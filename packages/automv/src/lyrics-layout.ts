import type { Cue } from '@amv/analysis';

/** Keep sung timestamps exact; only dialogue, never a visual impact, reserves text space. */
export function layoutLyrics(cues: Cue[], range: [number, number], speech: { atS: number; len: number }[]): Cue[] {
  const [from, to] = range;
  return cues.flatMap((cue) => {
    if (!Number.isFinite(cue.startS) || !Number.isFinite(cue.endS) || !cue.text.trim()) return [];
    const start = Math.max(0, cue.startS - from);
    const end = Math.min(to - from, cue.endS - from);
    let windows: [number, number][] = end > start ? [[start, end]] : [];
    for (const block of speech) {
      windows = windows.flatMap(([a, b]) => {
        if (block.atS >= b || block.atS + block.len <= a) return [[a, b]];
        const remaining: [number, number][] = [];
        if (block.atS > a) remaining.push([a, block.atS]);
        if (block.atS + block.len < b) remaining.push([block.atS + block.len, b]);
        return remaining;
      });
    }
    return windows.filter(([a, b]) => b - a >= 0.04).map(([a, b]) => ({
      ...cue,
      startS: a,
      endS: b,
      words: (cue.words ?? []).flatMap((word) => {
        const startS = Math.max(a, word.startS - from);
        const endS = Math.min(b, word.endS - from);
        return endS > startS ? [{ ...word, startS, endS }] : [];
      }),
    }));
  });
}