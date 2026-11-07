import { formatTimecode, frameToUs, projectDurationUs, usToFrame, type Project } from '@amv/project';
import { ChevronFirst, ChevronLast, Pause, Play, StepBack, StepForward } from 'lucide-react';
import { useEffect, useRef } from 'react';
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
    const platform = useApp.getState().platform!;
    p = new Player(session.project, {
      videoUrl: (id) => {
        const path = session.assetRuntime(id).artifacts?.proxyPath;
        return path ? platform.fileUrl(path) : null;
      },
      audioUrl: (id) => {
        const asset = session.project.assets.find((a) => a.id === id);
        if (!asset || asset.status === 'missing') return null;
        const art = session.assetRuntime(id).artifacts;
        // vídeo na trilha de áudio: usa o áudio do proxy (AAC, sempre tocável)
        if (asset.kind === 'video') return art?.proxyPath ? platform.fileUrl(art.proxyPath) : null;
        return platform.fileUrl(art?.audioProxyPath ?? asset.path);
      },
      imageUrl: (id) => {
        const asset = session.project.assets.find((a) => a.id === id);
        return asset && asset.status !== 'missing' ? platform.fileUrl(asset.path) : null;
      },
    });
    players.set(session, p);
  }
  return p;
}

export function stepFrames(project: Project, us: number, n: number): number {
  const f = usToFrame(us, project.settings.fps) + n;
  return Math.max(0, frameToUs(f, project.settings.fps));
}

export function Preview({ session, project }: { session: ProjectSession; project: Project }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const { playheadUs, setPlayhead, playing, setPlaying, previewScale, setPreviewScale } = useEditor();
  const player = getPlayer(session);
  const P = project.settings;

  // liga o canvas ao player
  useEffect(() => {
    const cv = canvasRef.current!;
    player.attach(cv);
    const offTime = player.onTime((us) => {
      if (player.isPlaying) useEditor.getState().setPlayhead(us);
    });
    const offEnd = player.onEnded(() => useEditor.getState().setPlaying(false));
    return () => {
      offTime();
      offEnd();
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
      cv.style.width = `${Math.floor(P.width * s)}px`;
      cv.style.height = `${Math.floor(P.height * s)}px`;
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

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Pré-visualização">
      <div ref={boxRef} className="grid min-h-0 flex-1 place-items-center overflow-hidden bg-[#0e0f12] p-3">
        <canvas
          ref={canvasRef}
          className="bg-black shadow-lg shadow-black/40"
          onClick={() => setPlaying(!playing)}
        />
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
