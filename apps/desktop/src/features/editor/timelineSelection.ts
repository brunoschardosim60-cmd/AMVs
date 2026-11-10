import { clipEndUs, type Project } from '@amv/project';

export function selectClipsInMarquee(
  project: Pick<Project, 'clips' | 'tracks'>,
  startUs: number,
  endUs: number,
  firstTrackIndex: number,
  lastTrackIndex: number,
  initialSelection: string[] = [],
): string[] {
  const leftUs = Math.min(startUs, endUs);
  const rightUs = Math.max(startUs, endUs);
  const topTrack = Math.min(firstTrackIndex, lastTrackIndex);
  const bottomTrack = Math.max(firstTrackIndex, lastTrackIndex);
  const selected = new Set(initialSelection);

  for (const clip of project.clips) {
    const trackIndex = project.tracks.findIndex((track) => track.id === clip.trackId);
    if (trackIndex < topTrack || trackIndex > bottomTrack) continue;
    if (clip.timelineStartUs < rightUs && clipEndUs(clip) > leftUs) selected.add(clip.id);
  }

  return [...selected];
}
