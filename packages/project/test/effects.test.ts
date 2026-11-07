import { describe, expect, it } from 'vitest';
import { defaultParams, easeInOut, evalClipLook, shakeOffset, transitionUnderlay } from '../src/index.js';

const base = { transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } }, transitionIn: null };
const fx = (effect: string, params: Record<string, number> = {}) => ({ id: effect, effect, enabled: true, params });

describe('efeitos', () => {
  it('zoom com suavização vai de from a to', () => {
    const c = { ...base, effects: [fx('zoom', { from: 1, to: 1.5, ease: 1 })] };
    expect(evalClipLook(c, 0, 2).zoom).toBeCloseTo(1);
    expect(evalClipLook(c, 1, 2).zoom).toBeCloseTo(1.25);
    expect(evalClipLook(c, 2, 2).zoom).toBeCloseTo(1.5);
    expect(easeInOut(0.25)).toBeLessThan(0.25);
  });

  it('clarão some ao longo da duração; efeito desligado não conta', () => {
    const c = { ...base, effects: [fx('flash', { duration: 0.2, white: 1, strength: 1 })] };
    expect(evalClipLook(c, 0, 2).overlays).toEqual([{ white: true, alpha: 1 }]);
    expect(evalClipLook(c, 0.1, 2).overlays[0]!.alpha).toBeCloseTo(0.5);
    expect(evalClipLook(c, 0.25, 2).overlays).toEqual([]);
    expect(evalClipLook({ ...c, effects: [{ ...c.effects[0]!, enabled: false }] }, 0, 2).overlays).toEqual([]);
  });

  it('tremida diminui até zero', () => {
    expect(shakeOffset(0.6, 20, 10, 0.5)).toEqual({ dx: 0, dy: 0 });
    expect(Math.abs(shakeOffset(0, 20, 10, 0.5).dy)).toBeCloseTo(20);
  });

  it('fades e transições', () => {
    const c = { ...base, effects: [fx('fade_out', { duration: 1 })] };
    expect(evalClipLook(c, 3.5, 4).overlays[0]!.alpha).toBeCloseTo(0.5);
    const d = { ...base, effects: [], transitionIn: { transition: 'dissolve', durationUs: 1_000_000, params: {} } };
    expect(evalClipLook(d, 0.25, 4).alpha).toBeCloseTo(0.25);
    const dip = { ...base, effects: [], transitionIn: { transition: 'dip_black', durationUs: 1_000_000, params: {} } };
    expect(evalClipLook(dip, 0.25, 4)).toMatchObject({ alpha: 0, overlays: [{ white: false, alpha: 0.5 }] });
    expect(evalClipLook(dip, 0.75, 4).overlays[0]!.alpha).toBeCloseTo(0.5);
  });

  it('clipe anterior encostado continua por baixo na transição', () => {
    const a = { id: 'a', trackId: 't', timelineStartUs: 0, durationUs: 2_000_000, transitionIn: null, assetId: 'x' };
    const b = { id: 'b', trackId: 't', timelineStartUs: 2_000_000, durationUs: 2_000_000, transitionIn: { transition: 'dissolve', durationUs: 500_000, params: {} }, assetId: 'x' };
    expect(transitionUnderlay([a, b], b)?.id).toBe('a');
    expect(transitionUnderlay([a, { ...b, transitionIn: null }], { ...b, transitionIn: null })).toBeNull();
    expect(defaultParams('shake')).toEqual({ intensity: 18, frequency: 14, duration: 0.5 });
  });
});
