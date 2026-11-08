import { isSfxAsset, type Asset } from '@amv/project';
import { AudioLines, Film, Image as ImageIcon, Plus } from 'lucide-react';
import { useEffect, useState, type PointerEvent as RPointerEvent } from 'react';
import type { ProjectSession } from '../../core/session';
import { duration } from '../../format';
import { useApp } from '../../store';
import { Button } from '../../ui/controls';
import { useEditor } from './editorStore';
import { LinesPanel, ScenesPanel } from './MomentsPanel';
import { SubtitlesPanel } from './SubtitlesPanel';

const ICON = { video: Film, audio: AudioLines, image: ImageIcon };

/** Biblioteca compacta do editor: arraste um item para a timeline. */
export function MediaPanel({ session }: { session: ProjectSession }) {
  const { platform, importMedia, selectedAssetId, selectAsset } = useApp();
  const setAssetDrag = useEditor((s) => s.setAssetDrag);
  const select = useEditor((s) => s.select);
  const assets = session.project.assets.filter((a) => !isSfxAsset(a));
  const [tab, setTab] = useState<'media' | 'scenes' | 'lines' | 'subs'>('media');

  const startDrag = (e: RPointerEvent, a: Asset) => {
    if (e.button !== 0) return;
    e.preventDefault(); // não seleciona texto durante o arrasto
    selectAsset(a.id);
    select([]);
    if (a.status === 'missing') return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return;
      window.removeEventListener('pointermove', onMove);
      setAssetDrag({ assetId: a.id, label: a.name, x: ev.clientX, y: ev.clientY });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', onMove), { once: true });
  };

  return (
    <aside className="flex w-[248px] shrink-0 flex-col border-r border-line bg-panel" aria-label="Mídia do projeto">
      <div className="flex h-10 shrink-0 items-center gap-0.5 px-2" role="tablist">
        {(
          [
            ['media', 'Mídia'],
            ['scenes', 'Cenas'],
            ['lines', 'Falas'],
            ['subs', 'Legendas'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-control px-2 py-1 text-xs ${tab === k ? 'bg-raised font-semibold text-ink' : 'text-muted hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'media' && (
        // fora da linha de abas: lá ele era empurrado para além dos 248 px do painel e ficava atrás do preview
        <div className="shrink-0 px-2 pb-2">
          <Button size="sm" variant="ghost" className="w-full border border-line" icon={<Plus size={14} />} onClick={() => importMedia()}>
            Importar episódios e músicas
          </Button>
        </div>
      )}
      {tab === 'subs' ? <SubtitlesPanel session={session} /> : tab === 'scenes' ? <ScenesPanel session={session} /> : tab === 'lines' ? <LinesPanel session={session} /> : assets.length === 0 ? (
        <p className="px-3 text-xs leading-relaxed text-muted">Importe episódios e músicas. Depois arraste para a timeline.</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {assets.map((a) => {
            const Icon = ICON[a.kind];
            const poster = session.assetRuntime(a.id).artifacts?.posterPath;
            const sel = a.id === selectedAssetId;
            return (
              <li key={a.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onPointerDown={(e) => startDrag(e, a)}
                  onKeyDown={(e) => e.key === 'Enter' && selectAsset(a.id)}
                  title={a.status === 'missing' ? `${a.name} — arquivo não encontrado` : `${a.name} — arraste para a timeline`}
                  className={`flex cursor-grab items-center gap-2 rounded-md px-1.5 py-1 active:cursor-grabbing ${sel ? 'bg-violet/15' : 'hover:bg-raised'} ${a.status === 'missing' ? 'opacity-50' : ''}`}
                >
                  {poster && a.status !== 'missing' ? (
                    <img src={platform!.fileUrl(poster)} alt="" draggable={false} className="h-8 w-14 shrink-0 rounded-[3px] bg-black object-cover" />
                  ) : (
                    <span className={`grid h-8 w-14 shrink-0 place-items-center rounded-[3px] ${a.kind === 'audio' ? 'bg-azure-deep text-azure' : 'bg-raised text-faint'}`}>
                      <Icon size={14} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-ink">{a.name}</span>
                    <span className="tnum block text-2xs text-muted">
                      {a.status === 'processing' ? 'preparando…' : a.status === 'missing' ? 'não encontrada' : a.kind === 'image' ? 'imagem' : a.probe ? duration(a.probe.durationUs) : ''}
                    </span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

/** Etiqueta que segue o cursor enquanto se arrasta mídia. */
export function AssetDragGhost() {
  const drag = useEditor((s) => s.assetDrag);
  const setAssetDrag = useEditor((s) => s.setAssetDrag);
  if (!drag) return null;
  return <Ghost key={drag.assetId} label={drag.label} onDone={() => setAssetDrag(null)} start={{ x: drag.x, y: drag.y }} />;
}


function Ghost({ label, start }: { label: string; start: { x: number; y: number }; onDone: () => void }) {
  const [pos, setPos] = useState(start);
  useEffect(() => {
    const m = (e: PointerEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', m);
    return () => window.removeEventListener('pointermove', m);
  }, []);
  return (
    <div className="pointer-events-none fixed z-50 rounded-md border border-violet bg-panel px-2 py-1 text-xs shadow-lg" style={{ left: pos.x + 12, top: pos.y + 12 }}>
      {label}
    </div>
  );
}
