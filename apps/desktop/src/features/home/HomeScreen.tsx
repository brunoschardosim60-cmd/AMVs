import { Film, FolderOpen, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { forgetRecent, updateRecent, type RecentProject } from '../../core/recents';
import { duration, relativeDate } from '../../format';
import { useApp } from '../../store';
import { Button, IconButton, Kbd } from '../../ui/controls';

function Poster({ path, className }: { path: string | null; className: string }) {
  const platform = useApp((s) => s.platform);
  const [broken, setBroken] = useState(false);
  if (!path || broken || !platform) {
    return (
      <div className={`grid place-items-center bg-raised text-faint ${className}`}>
        <Film size={22} strokeWidth={1.5} />
      </div>
    );
  }
  return <img src={platform.fileUrl(path)} alt="" className={`object-cover ${className}`} onError={() => setBroken(true)} draggable={false} />;
}

function Meta({ r }: { r: RecentProject }) {
  const parts = [`${r.assetCount} ${r.assetCount === 1 ? 'mídia' : 'mídias'}`];
  if (r.durationUs > 0) parts.push(`timeline de ${duration(r.durationUs)}`);
  return <span className="tnum">{parts.join(', ')}</span>;
}

function RecentRow({ r }: { r: RecentProject }) {
  const { openProject, platform, refreshRecents, session } = useApp();
  const isOpen = session?.path === r.path;
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => openProject(r.path)}
        className="flex w-full items-center gap-4 rounded-panel px-3 py-2.5 text-left transition-colors hover:bg-panel"
      >
        <Poster path={r.posterPath} className="aspect-video w-28 shrink-0 rounded-md" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[15px] font-semibold">
            <span className="truncate">{r.name}</span>
            {isOpen && <span className="rounded bg-violet/15 px-1.5 py-px text-2xs font-medium text-violet-strong">aberto</span>}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted" title={r.path}>
            {r.path}
          </span>
          <span className="mt-1 block text-xs text-ink-soft">
            <Meta r={r} />
          </span>
        </span>
        <span className="w-28 shrink-0 text-right text-xs text-muted">{relativeDate(r.openedAt)}</span>
        <span className="w-[72px] shrink-0" />
      </button>
      <div className="absolute top-1/2 right-3 flex -translate-y-1/2 gap-0.5">
        <IconButton
          label={r.favorite ? 'Tirar dos favoritos' : 'Marcar como favorito'}
          aria-pressed={r.favorite}
          className={r.favorite ? 'text-warn' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'}
          onClick={async () => {
            await updateRecent(platform!, r.path, { favorite: !r.favorite });
            await refreshRecents();
          }}
        >
          <Star size={15} fill={r.favorite ? 'currentColor' : 'none'} />
        </IconButton>
        <IconButton
          label="Remover da lista (não apaga o arquivo)"
          className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          onClick={async () => {
            await forgetRecent(platform!, r.path);
            await refreshRecents();
          }}
        >
          <Trash2 size={15} />
        </IconButton>
      </div>
    </li>
  );
}

function ContinueHero({ r }: { r: RecentProject }) {
  const openProject = useApp((s) => s.openProject);
  return (
    <section className="mb-10 flex items-stretch gap-6" aria-label="Continuar de onde parou">
      <button type="button" onClick={() => openProject(r.path)} className="group relative shrink-0 overflow-hidden rounded-panel" aria-label={`Abrir ${r.name}`}>
        <Poster path={r.posterPath} className="aspect-video w-[420px] transition-transform duration-500 group-hover:scale-[1.02]" />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-violet" />
      </button>
      <div className="flex min-w-0 flex-col justify-end pb-1">
        <p className="text-sm text-muted">Continuar de onde parou</p>
        <h2 className="mt-1 truncate text-[28px] leading-tight font-semibold tracking-tight">{r.name}</h2>
        <p className="mt-2 text-sm text-ink-soft">
          <Meta r={r} />, aberto {relativeDate(r.openedAt)}
        </p>
        <div className="mt-5">
          <Button variant="primary" onClick={() => openProject(r.path)}>
            Continuar editando
          </Button>
        </div>
      </div>
    </section>
  );
}

export function HomeScreen() {
  const { recents, setNewProjectOpen, openProject } = useApp();
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [first, ...rest] = recents;
  const list = onlyFavorites ? recents.filter((r) => r.favorite) : rest;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1080px] px-10 pt-10 pb-16">
        <header className="mb-10 flex items-center justify-between">
          <h1 className="text-[15px] font-semibold text-ink-soft">Projetos</h1>
          <div className="flex gap-2">
            <Button icon={<FolderOpen size={16} />} onClick={() => openProject()}>
              Abrir projeto
            </Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setNewProjectOpen(true)}>
              Novo projeto
            </Button>
          </div>
        </header>

        {!first ? (
          <section className="max-w-[560px] pt-16">
            <h2 className="text-[32px] leading-tight font-semibold tracking-tight">Comece seu primeiro AMV</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
              Crie um projeto, importe os episódios e a música. O AMV Studio prepara versões leves dos vídeos para a edição ficar fluida, sem tocar nos
              seus arquivos originais.
            </p>
            <div className="mt-7 flex items-center gap-3">
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => setNewProjectOpen(true)}>
                Novo projeto
              </Button>
              <span className="text-xs text-muted">
                ou <Kbd>Ctrl</Kbd> <Kbd>N</Kbd>
              </span>
            </div>
          </section>
        ) : (
          <>
            {!onlyFavorites && <ContinueHero r={first} />}
            {(rest.length > 0 || onlyFavorites || recents.some((r) => r.favorite)) && (
              <section aria-label="Projetos recentes">
                <div className="mb-2 flex items-center justify-between px-3">
                  <h2 className="text-sm font-semibold text-ink-soft">{onlyFavorites ? 'Favoritos' : 'Recentes'}</h2>
                  <div className="flex gap-1 text-xs" role="tablist">
                    {[
                      ['Recentes', false],
                      ['Favoritos', true],
                    ].map(([label, fav]) => (
                      <button
                        key={String(label)}
                        type="button"
                        role="tab"
                        aria-selected={onlyFavorites === fav}
                        onClick={() => setOnlyFavorites(fav as boolean)}
                        className={`rounded-control px-2.5 py-1 ${onlyFavorites === fav ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {list.length ? (
                  <ul>
                    {list.map((r) => (
                      <RecentRow key={r.path} r={r} />
                    ))}
                  </ul>
                ) : (
                  <p className="px-3 py-6 text-sm text-muted">
                    {onlyFavorites ? 'Nenhum favorito. Passe o mouse num projeto e clique na estrela.' : 'Os outros projetos que você abrir aparecem aqui.'}
                  </p>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
