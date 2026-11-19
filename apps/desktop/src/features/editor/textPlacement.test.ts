import { expect, it } from 'vitest';
import { createProject, type Clip } from '@amv/project';
import { nextTextStart } from './textPlacement';

it('preserves occupied caption intervals when adding another text', () => {
  const project = createProject({ name: 'Text insertion' });
  project.clips = [{ trackId: 'text', timelineStartUs: 0, durationUs: 3_000_000 }, { trackId: 'text', timelineStartUs: 3_000_000, durationUs: 3_000_000 }] as Clip[];
  expect(nextTextStart(project, 'text', 0, 3_000_000)).toBe(6_000_000);
  expect(nextTextStart(project, 'empty', 1_000_000, 3_000_000)).toBe(1_000_000);
});