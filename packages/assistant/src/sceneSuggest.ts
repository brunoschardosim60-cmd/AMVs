/**
 * Sugestão de cenas e pontos de corte por letra/clima, usando o modelo de texto que a
 * pessoa já configurou (Ollama local, Claude, OpenAI, Gemini…). Só texto: descritores
 * das cenas já analisadas, versos com tempo e o clima informado. Nenhum quadro ou áudio.
 * A saída do modelo é validada: cenas e versos inexistentes são descartados e os
 * pontos de corte são limitados ao intervalo real da cena.
 */
import { chat, type FetchLike, type ProviderConfig } from './providers.js';

export interface SuggestionScene {
  /** Id estável da cena (no Auto AMV: `${assetId}@${startS}`). */
  id: string;
  episode: string;
  startS: number;
  endS: number;
  /** 0..1 */
  intensity: number;
  motion: number;
  tags: string[];
  /** Fala/legenda dentro da cena, se houver. */
  line?: string | null;
  /** Nota, emoção, ação e personagens da análise com visão, se houver. */
  note?: string | null;
  emotion?: string | null;
  action?: string | null;
  characters?: string[];
}

export interface SuggestionLyric {
  /** Chave estável do verso (lyricCueKey). */
  key: string;
  text: string;
  startS: number;
  endS: number;
}

export interface SceneSuggestion {
  lyricKey: string;
  sceneId: string;
  /** Ponto de entrada/saída sugerido, em segundos do episódio, dentro da cena. */
  inS: number;
  outS: number;
  /** 0..1, confiança declarada pelo modelo (limitada). */
  score: number;
  reason: string;
}

export interface SuggestScenesInput {
  mood: string;
  lyrics: SuggestionLyric[];
  scenes: SuggestionScene[];
  /** Quadros opcionais (um por cena) para modelos com visão; no máximo MAX_SUGGESTION_FRAMES. */
  frames?: { sceneId: string; jpegBase64: string }[];
  signal?: AbortSignal;
}

export interface SuggestScenesResult {
  suggestions: SceneSuggestion[];
  /** Itens devolvidos pelo modelo que não passaram na validação. */
  discarded: number;
  usage: { input: number; output: number };
}

export const MAX_SUGGESTION_SCENES = 80;
export const MAX_SUGGESTION_LYRICS = 24;
export const MAX_SUGGESTION_FRAMES = 16;

/** Escolhe quais cenas recebem quadro: as mais intensas, espalhadas, até o limite. */
export function pickFrameScenes(scenes: readonly SuggestionScene[], max = MAX_SUGGESTION_FRAMES): SuggestionScene[] {
  const pool = scenes.slice(0, MAX_SUGGESTION_SCENES);
  if (pool.length <= max) return [...pool];
  const step = pool.length / max;
  return Array.from({ length: max }, (_, i) => pool[Math.floor(i * step)]!);
}

/** Legenda dos quadros: imagem N → id curto da cena, na mesma ordem das imagens. */
export function frameLegend<T extends { sceneId: string }>(scenes: readonly SuggestionScene[], frames: readonly T[]): { images: string[]; valid: T[] } {
  const shortById = new Map(scenes.slice(0, MAX_SUGGESTION_SCENES).map((s, i) => [s.id, `c${i}`]));
  const valid = frames.filter((f) => shortById.has(f.sceneId)).slice(0, MAX_SUGGESTION_FRAMES);
  return { images: valid.map((f, i) => `imagem ${i + 1} = cena ${shortById.get(f.sceneId)}`), valid };
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

const SYSTEM =
  'Você é um editor experiente de AMVs (vídeos musicais de anime). Recebe o clima desejado, versos da música com tempo ' +
  'e uma lista de cenas disponíveis descritas por texto; às vezes também quadros de algumas cenas, com legenda indicando a cena de cada imagem. Use o que vê nos quadros (expressão, ação, enquadramento) como evidência. Para cada verso escolha até 2 cenas que combinem ' +
  'com o sentido do verso, o clima e uma progressão narrativa coerente (evite repetir a mesma cena em versos seguidos). ' +
  'Sugira um ponto de entrada e saída dentro da cena, em segundos do episódio, com duração próxima à do verso. ' +
  'Use somente ids de cenas e chaves de versos fornecidos. Não invente personagens nem eventos que não estejam nos descritores. ' +
  'Responda SOMENTE com um array JSON: [{"lyric":"<chave>","scene":"<id>","in":<s>,"out":<s>,"score":<0..1>,"reason":"<curta, em português>"}].';

/** Monta a mensagem do usuário com dados compactos (ids curtos economizam tokens). */
export function buildSceneSuggestionPrompt(input: Pick<SuggestScenesInput, 'mood' | 'lyrics' | 'scenes'>): { content: string; sceneIds: string[]; lyricKeys: string[] } {
  const scenes = input.scenes.slice(0, MAX_SUGGESTION_SCENES);
  const lyrics = input.lyrics.slice(0, MAX_SUGGESTION_LYRICS);
  const payload = {
    clima: input.mood.trim() || 'não informado (use a letra)',
    versos: lyrics.map((l, i) => ({ chave: `v${i}`, texto: l.text, inicio: round(l.startS), duracao: round(l.endS - l.startS) })),
    cenas: scenes.map((s, i) => ({
      id: `c${i}`,
      ep: s.episode,
      inicio: round(s.startS),
      fim: round(s.endS),
      intensidade: round(s.intensity),
      movimento: round(s.motion),
      ...(s.tags.length ? { tags: s.tags } : {}),
      ...(s.line ? { fala: s.line.slice(0, 120) } : {}),
      ...(s.note ? { nota: s.note.slice(0, 160) } : {}),
      ...(s.emotion ? { emocao: s.emotion } : {}),
      ...(s.action ? { acao: s.action } : {}),
      ...(s.characters?.length ? { personagens: s.characters.slice(0, 4) } : {}),
    })),
  };
  return { content: JSON.stringify(payload), sceneIds: scenes.map((s) => s.id), lyricKeys: lyrics.map((l) => l.key) };
}

/** Lê e valida a resposta. Ids curtos (`c3`, `v1`) são traduzidos para os ids reais. */
export function parseSceneSuggestions(
  text: string,
  scenes: readonly SuggestionScene[],
  lyrics: readonly SuggestionLyric[],
): { suggestions: SceneSuggestion[]; discarded: number } | null {
  const a = text.indexOf('[');
  const b = text.lastIndexOf(']');
  if (a < 0 || b <= a) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  const sceneByShort = new Map(scenes.slice(0, MAX_SUGGESTION_SCENES).map((s, i) => [`c${i}`, s]));
  const lyricByShort = new Map(lyrics.slice(0, MAX_SUGGESTION_LYRICS).map((l, i) => [`v${i}`, l]));
  const out: SceneSuggestion[] = [];
  const seen = new Set<string>();
  const perLyric = new Map<string, number>();
  let discarded = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      discarded++;
      continue;
    }
    const r = item as Record<string, unknown>;
    const scene = sceneByShort.get(String(r.scene ?? ''));
    const lyric = lyricByShort.get(String(r.lyric ?? ''));
    if (!scene || !lyric) {
      discarded++;
      continue;
    }
    const dedupe = `${lyric.key}|${scene.id}`;
    if (seen.has(dedupe) || (perLyric.get(lyric.key) ?? 0) >= 2) {
      discarded++;
      continue;
    }
    const want = Math.max(0.25, lyric.endS - lyric.startS);
    let inS = Number(r.in);
    let outS = Number(r.out);
    if (!Number.isFinite(inS)) inS = scene.startS;
    inS = Math.min(Math.max(inS, scene.startS), scene.endS);
    if (!Number.isFinite(outS) || outS <= inS) outS = inS + want;
    outS = Math.min(outS, scene.endS);
    if (outS - inS < 0.25) {
      // ponto fora do fim da cena: recua a entrada para caber o mínimo possível
      inS = Math.max(scene.startS, outS - want);
    }
    if (outS - inS < 0.25) {
      discarded++;
      continue;
    }
    const scoreRaw = Number(r.score);
    // O modelo sugere; limitar a nota impede que uma sugestão anule ritmo e energia na pontuação.
    const score = Math.min(0.9, Math.max(0.55, Number.isFinite(scoreRaw) ? scoreRaw : 0.7));
    const reason = typeof r.reason === 'string' && r.reason.trim() ? r.reason.trim().slice(0, 200) : 'sugerida pelo modelo para este verso';
    seen.add(dedupe);
    perLyric.set(lyric.key, (perLyric.get(lyric.key) ?? 0) + 1);
    out.push({ lyricKey: lyric.key, sceneId: scene.id, inS: round(inS, 3), outS: round(outS, 3), score: round(score), reason });
  }
  return { suggestions: out, discarded };
}

/** Converte sugestões para o mapa usado pelo Auto AMV (`lyricSceneMatches`). */
export function suggestionsToLyricMatches(suggestions: readonly SceneSuggestion[]): Record<string, Record<string, { score: number; reason: string }>> {
  const out: Record<string, Record<string, { score: number; reason: string }>> = {};
  for (const s of suggestions) {
    out[s.sceneId] ??= {};
    out[s.sceneId]![s.lyricKey] = { score: s.score, reason: `IA (letra/clima): ${s.reason}` };
  }
  return out;
}

/** Pede as sugestões ao modelo configurado. Lança só em falha de conexão/chave ou resposta ilegível duas vezes. */
export async function suggestScenes(cfg: ProviderConfig, key: string | null, fetch: FetchLike, input: SuggestScenesInput): Promise<SuggestScenesResult> {
  if (!input.lyrics.length) throw new Error('Informe ao menos um verso com tempo.');
  if (!input.scenes.length) throw new Error('Não há cenas analisadas nos trechos selecionados.');
  const built = buildSceneSuggestionPrompt(input);
  const legend = frameLegend(input.scenes, input.frames ?? []);
  const images = legend.valid.map((f) => ({ mime: 'image/jpeg' as const, base64: f.jpegBase64 }));
  const content = images.length ? `${built.content}\n\nQuadros: ${legend.images.join('; ')}.` : built.content;
  const usage = { input: 0, output: 0 };
  for (let attempt = 0; attempt < 2; attempt++) {
    const ask = attempt === 0 ? content : `${content}\n\nA resposta anterior não era um array JSON válido. Responda somente com o array.`;
    const r = await chat(cfg, key, fetch, SYSTEM, [images.length ? { role: 'user', content: ask, images } : { role: 'user', content: ask }], [], input.signal);
    usage.input += r.usage?.input ?? 0;
    usage.output += r.usage?.output ?? 0;
    const parsed = parseSceneSuggestions(r.text, input.scenes, input.lyrics);
    if (parsed) return { ...parsed, usage };
  }
  throw new Error('O modelo não devolveu sugestões num formato válido. Tente de novo ou use outro modelo.');
}
