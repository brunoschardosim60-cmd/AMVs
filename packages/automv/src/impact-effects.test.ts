import { expect, it } from 'vitest';
import type { EffectInstance } from '@amv/project';
import { refineImpactEffects } from './impact-effects';

const effects: EffectInstance[] = ['color', 'flash', 'rgb_split', 'shake'].map((effect) => ({ id: effect, effect, enabled: true, params: { duration: 0.45, strength: 1.15, amount: 14, intensity: 28 } }));

it('keeps grading and limits a zoom impact to one brief additional effect', () => {
  const refined = refineImpactEffects(effects, 0.2, true, null);
  expect(refined.map((effect) => effect.effect)).toEqual(['color', 'flash']);
  expect(refined[1]?.params.duration).toBeCloseTo(0.09);
  expect(refined[1]?.params.strength).toBe(0.75);
});

it('does not stack a flash effect over a decorative transition', () => {
  const refined = refineImpactEffects(effects, 1, false, { transition: 'flash', durationUs: 100_000, params: {} });
  expect(refined.map((effect) => effect.effect)).toEqual(['color', 'rgb_split']);
  expect(refined[1]?.params.amount).toBe(8);
  expect(refined[1]?.params.duration).toBe(0.28);
});

it('does not waste the impact budget on duplicate effects', () => {
  const refined = refineImpactEffects([effects[1], effects[1], effects[2]].filter((e): e is EffectInstance => !!e), 1, false, null);
  expect(refined.map((e) => e.effect)).toEqual(['flash', 'rgb_split']);
});

it('rejects invalid clip durations without removing grading', () => {
  expect(refineImpactEffects(effects, NaN, false, null).map((e) => e.effect)).toEqual(['color']);
});

it('keeps impact parameters finite and nonnegative', () => {
  const refined = refineImpactEffects([
    { id: 'flash', effect: 'flash', enabled: true, params: { strength: -2, duration: Infinity } },
    { id: 'shake', effect: 'shake', enabled: true, params: { intensity: NaN } },
  ], 1, false, null);
  expect(refined[0]?.params).toMatchObject({ strength: 0, duration: 0.2 });
  expect(refined[1]?.params.intensity).toBe(10);
});