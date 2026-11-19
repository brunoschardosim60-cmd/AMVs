import { expect, it } from 'vitest';
import { createProject, type Clip } from '@amv/project';
import { playbackIndex } from './playbackIndex';

it('indexes each track in time order without reordering the source project', () => {
  const project = createProject({ name: 'Preview' });
  const clip = (id: string, trackId: string, start: number) => ({ id, trackId, timelineStartUs: start, durationUs: 1_000_000 } as Clip);
  project.clips = [clip('later', 'video', 2_000_000), clip('audio', 'audio', 0), clip('first', 'video', 0)];
  const index = playbackIndex(project);
  expect(index.tracks.get('video')?.map((c) => c.id)).toEqual(['first', 'later']);
  expect(index.tracks.get('audio')?.map((c) => c.id)).toEqual(['audio']);
  expect(index.durationUs).toBe(3_000_000);
  expect(project.clips.map((c) => c.id)).toEqual(['later', 'audio', 'first']);
});