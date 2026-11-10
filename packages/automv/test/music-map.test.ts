import { describe, expect, it } from 'vitest';
import type { MusicAnalysis } from '@amv/analysis';
import { buildMusicMap } from '../src/music-map.js';

const analysis: MusicAnalysis = {
  version: 'm4',
  durationS: 16,
  bpm: 120,
  bpmConfidence: 0.8,
  beats: Array.from({ length: 32 }, (_, index) => index * 0.5),
  downbeats: Array.from({ length: 8 }, (_, index) => index * 2),
  energy: Array.from({ length: 64 }, (_, index) => index / 63),
  energyStepS: 0.25,
  sections: [
    { startS: 0, endS: 8, label: 'intro', energy: 0.3 },
    { startS: 8, endS: 16, label: 'drop', energy: 0.8 },
  ],
  drops: [8],
  events: [{ atS: 9.5, type: 'impact', confidence: 0.7, strength: 0.8, band: 'low' }],
  intensity: 70,
  loudnessDb: -12,
};

describe('mapa musical', () => {
  it('recorta os dados ao trecho e preserva tempos, eventos e confiança', () => {
    const map = buildMusicMap(analysis, [4, 12]);
    expect(map.startS).toBe(4);
    expect(map.endS).toBe(12);
    expect(map.beats[0]).toBe(0);
    expect(map.downbeats).toEqual([0, 2, 4, 6, 8]);
    expect(map.sections.map((section) => [section.startS, section.endS])).toEqual([[0, 4], [4, 8]]);
    expect(map.events).toEqual([{ ...analysis.events![0]!, timelineS: 5.5 }]);
    expect(map.energy.at(-1)?.timeS).toBe(8);
  });
});
