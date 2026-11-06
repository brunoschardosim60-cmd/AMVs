import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatTimecode,
  frameToUs,
  parseRational,
  secondsToUs,
  snapUsToFrame,
  usToFrame,
} from '../src/index.js';

const NTSC = { num: 30000, den: 1001 };
const FILM = { num: 24000, den: 1001 };

describe('tempo', () => {
  it('lê FPS racional do ffprobe', () => {
    expect(parseRational('30000/1001')).toEqual(NTSC);
    expect(parseRational('50/2')).toEqual({ num: 25, den: 1 });
    expect(parseRational('25')).toEqual({ num: 25, den: 1 });
    expect(parseRational('0/0')).toBeNull();
    expect(parseRational(undefined)).toBeNull();
  });

  it('frame ↔ µs sem erro acumulado em uma hora de 23,976', () => {
    for (const frame of [0, 1, 24, 1000, 86_313]) {
      expect(usToFrame(frameToUs(frame, FILM), FILM)).toBe(frame);
    }
    // 1 hora a 23,976 = 86313,6 frames
    expect(usToFrame(3_600_000_000, FILM)).toBe(86313);
  });

  it('alinha ao frame mais próximo', () => {
    const f = frameToUs(10, NTSC);
    expect(snapUsToFrame(f + 3000, NTSC)).toBe(f);
    expect(snapUsToFrame(f - 3000, NTSC)).toBe(f);
  });

  it('formata duração e timecode', () => {
    expect(formatDuration(secondsToUs(83.4567))).toBe('01:23.457');
    expect(formatDuration(secondsToUs(3725))).toBe('01:02:05.000');
    expect(formatTimecode(secondsToUs(61.5), { num: 30, den: 1 })).toBe('00:01:01:15');
  });
});
