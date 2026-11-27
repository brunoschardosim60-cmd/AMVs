import { describe, expect, it } from 'vitest';
import type { SceneAnalysis } from '@amv/analysis';
import {
  advanceNarrativeMemory,
  createInitialNarrativeMemory,
  evaluateContinuityRelation,
} from '../src/continuity-engine.js';

function mockScene(partial: Partial<SceneAnalysis> & { sceneId: string; assetId: string }): SceneAnalysis {
  return {
    sceneId: partial.sceneId,
    contentKey: partial.sceneId,
    shotKey: 't100',
    assetId: partial.assetId,
    sourceFile: `${partial.assetId}.mkv`,
    sourceEpisode: partial.sourceEpisode ?? partial.assetId,
    episodeIndex: partial.episodeIndex ?? 0,
    sequenceId: partial.sequenceId ?? `${partial.assetId}#s1`,
    startTime: partial.startTime ?? 10,
    endTime: partial.endTime ?? 12.5,
    peakTime: partial.peakTime ?? 11.2,
    durationS: partial.durationS ?? 2.5,
    characters: (partial.characterNames ?? ['Akira']).map((name) => ({
      name,
      probableIdentity: name,
      confirmed: true,
      position: [0.5, 0.4],
      expression: null,
      confidence: 0.9,
    })),
    characterNames: partial.characterNames ?? ['Akira'],
    characterState: partial.characterState ?? 'strained',
    actions: partial.actions ?? ['combate'],
    actionPhase: partial.actionPhase ?? 'attack',
    emotions: partial.emotions ?? [{ emotion: 'determinação', intensity: 0.8, confidence: 0.88 }],
    semanticTags: (partial.actions ?? ['combate']).map((tag) => ({
      tag,
      score: 0.88,
      confidence: 0.86,
      evidence: 'teste',
    })),
    movement: partial.movement ?? {
      intensity: 0.7,
      direction: 'left-to-right',
      directionDeg: 5,
      bodyPosition: 'medium',
      speed: 0.5,
      confidence: 0.85,
    },
    cameraMotion: partial.cameraMotion ?? {
      type: 'pan-horizontal',
      orientation: 'profile_right',
      scaleChange: 'none',
      speed: 0.3,
      confidence: 0.8,
    },
    context: partial.context ?? {
      kind: 'combat',
      locationHint: 'arena',
      hasDialogue: false,
      dialogueText: null,
      dialogueKind: null,
      dialogueImpact: 0,
      dialogueStartS: null,
      dialogueEndS: null,
      isCompleteThought: true,
      hasConfrontation: true,
      emotionalReaction: false,
      stateChangedFromPrevious: false,
      visualIntent: 'progressão visual',
      narrativePotential: [],
      episodeProgress: 0.5,
    },
    visualDescription: partial.visualDescription ?? 'Cena de teste',
    intensity: partial.intensity ?? 0.75,
    brightness: partial.brightness ?? 0.48,
    dominantColors: ['#f97316'],
    fingerprint: 'fp1',
    deadFrameScore: 0,
    textClutterScore: 0,
    favorite: false,
    excluded: false,
    confidence: partial.confidence ?? 0.88,
  };
}

describe('Continuity & Coherence Engine (Camada 5)', () => {
  it('Teste D — Combate coerente entre episódios diferentes: encadeia preparação (Ep 1) → ataque L→R (Ep 2) → impacto push-in (Ep 3) → reação (Ep 1)', () => {
    const prepEp1 = mockScene({
      sceneId: 'ep1@10',
      assetId: 'ep1',
      episodeIndex: 0,
      characterNames: ['Akira'],
      actionPhase: 'preparation',
      actions: ['combate', 'preparação_combate', 'determinação'],
      movement: { intensity: 0.3, direction: 'left-to-right', directionDeg: 8, bodyPosition: 'close', speed: 0.2, confidence: 0.85 },
    });
    const attackEp2 = mockScene({
      sceneId: 'ep2@44',
      assetId: 'ep2',
      episodeIndex: 1,
      characterNames: ['Akira'],
      actionPhase: 'attack',
      actions: ['combate', 'ataque'],
      movement: { intensity: 0.82, direction: 'left-to-right', directionDeg: 4, bodyPosition: 'medium', speed: 0.68, confidence: 0.9 },
    });
    const impactEp3 = mockScene({
      sceneId: 'ep3@78',
      assetId: 'ep3',
      episodeIndex: 2,
      characterNames: ['Akira', 'Malakor'],
      actionPhase: 'impact',
      actions: ['combate', 'impacto'],
      movement: { intensity: 0.92, direction: 'push-in', directionDeg: null, bodyPosition: 'close', speed: 0.75, confidence: 0.9 },
    });
    const reactionEp1 = mockScene({
      sceneId: 'ep1@52',
      assetId: 'ep1',
      episodeIndex: 0,
      characterNames: ['Malakor'],
      actionPhase: 'reaction',
      actions: ['combate', 'reação'],
      movement: { intensity: 0.35, direction: 'left-to-right', directionDeg: 12, bodyPosition: 'close', speed: 0.25, confidence: 0.85 },
    });

    let mem = createInitialNarrativeMemory();
    mem = advanceNarrativeMemory(mem, prepEp1);
    const rel1 = evaluateContinuityRelation(prepEp1, attackEp2, mem);
    mem = advanceNarrativeMemory(mem, attackEp2);
    const rel2 = evaluateContinuityRelation(attackEp2, impactEp3, mem);
    mem = advanceNarrativeMemory(mem, impactEp3);
    const rel3 = evaluateContinuityRelation(impactEp3, reactionEp1, mem);

    expect(rel1.crossEpisode).toBe(true);
    expect(rel1.continuityScore).toBeGreaterThanOrEqual(82);
    expect(rel2.continuityScore).toBeGreaterThanOrEqual(82);
    expect(rel3.continuityScore).toBeGreaterThanOrEqual(72);
    expect(rel1.rejected).toBe(false);
    expect(rel2.rejected).toBe(false);
    expect(mem.combatChainLength).toBe(3);
  });

  it('Teste E — Combate incoerente: penaliza fortemente golpes desconexos com inversão de eixo e mistura aleatória de lutas', () => {
    const impactFightA = mockScene({
      sceneId: 'ep1@20',
      assetId: 'ep1',
      sequenceId: 'ep1#fightA',
      characterNames: ['Akira'],
      actionPhase: 'impact',
      actions: ['combate', 'impacto'],
      movement: { intensity: 0.9, direction: 'left-to-right', directionDeg: 0, bodyPosition: 'medium', speed: 0.7, confidence: 0.9 },
    });
    const randomImpactFightB = mockScene({
      sceneId: 'ep2@90',
      assetId: 'ep2',
      sequenceId: 'ep2#fightZ',
      characterNames: ['FiguranteX'],
      actionPhase: 'impact',
      actions: ['combate', 'impacto'],
      movement: { intensity: 0.88, direction: 'right-to-left', directionDeg: 180, bodyPosition: 'medium', speed: 0.72, confidence: 0.9 },
    });

    const incoherent = evaluateContinuityRelation(impactFightA, randomImpactFightB, createInitialNarrativeMemory());
    expect(incoherent.continuityScore).toBeLessThan(35);
    expect(incoherent.relationKind).toBe('jarring_jump');
    expect(incoherent.rejected).toBe(true);
  });

  it('rejeita chicote emocional abrupto (tristeza → luta desconexa → felicidade) e valoriza ponte por memória → determinação', () => {
    const crying = mockScene({
      sceneId: 'ep1@5',
      assetId: 'ep1',
      characterNames: ['Yuna'],
      actionPhase: 'reaction',
      actions: ['tristeza'],
      emotions: [{ emotion: 'tristeza', intensity: 0.9, confidence: 0.9 }],
    });
    const suddenHappy = mockScene({
      sceneId: 'ep1@25',
      assetId: 'ep1',
      characterNames: ['Yuna'],
      actionPhase: 'dialogue',
      actions: ['felicidade'],
      emotions: [{ emotion: 'alegria', intensity: 0.9, confidence: 0.9 }],
    });
    const memoryBridge = mockScene({
      sceneId: 'ep1@12',
      assetId: 'ep1',
      characterNames: ['Yuna'],
      actionPhase: 'contemplation',
      actions: ['memória', 'tristeza'],
      emotions: [{ emotion: 'tristeza', intensity: 0.65, confidence: 0.85 }],
    });
    const determination = mockScene({
      sceneId: 'ep2@18',
      assetId: 'ep2',
      characterNames: ['Yuna'],
      actionPhase: 'preparation',
      actions: ['determinação', 'superação'],
      emotions: [{ emotion: 'determinação', intensity: 0.85, confidence: 0.9 }],
    });

    const whiplash = evaluateContinuityRelation(crying, suddenHappy);
    const bridge1 = evaluateContinuityRelation(crying, memoryBridge, undefined, { allowFlashback: true });
    const bridge2 = evaluateContinuityRelation(memoryBridge, determination);

    expect(whiplash.continuityScore).toBeLessThan(40);
    expect(whiplash.rejected).toBe(true);
    expect(bridge1.continuityScore).toBeGreaterThan(75);
    expect(bridge2.continuityScore).toBeGreaterThan(78);
  });
});
