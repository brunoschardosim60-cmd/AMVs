import { expect, it } from 'vitest';
import { wordPreviewEnded } from './wordPreview';

it('does not stop ordinary playback when a timed subtitle is selected', () => {
  expect(wordPreviewEnded(null, 'lyrics', 1_400_000)).toBe(false);
});

it('stops only an explicitly requested word preview at its end', () => {
  const range = { clipId: 'lyrics', endUs: 500_000 };
  expect(wordPreviewEnded(range, 'lyrics', 499_999)).toBe(false);
  expect(wordPreviewEnded(range, 'lyrics', 500_000)).toBe(true);
  expect(wordPreviewEnded(range, 'other', 600_000)).toBe(false);
});