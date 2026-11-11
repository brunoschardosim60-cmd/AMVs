/**
 * Mixagem de áudio em UMA passada: cada clipe das trilhas de áudio vira uma entrada
 * (só o trecho usado), com velocidade, ganho, fades e posição; tudo é somado e
 * passa por um limitador para não estourar. Saída em WAV (sem perda) para o mux final.
 */
import { automaticDuckingExpression, clipEndUs, hasSpeedCurve, orderedKeyframes, sourceTimeAt, speedFactorAt, type Clip, type Project, type Track } from '@amv/project';
import { ToolError, type ProcessRunner } from '@amv/media';
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

export interface AudioQualityMetrics {
  integratedLufs: number | null;
  truePeakDbfs: number | null;
  clippingDetected: boolean;
}

/** Measure the rendered mix using FFmpeg's EBU R128 and sample-peak analysis. */
export async function measureAudioQuality(runner: ProcessRunner, path: string): Promise<AudioQualityMetrics> {
  const result = await runner.run('ffmpeg', [
    '-hide_banner', '-nostdin', '-loglevel', 'info', '-i', path, '-vn',
    '-af', 'ebur128=peak=true,astats=metadata=1:reset=0',
    '-f', 'null', '-',
  ]);
  if (result.code !== 0) throw new ToolError('ffmpeg', result.code, result.stderr);
  const integratedText = [...result.stderr.matchAll(/\bI:\s*(-?[\d.]+|-inf)\s*LUFS/g)].at(-1)?.[1];
  const peakText = [...result.stderr.matchAll(/\bPeak:\s*(-?[\d.]+|-inf)\s*dBFS/g)].at(-1)?.[1];
  const integratedLufs = integratedText && integratedText !== '-inf' ? Number(integratedText) : null;
  const truePeakDbfs = peakText && peakText !== '-inf' ? Number(peakText) : null;
  if ((integratedLufs !== null && !Number.isFinite(integratedLufs)) || (truePeakDbfs !== null && !Number.isFinite(truePeakDbfs))) {
    throw new Error('O FFmpeg retornou medições de áudio inválidas.');
  }
  return {
    integratedLufs,
    truePeakDbfs,
    clippingDetected: truePeakDbfs !== null && truePeakDbfs >= 0,
  };
}

export function audioClips(o: AudioJobInput): AudioClipPlan[] {
  const p = o.project;
  const mixTracks = p.tracks.filter((track) => track.kind === 'audio' || (track.kind === 'video' && p.audioMix.includeVideoAudio));
  const anySolo = mixTracks.some((track) => track.solo);
  const out: AudioClipPlan[] = [];
  for (const track of mixTracks) {
    if (track.muted || (anySolo && !track.solo)) continue;
    const audioTrack: Track = track.kind === 'video' ? { ...track, kind: 'audio', role: 'voice' } : track;
    for (const c of p.clips) {
      if (c.trackId !== track.id || !c.assetId) continue;
      if (c.reverse) continue;
      const src = o.source(c.assetId);
      if (!src || src.audioStreams.length === 0) continue;
      const stream = c.audio.streamIndex !== null && src.audioStreams.includes(c.audio.streamIndex) ? c.audio.streamIndex : src.audioStreams[0]!;
      out.push({ clip: c, track: audioTrack, path: src.path, streamIndex: stream });
    }
  }
  return out;
}

function audioCurveBoundaries(clip: Clip): number[] {
  const keyframes = orderedKeyframes(clip.keyframes.speed);
  const anchors = [...new Set([0, ...keyframes.map((frame) => frame.atUs), clip.durationUs])]
    .filter((atUs) => atUs >= 0 && atUs <= clip.durationUs)
    .sort((a, b) => a - b);
  const boundaries = [anchors[0]!];
  for (let index = 0; index + 1 < anchors.length; index++) {
    const start = anchors[index]!;
    const end = anchors[index + 1]!;
    const nextFrame = keyframes.find((frame) => frame.atUs === end);
    const changing = Math.abs(speedFactorAt(clip, start) - speedFactorAt(clip, end)) > 1e-6
      && nextFrame?.easing !== 'hold';
    const steps = changing ? Math.min(64, Math.max(1, Math.ceil((end - start) / 100_000))) : 1;
    for (let step = 1; step <= steps; step++) {
      boundaries.push(Math.round(start + (end - start) * step / steps));
    }
  }
  return boundaries;
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
    const boundaries = hasSpeedCurve(c)
      ? audioCurveBoundaries(c)
      : [0, c.durationUs];
    const segmentLabels: string[] = [];
    for (let segment = 0; segment + 1 < boundaries.length; segment++) {
      const localStartUs = boundaries[segment]!;
      const localEndUs = boundaries[segment + 1]!;
      const segmentDuration = (localEndUs - localStartUs) / 1e6;
      if (segmentDuration <= 0) continue;
      const sourceStartUs = sourceTimeAt(c, localStartUs);
      const sourceEndUs = sourceTimeAt(c, localEndUs);
      const sourceSpan = Math.abs(sourceEndUs - sourceStartUs) / 1e6;
      const segmentLabel = `as${i}_${segment}`;
      const inputIndex = inputs.filter((arg) => arg === '-i').length;
      if (sourceSpan < 1 / sr) {
        inputs.push('-f', 'lavfi', '-t', n(segmentDuration), '-i', `anullsrc=r=${sr}:cl=stereo`);
        filters.push(`[${inputIndex}:a]atrim=end=${n(segmentDuration)},asetpts=PTS-STARTPTS[${segmentLabel}]`);
      } else {
        const sourceLo = Math.min(sourceStartUs, sourceEndUs) / 1e6;
        const tempo = sourceSpan / segmentDuration;
        inputs.push('-ss', n(sourceLo), '-t', n(sourceSpan + 0.1, 3), '-i', pl.path);
        const chain = [
          `[${inputIndex}:${pl.streamIndex}]aresample=${sr}`,
          'aformat=sample_fmts=fltp:channel_layouts=stereo',
          `atrim=duration=${n(sourceSpan)}`,
          'asetpts=PTS-STARTPTS',
          ...(tempo < 1e-6 ? [] : c.audio.pitchMode === 'follow'
            ? [`asetrate=${Math.round(sr * tempo)}`, `aresample=${sr}`]
            : atempoChain(tempo)),
          ...(hasSpeedCurve(c) ? ['afade=t=in:st=0:d=0.003', `afade=t=out:st=${n(Math.max(0, segmentDuration - 0.003))}:d=0.003`] : []),
          `apad=pad_dur=${n(segmentDuration)}`,
          `atrim=end=${n(segmentDuration)}`,
          `asetpts=PTS-STARTPTS[${segmentLabel}]`,
        ];
        filters.push(chain.join(','));
      }
      segmentLabels.push(`[${segmentLabel}]`);
    }
    let clipLabel: string;
    if (segmentLabels.length === 1) {
      clipLabel = segmentLabels[0]!.slice(1, -1);
    } else {
      clipLabel = `aClip${i}`;
      filters.push(`${segmentLabels.join('')}concat=n=${segmentLabels.length}:v=0:a=1[${clipLabel}]`);
    }
    const gain = c.audio.gainDb + pl.track.gainDb;
    const chain = [`[${clipLabel}]`];
    if (gain !== 0) chain.push(`volume=${n(gain, 3)}dB`);
    if (c.audio.fadeInUs > 0) chain.push(`afade=t=in:st=0:d=${n(c.audio.fadeInUs / 1e6)}`);
    if (c.audio.fadeOutUs > 0) chain.push(`afade=t=out:st=${n(Math.max(0, dur - c.audio.fadeOutUs / 1e6))}:d=${n(c.audio.fadeOutUs / 1e6)}`);
    // volume ao longo do tempo (ducking): keyframes de "audio.gainDb"
    const kf = c.keyframes['audio.gainDb'];
    if (kf && kf.length) chain.push(`volume='${gainCurve(kf)}':eval=frame`);
    const ducking = automaticDuckingExpression(o.project, pl.track.id, c.timelineStartUs, c);
    if (ducking) chain.push(`volume='${ducking}':eval=frame`);
    const ms = Math.round(c.timelineStartUs / 1000);
    chain.push(`adelay=${ms}|${ms}`);
    filters.push(`${chain[0]}${chain.slice(1).join(',')}[a${i}]`);
    labels.push(`[a${i}]`);
  });
  if (!labels.length) {
    return ['-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', `anullsrc=r=${sr}:cl=stereo`, '-t', n(D, 3), '-c:a', 'pcm_s16le', '-loglevel', 'error', o.output];
  }
  const master = ['apad'];
  if (o.project.audioMix.normalization === 'ebu-r128') {
    master.push(`loudnorm=I=${n(o.project.audioMix.targetLufs, 2)}:TP=${n(Math.max(-9, o.project.audioMix.limiterCeilingDb), 2)}:LRA=11:linear=false:print_format=summary`);
  }
  if (o.project.audioMix.limiterEnabled) {
    const limit = Math.pow(10, o.project.audioMix.limiterCeilingDb / 20);
    master.push(`alimiter=limit=${n(limit, 6)}:attack=5:release=50:level=false`);
  }
  master.push(`atrim=end=${n(D)}`);
  filters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,${master.join(',')}[aout]`);
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
