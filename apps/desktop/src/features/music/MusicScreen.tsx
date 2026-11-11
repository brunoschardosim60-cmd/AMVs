import { insertAsset } from '@amv/project';
import {
  displayTitle,
  EMOTIONS,
  filterTracks,
  recommend,
  sortTracks,
  THEMES,
  type LibraryTrack,
  type SortKey,
  type ThemeId,
  type TrackFilter,
} from '@amv/music';
import type { MusicAnalysis } from '@amv/analysis';
import { AlertTriangle, FolderPlus, Heart, ListMusic, Loader2, Music2, Pause, Play, Plus, Search, Sparkles, Star, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApp, useLibraryVersion } from '../../store';
import { Button } from '../../ui/controls';
import { usePlayer } from './player';

type View = { kind: 'all' } | { kind: 'favorites' } | { kind: 'recommend' } | { kind: 'playlist'; id: string };

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const SECTION_PT: Record<string, string> = { intro: 'intro', verse: 'verso', build: 'subida', chorus: 'refrão', drop: 'drop', bridge: 'ponte', outro: 'final' };

export function MusicScreen() {
  const { platform, library, toast, session } = useApp();
  useLibraryVersion(library);
  const player = usePlayer();
  const [view, setView] = useState<View>({ kind: 'all' });
  const [filter, setFilter] = useState<TrackFilter>({});
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'added', desc: true });
  const [selected, setSelected] = useState<string[]>([]);
  const [theme, setTheme] = useState<ThemeId>('motivacao');
  const [busy, setBusy] = useState(false);
  const [newPl, setNewPl] = useState<string | null>(null);

  const lib = library?.lib;
  const tracks = useMemo(() => {
    if (!lib) return [];
    const f: TrackFilter = { ...filter, favorites: view.kind === 'favorites' || filter.favorites, playlistId: view.kind === 'playlist' ? view.id : null };
    const list = filterTracks(lib, f);
    if (view.kind === 'playlist') {
      const order = lib.playlists.find((p) => p.id === view.id)?.trackIds ?? [];
      return [...list].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    }
    return sortTracks(list, sort.key, sort.desc);
  }, [lib, filter, view, sort, library?.changes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!library || !lib || !platform) return null;

  const add = async (folder: boolean) => {
    const paths = folder ? [await platform.dialogs.pickFolder('Pasta de músicas')].filter((x): x is string => !!x) : ((await platform.dialogs.pickMedia()) ?? []);
    if (!paths.length) return;
    setBusy(true);
    try {
      const r = await library.add(paths);
      toast({
        tone: r.added ? 'ok' : 'info',
        title: r.added ? `${r.added} música(s) na biblioteca` : 'Nenhuma música nova',
        body: [r.duplicates && `${r.duplicates} já estavam`, r.skipped && `${r.skipped} ignorado(s) (não é áudio)`, r.added && 'Analisando BPM, energia e drop…'].filter(Boolean).join(' · ') || undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const useInProject = async (t: LibraryTrack) => {
    if (!session) {
      toast({ tone: 'info', title: 'Abra ou crie um projeto primeiro', body: 'A música entra na trilha de música do projeto aberto.' });
      return;
    }
    try {
      await session.importFiles([t.path]);
      const asset = session.project.assets.find((a) => a.hash === t.hash);
      if (!asset) throw new Error('não foi possível importar o arquivo');
      const musicTrack = session.project.tracks.find((x) => x.role === 'music');
      const empty = musicTrack && !session.project.clips.some((c) => c.trackId === musicTrack.id);
      if (musicTrack && empty) session.history.transaction(`Usar ${t.name}`, insertAsset(session.project, { assetId: asset.id, trackId: musicTrack.id, startUs: 0 }));
      library.markUsed(t.id, session.project.name);
      toast({ tone: 'ok', title: `"${displayTitle(t)}" no projeto`, body: empty ? 'Entrou na trilha de música. Use "Gerar meu AMV" para montar em cima dela.' : 'Está na mídia do projeto (a trilha de música já tinha outra).' });
    } catch (e) {
      toast({ tone: 'error', title: 'Não deu para usar no projeto', body: (e as Error).message });
    }
  };

  const recs = view.kind === 'recommend' ? recommend(lib, theme, { limit: 20 }) : [];
  const detail = selected.length === 1 ? library.track(selected[0]!) : undefined;
  const compare = selected.length >= 2 && selected.length <= 4 ? selected.map((id) => library.track(id)!).filter((t) => t?.summary) : [];
  const pickRow = (id: string, multi: boolean) => setSelected((s) => (multi ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]));
  const playList = (t: LibraryTrack, list: LibraryTrack[]) => (player.trackId === t.id ? player.toggle() : player.play(t.id, list.map((x) => x.id)));
  const analyzing = lib.tracks.filter((t) => t.status === 'analyzing').length;

  const SortHead = ({ k, label, className = '' }: { k: SortKey; label: string; className?: string }) => (
    <button type="button" className={`text-left uppercase hover:text-ink ${sort.key === k ? 'text-ink' : ''} ${className}`} onClick={() => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : k !== 'title' && k !== 'artist' }))}>
      {label}
      {sort.key === k ? (sort.desc ? ' ↓' : ' ↑') : ''}
    </button>
  );

  return (
    <div className="music-library flex h-full min-h-0">
      {/* coleções */}
      <aside className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-line bg-panel/80 p-3">
        <p className="px-2 pt-1 pb-2 text-sm font-semibold">Músicas</p>
        {(
          [
            [{ kind: 'all' }, 'Biblioteca', Music2, lib.tracks.length],
            [{ kind: 'favorites' }, 'Favoritas', Heart, lib.tracks.filter((t) => t.favorite).length],
            [{ kind: 'recommend' }, 'Recomendadas', Sparkles, null],
          ] as const
        ).map(([v, label, Icon, n]) => (
          <button key={label} type="button" onClick={() => setView(v)} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${view.kind === v.kind ? 'bg-raised text-ink' : 'text-ink-soft hover:bg-raised/60'}`}>
            <Icon size={14} />
            <span className="flex-1">{label}</span>
            {n !== null && <span className="tnum text-2xs text-faint">{n}</span>}
          </button>
        ))}
        <div className="mt-3 flex items-center justify-between px-2 text-2xs font-semibold tracking-wide text-muted uppercase">
          Playlists
          <button type="button" aria-label="Nova playlist" className="rounded p-0.5 hover:bg-raised hover:text-ink" onClick={() => setNewPl('')}>
            <Plus size={13} />
          </button>
        </div>
        {newPl !== null && (
          <input
            autoFocus
            className="mx-1 h-7 rounded border border-violet bg-base px-2 text-xs outline-none"
            placeholder="Nome da playlist"
            value={newPl}
            onChange={(e) => setNewPl(e.target.value)}
            onBlur={() => setNewPl(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const p = library.createPlaylist(newPl, selected);
                setNewPl(null);
                setView({ kind: 'playlist', id: p.id });
              }
              if (e.key === 'Escape') setNewPl(null);
            }}
          />
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {lib.playlists.map((p) => (
            <div key={p.id} className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${view.kind === 'playlist' && view.id === p.id ? 'bg-raised text-ink' : 'text-ink-soft hover:bg-raised/60'}`}>
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setView({ kind: 'playlist', id: p.id })}>
                <ListMusic size={14} className="shrink-0" />
                <span className="truncate">{p.name}</span>
              </button>
              <span className="tnum text-2xs text-faint group-hover:hidden">{p.trackIds.length}</span>
              <button type="button" aria-label="Apagar playlist" className="hidden text-muted hover:text-danger group-hover:block" onClick={() => library.deletePlaylist(p.id)}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {!lib.playlists.length && newPl === null && <p className="px-2 py-1 text-2xs text-faint">Selecione músicas e crie uma playlist com +.</p>}
        </div>
      </aside>

      {/* lista */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2">
          {view.kind === 'recommend' ? (
            <div className="flex flex-wrap gap-1">
              {THEMES.map((t) => (
                <button key={t.id} type="button" title={t.description} onClick={() => setTheme(t.id)} className={`rounded-full border px-3 py-1 text-xs ${theme === t.id ? 'border-violet bg-violet/15 text-ink' : 'border-line text-muted hover:text-ink'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="relative w-56 shrink-0">
                <Search size={14} className="absolute top-2 left-2 text-muted" />
                <input className="h-8 w-full rounded-control border border-line bg-base pr-2 pl-7 text-xs outline-none focus:border-violet" placeholder="Buscar título, artista, tag…" value={filter.query ?? ''} onChange={(e) => setFilter({ ...filter, query: e.target.value })} />
              </div>
              <RangeFilter label="BPM" min={50} max={200} value={filter.bpm} onChange={(bpm) => setFilter({ ...filter, bpm })} />
              <RangeFilter label="Intensidade" min={0} max={100} value={filter.intensity} onChange={(intensity) => setFilter({ ...filter, intensity })} />
              <select className="h-8 rounded-control border border-line bg-base px-2 text-xs" value={filter.emotion ?? ''} onChange={(e) => setFilter({ ...filter, emotion: e.target.value || null })}>
                <option value="">Emoção</option>
                {EMOTIONS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-xs whitespace-nowrap text-ink-soft">
                <input type="checkbox" className="accent-violet" checked={!!filter.hasDrop} onChange={(e) => setFilter({ ...filter, hasDrop: e.target.checked || undefined })} /> com drop
              </label>
              <label className="flex items-center gap-1 text-xs whitespace-nowrap text-ink-soft">
                <input type="checkbox" className="accent-violet" checked={!!filter.unused} onChange={(e) => setFilter({ ...filter, unused: e.target.checked || undefined })} /> não usadas
              </label>
            </>
          )}
          <div className="ml-auto flex gap-1">
            {analyzing > 0 && (
              <span className="flex items-center gap-1 self-center text-2xs text-muted">
                <Loader2 size={12} className="animate-spin" /> analisando {analyzing}
              </span>
            )}
            <Button size="sm" icon={<Plus size={14} />} disabled={busy} onClick={() => add(false)}>
              Arquivos
            </Button>
            <Button size="sm" icon={<FolderPlus size={14} />} disabled={busy} onClick={() => add(true)}>
              Pasta
            </Button>
          </div>
        </header>

        {lib.tracks.length === 0 ? (
          <div className="grid flex-1 place-items-center">
            <div className="max-w-sm text-center">
              <Music2 size={32} className="mx-auto mb-3 text-violet" />
              <p className="text-sm font-semibold">Sua biblioteca de músicas</p>
              <p className="mt-1 text-xs text-muted">Adicione arquivos ou uma pasta inteira (MP3, WAV, FLAC, M4A, OGG). O app descobre BPM, intensidade e o drop de cada uma e recomenda a melhor para cada tipo de AMV. Os arquivos não são copiados.</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button variant="primary" icon={<FolderPlus size={15} />} onClick={() => add(true)}>
                  Adicionar pasta
                </Button>
                <Button icon={<Plus size={15} />} onClick={() => add(false)}>
                  Arquivos
                </Button>
              </div>
            </div>
          </div>
        ) : view.kind === 'recommend' ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <p className="mb-3 text-xs text-muted">{THEMES.find((t) => t.id === theme)!.description} Pontuação feita com o BPM, a energia e o drop medidos em cada arquivo, mais as emoções que você marcou.</p>
            {recs.length === 0 ? (
              <p className="text-sm text-ink-soft">Nenhuma música da biblioteca combina bem com esse tema ainda.</p>
            ) : (
              <ol className="space-y-1.5">
                {recs.map((r, i) => (
                  <li key={r.track.id} className={`flex items-center gap-3 rounded-md border px-3 py-2 ${selected.includes(r.track.id) ? 'border-violet bg-violet/10' : 'border-line hover:bg-raised/60'}`} onClick={(e) => pickRow(r.track.id, e.ctrlKey || e.metaKey || e.shiftKey)}>
                    <span className="tnum w-5 text-xs text-faint">{i + 1}</span>
                    <PlayButton track={r.track} onClick={() => playList(r.track, recs.map((x) => x.track))} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{displayTitle(r.track)}</p>
                      <p className="truncate text-xs text-muted">{r.reasons.join(' · ')}</p>
                    </div>
                    <span className="tnum rounded bg-violet/15 px-2 py-0.5 text-xs text-violet-strong">{Math.round(r.score * 100)}%</span>
                    <Button size="sm" icon={<Wand2 size={13} />} onClick={(e) => (e.stopPropagation(), void useInProject(r.track))}>
                      Usar
                    </Button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="sticky top-0 z-10 grid grid-cols-[32px_24px_minmax(0,1fr)_64px_110px_64px_56px_100px] items-center gap-2 border-b border-line bg-panel px-4 py-2 text-2xs font-semibold tracking-wide text-muted uppercase">
              <span />
              <span />
              <SortHead k="title" label="Título" />
              <SortHead k="bpm" label="BPM" />
              <SortHead k="intensity" label="Intensidade" />
              <span>Drop</span>
              <SortHead k="duration" label="Tempo" />
              <span>Emoção</span>
            </div>
            {tracks.map((t) => (
              <div
                key={t.id}
                onClick={(e) => pickRow(t.id, e.ctrlKey || e.metaKey || e.shiftKey)}
                onDoubleClick={() => player.play(t.id, tracks.map((x) => x.id))}
                className={`music-library-row grid cursor-default grid-cols-[32px_24px_minmax(0,1fr)_64px_110px_64px_56px_100px] items-center gap-2 border-b border-line/50 px-4 py-2 text-xs [content-visibility:auto] ${selected.includes(t.id) ? 'selected bg-violet/10' : ''} ${t.status === 'missing' ? 'opacity-50' : ''}`}
              >
                <PlayButton track={t} onClick={() => playList(t, tracks)} />
                <button type="button" aria-label="Favorita" onClick={(e) => (e.stopPropagation(), library.update([t.id], { favorite: !t.favorite }))} className={t.favorite ? 'text-violet-strong' : 'text-faint hover:text-ink'}>
                  <Heart size={13} fill={t.favorite ? 'currentColor' : 'none'} />
                </button>
                <div className="min-w-0">
                  <p className={`truncate ${player.trackId === t.id ? 'text-violet-strong' : ''}`}>{displayTitle(t)}</p>
                  <p className="truncate text-2xs text-muted">{[t.artist, t.genre].filter(Boolean).join(' · ') || t.name}</p>
                </div>
                <span className="tnum">{t.summary ? Math.round(t.summary.bpm) : <StatusCell t={t} />}</span>
                <span>{t.summary ? <IntensityBar v={t.summary.intensity} /> : null}</span>
                <span className="tnum text-ink-soft">{t.summary ? (t.summary.drops[0] !== undefined ? mmss(t.summary.drops[0]) : '—') : ''}</span>
                <span className="tnum text-ink-soft">{mmss(t.durationS)}</span>
                <select onClick={(e) => e.stopPropagation()} className="h-6 rounded border border-transparent bg-transparent text-2xs text-ink-soft hover:border-line" value={t.emotion ?? ''} onChange={(e) => library.update(selected.includes(t.id) ? selected : [t.id], { emotion: e.target.value || null })}>
                  <option value="">—</option>
                  {EMOTIONS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {tracks.length === 0 && <p className="p-6 text-center text-xs text-muted">Nenhuma música com esses filtros.</p>}
          </div>
        )}
      </section>

      {/* detalhe / comparação */}
      {(detail || compare.length >= 2) && (
        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-line bg-panel p-4">
          {detail ? <TrackDetail
            t={detail}
            onUse={() => void useInProject(detail)}
            hasProject={!!session}
            onCorrectTempo={async (direction) => {
              await library.correctTempo(detail.id, direction);
              const asset = session?.project.assets.find((item) => item.hash === detail.hash && item.kind === 'audio');
              if (session && asset) await session.refreshMusicAnalysis(asset.id);
            }}
            onSetTempo={async (bpm, anchorS) => {
              await library.setManualTempo(detail.id, bpm, anchorS);
              const asset = session?.project.assets.find((item) => item.hash === detail.hash && item.kind === 'audio');
              if (session && asset) await session.refreshMusicAnalysis(asset.id);
            }}
          /> : <Compare tracks={compare} />}
          {selected.length > 0 && lib.playlists.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-1 text-2xs font-semibold text-muted uppercase">Adicionar {selected.length > 1 ? `${selected.length} músicas` : ''} à playlist</p>
              <div className="flex flex-wrap gap-1">
                {lib.playlists.map((p) => (
                  <button key={p.id} type="button" className="rounded border border-line px-2 py-0.5 text-2xs hover:bg-raised" onClick={() => (library.addToPlaylist(p.id, selected), toast({ tone: 'ok', title: `Adicionada(s) a ${p.name}` }))}>
                    {p.name}
                  </button>
                ))}
              </div>
              {view.kind === 'playlist' && (
                <button type="button" className="mt-2 text-2xs text-muted hover:text-danger" onClick={() => library.removeFromPlaylist(view.id, selected)}>
                  Tirar desta playlist
                </button>
              )}
            </div>
          )}
          <button type="button" className="mt-4 self-start text-2xs text-muted hover:text-danger" onClick={() => (library.remove(selected), setSelected([]))}>
            Remover da biblioteca (o arquivo fica no disco)
          </button>
        </aside>
      )}
    </div>
  );
}

function StatusCell({ t }: { t: LibraryTrack }) {
  if (t.status === 'analyzing') return <Loader2 size={12} className="animate-spin text-muted" />;
  if (t.status === 'missing')
    return (
      <span title="Arquivo não encontrado. Adicione de novo de onde ele está agora." className="text-warn">
        <AlertTriangle size={12} />
      </span>
    );
  if (t.status === 'error')
    return (
      <span title={t.error ?? ''} className="text-danger">
        <AlertTriangle size={12} />
      </span>
    );
  return null;
}

function PlayButton({ track, onClick }: { track: LibraryTrack; onClick: () => void }) {
  const playing = usePlayer((s) => s.trackId === track.id && s.playing);
  return (
    <button type="button" aria-label={playing ? 'Pausar' : 'Tocar'} disabled={track.status === 'missing'} onClick={(e) => (e.stopPropagation(), onClick())} className="grid size-7 place-items-center rounded-full text-ink-soft hover:bg-raised hover:text-ink disabled:opacity-30">
      {playing ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}
    </button>
  );
}

function IntensityBar({ v }: { v: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-base">
        <span className="block h-full rounded-full bg-gradient-to-r from-violet to-[#ff6b8b]" style={{ width: `${Math.max(4, v)}%` }} />
      </span>
      <span className="tnum text-2xs text-muted">{Math.round(v)}</span>
    </span>
  );
}

function RangeFilter({ label, min, max, value, onChange }: { label: string; min: number; max: number; value?: [number, number]; onChange: (v: [number, number] | undefined) => void }) {
  const [lo, hi] = value ?? [min, max];
  const set = (a: number, b: number) => onChange(a <= min && b >= max ? undefined : [a, b]);
  return (
    <div className={`flex h-8 shrink-0 items-center gap-1 rounded-control border px-2 text-xs whitespace-nowrap ${value ? 'border-violet' : 'border-line'}`}>
      <span className="text-muted">{label}</span>
      <input aria-label={`${label} mínimo`} type="number" className="tnum w-10 bg-transparent text-right outline-none" value={lo} min={min} max={hi} onChange={(e) => set(Number(e.target.value), hi)} />
      <span className="text-faint">–</span>
      <input aria-label={`${label} máximo`} type="number" className="tnum w-10 bg-transparent outline-none" value={hi} min={lo} max={max} onChange={(e) => set(lo, Number(e.target.value))} />
    </div>
  );
}

/** Curva de energia com seções e drop; clicar toca a partir dali. */
function EnergyCurve({ t, height = 90, color = '#8b6cff', analysis }: { t: LibraryTrack; height?: number; color?: string; analysis?: MusicAnalysis | null }) {
  const player = usePlayer();
  const s = t.summary!;
  const W = 280;
  const pts = s.energy.map((e, i) => `${(i / (s.energy.length - 1)) * W},${height - e * (height - 6)}`).join(' ');
  const x = (sec: number) => (sec / Math.max(1, t.durationS)) * W;
  const here = player.trackId === t.id ? x(player.positionS) : null;
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      className="w-full cursor-pointer rounded bg-base"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const at = ((e.clientX - r.left) / r.width) * t.durationS;
        player.trackId === t.id ? player.seek(at) : player.play(t.id, undefined, at);
      }}
    >
      {s.sections.map((sec, i) => (
        <rect key={i} x={x(sec.startS)} y={0} width={Math.max(0, x(sec.endS) - x(sec.startS))} height={height} fill={i % 2 ? '#ffffff08' : 'transparent'} />
      ))}
      {analysis && (() => {
        const stride = Math.max(1, Math.ceil(analysis.beats.length / (W / 3)));
        return analysis.beats.filter((_, i) => i % stride === 0).map((beat, i) => (
          <line key={`beat-${i}`} x1={x(beat)} x2={x(beat)} y1={0} y2={height} stroke="#4fc3f7" strokeOpacity={0.22} />
        ));
      })()}
      <polyline points={`0,${height} ${pts} ${W},${height}`} fill={`${color}33`} stroke={color} strokeWidth={1.2} />
      {s.drops.map((d) => (
        <g key={d}>
          <line x1={x(d)} x2={x(d)} y1={0} y2={height} stroke="#f2b544" strokeDasharray="3 2" />
          <text x={x(d) + 3} y={10} fontSize={8} fill="#f2b544">
            DROP
          </text>
        </g>
      ))}
      {here !== null && <line x1={here} x2={here} y1={0} y2={height} stroke="#fff" />}
    </svg>
  );
}

function TrackDetail({ t, onUse, hasProject, onCorrectTempo, onSetTempo }: { t: LibraryTrack; onUse: () => void; hasProject: boolean; onCorrectTempo: (direction: 'double' | 'half') => Promise<void>; onSetTempo: (bpm: number, anchorS: number) => Promise<void> }) {
  const { library } = useApp();
  const toast = useApp((s) => s.toast);
  const player = usePlayer();
  const [tag, setTag] = useState('');
  const [analysis, setAnalysis] = useState<MusicAnalysis | null>(null);
  const [tempoBusy, setTempoBusy] = useState(false);
  const [taps, setTaps] = useState<{ atMs: number; positionS: number }[]>([]);
  const s = t.summary;
  useEffect(() => {
    let active = true;
    setAnalysis(null);
    setTaps([]);
    void library?.analysis(t.id).then((value) => {
      if (active) setAnalysis(value);
    }).catch((error: unknown) => {
      if (active) toast({ tone: 'error', title: 'Não foi possível carregar as batidas', body: (error as Error).message });
    });
    return () => { active = false; };
  }, [library, t.id, library?.changes, toast]);

  const tapTempo = async () => {
    const now = performance.now();
    const fresh = taps.filter((tap) => now - tap.atMs <= 2500);
    const positionS = player.positionS + (player.trackId === t.id && player.playing ? Math.max(0, Math.min(0.35, (now - player.positionTickAtMs) / 1000)) : 0);
    const next = [...fresh, { atMs: now, positionS }].slice(-5);
    setTaps(next);
    if (next.length < 4) return;
    const intervals = next.slice(1).map((tap, i) => tap.atMs - next[i]!.atMs);
    const bpm = 60_000 / (intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length);
    setTempoBusy(true);
    try {
      await onSetTempo(bpm, next[0]!.positionS);
      setTaps([]);
      toast({ tone: 'ok', title: `Batidas ajustadas para ${Math.round(bpm)} BPM`, body: 'Correção salva e usada na timeline e nas próximas montagens.' });
    } catch (error) {
      toast({ tone: 'error', title: 'Não foi possível ajustar o BPM', body: (error as Error).message });
    } finally {
      setTempoBusy(false);
    }
  };

  const correctOctave = async (direction: 'double' | 'half') => {
    setTempoBusy(true);
    try {
      await onCorrectTempo(direction);
      setTaps([]);
      toast({ tone: 'ok', title: direction === 'double' ? 'BPM dobrado' : 'BPM dividido por 2', body: 'Grade de batidas atualizada e salva.' });
    } catch (error) {
      toast({ tone: 'error', title: 'Não foi possível corrigir o BPM', body: (error as Error).message });
    } finally {
      setTempoBusy(false);
    }
  };

  return (
    <div>
      <p className="text-[15px] font-semibold text-ink">{displayTitle(t)}</p>
      <p className="text-xs text-muted">{[t.artist, t.album, t.genre].filter(Boolean).join(' · ') || t.name}</p>
      {s ? (
        <>
          <div className="mt-3">
            <EnergyCurve t={t} analysis={analysis} />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <Stat label="BPM" value={`${Math.round(s.bpm)}`} hint={s.bpmConfidence < 0.4 ? 'incerto' : undefined} />
            <Stat label="Intensidade" value={`${Math.round(s.intensity)}`} />
            <Stat label="Drop" value={s.drops[0] !== undefined ? mmss(s.drops[0]) : '—'} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <button type="button" disabled={tempoBusy} className="rounded border border-line px-2 py-1 text-2xs hover:bg-raised disabled:opacity-50" onClick={() => void correctOctave('double')} aria-label="Dobrar BPM">
              BPM ×2
            </button>
            <button type="button" disabled={tempoBusy} className="rounded border border-line px-2 py-1 text-2xs hover:bg-raised disabled:opacity-50" onClick={() => void correctOctave('half')} aria-label="Dividir BPM por 2">
              BPM ÷2
            </button>
            <button type="button" disabled={tempoBusy || !analysis || analysis.beats.length === 0 || player.trackId !== t.id || !player.playing} className="rounded border border-line px-2 py-1 text-2xs hover:bg-raised disabled:opacity-50" onClick={() => void tapTempo()} title="Toque quatro vezes no ritmo da música enquanto ela toca">
              {tempoBusy ? 'Salvando…' : `Tap tempo${taps.length ? ` ${taps.length}/4` : ''}`}
            </button>
            <span className="text-2xs text-faint">Linhas azuis = batidas · toque 4 vezes com a música tocando</span>
          </div>
          <p className="mt-3 mb-1 text-2xs font-semibold text-muted uppercase">Partes (clique para repetir)</p>
          <div className="flex flex-wrap gap-1">
            {s.sections.map((sec, i) => (
              <button key={i} type="button" className="rounded border border-line px-1.5 py-0.5 text-2xs hover:bg-raised" onClick={() => (player.trackId !== t.id && player.play(t.id), player.setLoop([sec.startS, sec.endS]))}>
                {SECTION_PT[sec.label] ?? sec.label} {mmss(sec.startS)}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-3 text-xs text-muted">{t.status === 'error' ? `Erro na análise: ${t.error}` : t.status === 'missing' ? 'Arquivo não encontrado.' : 'Analisando…'}</p>
      )}

      <p className="mt-4 mb-1 text-2xs font-semibold text-muted uppercase">Nota</p>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" aria-label={`${n} estrelas`} onClick={() => library!.update([t.id], { rating: t.rating === n ? 0 : n })} className={n <= t.rating ? 'text-warn' : 'text-faint hover:text-ink'}>
            <Star size={15} fill={n <= t.rating ? 'currentColor' : 'none'} />
          </button>
        ))}
      </div>

      <p className="mt-3 mb-1 text-2xs font-semibold text-muted uppercase">Tags</p>
      <div className="flex flex-wrap gap-1">
        {t.tags.map((x) => (
          <button key={x} type="button" title="Tirar tag" className="rounded-full bg-raised px-2 py-0.5 text-2xs hover:line-through" onClick={() => library!.update([t.id], { tags: t.tags.filter((y) => y !== x) })}>
            {x}
          </button>
        ))}
        <input
          className="h-6 w-24 rounded border border-line bg-base px-1.5 text-2xs outline-none focus:border-violet"
          placeholder="+ tag"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && tag.trim()) {
              library!.update([t.id], { tags: [...new Set([...t.tags, tag.trim().toLowerCase()])] });
              setTag('');
            }
          }}
        />
      </div>
      {t.usedIn.length > 0 && <p className="mt-3 text-2xs text-muted">Usada em: {t.usedIn.join(', ')}</p>}
      <Button className="mt-4 w-full" variant="primary" icon={<Wand2 size={14} />} disabled={t.status === 'missing'} onClick={onUse} title={hasProject ? undefined : 'Abra um projeto antes'}>
        Usar no projeto
      </Button>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded bg-base px-2 py-1.5">
      <p className="tnum text-sm font-semibold">{value}</p>
      <p className="text-2xs text-muted">
        {label}
        {hint ? ` (${hint})` : ''}
      </p>
    </div>
  );
}

const COLORS = ['#8b6cff', '#4fc3f7', '#ff6b8b', '#f2b544'];

function Compare({ tracks }: { tracks: LibraryTrack[] }) {
  const player = usePlayer();
  return (
    <div>
      <p className="text-sm font-semibold">Comparar {tracks.length} músicas</p>
      <p className="mb-3 text-2xs text-muted">Curvas de energia lado a lado. "Ouvir o drop" pula direto para ele em cada uma.</p>
      {tracks.map((t, i) => (
        <div key={t.id} className="mb-3">
          <div className="mb-1 flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: COLORS[i] }} />
            <span className="min-w-0 flex-1 truncate text-xs">{displayTitle(t)}</span>
            <span className="tnum text-2xs text-muted">
              {Math.round(t.summary!.bpm)} BPM · {Math.round(t.summary!.intensity)}
            </span>
          </div>
          <EnergyCurve t={t} height={48} color={COLORS[i]} />
          {t.summary!.drops[0] !== undefined && (
            <button type="button" className="mt-1 text-2xs text-violet-strong hover:underline" onClick={() => player.play(t.id, tracks.map((x) => x.id), Math.max(0, t.summary!.drops[0]! - 4))}>
              Ouvir o drop
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
