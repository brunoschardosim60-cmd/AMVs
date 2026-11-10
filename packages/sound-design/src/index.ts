import { clipEndUs, type Project } from '@amv/project';

export const SOUND_LIBRARY_VERSION = 1;
export const SOUND_CATEGORIES = ['whoosh', 'impact', 'explosion', 'riser', 'hit', 'ambience', 'transition', 'silence', 'other'] as const;
export type SoundCategory = (typeof SOUND_CATEGORIES)[number];

export const SOUND_CATEGORY_LABEL: Record<SoundCategory, string> = {
  whoosh: 'Whoosh',
  impact: 'Impacto',
  explosion: 'Explosão',
  riser: 'Riser',
  hit: 'Hit / golpe',
  ambience: 'Ambiência',
  transition: 'Transição',
  silence: 'Silêncio intencional',
  other: 'Outro',
};

export interface SoundEntry {
  id: string;
  path: string;
  hash: string;
  name: string;
  durationUs: number;
  category: SoundCategory;
  tags: string[];
  origin: string;
  license: string;
  attribution: string;
  notes: string;
  addedAt: string;
}

export interface SoundLibrary {
  version: number;
  sounds: SoundEntry[];
}

export function emptySoundLibrary(): SoundLibrary {
  return { version: SOUND_LIBRARY_VERSION, sounds: [] };
}

export function parseSoundLibrary(text: string): SoundLibrary {
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || !('sounds' in raw) || !Array.isArray(raw.sounds)) {
    throw new Error('formato inválido da biblioteca de efeitos sonoros');
  }
  if ('version' in raw && (typeof raw.version !== 'number' || raw.version > SOUND_LIBRARY_VERSION)) {
    throw new Error('a biblioteca de efeitos sonoros foi criada por uma versão mais recente do app');
  }
  const sounds = raw.sounds.map((value, index): SoundEntry => {
    if (!value || typeof value !== 'object') throw new Error(`efeito sonoro inválido na posição ${index + 1}`);
    const item = value as Partial<SoundEntry>;
    if (
      typeof item.id !== 'string' || typeof item.path !== 'string' || typeof item.hash !== 'string' ||
      typeof item.name !== 'string' || typeof item.durationUs !== 'number' ||
      !Number.isSafeInteger(item.durationUs) || item.durationUs < 0 ||
      typeof item.category !== 'string' || !SOUND_CATEGORIES.includes(item.category as SoundCategory)
    ) {
      throw new Error(`metadados inválidos para efeito sonoro na posição ${index + 1}`);
    }
    const requiredTextFields = ['origin', 'license', 'attribution', 'notes', 'addedAt'] as const;
    for (const field of requiredTextFields) {
      if (item[field] !== undefined && typeof item[field] !== 'string') {
        throw new Error(`campo ${field} inválido no efeito sonoro "${item.name}"`);
      }
    }
    if (item.tags !== undefined && (!Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== 'string'))) {
      throw new Error(`tags inválidas no efeito sonoro "${item.name}"`);
    }
    return {
      id: item.id,
      path: item.path,
      hash: item.hash,
      name: item.name,
      durationUs: item.durationUs,
      category: item.category as SoundCategory,
      tags: item.tags ?? [],
      origin: item.origin ?? '',
      license: item.license ?? '',
      attribution: item.attribution ?? '',
      notes: item.notes ?? '',
      addedAt: item.addedAt ?? new Date(0).toISOString(),
    };
  });
  return { version: SOUND_LIBRARY_VERSION, sounds };
}

export function filterSounds(library: SoundLibrary, query: string, category: SoundCategory | 'all'): SoundEntry[] {
  const q = query.trim().toLocaleLowerCase();
  return library.sounds.filter((sound) => {
    if (category !== 'all' && sound.category !== category) return false;
    return !q || [sound.name, sound.origin, sound.license, sound.attribution, sound.notes, ...sound.tags]
      .some((value) => value.toLocaleLowerCase().includes(q));
  });
}

export type SoundSuggestionKind = 'impact' | 'hit' | 'whoosh' | 'riser' | 'transition' | 'silence';

export interface SoundSuggestion {
  id: string;
  atUs: number;
  durationUs: number;
  kind: SoundSuggestionKind;
  confidence: number;
  reason: string;
  source: 'drop' | 'downbeat' | 'scene' | 'section';
}

/** Suggestions are based on existing timeline markers and always require explicit user approval. */
export function suggestSoundDesign(project: Project): SoundSuggestion[] {
  const suggestions: SoundSuggestion[] = [];
  for (const marker of project.markers) {
    const confidence = marker.confidence ?? 0;
    if (confidence < 0.6) continue;
    if (marker.kind === 'drop') {
      suggestions.push({ id: `drop:${marker.id}`, atUs: marker.atUs, durationUs: 1_200_000, kind: 'impact', confidence, reason: 'Impacto pontual no drop detectado na análise musical.', source: 'drop' });
    } else if (marker.kind === 'downbeat') {
      const hasDropNearby = project.markers.some((other) => other.kind === 'drop' && Math.abs(other.atUs - marker.atUs) < 800_000);
      if (!hasDropNearby) suggestions.push({ id: `beat:${marker.id}`, atUs: marker.atUs, durationUs: 500_000, kind: 'hit', confidence: confidence * 0.75, reason: 'Acento musical disponível; use com moderação.', source: 'downbeat' });
    } else if (marker.kind === 'scene') {
      const hasCutNearby = project.clips.some((clip) => clip.trackId === project.tracks.find((track) => track.kind === 'video')?.id && Math.abs(clip.timelineStartUs - marker.atUs) < 100_000);
      if (hasCutNearby) suggestions.push({ id: `scene:${marker.id}`, atUs: marker.atUs, durationUs: 650_000, kind: 'whoosh', confidence: confidence * 0.7, reason: 'Mudança de cena alinhada a um corte de vídeo.', source: 'scene' });
    } else if (marker.kind === 'section' && /build|subida|crescimento/i.test(marker.label)) {
      suggestions.push({ id: `section:${marker.id}`, atUs: marker.atUs, durationUs: Math.min(marker.durationUs || 2_000_000, 4_000_000), kind: 'riser', confidence: confidence * 0.65, reason: 'Seção marcada como crescimento na análise musical.', source: 'section' });
    }
  }
  const ordered = suggestions.sort((a, b) => a.atUs - b.atUs);
  const accepted: SoundSuggestion[] = [];
  for (const candidate of ordered) {
    const collision = accepted.some((item) => {
      const aEnd = item.atUs + item.durationUs;
      const bEnd = candidate.atUs + candidate.durationUs;
      return candidate.atUs < aEnd && item.atUs < bEnd;
    });
    if (!collision) accepted.push(candidate);
  }
  return accepted;
}

export function soundClipEndUs(project: Project, trackId: string): number {
  return project.clips.filter((clip) => clip.trackId === trackId).reduce((end, clip) => Math.max(end, clipEndUs(clip)), 0);
}
