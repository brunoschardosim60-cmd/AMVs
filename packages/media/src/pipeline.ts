import type { ProbeInfo } from '@amv/project';
import {
  audioProxyArgs,
  DEFAULT_PROXY,
  needsAudioProxy,
  planThumbStrip,
  posterArgs,
  proxyArgs,
  thumbStripArgs,
  waveformPcmArgs,
  WAVEFORM_RATE,
  type ProxyOptions,
  type ThumbStripPlan,
} from './args.js';
import { ProgressParser, progressFraction } from './progress.js';
import { CancelledError, ToolError, type FileSystem, type ProcessRunner } from './runner.js';
import { buildLevels, encodeWaveform, PeakAccumulator, type Waveform } from './waveform.js';

export interface Reporter {
  (fraction: number | null, detail?: string): void;
}

/** Versões dos artefatos de cache: mudar a receita = mudar a versão = regenerar. */
export const CACHE_VERSIONS = { proxy: 'p1', poster: 't1', strip: 's1', waveform: 'w1' } as const;

async function runFfmpegWithProgress(
  runner: ProcessRunner,
  args: string[],
  totalUs: number,
  report: Reporter,
  signal: AbortSignal | undefined,
): Promise<void> {
  const parser = new ProgressParser((u) => {
    const speed = u.speed ? ` · ${u.speed.toFixed(1)}x` : '';
    report(u.done ? 1 : progressFraction(u.outTimeUs, totalUs), speed ? `processando${speed}` : undefined);
  });
  const r = await runner.run('ffmpeg', args, { onStdout: (c) => parser.feed(c), signal });
  if (signal?.aborted) throw new CancelledError();
  if (r.code !== 0) throw new ToolError('ffmpeg', r.code, r.stderr);
}

/** Escreve em `<destino>.part` e só renomeia no fim: cancelamento nunca deixa arquivo pela metade. */
async function atomicOutput<T>(fs: FileSystem, finalPath: string, work: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = `${finalPath}.part`;
  try {
    const result = await work(tmp);
    // ffmpeg pode sair com código 0 sem gerar nada; isso é erro, não sucesso
    if (!(await fs.exists(tmp))) throw new Error('o FFmpeg terminou sem gerar o arquivo de saída');
    await fs.rename(tmp, finalPath);
    return result;
  } catch (e) {
    if (await fs.exists(tmp)) await fs.remove(tmp).catch(() => undefined);
    throw e;
  }
}

export async function makeProxy(
  runner: ProcessRunner,
  fs: FileSystem,
  input: string,
  output: string,
  probe: ProbeInfo,
  report: Reporter,
  signal?: AbortSignal,
  options: ProxyOptions = DEFAULT_PROXY,
): Promise<string> {
  return atomicOutput(fs, output, async (tmp) => {
    await runFfmpegWithProgress(runner, proxyArgs(input, tmp, probe, options), probe.durationUs, report, signal);
    return output;
  });
}

export async function makeAudioProxy(
  runner: ProcessRunner,
  fs: FileSystem,
  input: string,
  output: string,
  probe: ProbeInfo,
  report: Reporter,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!needsAudioProxy(probe)) return null;
  return atomicOutput(fs, output, async (tmp) => {
    await runFfmpegWithProgress(runner, audioProxyArgs(input, tmp), probe.durationUs, report, signal);
    return output;
  });
}

export async function makePoster(
  runner: ProcessRunner,
  fs: FileSystem,
  input: string,
  output: string,
  probe: ProbeInfo,
  signal?: AbortSignal,
): Promise<string> {
  // 10% da duração (evita tela preta de abertura), no máximo 30 s
  const at = Math.min(30, (probe.durationUs / 1e6) * 0.1);
  return atomicOutput(fs, output, async (tmp) => {
    // -f image2 porque o .part esconde a extensão
    const args = posterArgs(input, tmp, at);
    args.splice(args.length - 1, 0, '-f', 'image2', '-c:v', 'mjpeg');
    let r = await runner.run('ffmpeg', args, { signal });
    if (signal?.aborted) throw new CancelledError();
    if (r.code !== 0 || !(await fs.exists(tmp))) {
      // vídeos muito curtos: tenta o primeiro quadro
      const first = posterArgs(input, tmp, 0);
      first.splice(first.length - 1, 0, '-f', 'image2', '-c:v', 'mjpeg');
      r = await runner.run('ffmpeg', first, { signal });
      if (r.code !== 0) throw new ToolError('ffmpeg', r.code, r.stderr);
    }
    return output;
  });
}

export async function makeThumbStrip(
  runner: ProcessRunner,
  fs: FileSystem,
  input: string,
  output: string,
  probe: ProbeInfo,
  report: Reporter,
  signal?: AbortSignal,
): Promise<ThumbStripPlan> {
  const plan = planThumbStrip(probe);
  return atomicOutput(fs, output, async (tmp) => {
    const build = (keyframesOnly: boolean) => {
      const args = thumbStripArgs(input, tmp, plan, keyframesOnly);
      args.splice(args.length - 1, 0, '-f', 'image2', '-c:v', 'mjpeg');
      return args;
    };
    // Atalho rápido: só keyframes. Com poucos keyframes (comum em HEVC) não sai nada:
    // o FFmpeg 6 termina com sucesso sem arquivo; o 7+ falha com "Could not open
    // encoder before EOF". Nos dois casos, refaz decodificando todos os quadros.
    let fastOk = true;
    try {
      await runFfmpegWithProgress(runner, build(true), probe.durationUs, report, signal);
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
      fastOk = false;
    }
    if (!fastOk || !(await fs.exists(tmp))) {
      if (await fs.exists(tmp)) await fs.remove(tmp);
      report(0, 'refazendo miniaturas sem atalho');
      await runFfmpegWithProgress(runner, build(false), probe.durationUs, report, signal);
    }
    return plan;
  });
}

/** 10 ms por bucket no nível mais detalhado. */
export const WAVEFORM_BASE_BUCKET = WAVEFORM_RATE / 100;

export async function computeWaveform(
  runner: ProcessRunner,
  input: string,
  probe: ProbeInfo,
  report: Reporter,
  signal?: AbortSignal,
  streamIndex: number | null = null,
): Promise<Waveform> {
  const acc = new PeakAccumulator(WAVEFORM_BASE_BUCKET);
  const totalSamples = Math.max(1, (probe.durationUs / 1e6) * WAVEFORM_RATE);
  let lastReport = 0;
  const r = await runner.run('ffmpeg', waveformPcmArgs(input, streamIndex), {
    signal,
    onStdoutBytes: (chunk) => {
      acc.push(chunk);
      if (acc.totalSamples - lastReport > WAVEFORM_RATE * 5) {
        lastReport = acc.totalSamples;
        report(Math.min(0.99, acc.totalSamples / totalSamples));
      }
    },
  });
  if (signal?.aborted) throw new CancelledError();
  if (r.code !== 0) throw new ToolError('ffmpeg', r.code, r.stderr);
  const { mins, maxs } = acc.finish();
  report(1);
  return {
    sampleRate: WAVEFORM_RATE,
    durationUs: Math.round((acc.totalSamples * 1e6) / WAVEFORM_RATE),
    levels: buildLevels({ samplesPerBucket: WAVEFORM_BASE_BUCKET, mins, maxs }),
  };
}

export async function makeWaveformFile(
  runner: ProcessRunner,
  fs: FileSystem,
  input: string,
  output: string,
  probe: ProbeInfo,
  report: Reporter,
  signal?: AbortSignal,
): Promise<Waveform> {
  const w = await computeWaveform(runner, input, probe, report, signal);
  await atomicOutput(fs, output, async (tmp) => fs.writeFile(tmp, encodeWaveform(w)));
  return w;
}

/** Caminhos de cache de um asset: <cache>/<hash>/<artefato>-<versão>.<ext> */
export function cachePaths(cacheRoot: string, hash: string, join: (...p: string[]) => string) {
  const dir = join(cacheRoot, hash.replace(/[^a-z0-9]/gi, '_'));
  return {
    dir,
    proxy: join(dir, `proxy-${CACHE_VERSIONS.proxy}.mp4`),
    audioProxy: join(dir, `audio-${CACHE_VERSIONS.proxy}.m4a`),
    poster: join(dir, `poster-${CACHE_VERSIONS.poster}.jpg`),
    strip: join(dir, `strip-${CACHE_VERSIONS.strip}.jpg`),
    stripPlan: join(dir, `strip-${CACHE_VERSIONS.strip}.json`),
    waveform: join(dir, `waveform-${CACHE_VERSIONS.waveform}.bin`),
  };
}
