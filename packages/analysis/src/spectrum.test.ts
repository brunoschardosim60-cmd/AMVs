import { describe, expect, it } from 'vitest';
import { forEachSpectrum, stft } from './dsp';
import { voiceFeatures } from './episode';

describe('bounded episode spectral analysis', () => {
  it('reuses one spectrum buffer while matching the retained STFT values', () => {
    const samples = Float32Array.from({ length: 4096 }, (_, i) => Math.sin(2 * Math.PI * 440 * i / 16000));
    const full = stft(samples, 16000, 1024, 512);
    const buffers = new Set<Float32Array>();
    let count = 0;
    forEachSpectrum(samples, 1024, 512, (frame, index) => {
      buffers.add(frame); count++;
      expect([...frame]).toEqual([...full.mags[index] ?? []]);
    });
    expect(buffers.size).toBe(1);
    expect(count).toBe(7);
  });
  it('retains voice frequency evidence and exact analysis frame times', () => {
    const tone = (hz: number) => Float32Array.from({ length: 16000 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * hz * i / 16000));
    const voice = voiceFeatures(tone(1000), 16000);
    const low = voiceFeatures(tone(100), 16000);
    expect(voice.t[0]).toBe(0.032);
    expect(voice.t[1]).toBe(0.064);
    expect(voice.voiceRatio[0]).toBeGreaterThan(0.99);
    expect(low.voiceRatio[0]).toBeLessThan(0.01);
  });
});