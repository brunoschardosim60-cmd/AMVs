import { ClipSchema, TrackSchema } from '@amv/project';
import { describe, expect, it } from 'vitest';
import { clipVolume } from '../src/features/editor/player';

const track = TrackSchema.parse({ id: 'trk_audio', kind: 'audio', name: 'Música' });

function makeClip(
  audio: Partial<{ gainDb: number; fadeInUs: number; fadeOutUs: number }> = {},
  keyframes: Record<string, { atUs: number; value: number; easing: 'linear' }[]> = {},
) {
  return ClipSchema.parse({
    id: 'clip_audio',
    trackId: track.id,
    assetId: null,
    timelineStartUs: 0,
    durationUs: 1_000_000,
    sourceInUs: 0,
    sourceOutUs: 1_000_000,
    audio,
    keyframes,
  });
}

describe('preview audio gain', () => {
  it('preserves positive clip and track gain above unity for Web Audio', () => {
    const clip = makeClip({ gainDb: 6 });
    const withTrackGain = { ...track, gainDb: 6 };

    expect(clipVolume(clip, track, 500_000, false)).toBeCloseTo(10 ** (6 / 20), 8);
    expect(clipVolume(clip, withTrackGain, 500_000, false)).toBeCloseTo(10 ** (12 / 20), 8);
  });

  it('applies fades to the linear gain', () => {
    const fadeIn = makeClip({ gainDb: 6, fadeInUs: 1_000_000 });
    const fadeOut = makeClip({ gainDb: 6, fadeOutUs: 500_000 });

    expect(clipVolume(fadeIn, track, 500_000, false)).toBeCloseTo(10 ** (6 / 20) * 0.5, 8);
    expect(clipVolume(fadeOut, track, 750_000, false)).toBeCloseTo(10 ** (6 / 20) * 0.5, 8);
  });

  it('respects muted and solo tracks', () => {
    const clip = makeClip({ gainDb: 6 });

    expect(clipVolume(clip, { ...track, muted: true }, 500_000, false)).toBe(0);
    expect(clipVolume(clip, track, 500_000, true)).toBe(0);
    expect(clipVolume(clip, { ...track, solo: true }, 500_000, true)).toBeCloseTo(10 ** (6 / 20), 8);
  });

  it('interpolates keyframed gain in linear amplitude', () => {
    const clip = makeClip({}, {
      'audio.gainDb': [
        { atUs: 0, value: 0, easing: 'linear' },
        { atUs: 1_000_000, value: 6, easing: 'linear' },
      ],
    });
    const expected = (1 + 10 ** (6 / 20)) / 2;

    expect(clipVolume(clip, track, 500_000, false)).toBeCloseTo(expected, 8);
  });
});
