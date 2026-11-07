/**
 * Plano de render: divide a timeline em JANELAS em que o conjunto de camadas não
 * muda. Cada janela vira um comando do FFmpeg pequeno (poucas entradas), e no fim
 * os pedaços são concatenados sem recodificar. Memória fica limitada mesmo com
 * centenas de cortes, e cancelar/retomar é natural.
 */
import {
  clipEndUs,
  clipRamps,
  projectDurationUs,
  transitionUnderlay,
  type Clip,
  type Project,
  type Rational,
  type Track,
} from '@amv/project';

export interface Layer {
  clip: Clip;
  track: Track;
  /** true = clipe anterior continuando por baixo durante a transição do próximo. */
  underlay: boolean;
  /** Tempo local do clipe (µs desde o início dele na timeline) no começo da janela. */
  localStartUs: number;
}

export interface Window {
  index: number;
  startFrame: number;
  frames: number;
  startUs: number;
  durUs: number;
  /** De baixo para cima. */
  layers: Layer[];
}

export function frameAt(us: number, fps: Rational): number {
  return Math.round((us * fps.num) / (fps.den * 1e6));
}

export function usAtFrame(f: number, fps: Rational): number {
  return Math.round((f * fps.den * 1e6) / fps.num);
}

/** Trilhas visuais de baixo para cima (a última da lista é a de baixo). */
export function visualTracksBottomUp(project: Project): Track[] {
  return project.tracks.filter((t) => t.kind !== 'audio' && !t.hidden).reverse();
}

export function planWindows(project: Project, fps: Rational = project.settings.fps): { windows: Window[]; totalFrames: number; durationUs: number } {
  const durationUs = projectDurationUs(project);
  const totalFrames = frameAt(durationUs, fps);
  const tracks = visualTracksBottomUp(project);
  const trackIds = new Set(tracks.map((t) => t.id));
  const clips = project.clips.filter((c) => trackIds.has(c.trackId));

  // fronteiras: início/fim de clipes, mudanças de rampa e fim das transições
  const cuts = new Set<number>([0, totalFrames]);
  const addUs = (us: number) => {
    const f = frameAt(us, fps);
    if (f > 0 && f < totalFrames) cuts.add(f);
  };
  for (const c of clips) {
    addUs(c.timelineStartUs);
    addUs(clipEndUs(c));
    for (const r of clipRamps(c, c.durationUs / 1e6)) {
      addUs(c.timelineStartUs + r.startS * 1e6);
      addUs(c.timelineStartUs + (r.startS + r.durS) * 1e6);
    }
  }
  const sorted = [...cuts].sort((a, b) => a - b);

  const windows: Window[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (b <= a) continue;
    const startUs = usAtFrame(a, fps);
    const midUs = (startUs + usAtFrame(b, fps)) / 2;
    const layers: Layer[] = [];
    for (const track of tracks) {
      const active = clips.find((c) => c.trackId === track.id && midUs >= c.timelineStartUs && midUs < clipEndUs(c));
      if (!active) continue;
      // anterior continuando por baixo durante a transição de entrada
      const under = transitionUnderlay(clips, active);
      if (under && midUs < active.timelineStartUs + (active.transitionIn?.durationUs ?? 0)) {
        layers.push({ clip: under, track, underlay: true, localStartUs: startUs - under.timelineStartUs });
      }
      layers.push({ clip: active, track, underlay: false, localStartUs: Math.max(0, startUs - active.timelineStartUs) });
    }
    windows.push({ index: windows.length, startFrame: a, frames: b - a, startUs, durUs: usAtFrame(b, fps) - startUs, layers });
  }
  // janelas vazias seguidas viram uma só
  const merged: Window[] = [];
  for (const w of windows) {
    const prev = merged.at(-1);
    if (prev && prev.layers.length === 0 && w.layers.length === 0) {
      prev.frames += w.frames;
      prev.durUs += w.durUs;
    } else merged.push({ ...w, index: merged.length });
  }
  return { windows: merged, totalFrames, durationUs };
}
