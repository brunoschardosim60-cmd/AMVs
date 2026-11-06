import type { ProbeInfo, Rational } from '@amv/project';

/**
 * Construtores de argumentos do FFmpeg. Funções puras, testadas e reaproveitadas
 * pelo pipeline. Toda saída de vídeo usa `-progress pipe:1` para progresso real.
 */

const COMMON = ['-hide_banner', '-nostdin', '-y'];
const PROGRESS = ['-progress', 'pipe:1', '-nostats', '-loglevel', 'error'];

export interface ProxyOptions {
  /** Altura do proxy (largura proporcional, par). */
  height: number;
  /** CRF do x264 (maior = menor e pior). */
  crf: number;
  /** Intervalo entre keyframes em segundos (curto = seek rápido no preview). */
  keyframeIntervalS: number;
}

export const DEFAULT_PROXY: ProxyOptions = { height: 540, crf: 26, keyframeIntervalS: 0.5 };

/**
 * FPS constante do proxy: a taxa declarada quando é CFR; para VFR, a taxa declarada
 * também (r_frame_rate é o "teto" do conteúdo), o que preserva todos os quadros reais
 * duplicando onde há buracos. Se não houver taxa, 30.
 */
export function proxyFps(probe: ProbeInfo): Rational {
  const v = probe.video;
  const fps = v?.fps ?? v?.avgFps;
  if (!fps) return { num: 30, den: 1 };
  // proteção contra r_frame_rate absurdo (ex.: 90000/1 em alguns MKV)
  if (fps.num / fps.den > 120) return v?.avgFps && v.avgFps.num / v.avgFps.den <= 120 ? v.avgFps : { num: 30, den: 1 };
  return fps;
}

export function proxyArgs(input: string, output: string, probe: ProbeInfo, opts: ProxyOptions = DEFAULT_PROXY): string[] {
  const fps = proxyFps(probe);
  const gop = Math.max(1, Math.round((opts.keyframeIntervalS * fps.num) / fps.den));
  const srcH = probe.video?.height ?? opts.height;
  const height = Math.min(opts.height, srcH - (srcH % 2));
  const hasAudio = probe.audio.length > 0;
  return [
    ...COMMON,
    '-i', input,
    '-map', '0:v:0',
    ...(hasAudio ? ['-map', '0:a:0'] : []),
    '-sn', '-dn',
    '-vf', `scale=-2:${height}:flags=bicubic,format=yuv420p,fps=${fps.num}/${fps.den}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(opts.crf),
    '-profile:v', 'high', '-tune', 'fastdecode',
    '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0', '-bf', '0',
    ...(hasAudio ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000'] : ['-an']),
    '-movflags', '+faststart',
    ...PROGRESS,
    '-f', 'mp4',
    output,
  ];
}

/** Codecs de áudio que o WebView2/Chromium toca direto. */
const WEB_AUDIO = new Set(['mp3', 'aac', 'flac', 'opus', 'vorbis', 'pcm_s16le', 'pcm_s24le', 'pcm_f32le', 'pcm_u8']);

export function needsAudioProxy(probe: ProbeInfo): boolean {
  const codec = probe.audio[0]?.codec;
  return !codec || !WEB_AUDIO.has(codec);
}

export function audioProxyArgs(input: string, output: string): string[] {
  return [...COMMON, '-i', input, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', ...PROGRESS, '-f', 'mp4', output];
}

/** Uma miniatura (pôster) no instante `atS`. Seek antes do -i = rápido. */
export function posterArgs(input: string, output: string, atS: number, height = 180): string[] {
  return [
    ...COMMON, '-loglevel', 'error',
    '-ss', atS.toFixed(3), '-i', input,
    '-frames:v', '1', '-vf', `scale=-2:${height}`, '-q:v', '4',
    output,
  ];
}

export interface ThumbStripPlan {
  intervalS: number;
  count: number;
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

/** Planeja a folha de miniaturas: até `maxThumbs` imagens espaçadas pela duração. */
export function planThumbStrip(probe: ProbeInfo, maxThumbs = 200, tileHeight = 90): ThumbStripPlan {
  const durationS = Math.max(0.001, probe.durationUs / 1e6);
  const intervalS = Math.max(1, Math.ceil(durationS / maxThumbs));
  const count = Math.max(1, Math.ceil(durationS / intervalS));
  const cols = 10;
  const rows = Math.ceil(count / cols);
  const w = probe.video?.width || 16;
  const h = probe.video?.height || 9;
  let tileWidth = Math.round((tileHeight * w) / h);
  tileWidth += tileWidth % 2;
  return { intervalS, count, cols, rows, tileWidth, tileHeight };
}

/**
 * Folha de miniaturas (sprite) em UMA passada. Por padrão decodifica só keyframes
 * (`-skip_frame nokey`), o que deixa episódios inteiros rápidos. Arquivos com
 * pouquíssimos keyframes podem não gerar nada assim — o pipeline refaz sem o atalho.
 */
export function thumbStripArgs(input: string, output: string, plan: ThumbStripPlan, keyframesOnly = true): string[] {
  return [
    ...COMMON,
    ...(keyframesOnly ? ['-skip_frame', 'nokey'] : []),
    '-i', input,
    '-an', '-sn',
    '-vf',
    `fps=1/${plan.intervalS}:round=down,scale=${plan.tileWidth}:${plan.tileHeight}:force_original_aspect_ratio=decrease,pad=${plan.tileWidth}:${plan.tileHeight}:-1:-1,tile=${plan.cols}x${plan.rows}`,
    '-frames:v', '1', '-q:v', '5',
    ...PROGRESS,
    output,
  ];
}

export const WAVEFORM_RATE = 8000;

/** Decodifica o áudio para PCM mono 16-bit no stdout, para calcular picos sem arquivo temporário. */
export function waveformPcmArgs(input: string, streamIndex: number | null = null): string[] {
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'error',
    '-i', input,
    '-map', streamIndex === null ? '0:a:0' : `0:${streamIndex}`,
    '-vn', '-ac', '1', '-ar', String(WAVEFORM_RATE),
    '-f', 's16le', '-acodec', 'pcm_s16le',
    'pipe:1',
  ];
}
