import { clipEndUs, evaluateKeyframes, formatTimecode, frameToUs, projectDurationUs, upsertKeyframe, usToFrame, type Clip, type Project } from '@amv/project';
import { ChevronFirst, ChevronLast, Pause, Play, StepBack, StepForward } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ProjectSession } from '../../core/session';
import { useApp } from '../../store';
import { IconButton } from '../../ui/controls';
import { useEditor } from './editorStore';
import { Player } from './player';

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

export function createPlayer(session: ProjectSession, project: Project): Player {
  const platform = useApp.getState().platform!;
  return new Player(project, {
    videoUrl: (id) => {
      const path = session.assetRuntime(id).artifacts?.proxyPath;
      return path ? platform.fileUrl(path) : null;
    },
    audioUrl: (id) => {
      const asset = session.project.assets.find((a) => a.id === id);
      if (!asset || asset.status === 'missing') return null;
      const art = session.assetRuntime(id).artifacts;
      if (asset.kind === 'video') return art?.proxyPath ? platform.fileUrl(art.proxyPath) : null;
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

export function Preview({ session, project }: { session: ProjectSession; project: Project }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const { playheadUs, setPlayhead, playing, setPlaying, previewScale, setPreviewScale, selection } = useEditor();
  const player = getPlayer(session);
  const P = project.settings;
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [draftTransform, setDraftTransform] = useState<{ x: number; y: number; scale: number } | null>(null);
  const manipulation = useRef<{ clip: Clip; action: 'move' | 'resize'; pointerId: number; startX: number; startY: number; x: number; y: number; scale: number; width: number; height: number } | null>(null);

  // liga o canvas ao player
  useEffect(() => {
    const cv = canvasRef.current!;
    const offAudioError = player.onAudioError((error) => {
      useApp.getState().toast({ tone: 'warn', title: 'Áudio do preview indisponível', body: error.message });
    });
    player.attach(cv);
    const offTime = player.onTime((us) => {
      if (player.isPlaying) useEditor.getState().setPlayhead(us);
    });
    const offEnd = player.onEnded(() => useEditor.getState().setPlaying(false));
    return () => {
      offTime();
      offEnd();
      offAudioError();
      player.pause();
      player.detach();
    };
  }, [player]);

  useEffect(() => player.setProject(project), [player, project]);

  // playhead mudou por fora (scrub, teclas): reposiciona o player
  useEffect(() => {
    if (!player.isPlaying || Math.abs(player.timeUs - playheadUs) > 250_000) player.seek(playheadUs);
  }, [player, playheadUs]);

  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [player, playing]);

  // tamanho na tela: cabe na caixa mantendo a proporção do projeto (vertical, quadrado, 16:9)
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
      setFrameSize({ width, height });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [P.width, P.height]);

  // resolução interna do canvas = projeto × escala do preview
  useEffect(() => {
    const cv = canvasRef.current!;
    cv.width = Math.round(P.width * previewScale);
    cv.height = Math.round(P.height * previewScale);
  }, [P.width, P.height, previewScale]);

  const end = projectDurationUs(project);
  const go = (us: number) => {
    setPlayhead(us);
    player.seek(us);
  };
  const selectedClip = selection.length === 1 ? project.clips.find((clip) => clip.id === selection[0]) : undefined;
  const selectedTrack = selectedClip && project.tracks.find((track) => track.id === selectedClip.trackId);
  const selectedAsset = selectedClip?.assetId ? project.assets.find((asset) => asset.id === selectedClip.assetId) : undefined;
  const canManipulate = !!selectedClip && !!selectedTrack && selectedTrack.kind !== 'audio' && !selectedTrack.hidden &&
    playheadUs >= selectedClip.timelineStartUs && playheadUs < clipEndUs(selectedClip);
  let handleBox: { left: number; top: number; width: number; height: number; rotation: number; x: number; y: number; scale: number } | null = null;
  if (canManipulate && selectedClip && frameSize.width > 0) {
    const localUs = Math.max(0, playheadUs - selectedClip.timelineStartUs);
    const x = draftTransform?.x ?? evaluateKeyframes(selectedClip.keyframes['transform.x'], localUs, selectedClip.transform.x);
    const y = draftTransform?.y ?? evaluateKeyframes(selectedClip.keyframes['transform.y'], localUs, selectedClip.transform.y);
    const scale = draftTransform?.scale ?? evaluateKeyframes(selectedClip.keyframes['transform.scale'], localUs, selectedClip.transform.scale);
    const pixelScale = frameSize.width / P.width;
    const crop = selectedClip.transform.crop;
    const sourceWidth = selectedClip.text ? P.width * 0.8 : selectedAsset?.probe?.video?.width ?? P.width;
    const sourceHeight = selectedClip.text ? P.height * 0.18 : selectedAsset?.probe?.video?.height ?? P.height;
    const cropWidth = sourceWidth * (1 - crop.left - crop.right);
    const cropHeight = sourceHeight * (1 - crop.top - crop.bottom);
    const fit = selectedClip.text ? 1 : Math.min(P.width / cropWidth, P.height / cropHeight);
    const width = cropWidth * fit * scale * pixelScale;
    const height = cropHeight * fit * scale * pixelScale;
    handleBox = {
      left: (P.width / 2 + x) * pixelScale - width / 2,
      top: (P.height / 2 + y) * pixelScale - height / 2,
      width,
      height,
      rotation: evaluateKeyframes(selectedClip.keyframes['transform.rotation'], localUs, selectedClip.transform.rotation),
      x,
      y,
      scale,
    };
  }
  const startManipulation = (event: ReactPointerEvent<HTMLElement>, action: 'move' | 'resize') => {
    if (!selectedClip || !handleBox || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    manipulation.current = {
      clip: selectedClip,
      action,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: handleBox.x,
      y: handleBox.y,
      scale: handleBox.scale,
      width: handleBox.width,
      height: handleBox.height,
    };
    setDraftTransform({ x: handleBox.x, y: handleBox.y, scale: handleBox.scale });
  };
  const moveManipulation = (event: ReactPointerEvent<HTMLElement>) => {
    const current = manipulation.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    const frameScale = frameSize.width / P.width;
    if (current.action === 'move') {
      setDraftTransform({ x: current.x + dx / frameScale, y: current.y + dy / frameScale, scale: current.scale });
    } else {
      const oldLength = Math.hypot(current.width, current.height);
      const newLength = Math.hypot(current.width + dx, current.height + dy);
      setDraftTransform({ x: current.x, y: current.y, scale: Math.max(0.01, current.scale * newLength / oldLength) });
    }
  };
  const finishManipulation = (event: ReactPointerEvent<HTMLElement>) => {
    const current = manipulation.current;
    const draft = draftTransform;
    manipulation.current = null;
    setDraftTransform(null);
    if (!current || current.pointerId !== event.pointerId || !draft) return;
    const clip = current.clip;
    const localUs = Math.max(0, Math.min(clip.durationUs, playheadUs - clip.timelineStartUs));
    const transform = { ...clip.transform };
    const keyframes = { ...clip.keyframes };
    for (const property of ['x', 'y', 'scale'] as const) {
      const path = `transform.${property}`;
      const value = property === 'x' ? draft.x : property === 'y' ? draft.y : draft.scale;
      if (keyframes[path]?.length) keyframes[path] = upsertKeyframe(keyframes[path], localUs, value);
      else transform[property] = value;
    }
    session.history.transaction(current.action === 'move' ? 'Mover camada no preview' : 'Redimensionar camada no preview', [
      { type: 'clip.update', clipId: clip.id, patch: { transform, keyframes } },
    ]);
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Pré-visualização">
      <div ref={boxRef} className="grid min-h-0 flex-1 place-items-center overflow-hidden bg-[#0e0f12] p-3">
        <div ref={frameRef} className="relative shrink-0">
          <canvas
            ref={canvasRef}
            className="bg-black shadow-lg shadow-black/40"
            onClick={() => setPlaying(!playing)}
          />
          {handleBox && (
            <div
              className="absolute border border-azure shadow-[0_0_0_1px_rgba(0,0,0,0.65)]"
              style={{ left: handleBox.left, top: handleBox.top, width: handleBox.width, height: handleBox.height, transform: `rotate(${handleBox.rotation}deg)`, cursor: 'move', touchAction: 'none' }}
              title="Arraste para mover a camada; use a alça para redimensionar"
              onPointerDown={(event) => startManipulation(event, 'move')}
              onPointerMove={moveManipulation}
              onPointerUp={finishManipulation}
              onPointerCancel={finishManipulation}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                aria-label="Redimensionar camada selecionada"
                className="absolute -right-2 -bottom-2 size-4 rounded-full border-2 border-base bg-azure shadow"
                style={{ touchAction: 'none' }}
                onPointerDown={(event) => startManipulation(event, 'resize')}
                onPointerMove={moveManipulation}
                onPointerUp={finishManipulation}
                onPointerCancel={finishManipulation}
                onClick={(event) => event.stopPropagation()}
              />
            </div>
          )}
        </div>
      </div>
      <div className="flex h-11 shrink-0 items-center gap-1 border-t border-line-soft bg-panel px-3">
        <span className="tnum w-28 text-sm text-ink">{formatTimecode(playheadUs, P.fps)}</span>
        <div className="flex flex-1 items-center justify-center gap-0.5">
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
        <label className="flex w-28 items-center justify-end gap-1.5 text-xs text-muted">
          Qualidade
          <select
            className="rounded border border-line bg-base px-1 py-0.5 text-xs text-ink"
            value={previewScale}
            onChange={(e) => setPreviewScale(Number(e.target.value) as 1 | 0.5 | 0.25)}
            title="Só o preview; a exportação usa sempre a qualidade total"
          >
            <option value={1}>Total</option>
            <option value={0.5}>1/2</option>
            <option value={0.25}>1/4</option>
          </select>
        </label>
      </div>
    </section>
  );
}
