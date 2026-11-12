import { describe, expect, it } from 'vitest';
import type { Shot, ShotVision } from '@amv/analysis';
import { findHeroCoverFrame } from '../src/hero-cover.js';
import type { EpisodeInput, PoolEntry } from '../src/generate.js';

function createEpisode(id: string, shots: Shot[]): EpisodeInput {
  return {
    assetId: id,
    name: `${id}.mkv`,
    hasAudio: true,
    analysis: {
      version: 'e2',
      durationS: 120,
      shots,
      sequences: [
        {
          id: 'seq1',
          name: 'Luta Principal',
          startS: 20,
          endS: 60,
          kind: 'luta',
          intensity: 0.9,
          dominantEmotion: 'raiva',
        },
      ],
      subtitles: [],
      intensityCurve: [],
      curveStepS: 1,
      speech: [],
    },
  };
}

describe('findHeroCoverFrame', () => {
  it('seleciona o plano mais equilibrado e de maior impacto para capa', () => {
    const shotCalm: Shot = {
      startS: 0,
      endS: 5,
      motion: 0.2,
      loud: 0.2,
      intensity: 0.3,
      brightness: 0.5,
      tags: ['calma'],
      line: null,
      peakS: 2,
    };

    const shotClimax: Shot = {
      startS: 25,
      endS: 30,
      motion: 0.85,
      loud: 0.8,
      intensity: 0.9,
      brightness: 0.52, // Exposição ideal (~0.52)
      tags: ['ação', 'impacto'],
      line: null,
      peakS: 27.4,
    };

    const shotBlack: Shot = {
      startS: 35,
      endS: 40,
      motion: 0.9,
      loud: 0.9,
      intensity: 0.9,
      brightness: 0.1, // Escuro demais (descartado)
      tags: ['escura'],
      line: null,
      peakS: 37,
    };

    const ep = createEpisode('ep1', [shotCalm, shotClimax, shotBlack]);
    const cover = findHeroCoverFrame([ep]);

    expect(cover).toBeDefined();
    expect(cover?.shot).toBe(shotClimax);
    expect(cover?.timestampS).toBe(27.4); // Usa o pico
    expect(cover?.score).toBeGreaterThan(0.65);
    expect(cover?.reason).toContain('clímax de ação');
  });

  it('dá preferência ao pool de sequências quando fornecido', () => {
    const shotOutsidePool: Shot = {
      startS: 5,
      endS: 10,
      motion: 0.95,
      loud: 0.9,
      intensity: 0.95,
      brightness: 0.52,
      tags: ['ação', 'impacto'],
      line: null,
      peakS: 7,
    };

    const shotInPool: Shot = {
      startS: 30,
      endS: 35,
      motion: 0.8,
      loud: 0.7,
      intensity: 0.85,
      brightness: 0.5,
      tags: ['ação'],
      line: null,
      peakS: 32,
    };

    const ep = createEpisode('ep1', [shotOutsidePool, shotInPool]);
    const pool: PoolEntry[] = [
      {
        ep,
        seq: ep.analysis.sequences![0]!,
      },
    ];

    const cover = findHeroCoverFrame([ep], pool);
    expect(cover?.shot).toBe(shotInPool);
  });

  it('recompensa enquadramento com personagem e detecção de visão', () => {
    const shot: Shot = {
      startS: 22,
      endS: 25,
      motion: 0.7,
      loud: 0.6,
      intensity: 0.75,
      brightness: 0.52,
      tags: ['ação'],
      line: null,
      peakS: 23.5,
    };

    const ep = createEpisode('ep1', [shot]);
    const vision: ShotVision = {
      characters: ['Goku'],
      fight: true,
      action: 'combate',
      framing: 'close-up',
      confidence: 0.9,
      note: '',
      local: {
        version: 1,
        samples: 2,
        lumaGrid: [],
        edgeGrid: [],
        colorHistogram: [],
        brightness: 0.52,
        saturation: 0.5,
        entropy: 0.8,
        edgeDensity: 0.7,
        centerOfVisualMass: [0.5, 0.5], // perfeitamente centralizado
        temporalMotion: 0.4,
        globalShift: [0, 0],
        globalMotion: 0.3,
        motionEvents: [],
        motionConfidence: 0.8,
        fingerprint: 'fp',
        sceneType: 'action',
        sceneTypeConfidence: 0.9,
      },
    };

    const cover = findHeroCoverFrame([ep], undefined, () => vision);
    expect(cover).toBeDefined();
    expect(cover?.reason).toContain('Goku');
    expect(cover?.score).toBeGreaterThan(0.7);
  });

  it('retorna null se não houver planos válidos', () => {
    const ep = createEpisode('ep1', []);
    const cover = findHeroCoverFrame([ep]);
    expect(cover).toBeNull();
  });
});
