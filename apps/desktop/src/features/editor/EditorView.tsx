import {
  copyClips,
  deleteClips,
  duplicateClips,
  pasteClips,
  projectDurationUs,
  splitAllAt,
  type Command,
} from '@amv/project';
import { useEffect, useRef, useState } from 'react';
import type { ProjectSession } from '../../core/session';
import { useApp, useSessionVersion } from '../../store';
import { ignoreEditorKey, useEditor } from './editorStore';
import { Inspector } from './Inspector';
import { AssetDragGhost, MediaPanel } from './MediaPanel';
import { Preview, getPlayer, stepFrames } from './Preview';
import { Timeline, TRACK_H } from './Timeline';
import { clampTimelineHeight } from './editorLayout';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { IconButton } from '../../ui/controls';
import { CompareDialog } from './CompareDialog';
import { Columns2 } from 'lucide-react';

const TIMELINE_MIN = 160;

function useEditorShortcuts(session: ProjectSession) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignoreEditorKey(e)) return;
      const ed = useEditor.getState();
      const app = useApp.getState();
      const p = session.project;
      const mod = e.ctrlKey || e.metaKey;
      const run = (label: string, cmds: Command[]) => {
        if (!cmds.length) return;
        try {
          session.history.transaction(label, cmds);
        } catch (err) {
          app.toast({ tone: 'warn', title: 'Não deu para fazer isso', body: (err as Error).message });
        }
      };
      const seek = (us: number) => {
        ed.setPlayhead(us);
        getPlayer(session).seek(us);
      };

      switch (true) {
        case e.key === ' ': {
          e.preventDefault();
          ed.setPlaying(!ed.playing);
          break;
        }
        case !mod && e.key.toLowerCase() === 's': {
          e.preventDefault();
          // divide os selecionados no playhead; sem seleção, divide tudo que passa por ali
          const only = ed.selection.length ? ed.selection : undefined;
          run('Dividir', splitAllAt(p, ed.playheadUs, only));
          break;
        }
        case e.key === 'Delete' || e.key === 'Backspace': {
          if (!ed.selection.length) return;
          e.preventDefault();
          run(e.shiftKey ? 'Excluir e fechar buraco' : 'Excluir', deleteClips(p, ed.selection, e.shiftKey));
          ed.select([]);
          break;
        }
        case mod && e.key.toLowerCase() === 'c': {
          if (!ed.selection.length) return;
          e.preventDefault();
          ed.setClipboard(copyClips(p, ed.selection));
          app.toast({ tone: 'info', title: ed.selection.length === 1 ? 'Clipe copiado' : `${ed.selection.length} clipes copiados` });
          break;
        }
        case mod && e.key.toLowerCase() === 'x': {
          if (!ed.selection.length) return;
          e.preventDefault();
          ed.setClipboard(copyClips(p, ed.selection));
          run('Recortar', deleteClips(p, ed.selection));
          ed.select([]);
          break;
        }
        case mod && e.key.toLowerCase() === 'v': {
          if (!ed.clipboard) return;
          e.preventDefault();
          const { commands, newIds } = pasteClips(p, ed.clipboard, ed.playheadUs);
          run('Colar', commands);
          ed.select(newIds);
          break;
        }
        case mod && e.key.toLowerCase() === 'd': {
          if (!ed.selection.length) return;
          e.preventDefault();
          const { commands, newIds } = duplicateClips(p, ed.selection);
          run('Duplicar', commands);
          ed.select(newIds);
          break;
        }
        case mod && e.key.toLowerCase() === 'a': {
          e.preventDefault();
          ed.select(p.clips.map((c) => c.id));
          break;
        }
        case e.key === 'ArrowLeft' || e.key === 'ArrowRight': {
          e.preventDefault();
          const dir = e.key === 'ArrowLeft' ? -1 : 1;
          ed.setPlaying(false);
          seek(stepFrames(p, ed.playheadUs, dir * (e.shiftKey ? 10 : 1)));
          break;
        }
        case e.key === 'Home': {
          e.preventDefault();
          seek(0);
          break;
        }
        case e.key === 'End': {
          e.preventDefault();
          seek(projectDurationUs(p));
          break;
        }
        case e.key === '+' || e.key === '=': {
          ed.setZoom(ed.zoom * 1.4);
          break;
        }
        case e.key === '-': {
          ed.setZoom(ed.zoom / 1.4);
          break;
        }
        case e.key === 'Escape': {
          ed.select([]);
          break;
        }
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);
}

export function EditorView({ session }: { session: ProjectSession }) {
  useSessionVersion(session);
  const project = session.project;
  const selectedAssetId = useApp((s) => s.selectedAssetId);
  const bind = useEditor((s) => s.bind);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  // altura inicial: cabem todas as trilhas (sem esconder "Efeitos" atrás de rolagem), até ~56% da janela
  const [timelineH, setTimelineH] = useState(() => {
    const need = project.tracks.reduce((a, t) => a + TRACK_H[t.kind], 0) + 76; // + barra de ferramentas e régua
    return Math.round(Math.max(TIMELINE_MIN, Math.min(need, (window.innerHeight - 90) * 0.56)));
  });
  const dragRef = useRef<{ y: number; h: number } | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [showMedia, setShowMedia] = useState(() => window.innerWidth > 1100);
  const [showInspector, setShowInspector] = useState(() => window.innerWidth > 1100);
  const [comparing, setComparing] = useState(false);
  const compareClip = selection.length === 1 ? project.clips.find((c) => c.id === selection[0]) : undefined;
  const compareTrack = project.tracks.find((t) => t.id === compareClip?.trackId);

  useEffect(() => {
    const compact = window.matchMedia('(max-width: 1100px)');
    const resizePanels = () => {
      setShowMedia(!compact.matches);
      setShowInspector(!compact.matches);
    };
    compact.addEventListener('change', resizePanels);
    return () => compact.removeEventListener('change', resizePanels);
  }, []);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setTimelineH((height) => clampTimelineHeight(height, entry.contentRect.height));
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  useEffect(() => bind(project.id), [bind, project.id]);
  useShortcutsOnce(session);

  // seleção nunca aponta para clipe que sumiu (undo, exclusão)
  useEffect(() => {
    const ids = new Set(project.clips.map((c) => c.id));
    if (selection.some((id) => !ids.has(id))) select(selection.filter((id) => ids.has(id)));
  }, [project.clips, selection, select]);

  return (
    <div ref={workspaceRef} className="editor-workspace flex h-full min-h-0 min-w-0">
      {showMedia && <MediaPanel session={session} />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-line-soft bg-panel px-2">
          <IconButton label={showMedia ? 'Recolher biblioteca' : 'Abrir biblioteca'} aria-pressed={showMedia} onClick={() => { setShowMedia((value) => !value); if (window.innerWidth <= 1100) setShowInspector(false); }}>
            {showMedia ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </IconButton>
          <span className="min-w-0 truncate px-2 text-2xs font-semibold text-muted">{project.name}</span>
          <IconButton label="Comparar trecho" disabled={!compareClip || compareTrack?.kind !== 'video' || compareTrack.locked} onClick={() => { useEditor.getState().setPlaying(false); setComparing(true); }}><Columns2 size={16} /></IconButton>
          <IconButton label={showInspector ? 'Recolher propriedades' : 'Abrir propriedades'} aria-pressed={showInspector} onClick={() => { setShowInspector((value) => !value); if (window.innerWidth <= 1100) setShowMedia(false); }}>
            {showInspector ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </IconButton>
        </div>
        <div className="editor-upper flex min-h-0 flex-1">
          <Preview session={session} project={project} />
          {showInspector && <Inspector session={session} project={project} selectedAssetId={selection.length ? null : selectedAssetId} />}
        </div>
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Redimensionar timeline"
          tabIndex={0}
          aria-valuenow={timelineH}
          aria-valuemin={96}
          aria-valuemax={workspaceRef.current?.clientHeight ?? timelineH}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault();
            setTimelineH((height) => clampTimelineHeight(height + (e.key === 'ArrowUp' ? 24 : -24), workspaceRef.current?.clientHeight ?? window.innerHeight));
          }}
          className="editor-resize-grip h-1.5 shrink-0 cursor-row-resize"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            dragRef.current = { y: e.clientY, h: timelineH };
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (d) setTimelineH(clampTimelineHeight(d.h - (e.clientY - d.y), workspaceRef.current?.clientHeight ?? window.innerHeight));
          }}
          onPointerUp={() => (dragRef.current = null)}
          onPointerCancel={() => (dragRef.current = null)}
          onLostPointerCapture={() => (dragRef.current = null)}
        />
        <div className="editor-timeline flex shrink-0 flex-col" style={{ height: timelineH }}>
          <Timeline session={session} project={project} />
        </div>
      </div>
      <AssetDragGhost />
      {comparing && compareClip && <CompareDialog session={session} clip={compareClip} onClose={() => setComparing(false)} />}
    </div>
  );
}

function useShortcutsOnce(session: ProjectSession) {
  useEditorShortcuts(session);
}
