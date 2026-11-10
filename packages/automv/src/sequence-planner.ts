export type OrganizationMode = 'chronological' | 'narrative' | 'free';

export interface SequencePlanCandidate {
  id: string;
  assetId: string;
  episodeOrder: number;
  sequenceOrder: number;
  sourceStartS: number;
  sourceEndS: number;
}

export interface SequencePlanResult<T> {
  choices: (T | null)[];
  repeatedSlots: number[];
  totalScore: number;
}

interface Progress {
  sequenceOrder: number;
  sourceEndS: number;
}

interface BeamState<TCandidate, TSlot> {
  choices: (TCandidate | null)[];
  used: Set<string>;
  progress: Map<string, Progress>;
  last: TCandidate | null;
  lastSlot: TSlot | null;
  totalScore: number;
  repeatedSlots: number[];
}

export interface SequencePlannerOptions<TCandidate extends SequencePlanCandidate, TSlot> {
  mode: OrganizationMode;
  seed: number;
  score: (slot: TSlot, candidate: TCandidate, previous: TCandidate | null, previousSlot: TSlot | null) => number;
  candidateWindow?: (
    slotIndex: number,
    slot: TSlot,
    forward: TCandidate[],
    progress: ReadonlyMap<string, Progress>,
    used: ReadonlySet<string>,
  ) => TCandidate[];
  beamWidth?: number;
  branchLimit?: number;
}

function isForward<T extends SequencePlanCandidate>(
  mode: OrganizationMode,
  candidate: T,
  previous: T | null,
  progress: Map<string, Progress>,
): boolean {
  if (!previous || mode === 'free') return true;
  if (mode === 'chronological') {
    return candidate.episodeOrder > previous.episodeOrder
      || (candidate.episodeOrder === previous.episodeOrder && candidate.sourceStartS >= previous.sourceEndS - 0.05);
  }
  const assetProgress = progress.get(candidate.assetId);
  return !assetProgress
    || candidate.sequenceOrder > assetProgress.sequenceOrder
    || (candidate.sequenceOrder === assetProgress.sequenceOrder && candidate.sourceStartS >= assetProgress.sourceEndS - 0.05);
}

function stableTie(seed: number, slotIndex: number, id: string): number {
  let hash = (seed ^ Math.imul(slotIndex + 1, 0x9e3779b1)) >>> 0;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 0x45d9f3b) >>> 0;
  return ((hash % 10_001) / 10_000 - 0.5) * 0.001;
}

/**
 * Bounded beam search evaluates complete slot paths instead of committing to a
 * locally best scene at each cut. The search is deterministic for the same seed.
 */
export function planSequence<TCandidate extends SequencePlanCandidate, TSlot>(
  slots: TSlot[],
  candidates: TCandidate[],
  options: SequencePlannerOptions<TCandidate, TSlot>,
): SequencePlanResult<TCandidate> {
  if (!slots.length) return { choices: [], repeatedSlots: [], totalScore: 0 };
  if (!candidates.length) return { choices: slots.map(() => null), repeatedSlots: [], totalScore: 0 };

  const beamWidth = Math.max(1, options.beamWidth ?? 32);
  const branchLimit = Math.max(1, options.branchLimit ?? 16);
  let beam: BeamState<TCandidate, TSlot>[] = [{
    choices: [],
    used: new Set(),
    progress: new Map(),
    last: null,
    lastSlot: null,
    totalScore: 0,
    repeatedSlots: [],
  }];

  for (const [slotIndex, slot] of slots.entries()) {
    const expanded: BeamState<TCandidate, TSlot>[] = [];
    for (const state of beam) {
      let eligible = candidates.filter((candidate) =>
        !state.used.has(candidate.id) && isForward(options.mode, candidate, state.last, state.progress),
      );
      if (eligible.length && options.candidateWindow) {
        eligible = options.candidateWindow(slotIndex, slot, eligible, state.progress, state.used);
      }
      const repeated = eligible.length === 0;
      if (repeated && options.mode === 'chronological') {
        expanded.push({
          ...state,
          choices: [...state.choices, null],
          lastSlot: slot,
          totalScore: state.totalScore - 2,
        });
        continue;
      }
      const pool = repeated ? candidates : eligible;
      const ranked = pool
        .map((candidate) => {
          const score = options.score(slot, candidate, state.last, state.lastSlot);
          return {
            candidate,
            score: Number.isFinite(score) ? score + stableTie(options.seed, slotIndex, candidate.id) : Number.NEGATIVE_INFINITY,
          };
        })
        .filter((entry) => Number.isFinite(entry.score))
        .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id))
        .slice(0, branchLimit);

      if (!ranked.length) {
        expanded.push({
          ...state,
          choices: [...state.choices, null],
          lastSlot: slot,
        });
        continue;
      }

      for (const entry of ranked) {
        const used = repeated ? new Set<string>() : new Set(state.used);
        used.add(entry.candidate.id);
        const progress = repeated ? new Map<string, Progress>() : new Map(state.progress);
        progress.set(entry.candidate.assetId, {
          sequenceOrder: entry.candidate.sequenceOrder,
          sourceEndS: entry.candidate.sourceEndS,
        });
        expanded.push({
          choices: [...state.choices, entry.candidate],
          used,
          progress,
          last: entry.candidate,
          lastSlot: slot,
          totalScore: state.totalScore + entry.score - (repeated ? 1 : 0),
          repeatedSlots: repeated ? [...state.repeatedSlots, slotIndex] : state.repeatedSlots,
        });
      }
    }

    beam = expanded
      .sort((a, b) => b.totalScore - a.totalScore || (a.last?.id ?? '').localeCompare(b.last?.id ?? ''))
      .slice(0, beamWidth);
  }

  const best = beam[0]!;
  return { choices: best.choices, repeatedSlots: best.repeatedSlots, totalScore: best.totalScore };
}
