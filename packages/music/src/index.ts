import type { MusicAnalysis } from '@amv/analysis';

/**
 * Biblioteca de músicas (local, do usuário) e recomendação por tema.
 * Lógica pura: o app guarda/carrega o JSON e roda as análises.
 * Tudo que aparece como BPM/intensidade/drop vem da análise real do arquivo.
 */

export const LIBRARY_VERSION = 1;
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'];

export interface TrackSummary {
  bpm: number;
  bpmConfidence: number;
  /** 0–100, derivada da curva de energia. */
  intensity: number;
  drops: number[];
  sections: { label: string; startS: number; endS: number; energy: number }[];
  /** Curva de energia reduzida (~160 pontos) para desenhar. */
  energy: number[];
  loudnessDb: number;
  /** Quanto a energia sobe do começo até o pico (0–1). */
  buildUp: number;
  /** Diferença entre trechos calmos e fortes (0–1). */
  dynamics: number;
}

export interface LibraryTrack {
  id: string;
  path: string;
  hash: string;
  /** Nome do arquivo. */
  name: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  durationS: number;
  addedAt: string;
  favorite: boolean;
  rating: number;
  tags: string[];
  /** Emoção dada pelo usuário (nunca inventada). */
  emotion: string | null;
  notes: string;
  status: 'ok' | 'missing' | 'analyzing' | 'error';
  error: string | null;
  summary: TrackSummary | null;
  playCount: number;
  lastPlayedAt: string | null;
  usedIn: string[];
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: string;
}

export interface Library {
  version: number;
  tracks: LibraryTrack[];
  playlists: Playlist[];
}

export const EMOTIONS = ['motivação', 'épica', 'luta', 'triste', 'romântica', 'sombria', 'feliz', 'calma'] as const;

export function emptyLibrary(): Library {
  return { version: LIBRARY_VERSION, tracks: [], playlists: [] };
}

export function parseLibrary(text: string): Library {
  try {
    const raw = JSON.parse(text) as Partial<Library>;
    if (!raw || !Array.isArray(raw.tracks)) return emptyLibrary();
    return {
      version: LIBRARY_VERSION,
      tracks: raw.tracks.filter((t) => t && typeof t.path === 'string').map((t) => ({ ...newTrackDefaults(), ...t })),
      playlists: Array.isArray(raw.playlists) ? raw.playlists : [],
    };
  } catch {
    return emptyLibrary();
  }
}

function newTrackDefaults(): Omit<LibraryTrack, 'id' | 'path' | 'hash' | 'name'> {
  return { title: null, artist: null, album: null, genre: null, durationS: 0, addedAt: new Date(0).toISOString(), favorite: false, rating: 0, tags: [], emotion: null, notes: '', status: 'ok', error: null, summary: null, playCount: 0, lastPlayedAt: null, usedIn: [] };
}

export function newTrack(id: string, path: string, hash: string, durationS: number, tags: Record<string, string>, now: string): LibraryTrack {
  const name = path.split(/[\\/]/).pop() ?? path;
  const tag = (...keys: string[]) => {
    for (const k of Object.keys(tags)) if (keys.includes(k.toLowerCase())) return tags[k]!.trim() || null;
    return null;
  };
  return { ...newTrackDefaults(), id, path, hash, name, title: tag('title'), artist: tag('artist', 'album_artist'), album: tag('album'), genre: tag('genre'), durationS, addedAt: now };
}

export function displayTitle(t: LibraryTrack): string {
  return t.title ?? t.name.replace(/\.[^.]+$/, '');
}

/** Resume a análise para guardar na biblioteca (pequeno). */
export function summarize(a: MusicAnalysis): TrackSummary {
  const n = 160;
  const e = a.energy;
  const energy: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = Math.floor((i * e.length) / n);
    const t = Math.max(s + 1, Math.floor(((i + 1) * e.length) / n));
    let m = 0;
    for (let j = s; j < t && j < e.length; j++) m = Math.max(m, e[j]!);
    energy.push(Math.round(m * 1000) / 1000);
  }
  const sorted = [...e].sort((x, y) => x - y);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const firstQuarter = e.slice(0, Math.max(1, Math.floor(e.length / 4)));
  const startE = firstQuarter.reduce((x, y) => x + y, 0) / firstQuarter.length;
  return {
    bpm: a.bpm,
    bpmConfidence: a.bpmConfidence,
    intensity: a.intensity,
    drops: a.drops,
    sections: a.sections.map((s) => ({ label: s.label, startS: s.startS, endS: s.endS, energy: s.energy })),
    energy,
    loudnessDb: a.loudnessDb,
    buildUp: Math.max(0, Math.min(1, q(0.95) - startE)),
    dynamics: Math.max(0, Math.min(1, q(0.9) - q(0.1))),
  };
}

// ------------------------------------------------------------------ filtros

export interface TrackFilter {
  query?: string;
  bpm?: [number, number];
  intensity?: [number, number];
  emotion?: string | null;
  favorites?: boolean;
  hasDrop?: boolean;
  playlistId?: string | null;
  unused?: boolean;
}

export type SortKey = 'added' | 'title' | 'artist' | 'bpm' | 'intensity' | 'duration' | 'rating' | 'played';

export function filterTracks(lib: Library, f: TrackFilter): LibraryTrack[] {
  const q = f.query?.trim().toLowerCase();
  const pl = f.playlistId ? lib.playlists.find((p) => p.id === f.playlistId) : null;
  const inPl = pl ? new Set(pl.trackIds) : null;
  return lib.tracks.filter((t) => {
    if (inPl && !inPl.has(t.id)) return false;
    if (q && ![t.name, t.title, t.artist, t.album, t.genre, t.emotion, ...t.tags].some((x) => x?.toLowerCase().includes(q))) return false;
    if (f.favorites && !t.favorite) return false;
    if (f.emotion && t.emotion !== f.emotion) return false;
    if (f.unused && t.usedIn.length) return false;
    const s = t.summary;
    if (f.bpm && (!s || s.bpm < f.bpm[0] || s.bpm > f.bpm[1])) return false;
    if (f.intensity && (!s || s.intensity < f.intensity[0] || s.intensity > f.intensity[1])) return false;
    if (f.hasDrop && (!s || !s.drops.length)) return false;
    return true;
  });
}

export function sortTracks(tracks: LibraryTrack[], key: SortKey, desc = false): LibraryTrack[] {
  const val = (t: LibraryTrack): number | string => {
    switch (key) {
      case 'title':
        return displayTitle(t).toLowerCase();
      case 'artist':
        return (t.artist ?? '').toLowerCase();
      case 'bpm':
        return t.summary?.bpm ?? -1;
      case 'intensity':
        return t.summary?.intensity ?? -1;
      case 'duration':
        return t.durationS;
      case 'rating':
        return t.rating;
      case 'played':
        return t.lastPlayedAt ?? '';
      default:
        return t.addedAt;
    }
  };
  const out = [...tracks].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return desc ? out.reverse() : out;
}

// ------------------------------------------------------------------ recomendação

export type ThemeId = 'motivacao' | 'luta' | 'emocional' | 'epico' | 'romantico' | 'letra';

export interface Theme {
  id: ThemeId;
  label: string;
  description: string;
  emotions: string[];
  bpm: [number, number];
  intensity: [number, number];
  wantsDrop: boolean;
  wantsBuild: boolean;
}

export const THEMES: Theme[] = [
  { id: 'motivacao', label: 'Motivação / Superação', description: 'Começa contido e cresce até uma virada forte.', emotions: ['motivação', 'épica'], bpm: [80, 150], intensity: [45, 85], wantsDrop: true, wantsBuild: true },
  { id: 'luta', label: 'Luta / Hype', description: 'Rápida e pesada, drop cedo, energia o tempo todo.', emotions: ['luta', 'sombria'], bpm: [125, 185], intensity: [65, 100], wantsDrop: true, wantsBuild: false },
  { id: 'emocional', label: 'Triste / Emocional', description: 'Lenta, suave, sem explosões.', emotions: ['triste', 'calma'], bpm: [55, 105], intensity: [0, 50], wantsDrop: false, wantsBuild: false },
  { id: 'epico', label: 'Épico', description: 'Longa construção, várias partes, final grande.', emotions: ['épica', 'motivação'], bpm: [70, 160], intensity: [50, 90], wantsDrop: true, wantsBuild: true },
  { id: 'romantico', label: 'Romântico', description: 'Ritmo médio, calorosa, sem peso.', emotions: ['romântica', 'feliz'], bpm: [65, 120], intensity: [25, 65], wantsDrop: false, wantsBuild: false },
  { id: 'letra', label: 'Letra na tela', description: 'Batida clara e firme, boa para trocar palavra a cada corte.', emotions: [], bpm: [90, 170], intensity: [40, 95], wantsDrop: true, wantsBuild: false },
];

/** Estilo do Gerar meu AMV → tema de música. */
export const STYLE_THEME: Record<string, ThemeId> = { hype: 'luta', rapido: 'luta', superacao: 'motivacao', letra: 'letra', discurso: 'motivacao', emocional: 'emocional' };

export interface Recommendation {
  track: LibraryTrack;
  score: number;
  reasons: string[];
}

export interface SceneFitProfile {
  intensities: number[];
  lowI: number;
  highI: number;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function rangeFit(v: number, [lo, hi]: [number, number], soft: number): number {
  if (v >= lo && v <= hi) return 1;
  const d = v < lo ? lo - v : v - hi;
  return Math.max(0, 1 - d / soft);
}

/** Pontua uma faixa para um tema. Só usa dados medidos e etiquetas do usuário. */
export function scoreTrack(t: LibraryTrack, theme: Theme, targetDurationS?: number, sceneFit?: SceneFitProfile | null): Recommendation | null {
  const s = t.summary;
  if (!s) return null;
  const reasons: string[] = [];
  // BPM: aceita metade/dobro (muita música de luta é lida como 85 ou 170)
  const bpmCandidates = [s.bpm, s.bpm * 2, s.bpm / 2];
  const bpmFit = Math.max(...bpmCandidates.map((b, i) => rangeFit(b, theme.bpm, 25) * (i === 0 ? 1 : 0.85)));
  if (bpmFit > 0.8) reasons.push(`${Math.round(s.bpm)} BPM combina`);
  const intFit = rangeFit(s.intensity, theme.intensity, 25);
  if (intFit > 0.8) reasons.push(`intensidade ${Math.round(s.intensity)}`);
  let score = 0.35 * bpmFit + (sceneFit?.intensities.length ? 0.1 : 0.35) * intFit;

  const drop = s.drops[0];
  if (theme.wantsDrop) {
    if (drop !== undefined) {
      score += 0.12;
      reasons.push(`drop em ${mmss(drop)}`);
    } else score -= 0.05;
  } else if (drop !== undefined && s.dynamics > 0.45) score -= 0.08;
  if (theme.wantsBuild) {
    score += 0.1 * s.buildUp;
    if (s.buildUp > 0.35) reasons.push(`energia cresce ${Math.round(s.buildUp * 100)}% até o pico`);
  }
  if (sceneFit?.intensities.length && s.energy.length) {
    const samples = 12;
    let distance = 0;
    for (let i = 0; i < samples; i++) {
      const progress = (i + 0.5) / samples;
      const musicIndex = Math.min(s.energy.length - 1, Math.floor(progress * s.energy.length));
      const sceneIndex = Math.min(sceneFit.intensities.length - 1, Math.floor(progress * sceneFit.intensities.length));
      const target = sceneFit.lowI + (sceneFit.highI - sceneFit.lowI) * s.energy[musicIndex]!;
      distance += Math.abs(target - sceneFit.intensities[sceneIndex]!);
    }
    const fit = Math.max(0, 1 - distance / samples);
    score += 0.35 * fit;
    if (fit >= 0.72) reasons.push('curva de energia combina com a sequência de cenas');
  }
  if (theme.id === 'letra' && s.bpmConfidence > 0.5) {
    score += 0.08;
    reasons.push('batida bem marcada');
  }
  if (t.emotion && theme.emotions.includes(t.emotion)) {
    score += 0.25;
    reasons.unshift(`você marcou como ${t.emotion}`);
  } else if (t.emotion && theme.emotions.length) score -= 0.1;
  if (t.favorite) score += 0.04;
  score += 0.02 * t.rating;
  if (targetDurationS && t.durationS < targetDurationS * 0.9) {
    score -= 0.2;
    reasons.push(`curta para ${Math.round(targetDurationS)} s`);
  }
  return { track: t, score: Math.max(0, Math.min(1, score)), reasons };
}

export function recommend(lib: Library, themeId: ThemeId, opts: { limit?: number; targetDurationS?: number; sceneFit?: SceneFitProfile | null } = {}): Recommendation[] {
  const theme = THEMES.find((x) => x.id === themeId)!;
  return lib.tracks
    .filter((t) => t.status === 'ok')
    .map((t) => scoreTrack(t, theme, opts.targetDurationS, opts.sceneFit))
    .filter((r): r is Recommendation => r !== null && r.score > 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 12);
}
