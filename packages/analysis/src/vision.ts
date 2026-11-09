import type { EpisodeAnalysis, Shot } from './episode.js';

/**
 * Visão por cena (opcional, feita por um modelo de IA com visão): quem aparece e se é luta.
 * É guardada à parte da análise de ritmo: custa chamadas ao modelo, então só roda quando a
 * pessoa pede, e pode ser feita aos poucos (retoma de onde parou).
 */
export const VISION_VERSION = 'v2';

export const SCENE_EMOTIONS = ['determinação', 'raiva', 'medo', 'tristeza', 'alegria', 'calma', 'surpresa', 'neutro'] as const;
export const SCENE_ACTIONS = ['combate', 'perseguição', 'preparação', 'reação', 'diálogo', 'ambiente', 'outro'] as const;

export type SceneEmotion = (typeof SCENE_EMOTIONS)[number];
export type SceneAction = (typeof SCENE_ACTIONS)[number];

export interface ShotVision {
  /** Personagens vistos: nome (se o modelo reconheceu) ou descrição curta e estável. */
  characters: string[];
  /** Cena de luta/ação (golpes, ataques, confronto) — e não paisagem, conversa, plateia. */
  fight: boolean;
  /** Nota curta do que acontece. */
  note: string;
  /** Quadros combinados nesta classificação; ausente em análises antigas. */
  samples?: number;
  /** Intensidade visual estimada pelo modelo (0..1), usada só como sinal complementar. */
  visualIntensity?: number;
  /** Emoção visual controlada para selecionar cenas que combinem com o trecho. */
  emotion?: SceneEmotion;
  /** Ação visual controlada para evitar montar cenas de diálogo como golpes. */
  action?: SceneAction;
  /** Confiança do rótulo visual (0..1). */
  confidence?: number;
}

export type VisionScope = 'fights' | 'all';

export interface EpisodeVision {
  version: typeof VISION_VERSION;
  /** Modelo que rotulou (para saber o que foi usado). */
  model: string;
  /** Por cena, pela chave de {@link shotKey}. */
  shots: Record<string, ShotVision>;
}

/** Chave estável de uma cena: o início em centésimos de segundo. */
export const shotKey = (startS: number): string => `t${Math.round(startS * 100)}`;

/** Compara rótulos sem se importar com maiúsculas, acento ou espaços. */
export const normLabel = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export interface VisionTarget {
  startS: number;
  endS: number;
  midS: number;
}

/** Seleciona cenas sem rótulo, priorizando lutas no modo rápido. */
export function selectVisionTargets(
  episode: EpisodeAnalysis,
  labeled: Record<string, ShotVision>,
  scope: VisionScope = 'fights',
  max = scope === 'all' ? Infinity : 120,
): VisionTarget[] {
  const targets: VisionTarget[] = [];
  const seen = new Set<string>();
  const add = (shot: Shot) => {
    const key = shotKey(shot.startS);
    const previous = labeled[key];
    if (seen.has(key) || (previous !== undefined && (scope === 'fights' || (previous.samples ?? 1) >= 3))) return false;
    seen.add(key);
    targets.push({ startS: shot.startS, endS: shot.endS, midS: (shot.startS + shot.endS) / 2 });
    return targets.length >= max;
  };
  if (max <= 0) return targets;
  if (scope === 'all') {
    for (const shot of [...episode.shots].sort((a, b) => a.startS - b.startS)) {
      if (shot.endS - shot.startS < 0.25) continue;
      if (add(shot)) return targets;
    }
    return targets;
  }
  const fights = (episode.sequences ?? []).filter((sequence) => sequence.kind === 'luta').sort((a, b) => b.intensity - a.intensity);
  for (const fight of fights) {
    for (const shot of episode.shots) {
      if (shot.startS < fight.startS - 1e-3 || shot.endS > fight.endS + 1e-3 || shot.tags.includes('escura') || shot.endS - shot.startS < 0.25) continue;
      if (add(shot)) return targets;
    }
  }
  return targets;
}

/** Combina várias amostras da mesma cena; só marca luta quando há maioria clara. */
export function mergeShotVision(samples: ShotVision[]): ShotVision {
  if (!samples.length) throw new Error('é preciso pelo menos uma amostra visual');
  const characters = new Map<string, string>();
  const notes = new Map<string, number>();
  const emotions = new Map<SceneEmotion, number>();
  const actions = new Map<SceneAction, number>();
  const intensities: number[] = [];
  const confidences: number[] = [];
  let fights = 0;
  for (const sample of samples) {
    if (sample.fight) fights++;
    if (sample.emotion) emotions.set(sample.emotion, (emotions.get(sample.emotion) ?? 0) + 1);
    if (sample.action) actions.set(sample.action, (actions.get(sample.action) ?? 0) + 1);
    if (Number.isFinite(sample.visualIntensity)) intensities.push(Math.max(0, Math.min(1, sample.visualIntensity!)));
    if (Number.isFinite(sample.confidence)) confidences.push(Math.max(0, Math.min(1, sample.confidence!)));
    for (const character of sample.characters) {
      const key = normLabel(character);
      if (key && !characters.has(key)) characters.set(key, character);
    }
    const note = sample.note.trim();
    if (note) notes.set(note, (notes.get(note) ?? 0) + 1);
  }
  const note = [...notes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  const majority = <T>(counts: Map<T, number>) => [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const average = (values: number[]) => Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;
  return {
    characters: [...characters.values()],
    fight: fights > samples.length / 2,
    note,
    samples: samples.length,
    ...(intensities.length ? { visualIntensity: average(intensities) } : {}),
    ...(emotions.size ? { emotion: majority(emotions) } : {}),
    ...(actions.size ? { action: majority(actions) } : {}),
    ...(confidences.length ? { confidence: average(confidences) } : {}),
  };
}

/** Personagens, do mais ao menos presente, com quantas cenas cada um aparece. */
export function characterCounts(v: EpisodeVision | undefined | null): { name: string; shots: number }[] {
  const m = new Map<string, { name: string; shots: number }>();
  for (const s of Object.values(v?.shots ?? {})) {
    for (const c of s.characters) {
      const k = normLabel(c);
      const e = m.get(k);
      if (e) e.shots++;
      else m.set(k, { name: c, shots: 1 });
    }
  }
  return [...m.values()].sort((a, b) => b.shots - a.shots || a.name.localeCompare(b.name));
}
