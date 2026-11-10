import { normLabel, visualSimilarity, type LocalVisualFeatures, type Shot, type ShotVision } from '@amv/analysis';
import type { NarrativeRole } from './narrative.js';
import type { OrganizationMode } from './sequence-planner.js';
import type { EditorialDirection } from './styles.js';
import type { StyleDef } from './styles.js';

type VisualEvidence = Pick<ShotVision, 'action' | 'characters' | 'confidence' | 'emotion' | 'fight' | 'framing' | 'framingConfidence' | 'expressions' | 'sceneType' | 'sceneTypeConfidence'>;

export interface SceneScoringInput {
  shot: Shot;
  effectiveIntensity?: number;
  targetIntensity: number;
  musicEnergy: number;
  isDrop: boolean;
  narrativeRole?: NarrativeRole;
  style: Pick<StyleDef, 'id' | 'narrative' | 'sceneBias'>;
  current: { assetId: string; sequenceId: string; sourceStartS: number };
  previous?: { assetId: string; sequenceId: string; sourceEndS: number; vision?: VisualEvidence; local?: LocalVisualFeatures };
  vision?: VisualEvidence;
  local?: LocalVisualFeatures;
  lyricMatchScore?: number;
  organizationMode?: OrganizationMode;
  editorialDirection?: EditorialDirection;
  transitionCue?: string | null;
  sourceJumpS?: number | null;
}

export interface SceneScoreBreakdown {
  music: number;
  action: number;
  emotion: number;
  narrative: number;
  transition: number;
  diversity: number;
  lyric: number;
  visual: number;
  total: number;
  reasons: string[];
}

const TRUSTED_VISION_CONFIDENCE = 0.55;

function trusted(vision: VisualEvidence | undefined): vision is VisualEvidence & { confidence: number } {
  const confidence = vision?.confidence;
  return typeof confidence === 'number'
    && Number.isFinite(confidence)
    && confidence >= TRUSTED_VISION_CONFIDENCE
    && confidence <= 1;
}

function sharedCharacter(a: VisualEvidence | undefined, b: VisualEvidence | undefined): boolean {
  if (!trusted(a) || !trusted(b)) return false;
  const names = new Set(a.characters.map(normLabel).filter(Boolean));
  return b.characters.some((name) => !!normLabel(name) && names.has(normLabel(name)));
}

function actionTransition(previous: VisualEvidence | undefined, current: VisualEvidence | undefined): boolean {
  if (!trusted(previous) || !trusted(current)) return false;
  return (previous.action === 'preparação' && current.action === 'combate')
    || (previous.action === 'combate' && current.action === 'reação');
}

function motionTransition(
  previous: LocalVisualFeatures | undefined,
  current: LocalVisualFeatures | undefined,
  cue: string | null | undefined,
): { score: number; reason: string | null } {
  const end = previous?.motionEvents?.at(-1);
  const start = current?.motionEvents?.[0];
  if (!end || !start || end.confidence < 0.6 || start.confidence < 0.6) return { score: 0, reason: null };
  const movingEnd = Math.max(end.speed, end.scaleSpeed) >= 0.025 || end.cameraMotion === 'rotation';
  const movingStart = Math.max(start.speed, start.scaleSpeed) >= 0.025 || start.cameraMotion === 'rotation';
  const directionDot = end.directionDeg !== null && start.directionDeg !== null
    ? Math.cos((end.directionDeg - start.directionDeg) * Math.PI / 180)
    : null;
  const sameRadialMotion = end.cameraMotion === start.cameraMotion
    && ['zoom-in', 'zoom-out', 'rotation'].includes(end.cameraMotion);
  const compatible = movingEnd && movingStart && (sameRadialMotion || (directionDot !== null && directionDot >= 0.65));
  if (compatible) return { score: 0.12, reason: 'continuidade de movimento com direção semelhante entre cenas' };

  const intentionalContrast = cue !== null && cue !== undefined
    && (cue.includes('entrada do drop') || cue.includes('contraste de energia musical'))
    && ((directionDot !== null && directionDot <= -0.35)
      || (end.cameraMotion === 'zoom-in' && start.cameraMotion === 'zoom-out')
      || (end.cameraMotion === 'zoom-out' && start.cameraMotion === 'zoom-in')
      || movingEnd !== movingStart);
  if (intentionalContrast) return { score: 0.1, reason: 'contraste de movimento alinhado a uma mudança musical' };
  if (movingEnd && (!movingStart || (directionDot !== null && directionDot < -0.35)
    || end.cameraMotion === 'zoom-in' && start.cameraMotion === 'zoom-out'
    || end.cameraMotion === 'zoom-out' && start.cameraMotion === 'zoom-in')) {
    return { score: -0.1, reason: 'possível interrupção de movimento sem contraste musical explícito' };
  }
  return { score: 0, reason: null };
}

/**
 * Additive ranking signals, not an artistic-quality or probability score.
 * Technical-quality dimensions stay absent until the analyzer can measure them.
 */
export function scoreSceneCandidate(input: SceneScoringInput): SceneScoreBreakdown {
  const { shot, style, current, previous, vision } = input;
  const reasons: string[] = [];
  const sceneIntensity = input.effectiveIntensity ?? shot.intensity;
  const music = 1 - Math.abs(input.targetIntensity - sceneIntensity) * 1.6;
  if (Math.abs(input.targetIntensity - sceneIntensity) <= 0.2) reasons.push('energia visual próxima da meta musical');
  else reasons.push('energia visual distante da meta; outros critérios podem justificar a escolha');

  let narrative = 0;
  if (input.narrativeRole === 'opening') {
    if (shot.tags.includes('calma')) narrative += 0.18;
    if (sceneIntensity > 0.82) narrative -= 0.12;
  } else if (input.narrativeRole === 'build' && shot.tags.includes('ação') && sceneIntensity >= 0.35) {
    narrative += 0.08;
  } else if (input.narrativeRole === 'climax') {
    if (shot.tags.includes('impacto')) narrative += 0.2;
    if (shot.tags.includes('ação')) narrative += 0.08;
  } else if (input.narrativeRole === 'release') {
    if (shot.tags.includes('calma')) narrative += 0.2;
    if (sceneIntensity > 0.8) narrative -= 0.12;
  } else if (input.narrativeRole === 'ending' && shot.motion < 0.45) {
    narrative += 0.1;
  }
  if (narrative > 0) reasons.push('compatível com a direção narrativa da seção');
  else if (narrative < 0) reasons.push('menos compatível com a direção narrativa da seção');

  let action = 0;
  if (style.sceneBias === 'impact') {
    if (shot.tags.includes('impacto')) action += 0.32;
    if (shot.tags.includes('ação')) action += 0.12;
    if (shot.tags.includes('calma')) action -= 0.22;
  }
  if (input.editorialDirection === 'hype') {
    if (shot.tags.includes('impacto')) action += 0.18;
    if (trusted(vision) && vision.fight) action += 0.12;
  }
  if (input.isDrop && shot.tags.includes('impacto')) action += 0.5;
  if (input.musicEnergy > 0.7 && shot.tags.includes('ação')) action += 0.15;
  if (input.musicEnergy < 0.35 && shot.tags.includes('calma')) action += 0.2;
  if (shot.tags.includes('fala') && style.id !== 'discurso') action -= 0.08;
  if (vision && (vision.confidence === undefined || trusted(vision))) {
    if (vision.fight) action += input.musicEnergy > 0.5 ? 0.1 : 0;
    else action += input.musicEnergy > 0.5 ? -0.35 : 0.1;
  }
  if (trusted(vision)) {
    if (input.musicEnergy >= 0.65 && (vision.action === 'combate' || vision.action === 'perseguição')) action += 0.14;
    if (input.musicEnergy <= 0.35 && (vision.action === 'diálogo' || vision.action === 'ambiente' || vision.action === 'preparação')) action += 0.12;
  }
  const trustedFraming = trusted(vision) && (vision.framingConfidence ?? vision.confidence) >= TRUSTED_VISION_CONFIDENCE;
  if (trustedFraming && input.editorialDirection === 'cinematic' && vision.framing === 'wide') {
    action += 0.08;
    reasons.push('enquadramento amplo favorece a direção cinematográfica');
  }
  if (trustedFraming && input.editorialDirection === 'hype' && vision.framing === 'close-up' && input.musicEnergy >= 0.65) {
    action += 0.08;
    reasons.push('close-up confiável reforça o impacto no trecho intenso');
  }
  if (input.local && input.local.globalMotion >= 0.45 && input.musicEnergy >= 0.65) {
    action += 0.05;
    reasons.push('movimento global da imagem detectado no trecho intenso');
  }
  const localType = input.local?.sceneTypeConfidence !== undefined && input.local.sceneTypeConfidence >= TRUSTED_VISION_CONFIDENCE
    ? input.local.sceneType
    : undefined;
  const semanticType = trusted(vision) && (vision.sceneTypeConfidence ?? vision.confidence) >= TRUSTED_VISION_CONFIDENCE
    ? vision.sceneType
    : undefined;
  const sceneType = semanticType ?? localType;
  if (sceneType === 'action' && input.musicEnergy >= 0.55) action += 0.12;
  if (sceneType === 'dialogue' && style.id === 'discurso') action += 0.1;
  if (sceneType === 'dialogue' && style.id !== 'discurso' && input.musicEnergy >= 0.65) action -= 0.08;
  if (sceneType === 'tension' && (input.narrativeRole === 'build' || input.musicEnergy >= 0.45)) action += 0.1;
  if (sceneType === 'reaction' && input.narrativeRole !== 'climax') action += 0.08;
  const visualActionFit = trusted(vision) && (
    (input.musicEnergy >= 0.65 && (vision.action === 'combate' || vision.action === 'perseguição'))
    || (input.musicEnergy <= 0.35 && (vision.action === 'diálogo' || vision.action === 'ambiente' || vision.action === 'preparação'))
  );
  if (action > 0) reasons.push(
    visualActionFit ? 'ação visual apoiada por análise com confiança suficiente'
      : vision?.confidence === undefined && vision?.fight ? 'rótulo de luta visual (confiança não registrada)'
        : 'tags locais de ação compatíveis com o ritmo',
  );
  else if (action < 0 && trusted(vision) && !vision.fight) reasons.push('análise visual confiável não identifica luta para este trecho intenso');

  let emotion = 0;
  if (style.sceneBias === 'emotion') {
    if (shot.tags.includes('calma')) emotion += 0.24;
    if (trusted(vision) && (vision.emotion === 'tristeza' || vision.emotion === 'calma')) emotion += 0.32;
    if (style.id === 'emocional' && trusted(vision) && (vision.emotion === 'tristeza' || vision.emotion === 'calma')) emotion += 0.12;
  } else if (style.id === 'superacao' && trusted(vision) && vision.emotion === 'determinação') {
    emotion += 0.12;
  }
  const expressiveMatch = trusted(vision) && (vision.expressions ?? []).some((expression) =>
    expression.confidence >= TRUSTED_VISION_CONFIDENCE
      && ((style.sceneBias === 'emotion' && ['tristeza', 'calma', 'medo'].includes(normLabel(expression.label)))
        || (style.id === 'superacao' && normLabel(expression.label) === 'determinacao')),
  );
  if (expressiveMatch) {
    emotion += 0.12;
    reasons.push('expressão facial visível e confiável compatível com o estilo');
  }
  if (input.editorialDirection === 'cinematic') {
    if (shot.tags.includes('calma') || shot.tags.includes('fala')) emotion += 0.08;
    if (trusted(vision) && (vision.action === 'preparação' || vision.action === 'reação')) emotion += 0.12;
  }
  if (emotion > 0 && trusted(vision) && vision.emotion) reasons.push(`emoção visual identificada (${vision.emotion})`);
  else if (emotion > 0 && shot.tags.includes('calma')) reasons.push('tag local de cena calma (heurística, não emoção identificada)');

  let transition = 0;
  let diversity = 0;
  let visual = 0;
  if (previous) {
    if (previous.assetId === current.assetId) {
      diversity -= 0.12;
      const narrativeWeight = Math.max(0.7, style.narrative);
      if (current.sourceStartS < previous.sourceEndS) {
        transition -= 0.15 * narrativeWeight;
      } else {
        transition += 0.1 * narrativeWeight;
        if (input.current.sequenceId && input.current.sequenceId === previous.sequenceId) {
          transition += 0.3;
          transition += current.sourceStartS >= previous.sourceEndS - 0.05
            ? 0.25 * Math.exp(-(current.sourceStartS - previous.sourceEndS) / 12)
            : -0.25;
        }
      }
    } else if (input.current.sequenceId && input.current.sequenceId !== previous.sequenceId) {
      transition -= 0.1;
    }

    if (sharedCharacter(previous.vision, vision)) {
      transition += 0.08;
      reasons.push('personagem em comum nas cenas consecutivas (análise visual confiável)');
    }
    if (previous.local && input.local) {
      const similarity = visualSimilarity(previous.local, input.local);
      if (similarity >= 0.9 && !sharedCharacter(previous.vision, vision)) {
        visual -= 0.24 * ((similarity - 0.88) / 0.12);
        reasons.push('penalidade por repetição de composição visual semelhante');
      } else if (similarity >= 0.9 && sharedCharacter(previous.vision, vision)) {
        visual += 0.06;
        reasons.push('continuidade visual com estrutura e personagem em comum');
      }
    }
    if (actionTransition(previous.vision, vision)) {
      transition += 0.12;
      reasons.push('continuidade visual sugerida entre preparação/ação/reação');
    }
    const movement = motionTransition(previous.local, input.local, input.transitionCue);
    if (movement.score) {
      transition += movement.score;
      if (movement.reason) reasons.push(movement.reason);
    }
    if (input.organizationMode === 'free' && (input.sourceJumpS === null || Math.abs(input.sourceJumpS ?? 0) > 20)) {
      if (input.transitionCue || sharedCharacter(previous.vision, vision) || actionTransition(previous.vision, vision)) {
        reasons.push(`salto livre intencional${input.transitionCue ? ` por ${input.transitionCue}` : ' por continuidade visual'}`);
      } else {
        transition -= 0.35;
        reasons.push('salto temporal livre sem marcador musical ou visual suficiente');
      }
    }
    if (transition > 0 && !reasons.some((reason) => reason.startsWith('continuidade visual') || reason.startsWith('personagem em comum'))) {
      reasons.push('continua a sequência de origem sem retroceder');
    } else if (transition < 0) {
      reasons.push('penalidade de transição por retrocesso ou troca de sequência');
    }
    if (diversity < 0) reasons.push('penalidade leve por permanecer no mesmo episódio');
  }

  const lyric = input.lyricMatchScore === undefined
    ? 0
    : (Math.max(0, Math.min(1, input.lyricMatchScore)) - 0.5) * 2;
  if (lyric > 0) reasons.push('correspondência opcional entre letra e cena');
  else if (lyric < 0) reasons.push('correspondência opcional letra/cena abaixo do ponto neutro');

  return {
    music,
    action,
    emotion,
    narrative,
    transition,
    diversity,
    lyric,
    visual,
    total: music + action + emotion + narrative + transition + diversity + lyric + visual,
    reasons,
  };
}
