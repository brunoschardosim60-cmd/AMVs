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

  // Beam width adaptativo: mais candidatos → mais possibilidades → beam maior
  const baseBeamWidth = Math.max(1, options.beamWidth ?? 32);
  const beamWidth = candidates.length > 100
    ? Math.min(baseBeamWidth * 2, 64)
    : candidates.length > 50
      ? Math.min(Math.round(baseBeamWidth * 1.5), 48)
      : baseBeamWidth;
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
      const forward = eligible;
      if (forward.length && options.candidateWindow) {
        eligible = options.candidateWindow(slotIndex, slot, forward, state.progress, state.used);
      }
      const preferredSequences = new Set(eligible.map((candidate) => `${candidate.assetId}#${candidate.sequenceOrder}`));
      const repeated = forward.length === 0;
      if (repeated && options.mode === 'chronological') {
        expanded.push({
          ...state,
          choices: [...state.choices, null],
          lastSlot: slot,
          totalScore: state.totalScore - 2,
        });
        continue;
      }
      const currentSequence = repeated && options.mode === 'narrative' && state.last
        ? candidates.filter((candidate) =>
            candidate.assetId === state.last!.assetId
            && candidate.sequenceOrder === state.last!.sequenceOrder,
          )
        : candidates;
      const alternativesToLast = state.last
        ? currentSequence.filter((candidate) => candidate.id !== state.last!.id)
        : currentSequence;
      let repeatedCandidates = alternativesToLast.length ? alternativesToLast : currentSequence;
      if (repeated && options.mode === 'narrative' && state.last && repeatedCandidates.length) {
        const anchorS = state.progress.get(state.last.assetId)?.sourceEndS ?? state.last.sourceEndS;
        const nearestS = Math.min(...repeatedCandidates.map((candidate) => Math.abs(candidate.sourceStartS - anchorS)));
        repeatedCandidates = repeatedCandidates.filter(
          (candidate) => Math.abs(candidate.sourceStartS - anchorS) <= nearestS + 0.25,
        );
      }
      const pool = repeated ? repeatedCandidates : eligible;
      const rank = (items: TCandidate[]) => items
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
      const rankNearest = (items: TCandidate[]) => {
        if (options.mode !== 'narrative' || !state.last) return rank(items);
        for (const maxDistanceS of [2, 5, 10, 20, Number.POSITIVE_INFINITY]) {
          const nearby = items.filter((candidate) => {
            const progress = state.progress.get(candidate.assetId);
            return !progress || Math.abs(candidate.sourceStartS - progress.sourceEndS) <= maxDistanceS;
          });
          const rankedNearby = rank(nearby);
          if (rankedNearby.length) return rankedNearby;
        }
        return [];
      };
      let ranked = rank(pool);
      if (!repeated && !ranked.length && options.candidateWindow) {
        const sameSequence = forward.filter((candidate) => preferredSequences.has(`${candidate.assetId}#${candidate.sequenceOrder}`));
        ranked = rankNearest(sameSequence);
        if (!ranked.length) ranked = rankNearest(forward);
      }

      if (!ranked.length) {
        expanded.push({
          ...state,
          choices: [...state.choices, null],
          lastSlot: slot,
        });
        continue;
      }

      for (const entry of ranked) {
        const used = new Set(state.used);
        used.add(entry.candidate.id);
        const progress = new Map(state.progress);
        if (!repeated) {
          progress.set(entry.candidate.assetId, {
            sequenceOrder: entry.candidate.sequenceOrder,
            sourceEndS: entry.candidate.sourceEndS,
          });
        }
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
