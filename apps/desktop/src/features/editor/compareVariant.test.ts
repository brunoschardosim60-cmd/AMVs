import { expect, it } from 'vitest';
import { type Clip } from '@amv/project';
import { compareVariant, comparisonEndUs } from './compareVariant';
const clip = { durationUs: 4_000_000, timelineStartUs: 10_000_000, sourceInUs: 2_000_000, sourceOutUs: 6_000_000, speed: 1, reverse: false, keyframes: {}, effects: [] } as unknown as Clip;
it('allows seeking through the longer comparison in either column', () => {
  expect(comparisonEndUs({ durationUs: 3_000_000 }, { durationUs: 4_500_000 })).toBe(4_499_999);
  expect(comparisonEndUs({ durationUs: 4_500_000 }, { durationUs: 3_000_000 })).toBe(4_499_999);
});
it('keeps both source boundaries within the selected interval without mutating the original', () => {
  const result = compareVariant(clip, 'vibrant', 1_000_000, 3_000_000);
  expect(result.sourceInUs).toBe(3_000_000);
  expect(result.sourceOutUs).toBe(5_000_000);
  expect(result.durationUs).toBe(2_000_000);
  expect(result.timelineStartUs).toBe(11_000_000);
  expect(clip.effects).toEqual([]);
});
it('preserves reverse footage bounds and animations rather than guessing new timings', () => {
  const result = compareVariant({ ...clip, reverse: true }, 'impact', 1_000_000, 2_000_000);
  expect(result.sourceInUs).toBe(2_000_000);
  expect(result.sourceOutUs).toBe(6_000_000);
  expect(result.durationUs).toBe(4_000_000);
});