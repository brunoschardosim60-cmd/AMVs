import { describe, expect, it } from 'vitest';
import { applyColorGrade, applyWhipPan, colorGradeCube, createColorGradeLut, defaultParams, easeInOut, evalClipLook, matchSceneColor, matchSceneExposure, sampleColorGradeLut, shakeOffset, transitionProgress, transitionUnderlay } from '../src/index.js';

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

  it('color grading agrega ajustes e preserva o look legado', () => {
    const c = {
      ...base,
      effects: [
        fx('color', { brightness: 0.1, contrast: 1.2, saturation: 0.8, exposure: 0.5, temperature: 20, tint: -10, hue: 15, shadows: -0.2, midtones: 0.1, highlights: 0.3, vignette: 0.2 }),
      ],
    };
    expect(evalClipLook(c, 0, 1)).toMatchObject({
      brightness: 0.1, contrast: 1.2, saturation: 0.8, exposure: 0.5, temperature: 20, tint: -10,
      hue: 15, shadows: -0.2, midtones: 0.1, highlights: 0.3, vignette: 0.2,
    });
  });

  it('match de exposição só corrige saltos de luminância e mantém limite conservador', () => {
    expect(matchSceneExposure(0.5, 0.46)).toBe(0);
    expect(matchSceneExposure(0.8, 0.4)).toBeGreaterThan(0);
    expect(matchSceneExposure(0.2, 0.9)).toBeLessThan(0);
    expect(matchSceneExposure(1, 0.02)).toBe(0.3);
    expect(matchSceneExposure(0.02, 1)).toBe(-0.3);
  });

  it('matching cromático local é limitado e LUT interpola a mesma transformação', () => {
    expect(matchSceneColor([0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0], [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1])).toEqual({ temperature: 8, tint: 0 });
    expect(matchSceneColor([], [])).toEqual({ temperature: 0, tint: 0 });
    const grade = { brightness: 0.02, contrast: 1.08, saturation: 0.92, exposure: 0.25, temperature: 12, tint: -4, hue: 18, shadows: -0.1, midtones: 0.05, highlights: 0.08 };
    const lut = createColorGradeLut(grade, 17);
    const direct = applyColorGrade([0.31, 0.53, 0.72], grade);
    const sampled = sampleColorGradeLut([0.31, 0.53, 0.72], lut);
    direct.forEach((value, index) => expect(sampled[index]).toBeCloseTo(value, 2));
    expect(colorGradeCube(grade, 3).trim().split(/\r?\n/)).toHaveLength(31);
  });

  it('fades e transições', () => {
    const c = { ...base, effects: [fx('fade_out', { duration: 1 })] };
    expect(evalClipLook(c, 3.5, 4).overlays[0]!.alpha).toBeCloseTo(0.5);
    const d = { ...base, effects: [], transitionIn: { transition: 'dissolve', durationUs: 1_000_000, params: {} } };
    expect(evalClipLook(d, 0.25, 4).alpha).toBeCloseTo(0.25);
    const dip = { ...base, effects: [], transitionIn: { transition: 'dip_black', durationUs: 1_000_000, params: {} } };
    expect(evalClipLook(dip, 0.25, 4)).toMatchObject({ alpha: 0.25, overlays: [{ white: false, alpha: 0.5 }] });
    expect(evalClipLook(dip, 0.75, 4).overlays[0]!.alpha).toBeCloseTo(0.5);
  });

  it('curvas de transição e whip pan produzem valores estáveis no preview', () => {
    expect(transitionProgress(0.25, 'ease-in')).toBeCloseTo(0.0625);
    expect(transitionProgress(0.25, 'ease-out')).toBeCloseTo(0.4375);
    expect(transitionProgress(0.25, 'ease-in-out')).toBeCloseTo(easeInOut(0.25));
    expect(transitionProgress(0.5, 'linear', 0.5)).toBeCloseTo(Math.pow(0.5, 2.5));
    const look = { ...evalClipLook({ ...base, effects: [] }, 0, 1), dx: 0, blur: 0 };
    const transition = { transition: 'whip_pan', durationUs: 1_000_000, params: { intensity: 0.5, direction: -1, blur: 6, curve: 'linear' } };
    expect(applyWhipPan(look, transition, 0, false, 1000)).toMatchObject({ dx: 500, blur: 6 });
    expect(applyWhipPan(look, transition, 1, true, 1000)).toMatchObject({ dx: -500, blur: 6 });
  });

  it('clipe anterior encostado continua por baixo na transição', () => {
    const a = { id: 'a', trackId: 't', timelineStartUs: 0, durationUs: 2_000_000, transitionIn: null, assetId: 'x' };
    const b = { id: 'b', trackId: 't', timelineStartUs: 2_000_000, durationUs: 2_000_000, transitionIn: { transition: 'dissolve', durationUs: 500_000, params: {} }, assetId: 'x' };
    expect(transitionUnderlay([a, b], b)?.id).toBe('a');
    expect(transitionUnderlay([a, { ...b, transitionIn: { transition: 'match_cut', durationUs: 0, params: {} } }], {
      ...b,
      transitionIn: { transition: 'match_cut', durationUs: 0, params: {} },
    })).toBeNull();
    expect(transitionUnderlay([a, { ...b, transitionIn: null }], { ...b, transitionIn: null })).toBeNull();
    expect(defaultParams('shake')).toEqual({ intensity: 18, frequency: 14, duration: 0.5 });
  });
});
