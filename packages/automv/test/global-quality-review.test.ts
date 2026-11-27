import { describe, expect, it } from 'vitest';
import {
  analyzeEpisodeScenes,
  analyzeMusicUnderstanding,
  shotKey,
  type EpisodeAnalysis,
  type EpisodeVision,
  type MusicAnalysis,
} from '@amv/analysis';
import type { EditorialDecision } from '../src/editing-decision-engine.js';
import { solveGlobalEditorialDecisions } from '../src/editing-decision-engine.js';
import { evaluateGlobalAmvQuality } from '../src/global-quality-review.js';
import { buildCreativeDirectionPlan } from '../src/narrative-director.js';
import { evaluateSemanticAlignment } from '../src/semantic-alignment.js';

describe('Independent Global Quality Review (Camada 7)', () => {
  it('Teste K — Qualidade global: reprova montagem com bons clipes individuais que formam uma sequência global confusa e aprova montagem coerente', () => {
    const epAnalysis: EpisodeAnalysis = {
      version: 'e4',
      durationS: 90,
      shots: [
        { startS: 5, endS: 9, motion: 0.25, loud: 0.4, intensity: 0.48, brightness: 0.45, tags: ['fala'], line: 'Chegou a hora.', peakS: 7 },
        { startS: 15, endS: 19, motion: 0.78, loud: 0.8, intensity: 0.85, brightness: 0.5, tags: ['ação', 'impacto'], line: null, peakS: 16.5 },
        { startS: 25, endS: 29, motion: 0.84, loud: 0.9, intensity: 0.92, brightness: 0.55, tags: ['ação', 'impacto'], line: null, peakS: 26.2 },
        { startS: 35, endS: 40, motion: 0.2, loud: 0.35, intensity: 0.42, brightness: 0.52, tags: ['calma'], line: null, peakS: 37 },
        // Clipes individuais fortes mas de lutas/personagens/emoções totalmente desconexos:
        { startS: 50, endS: 54, motion: 0.82, loud: 0.85, intensity: 0.88, brightness: 0.5, tags: ['ação', 'impacto'], line: null, peakS: 51.5 },
        { startS: 62, endS: 66, motion: 0.15, loud: 0.25, intensity: 0.8, brightness: 0.65, tags: ['calma'], line: null, peakS: 63.5 },
        { startS: 74, endS: 78, motion: 0.86, loud: 0.88, intensity: 0.9, brightness: 0.48, tags: ['ação', 'impacto'], line: null, peakS: 75.2 },
      ],
      sequences: [
        { id: 's50', startS: 5, endS: 40, kind: 'luta', intensity: 0.82, peak: 0.92, shotCount: 4 },
        { id: 's500', startS: 50, endS: 54, kind: 'luta', intensity: 0.88, peak: 0.88, shotCount: 1 },
        { id: 's740', startS: 74, endS: 78, kind: 'luta', intensity: 0.9, peak: 0.9, shotCount: 1 },
      ],
      speech: [{ startS: 5.2, endS: 8.4, kind: 'fala', confidence: 0.9, text: 'Chegou a hora.', impact: 0.7 }],
      subtitles: [],
      intensityCurve: [],
      curveStepS: 1,
    };

    const vision: EpisodeVision = {
      version: 'v2',
      model: 'test-vlm',
      shots: {
        [shotKey(5)]: { characters: ['Ren'], fight: true, note: 'Preparação concentrada encarando o rival', emotion: 'determinação', action: 'preparação', confidence: 0.9, framing: 'close-up' },
        [shotKey(15)]: { characters: ['Ren'], fight: true, note: 'Ataque avançando da esquerda para a direita', emotion: 'determinação', action: 'combate', confidence: 0.9, framing: 'medium', local: { version: 3, samples: 2, lumaGrid: Array(64).fill(0.5), edgeGrid: Array(16).fill(0.4), colorHistogram: Array(12).fill(0.25), brightness: 0.5, saturation: 0.5, entropy: 0.6, edgeDensity: 0.15, centerOfVisualMass: [0.5, 0.5], temporalMotion: 0.6, globalShift: [0.1, 0], globalMotion: 0.6, motionEvents: [{ startS: 15.2, endS: 18, cameraMotion: 'pan-horizontal', directionDeg: 5, speed: 0.5, scaleSpeed: 0, confidence: 0.85, subjectMotion: { directionDeg: 5, speed: 0.55, confidence: 0.85 }, apparentScaleChange: 'none', abruptFramingChange: false }], motionConfidence: 0.85, fingerprint: 'fp-a', sceneType: 'action', sceneTypeConfidence: 0.85 } },
        [shotKey(25)]: { characters: ['Ren', 'Kuro'], fight: true, note: 'Impacto direto com explosão', emotion: 'raiva', action: 'combate', confidence: 0.92, framing: 'close-up', local: { version: 3, samples: 2, lumaGrid: Array(64).fill(0.5), edgeGrid: Array(16).fill(0.4), colorHistogram: Array(12).fill(0.25), brightness: 0.55, saturation: 0.6, entropy: 0.7, edgeDensity: 0.2, centerOfVisualMass: [0.5, 0.5], temporalMotion: 0.7, globalShift: [0.1, 0], globalMotion: 0.7, motionEvents: [{ startS: 25.2, endS: 28, cameraMotion: 'zoom-in', directionDeg: null, speed: 0.4, scaleSpeed: 0.2, confidence: 0.88, subjectMotion: { directionDeg: null, speed: 0.4, confidence: 0.8 }, apparentScaleChange: 'in', abruptFramingChange: false }], motionConfidence: 0.88, fingerprint: 'fp-b', sceneType: 'action', sceneTypeConfidence: 0.9 } },
        [shotKey(35)]: { characters: ['Ren'], fight: false, note: 'Olhar vitorioso estabilizado após a luta', emotion: 'calma', action: 'reação', confidence: 0.88, framing: 'close-up' },
        [shotKey(50)]: { characters: ['EstranhoB'], fight: true, note: 'Impacto desconexo da direita para a esquerda', emotion: 'raiva', action: 'combate', confidence: 0.9, local: { version: 3, samples: 2, lumaGrid: Array(64).fill(0.5), edgeGrid: Array(16).fill(0.4), colorHistogram: Array(12).fill(0.25), brightness: 0.5, saturation: 0.5, entropy: 0.6, edgeDensity: 0.15, centerOfVisualMass: [0.5, 0.5], temporalMotion: 0.6, globalShift: [-0.1, 0], globalMotion: 0.6, motionEvents: [{ startS: 50.2, endS: 53, cameraMotion: 'pan-horizontal', directionDeg: 180, speed: 0.5, scaleSpeed: 0, confidence: 0.85, subjectMotion: { directionDeg: 180, speed: 0.55, confidence: 0.85 }, apparentScaleChange: 'none', abruptFramingChange: false }], motionConfidence: 0.85, fingerprint: 'fp-c', sceneType: 'action', sceneTypeConfidence: 0.85 } },
        [shotKey(62)]: { characters: ['EstranhoC'], fight: false, note: 'Chorando de tristeza profunda', emotion: 'tristeza', action: 'reação', confidence: 0.9 },
        [shotKey(74)]: { characters: ['EstranhoD'], fight: true, note: 'Sorriso feliz em festa com explosão', emotion: 'alegria', action: 'outro', confidence: 0.9 },
      },
    };

    const scenes = analyzeEpisodeScenes({ assetId: 'ep1', sourceFile: 'ep1.mkv', analysis: epAnalysis, vision });
    const music: MusicAnalysis = {
      version: 'm6',
      durationS: 16,
      bpm: 120,
      bpmConfidence: 0.9,
      beats: Array.from({ length: 32 }, (_, i) => i * 0.5),
      downbeats: [0, 2, 4, 6, 8, 10, 12, 14],
      energy: Array.from({ length: 64 }, (_, i) => (i * 0.25 < 8 ? 0.45 : i * 0.25 < 12 ? 0.9 : 0.3)),
      energyStepS: 0.25,
      sections: [
        { startS: 0, endS: 4, label: 'intro', energy: 0.4 },
        { startS: 4, endS: 8, label: 'pré-refrão', energy: 0.55 },
        { startS: 8, endS: 12, label: 'drop', energy: 0.9 },
        { startS: 12, endS: 16, label: 'final', energy: 0.3 },
      ],
      drops: [8],
      intensity: 75,
      loudnessDb: -12,
    };
    const mu = analyzeMusicUnderstanding(music, { isInstrumental: true });
    const plan = buildCreativeDirectionPlan({
      scenes,
      musicUnderstanding: mu,
      musicRange: [0, 16],
      dropTimelineS: 8,
      style: 'hype',
      organizationMode: 'free',
    });

    // 1) Montagem coerente gerada pelo motor global
    const coherent = solveGlobalEditorialDecisions({
      plan,
      scenes: scenes.slice(0, 4),
      musicUnderstanding: mu,
      rawSlots: [
        { startS: 0, endS: 4, energy: 0.4 },
        { startS: 4, endS: 8, energy: 0.55 },
        { startS: 8, endS: 12, energy: 0.9, isDrop: true },
        { startS: 12, endS: 16, energy: 0.3 },
      ],
    });
    const coherentReport = evaluateGlobalAmvQuality({
      decisions: coherent.decisions,
      scenes,
      plan,
      musicUnderstanding: mu,
      audioMap: coherent.audioMap,
    });

    // 2) Montagem artificialmente confusa usando clipes individualmente intensos (impacto L->R -> impacto R->L estranho -> choro -> sorriso)
    const chaoticSceneOrder = [scenes[2]!, scenes[4]!, scenes[5]!, scenes[6]!];
    const chaoticDecisions: EditorialDecision[] = chaoticSceneOrder.map((sc, idx) => ({
      slotIndex: idx,
      selectedSceneId: sc.sceneId,
      episodeName: sc.sourceEpisode,
      startTime: idx * 4,
      endTime: idx === 3 ? 12.4 : (idx + 1) * 4, // encerramento curto abrupto (0.4s)
      sourceStartTime: sc.startTime,
      sourceEndTime: sc.endTime,
      cutType: 'on_beat',
      isBreathingHold: false,
      lockedByUser: false,
      reason: 'teste caótico',
      musicalRelationship: 'teste',
      narrativeRelationship: 'teste',
      semanticAlignment: evaluateSemanticAlignment(mu.events[0]!, sc),
      continuityWithPrevious: null,
      alternatives: [],
      coherenceRisks: [],
      score: 85,
      confidence: 0.88,
    }));

    const chaoticReport = evaluateGlobalAmvQuality({
      decisions: chaoticDecisions,
      scenes,
      plan,
      musicUnderstanding: mu,
    });

    expect(coherentReport.overallScore).toBeGreaterThanOrEqual(74);
    expect(coherentReport.verdict).toBe('approved');
    expect(chaoticReport.overallScore).toBeLessThan(coherentReport.overallScore - 20);
    expect(chaoticReport.findings.some((f) => f.code === 'confusing_sequence' || f.code === 'random_cuts')).toBe(true);
    expect(chaoticReport.findings.some((f) => f.code === 'abrupt_ending')).toBe(true);
  });
});
