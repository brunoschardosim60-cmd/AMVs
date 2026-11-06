import type { Clip, Project } from './schema.js';
import type { Us } from './time.js';

export function clipEndUs(clip: Clip): Us {
  return clip.timelineStartUs + clip.durationUs;
}

/** Duração total da timeline (fim do último clipe). */
export function projectDurationUs(project: Project): Us {
  let end = 0;
  for (const c of project.clips) end = Math.max(end, clipEndUs(c));
  return end;
}

export function clipsOnTrack(project: Project, trackId: string): Clip[] {
  return project.clips
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.timelineStartUs - b.timelineStartUs);
}

/** Pares de clipes que se sobrepõem na mesma trilha. */
export function findOverlaps(project: Project): [Clip, Clip][] {
  const out: [Clip, Clip][] = [];
  for (const t of project.tracks) {
    const list = clipsOnTrack(project, t.id);
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!;
      const cur = list[i]!;
      if (cur.timelineStartUs < clipEndUs(prev)) out.push([prev, cur]);
    }
  }
  return out;
}
