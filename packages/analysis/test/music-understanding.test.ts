import { describe, expect, it } from 'vitest';
import {
  analyzeMusicUnderstanding,
  CreativeAnalysisCache,
  interpretLyricPhrase,
  type Cue,
  type MusicAnalysis,
} from '../src/index.js';

function makeBaseMusic(overrides: Partial<MusicAnalysis> = {}): MusicAnalysis {
  const durationS = overrides.durationS ?? 32;
  const bpm = overrides.bpm ?? 128;
  const period = 60 / bpm;
  const beats = Array.from({ length: Math.floor(durationS / period) }, (_, i) => Number((i * period).toFixed(3)));
  const downbeats = beats.filter((_, i) => i % 4 === 0);
  const energyStepS = 0.25;
  const energy = Array.from({ length: Math.ceil(durationS / energyStepS) }, (_, i) => {
    const t = i * energyStepS;
    return t < 8 ? 0.22 : t < 16 ? 0.48 : t < 24 ? 0.88 : 0.3;
  });
  return {
    version: 'm6',
    durationS,
    bpm,
    bpmConfidence: 0.9,
    beats,
    downbeats,
    energy,
    energyStepS,
    sections: [
      { startS: 0, endS: 8, label: 'intro', energy: 0.22 },
      { startS: 8, endS: 16, label: 'pré-refrão', energy: 0.48 },
      { startS: 16, endS: 24, label: 'drop', energy: 0.88 },
      { startS: 24, endS: 32, label: 'final', energy: 0.3 },
    ],
    drops: [16],
    events: [
      { atS: 8, type: 'growth', durationS: 8, confidence: 0.82, strength: 0.4 },
      { atS: 16, type: 'drop', confidence: 0.91, strength: 0.66 },
      { atS: 28, type: 'pause', durationS: 1.2, confidence: 0.75, strength: 0.8 },
    ],
    intensity: 74,
    loudnessDb: -12,
    meter: 4,
    ...overrides,
  };
}

describe('Music Understanding Engine (Camada 1)', () => {
  it('interpreta sentido semântico, metáforas e adapta sugestões visuais ao contexto do anime', () => {
    const combatCtx = interpretLyricPhrase('Mesmo ferido eu vou continuar de pé nas chamas', {
      musicEnergy: 0.78,
      bpm: 140,
      animeContext: { hasFights: true, hasEmotionalDrama: true },
    });
    expect(combatCtx.meaning.themes).toContain('resistência');
    expect(combatCtx.meaning.themes).toContain('fúria');
    expect(combatCtx.meaning.isMetaphorical).toBe(true);
    expect(combatCtx.meaning.visualSuggestions.some((s) => /ferido|defesa|ataque/i.test(s))).toBe(true);
    expect(combatCtx.confidence).toBeGreaterThan(0.6);

    const dramaCtx = interpretLyricPhrase('Alone in the silence remembering yesterday', {
      musicEnergy: 0.25,
      bpm: 84,
      animeContext: { hasFights: false, hasEmotionalDrama: true },
    });
    expect(dramaCtx.meaning.themes).toContain('solidão');
    expect(dramaCtx.meaning.themes).toContain('memória');
    expect(dramaCtx.meaning.emotionalIntent).toBe('melancolia');
    expect(dramaCtx.meaning.valence).toBeLessThan(0);
  });

  it('Teste F — Música instrumental: nunca inventa significado de letra e guia por ritmo/dinâmica', () => {
    const music = makeBaseMusic();
    const res = analyzeMusicUnderstanding(music, { isInstrumental: true });

    expect(res.isInstrumental).toBe(true);
    expect(res.archetype).toBe('instrumental');
    expect(res.lyricInterpretations).toHaveLength(0);
    expect(res.vocalSpans).toHaveLength(0);
    expect(res.instrumentalSpans.length).toBeGreaterThan(0);
    expect(res.events.every((ev) => ev.lyrics === null && ev.semanticMeaning === null)).toBe(true);
    expect(res.events.some((ev) => ev.eventType === 'build')).toBe(true);
    expect(res.events.some((ev) => ev.eventType === 'drop')).toBe(true);
    expect(res.events.some((ev) => ev.eventType === 'pause')).toBe(true);
    expect(res.bars.length).toBeGreaterThanOrEqual(10);
  });

  it('Teste G — Música híbrida: detecta contraste entre seções calmas e explosivas e alterna estratégia', () => {
    const music = makeBaseMusic();
    const lyrics: Cue[] = [
      { startS: 1.0, endS: 6.5, text: 'Sozinho na noite lembrando do passado distante' },
      { startS: 9.0, endS: 14.5, text: 'Eu juro que nunca vou desistir dessa promessa' },
      { startS: 16.2, endS: 22.5, text: 'Ergue a espada e queima na batalha contra os deuses!', words: [
        { text: 'espada', startS: 17.0, endS: 17.6, source: 'lrc', confidence: 0.95 },
        { text: 'batalha', startS: 18.4, endS: 19.1, source: 'lrc', confidence: 0.95 },
      ] },
    ];
    const res = analyzeMusicUnderstanding(music, {
      lyrics,
      animeContext: { hasFights: true, hasEmotionalDrama: true },
    });

    expect(res.archetype).toBe('hybrid');
    expect(res.sectionProfiles[0]?.strategy).toBe('cinematic_breathing');
    expect(res.sectionProfiles[0]?.allowsLongBreathing).toBe(true);
    expect(res.sectionProfiles[2]?.strategy).toBe('impact_choreography');
    expect(res.events.some((ev) => ev.eventType === 'vocal_phrase' && ev.semanticMeaning?.themes.includes('combate'))).toBe(true);
    expect(res.events.some((ev) => ev.eventType === 'lyric_keyword')).toBe(true);
  });

  it('reaproveita resultado do cache determinístico por hash sem recomputar', () => {
    const cache = new CreativeAnalysisCache();
    const music = makeBaseMusic();
    const first = analyzeMusicUnderstanding(music, { assetHash: 'hash-song-1', isInstrumental: true, cache });
    const second = analyzeMusicUnderstanding(music, { assetHash: 'hash-song-1', isInstrumental: true, cache });
    expect(second).toBe(first);
    expect(cache.getStats().musicHits).toBe(1);
    expect(cache.getStats().musicMisses).toBe(1);
  });
});
