import { CURRENT_SCHEMA_VERSION, type Project, type ProjectSettings, type Rational, type Track } from './schema.js';

export function newId(prefix: string): string {
  const uuid = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `${prefix}_${uuid}`;
}

export interface FormatPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const FORMAT_PRESETS: FormatPreset[] = [
  { id: '1080p', label: 'Full HD 1920×1080', width: 1920, height: 1080 },
  { id: '1440p', label: 'QHD 2560×1440', width: 2560, height: 1440 },
  { id: '4k', label: '4K 3840×2160', width: 3840, height: 2160 },
  { id: 'vertical', label: 'Vertical 1080×1920', width: 1080, height: 1920 },
  { id: 'square', label: 'Quadrado 1080×1080', width: 1080, height: 1080 },
];

export const FPS_PRESETS: { label: string; fps: Rational }[] = [
  { label: '23,976', fps: { num: 24000, den: 1001 } },
  { label: '24', fps: { num: 24, den: 1 } },
  { label: '25', fps: { num: 25, den: 1 } },
  { label: '29,97', fps: { num: 30000, den: 1001 } },
  { label: '30', fps: { num: 30, den: 1 } },
  { label: '60', fps: { num: 60, den: 1 } },
];

export function defaultTracks(): Track[] {
  const base = { locked: false, hidden: false, muted: false, solo: false, gainDb: 0 };
  return [
    { ...base, id: newId('trk'), kind: 'text', name: 'Legendas', role: null },
    { ...base, id: newId('trk'), kind: 'video', name: 'V2', role: null },
    { ...base, id: newId('trk'), kind: 'video', name: 'V1', role: null },
    { ...base, id: newId('trk'), kind: 'audio', name: 'Música', role: 'music' },
    { ...base, id: newId('trk'), kind: 'audio', name: 'Vozes', role: 'voice' },
    { ...base, id: newId('trk'), kind: 'audio', name: 'Efeitos', role: 'sfx' },
  ];
}

export interface CreateProjectOptions {
  name: string;
  settings?: Partial<ProjectSettings>;
  now?: Date;
}

export function createProject({ name, settings, now = new Date() }: CreateProjectOptions): Project {
  const iso = now.toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: newId('prj'),
    name: name.trim() || 'Projeto sem nome',
    createdAt: iso,
    updatedAt: iso,
    settings: {
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      sampleRate: 48000,
      background: '#000000',
      ...settings,
    },
    assets: [],
    tracks: defaultTracks(),
    clips: [],
    markers: [],
    analysis: [],
    versions: [],
  };
}
