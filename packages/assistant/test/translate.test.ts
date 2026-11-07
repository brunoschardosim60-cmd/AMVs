import { describe, expect, it } from 'vitest';
import { PRESETS, parseTranslationArray, translateLines, type FetchLike } from '../src/index.js';

const cfg = { ...PRESETS.find((p) => p.id === 'ollama')! };

/** Modelo falso: responde conforme `reply(userContent, chamada)`. */
function fake(reply: (user: string, call: number) => string) {
  const calls: { user: string; system: string }[] = [];
  const f: FetchLike = async (_url, init) => {
    const body = JSON.parse(init.body) as { messages: { role: string; content: string }[] };
    const user = body.messages.filter((m) => m.role === 'user').at(-1)!.content;
    calls.push({ user, system: body.messages[0]!.content });
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: reply(user, calls.length) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
  };
  return { f, calls };
}
const lines = (user: string) => JSON.parse(user.split('\n\n')[0]!) as string[];

describe('tradução de legendas', () => {
  it('uma tradução por linha, na ordem, com o idioma no pedido', async () => {
    const m = fake((u) => JSON.stringify(lines(u).map((l) => `[en] ${l}`)));
    const r = await translateLines(cfg, null, m.f, ['Eu vou vencer!', 'Não desisto'], { target: 'inglês', source: 'português' });
    expect(r.translations).toEqual(['[en] Eu vou vencer!', '[en] Não desisto']);
    expect(r.failed).toBe(0);
    expect(m.calls[0]!.system).toMatch(/para inglês/);
    expect(m.calls[0]!.system).toMatch(/de português/);
    expect(r.usage).toEqual({ input: 10, output: 5 });
  });

  it('divide em lotes e mantém a ordem; avisa o progresso', async () => {
    const m = fake((u) => JSON.stringify(lines(u).map((l) => l.toUpperCase())));
    const input = Array.from({ length: 45 }, (_, i) => `linha ${i}`);
    const seen: number[] = [];
    const r = await translateLines(cfg, null, m.f, input, { target: 'es', onProgress: (d) => seen.push(d) });
    expect(m.calls).toHaveLength(3);
    expect(r.translations).toEqual(input.map((l) => l.toUpperCase()));
    expect(seen).toEqual([20, 40, 45]);
  });

  it('aceita JSON dentro de cerca de código e texto em volta', async () => {
    const m = fake(() => 'Claro! Aqui está:\n```json\n["Hello", "Bye"]\n```');
    const r = await translateLines(cfg, null, m.f, ['Olá', 'Tchau'], { target: 'en' });
    expect(r.translations).toEqual(['Hello', 'Bye']);
  });

  it('número errado de itens: tenta de novo e aceita a segunda resposta', async () => {
    const m = fake((u, n) => (n === 1 ? '["só uma"]' : JSON.stringify(lines(u).map((l) => `ok ${l}`))));
    const r = await translateLines(cfg, null, m.f, ['a', 'b', 'c'], { target: 'en' });
    expect(m.calls).toHaveLength(2);
    expect(m.calls[1]!.user).toMatch(/exatamente 3 itens/);
    expect(r.translations).toEqual(['ok a', 'ok b', 'ok c']);
    expect(r.failed).toBe(0);
  });

  it('falha duas vezes: linhas voltam null (mantém o original) e o resto do vídeo continua', async () => {
    const m = fake((u) => (u.includes('ruim') ? 'não sei' : JSON.stringify(lines(u).map((l) => `T ${l}`))));
    const input = [...Array.from({ length: 20 }, () => 'ruim'), 'boa', 'boa2'];
    const r = await translateLines(cfg, null, m.f, input, { target: 'en' });
    expect(r.failed).toBe(20);
    expect(r.translations.slice(0, 20).every((t) => t === null)).toBe(true);
    expect(r.translations.slice(20)).toEqual(['T boa', 'T boa2']);
  });

  it('linha cheia que volta vazia conta como erro (modelo engoliu a fala)', async () => {
    const m = fake(() => '["", "ok"]');
    const r = await translateLines(cfg, null, m.f, ['fala', 'outra'], { target: 'en' });
    expect(r.failed).toBe(2);
  });

  it('cancelar interrompe; sem chave dá erro claro', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(translateLines(cfg, null, fake(() => '[]').f, ['a'], { target: 'en', signal: ac.signal })).rejects.toThrow();
    await expect(translateLines({ ...cfg, needsKey: true }, null, fake(() => '[]').f, ['a'], { target: 'en' })).rejects.toThrow(/chave/);
  });

  it('parse: rejeita o que não é array do tamanho certo', () => {
    expect(parseTranslationArray('["a","b"]', 2)).toEqual(['a', 'b']);
    expect(parseTranslationArray('["a"]', 2)).toBeNull();
    expect(parseTranslationArray('{"a":1}', 1)).toBeNull();
    expect(parseTranslationArray('[{"x":1}]', 1)).toBeNull();
    expect(parseTranslationArray('sem json', 1)).toBeNull();
  });
});
