import type { Project } from '@amv/project';

/** Insert after occupied intervals instead of silently erasing existing captions. */
export function nextTextStart(project: Project, trackId: string, requestedUs: number, durationUs: number): number {
  let startUs = Math.max(0, requestedUs);
  const clips = project.clips.filter((clip) => clip.trackId === trackId).sort((a, b) => a.timelineStartUs - b.timelineStartUs);
  for (const clip of clips) {
    if (clip.timelineStartUs >= startUs + durationUs) break;
    if (clip.timelineStartUs + clip.durationUs > startUs) startUs = clip.timelineStartUs + clip.durationUs;
  }
  return startUs;
}