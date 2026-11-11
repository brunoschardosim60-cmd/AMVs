import { SCENE_EMOTIONS, type SceneEmotion } from '@amv/analysis';
import type { OrganizationMode } from './sequence-planner.js';
import type { EditorialDirection, StyleId } from './styles.js';

export interface CreativeEmphasis {
  action: number;
  emotion: number;
  preferredEmotion: SceneEmotion | null;
}

export interface CreativeProfile {
  id: string;
  name: string;
  style: StyleId;
  intensity: 0 | 1 | 2 | 3;
  editorialDirection: EditorialDirection;
  organizationMode: OrganizationMode;
  focus: 'fight' | 'mix';
  actionEmphasis: number;
  emotionEmphasis: number;
  preferredEmotion: SceneEmotion | null;
  voiceMoments: 0 | 1 | 2 | 3 | 4;
  showText: boolean;
  useEffects: boolean;
  hitSync: boolean;
  adaptiveSpeed: boolean;
}

export const DEFAULT_CREATIVE_PROFILES: readonly CreativeProfile[] = [
  {
    id: 'builtin:combat',
    name: 'Combate em destaque',
    style: 'hype',
    intensity: 3,
    editorialDirection: 'hype',
    organizationMode: 'narrative',
    focus: 'fight',
    actionEmphasis: 85,
    emotionEmphasis: 35,
    preferredEmotion: 'determinação',
    voiceMoments: 1,
    showText: true,
    useEffects: true,
    hitSync: true,
    adaptiveSpeed: true,
  },
  {
    id: 'builtin:cinematic',
    name: 'Cinematográfico',
    style: 'superacao',
    intensity: 1,
    editorialDirection: 'cinematic',
    organizationMode: 'narrative',
    focus: 'mix',
    actionEmphasis: 35,
    emotionEmphasis: 80,
    preferredEmotion: 'tristeza',
    voiceMoments: 2,
    showText: true,
    useEffects: false,
    hitSync: true,
    adaptiveSpeed: true,
  },
  {
    id: 'builtin:chronological',
    name: 'Narrativa cronológica',
    style: 'discurso',
    intensity: 1,
    editorialDirection: 'balanced',
    organizationMode: 'chronological',
    focus: 'mix',
    actionEmphasis: 30,
    emotionEmphasis: 70,
    preferredEmotion: 'determinação',
    voiceMoments: 3,
    showText: true,
    useEffects: false,
    hitSync: true,
    adaptiveSpeed: false,
  },
];

const STYLE_IDS = new Set<StyleId>(['hype', 'rapido', 'superacao', 'letra', 'discurso', 'emocional']);
const EDITORIAL_DIRECTIONS = new Set<EditorialDirection>(['cinematic', 'balanced', 'hype']);
const ORGANIZATION_MODES = new Set<OrganizationMode>(['chronological', 'narrative', 'free']);
const PROFILE_IDS = new Set(DEFAULT_CREATIVE_PROFILES.map((profile) => profile.id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function parseCreativeProfiles(value: unknown): CreativeProfile[] {
  if (!Array.isArray(value)) throw new Error('A biblioteca de perfis criativos precisa ser uma lista.');
  const ids = new Set<string>();
  const names = new Set<string>();
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Perfil criativo ${index + 1} inválido.`);
    const {
      id, name, style, intensity, editorialDirection, organizationMode, focus,
      actionEmphasis, emotionEmphasis, voiceMoments, showText, useEffects, hitSync,
      adaptiveSpeed = true,
      preferredEmotion,
    } = entry;
    if (typeof id !== 'string' || id.trim().length === 0 || PROFILE_IDS.has(id) || ids.has(id)) {
      throw new Error(`O identificador do perfil criativo ${index + 1} é inválido ou duplicado.`);
    }
    if (typeof name !== 'string' || !name.trim() || names.has(name.trim().toLowerCase())) {
      throw new Error(`O nome do perfil criativo ${index + 1} é inválido, vazio ou duplicado.`);
    }
    if (typeof style !== 'string' || !STYLE_IDS.has(style as StyleId)
      || !boundedNumber(intensity, 0, 3)
      || typeof editorialDirection !== 'string' || !EDITORIAL_DIRECTIONS.has(editorialDirection as EditorialDirection)
      || typeof organizationMode !== 'string' || !ORGANIZATION_MODES.has(organizationMode as OrganizationMode)
      || (focus !== 'fight' && focus !== 'mix')
      || !boundedNumber(actionEmphasis, 0, 100)
      || !boundedNumber(emotionEmphasis, 0, 100)
      || (preferredEmotion !== null && (typeof preferredEmotion !== 'string' || !SCENE_EMOTIONS.includes(preferredEmotion as SceneEmotion)))
      || !boundedNumber(voiceMoments, 0, 4)
      || typeof showText !== 'boolean'
      || typeof useEffects !== 'boolean'
      || typeof hitSync !== 'boolean'
      || typeof adaptiveSpeed !== 'boolean') {
      throw new Error(`O perfil criativo "${name.trim()}" contém configurações inválidas.`);
    }
    ids.add(id);
    names.add(name.trim().toLowerCase());
    return {
      id,
      name: name.trim(),
      style: style as StyleId,
      intensity: intensity as CreativeProfile['intensity'],
      editorialDirection: editorialDirection as EditorialDirection,
      organizationMode: organizationMode as OrganizationMode,
      focus,
      actionEmphasis,
      emotionEmphasis,
      preferredEmotion: preferredEmotion as SceneEmotion | null,
      voiceMoments: voiceMoments as CreativeProfile['voiceMoments'],
      showText,
      useEffects,
      hitSync,
      adaptiveSpeed,
    };
  });
}

export function isBuiltInCreativeProfile(profile: CreativeProfile): boolean {
  return PROFILE_IDS.has(profile.id);
}

export function creativeEmphasis(
  profile: Pick<CreativeProfile, 'actionEmphasis' | 'emotionEmphasis' | 'preferredEmotion'>,
): CreativeEmphasis {
  return {
    action: profile.actionEmphasis,
    emotion: profile.emotionEmphasis,
    preferredEmotion: profile.preferredEmotion,
  };
}
