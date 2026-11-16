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

/** Evita aceitar uma resposta claramente escrita em outro sistema de escrita (ex.: japonês quando o destino é português). */
function hasUnexpectedWritingSystem(text: string, target: string): boolean {
  const latinTarget = /^(pt|pt-br|portugu|brazil|en|english|ingl|es|espan|spanish|fr|french|fran|de|german|alem|it|ital)/i.test(target.trim());
  if (!latinTarget) return false;
  const letters = Array.from(text.matchAll(/\\p{L}/gu)).length;
  if (!letters) return true;
  const nonLatin = Array.from(text.matchAll(/[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\p{Script=Cyrillic}\\p{Script=Arabic}\\p{Script=Hebrew}\\p{Script=Thai}]/gu)).length;
  return nonLatin >= 2 && nonLatin / letters > 0.2;
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
    let rejectedForLanguage = false;
    for (let attempt = 0; attempt < 2 && !got; attempt++) {
      const retryReason = rejectedForLanguage
        ? `A resposta anterior veio em um sistema de escrita incompatível com o idioma de destino (${opts.target}). Traduza de verdade para ${opts.target}; não copie o texto original. `
        : `A resposta anterior não tinha exatamente ${batch.length} itens. `;
      const ask = attempt === 0 ? content : `${content}\n\n${retryReason}Devolva um array JSON com ${batch.length} strings, uma por linha, na mesma ordem.`;
      const r = await chat(cfg, key, fetch, SYSTEM(opts.target, opts.source), [{ role: 'user', content: ask }], [], opts.signal);
      usage.input += r.usage?.input ?? 0;
      usage.output += r.usage?.output ?? 0;
      got = parseTranslationArray(r.text, batch.length);
      if (got && got.some((t, k) => !t && batch[k]!.trim())) got = null;
      if (got && got.some((line) => hasUnexpectedWritingSystem(line, opts.target))) {
        got = null;
        rejectedForLanguage = true;
      }
    }
    if (got) got.forEach((t, k) => (out[i + k] = t));
    else failed += batch.length;
    opts.onProgress?.(Math.min(lines.length, i + batch.length), lines.length);
  }
  return { translations: out, failed, usage };
}
