/**
 * Mixagem de áudio em UMA passada: cada clipe das trilhas de áudio vira uma entrada
 * (só o trecho usado), com velocidade, ganho, fades e posição; tudo é somado e
 * passa por um limitador para não estourar. Saída em WAV (sem perda) para o mux final.
 */
import { clipEndUs, type Clip, type Project, type Track } from '@amv/project';
import type { AssetSource } from './video.js';

const n = (v: number, d = 6) => Number(v.toFixed(d)).toString();

/** atempo aceita 0,5–100 por filtro; abaixo de 0,5 encadeia. */
export function atempoChain(speed: number): string[] {
  const out: string[] = [];
  let s = speed;
  while (s < 0.5) {
    out.push('atempo=0.5');
    s /= 0.5;
  }
  if (Math.abs(s - 1) > 1e-6) out.push(`atempo=${n(s)}`);
  return out;
}

export interface AudioJobInput {
  project: Project;
  durationUs: number;
  sampleRate: number;
  output: string;
  source(assetId: string): (AssetSource & { audioStreams: number[] }) | null;
}

export interface AudioClipPlan {
  clip: Clip;
  track: Track;
  path: string;
  streamIndex: number;
}

export function audioClips(o: AudioJobInput): AudioClipPlan[] {
  const p = o.project;
  const anySolo = p.tracks.some((t) => t.kind === 'audio' && t.solo);
  const out: AudioClipPlan[] = [];
  for (const track of p.tracks) {
    if (track.kind !== 'audio' || track.muted || (anySolo && !track.solo)) continue;
    for (const c of p.clips) {
      if (c.trackId !== track.id || !c.assetId) continue;
      const src = o.source(c.assetId);
      if (!src || src.audioStreams.length === 0) continue;
      const stream = c.audio.streamIndex !== null && src.audioStreams.includes(c.audio.streamIndex) ? c.audio.streamIndex : src.audioStreams[0]!;
      out.push({ clip: c, track, path: src.path, streamIndex: stream });
    }
  }
  return out;
}

export function audioArgs(o: AudioJobInput): string[] {
  const D = o.durationUs / 1e6;
  const sr = o.sampleRate;
  const plans = audioClips(o);
  const inputs: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];
  plans.forEach((pl, i) => {
    const c = pl.clip;
    const dur = c.durationUs / 1e6;
    const srcStart = c.sourceInUs / 1e6;
    inputs.push('-ss', n(srcStart), '-t', n(dur * c.speed + 0.2, 3), '-i', pl.path);
    const gain = c.audio.gainDb + pl.track.gainDb;
    const chain = [`[${i}:${pl.streamIndex}]aresample=${sr}`, 'aformat=sample_fmts=fltp:channel_layouts=stereo', 'asetpts=PTS-STARTPTS', ...atempoChain(c.speed), `atrim=end=${n(dur)}`];
    if (gain !== 0) chain.push(`volume=${n(gain, 3)}dB`);
    if (c.audio.fadeInUs > 0) chain.push(`afade=t=in:st=0:d=${n(c.audio.fadeInUs / 1e6)}`);
    if (c.audio.fadeOutUs > 0) chain.push(`afade=t=out:st=${n(Math.max(0, dur - c.audio.fadeOutUs / 1e6))}:d=${n(c.audio.fadeOutUs / 1e6)}`);
    // volume ao longo do tempo (ducking): keyframes de "audio.gainDb"
    const kf = c.keyframes['audio.gainDb'];
    if (kf && kf.length) chain.push(`volume='${gainCurve(kf)}':eval=frame`);
    const ms = Math.round(c.timelineStartUs / 1000);
    chain.push(`adelay=${ms}|${ms}`);
    filters.push(`${chain.join(',')}[a${i}]`);
    labels.push(`[a${i}]`);
  });
  if (!labels.length) {
    return ['-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', `anullsrc=r=${sr}:cl=stereo`, '-t', n(D, 3), '-c:a', 'pcm_s16le', '-loglevel', 'error', o.output];
  }
  filters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,alimiter=limit=0.97:level=false,apad,atrim=end=${n(D)}[aout]`);
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    ...inputs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[aout]',
    '-c:a',
    'pcm_s16le',
    '-ar',
    String(sr),
    '-progress',
    'pipe:1',
    '-nostats',
    '-loglevel',
    'error',
    o.output,
  ];
}

/**
 * Curva de ganho (dB) por keyframes → expressão de volume linear em função de t
 * (tempo do trecho, que começa em 0 no início do clipe — o adelay vem depois).
 */
export function gainCurve(kf: { atUs: number; value: number }[]): string {
  const pts = [...kf].sort((a, b) => a.atUs - b.atUs);
  const lin = (db: number) => n(Math.pow(10, db / 20), 6);
  let expr = lin(pts.at(-1)!.value);
  for (let i = pts.length - 2; i >= 0; i--) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const ta = n(a.atUs / 1e6);
    const tb = n(b.atUs / 1e6);
    const seg = `${lin(a.value)}+(${lin(b.value)}-${lin(a.value)})*(t-${ta})/(${tb}-${ta})`;
    expr = `if(lt(t,${tb}),${seg},${expr})`;
  }
  return `if(lt(t,${n(pts[0]!.atUs / 1e6)}),${lin(pts[0]!.value)},${expr})`;
}

export function audioDurationUs(project: Project): number {
  let end = 0;
  for (const c of project.clips) {
    const t = project.tracks.find((x) => x.id === c.trackId);
    if (t?.kind === 'audio') end = Math.max(end, clipEndUs(c));
  }
  return end;
}
