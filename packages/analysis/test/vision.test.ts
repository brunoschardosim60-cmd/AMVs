import { describe, expect, it } from 'vitest';
import { mergeShotVision, selectVisionTargets, shotKey, type EpisodeAnalysis, type Shot } from '../src/index.js';

function shot(startS: number, endS: number, tags: Shot['tags'] = []): Shot {
  return { startS, endS, motion: 0.5, loud: 0.5, intensity: 0.5, brightness: 0.5, tags, line: null, peakS: (startS + endS) / 2 };
}

function episode(shots: Shot[], sequences: EpisodeAnalysis['sequences'] = []): EpisodeAnalysis {
  return { version: 'e2', durationS: 200, shots, sequences, speech: [], subtitles: [], intensityCurve: [], curveStepS: 1 };
}

describe('mergeShotVision', () => {
  it('combines character labels and requires a clear fight majority', () => {
    expect(
      mergeShotVision([
        { characters: ['Mika'], fight: true, note: 'soco' },
        { characters: ['mika', 'Rin'], fight: false, note: 'conversa' },
        { characters: ['Rin'], fight: true, note: 'soco' },
      ]),
    ).toEqual({ characters: ['Mika', 'Rin'], fight: true, note: 'soco', samples: 3 });
  });

  it('does not classify a tie as a fight', () => {
    expect(
      mergeShotVision([
        { characters: [], fight: true, note: '' },
        { characters: [], fight: false, note: '' },
      ]),
    ).toEqual({ characters: [], fight: false, note: '', samples: 2 });
  });

  it('combines detailed visual cues without letting a minority sample decide the result', () => {
    expect(
      mergeShotVision([
        { characters: [], fight: true, note: 'soco', action: 'combate', emotion: 'determinação', visualIntensity: 0.8, confidence: 0.9 },
        { characters: [], fight: true, note: 'impacto', action: 'combate', emotion: 'raiva', visualIntensity: 0.6, confidence: 0.7 },
        { characters: [], fight: false, note: 'close', action: 'reação', emotion: 'raiva', visualIntensity: 0.2, confidence: 0.5 },
      ]),
    ).toEqual({
      characters: [],
      fight: true,
      note: 'soco',
      samples: 3,
      visualIntensity: 0.533,
      emotion: 'raiva',
      action: 'combate',
      confidence: 0.7,
    });
  });

  it('rejects an empty sample set', () => {
    expect(() => mergeShotVision([])).toThrow('é preciso pelo menos uma amostra visual');
  });
});

describe('selectVisionTargets', () => {
  it('prioritizes stronger fights and includes all usable scenes in detailed mode', () => {
    const ep = episode(
      [shot(0, 1, ['escura']), shot(1, 2), shot(10, 11)],
      [
        { id: 'weak', startS: 0, endS: 2, kind: 'luta', intensity: 0.4, peak: 0.5, shotCount: 2 },
        { id: 'strong', startS: 10, endS: 11, kind: 'luta', intensity: 0.9, peak: 0.9, shotCount: 1 },
      ],
    );
    expect(selectVisionTargets(ep, {}, 'fights', 1).map((target) => target.startS)).toEqual([10]);
    expect(selectVisionTargets(ep, {}, 'all').map((target) => target.startS)).toEqual([0, 1, 10]);
  });

  it('revisits one-frame labels in detailed mode and does not cap its scene count', () => {
    const scenes = Array.from({ length: 125 }, (_, i) => shot(i, i + 0.5));
    const labels = {
      [shotKey(0)]: { characters: [], fight: false, note: '', samples: 1 },
      [shotKey(100)]: { characters: [], fight: false, note: '', samples: 3 },
    };
    const targets = selectVisionTargets(episode(scenes), labels, 'all');
    expect(targets).toHaveLength(124);
    expect(targets[0]?.startS).toBe(0);
    expect(targets.some((target) => target.startS === 100)).toBe(false);
  });
});
