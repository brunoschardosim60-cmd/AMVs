import { isSfxAsset, type Asset } from '@amv/project';
import { AudioLines, Film, Image as ImageIcon, LibraryBig, Plus } from 'lucide-react';
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
    <aside className="editor-side-panel flex w-[250px] shrink-0 flex-col border-r border-line" aria-label="Mídia do projeto">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line-soft px-3">
        <LibraryBig size={15} className="text-violet-strong" />
        <span className="text-xs font-semibold tracking-wide text-ink">Biblioteca</span>
        <span className="ml-auto rounded-full border border-line-soft bg-base px-1.5 py-0.5 text-[10px] text-muted">{assets.length}</span>
      </div>
      <div className="flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto px-2" role="tablist">
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
            className={`shrink-0 rounded-md px-2 py-1.5 text-[11px] transition-colors ${tab === k ? 'bg-raised font-semibold text-ink shadow-sm' : 'text-muted hover:bg-raised/50 hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'media' && (
        // fora da linha de abas: lá ele era empurrado para além dos 248 px do painel e ficava atrás do preview
        <div className="shrink-0 px-3 py-2">
          <Button size="sm" variant="secondary" className="w-full justify-start border-line-soft bg-base" icon={<Plus size={14} />} onClick={() => importMedia()}>
            Importar episódios e músicas
          </Button>
        </div>
      )}
      {tab === 'subs' ? <SubtitlesPanel session={session} /> : tab === 'scenes' ? <ScenesPanel session={session} /> : tab === 'lines' ? <LinesPanel session={session} /> : assets.length === 0 ? (
        <div className="mx-3 mt-2 rounded-lg border border-dashed border-line bg-base/60 px-3 py-4">
          <Film size={17} className="mb-2 text-faint" />
          <p className="text-xs font-medium text-ink-soft">Sua biblioteca está vazia</p>
          <p className="mt-1 text-2xs leading-relaxed text-muted">Importe episódios e músicas. Depois, arraste um item para a timeline.</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
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
                  className={`group flex cursor-grab items-center gap-2 rounded-lg border px-1.5 py-1.5 transition-colors active:cursor-grabbing ${sel ? 'border-violet/35 bg-violet/10' : 'border-transparent hover:border-line-soft hover:bg-raised/70'} ${a.status === 'missing' ? 'opacity-55' : ''}`}
                >
                  {poster && a.status !== 'missing' ? (
                    <img src={platform!.fileUrl(poster)} alt="" draggable={false} className="h-9 w-14 shrink-0 rounded-md bg-black object-cover" />
                  ) : (
                    <span className={`grid h-9 w-14 shrink-0 place-items-center rounded-md ${a.kind === 'audio' ? 'bg-azure-deep/70 text-azure' : 'bg-raised text-faint'}`}>
                      <Icon size={14} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-ink" title={a.name}>{a.name}</span>
                    <span className={`tnum block truncate text-[10px] ${a.status === 'missing' ? 'text-warn' : a.status === 'processing' ? 'text-azure' : 'text-muted'}`}>
                      {a.status === 'processing' ? 'Processando mídia…' : a.status === 'missing' ? 'Arquivo não encontrado' : a.kind === 'image' ? 'Imagem' : a.probe ? duration(a.probe.durationUs) : 'Aguardando análise'}
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
