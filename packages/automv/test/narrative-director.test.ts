import { describe, expect, it } from 'vitest';
import {
  analyzeEpisodeScenes,
  analyzeMusicUnderstanding,
  shotKey,
  type EpisodeAnalysis,
  type EpisodeVision,
  type MusicAnalysis,
} from '@amv/analysis';
import { buildCreativeDirectionPlan } from '../src/narrative-director.js';

function makeEpisode(
  assetId: string,
  episodeName: string,
  episodeIndex: number,
  isFinaleClimax: boolean,
) {
  const analysis: EpisodeAnalysis = {
    version: 'e4',
    durationS: 100,
    shots: [
      { startS: 8, endS: 12, motion: 0.16, loud: 0.3, intensity: 0.32, brightness: 0.45, tags: ['calma', 'fala'], line: 'Lembro da promessa na infância', peakS: 9.5 },
      { startS: 42, endS: 46, motion: 0.62, loud: 0.65, intensity: 0.68, brightness: 0.48, tags: ['ação'], line: null, peakS: 43.8 },
      {
        startS: 84,
        endS: 89,
        motion: isFinaleClimax ? 0.88 : 0.4,
        loud: isFinaleClimax ? 0.92 : 0.45,
        intensity: isFinaleClimax ? 0.94 : 0.5,
        brightness: 0.58,
        tags: isFinaleClimax ? ['ação', 'impacto', 'clarão'] : ['fala'],
        line: isFinaleClimax ? 'Esse é o despertar final!' : 'Ainda não acabou.',
        peakS: 86.1,
      },
    ],
    sequences: [
      { id: 's420', startS: 42, endS: 89, kind: 'luta', intensity: isFinaleClimax ? 0.85 : 0.6, peak: isFinaleClimax ? 0.94 : 0.68, shotCount: 2 },
    ],
    speech: [
      { startS: 8.2, endS: 11.6, kind: 'fala', confidence: 0.9, text: 'Lembro da promessa na infância', impact: 0.62 },
      { startS: 84.3, endS: 88.2, kind: isFinaleClimax ? 'grito' : 'fala', confidence: 0.92, text: isFinaleClimax ? 'Esse é o despertar final!' : 'Ainda não acabou.', impact: isFinaleClimax ? 0.9 : 0.55 },
    ],
    subtitles: [],
    intensityCurve: [],
    curveStepS: 1,
  };

  const vision: EpisodeVision = {
    version: 'v2',
    model: 'test-vlm',
    shots: {
      [shotKey(8)]: {
        characters: ['Kael'],
        fight: false,
        note: 'Flashback de infância lembrando a promessa do passado',
        emotion: 'tristeza',
        action: 'diálogo',
        confidence: 0.88,
        framing: 'close-up',
      },
      [shotKey(42)]: {
        characters: ['Kael', 'Vorg'],
        fight: true,
        note: 'Preparação e ataque inicial de espada na arena',
        emotion: 'determinação',
        action: 'combate',
        confidence: 0.86,
        framing: 'medium',
      },
      [shotKey(84)]: {
        characters: ['Kael', 'Vorg'],
        fight: isFinaleClimax,
        note: isFinaleClimax
          ? 'Revelação e transformação explosiva no fim do episódio 3'
          : 'Confronto tenso encerrando o episódio',
        emotion: isFinaleClimax ? 'determinação' : 'surpresa',
        action: isFinaleClimax ? 'combate' : 'tensão',
        confidence: 0.92,
        framing: 'close-up',
      },
    },
  };

  return analyzeEpisodeScenes({
    assetId,
    sourceFile: `${assetId}.mkv`,
    sourceEpisode: episodeName,
    episodeIndex,
    analysis,
    vision,
  });
}

describe('Narrative Director (Camada 4)', () => {
  it('Teste A — Narrativa não linear: com 3 episódios permite abrir com clímax tardio do Ep 3, voltar à origem e construir até o clímax final', () => {
    const scenes = [
      ...makeEpisode('ep1', 'Episódio 01', 0, false),
      ...makeEpisode('ep2', 'Episódio 02', 1, false),
      ...makeEpisode('ep3', 'Episódio 03', 2, true),
    ];

    const music: MusicAnalysis = {
      version: 'm6',
      durationS: 36,
      bpm: 136,
      bpmConfidence: 0.92,
      beats: Array.from({ length: 80 }, (_, i) => i * (60 / 136)),
      downbeats: Array.from({ length: 20 }, (_, i) => i * 4 * (60 / 136)),
      energy: Array(144).fill(0.65),
      energyStepS: 0.25,
      sections: [
        { startS: 0, endS: 8, label: 'intro', energy: 0.42 },
        { startS: 8, endS: 20, label: 'verso', energy: 0.54 },
        { startS: 20, endS: 30, label: 'drop', energy: 0.91 },
        { startS: 30, endS: 36, label: 'final', energy: 0.28 },
      ],
      drops: [20],
      intensity: 79,
      loudnessDb: -11,
    };

    const mu = analyzeMusicUnderstanding(music, {
      animeContext: { hasFights: true, hasEmotionalDrama: true },
    });

    const plan = buildCreativeDirectionPlan({
      scenes,
      musicUnderstanding: mu,
      musicRange: [0, 36],
      dropTimelineS: 20,
      style: 'superacao',
      organizationMode: 'free',
      useSpeech: true,
    });

    expect(plan.narrativeModel).toBe('climax_opening');
    expect(plan.openingSelection).not.toBeNull();
    // O gancho de abertura vem de um episódio posterior ou terço final (não começa mecanicamente no t=8 do Ep 1)
    expect(plan.openingSelection!.isLateEpisodeHook).toBe(true);
    // O 2º beat volta à origem (origin_flashback) antes do apex_climax no drop
    expect(plan.narrativeBeats[0]?.nonLinearFunction).toBe('cold_open_climax');
    expect(plan.narrativeBeats[1]?.nonLinearFunction).toBe('origin_flashback');
    expect(plan.narrativeBeats.some((b) => b.nonLinearFunction === 'apex_climax')).toBe(true);
    expect(plan.narrativeBeats.at(-1)?.nonLinearFunction).toBe('intentional_ending');
    expect(plan.preservedDialogues.length).toBeGreaterThan(0);
    expect(plan.openingSelection!.alternatives.length).toBeGreaterThan(0);
    expect(plan.climaxSelection!.alternatives.length).toBeGreaterThan(0);
  });
});
