import { describe, expect, it } from 'vitest';
import type { EpisodeAnalysis, MusicAnalysis, Shot } from '@amv/analysis';
import { applyCommand, clipEndUs, createProject, insertAsset, type Asset, type Project } from '@amv/project';
import { chat, closeSelection, fetchWithTimeout, findWeakPoints, listModels, localTurn, parseAnthropic, PRESETS, projectSummary, runTurn, validateSelection, type AssistantContext, type FetchLike } from '../src/index.js';

const S = 1_000_000;
function setup(): AssistantContext {
  let p: Project = createProject({ name: 't', settings: { width: 1920, height: 1080, fps: { num: 30, den: 1 } } });
  const asset = (id: string, kind: Asset['kind'], dur: number): Asset => ({
    id, name: `${id}.x`, path: `/m/${id}`, hash: id, kind, status: 'ok', error: null, importedAt: '', tags: [], favorite: false,
    probe: { container: 'x', durationUs: dur * S, sizeBytes: 1, bitRate: null, video: kind === 'video' ? { codec: 'h264', profile: null, width: 1920, height: 1080, pixFmt: null, bitDepth: 8, fps: { num: 24, den: 1 }, avgFps: null, vfr: false, frameCount: null } : null, audio: [{ index: 1, codec: 'aac', sampleRate: 48000, channels: 2, channelLayout: null, language: null, title: null }], subtitles: [], tags: {} },
  });
  for (const a of [asset('mus', 'audio', 60), asset('ep', 'video', 600)]) p = applyCommand(p, { type: 'asset.add', asset: a }).project;
  const track = (n: string) => p.tracks.find((t) => t.name === n)!.id;
  // música inteira; vídeo: 0–4 s (cena 10), 4.1–8 s (corte fora da batida), 8–12 repetindo a cena 10
  p = applyCommand(p, { type: 'batch', commands: insertAsset(p, { assetId: 'mus', trackId: track('Música'), startUs: 0 }) }).project;
  p = applyCommand(p, { type: 'batch', commands: insertAsset(p, { assetId: 'ep', trackId: track('V1'), startUs: 0, sourceInUs: 10 * S, sourceOutUs: 14 * S }) }).project;
  p = applyCommand(p, { type: 'batch', commands: insertAsset(p, { assetId: 'ep', trackId: track('V1'), startUs: 4.1 * S, sourceInUs: 100 * S, sourceOutUs: 103.9 * S }) }).project;
  p = applyCommand(p, { type: 'batch', commands: insertAsset(p, { assetId: 'ep', trackId: track('V1'), startUs: 8 * S, sourceInUs: 10 * S, sourceOutUs: 14 * S }) }).project;
  const beats = Array.from({ length: 120 }, (_, i) => i * 0.5);
  const music: MusicAnalysis = { version: 'm1', durationS: 60, bpm: 120, bpmConfidence: 0.9, beats, downbeats: beats.filter((_, i) => i % 4 === 0), energy: Array.from({ length: 240 }, (_, i) => (i < 40 ? 0.3 : 0.9)), energyStepS: 0.25, sections: [{ startS: 0, endS: 10, label: 'intro', energy: 0.3 }, { startS: 10, endS: 60, label: 'drop', energy: 0.9 }], drops: [10], intensity: 70, loudnessDb: -10 };
  const shots: Shot[] = Array.from({ length: 150 }, (_, i) => ({ startS: i * 4, endS: i * 4 + 3.8, motion: 0.5, loud: 0.5, intensity: (i % 10) / 10, brightness: 0.5, tags: i % 10 === 9 ? ['ação', 'impacto'] : ['ação'], line: null, peakS: i * 4 + 1.9 }));
  const episode: EpisodeAnalysis = { version: 'e2', durationS: 600, shots, sequences: [], subtitles: [], intensityCurve: [], curveStepS: 1, speech: [{ startS: 50, endS: 51.5, kind: 'grito', confidence: 0.9, text: 'Ainda não acabou!', impact: 0.95 }] };
  return { project: p, selection: [], playheadUs: 0, music: new Map([['mus', music]]), episodes: new Map([['ep', episode]]) };
}

describe('pontos fracos (sem IA)', () => {
  it('acha corte fora da batida, cena repetida e tela preta', () => {
    const f = findWeakPoints(setup());
    const text = f.map((x) => x.text).join('\n');
    expect(text).toMatch(/100 ms fora da batida/);
    expect(text).toMatch(/Cena repetida/);
    expect(text).toMatch(/Tela preta de 0\.1 s/);
  });
});

describe('resumo visual do AMV para o assistente', () => {
  it('associa rótulos visuais já analisados aos clipes usados na timeline', () => {
    const ctx = setup();
    ctx.visions = new Map([['ep', {
      version: 'v2',
      model: 'modelo de teste',
      shots: {
        t1200: { characters: ['Personagem A'], fight: true, note: 'prepara o golpe', action: 'preparação', confidence: 0.8 },
      },
    }]]);

    expect(projectSummary(ctx)).toContain('[análise visual 80%: Personagem A, preparação, prepara o golpe]');
  });
});

describe('chat local (sem modelo)', () => {
  it('"deixe os cortes mais rápidos" → proposta válida que corta na batida', () => {
    const ctx = setup();
    const r = localTurn(ctx, 'deixe os cortes mais rápidos');
    expect(r.proposals).toHaveLength(1);
    const cs = r.proposals[0]!;
    const v = validateSelection(ctx.project, cs, new Set(cs.items.map((i) => i.id)));
    expect(v.ok).toBe(true);
    const after = applyCommand(ctx.project, { type: 'batch', commands: v.commands }).project;
    expect(after.clips.length).toBeGreaterThan(ctx.project.clips.length);
  });

  it('"coloca um grito antes do drop" → fala termina no drop, legenda e ducking dependem dela', () => {
    const ctx = setup();
    const cs = localTurn(ctx, 'coloca um grito antes do drop').proposals[0]!;
    expect(cs.items).toHaveLength(3);
    const [voice, legend, duck] = cs.items;
    const clip = (voice!.commands[0] as { clip: { timelineStartUs: number; durationUs: number } }).clip;
    expect(clip.timelineStartUs + clip.durationUs).toBe(10 * S);
    expect(legend!.dependsOn).toEqual([voice!.id]);
    // desmarcar a fala desmarca a legenda e o ducking
    expect([...closeSelection(cs, new Set([legend!.id, duck!.id]))]).toEqual([]);
    const v = validateSelection(ctx.project, cs, new Set(cs.items.map((i) => i.id)));
    expect(v.ok).toBe(true);
  });

  it('"como melhorar esta cena" olha só o clipe e oferece troca; dois efeitos de uma vez', () => {
    const ctx = setup();
    const second = ctx.project.clips.find((c) => c.sourceInUs === 100 * S)!;
    ctx.selection = [second.id];
    const r = localTurn(ctx, 'Como melhorar esta cena?');
    expect(r.reply).toMatch(/100 ms fora da batida/);
    expect(r.reply).not.toMatch(/repetida/);
    expect(r.proposals[0]!.title).toBe('Trocar cena');
    const two = localTurn(ctx, 'Clarão e tremida aqui');
    expect(two.proposals.map((p) => p.title)).toEqual(['Adicionar clarão', 'Adicionar tremida']);
  });

  it('pedido desconhecido explica o que dá para fazer', () => {
    expect(localTurn(setup(), 'qual o sentido da vida').reply).toMatch(/cortes mais rápidos/);
  });

  it('revalidação pega proposta que ficou inválida', () => {
    const ctx = setup();
    const cs = localTurn(ctx, 'clarão nas batidas').proposals[0]!;
    const removed = applyCommand(ctx.project, { type: 'batch', commands: ctx.project.clips.filter((c) => c.assetId === 'ep').map((c) => ({ type: 'clip.remove' as const, clipId: c.id })) }).project;
    const v = validateSelection(removed, cs, new Set(cs.items.map((i) => i.id)));
    expect(v.ok).toBe(false);
  });
});

describe('chat com modelo (respostas gravadas)', () => {
  it('Gemini repete falha transitória e respeita Retry-After', async () => {
    const cfg = { ...PRESETS.find((p) => p.id === 'gemini')!, model: 'retry-test' };
    let calls = 0;
    const fetch: FetchLike = async () => {
      calls++;
      if (calls === 1) return {
        ok: false,
        status: 429,
        headers: { get: (name) => name.toLowerCase() === 'retry-after' ? '0' : null },
        text: async () => 'limite temporário',
      };
      return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) };
    };
    await expect(chat(cfg, 'secret', fetch, '', [{ role: 'user', content: 'oi' }], [])).resolves.toMatchObject({ text: 'ok' });
    expect(calls).toBe(2);
  });

  it('Gemini abre o circuit breaker após três chamadas esgotarem tentativas', async () => {
    const cfg = { ...PRESETS.find((p) => p.id === 'gemini')!, model: 'circuit-test' };
    let calls = 0;
    const fetch: FetchLike = async () => {
      calls++;
      return { ok: false, status: 503, text: async () => 'temporariamente indisponível' };
    };
    const request = () => chat(cfg, 'secret', fetch, '', [{ role: 'user', content: 'oi' }], []);
    for (let i = 0; i < 3; i++) await expect(request()).rejects.toMatchObject({ retryable: true });
    const attempted = calls;
    await expect(request()).rejects.toThrow(/Circuit breaker aberto/);
    expect(calls).toBe(attempted);
    expect(calls).toBe(9);
  });

  it('timeout do provedor é limitado e classificado como transitório', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetch: FetchLike = async (_url, init) => {
      requestSignal = init.signal;
      return new Promise(() => undefined);
    };
    await expect(fetchWithTimeout(fetch, 'https://example.test', { method: 'POST', headers: {}, body: '' }, 5))
      .rejects.toMatchObject({ retryable: true });
    expect(requestSignal?.aborted).toBe(true);
  });

  it('Gemini usa a API oficial, converte tool calls e contabiliza uso', async () => {
    const cfg = PRESETS.find((p) => p.id === 'gemini')!;
    let request: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | undefined;
    const fetch: FetchLike = async (url, init) => {
      request = { url, headers: init.headers, body: JSON.parse(init.body) };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          candidates: [{ content: { parts: [{ functionCall: { name: 'ideas', args: {} } }] } }],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 },
        }),
      };
    };
    const result = await chat(cfg, 'secret', fetch, 'sistema', [{ role: 'user', content: 'ideias' }], [{ name: 'ideas', description: 'ideias', parameters: { type: 'object' } }]);
    expect(request?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect(request?.headers['x-goog-api-key']).toBe('secret');
    expect(request?.url).not.toContain('secret');
    expect(request?.body).toMatchObject({
      systemInstruction: { parts: [{ text: 'sistema' }] },
      tools: [{ functionDeclarations: [{ name: 'ideas' }] }],
    });
    expect(result).toEqual({ text: '', toolCalls: [{ id: 'gemini_call_0', name: 'ideas', args: {} }], usage: { input: 12, output: 4 } });
  });

  it('Gemini lista somente modelos que aceitam generateContent', async () => {
    const cfg = PRESETS.find((p) => p.id === 'gemini')!;
    const fetch: FetchLike = async (url, init) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000');
      expect(init.headers['x-goog-api-key']).toBe('secret');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          models: [
            { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
          ],
        }),
      };
    };
    await expect(listModels(cfg, 'secret', fetch)).resolves.toEqual(['gemini-2.5-flash']);
  });

  it('Gemini recusa endpoints não oficiais antes de enviar a chave', async () => {
    const cfg = { ...PRESETS.find((p) => p.id === 'gemini')!, baseUrl: 'https://attacker.example/api' };
    const fetch: FetchLike = async () => { throw new Error('não deveria chamar a rede'); };
    await expect(chat(cfg, 'secret', fetch, '', [], [])).rejects.toThrow(/API oficial/);
  });

  it('OpenAI: chama ferramenta, recebe resultado e responde; a proposta volta para o app', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const answers = [
      { choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'propose_add_effect', arguments: '{"effect":"shake","onBeats":true}' } }] } }], usage: { prompt_tokens: 100, completion_tokens: 10 } },
      { choices: [{ message: { content: 'Coloquei tremida nos cortes das batidas fortes. Revise a proposta.' } }], usage: { prompt_tokens: 120, completion_tokens: 15 } },
    ];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const a = answers.shift()!;
      return { ok: true, status: 200, text: async () => JSON.stringify(a) };
    };
    const r = await runTurn({ cfg: { name: 'Ollama', kind: 'openai', baseUrl: 'http://localhost:11434/v1/', model: 'llama3.1', needsKey: false }, key: null, fetch, ctx: setup(), history: [], question: 'adiciona tremida nas batidas' });
    expect(calls[0]!.url).toBe('http://localhost:11434/v1/chat/completions');
    expect((calls[0]!.body.messages as { content: string }[])[0]!.content).toMatch(/RESUMO ATUAL DO PROJETO/);
    const second = calls[1]!.body.messages as { role: string; tool_call_id?: string; content: string }[];
    expect(second.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
    expect(r.proposals[0]!.title).toBe('Adicionar tremida');
    expect(r.reply).toMatch(/tremida/);
    expect(r.usage).toEqual({ input: 220, output: 25 });
  });

  it('erro de chave vira mensagem clara', async () => {
    const fetch: FetchLike = async () => ({ ok: false, status: 401, text: async () => '{"error":{"message":"invalid x-api-key"}}' });
    await expect(runTurn({ cfg: { name: 'Claude (Anthropic)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'm', needsKey: true }, key: 'k', fetch, ctx: setup(), history: [], question: 'oi' })).rejects.toThrow(/Chave recusada/);
  });

  it('Anthropic: lê texto e tool_use', () => {
    const r = parseAnthropic(JSON.stringify({ content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name: 'ideas', input: {} }], usage: { input_tokens: 5, output_tokens: 2 } }));
    expect(r).toEqual({ text: 'ok', toolCalls: [{ id: 't1', name: 'ideas', args: {} }], usage: { input: 5, output: 2 } });
  });
});
