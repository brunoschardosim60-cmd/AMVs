/**
 * Adaptadores de provedores de LLM atrás de uma interface única.
 * - "openai": API de chat compatível com OpenAI (OpenAI, Ollama, LM Studio, OpenRouter, Groq…)
 * - "anthropic": API de mensagens da Anthropic
 * O fetch é injetado (no app vem do plugin HTTP do Tauri; nos testes, um falso).
 */

export type ProviderKind = 'openai' | 'anthropic';

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

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  usage: { input: number; output: number } | null;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
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
    res = cfg.kind === 'anthropic' ? await callAnthropic(cfg, key!, fetch, system, messages, tools, signal) : await callOpenAi(cfg, key, fetch, system, messages, tools, signal);
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (e instanceof Error && e.name === 'AbortError') throw e;
    const local = /localhost|127\.0\.0\.1/.test(cfg.baseUrl);
    throw new ProviderError(local ? `Não consegui falar com ${cfg.baseUrl}. O ${cfg.name} está aberto?` : `Sem conexão com ${cfg.name}: ${errText(e)}`, null);
  }
  const body = await res.text();
  if (!res.ok) throw new ProviderError(explain(res.status, body, cfg), res.status);
  try {
    return cfg.kind === 'anthropic' ? parseAnthropic(body) : parseOpenAi(body);
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
    if (m.role === 'user') push('user', { type: 'text', text: m.content });
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

/** Lista os modelos disponíveis (também serve de "testar conexão"). */
export async function listModels(cfg: ProviderConfig, key: string | null, fetch: FetchLike): Promise<string[]> {
  if (cfg.needsKey && !key) throw new ProviderError(`Falta a chave do ${cfg.name}.`, null);
  const headers: Record<string, string> = {};
  if (cfg.kind === 'anthropic') Object.assign(headers, { 'x-api-key': key!, 'anthropic-version': '2023-06-01' });
  else if (key) headers.authorization = `Bearer ${key}`;
  const url = cfg.kind === 'anthropic' ? `${trimSlash(cfg.baseUrl)}/v1/models?limit=100` : `${trimSlash(cfg.baseUrl)}/models`;
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetch(url, { method: 'GET', headers, body: '' });
  } catch (e) {
    const local = /localhost|127\.0\.0\.1/.test(cfg.baseUrl);
    throw new ProviderError(local ? `Não consegui falar com ${cfg.baseUrl}. O ${cfg.name} está aberto?` : `Sem conexão com ${cfg.name}: ${errText(e)}`, null);
  }
  const body = await res.text();
  if (!res.ok) throw new ProviderError(explain(res.status, body, cfg), res.status);
  let j: { data?: { id: string }[]; models?: { name: string }[] };
  try {
    j = JSON.parse(body) as typeof j;
  } catch {
    throw new ProviderError(`Resposta inesperada de ${url} (não é a API de um modelo). Confira o endereço.`, res.status);
  }
  return (j.data?.map((m) => m.id) ?? j.models?.map((m) => m.name) ?? []).sort();
}
