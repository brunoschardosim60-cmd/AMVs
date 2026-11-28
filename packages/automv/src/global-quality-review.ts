/**
 * INDEPENDENT GLOBAL QUALITY REVIEW (Camada 7 — AMV Creative Intelligence)
 *
 * Avalia o AMV completo como obra audiovisual integral — independente do otimizador local —
 * usando rubrica configurável 0..100 em 8 dimensões:
 * - Coerência narrativa (20%)
 * - Alinhamento música-imagem (20%)
 * - Continuidade visual (15%)
 * - Continuidade emocional (15%)
 * - Ritmo e dinâmica / respiração (10%)
 * - Qualidade dos cortes (10%)
 * - Variedade visual (5%)
 * - Qualidade do encerramento (5%)
 *
 * Detecta falhas globais mesmo quando clipes isolados têm alta nota técnica/intensidade (Teste K).
 */
import type { MusicUnderstandingResult, SceneAnalysis } from '@amv/analysis';
import { evaluateContinuityRelation } from './continuity-engine.js';
import type { EditorialDecision, UnifiedAudioEventMap } from './editing-decision-engine.js';
import type { CreativeDirectionPlan } from './narrative-director.js';
import { evaluateSemanticAlignment } from './semantic-alignment.js';

export interface GlobalQualityWeights {
  narrativeCoherence: number;     // 0.20
  musicImageAlignment: number;    // 0.20
  visualContinuity: number;       // 0.15
  emotionalContinuity: number;    // 0.15
  rhythmAndDynamics: number;      // 0.10
  cutQuality: number;             // 0.10
  visualVariety: number;          // 0.05
  endingQuality: number;          // 0.05
}

export const DEFAULT_GLOBAL_QUALITY_WEIGHTS: GlobalQualityWeights = {
  narrativeCoherence: 0.20,
  musicImageAlignment: 0.20,
  visualContinuity: 0.15,
  emotionalContinuity: 0.15,
  rhythmAndDynamics: 0.10,
  cutQuality: 0.10,
  visualVariety: 0.05,
  endingQuality: 0.05,
};

export type GlobalFlawCode =
  | 'random_cuts'
  | 'purposeless_scenes'
  | 'unmatched_key_phrases'
  | 'confusing_sequence'
  | 'interrupted_dialogue'
  | 'missing_emotional_build'
  | 'unprepared_climax'
  | 'abrupt_ending';

export interface GlobalQualityFinding {
  code: GlobalFlawCode;
  dimension: keyof GlobalQualityWeights;
  severity: 'high' | 'medium' | 'low';
  startTime: number;
  endTime: number;
  explanation: string;
  replanSuggestion: string;
}

export interface GlobalQualityDimensions {
  narrativeCoherence: number;
  musicImageAlignment: number;
  visualContinuity: number;
  emotionalContinuity: number;
  rhythmAndDynamics: number;
  cutQuality: number;
  visualVariety: number;
  endingQuality: number;
}

export interface GlobalQualityReport {
  overallScore: number;
  verdict: 'approved' | 'needs_revision' | 'rejected';
  dimensions: GlobalQualityDimensions;
  findings: GlobalQualityFinding[];
  strengths: string[];
  confidence: number;
}

export interface EvaluateGlobalQualityInput {
  decisions: EditorialDecision[];
  scenes: SceneAnalysis[];
  plan: CreativeDirectionPlan;
  musicUnderstanding: MusicUnderstandingResult;
  audioMap?: UnifiedAudioEventMap;
  weights?: Partial<GlobalQualityWeights>;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function normalizeWeights(partial?: Partial<GlobalQualityWeights>): GlobalQualityWeights {
  const w: GlobalQualityWeights = {
    narrativeCoherence: Math.max(0, partial?.narrativeCoherence ?? DEFAULT_GLOBAL_QUALITY_WEIGHTS.narrativeCoherence),
    musicImageAlignment: Math.max(0, partial?.musicImageAlignment ?? DEFAULT_GLOBAL_QUALITY_WEIGHTS.musicImageAlignment),
    visualContinuity: Math.max(0, partial?.visualContinuity ?? DEFAULT_GLOBAL_QUALITY_WEIGHTS.visualContinuity),
    emotionalContinuity: Math.max(0, partial?.emotionalContinuity ?? DEFAULT_GLOBAL_QUALITY_WEIGHTS.emotionalContinuity),
    rhythmAndDynamics: Math.max(0, partial?.rhythmAndDynamics ?? DEFAULT_GLOBAL_QUALITY_WEIGHTS.rhythmAndDynamics),
    cutQuality: Math.max(0, partial?.cutQuality ?? DEFAULT_GLOBAL_QUALITY_WEIGHTS.cutQuality),
    visualVariety: Math.max(0, partial?.visualVariety ?? DEFAULT_GLOBAL_QUALITY_WEIGHTS.visualVariety),
    endingQuality: Math.max(0, partial?.endingQuality ?? DEFAULT_GLOBAL_QUALITY_WEIGHTS.endingQuality),
  };
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  if (sum <= 0) return { ...DEFAULT_GLOBAL_QUALITY_WEIGHTS };
  return {
    narrativeCoherence: w.narrativeCoherence / sum,
    musicImageAlignment: w.musicImageAlignment / sum,
    visualContinuity: w.visualContinuity / sum,
    emotionalContinuity: w.emotionalContinuity / sum,
    rhythmAndDynamics: w.rhythmAndDynamics / sum,
    cutQuality: w.cutQuality / sum,
    visualVariety: w.visualVariety / sum,
    endingQuality: w.endingQuality / sum,
  };
}

/**
 * Avalia independentemente o AMV completo re-medindo transições, arco global,
 * frases cantadas, respiração, continuidade de diálogos e encerramento.
 */
export function evaluateGlobalAmvQuality(input: EvaluateGlobalQualityInput): GlobalQualityReport {
  const weights = normalizeWeights(input.weights);
  const scenesById = new Map(input.scenes.map((s) => [s.sceneId, s]));
  const findings: GlobalQualityFinding[] = [];
  const strengths: string[] = [];
  const { decisions, plan, musicUnderstanding } = input;

  if (!decisions.length) {
    return {
      overallScore: 0,
      verdict: 'rejected',
      dimensions: {
        narrativeCoherence: 0,
        musicImageAlignment: 0,
        visualContinuity: 0,
        emotionalContinuity: 0,
        rhythmAndDynamics: 0,
        cutQuality: 0,
        visualVariety: 0,
        endingQuality: 0,
      },
      findings: [{
        code: 'confusing_sequence',
        dimension: 'narrativeCoherence',
        severity: 'high',
        startTime: 0,
        endTime: 0,
        explanation: 'Nenhuma decisão editorial presente na montagem.',
        replanSuggestion: 'Selecione episódios analisados e regenere o plano de direção.',
      }],
      strengths: [],
      confidence: 0,
    };
  }

  const [rangeStart, rangeEnd] = plan.musicRange;

  // Reavalia independentemente o alinhamento semântico/narrativo REAL de cada cena escolhida
  const independentAlignments = decisions.map((d) => {
    const actualScene = scenesById.get(d.selectedSceneId);
    if (!actualScene) return d.semanticAlignment;
    const absStart = rangeStart + d.startTime;
    const absEnd = rangeStart + d.endTime;
    const beat = plan.narrativeBeats.find(
      (b) => d.startTime >= b.startTime - 0.05 && d.startTime < b.endTime + 0.05,
    );
    const activeEv = musicUnderstanding.events.find(
      (e) => e.eventType === 'vocal_phrase' && e.startTime < absEnd - 0.05 && e.endTime > absStart + 0.05,
    ) ?? musicUnderstanding.events.find(
      (e) => ['drop', 'pause', 'build', 'climax', 'ending', 'section'].includes(e.eventType)
        && (absStart + absEnd) / 2 >= e.startTime
        && (absStart + absEnd) / 2 <= e.endTime,
    );
    if (!activeEv) return d.semanticAlignment;
    return evaluateSemanticAlignment(activeEv, actualScene, {
      narrativeTargetTags: beat?.targetTags,
      narrativeRole: beat?.role,
      allowIntentionalContrast: beat?.allowIntentionalContrast,
    });
  });

  // Reavalia independentemente cada par consecutivo de cenas na montagem
  const pairRelations = [];
  for (let i = 1; i < decisions.length; i++) {
    const prevScene = scenesById.get(decisions[i - 1]!.selectedSceneId);
    const currScene = scenesById.get(decisions[i]!.selectedSceneId);
    if (!prevScene || !currScene) continue;
    const beat = plan.narrativeBeats.find(
      (b) => decisions[i]!.startTime >= b.startTime - 0.05 && decisions[i]!.startTime < b.endTime + 0.05,
    );
    const rel = evaluateContinuityRelation(prevScene, currScene, undefined, {
      musicalTransitionCue: decisions[i]!.cutType === 'sonic_impact' ? 'entrada do drop' : null,
      allowFlashback: beat?.nonLinearFunction === 'origin_flashback' || beat?.nonLinearFunction === 'memory_echo',
      allowIntentionalContrast: beat?.allowIntentionalContrast || independentAlignments[i]!.alignmentType === 'intentional_contrast',
    });
    pairRelations.push({ index: i, decision: decisions[i]!, rel });
  }

  const jarringPairs = pairRelations.filter((p) => p.rel.relationKind === 'jarring_jump' || p.rel.continuityScore < 38);
  for (const jp of jarringPairs.slice(0, 3)) {
    findings.push({
      code: 'random_cuts',
      dimension: 'visualContinuity',
      severity: jp.rel.continuityScore < 28 ? 'high' : 'medium',
      startTime: jp.decision.startTime,
      endTime: jp.decision.endTime,
      explanation: `Corte desconexo em ${jp.decision.startTime.toFixed(1)}s: ${jp.rel.explanation}.`,
      replanSuggestion: 'Substituir por cena com vetor de movimento compatível ou personagem compartilhado.',
    });
  }

  // 1. Continuidade Visual & Coreográfica (15%)
  const avgVisualCont = pairRelations.length
    ? pairRelations.reduce((sum, p) => sum + (p.rel.dimensions.combatChoreography * 0.45 + p.rel.dimensions.motionDirection * 0.35 + p.rel.dimensions.visualTone * 0.2), 0) / pairRelations.length
    : 75;
  const visualContinuity = clamp(avgVisualCont - jarringPairs.length * 9, 0, 100);

  // 2. Continuidade Emocional & Construção antes do Auge (15%)
  const avgEmoCont = pairRelations.length
    ? pairRelations.reduce((sum, p) => sum + p.rel.dimensions.emotionalTransition, 0) / pairRelations.length
    : 78;
  const chosenScenes = decisions.map((d) => scenesById.get(d.selectedSceneId)).filter((s): s is SceneAnalysis => Boolean(s));
  const intensities = chosenScenes.map((s) => s.intensity);
  const firstHalfAvg = intensities.slice(0, Math.max(1, Math.floor(intensities.length / 2)))
    .reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(intensities.length / 2));
  const maxIntensity = Math.max(0, ...intensities);
  const intensitySpan = maxIntensity - Math.min(1, ...intensities);

  let sawtoothSwings = 0;
  for (let i = 1; i < intensities.length; i++) {
    if (Math.abs(intensities[i]! - intensities[i - 1]!) >= 0.48) sawtoothSwings++;
  }
  const sawtoothRatio = intensities.length > 2 ? sawtoothSwings / (intensities.length - 1) : 0;

  let emotionalBuildPenalty = 0;
  if (decisions.length >= 4 && intensitySpan < 0.14 && plan.narrativeModel !== 'combat_sequence') {
    emotionalBuildPenalty += 22;
    findings.push({
      code: 'missing_emotional_build',
      dimension: 'emotionalContinuity',
      severity: 'medium',
      startTime: decisions[0]!.startTime,
      endTime: decisions.at(-1)!.endTime,
      explanation: `Intensidade visual chapada (variação de apenas ${(intensitySpan * 100).toFixed(0)}%) sem construção dramática progressiva.`,
      replanSuggestion: 'Inserir planos de preparação, memória ou tensão contida antes do clímax.',
    });
  } else if (decisions.length >= 4 && sawtoothRatio >= 0.65) {
    emotionalBuildPenalty += 28;
    findings.push({
      code: 'missing_emotional_build',
      dimension: 'emotionalContinuity',
      severity: 'high',
      startTime: decisions[0]!.startTime,
      endTime: decisions.at(-1)!.endTime,
      explanation: `Oscilação errática de intensidade em ${Math.round(sawtoothRatio * 100)}% dos cortes sem arco emocional progressivo.`,
      replanSuggestion: 'Agrupar planos por progressão dramática em vez de alternar calma e impacto a cada corte.',
    });
  }
  const emotionalContinuity = clamp(avgEmoCont - emotionalBuildPenalty - jarringPairs.filter((p) => p.rel.dimensions.emotionalTransition < 35).length * 10, 0, 100);

  // 3. Coerência Narrativa Global (20%) — Detecta "bons clipes isolados mas sequência global confusa" (Teste K!)
  const distinctCharSets = chosenScenes.map((s) => s.characterNames);
  let unmotivatedSwitches = 0;
  for (let i = 1; i < distinctCharSets.length; i++) {
    const prevChars = distinctCharSets[i - 1]!;
    const currChars = distinctCharSets[i]!;
    if (prevChars.length > 0 && currChars.length > 0 && !currChars.some((c) => prevChars.includes(c))) {
      unmotivatedSwitches++;
    }
  }
  const purposelessDecisions = decisions.filter((d, idx) => independentAlignments[idx]!.components.generalNarrative < 48 && !d.lockedByUser);
  if (purposelessDecisions.length >= Math.ceil(decisions.length * 0.35)) {
    findings.push({
      code: 'purposeless_scenes',
      dimension: 'narrativeCoherence',
      severity: 'medium',
      startTime: purposelessDecisions[0]!.startTime,
      endTime: purposelessDecisions.at(-1)!.endTime,
      explanation: `${purposelessDecisions.length} de ${decisions.length} cenas não cumprem a função dramática esperada de seu capítulo narrativo.`,
      replanSuggestion: 'Realinhar seleção de cenas às tags-alvo de cada capítulo do Diretor Narrativo.',
    });
  }

  // Checa se o clímax tem preparação anterior (turning_point / build / preparation)
  const dropIdx = decisions.findIndex((d) => d.cutType === 'sonic_impact' || (plan.dropTimelineS !== null && Math.abs(d.startTime - plan.dropTimelineS) <= 0.25));
  let unpreparedClimaxPenalty = 0;
  if (dropIdx > 0) {
    const preClimaxScene = scenesById.get(decisions[dropIdx - 1]!.selectedSceneId);
    const climaxScene = scenesById.get(decisions[dropIdx]!.selectedSceneId);
    if (climaxScene && climaxScene.intensity < 0.52 && input.scenes.some((s) => s.intensity >= 0.72)) {
      unpreparedClimaxPenalty += 24;
      findings.push({
        code: 'unprepared_climax',
        dimension: 'narrativeCoherence',
        severity: 'high',
        startTime: decisions[dropIdx]!.startTime,
        endTime: decisions[dropIdx]!.endTime,
        explanation: `Cena fraca no clímax/drop (intensidade ${climaxScene.intensity.toFixed(2)}) apesar de haver cenas fortes disponíveis.`,
        replanSuggestion: 'Trocar o clímax por cena de impacto, transformação ou superação.',
      });
    } else if (preClimaxScene && preClimaxScene.actionPhase === 'impact' && climaxScene && preClimaxScene.intensity > climaxScene.intensity + 0.1) {
      unpreparedClimaxPenalty += 16;
      findings.push({
        code: 'unprepared_climax',
        dimension: 'narrativeCoherence',
        severity: 'medium',
        startTime: decisions[dropIdx - 1]!.startTime,
        endTime: decisions[dropIdx]!.endTime,
        explanation: 'O impacto máximo foi gasto imediatamente antes do drop sem preparação crescente.',
        replanSuggestion: 'Usar cena de preparação/tensão antes do drop e reservar o maior impacto para a batida do clímax.',
      });
    }
  }

  // Sequência globalmente confusa: muitos saltos desconexos, oscilação errática ou repetição ping-pong
  const uniqueIdsCount = new Set(decisions.map((d) => d.selectedSceneId)).size;
  const uniqueSceneRatio = uniqueIdsCount / decisions.length;
  let confusingPenalty = 0;
  const jarringRatio = pairRelations.length ? jarringPairs.length / pairRelations.length : 0;
  const switchRatio = decisions.length > 2 ? unmotivatedSwitches / (decisions.length - 1) : 0;
  if (jarringRatio >= 0.4 || (switchRatio >= 0.75 && plan.narrativeModel !== 'rivalry') || (decisions.length >= 4 && uniqueSceneRatio <= 0.5 && input.scenes.length >= 4)) {
    confusingPenalty = 36;
    findings.push({
      code: 'confusing_sequence',
      dimension: 'narrativeCoherence',
      severity: 'high',
      startTime: decisions[0]!.startTime,
      endTime: decisions.at(-1)!.endTime,
      explanation: `Montagem globalmente confusa ou repetitiva (${jarringPairs.length} cortes desconexos, variedade ${Math.round(uniqueSceneRatio * 100)}%, ${Math.round(switchRatio * 100)}% de trocas de elenco), ainda que cenas isoladas tenham intensidade.`,
      replanSuggestion: 'Replanejar a sequência inteira priorizando fio condutor de personagem, variedade e continuidade coreográfica.',
    });
  }

  // Fala interrompida no meio da ideia
  let speechPenalty = 0;
  if ((input.audioMap?.interruptedSpeechCount ?? 0) > 0) {
    speechPenalty = 22;
    findings.push({
      code: 'interrupted_dialogue',
      dimension: 'narrativeCoherence',
      severity: 'high',
      startTime: 0,
      endTime: decisions.at(-1)!.endTime,
      explanation: `${input.audioMap!.interruptedSpeechCount} fala(s) importante(s) foram cortadas antes de concluir a ideia.`,
      replanSuggestion: 'Estender a janela de áudio da fala em L-cut/narração até o fim da frase.',
    });
  }

  const baseNarrative = independentAlignments.reduce((s, a) => s + a.components.generalNarrative, 0) / decisions.length;
  const narrativeCoherence = clamp(baseNarrative + (firstHalfAvg < maxIntensity ? 8 : 0) - unpreparedClimaxPenalty - confusingPenalty - speechPenalty, 0, 100);

  // 4. Alinhamento Música-Imagem (20%) — Checa frases importantes sem correspondência
  const keyVocalEvents = musicUnderstanding.events.filter(
    (e) => e.eventType === 'vocal_phrase'
      && e.semanticMeaning?.primaryTheme !== null
      && e.endTime > rangeStart
      && e.startTime < rangeEnd,
  );
  let unmatchedPhrases = 0;
  for (const vEv of keyVocalEvents) {
    const tStart = Math.max(0, vEv.startTime - rangeStart);
    const tEnd = vEv.endTime - rangeStart;
    const overlappingIdxs = decisions
      .map((d, idx) => ({ d, idx }))
      .filter(({ d }) => d.startTime < tEnd - 0.05 && d.endTime > tStart + 0.05);
    const bestOverlapScore = Math.max(0, ...overlappingIdxs.map(({ idx }) => independentAlignments[idx]!.score));
    const betterExistsInPool = input.scenes.some((s) => !s.excluded && evaluateSemanticAlignment(vEv, s).score >= 78);
    if (overlappingIdxs.length > 0 && bestOverlapScore < 58 && betterExistsInPool) {
      unmatchedPhrases++;
    }
  }
  if (unmatchedPhrases > 0) {
    findings.push({
      code: 'unmatched_key_phrases',
      dimension: 'musicImageAlignment',
      severity: unmatchedPhrases >= 2 ? 'high' : 'medium',
      startTime: decisions[0]!.startTime,
      endTime: decisions.at(-1)!.endTime,
      explanation: `${unmatchedPhrases} frase(s) temática(s) da letra ficaram com baixa correspondência semântica apesar de existirem cenas compatíveis no projeto.`,
      replanSuggestion: 'Usar "Encontrar outra cena para esta frase" no Creative Direction Preview para alinhar os versos focais.',
    });
  }
  const avgSemantic = independentAlignments.reduce((s, a) => s + a.score, 0) / decisions.length;
  const musicImageAlignment = clamp(avgSemantic - unmatchedPhrases * 12, 0, 100);

  // 5. Ritmo, Dinâmica e Respiração Cinematográfica (10%)
  let rhythmScore = 84;
  if (plan.breathingZones.length > 0) {
    const respectedZones = plan.breathingZones.filter((z) =>
      decisions.some((d) => d.startTime <= z.endTime && d.endTime >= z.startTime && (d.isBreathingHold || (d.endTime - d.startTime) >= 1.8)),
    ).length;
    const ratio = respectedZones / plan.breathingZones.length;
    rhythmScore = clamp(55 + ratio * 40, 35, 96);
    if (ratio >= 0.75) strengths.push('Respiração cinematográfica respeitada nos trechos contemplativos/pausas.');
  } else {
    strengths.push('Cadência rítmica alinhada aos compassos e acentos musicais.');
  }

  // 6. Qualidade dos Cortes (10%)
  const microCuts = decisions.filter((d) => d.endTime - d.startTime < 0.2).length;
  const purposefulCuts = decisions.filter((d) => d.cutType !== 'on_beat' || d.score >= 68).length;
  const cutQuality = clamp((purposefulCuts / decisions.length) * 92 - microCuts * 15, 20, 98);

  // 7. Variedade Visual (5%)
  const uniqueIds = new Set(decisions.map((d) => d.selectedSceneId)).size;
  const uniqueRatio = uniqueIds / decisions.length;
  const visualVariety = clamp(uniqueRatio * 96, 20, 98);
  if (uniqueRatio >= 0.95) strengths.push('Alta diversidade visual sem repetição de planos.');

  // 8. Qualidade do Encerramento (5%)
  const lastDecision = decisions.at(-1)!;
  const lastDuration = lastDecision.endTime - lastDecision.startTime;
  let endingQuality = 85;
  if (plan.endingStrategy.kind !== 'dry_impact_cut' && lastDuration < 0.75) {
    endingQuality = 38;
    findings.push({
      code: 'abrupt_ending',
      dimension: 'endingQuality',
      severity: 'medium',
      startTime: lastDecision.startTime,
      endTime: lastDecision.endTime,
      explanation: `Encerramento curto demais (${lastDuration.toFixed(2)}s) para a estratégia "${plan.endingStrategy.kind}".`,
      replanSuggestion: 'Sustentar o plano final por pelo menos 1,5s ou escolher corte seco intencional em música rápida.',
    });
  } else {
    strengths.push(`Encerramento intencional (${plan.endingStrategy.kind.replace(/_/g, ' ')}) bem sustentado.`);
  }

  const dimensions: GlobalQualityDimensions = {
    narrativeCoherence: round1(narrativeCoherence),
    musicImageAlignment: round1(musicImageAlignment),
    visualContinuity: round1(visualContinuity),
    emotionalContinuity: round1(emotionalContinuity),
    rhythmAndDynamics: round1(rhythmScore),
    cutQuality: round1(cutQuality),
    visualVariety: round1(visualVariety),
    endingQuality: round1(endingQuality),
  };

  const overallScore = round1(clamp(
    dimensions.narrativeCoherence * weights.narrativeCoherence
      + dimensions.musicImageAlignment * weights.musicImageAlignment
      + dimensions.visualContinuity * weights.visualContinuity
      + dimensions.emotionalContinuity * weights.emotionalContinuity
      + dimensions.rhythmAndDynamics * weights.rhythmAndDynamics
      + dimensions.cutQuality * weights.cutQuality
      + dimensions.visualVariety * weights.visualVariety
      + dimensions.endingQuality * weights.endingQuality,
    0,
    100,
  ));

  const highCount = findings.filter((f) => f.severity === 'high').length;
  const verdict: GlobalQualityReport['verdict'] =
    overallScore >= 74 && highCount === 0
      ? 'approved'
      : overallScore >= 52
        ? 'needs_revision'
        : 'rejected';

  const confidence = round3(clamp(
    decisions.reduce((s, d) => s + d.confidence, 0) / decisions.length,
    0.25,
    0.96,
  ));

  return {
    overallScore,
    verdict,
    dimensions,
    findings,
    strengths,
    confidence,
  };
}
