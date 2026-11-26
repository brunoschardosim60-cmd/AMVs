import { alignClipPeakToNearestBeat, harmonizeTextClipsWithScenes, readPlayheadInsight } from '@amv/automv';
import { clipEndUs, evaluateKeyframes, formatTimecode, frameToUs, projectDurationUs, upsertKeyframe, usToFrame, type Clip, type Project } from '@amv/project';
import { editSubtitleTextManually, LOOKS, restyleSubtitles, type SubtitleLook } from '@amv/subtitles';
import { Activity, ChevronFirst, ChevronLast, Headphones, Maximize2, Minimize2, MonitorPlay, Pause, Pencil, Play, RotateCw, Sparkles, StepBack, StepForward, Wand2, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createCharacterCutoutOnV2 } from '../../core/cutout';
import type { ProjectSession } from '../../core/session';
import { useApp } from '../../store';
import { IconButton } from '../../ui/controls';
import { useEditor } from './editorStore';
import { LOCAL_FONT_FAMILIES } from './Inspector';
import { Player } from './player';
import { buildSessionReadingInputs } from './readingInputs';
import { estimateTextBounds } from './textLayer';

/** Um Player por sessão aberta; o React só liga/desliga o canvas. */
const players = new WeakMap<ProjectSession, Player>();

export function getPlayer(session: ProjectSession): Player {
  let p = players.get(session);
  if (!p) {
    p = createPlayer(session, session.project);
    players.set(session, p);
  }
  return p;
}

const DIRECT_VIDEO_EXT = /\.(mp4|m4v|webm|mov)$/i;
const DIRECT_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);

/** Indica se o WebView2 reproduz o vídeo original direto (ex.: MP4 H.264 8-bit em 1080p). */
export function canPlayOriginalDirectly(asset: Project['assets'][number]): boolean {
  if (asset.kind !== 'video') return false;
  const extOk = DIRECT_VIDEO_EXT.test(asset.path) || DIRECT_VIDEO_EXT.test(asset.name);
  const v = asset.probe?.video;
  if (!v) return extOk;
  const codecOk = DIRECT_VIDEO_CODECS.has(v.codec.toLowerCase());
  const depthOk = v.bitDepth === null || v.bitDepth === undefined || v.bitDepth <= 8;
  return extOk && codecOk && depthOk;
}

export function createPlayer(session: ProjectSession, project: Project, original?: boolean): Player {
  const platform = useApp.getState().platform;
  if (!platform) throw new Error('Plataforma indisponível');
  return new Player(project, {
    videoUrl: (id) => {
      const asset = session.project.assets.find((a) => a.id === id);
      if (!asset || asset.status === 'missing') return null;
      const useOriginal = original ?? useEditor.getState().previewOriginal;
      const proxyPath = session.assetRuntime(id).artifacts?.proxyPath ?? null;
      const path = useOriginal
        ? (canPlayOriginalDirectly(asset) || !proxyPath ? asset.path : proxyPath)
        : (proxyPath ?? asset.path);
      return path ? platform.fileUrl(path) : null;
    },
    audioUrl: (id, streamIndex) => {
      const asset = session.project.assets.find((a) => a.id === id);
      if (!asset || asset.status === 'missing') return null;
      const art = session.assetRuntime(id).artifacts;
      if (asset.kind === 'video') {
        const defaultStream = asset.probe?.audio[0]?.index;
        if (streamIndex !== null && streamIndex !== undefined && streamIndex !== defaultStream) {
          const streamProxy = art?.audioStreamProxyPaths[streamIndex];
          return streamProxy ? platform.fileUrl(streamProxy) : (asset.path ? platform.fileUrl(asset.path) : null);
        }
        const useOriginal = original ?? useEditor.getState().previewOriginal;
        const path = useOriginal && canPlayOriginalDirectly(asset)
          ? asset.path
          : (art?.proxyPath ?? asset.path);
        return path ? platform.fileUrl(path) : null;
      }
      return platform.fileUrl(art?.audioProxyPath ?? asset.path);
    },
    imageUrl: (id) => {
      const asset = session.project.assets.find((a) => a.id === id);
      return asset && asset.status !== 'missing' ? platform.fileUrl(asset.path) : null;
    },
  });
}

export function stepFrames(project: Project, us: number, n: number): number {
  const f = usToFrame(us, project.settings.fps) + n;
  return Math.max(0, frameToUs(f, project.settings.fps));
}

export function toggleAuditionClip(session: ProjectSession, clip: Clip): void {
  const state = useEditor.getState();
  const player = getPlayer(session);
  if (state.soloClipId === clip.id && state.playing) {
    state.setSoloClip(null);
    player.setSoloClip(null);
    state.setPlaying(false);
    player.pause();
    return;
  }
  const endUs = clipEndUs(clip);
  state.setSoloClip(clip.id, endUs);
  player.setSoloClip(clip.id, endUs);
  state.setPlayhead(clip.timelineStartUs);
  player.seek(clip.timelineStartUs);
  state.setPlaying(true);
}

interface ScreenBox {
  left: number;
  top: number;
  width: number;
  height: number;
  rotation: number;
  x: number;
  y: number;
  scale: number;
}

function computeClipScreenBox(
  project: Project,
  clip: Clip,
  playheadUs: number,
  frameWidth: number,
  draft?: { x: number; y: number; scale: number; rotation: number } | null,
): ScreenBox | null {
  if (frameWidth <= 0) return null;
  const P = project.settings;
  const pixelScale = frameWidth / P.width;
  const localUs = Math.max(0, playheadUs - clip.timelineStartUs);
  if (clip.text) {
    const est = estimateTextBounds(clip, P.width, P.height, localUs);
    if (!est) return null;
    const x = draft?.x ?? est.x;
    const y = draft?.y ?? est.y;
    const scale = draft?.scale ?? est.scale;
    const rotation = draft?.rotation ?? est.rotation;
    const scaleRatio = est.scale > 0 ? scale / est.scale : 1;
    const width = est.width * scaleRatio * pixelScale;
    const height = est.height * scaleRatio * pixelScale;
    return {
      left: (P.width / 2 + x) * pixelScale - width / 2,
      top: (P.height / 2 + y) * pixelScale - height / 2,
      width,
      height,
      rotation,
      x,
      y,
      scale,
    };
  }
  const asset = clip.assetId ? project.assets.find((a) => a.id === clip.assetId) : undefined;
  const x = draft?.x ?? evaluateKeyframes(clip.keyframes['transform.x'], localUs, clip.transform.x);
  const y = draft?.y ?? evaluateKeyframes(clip.keyframes['transform.y'], localUs, clip.transform.y);
  const scale = draft?.scale ?? evaluateKeyframes(clip.keyframes['transform.scale'], localUs, clip.transform.scale);
  const rotation = draft?.rotation ?? evaluateKeyframes(clip.keyframes['transform.rotation'], localUs, clip.transform.rotation);
  const crop = clip.transform.crop;
  const sourceWidth = asset?.probe?.video?.width ?? P.width;
  const sourceHeight = asset?.probe?.video?.height ?? P.height;
  const cropWidth = sourceWidth * (1 - crop.left - crop.right);
  const cropHeight = sourceHeight * (1 - crop.top - crop.bottom);
  const fit = Math.min(P.width / cropWidth, P.height / cropHeight);
  const width = cropWidth * fit * scale * pixelScale;
  const height = cropHeight * fit * scale * pixelScale;
  return {
    left: (P.width / 2 + x) * pixelScale - width / 2,
    top: (P.height / 2 + y) * pixelScale - height / 2,
    width,
    height,
    rotation,
    x,
    y,
    scale,
  };
}

export function Preview({ session, project }: { session: ProjectSession; project: Project }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const inlineInputRef = useRef<HTMLTextAreaElement>(null);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const playing = useEditor((s) => s.playing);
  const setPlaying = useEditor((s) => s.setPlaying);
  const previewScale = useEditor((s) => s.previewScale);
  const previewOriginal = useEditor((s) => s.previewOriginal);
  const setPreviewScale = useEditor((s) => s.setPreviewScale);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const requestInspector = useEditor((s) => s.requestInspector);
  const setEditingClipId = useEditor((s) => s.setEditingClipId);
  const soloClipId = useEditor((s) => s.soloClipId);
  const soloStopAtUs = useEditor((s) => s.soloStopAtUs);
  const setSoloClip = useEditor((s) => s.setSoloClip);
  const [playheadUs, setPausedPlayheadUs] = useState(() => useEditor.getState().playheadUs);
  const player = getPlayer(session);
  const P = project.settings;
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null);
  const [inlineEditClipId, setInlineEditClipId] = useState<string | null>(null);
  const [inlineDraft, setInlineDraft] = useState('');
  const [draftTransform, setDraftTransform] = useState<{ x: number; y: number; scale: number; rotation: number } | null>(null);
  const manipulation = useRef<{
    clip: Clip;
    action: 'move' | 'resize' | 'rotate';
    pointerId: number;
    startX: number;
    startY: number;
    centerX: number;
    centerY: number;
    startAngleDeg: number;
    x: number;
    y: number;
    scale: number;
    rotation: number;
    width: number;
    height: number;
    moved: boolean;
    wasCanvasClick?: boolean;
  } | null>(null);
  const previewRef = useRef<HTMLElement>(null);
  const syncingFromPlayerRef = useRef(false);

  useEffect(() => {
    const cv = canvasRef.current!;
    const offAudioError = player.onAudioError((error) => {
      useApp.getState().toast({ tone: 'warn', title: 'Áudio do preview indisponível', body: error.message });
    });
    player.attach(cv);
    const offTime = player.onTime((us) => {
      if (player.isPlaying) {
        syncingFromPlayerRef.current = true;
        try {
          useEditor.getState().setPlayhead(us);
        } finally {
          syncingFromPlayerRef.current = false;
        }
      }
    });
    const offEnd = player.onEnded(() => {
      const st = useEditor.getState();
      if (st.soloStopAtUs !== null) st.setSoloClip(null);
      st.setPlaying(false);
    });
    return () => {
      offTime();
      offEnd();
      offAudioError();
      player.pause();
      player.detach();
    };
  }, [player]);

  useEffect(() => {
    player.setSoloClip(soloClipId, soloStopAtUs);
    if (!player.isPlaying) player.seek(useEditor.getState().playheadUs);
  }, [player, soloClipId, soloStopAtUs]);

  useEffect(() => {
    player.setProject(project);
    if (!player.isPlaying) player.seek(useEditor.getState().playheadUs);
  }, [player, project]);

  useEffect(() => {
    const updateFullscreen = () => setFullscreen(document.fullscreenElement === previewRef.current);
    document.addEventListener('fullscreenchange', updateFullscreen);
    return () => document.removeEventListener('fullscreenchange', updateFullscreen);
  }, []);

  useEffect(() => {
    setPausedPlayheadUs(useEditor.getState().playheadUs);
    return useEditor.subscribe((state, prev) => {
      if (state.playheadUs === prev.playheadUs) return;
      if (syncingFromPlayerRef.current) return;
      player.seek(state.playheadUs);
      if (!state.playing) setPausedPlayheadUs(state.playheadUs);
    });
  }, [player]);

  useEffect(() => {
    if (playing) {
      player.play();
    } else {
      player.pause();
      setPausedPlayheadUs(useEditor.getState().playheadUs);
    }
  }, [player, playing]);

  useEffect(() => {
    const box = boxRef.current!;
    const cv = canvasRef.current!;
    const fit = () => {
      const pad = 24;
      const bw = Math.max(1, box.clientWidth - pad);
      const bh = Math.max(1, box.clientHeight - pad);
      const s = Math.min(bw / P.width, bh / P.height);
      const width = Math.floor(P.width * s);
      const height = Math.floor(P.height * s);
      cv.style.width = `${width}px`;
      cv.style.height = `${height}px`;
      if (frameRef.current) {
        frameRef.current.style.width = `${width}px`;
        frameRef.current.style.height = `${height}px`;
      }
      setFrameSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [P.width, P.height]);

  useEffect(() => {
    const cv = canvasRef.current!;
    const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    const maxW = Math.round(P.width * previewScale);
    const screenW = !fullscreen && frameSize.width > 0 ? Math.max(320, Math.round(frameSize.width * dpr)) : maxW;
    const targetW = Math.max(2, Math.min(maxW, screenW));
    const targetH = Math.max(2, Math.round((targetW * P.height) / P.width));
    if (cv.width !== targetW || cv.height !== targetH) {
      cv.width = targetW;
      cv.height = targetH;
      if (!player.isPlaying) player.seek(useEditor.getState().playheadUs);
    }
  }, [P.width, P.height, previewScale, fullscreen, frameSize.width, player]);

  useEffect(() => {
    if (inlineEditClipId) {
      setTimeout(() => {
        inlineInputRef.current?.focus();
        inlineInputRef.current?.select();
      }, 0);
    }
  }, [inlineEditClipId]);

  const end = projectDurationUs(project);
  const go = (us: number) => {
    setPlayhead(us);
    player.seek(us);
  };

  const toggleFullscreen = async () => {
    const element = previewRef.current;
    if (!element) return;
    try {
      if (document.fullscreenElement === element) await document.exitFullscreen();
      else await element.requestFullscreen();
    } catch (error) {
      useApp.getState().toast({ tone: 'warn', title: 'Não foi possível ampliar a prévia', body: error instanceof Error ? error.message : String(error) });
    }
  };

  /** Clipes visuais ativos neste instante, na ordem exata de frente → fundo (texto frontal → V2 → texto atrás → V1). */
  const activeVisualStack = (): Clip[] => {
    const phUs = useEditor.getState().playheadUs;
    const visualTracks = project.tracks.filter((t) => t.kind !== 'audio' && !t.hidden && !t.locked);
    const bottomVideoId = [...visualTracks].reverse().find((t) => t.kind === 'video')?.id;
    const activeInTrack = (trackId: string) =>
      project.clips.filter((c) => c.trackId === trackId && phUs >= c.timelineStartUs && phUs < clipEndUs(c));
    const drawOrderBottomToTop: Clip[] = [];
    let drewBehindText = false;
    for (let i = visualTracks.length - 1; i >= 0; i--) {
      const tr = visualTracks[i]!;
      if (!drewBehindText && tr.kind === 'video' && tr.id !== bottomVideoId) {
        for (let j = visualTracks.length - 1; j >= 0; j--) {
          if (visualTracks[j]!.kind === 'text') {
            drawOrderBottomToTop.push(...activeInTrack(visualTracks[j]!.id).filter((c) => Boolean(c.text?.behindCutout)));
          }
        }
        drewBehindText = true;
      }
      if (tr.kind === 'text') {
        drawOrderBottomToTop.push(
          ...activeInTrack(tr.id).filter((c) => (drewBehindText ? !c.text?.behindCutout : true)),
        );
      } else {
        drawOrderBottomToTop.push(...activeInTrack(tr.id));
      }
    }
    return drawOrderBottomToTop.reverse();
  };

  const hitTestPreview = (clientX: number, clientY: number): { clip: Clip; box: ScreenBox; isOverlay: boolean } | null => {
    const frameEl = frameRef.current;
    if (!frameEl || frameSize.width <= 0) return null;
    const phUs = useEditor.getState().playheadUs;
    const rect = frameEl.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const stack = activeVisualStack();
    const bottomVideoId = [...project.tracks].reverse().find((t) => t.kind === 'video')?.id;
    for (const c of stack) {
      const box = computeClipScreenBox(project, c, phUs, frameSize.width);
      if (!box) continue;
      const pad = c.text ? 10 : 0;
      if (px >= box.left - pad && px <= box.left + box.width + pad && py >= box.top - pad && py <= box.top + box.height + pad) {
        return { clip: c, box, isOverlay: Boolean(c.text || c.trackId !== bottomVideoId) };
      }
    }
    return null;
  };

  const selectedClip = selection.length === 1 ? project.clips.find((clip) => clip.id === selection[0]) : undefined;
  const selectedTrack = selectedClip && project.tracks.find((track) => track.id === selectedClip.trackId);
  const aspect = P.width / P.height;
  const aspectLabel = Math.abs(aspect - 16 / 9) < 0.02 ? '16:9' : Math.abs(aspect - 9 / 16) < 0.02 ? '9:16' : Math.abs(aspect - 1) < 0.02 ? '1:1' : `${P.width}:${P.height}`;
  const canManipulate = !playing && !!selectedClip && !!selectedTrack && selectedTrack.kind !== 'audio' && !selectedTrack.hidden && !selectedTrack.locked &&
    playheadUs >= selectedClip.timelineStartUs && playheadUs < clipEndUs(selectedClip);
  const handleBox = canManipulate && selectedClip
    ? computeClipScreenBox(project, selectedClip, playheadUs, frameSize.width, draftTransform)
    : null;
  const hoveredClip = hoveredClipId && hoveredClipId !== selectedClip?.id
    ? project.clips.find((c) => c.id === hoveredClipId)
    : undefined;
  const hoveredBox = hoveredClip ? computeClipScreenBox(project, hoveredClip, playheadUs, frameSize.width) : null;

  const openInlineTextEdit = (clip: Clip) => {
    if (!clip.text) return;
    setPlaying(false);
    select([clip.id]);
    setInlineDraft(clip.text.text);
    setInlineEditClipId(clip.id);
  };

  const commitInlineTextEdit = () => {
    if (!inlineEditClipId) return;
    const clip = project.clips.find((c) => c.id === inlineEditClipId);
    setInlineEditClipId(null);
    if (!clip?.text) return;
    if (inlineDraft !== clip.text.text && inlineDraft.trim()) {
      session.history.transaction('Editar texto na tela de preview', [
        { type: 'clip.update', clipId: clip.id, patch: { text: editSubtitleTextManually(clip.text, inlineDraft) } },
      ]);
    }
  };

  const beginDragGesture = (
    event: ReactPointerEvent<HTMLElement>,
    clip: Clip,
    box: ScreenBox,
    action: 'move' | 'resize' | 'rotate',
    wasCanvasClick = false,
  ) => {
    const frameEl = frameRef.current;
    if (!frameEl) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = frameEl.getBoundingClientRect();
    const centerX = rect.left + box.left + box.width / 2;
    const centerY = rect.top + box.top + box.height / 2;
    const startAngleDeg = (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) / Math.PI;
    manipulation.current = {
      clip,
      action,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      centerX,
      centerY,
      startAngleDeg,
      x: box.x,
      y: box.y,
      scale: box.scale,
      rotation: box.rotation,
      width: box.width,
      height: box.height,
      moved: false,
      wasCanvasClick,
    };
    setDraftTransform({ x: box.x, y: box.y, scale: box.scale, rotation: box.rotation });
  };

  const startManipulation = (event: ReactPointerEvent<HTMLElement>, action: 'move' | 'resize' | 'rotate') => {
    if (!selectedClip || !handleBox || event.button !== 0) return;
    beginDragGesture(event, selectedClip, handleBox, action, false);
  };

  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    if (inlineEditClipId) {
      commitInlineTextEdit();
      return;
    }
    const hit = hitTestPreview(event.clientX, event.clientY);
    if (hit && hit.isOverlay) {
      setPlaying(false);
      select([hit.clip.id]);
      requestInspector();
      beginDragGesture(event, hit.clip, hit.box, 'move', true);
      return;
    }
    if (hit) {
      // Clicou na cena de fundo (V1): seleciona a cena e permite alternar play/pause se não arrastar
      select([hit.clip.id]);
      beginDragGesture(event, hit.clip, hit.box, 'move', true);
      return;
    }
    setPlaying(!playing);
  };

  const onCanvasDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = hitTestPreview(event.clientX, event.clientY);
    if (!hit) return;
    event.preventDefault();
    event.stopPropagation();
    if (hit.clip.text) {
      openInlineTextEdit(hit.clip);
    } else {
      setPlaying(false);
      select([hit.clip.id]);
      requestInspector();
      setEditingClipId(hit.clip.id);
    }
  };

  const moveManipulation = (event: ReactPointerEvent<HTMLElement>) => {
    const current = manipulation.current;
    if (!current || current.pointerId !== event.pointerId) {
      const hit = hitTestPreview(event.clientX, event.clientY);
      setHoveredClipId(hit?.isOverlay ? hit.clip.id : null);
      return;
    }
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (Math.hypot(dx, dy) >= 4) {
      if (!current.moved && playing) setPlaying(false);
      current.moved = true;
    }
    if (!current.moved) return;
    const frameScale = frameSize.width / P.width;
    if (current.action === 'move') {
      setDraftTransform({
        x: Math.round(current.x + dx / frameScale),
        y: Math.round(current.y + dy / frameScale),
        scale: current.scale,
        rotation: current.rotation,
      });
    } else if (current.action === 'rotate') {
      const angle = (Math.atan2(event.clientY - current.centerY, event.clientX - current.centerX) * 180) / Math.PI;
      const deltaAngle = angle - current.startAngleDeg;
      setDraftTransform({
        x: current.x,
        y: current.y,
        scale: current.scale,
        rotation: Math.round((current.rotation + deltaAngle) * 10) / 10,
      });
    } else {
      const startDist = Math.max(12, Math.hypot(current.startX - current.centerX, current.startY - current.centerY));
      const newDist = Math.max(6, Math.hypot(event.clientX - current.centerX, event.clientY - current.centerY));
      setDraftTransform({
        x: current.x,
        y: current.y,
        scale: Math.max(0.1, Math.round(current.scale * (newDist / startDist) * 1000) / 1000),
        rotation: current.rotation,
      });
    }
  };

  const finishManipulation = (event: ReactPointerEvent<HTMLElement>) => {
    const current = manipulation.current;
    const draft = draftTransform;
    manipulation.current = null;
    setDraftTransform(null);
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.moved) {
      const bottomVideoId = [...project.tracks].reverse().find((t) => t.kind === 'video')?.id;
      if (current.wasCanvasClick && current.clip.trackId === bottomVideoId && !current.clip.text) {
        setPlaying(!playing);
      }
      return;
    }
    if (!draft) return;
    const clip = current.clip;
    const localUs = Math.max(0, Math.min(clip.durationUs, playheadUs - clip.timelineStartUs));
    const transform = { ...clip.transform };
    const keyframes = { ...clip.keyframes };
    // Em texto sem keyframes de escala, redimensionar ajusta diretamente o tamanho da fonte para nitidez máxima
    if (clip.text && current.action === 'resize' && !keyframes['transform.scale']?.length && current.scale > 0) {
      const newSize = Math.max(12, Math.min(420, Math.round(clip.text.size * (draft.scale / current.scale))));
      session.history.transaction('Redimensionar texto no preview', [
        { type: 'clip.update', clipId: clip.id, patch: { text: { ...clip.text, size: newSize } } },
      ]);
      return;
    }
    for (const property of ['x', 'y', 'scale', 'rotation'] as const) {
      const path = `transform.${property}`;
      const value = draft[property];
      if (keyframes[path]?.length) keyframes[path] = upsertKeyframe(keyframes[path], localUs, value);
      else transform[property] = value;
    }
    const label = current.action === 'move'
      ? 'Mover camada no preview'
      : current.action === 'rotate'
        ? 'Girar camada no preview'
        : 'Redimensionar camada no preview';
    session.history.transaction(label, [
      { type: 'clip.update', clipId: clip.id, patch: { transform, keyframes } },
    ]);
  };

  const patchSelectedClip = (label: string, patch: Partial<Clip>) => {
    if (!selectedClip) return;
    session.history.transaction(label, [{ type: 'clip.update', clipId: selectedClip.id, patch }]);
  };

  const soloClipObj = soloClipId ? project.clips.find((c) => c.id === soloClipId) : undefined;
  const editingTextClip = inlineEditClipId ? project.clips.find((c) => c.id === inlineEditClipId) : undefined;
  const editingBox = editingTextClip ? computeClipScreenBox(project, editingTextClip, playheadUs, frameSize.width) : null;
  const [hudOpen, setHudOpen] = useState(false);

  return (
    <section ref={previewRef} className="editor-preview flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Pré-visualização">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line-soft px-4">
        <MonitorPlay size={15} className="text-violet-strong" />
        <span className="text-[11px] font-semibold tracking-wide text-ink">Prévia interativa</span>
        <select aria-label="Fonte da prévia" className="min-w-0 rounded border border-line bg-base text-xs text-ink" value={previewOriginal ? 'original' : 'proxy'} onChange={(e) => { setPlaying(false); useEditor.setState({ previewOriginal: e.target.value === 'original' }); player.seek(playheadUs); }}>
          <option value="proxy">Proxy leve</option>
          <option value="original">Original</option>
        </select>
        <select aria-label="Resolução da prévia" className="min-w-0 rounded border border-line bg-base text-xs text-ink" value={previewScale} onChange={(e) => { const n = Number(e.target.value); if (n === 1 || n === 0.5 || n === 0.25) setPreviewScale(n); }}>
          <option value={1}>100%</option><option value={0.5}>50%</option><option value={0.25}>25%</option>
        </select>
        <button
          type="button"
          aria-pressed={hudOpen}
          onClick={() => setHudOpen((v) => !v)}
          title="Raio-X de Leitura ao vivo: mostra batida/seção da música, nitidez/cores da cena e velocidade/contraste da legenda"
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${
            hudOpen
              ? 'border-violet bg-violet/25 text-ink'
              : 'border-line bg-base text-muted hover:border-violet/50 hover:text-ink'
          }`}
        >
          <Activity size={11} className={hudOpen ? 'text-violet-strong' : ''} />
          Raio-X
        </button>
        {soloClipObj && (
          <button
            type="button"
            onClick={() => {
              setSoloClip(null);
              player.setSoloClip(null);
              setPlaying(false);
            }}
            className="inline-flex items-center gap-1 rounded-full border border-azure bg-azure/20 px-2.5 py-0.5 text-[10px] font-semibold text-ink hover:bg-azure/30"
            title="Clique para voltar a escutar todas as trilhas"
          >
            <Headphones size={11} className="text-azure" />
            Escuta isolada ativa · Sair
          </button>
        )}
        <span className="ml-auto hidden tnum text-[10px] text-muted sm:block">{P.width}×{P.height} · {aspectLabel} · {P.fps.num}/{P.fps.den} fps</span>
      </div>
      <div ref={boxRef} className="preview-stage grid min-h-0 flex-1 place-items-center overflow-hidden p-4">
        <div ref={frameRef} className="relative shrink-0">
          <canvas
            ref={canvasRef}
            className="preview-canvas bg-black"
            style={{ cursor: hoveredClipId ? 'grab' : 'default', touchAction: 'none' }}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={moveManipulation}
            onPointerUp={finishManipulation}
            onPointerCancel={finishManipulation}
            onPointerLeave={() => setHoveredClipId(null)}
            onDoubleClick={onCanvasDoubleClick}
          />
          {hudOpen && <PreviewHudOverlay project={project} session={session} />}
          {hoveredBox && !inlineEditClipId && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute rounded border border-dashed border-violet/80 bg-violet/5"
              style={{
                left: hoveredBox.left,
                top: hoveredBox.top,
                width: hoveredBox.width,
                height: hoveredBox.height,
                transform: `rotate(${hoveredBox.rotation}deg)`,
              }}
            />
          )}
          {handleBox && selectedClip && !inlineEditClipId && (
            <>
              <div
                className="absolute border-2 border-azure shadow-[0_0_0_1px_rgba(0,0,0,0.75)]"
                style={{
                  left: handleBox.left,
                  top: handleBox.top,
                  width: handleBox.width,
                  height: handleBox.height,
                  transform: `rotate(${handleBox.rotation}deg)`,
                  cursor: 'move',
                  touchAction: 'none',
                }}
                title={selectedClip.text ? 'Arraste para mover · clique duas vezes para editar o texto aqui na tela' : 'Arraste para mover · cantos redimensionam · topo gira'}
                onPointerDown={(event) => startManipulation(event, 'move')}
                onPointerMove={moveManipulation}
                onPointerUp={finishManipulation}
                onPointerCancel={finishManipulation}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (selectedClip.text) openInlineTextEdit(selectedClip);
                  else setEditingClipId(selectedClip.id);
                }}
                onClick={(event) => event.stopPropagation()}
              >
                {/* Alça de rotação no topo */}
                <button
                  type="button"
                  aria-label="Girar camada selecionada"
                  title="Arraste para girar"
                  className="absolute -top-6 left-1/2 grid size-4 -translate-x-1/2 cursor-grab place-items-center rounded-full border border-base bg-violet text-action-ink shadow active:cursor-grabbing"
                  style={{ touchAction: 'none' }}
                  onPointerDown={(event) => startManipulation(event, 'rotate')}
                  onPointerMove={moveManipulation}
                  onPointerUp={finishManipulation}
                  onPointerCancel={finishManipulation}
                  onClick={(event) => event.stopPropagation()}
                >
                  <RotateCw size={9} />
                </button>
                {/* 4 cantos de redimensionamento */}
                {(['-left-1.5 -top-1.5 cursor-nwse-resize', '-right-1.5 -top-1.5 cursor-nesw-resize', '-left-1.5 -bottom-1.5 cursor-nesw-resize', '-right-1.5 -bottom-1.5 cursor-nwse-resize'] as const).map((pos, idx) => (
                  <button
                    key={idx}
                    type="button"
                    aria-label="Redimensionar camada selecionada"
                    className={`absolute size-3.5 rounded-full border-2 border-base bg-azure shadow ${pos}`}
                    style={{ touchAction: 'none' }}
                    onPointerDown={(event) => startManipulation(event, 'resize')}
                    onPointerMove={moveManipulation}
                    onPointerUp={finishManipulation}
                    onPointerCancel={finishManipulation}
                    onClick={(event) => event.stopPropagation()}
                  />
                ))}
              </div>

              {/* Barra flutuante de edição rápida direto na tela de Preview */}
              <div
                className="absolute z-20 flex max-w-[96%] flex-wrap items-center gap-1 rounded-lg border border-line bg-[#11141acc] px-2 py-1 text-[11px] text-ink shadow-xl backdrop-blur-md"
                style={{
                  left: Math.max(4, Math.min(frameSize.width - 260, handleBox.left)),
                  top: handleBox.top > 48 ? Math.max(4, handleBox.top - 40) : Math.min(frameSize.height - 38, handleBox.top + handleBox.height + 8),
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                {selectedClip.text ? (
                  <>
                    <button
                      type="button"
                      onClick={() => openInlineTextEdit(selectedClip)}
                      className="inline-flex h-6 items-center gap-1 rounded bg-violet px-2 font-semibold text-action-ink hover:bg-violet-strong"
                      title="Editar palavras diretamente na tela"
                    >
                      <Pencil size={11} /> Editar
                    </button>
                    <select
                      aria-label="Fonte rápida no preview"
                      value={selectedClip.text.font}
                      onChange={(e) => patchSelectedClip('Trocar fonte no preview', { text: { ...selectedClip.text!, font: e.target.value } })}
                      className="h-6 max-w-[116px] rounded border border-line bg-base px-1 text-[10px] text-ink"
                    >
                      {[...new Set([selectedClip.text.font, ...LOCAL_FONT_FAMILIES])].map((f) => (
                        <option key={f} value={f}>{f.replace(/ Variable$/, '')}</option>
                      ))}
                    </select>
                    <select
                      aria-label="Preset rápido no preview"
                      value=""
                      onChange={(e) => {
                        const lk = e.target.value as SubtitleLook;
                        if (lk) session.history.transaction(`Estilo ${lk}`, restyleSubtitles(project, [selectedClip.id], lk));
                      }}
                      className="h-6 max-w-[104px] rounded border border-line bg-base px-1 text-[10px] text-ink"
                    >
                      <option value="">Estilo…</option>
                      {LOOKS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                    </select>
                    <select
                      aria-label="Mesclar texto com o vídeo"
                      value={selectedClip.blendMode}
                      onChange={(e) => patchSelectedClip('Mesclar com vídeo', { blendMode: e.target.value as Clip['blendMode'] })}
                      className="h-6 max-w-[98px] rounded border border-line bg-base px-1 text-[10px] text-ink"
                      title="Mesclar letra com as cores e luz do vídeo"
                    >
                      <option value="normal">Normal</option>
                      <option value="difference">Negativo (Vídeo)</option>
                      <option value="screen">Luz / Tela</option>
                      <option value="overlay">Sobrepor</option>
                      <option value="hardlight">Luz Forte</option>
                      <option value="dodge">Brilho Vivo</option>
                      <option value="addition">Adição</option>
                    </select>
                    <input
                      type="color"
                      aria-label="Cor do texto no preview"
                      value={selectedClip.text.color}
                      onChange={(e) => patchSelectedClip('Cor do texto', { text: { ...selectedClip.text!, color: e.target.value } })}
                      className="h-6 w-6 cursor-pointer rounded border border-line bg-base p-0"
                      title="Cor principal"
                    />
                    <button
                      type="button"
                      aria-pressed={selectedClip.text.fillStyle === 'hollow'}
                      onClick={() => patchSelectedClip('Alternar texto vazado', {
                        text: { ...selectedClip.text!, fillStyle: selectedClip.text!.fillStyle === 'hollow' ? 'solid' : 'hollow' },
                      })}
                      className={`h-6 rounded border px-1.5 text-[10px] ${selectedClip.text.fillStyle === 'hollow' ? 'border-azure bg-azure/25 font-semibold text-ink' : 'border-line bg-base text-muted hover:text-ink'}`}
                      title="Texto vazado: deixa o vídeo/fogo aparecer por dentro da letra"
                    >
                      Vazado
                    </button>
                    <button
                      type="button"
                      aria-pressed={selectedClip.text.behindCutout}
                      onClick={() => patchSelectedClip('Alternar atrás do personagem', {
                        text: { ...selectedClip.text!, behindCutout: !selectedClip.text!.behindCutout },
                      })}
                      className={`h-6 rounded border px-1.5 text-[10px] ${selectedClip.text.behindCutout ? 'border-violet bg-violet/25 font-semibold text-ink' : 'border-line bg-base text-muted hover:text-ink'}`}
                      title="Passar texto por trás do recorte de personagem em V2"
                    >
                      Atrás V2
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const { episodes } = buildSessionReadingInputs(session);
                        const res = harmonizeTextClipsWithScenes({ project, episodes, clipIds: [selectedClip.id] });
                        if (res.commands.length) {
                          session.history.transaction('Harmonizar texto com a cena', res.commands);
                          useApp.getState().toast({ tone: 'ok', title: 'Harmonizado com a cena', body: 'Cores, contraste, desvio facial e leitura ajustados.' });
                        } else {
                          useApp.getState().toast({ tone: 'info', title: 'Já harmonizado com esta cena' });
                        }
                      }}
                      className="inline-flex h-6 items-center gap-1 rounded border border-azure/50 bg-azure/20 px-1.5 text-[10px] font-semibold text-ink hover:bg-azure/30"
                      title="Harmonizar cores, contraste, desvio do rosto e tempo de leitura com o vídeo"
                    >
                      <Wand2 size={10} /> Harmonizar
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => toggleAuditionClip(session, selectedClip)}
                      className={`inline-flex h-6 items-center gap-1 rounded border px-2 text-[10px] font-medium ${soloClipId === selectedClip.id ? 'border-azure bg-azure/25 text-ink' : 'border-line bg-base text-ink-soft hover:text-ink'}`}
                      title="Isolar e escutar apenas o som original desta cena (atalho: O)"
                    >
                      <Headphones size={11} /> {soloClipId === selectedClip.id ? 'Parar escuta' : 'Ouvir cena'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const { episodes, musics } = buildSessionReadingInputs(session);
                        const aligned = alignClipPeakToNearestBeat({ project, clipId: selectedClip.id, episodes, musics });
                        if (aligned) {
                          session.history.transaction('Sincronizar golpe na batida', [aligned.command]);
                          useApp.getState().toast({ tone: 'ok', title: 'Golpe cravado na batida', body: `Pico em ${aligned.peakSourceS}s alinhado em ${aligned.beatTimelineS}s.` });
                        } else {
                          useApp.getState().toast({ tone: 'info', title: 'Golpe já alinhado ou sem batida próxima' });
                        }
                      }}
                      className="inline-flex h-6 items-center gap-1 rounded border border-ok/45 bg-ok/15 px-2 text-[10px] font-medium text-ink hover:bg-ok/25"
                      title="Cravar automaticamente o golpe/pico de movimento desta cena na batida da música"
                    >
                      <Zap size={10} /> Golpe na batida
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const { platform: plat, toast: showToast } = useApp.getState();
                        if (!plat) return;
                        void createCharacterCutoutOnV2(plat, session, selectedClip, playheadUs)
                          .then(({ engine }) => showToast({ tone: 'ok', title: 'Personagem recortado em V2', body: `Recorte (${engine}) pronto com letra atrás.` }))
                          .catch((err) => showToast({ tone: 'error', title: 'Falha no recorte', body: err instanceof Error ? err.message : String(err) }));
                      }}
                      className="inline-flex h-6 items-center gap-1 rounded border border-violet/45 bg-violet/15 px-2 text-[10px] font-medium text-ink hover:bg-violet/25"
                      title="Recortar personagem deste quadro em V2 e passar a letra por trás"
                    >
                      <Sparkles size={11} /> Recortar V2
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingClipId(selectedClip.id)}
                      className="inline-flex h-6 items-center gap-1 rounded border border-line bg-base px-2 text-[10px] text-ink-soft hover:text-ink"
                    >
                      <Pencil size={10} /> Trocar trecho
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          {/* Editor inline direto em cima do vídeo ao dar duplo-clique no texto */}
          {editingTextClip?.text && editingBox && (
            <div
              className="absolute z-30 flex flex-col gap-1"
              style={{
                left: Math.max(8, Math.min(frameSize.width - 220, editingBox.left - 8)),
                top: Math.max(8, Math.min(frameSize.height - 90, editingBox.top - 6)),
                width: Math.min(frameSize.width - 16, Math.max(220, editingBox.width + 16)),
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <textarea
                ref={inlineInputRef}
                value={inlineDraft}
                onChange={(e) => setInlineDraft(e.target.value)}
                onBlur={commitInlineTextEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setInlineEditClipId(null);
                  } else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    commitInlineTextEdit();
                  }
                }}
                rows={2}
                aria-label="Editar texto diretamente no preview"
                className="w-full resize-none rounded-md border-2 border-violet bg-black/85 px-3 py-2 text-center text-base font-bold text-white shadow-2xl outline-none"
                style={{ fontFamily: `"${editingTextClip.text.font}", system-ui, sans-serif` }}
              />
              <span className="self-center rounded bg-black/80 px-2 py-0.5 text-[10px] text-muted">
                Enter salva · Shift+Enter quebra linha · Esc cancela
              </span>
            </div>
          )}
        </div>
      </div>
      <PreviewTransportBar
        project={project}
        end={end}
        playing={playing}
        previewScale={previewScale}
        setPreviewScale={setPreviewScale}
        setPlaying={setPlaying}
        go={go}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
      />
    </section>
  );
}

function PreviewHudOverlay({ project, session }: { project: Project; session: ProjectSession }) {
  const [playheadUs, setPlayheadUs] = useState(() => useEditor.getState().playheadUs);
  // Raio-X é caro: pausado acompanha na hora; tocando, atualiza só ~3x por segundo.
  useEffect(() => {
    let last = 0;
    return useEditor.subscribe((state, prev) => {
      if (state.playheadUs === prev.playheadUs) return;
      const now = performance.now();
      if (state.playing && now - last < 350) return;
      last = now;
      setPlayheadUs(state.playheadUs);
    });
  }, []);
  const readingInputs = useMemo(
    () => buildSessionReadingInputs(session),
    [session, session.changes, project.assets],
  );
  const playheadInsight = useMemo(
    () => readPlayheadInsight({ project, playheadUs, ...readingInputs }),
    [project, playheadUs, readingInputs],
  );
  return (
    <div
      aria-label="Raio-X de Leitura Audiovisual"
      className="pointer-events-none absolute top-2.5 left-2.5 z-10 flex max-w-[92%] flex-col gap-1 rounded-lg border border-white/15 bg-black/75 px-2.5 py-2 text-[10px] text-white shadow-lg backdrop-blur-md"
    >
      {playheadInsight.music && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-violet/35 px-1.5 py-0.5 font-bold uppercase tracking-wider text-violet-strong">
            {playheadInsight.music.sectionLabel}
          </span>
          <span className="tnum text-white/85">
            {playheadInsight.music.bpm} BPM · Energia {Math.round(playheadInsight.music.energy * 100)}%
          </span>
          {playheadInsight.music.beatDeltaMs !== null && (
            <span
              className={`tnum rounded px-1.5 py-0.5 font-semibold ${
                playheadInsight.music.beatStatus === 'locked'
                  ? 'bg-ok/25 text-ok'
                  : playheadInsight.music.beatStatus === 'near'
                    ? 'bg-warn/25 text-warn'
                    : 'bg-white/10 text-white/70'
              }`}
            >
              Batida {playheadInsight.music.beatDeltaMs > 0 ? `+${playheadInsight.music.beatDeltaMs}` : playheadInsight.music.beatDeltaMs}ms
            </span>
          )}
          {playheadInsight.music.nextDropInS !== null && playheadInsight.music.nextDropInS > 0.1 && playheadInsight.music.nextDropInS <= 8 && (
            <span className="tnum text-azure">Drop em {playheadInsight.music.nextDropInS}s</span>
          )}
        </div>
      )}
      {playheadInsight.scene && (
        <div className="flex flex-wrap items-center gap-1.5 text-white/85">
          <span className="font-semibold text-white">Cena:</span>
          <span className="tnum">Ação {Math.round(playheadInsight.scene.intensity * 100)}%</span>
          <span>·</span>
          <span className="tnum">Nitidez {Math.round(playheadInsight.scene.sharpness * 100)}%</span>
          {playheadInsight.scene.cameraMotion && (
            <>
              <span>·</span>
              <span className="text-white/70">{playheadInsight.scene.cameraMotion}</span>
            </>
          )}
          {playheadInsight.scene.peakBeatDeltaMs !== null && Math.abs(playheadInsight.scene.peakBeatDeltaMs) <= 60 && (
            <span className="rounded bg-ok/25 px-1.5 py-0.5 font-semibold text-ok">Golpe na batida</span>
          )}
          {playheadInsight.scene.dominantColors.length > 0 && (
            <span className="ml-0.5 inline-flex items-center gap-1">
              {playheadInsight.scene.dominantColors.slice(0, 3).map((hex, i) => (
                <span key={`${hex}-${i}`} className="size-2.5 rounded-full border border-white/40" style={{ backgroundColor: hex }} title={hex} />
              ))}
            </span>
          )}
        </div>
      )}
      {playheadInsight.text && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-white">Leitura:</span>
          <span
            className={`tnum rounded px-1.5 py-0.5 font-semibold ${
              playheadInsight.text.readingPace === 'comfortable'
                ? 'bg-ok/25 text-ok'
                : 'bg-warn/25 text-warn'
            }`}
          >
            {playheadInsight.text.charsPerSecond} chars/s · {playheadInsight.text.wordsPerMinute} WPM
          </span>
          {playheadInsight.text.contrastStatus !== 'good' && (
            <span className="rounded bg-danger/25 px-1.5 py-0.5 font-semibold text-danger">
              {playheadInsight.text.contrastStatus === 'covers-face' ? 'Sobre rosto' : 'Baixo contraste'}
            </span>
          )}
          {playheadInsight.text.suggestion && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const res = harmonizeTextClipsWithScenes({
                  project,
                  episodes: readingInputs.episodes,
                  clipIds: [playheadInsight.text!.clipId],
                });
                if (res.commands.length) {
                  session.history.transaction('Harmonizar legenda com cena', res.commands);
                  useApp.getState().toast({ tone: 'ok', title: 'Legenda harmonizada com a cena' });
                }
              }}
              className="pointer-events-auto inline-flex items-center gap-1 rounded bg-azure px-1.5 py-0.5 font-semibold text-action-ink hover:opacity-90"
              title={playheadInsight.text.suggestion}
            >
              <Wand2 size={10} /> Corrigir leitura
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PreviewTransportBar({
  project,
  end,
  playing,
  previewScale,
  setPreviewScale,
  setPlaying,
  go,
  fullscreen,
  onToggleFullscreen,
}: {
  project: Project;
  end: number;
  playing: boolean;
  previewScale: 1 | 0.5 | 0.25;
  setPreviewScale: (s: 1 | 0.5 | 0.25) => void;
  setPlaying: (p: boolean) => void;
  go: (us: number) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const playheadUs = useEditor((s) => s.playheadUs);
  const P = project.settings;
  return (
    <div className="flex min-h-[68px] shrink-0 flex-col justify-center gap-1 border-t border-line-soft bg-panel px-3 py-1.5">
      <div className="preview-transport flex min-w-0 items-center gap-2">
        <span className="tnum w-[92px] shrink-0 font-mono text-[13px] font-semibold tracking-tight text-ink">{formatTimecode(playheadUs, P.fps)}</span>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-0.5">
          <div className="flex items-center rounded-lg border border-line-soft bg-base/80 p-0.5">
            <IconButton label="Início (Home)" onClick={() => go(0)}>
              <ChevronFirst size={17} />
            </IconButton>
            <IconButton label="Quadro anterior (←)" onClick={() => go(stepFrames(project, playheadUs, -1))}>
              <StepBack size={16} />
            </IconButton>
            <button
              type="button"
              aria-label={playing ? 'Pausar (Espaço)' : 'Reproduzir (Espaço)'}
              title={playing ? 'Pausar (Espaço)' : 'Reproduzir (Espaço)'}
              className="mx-1 grid size-9 place-items-center rounded-full bg-ink text-base hover:bg-white"
              onClick={() => setPlaying(!playing)}
            >
              {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="translate-x-px" />}
            </button>
            <IconButton label="Próximo quadro (→)" onClick={() => go(stepFrames(project, playheadUs, 1))}>
              <StepForward size={16} />
            </IconButton>
            <IconButton label="Fim (End)" onClick={() => go(end)}>
              <ChevronLast size={17} />
            </IconButton>
          </div>
        </div>
        <span className="tnum w-[92px] shrink-0 text-right font-mono text-[11px] text-muted">{formatTimecode(end, P.fps)}</span>
        <label className="hidden shrink-0 items-center justify-end gap-1.5 text-[10px] text-muted sm:flex">
          Escala
          <select
            className="h-7 rounded-md border border-line bg-base px-1.5 text-[11px] text-ink"
            value={previewScale}
            onChange={(e) => setPreviewScale(Number(e.target.value) as 1 | 0.5 | 0.25)}
            title="Resolução do preview; a exportação usa sempre a qualidade total"
          >
            <option value={1}>100%</option>
            <option value={0.5}>1/2</option>
            <option value={0.25}>1/4</option>
          </select>
        </label>
        <IconButton label={fullscreen ? 'Sair da tela cheia' : 'Ampliar prévia'} onClick={onToggleFullscreen}>
          {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </IconButton>
      </div>
      <input
        type="range"
        aria-label="Posição da prévia"
        className="h-1 w-full cursor-pointer accent-violet"
        min={0}
        max={Math.max(1, end)}
        step={Math.max(1, frameToUs(1, P.fps))}
        value={Math.min(playheadUs, end)}
        onChange={(event) => go(Number(event.currentTarget.value))}
      />
    </div>
  );
}
