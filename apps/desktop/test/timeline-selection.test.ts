import { ClipSchema, createProject, type Project } from '@amv/project';
import { describe, expect, it } from 'vitest';
import { selectClipsInMarquee } from '../src/features/editor/timelineSelection';

function projectWithClips(): Project {
  const project = createProject({ name: 'Seleção de timeline' });
  const videoTracks = project.tracks.filter((track) => track.kind === 'video');
  const audioTrack = project.tracks.find((track) => track.kind === 'audio')!;
  project.clips = [
    ClipSchema.parse({ id: 'video-a', trackId: videoTracks[0]!.id, assetId: null, timelineStartUs: 1_000_000, durationUs: 2_000_000, sourceInUs: 0, sourceOutUs: 0 }),
    ClipSchema.parse({ id: 'video-b', trackId: videoTracks[1]!.id, assetId: null, timelineStartUs: 4_000_000, durationUs: 2_000_000, sourceInUs: 0, sourceOutUs: 0 }),
    ClipSchema.parse({ id: 'audio-a', trackId: audioTrack.id, assetId: null, timelineStartUs: 1_500_000, durationUs: 1_000_000, sourceInUs: 0, sourceOutUs: 0 }),
  ];
  return project;
}

describe('timeline marquee selection', () => {
  it('selects intersecting clips across the chosen time and track range', () => {
    const project = projectWithClips();
    const videoTracks = project.tracks.map((track, index) => ({ track, index })).filter(({ track }) => track.kind === 'video');
    const selected = selectClipsInMarquee(project, 2_500_000, 900_000, videoTracks[0]!.index, videoTracks[1]!.index);

    expect(selected).toEqual(['video-a']);
  });

  it('adds to an existing selection when the marquee is additive', () => {
    const project = projectWithClips();
    const firstVideoTrack = project.tracks.findIndex((track) => track.kind === 'video');
    const audioTrack = project.tracks.findIndex((track) => track.kind === 'audio');

    expect(selectClipsInMarquee(project, 1_000_000, 2_500_000, firstVideoTrack, audioTrack, ['video-b'])).toEqual([
      'video-b',
      'video-a',
      'audio-a',
    ]);
  });

  it('uses half-open clip intervals and does not select clips that only touch the range', () => {
    const project = projectWithClips();
    const videoTrack = project.tracks.findIndex((track) => track.kind === 'video');

    expect(selectClipsInMarquee(project, 3_000_000, 4_000_000, videoTrack, videoTrack)).toEqual([]);
  });
});
