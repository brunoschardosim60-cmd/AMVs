import { describe, expect, it } from 'vitest';
import type { Cue, Shot, ShotVision } from '@amv/analysis';
import { matchLyricsSemantics } from '../src/lyric-matcher.js';
import type { Candidate, EpisodeInput } from '../src/generate.js';

function createCandidate(id: string, shotOverrides: Partial<Shot> = {}, speechText?: string): Candidate {
  const shot: Shot = {
    startS: 10,
    endS: 13,
    motion: 0.5,
    loud: 0.5,
    intensity: 0.6,
    brightness: 0.5,
    tags: ['ação'],
    line: null,
    peakS: 11.5,
    ...shotOverrides,
  };
  const ep: EpisodeInput = {
    assetId: 'ep1',
    name: 'Episode 01.mkv',
    hasAudio: true,
    analysis: {
      version: 'e2',
      durationS: 100,
      shots: [shot],
      sequences: [],
      subtitles: [],
      intensityCurve: [],
      curveStepS: 1,
      speech: speechText
        ? [{ startS: 10.2, endS: 12.0, kind: 'fala', confidence: 0.9, text: speechText, impact: 0.8 }]
        : [],
    },
  };
  return {
    id,
    assetId: ep.assetId,
    ep,
    shot,
    seq: 'ep1#seq1',
    sequenceOrder: 0,
    episodeOrder: 0,
    sourceStartS: shot.startS,
    sourceEndS: shot.endS,
  };
}

describe('matchLyricsSemantics', () => {
  it('detecta combate e acopla a cena de confronto visual', () => {
    const candidate = createCandidate('cand-fight', { tags: ['ação', 'impacto'] });
    const vision: ShotVision = {
      characters: ['Zoro'],
      fight: true,
      action: 'combate',
      confidence: 0.9,
      note: '',
    };

    const cues: Cue[] = [
      { startS: 15, endS: 18, text: 'Fight until the enemy falls down and bleed!' },
    ];

    const matches = matchLyricsSemantics(cues, [candidate], () => vision);
    const key = `${Math.round(15 * 1000)}-${Math.round(18 * 1000)}`;

    expect(matches['cand-fight']).toBeDefined();
    expect(matches['cand-fight']![key]?.score).toBeGreaterThanOrEqual(0.7);
    expect(matches['cand-fight']![key]?.reason).toContain('combate visual');
  });

  it('associa escuridão e noite com cenas de baixa luminosidade', () => {
    const candidate = createCandidate('cand-dark', { brightness: 0.25 });
    const cues: Cue[] = [
      { startS: 5, endS: 8, text: 'Lost in the shadows and endless dark night' },
    ];

    const matches = matchLyricsSemantics(cues, [candidate]);
    const key = `${Math.round(5 * 1000)}-${Math.round(8 * 1000)}`;

    expect(matches['cand-dark']).toBeDefined();
    expect(matches['cand-dark']![key]?.score).toBeGreaterThanOrEqual(0.7);
    expect(matches['cand-dark']![key]?.reason).toContain('atmosfera escura');
  });

  it('associa luz e claridade com cenas muito brilhantes', () => {
    const candidate = createCandidate('cand-light', { brightness: 0.85 });
    const cues: Cue[] = [
      { startS: 25, endS: 28, text: 'A shining star of light will guide the way' },
    ];

    const matches = matchLyricsSemantics(cues, [candidate]);
    const key = `${Math.round(25 * 1000)}-${Math.round(28 * 1000)}`;

    expect(matches['cand-light']).toBeDefined();
    expect(matches['cand-light']![key]?.score).toBeGreaterThanOrEqual(0.7);
    expect(matches['cand-light']![key]?.reason).toContain('iluminação');
  });

  it('dá bônus quando o personagem na cena fala algo coerente com a letra', () => {
    const candidate = createCandidate('cand-speech', { intensity: 0.8, motion: 0.7 }, 'Eu nunca vou me render, tenho o poder!');
    const cues: Cue[] = [
      { startS: 30, endS: 33, text: 'Unleash your true power and rise as a champion' },
    ];

    const matches = matchLyricsSemantics(cues, [candidate]);
    const key = `${Math.round(30 * 1000)}-${Math.round(33 * 1000)}`;

    expect(matches['cand-speech']).toBeDefined();
    expect(matches['cand-speech']![key]?.score).toBeGreaterThanOrEqual(0.8);
    expect(matches['cand-speech']![key]?.reason).toContain('fala do personagem coincide');
  });

  it('ignora estrofes sem temas semânticos ou candidatos que não se encaixam', () => {
    const candidate = createCandidate('cand-calm', { brightness: 0.5, intensity: 0.3, motion: 0.2, tags: ['calma'] });
    const cues: Cue[] = [
      { startS: 1, endS: 4, text: 'Walking down the peaceful quiet street' },
    ];

    const matches = matchLyricsSemantics(cues, [candidate]);
    expect(Object.keys(matches).length).toBe(0);
  });
});
