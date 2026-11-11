import { filterSounds, SOUND_CATEGORIES, SOUND_CATEGORY_LABEL, suggestSoundDesign, type SoundCategory, type SoundEntry } from '@amv/sound-design';
import { AudioLines, FolderPlus, Pause, Play, Plus, Search, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useSessionVersion, useSoundLibraryVersion } from '../../store';
import { useEditor } from '../editor/editorStore';
import { usePlayer } from '../music/player';
import { Button, inputClass } from '../../ui/controls';

const fieldClass = 'h-8 w-full rounded-control border border-line bg-base px-2.5 text-xs text-ink outline-none focus:border-violet';
const areaClass = 'w-full resize-y rounded-control border border-line bg-base px-2.5 py-2 text-xs text-ink outline-none focus:border-violet';
const timeLabel = (us: number) => `${Math.floor(us / 60_000_000)}:${String(Math.floor((us % 60_000_000) / 1_000_000)).padStart(2, '0')}`;

export function SoundLibraryScreen() {
  const { platform, soundLibrary, session, toast } = useApp();
  const revision = useSoundLibraryVersion(soundLibrary);
  const sessionRevision = useSessionVersion(session);
  const musicPlaying = usePlayer((state) => state.playing);
  const playheadUs = useEditor((state) => state.playheadUs);
  const audio = useRef<HTMLAudioElement>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SoundCategory | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!soundLibrary) return;
    let active = true;
    soundLibrary.load().then(() => {
      if (active) setLoading(false);
    }).catch((error: unknown) => {
      if (active) {
        setLoading(false);
        toast({ tone: 'error', title: 'Não foi possível carregar a biblioteca de sons', body: (error as Error).message });
      }
    });
    return () => { active = false; };
  }, [soundLibrary, toast]);

  const sounds = useMemo(
    () => soundLibrary ? filterSounds(soundLibrary.library, query, category) : [],
    [soundLibrary, query, category, revision],
  );
  const selected = soundLibrary?.get(selectedId ?? '') ?? null;
  const suggestions = useMemo(() => session ? suggestSoundDesign(session.project) : [], [session, sessionRevision]);

  useEffect(() => {
    if (musicPlaying && playingId) {
      audio.current?.pause();
      setPlayingId(null);
    }
  }, [musicPlaying, playingId]);

  const importSounds = async (folder: boolean) => {
    if (!platform || !soundLibrary) return;
    setBusy(true);
    try {
      const paths = folder
        ? [await platform.dialogs.pickFolder('Pasta de efeitos sonoros')].filter((path): path is string => !!path)
        : (await platform.dialogs.pickMedia()) ?? [];
      if (!paths.length) return;
      const result = await soundLibrary.add(paths);
      await soundLibrary.flush();
      const imported = soundLibrary.library.sounds.find((sound) => paths.includes(sound.path));
      if (imported) setSelectedId(imported.id);
      const failures = result.failed.slice(0, 3).map((item) => `${item.path}: ${item.reason}`).join('\n');
      toast({
        tone: result.added ? 'ok' : result.failed.length ? 'error' : 'info',
        title: result.added ? `${result.added} efeito(s) adicionado(s)` : 'Nenhum efeito sonoro novo',
        body: [
          result.duplicates && `${result.duplicates} duplicado(s)`,
          result.skipped && `${result.skipped} arquivo(s) sem áudio`,
          failures,
          result.failed.length > 3 && `e mais ${result.failed.length - 3} erro(s)`,
        ].filter(Boolean).join('\n') || undefined,
      });
    } catch (error) {
      toast({ tone: 'error', title: 'Não foi possível importar os efeitos sonoros', body: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const preview = async (sound: SoundEntry) => {
    if (!platform || !audio.current) return;
    if (playingId === sound.id) {
      audio.current.pause();
      setPlayingId(null);
      return;
    }
    const player = audio.current;
    usePlayer.getState().pause();
    player.pause();
    player.src = platform.fileUrl(sound.path);
    player.currentTime = 0;
    try {
      await player.play();
      setPlayingId(sound.id);
    } catch (error) {
      setPlayingId(null);
      toast({ tone: 'error', title: 'Não foi possível reproduzir o efeito', body: (error as Error).message });
    }
  };

  const placeSound = async (sound: SoundEntry, atUs = playheadUs) => {
    if (!session) return;
    try {
      const clipId = await session.addSoundToTimeline({
        path: sound.path,
        name: sound.name,
        rights: { origin: sound.origin, license: sound.license, attribution: sound.attribution },
        startUs: atUs,
      });
      audio.current?.pause();
      setPlayingId(null);
      useEditor.getState().setPlayhead(atUs);
      useEditor.getState().select([clipId]);
      useApp.getState().go('project');
      toast({ tone: 'ok', title: `"${sound.name}" adicionado à timeline`, body: 'O clipe pode ser cortado, movido, ajustado e desfeito no editor.' });
    } catch (error) {
      toast({ tone: 'error', title: 'Não foi possível adicionar o efeito à timeline', body: (error as Error).message });
    }
  };

  const removeSound = async (sound: SoundEntry) => {
    if (!platform || !soundLibrary) return;
    try {
      const confirmed = await platform.dialogs.confirm(
        `Remover "${sound.name}" da biblioteca? O arquivo original não será apagado.`,
        'Remover efeito sonoro',
      );
      if (!confirmed) return;
      soundLibrary.remove(sound.id);
      await soundLibrary.flush();
      if (selectedId === sound.id) setSelectedId(null);
      if (playingId === sound.id) {
        audio.current?.pause();
        setPlayingId(null);
      }
    } catch (error) {
      toast({ tone: 'error', title: 'Não foi possível remover o efeito da biblioteca', body: (error as Error).message });
    }
  };

  if (!soundLibrary || !platform) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="studio-page-header flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
        <div>
          <h1 className="flex items-center gap-2 text-base font-semibold"><AudioLines size={18} className="text-violet" /> Biblioteca de efeitos sonoros</h1>
          <p className="mt-1 text-xs text-muted">Arquivos locais referenciados sem cópia ou alteração. Confira licença e atribuição antes de usar.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" icon={<FolderPlus size={14} />} disabled={busy} onClick={() => void importSounds(true)}>Importar pasta</Button>
          <Button size="sm" variant="primary" icon={<Upload size={14} />} disabled={busy} onClick={() => void importSounds(false)}>{busy ? 'Importando…' : 'Importar arquivos'}</Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2.5">
            <label className="relative min-w-44 flex-1">
              <Search size={14} className="absolute top-2.5 left-2.5 text-faint" />
              <input className={`${inputClass} h-8 pl-8 text-xs`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nome, tags, licença ou origem…" aria-label="Buscar efeitos sonoros" />
            </label>
            <select className={`${fieldClass} w-44`} value={category} onChange={(event) => setCategory(event.target.value as SoundCategory | 'all')} aria-label="Filtrar categoria">
              <option value="all">Todas as categorias</option>
              {SOUND_CATEGORIES.map((item) => <option key={item} value={item}>{SOUND_CATEGORY_LABEL[item]}</option>)}
            </select>
          </div>

          {session && suggestions.length > 0 && (
            <aside className="shrink-0 border-b border-line-soft bg-violet/5 px-4 py-3">
              <h2 className="text-xs font-semibold text-ink">Sugestões para revisar</h2>
              <p className="mt-1 text-2xs text-muted">Usam marcadores de música e cortes já existentes; não inferem eventos visuais nem inserem áudio automaticamente.</p>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {suggestions.slice(0, 8).map((suggestion) => {
                  const match = soundLibrary.library.sounds.find((sound) => sound.category === suggestion.kind);
                  return (
                    <div key={suggestion.id} className="flex min-w-56 items-center gap-2 rounded-control border border-line bg-panel p-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{SOUND_CATEGORY_LABEL[suggestion.kind]} · {timeLabel(suggestion.atUs)}</p>
                        <p className="text-2xs text-muted">{Math.round(suggestion.confidence * 100)}% · {suggestion.reason}</p>
                      </div>
                      <Button size="sm" disabled={!match} title={!match ? 'Importe um efeito desta categoria' : undefined} onClick={() => match && void placeSound(match, suggestion.atUs)}>
                        <Plus size={13} /> Usar
                      </Button>
                    </div>
                  );
                })}
              </div>
            </aside>
          )}

          {loading ? (
            <div className="grid flex-1 place-items-center text-sm text-muted">Carregando biblioteca…</div>
          ) : sounds.length === 0 ? (
            <div className="grid flex-1 place-items-center px-6 text-center">
              <div className="max-w-sm">
                <AudioLines size={28} className="mx-auto text-faint" />
                <p className="mt-3 text-sm font-medium">{query || category !== 'all' ? 'Nenhum efeito corresponde à busca' : 'Sua biblioteca está vazia'}</p>
                <p className="mt-1 text-xs text-muted">Importe arquivos que você tem autorização para usar. O app guarda somente a referência e os metadados.</p>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <div className="grid gap-2">
                {sounds.map((sound) => (
                  <article key={sound.id} className={`sound-library-item flex items-center gap-3 rounded-panel border p-3 ${selectedId === sound.id ? 'border-violet/60 bg-violet/5' : 'border-line'}`} onClick={() => setSelectedId(sound.id)}>
                    <button type="button" aria-label={playingId === sound.id ? `Pausar ${sound.name}` : `Pré-escutar ${sound.name}`} className="grid size-9 shrink-0 place-items-center rounded-full bg-raised text-ink-soft hover:text-ink" onClick={(event) => { event.stopPropagation(); void preview(sound); }}>
                      {playingId === sound.id ? <Pause size={15} /> : <Play size={15} />}
                    </button>
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(sound.id)}>
                      <span className="block truncate text-sm font-medium">{sound.name}</span>
                      <span className="mt-0.5 block truncate text-2xs text-muted">{SOUND_CATEGORY_LABEL[sound.category]} · {timeLabel(sound.durationUs)} · {sound.tags.join(', ') || 'sem tags'}</span>
                      <span className="mt-0.5 block truncate text-2xs text-faint">{sound.license || 'Licença não informada'} · {sound.origin || sound.path}</span>
                    </button>
                    <Button size="sm" disabled={!session} title={!session ? 'Abra um projeto para adicionar o som' : undefined} onClick={(event) => { event.stopPropagation(); void placeSound(sound); }}>
                      <Plus size={13} /> Timeline
                    </Button>
                    <button type="button" aria-label={`Remover ${sound.name} da biblioteca`} title="Remover da biblioteca (não apaga o arquivo)" className="grid size-8 shrink-0 place-items-center rounded-control text-muted hover:bg-danger/10 hover:text-danger" onClick={(event) => { event.stopPropagation(); void removeSound(sound); }}>
                      <Trash2 size={14} />
                    </button>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="w-[320px] shrink-0 overflow-y-auto border-l border-line bg-panel p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Metadados e direitos</h2>
          {selected ? (
            <SoundMetadataEditor key={selected.id} sound={selected} onSave={async (patch) => {
              try {
                soundLibrary.update(selected.id, patch);
                await soundLibrary.flush();
                toast({ tone: 'ok', title: 'Metadados do efeito atualizados' });
              } catch (error) {
                toast({ tone: 'error', title: 'Não foi possível atualizar o efeito', body: (error as Error).message });
              }
            }} />
          ) : (
            <p className="text-xs leading-relaxed text-muted">Selecione um efeito para revisar ou editar categoria, tags, origem e licença.</p>
          )}
          {selected && (
            <Button className="mt-4 w-full" disabled={!session} onClick={() => void placeSound(selected)}>
              <Plus size={14} /> Adicionar no playhead ({timeLabel(playheadUs)})
            </Button>
          )}
        </aside>
      </div>
      <audio ref={audio} hidden onEnded={() => setPlayingId(null)} onError={() => {
        if (playingId) toast({ tone: 'error', title: 'Falha ao ler o arquivo de áudio', body: 'Verifique se o arquivo ainda existe e se o formato é compatível.' });
        setPlayingId(null);
      }} />
    </div>
  );
}

function SoundMetadataEditor({ sound, onSave }: {
  sound: SoundEntry;
  onSave: (patch: Partial<Pick<SoundEntry, 'name' | 'category' | 'tags' | 'origin' | 'license' | 'attribution' | 'notes'>>) => Promise<void>;
}) {
  const [name, setName] = useState(sound.name);
  const [category, setCategory] = useState(sound.category);
  const [tags, setTags] = useState(sound.tags.join(', '));
  const [origin, setOrigin] = useState(sound.origin);
  const [license, setLicense] = useState(sound.license);
  const [attribution, setAttribution] = useState(sound.attribution);
  const [notes, setNotes] = useState(sound.notes);

  return (
    <div>
      <label className="mb-3 block text-xs text-muted">Nome<input className={`${fieldClass} mt-1`} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="mb-3 block text-xs text-muted">Categoria<select className={`${fieldClass} mt-1`} value={category} onChange={(event) => setCategory(event.target.value as SoundCategory)}>{SOUND_CATEGORIES.map((item) => <option key={item} value={item}>{SOUND_CATEGORY_LABEL[item]}</option>)}</select></label>
      <label className="mb-3 block text-xs text-muted">Tags<input className={`${fieldClass} mt-1`} value={tags} onChange={(event) => setTags(event.target.value)} placeholder="impacto, luta, transição" /></label>
      <label className="mb-3 block text-xs text-muted">Origem<input className={`${fieldClass} mt-1`} value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="autor, biblioteca ou URL de origem" /></label>
      <label className="mb-3 block text-xs text-muted">Licença<input className={`${fieldClass} mt-1`} value={license} onChange={(event) => setLicense(event.target.value)} placeholder="Ex.: CC BY 4.0, própria, desconhecida" /></label>
      <label className="mb-3 block text-xs text-muted">Atribuição<input className={`${fieldClass} mt-1`} value={attribution} onChange={(event) => setAttribution(event.target.value)} placeholder="Texto de crédito exigido" /></label>
      <label className="mb-3 block text-xs text-muted">Observações<textarea className={`${areaClass} mt-1`} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      <p className="mb-3 break-all text-2xs text-faint">Arquivo local: {sound.path}</p>
      <Button variant="primary" className="w-full" onClick={() => onSave({
        name: name.trim() || sound.name,
        category,
        tags: tags.split(','),
        origin,
        license,
        attribution,
        notes,
      })}>Salvar metadados</Button>
    </div>
  );
}
