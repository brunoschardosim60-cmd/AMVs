/**
 * Adaptadores de provedores de LLM atrás de uma interface única.
 * - "openai": API de chat compatível com OpenAI (OpenAI, Ollama, LM Studio, OpenRouter, Groq…)
 * - "anthropic": API de mensagens da Anthropic
 * - "gemini": Gemini API oficial do Google
 * O fetch é injetado (no app vem do plugin HTTP do Tauri; nos testes, um falso).
 */

export type ProviderKind = 'openai' | 'anthropic' | 'gemini';

export interface ProviderConfig {
  /** Rótulo para o usuário. */
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  /** Precisa de chave? (Ollama local não precisa.) */
  needsKey: boolean;
}

export const PRESETS: (ProviderConfig & { id: string; help: string; local: boolean })[] = [
  { id: 'ollama', name: 'Ollama (no seu PC)', kind: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', needsKey: false, local: true, help: 'Grátis e offline. Instale o Ollama e rode "ollama pull llama3.1".' },
  { id: 'anthropic', name: 'Claude (Anthropic)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', needsKey: true, local: false, help: 'Chave em console.anthropic.com.' },
  { id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', needsKey: true, local: false, help: 'Chave em platform.openai.com.' },
  { id: 'gemini', name: 'Gemini (Google)', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.8-flash', needsKey: true, local: false, help: 'API oficial do Gemini. Crie uma chave no Google AI Studio.' },
  { id: 'compat', name: 'Outro compatível com OpenAI', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '', needsKey: true, local: false, help: 'OpenRouter, Groq, LM Studio… informe o endereço e o modelo.' },
];

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema dos argumentos. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Imagem enviada a um modelo com visão (base64, sem o prefixo `data:`). */
export interface ChatImage {
  mime: 'image/jpeg' | 'image/png';
  base64: string;
}

export type ChatMessage =
  | { role: 'user'; content: string; images?: ChatImage[] }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  usage: { input: number; output: number } | null;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null }; text(): Promise<string> }>;

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

function explain(status: number, body: string, cfg: ProviderConfig): string {
  let detail = body.slice(0, 300);
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    detail = (typeof j.error === 'string' ? j.error : j.error?.message) ?? j.message ?? detail;
  } catch {
    /* texto puro */
  }
  if (status === 401 || status === 403) return `Chave recusada pelo ${cfg.name}. Confira a chave nas configurações de IA. (${detail})`;
  if (status === 404) return `Modelo ou endereço não encontrado (${cfg.model} em ${cfg.baseUrl}). ${detail}`;
  if (status === 429) return `Limite de uso atingido no ${cfg.name}. Espere um pouco. (${detail})`;
  return `${cfg.name} respondeu ${status}: ${detail}`;
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_TRANSIENT_ATTEMPTS = 3;
const CIRCUIT_FAILURE_LIMIT = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;
const geminiFailures = new Map<string, { count: number; openUntil: number }>();

function providerKey(cfg: ProviderConfig): string {
  return `${cfg.kind}:${trimSlash(cfg.baseUrl)}:${cfg.model}`;
}

function retryAfterMs(res: Awaited<ReturnType<FetchLike>>): number | null {
  const header = res.headers?.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(15_000, seconds * 1000));
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.min(15_000, date - Date.now())) : null;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('cancelado'), { name: 'AbortError' }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('cancelado'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function fetchWithTimeout(
  fetch: FetchLike,
  url: string,
  init: Parameters<FetchLike>[1],
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Awaited<ReturnType<FetchLike>>> {
  const controller = new AbortController();
  const upstreamAbort = () => controller.abort();
  if (init.signal?.aborted) throw Object.assign(new Error('cancelado'), { name: 'AbortError' });
  init.signal?.addEventListener('abort', upstreamAbort, { once: true });
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new ProviderError('A requisição ao provedor excedeu 45 segundos.', null, true));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (init.signal?.aborted) throw Object.assign(new Error('cancelado'), { name: 'AbortError' });
    if (timedOut && !(error instanceof ProviderError)) throw new ProviderError('A requisição ao provedor excedeu 45 segundos.', null, true);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    init.signal?.removeEventListener('abort', upstreamAbort);
  }
}

async function callGeminiWithRetry(
  cfg: ProviderConfig,
  key: string,
  fetch: FetchLike,
  system: string,
  messages: ChatMessage[],
  tools: ToolSpec[],
  signal?: AbortSignal,
): Promise<Awaited<ReturnType<FetchLike>>> {
  const circuitKey = providerKey(cfg);
  const state = geminiFailures.get(circuitKey);
  if (state && state.openUntil > Date.now()) {
    throw new ProviderError(`Circuit breaker aberto para ${cfg.name} (${cfg.model}); tente novamente em alguns segundos.`, 503, true);
  }
  if (state && state.openUntil > 0) geminiFailures.delete(circuitKey);

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_TRANSIENT_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(fetch, `${trimSlash(cfg.baseUrl)}/models/${encodeURIComponent(cfg.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(geminiBody(system, messages, tools)),
        signal,
      });
      if (res.ok || (res.status !== 429 && res.status < 500)) {
        geminiFailures.delete(circuitKey);
        return res;
      }
      lastError = new ProviderError(explain(res.status, '', cfg), res.status, true);
      if (attempt < MAX_TRANSIENT_ATTEMPTS - 1) {
        const delay = retryAfterMs(res) ?? Math.round(300 * 2 ** attempt * (0.75 + Math.random() * 0.5));
        await wait(delay, signal);
        continue;
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      lastError = error;
      if (error instanceof ProviderError && !error.retryable) throw error;
      if (attempt < MAX_TRANSIENT_ATTEMPTS - 1) {
        await wait(Math.round(300 * 2 ** attempt * (0.75 + Math.random() * 0.5)), signal);
        continue;
      }
    }
  }

  const failures = (geminiFailures.get(circuitKey)?.count ?? 0) + 1;
  geminiFailures.set(circuitKey, {
    count: failures,
    openUntil: failures >= CIRCUIT_FAILURE_LIMIT ? Date.now() + CIRCUIT_COOLDOWN_MS : 0,
  });
  if (lastError instanceof ProviderError) throw lastError;
  throw new ProviderError(`Falha temporária no ${cfg.name} após ${MAX_TRANSIENT_ATTEMPTS} tentativas: ${errText(lastError)}`, null, true);
}

function assertGeminiBaseUrl(baseUrl: string): void {
  if (trimSlash(baseUrl) !== GEMINI_BASE_URL) throw new ProviderError('O Gemini só pode usar a API oficial generativelanguage.googleapis.com.', null);
}
/** O plugin HTTP do Tauri rejeita com string, não com Error. */
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function chat(
  cfg: ProviderConfig,
  key: string | null,
  fetch: FetchLike,
  system: string,
  messages: ChatMessage[],
  tools: ToolSpec[],
  signal?: AbortSignal,
): Promise<ChatResult> {
  if (cfg.needsKey && !key) throw new ProviderError(`Falta a chave do ${cfg.name}. Abra as configurações de IA.`, null);
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    if (cfg.kind === 'anthropic') res = await callAnthropic(cfg, key!, fetch, system, messages, tools, signal);
    else if (cfg.kind === 'gemini') {
      assertGeminiBaseUrl(cfg.baseUrl);
      res = await callGeminiWithRetry(cfg, key!, fetch, system, messages, tools, signal);
    }
    else res = await callOpenAi(cfg, key, fetch, system, messages, tools, signal);
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (e instanceof Error && e.name === 'AbortError') throw e;
    const local = /localhost|127\.0\.0\.1/.test(cfg.baseUrl);
    throw new ProviderError(local ? `Não consegui falar com ${cfg.baseUrl}. O ${cfg.name} está aberto?` : `Sem conexão com ${cfg.name}: ${errText(e)}`, null);
  }
  const body = await res.text();
  if (!res.ok) throw new ProviderError(explain(res.status, body, cfg), res.status);
  try {
    if (cfg.kind === 'anthropic') return parseAnthropic(body);
    if (cfg.kind === 'gemini') return parseGemini(body);
    return parseOpenAi(body);
  } catch {
    throw new ProviderError(`Resposta inesperada de ${cfg.baseUrl} (não é a API de um modelo). Confira o endereço.`, res.status);
  }
}

// ---------------------------------------------------------------- OpenAI

function toOpenAi(system: string, messages: ChatMessage[]) {
  const out: Record<string, unknown>[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    else if (m.role === 'assistant' && m.toolCalls?.length)
      out.push({ role: 'assistant', content: m.content || null, tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } })) });
    else if (m.role === 'user' && m.images?.length)
      out.push({ role: 'user', content: [{ type: 'text', text: m.content }, ...m.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.base64}` } }))] });
    else out.push({ role: m.role, content: m.content });
  }
  return out;
}

function callOpenAi(cfg: ProviderConfig, key: string | null, fetch: FetchLike, system: string, messages: ChatMessage[], tools: ToolSpec[], signal?: AbortSignal) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  const body: Record<string, unknown> = { model: cfg.model, messages: toOpenAi(system, messages), temperature: 0.4 };
  if (tools.length) body.tools = tools.map((t) => ({ type: 'function', function: t }));
  return fetch(`${trimSlash(cfg.baseUrl)}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal });
}

export function parseOpenAi(body: string): ChatResult {
  const j = JSON.parse(body) as {
    choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const msg = j.choices?.[0]?.message ?? {};
  const toolCalls = (msg.tool_calls ?? []).map((t, i) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(t.function.arguments || '{}') as Record<string, unknown>;
    } catch {
      /* argumentos inválidos: segue vazio */
    }
    return { id: t.id || `call_${i}`, name: t.function.name, args };
  });
  return { text: msg.content ?? '', toolCalls, usage: j.usage ? { input: j.usage.prompt_tokens ?? 0, output: j.usage.completion_tokens ?? 0 } : null };
}

// ---------------------------------------------------------------- Anthropic

function toAnthropic(messages: ChatMessage[]) {
  const out: { role: 'user' | 'assistant'; content: unknown[] }[] = [];
  const push = (role: 'user' | 'assistant', block: unknown) => {
    const last = out.at(-1);
    if (last && last.role === role) last.content.push(block);
    else out.push({ role, content: [block] });
  };
  for (const m of messages) {
    if (m.role === 'user') {
      // a Anthropic recomenda as imagens antes do texto
      for (const i of m.images ?? []) push('user', { type: 'image', source: { type: 'base64', media_type: i.mime, data: i.base64 } });
      push('user', { type: 'text', text: m.content });
    }
    else if (m.role === 'tool') push('user', { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content });
    else {
      if (m.content) push('assistant', { type: 'text', text: m.content });
      for (const t of m.toolCalls ?? []) push('assistant', { type: 'tool_use', id: t.id, name: t.name, input: t.args });
    }
  }
  return out;
}

function callAnthropic(cfg: ProviderConfig, key: string, fetch: FetchLike, system: string, messages: ChatMessage[], tools: ToolSpec[], signal?: AbortSignal) {
  const body: Record<string, unknown> = { model: cfg.model, max_tokens: 1500, system, messages: toAnthropic(messages) };
  if (tools.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  return fetch(`${trimSlash(cfg.baseUrl)}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
    signal,
  });
}

export function parseAnthropic(body: string): ChatResult {
  const j = JSON.parse(body) as { content?: ({ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> })[]; usage?: { input_tokens?: number; output_tokens?: number } };
  let text = '';
  const toolCalls: ToolCall[] = [];
  for (const b of j.content ?? []) {
    if (b.type === 'text') text += b.text;
    else if (b.type === 'tool_use') toolCalls.push({ id: b.id, name: b.name, args: b.input ?? {} });
  }
  return { text, toolCalls, usage: j.usage ? { input: j.usage.input_tokens ?? 0, output: j.usage.output_tokens ?? 0 } : null };
}

// ---------------------------------------------------------------- Gemini

function toGemini(messages: ChatMessage[]) {
  const out: { role: 'user' | 'model'; parts: Record<string, unknown>[] }[] = [];
  const push = (role: 'user' | 'model', part: Record<string, unknown>) => {
    const last = out.at(-1);
    if (last?.role === role) last.parts.push(part);
    else out.push({ role, parts: [part] });
  };
  for (const m of messages) {
    if (m.role === 'user') {
      push('user', { text: m.content });
      for (const image of m.images ?? []) push('user', { inlineData: { mimeType: image.mime, data: image.base64 } });
    } else if (m.role === 'assistant') {
      if (m.content) push('model', { text: m.content });
      for (const tool of m.toolCalls ?? []) push('model', { functionCall: { name: tool.name, args: tool.args } });
    } else {
      push('user', { functionResponse: { name: m.name, response: { content: m.content } } });
    }
  }
  return out;
}

function geminiBody(system: string, messages: ChatMessage[], tools: ToolSpec[]): Record<string, unknown> {
  const declarations = tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: system }] },
    contents: toGemini(messages),
    generationConfig: { temperature: 0.4 },
  };
  if (declarations.length) body.tools = [{ functionDeclarations: declarations }];
  return body;
}

export function parseGemini(body: string): ChatResult {
  const j = JSON.parse(body) as {
    candidates?: { content?: { parts?: ({ text?: string; functionCall?: { id?: string; name: string; args?: Record<string, unknown> } }[]) } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const parts = j.candidates?.[0]?.content?.parts ?? [];
  const text = parts.flatMap((part) => (typeof part.text === 'string' ? [part.text] : [])).join('');
  const toolCalls = parts.flatMap((part, i) => {
    const call = part.functionCall;
    return call ? [{ id: call.id || `gemini_call_${i}`, name: call.name, args: call.args ?? {} }] : [];
  });
  const usage = j.usageMetadata
    ? { input: j.usageMetadata.promptTokenCount ?? 0, output: j.usageMetadata.candidatesTokenCount ?? 0 }
    : null;
  return { text, toolCalls, usage };
}

/** Lista os modelos disponíveis (também serve de "testar conexão"). */
export async function listModels(cfg: ProviderConfig, key: string | null, fetch: FetchLike): Promise<string[]> {
  if (cfg.needsKey && !key) throw new ProviderError(`Falta a chave do ${cfg.name}.`, null);
  if (cfg.kind === 'gemini') assertGeminiBaseUrl(cfg.baseUrl);
  const headers: Record<string, string> = {};
  if (cfg.kind === 'anthropic') Object.assign(headers, { 'x-api-key': key!, 'anthropic-version': '2023-06-01' });
  else if (cfg.kind === 'gemini') headers['x-goog-api-key'] = key!;
  else if (key) headers.authorization = `Bearer ${key}`;
  const url = cfg.kind === 'anthropic'
    ? `${trimSlash(cfg.baseUrl)}/v1/models?limit=100`
    : cfg.kind === 'gemini'
      ? `${trimSlash(cfg.baseUrl)}/models?pageSize=1000`
      : `${trimSlash(cfg.baseUrl)}/models`;
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetch(url, { method: 'GET', headers, body: '' });
  } catch (e) {
    const local = /localhost|127\.0\.0\.1/.test(cfg.baseUrl);
    throw new ProviderError(local ? `Não consegui falar com ${cfg.baseUrl}. O ${cfg.name} está aberto?` : `Sem conexão com ${cfg.name}: ${errText(e)}`, null);
  }
  const body = await res.text();
  if (!res.ok) throw new ProviderError(explain(res.status, body, cfg), res.status);
  let j: { data?: { id: string }[]; models?: { name: string; supportedGenerationMethods?: string[] }[] };
  try {
    j = JSON.parse(body) as typeof j;
  } catch {
    throw new ProviderError(`Resposta inesperada de ${url} (não é a API de um modelo). Confira o endereço.`, res.status);
  }
  const models = j.data?.map((m) => m.id) ?? j.models
    ?.filter((m) => cfg.kind !== 'gemini' || m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => cfg.kind === 'gemini' ? m.name.replace(/^models\//, '') : m.name) ?? [];
  return models.sort();
}
