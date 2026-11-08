import { describe, expect, it } from 'vitest';
import { characterCounts, shotKey, type EpisodeVision } from '@amv/analysis';
import { PRESETS, labelScenes, parseSceneLabels, type FetchLike } from '../src/index.js';

const ollama = { ...PRESETS.find((p) => p.id === 'ollama')! };
const anthropic = { ...PRESETS.find((p) => p.id === 'anthropic')! };

/** Modelo falso: recebe o corpo da requisição e responde. */
function fake(reply: (body: any, call: number) => string, kind: 'openai' | 'anthropic' = 'openai') {
  const bodies: any[] = [];
  const f: FetchLike = async (_u, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const text = reply(body, bodies.length);
    const json = kind === 'openai' ? { choices: [{ message: { content: text } }], usage: { prompt_tokens: 100, completion_tokens: 20 } } : { content: [{ type: 'text', text }], usage: { input_tokens: 100, output_tokens: 20 } };
    return { ok: true, status: 200, text: async () => JSON.stringify(json) };
  };
  return { f, bodies };
}
const frames = (n: number) => Array.from({ length: n }, (_, i) => ({ id: shotKey(i * 3), jpegBase64: `IMG${i}` }));
const asked = (body: any): string => (typeof body.messages.at(-1).content === 'string' ? body.messages.at(-1).content : body.messages.at(-1).content.find((c: any) => c.type === 'text').text);
const nImages = (body: any): number => (body.messages.at(-1).content as any[]).filter((c) => c.type === 'image_url').length;

describe('imagens para o modelo', () => {
  it('OpenAI/Ollama: texto + image_url com data URI', async () => {
    const m = fake(() => '[{"i":1,"characters":["A"],"fight":true,"note":"x"}]');
    await labelScenes(ollama, null, m.f, frames(1));
    const c = m.bodies[0].messages.at(-1).content;
    expect(c[0]).toMatchObject({ type: 'text' });
    expect(c[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,IMG0' } });
  });

  it('Anthropic: blocos image base64 antes do texto', async () => {
    const m = fake(() => '[{"i":1,"characters":[],"fight":false,"note":""}]', 'anthropic');
    await labelScenes({ ...anthropic }, 'k', m.f, frames(1));
    const c = m.bodies[0].messages.at(-1).content;
    expect(c[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'IMG0' } });
    expect(c.at(-1).type).toBe('text');
  });
});

describe('rotular cenas', () => {
  const reply = (body: any) => JSON.stringify(Array.from({ length: nImages(body) }, (_, k) => ({ i: k + 1, characters: ['Goku'], fight: true, note: 'soco' })));

  it('divide em lotes de 6 e devolve um rótulo por cena', async () => {
    const m = fake(reply);
    const seen: number[] = [];
    const r = await labelScenes(ollama, null, m.f, frames(14), { onProgress: (d) => seen.push(d) });
    expect(m.bodies).toHaveLength(3);
    expect(m.bodies.map(nImages)).toEqual([6, 6, 2]);
    expect(Object.keys(r.labels)).toHaveLength(14);
    expect(seen).toEqual([6, 12, 14]);
    expect(r.usage).toEqual({ input: 300, output: 60 });
  });

  it('rótulos consistentes: "goku", "Goku " e "GOKU" viram um só; o lote seguinte recebe a lista dos já usados', async () => {
    const names = ['Goku', 'goku ', 'GOKU', 'Vegeta', 'vegeta', 'Garoto de cabelo laranja'];
    const m = fake((b, call) => JSON.stringify(Array.from({ length: nImages(b) }, (_, k) => ({ i: k + 1, characters: [names[(call * 3 + k) % names.length]], fight: true, note: '' }))));
    const r = await labelScenes(ollama, null, m.f, frames(12), { batchSize: 4 });
    expect(r.characters.map((c) => c.toLowerCase().trim()).filter((c, i, a) => a.indexOf(c) === i)).toEqual(r.characters.map((c) => c.toLowerCase().trim()));
    expect(new Set(Object.values(r.labels).flatMap((l) => l.characters)).size).toBe(r.characters.length);
    expect(asked(m.bodies[0])).toMatch(/\(nenhum ainda\)/);
    expect(asked(m.bodies[1])).toMatch(/Rótulos já usados: \[/);
  });

  it('retomada: rótulos conhecidos entram no pedido e prevalecem na grafia', async () => {
    const m = fake(() => '[{"i":1,"characters":["vegeta"],"fight":true,"note":""}]');
    const r = await labelScenes(ollama, null, m.f, frames(1), { known: ['Vegeta'] });
    expect(asked(m.bodies[0])).toContain('"Vegeta"');
    expect(r.labels[frames(1)[0]!.id]!.characters).toEqual(['Vegeta']);
  });

  it('modelo esqueceu uma imagem: tenta de novo só para completar e mantém as boas', async () => {
    const m = fake((b, call) => (call === 1 ? '[{"i":1,"characters":["A"],"fight":true,"note":""},{"i":3,"characters":["B"],"fight":false,"note":""}]' : '[{"i":2,"characters":["C"],"fight":true,"note":""}]'));
    const r = await labelScenes(ollama, null, m.f, frames(3));
    expect(m.bodies).toHaveLength(2);
    expect(asked(m.bodies[1])).toMatch(/não cobriu/);
    expect(r.failed).toEqual([]);
    expect(Object.values(r.labels).map((l) => l.characters[0])).toEqual(['A', 'C', 'B']);
  });

  it('resposta inútil duas vezes: cenas ficam em "failed" e as outras lotes seguem', async () => {
    // as duas tentativas do 1º lote vêm inúteis; os lotes seguintes respondem bem
    const m = fake((b, call) => (call <= 2 ? 'não consigo ver imagens' : reply(b)));
    const r = await labelScenes(ollama, null, m.f, frames(12), { batchSize: 6 });
    expect(r.failed).toHaveLength(6);
    expect(Object.keys(r.labels)).toHaveLength(6);
  });

  it('no máximo 4 personagens por cena; sem repetir; sem vazios', async () => {
    const m = fake(() => '[{"i":1,"characters":["a","A","b","c","d","e"," "],"fight":true,"note":"n"}]');
    const r = await labelScenes(ollama, null, m.f, frames(1));
    expect(Object.values(r.labels)[0]!.characters).toEqual(['a', 'b', 'c', 'd']);
  });

  it('cancelar interrompe', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(labelScenes(ollama, null, fake(reply).f, frames(3), { signal: ac.signal })).rejects.toThrow();
  });

  it('parse: ignora índice fora da faixa, duplicado e fight que não é booleano', () => {
    const p = parseSceneLabels('[{"i":0,"fight":true},{"i":1,"fight":true,"characters":["x"]},{"i":1,"fight":false},{"i":2,"fight":"sim"},{"i":9,"fight":true}]', 3);
    expect([...p.keys()]).toEqual([1]);
    expect(p.get(1)!.fight).toBe(true);
  });
});

describe('contagem de personagens', () => {
  it('ordena do mais ao menos presente, juntando grafias', () => {
    const v: EpisodeVision = {
      version: 'v1',
      model: 't',
      shots: { t0: { characters: ['Goku', 'Vegeta'], fight: true, note: '' }, t1: { characters: ['goku'], fight: true, note: '' }, t2: { characters: ['Vegeta'], fight: false, note: '' }, t3: { characters: ['Goku'], fight: true, note: '' } },
    };
    expect(characterCounts(v)).toEqual([{ name: 'Goku', shots: 3 }, { name: 'Vegeta', shots: 2 }]);
    expect(characterCounts(null)).toEqual([]);
  });
});
