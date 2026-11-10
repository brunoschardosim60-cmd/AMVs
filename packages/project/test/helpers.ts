import { createProject, newId, type Asset, type Clip, type Project } from '../src/index.js';

export function videoAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: newId('ast'),
    name: 'ep01.mkv',
    path: '/midia/ep01.mkv',
    hash: 'v1:abc',
    kind: 'video',
    probe: null,
    status: 'ok',
    error: null,
    importedAt: '2026-11-06T00:00:00.000Z',
    tags: [],
    favorite: false,
    ...overrides,
  };
}

export function audioAsset(overrides: Partial<Asset> = {}): Asset {
  return videoAsset({ name: 'musica.flac', path: '/midia/musica.flac', kind: 'audio', hash: 'v1:def', ...overrides });
}

export function track(project: Project, name: string) {
  const t = project.tracks.find((x) => x.name === name);
  if (!t) throw new Error(`sem trilha ${name}`);
  return t;
}

export function clip(trackId: string, assetId: string, overrides: Partial<Clip> = {}): Clip {
  return {
    id: newId('clp'),
    trackId,
    assetId,
    timelineStartUs: 0,
    durationUs: 2_000_000,
    sourceInUs: 10_000_000,
    sourceOutUs: 12_000_000,
    speed: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
    blendMode: 'normal',
    mask: 'none',
    groupId: null,
    audio: { gainDb: 0, fadeInUs: 0, fadeOutUs: 0, pitchSemitones: 0, pitchMode: 'preserve', streamIndex: null },
    effects: [],
    transitionIn: null,
    keyframes: {},
    text: null,
    origin: 'user',
    reason: null,
    confidence: null,
    label: null,
    ...overrides,
    reverse: overrides.reverse ?? false,
  };
}

export function baseProject(): Project {
  return createProject({ name: 'Teste', now: new Date('2026-11-06T12:00:00Z') });
}
