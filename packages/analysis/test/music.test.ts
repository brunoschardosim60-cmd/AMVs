import { describe, expect, it } from 'vitest';
import { analyzeMusic, correctTempoOctave, fft, setManualTempo } from '../src/index.js';
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
  it('corrige BPM em dobro/metade mantendo coerentes as batidas e compassos', () => {
    const analysis = analyzeMusic(synth(80, 20, 1000), SR);
    const doubled = correctTempoOctave(analysis, 'double');
    expect(doubled.bpm).toBe(analysis.bpm * 2);
    expect(doubled.beats.length).toBeGreaterThan(analysis.beats.length * 1.8);
    expect(doubled.downbeats).toEqual(analysis.downbeats);
    const halved = correctTempoOctave(analysis, 'half');
    expect(halved.bpm).toBe(analysis.bpm / 2);
    expect(halved.beats.length).toBe(Math.ceil(analysis.beats.length / 2));
    expect(halved.downbeats.length).toBe(Math.ceil(analysis.downbeats.length / 2));
    expect(() => correctTempoOctave({ ...analysis, bpm: 200 }, 'double')).toThrow(RangeError);
  });

  it('reconstrói batidas e compassos pelo BPM e pela fase informados manualmente', () => {
    const analysis = analyzeMusic(synth(80, 10, 1000), SR);
    const corrected = setManualTempo(analysis, 120, 0.25);
    expect(corrected.bpm).toBe(120);
    expect(corrected.beats[0]).toBeCloseTo(0.25);
    expect(corrected.beats[1]! - corrected.beats[0]!).toBeCloseTo(0.5);
    expect(corrected.downbeats[1]! - corrected.downbeats[0]!).toBeCloseTo(2);
    expect(corrected.bpmConfidence).toBe(1);
    expect(() => setManualTempo(analysis, 0, 0)).toThrow(RangeError);
    expect(() => setManualTempo(analysis, 120, analysis.durationS)).toThrow(RangeError);
  });

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

  it('sincronia fina: batida detectada a menos de 8 ms do golpe real, sem viés (era −24 ms)', () => {
    for (const bpm of [90, 128, 174]) {
      for (const off of [0, 0.13, 0.31]) {
        const per = 60 / bpm;
        const a = analyzeMusic(synth(bpm, 40, 1000, off), SR);
        const errs = a.beats.slice(3, -3).map((t) => t - (off + Math.round((t - off) / per) * per));
        const bias = errs.reduce((x, y) => x + y, 0) / errs.length;
        expect(Math.abs(bias), `viés a ${bpm} BPM, início ${off}`).toBeLessThan(0.004);
        expect(Math.max(...errs.map(Math.abs)), `pior erro a ${bpm} BPM`).toBeLessThan(0.008);
      }
    }
  });

  it('drop fora da grade de 4 compassos: achado e no primeiro golpe forte (antes: perdido ou 1-2 s atrasado)', () => {
    for (const [bpm, dropAt, off] of [[128, 32.3, 0], [128, 30, 0.2], [120, 28, 0.1], [140, 26.5, 0], [100, 19.2, 0], [128, 35, 0.3]] as const) {
      const per = 60 / bpm;
      const a = analyzeMusic(synth(bpm, 70, dropAt, off), SR);
      // primeira batida já forte: a primeira do sintetizador com início >= dropAt
      const firstLoud = off + Math.ceil((dropAt - off) / per - 1e-9) * per;
      expect(a.drops.length, `${bpm} BPM, drop ${dropAt}`).toBeGreaterThan(0);
      expect(Math.abs(a.drops[0]! - firstLoud), `${bpm} BPM, drop ${dropAt}: achou ${a.drops[0]}`).toBeLessThan(0.05);
      expect(a.sections.some((x) => x.label === 'drop' && Math.abs(x.startS - firstLoud) < 0.05)).toBe(true);
    }
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
