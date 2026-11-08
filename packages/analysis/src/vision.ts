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
}

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
