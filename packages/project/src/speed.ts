import { orderedKeyframes } from './keyframes.js';
import type { Clip, Keyframe } from './schema.js';

const SPEED_KEY = 'speed';

export interface SpeedPreset {
  id: 'constant' | 'slow-motion' | 'ramp-up' | 'ramp-down' | 'freeze-impact';
  label: string;
  points: { position: number; value: number; easing: Keyframe['easing'] }[];
}

export const SPEED_PRESETS: SpeedPreset[] = [
  { id: 'constant', label: 'Constante', points: [] },
  { id: 'slow-motion', label: 'Slow motion', points: [
    { position: 0, value: 1, easing: 'linear' },
    { position: 0.3, value: 1, easing: 'ease-in-out' },
    { position: 0.45, value: 0.25, easing: 'hold' },
    { position: 0.6, value: 0.25, easing: 'ease-in-out' },
    { position: 0.75, value: 1, easing: 'linear' },
    { position: 1, value: 1, easing: 'linear' },
  ] },
  { id: 'ramp-up', label: 'Aceleração progressiva', points: [
    { position: 0, value: 0.35, easing: 'ease-in-out' },
    { position: 1, value: 2.4, easing: 'linear' },
  ] },
  { id: 'ramp-down', label: 'Desaceleração progressiva', points: [
    { position: 0, value: 2.4, easing: 'ease-in-out' },
    { position: 1, value: 0.35, easing: 'linear' },
  ] },
  { id: 'freeze-impact', label: 'Freeze frame de impacto', points: [
    { position: 0, value: 1, easing: 'ease-in-out' },
    { position: 0.44, value: 1, easing: 'ease-out' },
    { position: 0.48, value: 0, easing: 'hold' },
    { position: 0.56, value: 0, easing: 'ease-in' },
    { position: 0.6, value: 1, easing: 'linear' },
    { position: 1, value: 1, easing: 'linear' },
  ] },
];

function primitive(t: number, easing: Keyframe['easing']): number {
  switch (easing) {
    case 'hold': return 0;
    case 'ease-in': return (t ** 3) / 3;
    case 'ease-out': return (t ** 2) - (t ** 3) / 3;
    case 'ease-in-out': return t / 2 - Math.sin(Math.PI * t) / (2 * Math.PI);
    default: return (t ** 2) / 2;
  }
}

function ease(t: number, easing: Keyframe['easing']): number {
  const x = Math.max(0, Math.min(1, t));
  switch (easing) {
    case 'hold': return 0;
    case 'ease-in': return x * x;
    case 'ease-out': return 1 - (1 - x) ** 2;
    case 'ease-in-out': return 0.5 - 0.5 * Math.cos(Math.PI * x);
    default: return x;
  }
}

function curveKeyframes(clip: Clip): Keyframe[] {
  return orderedKeyframes(clip.keyframes?.[SPEED_KEY])
    .map((frame) => ({ ...frame, atUs: Math.min(clip.durationUs, frame.atUs), value: Math.max(0, frame.value) }));
}

export function hasSpeedCurve(clip: Clip): boolean {
  return (clip.keyframes?.[SPEED_KEY]?.length ?? 0) > 0;
}

export function speedFactorAt(clip: Clip, localUs: number): number {
  const frames = curveKeyframes(clip);
  if (!frames.length) return 1;
  const t = Math.max(0, Math.min(clip.durationUs, localUs));
  if (t <= frames[0]!.atUs) return frames[0]!.value;
  for (let index = 1; index < frames.length; index++) {
    const next = frames[index]!;
    if (t <= next.atUs) {
      const previous = frames[index - 1]!;
      const duration = next.atUs - previous.atUs;
      if (duration <= 0) return next.value;
      const progress = (t - previous.atUs) / duration;
      return previous.value + (next.value - previous.value) * ease(progress, next.easing);
    }
  }
  return frames.at(-1)!.value;
}

function primitiveAt(frames: Keyframe[], localUs: number, durationUs: number): number {
  const t = Math.max(0, Math.min(durationUs, localUs));
  if (!frames.length) return t / 1e6;
  let total = 0;
  const first = frames[0]!;
  if (t <= first.atUs) return first.value * t;
  total += first.value * first.atUs;
  for (let index = 1; index < frames.length; index++) {
    const next = frames[index]!;
    const previous = frames[index - 1]!;
    const duration = next.atUs - previous.atUs;
    if (duration <= 0) continue;
    const used = Math.max(0, Math.min(duration, t - previous.atUs));
    const progress = used / duration;
    total += previous.value * used + (next.value - previous.value) * duration * primitive(progress, next.easing);
    if (used < duration) return total;
  }
  const last = frames.at(-1)!;
  if (t > last.atUs) total += last.value * (t - last.atUs);
  return total;
}

export function speedCurveIntegral(clip: Clip, localUs: number): number {
  const frames = curveKeyframes(clip);
  if (!frames.length) return Math.max(0, Math.min(clip.durationUs, localUs)) / 1e6;
  return primitiveAt(frames, localUs, clip.durationUs) / 1e6;
}

export function speedCurveTotal(clip: Clip): number {
  return speedCurveIntegral(clip, clip.durationUs);
}

export function speedProgressAt(clip: Clip, localUs: number): number {
  if (!hasSpeedCurve(clip)) return clip.durationUs > 0 ? Math.max(0, Math.min(1, localUs / clip.durationUs)) : 0;
  const total = speedCurveTotal(clip);
  return total <= 0 ? 0 : Math.max(0, Math.min(1, speedCurveIntegral(clip, localUs) / total));
}

export function timelineLocalAtProgress(clip: Clip, progress: number): number {
  const target = Math.max(0, Math.min(1, progress));
  if (!hasSpeedCurve(clip)) return Math.round(target * clip.durationUs);
  const total = speedCurveTotal(clip);
  if (total <= 0) return 0;
  const area = target * total;
  let low = 0;
  let high = clip.durationUs;
  for (let iteration = 0; iteration < 48; iteration++) {
    const mid = (low + high) / 2;
    if (speedCurveIntegral(clip, mid) < area) low = mid;
    else high = mid;
  }
  return Math.round(high);
}

export function speedAt(clip: Clip, localUs: number): number {
  if (!hasSpeedCurve(clip)) return clip.speed;
  const total = speedCurveTotal(clip);
  if (total <= 0) return 0;
  const mean = total / (clip.durationUs / 1e6);
  const mappedMean = (clip.sourceOutUs - clip.sourceInUs) / clip.durationUs;
  return mappedMean * speedFactorAt(clip, localUs) / mean;
}

/** Source time for a local timeline time; curve endpoints remain anchored to the selected source range. */
export function sourceTimeAt(clip: Clip, localUs: number): number {
  const elapsedUs = Math.max(0, Math.min(clip.durationUs, localUs));
  const sourceSpan = clip.sourceOutUs - clip.sourceInUs;
  const start = clip.reverse ? clip.sourceOutUs : clip.sourceInUs;
  const direction = clip.reverse ? -1 : 1;
  if (localUs < 0) return Math.round(start + direction * localUs * speedAt(clip, 0));
  if (localUs > clip.durationUs) {
    const end = sourceTimeAt(clip, clip.durationUs);
    return Math.round(end + direction * (localUs - clip.durationUs) * speedAt(clip, clip.durationUs));
  }
  let progress: number;
  if (hasSpeedCurve(clip)) {
    const total = speedCurveTotal(clip);
    progress = total <= 0 ? 0 : speedCurveIntegral(clip, elapsedUs) / total;
  } else {
    const sourceOffsetUs = elapsedUs * clip.speed;
    return Math.round(start + direction * sourceOffsetUs);
  }
  return Math.round(start + direction * sourceSpan * progress);
}

/** Inverts sourceTimeAt for a source timestamp; freeze plateaus resolve to their first timeline instant. */
export function timelineLocalAtSource(clip: Clip, sourceUs: number): number | null {
  const span = clip.sourceOutUs - clip.sourceInUs;
  if (span <= 0) return null;
  const progress = clip.reverse
    ? (clip.sourceOutUs - sourceUs) / span
    : (sourceUs - clip.sourceInUs) / span;
  if (progress < 0 || progress > 1) return null;
  if (!hasSpeedCurve(clip)) return clip.speed <= 0 ? null : Math.round((progress * span) / clip.speed);
  if (speedCurveTotal(clip) <= 0) {
    return Math.abs(sourceUs - sourceTimeAt(clip, 0)) <= 1 ? 0 : null;
  }
  return timelineLocalAtProgress(clip, progress);
}

export function speedKeyframesForPreset(clip: Clip, presetId: SpeedPreset['id']): Keyframe[] {
  const preset = SPEED_PRESETS.find((item) => item.id === presetId);
  if (!preset || !preset.points.length) return [];
  return preset.points.map((point) => ({
    atUs: Math.round(clip.durationUs * point.position),
    value: point.value,
    easing: point.easing,
  }));
}
