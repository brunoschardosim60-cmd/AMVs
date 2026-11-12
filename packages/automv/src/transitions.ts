import type { LocalVisualFeatures, Shot, ShotVision } from '@amv/analysis';
import type { Clip } from '@amv/project';
import type { StyleId } from './styles.js';

type TransitionType = NonNullable<Clip['transitionIn']>['transition'];
type SceneEvidence = Pick<ShotVision, 'characters' | 'action' | 'framing' | 'framingConfidence' | 'confidence'>;

export interface TransitionSceneInput {
  shot: Shot;
  local?: LocalVisualFeatures;
  vision?: SceneEvidence;
}

export interface TransitionChoiceInput {
  outgoing: TransitionSceneInput;
  incoming: TransitionSceneInput;
  musicEnergy: number;
  isDrop: boolean;
  durationS: number;
  direction: 'cinematic' | 'balanced' | 'hype';
  style: StyleId;
}

export interface TransitionChoice {
  transition: Clip['transitionIn'];
  reason: string;
}

const CONFIDENCE = 0.6;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function confidentMotion(scene: TransitionSceneInput, edge: 'first' | 'last') {
  const events = scene.local?.motionEvents ?? [];
  const event = edge === 'first' ? events[0] : events.at(-1);
  return event && event.confidence >= CONFIDENCE && event.cameraMotion !== 'unknown' ? event : undefined;
}

function similarDirection(a: number, b: number, minimum = 0.65): boolean {
  return Math.cos((a - b) * Math.PI / 180) >= minimum;
}

function luminanceDifference(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 1;
  return a.reduce((sum, value, index) => sum + Math.abs(value - b[index]!), 0) / a.length;
}

function compositionSimilarity(a?: LocalVisualFeatures, b?: LocalVisualFeatures): number | null {
  if (!a || !b || a.samples < 2 || b.samples < 2) return null;
  const luma = a.lumaGrid.length === b.lumaGrid.length && a.lumaGrid.length
    ? 1 - luminanceDifference(a.lumaGrid, b.lumaGrid)
    : null;
  const edges = a.edgeGrid.length === b.edgeGrid.length && a.edgeGrid.length
    ? 1 - luminanceDifference(a.edgeGrid, b.edgeGrid)
    : null;
  const colors = a.colorHistogram.length === b.colorHistogram.length && a.colorHistogram.length
    ? 1 - luminanceDifference(a.colorHistogram, b.colorHistogram)
    : null;
  if (edges === null || (luma === null && colors === null)) return null;
  const centerDistance = Math.hypot(
    a.centerOfVisualMass[0] - b.centerOfVisualMass[0],
    a.centerOfVisualMass[1] - b.centerOfVisualMass[1],
  );
  const center = 1 - Math.min(1, centerDistance / Math.SQRT2);
  const components = [
    ...(luma === null ? [] : [[luma, 0.3] as const]),
    ...(edges === null ? [] : [[edges, 0.3] as const]),
    ...(colors === null ? [] : [[colors, 0.2] as const]),
    [center, 0.2] as const,
  ];
  const weight = components.reduce((sum, [, componentWeight]) => sum + componentWeight, 0);
  return weight >= 0.5
    ? components.reduce((sum, [value, componentWeight]) => sum + value * componentWeight, 0) / weight
    : null;
}

function sameCharacter(a?: SceneEvidence, b?: SceneEvidence): boolean {
  if (!a || !b || (a.confidence ?? 0) < CONFIDENCE || (b.confidence ?? 0) < CONFIDENCE) return false;
  const names = new Set(a.characters.map((name) => name.trim().toLocaleLowerCase()).filter(Boolean));
  return b.characters.some((name) => names.has(name.trim().toLocaleLowerCase()));
}

function createTransition(
  transition: TransitionType,
  durationS: number,
  params: Record<string, unknown> = {},
): NonNullable<Clip['transitionIn']> {
  return {
    transition,
    durationUs: Math.round(durationS * 1_000_000),
    params: { curve: 'ease-in-out', ...params },
  };
}

/**
 * Selects an edit from measured scene-pair evidence. A plain cut is the
 * intentional fallback when evidence is weak or the cut is too short.
 */
export function chooseSceneTransition(input: TransitionChoiceInput): TransitionChoice {
  const { outgoing, incoming, musicEnergy, isDrop, durationS, direction, style } = input;
  const energy = clamp01(musicEnergy);
  if (durationS < 0.22) return { transition: null, reason: 'corte seco: duração curta demais para uma transição limpa' };

  const outMotion = confidentMotion(outgoing, 'last');
  const inMotion = confidentMotion(incoming, 'first');
  const sharedCharacter = sameCharacter(outgoing.vision, incoming.vision);
  const similarMovement = !!outMotion && !!inMotion
    && outMotion.speed >= 0.025 && inMotion.speed >= 0.025
    && outMotion.directionDeg !== null && inMotion.directionDeg !== null
    && similarDirection(outMotion.directionDeg, inMotion.directionDeg);
  const actionContinuation = sharedCharacter && similarMovement
    && (outgoing.vision?.action === 'combate' || outgoing.shot.tags.includes('ação'))
    && (incoming.vision?.action === 'combate' || incoming.shot.tags.includes('ação'));

  if (actionContinuation) {
    if (direction !== 'cinematic' && outMotion!.speed >= 0.055 && inMotion!.speed >= 0.055 && durationS >= 0.45 && energy >= 0.5) {
      return {
        transition: createTransition('whip_pan', Math.min(0.28, durationS / 3), {
          intensity: Math.min(0.8, 0.45 + energy * 0.25),
          direction: outMotion!.directionDeg! > 90 || outMotion!.directionDeg! < -90 ? -1 : 1,
          blur: 7,
        }),
        reason: 'whip pan: movimento rápido e alinhado, ação contínua e duração disponível',
      };
    }
    return {
      transition: createTransition('cut_on_action', 0, {}),
      reason: 'corte em ação: movimento e ação continuam entre cenas com personagem em comum',
    };
  }

  const compositionMatch = compositionSimilarity(outgoing.local, incoming.local);
  const outLocal = outgoing.local;
  const inLocal = incoming.local;
  const colorDifference = outLocal && inLocal && outLocal.samples >= 2 && inLocal.samples >= 2
    ? luminanceDifference(outLocal.colorHistogram, inLocal.colorHistogram)
    : 1;
  const framingConfidence = Math.min(outgoing.vision?.framingConfidence ?? 0, incoming.vision?.framingConfidence ?? 0);
  const sameFraming = framingConfidence >= CONFIDENCE
    && outgoing.vision?.framing === incoming.vision?.framing;
  if (durationS >= 0.28 && compositionMatch !== null
    && (compositionMatch >= 0.88 || (sameFraming && compositionMatch >= 0.78 && colorDifference <= 0.12))) {
    return {
      transition: createTransition('match_cut', 0),
      reason: 'match cut: composição/enquadramento e paleta compatíveis favorecem um corte seco',
    };
  }

  const brightnessGap = Math.abs(outgoing.shot.brightness - incoming.shot.brightness);
  const calm = (scene: TransitionSceneInput) => scene.shot.tags.includes('calma')
    || ((scene.vision?.confidence ?? 0) >= CONFIDENCE
      && ['contemplação', 'diálogo', 'ambiente'].includes(scene.vision?.action ?? ''));
  const bothCalm = calm(outgoing) && calm(incoming);
  const allowsDissolve = ['emocional', 'superacao', 'discurso'].includes(style) || direction === 'cinematic';
  if ((direction === 'cinematic' || style === 'discurso' || style === 'superacao')
    && durationS >= 0.7 && energy <= 0.4 && (brightnessGap >= 0.28 || bothCalm)) {
    return {
      transition: createTransition('dip_black', Math.min(0.7, durationS / 2), {}),
      reason: brightnessGap >= 0.28
        ? 'dip to black: separa cenas com luminosidade muito diferente num trecho musical calmo'
        : 'dip to black: cria respiro entre cenas em um trecho musical calmo',
    };
  }

  if (isDrop && energy >= 0.72 && durationS >= 0.3
    && (incoming.shot.tags.includes('impacto') || incoming.shot.intensity >= 0.72)) {
    return {
      transition: createTransition('flash', Math.min(0.16, durationS / 4), { intensity: 0.72, curve: 'linear' }),
      reason: 'flash breve: impacto visual coincide com o drop sem alongar o corte',
    };
  }

  if (allowsDissolve && direction !== 'hype' && style !== 'hype' && style !== 'rapido' && style !== 'letra'
    && durationS >= 0.75 && energy <= 0.38 && bothCalm) {
    return {
      transition: createTransition('dissolve', Math.min(0.45, durationS / 3), {}),
      reason: 'dissolve: planos calmos e longos permitem uma passagem suave',
    };
  }

  if (isDrop && energy >= 0.85 && durationS < 0.4) {
    return { transition: null, reason: 'corte seco: preserva a precisão rítmica do drop' };
  }

  // dip to white para impactos não-drop com alta energia e movimento
  if (!isDrop && energy >= 0.65 && durationS >= 0.35 && durationS <= 1.2
    && direction !== 'cinematic'
    && (incoming.shot.tags.includes('impacto') || incoming.shot.intensity >= 0.72)
    && inMotion && inMotion.speed >= 0.035) {
    return {
      transition: createTransition('dip_white', Math.min(0.14, durationS / 4), {
        intensity: Math.min(0.65, 0.35 + energy * 0.2),
      }),
      reason: 'dip to white breve: impacto visual luminoso fora do drop com movimento de câmera detectado',
    };
  }

  return { transition: null, reason: 'corte seco: não há continuidade visual suficiente para justificar um efeito' };
}
