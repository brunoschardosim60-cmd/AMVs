/**
 * GLOBAL EDITING DECISION ENGINE, MUSIC-DRIVEN EDITING & VOCAL INTERACTION (Camada 6)
 *
 * Unifica:
 * - Mapa temporal de eventos sonoros (falas essenciais vs secundárias, letras cantadas, SFX, instrumental)
 *   com coexistência vocal, L-cuts/narração contínua sobre cortes e proteção contra fala interrompida.
 * - Planejamento inteligente de cortes (11 tipos editoriais + respiração cinematográfica sustentada).
 * - Otimizador global em feixe (*Beam Search*) integrando Diretor Narrativo + Alinhamento Semântico +
 *   Continuidade Coreográfica/Emocional + Memória Contextual, gerando `EditorialDecision[]` completas
 *   com justificativas objetivas, alternativas ranqueadas e confiança explícita.
 */
import {
  interpretLyricPhrase,
  type CreativeMusicEvent,
  type MusicUnderstandingResult,
  type SceneAnalysis,
} from '@amv/analysis';
import {
  advanceNarrativeMemory,
  createInitialNarrativeMemory,
  evaluateContinuityRelation,
  type ContinuityRelation,
  type NarrativeContextMemory,
} from './continuity-engine.js';
import type {
  CreativeDirectionOverrides,
  CreativeDirectionPlan,
  CreativeNarrativeBeat,
} from './narrative-director.js';
import {
  evaluateSemanticAlignment,
  type SemanticAlignment,
  type SemanticAlignmentWeights,
} from './semantic-alignment.js';

export type EditorialCutType =
  | 'on_beat'
  | 'pre_beat'
  | 'post_beat'
  | 'phrase_start'
  | 'phrase_end'
  | 'sonic_impact'
  | 'instrumental_transition'
  | 'musical_pause'
  | 'action_cut'
  | 'reaction_cut'
  | 'breathing_hold';

export type AudioLayerRole =
  | 'character_speech_essential'
  | 'character_speech_secondary'
  | 'song_lyrics'
  | 'sfx_impact'
  | 'instrumental_music';

export interface UnifiedAudioEvent {
  id: string;
  role: AudioLayerRole;
  startTime: number;
  endTime: number;
  sourceSceneId?: string;
  text: string | null;
  preservesCompleteIdea: boolean;
  /** Permite que a voz continue fluida enquanto múltiplos planos visuais se sucedem (L-cut/narração). */
  spansMultipleVisualCuts: boolean;
  recommendedMusicDuckDb: number;
  rationale: string;
}

export interface UnifiedAudioEventMap {
  events: UnifiedAudioEvent[];
  essentialSpeechCount: number;
  interruptedSpeechCount: number;
  multiCutVocalPhrases: Array<{ lyricEventId: string; text: string; startTime: number; endTime: number; cutCount: number }>;
}

export interface PlannedEditorialSlot {
  slotIndex: number;
  startTime: number;
  endTime: number;
  durationS: number;
  energy: number;
  isDrop: boolean;
  isBreathingHold: boolean;
  cutType: EditorialCutType;
  narrativeBeat: CreativeNarrativeBeat;
  activeMusicEvent: CreativeMusicEvent;
  keywordEvent: CreativeMusicEvent | null;
  voiceoverBridgeActive: boolean;
  phraseUnitId: string | null;
}

export interface RejectedSceneAlternative {
  sceneId: string;
  episodeName: string;
  startTime: number;
  endTime: number;
  score: number;
  alignmentType: SemanticAlignment['alignmentType'];
  whyRejected: string;
}

export interface EditorialDecision {
  slotIndex: number;
  selectedSceneId: string;
  episodeName: string;
  clipId?: string;
  startTime: number;
  endTime: number;
  sourceStartTime: number;
  sourceEndTime: number;
  cutType: EditorialCutType;
  isBreathingHold: boolean;
  lockedByUser: boolean;
  reason: string;
  musicalRelationship: string;
  narrativeRelationship: string;
  semanticAlignment: SemanticAlignment;
  continuityWithPrevious: ContinuityRelation | null;
  alternatives: RejectedSceneAlternative[];
  coherenceRisks: string[];
  score: number;
  confidence: number;
}

export interface SolveEditorialDecisionsInput {
  plan: CreativeDirectionPlan;
  scenes: SceneAnalysis[];
  musicUnderstanding: MusicUnderstandingResult;
  /** Slots brutos opcionais (ex.: vindos de `makeSlots`); quando omitidos, o motor cria a grade inteligente. */
  rawSlots?: Array<{ startS: number; endS: number; energy: number; isDrop?: boolean }>;
  overrides?: CreativeDirectionOverrides;
  semanticWeights?: Partial<SemanticAlignmentWeights>;
  beamWidth?: number;
}

export interface GlobalEditorialSolution {
  slots: PlannedEditorialSlot[];
  decisions: EditorialDecision[];
  audioMap: UnifiedAudioEventMap;
  averageScore: number;
  averageConfidence: number;
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

function findBeatForTime(beats: CreativeNarrativeBeat[], timeS: number): CreativeNarrativeBeat {
  return beats.find((b) => timeS >= b.startTime - 1e-4 && timeS < b.endTime + 1e-4)
    ?? beats.at(-1)!;
}

function findPrimaryMusicEventAt(
  mu: MusicUnderstandingResult,
  rangeStart: number,
  slotStartTimelineS: number,
  slotEndTimelineS: number,
  isDrop: boolean,
): { event: CreativeMusicEvent; keyword: CreativeMusicEvent | null } {
  const absStart = rangeStart + slotStartTimelineS;
  const absEnd = rangeStart + slotEndTimelineS;
  const absMid = (absStart + absEnd) / 2;

  if (isDrop) {
    const dropEv = mu.events.find((e) => e.eventType === 'drop' && Math.abs(e.startTime - absStart) <= 0.35);
    if (dropEv) return { event: dropEv, keyword: null };
  }

  const vocalPhrase = mu.events.find(
    (e) => e.eventType === 'vocal_phrase' && e.startTime < absEnd - 0.05 && e.endTime > absStart + 0.05,
  );
  if (vocalPhrase) {
    const keyword = mu.events.find(
      (e) => e.eventType === 'lyric_keyword' && e.startTime >= absStart - 0.08 && e.startTime <= absEnd + 0.08,
    ) ?? null;
    return { event: vocalPhrase, keyword };
  }

  const structural = mu.events.find(
    (e) => ['pause', 'build', 'climax', 'ending', 'instrumental_passage', 'section'].includes(e.eventType)
      && absMid >= e.startTime && absMid <= e.endTime,
  ) ?? {
    id: `fallback-${slotStartTimelineS.toFixed(2)}`,
    startTime: absStart,
    endTime: absEnd,
    eventType: 'section' as const,
    lyrics: null,
    semanticMeaning: null,
    emotion: 'determinação' as const,
    intensity: 0.5,
    confidence: 0.6,
  };

  return { event: structural, keyword: null };
}

/**
 * Constrói os slots temporais inteligentes aplicando respiração cinematográfica:
 * consolida cortes picotados desnecessários em zonas emocionais/contemplativas quando há planos longos,
 * e classifica o tipo editorial exato de cada corte.
 */
export function planEditorialTimelineSlots(input: {
  plan: CreativeDirectionPlan;
  scenes: SceneAnalysis[];
  musicUnderstanding: MusicUnderstandingResult;
  rawSlots?: Array<{ startS: number; endS: number; energy: number; isDrop?: boolean }>;
  intensityBias?: -1 | 0 | 1;
}): PlannedEditorialSlot[] {
  const { plan, scenes, musicUnderstanding } = input;
  const [rangeStart, rangeEnd] = plan.musicRange;
  const durationS = Math.max(1, rangeEnd - rangeStart);
  const maxSceneDurationS = Math.max(1.5, ...scenes.filter((s) => !s.excluded).map((s) => s.durationS));
  const bias = input.intensityBias ?? 0;

  // Gera grade base caso `rawSlots` não tenha sido fornecida
  const baseRaw: Array<{ startS: number; endS: number; energy: number; isDrop: boolean }> = input.rawSlots?.length
    ? input.rawSlots.map((s) => ({
        startS: round3(s.startS),
        endS: round3(s.endS),
        energy: s.energy,
        isDrop: Boolean(s.isDrop || (plan.dropTimelineS !== null && Math.abs(s.startS - plan.dropTimelineS) <= 0.12)),
      }))
    : (() => {
        const barsInRange = musicUnderstanding.bars
          .filter((b) => b.endTime > rangeStart + 0.1 && b.startTime < rangeEnd - 0.1)
          .map((b) => ({
            startS: round3(Math.max(0, b.startTime - rangeStart)),
            endS: round3(Math.min(durationS, b.endTime - rangeStart)),
            energy: b.energy,
          }))
          .filter((b) => b.endS - b.startS >= 0.35);

        if (!barsInRange.length) {
          const step = bias > 0 ? 1.5 : bias < 0 ? 3.2 : 2.2;
          const fallback: Array<{ startS: number; endS: number; energy: number; isDrop: boolean }> = [];
          for (let t = 0; t < durationS - 0.1; t += step) {
            const end = Math.min(durationS, t + step);
            fallback.push({
              startS: round3(t),
              endS: round3(end),
              energy: 0.5,
              isDrop: plan.dropTimelineS !== null && Math.abs(t - plan.dropTimelineS) <= 0.2,
            });
          }
          return fallback;
        }

        const generated: Array<{ startS: number; endS: number; energy: number; isDrop: boolean }> = [];
        for (const bar of barsInRange) {
          const beat = findBeatForTime(plan.narrativeBeats, (bar.startS + bar.endS) / 2);
          const barLen = bar.endS - bar.startS;
          const highAction = (bar.energy >= 0.72 || beat.musicalStrategy === 'impact_choreography') && !beat.preferBreathingHold && bias >= 0;
          if (highAction && barLen >= 1.2) {
            const mid = round3((bar.startS + bar.endS) / 2);
            generated.push({
              startS: bar.startS,
              endS: mid,
              energy: bar.energy,
              isDrop: plan.dropTimelineS !== null && Math.abs(bar.startS - plan.dropTimelineS) <= 0.18,
            });
            generated.push({
              startS: mid,
              endS: bar.endS,
              energy: bar.energy,
              isDrop: plan.dropTimelineS !== null && Math.abs(mid - plan.dropTimelineS) <= 0.18,
            });
          } else {
            generated.push({
              startS: bar.startS,
              endS: bar.endS,
              energy: bar.energy,
              isDrop: plan.dropTimelineS !== null && Math.abs(bar.startS - plan.dropTimelineS) <= 0.18,
            });
          }
        }
        return generated;
      })();

  // Consolidação inteligente de Respiração Cinematográfica:
  // Em zonas de respiração / pausas / encerramento, une slots curtos adjacentes até o limite sustentável pelas cenas!
  const merged: Array<{ startS: number; endS: number; energy: number; isDrop: boolean; breathing: boolean }> = [];
  const targetHoldMaxS = Math.min(maxSceneDurationS * 0.95, bias < 0 ? 5.8 : 4.4);

  for (const item of baseRaw) {
    const mid = (item.startS + item.endS) / 2;
    const beat = findBeatForTime(plan.narrativeBeats, mid);
    const inBreathingZone = beat.preferBreathingHold
      || plan.breathingZones.some((z) => mid >= z.startTime && mid <= z.endTime);

    const prev = merged.at(-1);
    if (
      prev
      && inBreathingZone
      && !item.isDrop
      && !prev.isDrop
      && item.energy <= 0.48
      && item.endS - prev.startS <= targetHoldMaxS
    ) {
      prev.endS = item.endS;
      prev.energy = round3((prev.energy + item.energy) / 2);
      prev.breathing = true;
    } else {
      merged.push({
        ...item,
        breathing: inBreathingZone && (item.endS - item.startS >= 1.8),
      });
    }
  }

  return merged.map((slot, idx): PlannedEditorialSlot => {
    const mid = (slot.startS + slot.endS) / 2;
    const beat = findBeatForTime(plan.narrativeBeats, mid);
    const { event: activeMusicEvent, keyword: keywordEvent } = findPrimaryMusicEventAt(
      musicUnderstanding,
      rangeStart,
      slot.startS,
      slot.endS,
      slot.isDrop,
    );

    const absStart = rangeStart + slot.startS;
    const isPhraseStart = activeMusicEvent.eventType === 'vocal_phrase' && Math.abs(activeMusicEvent.startTime - absStart) <= 0.28;
    const isPhraseEnd = activeMusicEvent.eventType === 'vocal_phrase' && Math.abs(activeMusicEvent.endTime - (rangeStart + slot.endS)) <= 0.28;
    const nearPause = musicUnderstanding.events.some(
      (e) => e.eventType === 'pause' && absStart >= e.startTime - 0.15 && absStart <= e.endTime + 0.15,
    );
    const preDropAnticipation = plan.dropTimelineS !== null
      && plan.dropTimelineS - slot.startS > 0.12
      && plan.dropTimelineS - slot.startS <= 1.2;

    let cutType: EditorialCutType = 'on_beat';
    if (slot.isDrop || activeMusicEvent.eventType === 'drop') cutType = 'sonic_impact';
    else if (slot.breathing) cutType = 'breathing_hold';
    else if (nearPause) cutType = 'musical_pause';
    else if (preDropAnticipation) cutType = 'pre_beat';
    else if (isPhraseStart) cutType = 'phrase_start';
    else if (isPhraseEnd) cutType = 'phrase_end';
    else if (activeMusicEvent.eventType === 'instrumental_passage') cutType = 'instrumental_transition';
    else if (beat.role === 'release') cutType = 'reaction_cut';
    else if (slot.energy >= 0.72) cutType = 'action_cut';

    const voiceoverBridgeActive = plan.preservedDialogues.some(
      (d) => slot.endS - slot.startS < (d.endTime - d.startTime) && beat.role === 'build',
    );

    return {
      slotIndex: idx,
      startTime: slot.startS,
      endTime: slot.endS,
      durationS: round3(slot.endS - slot.startS),
      energy: slot.energy,
      isDrop: slot.isDrop,
      isBreathingHold: slot.breathing,
      cutType,
      narrativeBeat: beat,
      activeMusicEvent,
      keywordEvent,
      voiceoverBridgeActive,
      phraseUnitId: activeMusicEvent.eventType === 'vocal_phrase' ? activeMusicEvent.id : null,
    };
  });
}

/**
 * Constrói o mapa unificado de eventos sonoros garantindo que:
 * - falas essenciais não sejam cortadas no meio da ideia;
 * - ducking contextual adapte a redução conforme a energia/refrão da música;
 * - frases vocais que cruzam múltiplos cortes visuais sejam tratadas como unidade narrativa.
 */
export function buildUnifiedAudioEventMap(input: {
  plan: CreativeDirectionPlan;
  slots: PlannedEditorialSlot[];
  musicUnderstanding: MusicUnderstandingResult;
}): UnifiedAudioEventMap {
  const { plan, slots, musicUnderstanding } = input;
  const [rangeStart, rangeEnd] = plan.musicRange;
  const durationS = Math.max(1, rangeEnd - rangeStart);
  const events: UnifiedAudioEvent[] = [];

  // 1. Falas preservadas com proteção integral da ideia completa
  let essentialSpeechCount = 0;
  let interruptedSpeechCount = 0;
  let cursorS = 0.8;

  for (const speech of plan.preservedDialogues) {
    const rawLen = Math.max(0.5, speech.endTime - speech.startTime);
    let targetStartS: number;
    if (speech.importance === 'essential' && plan.dropTimelineS !== null && plan.dropTimelineS >= rawLen + 0.3 && essentialSpeechCount === 0) {
      // Posiciona a fala essencial principal terminando exatamente antes do drop!
      targetStartS = round3(plan.dropTimelineS - rawLen);
    } else {
      targetStartS = round3(Math.min(Math.max(cursorS, 0.5), Math.max(0.5, durationS - rawLen - 0.3)));
    }
    const targetEndS = round3(Math.min(durationS, targetStartS + rawLen));
    const placedLen = targetEndS - targetStartS;
    const preservesCompleteIdea = placedLen >= rawLen - 0.08;
    if (!preservesCompleteIdea) interruptedSpeechCount++;
    if (speech.importance === 'essential') essentialSpeechCount++;

    const overlappingSlots = slots.filter((s) => s.startTime < targetEndS - 0.05 && s.endTime > targetStartS + 0.05);
    const avgMusicEnergy = overlappingSlots.length
      ? overlappingSlots.reduce((sum, s) => sum + s.energy, 0) / overlappingSlots.length
      : 0.45;
    const overlapsVocal = musicUnderstanding.vocalSpans.some(
      (v) => v.startTime < rangeStart + targetEndS && v.endTime > rangeStart + targetStartS,
    );

    // Ducking contextual inteligente: protege o impacto musical do refrão mas dá espaço cristalino às falas essenciais
    const recommendedMusicDuckDb = speech.importance === 'essential'
      ? (avgMusicEnergy >= 0.72 ? -7.5 : overlapsVocal ? -10.5 : -12)
      : (avgMusicEnergy >= 0.72 ? -4.5 : -7);

    events.push({
      id: `speech-${speech.sceneId}`,
      role: speech.importance === 'essential' ? 'character_speech_essential' : 'character_speech_secondary',
      startTime: targetStartS,
      endTime: targetEndS,
      sourceSceneId: speech.sceneId,
      text: speech.text,
      preservesCompleteIdea,
      spansMultipleVisualCuts: overlappingSlots.length >= 2,
      recommendedMusicDuckDb,
      rationale: `${speech.importance === 'essential' ? 'Fala essencial' : 'Fala de apoio'} preservada integralmente (${placedLen.toFixed(2)}s)${overlappingSlots.length >= 2 ? ` fluindo sobre ${overlappingSlots.length} planos visuais (L-cut/narração)` : ''}.`,
    });
    cursorS = targetEndS + 2.2;
  }

  // 2. Frases cantadas da música e quantos cortes visuais cada frase abrange como unidade narrativa
  const multiCutVocalPhrases: UnifiedAudioEventMap['multiCutVocalPhrases'] = [];
  for (const ev of musicUnderstanding.events) {
    if (ev.eventType !== 'vocal_phrase' || !ev.lyrics) continue;
    if (ev.endTime <= rangeStart || ev.startTime >= rangeEnd) continue;
    const tStart = round3(Math.max(0, ev.startTime - rangeStart));
    const tEnd = round3(Math.min(durationS, ev.endTime - rangeStart));
    const coveredSlots = slots.filter((s) => s.startTime < tEnd - 0.05 && s.endTime > tStart + 0.05);
    if (coveredSlots.length >= 2) {
      multiCutVocalPhrases.push({
        lyricEventId: ev.id,
        text: ev.lyrics,
        startTime: tStart,
        endTime: tEnd,
        cutCount: coveredSlots.length,
      });
    }
    events.push({
      id: ev.id,
      role: 'song_lyrics',
      startTime: tStart,
      endTime: tEnd,
      text: ev.lyrics,
      preservesCompleteIdea: true,
      spansMultipleVisualCuts: coveredSlots.length >= 2,
      recommendedMusicDuckDb: 0,
      rationale: coveredSlots.length >= 2
        ? `Frase cantada conduz ${coveredSlots.length} cortes visuais consecutivos como unidade narrativa única.`
        : 'Frase cantada sincronizada a um plano dedicado.',
    });
  }

  // 3. Passagens instrumentais limpas
  for (const inst of musicUnderstanding.instrumentalSpans) {
    if (inst.endTime <= rangeStart || inst.startTime >= rangeEnd) continue;
    const tStart = round3(Math.max(0, inst.startTime - rangeStart));
    const tEnd = round3(Math.min(durationS, inst.endTime - rangeStart));
    events.push({
      id: `inst-${tStart}`,
      role: 'instrumental_music',
      startTime: tStart,
      endTime: tEnd,
      text: null,
      preservesCompleteIdea: true,
      spansMultipleVisualCuts: true,
      recommendedMusicDuckDb: 0,
      rationale: 'Trecho instrumental sem conflito vocal: espaço ideal para impacto sonoro ou fala dramática.',
    });
  }

  events.sort((a, b) => a.startTime - b.startTime);

  return {
    events,
    essentialSpeechCount,
    interruptedSpeechCount,
    multiCutVocalPhrases,
  };
}

interface CandidateEval {
  scene: SceneAnalysis;
  semantic: SemanticAlignment;
  continuity: ContinuityRelation | null;
  combinedScore: number;
  locked: boolean;
}

function evaluateCandidateForSlot(
  slot: PlannedEditorialSlot,
  totalSlots: number,
  scene: SceneAnalysis,
  memory: NarrativeContextMemory,
  plan: CreativeDirectionPlan,
  overrides?: CreativeDirectionOverrides,
  semanticWeights?: Partial<SemanticAlignmentWeights>,
): CandidateEval | null {
  const lockedSceneId = overrides?.lockedScenes?.[`slot:${slot.slotIndex}`]
    ?? overrides?.lockedScenes?.[`beat:${slot.narrativeBeat.beatId.replace('nbeat-', '')}`]
    ?? (slot.slotIndex === 0 ? overrides?.openingSceneId : undefined)
    ?? (slot.isDrop ? overrides?.climaxSceneId : undefined)
    ?? (slot.slotIndex === totalSlots - 1 ? overrides?.endingSceneId : undefined);

  const isLocked = lockedSceneId === scene.sceneId;
  if (lockedSceneId && !isLocked) {
    // Se o slot está travado pelo usuário e a cena travada existe, desprioriza as demais mantendo só para lista de alternativas
  }

  // Limite físico de duração (até 0,6x câmera lenta sem invadir cena vizinha), exceto se o usuário travou explicitamente
  if (!isLocked && scene.durationS + 1e-4 < slot.durationS * 0.6) {
    return null;
  }

  const semantic = evaluateSemanticAlignment(slot.activeMusicEvent, scene, {
    weights: semanticWeights,
    recentCharacters: memory.recentCharacters,
    narrativeTargetTags: slot.narrativeBeat.targetTags,
    narrativeRole: slot.narrativeBeat.role,
    allowIntentionalContrast: slot.narrativeBeat.allowIntentionalContrast
      || overrides?.preferredAlignmentType === 'intentional_contrast',
    keywordEvent: slot.keywordEvent,
  });

  const continuity = memory.lastScene
    ? evaluateContinuityRelation(memory.lastScene, scene, memory, {
        musicalTransitionCue: slot.isDrop
          ? 'entrada do drop'
          : slot.cutType === 'phrase_start'
            ? 'início de frase musical'
            : slot.cutType === 'instrumental_transition'
              ? 'transição instrumental'
              : null,
        allowFlashback: slot.narrativeBeat.nonLinearFunction === 'origin_flashback'
          || slot.narrativeBeat.nonLinearFunction === 'memory_echo',
        allowIntentionalContrast: slot.narrativeBeat.allowIntentionalContrast,
        voiceoverBridgeActive: slot.voiceoverBridgeActive,
      })
    : null;

  let score = continuity
    ? semantic.score * 0.56 + continuity.continuityScore * 0.44
    : semantic.score;

  // Bônus de âncoras do Diretor Narrativo (abertura não linear, clímax e encerramento intencional)
  if (slot.slotIndex === 0 && plan.openingSelection?.sceneId === scene.sceneId) score += 16;
  if (slot.isDrop && plan.climaxSelection?.sceneId === scene.sceneId) score += 18;
  if (slot.slotIndex === totalSlots - 1 && plan.endingStrategy.sceneId === scene.sceneId) score += 15;

  // Escopo não linear por episódio (ex.: cold open tardio seguido de flashback inicial)
  if (slot.narrativeBeat.preferredEpisodeScope === 'late_hook' && (scene.context.episodeProgress >= 0.65 || scene.episodeIndex > 0)) {
    score += 10;
  } else if (slot.narrativeBeat.preferredEpisodeScope === 'early_origin' && scene.episodeIndex === 0 && scene.context.episodeProgress <= 0.5) {
    score += 10;
  }

  // Respiração cinematográfica: valoriza planos longos e contemplativos/expressivos em holds
  if (slot.isBreathingHold) {
    if (scene.durationS >= slot.durationS * 0.95) score += 10;
    if (scene.actionPhase === 'contemplation' || scene.actionPhase === 'reaction' || scene.actionPhase === 'dialogue' || scene.actions.includes('memória') || scene.actions.includes('despedida')) {
      score += 12;
    }
    if (scene.actionPhase === 'impact' && !slot.isDrop) score -= 18;
  }

  // Preferência explícita de tipo de alinhamento do usuário
  if (overrides?.preferredAlignmentType && semantic.alignmentType === overrides.preferredAlignmentType) {
    score += 12;
  }

  // Anti-repetição rigorosa na memória global do feixe
  if (memory.usedSceneIds.includes(scene.sceneId)) {
    score -= 38;
  } else if (memory.lastScene?.fingerprint && scene.fingerprint && memory.lastScene.fingerprint === scene.fingerprint) {
    score -= 28;
  }

  // Rejeição forte de quebras de coerência detectadas pelo ContinuityEngine
  if (continuity?.rejected) {
    score -= 32;
  }

  if (isLocked) score += 200;

  return {
    scene,
    semantic,
    continuity,
    combinedScore: round1(clamp(score, 0, isLocked ? 300 : 100)),
    locked: isLocked,
  };
}

/**
 * Resolve globalmente a sequência inteira de decisões editoriais usando busca em feixe (*Beam Search*)
 * com memória narrativa contextual (`NarrativeContextMemory`) e registro completo de alternativas.
 */
export function solveGlobalEditorialDecisions(input: SolveEditorialDecisionsInput): GlobalEditorialSolution {
  const rejectedSet = new Set(input.overrides?.rejectedSceneIds ?? []);
  const eligibleScenes = input.scenes.filter((s) => !s.excluded && !rejectedSet.has(s.sceneId));
  const slots = planEditorialTimelineSlots({
    plan: input.plan,
    scenes: eligibleScenes,
    musicUnderstanding: input.musicUnderstanding,
    rawSlots: input.rawSlots,
    intensityBias: input.overrides?.intensityBias,
  });
  const audioMap = buildUnifiedAudioEventMap({
    plan: input.plan,
    slots,
    musicUnderstanding: input.musicUnderstanding,
  });

  if (!slots.length || !eligibleScenes.length) {
    return {
      slots,
      decisions: [],
      audioMap,
      averageScore: 0,
      averageConfidence: 0,
    };
  }

  interface BeamPath {
    evals: CandidateEval[];
    memory: NarrativeContextMemory;
    totalScore: number;
  }

  const beamWidth = Math.max(4, Math.min(32, input.beamWidth ?? 18));
  const branchLimit = 8;

  let beam: BeamPath[] = [{
    evals: [],
    memory: createInitialNarrativeMemory(),
    totalScore: 0,
  }];

  for (const slot of slots) {
    const nextBeam: BeamPath[] = [];
    for (const path of beam) {
      const scoredCandidates: CandidateEval[] = [];
      for (const scene of eligibleScenes) {
        const ev = evaluateCandidateForSlot(
          slot,
          slots.length,
          scene,
          path.memory,
          input.plan,
          input.overrides,
          input.semanticWeights,
        );
        if (ev) scoredCandidates.push(ev);
      }

      // Fallback se todos os planos forem mais curtos que 0.6 * slot.durationS
      if (!scoredCandidates.length) {
        const longest = [...eligibleScenes].sort((a, b) => b.durationS - a.durationS)[0]!;
        const fallbackSemantic = evaluateSemanticAlignment(slot.activeMusicEvent, longest);
        scoredCandidates.push({
          scene: longest,
          semantic: fallbackSemantic,
          continuity: path.memory.lastScene ? evaluateContinuityRelation(path.memory.lastScene, longest, path.memory) : null,
          combinedScore: round1(fallbackSemantic.score * 0.7),
          locked: false,
        });
      }

      scoredCandidates.sort((a, b) => b.combinedScore - a.combinedScore || a.scene.sceneId.localeCompare(b.scene.sceneId));
      for (const top of scoredCandidates.slice(0, branchLimit)) {
        nextBeam.push({
          evals: [...path.evals, top],
          memory: advanceNarrativeMemory(path.memory, top.scene),
          totalScore: path.totalScore + top.combinedScore,
        });
      }
    }

    nextBeam.sort((a, b) => b.totalScore - a.totalScore);
    beam = nextBeam.slice(0, beamWidth);
  }

  const winningPath = beam[0]!;
  let replayMemory = createInitialNarrativeMemory();
  const decisions: EditorialDecision[] = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    const chosen = winningPath.evals[i]!;
    const allAtSlot = eligibleScenes
      .map((s) => evaluateCandidateForSlot(slot, slots.length, s, replayMemory, input.plan, input.overrides, input.semanticWeights))
      .filter((x): x is CandidateEval => x !== null && x.scene.sceneId !== chosen.scene.sceneId)
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, 4);

    const alternatives: RejectedSceneAlternative[] = allAtSlot.map((alt) => {
      let whyRejected = `Nota global inferior (${Math.min(100, alt.combinedScore).toFixed(1)} vs ${Math.min(100, chosen.combinedScore).toFixed(1)})`;
      if (chosen.locked) {
        whyRejected = 'Preterida porque o editor travou outra cena neste momento';
      } else if (alt.continuity?.rejected) {
        whyRejected = `Rejeitada por quebra de continuidade (${alt.continuity.explanation})`;
      } else if (replayMemory.usedSceneIds.includes(alt.scene.sceneId)) {
        whyRejected = 'Evitada para impedir repetição visual na montagem';
      } else if (alt.semantic.score + 6 < chosen.semantic.score) {
        whyRejected = `Menor alinhamento semântico/emocional (${alt.semantic.score.toFixed(0)} vs ${chosen.semantic.score.toFixed(0)})`;
      } else if (alt.continuity && chosen.continuity && alt.continuity.continuityScore + 6 < chosen.continuity.continuityScore) {
        whyRejected = `Menor continuidade coreográfica/emocional (${alt.continuity.continuityScore.toFixed(0)} vs ${chosen.continuity.continuityScore.toFixed(0)})`;
      }
      return {
        sceneId: alt.scene.sceneId,
        episodeName: alt.scene.sourceEpisode,
        startTime: alt.scene.startTime,
        endTime: alt.scene.endTime,
        score: round1(Math.min(100, alt.combinedScore)),
        alignmentType: alt.semantic.alignmentType,
        whyRejected,
      };
    });

    const srcIn = chosen.semantic.phraseSync.recommendedSourceInS;
    const srcOut = round3(Math.min(chosen.scene.endTime, srcIn + Math.min(chosen.scene.durationS, Math.max(0.25, slot.durationS))));

    const musicalRelationship = slot.isDrop
      ? `Sincronizado ao drop principal (${slot.startTime.toFixed(1)}s) via corte "${slot.cutType}"`
      : slot.activeMusicEvent.lyrics
        ? `Alinhamento ${chosen.semantic.alignmentType} com "${slot.activeMusicEvent.lyrics.slice(0, 44)}" (${chosen.semantic.phraseSync.mode})`
        : slot.isBreathingHold
          ? `Respiração cinematográfica sustentada por ${slot.durationS.toFixed(1)}s acompanhando "${slot.narrativeBeat.section}"`
          : `Corte "${slot.cutType}" guiado pela seção "${slot.narrativeBeat.section}" (${slot.activeMusicEvent.emotion}, energia ${slot.energy.toFixed(2)})`;

    const narrativeRelationship = `${slot.narrativeBeat.nonLinearFunction} no modelo "${input.plan.narrativeModelLabel}"${chosen.continuity ? ` · ${chosen.continuity.explanation}` : ' · abertura da montagem'}`;

    const coherenceRisks: string[] = [];
    if (chosen.scene.confidence < 0.5) {
      coherenceRisks.push('Confiança visual moderada/baixa (sem análise semântica profunda VLM nesta cena).');
    }
    if (chosen.continuity && chosen.continuity.continuityScore < 45) {
      coherenceRisks.push(`Transição delicada (${chosen.continuity.explanation}).`);
    }

    const displayScore = round1(Math.min(100, chosen.combinedScore));
    const confidence = round3(clamp(
      chosen.semantic.confidence * 0.55 + (chosen.continuity?.confidence ?? chosen.scene.confidence) * 0.45,
      0.25,
      0.98,
    ));

    const reason = [
      chosen.locked ? '[Travada pelo usuário]' : null,
      `${chosen.scene.sourceEpisode} (${chosen.scene.startTime.toFixed(1)}s–${chosen.scene.endTime.toFixed(1)}s)`,
      `tags: ${chosen.scene.actions.slice(0, 3).join(', ')}`,
      musicalRelationship,
      chosen.continuity ? chosen.continuity.explanation : input.plan.openingSelection?.reason ?? null,
    ].filter(Boolean).join(' · ');

    decisions.push({
      slotIndex: slot.slotIndex,
      selectedSceneId: chosen.scene.sceneId,
      episodeName: chosen.scene.sourceEpisode,
      startTime: slot.startTime,
      endTime: slot.endTime,
      sourceStartTime: srcIn,
      sourceEndTime: srcOut,
      cutType: slot.cutType,
      isBreathingHold: slot.isBreathingHold,
      lockedByUser: chosen.locked,
      reason,
      musicalRelationship,
      narrativeRelationship,
      semanticAlignment: chosen.semantic,
      continuityWithPrevious: chosen.continuity,
      alternatives,
      coherenceRisks,
      score: displayScore,
      confidence,
    });

    replayMemory = advanceNarrativeMemory(replayMemory, chosen.scene);
  }

  const averageScore = round1(decisions.reduce((acc, d) => acc + d.score, 0) / decisions.length);
  const averageConfidence = round3(decisions.reduce((acc, d) => acc + d.confidence, 0) / decisions.length);

  return {
    slots,
    decisions,
    audioMap,
    averageScore,
    averageConfidence,
  };
}

/**
 * Responde objetivamente à consulta do usuário: "Por que você escolheu essa cena?"
 */
export function explainEditorialDecision(decision: EditorialDecision, scene?: SceneAnalysis): string {
  const header = `Cena selecionada em ${decision.startTime.toFixed(1)}s–${decision.endTime.toFixed(1)}s: ${decision.episodeName} (${decision.sourceStartTime.toFixed(1)}s–${decision.sourceEndTime.toFixed(1)}s) — nota ${decision.score.toFixed(1)}/100 (confiança ${Math.round(decision.confidence * 100)}%).`;
  const visualLine = scene
    ? `Conteúdo visual: fase "${scene.actionPhase}", classificações [${scene.actions.slice(0, 5).join(', ')}], estado "${scene.characterState}"${scene.characterNames.length ? `, personagens: ${scene.characterNames.join(', ')}` : ''}.`
    : '';
  const musicLine = `Relação musical: ${decision.musicalRelationship} (alinhamento semântico ${decision.semanticAlignment.score.toFixed(0)}/100, tipo "${decision.semanticAlignment.alignmentType}").`;
  const narrativeLine = `Função narrativa e continuidade: ${decision.narrativeRelationship}.`;
  const altLine = decision.alternatives.length
    ? `Principais alternativas descartadas: ${decision.alternatives.slice(0, 2).map((a) => `${a.episodeName} ${a.startTime.toFixed(1)}s (${a.whyRejected})`).join('; ')}.`
    : 'Nenhuma alternativa superior disponível no material analisado.';
  const riskLine = decision.coherenceRisks.length ? `Observações de incerteza: ${decision.coherenceRisks.join(' ')}` : '';
  return [header, visualLine, musicLine, narrativeLine, altLine, riskLine].filter(Boolean).join('\n');
}

/**
 * Responde à consulta do usuário: "Encontre outra cena que combine melhor com essa frase."
 */
export function findAlternativeScenesForPhrase(input: {
  phraseText: string;
  scenes: SceneAnalysis[];
  excludeSceneIds?: string[];
  previousScene?: SceneAnalysis | null;
  allowIntentionalContrast?: boolean;
  limit?: number;
}): Array<{
  scene: SceneAnalysis;
  alignment: SemanticAlignment;
  continuity: ContinuityRelation | null;
  combinedScore: number;
  explanation: string;
}> {
  const hasFights = input.scenes.some((s) => s.actions.includes('combate'));
  const hasDrama = input.scenes.some((s) => s.actions.includes('tristeza') || s.actions.includes('memória'));
  const interpreted = interpretLyricPhrase(input.phraseText, {
    musicEnergy: 0.65,
    bpm: 128,
    animeContext: { hasFights, hasEmotionalDrama: hasDrama },
  });

  const syntheticEvent: CreativeMusicEvent = {
    id: 'query-phrase',
    startTime: 0,
    endTime: 3,
    eventType: 'vocal_phrase',
    lyrics: input.phraseText,
    semanticMeaning: interpreted.meaning,
    emotion: interpreted.meaning.emotionalIntent,
    intensity: interpreted.meaning.arousal,
    confidence: interpreted.confidence,
  };

  const excluded = new Set(input.excludeSceneIds ?? []);
  return input.scenes
    .filter((s) => !s.excluded && !excluded.has(s.sceneId))
    .map((scene) => {
      const alignment = evaluateSemanticAlignment(syntheticEvent, scene, {
        allowIntentionalContrast: input.allowIntentionalContrast,
      });
      const continuity = input.previousScene
        ? evaluateContinuityRelation(input.previousScene, scene)
        : null;
      const combinedScore = round1(
        continuity ? alignment.score * 0.68 + continuity.continuityScore * 0.32 : alignment.score,
      );
      return {
        scene,
        alignment,
        continuity,
        combinedScore,
        explanation: `${scene.sourceEpisode} (${scene.startTime.toFixed(1)}s–${scene.endTime.toFixed(1)}s) — ${alignment.explanation}${continuity ? ` · Continuidade: ${continuity.explanation}` : ''}`,
      };
    })
    .sort((a, b) => b.combinedScore - a.combinedScore || b.scene.confidence - a.scene.confidence)
    .slice(0, input.limit ?? 5);
}
