import { describe, expect, it } from 'vitest';
import { CreativeAnalysisCache } from '../src/creative-cache.js';
import type { EpisodeAnalysis } from '../src/episode.js';
import { shotKey, type EpisodeVision } from '../src/vision.js';
import { analyzeEpisodeScenes } from '../src/visual-understanding.js';

function makeSampleEpisode(): { analysis: EpisodeAnalysis; vision: EpisodeVision } {
  const analysis: EpisodeAnalysis = {
    version: 'e4',
    durationS: 120,
    shots: [
      {
        startS: 10,
        endS: 13,
        motion: 0.22,
        loud: 0.45,
        intensity: 0.48,
        brightness: 0.35,
        tags: ['fala'],
        line: 'Eu nunca vou desistir dessa promessa!',
        peakS: 11.8,
      },
      {
        startS: 13,
        endS: 15,
        motion: 0.78,
        loud: 0.82,
        intensity: 0.84,
        brightness: 0.52,
        tags: ['ação', 'impacto', 'clarão'],
        line: null,
        peakS: 13.6,
      },
      {
        startS: 15,
        endS: 18,
        motion: 0.18,
        loud: 0.38,
        intensity: 0.42,
        brightness: 0.31,
        tags: ['calma'],
        line: null,
        peakS: 16.0,
      },
    ],
    sequences: [
      { id: 's100', startS: 10, endS: 18, kind: 'luta', intensity: 0.72, peak: 0.84, shotCount: 3 },
    ],
    speech: [
      { startS: 10.2, endS: 12.7, kind: 'fala', confidence: 0.92, text: 'Eu nunca vou desistir dessa promessa!', impact: 0.78 },
    ],
    subtitles: [],
    intensityCurve: [],
    curveStepS: 1,
  };

  const vision: EpisodeVision = {
    version: 'v2',
    model: 'test-vlm',
    shots: {
      [shotKey(10)]: {
        characters: ['Akira'],
        fight: true,
        note: 'Personagem machucado e ajoelhado encarando o adversário em postura de preparação',
        emotion: 'determinação',
        action: 'preparação',
        confidence: 0.88,
        framing: 'close-up',
        faceCount: 1,
      },
      [shotKey(13)]: {
        characters: ['Akira', 'Malakor'],
        fight: true,
        note: 'Ataque de espada com contra-ataque e explosão de impacto',
        emotion: 'raiva',
        action: 'combate',
        confidence: 0.9,
        local: {
          version: 3,
          samples: 3,
          lumaGrid: Array(64).fill(0.5),
          edgeGrid: Array(16).fill(0.4),
          colorHistogram: Array(12).fill(0.25),
          dominantColors: ['#f97316', '#1e293b'],
          brightness: 0.52,
          saturation: 0.64,
          entropy: 0.71,
          edgeDensity: 0.18,
          deadFrameScore: 0.02,
          textClutterScore: 0,
          centerOfVisualMass: [0.5, 0.5],
          subjectFocus: [0.55, 0.42],
          subjectFocusConfidence: 0.82,
          temporalMotion: 0.62,
          globalShift: [0.12, 0],
          globalMotion: 0.68,
          motionEvents: [
            {
              startS: 13.1,
              endS: 14.4,
              cameraMotion: 'pan-horizontal',
              directionDeg: 10,
              speed: 0.42,
              scaleSpeed: 0.02,
              confidence: 0.84,
              subjectMotion: { directionDeg: 8, speed: 0.48, confidence: 0.82 },
              apparentScaleChange: 'none',
              abruptFramingChange: false,
            },
          ],
          motionConfidence: 0.84,
          fingerprint: 'lv3-sample1',
          sceneType: 'action',
          sceneTypeConfidence: 0.86,
        },
      },
      [shotKey(15)]: {
        characters: ['Malakor'],
        fight: true,
        note: 'Adversário recua em reação ao golpe sofrido',
        emotion: 'surpresa',
        action: 'reação',
        confidence: 0.84,
        framing: 'close-up',
        faceCount: 1,
      },
    },
  };

  return { analysis, vision };
}

describe('Visual Understanding Engine (Camada 2)', () => {
  it('atribui múltiplas classificações semânticas simultâneas, estado físico, fases coreográficas e direção', () => {
    const { analysis, vision } = makeSampleEpisode();
    const scenes = analyzeEpisodeScenes({
      assetId: 'ep1',
      assetHash: 'hash-ep1',
      sourceFile: 'ep01.mkv',
      sourceEpisode: 'Episódio 01',
      episodeIndex: 0,
      analysis,
      vision,
    });

    expect(scenes).toHaveLength(3);

    // Cena 1: machucado, ajoelhado, determinado -> resistência + superação + preparação + diálogo
    const s0 = scenes[0]!;
    expect(s0.characterState).toBe('debilitated');
    expect(s0.movement.bodyPosition).toBe('grounded_kneeling');
    expect(s0.actions).toContain('combate');
    expect(s0.actions).toContain('preparação_combate');
    expect(s0.actions).toContain('determinação');
    expect(s0.actions).toContain('superação');
    expect(s0.actions).toContain('diálogo');
    expect(s0.context.visualIntent).toBe('resistência');
    expect(s0.context.narrativePotential).toContain('superação');
    expect(s0.context.isCompleteThought).toBe(true);
    expect(s0.confidence).toBeGreaterThan(0.75);

    // Cena 2: ataque + contra-ataque + impacto com vetor left-to-right
    const s1 = scenes[1]!;
    expect(s1.actions).toContain('ataque');
    expect(s1.actions).toContain('contra_ataque');
    expect(s1.actions).toContain('impacto');
    expect(s1.movement.direction).toBe('left-to-right');
    expect(s1.context.stateChangedFromPrevious).toBe(true);

    // Cena 3: reação pós-golpe
    const s2 = scenes[2]!;
    expect(s2.actionPhase).toBe('reaction');
    expect(s2.actions).toContain('reação');
  });

  it('reaproveita SceneAnalysis entre múltiplos projetos usando o mesmo hash de arquivo', () => {
    const cache = new CreativeAnalysisCache();
    const { analysis, vision } = makeSampleEpisode();
    const projA = analyzeEpisodeScenes({
      assetId: 'asset-proj-a',
      assetHash: 'shared-mkv-hash',
      sourceFile: 'ep01.mkv',
      analysis,
      vision,
      cache,
    });
    const projB = analyzeEpisodeScenes({
      assetId: 'asset-proj-b',
      assetHash: 'shared-mkv-hash',
      sourceFile: 'ep01.mkv',
      analysis,
      vision,
      cache,
    });

    expect(projB.map((s) => s.contentKey)).toEqual(projA.map((s) => s.contentKey));
    expect(projB[0]?.assetId).toBe('asset-proj-b');
    expect(projB[0]?.semanticTags).toBe(projA[0]?.semanticTags);
    expect(cache.getStats().visualHits).toBe(1);
    expect(cache.getStats().visualMisses).toBe(1);
  });
});
