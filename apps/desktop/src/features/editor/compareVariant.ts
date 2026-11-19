import { sourceTimeAt, type Clip } from '@amv/project';

export type ComparePreset = 'current' | 'clean' | 'vibrant' | 'impact';

export function comparisonEndUs(a: Pick<Clip, 'durationUs'>, b: Pick<Clip, 'durationUs'>): number {
  return Math.max(1, a.durationUs, b.durationUs) - 1;
}

export function compareVariant(clip: Clip, preset: ComparePreset, trimStartUs: number, trimEndUs: number): Clip {
  const canTrim = !clip.reverse && Object.values(clip.keyframes).every((frames) => !frames.length) && !clip.text;
  const start = canTrim ? Math.max(0, Math.min(clip.durationUs - 1, Math.round(trimStartUs))) : 0;
  const end = canTrim ? Math.max(start + 1, Math.min(clip.durationUs, Math.round(trimEndUs))) : clip.durationUs;
  const effects = preset === 'current' ? clip.effects : preset === 'clean' ? [] : [
    { id: 'compare-color', effect: 'color', enabled: true, params: { contrast: 1.1, saturation: 1.12 } },
    ...(preset === 'impact' ? [{ id: 'compare-shake', effect: 'shake', enabled: true, params: { intensity: 8, duration: Math.min(0.2, (end - start) / 2_000_000), frequency: 12 } }] : []),
  ];
  return { ...clip, sourceInUs: canTrim ? sourceTimeAt(clip, start) : clip.sourceInUs, sourceOutUs: canTrim ? sourceTimeAt(clip, end) : clip.sourceOutUs, durationUs: end - start, timelineStartUs: clip.timelineStartUs + start, effects };
}