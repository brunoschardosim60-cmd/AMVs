import { describe, expect, it } from 'vitest';
import { buildEpisodeAnalysis, detectSpeech } from '../src/index.js';

describe('nível estimado de cada fala', () => {
  const t = Array.from({ length: 200 }, (_, i) => i * 0.032);
  const db = t.map((x) => (x >= 3 && x <= 4.5 ? -9 : x >= 1 && x <= 2.5 ? -27 : -60));
  const voiceRatio = t.map(() => 0.8);

  it('guarda percentil 90 do nível nas falas associadas a legendas', () => {
    const speech = detectSpeech({ t, db, voiceRatio }, [
      { startS: 1, endS: 2.5, text: 'baixinho' },
      { startS: 3, endS: 4.5, text: 'alto!' },
    ]);
    expect(speech).toHaveLength(2);
    expect(speech[0]!.loudnessDb).toBeCloseTo(-28, 0);
    expect(speech[1]!.loudnessDb).toBeCloseTo(-10, 0);
  });


  it('registra qual faixa foi usada para medir as falas', () => {
    const analysis = buildEpisodeAnalysis(
      [{ t: 0, scene: 0, ydif: 0, yavg: 100 }, { t: 1, scene: 0, ydif: 0, yavg: 100 }],
      2,
      { t: [0.5], db: [-20] },
      [],
      [],
      7,
    );
    expect(analysis.speechAudioStreamIndex).toBe(7);
  });

  it('guarda nível estimado também na detecção sem legendas', () => {
    const speech = detectSpeech({ t, db, voiceRatio });
    expect(speech.length).toBeGreaterThan(0);
    expect(speech.every((segment) => Number.isFinite(segment.loudnessDb))).toBe(true);
  });
});
