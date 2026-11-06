import { formatDuration, rationalToNumber, type Asset, type Rational } from '@amv/project';

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`;
}

export function fpsLabel(fps: Rational | null | undefined): string {
  if (!fps) return '—';
  const v = rationalToNumber(fps);
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

export function duration(us: number): string {
  return formatDuration(us).replace(/\.\d{3}$/, '');
}

export function durationPrecise(us: number): string {
  return formatDuration(us).replace('.', ',');
}

const CODECS: Record<string, string> = {
  h264: 'H.264',
  hevc: 'HEVC',
  av1: 'AV1',
  vp9: 'VP9',
  prores: 'ProRes',
  mjpeg: 'JPEG',
  png: 'PNG',
  aac: 'AAC',
  mp3: 'MP3',
  flac: 'FLAC',
  opus: 'Opus',
  vorbis: 'Vorbis',
  pcm_s16le: 'PCM 16-bit',
  pcm_s24le: 'PCM 24-bit',
  pcm_f32le: 'PCM 32-bit float',
};

export function codecLabel(c: string | null | undefined): string {
  if (!c) return '—';
  return CODECS[c] ?? c.toUpperCase();
}

export function kindLabel(a: Pick<Asset, 'kind'>): string {
  return { video: 'Vídeo', audio: 'Áudio', image: 'Imagem' }[a.kind];
}

export function resolution(a: Asset): string {
  const v = a.probe?.video;
  return v ? `${v.width}×${v.height}` : '—';
}

export function mainCodec(a: Asset): string {
  if (a.kind === 'audio') return codecLabel(a.probe?.audio[0]?.codec);
  return codecLabel(a.probe?.video?.codec);
}

const LANG: Record<string, string> = { jpn: 'japonês', por: 'português', eng: 'inglês', spa: 'espanhol', und: 'indefinido' };
export function language(code: string | null): string {
  if (!code) return 'idioma não informado';
  return LANG[code] ?? code;
}

export function relativeDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0 && now.getDate() === d.getDate()) return `hoje, ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  if (days <= 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: now.getFullYear() === d.getFullYear() ? undefined : 'numeric' });
}
