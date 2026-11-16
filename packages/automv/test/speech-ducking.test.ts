import { describe, expect, it } from 'vitest';
import { buildSpeechDuckingKeyframes } from '../src/speech-ducking.js';

const seconds = (keyframes: ReturnType<typeof buildSpeechDuckingKeyframes>) =>
  keyframes.map((frame) => [frame.atUs / 1_000_000, frame.value]);

describe('envelope de ducking de falas', () => {
  it('mantém a música baixa durante pausas curtas entre frases', () => {
    const keyframes = buildSpeechDuckingKeyframes([
      { startS: 1, endS: 2 },
      { startS: 2.35, endS: 3.4 },
    ]);

    expect(seconds(keyframes)).toEqual([
      [0.82, 0],
      [1, -16],
      [3.4, -16],
      [4.05, 0],
    ]);
  });

  it('recupera a música entre falas realmente separadas', () => {
    const keyframes = buildSpeechDuckingKeyframes([
      { startS: 1, endS: 2 },
      { startS: 3.5, endS: 4 },
    ]);

    expect(seconds(keyframes)).toEqual([
      [0.82, 0],
      [1, -16],
      [2, -16],
      [2.65, 0],
      [3.32, 0],
      [3.5, -16],
      [4, -16],
      [4.65, 0],
    ]);
  });

  it('preserva a liberação rápida de uma fala que termina no drop', () => {
    const keyframes = buildSpeechDuckingKeyframes([
      { startS: 2, endS: 4, forceRelease: true, releaseS: 0.12 },
      { startS: 4.35, endS: 5 },
    ]);

    expect(seconds(keyframes)).toEqual([
      [1.82, 0],
      [2, -16],
      [4, -16],
      [4.12, 0],
      [4.17, 0],
      [4.35, -16],
      [5, -16],
      [5.65, 0],
    ]);
  });

  it('ordena, deduplica e ignora intervalos inválidos', () => {
    const keyframes = buildSpeechDuckingKeyframes([
      { startS: 2, endS: 3 },
      { startS: Number.NaN, endS: 4 },
      { startS: -1, endS: 1 },
      { startS: 1, endS: 2 },
    ]);

    expect(keyframes.map((frame) => frame.atUs)).toEqual([820_000, 1_000_000, 3_000_000, 3_650_000]);
    expect(keyframes.every((frame) => Number.isFinite(frame.value))).toBe(true);
  });

  it('retorna vazio quando não há falas válidas', () => {
    expect(buildSpeechDuckingKeyframes([{ startS: 2, endS: 2 }])).toEqual([]);
  });
});
