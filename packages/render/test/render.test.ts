/**
 * Exportação de verdade com FFmpeg, conferindo pixels e áudio do arquivo final.
 */
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CancelledError, probeFile } from '@amv/media';
import { NodeRunner, nodeFs } from '@amv/media/src/node';
import { applyCommand, createProject, newId, type Asset, type Clip, type Command, type Project } from '@amv/project';
import { planWindows, renderProject, gainCurve, atempoChain, type RenderEnv } from '../src/index.js';

const runner = new NodeRunner();
let dir: string;
const S = 1_000_000;

async function ff(args: string[]) {
  const r = await runner.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (r.code !== 0) throw new Error(r.stderr);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'amv-render-'));
  // vermelho 0–2 s e verde 2–4 s no mesmo arquivo (para testar velocidade e trecho de origem)
  await ff(['-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=30:d=2', '-f', 'lavfi', '-i', 'color=c=lime:s=320x180:r=30:d=2', '-filter_complex', '[0][1]concat=n=2:v=1:a=0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '15', join(dir, 'rg.mp4')]);
  await ff(['-f', 'lavfi', '-i', 'color=c=lime:s=640x360:r=24000/1001:d=5', '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le', '-x265-params', 'log-level=error', join(dir, 'green.mkv')]);
  await ff(['-f', 'lavfi', '-i', 'color=c=blue:s=400x400', '-frames:v', '1', join(dir, 'blue.png')]);
  await ff(['-f', 'lavfi', '-i', 'color=c=white:s=100x100:r=30:d=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'white.mp4')]);
  await ff(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=5', '-af', 'volume=0.5', join(dir, 'tone.wav')]);
});
afterAll(() => { if (!process.env.KEEP) rmSync(dir, { recursive: true, force: true }); });

async function asset(path: string, id: string): Promise<Asset> {
  const { kind, probe } = await probeFile(runner, path);
  return { id, name: id, path, hash: id, kind, probe, status: 'ok', error: null, importedAt: '', tags: [], favorite: false };
}

function clip(trackId: string, assetId: string, start: number, dur: number, srcIn = 0, extra: Partial<Clip> = {}): Clip {
  return {
    id: newId('clp'), trackId, assetId, timelineStartUs: start, durationUs: dur, sourceInUs: srcIn, sourceOutUs: srcIn + dur, speed: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
    audio: { gainDb: 0, fadeInUs: 0, fadeOutUs: 0, pitchSemitones: 0, streamIndex: null },
    effects: [], transitionIn: null, keyframes: {}, text: null, origin: 'user', reason: null, confidence: null, label: null, ...extra,
  };
}

async function project(clips: (p: Project) => Clip[]): Promise<Project> {
  let p = createProject({ name: 't', settings: { width: 320, height: 180, fps: { num: 30, den: 1 } } });
  const assets = [await asset(join(dir, 'rg.mp4'), 'rg'), await asset(join(dir, 'green.mkv'), 'green'), await asset(join(dir, 'blue.png'), 'blue'), await asset(join(dir, 'white.mp4'), 'white'), await asset(join(dir, 'tone.wav'), 'tone')];
  const cmds: Command[] = assets.map((a) => ({ type: 'asset.add', asset: a }));
  p = applyCommand(p, { type: 'batch', commands: cmds }).project;
  return applyCommand(p, { type: 'batch', commands: clips(p).map((c) => ({ type: 'clip.add', clip: c })) }).project;
}

const track = (p: Project, name: string) => p.tracks.find((t) => t.name === name)!.id;

function env(p: Project, name: string): RenderEnv {
  return {
    runner,
    fs: nodeFs,
    workDir: join(dir, `work-${name}`),
    source: (id) => {
      const a = p.assets.find((x) => x.id === id)!;
      return { path: a.path, kind: a.kind, width: a.probe?.video?.width ?? 0, height: a.probe?.video?.height ?? 0, audioStreams: a.probe?.audio.map((s) => s.index) ?? [] };
    },
    textImage: async () => null,
  };
}

async function pixel(file: string, t: number): Promise<[number, number, number]> {
  const chunks: Uint8Array[] = [];
  await runner.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'crop=8:8:(iw-8)/2:(ih-8)/2,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { onStdoutBytes: (b) => chunks.push(b) });
  const b = Buffer.concat(chunks);
  return [b[0]!, b[1]!, b[2]!];
}

async function rmsDb(file: string, start: number, dur: number): Promise<number> {
  const r = await runner.run('ffmpeg', ['-hide_banner', '-ss', String(start), '-t', String(dur), '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-']);
  const m = r.stderr.match(/mean_volume: (-?[\d.]+|-inf) dB/);
  return m ? (m[1] === '-inf' ? -200 : Number(m[1])) : -200;
}

const near = (c: number[], target: number[], tol = 40) => c.every((v, i) => Math.abs(v - target[i]!) <= tol);
const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

describe('plano de janelas', () => {
  it('divide nos cortes e junta vazios', async () => {
    const p = await project((p) => [clip(track(p, 'V1'), 'rg', 0, 1 * S), clip(track(p, 'V1'), 'blue', 2 * S, 1 * S)]);
    const plan = planWindows(p);
    expect(plan.totalFrames).toBe(90);
    expect(plan.windows.map((w) => [w.startFrame, w.frames, w.layers.length])).toEqual([
      [0, 30, 1],
      [30, 30, 0],
      [60, 30, 1],
    ]);
  });
});

describe('exportação', () => {
  it('cortes, trecho de origem, HEVC 10-bit, imagem e buraco preto', async () => {
    const p = await project((p) => [
      clip(track(p, 'V1'), 'rg', 0, 1 * S, 0),
      clip(track(p, 'V1'), 'rg', 1 * S, 1 * S, 2.5 * S),
      clip(track(p, 'V1'), 'green', 2 * S, 1 * S, 1 * S),
      clip(track(p, 'V1'), 'blue', 3 * S, 1 * S),
      clip(track(p, 'V1'), 'rg', 5 * S, 1 * S, 0),
    ]);
    const out = join(dir, 'cortes.mp4');
    const fr: number[] = [];
    const r = await renderProject(p, out, { width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 128 }, env(p, 'a'), (x) => fr.push(x.fraction));
    expect(r.frames).toBe(180);
    const probe = await probeFile(runner, out);
    expect(probe.probe.durationUs).toBeGreaterThan(5.9 * S);
    expect(probe.probe.durationUs).toBeLessThan(6.1 * S);
    expect(probe.probe.video).toMatchObject({ codec: 'h264', width: 320, height: 180 });
    expect(probe.probe.audio).toHaveLength(1);
    expect(near(await pixel(out, 0.5), RED)).toBe(true);
    expect(near(await pixel(out, 1.5), GREEN)).toBe(true); // origem 2,5 s = parte verde
    expect(near(await pixel(out, 2.5), GREEN)).toBe(true);
    expect(near(await pixel(out, 3.5), BLUE)).toBe(true);
    expect(near(await pixel(out, 4.5), BLACK)).toBe(true);
    expect(near(await pixel(out, 5.5), RED)).toBe(true);
    expect(fr.at(-1)).toBe(1);
    expect(fr.every((v, i) => i === 0 || v >= fr[i - 1]! - 1e-9)).toBe(true);
    expect(existsSync(join(dir, 'work-a'))).toBe(false);
  });

  it('camadas: trilha de cima com opacidade e posição', async () => {
    const p = await project((p) => [
      clip(track(p, 'V1'), 'rg', 0, 1 * S),
      // branco pequeno (100px de 180px de altura, encaixado = cheio na altura) — escala 0,3 e deslocado
      clip(track(p, 'V2'), 'white', 0, 1 * S, 0, { transform: { x: 0, y: 0, scale: 0.3, rotation: 0, opacity: 0.5, crop: { left: 0, top: 0, right: 0, bottom: 0 } } }),
    ]);
    const out = join(dir, 'camadas.mp4');
    await renderProject(p, out, { width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 128 }, env(p, 'b'), () => undefined);
    // centro: branco 50% sobre vermelho ≈ (255,128,128)
    expect(near(await pixel(out, 0.5), [255, 128, 128], 45)).toBe(true);
  });

  it('clarão, dissolver e velocidade', async () => {
    const p = await project((p) => {
      const v1 = track(p, 'V1');
      return [
        clip(v1, 'rg', 0, 1 * S, 0, { effects: [{ id: 'f', effect: 'flash', enabled: true, params: { duration: 0.4, white: 1, strength: 1 } }] }),
        clip(v1, 'green', 1 * S, 1 * S, 0, { transitionIn: { transition: 'dissolve', durationUs: 0.6 * S, params: {} } }),
        // 2× a partir de 1 s da origem: 1 s de timeline = origem 1–3 s; a origem vira verde em 2 s → timeline 2,5 s
        clip(v1, 'rg', 2 * S, 1 * S, 1 * S, { speed: 2, sourceOutUs: 3 * S }),
      ];
    });
    const out = join(dir, 'efeitos.mp4');
    await renderProject(p, out, { width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 128 }, env(p, 'c'), () => undefined);
    expect(near(await pixel(out, 0.0), WHITE, 60)).toBe(true);
    expect(near(await pixel(out, 0.6), RED)).toBe(true);
    // meio do dissolver: vermelho (anterior continuando) + verde
    const mid = await pixel(out, 1.3);
    expect(mid[0]).toBeGreaterThan(70);
    expect(mid[1]).toBeGreaterThan(70);
    expect(near(await pixel(out, 1.8), GREEN)).toBe(true); // depois do dissolver: verde cheio
    expect(near(await pixel(out, 2.25), RED)).toBe(true);
    expect(near(await pixel(out, 2.8), GREEN)).toBe(true);
  });

  it('zoom e tremida renderizam sem erro, com a duração certa', async () => {
    const p = await project((p) => [
      clip(track(p, 'V1'), 'rg', 0, 2 * S, 0, {
        effects: [
          { id: 'z', effect: 'zoom', enabled: true, params: { from: 1, to: 1.5, ease: 1 } },
          { id: 's', effect: 'shake', enabled: true, params: { intensity: 20, frequency: 12, duration: 0.5 } },
          { id: 'c', effect: 'color', enabled: true, params: { brightness: 0, contrast: 1.1, saturation: 1.2 } },
          { id: 'r', effect: 'rgb_split', enabled: true, params: { amount: 6 } },
          { id: 'v', effect: 'vignette', enabled: true, params: { strength: 0.5 } },
          { id: 'b', effect: 'blur', enabled: true, params: { amount: 2 } },
        ],
      }),
    ]);
    const out = join(dir, 'zoom.mp4');
    const r = await renderProject(p, out, { width: 320, height: 180, enc: { codec: 'h265', quality: 0 }, audioBitrateK: 128 }, env(p, 'd'), () => undefined);
    expect(r.frames).toBe(60);
    expect((await probeFile(runner, out)).probe.video?.codec).toBe('hevc');
    expect(near(await pixel(out, 1.0), RED, 60)).toBe(true);
  });

  it('áudio: posição, ganho, fade e ducking por keyframes', async () => {
    const p = await project((p) => [
      clip(track(p, 'V1'), 'rg', 0, 4 * S, 0, { sourceOutUs: 4 * S }),
      clip(track(p, 'Música'), 'tone', 1 * S, 2 * S, 0, {
        keyframes: { 'audio.gainDb': [{ atUs: 0, value: 0, easing: 'linear' }, { atUs: 0.9 * S, value: 0, easing: 'linear' }, { atUs: 1 * S, value: -20, easing: 'linear' }] },
      }),
    ]);
    const out = join(dir, 'audio.mp4');
    await renderProject(p, out, { width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 192 }, env(p, 'e'), () => undefined);
    expect(await rmsDb(out, 0.1, 0.7)).toBeLessThan(-60); // silêncio antes de começar
    const loud = await rmsDb(out, 1.2, 0.5);
    const ducked = await rmsDb(out, 2.2, 0.5);
    expect(loud).toBeGreaterThan(-35); // o tom de teste tem ~-27 dB de média
    expect(loud - ducked).toBeGreaterThan(15); // ~20 dB mais baixo depois do keyframe
    expect(await rmsDb(out, 3.2, 0.6)).toBeLessThan(-60);
  });

  it('cancelar apaga os temporários e não deixa arquivo final', async () => {
    const p = await project((p) => [clip(track(p, 'V1'), 'green', 0, 4 * S, 0, { sourceOutUs: 4 * S })]);
    const out = join(dir, 'cancelado.mp4');
    const ctrl = new AbortController();
    const prom = renderProject(p, out, { width: 1920, height: 1080, enc: { codec: 'h264', quality: 2 }, audioBitrateK: 128 }, env(p, 'f'), (x) => x.stage === 'video' && ctrl.abort(), ctrl.signal);
    await expect(prom).rejects.toBeInstanceOf(CancelledError);
    expect(existsSync(out)).toBe(false);
    expect(existsSync(join(dir, 'work-f'))).toBe(false);
    expect(readdirSync(dir).some((f) => f.startsWith('cancelado'))).toBe(false);
  });

  it('texto: imagem única e sequência animada', async () => {
    const p = await project((p) => {
      const base = (start: number, extra: Partial<Clip>) =>
        clip(track(p, 'Legendas'), '', start, 1 * S, 0, {
          assetId: null,
          text: { text: 'Oi', font: 'Inter', size: 40, color: '#fff', outlineColor: null, outlineWidth: 0, shadow: false, animationIn: null, animationOut: null },
          ...extra,
        });
      return [clip(track(p, 'V1'), 'rg', 0, 2 * S, 0, { sourceOutUs: 2 * S }), base(0, {}), base(1 * S, { label: 'seq' })];
    });
    const e = env(p, 'h');
    e.textImage = async (c, W, H, d, fps) => {
      // estática: quadro todo branco; sequência: quadros pares brancos, ímpares transparentes (fade simulado)
      if (c.label !== 'seq') {
        await ff(['-f', 'lavfi', '-i', `color=c=white:s=${W}x${H}`, '-frames:v', '1', join(d, 'a.png')]);
        return { path: join(d, 'a.png'), sequence: false };
      }
      await ff(['-f', 'lavfi', '-i', `color=c=blue:s=${W}x${H}:r=${fps.num}/${fps.den}:d=1`, '-start_number', '0', join(d, 'f%05d.png')]);
      return { path: join(d, 'f%05d.png'), sequence: true };
    };
    const out = join(dir, 'texto.mp4');
    await renderProject(p, out, { width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 128 }, e, () => undefined);
    expect(near(await pixel(out, 0.5), WHITE)).toBe(true);
    expect(near(await pixel(out, 1.5), BLUE)).toBe(true);
  });

  it('recusa exportar com mídia ausente', async () => {
    let p = await project((p) => [clip(track(p, 'V1'), 'rg', 0, 1 * S)]);
    p = applyCommand(p, { type: 'asset.update', assetId: 'rg', patch: { status: 'missing' } }).project;
    await expect(renderProject(p, join(dir, 'x.mp4'), { width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 128 }, env(p, 'g'), () => undefined)).rejects.toThrow(/faltam arquivos: rg/);
  });
});

describe('auxiliares de áudio', () => {
  it('atempo encadeado e curva de ganho', () => {
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(0.25)).toEqual(['atempo=0.5', 'atempo=0.5']);
    expect(atempoChain(2)).toEqual(['atempo=2']);
    expect(gainCurve([{ atUs: 0, value: 0 }, { atUs: S, value: -20 }])).toContain('if(lt(t,1)');
  });
});
