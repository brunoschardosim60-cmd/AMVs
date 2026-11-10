import type { Keyframe } from './schema.js';

function ease(value: number, easing: Keyframe['easing']): number {
  const t = Math.max(0, Math.min(1, value));
  switch (easing) {
    case 'hold':
      return 0;
    case 'ease-in':
      return t * t;
    case 'ease-out':
      return 1 - (1 - t) * (1 - t);
    case 'ease-in-out':
      return 0.5 - 0.5 * Math.cos(Math.PI * t);
    default:
      return t;
  }
}

export function orderedKeyframes(keyframes: Keyframe[] | undefined): Keyframe[] {
  const sorted = [...(keyframes ?? [])].sort((a, b) => a.atUs - b.atUs);
  const unique: Keyframe[] = [];
  for (const frame of sorted) {
    if (unique.at(-1)?.atUs === frame.atUs) unique[unique.length - 1] = frame;
    else unique.push(frame);
  }
  return unique;
}

export function evaluateKeyframes(keyframes: Keyframe[] | undefined, atUs: number, fallback: number): number {
  const sorted = orderedKeyframes(keyframes);
  if (!sorted.length) return fallback;
  if (atUs <= sorted[0]!.atUs) return sorted[0]!.value;
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]!;
    if (atUs <= next.atUs) {
      const previous = sorted[i - 1]!;
      const t = (atUs - previous.atUs) / (next.atUs - previous.atUs);
      return previous.value + (next.value - previous.value) * ease(t, next.easing);
    }
  }
  return sorted.at(-1)!.value;
}

export function upsertKeyframe(keyframes: Keyframe[] | undefined, atUs: number, value: number): Keyframe[] {
  const easing = keyframes?.find((frame) => frame.atUs === atUs)?.easing ?? 'linear';
  const next = (keyframes ?? []).filter((frame) => frame.atUs !== atUs);
  next.push({ atUs, value, easing });
  return next.sort((a, b) => a.atUs - b.atUs);
}

export function removeKeyframeAt(keyframes: Keyframe[] | undefined, atUs: number): Keyframe[] {
  return (keyframes ?? []).filter((frame) => frame.atUs !== atUs);
}
