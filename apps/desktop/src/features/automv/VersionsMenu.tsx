import { History } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ProjectSession } from '../../core/session';
import { useApp, useSessionVersion } from '../../store';

export function VersionsMenu({ session, onClose }: { session: ProjectSession; onClose: () => void }) {
  useSessionVersion(session);
  const { toast } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', down);
    return () => window.removeEventListener('mousedown', down);
  }, [onClose]);
  const versions = [...session.project.versions].reverse();

  const save = async () => {
    try {
      const id = await session.saveVersion(`Versão ${session.project.versions.length + 1}`);
      if (!id) toast({ tone: 'warn', title: 'A timeline está vazia', body: 'Não há nada para guardar ainda.' });
    } catch (e) {
      toast({ tone: 'error', title: 'Não deu para guardar a versão', body: (e as Error).message });
    }
  };
  const restore = async (id: string, name: string) => {
    try {
      await session.saveVersion('Antes de voltar versão');
      await session.restoreVersion(id);
      toast({ tone: 'ok', title: `Voltou para "${name}"`, body: 'Ctrl+Z desfaz.' });
      onClose();
    } catch (e) {
      toast({ tone: 'error', title: 'Não deu para voltar a versão', body: (e as Error).message });
    }
  };

  return (
    <div ref={ref} className="absolute right-0 top-10 z-40 w-72 rounded-md border border-line bg-panel p-2 shadow-xl">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-xs font-semibold text-ink-soft">Versões guardadas</span>
        <button type="button" className="text-xs text-violet-strong hover:underline" onClick={save}>
          Guardar a atual
        </button>
      </div>
      {versions.length === 0 ? (
        <p className="px-1 py-3 text-xs text-muted">Nenhuma ainda. Ao gerar um AMV, a montagem anterior é guardada aqui.</p>
      ) : (
        <ul className="max-h-72 overflow-y-auto">
          {versions.map((v) => (
            <li key={v.id}>
              <button type="button" onClick={() => restore(v.id, v.name)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-raised">
                <History size={13} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate text-xs">{v.name}</span>
                <span className="text-2xs text-faint">{new Date(v.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
