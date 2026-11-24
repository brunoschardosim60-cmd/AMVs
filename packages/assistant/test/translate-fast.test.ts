import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../src/providers.js';
import { clearFreeTranslationCache, translateLinesFree } from '../src/translate.js';

function countingFetch() {
  const urls: string[] = [];
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    const q = new URL(url).searchParams.get('q') ?? '';
    const mapped = q.split('\n').map((line) => `PT:${line}`).join('\n');
    return { ok: true, status: 200, text: async () => JSON.stringify([[[mapped, q]]]) };
  };
  return { fetch, urls };
}

describe('tradução gratuita rápida', () => {
  it('traduz 40 linhas em poucos pedidos, pula texto em português e reaproveita o cache', async () => {
    clearFreeTranslationCache();
    const { fetch, urls } = countingFetch();
    const lines = Array.from({ length: 40 }, (_, i) => `What the hell is this ${i}?!`);
    lines.push('Eu não vou desistir!', '...', '');
    const progress: number[] = [];
    const r = await translateLinesFree(fetch, lines, { target: 'Português (Brasil)', onProgress: (d) => progress.push(d) });
    expect(r.failed).toBe(0);
    expect(urls.length).toBeLessThanOrEqual(6);
    expect(r.translations[0]).toBe('PT:What the hell is this 0?!');
    expect(r.translations[40]).toBe('Eu não vou desistir!');
    expect(r.translations[41]).toBe('...');
    expect(progress.at(-1)).toBe(lines.length);

    const before = urls.length;
    const again = await translateLinesFree(fetch, lines, { target: 'Português (Brasil)' });
    expect(urls.length).toBe(before);
    expect(again.translations).toEqual(r.translations);
  });

  it('linhas repetidas viram um único pedido', async () => {
    clearFreeTranslationCache();
    const { fetch, urls } = countingFetch();
    const r = await translateLinesFree(fetch, Array(20).fill('Never give up'), { target: 'pt' });
    expect(urls).toHaveLength(1);
    expect(new Set(r.translations).size).toBe(1);
  });
});
