export interface WordPreviewRange {
  clipId: string;
  endUs: number;
}

export function wordPreviewEnded(range: WordPreviewRange | null, clipId: string, playheadUs: number): boolean {
  return range !== null && range.clipId === clipId && playheadUs >= range.endUs;
}