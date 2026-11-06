/**
 * Testes de integração com FFmpeg/FFprobe REAIS sobre mídia sintética.
 * Gere as fixtures antes: `pnpm fixtures`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CancelledError,
  computeWaveform,
  decodeWaveform,
  hashFile,
  inspectFile,
  JobQueue,
  makePoster,
  makeProxy,
  makeThumbStrip,
  prepareArtifacts,
  probeFile,
  probeWarnings,
} from '../src/index.js';
import { NodeRunner, nodeFs } from '../src/node.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/generated');
const f = (name: string) => join(FIX, name);
const runner = new NodeRunner();
let tmp: string;

beforeAll(async () => {
  if (!(await nodeFs.exists(f('hevc10_23976.mkv')))) {
    throw new Error('fixtures ausentes: rode `pnpm fixtures` na raiz');
  }
  tmp = mkdtempSync(join(tmpdir(), 'amv-media-'));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function keyframeTimes(path: string): Promise<number[]> {
  const r = await runner.run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', path]);
  return r.stdout.trim().split('\n').map((l) => parseFloat(l));
}

describe('probe', () => {
  it('MKV HEVC 10-bit de anime: 2 áudios com idioma, legenda ASS, avisos', async () => {
    const r = await probeFile(runner, f('hevc10_23976.mkv'));
    expect(r.kind).toBe('video');
    expect(r.probe.container).toContain('matroska');
    expect(r.probe.video).toMatchObject({ codec: 'hevc', width: 640, height: 360, bitDepth: 10, fps: { num: 24000, den: 1001 }, vfr: false });
    expect(r.probe.audio.map((a) => a.language)).toEqual(['jpn', 'por']);
    expect(r.probe.subtitles[0]).toMatchObject({ codec: 'ass', language: 'por' });
    expect(r.probe.durationUs).toBeGreaterThan(2_900_000);
    const w = probeWarnings(r).join(' ');
    expect(w).toMatch(/10-bit/);
    expect(w).toMatch(/HEVC/);
    expect(w).toMatch(/2 faixas de áudio/);
  });

  it('detecta VFR', async () => {
    const r = await probeFile(runner, f('vfr.mp4'));
    expect(r.probe.video!.vfr).toBe(true);
    expect(probeWarnings(r).join()).toMatch(/VFR/);
  });

  it('MP3 com capa é áudio, com tags', async () => {
    const r = await probeFile(runner, f('musica_capa.mp3'));
    expect(r.kind).toBe('audio');
    expect(r.probe.video).toBeNull();
    expect(r.probe.tags).toMatchObject({ title: 'Faixa de Teste', artist: 'AMV Studio', genre: 'Teste' });
  });

  it('todos os formatos da lista', async () => {
    const expected: Record<string, string> = {
      'h264_30fps.mp4': 'video', 'vp9.webm': 'video', 'prores.mov': 'video',
      'click_120bpm.wav': 'audio', 'tom.flac': 'audio', 'imagem.png': 'image', 'imagem.jpg': 'image',
    };
    for (const [file, kind] of Object.entries(expected)) {
      const r = await probeFile(runner, f(file));
      expect(r.kind, file).toBe(kind);
    }
    const png = await probeFile(runner, f('imagem.png'));
    expect(png.probe.video).toMatchObject({ width: 800, height: 600 });
  });

  it('erro claro para arquivo que não é mídia', async () => {
    const bogus = join(tmp, 'nada.mp4');
    await nodeFs.writeFile(bogus, new TextEncoder().encode('isto não é vídeo'));
    await expect(probeFile(runner, bogus)).rejects.toThrow(/não foi possível ler/);
  });
});

describe('proxy', () => {
  it('HEVC 10-bit MKV vira H.264 8-bit CFR com keyframe a cada ~0,5 s, com progresso real', async () => {
    const out = join(tmp, 'proxy.mp4');
    const { probe } = await probeFile(runner, f('hevc10_23976.mkv'));
    const fractions: number[] = [];
    await makeProxy(runner, nodeFs, f('hevc10_23976.mkv'), out, probe, (fr) => fr !== null && fractions.push(fr));
    const p = await probeFile(runner, out);
    expect(p.probe.video).toMatchObject({ codec: 'h264', pixFmt: 'yuv420p', height: 360, fps: { num: 24000, den: 1001 } });
    expect(p.probe.audio).toHaveLength(1);
    expect(Math.abs(p.probe.durationUs - probe.durationUs)).toBeLessThan(150_000);
    const kf = await keyframeTimes(out);
    const gaps = kf.slice(1).map((t, i) => t - kf[i]!);
    expect(Math.max(...gaps)).toBeLessThan(0.6);
    expect(fractions.at(-1)).toBe(1);
    expect(await nodeFs.exists(`${out}.part`)).toBe(false);
  });

  it('VFR vira CFR', async () => {
    const out = join(tmp, 'vfr-proxy.mp4');
    const { probe } = await probeFile(runner, f('vfr.mp4'));
    await makeProxy(runner, nodeFs, f('vfr.mp4'), out, probe, () => undefined);
    const p = await probeFile(runner, out);
    expect(p.probe.video!.vfr).toBe(false);
  });

  it('cancelar mata o processo e não deixa arquivo pela metade', async () => {
    const out = join(tmp, 'cancel.mp4');
    const { probe } = await probeFile(runner, f('h264_30fps.mp4'));
    const ctrl = new AbortController();
    const started = Date.now();
    const p = makeProxy(runner, nodeFs, f('h264_30fps.mp4'), out, { ...probe, durationUs: probe.durationUs }, () => ctrl.abort(), ctrl.signal, { height: 720, crf: 18, keyframeIntervalS: 0.5 });
    await expect(p).rejects.toBeInstanceOf(CancelledError);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(await nodeFs.exists(out)).toBe(false);
    expect(await nodeFs.exists(`${out}.part`)).toBe(false);
  });
});

describe('miniaturas e waveform', () => {
  it('pôster e folha de miniaturas', async () => {
    const { probe } = await probeFile(runner, f('h264_30fps.mp4'));
    const poster = join(tmp, 'poster.jpg');
    await makePoster(runner, nodeFs, f('h264_30fps.mp4'), poster, probe);
    expect((await probeFile(runner, poster)).probe.video!.height).toBe(180);

    const strip = join(tmp, 'strip.jpg');
    const plan = await makeThumbStrip(runner, nodeFs, f('h264_30fps.mp4'), strip, probe, () => undefined);
    const img = await probeFile(runner, strip);
    expect(img.probe.video!.width).toBe(plan.tileWidth * plan.cols);
    expect(img.probe.video!.height).toBe(plan.tileHeight * plan.rows);
  });

  it('waveform encontra os cliques de 120 BPM a cada 0,5 s', async () => {
    const { probe } = await probeFile(runner, f('click_120bpm.wav'));
    const w = await computeWaveform(runner, f('click_120bpm.wav'), probe, () => undefined);
    expect(w.durationUs).toBeGreaterThan(7_900_000);
    const base = w.levels[0]!;
    const secondsPerBucket = base.samplesPerBucket / w.sampleRate;
    const loud: number[] = [];
    for (let i = 0; i < base.maxs.length; i++) {
      if (base.maxs[i]! > 20000 && (i === 0 || base.maxs[i - 1]! <= 20000)) loud.push(i * secondsPerBucket);
    }
    expect(loud).toHaveLength(16);
    loud.forEach((t, i) => expect(t).toBeCloseTo(i * 0.5, 1));
  });
});

describe('importação completa', () => {
  it('hash, probe e artefatos em cache; segunda vez reaproveita', async () => {
    const queue = new JobQueue(2);
    const env = { runner, fs: nodeFs, queue, cacheRoot: join(tmp, 'cache') };
    const { asset, warnings } = await inspectFile(env, f('hevc10_23976.mkv'));
    expect(asset.kind).toBe('video');
    expect(asset.hash).toMatch(/^v1:/);
    expect(warnings.length).toBeGreaterThan(0);

    const { artifacts, errors } = prepareArtifacts(env, { ...asset, probe: asset.probe! });
    const a = await artifacts;
    expect(await errors).toEqual([]);
    for (const p of [a.posterPath, a.stripPath, a.waveformPath, a.proxyPath]) {
      expect(p && (await nodeFs.exists(p))).toBe(true);
    }
    const wf = decodeWaveform(await nodeFs.readFile(a.waveformPath!));
    expect(wf.levels.length).toBeGreaterThan(0);

    const kinds = queue.list().map((j) => j.kind).sort();
    expect(kinds).toEqual(['poster', 'probe', 'proxy', 'thumbnails', 'waveform']);
    queue.clearFinished();
    await prepareArtifacts(env, { ...asset, probe: asset.probe! }).artifacts;
    expect(queue.list()).toEqual([]);

    const same = await hashFile(nodeFs, f('hevc10_23976.mkv'));
    expect(same.hash).toBe(asset.hash);
  }, 60_000);
});
