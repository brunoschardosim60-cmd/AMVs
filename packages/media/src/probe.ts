import { parseRational, secondsToUs, type AssetKind, type ProbeInfo, type Rational } from '@amv/project';
import { ToolError, type ProcessRunner } from './runner.js';

export function probeArgs(path: string): string[] {
  return ['-v', 'error', '-hide_banner', '-print_format', 'json', '-show_format', '-show_streams', path];
}

interface RawStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  bits_per_raw_sample?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  nb_frames?: string;
  duration?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  disposition?: Record<string, number>;
  tags?: Record<string, string>;
}

interface RawProbe {
  streams?: RawStream[];
  format?: {
    format_name?: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
  };
}

const IMAGE_FORMATS = new Set(['png_pipe', 'jpeg_pipe', 'image2', 'webp_pipe', 'bmp_pipe', 'gif', 'tiff_pipe']);

function int(v: string | number | undefined): number | null {
  if (v === undefined || v === 'N/A') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function bitDepth(stream: RawStream): number | null {
  const raw = int(stream.bits_per_raw_sample);
  if (raw) return raw;
  const m = stream.pix_fmt?.match(/p(\d{2})(le|be)$/);
  if (m) return Number(m[1]);
  return stream.pix_fmt ? 8 : null;
}

function rel(a: Rational, b: Rational): number {
  const x = a.num / a.den;
  const y = b.num / b.den;
  return Math.abs(x - y) / Math.max(x, y);
}

/**
 * VFR: ffprobe não diz diretamente. Heurística: taxa declarada (r_frame_rate) e taxa
 * média (avg_frame_rate) diferem mais de 1%. MKV costuma não ter nb_frames; nesse caso
 * só a comparação de taxas é usada. Resultado é aviso, não verdade absoluta.
 */
export function detectVfr(fps: Rational | null, avgFps: Rational | null): boolean {
  if (!fps || !avgFps) return false;
  return rel(fps, avgFps) > 0.01;
}

export interface ProbeResult {
  kind: AssetKind;
  probe: ProbeInfo;
}

export function parseProbe(json: string): ProbeResult {
  const raw = JSON.parse(json) as RawProbe;
  const streams = raw.streams ?? [];
  const format = raw.format ?? {};
  const container = format.format_name ?? 'desconhecido';

  // stream de vídeo "de verdade": ignora capa de álbum (attached_pic) em MP3/FLAC/M4A
  const videoStream = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audioStreams = streams.filter((s) => s.codec_type === 'audio');
  const subtitleStreams = streams.filter((s) => s.codec_type === 'subtitle');

  let kind: AssetKind;
  if (videoStream && IMAGE_FORMATS.has(container)) kind = 'image';
  else if (videoStream) kind = 'video';
  else if (audioStreams.length) kind = 'audio';
  else throw new Error('o arquivo não tem vídeo nem áudio reconhecível');

  let durationS = Number(format.duration);
  if (!Number.isFinite(durationS)) {
    durationS = Math.max(0, ...streams.map((s) => Number(s.duration)).filter(Number.isFinite));
  }

  const fps = videoStream ? parseRational(videoStream.r_frame_rate) : null;
  const avgFps = videoStream ? parseRational(videoStream.avg_frame_rate) : null;

  const probe: ProbeInfo = {
    container,
    durationUs: kind === 'image' ? 0 : secondsToUs(durationS || 0),
    sizeBytes: int(format.size) ?? 0,
    bitRate: int(format.bit_rate),
    video: videoStream
      ? {
          codec: videoStream.codec_name ?? 'desconhecido',
          profile: videoStream.profile ?? null,
          width: videoStream.width ?? 0,
          height: videoStream.height ?? 0,
          pixFmt: videoStream.pix_fmt ?? null,
          bitDepth: bitDepth(videoStream),
          fps: kind === 'image' ? null : fps,
          avgFps: kind === 'image' ? null : avgFps,
          vfr: kind === 'video' && detectVfr(fps, avgFps),
          frameCount: int(videoStream.nb_frames),
        }
      : null,
    audio: audioStreams.map((s) => ({
      index: s.index,
      codec: s.codec_name ?? 'desconhecido',
      sampleRate: int(s.sample_rate),
      channels: s.channels ?? null,
      channelLayout: s.channel_layout ?? null,
      language: s.tags?.language ?? null,
      title: s.tags?.title ?? null,
    })),
    subtitles: subtitleStreams.map((s) => ({
      index: s.index,
      codec: s.codec_name ?? 'desconhecido',
      language: s.tags?.language ?? null,
      title: s.tags?.title ?? null,
    })),
    tags: Object.fromEntries(
      Object.entries(format.tags ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
    ),
  };
  return { kind, probe };
}

export async function probeFile(runner: ProcessRunner, path: string, signal?: AbortSignal): Promise<ProbeResult> {
  const r = await runner.run('ffprobe', probeArgs(path), { signal });
  if (r.code !== 0) {
    throw new ToolError('ffprobe', r.code, r.stderr, `não foi possível ler o arquivo: ${r.stderr.trim() || `código ${r.code}`}`);
  }
  return parseProbe(r.stdout);
}

/** Avisos legíveis sobre o arquivo (mostrados na importação). */
export function probeWarnings(result: ProbeResult): string[] {
  const w: string[] = [];
  const v = result.probe.video;
  if (v?.vfr) w.push('Taxa de quadros variável (VFR): o proxy e a exportação vão normalizar para taxa constante.');
  if (v && v.bitDepth && v.bitDepth > 8) w.push(`Vídeo ${v.bitDepth}-bit: o preview usa proxy 8-bit; a exportação usa o original.`);
  if (v && ['hevc', 'av1', 'vp9'].includes(v.codec)) w.push(`Codec ${v.codec.toUpperCase()}: o preview usa proxy H.264.`);
  if (result.kind === 'video' && result.probe.audio.length === 0) w.push('Este vídeo não tem áudio.');
  if (result.probe.audio.length > 1) w.push(`${result.probe.audio.length} faixas de áudio: escolha qual usar em cada clipe.`);
  return w;
}
