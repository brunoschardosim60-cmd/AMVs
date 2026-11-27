import { describe, expect, it } from 'vitest';
import {
  analyzeEpisodeScenes,
  analyzeMusicUnderstanding,
  shotKey,
  type Cue,
  type EpisodeAnalysis,
  type EpisodeVision,
  type MusicAnalysis,
} from '@amv/analysis';
import {
  evaluateSemanticAlignment,
  rankScenesForMusicEvent,
} from '../src/semantic-alignment.js';

function buildFixture() {
  const epAnalysis: EpisodeAnalysis = {
    version: 'e4',
    durationS: 60,
    shots: [
      { startS: 2, endS: 5.5, motion: 0.14, loud: 0.2, intensity: 0.25, brightness: 0.3, tags: ['calma'], line: null, peakS: 3.5 },
      { startS: 10, endS: 14, motion: 0.28, loud: 0.55, intensity: 0.62, brightness: 0.42, tags: ['fala'], line: 'Mesmo assim não vou cair!', peakS: 12.2 },
      { startS: 20, endS: 23.5, motion: 0.85, loud: 0.9, intensity: 0.91, brightness: 0.64, tags: ['ação', 'impacto', 'clarão'], line: null, peakS: 21.4 },
      { startS: 30, endS: 34, motion: 0.16, loud: 0.3, intensity: 0.34, brightness: 0.24, tags: ['calma'], line: 'Perdemos tudo...', peakS: 31.8 },
    ],
    sequences: [
      { id: 's100', startS: 10, endS: 23.5, kind: 'luta', intensity: 0.8, peak: 0.91, shotCount: 2 },
    ],
    speech: [
      { startS: 10.2, endS: 13.5, kind: 'fala', confidence: 0.9, text: 'Mesmo assim não vou cair!', impact: 0.75 },
      { startS: 30.4, endS: 33.2, kind: 'fala', confidence: 0.88, text: 'Perdemos tudo...', impact: 0.55 },
    ],
    subtitles: [],
    intensityCurve: [],
    curveStepS: 1,
  };

  const vision: EpisodeVision = {
    version: 'v2',
    model: 'test-vlm',
    shots: {
      [shotKey(2)]: {
        characters: ['Riku'],
        fight: false,
        note: 'Paisagem calma de fim de tarde sem confronto',
        emotion: 'calma',
        action: 'ambiente',
        confidence: 0.85,
        framing: 'wide',
      },
      [shotKey(10)]: {
        characters: ['Riku'],
        fight: true,
        note: 'Personagem ferido e ajoelhado se erguendo com olhar determinado',
        emotion: 'determinação',
        action: 'preparação',
        confidence: 0.9,
        framing: 'close-up',
      },
      [shotKey(20)]: {
        characters: ['Riku'],
        fight: true,
        note: 'Golpe de espada em chamas cortando o inimigo com explosão de fogo',
        emotion: 'raiva',
        action: 'combate',
        confidence: 0.92,
        framing: 'medium',
      },
      [shotKey(30)]: {
        characters: ['Riku'],
        fight: false,
        note: 'Herói caído no chão derrotado sob chuva escura',
        emotion: 'tristeza',
        action: 'reação',
        confidence: 0.89,
        framing: 'close-up',
      },
    },
  };

  const scenes = analyzeEpisodeScenes({
    assetId: 'ep1',
    sourceFile: 'ep1.mkv',
    analysis: epAnalysis,
    vision,
  });

  const music: MusicAnalysis = {
    version: 'm6',
    durationS: 30,
    bpm: 130,
    bpmConfidence: 0.9,
    beats: Array.from({ length: 60 }, (_, i) => i * (60 / 130)),
    downbeats: Array.from({ length: 15 }, (_, i) => i * 4 * (60 / 130)),
    energy: Array(120).fill(0.7),
    energyStepS: 0.25,
    sections: [{ startS: 0, endS: 30, label: 'refrão', energy: 0.76 }],
    drops: [12],
    intensity: 78,
    loudnessDb: -11,
  };

  const lyrics: Cue[] = [
    {
      startS: 4,
      endS: 7,
      text: 'Minha espada em chamas corta a escuridão',
      words: [{ text: 'espada', startS: 4.8, endS: 5.3, source: 'lrc', confidence: 0.96 }],
    },
    {
      startS: 8,
      endS: 11.5,
      text: 'Mesmo sangrando eu vou continuar de pé',
    },
    {
      startS: 14,
      endS: 17.5,
      text: 'A vitória e a glória brilham no topo da coroa',
    },
  ];

  const mu = analyzeMusicUnderstanding(music, {
    lyrics,
    animeContext: { hasFights: true, hasEmotionalDrama: true },
  });

  return { scenes, mu };
}

describe('Semantic Alignment Engine (Camada 3)', () => {
  it('Teste B — Correspondência letra-imagem: prioriza cena literal/semântica sobre cena neutra e alinha palavra-chave', () => {
    const { scenes, mu } = buildFixture();
    const swordPhrase = mu.events.find((e) => e.eventType === 'vocal_phrase' && e.lyrics?.includes('espada em chamas'))!;
    const swordKeyword = mu.events.find((e) => e.eventType === 'lyric_keyword' && e.lyrics === 'espada')!;

    const ranked = rankScenesForMusicEvent(swordPhrase, scenes, { keywordEvent: swordKeyword });
    expect(ranked[0]?.sceneId).toBe('ep1@20');
    expect(ranked[0]?.alignmentType).toBe('literal');
    expect(ranked[0]?.phraseSync.mode).toBe('impact_on_keyword');
    expect(ranked[0]!.score).toBeGreaterThan(ranked.find((r) => r.sceneId === 'ep1@2')!.score + 20);
  });

  it('Teste C — Correspondência contextual: conecta frase de resistência a personagem ferido/determinado sem palavra idêntica', () => {
    const { scenes, mu } = buildFixture();
    const resiliencePhrase = mu.events.find((e) => e.eventType === 'vocal_phrase' && e.lyrics?.includes('continuar de pé'))!;

    const alignment = evaluateSemanticAlignment(resiliencePhrase, scenes[1]!);
    const neutralAlignment = evaluateSemanticAlignment(resiliencePhrase, scenes[0]!);

    expect(['contextual', 'metaphorical']).toContain(alignment.alignmentType);
    expect(alignment.score).toBeGreaterThan(80);
    expect(alignment.score).toBeGreaterThan(neutralAlignment.score + 18);
    expect(alignment.explanation).toMatch(/resistência|superação|determinação/i);
  });

  it('Teste I — Contraste intencional: reconhece contraponto dramático (letra de vitória sobre cena de derrota) sem tratá-lo como erro', () => {
    const { scenes, mu } = buildFixture();
    const victoryPhrase = mu.events.find((e) => e.eventType === 'vocal_phrase' && e.lyrics?.includes('vitória e a glória'))!;
    const defeatScene = scenes[3]!;

    const contrast = evaluateSemanticAlignment(victoryPhrase, defeatScene, {
      allowIntentionalContrast: true,
    });

    expect(contrast.alignmentType).toBe('intentional_contrast');
    expect(contrast.score).toBeGreaterThanOrEqual(75);
    expect(contrast.explanation).toMatch(/Contraste dramático intencional/i);
  });
});
