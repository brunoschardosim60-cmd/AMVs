/**
 * Rotula cenas com um modelo de IA com visão: personagens e se é luta. Os rótulos de
 * personagem têm que ser CONSISTENTES entre cenas (o mesmo personagem, o mesmo nome),
 * então cada lote leva a lista de rótulos já usados e o resultado é normalizado para
 * eles. Em lotes de poucas imagens: mais barato que uma chamada por cena e o modelo
 * enxerga as cenas lado a lado, o que ajuda a reconhecer quem é quem.
 */
import { normLabel, type ShotVision } from '@amv/analysis';
import { chat, type ChatImage, type FetchLike, type ProviderConfig } from './providers.js';

export interface SceneFrame {
  /** Chave da cena (ver `shotKey`). */
  id: string;
  jpegBase64: string;
}

export interface LabelOptions {
  /** Imagens por chamada. */
  batchSize?: number;
  /** Rótulos de personagens já usados (retomada): o modelo os reaproveita. */
  known?: string[];
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface LabelResult {
  labels: Record<string, ShotVision>;
  /** Cenas que o modelo não devolveu de forma válida. */
  failed: string[];
  /** Todos os rótulos usados (os de `known` + os novos). */
  characters: string[];
  usage: { input: number; output: number };
}

const MAX_CHARS_PER_SHOT = 4;

const SYSTEM = `Você analisa quadros de cenas de anime para montar um AMV (vídeo musical de anime).
Para CADA imagem numerada, diga:
- "characters": os personagens que aparecem de forma clara. Use o NOME só se tiver certeza; senão, uma descrição curta e estável (ex.: "garoto de cabelo laranja", "vilão de capa roxa"). No máximo ${MAX_CHARS_PER_SHOT}. Lista vazia se não houver personagem claro.
- "fight": true se for luta/ação (golpes, ataques, confronto, perseguição); false para paisagem, conversa, plateia, close parado.
- "note": o que acontece, em até 8 palavras.
IMPORTANTE: use EXATAMENTE o mesmo rótulo para o mesmo personagem em imagens diferentes, e reaproveite os rótulos da lista "já usados" quando for o mesmo personagem.
Responda SOMENTE com um array JSON, um objeto por imagem, assim: [{"i":1,"characters":["..."],"fight":true,"note":"..."}]`;

/** Lê a resposta do modelo; devolve só as cenas válidas (por índice 1..n). */
export function parseSceneLabels(text: string, n: number): Map<number, { characters: string[]; fight: boolean; note: string }> {
  const out = new Map<number, { characters: string[]; fight: boolean; note: string }>();
  const a = text.indexOf('[');
  const b = text.lastIndexOf(']');
  if (a < 0 || b <= a) return out;
  let v: unknown;
  try {
    v = JSON.parse(text.slice(a, b + 1));
  } catch {
    return out;
  }
  if (!Array.isArray(v)) return out;
  for (const o of v) {
    if (!o || typeof o !== 'object') continue;
    const r = o as Record<string, unknown>;
    const i = Number(r.i);
    if (!Number.isInteger(i) || i < 1 || i > n || out.has(i)) continue;
    if (typeof r.fight !== 'boolean') continue;
    const chars = Array.isArray(r.characters) ? r.characters.filter((c): c is string => typeof c === 'string').map((c) => c.trim()).filter(Boolean) : [];
    out.set(i, { characters: chars.slice(0, 12), fight: r.fight, note: typeof r.note === 'string' ? r.note.trim().slice(0, 80) : '' });
  }
  return out;
}

export async function labelScenes(cfg: ProviderConfig, key: string | null, fetch: FetchLike, frames: SceneFrame[], opts: LabelOptions = {}): Promise<LabelResult> {
  const size = Math.max(1, opts.batchSize ?? 6);
  const labels: Record<string, ShotVision> = {};
  const failed: string[] = [];
  const usage = { input: 0, output: 0 };
  // rótulo canônico por forma normalizada: "Goku" e "goku " viram o mesmo
  const canon = new Map<string, string>();
  for (const k of opts.known ?? []) canon.set(normLabel(k), k);

  for (let i = 0; i < frames.length; i += size) {
    if (opts.signal?.aborted) throw Object.assign(new Error('cancelado'), { name: 'AbortError' });
    const batch = frames.slice(i, i + size);
    const images: ChatImage[] = batch.map((f) => ({ mime: 'image/jpeg', base64: f.jpegBase64 }));
    let got = new Map<number, { characters: string[]; fight: boolean; note: string }>();
    for (let attempt = 0; attempt < 2 && got.size < batch.length; attempt++) {
      const used = [...canon.values()];
      const ask =
        `${batch.length} imagem(ns), numeradas de 1 a ${batch.length} na ordem em que aparecem.\n` +
        `Rótulos já usados: ${used.length ? JSON.stringify(used) : '(nenhum ainda)'}.` +
        (attempt ? `\nA resposta anterior não cobriu todas as imagens: devolva ${batch.length} objetos, um por imagem.` : '');
      const r = await chat(cfg, key, fetch, SYSTEM, [{ role: 'user', content: ask, images }], [], opts.signal);
      usage.input += r.usage?.input ?? 0;
      usage.output += r.usage?.output ?? 0;
      const parsed = parseSceneLabels(r.text, batch.length);
      // na repetição, mantém o que já veio certo
      for (const [k, v] of parsed) if (!got.has(k)) got.set(k, v);
    }
    batch.forEach((f, idx) => {
      const g = got.get(idx + 1);
      if (!g) {
        failed.push(f.id);
        return;
      }
      const chars: string[] = [];
      for (const c of g.characters) {
        const n = normLabel(c);
        if (!n) continue;
        if (!canon.has(n)) canon.set(n, c);
        const name = canon.get(n)!;
        if (!chars.includes(name) && chars.length < MAX_CHARS_PER_SHOT) chars.push(name);
      }
      labels[f.id] = { characters: chars, fight: g.fight, note: g.note };
    });
    opts.onProgress?.(Math.min(frames.length, i + batch.length), frames.length);
  }
  return { labels, failed, characters: [...canon.values()], usage };
}
