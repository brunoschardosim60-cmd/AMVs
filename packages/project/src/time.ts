/**
 * Tempo no AMV Studio.
 *
 * Todo tempo do projeto é um INTEIRO em microssegundos (µs). Frames só existem na
 * borda (UI e render), calculados a partir do FPS racional do projeto.
 */

import type { Rational } from './schema.js';

export type Us = number;

export const US_PER_SECOND = 1_000_000;

export function assertUs(value: number, label = 'tempo'): Us {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} precisa ser inteiro em µs, recebeu ${value}`);
  }
  return value;
}

export function secondsToUs(seconds: number): Us {
  return Math.round(seconds * US_PER_SECOND);
}

export function usToSeconds(us: Us): number {
  return us / US_PER_SECOND;
}

export function rationalToNumber(r: Rational): number {
  return r.num / r.den;
}

/** Converte "30000/1001", "25/1" ou "25" em racional. Retorna null para "0/0" e entradas inválidas. */
export function parseRational(text: string | undefined | null): Rational | null {
  if (!text) return null;
  const [a, b] = text.split('/');
  const num = Number(a);
  const den = b === undefined ? 1 : Number(b);
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return null;
  return simplify({ num, den });
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return Math.abs(a);
}

export function simplify(r: Rational): Rational {
  if (!Number.isInteger(r.num) || !Number.isInteger(r.den)) return r;
  const g = gcd(r.num, r.den) || 1;
  return { num: r.num / g, den: r.den / g };
}

/** Índice do frame que contém o instante `us` (arredonda para baixo). */
export function usToFrame(us: Us, fps: Rational): number {
  // frame = us * num / (den * 1e6), feito em BigInt para não perder precisão
  const n = BigInt(Math.round(us)) * BigInt(fps.num);
  const d = BigInt(fps.den) * BigInt(US_PER_SECOND);
  return Number(n >= 0n ? n / d : -((-n + d - 1n) / d));
}

/**
 * Instante de início do frame `frame` em µs. Arredonda para CIMA, garantindo que
 * o µs devolvido já pertence ao frame (usToFrame(frameToUs(f)) === f).
 */
export function frameToUs(frame: number, fps: Rational): Us {
  const n = BigInt(frame) * BigInt(fps.den) * BigInt(US_PER_SECOND);
  const d = BigInt(fps.num);
  return Number(n >= 0n ? (n + d - 1n) / d : n / d);
}

/** Alinha um instante ao início do frame mais próximo. */
export function snapUsToFrame(us: Us, fps: Rational): Us {
  const frameDur = (fps.den * US_PER_SECOND) / fps.num;
  return frameToUs(Math.round(us / frameDur), fps);
}

/** Formata como 01:02:03.456 (ou 02:03.456 se não houver horas). */
export function formatDuration(us: Us): string {
  const negative = us < 0;
  let ms = Math.round(Math.abs(us) / 1000);
  const h = Math.floor(ms / 3_600_000);
  ms -= h * 3_600_000;
  const m = Math.floor(ms / 60_000);
  ms -= m * 60_000;
  const s = Math.floor(ms / 1000);
  ms -= s * 1000;
  const pad = (v: number, n = 2) => String(v).padStart(n, '0');
  const body = `${h ? `${pad(h)}:` : ''}${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
  return negative ? `-${body}` : body;
}

/** Timecode HH:MM:SS:FF para o FPS do projeto (sem drop-frame). */
export function formatTimecode(us: Us, fps: Rational): string {
  const total = usToFrame(Math.max(0, us), fps);
  const fpsRound = Math.round(fps.num / fps.den);
  const ff = total % fpsRound;
  const totalSec = Math.floor(total / fpsRound);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}
