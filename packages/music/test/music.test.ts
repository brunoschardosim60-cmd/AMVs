import { describe, expect, it } from 'vitest';
import type { MusicAnalysis } from '@amv/analysis';
import { emptyLibrary, filterTracks, newTrack, parseLibrary, recommend, sortTracks, summarize, type LibraryTrack } from '../src/index.js';

function analysis(bpm: number, level: (t: number) => number, dur: number, drops: number[]): MusicAnalysis {
  const energy = Array.from({ length: dur * 4 }, (_, i) => level(i / 4));
  return { version: 'm1', durationS: dur, bpm, bpmConfidence: 0.8, beats: [], downbeats: [], energy, energyStepS: 0.25, sections: [], drops, intensity: Math.round((energy.reduce((a, b) => a + b, 0) / energy.length) * 100), loudnessDb: -10 };
}
function track(id: string, a: MusicAnalysis, extra: Partial<LibraryTrack> = {}): LibraryTrack {
  return { ...newTrack(id, `/m/${id}.mp3`, id, a.durationS, { TITLE: id.toUpperCase(), artist: 'X' }, '2026-01-0' + id.length + 'T00:00:00Z'), summary: summarize(a), ...extra };
}

const lib = emptyLibrary();
lib.tracks = [
  track('luta', analysis(170, () => 0.85, 180, [20])),
  track('triste', analysis(72, () => 0.25, 200, [])),
  track('cresce', analysis(120, (t) => (t < 60 ? 0.3 : 0.8), 200, [60])),
  track('curta', analysis(150, () => 0.8, 25, [5])),
];
lib.playlists = [{ id: 'p', name: 'AMV 1', trackIds: ['triste'], createdAt: '' }];

describe('biblioteca', () => {
  it('lê tags e resume a análise', () => {
    const t = lib.tracks[0]!;
    expect(t.title).toBe('LUTA');
    expect(t.artist).toBe('X');
    expect(t.summary!.energy).toHaveLength(160);
    expect(lib.tracks[2]!.summary!.buildUp).toBeGreaterThan(0.4);
  });

  it('filtra por BPM, intensidade, drop, busca e playlist', () => {
    expect(filterTracks(lib, { bpm: [100, 160] }).map((t) => t.id)).toEqual(['cresce', 'curta']);
    expect(filterTracks(lib, { intensity: [0, 40] }).map((t) => t.id)).toEqual(['triste']);
    expect(filterTracks(lib, { hasDrop: true }).length).toBe(3);
    expect(filterTracks(lib, { query: 'cres' }).map((t) => t.id)).toEqual(['cresce']);
    expect(filterTracks(lib, { playlistId: 'p' }).map((t) => t.id)).toEqual(['triste']);
  });

  it('ordena', () => {
    expect(sortTracks(lib.tracks, 'bpm', true).map((t) => t.id)).toEqual(['luta', 'curta', 'cresce', 'triste']);
  });

  it('arquivo corrompido vira biblioteca vazia (nunca trava)', () => {
    expect(parseLibrary('{oops').tracks).toEqual([]);
    expect(parseLibrary(JSON.stringify({ tracks: [{ path: '/a.mp3', id: 'a', hash: 'h', name: 'a.mp3' }] })).tracks[0]!.tags).toEqual([]);
  });
});

describe('recomendação por tema', () => {
  it('luta → a rápida e pesada; triste → a lenta; motivação → a que cresce', () => {
    expect(recommend(lib, 'luta')[0]!.track.id).toBe('luta');
    expect(recommend(lib, 'emocional')[0]!.track.id).toBe('triste');
    expect(recommend(lib, 'motivacao', { targetDurationS: 60 })[0]!.track.id).toBe('cresce');
  });

  it('justificativa vem dos dados', () => {
    const r = recommend(lib, 'luta')[0]!;
    expect(r.reasons.join(' · ')).toMatch(/170 BPM combina.*drop em 0:20/);
  });

  it('etiqueta de emoção do usuário pesa', () => {
    const l = { ...lib, tracks: lib.tracks.map((t) => (t.id === 'triste' ? { ...t, emotion: 'luta' } : t)) };
    const r = recommend(l, 'luta');
    expect(r.find((x) => x.track.id === 'triste')?.reasons[0]).toBe('você marcou como luta');
  });

  it('música curta demais para o vídeo perde pontos', () => {
    const r = recommend(lib, 'luta', { targetDurationS: 60 });
    expect(r.findIndex((x) => x.track.id === 'curta')).not.toBe(0);
  });

  it('classifica pela progressão de energia compatível com as cenas', () => {
    const flat = track('flat', analysis(120, () => 0.55, 180, [60]));
    const rising = track('rising', analysis(120, (t) => 0.1 + (0.9 * t) / 180, 180, [60]));
    const scenes = Array.from({ length: 12 }, (_, i) => 0.1 + (0.9 * i) / 11);
    const result = recommend({ ...emptyLibrary(), tracks: [flat, rising] }, 'letra', {
      sceneFit: { intensities: scenes, lowI: 0.1, highI: 1 },
    });
    expect(result[0]!.track.id).toBe('rising');
    expect(result[0]!.reasons).toContain('curva de energia combina com a sequência de cenas');
  });
});
