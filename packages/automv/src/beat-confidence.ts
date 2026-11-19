import type { MusicAnalysis } from '@amv/analysis';

/** Keep measured beats for editing, but don't subdivide uncertain detections for rapid cuts. */
export function reliableBeatGrid(music: MusicAnalysis): boolean {
  return Number.isFinite(music.bpmConfidence) && music.bpmConfidence >= 0.55;
}