import type { EpisodeAnalysis, Shot } from './episode.js';

/**
 * Visão por cena (opcional, feita por um modelo de IA com visão): quem aparece e se é luta.
 * É guardada à parte da análise de ritmo: custa chamadas ao modelo, então só roda quando a
 * pessoa pede, e pode ser feita aos poucos (retoma de onde parou).
 */
export const VISION_VERSION = 'v1';

export interface ShotVision {
  /** Personagens vistos: nome (se o modelo reconheceu) ou descrição curta e estável. */
  characters: string[];
  /** Cena de luta/ação (golpes, ataques, confronto) — e não paisagem, conversa, plateia. */
  fight: boolean;
  /** Nota curta do que acontece. */
  note: string;
  /** Quadros combinados nesta classificação; ausente em análises antigas. */
  samples?: number;
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
  let fights = 0;
  for (const sample of samples) {
    if (sample.fight) fights++;
    for (const character of sample.characters) {
      const key = normLabel(character);
      if (key && !characters.has(key)) characters.set(key, character);
    }
    const note = sample.note.trim();
    if (note) notes.set(note, (notes.get(note) ?? 0) + 1);
  }
  const note = [...notes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  return { characters: [...characters.values()], fight: fights > samples.length / 2, note, samples: samples.length };
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
