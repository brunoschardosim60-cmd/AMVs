import { describe, expect, it } from 'vitest';
import { mergeLyricMatches } from '@amv/automv';
import { parseSceneSuggestions, suggestScenes, suggestionsToLyricMatches, type SuggestionLyric, type SuggestionScene } from './sceneSuggest';
import type { FetchLike } from './providers';

const scenes: SuggestionScene[] = [
  { id: 'ep1@10', episode: 'Ep 1', startS: 10, endS: 14, intensity: 0.9, motion: 0.8, tags: ['luta'] },
  { id: 'ep1@20', episode: 'Ep 1', startS: 20, endS: 22, intensity: 0.2, motion: 0.1, tags: [], line: 'Eu não vou desistir' },
];
const lyrics: SuggestionLyric[] = [
  { key: 'k0', text: 'Eu vou vencer', startS: 0, endS: 2 },
  { key: 'k1', text: 'Sozinho na chuva', startS: 2, endS: 5 },
];

describe('scene suggestions', () => {
  it('maps short ids to real scenes and verses and drops unknown ones', () => {
    const r = parseSceneSuggestions(
      'ok ```json [{"lyric":"v0","scene":"c0","in":11,"out":13,"score":0.8,"reason":"golpe"},{"lyric":"v9","scene":"c0"},{"lyric":"v1","scene":"c7"}] ```',
      scenes,
      lyrics,
    )!;
    expect(r.suggestions).toEqual([{ lyricKey: 'k0', sceneId: 'ep1@10', inS: 11, outS: 13, score: 0.8, reason: 'golpe' }]);
    expect(r.discarded).toBe(2);
  });

  it('keeps cut points inside the real scene', () => {
    const r = parseSceneSuggestions('[{"lyric":"v1","scene":"c1","in":5,"out":99}]', scenes, lyrics)!;
    expect(r.suggestions[0]!.inS).toBe(20);
    expect(r.suggestions[0]!.outS).toBe(22);
  });

  it('caps model confidence so it cannot override rhythm and energy', () => {
    const r = parseSceneSuggestions('[{"lyric":"v0","scene":"c0","score":5},{"lyric":"v1","scene":"c1","score":0}]', scenes, lyrics)!;
    expect(r.suggestions.map((s) => s.score)).toEqual([0.9, 0.55]);
  });

  it('allows at most two scenes per verse', () => {
    const extra = [...scenes, { ...scenes[0]!, id: 'ep2@0', startS: 0, endS: 3 }];
    const r = parseSceneSuggestions('[{"lyric":"v0","scene":"c0"},{"lyric":"v0","scene":"c1"},{"lyric":"v0","scene":"c2"}]', extra, lyrics)!;
    expect(r.suggestions).toHaveLength(2);
  });

  it('retries once when the model answers without JSON and reports usage', async () => {
    const answers = ['não sei', '[{"lyric":"v1","scene":"c1","in":20,"out":21.5,"reason":"tristeza"}]'];
    const fetch: FetchLike = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: answers.shift() } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) });
    const r = await suggestScenes({ name: 'Ollama', kind: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'x', needsKey: false }, null, fetch, { mood: 'melancólico', lyrics, scenes });
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]!.sceneId).toBe('ep1@20');
    expect(r.usage).toEqual({ input: 20, output: 10 });
  });

  it('adds AI suggestions without erasing local lyric matches', () => {
    const merged = mergeLyricMatches(
      { 'ep1@10': { k0: { score: 0.6, reason: 'local' } }, 'ep1@20': { k1: { score: 0.6, reason: 'local' } } },
      suggestionsToLyricMatches([{ lyricKey: 'k0', sceneId: 'ep1@10', inS: 10, outS: 12, score: 0.8, reason: 'golpe' }]),
    )!;
    expect(merged['ep1@10']!.k0!.score).toBe(0.8);
    expect(merged['ep1@20']!.k1!.reason).toBe('local');
    expect(mergeLyricMatches({ a: { k: { score: 0.6, reason: 'l' } } }, {})!.a!.k!.score).toBe(0.6);
  });
});

import { frameLegend, pickFrameScenes } from './sceneSuggest';
describe('quadros nas sugestões', () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `ep@${i}`, episode: 'ep', startS: i, endS: i + 1, intensity: 0.5, motion: 0.5, tags: [] }));
  it('limita a 16 cenas espalhadas', () => {
    const p = pickFrameScenes(mk(40));
    expect(p).toHaveLength(16);
    expect(p[0]!.id).toBe('ep@0');
    expect(p[15]!.id).toBe('ep@37');
  });
  it('legenda liga cada imagem à cena certa e ignora cenas inexistentes', () => {
    const l = frameLegend(mk(5), [{ sceneId: 'ep@3', jpegBase64: 'a' }, { sceneId: 'x', jpegBase64: 'b' }, { sceneId: 'ep@1', jpegBase64: 'c' }]);
    expect(l.images).toEqual(['imagem 1 = cena c3', 'imagem 2 = cena c1']);
  });
});
