import { describe, expect, it } from 'vitest';
import { buildEpisodeAnalysis, buildSequences, type FrameStat, type Shot } from '../src/index.js';

function shot(startS: number, endS: number, intensity: number, tags: Shot['tags'] = []): Shot {
  return { startS, endS, motion: intensity, loud: intensity, intensity, brightness: 0.5, tags, line: null, peakS: (startS + endS) / 2 };
}
/** n planos de 2 s, um atrás do outro, a partir de t0. */
function run(t0: number, n: number, intensity: number, tags: Shot['tags'] = []): Shot[] {
  return Array.from({ length: n }, (_, i) => shot(t0 + i * 2, t0 + i * 2 + 2, intensity, tags));
}

describe('sequências (lutas)', () => {
  it('duas lutas separadas por cena calma longa não se misturam', () => {
    const shots = [...run(0, 6, 0.8), ...run(12, 8, 0.1, ['calma']), ...run(28, 6, 0.7)];
    const seq = buildSequences(shots);
    const fights = seq.filter((s) => s.kind === 'luta');
    expect(fights).toHaveLength(2);
    expect(fights[0]!.endS).toBeLessThanOrEqual(12);
    expect(fights[1]!.startS).toBeGreaterThanOrEqual(28);
    expect(seq.some((s) => s.kind === 'calma' && s.startS === 12)).toBe(true);
  });

  it('respiro curto (close, fala de 4 s) fica dentro da mesma luta', () => {
    const shots = [...run(0, 4, 0.8), ...run(8, 2, 0.1, ['fala']), ...run(12, 4, 0.9)];
    const fights = buildSequences(shots).filter((s) => s.kind === 'luta');
    expect(fights).toHaveLength(1);
    expect(fights[0]).toMatchObject({ startS: 0, endS: 20 });
    expect(fights[0]!.shotCount).toBe(10);
  });

  it('cena escura (fade) separa duas lutas mesmo sem pausa', () => {
    const shots = [...run(0, 5, 0.8), shot(10, 10.6, 0.05, ['escura']), ...run(10.6, 5, 0.8)];
    expect(buildSequences(shots).filter((s) => s.kind === 'luta')).toHaveLength(2);
  });

  it('bloco quente pequeno demais não vira luta', () => {
    const shots = [...run(0, 2, 0.9), ...run(4, 10, 0.1, ['calma'])];
    expect(buildSequences(shots).filter((s) => s.kind === 'luta')).toHaveLength(0);
  });

  it('id é estável e intensidade usa as cenas mais fortes', () => {
    const shots = [...run(0, 5, 0.5), shot(10, 12, 1)];
    const [s] = buildSequences(shots);
    expect(s!.id).toBe('s0');
    expect(s!.peak).toBe(1);
    // média dos 40% planos mais fortes (3 de 6): (1 + 0,5 + 0,5) / 3
    expect(s!.intensity).toBeCloseTo(0.67, 2);
  });
});

describe('golpe (peakS)', () => {
  it('é o quadro de maior movimento do plano, não o do corte', () => {
    const frames: FrameStat[] = [];
    for (let i = 0; i < 24 * 6; i++) {
      const t = i / 24;
      // corte em 3 s (scene alto no quadro do corte); golpe em 4,5 s
      frames.push({ t, scene: Math.abs(t - 3) < 1e-6 ? 0.9 : 0.01, ydif: Math.abs(t - 3) < 1e-6 ? 90 : Math.abs(t - 4.5) < 1e-6 ? 60 : 4, yavg: 120 });
    }
    const a = buildEpisodeAnalysis(frames, 6, { t: [0, 6], db: [-30, -30] }, [], []);
    const second = a.shots.find((s) => s.startS >= 2.9)!;
    expect(second.peakS).toBeCloseTo(4.5, 2);
    expect(second.peakS).toBeGreaterThan(second.startS);
    expect(second.peakS).toBeLessThan(second.endS);
    expect(a.sequences).toBeDefined();
  });
});
