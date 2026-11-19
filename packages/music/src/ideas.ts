/**
 * Ideias de música para AMVs vindas de links do YouTube e do Spotify.
 * Usa só os dados públicos de oEmbed (título, canal/artista, capa) — sem chave, sem login
 * e sem baixar áudio. A música para editar continua sendo um arquivo que a pessoa importa.
 */
import type { ThemeId } from './index.js';

export type IdeaService = 'youtube' | 'spotify';
export type IdeaKind = 'track' | 'video' | 'playlist' | 'album';

export interface MediaLink {
  service: IdeaService;
  kind: IdeaKind;
  id: string;
  url: string;
}

export interface MusicIdea extends MediaLink {
  title: string;
  author: string | null;
  thumbnail: string | null;
  /** Clima/tema pensado para o AMV. */
  theme: ThemeId | null;
  notes: string;
  addedAt: number;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const SP_ID = /^[A-Za-z0-9]{22}$/;

/** Reconhece links do YouTube/Spotify. Null para qualquer outra coisa. */
export function parseMediaLink(input: string): MediaLink | null {
  const raw = input.trim();
  const sp = /^spotify:(track|album|playlist):([A-Za-z0-9]{22})$/.exec(raw);
  if (sp) return { service: 'spotify', kind: sp[1] as IdeaKind, id: sp[2]!, url: `https://open.spotify.com/${sp[1]}/${sp[2]}` };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0] ?? '';
    return YT_ID.test(id) ? { service: 'youtube', kind: 'video', id, url: `https://www.youtube.com/watch?v=${id}` } : null;
  }
  if (host === 'youtube.com') {
    const list = u.searchParams.get('list');
    const v = u.searchParams.get('v') ?? /^\/(?:shorts|embed|live)\/([^/]+)/.exec(u.pathname)?.[1] ?? null;
    if (v && YT_ID.test(v)) return { service: 'youtube', kind: 'video', id: v, url: `https://www.youtube.com/watch?v=${v}` };
    if (list && /^[A-Za-z0-9_-]{10,64}$/.test(list)) return { service: 'youtube', kind: 'playlist', id: list, url: `https://www.youtube.com/playlist?list=${list}` };
    return null;
  }
  if (host === 'open.spotify.com') {
    const m = /^\/(?:intl-[a-z-]+\/)?(track|album|playlist)\/([^/?]+)/.exec(u.pathname);
    if (m && SP_ID.test(m[2]!)) return { service: 'spotify', kind: m[1] as IdeaKind, id: m[2]!, url: `https://open.spotify.com/${m[1]}/${m[2]}` };
  }
  return null;
}

export function oembedUrl(link: MediaLink): string {
  return link.service === 'youtube'
    ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(link.url)}`
    : `https://open.spotify.com/oembed?url=${encodeURIComponent(link.url)}`;
}

/** Converte a resposta oEmbed numa ideia. Lança se não houver título. */
export function ideaFromOEmbed(link: MediaLink, body: unknown, now = Date.now()): MusicIdea {
  const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  if (!title) throw new Error('O link não devolveu um título.');
  const author = typeof o.author_name === 'string' && o.author_name.trim() ? o.author_name.trim() : null;
  const thumb = typeof o.thumbnail_url === 'string' && /^https:\/\//.test(o.thumbnail_url) ? o.thumbnail_url : null;
  return { ...link, title, author, thumbnail: thumb, theme: guessTheme(title), notes: '', addedAt: now };
}

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Palpite de clima só pelo título (palavras óbvias); null quando não há pista. A pessoa ajusta. */
export function guessTheme(title: string): ThemeId | null {
  const t = norm(title);
  if (/\b(sad|cry|tears|alone|lonely|goodbye|triste|lagrima|adeus|sozinho|saudade)\b/.test(t)) return 'emocional';
  if (/\b(love|heart|amor|coracao|kiss)\b/.test(t)) return 'romantico';
  if (/\b(fight|war|battle|monster|rage|kill|luta|guerra|batalha|phonk)\b/.test(t)) return 'luta';
  if (/\b(rise|hero|legend|unstoppable|never give up|champion|superacao|heroi|lenda)\b/.test(t)) return 'motivacao';
  if (/\b(epic|epico|orchestral|cinematic)\b/.test(t)) return 'epico';
  return null;
}

/** Título "limpo" para comparar com a biblioteca (sem "(Official Video)", "[4K]", "- Topic"…). */
export function cleanTitle(title: string): string {
  return norm(title)
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\b(official|video|music|lyrics?|audio|clipe|oficial|hd|4k|remaster(ed)?|mv|amv|topic)\b/g, ' ')
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A música da ideia já está na biblioteca? Compara o nome do arquivo/título sem ruído. */
export function ideaMatchesTrack(idea: Pick<MusicIdea, 'title'>, trackTitle: string): boolean {
  const a = cleanTitle(idea.title);
  const b = cleanTitle(trackTitle);
  if (a.length < 3 || b.length < 3) return false;
  return a.includes(b) || b.includes(a);
}

/** Adiciona sem duplicar (mesmo serviço + id); a mais recente vai para o topo. */
export function upsertIdea(list: readonly MusicIdea[], idea: MusicIdea): MusicIdea[] {
  return [idea, ...list.filter((x) => !(x.service === idea.service && x.id === idea.id))];
}
