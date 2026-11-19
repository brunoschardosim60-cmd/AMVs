import { displayTitle, ideaFromOEmbed, ideaMatchesTrack, oembedUrl, parseMediaLink, THEMES, upsertIdea, type LibraryTrack, type MusicIdea, type ThemeId } from '@amv/music';
import { ExternalLink, Lightbulb, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadMusicIdeas, saveMusicIdeas } from '../../core/musicIdeas';
import { useApp } from '../../store';
import { Button } from '../../ui/controls';

const STYLE_FOR_THEME: Record<ThemeId, string> = {
  luta: 'Hype ou Rápido',
  motivacao: 'Superação',
  emocional: 'Emocional',
  epico: 'Superação ou Hype',
  romantico: 'Emocional',
  letra: 'Letra na tela',
};
const SCENES_FOR_THEME: Record<ThemeId, string> = {
  luta: 'lutas com golpes fortes no drop e cortes curtos',
  motivacao: 'derrota → treino → virada; guarde a melhor cena para o refrão',
  emocional: 'olhares, despedidas e planos longos; poucos efeitos',
  epico: 'construção lenta com vários arcos e um final grande',
  romantico: 'momentos calmos entre os personagens, cores quentes',
  letra: 'cenas que ilustrem as palavras; uma troca por verso',
};

export function MusicIdeas({ tracks }: { tracks: LibraryTrack[] }) {
  const { platform, toast } = useApp();
  const [ideas, setIdeas] = useState<MusicIdea[]>([]);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (platform) void loadMusicIdeas(platform).then(setIdeas);
  }, [platform]);

  const persist = (next: MusicIdea[]) => {
    setIdeas(next);
    if (platform) void saveMusicIdeas(platform, next);
  };

  const add = async () => {
    if (!platform || busy) return;
    const parsed = parseMediaLink(link);
    if (!parsed) {
      toast({ tone: 'warn', title: 'Link não reconhecido', body: 'Cole um link de música, vídeo ou playlist do YouTube ou do Spotify.' });
      return;
    }
    setBusy(true);
    try {
      const res = await platform.http(oembedUrl(parsed), { method: 'GET', headers: { accept: 'application/json' }, body: '' });
      if (!res.ok) throw new Error(res.status === 404 || res.status === 401 ? 'Conteúdo privado, removido ou indisponível.' : `O serviço respondeu ${res.status}.`);
      const idea = ideaFromOEmbed(parsed, JSON.parse(await res.text()));
      persist(upsertIdea(ideas, idea));
      setLink('');
    } catch (error) {
      toast({ tone: 'error', title: 'Não deu para ler o link', body: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const update = (idea: MusicIdea, patch: Partial<MusicIdea>) => persist(ideas.map((x) => (x === idea ? { ...x, ...patch } : x)));

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label="Ideias de música">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <input
          aria-label="Link do YouTube ou Spotify"
          className="h-8 min-w-0 flex-1 rounded-control border border-line bg-base px-2 text-xs outline-none focus:border-violet"
          placeholder="Cole um link do YouTube ou Spotify (música, vídeo ou playlist)"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
        />
        <Button size="sm" variant="primary" disabled={!link.trim() || busy} onClick={() => void add()}>{busy ? 'Lendo…' : 'Salvar ideia'}</Button>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        <p className="text-2xs text-muted">
          Guarda o nome, o artista e a capa para planejar AMVs. O app não baixa áudio do YouTube nem do Spotify; para editar, importe o arquivo da música que você tem.
        </p>
        {ideas.length === 0 && <p className="p-6 text-center text-xs text-muted">Nenhuma ideia ainda. Cole um link acima.</p>}
        {ideas.map((idea) => {
          const owned = tracks.find((t) => ideaMatchesTrack(idea, displayTitle(t)));
          const theme = idea.theme ? THEMES.find((t) => t.id === idea.theme) : null;
          return (
            <article key={`${idea.service}:${idea.id}`} className="flex gap-3 rounded-md border border-line-soft bg-panel p-3">
              {idea.thumbnail ? <img src={idea.thumbnail} alt="" className="size-16 shrink-0 rounded object-cover" loading="lazy" /> : <div className="grid size-16 shrink-0 place-items-center rounded bg-raised text-muted"><Lightbulb size={18} /></div>}
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{idea.title}</p>
                    <p className="text-2xs text-muted">{idea.service === 'youtube' ? 'YouTube' : 'Spotify'} · {idea.kind === 'playlist' ? 'playlist' : idea.kind === 'album' ? 'álbum' : 'música'}{idea.author ? ` · ${idea.author}` : ''}</p>
                  </div>
                  <a href={idea.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${idea.title}`} className="rounded p-1 text-muted hover:bg-raised hover:text-ink"><ExternalLink size={14} /></a>
                  <button type="button" aria-label={`Apagar ${idea.title}`} className="rounded p-1 text-muted hover:text-danger" onClick={() => persist(ideas.filter((x) => x !== idea))}><Trash2 size={14} /></button>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-2xs">
                  <select aria-label="Clima do AMV" value={idea.theme ?? ''} onChange={(e) => update(idea, { theme: (e.target.value || null) as ThemeId | null })} className="h-7 rounded-control border border-line bg-base px-1.5">
                    <option value="">Clima: escolher…</option>
                    {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  <span className={owned ? 'text-violet-strong' : 'text-muted'}>{owned ? `Já está na biblioteca: ${displayTitle(owned)}` : 'Ainda não está na biblioteca'}</span>
                </div>
                {theme && (
                  <p className="text-2xs text-ink-soft">
                    Sugestão: estilo <b>{STYLE_FOR_THEME[theme.id]}</b> · cenas: {SCENES_FOR_THEME[theme.id]}.
                  </p>
                )}
                <input aria-label="Anotações da ideia" value={idea.notes} onChange={(e) => update(idea, { notes: e.target.value })} placeholder="Anotações: anime, personagens, momento do drop…" className="h-7 w-full rounded-control border border-line bg-base px-2 text-2xs" />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

