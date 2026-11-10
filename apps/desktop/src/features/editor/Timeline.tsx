import {
  clearRange,
  newId,
  clipEndUs,
  EditError,
  findSnap,
  formatTimecode,
  insertAsset,
  moveClips,
  projectDurationUs,
  TextContentSchema,
  snapPoints,
  sourceTimeAt,
  speedAt,
  timelineLocalAtSource,
  trimBounds,
  trimClip,
  type Clip,
  type Command,
  type MoveTarget,
  type Project,
  type Track,
} from '@amv/project';
import { ChevronDown, ChevronUp, Eye, EyeOff, Lock, LockOpen, Magnet, Plus, ScanSearch, SlidersHorizontal, Sparkles, Trash2, Type, Volume2, VolumeX, ZoomIn, ZoomOut } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { ProjectSession } from '../../core/session';
import { useApp } from '../../store';
import { IconButton } from '../../ui/controls';
import { ignoreEditorKey, pxToUs, useEditor, usToPx, ZOOM_MAX, ZOOM_MIN } from './editorStore';
import { useStrip, useWaveform } from './mediaCache';
import { pickLevel } from '@amv/media';
import { selectClipsInMarquee } from './timelineSelection';
import { QualityDialog } from './QualityDialog';
import { GenerateDialog } from '../automv/GenerateDialog';
import { AudioMixerDialog } from './AudioMixerDialog';

const HEADER_W = 168;
const RULER_H = 26;
export const TRACK_H: Record<Track['kind'], number> = { video: 58, audio: 50, text: 34 };
const SNAP_PX = 8;
const EDGE_PX = 6;

type Gesture =
  | { kind: 'move'; ids: string[]; startX: number; startY: number; originTrackIdx: number; deltaUs: number; trackShift: number; snapAt: number | null; moved: boolean }
  | { kind: 'trim'; id: string; edge: 'start' | 'end'; startX: number; toUs: number; snapAt: number | null }
  | { kind: 'marquee'; startX: number; startY: number; endX: number; endY: number; initialSelection: string[]; moved: boolean }
  | { kind: 'scrub' }
  | null;

function trackColor(t: Track): string {
  return t.kind === 'video' ? 'bg-violet-deep/80 border-violet/60' : t.kind === 'audio' ? 'bg-azure-deep/80 border-azure/50' : 'bg-raised border-ink-soft/40';
}

// --------------------------------------------------------------------------- régua

function Ruler({ zoom, width, fps, playheadUs, onScrub }: { zoom: number; width: number; fps: Project['settings']['fps']; playheadUs: number; onScrub: (e: RPointerEvent) => void }) {
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
        {isMajor && <span className="tnum absolute top-1 left-1 text-2xs whitespace-nowrap text-muted">{formatTimecode(s * 1e6, fps)}</span>}
      </div>,
    );
  }
  return (
    <div className="relative cursor-text border-b border-line bg-panel" style={{ height: RULER_H, width }} onPointerDown={onScrub}>
      {ticks}
      <div
        className="pointer-events-none absolute bottom-0 size-0"
        style={{ left: usToPx(playheadUs, zoom) - 6, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '9px solid var(--color-azure)' }}
      />
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
  const { zoom, setZoom, playheadUs, setPlayhead, selection, select, toggleSelect, snapping, setSnapping, assetDrag, setAssetDrag } = useEditor();
  const toast = useApp((s) => s.toast);
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
  const allSnapPoints = useCallback(
    (exclude: Set<string>) => [...snapPoints(project, playheadUs, exclude), ...beatMarks.map((b) => ({ atUs: b.atUs, kind: 'marker' as const }))],
    [project, playheadUs, beatMarks],
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
    let ids = selection;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      toggleSelect(clip.id);
      return;
    }
    if (!selection.includes(clip.id)) {
      ids = [clip.id];
    }
    const groups = new Set(ids.map((id) => project.clips.find((item) => item.id === id)?.groupId).filter((id): id is string => !!id));
    const expanded = new Set(ids);
    for (const grouped of project.clips) if (grouped.groupId && groups.has(grouped.groupId)) expanded.add(grouped.id);
    ids = [...expanded];
    if (!selection.includes(clip.id) || ids.length !== selection.length) select(ids);
    if (track.locked) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (offset <= EDGE_PX && rect.width > EDGE_PX * 3) {
      setGesture({ kind: 'trim', id: clip.id, edge: 'start', startX: e.clientX, toUs: clip.timelineStartUs, snapAt: null });
    } else if (rect.right - e.clientX <= EDGE_PX && rect.width > EDGE_PX * 3) {
      setGesture({ kind: 'trim', id: clip.id, edge: 'end', startX: e.clientX, toUs: clipEndUs(clip), snapAt: null });
    } else {
      setGesture({ kind: 'move', ids, startX: e.clientX, startY: e.clientY, originTrackIdx: tracks.indexOf(track), deltaUs: 0, trackShift: 0, snapAt: null, moved: false });
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
    if (!g.moved) return;
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
  }, [assetDrag, project, tracks, trackAtY, xToUs, snapping, playheadUs, thresholdUs, run, setAssetDrag, setDropHint, toast, allSnapPoints]);

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

  // segue o playhead tocando
  const playing = useEditor((s) => s.playing);
  const proposalMarks = useEditor((s) => s.proposalMarks);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const x = usToPx(playheadUs, zoom);
    const view = el.clientWidth - HEADER_W;
    if (x > el.scrollLeft + view - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80);
  }, [playheadUs, zoom, playing]);

  const addText = () => {
    const track = tracks.find((t) => t.kind === 'text' && !t.locked);
    if (!track) {
      toast({ tone: 'warn', title: 'Não há trilha de texto destravada' });
      return;
    }
    const id = newId('clp');
    const P = project.settings;
    const cmds: Command[] = [
      ...clearRange(project, track.id, playheadUs, playheadUs + 3_000_000),
      {
        type: 'clip.add',
        clip: {
          id, trackId: track.id, assetId: null, timelineStartUs: playheadUs, durationUs: 3_000_000, sourceInUs: 0, sourceOutUs: 3_000_000, speed: 1, reverse: false,
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
      if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey) addTextRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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

  return (
    <>
    <section className="flex min-h-0 flex-1 flex-col border-t border-line bg-base" aria-label="Timeline">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line-soft px-2">
        <IconButton label={snapping ? 'Encaixe ligado (segure Alt para ignorar)' : 'Encaixe desligado'} aria-pressed={snapping} className={snapping ? 'text-violet-strong' : ''} onClick={() => setSnapping(!snapping)}>
          <Magnet size={15} />
        </IconButton>
        <span className="mx-1 h-4 w-px bg-line" />
        <IconButton label="Diminuir zoom (−)" onClick={() => setZoom(zoom / 1.4)}>
          <ZoomOut size={15} />
        </IconButton>
        <input
          type="range"
          aria-label="Zoom da timeline"
          className="w-28 accent-violet"
          min={Math.log(ZOOM_MIN)}
          max={Math.log(ZOOM_MAX)}
          step={0.01}
          value={Math.log(zoom)}
          onChange={(e) => setZoom(Math.exp(Number(e.target.value)))}
        />
        <IconButton label="Aumentar zoom (+)" onClick={() => setZoom(zoom * 1.4)}>
          <ZoomIn size={15} />
        </IconButton>
        <button type="button" className="ml-1 rounded px-2 py-1 text-xs text-muted hover:bg-raised hover:text-ink" onClick={fitAll}>
          Ajustar tudo
        </button>
        <span className="mx-1 h-4 w-px bg-line" />
        <button type="button" className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-ink-soft hover:bg-raised hover:text-ink" onClick={addText} title="Adicionar texto no playhead (T)">
          <Type size={14} /> Texto
        </button>
        <button type="button" className="flex items-center gap-1 rounded px-2 py-1 text-xs text-ink-soft hover:bg-raised hover:text-ink" onClick={() => addTrack('text')} title="Adicionar trilha de texto">
          <Plus size={13} /> Faixa de texto
        </button>
        <button type="button" className="flex items-center gap-1 rounded px-2 py-1 text-xs text-ink-soft hover:bg-raised hover:text-ink" onClick={() => addTrack('video')} title="Adicionar camada de vídeo">
          <Plus size={13} /> Vídeo
        </button>
        <button type="button" className="flex items-center gap-1 rounded px-2 py-1 text-xs text-ink-soft hover:bg-raised hover:text-ink" onClick={() => addTrack('audio')} title="Adicionar faixa de áudio">
          <Plus size={13} /> Áudio
        </button>
        <IconButton label="Abrir mixer de áudio" onClick={() => setAudioMixerOpen(true)}>
          <SlidersHorizontal size={15} />
        </IconButton>
        <IconButton label="Avaliar qualidade audiovisual" onClick={() => setQualityOpen(true)}>
          <ScanSearch size={15} />
        </IconButton>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-ink-soft hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:text-faint"
          title={localizedRange ? 'Gerar uma alternativa apenas para os clipes de vídeo selecionados' : 'Selecione clipes de vídeo na trilha principal'}
          disabled={!localizedRange}
          onClick={() => setRegenerateOpen(true)}
        >
          <Sparkles size={14} /> Melhorar seleção
        </button>
        <span className="tnum ml-auto pr-2 text-xs text-muted">
          {selection.length ? `${selection.length} selecionado(s) · ` : ''}duração {formatTimecode(durationUs, project.settings.fps)}
        </span>
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
            <div className="sticky left-0 z-30 shrink-0 border-r border-b border-line bg-panel" style={{ width: HEADER_W, height: RULER_H }} />
            <Ruler zoom={zoom} width={contentW} fps={project.settings.fps} playheadUs={playheadUs} onScrub={startScrub} />
          </div>

          {/* trilhas */}
          {tracks.map((t) => {
            const h = TRACK_H[t.kind];
            const sameKind = tracks.filter((item) => item.kind === t.kind);
            const trackPosition = sameKind.findIndex((item) => item.id === t.id);
            return (
              <div key={t.id} className="flex border-b border-line-soft" style={{ height: h }}>
                <div className="sticky left-0 z-10 flex shrink-0 items-center gap-0.5 border-r border-line bg-panel px-2" style={{ width: HEADER_W }}>
                  <span className={`mr-auto truncate text-xs font-medium ${t.hidden || t.muted ? 'text-faint' : 'text-ink-soft'}`}>{t.name}</span>
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
                    <IconButton label={t.muted ? 'Ativar som' : 'Silenciar'} aria-pressed={t.muted} className={`size-6 ${t.muted ? 'text-warn' : ''}`} onClick={() => run(t.muted ? 'Ativar som da trilha' : 'Silenciar trilha', [{ type: 'track.update', trackId: t.id, patch: { muted: !t.muted } }])}>
                      {t.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                    </IconButton>
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
                  title={`${c.label ?? asset?.name ?? 'Texto'}${c.groupId ? '\nElemento agrupado' : ''}${c.reason ? `\nIA: ${c.reason}` : ''}`}
                  onPointerDown={(e) => onClipPointerDown(e, c)}
                  className={`pointer-events-auto absolute overflow-hidden rounded-md border ${trackColor(t)} ${sel ? 'ring-2 ring-ink' : ''} ${box.dragging ? 'opacity-80 shadow-lg shadow-black/50' : ''} ${missing ? 'border-dashed border-warn' : ''} ${t.locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
                  style={{ left, width, top: trackTops.tops[ti]! + 2, height: h - 4, zIndex: box.dragging ? 5 : 1 }}
                >
                  {t.kind === 'video' && asset?.kind === 'video' && width > 30 && <Thumbs clip={c} widthPx={width} zoom={zoom} session={session} height={h - 4} />}
                  {t.kind === 'audio' && <Waveform clip={c} widthPx={width} zoom={zoom} session={session} color="rgba(147, 200, 255, 0.85)" />}
                  {keyTimes.map((atUs) => (
                    <span key={atUs} aria-hidden="true" className="pointer-events-none absolute top-1 z-[2] size-1.5 rotate-45 bg-azure shadow-sm" style={{ left: usToPx(atUs, zoom) - 3 }} />
                  ))}
                  <span className="relative z-[1] block truncate px-1.5 pt-0.5 text-2xs font-medium text-ink drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
                    {c.origin === 'ai' && <span className="mr-1 text-violet-strong">IA</span>}
                    {c.groupId && <span className="mr-1 text-azure">Grupo</span>}
                    {c.speed !== 1 && <span className="mr-1 text-warn">{c.speed}×</span>}
                    {c.text ? c.text.text : (c.label ?? asset?.name)}
                  </span>
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
            <div className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-azure" style={{ left: usToPx(playheadUs, zoom) }} />
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
    </>
  );
}
