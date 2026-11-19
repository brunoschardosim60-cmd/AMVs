import { projectDurationUs, type Clip, type Project } from '@amv/project';

/** Rebuild only when the immutable project changes, never for each preview frame. */
export function playbackIndex(project: Project) {
  const tracks = new Map<string, Clip[]>();
  for (const clip of project.clips) {
    const clips = tracks.get(clip.trackId) ?? [];
    clips.push(clip);
    tracks.set(clip.trackId, clips);
  }
  for (const clips of tracks.values()) clips.sort((a, b) => a.timelineStartUs - b.timelineStartUs);
  return { tracks, assets: new Map(project.assets.map((asset) => [asset.id, asset])), durationUs: projectDurationUs(project) };
}