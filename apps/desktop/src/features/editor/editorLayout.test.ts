import { expect, it } from 'vitest';
import { clampTimelineHeight } from './editorLayout';

it('reserves 280 pixels for preview and transport when timeline grows', () => {
  expect(clampTimelineHeight(500, 600)).toBe(320);
  expect(clampTimelineHeight(500, 450)).toBe(170);
  expect(clampTimelineHeight(20, 600)).toBe(160);
});