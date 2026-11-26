import {
  clearRange,
  splitAllAt,
  deleteClips,
  newId,
  clipEndUs,
  EditError,
  findSnap,
  formatTimecode,
  insertAsset,
  moveClips,
  projectDurationUs,
  sourceDurationUs,
  TextContentSchema,
  snapPoints,
  sourceTimeAt,
  speedAt,
  timelineLocalAtSource,
  TRANSITIONS,
  trimBounds,
  trimClip,
  type Clip,
  type Command,
  type MoveTarget,
  type Project,
  type Track,
} from '@amv/project';
import type { ShotTag } from '@amv/analysis';
import { alignClipPeakToNearestBeat, harmonizeTextClipsWithScenes } from '@amv/automv';
import { editSubtitleTextManually, LOOKS, restyleSubtitles, subtitleClips } from '@amv/subtitles';
import { ChevronDown, ChevronUp, Eye, EyeOff, Headphones, Languages, Layers3, Lock, LockOpen, Magnet, Pencil, Plus, ScanSearch, Scissors, SlidersHorizontal, Sparkles, Trash2, Type, Volume2, VolumeX, Wand2, Zap, ZoomIn, ZoomOut } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { ProjectSession } from '../../core/session';
import { useApp } from '../../store';
import { Button, Dialog, IconButton } from '../../ui/controls';
import { nextTextStart } from './textPlacement';
import { ignoreEditorKey, pxToUs, useEditor, usToPx, ZOOM_MAX, ZOOM_MIN } from './editorStore';
import { applyFramingPreset, clipSceneShotPatch, clipSourceRangePatch, FRAMING_PRESETS, LOCAL_FONT_FAMILIES, translateTextClipsToPt } from './Inspector';
import { ClipRangePreview } from './MomentsPanel';
import { useStrip, useWaveform } from './mediaCache';
import { getPlayer, toggleAuditionClip } from './Preview';
import { TEXT_ANIMATIONS_IN, TEXT_ANIMATIONS_OUT } from './textLayer';
import { pickLevel } from '@amv/media';
import { selectClipsInMarquee } from './timelineSelection';
import { QualityDialog } from './QualityDialog';
import { GenerateDialog } from '../automv/GenerateDialog';
import { AudioMixerDialog } from './AudioMixerDialog';
import { buildSessionReadingInputs } from './readingInputs';

const HEADER_W = 180;
const RULER_H = 26;
export const TRACK_H: Record<Track['kind'], number> = { video: 58, audio: 50, text: 34 };
const SNAP_PX = 8;
const EDGE_PX = 6;

const MODAL_SCENE_TAGS: { id: ShotTag; label: string }[] = [
  { id: 'impacto', label: 'Impacto' },
  { id: 'ação', label: 'Ação' },
  { id: 'grito', label: 'Grito' },
  { id: 'fala', label: 'Fala' },
  { id: 'calma', label: 'Calma' },
  { id: 'clarão', label: 'Clarão' },
];

type Gesture =
  | { kind: 'move'; ids: string[]; clickedId: string; hadMultiSelection: boolean; startX: number; startY: number; originTrackIdx: number; deltaUs: number; trackShift: number; snapAt: number | null; moved: boolean }
  | { kind: 'trim'; id: string; edge: 'start' | 'end'; startX: number; toUs: number; snapAt: number | null }
  | { kind: 'marquee'; startX: number; startY: number; endX: number; endY: number; initialSelection: string[]; moved: boolean }
  | { kind: 'scrub' }
  | null;

function trackColor(t: Track): string {
  return t.kind === 'video'
    ? 'bg-violet-deep/85 border-violet/55'
    : t.kind === 'audio'
      ? 'bg-azure-deep/85 border-azure/45'
      : 'bg-violet-deep border-ok/50';
}

// --------------------------------------------------------------------------- régua

interface TimelineSectionMark {
  startUs: number;
  endUs: number;
  label: string;
  energy: number;
}

function RulerPlayhead({ zoom }: { zoom: number }) {
  const playheadUs = useEditor((s) => s.playheadUs);
  return (
    <div
      className="pointer-events-none absolute bottom-0 size-0"
      style={{ left: usToPx(playheadUs, zoom) - 6, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '9px solid var(--color-azure)' }}
    />
  );
}

function TimelinePlayhead({ zoom, scrollRef }: { zoom: number; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const playheadUs = useEditor((s) => s.playheadUs);
  const playing = useEditor((s) => s.playing);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const x = usToPx(playheadUs, zoom);
    const view = el.clientWidth - HEADER_W;
    if (x > el.scrollLeft + view - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80);
  }, [playheadUs, zoom, playing, scrollRef]);
  return <div className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-azure" style={{ left: usToPx(playheadUs, zoom) }} />;
}

function TimelineSplitButton({
  project,
  editableSelection,
  hasSelection,
  onSplit,
}: {
  project: Project;
  editableSelection: Clip[];
  hasSelection: boolean;
  onSplit: (ids: string[]) => void;
}) {
  const playheadUs = useEditor((s) => s.playheadUs);
  const pool = hasSelection
    ? editableSelection
    : project.clips.filter((clip) => project.tracks.some((track) => track.id === clip.trackId && !track.locked));
  const splittable = pool.filter((clip) => clip.timelineStartUs < playheadUs && clipEndUs(clip) > playheadUs);
  return (
    <IconButton
      label="Dividir no cursor (S)"
      className="size-7 shrink-0"
      disabled={!splittable.length}
      onClick={() => onSplit(splittable.map((clip) => clip.id))}
    >
      <Scissors size={14} />
    </IconButton>
  );
}

function Ruler({
  zoom,
  width,
  fps,
  sections = [],
  onScrub,
}: {
  zoom: number;
  width: number;
  fps: Project['settings']['fps'];
  sections?: TimelineSectionMark[];
  onScrub: (e: RPointerEvent) => void;
}) {
  // intervalo entre marcas grandes: o menor "bonito" que dá ≥ 90 px
  const steps = [0.04, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const major = steps.find((s) => s * zoom >= 90) ?? 600;
  const minor = major / 5;
  const count = Math.ceil(width / (minor * zoom)) + 1;
  const ticks = [];
  for (let i = 0; i < count; i++) {
    const s = i * minor;
    const isMajor = i % 5 === 0;
    ticks.push(
      <div key={i} className="absolute top-0 bottom-0" style={{ left: s * zoom }}>
        <div className={`absolute bottom-0 w-px ${isMajor ? 'h-2.5 bg-muted' : 'h-1.5 bg-faint'}`} />
        {isMajor && <span className="tnum absolute top-0.5 left-1 text-2xs whitespace-nowrap text-muted">{formatTimecode(s * 1e6, fps)}</span>}
      </div>,
    );
  }
  return (
    <div className="relative cursor-text border-b border-line bg-panel" style={{ height: RULER_H, width }} onPointerDown={onScrub}>
      {ticks}
      {sections.map((sec, idx) => {
        const left = usToPx(sec.startUs, zoom);
        const w = Math.max(0, usToPx(sec.endUs - sec.startUs, zoom));
        if (w < 44) return null;
        const isDrop = /drop|refr|cl[ií]max/i.test(sec.label) || sec.energy >= 0.75;
        return (
          <div
            key={`${sec.startUs}-${idx}`}
            className="pointer-events-none absolute bottom-0 overflow-hidden"
            style={{ left, width: w, height: 11 }}
          >
            <span
              className={`inline-block rounded-tr px-1 text-[8px] font-bold uppercase leading-[11px] tracking-wider ${
                isDrop ? 'bg-violet/35 text-violet-strong' : 'bg-raised/85 text-faint'
              }`}
            >
              {sec.label}
            </span>
          </div>
        );
      })}
      <RulerPlayhead zoom={zoom} />
    </div>
  );
}

// --------------------------------------------------------------------------- conteúdo do clipe

const Waveform = memo(function Waveform({ clip, widthPx, zoom, session, color }: { clip: Clip; widthPx: number; zoom: number; session: ProjectSession; color: string }) {
  const platform = useApp((s) => s.platform)!;
  const w = useWaveform(platform, session, clip.assetId);
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv || !w) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.min(widthPx, 8000);
    const cssH = cv.clientHeight || 30;
    cv.width = Math.max(1, Math.round(cssW * dpr));
    cv.height = Math.round(cssH * dpr);
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = color;
    const level = pickLevel(w, zoom / Math.max(0.1, speedAt(clip, clip.durationUs / 2))); // média local para escolher o nível do waveform
    const secondsPerBucket = level.samplesPerBucket / w.sampleRate;
    const mid = cv.height / 2;
    const scaleX = cssW / widthPx; // se o canvas foi limitado, comprime
    for (let x = 0; x < cv.width; x++) {
      const tlUs = ((x / dpr / scaleX) / zoom) * 1e6;
      const srcS = sourceTimeAt(clip, tlUs) / 1e6;
      const i = Math.floor(srcS / secondsPerBucket);
      if (i < 0 || i >= level.mins.length) continue;
      const lo = level.mins[i]! / 32768;
      const hi = level.maxs[i]! / 32768;
      const y1 = mid - hi * mid * 0.95;
      const y2 = mid - lo * mid * 0.95;
      ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
  }, [w, widthPx, zoom, clip.sourceInUs, clip.sourceOutUs, clip.durationUs, clip.speed, clip.reverse, clip.keyframes.speed, color]);
  if (!w) return null;
  return <canvas ref={ref} className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%]" style={{ width: Math.min(widthPx, 8000) }} />;
});

const Thumbs = memo(function Thumbs({ clip, widthPx, zoom, session, height }: { clip: Clip; widthPx: number; zoom: number; session: ProjectSession; height: number }) {
  const platform = useApp((s) => s.platform)!;
  const strip = useStrip(platform, session, clip.assetId);
  if (!strip) return null;
  const { plan, url } = strip;
  const tileW = (plan.tileWidth * height) / plan.tileHeight;
  const n = Math.min(80, Math.ceil(widthPx / tileW));
  const tiles = [];
  for (let i = 0; i < n; i++) {
    const tlS = (i * tileW) / zoom;
    const srcS = sourceTimeAt(clip, tlS * 1e6) / 1e6;
    const idx = Math.min(plan.count - 1, Math.max(0, Math.floor(srcS / plan.intervalS)));
    const col = idx % plan.cols;
    const row = Math.floor(idx / plan.cols);
    tiles.push(
      <div
        key={i}
        className="absolute top-0 bottom-0"
        style={{
          left: i * tileW,
          width: tileW,
          backgroundImage: `url("${url}")`,
          backgroundSize: `${plan.cols * tileW}px ${plan.rows * height}px`,
          backgroundPosition: `-${col * tileW}px -${row * height}px`,
        }}
      />,
    );
  }
  return <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-75">{tiles}</div>;
});

// --------------------------------------------------------------------------- timeline

export function Timeline({ session, project }: { session: ProjectSession; project: Project }) {
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const toggleSelect = useEditor((s) => s.toggleSelect);
  const snapping = useEditor((s) => s.snapping);
  const setSnapping = useEditor((s) => s.setSnapping);
  const assetDrag = useEditor((s) => s.assetDrag);
  const setAssetDrag = useEditor((s) => s.setAssetDrag);
  const requestInspector = useEditor((s) => s.requestInspector);
  const editingClipId = useEditor((s) => s.editingClipId);
  const setEditingClipId = useEditor((s) => s.setEditingClipId);
  const soloClipId = useEditor((s) => s.soloClipId);
  const toast = useApp((s) => s.toast);
  const platform = useApp((s) => s.platform);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture>(null);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [audioMixerOpen, setAudioMixerOpen] = useState(false);
  const gestureRef = useRef<Gesture>(null);
  gestureRef.current = gesture;
  const [dropHint, setDropHintState] = useState<{ trackId: string; startUs: number; durUs: number; ok: boolean } | null>(null);
  // a dica também fica num ref: soltar precisa ler o valor atual sem efeito colateral dentro de setState
  const dropHintRef = useRef(dropHint);
  const setDropHint = useCallback((h: typeof dropHint) => {
    dropHintRef.current = h;
    setDropHintState(h);
  }, []);

  const tracks = project.tracks;
  const durationUs = projectDurationUs(project);
  const targetVideoTrack = [...tracks].reverse().find((track) => track.kind === 'video');
  const regenerableClips = targetVideoTrack
    ? project.clips.filter((clip) => selection.includes(clip.id) && clip.trackId === targetVideoTrack.id && !!clip.assetId && !clip.text)
    : [];
  const localizedRange = regenerableClips.length
    ? {
        startUs: Math.min(...regenerableClips.map((clip) => clip.timelineStartUs)),
        endUs: Math.max(...regenerableClips.map(clipEndUs)),
        trackId: targetVideoTrack!.id,
        clipIds: regenerableClips.map((clip) => clip.id),
      }
    : null;
  const contentW = Math.max(usToPx(durationUs, zoom) + 400, (scrollRef.current?.clientWidth ?? 1200) - HEADER_W);
  const thresholdUs = pxToUs(SNAP_PX, zoom);

  /** Batidas/compassos/drops das músicas na timeline, já em tempo da timeline. */
  const beatMarks = useMemo(() => {
    const out: { atUs: number; kind: 'beat' | 'down' | 'drop'; trackId: string }[] = [];
    for (const c of project.clips) {
      const t = tracks.find((x) => x.id === c.trackId);
      if (t?.kind !== 'audio' || !c.assetId) continue;
      const m = session.assetRuntime(c.assetId).music;
      if (!m) continue;
      const toTl = (s: number) => {
        const localUs = timelineLocalAtSource(c, s * 1e6);
        return localUs === null ? Number.NaN : c.timelineStartUs + localUs;
      };
      const inside = (us: number) => us >= c.timelineStartUs && us < c.timelineStartUs + c.durationUs;
      const downs = new Set(m.downbeats.map((d) => Math.round(d * 1000)));
      for (const b of m.beats) {
        const us = Math.round(toTl(b));
        if (!Number.isFinite(us)) continue;
        if (inside(us)) out.push({ atUs: us, kind: downs.has(Math.round(b * 1000)) ? 'down' : 'beat', trackId: c.trackId });
      }
      for (const d of m.drops.slice(0, 2)) {
        const us = Math.round(toTl(d));
        if (!Number.isFinite(us)) continue;
        if (inside(us)) out.push({ atUs: us, kind: 'drop', trackId: c.trackId });
      }
    }
    return out;
  }, [project.clips, tracks, session, session.changes]);
  const sectionMarks = useMemo(() => {
    const out: TimelineSectionMark[] = [];
    for (const c of project.clips) {
      const t = tracks.find((x) => x.id === c.trackId);
      if (t?.kind !== 'audio' || t.role !== 'music' || !c.assetId) continue;
      const m = session.assetRuntime(c.assetId).music;
      if (!m?.sections?.length) continue;
      for (const sec of m.sections) {
        const startLocal = timelineLocalAtSource(c, Math.max(c.sourceInUs, Math.round(sec.startS * 1e6)));
        const endLocal = timelineLocalAtSource(c, Math.min(c.sourceOutUs || c.sourceInUs + c.durationUs, Math.round(sec.endS * 1e6)));
        if (startLocal === null || endLocal === null) continue;
        const startUs = Math.max(c.timelineStartUs, c.timelineStartUs + Math.min(startLocal, endLocal));
        const endUs = Math.min(clipEndUs(c), c.timelineStartUs + Math.max(startLocal, endLocal));
        if (endUs - startUs >= 400_000) {
          out.push({ startUs, endUs, label: sec.label, energy: sec.energy });
        }
      }
    }
    return out;
  }, [project.clips, tracks, session, session.changes]);
  const allSnapPoints = useCallback(
    (exclude: Set<string>) => [...snapPoints(project, useEditor.getState().playheadUs, exclude), ...beatMarks.map((b) => ({ atUs: b.atUs, kind: 'marker' as const }))],
    [project, beatMarks],
  );

  const trackTops = useMemo(() => {
    const tops: number[] = [];
    let y = 0;
    for (const t of tracks) {
      tops.push(y);
      y += TRACK_H[t.kind];
    }
    return { tops, total: y };
  }, [tracks]);

  const trackAtY = useCallback(
    (clientY: number): number => {
      const el = scrollRef.current;
      if (!el) return -1;
      const y = clientY - el.getBoundingClientRect().top - RULER_H + el.scrollTop;
      for (let i = tracks.length - 1; i >= 0; i--) if (y >= trackTops.tops[i]!) return i;
      return -1;
    },
    [tracks, trackTops],
  );

  const xToUs = useCallback(
    (clientX: number) => {
      const el = scrollRef.current!;
      return pxToUs(clientX - el.getBoundingClientRect().left - HEADER_W + el.scrollLeft, zoom);
    },
    [zoom],
  );

  const run = useCallback(
    (label: string, cmds: Command[]) => {
      if (!cmds.length) return;
      try {
        session.history.transaction(label, cmds);
      } catch (e) {
        toast({ tone: 'error', title: 'Não deu para fazer isso', body: (e as Error).message });
      }
    },
    [session, toast],
  );

  // ---------------------------------------------------------------- scrub
  const startScrub = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setPlayhead(Math.max(0, xToUs(e.clientX)));
    setGesture({ kind: 'scrub' });
  };

  // ---------------------------------------------------------------- arrastar e aparar clipes
  const onClipPointerDown = (e: RPointerEvent, clip: Clip) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const track = tracks.find((t) => t.id === clip.trackId)!;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const offset = e.clientX - rect.left;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      toggleSelect(clip.id);
      return;
    }
    const hadMultiSelection = selection.length > 1;
    const dragBaseIds = selection.includes(clip.id) ? selection : [clip.id];
    if (!selection.includes(clip.id)) select([clip.id]);
    const currentPlayhead = useEditor.getState().playheadUs;
    if (currentPlayhead < clip.timelineStartUs || currentPlayhead >= clipEndUs(clip)) {
      setPlayhead(clip.timelineStartUs);
      getPlayer(session).seek(clip.timelineStartUs);
    }
    requestInspector();
    if (track.locked) return;
    const groups = new Set(dragBaseIds.map((id) => project.clips.find((item) => item.id === id)?.groupId).filter((id): id is string => !!id));
    const expanded = new Set(dragBaseIds);
    for (const grouped of project.clips) if (grouped.groupId && groups.has(grouped.groupId)) expanded.add(grouped.id);
    const ids = [...expanded];
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (offset <= EDGE_PX && rect.width > EDGE_PX * 3) {
      setGesture({ kind: 'trim', id: clip.id, edge: 'start', startX: e.clientX, toUs: clip.timelineStartUs, snapAt: null });
    } else if (rect.right - e.clientX <= EDGE_PX && rect.width > EDGE_PX * 3) {
      setGesture({ kind: 'trim', id: clip.id, edge: 'end', startX: e.clientX, toUs: clipEndUs(clip), snapAt: null });
    } else {
      setGesture({
        kind: 'move',
        ids,
        clickedId: clip.id,
        hadMultiSelection,
        startX: e.clientX,
        startY: e.clientY,
        originTrackIdx: tracks.indexOf(track),
        deltaUs: 0,
        trackShift: 0,
        snapAt: null,
        moved: false,
      });
    }
  };

  const moveTargets = useCallback(
    (g: Extract<Gesture, { kind: 'move' }>): MoveTarget[] | null => {
      const out: MoveTarget[] = [];
      for (const id of g.ids) {
        const c = project.clips.find((x) => x.id === id);
        if (!c) continue;
        const idx = tracks.findIndex((t) => t.id === c.trackId);
        const dest = tracks[idx + g.trackShift];
        if (!dest || dest.kind !== tracks[idx]!.kind) return null;
        out.push({ clipId: id, trackId: dest.id, startUs: Math.max(0, c.timelineStartUs + g.deltaUs) });
      }
      return out;
    },
    [project, tracks],
  );

  const onPointerMove = (e: RPointerEvent) => {
    const g = gestureRef.current;
    if (!g) return;
    if (g.kind === 'scrub') {
      setPlayhead(Math.max(0, xToUs(e.clientX)));
      return;
    }
    if (g.kind === 'marquee') {
      const moved = g.moved || Math.abs(e.clientX - g.startX) > 3 || Math.abs(e.clientY - g.startY) > 3;
      if (moved) {
        const firstTrack = trackAtY(g.startY);
        const lastTrack = trackAtY(e.clientY);
        if (firstTrack >= 0 && lastTrack >= 0) {
          select(
            selectClipsInMarquee(
              project,
              Math.max(0, xToUs(g.startX)),
              Math.max(0, xToUs(e.clientX)),
              firstTrack,
              lastTrack,
              g.initialSelection,
            ),
          );
        }
      }
      setGesture({ ...g, endX: e.clientX, endY: e.clientY, moved });
      return;
    }
    if (g.kind === 'trim') {
      const c = project.clips.find((x) => x.id === g.id)!;
      const base = g.edge === 'start' ? c.timelineStartUs : clipEndUs(c);
      let to = base + pxToUs(e.clientX - g.startX, zoom);
      let snapAt: number | null = null;
      if (snapping && !e.altKey) {
        const s = findSnap([to], allSnapPoints(new Set([c.id])), thresholdUs);
        if (s) {
          to += s.deltaUs;
          snapAt = s.point.atUs;
        }
      }
      const b = trimBounds(project, c.id, g.edge);
      setGesture({ ...g, toUs: Math.min(b.max, Math.max(b.min, to)), snapAt });
      return;
    }
    // move
    const dx = e.clientX - g.startX;
    const moved = g.moved || Math.abs(dx) > 3 || Math.abs(e.clientY - g.startY) > 3;
    let delta = pxToUs(dx, zoom);
    const clips = g.ids.map((id) => project.clips.find((x) => x.id === id)!).filter(Boolean);
    const minStart = Math.min(...clips.map((c) => c.timelineStartUs));
    if (minStart + delta < 0) delta = -minStart;
    let snapAt: number | null = null;
    if (snapping && !e.altKey) {
      const edges = clips.flatMap((c) => [c.timelineStartUs + delta, clipEndUs(c) + delta]);
      const s = findSnap(edges, allSnapPoints(new Set(g.ids)), thresholdUs);
      if (s) {
        delta += s.deltaUs;
        snapAt = s.point.atUs;
      }
    }
    const hovered = trackAtY(e.clientY);
    const shift = hovered >= 0 ? hovered - g.originTrackIdx : g.trackShift;
    setGesture({ ...g, deltaUs: delta, trackShift: shift, snapAt, moved });
  };

  const onPointerUp = () => {
    const g = gestureRef.current;
    setGesture(null);
    if (!g || g.kind === 'scrub') return;
    if (g.kind === 'marquee') return;
    if (g.kind === 'trim') {
      try {
        run(g.edge === 'start' ? 'Aparar início' : 'Aparar fim', trimClip(project, g.id, g.edge, g.toUs));
      } catch (e) {
        toast({ tone: 'error', title: 'Não deu para aparar', body: (e as Error).message });
      }
      return;
    }
    if (!g.moved) {
      if (g.hadMultiSelection) {
        select([g.clickedId]);
        requestInspector();
      }
      return;
    }
    const targets = moveTargets(g);
    if (!targets) {
      toast({ tone: 'warn', title: 'Clipes só podem ir para trilhas do mesmo tipo' });
      return;
    }
    try {
      run(g.ids.length > 1 ? `Mover ${g.ids.length} clipes` : 'Mover clipe', moveClips(project, targets));
    } catch (e) {
      toast({ tone: 'warn', title: 'Não deu para mover', body: e instanceof EditError ? e.message : String(e) });
    }
  };

  // ---------------------------------------------------------------- soltar mídia da biblioteca
  useEffect(() => {
    if (!assetDrag) {
      setDropHint(null);
      return;
    }
    const asset = project.assets.find((a) => a.id === assetDrag.assetId);
    if (!asset) return;
    const el = scrollRef.current;
    const onMove = (e: PointerEvent) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (e.clientX < r.left + HEADER_W || e.clientX > r.right || e.clientY < r.top + RULER_H || e.clientY > r.bottom) {
        setDropHint(null);
        return;
      }
      const idx = trackAtY(e.clientY);
      const track = tracks[idx];
      if (!track) {
        setDropHint(null);
        return;
      }
      const durUs = assetDrag.sourceOutUs !== undefined ? assetDrag.sourceOutUs - (assetDrag.sourceInUs ?? 0) : asset.kind === 'image' ? 3_000_000 : (asset.probe?.durationUs ?? 0);
      let start = Math.max(0, xToUs(e.clientX));
      if (snapping && !e.altKey) {
        const s = findSnap([start, start + durUs], allSnapPoints(new Set()), thresholdUs);
        if (s) start = Math.max(0, start + s.deltaUs);
      }
      let ok = true;
      try {
        insertAsset(project, { assetId: asset.id, trackId: track.id, startUs: start, sourceInUs: assetDrag.sourceInUs, sourceOutUs: assetDrag.sourceOutUs });
      } catch {
        ok = false;
      }
      setDropHint({ trackId: track.id, startUs: start, durUs, ok });
    };
    const onUp = () => {
      const hint = dropHintRef.current;
      setAssetDrag(null);
      setDropHint(null);
      if (hint?.ok) {
        try {
          run(`Adicionar ${assetDrag.sourceOutUs !== undefined ? 'trecho de ' : ''}${asset.name}`, insertAsset(project, { assetId: asset.id, trackId: hint.trackId, startUs: hint.startUs, sourceInUs: assetDrag.sourceInUs, sourceOutUs: assetDrag.sourceOutUs }));
        } catch (err) {
          toast({ tone: 'warn', title: 'Não deu para adicionar', body: (err as Error).message });
        }
      } else if (hint && !hint.ok) {
        const tr = tracks.find((t) => t.id === hint.trackId);
        toast({ tone: 'warn', title: `${asset.name} não pode ir para a trilha ${tr?.name ?? ''}`, body: tr?.locked ? 'A trilha está travada.' : 'Vídeo e imagem vão em trilhas de vídeo; música e falas em trilhas de áudio.' });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [assetDrag, project, tracks, trackAtY, xToUs, snapping, thresholdUs, run, setAssetDrag, setDropHint, toast, allSnapPoints]);

  // ---------------------------------------------------------------- zoom com Ctrl+roda, mantendo o ponto sob o mouse
  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const el = scrollRef.current!;
    const atUs = xToUs(e.clientX);
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    setZoom(next);
    requestAnimationFrame(() => {
      el.scrollLeft = usToPx(atUs, next) - (e.clientX - el.getBoundingClientRect().left - HEADER_W);
    });
  };

  const proposalMarks = useEditor((s) => s.proposalMarks);

  const addText = () => {
    const track = tracks.find((t) => t.kind === 'text' && !t.locked);
    if (!track) {
      toast({ tone: 'warn', title: 'Não há trilha de texto destravada' });
      return;
    }
    const id = newId('clp');
    const phUs = useEditor.getState().playheadUs;
    const startUs = nextTextStart(project, track.id, phUs, 3_000_000);
    const P = project.settings;
    const cmds: Command[] = [
      {
        type: 'clip.add',
        clip: {
          id, trackId: track.id, assetId: null, timelineStartUs: startUs, durationUs: 3_000_000, sourceInUs: 0, sourceOutUs: 3_000_000, speed: 1, reverse: false,
          transform: { x: 0, y: Math.round(P.height * 0.36), scale: 1, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
          blendMode: 'normal', mask: 'none', groupId: null,
          audio: { gainDb: 0, fadeInUs: 0, fadeOutUs: 0, pitchSemitones: 0, pitchMode: 'preserve', streamIndex: null },
          effects: [], transitionIn: null, keyframes: {},
          text: TextContentSchema.parse({ text: 'Seu texto', font: 'Manrope Variable', size: Math.round(P.height * 0.05), color: '#ffffff', outlineColor: '#000000', outlineWidth: 3, shadow: true, animationIn: 'fade', animationOut: 'fade' }),
          origin: 'user', reason: null, confidence: null, label: null,
        },
      },
    ];
    run('Adicionar texto', cmds);
    select([id]);
    if (startUs !== phUs) toast({ tone: 'info', title: 'Texto adicionado depois da legenda existente' });
  };

  const addTrack = (kind: Track['kind']) => {
    const sameKind = tracks.filter((track) => track.kind === kind);
    const name = kind === 'video' ? `V${sameKind.length + 1}` : kind === 'text' ? `Texto ${sameKind.length + 1}` : `Áudio ${sameKind.length + 1}`;
    const insertIndex = kind === 'video'
      ? tracks.findIndex((track) => track.kind === 'video') >= 0 ? tracks.findIndex((track) => track.kind === 'video') : tracks.findIndex((track) => track.kind === 'text')
      : tracks.findIndex((track) => track.kind === kind);
    const index = insertIndex < 0 ? tracks.length : insertIndex;
    run(`Adicionar trilha ${name}`, [{
      type: 'track.add',
      index,
      track: { id: newId('trk'), kind, name, role: kind === 'audio' ? 'other' : null, locked: false, hidden: false, muted: false, solo: false, gainDb: 0 },
    }]);
  };

  const moveTrack = (track: Track, direction: -1 | 1) => {
    const ordered = tracks.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === track.kind);
    const position = ordered.findIndex(({ item }) => item.id === track.id);
    const target = ordered[position + direction];
    if (target) run('Reordenar trilha', [{ type: 'track.move', trackId: track.id, index: target.index }]);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignoreEditorKey(e)) return;
      if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey && !e.altKey) addTextRef.current();
      const isSoloKey = (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'o')
        || (!e.ctrlKey && !e.metaKey && e.altKey && e.key.toLowerCase() === 's');
      if (isSoloKey) {
        const selId = useEditor.getState().selection[0];
        const selClip = selId ? session.project.clips.find((c) => c.id === selId) : undefined;
        if (selClip && !selClip.text) {
          e.preventDefault();
          toggleAuditionClip(session, selClip);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);
  const addTextRef = useRef(addText);
  addTextRef.current = addText;

  const fitAll = () => {
    const el = scrollRef.current;
    if (!el || durationUs <= 0) return;
    setZoom(((el.clientWidth - HEADER_W - 40) / durationUs) * 1e6);
    el.scrollLeft = 0;
  };

  // ---------------------------------------------------------------- render
  const preview = gesture?.kind === 'move' && gesture.moved ? moveTargets(gesture) : null;
  const snapLine = gesture?.kind === 'move' || gesture?.kind === 'trim' ? gesture.snapAt : null;
  const marqueeBox = (() => {
    if (!gesture || gesture.kind !== 'marquee' || !gesture.moved) return null;
    const el = scrollRef.current;
    if (!el) return null;
    const left = Math.max(0, usToPx(Math.max(0, xToUs(gesture.startX)), zoom));
    const right = Math.max(0, usToPx(Math.max(0, xToUs(gesture.endX)), zoom));
    const y = (clientY: number) => clientY - el.getBoundingClientRect().top + el.scrollTop - RULER_H;
    const top = Math.max(0, Math.min(y(gesture.startY), y(gesture.endY)));
    const bottom = Math.min(trackTops.total, Math.max(y(gesture.startY), y(gesture.endY)));
    return { left: Math.min(left, right), top, width: Math.abs(right - left), height: Math.max(0, bottom - top) };
  })();

  const clipBox = (c: Clip) => {
    let start = c.timelineStartUs;
    let dur = c.durationUs;
    let trackId = c.trackId;
    if (gesture?.kind === 'trim' && gesture.id === c.id) {
      if (gesture.edge === 'start') {
        dur = clipEndUs(c) - gesture.toUs;
        start = gesture.toUs;
      } else dur = gesture.toUs - c.timelineStartUs;
    }
    const pv = preview?.find((p) => p.clipId === c.id);
    if (pv) {
      start = pv.startUs;
      trackId = pv.trackId;
    }
    return { start, dur, trackId, dragging: !!pv };
  };

  const editableSelection = project.clips.filter((clip) => selection.includes(clip.id) && tracks.some((track) => track.id === clip.trackId && !track.locked));
  const selectedClip = selection.length === 1 ? project.clips.find((clip) => clip.id === selection[0]) : undefined;
  const editingClip = editingClipId ? project.clips.find((clip) => clip.id === editingClipId) : undefined;

  return (
    <>
    <section className="editor-timeline-panel flex min-h-0 flex-1 flex-col border-t border-line" aria-label="Timeline">
      <div className="shrink-0 border-b border-line-soft bg-panel">
        <div className="timeline-primary-tools flex h-9 items-center gap-1 overflow-x-auto px-2">
          <div className="mr-2 flex shrink-0 items-center gap-2 pl-1">
            <Layers3 size={14} className="text-violet-strong" />
            <span className="text-2xs font-semibold text-ink-soft">Timeline</span>
          </div>
          <span className="h-4 w-px shrink-0 bg-line" />
          <IconButton label={snapping ? 'Encaixe ligado (segure Alt para ignorar)' : 'Encaixe desligado'} aria-pressed={snapping} className={`size-7 ${snapping ? 'text-violet-strong' : ''}`} onClick={() => setSnapping(!snapping)}>
            <Magnet size={14} />
          </IconButton>
          <span className="mx-1 h-4 w-px shrink-0 bg-line" />
          <IconButton label="Diminuir zoom (−)" className="size-7" onClick={() => setZoom(zoom / 1.4)}>
            <ZoomOut size={14} />
          </IconButton>
          <input
            type="range"
            aria-label="Zoom da timeline"
            className="w-24 accent-violet"
            min={Math.log(ZOOM_MIN)}
            max={Math.log(ZOOM_MAX)}
            step={0.01}
            value={Math.log(zoom)}
            onChange={(e) => setZoom(Math.exp(Number(e.target.value)))}
          />
          <IconButton label="Aumentar zoom (+)" className="size-7" onClick={() => setZoom(zoom * 1.4)}>
            <ZoomIn size={14} />
          </IconButton>
          <Button variant="ghost" size="sm" className="shrink-0" disabled={durationUs <= 0} onClick={fitAll}>Ajustar tudo</Button>
          <span className="mx-1 h-4 w-px shrink-0 bg-line" />
          <TimelineSplitButton
            project={project}
            editableSelection={editableSelection}
            hasSelection={selection.length > 0}
            onSplit={(ids) => run('Dividir', splitAllAt(project, useEditor.getState().playheadUs, ids))}
          />
          <IconButton label="Excluir seleção" className="size-7 shrink-0" disabled={!editableSelection.length} onClick={() => { run('Excluir', deleteClips(project, editableSelection.map((clip) => clip.id))); select([]); }}><Trash2 size={14} /></IconButton>
          <span className="tnum ml-auto shrink-0 pr-2 text-[10px] text-muted">
            {selection.length ? `${selection.length} selecionado(s) · ` : ''}{formatTimecode(durationUs, project.settings.fps)}
          </span>
        </div>
        <div className="flex h-9 items-center gap-1 overflow-x-auto border-t border-line-soft/60 px-2">
          <span className="mr-1 shrink-0 text-[9px] font-bold uppercase tracking-[0.12em] text-faint">Adicionar</span>
          <Button variant="ghost" size="sm" className="shrink-0" icon={<Type size={13} />} onClick={addText} title="Adicionar texto no playhead (T)">Texto</Button>
          <button type="button" className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-soft transition-colors hover:bg-raised hover:text-ink" onClick={() => addTrack('text')} title="Adicionar trilha de texto">
            <Plus size={12} /> Trilha de texto
          </button>
          <button type="button" className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-soft transition-colors hover:bg-raised hover:text-ink" onClick={() => addTrack('video')} title="Adicionar camada de vídeo">
            <Plus size={12} /> Vídeo
          </button>
          <button type="button" className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-soft transition-colors hover:bg-raised hover:text-ink" onClick={() => addTrack('audio')} title="Adicionar faixa de áudio">
            <Plus size={12} /> Áudio
          </button>
          <span className="mx-1 h-4 w-px shrink-0 bg-line" />
          <IconButton label="Abrir mixer de áudio" className="size-7" onClick={() => setAudioMixerOpen(true)}>
            <SlidersHorizontal size={14} />
          </IconButton>
          <IconButton label="Avaliar qualidade audiovisual" className="size-7" onClick={() => setQualityOpen(true)}>
            <ScanSearch size={14} />
          </IconButton>
          <button
            type="button"
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-ink-soft transition-colors hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:text-faint"
            title={localizedRange ? 'Gerar uma alternativa apenas para os clipes de vídeo selecionados' : 'Selecione clipes de vídeo na trilha principal'}
            disabled={!localizedRange}
            onClick={() => setRegenerateOpen(true)}
          >
            <Sparkles size={13} /> Melhorar seleção
          </button>
        </div>
        {selectedClip && (
          <TimelineQuickEditBar
            session={session}
            project={project}
            clip={selectedClip}
            platform={platform}
            run={run}
            toast={toast}
            onOpenModal={() => {
              requestInspector();
              setEditingClipId(selectedClip.id);
            }}
          />
        )}
      </div>

      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto"
        onWheel={onWheel}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          const current = gestureRef.current;
          if (current?.kind === 'marquee') select(current.initialSelection);
          setGesture(null);
        }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) select([]);
        }}
      >
        <div className="relative" style={{ width: HEADER_W + contentW, minHeight: '100%' }}>
          {/* régua */}
          <div className="sticky top-0 z-20 flex">
            <div className="editor-ruler-gutter sticky left-0 z-30 flex shrink-0 items-center border-r border-b border-line px-3" style={{ width: HEADER_W, height: RULER_H }}>
              <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-faint">Trilhas · tempo</span>
            </div>
            <Ruler zoom={zoom} width={contentW} fps={project.settings.fps} sections={sectionMarks} onScrub={startScrub} />
          </div>

          {/* trilhas */}
          {tracks.map((t) => {
            const h = TRACK_H[t.kind];
            const sameKind = tracks.filter((item) => item.kind === t.kind);
            const trackPosition = sameKind.findIndex((item) => item.id === t.id);
            return (
              <div key={t.id} className="editor-track-row flex border-b border-line-soft" style={{ height: h }}>
                <div className="editor-track-header sticky left-0 z-10 flex shrink-0 items-center gap-0.5 border-r border-line px-2" style={{ width: HEADER_W }}>
                  <span className={`mr-auto min-w-0 truncate text-[11px] font-semibold ${t.hidden || t.muted ? 'text-faint' : 'text-ink-soft'}`} title={t.name}>{t.name}</span>
                  <IconButton label="Mover trilha para cima" className="size-6" disabled={trackPosition === 0} onClick={() => moveTrack(t, -1)}>
                    <ChevronUp size={13} />
                  </IconButton>
                  <IconButton label="Mover trilha para baixo" className="size-6" disabled={trackPosition === sameKind.length - 1} onClick={() => moveTrack(t, 1)}>
                    <ChevronDown size={13} />
                  </IconButton>
                  <IconButton label={t.locked ? 'Destrave para remover' : 'Remover trilha vazia'} className="size-6" disabled={t.locked || project.clips.some((clip) => clip.trackId === t.id)} onClick={() => run('Remover trilha vazia', [{ type: 'track.remove', trackId: t.id }])}>
                    <Trash2 size={12} />
                  </IconButton>
                  {t.kind === 'audio' ? (
                    <>
                      <button
                        type="button"
                        aria-label={t.solo ? 'Sair do solo da trilha' : 'Isolar trilha (Solo)'}
                        aria-pressed={t.solo}
                        title={t.solo ? 'Sair do solo da trilha' : 'Ouvir apenas esta trilha (Solo)'}
                        onClick={() => run(t.solo ? 'Sair do solo da trilha' : 'Isolar trilha', [{ type: 'track.update', trackId: t.id, patch: { solo: !t.solo } }])}
                        className={`grid size-6 place-items-center rounded text-[10px] font-bold ${t.solo ? 'bg-azure text-action-ink' : 'text-muted hover:bg-raised hover:text-ink'}`}
                      >
                        S
                      </button>
                      <IconButton label={t.muted ? 'Ativar som' : 'Silenciar'} aria-pressed={t.muted} className={`size-6 ${t.muted ? 'text-warn' : ''}`} onClick={() => run(t.muted ? 'Ativar som da trilha' : 'Silenciar trilha', [{ type: 'track.update', trackId: t.id, patch: { muted: !t.muted } }])}>
                        {t.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                      </IconButton>
                    </>
                  ) : (
                    <IconButton label={t.hidden ? 'Mostrar' : 'Ocultar'} aria-pressed={t.hidden} className={`size-6 ${t.hidden ? 'text-warn' : ''}`} onClick={() => run(t.hidden ? 'Mostrar trilha' : 'Ocultar trilha', [{ type: 'track.update', trackId: t.id, patch: { hidden: !t.hidden } }])}>
                      {t.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                    </IconButton>
                  )}
                  <IconButton label={t.locked ? 'Destravar' : 'Travar'} aria-pressed={t.locked} className={`size-6 ${t.locked ? 'text-warn' : ''}`} onClick={() => run(t.locked ? 'Destravar trilha' : 'Travar trilha', [{ type: 'track.update', trackId: t.id, patch: { locked: !t.locked } }])}>
                    {t.locked ? <Lock size={13} /> : <LockOpen size={13} />}
                  </IconButton>
                </div>
                <div
                  className={`relative flex-1 ${t.locked ? 'bg-[repeating-linear-gradient(-45deg,transparent_0_6px,rgb(255_255_255/0.02)_6px_12px)]' : ''}`}
                  title="Clique para posicionar o playhead; arraste para selecionar clipes. Shift/Ctrl adiciona à seleção."
                  onPointerDown={(e) => {
                    if (e.button === 0 && e.target === e.currentTarget) {
                      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
                      const initialSelection = additive ? selection : [];
                      if (!additive) select([]);
                      setPlayhead(Math.max(0, xToUs(e.clientX)));
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setGesture({
                        kind: 'marquee',
                        startX: e.clientX,
                        startY: e.clientY,
                        endX: e.clientX,
                        endY: e.clientY,
                        initialSelection,
                        moved: false,
                      });
                    }
                  }}
                >
                  {dropHint?.trackId === t.id && (
                    <div
                      className={`pointer-events-none absolute top-1 bottom-1 rounded-md border-2 border-dashed ${dropHint.ok ? 'border-violet bg-violet/15' : 'border-danger bg-danger/10'}`}
                      style={{ left: usToPx(dropHint.startUs, zoom), width: Math.max(4, usToPx(dropHint.durUs, zoom)) }}
                    />
                  )}
                </div>
              </div>
            );
          })}

          {/* clipes (camada própria para poderem mudar de trilha durante o arrasto) */}
          <div className="pointer-events-none absolute" style={{ left: HEADER_W, top: RULER_H, width: contentW, height: trackTops.total }}>
            {project.clips.map((c) => {
              const box = clipBox(c);
              const ti = tracks.findIndex((t) => t.id === box.trackId);
              const t = tracks[ti];
              if (!t) return null;
              const asset = c.assetId ? project.assets.find((a) => a.id === c.assetId) : null;
              const h = TRACK_H[t.kind];
              const left = usToPx(box.start, zoom);
              const width = Math.max(2, usToPx(box.dur, zoom));
              const sel = selection.includes(c.id);
              const missing = asset?.status === 'missing';
              const keyTimes = [...new Set([
                ...(c.keyframes['transform.x'] ?? []),
                ...(c.keyframes['transform.y'] ?? []),
                ...(c.keyframes['transform.scale'] ?? []),
                ...(c.keyframes['transform.rotation'] ?? []),
                ...(c.keyframes['transform.opacity'] ?? []),
              ].map((keyframe) => keyframe.atUs))];
              return (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={-1}
                  aria-pressed={sel}
                  aria-label={`${c.label ?? asset?.name ?? 'clipe'} em ${formatTimecode(c.timelineStartUs, project.settings.fps)}`}
                  title={`${c.text ? c.text.text : (c.label ?? asset?.name ?? 'Texto')}${c.groupId ? '\nElemento agrupado' : ''}${c.reason ? `\nIA: ${c.reason}` : ''}\nClique para editar · clique duas vezes para modificar`}
                  onPointerDown={(e) => onClipPointerDown(e, c)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    select([c.id]);
                    requestInspector();
                    if (!t.locked) setEditingClipId(c.id);
                  }}
                  className={`editor-clip pointer-events-auto absolute overflow-hidden rounded-md border ${trackColor(t)} ${sel ? 'ring-2 ring-azure ring-offset-1 ring-offset-base shadow-lg shadow-azure/10' : ''} ${box.dragging ? 'opacity-80 shadow-lg shadow-black/50' : ''} ${missing ? 'border-dashed border-warn' : ''} ${t.locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
                  style={{ left, width, top: trackTops.tops[ti]! + 2, height: h - 4, zIndex: box.dragging ? 5 : 1 }}
                >
                  {t.kind === 'video' && asset?.kind === 'video' && width > 30 && <Thumbs clip={c} widthPx={width} zoom={zoom} session={session} height={h - 4} />}
                  {t.kind === 'audio' && <Waveform clip={c} widthPx={width} zoom={zoom} session={session} color="rgba(147, 200, 255, 0.85)" />}
                  {keyTimes.map((atUs) => (
                    <span key={atUs} aria-hidden="true" className="pointer-events-none absolute top-1 z-[2] size-1.5 rotate-45 bg-azure shadow-sm" style={{ left: usToPx(atUs, zoom) - 3 }} />
                  ))}
                  <span className={`relative z-[1] block truncate px-1.5 pt-0.5 text-2xs font-medium text-ink drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] ${sel && !t.locked && width >= 44 ? 'pr-6' : ''}`}>
                    {c.origin === 'ai' && <span className="mr-1 text-violet-strong">IA</span>}
                    {c.groupId && <span className="mr-1 text-azure">Grupo</span>}
                    {c.speed !== 1 && <span className="mr-1 text-warn">{c.speed}×</span>}
                    {c.text ? c.text.text : (c.label ?? asset?.name)}
                  </span>
                  {sel && !t.locked && !c.text && width >= 22 && (
                    <button
                      type="button"
                      aria-label={soloClipId === c.id ? 'Parar escuta isolada' : 'Isolar e escutar só este clipe'}
                      title={soloClipId === c.id ? 'Parar escuta isolada (O)' : 'Isolar e escutar só este clipe (O)'}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleAuditionClip(session, c);
                      }}
                      className={`absolute top-1 z-[3] grid size-5 place-items-center rounded ${width >= 48 ? 'right-7' : 'right-0.5'} ${soloClipId === c.id ? 'bg-azure text-action-ink shadow' : 'bg-black/75 text-ink hover:bg-azure hover:text-action-ink'}`}
                    >
                      <Headphones size={10} />
                    </button>
                  )}
                  {sel && !t.locked && width >= 48 && (
                    <button
                      type="button"
                      aria-label="Modificar clipe"
                      title="Modificar clipe (ou clique duas vezes)"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        requestInspector();
                        setEditingClipId(c.id);
                      }}
                      className="absolute top-1 right-1 z-[3] grid size-5 place-items-center rounded bg-black/70 text-ink hover:bg-violet hover:text-white"
                    >
                      <Pencil size={10} />
                    </button>
                  )}
                  {/* alças de aparar */}
                  {!t.locked && width > EDGE_PX * 3 && (
                    <>
                      <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-ink/40" />
                      <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-ink/40" />
                    </>
                  )}
                </div>
              );
            })}

            {marqueeBox && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute z-10 border border-azure bg-azure/15"
                style={marqueeBox}
              />
            )}

            {/* batidas da música: compassos mais fortes, drop destacado */}
            {zoom >= 8 &&
              beatMarks.map((b, i) =>
                b.kind === 'beat' && zoom < 40 ? null : (
                  <div
                    key={i}
                    className={`pointer-events-none absolute top-0 bottom-0 w-px ${b.kind === 'drop' ? 'bg-warn/70' : b.kind === 'down' ? 'bg-azure/25' : 'bg-azure/10'}`}
                    style={{ left: usToPx(b.atUs, zoom) }}
                  >
                    {b.kind === 'drop' && <span className="absolute top-0 left-1 rounded bg-warn px-1 text-[9px] font-bold text-base">DROP</span>}
                  </div>
                ),
              )}

            {/* onde a proposta da IA mexe */}
            {proposalMarks.map((m, i) => (
              <div
                key={`pm${i}`}
                className={`pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 ${m.kind === 'add' ? 'bg-ok/80' : m.kind === 'remove' ? 'bg-danger/80' : 'bg-violet-strong/80'}`}
                style={{ left: usToPx(m.atUs, zoom) }}
              >
                <span className={`absolute top-0 -left-1 size-2.5 rotate-45 ${m.kind === 'add' ? 'bg-ok' : m.kind === 'remove' ? 'bg-danger' : 'bg-violet-strong'}`} />
              </div>
            ))}

            {/* linha de encaixe */}
            {snapLine !== null && <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-warn" style={{ left: usToPx(snapLine, zoom) }} />}

            {/* playhead */}
            <TimelinePlayhead zoom={zoom} scrollRef={scrollRef} />
          </div>
        </div>
      </div>
    </section>
    {qualityOpen && <QualityDialog session={session} onClose={() => setQualityOpen(false)} />}
    {audioMixerOpen && <AudioMixerDialog session={session} onClose={() => setAudioMixerOpen(false)} />}
    {regenerateOpen && localizedRange && (
      <GenerateDialog
        session={session}
        localizedRange={localizedRange}
        onClose={() => setRegenerateOpen(false)}
      />
    )}
    {editingClip && (
      <TimelineClipModifyModal
        session={session}
        project={project}
        clip={editingClip}
        platform={platform}
        run={run}
        toast={toast}
        onClose={() => setEditingClipId(null)}
        onOpenAudioMixer={() => {
          setEditingClipId(null);
          setAudioMixerOpen(true);
        }}
      />
    )}
    </>
  );
}

// --------------------------------------------------------------------------- helpers de edição direta

function slipSourceUs(project: Project, clip: Clip, deltaUs: number): Partial<Clip> | null {
  const srcMax = sourceDurationUs(project, clip);
  const span = Math.max(100_000, clip.sourceOutUs - clip.sourceInUs);
  const maxStart = srcMax !== null ? Math.max(0, srcMax - span) : Infinity;
  const nextIn = Math.min(maxStart, Math.max(0, clip.sourceInUs + deltaUs));
  if (nextIn === clip.sourceInUs) return null;
  return { sourceInUs: nextIn, sourceOutUs: nextIn + span };
}

function speedClipPatch(project: Project, clip: Clip, nextSpeed: number): Partial<Clip> {
  const S = 1_000_000;
  const srcMax = sourceDurationUs(project, clip);
  const span = Math.max(100_000, clip.sourceOutUs - clip.sourceInUs);
  const neighbors = project.clips.filter((item) => item.trackId === clip.trackId && item.id !== clip.id);
  const nextStart = Math.min(Infinity, ...neighbors.filter((item) => item.timelineStartUs >= clipEndUs(clip)).map((item) => item.timelineStartUs));
  const maxSlotDur = nextStart === Infinity ? Infinity : Math.max(100_000, nextStart - clip.timelineStartUs);
  const rawDur = Math.max(100_000, Math.round(span / nextSpeed));
  const durationUs = Math.min(maxSlotDur, rawDur);
  const needSourceSpan = Math.max(100_000, Math.round((durationUs * nextSpeed * S) / S));
  const sourceOutUs = Math.min(srcMax ?? Infinity, clip.sourceInUs + needSourceSpan);
  const keyframes = { ...clip.keyframes };
  delete keyframes.speed;
  return { speed: nextSpeed, durationUs, sourceOutUs, keyframes };
}

function textPositionPatch(project: Project, clip: Clip, zone: 'top' | 'center' | 'bottom'): Partial<Clip> {
  const H = project.settings.height;
  const y = zone === 'top' ? -Math.round(H * 0.34) : zone === 'center' ? 0 : Math.round(H * 0.36);
  const keyframes = { ...clip.keyframes };
  delete keyframes['transform.y'];
  return { transform: { ...clip.transform, y }, keyframes };
}

function textZoneOf(project: Project, clip: Clip): 'top' | 'center' | 'bottom' {
  const H = project.settings.height || 1080;
  if (clip.transform.y <= -H * 0.14) return 'top';
  if (clip.transform.y >= H * 0.14) return 'bottom';
  return 'center';
}

function TimelineQuickEditBar({
  session,
  project,
  clip,
  platform,
  run,
  toast,
  onOpenModal,
}: {
  session: ProjectSession;
  project: Project;
  clip: Clip;
  platform: ReturnType<typeof useApp.getState>['platform'];
  run: (label: string, cmds: Command[]) => void;
  toast: ReturnType<typeof useApp.getState>['toast'];
  onOpenModal: () => void;
}) {
  const track = project.tracks.find((t) => t.id === clip.trackId);
  const locked = !!track?.locked;
  const soloClipId = useEditor((s) => s.soloClipId);
  const [inlineText, setInlineText] = useState(clip.text?.text ?? '');
  const [translating, setTranslating] = useState(false);

  useEffect(() => {
    setInlineText(clip.text?.text ?? '');
  }, [clip.id, clip.text?.text]);

  const patchClip = (label: string, patch: Partial<Clip>) => run(label, [{ type: 'clip.update', clipId: clip.id, patch }]);

  const commitInlineText = () => {
    if (!clip.text || inlineText === clip.text.text) return;
    patchClip('Editar texto na timeline', { text: editSubtitleTextManually(clip.text, inlineText) });
  };

  const handleTranslate = async (allOnTrack: boolean) => {
    if (!platform || translating) return;
    setTranslating(true);
    try {
      const target = allOnTrack ? subtitleClips(project, clip.trackId) : [clip];
      const r = await translateTextClipsToPt(session, target, platform, allOnTrack ? 'Traduzir trilha para PT-BR' : 'Traduzir legenda para PT-BR');
      if (r.failed && !r.translated) toast({ tone: 'warn', title: 'Não foi possível traduzir agora' });
      else toast({ tone: 'ok', title: `${r.translated} item(ns) traduzido(s) para PT-BR` });
    } catch (e) {
      toast({ tone: 'error', title: 'Erro ao traduzir', body: (e as Error).message });
    } finally {
      setTranslating(false);
    }
  };

  if (clip.text) {
    const t = clip.text;
    const zone = textZoneOf(project, clip);
    return (
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 border-t border-line-soft bg-raised/60 px-2 py-1 text-2xs">
        <span className="shrink-0 rounded bg-ok/15 px-1.5 py-0.5 font-semibold text-ok">Texto · {track?.name ?? 'Legendas'}</span>
        <input
          type="text"
          aria-label="Editar texto selecionado na timeline"
          disabled={locked}
          value={inlineText}
          onChange={(e) => setInlineText(e.target.value)}
          onBlur={commitInlineText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitInlineText();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setInlineText(t.text);
              e.currentTarget.blur();
            }
          }}
          className="h-7 min-w-[180px] flex-1 rounded-control border border-line bg-base px-2 text-xs text-ink outline-none focus:border-violet disabled:opacity-50"
        />
        <button
          type="button"
          disabled={locked || !platform || translating}
          onClick={() => void handleTranslate(false)}
          title="Traduzir esta legenda/letra para Português (Brasil)"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-control border border-violet/40 bg-violet/10 px-2 text-ink-soft hover:bg-violet/20 hover:text-ink disabled:opacity-50"
        >
          <Languages size={12} />
          {translating ? 'Traduzindo…' : 'Traduzir PT-BR'}
        </button>
        <button
          type="button"
          disabled={locked || !platform || translating}
          onClick={() => void handleTranslate(true)}
          title="Traduzir de uma vez todas as legendas/letras desta trilha para Português (Brasil)"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-control border border-line bg-base px-2 text-ink-soft hover:border-violet/50 hover:text-ink disabled:opacity-50"
        >
          <Languages size={12} />
          Traduzir trilha PT-BR
        </button>
        <select
          aria-label="Estilo rápido do texto"
          disabled={locked}
          value=""
          onChange={(e) => {
            const look = LOOKS.find((l) => l.id === e.target.value);
            if (look) run(`Estilo ${look.label}`, restyleSubtitles(project, [clip.id], look.id));
          }}
          className="h-7 shrink-0 rounded-control border border-line bg-base px-1.5 text-2xs text-ink disabled:opacity-50"
        >
          <option value="">Estilo…</option>
          {LOOKS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <div className="flex shrink-0 items-center overflow-hidden rounded-control border border-line bg-base">
          <button type="button" disabled={locked} onClick={() => patchClip('Diminuir fonte', { text: { ...t, size: Math.max(12, Math.round(t.size - 4)) } })} className="h-7 px-2 text-ink-soft hover:bg-raised disabled:opacity-50" title="Diminuir tamanho da fonte">A-</button>
          <span className="tnum border-x border-line-soft px-1.5 text-muted">{Math.round(t.size)}px</span>
          <button type="button" disabled={locked} onClick={() => patchClip('Aumentar fonte', { text: { ...t, size: Math.min(360, Math.round(t.size + 4)) } })} className="h-7 px-2 text-ink-soft hover:bg-raised disabled:opacity-50" title="Aumentar tamanho da fonte">A+</button>
        </div>
        <div className="flex shrink-0 items-center overflow-hidden rounded-control border border-line bg-base">
          {([['top', 'Topo'], ['center', 'Centro'], ['bottom', 'Base']] as const).map(([z, lbl]) => (
            <button
              key={z}
              type="button"
              disabled={locked}
              onClick={() => patchClip(`Posicionar no ${lbl.toLowerCase()}`, textPositionPatch(project, clip, z))}
              className={`h-7 px-2 transition-colors disabled:opacity-50 ${zone === z ? 'bg-violet/20 font-semibold text-ink' : 'text-muted hover:bg-raised hover:text-ink'}`}
            >
              {lbl}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={locked}
          onClick={() => {
            const { episodes } = buildSessionReadingInputs(session);
            const res = harmonizeTextClipsWithScenes({ project, episodes, clipIds: [clip.id] });
            if (res.commands.length) {
              run('Harmonizar texto com a cena', res.commands);
              toast({ tone: 'ok', title: 'Texto harmonizado com a cena', body: 'Cores, contraste, posição facial e tempo de leitura ajustados.' });
            } else {
              toast({ tone: 'info', title: 'Já harmonizado', body: 'Este texto já está alinhado com a luz, o foco e o tempo de leitura da cena.' });
            }
          }}
          title="Harmonizar automaticamente cores, contraste, desvio do rosto e velocidade de leitura com a cena"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-control border border-azure/45 bg-azure/10 px-2 text-ink-soft hover:bg-azure/20 hover:text-ink disabled:opacity-50"
        >
          <Wand2 size={12} />
          Harmonizar c/ cena
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={onOpenModal}
          className="ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-control bg-violet px-2.5 text-2xs font-medium text-white hover:bg-violet-strong disabled:opacity-50"
        >
          <Pencil size={11} />
          Modificar…
        </button>
      </div>
    );
  }

  if (track?.kind === 'video') {
    const quickFrames = ['normal', 'highlight', 'close', 'punch'] as const;
    const isClipSolo = soloClipId === clip.id;
    return (
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 border-t border-line-soft bg-raised/60 px-2 py-1 text-2xs">
        <span className="shrink-0 rounded bg-violet/20 px-1.5 py-0.5 font-semibold text-violet-strong">Vídeo · {track.name}</span>
        <button
          type="button"
          onClick={() => toggleAuditionClip(session, clip)}
          title="Isolar e escutar apenas o áudio original desta cena (atalho: O)"
          className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-control border px-2 font-medium transition-colors ${isClipSolo ? 'border-azure bg-azure text-action-ink' : 'border-azure/45 bg-azure/10 text-ink hover:bg-azure/20'}`}
        >
          <Headphones size={12} />
          {isClipSolo ? 'Parar escuta' : 'Ouvir só esta cena'}
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={() => {
            const { episodes, musics } = buildSessionReadingInputs(session);
            const aligned = alignClipPeakToNearestBeat({ project, clipId: clip.id, episodes, musics });
            if (aligned) {
              run('Sincronizar golpe na batida', [aligned.command]);
              toast({ tone: 'ok', title: 'Golpe cravado na batida', body: `Pico em ${aligned.peakSourceS}s alinhado à batida de ${aligned.beatTimelineS}s.` });
            } else {
              toast({ tone: 'info', title: 'Golpe já alinhado ou sem batida próxima' });
            }
          }}
          title="Deslizar automaticamente o pico de ação/golpe desta cena para cair cravado na batida da música"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-control border border-violet/45 bg-violet/10 px-2 font-medium text-ink-soft hover:bg-violet/20 hover:text-ink disabled:opacity-50"
        >
          <Zap size={12} />
          Golpe na batida
        </button>
        <div className="flex shrink-0 items-center overflow-hidden rounded-control border border-line bg-base" title="Deslizar trecho dentro do episódio">
          <span className="px-1.5 text-muted">Trecho</span>
          <button
            type="button"
            disabled={locked}
            onClick={() => {
              const p = slipSourceUs(project, clip, -500_000);
              if (p) patchClip('Voltar 0,5s no episódio', p);
              else toast({ tone: 'info', title: 'Já está no início do episódio' });
            }}
            className="h-7 border-l border-line-soft px-2 text-ink-soft hover:bg-raised disabled:opacity-50"
          >
            -0.5s
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => {
              const p = slipSourceUs(project, clip, 500_000);
              if (p) patchClip('Avançar 0,5s no episódio', p);
              else toast({ tone: 'info', title: 'Já está no fim do episódio' });
            }}
            className="h-7 border-l border-line-soft px-2 text-ink-soft hover:bg-raised disabled:opacity-50"
          >
            +0.5s
          </button>
        </div>
        <div className="flex shrink-0 items-center overflow-hidden rounded-control border border-line bg-base" title="Ajustar duração na timeline">
          <span className="px-1.5 text-muted">Dur</span>
          <button
            type="button"
            disabled={locked}
            onClick={() => {
              const targetEnd = Math.max(clip.timelineStartUs + 150_000, clipEndUs(clip) - 250_000);
              run('Encurtar duração', trimClip(project, clip.id, 'end', targetEnd));
            }}
            className="h-7 border-l border-line-soft px-2 text-ink-soft hover:bg-raised disabled:opacity-50"
          >
            -0.25s
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => run('Estender duração', trimClip(project, clip.id, 'end', clipEndUs(clip) + 250_000))}
            className="h-7 border-l border-line-soft px-2 text-ink-soft hover:bg-raised disabled:opacity-50"
          >
            +0.25s
          </button>
        </div>
        <div className="flex shrink-0 items-center overflow-hidden rounded-control border border-line bg-base">
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((spd) => (
            <button
              key={spd}
              type="button"
              disabled={locked}
              onClick={() => patchClip(`Velocidade ${spd}×`, speedClipPatch(project, clip, spd))}
              className={`h-7 px-1.5 transition-colors disabled:opacity-50 ${Math.abs(clip.speed - spd) < 0.02 ? 'bg-violet/20 font-semibold text-ink' : 'text-muted hover:bg-raised hover:text-ink'}`}
            >
              {spd}×
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center overflow-hidden rounded-control border border-line bg-base">
          {quickFrames.map((fid) => {
            const preset = FRAMING_PRESETS.find((x) => x.id === fid)!;
            return (
              <button
                key={fid}
                type="button"
                disabled={locked}
                onClick={() => {
                  const res = applyFramingPreset(clip, fid);
                  patchClip(res.label, res.patch);
                }}
                className="h-7 border-r border-line-soft px-2 text-ink-soft last:border-r-0 hover:bg-raised hover:text-ink disabled:opacity-50"
              >
                {preset.shortLabel}
              </button>
            );
          })}
        </div>
        <select
          aria-label="Transição rápida de entrada"
          disabled={locked}
          value={clip.transitionIn?.transition ?? ''}
          onChange={(e) => {
            const tr = e.target.value;
            const editorial = tr === 'match_cut' || tr === 'cut_on_action';
            patchClip('Transição de entrada', {
              transitionIn: tr
                ? {
                    transition: tr,
                    durationUs: editorial ? 0 : clip.transitionIn?.durationUs || 400_000,
                    params: { curve: 'linear', intensity: tr === 'flash' ? 0.8 : tr === 'whip_pan' ? 0.65 : 1, ...(tr === 'whip_pan' ? { direction: 1, blur: 8 } : {}) },
                  }
                : null,
            });
          }}
          className="h-7 shrink-0 rounded-control border border-line bg-base px-1.5 text-2xs text-ink disabled:opacity-50"
        >
          <option value="">Corte seco</option>
          {TRANSITIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <button
          type="button"
          disabled={locked}
          onClick={onOpenModal}
          className="ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-control bg-violet px-2.5 text-2xs font-medium text-white hover:bg-violet-strong disabled:opacity-50"
        >
          <Pencil size={11} />
          Modificar cena / Trocar trecho
        </button>
      </div>
    );
  }

  const isAudioSolo = soloClipId === clip.id;
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 border-t border-line-soft bg-raised/60 px-2 py-1 text-2xs">
      <span className="shrink-0 rounded bg-azure/20 px-1.5 py-0.5 font-semibold text-azure">Áudio · {track?.name ?? 'Música'}</span>
      <button
        type="button"
        onClick={() => toggleAuditionClip(session, clip)}
        title="Isolar e escutar apenas este clipe de áudio sem música nem outras faixas (atalho: S)"
        className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-control border px-2.5 font-semibold transition-colors ${isAudioSolo ? 'border-azure bg-azure text-action-ink' : 'border-azure/50 bg-azure/15 text-ink hover:bg-azure/25'}`}
      >
        <Headphones size={12} />
        {isAudioSolo ? 'Parar escuta isolada' : 'Ouvir só este clipe'}
      </button>
      <div className="flex shrink-0 items-center overflow-hidden rounded-control border border-line bg-base">
        <span className="px-1.5 text-muted">Trecho</span>
        <button
          type="button"
          disabled={locked}
          onClick={() => {
            const p = slipSourceUs(project, clip, -1_000_000);
            if (p) patchClip('Voltar 1s na música', p);
            else toast({ tone: 'info', title: 'Já está no início da faixa' });
          }}
          className="h-7 border-l border-line-soft px-2 text-ink-soft hover:bg-raised disabled:opacity-50"
        >
          -1s
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={() => {
            const p = slipSourceUs(project, clip, 1_000_000);
            if (p) patchClip('Avançar 1s na música', p);
            else toast({ tone: 'info', title: 'Já está no fim da faixa' });
          }}
          className="h-7 border-l border-line-soft px-2 text-ink-soft hover:bg-raised disabled:opacity-50"
        >
          +1s
        </button>
      </div>
      <div className="flex shrink-0 items-center overflow-hidden rounded-control border border-line bg-base">
        <span className="px-1.5 text-muted">Vol</span>
        {[-3, 0, 3].map((db) => (
          <button
            key={db}
            type="button"
            disabled={locked}
            onClick={() => patchClip(`Volume ${db > 0 ? `+${db}` : db} dB`, { audio: { ...clip.audio, gainDb: db } })}
            className={`h-7 border-l border-line-soft px-2 transition-colors disabled:opacity-50 ${Math.abs(clip.audio.gainDb - db) < 0.2 ? 'bg-azure/20 font-semibold text-ink' : 'text-muted hover:bg-raised hover:text-ink'}`}
          >
            {db > 0 ? `+${db}` : db} dB
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={locked}
        onClick={() => patchClip('Fade in 0,5s', { audio: { ...clip.audio, fadeInUs: clip.audio.fadeInUs >= 400_000 ? 0 : 500_000 } })}
        className={`h-7 rounded-control border px-2 disabled:opacity-50 ${clip.audio.fadeInUs >= 400_000 ? 'border-azure bg-azure/15 text-ink' : 'border-line bg-base text-muted hover:text-ink'}`}
      >
        Fade in 0.5s
      </button>
      <button
        type="button"
        disabled={locked}
        onClick={() => patchClip('Fade out 0,5s', { audio: { ...clip.audio, fadeOutUs: clip.audio.fadeOutUs >= 400_000 ? 0 : 500_000 } })}
        className={`h-7 rounded-control border px-2 disabled:opacity-50 ${clip.audio.fadeOutUs >= 400_000 ? 'border-azure bg-azure/15 text-ink' : 'border-line bg-base text-muted hover:text-ink'}`}
      >
        Fade out 0.5s
      </button>
      <button
        type="button"
        disabled={locked}
        onClick={onOpenModal}
        className="ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-control bg-violet px-2.5 text-2xs font-medium text-white hover:bg-violet-strong disabled:opacity-50"
      >
        <Pencil size={11} />
        Modificar áudio
      </button>
    </div>
  );
}

function TimelineClipModifyModal({
  session,
  project,
  clip,
  platform,
  run,
  toast,
  onClose,
  onOpenAudioMixer,
}: {
  session: ProjectSession;
  project: Project;
  clip: Clip;
  platform: ReturnType<typeof useApp.getState>['platform'];
  run: (label: string, cmds: Command[]) => void;
  toast: ReturnType<typeof useApp.getState>['toast'];
  onClose: () => void;
  onOpenAudioMixer: () => void;
}) {
  const S = 1_000_000;
  const track = project.tracks.find((t) => t.id === clip.trackId);
  const asset = clip.assetId ? project.assets.find((a) => a.id === clip.assetId) : null;
  const [modalText, setModalText] = useState(clip.text?.text ?? '');
  const [modalFont, setModalFont] = useState(clip.text?.font ?? 'Manrope Variable');
  const [translating, setTranslating] = useState(false);
  const [sceneAssetId, setSceneAssetId] = useState(clip.assetId ?? project.assets.find((a) => a.kind === 'video')?.id ?? '');
  const [sceneTag, setSceneTag] = useState<ShotTag | null>(null);
  const [durInput, setDurInput] = useState((clip.durationUs / S).toFixed(2));
  const [inInput, setInInput] = useState((clip.sourceInUs / S).toFixed(2));
  const [outInput, setOutInput] = useState((clip.sourceOutUs / S).toFixed(2));
  const [gainInput, setGainInput] = useState(String(clip.audio.gainDb));
  const [fadeInInput, setFadeInInput] = useState((clip.audio.fadeInUs / S).toFixed(2));
  const [fadeOutInput, setFadeOutInput] = useState((clip.audio.fadeOutUs / S).toFixed(2));
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setModalText(clip.text?.text ?? '');
    setModalFont(clip.text?.font ?? 'Manrope Variable');
    setDurInput((clip.durationUs / S).toFixed(2));
    setInInput((clip.sourceInUs / S).toFixed(2));
    setOutInput((clip.sourceOutUs / S).toFixed(2));
    setGainInput(String(clip.audio.gainDb));
    setFadeInInput((clip.audio.fadeInUs / S).toFixed(2));
    setFadeOutInput((clip.audio.fadeOutUs / S).toFixed(2));
    if (clip.assetId) setSceneAssetId(clip.assetId);
  }, [clip]);

  useEffect(() => {
    if (clip.text) textAreaRef.current?.focus();
  }, [clip.id, !!clip.text]);

  const patchClip = (label: string, patch: Partial<Clip>) => run(label, [{ type: 'clip.update', clipId: clip.id, patch }]);

  const videoAssets = project.assets.filter((a) => a.kind === 'video');
  const chosenSceneAsset = videoAssets.find((a) => a.id === sceneAssetId) ?? asset;
  const candidateShots = useMemo(() => {
    if (!chosenSceneAsset) return [];
    const list = session.assetRuntime(chosenSceneAsset.id).episode?.shots ?? [];
    return list
      .filter((shot) => (!sceneTag || shot.tags.includes(sceneTag)) && shot.endS - shot.startS >= 0.35)
      .slice(0, 60);
  }, [chosenSceneAsset, session, sceneTag]);

  if (clip.text) {
    const t = clip.text;
    const setT = (label: string, partial: Partial<NonNullable<Clip['text']>>) => patchClip(label, { text: { ...t, ...partial } });
    const zone = textZoneOf(project, clip);
    return (
      <Dialog title={`Modificar texto · ${track?.name ?? 'Legendas'}`} width="w-[620px]" onClose={onClose}>
        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="tnum text-muted">
              {formatTimecode(clip.timelineStartUs, project.settings.fps)} → {formatTimecode(clipEndUs(clip), project.settings.fps)}
            </span>
            <button
              type="button"
              disabled={!platform || translating}
              onClick={async () => {
                if (!platform || translating) return;
                setTranslating(true);
                try {
                  const r = await translateTextClipsToPt(session, [clip], platform);
                  if (r.failed && !r.translated) toast({ tone: 'warn', title: 'Não foi possível traduzir agora' });
                  else if (r.translated) toast({ tone: 'ok', title: 'Traduzido para PT-BR' });
                } catch (e) {
                  toast({ tone: 'error', title: 'Erro ao traduzir', body: (e as Error).message });
                } finally {
                  setTranslating(false);
                }
              }}
              className="inline-flex h-7 items-center gap-1 rounded-control border border-violet/45 bg-violet/15 px-2.5 text-xs font-medium text-ink hover:bg-violet/25 disabled:opacity-50"
            >
              <Languages size={13} />
              {translating ? 'Traduzindo…' : 'Traduzir para PT-BR'}
            </button>
          </div>
          <textarea
            ref={textAreaRef}
            autoFocus
            value={modalText}
            onChange={(e) => setModalText(e.target.value)}
            onBlur={() => {
              if (modalText !== t.text) setT('Editar texto', editSubtitleTextManually(t, modalText));
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.currentTarget.blur();
                onClose();
              }
            }}
            className="h-28 w-full resize-y rounded-control border border-line bg-base p-2.5 text-sm text-ink outline-none focus:border-violet"
            aria-label="Editar texto completo"
          />
          {t.original !== undefined && (
            <div className="rounded-control border border-line-soft bg-base/60 px-2.5 py-1.5 text-2xs text-muted">
              <strong className="text-ink-soft">Original:</strong> {t.original}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            <label className="space-y-1">
              <span className="text-muted">Estilo visual</span>
              <select
                value=""
                onChange={(e) => {
                  const look = LOOKS.find((l) => l.id === e.target.value);
                  if (look) run(`Estilo ${look.label}`, restyleSubtitles(project, [clip.id], look.id));
                }}
                className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink"
              >
                <option value="">Escolher estilo…</option>
                {LOOKS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-muted">Fonte</span>
              <input
                list="timeline-modal-fonts"
                value={modalFont}
                onChange={(e) => setModalFont(e.target.value)}
                onBlur={() => {
                  const next = modalFont.trim() || 'Manrope Variable';
                  setModalFont(next);
                  if (next !== t.font) setT('Fonte', { font: next });
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink"
              />
              <datalist id="timeline-modal-fonts">
                {LOCAL_FONT_FAMILIES.map((f) => <option key={f} value={f} />)}
              </datalist>
            </label>
            <label className="space-y-1">
              <span className="text-muted">Tamanho (px)</span>
              <input
                type="number"
                min={10}
                max={400}
                step={2}
                value={Math.round(t.size)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 10) setT('Tamanho do texto', { size: v });
                }}
                className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink"
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted">Duração na timeline (s)</span>
              <input
                type="number"
                min={0.15}
                step={0.1}
                value={durInput}
                onChange={(e) => setDurInput(e.target.value)}
                onBlur={() => {
                  const v = Number(durInput.replace(',', '.'));
                  if (Number.isFinite(v) && v >= 0.15) {
                    run('Ajustar duração', trimClip(project, clip.id, 'end', clip.timelineStartUs + Math.round(v * S)));
                  }
                }}
                className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink"
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted">Cor do texto</span>
              <input type="color" value={t.color} onChange={(e) => setT('Cor do texto', { color: e.target.value })} className="h-8 w-full rounded-control border border-line bg-base" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-muted">Contorno</span>
                <input type="color" value={t.outlineColor ?? '#000000'} onChange={(e) => setT('Cor do contorno', { outlineColor: e.target.value, outlineWidth: t.outlineWidth || 3 })} className="h-8 w-full rounded-control border border-line bg-base" />
              </label>
              <label className="space-y-1">
                <span className="text-muted">Espessura</span>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={t.outlineWidth}
                  onChange={(e) => setT('Espessura do contorno', { outlineWidth: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })}
                  className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-muted">Glow (cor)</span>
                <input type="color" value={t.glowColor} onChange={(e) => setT('Cor do glow', { glowColor: e.target.value })} className="h-8 w-full rounded-control border border-line bg-base" />
              </label>
              <label className="space-y-1">
                <span className="text-muted">Glow (px)</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={t.glowIntensity}
                  onChange={(e) => setT('Intensidade do glow', { glowIntensity: Math.max(0, Math.min(50, Number(e.target.value) || 0)) })}
                  className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink"
                />
              </label>
            </div>
            <div className="space-y-1">
              <span className="text-muted block">Posição vertical</span>
              <div className="grid grid-cols-3 gap-1">
                {([['top', 'Topo'], ['center', 'Centro'], ['bottom', 'Base']] as const).map(([z, lbl]) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => patchClip(`Posicionar no ${lbl.toLowerCase()}`, textPositionPatch(project, clip, z))}
                    className={`h-8 rounded-control border text-xs ${zone === z ? 'border-violet bg-violet/20 font-semibold text-ink' : 'border-line bg-base text-muted hover:text-ink'}`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <label className="space-y-1">
              <span className="text-muted">Animação de entrada</span>
              <select value={t.animationIn ?? ''} onChange={(e) => setT('Entrada', { animationIn: (e.target.value || null) as NonNullable<typeof t.animationIn> | null })} className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink">
                {TEXT_ANIMATIONS_IN.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-muted">Animação de saída</span>
              <select value={t.animationOut ?? ''} onChange={(e) => setT('Saída', { animationOut: (e.target.value || null) as NonNullable<typeof t.animationOut> | null })} className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink">
                {TEXT_ANIMATIONS_OUT.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="primary" size="sm" onClick={() => { if (modalText !== t.text) setT('Editar texto', editSubtitleTextManually(t, modalText)); onClose(); }}>
              Concluir
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  if (track?.kind === 'video') {
    const assetMaxS = asset?.probe?.durationUs ? asset.probe.durationUs / S : 3600;
    const commitRangeInputs = () => {
      const i = Number(inInput.replace(',', '.'));
      const o = Number(outInput.replace(',', '.'));
      if (!Number.isFinite(i) || !Number.isFinite(o) || o <= i + 0.1) return;
      const res = clipSourceRangePatch(project, clip, i, o);
      patchClip(res.label, res.patch);
    };
    return (
      <Dialog title={`Modificar cena · ${clip.label ?? asset?.name ?? 'Vídeo'}`} width="w-[780px]" onClose={onClose}>
        <div className="space-y-3 text-xs">
          {asset?.kind === 'video' && (
            <ClipRangePreview
              session={session}
              asset={asset}
              startS={clip.sourceInUs / S}
              endS={clip.sourceOutUs / S}
              title={clip.label ?? asset.name}
              onAdjustRange={(next) => {
                const res = clipSourceRangePatch(project, clip, next.inS, next.outS);
                patchClip(res.label, res.patch);
              }}
            />
          )}
          <div className="grid grid-cols-4 gap-2">
            <label className="space-y-1">
              <span className="text-muted">Início na origem (s)</span>
              <input type="number" step={0.1} min={0} max={assetMaxS} value={inInput} onChange={(e) => setInInput(e.target.value)} onBlur={commitRangeInputs} className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink" />
            </label>
            <label className="space-y-1">
              <span className="text-muted">Fim na origem (s)</span>
              <input type="number" step={0.1} min={0.2} max={assetMaxS} value={outInput} onChange={(e) => setOutInput(e.target.value)} onBlur={commitRangeInputs} className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink" />
            </label>
            <label className="space-y-1">
              <span className="text-muted">Duração na timeline (s)</span>
              <input
                type="number"
                step={0.1}
                min={0.15}
                value={durInput}
                onChange={(e) => setDurInput(e.target.value)}
                onBlur={() => {
                  const d = Number(durInput.replace(',', '.'));
                  if (Number.isFinite(d) && d >= 0.15) run('Alterar duração', trimClip(project, clip.id, 'end', clip.timelineStartUs + Math.round(d * S)));
                }}
                className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink"
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted">Velocidade (×)</span>
              <input
                type="number"
                step={0.05}
                min={0.1}
                max={8}
                value={clip.speed}
                onChange={(e) => {
                  const spd = Number(e.target.value);
                  if (Number.isFinite(spd) && spd >= 0.1 && spd <= 8) patchClip(`Velocidade ${spd}×`, speedClipPatch(project, clip, spd));
                }}
                className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink"
              />
            </label>
          </div>
          <div className="grid grid-cols-[1fr_200px] gap-2">
            <div>
              <span className="mb-1 block text-muted">Enquadramento &amp; movimento</span>
              <div className="flex flex-wrap gap-1">
                {FRAMING_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      const res = applyFramingPreset(clip, preset.id);
                      patchClip(res.label, res.patch);
                    }}
                    className={`rounded-control border px-2 py-1 text-2xs ${preset.accent ? 'border-violet/45 bg-violet/10 text-ink hover:bg-violet/20' : 'border-line bg-base text-ink-soft hover:border-violet/50 hover:text-ink'}`}
                  >
                    {preset.shortLabel}
                  </button>
                ))}
              </div>
            </div>
            <label className="space-y-1">
              <span className="text-muted">Transição de entrada</span>
              <select
                value={clip.transitionIn?.transition ?? ''}
                onChange={(e) => {
                  const tr = e.target.value;
                  const editorial = tr === 'match_cut' || tr === 'cut_on_action';
                  patchClip('Transição', {
                    transitionIn: tr
                      ? { transition: tr, durationUs: editorial ? 0 : clip.transitionIn?.durationUs || 400_000, params: { curve: 'linear', intensity: tr === 'flash' ? 0.8 : tr === 'whip_pan' ? 0.65 : 1 } }
                      : null,
                  });
                }}
                className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink"
              >
                <option value="">Corte seco</option>
                {TRANSITIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
          </div>
          <div className="space-y-2 border-t border-line-soft pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-ink-soft">Trocar por outra cena do episódio</span>
              {videoAssets.length > 1 && (
                <select value={chosenSceneAsset?.id ?? ''} onChange={(e) => setSceneAssetId(e.target.value)} className="h-7 rounded-control border border-line bg-base px-2 text-2xs text-ink">
                  {videoAssets.map((va) => <option key={va.id} value={va.id}>{va.name}</option>)}
                </select>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {MODAL_SCENE_TAGS.map((tg) => (
                <button
                  key={tg.id}
                  type="button"
                  onClick={() => setSceneTag(sceneTag === tg.id ? null : tg.id)}
                  className={`rounded-full border px-2 py-0.5 text-2xs ${sceneTag === tg.id ? 'border-violet bg-violet/20 text-ink' : 'border-line text-muted hover:text-ink'}`}
                >
                  {tg.label}
                </button>
              ))}
            </div>
            {candidateShots.length === 0 ? (
              <p className="rounded border border-line-soft bg-base/60 px-3 py-2 text-2xs text-muted">
                Nenhuma cena encontrada com esse filtro ou análise ainda em andamento.
              </p>
            ) : (
              <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
                {candidateShots.map((shot) => (
                  <li key={`${chosenSceneAsset?.id}-${shot.startS}`} className="flex items-center justify-between gap-2 rounded-control border border-line-soft bg-base/70 px-2.5 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="tnum font-semibold text-ink">
                          {formatTimecode(Math.round(shot.startS * S), project.settings.fps)} → {formatTimecode(Math.round(shot.endS * S), project.settings.fps)}
                        </span>
                        <span className="tnum text-2xs text-faint">({(shot.endS - shot.startS).toFixed(1)}s)</span>
                        {shot.tags.length > 0 && <span className="truncate text-2xs text-violet-strong">{shot.tags.slice(0, 3).join(' · ')}</span>}
                      </div>
                      {shot.line && <p className="truncate text-2xs text-muted">"{shot.line}"</p>}
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        if (!chosenSceneAsset) return;
                        const p = clipSceneShotPatch(project, clip, shot);
                        patchClip('Trocar cena na timeline', chosenSceneAsset.id !== clip.assetId ? { ...p, assetId: chosenSceneAsset.id } : p);
                      }}
                    >
                      Usar esta cena
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={`Modificar áudio · ${asset?.name ?? clip.label ?? 'Música'}`} width="w-[460px]" onClose={onClose}>
      <div className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-2.5">
          <label className="space-y-1">
            <span className="text-muted">Entrada na origem (s)</span>
            <input
              type="number"
              step={0.5}
              min={0}
              value={inInput}
              onChange={(e) => setInInput(e.target.value)}
              onBlur={() => {
                const v = Number(inInput.replace(',', '.'));
                if (Number.isFinite(v) && v >= 0) {
                  const delta = Math.round(v * S) - clip.sourceInUs;
                  const p = slipSourceUs(project, clip, delta);
                  if (p) patchClip('Alterar ponto da música', p);
                }
              }}
              className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink"
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted">Volume (dB)</span>
            <input
              type="number"
              step={1}
              min={-60}
              max={12}
              value={gainInput}
              onChange={(e) => setGainInput(e.target.value)}
              onBlur={() => {
                const v = Number(gainInput.replace(',', '.'));
                if (Number.isFinite(v)) patchClip('Volume', { audio: { ...clip.audio, gainDb: Math.max(-60, Math.min(12, v)) } });
              }}
              className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink"
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted">Fade in (s)</span>
            <input
              type="number"
              step={0.1}
              min={0}
              max={clip.durationUs / S}
              value={fadeInInput}
              onChange={(e) => setFadeInInput(e.target.value)}
              onBlur={() => {
                const v = Number(fadeInInput.replace(',', '.'));
                if (Number.isFinite(v) && v >= 0) patchClip('Fade in', { audio: { ...clip.audio, fadeInUs: Math.round(v * S) } });
              }}
              className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink"
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted">Fade out (s)</span>
            <input
              type="number"
              step={0.1}
              min={0}
              max={clip.durationUs / S}
              value={fadeOutInput}
              onChange={(e) => setFadeOutInput(e.target.value)}
              onBlur={() => {
                const v = Number(fadeOutInput.replace(',', '.'));
                if (Number.isFinite(v) && v >= 0) patchClip('Fade out', { audio: { ...clip.audio, fadeOutUs: Math.round(v * S) } });
              }}
              className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[-5, -1, 1, 5].map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => {
                const p = slipSourceUs(project, clip, sec * S);
                if (p) patchClip(`Deslizar ${sec > 0 ? `+${sec}` : sec}s`, p);
                else toast({ tone: 'info', title: 'Limite do arquivo atingido' });
              }}
              className="h-7 rounded-control border border-line bg-base px-2 text-ink-soft hover:bg-raised hover:text-ink"
            >
              Trecho {sec > 0 ? `+${sec}` : sec}s
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between pt-1">
          <Button variant="secondary" size="sm" icon={<SlidersHorizontal size={13} />} onClick={onOpenAudioMixer}>
            Abrir mixer completo
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </Dialog>
  );
}
