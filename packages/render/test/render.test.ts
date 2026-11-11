/**
 * Exportação de verdade com FFmpeg, conferindo pixels e áudio do arquivo final.
 */
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeFile } from '@amv/media';
import type { ProcessRunner } from '@amv/media';
import { NodeRunner, nodeFs } from '@amv/media/src/node';
import { applyCommand, createProject, newId, TextContentSchema, type Asset, type Clip, type Command, type Project } from '@amv/project';
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
  await ff(['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'black.mp4')]);
  await ff(['-f', 'lavfi', '-i', 'color=c=0x804040:s=320x180:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'grade-source.mp4')]);
  await ff(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=5', '-af', 'volume=0.5', join(dir, 'tone.wav')]);
  await ff(['-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=5', '-af', 'volume=0.5', join(dir, 'voice-tone.wav')]);
  await ff(['-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=30:d=5', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(dir, 'video-audio.mp4')]);
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
    blendMode: 'normal', mask: 'none', groupId: null,
    audio: { gainDb: 0, fadeInUs: 0, fadeOutUs: 0, pitchSemitones: 0, pitchMode: 'preserve', streamIndex: null },
    effects: [], transitionIn: null, keyframes: {}, text: null, origin: 'user', reason: null, confidence: null, label: null, ...extra, reverse: extra.reverse ?? false,
  };
}

async function project(clips: (p: Project) => Clip[]): Promise<Project> {
  let p = createProject({ name: 't', settings: { width: 320, height: 180, fps: { num: 30, den: 1 } } });
  const assets = [await asset(join(dir, 'rg.mp4'), 'rg'), await asset(join(dir, 'green.mkv'), 'green'), await asset(join(dir, 'blue.png'), 'blue'), await asset(join(dir, 'white.mp4'), 'white'), await asset(join(dir, 'black.mp4'), 'black'), await asset(join(dir, 'grade-source.mp4'), 'grade-source'), await asset(join(dir, 'tone.wav'), 'tone'), await asset(join(dir, 'voice-tone.wav'), 'voice-tone'), await asset(join(dir, 'video-audio.mp4'), 'av')];
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

async function pixelAt(file: string, t: number, x: number, y: number): Promise<[number, number, number]> {
  const chunks: Uint8Array[] = [];
  await runner.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=8:8:${x}:${y},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { onStdoutBytes: (b) => chunks.push(b) });
  const b = Buffer.concat(chunks);
  return [b[0]!, b[1]!, b[2]!];
}

async function rmsDb(file: string, start: number, dur: number): Promise<number> {
  const r = await runner.run('ffmpeg', ['-hide_banner', '-ss', String(start), '-t', String(dur), '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-']);
  const m = r.stderr.match(/mean_volume: (-?[\d.]+|-inf) dB/);
  return m ? (m[1] === '-inf' ? -200 : Number(m[1])) : -200;
}

async function rmsBandDb(file: string, start: number, dur: number, frequency: number, width = 80): Promise<number> {
  const r = await runner.run('ffmpeg', ['-hide_banner', '-ss', String(start), '-t', String(dur), '-i', file, '-af', `bandpass=f=${frequency}:width_type=h:width=${width},volumedetect`, '-vn', '-f', 'null', '-']);
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
  it('refaz a exportação inteira em CPU se o hardware falhar durante o render automático', async () => {
    const p = await project((p) => [clip(track(p, 'V1'), 'rg', 0, S)]);
    const base = env(p, 'hardware-fallback');
    const fallbackRunner: ProcessRunner = {
      run: async (tool, args, options) => {
        if (tool === 'ffmpeg' && args.includes('-encoders')) {
          return { code: 0, stdout: ' V..... h264_nvenc NVIDIA NVENC H.264\n', stderr: '' };
        }
        if (tool === 'ffmpeg' && args.includes('h264_nvenc') && args.includes('-filter_complex')) {
          options?.onStderr?.('simulated hardware failure\n');
          return { code: 1, stdout: '', stderr: 'simulated hardware failure' };
        }
        if (tool === 'ffmpeg' && args.includes('h264_nvenc')) return { code: 0, stdout: '', stderr: '' };
        return runner.run(tool, args, options);
      },
    };
    const out = join(dir, 'hardware-fallback.mp4');
    const result = await renderProject(p, out, {
      width: 320, height: 180, enc: { codec: 'h264', quality: 0, encoder: 'auto' }, audioBitrateK: 128,
    }, { ...base, runner: fallbackRunner }, () => undefined);
    expect(result.validation.videoCodec).toBe('h264');
    expect(readFileSync(result.logPath, 'utf8')).toContain('retrying the complete export on CPU');
    expect(existsSync(join(dir, 'work-hardware-fallback-cpu-fallback'))).toBe(false);
  });

  it('exporta MKV H.264 em FPS e resolução escolhidos e valida o arquivo decodificado', async () => {
    const p = await project((p) => [clip(track(p, 'V1'), 'rg', 0, 2 * S)]);
    const out = join(dir, 'custom-24fps.mkv');
    const result = await renderProject(p, out, {
      width: 160, height: 90, enc: { codec: 'h264', quality: 0, encoder: 'cpu' },
      audioBitrateK: 128, container: 'mkv', fps: { num: 24, den: 1 },
    }, env(p, 'custom-mkv'), () => undefined);
    expect(result.validation).toMatchObject({
      width: 160, height: 90, fps: { num: 24, den: 1 }, videoCodec: 'h264',
      frames: 48, audioStreams: 1, audioSyncDifferenceUs: expect.any(Number),
    });
    expect(result.logPath).toBe(`${out}.log`);
    expect(existsSync(out)).toBe(true);
    expect(existsSync(result.logPath)).toBe(true);
  });

  it('preserva o arquivo anterior se a validação do novo render falhar', async () => {
    const p = await project((p) => [clip(track(p, 'V1'), 'rg', 0, S)]);
    const out = join(dir, 'preserve-output.mp4');
    writeFileSync(out, 'previous valid output');
    const base = env(p, 'failed-validation');
    const failedProbeEnv: RenderEnv = {
      ...base,
      runner: {
        run: async (tool, args, options) => {
          if (tool === 'ffprobe' && args.includes('-count_frames')) return { code: 1, stdout: '', stderr: 'simulated validation failure' };
          return runner.run(tool, args, options);
        },
      },
    };
    await expect(renderProject(p, out, {
      width: 320, height: 180, enc: { codec: 'h264', quality: 0, encoder: 'cpu' }, audioBitrateK: 128,
    }, failedProbeEnv, () => undefined)).rejects.toThrow(/simulated validation failure/);
    expect(readFileSync(out, 'utf8')).toBe('previous valid output');
    expect(existsSync(`${out}.part.mp4`)).toBe(false);
    expect(existsSync(`${out}.log`)).toBe(true);
  });

  it('renderiza curva/intensidade de dissolve e whip pan nas duas cenas', async () => {
    const dissolveProject = await project((p) => [
      clip(track(p, 'V1'), 'rg', 0, S, 0),
      clip(track(p, 'V1'), 'rg', S, S, 2 * S, {
        transitionIn: { transition: 'dissolve', durationUs: 500_000, params: { curve: 'ease-in-out', intensity: 0.5 } },
      }),
    ]);
    const dissolveOut = join(dir, 'transition-dissolve.mp4');
    await renderProject(dissolveProject, dissolveOut, { width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 128 }, env(dissolveProject, 'transition-dissolve'), () => undefined);
    const dissolveEarly = await pixel(dissolveOut, 1.05);
    const dissolveLate = await pixel(dissolveOut, 1.45);
    expect(dissolveEarly[0]).toBeGreaterThan(dissolveEarly[1]!);
    expect(dissolveLate[1]).toBeGreaterThan(dissolveLate[0]!);

    const whipProject = await project((p) => [
      clip(track(p, 'V1'), 'rg', 0, S, 0),
      clip(track(p, 'V1'), 'rg', S, S, 2 * S, {
        transitionIn: { transition: 'whip_pan', durationUs: 500_000, params: { curve: 'linear', intensity: 0.7, direction: 1, blur: 4 } },
      }),
    ]);
    const whipOut = join(dir, 'transition-whip.mp4');
    await renderProject(whipProject, whipOut, { width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 128 }, env(whipProject, 'transition-whip'), () => undefined);
    const whipMiddleRight = await pixelAt(whipOut, 1.25, 280, 80);
    const whipEnd = await pixel(whipOut, 1.45);
    expect(whipMiddleRight[0]).toBeGreaterThan(whipMiddleRight[1]!);
    expect(whipEnd[1]).toBeGreaterThan(whipEnd[0]!);
  });

  it('renderiza color grading com exposição, balanço tonal e vinheta via FFmpeg', async () => {
    const p = await project((p) => [
      clip(track(p, 'V1'), 'grade-source', 0, 1 * S, 0, {
        effects: [{
          id: 'grade',
          effect: 'color',
          enabled: true,
          params: {
            brightness: 0,
            contrast: 1.08,
            saturation: 0.96,
            exposure: 0.35,
            temperature: 18,
            tint: -8,
            hue: 12,
            shadows: -0.12,
            midtones: 0.06,
            highlights: 0.1,
            vignette: 0.2,
          },
        }],
      }),
    ]);
    const out = join(dir, 'color-grade.mp4');
    await renderProject(p, out, { width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 128 }, env(p, 'color-grade'), () => undefined);
    const graded = await pixel(out, 0.5);
    expect(near(graded, [128, 64, 64], 15)).toBe(false);
    expect(graded.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255)).toBe(true);
  });

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
    expect(r.validation.warnings).toEqual([]);
    expect(fr.at(-1)).toBe(1);
    expect(fr.every((v, i) => i === 0 || v >= fr[i - 1]! - 1e-9)).toBe(true);
    expect(existsSync(join(dir, 'work-a'))).toBe(false);
  });

  it('avisa sobre trecho preto no conteúdo, sem tratar gaps da timeline como falha', async () => {
    const p = await project((p) => [clip(track(p, 'V1'), 'black', 0, S)]);
    const out = join(dir, 'unexpected-black.mp4');
    const result = await renderProject(p, out, {
      width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 128,
    }, env(p, 'unexpected-black'), () => undefined);
    expect(result.validation.blackIntervals.length).toBeGreaterThan(0);
    expect(result.validation.warnings.join(' ')).toContain('fora de gaps/fades intencionais');
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

  it('anima posição entre keyframes no vídeo exportado', async () => {
    const p = await project((p) => [
      clip(track(p, 'V1'), 'rg', 0, 1 * S, 0, {
        keyframes: {
          'transform.x': [
            { atUs: 0, value: -80, easing: 'linear' },
            { atUs: 1 * S, value: 80, easing: 'ease-in' },
          ],
        },
      }),
    ]);
    const out = join(dir, 'posicao-keyframe.mp4');
    await renderProject(p, out, { width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 128 }, env(p, 'keyframes'), () => undefined);
    expect(near(await pixelAt(out, 0.05, 16, 86), RED)).toBe(true);
    expect(near(await pixelAt(out, 0.5, 300, 86), BLACK)).toBe(true);
    expect(near(await pixelAt(out, 0.95, 16, 86), BLACK)).toBe(true);
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

  it('renderiza speed ramp, freeze e reverse em FPS racional', async () => {
    let ramp = await project((p) => [
      clip(track(p, 'V1'), 'rg', 0, 4 * S, 0, {
        keyframes: { speed: [
          { atUs: 0, value: 0.5, easing: 'linear' },
          { atUs: 4 * S, value: 1.5, easing: 'linear' },
        ] },
      }),
      clip(track(p, 'Música'), 'tone', 0, 4 * S, 0, {
        audio: { gainDb: 0, fadeInUs: 0, fadeOutUs: 0, pitchSemitones: 0, pitchMode: 'follow', streamIndex: null },
        keyframes: { speed: [
          { atUs: 0, value: 0.5, easing: 'linear' },
          { atUs: 4 * S, value: 1.5, easing: 'linear' },
        ] },
      }),
    ]);
    ramp = { ...ramp, settings: { ...ramp.settings, fps: { num: 24_000, den: 1001 } } };
    const rampOut = join(dir, 'speed-ramp.mp4');
    const rampResult = await renderProject(ramp, rampOut, { width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 128 }, env(ramp, 'speed-ramp'), () => undefined);
    expect(rampResult.frames).toBe(96);
    expect(near(await pixel(rampOut, 2.25), RED)).toBe(true);
    expect(near(await pixel(rampOut, 2.75), GREEN)).toBe(true);

    const freeze = await project((p) => [clip(track(p, 'V1'), 'rg', 0, 2 * S, 0, {
      keyframes: { speed: [
        { atUs: 0, value: 0, easing: 'hold' },
        { atUs: 2 * S, value: 0, easing: 'linear' },
      ] },
    })]);
    const freezeOut = join(dir, 'speed-freeze.mp4');
    await renderProject(freeze, freezeOut, { width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 128 }, env(freeze, 'speed-freeze'), () => undefined);
    expect(near(await pixel(freezeOut, 0.25), RED)).toBe(true);
    expect(near(await pixel(freezeOut, 1.75), RED)).toBe(true);

    const reverse = await project((p) => [clip(track(p, 'V1'), 'rg', 0, 4 * S, 0, { reverse: true })]);
    const reverseOut = join(dir, 'speed-reverse.mp4');
    await renderProject(reverse, reverseOut, { width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 128 }, env(reverse, 'speed-reverse'), () => undefined);
    expect(near(await pixel(reverseOut, 0.5), GREEN)).toBe(true);
    expect(near(await pixel(reverseOut, 3.5), RED)).toBe(true);
  });

  it('renderiza máscara circular, mesclagem e escala/opacidade animadas', async () => {
    const masked = await project((p) => [
      clip(track(p, 'V1'), 'rg', 0, 2 * S, 0),
      clip(track(p, 'V2'), 'rg', 0, 2 * S, 2 * S, { mask: 'left' }),
    ]);
    const maskedOut = join(dir, 'composition-mask.mp4');
    await renderProject(masked, maskedOut, { width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 128 }, env(masked, 'composition-mask'), () => undefined);
    expect(near(await pixelAt(maskedOut, 0.5, 40, 80), GREEN)).toBe(true);
    expect(near(await pixelAt(maskedOut, 0.5, 240, 80), RED)).toBe(true);

    const blended = await project((p) => [
      clip(track(p, 'V1'), 'rg', 0, 2 * S, 0),
      clip(track(p, 'V2'), 'rg', 0, 2 * S, 0, { blendMode: 'multiply' }),
    ]);
    const blendedOut = join(dir, 'composition-blend.mp4');
    await renderProject(blended, blendedOut, { width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 128 }, env(blended, 'composition-blend'), () => undefined);
    expect(near(await pixel(blendedOut, 0.5), RED)).toBe(true);

    const animated = await project((p) => [
      clip(track(p, 'V1'), 'rg', 0, 2 * S, 0),
      clip(track(p, 'V2'), 'rg', 0, 2 * S, 2 * S, {
        keyframes: {
          'transform.scale': [
            { atUs: 0, value: 0.3, easing: 'linear' },
            { atUs: 2 * S, value: 0.8, easing: 'linear' },
          ],
          'transform.opacity': [
            { atUs: 0, value: 0, easing: 'linear' },
            { atUs: 1 * S, value: 1, easing: 'linear' },
          ],
        },
      }),
    ]);
    const animatedOut = join(dir, 'composition-keyframes.mp4');
    const animatedEnv = env(animated, 'composition-keyframes');
    await renderProject(animated, animatedOut, { width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 128 }, animatedEnv, () => undefined);
    expect(near(await pixel(animatedOut, 0.1), RED)).toBe(true);
    const animatedPixel = await pixelAt(animatedOut, 1.5, 80, 80);
    expect(near(animatedPixel, GREEN)).toBe(true);
    expect(near(await pixelAt(animatedOut, 0.1, 80, 80), RED)).toBe(true);
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

  it('ducking automático reduz a música durante diálogo e limita picos na saída', async () => {
    let p = await project((p) => [
      clip(track(p, 'V1'), 'rg', 0, 4 * S, 0, { sourceOutUs: 4 * S }),
      clip(track(p, 'Música'), 'tone', 500_000, 3 * S),
      clip(track(p, 'Vozes'), 'tone', 1_500_000, S, 0, { audio: { gainDb: -16, fadeInUs: 0, fadeOutUs: 0, pitchSemitones: 0, pitchMode: 'preserve', streamIndex: null } }),
    ]);
    p = applyCommand(p, { type: 'audioMix.update', patch: { duckingAttackMs: 0, duckingReleaseMs: 0, duckingAmountDb: 12, limiterCeilingDb: -1 } }).project;
    const duckedOut = join(dir, 'audio-ducked.mp4');
    const renderResult = await renderProject(p, duckedOut, { width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 192 }, env(p, 'audio-ducked'), () => undefined);
    const duckedMusic = await rmsDb(duckedOut, 0.7, 0.5);
    const duckedVoice = await rmsDb(duckedOut, 1.8, 0.5);
    expect(duckedMusic - duckedVoice).toBeGreaterThan(7);

    const loud = await runner.run('ffmpeg', ['-hide_banner', '-i', duckedOut, '-af', 'volumedetect', '-vn', '-f', 'null', '-']);
    const peak = Number(loud.stderr.match(/max_volume: (-?[\d.]+) dB/)?.[1]);
    expect(Number.isFinite(peak)).toBe(true);
    expect(peak).toBeLessThanOrEqual(-0.5);
    expect(renderResult.audioMetrics.truePeakDbfs).not.toBeNull();
    expect(renderResult.audioMetrics.truePeakDbfs!).toBeLessThanOrEqual(-0.5);
    expect(renderResult.audioMetrics.clippingDetected).toBe(false);
  });

  it('não soma o ducking global sobre os keyframes manuais', async () => {
    let p = await project((p) => [
      clip(track(p, 'Música'), 'tone', 0, 3 * S, 0, {
        audio: { gainDb: 0, fadeInUs: 0, fadeOutUs: 0, pitchSemitones: 0, pitchMode: 'preserve', streamIndex: null, duckingMode: 'manual' },
        keyframes: {
          'audio.gainDb': [
            { atUs: 0, value: 0, easing: 'linear' },
            { atUs: 650_000, value: 0, easing: 'linear' },
            { atUs: S, value: -16, easing: 'linear' },
            { atUs: 2 * S, value: -16, easing: 'linear' },
            { atUs: 2 * S + 1, value: 0, easing: 'linear' },
          ],
        },
      }),
      clip(track(p, 'Vozes'), 'voice-tone', S, S),
    ]);
    p = applyCommand(p, {
      type: 'audioMix.update',
      patch: { duckingAttackMs: 0, duckingReleaseMs: 0, duckingAmountDb: 12, limiterEnabled: false },
    }).project;
    const output = join(dir, 'generated-dialogue-ducking.wav');
    await renderProject(p, output, {
      width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 192, audioOnly: true,
    }, env(p, 'generated-dialogue-ducking'), () => undefined);
    const beforeSpeech = await rmsBandDb(output, 0.2, 0.5, 440, 1);
    const duringSpeech = await rmsBandDb(output, 1.2, 0.5, 440, 1);
    const afterSpeech = await rmsBandDb(output, 2.2, 0.5, 440, 1);
    expect(beforeSpeech - duringSpeech).toBeCloseTo(16, 0);
    expect(afterSpeech).toBeCloseTo(beforeSpeech, 1);
  });

  it('normaliza a mixagem WAV ao alvo EBU R128 configurado', async () => {
    let p = await project((p) => [
      clip(track(p, 'V1'), 'rg', 0, 4 * S, 0, { sourceOutUs: 4 * S }),
      clip(track(p, 'Música'), 'tone', 0, 3 * S),
    ]);
    p = applyCommand(p, { type: 'audioMix.update', patch: { normalization: 'ebu-r128', targetLufs: -14 } }).project;
    const output = join(dir, 'normalized-mix.wav');
    const result = await renderProject(p, output, { width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 192, audioOnly: true }, env(p, 'normalized-mix'), () => undefined);
    expect(result.audioMetrics.integratedLufs).not.toBeNull();
    expect(result.audioMetrics.integratedLufs!).toBeCloseTo(-14, 0);
    expect(result.audioMetrics.truePeakDbfs).not.toBeNull();
  });

  it('inclui áudio original de clipes de vídeo e aplica ducking à música', async () => {
    let p = await project((p) => [
      clip(track(p, 'V1'), 'av', 1_500_000, 1_500_000, 0),
      clip(track(p, 'Música'), 'tone', 500_000, 3 * S),
    ]);
    p = applyCommand(p, { type: 'audioMix.update', patch: { duckingAttackMs: 0, duckingReleaseMs: 0, duckingAmountDb: 12 } }).project;
    const duckedOut = join(dir, 'embedded-audio-ducked.mp4');
    await renderProject(p, duckedOut, { width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 192 }, env(p, 'embedded-audio-ducked'), () => undefined);
    const duckedMusic = await rmsBandDb(duckedOut, 1.8, 0.5, 440);
    const duckedVoice = await rmsBandDb(duckedOut, 1.8, 0.5, 880);
    expect(duckedVoice).toBeGreaterThan(-35);

    p = applyCommand(p, { type: 'audioMix.update', patch: { duckingEnabled: false } }).project;
    const regularOut = join(dir, 'embedded-audio-regular.mp4');
    await renderProject(p, regularOut, { width: 320, height: 180, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 192 }, env(p, 'embedded-audio-regular'), () => undefined);
    const regularMusic = await rmsBandDb(regularOut, 1.8, 0.5, 440);
    expect(regularMusic - duckedMusic).toBeGreaterThan(8);
  });

  it('cancelar apaga os temporários e não deixa arquivo final', async () => {
    const p = await project((p) => [clip(track(p, 'V1'), 'green', 0, 4 * S, 0, { sourceOutUs: 4 * S })]);
    const out = join(dir, 'cancelado.mp4');
    const ctrl = new AbortController();
    const prom = renderProject(p, out, { width: 1920, height: 1080, enc: { codec: 'h264', quality: 2 }, audioBitrateK: 128 }, env(p, 'f'), (x) => x.stage === 'video' && ctrl.abort(), ctrl.signal);
    await expect(prom).rejects.toMatchObject({ name: 'CancelledError', logPath: `${out}.log` });
    expect(existsSync(out)).toBe(false);
    expect(existsSync(join(dir, 'work-f'))).toBe(false);
    expect(existsSync(`${out}.part.mp4`)).toBe(false);
    expect(existsSync(`${out}.log`)).toBe(true);
    expect(readdirSync(dir).some((f) => f === 'cancelado.mp4')).toBe(false);
  });

  it('texto: imagem única e sequência animada', async () => {
    const p = await project((p) => {
      const base = (start: number, extra: Partial<Clip>) =>
        clip(track(p, 'Legendas'), '', start, 1 * S, 0, {
          assetId: null,
          text: TextContentSchema.parse({ text: 'Oi', font: 'Inter', size: 40, color: '#fff', outlineColor: null, outlineWidth: 0, shadow: false, animationIn: null, animationOut: null }),
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

describe('projeto vertical com episódio horizontal', () => {
  async function topPixel(file: string): Promise<[number, number, number]> {
    const chunks: Uint8Array[] = [];
    // faixa perto do topo (10% da altura), no centro
    await runner.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', '0.5', '-i', file, '-frames:v', '1', '-vf', 'crop=8:8:(iw-8)/2:ih*0.1,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { onStdoutBytes: (b) => chunks.push(b) });
    const b = chunks[0]!;
    return [b[0]!, b[1]!, b[2]!];
  }
  it('"Preencher" ocupa o quadro todo na exportação; "Encaixar" deixa faixa preta', async () => {
    const { fillScale } = await import('@amv/project');
    const a = await asset(join(dir, 'rg.mp4'), 'rg');
    let p = createProject({ name: 'v', settings: { width: 180, height: 320, fps: { num: 30, den: 1 } } });
    p = applyCommand(p, { type: 'asset.add', asset: a }).project;
    const v1 = track(p, 'V1');
    const fill = fillScale(p, a);
    const mk = async (scale: number, name: string) => {
      const q = applyCommand(p, { type: 'clip.add', clip: clip(v1, 'rg', 0, 1 * S, 0, { transform: { x: 0, y: 0, scale, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } } }) }).project;
      const out = join(dir, `${name}.mp4`);
      await renderProject(q, out, { width: 180, height: 320, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 128 }, env(q, name), () => undefined);
      return topPixel(out);
    };
    expect(near(await mk(fill, 'vert-fill'), RED)).toBe(true);
    expect(near(await mk(1, 'vert-fit'), BLACK)).toBe(true);
  });
});
