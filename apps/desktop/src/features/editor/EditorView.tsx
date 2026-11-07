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
import { Timeline } from './Timeline';

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
  const [timelineH, setTimelineH] = useState(300);
  const dragRef = useRef<{ y: number; h: number } | null>(null);

  useEffect(() => bind(project.id), [bind, project.id]);
  useShortcutsOnce(session);

  // seleção nunca aponta para clipe que sumiu (undo, exclusão)
  useEffect(() => {
    const ids = new Set(project.clips.map((c) => c.id));
    if (selection.some((id) => !ids.has(id))) select(selection.filter((id) => ids.has(id)));
  }, [project.clips, selection, select]);

  return (
    <div className="flex h-full min-h-0">
      <MediaPanel session={session} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          <Preview session={session} project={project} />
          <Inspector session={session} project={project} selectedAssetId={selection.length ? null : selectedAssetId} />
        </div>
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Redimensionar timeline"
          className="h-1.5 shrink-0 cursor-row-resize bg-line-soft hover:bg-violet/50"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            dragRef.current = { y: e.clientY, h: timelineH };
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (d) setTimelineH(Math.max(TIMELINE_MIN, Math.min(window.innerHeight - 260, d.h - (e.clientY - d.y))));
          }}
          onPointerUp={() => (dragRef.current = null)}
        />
        <div className="flex shrink-0 flex-col" style={{ height: timelineH }}>
          <Timeline session={session} project={project} />
        </div>
      </div>
      <AssetDragGhost />
    </div>
  );
}

function useShortcutsOnce(session: ProjectSession) {
  useEditorShortcuts(session);
}
