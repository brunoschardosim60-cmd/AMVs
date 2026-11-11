import { describe, expect, it } from 'vitest';
import {
  buildLevels,
  CancelledError,
  decodeWaveform,
  detectVfr,
  encodeWaveform,
  etaSeconds,
  JobQueue,
  joinPath,
  PeakAccumulator,
  pickLevel,
  planThumbStrip,
  ProgressParser,
  audioProxyArgs,
  proxyArgs,
  proxyFps,
  type ProgressUpdate,
} from '../src/index.js';
import type { ProbeInfo } from '@amv/project';

const probe = (over: Partial<ProbeInfo> = {}): ProbeInfo => ({
  container: 'mov,mp4',
  durationUs: 1_440_000_000,
  sizeBytes: 1,
  bitRate: null,
  video: { codec: 'hevc', profile: null, width: 1920, height: 1080, pixFmt: 'yuv420p10le', bitDepth: 10, fps: { num: 24000, den: 1001 }, avgFps: { num: 24000, den: 1001 }, vfr: false, frameCount: null },
  audio: [{ index: 1, codec: 'aac', sampleRate: 48000, channels: 2, channelLayout: 'stereo', language: null, title: null }],
  subtitles: [],
  tags: {},
  ...over,
});

describe('progresso do ffmpeg', () => {
  it('lê blocos -progress mesmo quebrados no meio', () => {
    const got: ProgressUpdate[] = [];
    const p = new ProgressParser((u) => got.push(u));
    p.feed('frame=10\nout_time_us=500000\nspe');
    p.feed('ed=2.5x\nprogress=continue\nframe=20\nout_time_us=N/A\nprogress=continue\n');
    p.feed('out_time_ms=1000000\nspeed=N/A\nprogress=end\n');
    expect(got).toEqual([
      { outTimeUs: 500000, speed: 2.5, frame: 10, done: false },
      { outTimeUs: 0, speed: null, frame: 20, done: false },
      { outTimeUs: 1000000, speed: null, frame: null, done: true },
    ]);
  });

  it('estimativa de tempo só depois de dados suficientes', () => {
    expect(etaSeconds(0.01, 5000)).toBeNull();
    expect(etaSeconds(0.5, 10_000)).toBeCloseTo(10);
  });
});

describe('argumentos', () => {
  it('proxy: H.264 8-bit, CFR, GOP de ~0,5 s, sem legendas, com progresso', () => {
    const a = proxyArgs('in.mkv', 'out.mp4', probe()).join(' ');
    expect(a).toContain('-c:v libx264');
    expect(a).toContain('format=yuv420p');
    expect(a).toContain('fps=24000/1001');
    expect(a).toContain('-g 12 -keyint_min 12');
    expect(a).toContain('scale=-2:540');
    expect(a).toContain('-sn');
    expect(a).toContain('-progress pipe:1');
  });

  it('proxy não aumenta vídeo pequeno e funciona sem áudio', () => {
    const a = proxyArgs('in', 'out', probe({ audio: [], video: { ...probe().video!, height: 360 } })).join(' ');
    expect(a).toContain('scale=-2:360');
    expect(a).toContain('-an');
    expect(a).not.toContain('0:a:0');
  });

  it('fps do proxy ignora r_frame_rate absurdo', () => {
    expect(proxyFps(probe({ video: { ...probe().video!, fps: { num: 90000, den: 1 }, avgFps: { num: 25, den: 1 } } }))).toEqual({ num: 25, den: 1 });
  });

  it('proxy de áudio seleciona o índice exato da faixa do arquivo original', () => {
    const args = audioProxyArgs('episode.mkv', 'japanese.m4a', 2);
    expect(args).toContain('-map');
    expect(args).toContain('0:2');
    expect(args).toContain('-c:a');
    expect(args).toContain('aac');
  });

  it('proxy de áudio padrão usa a primeira faixa do arquivo', () => {
    expect(audioProxyArgs('episode.mkv', 'default.m4a', null).join(' ')).toContain('-map 0:a:0');
  });

  it('VFR e plano de miniaturas', () => {
    expect(detectVfr({ num: 30, den: 1 }, { num: 125, den: 7 })).toBe(true);
    expect(detectVfr({ num: 24000, den: 1001 }, { num: 24000, den: 1001 })).toBe(false);
    const plan = planThumbStrip(probe());
    expect(plan.count).toBeLessThanOrEqual(200);
    expect(plan.intervalS).toBe(8);
    expect(plan.tileWidth % 2).toBe(0);
  });

  it('caminhos no Windows e no Linux', () => {
    expect(joinPath('C:\\cache\\', 'v1_abc', 'proxy.mp4')).toBe('C:\\cache\\v1_abc\\proxy.mp4');
    expect(joinPath('/cache/', '/v1_abc/', 'proxy.mp4')).toBe('/cache/v1_abc/proxy.mp4');
  });
});

describe('waveform', () => {
  it('acumula picos com bytes quebrados entre pedaços', () => {
    const samples = new Int16Array([0, 100, -200, 300, -32768, 32767, 5]);
    const bytes = new Uint8Array(samples.buffer);
    const acc = new PeakAccumulator(3);
    acc.push(bytes.subarray(0, 3));
    acc.push(bytes.subarray(3, 9));
    acc.push(bytes.subarray(9));
    const { mins, maxs } = acc.finish();
    expect([...mins]).toEqual([-200, -32768, 5]);
    expect([...maxs]).toEqual([100, 32767, 5]);
  });

  it('níveis, codificação e escolha por zoom', () => {
    const n = 1000;
    const mins = Int16Array.from({ length: n }, (_, i) => -i);
    const maxs = Int16Array.from({ length: n }, (_, i) => i);
    const levels = buildLevels({ samplesPerBucket: 80, mins, maxs });
    expect(levels.length).toBeGreaterThan(3);
    expect(levels[1]!.maxs[0]).toBe(1);
    const w = { sampleRate: 8000, durationUs: 10_000_000, levels };
    const back = decodeWaveform(encodeWaveform(w));
    expect(back.levels.map((l) => l.mins.length)).toEqual(levels.map((l) => l.mins.length));
    expect(back.levels[2]!.maxs).toEqual(levels[2]!.maxs);
    expect(back.durationUs).toBe(10_000_000);
    expect(pickLevel(back, 100).samplesPerBucket).toBe(80);
    expect(pickLevel(back, 5).samplesPerBucket).toBe(1280);
  });
});

describe('fila de jobs', () => {
  const deferred = () => {
    let resolve!: () => void;
    const p = new Promise<void>((r) => (resolve = r));
    return { p, resolve };
  };

  it('respeita prioridade e limite de concorrência', async () => {
    const q = new JobQueue(1);
    const order: string[] = [];
    const gate = deferred();
    q.enqueue({ key: 'a', kind: 'proxy', label: 'a', run: async () => { order.push('proxy-1'); await gate.p; } });
    const b = q.enqueue({ key: 'b', kind: 'proxy', label: 'b', run: async () => { order.push('proxy-2'); } });
    const c = q.enqueue({ key: 'c', kind: 'probe', label: 'c', run: async () => { order.push('probe'); } });
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['proxy-1']);
    gate.resolve();
    await Promise.all([b.promise, c.promise]);
    expect(order).toEqual(['proxy-1', 'probe', 'proxy-2']);
  });

  it('não duplica job com a mesma chave em andamento', () => {
    const q = new JobQueue(1);
    const g = deferred();
    const a = q.enqueue({ key: 'x', kind: 'proxy', label: 'x', run: () => g.p });
    const b = q.enqueue({ key: 'x', kind: 'proxy', label: 'x', run: () => g.p });
    expect(a.id).toBe(b.id);
    g.resolve();
  });

  it('cancela job na fila e em execução; erro vira "failed" com mensagem', async () => {
    const q = new JobQueue(1);
    const running = q.enqueue({
      key: 'r', kind: 'proxy', label: 'r',
      run: ({ signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new CancelledError()))),
    });
    const queued = q.enqueue({ key: 'q', kind: 'proxy', label: 'q', run: async () => 1 });
    await new Promise((r) => setTimeout(r, 5));
    q.cancel(queued.id);
    q.cancel(running.id);
    await expect(running.promise).rejects.toBeInstanceOf(CancelledError);
    await expect(queued.promise).rejects.toBeInstanceOf(CancelledError);
    expect(q.get(running.id)!.status).toBe('cancelled');
    expect(q.get(queued.id)!.status).toBe('cancelled');

    const bad = q.enqueue({ key: 'f', kind: 'probe', label: 'f', run: async () => { throw new Error('arquivo corrompido'); } });
    await expect(bad.promise).rejects.toThrow('arquivo corrompido');
    expect(q.get(bad.id)).toMatchObject({ status: 'failed', error: 'arquivo corrompido' });
  });

  it('progresso nunca regride', async () => {
    const q = new JobQueue(1);
    const seen: (number | null)[] = [];
    q.subscribe((j) => j.status === 'running' && seen.push(j.progress));
    await q.enqueue({ key: 'p', kind: 'proxy', label: 'p', run: async ({ report }) => { report(0.5); report(0.3); report(0.8); } }).promise;
    expect(seen).toEqual([0, 0.5, 0.8]);
  });

  it('não inunda a UI com avisos de progresso minúsculos', async () => {
    const q = new JobQueue(1);
    let n = 0;
    q.subscribe((j) => j.status === 'running' && n++);
    await q.enqueue({ key: 'p', kind: 'analysis', label: 'p', run: async ({ report }) => { for (let i = 0; i <= 10_000; i++) report(i / 10_000); } }).promise;
    expect(n).toBeLessThan(220);
  });
});
