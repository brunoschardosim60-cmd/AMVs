import { SCENE_ACTIONS, SCENE_EMOTIONS } from '@amv/analysis';

export const FRAMINGS = ['extreme-close-up', 'close-up', 'medium', 'wide'] as const;
export const SCENE_TYPES = ['action', 'dialogue', 'contemplation', 'tension', 'reaction', 'environment'] as const;

export interface SceneSearchFilters {
  character: string | null;
  action: string | null;
  emotion: string | null;
  framing: string | null;
  sceneType: string | null;
  text: string | null;
}

function isSceneSearchFilters(value: unknown): value is SceneSearchFilters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const nullableString = (item: unknown) => item === null || typeof item === 'string';
  return nullableString(row.character)
    && nullableString(row.action)
    && nullableString(row.emotion)
    && nullableString(row.framing)
    && nullableString(row.sceneType)
    && nullableString(row.text);
}

export function parseSceneSearchFilters(text: string): SceneSearchFilters {
  const cleanText = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const value: unknown = JSON.parse(cleanText);
  if (!isSceneSearchFilters(value)) throw new Error('O modelo não retornou filtros válidos.');
  if (value.action !== null && !SCENE_ACTIONS.includes(value.action as (typeof SCENE_ACTIONS)[number])) throw new Error('A ação retornada não é suportada.');
  if (value.emotion !== null && !SCENE_EMOTIONS.includes(value.emotion as (typeof SCENE_EMOTIONS)[number])) throw new Error('A emoção retornada não é suportada.');
  if (value.framing !== null && !FRAMINGS.includes(value.framing as (typeof FRAMINGS)[number])) throw new Error('O enquadramento retornado não é suportado.');
  if (value.sceneType !== null && !SCENE_TYPES.includes(value.sceneType as (typeof SCENE_TYPES)[number])) throw new Error('O tipo de cena retornado não é suportado.');
  const cleanValue = (item: string | null) => item?.trim() || null;
  return {
    character: cleanValue(value.character),
    action: value.action,
    emotion: value.emotion,
    framing: value.framing,
    sceneType: value.sceneType,
    text: cleanValue(value.text),
  };
}
