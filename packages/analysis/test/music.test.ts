import { describe, expect, it } from 'vitest';
import { analyzeMusic, fft } from '../src/index.js';
import { synthForDebug } from './synth.js';

const SR = 22050;

const synth = synthForDebug;

describe('fft', () => {
  it('acha a frequência de uma senoide', () => {
    const n = 1024;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 32 * i) / n);
    fft(re, im);
    const mags = Array.from({ length: n / 2 }, (_, i) => Math.hypot(re[i]!, im[i]!));
    expect(mags.indexOf(Math.max(...mags))).toBe(32);
  });
});

describe('análise de música', () => {
  for (const bpm of [90, 128, 150, 174]) {
    it(`BPM ${bpm}`, () => {
      const a = analyzeMusic(synth(bpm, 40, 1000), SR);
      expect(Math.abs(a.bpm - bpm)).toBeLessThan(bpm * 0.02);
    });
  }

  it('batidas no lugar certo e compassos de 4', () => {
    const bpm = 120;
    const a = analyzeMusic(synth(bpm, 30, 1000, 0.25), SR);
    // cada batida detectada perto de 0,25 + k*0,5
    const errs = a.beats.slice(2, -2).map((t) => Math.abs(((t - 0.25 + 0.25) % 0.5) - 0.25));
    expect(Math.max(...errs)).toBeLessThan(0.05);
    expect(a.beats.length).toBeGreaterThan(55);
    expect(a.downbeats.length).toBeGreaterThan(12);
    const gaps = a.downbeats.slice(1).map((t, i) => t - a.downbeats[i]!);
    expect(Math.abs(gaps[5]! - 2)).toBeLessThan(0.06);
  });

  it('acha o drop e dá nome às seções', () => {
    const bpm = 128;
    const period = 60 / bpm;
    const dropS = 32 * period; // compasso 9 (15 s)
    const a = analyzeMusic(synth(bpm, 45, dropS), SR);
    expect(a.drops.length).toBeGreaterThan(0);
    expect(Math.abs(a.drops[0]! - dropS)).toBeLessThan(period * 4 + 0.1);
    expect(a.sections[0]!.label).toBe('intro');
    expect(a.sections.some((s) => s.label === 'drop' || s.label === 'refrão')).toBe(true);
    const after = a.energy.slice(Math.ceil((dropS + 2) / a.energyStepS));
    const before = a.energy.slice(4, Math.floor((dropS - 1) / a.energyStepS));
    expect(Math.min(...after)).toBeGreaterThan(Math.max(...before) - 0.05);
    expect(a.intensity).toBeGreaterThan(0);
  });

  it('silêncio não quebra', () => {
    const a = analyzeMusic(new Float32Array(SR * 5), SR);
    expect(a.durationS).toBeCloseTo(5);
    expect(Number.isFinite(a.bpm)).toBe(true);
  });
});
