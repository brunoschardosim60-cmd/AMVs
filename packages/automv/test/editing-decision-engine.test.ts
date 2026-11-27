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
  explainEditorialDecision,
  findAlternativeScenesForPhrase,
  solveGlobalEditorialDecisions,
} from '../src/editing-decision-engine.js';
import { buildCreativeDirectionPlan } from '../src/narrative-director.js';

function createEmotionalAndSpeechFixture() {
  const epAnalysis: EpisodeAnalysis = {
    version: 'e4',
    durationS: 80,
    shots: [
      { startS: 4, endS: 10, motion: 0.1, loud: 0.25, intensity: 0.22, brightness: 0.55, tags: ['calma'], line: null, peakS: 6.5 },
      { startS: 12, endS: 17, motion: 0.14, loud: 0.52, intensity: 0.44, brightness: 0.42, tags: ['fala'], line: 'Mesmo que o mundo esqueça, eu vou guardar essa promessa até o fim.', peakS: 14.5 },
      { startS: 25, endS: 30, motion: 0.12, loud: 0.2, intensity: 0.28, brightness: 0.48, tags: ['calma'], line: null, peakS: 27.5 },
      { startS: 40, endS: 44, motion: 0.82, loud: 0.88, intensity: 0.9, brightness: 0.62, tags: ['ação', 'impacto'], line: null, peakS: 41.2 },
    ],
    sequences: [
      { id: 's40', startS: 4, endS: 30, kind: 'calma', intensity: 0.32, peak: 0.44, shotCount: 3 },
      { id: 's400', startS: 40, endS: 44, kind: 'luta', intensity: 0.9, peak: 0.9, shotCount: 1 },
    ],
    speech: [
      {
        startS: 12.2,
        endS: 16.4,
        kind: 'fala',
        confidence: 0.94,
        text: 'Mesmo que o mundo esqueça, eu vou guardar essa promessa até o fim.',
        impact: 0.86,
      },
    ],
    subtitles: [],
    intensityCurve: [],
    curveStepS: 1,
  };

  const vision: EpisodeVision = {
    version: 'v2',
    model: 'test-vlm',
    shots: {
      [shotKey(4)]: {
        characters: ['Hana'],
        fight: false,
        note: 'Personagem olhando o horizonte ao pôr do sol em silêncio contemplativo',
        emotion: 'tristeza',
        action: 'contemplação',
        confidence: 0.9,
        framing: 'wide',
      },
      [shotKey(12)]: {
        characters: ['Hana'],
        fight: false,
        note: 'Close-up emocional proferindo juramento e promessa de memória',
        emotion: 'determinação',
        action: 'diálogo',
        confidence: 0.92,
        framing: 'close-up',
      },
      [shotKey(25)]: {
        characters: ['Hana'],
        fight: false,
        note: 'Despedida suave caminhando para longe sob luz dourada',
        emotion: 'calma',
        action: 'ambiente',
        confidence: 0.88,
        framing: 'wide',
      },
      [shotKey(40)]: {
        characters: ['Hana'],
        fight: true,
        note: 'Golpe de espada explosivo rompendo as chamas',
        emotion: 'raiva',
        action: 'combate',
        confidence: 0.91,
        framing: 'medium',
      },
    },
  };

  const scenes = analyzeEpisodeScenes({
    assetId: 'ep1',
    sourceFile: 'ep1.mkv',
    sourceEpisode: 'Episódio 01',
    analysis: epAnalysis,
    vision,
  });

  const music: MusicAnalysis = {
    version: 'm6',
    durationS: 24,
    bpm: 96,
    bpmConfidence: 0.88,
    beats: Array.from({ length: 38 }, (_, i) => Number((i * (60 / 96)).toFixed(3))),
    downbeats: Array.from({ length: 10 }, (_, i) => Number((i * 4 * (60 / 96)).toFixed(3))),
    energy: Array.from({ length: 96 }, (_, i) => (i * 0.25 < 16 ? 0.26 : 0.82)),
    energyStepS: 0.25,
    sections: [
      { startS: 0, endS: 8, label: 'intro', energy: 0.24 },
      { startS: 8, endS: 16, label: 'ponte', energy: 0.28 },
      { startS: 16, endS: 24, label: 'drop', energy: 0.84 },
    ],
    drops: [16],
    intensity: 54,
    loudnessDb: -13,
  };

  const lyrics: Cue[] = [
    { startS: 1.0, endS: 6.5, text: 'Sozinha olhando o céu distante em despedida' },
    { startS: 16.2, endS: 22.0, text: 'A espada em chamas desperta na batalha!' },
  ];

  const mu = analyzeMusicUnderstanding(music, {
    lyrics,
    animeContext: { hasFights: true, hasEmotionalDrama: true },
  });

  return { scenes, mu };
}

describe('Global Editing Decision Engine & Vocal Interaction (Camada 6)', () => {
  it('Teste H — Continuidade de fala: preserva fala importante completa antes do drop com ducking contextual e sem cortar no meio da ideia', () => {
    const { scenes, mu } = createEmotionalAndSpeechFixture();
    const plan = buildCreativeDirectionPlan({
      scenes,
      musicUnderstanding: mu,
      musicRange: [0, 24],
      dropTimelineS: 16,
      style: 'superacao',
      organizationMode: 'free',
      useSpeech: true,
    });

    const solution = solveGlobalEditorialDecisions({
      plan,
      scenes,
      musicUnderstanding: mu,
    });

    expect(solution.audioMap.essentialSpeechCount).toBeGreaterThanOrEqual(1);
    expect(solution.audioMap.interruptedSpeechCount).toBe(0);
    const essentialSpeech = solution.audioMap.events.find((e) => e.role === 'character_speech_essential')!;
    expect(essentialSpeech.preservesCompleteIdea).toBe(true);
    expect(essentialSpeech.endTime - essentialSpeech.startTime).toBeGreaterThanOrEqual(4.1);
    expect(essentialSpeech.recommendedMusicDuckDb).toBeLessThan(0);
  });

  it('Teste J — Respiração cinematográfica: consolida slots curtos em trechos emocionais/contemplativos em vez de cortar mecanicamente a cada batida', () => {
    const { scenes, mu } = createEmotionalAndSpeechFixture();
    const plan = buildCreativeDirectionPlan({
      scenes,
      musicUnderstanding: mu,
      musicRange: [0, 24],
      dropTimelineS: 16,
      style: 'emocional',
      organizationMode: 'free',
    });

    // Passa slots mecânicos curtos de 1s na abertura/ponte emocional: o motor deve consolidá-los em breathing_hold!
    const mechanicalRawSlots = Array.from({ length: 24 }, (_, i) => ({
      startS: i,
      endS: i + 1,
      energy: i < 16 ? 0.25 : 0.84,
      isDrop: i === 16,
    }));

    const solution = solveGlobalEditorialDecisions({
      plan,
      scenes,
      musicUnderstanding: mu,
      rawSlots: mechanicalRawSlots,
    });

    const breathingDecisions = solution.decisions.filter((d) => d.isBreathingHold && d.cutType === 'breathing_hold');
    expect(breathingDecisions.length).toBeGreaterThanOrEqual(2);
    expect(breathingDecisions[0]!.endTime - breathingDecisions[0]!.startTime).toBeGreaterThanOrEqual(3);
    // Já no drop (t=16s), preserva o impacto rítmico e escolhe a cena de combate!
    const dropDecision = solution.decisions.find((d) => Math.abs(d.startTime - 16) < 0.05)!;
    expect(dropDecision.cutType).toBe('sonic_impact');
    expect(dropDecision.selectedSceneId).toBe('ep1@40');

    // Testa também as consultas interativas de justificativa e substituição por frase
    const explanation = explainEditorialDecision(dropDecision, scenes.find((s) => s.sceneId === dropDecision.selectedSceneId));
    expect(explanation).toMatch(/Relação musical/i);
    expect(explanation).toMatch(/alternativas descartadas/i);

    const alternativesForSword = findAlternativeScenesForPhrase({
      phraseText: 'Minha espada corta nas chamas da guerra',
      scenes,
    });
    expect(alternativesForSword[0]?.scene.sceneId).toBe('ep1@40');
  });
});
