/**
 * CONTINUITY & COHERENCE ENGINE (Camada 5 — AMV Creative Intelligence)
 *
 * Avalia continuidade coreográfica de combate (preparação → ataque → impacto → reação/defesa/esquiva/contra-ataque),
 * compatibilidade direcional de movimento entre planos (inclusive de episódios diferentes),
 * continuidade de diálogos, transições emocionais legítimas e memória narrativa contextual (`NarrativeContextMemory`).
 */
import {
  normLabel,
  type ActionPhase,
  type MotionDirection,
  type SceneAnalysis,
} from '@amv/analysis';

export type ContinuityRelationKind =
  | 'combat_chain'
  | 'directional_match'
  | 'cross_episode_match'
  | 'emotional_bridge'
  | 'flashback_cut'
  | 'dialogue_bridge'
  | 'intentional_contrast'
  | 'neutral'
  | 'jarring_jump';

export interface ContinuityDimensions {
  combatChoreography: number;
  motionDirection: number;
  characterContinuity: number;
  emotionalTransition: number;
  dialogueContinuity: number;
  visualTone: number;
}

export interface ContinuityRelation {
  fromSceneId: string;
  toSceneId: string;
  /** Nota consolidada 0..100 (50 = neutro, >= 72 = continuidade forte, < 38 = salto problemático). */
  continuityScore: number;
  dimensions: ContinuityDimensions;
  relationKind: ContinuityRelationKind;
  crossEpisode: boolean;
  rejected: boolean;
  explanation: string;
  confidence: number;
}

export interface NarrativeContextMemory {
  lastScene: SceneAnalysis | null;
  lastCharacter: string | null;
  recentCharacters: string[];
  lastActionPhase: ActionPhase | null;
  combatChainLength: number;
  emotionalState: string;
  valenceHistory: number[];
  activeConflict: boolean;
  establishedCharacters: string[];
  usedSceneIds: string[];
  expectedNextPhases: ActionPhase[];
}

export interface EvaluateContinuityOptions {
  /** Sinal musical explícito no corte (drop, mudança de seção, pausa, frase). */
  musicalTransitionCue?: string | null;
  /** Permite flashback intencional sem penalizar salto temporal/luminoso. */
  allowFlashback?: boolean;
  /** Permite contraste dramático intencional planejado pelo diretor narrativo. */
  allowIntentionalContrast?: boolean;
  /** Indica que a voz do plano anterior continua em L-cut/narração sobre este corte. */
  voiceoverBridgeActive?: boolean;
}

const VALID_COMBAT_FOLLOWUPS: Record<ActionPhase, ActionPhase[]> = {
  preparation: ['attack', 'transformation', 'dodge', 'defense', 'impact'],
  attack: ['impact', 'defense', 'dodge', 'counter', 'reaction'],
  defense: ['counter', 'attack', 'reaction', 'dodge'],
  dodge: ['counter', 'attack', 'preparation'],
  counter: ['impact', 'reaction', 'aftermath'],
  impact: ['reaction', 'aftermath', 'counter', 'attack', 'transformation'],
  reaction: ['preparation', 'attack', 'counter', 'aftermath', 'dialogue', 'contemplation'],
  aftermath: ['contemplation', 'dialogue', 'preparation', 'reaction'],
  transformation: ['attack', 'impact', 'reaction'],
  dialogue: ['reaction', 'preparation', 'dialogue', 'contemplation', 'attack'],
  contemplation: ['dialogue', 'preparation', 'contemplation', 'reaction'],
  environment: ['preparation', 'dialogue', 'contemplation', 'attack'],
};

const EMOTION_VALENCE: Record<string, number> = {
  felicidade: 0.85,
  alegria: 0.85,
  vitória: 0.8,
  esperança: 0.65,
  determinação: 0.45,
  calma: 0.15,
  neutro: 0,
  surpresa: -0.05,
  memória: -0.15,
  raiva: -0.35,
  medo: -0.65,
  tristeza: -0.78,
  desespero: -0.9,
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function sceneValence(scene: SceneAnalysis): number {
  const topEmotion = scene.emotions[0]?.emotion ?? 'neutro';
  if (scene.actions.includes('felicidade')) return 0.85;
  if (scene.actions.includes('desespero') || scene.actions.includes('derrota')) return -0.85;
  if (scene.actions.includes('tristeza') || scene.actions.includes('despedida')) return -0.75;
  if (scene.actions.includes('superação') || scene.actions.includes('determinação')) return 0.48;
  return EMOTION_VALENCE[topEmotion] ?? 0;
}

function sharedCharacters(a: SceneAnalysis, b: SceneAnalysis): string[] {
  const setA = new Set(a.characterNames.map(normLabel).filter(Boolean));
  return b.characterNames.filter((name) => setA.has(normLabel(name)));
}

function evaluateDirectionalCompatibility(
  dirA: MotionDirection,
  dirB: MotionDirection,
  isCombatPair: boolean,
  sameCharacter: boolean,
  sameSequence: boolean,
): { score: number; note: string | null } {
  if (dirA === 'unknown' || dirB === 'unknown') {
    return { score: 58, note: null };
  }
  if (dirA === dirB && dirA !== 'static') {
    return { score: 92, note: `continuidade de vetor de movimento (${dirA})` };
  }
  if ((dirA === 'left-to-right' || dirA === 'right-to-left') && dirB === 'push-in') {
    return { score: 88, note: `avanço lateral (${dirA}) culminando em aproximação de impacto (push-in)` };
  }
  if (dirA === 'push-in' && (dirB === 'pull-out' || dirB === 'radial') && isCombatPair) {
    return { score: 84, note: 'aproximação seguida de expansão de impacto' };
  }
  const oppositeHorizontal = (dirA === 'left-to-right' && dirB === 'right-to-left')
    || (dirA === 'right-to-left' && dirB === 'left-to-right');
  if (oppositeHorizontal) {
    if (isCombatPair && !sameCharacter && sameSequence) {
      // Dois oponentes distintos na MESMA sequência trocando golpe/defesa em eixos opostos colidem legitimamente.
      return { score: 66, note: 'choque frontal de eixos opostos entre adversários da mesma luta' };
    }
    return { score: 18, note: 'quebra de eixo direcional (movimento inverte abruptamente sem ponte)' };
  }
  if (dirA === 'static' && dirB !== 'static') {
    return { score: 64, note: null };
  }
  return { score: 60, note: null };
}

export function createInitialNarrativeMemory(): NarrativeContextMemory {
  return {
    lastScene: null,
    lastCharacter: null,
    recentCharacters: [],
    lastActionPhase: null,
    combatChainLength: 0,
    emotionalState: 'neutro',
    valenceHistory: [],
    activeConflict: false,
    establishedCharacters: [],
    usedSceneIds: [],
    expectedNextPhases: ['preparation', 'dialogue', 'contemplation', 'attack'],
  };
}

export function advanceNarrativeMemory(
  memory: NarrativeContextMemory,
  chosen: SceneAnalysis,
): NarrativeContextMemory {
  const primaryChar = chosen.characterNames[0] ?? memory.lastCharacter;
  const recentCharacters = [...memory.recentCharacters, ...chosen.characterNames].slice(-6);
  const established = new Set([...memory.establishedCharacters, ...chosen.characterNames.map(normLabel).filter(Boolean)]);
  const isCombatPhase = ['preparation', 'attack', 'defense', 'dodge', 'counter', 'impact'].includes(chosen.actionPhase);
  const continuesChain = memory.lastActionPhase !== null
    && (VALID_COMBAT_FOLLOWUPS[memory.lastActionPhase] ?? []).includes(chosen.actionPhase)
    && isCombatPhase;

  return {
    lastScene: chosen,
    lastCharacter: primaryChar ?? null,
    recentCharacters,
    lastActionPhase: chosen.actionPhase,
    combatChainLength: continuesChain ? memory.combatChainLength + 1 : isCombatPhase ? 1 : 0,
    emotionalState: chosen.emotions[0]?.emotion ?? memory.emotionalState,
    valenceHistory: [...memory.valenceHistory.slice(-5), sceneValence(chosen)],
    activeConflict: chosen.context.hasConfrontation || isCombatPhase,
    establishedCharacters: [...established],
    usedSceneIds: [...memory.usedSceneIds, chosen.sceneId],
    expectedNextPhases: VALID_COMBAT_FOLLOWUPS[chosen.actionPhase] ?? ['reaction', 'attack'],
  };
}

/**
 * Avalia `ContinuityRelation` entre duas cenas consecutivas considerando coreografia,
 * direção de movimento, diálogo, emoção, memória narrativa e permissões não lineares.
 */
export function evaluateContinuityRelation(
  fromScene: SceneAnalysis,
  toScene: SceneAnalysis,
  memory?: NarrativeContextMemory,
  options: EvaluateContinuityOptions = {},
): ContinuityRelation {
  const crossEpisode = fromScene.assetId !== toScene.assetId;
  const commonChars = sharedCharacters(fromScene, toScene);
  const sameCharacter = commonChars.length > 0;
  const notes: string[] = [];

  const combatPhases: ActionPhase[] = ['preparation', 'attack', 'defense', 'dodge', 'counter', 'impact'];
  const fromIsCombat = combatPhases.includes(fromScene.actionPhase) || fromScene.actions.includes('combate');
  const toIsCombat = combatPhases.includes(toScene.actionPhase) || toScene.actions.includes('combate');
  const isCombatPair = fromIsCombat && (toIsCombat || toScene.actionPhase === 'reaction' || toScene.actionPhase === 'aftermath');

  // 1. Coreografia de Combate (0..100)
  let combatScore = 60;
  const validFollowups = VALID_COMBAT_FOLLOWUPS[fromScene.actionPhase] ?? [];
  const unrelatedForeignFightJump = !sameCharacter
    && fromScene.characterNames.length > 0
    && toScene.characterNames.length > 0
    && fromScene.sequenceId !== toScene.sequenceId
    && !options.musicalTransitionCue;

  if (isCombatPair) {
    if (unrelatedForeignFightJump && ['attack', 'counter', 'impact'].includes(fromScene.actionPhase) && ['attack', 'counter', 'impact'].includes(toScene.actionPhase)) {
      combatScore = 22;
      notes.push('golpes/impactos isolados desconexos de lutas e personagens diferentes sem preparação');
    } else if (fromScene.actionPhase === 'preparation' && toScene.actionPhase === 'attack') {
      combatScore = 94;
      notes.push('preparação seguida diretamente de ataque');
    } else if (fromScene.actionPhase === 'attack' && (toScene.actionPhase === 'impact' || toScene.actionPhase === 'defense' || toScene.actionPhase === 'dodge')) {
      combatScore = 96;
      notes.push(`ataque conectado a ${toScene.actionPhase === 'impact' ? 'impacto' : toScene.actionPhase === 'defense' ? 'defesa' : 'esquiva'}`);
    } else if ((fromScene.actionPhase === 'defense' || fromScene.actionPhase === 'dodge') && toScene.actionPhase === 'counter') {
      combatScore = 95;
      notes.push('defesa/esquiva convertida em contra-ataque');
    } else if ((fromScene.actionPhase === 'impact' || fromScene.actionPhase === 'counter') && (toScene.actionPhase === 'reaction' || toScene.actionPhase === 'aftermath')) {
      combatScore = 92;
      notes.push('impacto seguido de reação/consequência legível');
    } else if (validFollowups.includes(toScene.actionPhase)) {
      combatScore = 82;
      notes.push(`encadeamento coreográfico válido (${fromScene.actionPhase} → ${toScene.actionPhase})`);
    } else {
      combatScore = 42;
    }

    // Incoerência física: personagem caído/derrotado atacando no ar imediatamente sem se erguer
    if (fromScene.characterState === 'defeated' && toScene.actionPhase === 'attack' && sameCharacter) {
      combatScore = 18;
      notes.push('salto físico incoerente: personagem derrotado/caído ataca sem transição de recuperação');
    }
  }

  // 2. Direção de Movimento (0..100)
  const dirEval = evaluateDirectionalCompatibility(
    fromScene.movement.direction,
    toScene.movement.direction,
    isCombatPair,
    sameCharacter,
    fromScene.sequenceId === toScene.sequenceId,
  );
  if (dirEval.note) notes.push(dirEval.note);

  // 3. Continuidade de Personagem & Elenco (0..100)
  let charScore = 62;
  if (sameCharacter) {
    charScore = crossEpisode ? 92 : 88;
    notes.push(
      crossEpisode
        ? `ponte não linear entre episódios ancorada em ${commonChars.join(', ')}`
        : `continuidade de personagem (${commonChars.join(', ')})`,
    );
  } else if (fromScene.characterNames.length > 0 && toScene.characterNames.length > 0) {
    const knownInMemory = memory
      ? toScene.characterNames.some((c) => memory.establishedCharacters.includes(normLabel(c)))
      : false;
    if (knownInMemory) {
      charScore = 76;
      notes.push('alternância para personagem já estabelecido na narrativa');
    } else if (isCombatPair && fromScene.sequenceId !== toScene.sequenceId && !options.musicalTransitionCue) {
      charScore = 26;
      notes.push('mistura abrupta de personagens desconhecidos em lutas distintas');
    } else {
      charScore = options.musicalTransitionCue ? 68 : 46;
    }
  }

  // 4. Transição Emocional + Prevenção de Whiplash (choro → luta aleatória → sorriso)
  const vFrom = sceneValence(fromScene);
  const vTo = sceneValence(toScene);
  const valenceJump = Math.abs(vTo - vFrom);
  let emotionalScore = 76;
  const isFlashbackTarget = Boolean(options.allowFlashback || toScene.actions.includes('memória'));

  if (options.allowIntentionalContrast) {
    emotionalScore = 84;
    notes.push('contraste emocional intencional autorizado pelo plano de direção');
  } else if (isFlashbackTarget && (fromScene.actions.includes('tristeza') || fromScene.actions.includes('determinação') || fromScene.actionPhase === 'reaction')) {
    emotionalScore = 86;
    notes.push('ponte emocional orgânica para flashback/memória');
  } else if (fromScene.actions.includes('tristeza') && toScene.actions.includes('felicidade') && !toScene.actions.includes('memória') && !options.musicalTransitionCue) {
    emotionalScore = 18;
    notes.push('salto emocional brusco (tristeza → felicidade imediata sem ponte)');
  } else if (fromScene.actions.includes('tristeza') && toIsCombat && !sameCharacter && !toScene.actions.includes('determinação') && !toScene.actions.includes('superação')) {
    emotionalScore = 22;
    notes.push('quebra emocional: cena de tristeza cortada para luta aleatória desconexa');
  } else {
    // Detecta chicote em 3 passos na memória: ex. tristeza (-0.75) -> luta (-0.3) -> sorriso (+0.85)
    const priorValence = memory?.valenceHistory.at(-2);
    if (priorValence !== undefined && priorValence <= -0.6 && fromIsCombat && vTo >= 0.7 && !toScene.actions.includes('vitória')) {
      emotionalScore = 20;
      notes.push('oscilação emocional incoerente em 3 cortes (dor → luta → sorriso sem resolução)');
    } else if (valenceJump <= 0.45) {
      emotionalScore = 88;
    } else if (fromScene.actions.includes('memória') && (toScene.actions.includes('determinação') || toScene.actions.includes('superação'))) {
      emotionalScore = 92;
      notes.push('progressão emocional clássica: memória alimentando determinação');
    } else {
      emotionalScore = options.musicalTransitionCue ? 72 : clamp(82 - valenceJump * 32, 32, 78);
    }
  }

  // 5. Continuidade de Diálogo (0..100)
  let dialogueScore = 75;
  if (fromScene.context.hasDialogue && !fromScene.context.isCompleteThought && !options.voiceoverBridgeActive && fromScene.sceneId !== toScene.sceneId) {
    dialogueScore = 25;
    notes.push('risco de cortar fala incompleta sem manter a voz em L-cut/narração');
  } else if (fromScene.context.hasDialogue && options.voiceoverBridgeActive) {
    dialogueScore = 90;
    notes.push('voz contínua sobre corte visual (L-cut / narração preservada)');
  } else if (fromScene.actionPhase === 'dialogue' && toScene.actionPhase === 'reaction') {
    dialogueScore = 90;
    notes.push('diálogo seguido de plano de reação correspondente');
  }

  // 6. Tom Visual / Luminosidade (0..100)
  const lumaDiff = Math.abs(fromScene.brightness - toScene.brightness);
  const visualTone = isFlashbackTarget || options.musicalTransitionCue?.includes('drop')
    ? 82
    : clamp(92 - lumaDiff * 85, 35, 95);

  const dimensions: ContinuityDimensions = {
    combatChoreography: round1(combatScore),
    motionDirection: round1(dirEval.score),
    characterContinuity: round1(charScore),
    emotionalTransition: round1(emotionalScore),
    dialogueContinuity: round1(dialogueScore),
    visualTone: round1(visualTone),
  };

  // Pesos adaptativos: em pares de combate, coreografia + direção pesam mais; em drama, emoção + diálogo + personagem pesam mais.
  const rawTotal = isCombatPair
    ? dimensions.combatChoreography * 0.34
      + dimensions.motionDirection * 0.24
      + dimensions.characterContinuity * 0.18
      + dimensions.emotionalTransition * 0.12
      + dimensions.dialogueContinuity * 0.06
      + dimensions.visualTone * 0.06
    : dimensions.emotionalTransition * 0.30
      + dimensions.characterContinuity * 0.24
      + dimensions.dialogueContinuity * 0.20
      + dimensions.combatChoreography * 0.10
      + dimensions.motionDirection * 0.08
      + dimensions.visualTone * 0.08;

  // Penalidade de gargalo severo: se coreografia, direção, emoção ou diálogo colapsam (<= 26), derruba a nota global
  const minCritical = Math.min(
    dimensions.combatChoreography,
    dimensions.motionDirection,
    dimensions.emotionalTransition,
    dimensions.dialogueContinuity,
  );
  const bottleneckPenalty = minCritical <= 26 ? (46 - minCritical) * 1.35 : 0;
  const continuityScore = round1(clamp(rawTotal - bottleneckPenalty, 0, 100));

  let relationKind: ContinuityRelationKind = 'neutral';
  if (continuityScore < 38 || minCritical <= 22) relationKind = 'jarring_jump';
  else if (options.allowIntentionalContrast && valenceJump >= 0.6) relationKind = 'intentional_contrast';
  else if (isFlashbackTarget && toScene.actions.includes('memória')) relationKind = 'flashback_cut';
  else if (fromScene.context.hasDialogue && (options.voiceoverBridgeActive || toScene.actionPhase === 'reaction')) relationKind = 'dialogue_bridge';
  else if (isCombatPair && dimensions.combatChoreography >= 82 && dimensions.motionDirection >= 75) {
    relationKind = crossEpisode ? 'cross_episode_match' : 'combat_chain';
  } else if (dimensions.motionDirection >= 85) relationKind = 'directional_match';
  else if (dimensions.emotionalTransition >= 84) relationKind = 'emotional_bridge';

  const rejected = relationKind === 'jarring_jump' && continuityScore < 34;
  const confidence = round3(clamp(fromScene.confidence * 0.5 + toScene.confidence * 0.5, 0.25, 0.96));

  return {
    fromSceneId: fromScene.sceneId,
    toSceneId: toScene.sceneId,
    continuityScore,
    dimensions,
    relationKind,
    crossEpisode,
    rejected,
    explanation: notes.length ? notes.join('; ') : 'transição visual neutra compatível',
    confidence,
  };
}
