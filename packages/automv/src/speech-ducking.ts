import type { Keyframe } from '@amv/project';

export interface SpeechDuckingInterval {
  startS: number;
  endS: number;
  /** No discurso que termina no drop, a música deve recuperar o impacto imediatamente. */
  forceRelease?: boolean;
  /** Sobrescreve a rampa de retorno para casos editoriais especiais. */
  releaseS?: number;
}

export interface SpeechDuckingOptions {
  duckDb?: number;
  attackS?: number;
  releaseS?: number;
  mergeGapS?: number;
}

/**
 * Cria um envelope de volume contínuo para falas.
 *
 * Pequenas pausas entre frases são tratadas como uma única intervenção de voz:
 * a música permanece abaixada e só recupera depois de silêncio suficiente.
 * Isso evita o efeito de "respiração" (sobe/desce) entre frases próximas.
 */
export function buildSpeechDuckingKeyframes(
  intervals: SpeechDuckingInterval[],
  options: SpeechDuckingOptions = {},
): Keyframe[] {
  const duckDb = Number.isFinite(options.duckDb) ? options.duckDb! : -16;
  const attackS = Math.max(0, Number.isFinite(options.attackS) ? options.attackS! : 0.18);
  const releaseS = Math.max(0, Number.isFinite(options.releaseS) ? options.releaseS! : 0.65);
  const mergeGapS = Math.max(0, Number.isFinite(options.mergeGapS) ? options.mergeGapS! : 0.9);

  const sorted = intervals
    .filter((interval) =>
      Number.isFinite(interval.startS)
      && Number.isFinite(interval.endS)
      && interval.startS >= 0
      && interval.endS > interval.startS,
    )
    .map((interval) => ({
      startS: interval.startS,
      endS: interval.endS,
      forceRelease: interval.forceRelease === true,
      releaseS: Math.max(0, Number.isFinite(interval.releaseS) ? interval.releaseS! : releaseS),
    }))
    .sort((a, b) => a.startS - b.startS || a.endS - b.endS);

  if (!sorted.length) return [];

  const merged: typeof sorted = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    const gapS = previous ? interval.startS - previous.endS : Number.POSITIVE_INFINITY;
    if (previous && !previous.forceRelease && !interval.forceRelease && gapS <= mergeGapS) {
      previous.endS = Math.max(previous.endS, interval.endS);
      previous.releaseS = interval.releaseS;
    } else {
      merged.push({ ...interval });
    }
  }

  const points: Keyframe[] = [];
  for (const interval of merged) {
    const attackStartS = Math.max(0, interval.startS - attackS);
    if (attackStartS < interval.startS) {
      points.push({ atUs: Math.round(attackStartS * 1_000_000), value: 0, easing: 'linear' });
    }
    points.push(
      { atUs: Math.round(interval.startS * 1_000_000), value: duckDb, easing: 'linear' },
      { atUs: Math.round(interval.endS * 1_000_000), value: duckDb, easing: 'linear' },
      { atUs: Math.round((interval.endS + interval.releaseS) * 1_000_000), value: 0, easing: 'linear' },
    );
  }

  // Colisões de timestamps podem ocorrer após arredondar para microssegundos.
  // Em caso de empate, conservar o nível mais baixo evita um pico de música.
  const unique = new Map<number, Keyframe>();
  for (const point of points.sort((a, b) => a.atUs - b.atUs)) {
    const previous = unique.get(point.atUs);
    if (!previous || point.value < previous.value) unique.set(point.atUs, point);
  }
  return [...unique.values()].sort((a, b) => a.atUs - b.atUs);
}
