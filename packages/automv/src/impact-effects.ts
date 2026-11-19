import type { Clip, EffectInstance } from '@amv/project';

const IMPACTS = new Set(['flash', 'shake', 'rgb_split']);

/** Keep impacts brief and avoid stacking zoom, flash, shake and chromatic split. */
export function refineImpactEffects(effects: EffectInstance[], durationS: number, hasZoom: boolean, transition: Clip['transitionIn'], isDrop = false): EffectInstance[] {
  const decorativeTransition = !!transition && !['match_cut', 'cut_on_action'].includes(transition.transition);
  const budget = isDrop ? 2 : hasZoom || decorativeTransition ? 1 : 2;
  let count = 0;
  const seen = new Set<string>();
  return effects.flatMap((effect) => {
    if (!IMPACTS.has(effect.effect) || !effect.enabled) return [effect];
    if (!Number.isFinite(durationS) || durationS <= 0 || seen.has(effect.effect)) return [];
    if (decorativeTransition && effect.effect === 'flash') return [];
    if (count >= budget) return [];
    count++;
    seen.add(effect.effect);
    const params = { ...effect.params };
    const requested = typeof params.duration === 'number' && Number.isFinite(params.duration) ? params.duration : 0.2;
    params.duration = Math.max(0, Math.min(requested, durationS * 0.45, 0.28));
    const bounded = (value: unknown, fallback: number, max: number) => Math.max(0, Math.min(max, typeof value === 'number' && Number.isFinite(value) ? value : fallback));
    if (effect.effect === 'flash') params.strength = bounded(params.strength, 0.5, 0.75);
    if (effect.effect === 'rgb_split') params.amount = bounded(params.amount, 4, 8);
    if (effect.effect === 'shake') params.intensity = bounded(params.intensity, 10, 18);
    return [{ ...effect, params }];
  });
}