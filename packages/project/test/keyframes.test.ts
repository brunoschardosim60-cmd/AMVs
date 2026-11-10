import { describe, expect, it } from 'vitest';
import { evaluateKeyframes, removeKeyframeAt, upsertKeyframe } from '../src/index.js';

describe('keyframes de posição', () => {
  const frames = [
    { atUs: 0, value: -100, easing: 'linear' as const },
    { atUs: 1_000_000, value: 100, easing: 'ease-in-out' as const },
  ];

  it('mantém o valor das bordas e interpola no tempo local', () => {
    expect(evaluateKeyframes(frames, 0, 0)).toBe(-100);
    expect(evaluateKeyframes(frames, 500_000, 0)).toBeCloseTo(0);
    expect(evaluateKeyframes(frames, 1_000_000, 0)).toBe(100);
    expect(evaluateKeyframes(frames, 2_000_000, 7)).toBe(100);
  });

  it('respeita hold e atualiza/remove uma chave sem alterar as demais', () => {
    const hold = [{ atUs: 0, value: 2, easing: 'linear' as const }, { atUs: 1_000_000, value: 8, easing: 'hold' as const }];
    expect(evaluateKeyframes(hold, 900_000, 0)).toBe(2);
    const updated = upsertKeyframe(hold, 1_000_000, 9);
    expect(updated).toHaveLength(2);
    expect(updated[1]?.value).toBe(9);
    expect(updated[1]?.easing).toBe('hold');
    expect(removeKeyframeAt(updated, 1_000_000)).toEqual([hold[0]]);
  });
});
