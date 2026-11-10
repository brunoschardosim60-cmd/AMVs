import { createProject } from '@amv/project';
import { describe, expect, it } from 'vitest';
import {
  emptySoundLibrary,
  filterSounds,
  parseSoundLibrary,
  suggestSoundDesign,
  type SoundEntry,
} from '../src/index.js';

const sound: SoundEntry = {
  id: 'snd_1',
  path: 'C:\\sons\\impacto.wav',
  hash: 'sha256:one',
  name: 'Impacto grave',
  durationUs: 800_000,
  category: 'impact',
  tags: ['luta', 'grave'],
  origin: 'Biblioteca local',
  license: 'CC BY 4.0',
  attribution: 'Artista',
  notes: '',
  addedAt: '2026-11-10T12:00:00.000Z',
};

describe('biblioteca de sound design', () => {
  it('inicializa e faz round-trip preservando os metadados de licença', () => {
    const library = { ...emptySoundLibrary(), sounds: [sound] };
    expect(parseSoundLibrary(JSON.stringify(library))).toEqual(library);
  });

  it('rejeita JSON e itens inválidos em vez de substituir a biblioteca por uma vazia', () => {
    expect(() => parseSoundLibrary('{')).toThrow();
    expect(() => parseSoundLibrary(JSON.stringify({ sounds: [{ id: 'broken' }] }))).toThrow(/metadados inválidos/);
  });

  it('busca em metadados e tags sem diferenciar maiúsculas', () => {
    const library = { ...emptySoundLibrary(), sounds: [sound] };
    expect(filterSounds(library, 'cc by 4.0', 'all').map((item) => item.id)).toEqual(['snd_1']);
    expect(filterSounds(library, 'GRAVE', 'impact').map((item) => item.id)).toEqual(['snd_1']);
    expect(filterSounds(library, 'luta', 'whoosh')).toEqual([]);
  });
});

describe('sugestões de sound design', () => {
  it('considera apenas marcadores com confiança e não propõe áudio automaticamente', () => {
    const project = createProject({ name: 'Teste' });
    project.markers = [
      { id: 'drop', kind: 'drop', atUs: 5_000_000, durationUs: 0, label: 'Drop', color: null, origin: 'ai', confidence: 0.9 },
      { id: 'uncertain', kind: 'drop', atUs: 9_000_000, durationUs: 0, label: '', color: null, origin: 'ai', confidence: 0.3 },
    ];

    expect(suggestSoundDesign(project)).toEqual([
      expect.objectContaining({ id: 'drop:drop', kind: 'impact', atUs: 5_000_000, confidence: 0.9 }),
    ]);
    expect(project.clips).toEqual([]);
  });

  it('evita empilhar sugestões concorrentes e limita acentos em downbeats próximos a drops', () => {
    const project = createProject({ name: 'Teste' });
    project.markers = [
      { id: 'drop', kind: 'drop', atUs: 5_000_000, durationUs: 0, label: '', color: null, origin: 'ai', confidence: 0.9 },
      { id: 'beat-near', kind: 'downbeat', atUs: 5_200_000, durationUs: 0, label: '', color: null, origin: 'ai', confidence: 0.9 },
      { id: 'beat-far', kind: 'downbeat', atUs: 8_000_000, durationUs: 0, label: '', color: null, origin: 'ai', confidence: 0.8 },
    ];

    expect(suggestSoundDesign(project).map((item) => item.id)).toEqual(['drop:drop', 'beat:beat-far']);
  });
});
