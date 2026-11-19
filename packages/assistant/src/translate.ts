/**
 * Tradução de legendas e letras pelo modelo de IA que a pessoa já configurou
 * (Ollama local, Claude, OpenAI…). Em lotes, com a saída validada: o modelo tem
 * que devolver exatamente uma tradução por linha, na mesma ordem.
 */
import { chat, type FetchLike, type ProviderConfig } from './providers.js';

export interface TranslateOptions {
  /** Idioma de destino, em português ou código (ex.: "inglês", "en"). */
  target: string;
  /** Idioma de origem, se souber (senão o modelo identifica). */
  source?: string | null;
  signal?: AbortSignal;
  /** Linhas por chamada. */
  batchSize?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface TranslateResult {
  /** Uma entrada por linha de entrada; null = não consegui (mantenha o original). */
  translations: (string | null)[];
  failed: number;
  usage: { input: number; output: number };
}

const LANG_CODE_ALIASES: Record<string, string> = {
  pt: 'pt',
  'pt-br': 'pt',
  'pt_br': 'pt',
  portugues: 'pt',
  'portugues brasileiro': 'pt',
  'portugues (brasil)': 'pt',
  portuguese: 'pt',
  en: 'en',
  eng: 'en',
  ingles: 'en',
  english: 'en',
  es: 'es',
  spa: 'es',
  espanhol: 'es',
  spanish: 'es',
  ja: 'ja',
  jpn: 'ja',
  jp: 'ja',
  japones: 'ja',
  japanese: 'ja',
  fr: 'fr',
  fra: 'fr',
  fre: 'fr',
  frances: 'fr',
  french: 'fr',
  de: 'de',
  deu: 'de',
  ger: 'de',
  alemao: 'de',
  german: 'de',
  it: 'it',
  ita: 'it',
  italiano: 'it',
  italian: 'it',
  ko: 'ko',
  kor: 'ko',
  coreano: 'ko',
  korean: 'ko',
  zh: 'zh',
  zho: 'zh',
  chi: 'zh',
  'zh-cn': 'zh',
  'zh-tw': 'zh',
  chines: 'zh',
  chinese: 'zh',
};

/** Converte nomes/códigos de idioma para o código ISO usado pelo tradutor gratuito. */
export function normalizeTargetLangCode(target: string): string {
  const normalized = target
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (!normalized) return 'pt';
  if (LANG_CODE_ALIASES[normalized]) return LANG_CODE_ALIASES[normalized]!;
  const prefix = normalized.split(/[-_]/)[0] ?? normalized;
  return LANG_CODE_ALIASES[prefix] ?? (prefix.length <= 3 ? prefix : 'pt');
}

const SYSTEM = (target: string, source: string | null | undefined) =>
  `Você traduz legendas de anime e letras de música${source ? ` de ${source}` : ''} para ${target}. ` +
  'Preserve o tom, a emoção, gírias, nomes de personagens, de golpes e de lugares. ' +
  'Mantenha cada linha curta e natural, como legenda de vídeo, sem explicações nem notas. ' +
  'Não una nem divida linhas, não omita nenhuma. Se uma linha já estiver em ' + target + ', devolva-a igual. ' +
  'Responda SOMENTE com um array JSON de strings, com exatamente o mesmo número de itens da entrada e na mesma ordem.';

/** Lê o array JSON da resposta (aceita cerca de código e texto em volta). Null se não bate com `n`. */
export function parseTranslationArray(text: string, n: number): string[] | null {
  const a = text.indexOf('[');
  const b = text.lastIndexOf(']');
  if (a < 0 || b <= a) return null;
  let v: unknown;
  try {
    v = JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(v) || v.length !== n) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string' && typeof x !== 'number') return null;
    out.push(String(x).trim());
  }
  // uma linha vazia no lugar de uma cheia é erro do modelo
  return out;
}

/** Traduz `lines` para `opts.target`. Lança só em falha de conexão/chave; linhas que o modelo erra voltam como null. */
export async function translateLines(cfg: ProviderConfig, key: string | null, fetch: FetchLike, lines: string[], opts: TranslateOptions): Promise<TranslateResult> {
  const size = Math.max(1, opts.batchSize ?? 20);
  const out: (string | null)[] = lines.map(() => null);
  const usage = { input: 0, output: 0 };
  let failed = 0;
  for (let i = 0; i < lines.length; i += size) {
    if (opts.signal?.aborted) throw Object.assign(new Error('cancelado'), { name: 'AbortError' });
    const batch = lines.slice(i, i + size);
    const content = JSON.stringify(batch);
    let got: string[] | null = null;
    for (let attempt = 0; attempt < 2 && !got; attempt++) {
      const ask = attempt === 0 ? content : `${content}\n\nA resposta anterior não tinha exatamente ${batch.length} itens. Devolva um array JSON com ${batch.length} strings, uma por linha, na mesma ordem.`;
      const r = await chat(cfg, key, fetch, SYSTEM(opts.target, opts.source), [{ role: 'user', content: ask }], [], opts.signal);
      usage.input += r.usage?.input ?? 0;
      usage.output += r.usage?.output ?? 0;
      got = parseTranslationArray(r.text, batch.length);
      // linha que tinha texto e voltou vazia conta como erro do lote
      if (got && got.some((t, k) => !t && batch[k]!.trim())) got = null;
    }
    if (got) got.forEach((t, k) => (out[i + k] = t));
    else failed += batch.length;
    opts.onProgress?.(Math.min(lines.length, i + batch.length), lines.length);
  }
  return { translations: out, failed, usage };
}

function parseGtxTranslation(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!Array.isArray(parsed) || !Array.isArray(parsed[0])) return null;
    const chunks: string[] = [];
    for (const part of parsed[0]) {
      if (Array.isArray(part) && typeof part[0] === 'string') chunks.push(part[0]);
    }
    const joined = chunks.join('').trim();
    return joined || null;
  } catch {
    return null;
  }
}

function parseClients5Translation(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!Array.isArray(parsed)) return null;
    const chunks: string[] = [];
    for (const entry of parsed) {
      if (typeof entry === 'string' && entry.trim()) chunks.push(entry);
      else if (Array.isArray(entry) && typeof entry[0] === 'string') chunks.push(entry[0]);
    }
    const joined = chunks.join('').trim();
    return joined || null;
  } catch {
    return null;
  }
}

async function tryTranslateUrl(
  fetchImpl: FetchLike,
  url: string,
  parser: (payload: string) => string | null,
  signal?: AbortSignal,
): Promise<string | null> {
  if (signal?.aborted) throw Object.assign(new Error('cancelado'), { name: 'AbortError' });
  try {
    const response = await fetchImpl(url, { method: 'GET', headers: {}, body: '', signal });
    if (!response.ok) return null;
    return parser(await response.text());
  } catch (error) {
    if ((error as Error)?.name === 'AbortError' || signal?.aborted) {
      throw Object.assign(new Error('cancelado'), { name: 'AbortError' });
    }
    return null;
  }
}

async function fetchGtxText(
  fetch: FetchLike,
  text: string,
  sourceCode: string,
  targetCode: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (signal?.aborted) throw Object.assign(new Error('cancelado'), { name: 'AbortError' });
  const trimmed = text.trim();
  if (!trimmed) return '';
  const gtxUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sourceCode)}&tl=${encodeURIComponent(targetCode)}&dt=t&q=${encodeURIComponent(trimmed)}`;
  const gtx = await tryTranslateUrl(fetch, gtxUrl, parseGtxTranslation, signal);
  if (gtx) return gtx;

  const fallbackUrl = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${encodeURIComponent(sourceCode)}&tl=${encodeURIComponent(targetCode)}&q=${encodeURIComponent(trimmed)}`;
  return tryTranslateUrl(fetch, fallbackUrl, parseClients5Translation, signal);
}

/** Tradução gratuita e sem chave via endpoint público translate.googleapis.com. */
export async function translateLinesFree(
  fetch: FetchLike,
  lines: string[],
  opts: TranslateOptions,
): Promise<TranslateResult> {
  if (!lines.length) return { translations: [], failed: 0, usage: { input: 0, output: 0 } };
  const targetCode = normalizeTargetLangCode(opts.target);
  const sourceCode = opts.source ? normalizeTargetLangCode(opts.source) : 'auto';
  const out: (string | null)[] = lines.map(() => null);
  let failed = 0;
  let done = 0;

  // Tenta agrupar linhas simples (sem quebra de linha interna) em lotes rápidos;
  // se o endpoint mesclar linhas, refaz em paralelo controlado linha a linha.
  const MAX_BATCH = Math.max(1, Math.min(12, opts.batchSize ?? 10));
  for (let i = 0; i < lines.length; i += MAX_BATCH) {
    if (opts.signal?.aborted) throw Object.assign(new Error('cancelado'), { name: 'AbortError' });
    const slice = lines.slice(i, i + MAX_BATCH);
    const cleaned = slice.map((line) => line.replace(/\s*\n\s*/g, ' ').trim());
    const joined = cleaned.join('\n');
    let resolved: (string | null)[] | null = null;
    if (slice.length > 1 && slice.every((line) => line.trim() && !line.includes('\n')) && joined.length <= 1600) {
      const bulk = await fetchGtxText(fetch, joined, sourceCode, targetCode, opts.signal);
      if (bulk) {
        const split = bulk.split(/\r?\n/).map((item) => item.trim());
        if (split.length === slice.length && split.every((item) => item.length > 0)) {
          resolved = split;
        }
      }
    }
    if (!resolved) {
      const CONCURRENCY = 6;
      resolved = new Array<string | null>(slice.length).fill(null);
      for (let j = 0; j < slice.length; j += CONCURRENCY) {
        if (opts.signal?.aborted) throw Object.assign(new Error('cancelado'), { name: 'AbortError' });
        const chunk = slice.slice(j, j + CONCURRENCY);
        const translatedChunk = await Promise.all(
          chunk.map((line) => fetchGtxText(fetch, line, sourceCode, targetCode, opts.signal)),
        );
        translatedChunk.forEach((value, offset) => {
          resolved![j + offset] = value;
        });
      }
    }
    resolved.forEach((value, offset) => {
      const original = slice[offset] ?? '';
      if (value !== null && (value.trim() || !original.trim())) {
        out[i + offset] = value;
      } else if (original.trim()) {
        failed++;
      } else {
        out[i + offset] = '';
      }
    });
    done += slice.length;
    opts.onProgress?.(done, lines.length);
  }
  return { translations: out, failed, usage: { input: 0, output: 0 } };
}

/** Tenta o provedor de IA configurado (se houver) e preenche falhas com o tradutor gratuito. */
export async function translateLinesWithFallback(
  cfg: ProviderConfig | null | undefined,
  key: string | null,
  fetch: FetchLike,
  lines: string[],
  opts: TranslateOptions,
): Promise<TranslateResult> {
  if (!lines.length) return { translations: [], failed: 0, usage: { input: 0, output: 0 } };
  if (!cfg) return translateLinesFree(fetch, lines, opts);
  let primary: TranslateResult | null = null;
  try {
    primary = await translateLines(cfg, key, fetch, lines, opts);
  } catch (error) {
    if ((error as Error)?.name === 'AbortError' || opts.signal?.aborted) throw error;
    primary = null;
  }
  if (primary && primary.failed === 0 && primary.translations.every((item, idx) => item !== null || !lines[idx]?.trim())) {
    return primary;
  }
  const baseTranslations = primary ? [...primary.translations] : lines.map(() => null);
  const missingIndices: number[] = [];
  const missingLines: string[] = [];
  baseTranslations.forEach((value, idx) => {
    const raw = lines[idx] ?? '';
    if (value === null && raw.trim()) {
      missingIndices.push(idx);
      missingLines.push(raw);
    } else if (value === null && !raw.trim()) {
      baseTranslations[idx] = '';
    }
  });
  if (!missingLines.length) {
    return { translations: baseTranslations, failed: 0, usage: primary?.usage ?? { input: 0, output: 0 } };
  }
  const free = await translateLinesFree(fetch, missingLines, opts);
  let failed = 0;
  missingIndices.forEach((targetIdx, idx) => {
    const fallbackText = free.translations[idx] ?? null;
    baseTranslations[targetIdx] = fallbackText;
    if (fallbackText === null && lines[targetIdx]?.trim()) failed++;
  });
  return {
    translations: baseTranslations,
    failed,
    usage: primary?.usage ?? { input: 0, output: 0 },
  };
}
