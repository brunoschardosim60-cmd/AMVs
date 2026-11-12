import { describe, expect, it } from 'vitest';
import type { MusicAnalysis, Shot } from '@amv/analysis';
import { recommendEpisodePreset } from '../src/smart-preset.js';
import type { EpisodeInput, MusicInput } from '../src/generate.js';

function createMusic(overrides: Partial<MusicAnalysis> = {}): MusicInput {
  const analysis: MusicAnalysis = {
    version: 'm2',
    durationS: 90,
    bpm: 145,
    bpmConfidence: 0.9,
    beats: [0.5, 1.0, 1.5, 2.0],
    downbeats: [0, 1.0, 2.0],
    energy: [0.5, 0.8, 0.9, 0.85],
    energyStepS: 0.1,
    intensity: 85,
    loudnessDb: -12,
    drops: [15],
    sections: [
      { label: 'intro', startS: 0, endS: 15, energy: 0.3 },
      { label: 'drop', startS: 15, endS: 45, energy: 0.9 },
    ],
    ...overrides,
  };
  return {
    assetId: 'mus1',
    name: 'Epic Fight Song.mp3',
    analysis,
  };
}

function createEpisode(hasPtAudio = false): EpisodeInput {
  const shot: Shot = {
    startS: 10,
    endS: 15,
    motion: 0.8,
    loud: 0.7,
    intensity: 0.85,
    brightness: 0.52,
    tags: ['ação', 'impacto'],
    line: null,
    peakS: 12.5,
  };

  return {
    assetId: 'ep1',
    name: 'Chainsaw Man 01.mkv',
    hasAudio: true,
    audioStreams: [
      { index: 0, language: 'jpn', title: 'Japonês' },
      ...(hasPtAudio ? [{ index: 1, language: 'pt', title: 'Português' }] : []),
    ],
    analysis: {
      version: 'e2',
      durationS: 120,
      shots: [shot],
      sequences: [
        {
          id: 'seq1',
          startS: 10,
          endS: 50,
          kind: 'luta',
          intensity: 0.9,
          peak: 0.95,
          shotCount: 1,
        },
      ],
      subtitles: [],
      intensityCurve: [],
      curveStepS: 1,
      speech: [
        { startS: 14.0, endS: 16.0, kind: 'grito', confidence: 0.95, text: 'Vou cortar você!', impact: 0.9 },
        { startS: 30.0, endS: 32.0, kind: 'grito', confidence: 0.9, text: 'Morra!', impact: 0.85 },
      ],
    },
  };
}

describe('recommendEpisodePreset', () => {
  it('gera preset com intensidade alta para música acelerada de combate', () => {
    const music = createMusic({ bpm: 150, energy: [0.88], drops: [18] });
    const ep = createEpisode(false);

    const preset = recommendEpisodePreset([ep], music);

    expect(preset.intensity).toBe(3);
    expect(preset.focus).toBe('fight');
    expect(preset.organizationMode).toBe('narrative');
    expect(preset.durationS).toBe(30);
    expect(preset.voiceMoments).toBe(2);
    expect(preset.voiceLang).toBe('original');
    expect(preset.useSpeech).toBe(true);
    expect(preset.useEffects).toBe(true);
    expect(preset.heroCover).toBeDefined();
    expect(preset.explanation.title).toContain('Chainsaw Man');
    expect(preset.explanation.reasons.length).toBeGreaterThan(0);
  });

  it('detecta faixa em português e calibra voiceLang como pt', () => {
    const music = createMusic({ bpm: 120, energy: [0.6], drops: [28] });
    const ep = createEpisode(true);

    const preset = recommendEpisodePreset([ep], music);

    expect(preset.voiceLang).toBe('pt');
    expect(preset.durationS).toBe(45); // drop aos 28s -> duration 45s
  });

  it('calibra para modo suave e direção cinematográfica em música calma', () => {
    const music = createMusic({ bpm: 85, energy: [0.3], drops: [] });
    const ep = createEpisode(false);

    const preset = recommendEpisodePreset([ep], music);

    expect(preset.intensity).toBe(1);
    expect(preset.explanation.reasons.some((r) => r.includes('Intensidade 1/3'))).toBe(true);
  });
});
