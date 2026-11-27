/**
 * VISUAL UNDERSTANDING ENGINE (Camada 2 — AMV Creative Intelligence)
 *
 * Analisa episódios de forma contextualizada (não como quadros isolados), produzindo
 * `SceneAnalysis` com classificações semânticas simultâneas nas 24 categorias da especificação,
 * fases coreográficas de ação, vetores direcionais de continuidade visual, presença de
 * personagens/diálogos/confrontos, mudanças de estado físico/emocional e confiança explícita.
 */
import type { ProjectCharacter, SceneAnnotation } from '@amv/project';
import { defaultCreativeAnalysisCache, type CreativeAnalysisCache } from './creative-cache.js';
import type { EpisodeAnalysis, Sequence, Shot, SpeechSegment } from './episode.js';
import type { CameraMotionType, LocalVisualFeatures } from './local-vision.js';
import { normLabel, shotKey, type EpisodeVision, type ShotVision } from './vision.js';

export const VISUAL_UNDERSTANDING_VERSION = 'vu1';

export const SCENE_SEMANTIC_TAGS = [
  'combate',
  'preparação_combate',
  'ataque',
  'defesa',
  'esquiva',
  'contra_ataque',
  'impacto',
  'transformação',
  'superação',
  'derrota',
  'vitória',
  'desespero',
  'determinação',
  'tristeza',
  'felicidade',
  'revelação',
  'despedida',
  'sacrifício',
  'memória',
  'reação',
  'diálogo',
  'suspense',
  'descoberta',
  'confronto_emocional',
] as const;

export type SceneSemanticTag = (typeof SCENE_SEMANTIC_TAGS)[number];

export type ActionPhase =
  | 'preparation'
  | 'attack'
  | 'defense'
  | 'dodge'
  | 'counter'
  | 'impact'
  | 'reaction'
  | 'aftermath'
  | 'transformation'
  | 'dialogue'
  | 'contemplation'
  | 'environment';

export type MotionDirection =
  | 'left-to-right'
  | 'right-to-left'
  | 'upward'
  | 'downward'
  | 'push-in'
  | 'pull-out'
  | 'radial'
  | 'static'
  | 'unknown';

export type CharacterPhysicalState =
  | 'intact'
  | 'strained'
  | 'debilitated'
  | 'rising'
  | 'transformed'
  | 'victorious'
  | 'defeated'
  | 'calm'
  | 'unknown';

export interface SceneCharacterPresence {
  name: string;
  probableIdentity: string;
  confirmed: boolean;
  position: [number, number] | null;
  expression: string | null;
  confidence: number;
}

export interface SceneTagScore {
  tag: SceneSemanticTag;
  score: number;
  confidence: number;
  evidence: string;
}

export interface SceneEmotionScore {
  emotion: string;
  intensity: number;
  confidence: number;
}

export interface SceneMovementDescriptor {
  intensity: number;
  direction: MotionDirection;
  directionDeg: number | null;
  bodyPosition: 'extreme-close' | 'close' | 'medium' | 'wide' | 'grounded_kneeling' | 'airborne' | 'unknown';
  speed: number;
  confidence: number;
}

export interface SceneCameraDescriptor {
  type: CameraMotionType;
  orientation: 'frontal' | 'profile_left' | 'profile_right' | 'low_angle' | 'high_angle' | 'wide_establishing' | 'unknown';
  scaleChange: 'in' | 'out' | 'none' | 'unknown';
  speed: number;
  confidence: number;
}

export interface SceneContextDescriptor {
  kind: 'combat' | 'dialogue' | 'memory' | 'emotional_confrontation' | 'transition' | 'contemplation' | 'climax';
  locationHint: string;
  hasDialogue: boolean;
  dialogueText: string | null;
  dialogueKind: 'fala' | 'grito' | null;
  dialogueImpact: number;
  dialogueStartS: number | null;
  dialogueEndS: number | null;
  isCompleteThought: boolean;
  hasConfrontation: boolean;
  emotionalReaction: boolean;
  stateChangedFromPrevious: boolean;
  visualIntent: string;
  narrativePotential: SceneSemanticTag[];
  /** Posição relativa no episódio (0 = início, 1 = fim) para detectar clímax tardio / cold open. */
  episodeProgress: number;
}

export interface SceneAnalysis {
  sceneId: string;
  /** Chave estável baseada em hash de conteúdo quando disponível (reutilizável entre projetos). */
  contentKey: string;
  shotKey: string;
  assetId: string;
  assetHash?: string;
  sourceFile: string;
  sourceEpisode: string;
  episodeIndex: number;
  sequenceId: string;
  startTime: number;
  endTime: number;
  peakTime: number;
  durationS: number;
  characters: SceneCharacterPresence[];
  characterNames: string[];
  characterState: CharacterPhysicalState;
  actions: SceneSemanticTag[];
  actionPhase: ActionPhase;
  emotions: SceneEmotionScore[];
  semanticTags: SceneTagScore[];
  movement: SceneMovementDescriptor;
  cameraMotion: SceneCameraDescriptor;
  context: SceneContextDescriptor;
  visualDescription: string;
  intensity: number;
  brightness: number;
  dominantColors: string[];
  fingerprint: string | null;
  deadFrameScore: number;
  textClutterScore: number;
  favorite: boolean;
  excluded: boolean;
  confidence: number;
}

export interface AnalyzeEpisodeScenesInput {
  assetId: string;
  assetHash?: string;
  sourceFile: string;
  sourceEpisode?: string;
  episodeIndex?: number;
  analysis: EpisodeAnalysis;
  vision?: EpisodeVision | null;
  characterLibrary?: ProjectCharacter[];
  sceneAnnotations?: SceneAnnotation[];
  cache?: CreativeAnalysisCache;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAnyTerm(text: string, terms: string[]): boolean {
  if (!text) return false;
  const norm = normalizeText(text);
  return terms.some((term) => norm.includes(normalizeText(term)));
}

function classifyDirection(deg: number | null, camera: CameraMotionType, scaleChange: 'in' | 'out' | 'none' | 'unknown', speed: number): MotionDirection {
  if (camera === 'zoom-in' || scaleChange === 'in') return 'push-in';
  if (camera === 'zoom-out' || scaleChange === 'out') return 'pull-out';
  if (camera === 'rotation') return 'radial';
  if (deg === null || speed < 0.006) {
    return camera === 'static' ? 'static' : 'unknown';
  }
  const normalized = ((deg % 360) + 360) % 360;
  if (normalized <= 45 || normalized >= 315) return 'left-to-right';
  if (normalized >= 135 && normalized <= 225) return 'right-to-left';
  if (normalized > 45 && normalized < 135) return 'downward';
  return 'upward';
}

function resolveCharacters(
  assetId: string,
  sKey: string,
  vision: ShotVision | undefined,
  local: LocalVisualFeatures | undefined,
  library: ProjectCharacter[],
): SceneCharacterPresence[] {
  const out = new Map<string, SceneCharacterPresence>();
  const position = local?.subjectFocus && (local.subjectFocusConfidence ?? 0) >= 0.45
    ? local.subjectFocus
    : null;
  const topExpression = vision?.expressions?.slice().sort((a, b) => b.confidence - a.confidence)[0]?.label ?? null;

  for (const charEntry of library) {
    const ev = charEntry.evidence.find((e) => e.assetId === assetId && e.sceneKey === sKey);
    if (ev) {
      const k = normLabel(charEntry.name);
      out.set(k, {
        name: charEntry.name,
        probableIdentity: charEntry.name,
        confirmed: Boolean(charEntry.confirmed || ev.source === 'user'),
        position,
        expression: topExpression,
        confidence: round3(clamp01(ev.confidence ?? charEntry.confidence ?? (ev.source === 'user' ? 0.98 : 0.72))),
      });
    }
  }

  for (const rawName of vision?.characters ?? []) {
    const clean = rawName.trim();
    if (!clean) continue;
    const norm = normLabel(clean);
    if (out.has(norm)) continue;
    const matchedProfile = library.find(
      (p) => normLabel(p.name) === norm || p.aliases.some((alias) => normLabel(alias) === norm),
    );
    const canonical = matchedProfile?.name ?? clean;
    out.set(normLabel(canonical), {
      name: canonical,
      probableIdentity: canonical,
      confirmed: Boolean(matchedProfile?.confirmed),
      position,
      expression: topExpression,
      confidence: round3(clamp01(vision?.confidence ?? 0.6)),
    });
  }

  return [...out.values()];
}

function findOverlappingSpeech(speechList: SpeechSegment[], shot: Shot): SpeechSegment[] {
  return speechList.filter((sp) => {
    const overlap = Math.min(shot.endS, sp.endS) - Math.max(shot.startS, sp.startS);
    return overlap >= Math.min(0.18, (shot.endS - shot.startS) * 0.25);
  });
}

function inferCharacterState(
  noteAndLine: string,
  shot: Shot,
  vision: ShotVision | undefined,
  prevShot: Shot | undefined,
  inFightSequence: boolean,
): CharacterPhysicalState {
  if (hasAnyTerm(noteAndLine, ['ajoelh', 'ferid', 'machucad', 'sangr', 'kneel', 'wounded', 'bleed', 'hurt', 'exausto', 'exhaust'])) {
    return 'debilitated';
  }
  if (hasAnyTerm(noteAndLine, ['levant', 'ergu', 'rising', 'stands up', 'gets up'])) {
    return 'rising';
  }
  if (hasAnyTerm(noteAndLine, ['transform', 'despert', 'aura', 'awaken', 'forma', 'chamas'])) {
    return 'transformed';
  }
  if (hasAnyTerm(noteAndLine, ['caido', 'derrotad', 'fallen', 'defeated', 'inconsciente'])) {
    return 'defeated';
  }
  if (hasAnyTerm(noteAndLine, ['vitoria', 'sorri vitorioso', 'triunfo', 'victorious'])) {
    return 'victorious';
  }
  if (inFightSequence) {
    if (shot.motion < 0.22 && prevShot && prevShot.intensity >= 0.68) return 'debilitated';
    if (shot.intensity >= 0.62 || vision?.fight) return 'strained';
    return 'intact';
  }
  if (shot.tags.includes('calma') && shot.motion < 0.18) return 'calm';
  return 'unknown';
}

function scoreMultiLabelSemantics(params: {
  shot: Shot;
  prevShot?: Shot;
  nextShot?: Shot;
  sequence?: Sequence;
  vision?: ShotVision;
  local?: LocalVisualFeatures;
  speeches: SpeechSegment[];
  userTags: string[];
  characterState: CharacterPhysicalState;
  direction: MotionDirection;
  episodeProgress: number;
}): {
  tags: SceneTagScore[];
  actionPhase: ActionPhase;
  emotions: SceneEmotionScore[];
  visualIntent: string;
  narrativePotential: SceneSemanticTag[];
} {
  const { shot, prevShot, nextShot, sequence, vision, local, speeches, userTags, characterState, direction, episodeProgress } = params;
  const tagMap = new Map<SceneSemanticTag, SceneTagScore>();
  const addTag = (tag: SceneSemanticTag, score: number, confidence: number, evidence: string) => {
    const s = round3(clamp01(score));
    const c = round3(clamp01(confidence));
    if (s < 0.28) return;
    const prev = tagMap.get(tag);
    if (!prev || s > prev.score) {
      tagMap.set(tag, { tag, score: s, confidence: c, evidence });
    }
  };

  const vConf = typeof vision?.confidence === 'number' && Number.isFinite(vision.confidence) ? vision.confidence : 0;
  const hasTrustedVision = vConf >= 0.55;
  const noteText = `${vision?.note ?? ''} ${userTags.join(' ')}`.trim();
  const speechText = speeches.map((s) => s.text ?? '').join(' ').trim() || (shot.line ?? '');
  const combinedText = `${noteText} ${speechText}`.trim();
  const inFightSeq = sequence?.kind === 'luta' || Boolean(hasTrustedVision && vision?.fight);
  const hasShout = shot.tags.includes('grito') || speeches.some((s) => s.kind === 'grito');
  const hasSpeech = speeches.length > 0 || shot.tags.includes('fala') || Boolean(shot.line?.trim());

  // 1. Combate & Subfases Coreográficas
  if (inFightSeq || (hasTrustedVision && vision?.action === 'combate') || (shot.tags.includes('ação') && shot.intensity >= 0.58)) {
    addTag(
      'combate',
      hasTrustedVision && vision?.fight ? 0.92 : inFightSeq ? 0.8 : 0.66,
      hasTrustedVision ? vConf : inFightSeq ? 0.68 : 0.52,
      hasTrustedVision && vision?.fight ? 'análise visual confirmou confronto' : 'sequência de luta e movimento intenso',
    );
  }

  const risingIntoNext = nextShot !== undefined && nextShot.intensity >= shot.intensity + 0.22 && nextShot.intensity >= 0.62;
  if ((hasTrustedVision && vision?.action === 'preparação')
    || hasAnyTerm(noteText, ['prepar', 'postura', 'stance', 'empunh', 'carregando', 'charging', 'encara'])
    || (inFightSeq && shot.motion < 0.38 && risingIntoNext)) {
    addTag(
      'preparação_combate',
      hasTrustedVision && vision?.action === 'preparação' ? 0.88 : 0.7,
      hasTrustedVision ? vConf : 0.58,
      'tensão/postura antecedendo aumento de intensidade no plano seguinte',
    );
  }

  const isExplicitReaction = (hasTrustedVision && vision?.action === 'reação')
    || hasAnyTerm(noteText, ['recua em reacao', 'golpe sofrido', 'sofre o golpe', 'atingido pelo golpe']);

  if (!isExplicitReaction && (
    hasAnyTerm(noteText, ['ataque', 'golpe', 'soco', 'espada', 'corte', 'disparo', 'attack', 'strike', 'slash', 'punch', 'lunge'])
    || (inFightSeq && shot.motion >= 0.55 && (direction === 'left-to-right' || direction === 'right-to-left' || direction === 'push-in') && !shot.tags.includes('calma'))
  )) {
    addTag(
      'ataque',
      hasAnyTerm(noteText, ['ataque', 'golpe', 'soco', 'attack', 'strike', 'slash']) ? 0.9 : 0.74,
      hasTrustedVision ? vConf : Math.max(0.54, local?.motionConfidence ?? 0.54),
      `avanço ofensivo detectado (${direction})`,
    );
  }

  if (hasAnyTerm(noteText, ['defesa', 'bloquei', 'escudo', 'aparando', 'block', 'defend', 'guard', 'parry'])) {
    addTag('defesa', 0.86, Math.max(0.62, vConf), 'bloqueio/defesa descrito na cena');
  } else if (inFightSeq && prevShot && prevShot.motion >= 0.6 && shot.motion >= 0.32 && shot.motion <= 0.55 && direction === 'pull-out') {
    addTag('defesa', 0.58, 0.48, 'recuo controlado após ataque intenso');
  }

  if (hasAnyTerm(noteText, ['esquiv', 'desvi', 'salto lateral', 'dodge', 'evade', 'sidestep'])
    || (inFightSeq && hasTrustedVision && vision?.action === 'perseguição' && shot.motion >= 0.58)) {
    addTag('esquiva', hasAnyTerm(noteText, ['esquiv', 'desvi', 'dodge', 'evade']) ? 0.86 : 0.64, Math.max(0.55, vConf), 'movimento rápido de evasão/deslocamento');
  }

  if (hasAnyTerm(noteText, ['contra-ataque', 'contra ataque', 'revid', 'counter'])
    || (inFightSeq && prevShot && prevShot.tags.includes('impacto') && shot.tags.includes('impacto') && direction !== 'unknown')) {
    addTag('contra_ataque', hasAnyTerm(noteText, ['contra-ataque', 'contra ataque', 'revid', 'counter']) ? 0.88 : 0.66, Math.max(0.54, vConf), 'resposta ofensiva imediata após impacto anterior');
  }

  if (shot.tags.includes('impacto') || (shot.tags.includes('clarão') && shot.motion >= 0.5) || hasAnyTerm(noteText, ['impacto', 'explos', 'colisao', 'choque', 'impact', 'explosion'])) {
    addTag(
      'impacto',
      shot.tags.includes('impacto') ? 0.92 : 0.8,
      shot.tags.includes('impacto') ? 0.82 : Math.max(0.6, vConf),
      'pico simultâneo de movimento, energia sonora ou clarão de colisão',
    );
  }

  // 2. Estados Dramáticos, Emoções e Arco de Personagem
  if (characterState === 'transformed' || (shot.tags.includes('clarão') && hasShout && shot.intensity >= 0.72)) {
    addTag('transformação', characterState === 'transformed' ? 0.9 : 0.68, characterState === 'transformed' ? Math.max(0.68, vConf) : 0.52, 'mudança intensa de estado/energia com clarão ou despertar');
  }

  const determinedVision = (hasTrustedVision && vision?.emotion === 'determinação')
    || (vision?.expressions ?? []).some((e) => e.confidence >= 0.55 && hasAnyTerm(e.label, ['determin', 'firme', 'resolut']));
  if (determinedVision || hasAnyTerm(combinedText, ['nao vou desistir', 'nunca desist', 'eu juro', 'vou vencer', 'continuar', 'never give up', 'i swear', 'determin'])) {
    addTag('determinação', determinedVision ? 0.9 : 0.78, determinedVision ? vConf : 0.66, 'expressão ou fala de determinação firme');
  }

  if (characterState === 'debilitated' && (tagMap.has('determinação') || risingIntoNext || hasShout)
    || characterState === 'rising'
    || hasAnyTerm(combinedText, ['supera', 'ergue', 'levantar de novo', 'alem do limite', 'surpass', 'stand back up'])) {
    addTag('superação', 0.88, Math.max(0.62, vConf || 0.62), 'personagem debilitado/em ascensão reagindo com resistência ou virada');
  }

  if (characterState === 'defeated' || hasAnyTerm(combinedText, ['derrota', 'perdemos', 'acabou', 'nao consigo', 'defeat', 'we lost'])) {
    addTag('derrota', characterState === 'defeated' ? 0.86 : 0.72, Math.max(0.58, vConf || 0.58), 'queda física ou fala reconhecendo derrota');
  }

  if (characterState === 'victorious' || (episodeProgress >= 0.78 && inFightSeq && prevShot?.tags.includes('impacto') && shot.motion < 0.3 && shot.brightness >= 0.45 && !hasAnyTerm(combinedText, ['derrota', 'morrer']))) {
    addTag('vitória', characterState === 'victorious' ? 0.88 : 0.6, characterState === 'victorious' ? Math.max(0.68, vConf) : 0.46, 'desfecho estabilizado após confronto ou postura vitoriosa');
  }

  if ((hasTrustedVision && vision?.emotion === 'medo') || hasAnyTerm(combinedText, ['desespero', 'socorro', 'impossivel', 'medo', 'pavor', 'despair', 'hopeless', 'afraid'])) {
    addTag('desespero', 0.84, Math.max(0.6, vConf || 0.6), 'sinal emocional/verbal de medo extremo ou desespero');
  }

  if ((hasTrustedVision && vision?.emotion === 'tristeza')
    || (vision?.expressions ?? []).some((e) => e.confidence >= 0.55 && hasAnyTerm(e.label, ['triste', 'sad', 'cry', 'chora', 'lagrima']))
    || hasAnyTerm(combinedText, ['triste', 'chor', 'lagrima', 'dor', 'perdi', 'sozinho', 'sad', 'tears'])) {
    addTag('tristeza', hasTrustedVision && vision?.emotion === 'tristeza' ? 0.9 : 0.76, Math.max(0.6, vConf || 0.6), 'expressão de tristeza/lágrimas ou fala melancólica');
  }

  if ((hasTrustedVision && vision?.emotion === 'alegria')
    || (vision?.expressions ?? []).some((e) => e.confidence >= 0.55 && hasAnyTerm(e.label, ['alegria', 'sorriso', 'smile', 'happy', 'joy']))
    || hasAnyTerm(combinedText, ['sorriso', 'feliz', 'obrigado', 'conseguimos', 'happy', 'smile'])) {
    addTag('felicidade', hasTrustedVision && vision?.emotion === 'alegria' ? 0.88 : 0.74, Math.max(0.6, vConf || 0.6), 'sorriso/alegria identificada na cena');
  }

  if ((hasTrustedVision && vision?.emotion === 'surpresa') || hasAnyTerm(combinedText, ['verdade', 'entao era voce', 'segredo', 'revel', 'impossivel ser', 'truth', 'secret'])) {
    addTag('revelação', 0.78, Math.max(0.56, vConf || 0.56), 'surpresa ou revelação dramática no diálogo/cena');
  }

  if (hasAnyTerm(combinedText, ['adeus', 'despedida', 'ate logo', 'ultima vez', 'partir', 'goodbye', 'farewell', 'sayonara'])
    || (tagMap.has('tristeza') && direction === 'pull-out' && shot.motion < 0.25)) {
    addTag('despedida', hasAnyTerm(combinedText, ['adeus', 'despedida', 'goodbye', 'farewell', 'sayonara']) ? 0.88 : 0.62, Math.max(0.55, vConf || 0.55), 'afastamento melancólico ou fala explícita de despedida');
  }

  if (hasAnyTerm(combinedText, ['sacrific', 'minha vida', 'fique vivo', 'fuja', 'corra sem mim', 'protect you with my life'])) {
    addTag('sacrifício', 0.86, 0.68, 'entrega/proteção extrema indicada na cena ou fala');
  }

  const softBright = (local?.brightness ?? shot.brightness) >= 0.58 && (local?.saturation ?? 0.5) <= 0.38 && shot.motion < 0.25;
  if (hasAnyTerm(combinedText, ['lembr', 'memoria', 'passado', 'infancia', 'naquele dia', 'flashback', 'remember', 'memory']) || softBright) {
    addTag('memória', hasAnyTerm(combinedText, ['lembr', 'memoria', 'flashback', 'remember']) ? 0.86 : 0.54, hasAnyTerm(combinedText, ['lembr', 'memoria', 'flashback', 'remember']) ? 0.7 : 0.44, 'tom nostálgico/flashback ou referência direta ao passado');
  }

  if ((hasTrustedVision && vision?.action === 'reação')
    || local?.sceneType === 'reaction'
    || (prevShot && prevShot.intensity >= 0.62 && shot.motion < 0.32 && (vision?.framing === 'close-up' || vision?.framing === 'extreme-close-up' || (vision?.faceCount ?? 0) >= 1))) {
    addTag('reação', hasTrustedVision && vision?.action === 'reação' ? 0.88 : 0.72, Math.max(0.56, vConf || (local?.sceneTypeConfidence ?? 0.56)), 'plano de reação/rosto respondendo a evento intenso');
  }

  if (hasSpeech || (hasTrustedVision && vision?.action === 'diálogo') || local?.sceneType === 'dialogue') {
    addTag('diálogo', hasSpeech ? 0.9 : 0.76, hasSpeech ? Math.max(0.75, speeches[0]?.confidence ?? 0.75) : Math.max(0.58, vConf), 'fala ativa ou cena conversacional detectada');
  }

  if ((hasTrustedVision && vision?.action === 'tensão')
    || local?.sceneType === 'tension'
    || (shot.brightness < 0.26 && shot.motion < 0.32 && risingIntoNext)) {
    addTag('suspense', 0.76, Math.max(0.52, vConf || (local?.sceneTypeConfidence ?? 0.52)), 'atmosfera tensa antecedendo escalada');
  }

  if (hasAnyTerm(combinedText, ['descobr', 'encontr', 'olha isso', 'o que e isso', 'novo mundo', 'discover', 'found it'])
    || (vision?.framing === 'wide' && direction === 'push-in' && shot.brightness >= 0.5 && !inFightSeq)) {
    addTag('descoberta', 0.68, 0.54, 'abertura visual ou descoberta contextual');
  }

  if ((hasSpeech && hasShout && !tagMap.has('ataque'))
    || (hasSpeech && (tagMap.has('tristeza') || tagMap.has('desespero') || tagMap.has('determinação')) && (vision?.faceCount ?? 0) >= 1)) {
    addTag('confronto_emocional', 0.82, 0.66, 'embate verbal/emocional intenso com carga dramática');
  }

  // Garante pelo menos uma classificação coerente mesmo em planos neutros
  if (tagMap.size === 0) {
    if (shot.tags.includes('ação')) addTag('combate', 0.55, 0.45, 'movimento elevado no episódio');
    else addTag('reação', 0.45, 0.38, 'plano de transição/observação');
  }

  const tags = [...tagMap.values()].sort((a, b) => b.score - a.score || b.confidence - a.confidence);

  // Fase coreográfica principal para encadeamento no Continuity Engine
  let actionPhase: ActionPhase = 'environment';
  if (tagMap.has('contra_ataque')) actionPhase = 'counter';
  else if (tagMap.has('impacto') && (shot.tags.includes('impacto') || (tagMap.get('impacto')?.score ?? 0) >= 0.85)) actionPhase = 'impact';
  else if (tagMap.has('defesa')) actionPhase = 'defense';
  else if (tagMap.has('esquiva')) actionPhase = 'dodge';
  else if (tagMap.has('ataque')) actionPhase = 'attack';
  else if (tagMap.has('transformação')) actionPhase = 'transformation';
  else if (tagMap.has('preparação_combate') || tagMap.has('suspense')) actionPhase = 'preparation';
  else if (tagMap.has('reação') && prevShot && prevShot.intensity >= 0.55) actionPhase = 'reaction';
  else if (characterState === 'debilitated' || characterState === 'defeated' || characterState === 'victorious') actionPhase = 'aftermath';
  else if (tagMap.has('diálogo') && shot.motion < 0.35) actionPhase = 'dialogue';
  else if (shot.tags.includes('calma') || local?.sceneType === 'contemplation') actionPhase = 'contemplation';
  else if (tagMap.has('combate')) actionPhase = 'attack';

  // Emoções simultâneas pontuadas
  const emotions: SceneEmotionScore[] = [];
  const pushEmotion = (emotion: string, intensity: number, confidence: number) => {
    if (emotions.some((e) => e.emotion === emotion)) return;
    emotions.push({ emotion, intensity: round3(clamp01(intensity)), confidence: round3(clamp01(confidence)) });
  };
  if (hasTrustedVision && vision?.emotion) {
    pushEmotion(vision.emotion, Math.max(0.55, shot.intensity), vConf);
  }
  if (tagMap.has('determinação')) pushEmotion('determinação', Math.max(0.65, shot.intensity), tagMap.get('determinação')!.confidence);
  if (tagMap.has('tristeza')) pushEmotion('tristeza', 0.72, tagMap.get('tristeza')!.confidence);
  if (tagMap.has('desespero')) pushEmotion('desespero', 0.8, tagMap.get('desespero')!.confidence);
  if (tagMap.has('felicidade')) pushEmotion('felicidade', 0.7, tagMap.get('felicidade')!.confidence);
  if (hasShout && inFightSeq) pushEmotion('raiva', Math.max(0.75, shot.intensity), 0.62);
  if (!emotions.length) {
    pushEmotion(shot.tags.includes('calma') ? 'calma' : shot.intensity >= 0.65 ? 'determinação' : 'neutro', shot.intensity, 0.4);
  }

  const visualIntent =
    characterState === 'debilitated' && tagMap.has('determinação') ? 'resistência'
      : actionPhase === 'preparation' ? 'antecipação'
        : actionPhase === 'impact' || actionPhase === 'counter' ? 'explosão de impacto'
          : tagMap.has('despedida') || tagMap.has('memória') ? 'contemplação emocional'
            : tagMap.has('confronto_emocional') ? 'tensão dramática'
              : actionPhase === 'dialogue' ? 'exposição narrativa'
                : 'progressão visual';

  const narrativePotential: SceneSemanticTag[] = [];
  if (characterState === 'debilitated' || tagMap.has('superação') || characterState === 'rising') narrativePotential.push('superação');
  if (episodeProgress >= 0.72 && (tagMap.has('impacto') || tagMap.has('combate') || tagMap.has('revelação'))) narrativePotential.push('revelação');
  if (tagMap.has('memória') || tagMap.has('tristeza')) narrativePotential.push('memória');
  if (tagMap.has('preparação_combate') || tagMap.has('suspense')) narrativePotential.push('preparação_combate');
  if (tagMap.has('impacto') || tagMap.has('transformação')) narrativePotential.push('impacto');
  if (tagMap.has('despedida') || tagMap.has('vitória') || tagMap.has('derrota')) {
    narrativePotential.push(tagMap.has('despedida') ? 'despedida' : tagMap.has('vitória') ? 'vitória' : 'derrota');
  }

  return { tags, actionPhase, emotions, visualIntent, narrativePotential: [...new Set(narrativePotential)] };
}

/**
 * Constrói `SceneAnalysis[]` completas para um episódio inteiro, considerando vizinhança
 * temporal entre planos, sequências, falas, legendas, descritores ópticos locais, VLM e anotações.
 */
export function analyzeEpisodeScenes(input: AnalyzeEpisodeScenesInput): SceneAnalysis[] {
  const cache = input.cache ?? defaultCreativeAnalysisCache;
  const episodeName = input.sourceEpisode ?? input.sourceFile;
  const episodeIndex = input.episodeIndex ?? 0;
  const visionCount = Object.keys(input.vision?.shots ?? {}).length;
  const annSig = (input.sceneAnnotations ?? [])
    .filter((a) => a.assetId === input.assetId)
    .map((a) => `${a.sceneKey}:${a.favorite ? 1 : 0}:${a.excludedFromAuto ? 1 : 0}:${a.tags.join(',')}`)
    .join('|');
  const charSig = (input.characterLibrary ?? []).map((c) => `${c.id}:${c.name}:${c.confirmed ? 1 : 0}`).join('|');
  const cacheKey = input.assetHash
    ? `${VISUAL_UNDERSTANDING_VERSION}:${input.assetHash}:${input.analysis.version}:${input.analysis.shots.length}:${visionCount}:${annSig}:${charSig}`
    : '';

  const compute = (): SceneAnalysis[] => {
    const shots = input.analysis.shots;
    const sequences = input.analysis.sequences ?? [];
    const annotationsByKey = new Map(
      (input.sceneAnnotations ?? [])
        .filter((a) => a.assetId === input.assetId)
        .map((a) => [a.sceneKey, a]),
    );
    const durationS = Math.max(1, input.analysis.durationS || shots.at(-1)?.endS || 1);

    let prevState: CharacterPhysicalState = 'unknown';

    return shots.map((shot, idx): SceneAnalysis => {
      const sKey = shotKey(shot.startS);
      const sceneId = `${input.assetId}@${shot.startS}`;
      const contentKey = `${input.assetHash ?? input.assetId}@${sKey}`;
      const prevShot = idx > 0 ? shots[idx - 1] : undefined;
      const nextShot = idx + 1 < shots.length ? shots[idx + 1] : undefined;
      const sequence = sequences.find((seq) => shot.startS >= seq.startS - 1e-3 && shot.endS <= seq.endS + 1e-3);
      const sequenceId = sequence ? `${input.assetId}#${sequence.id}` : `${input.assetId}#-`;
      const vision = input.vision?.shots[sKey];
      const local = vision?.local;
      const annotation = annotationsByKey.get(sKey);
      const userTags = annotation?.tags ?? [];
      const speeches = findOverlappingSpeech(input.analysis.speech ?? [], shot);
      const episodeProgress = round3(clamp01(((shot.startS + shot.endS) / 2) / durationS));

      const dominantMotionEvent = local?.motionEvents
        ?.slice()
        .sort((a, b) => b.speed * b.confidence - a.speed * a.confidence)[0];
      const subjectDir = dominantMotionEvent?.subjectMotion.confidence && dominantMotionEvent.subjectMotion.confidence >= 0.55
        ? dominantMotionEvent.subjectMotion.directionDeg
        : dominantMotionEvent?.directionDeg ?? null;
      const cameraType: CameraMotionType = dominantMotionEvent?.cameraMotion ?? 'unknown';
      const scaleChange = dominantMotionEvent?.apparentScaleChange ?? 'unknown';
      const motionSpeed = dominantMotionEvent?.subjectMotion.speed || dominantMotionEvent?.speed || shot.motion;
      const direction = classifyDirection(subjectDir, cameraType, scaleChange, motionSpeed);

      const characters = resolveCharacters(
        input.assetId,
        sKey,
        vision,
        local,
        input.characterLibrary ?? [],
      );
      const noteAndLine = `${vision?.note ?? ''} ${speeches.map((s) => s.text ?? '').join(' ')} ${shot.line ?? ''} ${userTags.join(' ')}`.trim();
      const characterState = inferCharacterState(
        noteAndLine,
        shot,
        vision,
        prevShot,
        sequence?.kind === 'luta' || Boolean(vision?.fight),
      );

      const semantic = scoreMultiLabelSemantics({
        shot,
        prevShot,
        nextShot,
        sequence,
        vision,
        local,
        speeches,
        userTags,
        characterState,
        direction,
        episodeProgress,
      });

      const bodyPosition: SceneMovementDescriptor['bodyPosition'] =
        characterState === 'debilitated' && hasAnyTerm(noteAndLine, ['ajoelh', 'kneel', 'chao', 'ground'])
          ? 'grounded_kneeling'
          : direction === 'upward' && shot.motion >= 0.55
            ? 'airborne'
            : vision?.framing === 'extreme-close-up'
              ? 'extreme-close'
              : vision?.framing === 'close-up'
                ? 'close'
                : vision?.framing === 'medium'
                  ? 'medium'
                  : vision?.framing === 'wide'
                    ? 'wide'
                    : 'unknown';

      const cameraOrientation: SceneCameraDescriptor['orientation'] =
        vision?.framing === 'wide'
          ? 'wide_establishing'
          : direction === 'left-to-right'
            ? 'profile_right'
            : direction === 'right-to-left'
              ? 'profile_left'
              : (vision?.faceCount ?? 0) >= 1
                ? 'frontal'
                : 'unknown';

      const primarySpeech = speeches.slice().sort((a, b) => b.impact - a.impact)[0];
      const dialogueText = primarySpeech?.text?.trim() || shot.line?.trim() || null;
      const isCompleteThought = primarySpeech
        ? primarySpeech.startS >= shot.startS - 0.15 && primarySpeech.endS <= shot.endS + 0.15
        : true;
      const hasConfrontation = semantic.tags.some((t) =>
        ['combate', 'ataque', 'defesa', 'contra_ataque', 'impacto', 'confronto_emocional'].includes(t.tag),
      );
      const stateChangedFromPrevious = prevState !== 'unknown' && characterState !== 'unknown' && prevState !== characterState;
      if (characterState !== 'unknown') prevState = characterState;

      const contextKind: SceneContextDescriptor['kind'] =
        semantic.tags.some((t) => t.tag === 'memória' && t.score >= 0.65) ? 'memory'
          : semantic.tags.some((t) => t.tag === 'confronto_emocional' && t.score >= 0.7) ? 'emotional_confrontation'
            : episodeProgress >= 0.75 && semantic.tags.some((t) => t.tag === 'impacto' || t.tag === 'transformação') ? 'climax'
              : semantic.tags.some((t) => t.tag === 'combate' || t.tag === 'ataque' || t.tag === 'impacto') ? 'combat'
                : semantic.actionPhase === 'dialogue' ? 'dialogue'
                  : semantic.actionPhase === 'contemplation' ? 'contemplation'
                    : 'transition';

      const locationHint = (local?.brightness ?? shot.brightness) < 0.25
        ? 'ambiente escuro / noturno'
        : (local?.brightness ?? shot.brightness) > 0.72
          ? 'ambiente luminoso / aberto'
          : sequence?.kind === 'luta'
            ? 'arena de confronto'
            : 'ambiente interno / dramático';

      const vConfidence = typeof vision?.confidence === 'number' && Number.isFinite(vision.confidence) ? vision.confidence : null;
      const localConfidence = local ? Math.max(0.52, local.sceneTypeConfidence, local.motionConfidence) : null;
      const speechConfidence = primarySpeech?.confidence ?? null;
      const overallConfidence = round3(clamp01(
        vConfidence !== null && localConfidence !== null
          ? vConfidence * 0.6 + localConfidence * 0.4
          : vConfidence !== null
            ? vConfidence * 0.85 + 0.1
            : localConfidence !== null
              ? localConfidence * 0.8 + (speechConfidence ? 0.12 : 0)
              : speechConfidence !== null
                ? 0.48 + speechConfidence * 0.2
                : 0.38,
      ));

      const effectiveIntensity = round3(clamp01(
        vision?.visualIntensity !== undefined && vConfidence !== null && vConfidence >= 0.55
          ? shot.intensity * 0.65 + vision.visualIntensity * 0.35
          : shot.intensity,
      ));

      const descriptionParts: string[] = [];
      if (characters.length) descriptionParts.push(`Personagens: ${characters.map((c) => c.name).join(', ')}`);
      if (vision?.note?.trim()) descriptionParts.push(vision.note.trim());
      else descriptionParts.push(`Fase: ${semantic.actionPhase} (${semantic.tags.slice(0, 3).map((t) => t.tag).join(', ')})`);
      if (dialogueText) descriptionParts.push(`Fala: "${dialogueText}"`);

      return {
        sceneId,
        contentKey,
        shotKey: sKey,
        assetId: input.assetId,
        ...(input.assetHash ? { assetHash: input.assetHash } : {}),
        sourceFile: input.sourceFile,
        sourceEpisode: episodeName,
        episodeIndex,
        sequenceId,
        startTime: shot.startS,
        endTime: shot.endS,
        peakTime: shot.peakS,
        durationS: round3(shot.endS - shot.startS),
        characters,
        characterNames: characters.map((c) => c.name),
        characterState,
        actions: semantic.tags.map((t) => t.tag),
        actionPhase: semantic.actionPhase,
        emotions: semantic.emotions,
        semanticTags: semantic.tags,
        movement: {
          intensity: shot.motion,
          direction,
          directionDeg: subjectDir !== null ? round3(subjectDir) : null,
          bodyPosition,
          speed: round3(clamp01(motionSpeed)),
          confidence: round3(clamp01(dominantMotionEvent?.confidence ?? (local ? 0.55 : 0.35))),
        },
        cameraMotion: {
          type: cameraType,
          orientation: cameraOrientation,
          scaleChange,
          speed: round3(clamp01(dominantMotionEvent?.speed ?? 0)),
          confidence: round3(clamp01(dominantMotionEvent?.confidence ?? 0)),
        },
        context: {
          kind: contextKind,
          locationHint,
          hasDialogue: speeches.length > 0 || Boolean(dialogueText),
          dialogueText,
          dialogueKind: primarySpeech?.kind ?? (shot.tags.includes('grito') ? 'grito' : dialogueText ? 'fala' : null),
          dialogueImpact: round3(primarySpeech?.impact ?? 0),
          dialogueStartS: primarySpeech?.startS ?? null,
          dialogueEndS: primarySpeech?.endS ?? null,
          isCompleteThought,
          hasConfrontation,
          emotionalReaction: semantic.tags.some((t) => t.tag === 'reação' || t.tag === 'confronto_emocional'),
          stateChangedFromPrevious,
          visualIntent: semantic.visualIntent,
          narrativePotential: semantic.narrativePotential,
          episodeProgress,
        },
        visualDescription: descriptionParts.join(' · '),
        intensity: effectiveIntensity,
        brightness: round3(local?.brightness ?? shot.brightness),
        dominantColors: local?.dominantColors ?? [],
        fingerprint: local?.fingerprint ?? null,
        deadFrameScore: round3(local?.deadFrameScore ?? 0),
        textClutterScore: round3(local?.textClutterScore ?? 0),
        favorite: Boolean(annotation?.favorite),
        excluded: Boolean(annotation?.excludedFromAuto),
        confidence: overallConfidence,
      };
    });
  };

  if (cacheKey) {
    const { value: baseScenes } = cache.getOrComputeVisual(cacheKey, compute) as { value: SceneAnalysis[]; fromCache: boolean };
    if (
      !baseScenes.length
      || (baseScenes[0]!.assetId === input.assetId
        && baseScenes[0]!.sourceEpisode === episodeName
        && baseScenes[0]!.episodeIndex === episodeIndex)
    ) {
      return baseScenes;
    }
    return baseScenes.map((scene) => {
      const seqSuffix = scene.sequenceId.split('#')[1] ?? '-';
      return {
        ...scene,
        sceneId: `${input.assetId}@${scene.startTime}`,
        assetId: input.assetId,
        sourceFile: input.sourceFile,
        sourceEpisode: episodeName,
        episodeIndex,
        sequenceId: `${input.assetId}#${seqSuffix}`,
      };
    });
  }
  return compute();
}
