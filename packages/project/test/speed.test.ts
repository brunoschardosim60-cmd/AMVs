import { describe, expect, it } from 'vitest';
import { sourceTimeAt, speedAt, speedCurveTotal, timelineLocalAtSource, type Clip } from '../src/index.js';
import { clip } from './helpers.js';

const S = 1_000_000;

describe('curva de velocidade', () => {
  const base = (overrides: Partial<Clip> = {}) => clip('v1', 'ep', {
    durationUs: 4 * S,
    sourceInUs: 10 * S,
    sourceOutUs: 14 * S,
    speed: 1,
    ...overrides,
  });

  it('integra uma aceleração linear e mantém as extremidades do trecho selecionado', () => {
    const c = base({ keyframes: { speed: [
      { atUs: 0, value: 0.5, easing: 'linear' },
      { atUs: 4 * S, value: 1.5, easing: 'linear' },
    ] } });
    expect(speedCurveTotal(c)).toBeCloseTo(4, 8);
    expect(sourceTimeAt(c, 0)).toBe(10 * S);
    expect(sourceTimeAt(c, 2 * S)).toBeCloseTo(11.5 * S, -3);
    expect(sourceTimeAt(c, 4 * S)).toBe(14 * S);
    expect(speedAt(c, 0)).toBeCloseTo(0.5, 6);
    expect(speedAt(c, 4 * S)).toBeCloseTo(1.5, 6);
    const midpoint = timelineLocalAtSource(c, 12 * S)!;
    expect(sourceTimeAt(c, midpoint)).toBeCloseTo(12 * S, -3);
  });

  it('suporta uma pausa de frame congelado e retoma o movimento sem pular a origem', () => {
    const c = base({ keyframes: { speed: [
      { atUs: 0, value: 1, easing: 'linear' },
      { atUs: S, value: 0, easing: 'hold' },
      { atUs: 2 * S, value: 0, easing: 'linear' },
      { atUs: 3 * S, value: 1, easing: 'linear' },
      { atUs: 4 * S, value: 1, easing: 'linear' },
    ] } });
    expect(sourceTimeAt(c, S)).toBe(sourceTimeAt(c, 2 * S));
    expect(speedAt(c, 1.5 * S)).toBe(0);
    expect(sourceTimeAt(c, 4 * S)).toBe(14 * S);
  });

  it('inverte o sentido sem sair do intervalo e preserva o tempo da curva', () => {
    const c = base({ reverse: true });
    expect(sourceTimeAt(c, 0)).toBe(14 * S);
    expect(sourceTimeAt(c, 2 * S)).toBe(12 * S);
    expect(sourceTimeAt(c, 4 * S)).toBe(10 * S);
    expect(timelineLocalAtSource(c, 12 * S)).toBe(2 * S);
  });

  it('a velocidade exibida segue o mapeamento efetivo quando duração e origem foram editadas separadamente', () => {
    const c = base({
      durationUs: 2 * S,
      keyframes: { speed: [
        { atUs: 0, value: 0.5, easing: 'linear' },
        { atUs: 2 * S, value: 1.5, easing: 'linear' },
      ] },
    });
    expect(speedAt(c, 0)).toBeCloseTo(1, 6);
    expect(speedAt(c, 2 * S)).toBeCloseTo(3, 6);
  });

  it('um perfil inteiramente congelado mantém o primeiro quadro', () => {
    const c = base({ keyframes: { speed: [
      { atUs: 0, value: 0, easing: 'hold' },
      { atUs: 4 * S, value: 0, easing: 'linear' },
    ] } });
    expect(speedCurveTotal(c)).toBe(0);
    expect(speedAt(c, 2 * S)).toBe(0);
    expect(sourceTimeAt(c, 3 * S)).toBe(10 * S);
    expect(timelineLocalAtSource(c, 10 * S)).toBe(0);
    expect(timelineLocalAtSource(c, 11 * S)).toBeNull();
  });
});
