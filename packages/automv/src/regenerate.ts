import { clipEndUs, newId, sliceClipKeyframes, sourceTimeAt, type Clip, type Command, type Project } from '@amv/project';

const MIN_CLIP_US = 1_000;

export interface LocalizedRegenerationOptions {
  startUs: number;
  endUs: number;
  trackId: string;
  replaceClipIds: string[];
}

export interface LocalizedRegenerationResult {
  commands: Command[];
  replaced: number;
  added: number;
}

function clipSegment(clip: Clip, startUs: number, endUs: number, id = clip.id): Clip | null {
  const start = Math.max(startUs, clip.timelineStartUs);
  const end = Math.min(endUs, clipEndUs(clip));
  if (end - start < MIN_CLIP_US) return null;
  const offsetUs = start - clip.timelineStartUs;
  const endOffsetUs = end - clip.timelineStartUs;
  const sourceStartUs = sourceTimeAt(clip, offsetUs);
  const sourceEndUs = sourceTimeAt(clip, endOffsetUs);
  const durationUs = end - start;
  return {
    ...structuredClone(clip),
    id,
    timelineStartUs: start,
    durationUs,
    sourceInUs: clip.reverse ? sourceEndUs : sourceStartUs,
    sourceOutUs: clip.reverse ? sourceStartUs : sourceEndUs,
    transitionIn: start === clip.timelineStartUs ? structuredClone(clip.transitionIn) : null,
    keyframes: sliceClipKeyframes(clip, offsetUs, endOffsetUs),
  };
}

function freeIntervals(startUs: number, endUs: number, blocked: Array<{ startUs: number; endUs: number }>) {
  const sorted = blocked
    .map((interval) => ({ startUs: Math.max(startUs, interval.startUs), endUs: Math.min(endUs, interval.endUs) }))
    .filter((interval) => interval.endUs > interval.startUs)
    .sort((a, b) => a.startUs - b.startUs);
  const merged: typeof sorted = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && interval.startUs <= last.endUs) last.endUs = Math.max(last.endUs, interval.endUs);
    else merged.push({ ...interval });
  }
  const free: Array<{ startUs: number; endUs: number }> = [];
  let cursor = startUs;
  for (const interval of merged) {
    if (interval.startUs > cursor) free.push({ startUs: cursor, endUs: interval.startUs });
    cursor = Math.max(cursor, interval.endUs);
  }
  if (cursor < endUs) free.push({ startUs: cursor, endUs });
  return free;
}

function preserveSelectedEdits(candidate: Clip, previous: Clip[], startUs: number, endUs: number): Clip {
  const overlapping = previous
    .map((clip) => ({ clip, overlap: Math.max(0, Math.min(endUs, clipEndUs(clip)) - Math.max(startUs, clip.timelineStartUs)) }))
    .filter((item) => item.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap);
  if (!overlapping.length) return candidate;

  const strongest = overlapping[0]!.clip;
  const preservedEffects = new Map<string, Clip['effects']>();
  for (const { clip } of overlapping) {
    for (const effect of clip.effects) {
      preservedEffects.set(effect.effect, [...(preservedEffects.get(effect.effect) ?? []), effect]);
    }
  }
  const effects = candidate.effects.filter((effect) => !preservedEffects.has(effect.effect));
  effects.push(...[...preservedEffects.values()].flat().map((effect) => ({ ...structuredClone(effect), id: newId('fx') })));

  const keyframes: Clip['keyframes'] = Object.fromEntries(
    Object.entries(candidate.keyframes).map(([parameter, values]) => [parameter, [...values]]),
  );
  const keyframesByTime = new Map<string, Map<number, Clip['keyframes'][string][number]>>();
  for (const [parameter, values] of Object.entries(keyframes)) {
    keyframesByTime.set(parameter, new Map(values.map((value) => [value.atUs, value])));
  }
  for (const { clip } of overlapping) {
    const from = Math.max(startUs, clip.timelineStartUs, candidate.timelineStartUs);
    const to = Math.min(endUs, clipEndUs(clip), clipEndUs(candidate));
    for (const [parameter, values] of Object.entries(clip.keyframes)) {
      const byTime = keyframesByTime.get(parameter) ?? new Map();
      for (const value of values) {
        const absoluteUs = clip.timelineStartUs + value.atUs;
        if (absoluteUs < from || absoluteUs > to) continue;
        byTime.set(absoluteUs - candidate.timelineStartUs, {
          ...structuredClone(value),
          atUs: absoluteUs - candidate.timelineStartUs,
        });
      }
      keyframesByTime.set(parameter, byTime);
    }
  }
  for (const [parameter, byTime] of keyframesByTime) {
    keyframes[parameter] = [...byTime.values()].sort((a, b) => a.atUs - b.atUs);
  }

  const transition = overlapping.find(({ clip }) => clip.timelineStartUs === candidate.timelineStartUs && clip.transitionIn)?.clip.transitionIn;
  return {
    ...candidate,
    transform: structuredClone(strongest.transform),
    audio: structuredClone(strongest.audio),
    effects,
    keyframes,
    transitionIn: transition ? structuredClone(transition) : candidate.transitionIn,
  };
}

/**
 * Builds an undoable localized edit. Unselected clips are never modified; they
 * remain as anchors, and generated video is clipped around their occupied time.
 */
export function prepareLocalizedRegeneration(
  project: Project,
  generatedClips: Clip[],
  options: LocalizedRegenerationOptions,
): LocalizedRegenerationResult {
  const { startUs, endUs, trackId, replaceClipIds } = options;
  if (!Number.isSafeInteger(startUs) || !Number.isSafeInteger(endUs) || startUs < 0 || endUs <= startUs) {
    throw new Error('O intervalo de regeneração é inválido.');
  }
  const track = project.tracks.find((item) => item.id === trackId);
  if (!track || track.kind !== 'video') throw new Error('A trilha de destino não é uma trilha de vídeo válida.');
  if (track.locked) throw new Error(`A trilha "${track.name}" está travada.`);
  if (!replaceClipIds.length) throw new Error('Selecione pelo menos um clipe de vídeo para regenerar.');

  const selected = replaceClipIds.map((id) => project.clips.find((clip) => clip.id === id));
  if (selected.some((clip) => !clip || clip.trackId !== trackId || !clip.assetId || clip.text)) {
    throw new Error('A seleção mudou ou contém clipes que não pertencem à trilha de vídeo escolhida.');
  }
  const selectedClips = (selected as Clip[]).filter((clip) =>
    clip.timelineStartUs < endUs && clipEndUs(clip) > startUs,
  );
  if (!selectedClips.length) throw new Error('Os clipes selecionados não cruzam o intervalo informado.');
  const selectedIds = new Set(replaceClipIds);
  const available = project.clips.filter((clip) => clip.trackId === trackId && !selectedIds.has(clip.id));
  const intervals = freeIntervals(startUs, endUs, available.map((clip) => ({
    startUs: clip.timelineStartUs,
    endUs: clipEndUs(clip),
  })));
  const clipIds = new Set(project.clips.map((clip) => clip.id));
  const candidatePieces: Clip[] = [];
  for (const generated of generatedClips) {
    if (generated.trackId !== trackId || !generated.assetId || generated.text) continue;
    const absolute = {
      ...structuredClone(generated),
      timelineStartUs: generated.timelineStartUs + startUs,
    };
    const boundedStart = Math.max(startUs, absolute.timelineStartUs);
    const boundedEnd = Math.min(endUs, clipEndUs(absolute));
    if (boundedEnd - boundedStart < MIN_CLIP_US) continue;
    for (const free of intervals) {
      const piece = clipSegment(absolute, free.startUs, free.endUs, absolute.id);
      if (!piece) continue;
      const uniquePiece = {
        ...piece,
        id: clipIds.has(piece.id) ? newId('clp') : piece.id,
      };
      const transitionPoints = selectedClips
        .filter((clip) => clip.transitionIn && clip.timelineStartUs > uniquePiece.timelineStartUs && clip.timelineStartUs < clipEndUs(uniquePiece))
        .map((clip) => clip.timelineStartUs)
        .sort((a, b) => a - b);
      const points = [uniquePiece.timelineStartUs, ...new Set(transitionPoints), clipEndUs(uniquePiece)];
      for (let index = 0; index + 1 < points.length; index++) {
        const partId = index === 0 ? uniquePiece.id : newId('clp');
        const part = clipSegment(uniquePiece, points[index]!, points[index + 1]!, partId);
        if (!part) continue;
        clipIds.add(part.id);
        const previous = selectedClips.filter((clip) => clip.timelineStartUs < clipEndUs(part) && clipEndUs(clip) > part.timelineStartUs);
        candidatePieces.push(preserveSelectedEdits(part, previous, part.timelineStartUs, clipEndUs(part)));
      }
    }
  }
  if (!candidatePieces.length) throw new Error('Não há cenas candidatas para inserir no intervalo sem substituir clipes não selecionados.');

  const commands: Command[] = selectedClips.map((clip) => ({ type: 'clip.remove', clipId: clip.id }));
  for (const clip of selectedClips) {
    const covered = candidatePieces
      .map((candidate) => ({
        startUs: Math.max(clip.timelineStartUs, candidate.timelineStartUs),
        endUs: Math.min(clipEndUs(clip), clipEndUs(candidate)),
      }))
      .filter((interval) => interval.endUs > interval.startUs);
    const retained = freeIntervals(clip.timelineStartUs, clipEndUs(clip), covered);
    for (const [index, interval] of retained.entries()) {
      const fragment = clipSegment(clip, interval.startUs, interval.endUs, index === 0 ? clip.id : newId('clp'));
      if (fragment) {
        clipIds.add(fragment.id);
        commands.push({ type: 'clip.add', clip: fragment });
      }
    }
  }
  for (const candidate of candidatePieces) commands.push({ type: 'clip.add', clip: candidate });
  return { commands, replaced: selectedClips.length, added: candidatePieces.length };
}
