import { describe, expect, it } from 'vitest';
import { planSequence, type SequencePlanCandidate } from '../src/sequence-planner.js';

interface Candidate extends SequencePlanCandidate {
  slotScores: number[];
}

const candidate = (id: string, startS: number, slotScores: number[], episodeOrder = 0): Candidate => ({
  id,
  assetId: `ep${episodeOrder}`,
  episodeOrder,
  sequenceOrder: 0,
  sourceStartS: startS,
  sourceEndS: startS + 1,
  slotScores,
});

describe('planejador global de sequência', () => {
  it('prefere um caminho completo coerente a uma cena localmente mais forte', () => {
    const candidates = [
      candidate('gananciosa', 10, [10, -100]),
      candidate('continuidade-a', 0, [9, 9]),
      candidate('continuidade-b', 1, [-100, 9]),
    ];
    const result = planSequence([0, 1], candidates, {
      mode: 'chronological',
      seed: 1,
      score: (slot, item) => item.slotScores[slot]!,
      beamWidth: 8,
      branchLimit: 8,
    });

    expect(result.choices.map((item) => item?.id)).toEqual(['continuidade-a', 'continuidade-b']);
  });

  it('modo cronológico nunca volta a um episódio ou trecho anterior', () => {
    const candidates = [
      candidate('episodio-1-a', 0, [1, 100], 0),
      candidate('episodio-1-b', 1, [-10, -10, -10], 0),
      candidate('episodio-2-a', 0, [-10, 9, 9], 1),
      candidate('episodio-2-b', 1, [-10, 8, 8], 1),
    ];
    candidates[0]!.slotScores = [9, -10, -10];
    candidates[1]!.slotScores = [8, -10, -10];
    const result = planSequence([0, 1, 2], candidates, {
      mode: 'chronological',
      seed: 2,
      score: (slot, item) => item.slotScores[slot]!,
      beamWidth: 8,
      branchLimit: 8,
    });
    const selected = result.choices.filter((item): item is Candidate => item !== null);

    expect(selected.map((item) => item.episodeOrder)).toEqual([0, 1, 1]);
    expect(selected[2]!.sourceStartS).toBeGreaterThanOrEqual(selected[1]!.sourceEndS - 0.05);
  });

  it('permite não linearidade no modo livre sem reutilizar cenas antes de esgotar', () => {
    const candidates = [
      candidate('origem', 0, [10, -10]),
      candidate('alternativa', 1, [-10, 10]),
    ];
    const result = planSequence([0, 1], candidates, {
      mode: 'free',
      seed: 3,
      score: (slot, item) => item.slotScores[slot]!,
      beamWidth: 8,
      branchLimit: 8,
    });

    expect(result.choices.map((item) => item?.id)).toEqual(['origem', 'alternativa']);
    expect(result.repeatedSlots).toEqual([]);
  });
});
