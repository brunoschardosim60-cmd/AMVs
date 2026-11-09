/**
 * Gerar meu AMV — atribuição de cenas a trechos da música, com regras por estilo.
 * Determinístico para a mesma `seed`. Saída: Commands comuns (tudo editável depois),
 * cada clipe com `origin: 'ai'` e um `reason` legível.
 */
import { SFX_ANCHOR_S, SFX_DURATION_S, type SfxKind } from '@amv/sfx';
import { normLabel, pickAudioStreamByLanguage, shotKey, type EpisodeVision, type ShotVision, type Cue, type EpisodeAnalysis, type MusicAnalysis, type Sequence, type Shot, type SpeechSegment } from '@amv/analysis';
import { defaultScale, newId, type Clip, type Command, type EffectInstance, type Project, type Track } from '@amv/project';
import { styleDef, type StyleDef, type StyleId } from './styles.js';

export interface EpisodeInput {
  assetId: string;
  name: string;
  analysis: EpisodeAnalysis;
  hasAudio: boolean;
  /** Faixas de áudio do arquivo (ex.: japonês e português): para escolher a da fala. */
  audioStreams?: { index: number; language: string | null; title?: string | null }[];
  /** Quem aparece em cada cena e se é luta (análise com IA com visão), se a pessoa rodou. */
  vision?: EpisodeVision;
}

export interface MusicInput {
  assetId: string;
  name: string;
  analysis: MusicAnalysis;
}

export interface GenerateOptions {
  style: StyleId;
  /** 0 suave … 3 extremamente intensa. */
  intensity: 0 | 1 | 2 | 3;
  /** Duração desejada (s). */
  durationS: number;
  /** Onde começa na música (s). null = automático (o drop cai em ~40% do vídeo). */
  musicStartS: number | null;
  /** Letra com tempo (para o estilo "letra" e legendas da música). */
  lyrics?: Cue[];
  useSpeech: boolean;
  useEffects: boolean;
  showText: boolean;
  /** Episódios/cenas proibidos (assetId ou `${assetId}@${startS}`). */
  exclude?: string[];
  seed: number;
  /**
   * `fight` (padrão): escolhe a(s) melhor(es) luta(s) e fica nela(s), em ordem, sem
   * misturar cenas de outros pontos. `mix`: usa cenas de qualquer lugar (comportamento antigo).
   */
  focus?: 'fight' | 'mix';
  /** Lutas escolhidas à mão (`${assetId}#${sequenceId}`). Vazio = o app escolhe. */
  sequenceIds?: string[];
  /** Encaixa o golpe de cada cena forte na batida (padrão: ligado). */
  hitSync?: boolean;
  /** Ajuste manual da posição dos cortes em relação à música, em milissegundos. */
  beatOffsetMs?: number;
  /** Quantas falas intercalar, contando a de antes do drop. Padrão: 1 se o estilo usa fala, senão 0. */
  voiceMoments?: number;
  /** Faixa de áudio da fala: `original` (japonês) ou `pt` (dublagem). Padrão: original. */
  voiceLang?: 'original' | 'pt';
  /** Efeitos sonoros (subida, impacto no drop, golpes, whoosh). Padrão: ligado, se `sfxAssets` vier. */
  useSfx?: boolean;
  /**
   * Só cenas em que aparece algum destes personagens (exige a análise com visão). Se não houver
   * cenas suficientes, usa todas e avisa.
   */
  characters?: string[];
  /** Onde estão os efeitos (id do asset de cada um). Sem isso, não coloca efeito sonoro. */
  sfxAssets?: Partial<Record<SfxKind, string>>;
}

export interface GenerateResult {
  commands: Command[];
  summary: { clips: number; cuts: number; speech: string | null; musicRange: [number, number]; drop: number | null; focus: 'fight' | 'mix'; fights: string[]; voices: number; hitsSynced: number; sfx: number };
  warnings: string[];
}

interface Slot {
  startS: number; // tempo da timeline
  endS: number;
  energy: number;
  section: string;
  isDrop: boolean;
  /** Palavra da letra que entra neste corte (estilo letra). */
  word?: string;
}

const S = 1_000_000;
const us = (s: number) => Math.round(s * S);

function rng(seed: number) {
  let x = (seed * 2654435761) >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 100000) / 100000;
  };
}

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function energyAt(m: MusicAnalysis, t: number): number {
  const i = Math.min(m.energy.length - 1, Math.max(0, Math.floor(t / m.energyStepS)));
  return m.energy[i] ?? 0;
}

function sectionAt(m: MusicAnalysis, t: number) {
  return m.sections.find((s) => t >= s.startS && t < s.endS) ?? m.sections.at(-1);
}

/** Escolhe o trecho da música: o drop principal cai em ~40% do vídeo, começando num compasso. */
export function chooseMusicRange(m: MusicAnalysis, durationS: number, startS: number | null): [number, number] {
  const D = Math.min(durationS, m.durationS);
  let s0 = startS ?? 0;
  if (startS === null && m.drops.length) {
    s0 = Math.max(0, m.drops[0]! - 0.4 * D);
    const db = m.downbeats.filter((d) => d <= s0).at(-1);
    if (db !== undefined) s0 = db;
  }
  s0 = Math.max(0, Math.min(s0, m.durationS - D));
  return [s0, s0 + D];
}

/** Divide o trecho da música em cortes nas batidas, mais curtos quanto mais energia. */
export function makeSlots(m: MusicAnalysis, range: [number, number], style: StyleDef, intensity: number, lyrics?: Cue[], beatOffsetS = 0): Slot[] {
  const [a, b] = range;
  const drop = m.drops.map((d) => d + beatOffsetS).find((d) => d > a + 1 && d < b - 1) ?? null;
  // estilo letra com letra: um corte por palavra (palavras distribuídas na duração da linha)
  if (style.id === 'letra' && lyrics?.length) {
    const words: { t: number; w: string }[] = [];
    for (const c of lyrics) {
      if (!Number.isFinite(c.startS) || c.endS <= a || c.startS >= b) continue;
      const ws = c.text.replace(/\n/g, ' ').split(/\s+/).filter(Boolean);
      const step = (c.endS - c.startS) / Math.max(1, ws.length);
      ws.forEach((w, i) => words.push({ t: c.startS + i * step, w }));
    }
    if (words.length >= 2) {
      const slots: Slot[] = [];
      if (words[0]!.t > a + 0.2) slots.push({ startS: 0, endS: words[0]!.t - a, energy: energyAt(m, a), section: 'intro', isDrop: false });
      let lastEnd = a;
      words.forEach((w, i) => {
        // palavra fica no máximo ~1,5 s; depois da última, volta a cortar na batida
        const end = Math.min(b, words[i + 1]?.t ?? w.t + 1.5, w.t + 1.5);
        if (end - w.t < 0.12) return;
        slots.push({ startS: w.t - a, endS: end - a, energy: energyAt(m, w.t), section: sectionAt(m, w.t)?.label ?? '', isDrop: drop !== null && Math.abs(w.t - drop) < 0.15, word: w.w });
        lastEnd = end;
      });
      if (lastEnd < b - 0.3) {
        for (const sl of makeSlots(m, [lastEnd, b], style, intensity, undefined, beatOffsetS)) slots.push({ ...sl, startS: sl.startS + (lastEnd - a), endS: sl.endS + (lastEnd - a) });
      }
      return slots;
    }
  }
  const beats = m.beats.map((t) => t + beatOffsetS).filter((t) => t >= a - 0.01 && t <= b + 0.01);
  const sectionEdges = m.sections.flatMap((section) => [section.startS, section.endS]).map((t) => t + beatOffsetS);
  const grid = beats.length >= 4 ? beats : Array.from({ length: Math.ceil((b - a) / 0.5) + 1 }, (_, i) => a + beatOffsetS + i * 0.5);
  const speedUp = [1.6, 1.25, 1, 0.75][intensity]!;
  const slots: Slot[] = [];
  let i = 0;
  let cur = a;
  while (cur < b - 0.05) {
    const e = energyAt(m, cur);
    const lvl = e < 0.35 ? 0 : e < 0.7 ? 1 : 2;
    let n = Math.max(1, Math.round(style.beatsPerCut[lvl]! * speedUp));
    // não atravessa o drop: o drop sempre abre um corte novo
    let next = grid[Math.min(grid.length - 1, i + n)] ?? b;
    if (drop !== null && cur < drop - 0.05 && next > drop + 0.05) {
      next = drop;
      n = grid.findIndex((g) => Math.abs(g - drop) < 0.05) - i;
    }
    if (next - cur < style.minCutS) {
      // junta com o próximo grupo de batidas
      n += Math.max(1, Math.round(style.beatsPerCut[lvl]! * speedUp));
      next = grid[Math.min(grid.length - 1, i + n)] ?? b;
    }
    if (next <= cur + 0.05 || i + n >= grid.length - 1) next = b;
    const sectionEdge = sectionEdges.find((edge) => edge > cur + 0.05 && edge < next - 0.05);
    if (sectionEdge !== undefined) next = sectionEdge;
    slots.push({ startS: cur - a, endS: Math.min(b, next) - a, energy: e, section: sectionAt(m, cur)?.label ?? '', isDrop: drop !== null && Math.abs(cur - drop) < 0.06 });
    i = grid.findIndex((g) => g >= next - 0.01);
    if (i < 0) break;
    cur = next;
  }
  return slots.filter((s) => s.endS - s.startS > 0.05);
}

interface Candidate {
  ep: EpisodeInput;
  shot: Shot;
  id: string;
  /** Luta a que a cena pertence (`${assetId}#${sequenceId}`); vazio no modo misturar. */
  seq: string;
}

/** Fala marcante para antes do drop: curta, com impacto alto. */
export function pickSpeech(eps: EpisodeInput[], maxS: number, exclude: Set<string>, accept?: (ep: EpisodeInput, s: SpeechSegment) => boolean): { ep: EpisodeInput; s: SpeechSegment } | null {
  let best: { ep: EpisodeInput; s: SpeechSegment; score: number } | null = null;
  for (const ep of eps) {
    if (!ep.hasAudio || exclude.has(ep.assetId)) continue;
    for (const s of ep.analysis.speech) {
      const d = s.endS - s.startS;
      if (d < 0.6 || d > maxS) continue;
      if (accept && !accept(ep, s)) continue;
      const score = s.impact + (s.kind === 'grito' ? 0.3 : 0) + (s.text ? 0.1 : 0) - Math.abs(d - 2) * 0.05;
      if (!best || score > best.score) best = { ep, s, score };
    }
  }
  return best;
}


// ---------------------------------------------------------------- foco na luta

export interface PoolEntry {
  ep: EpisodeInput;
  seq: Sequence;
  /** Tempo (s) de cenas aproveitáveis na sequência. */
  usableS: number;
  /** Quantas cenas aproveitáveis (cada corte usa uma cena). */
  shotCount: number;
}

export interface FootageFit {
  /** Intensidade (0..1) de cada cena disponível. */
  intensities: number[];
  lowI: number;
  highI: number;
}

export interface FootagePlan {
  /** Personagens pedidos que realmente filtram as cenas (vazio = sem filtro). */
  wanted: Set<string> | null;
  mode: 'fight' | 'mix';
  pool: PoolEntry[];
  fit: FootageFit;
  warnings: string[];
}

const MIN_SHOT_S = 0.25;
/** Quanto de imagem aproveitável (× duração do vídeo) a seleção de lutas procura ter. */
const POOL_ROOM = 1.6;
/**
 * E quantas cenas (fração dos cortes previstos): cada corte gasta uma cena, então só os
 * segundos não bastam. Abaixo disso a luta repetiria cenas demais e entra a próxima;
 * acima, repetir um pouco é melhor que misturar outra luta.
 */
const POOL_SHOT_MIN = 0.7;

const visionOf = (ep: EpisodeInput, shot: Shot): ShotVision | undefined => ep.vision?.shots[shotKey(shot.startS)];

/** IA visual só pesa quando declara confiança; o sinal local continua sendo a base. */
function effectiveShotIntensity(ep: EpisodeInput, shot: Shot): number {
  const visual = visionOf(ep, shot);
  if (visual?.confidence === undefined || visual.confidence < 0.55 || visual.visualIntensity === undefined) return shot.intensity;
  return shot.intensity * 0.55 + visual.visualIntensity * 0.45;
}

/** A cena tem algum dos personagens pedidos? Sem análise da cena = não dá para saber = não. */
function hasCharacter(ep: EpisodeInput, shot: Shot, wanted: Set<string>): boolean {
  const v = visionOf(ep, shot);
  return !!v && v.characters.some((c) => wanted.has(normLabel(c)));
}

function usableShots(ep: EpisodeInput, seq: Sequence, wanted?: Set<string> | null): Shot[] {
  return ep.analysis.shots.filter((sh) => sh.startS >= seq.startS - 1e-3 && sh.endS <= seq.endS + 1e-3 && sh.endS - sh.startS >= MIN_SHOT_S && !sh.tags.includes('escura') && (!wanted || hasCharacter(ep, sh, wanted)));
}

/**
 * Escolhe as lutas do vídeo: as mais fortes primeiro, até haver imagem de sobra
 * (1,6× a duração). Com `sequenceIds`, usa exatamente as que a pessoa marcou.
 */
export function chooseSequences(eps: EpisodeInput[], neededS: number, o: { sequenceIds?: string[]; exclude?: Set<string>; jitter?: () => number; neededShots?: number; wanted?: Set<string> | null }): PoolEntry[] {
  const all: PoolEntry[] = [];
  for (const ep of eps) {
    if (o.exclude?.has(ep.assetId)) continue;
    for (const seq of ep.analysis.sequences ?? []) {
      const shots = usableShots(ep, seq, o.wanted);
      if (!shots.length) continue;
      all.push({ ep, seq, usableS: shots.reduce((a, x) => a + (x.endS - x.startS), 0), shotCount: shots.length });
    }
  }
  const key = (e: PoolEntry) => `${e.ep.assetId}#${e.seq.id}`;
  if (o.sequenceIds?.length) {
    const want = new Set(o.sequenceIds);
    return all.filter((e) => want.has(key(e))).sort((a, b) => a.ep.assetId.localeCompare(b.ep.assetId) || a.seq.startS - b.seq.startS);
  }
  const score = (e: PoolEntry) => 0.6 * e.seq.intensity + 0.25 * e.seq.peak + 0.15 * Math.min(1, e.usableS / (neededS * POOL_ROOM)) + (o.jitter ? (o.jitter() - 0.5) * 0.16 : 0);
  const fights = all
    .filter((e) => e.seq.kind === 'luta')
    .map((e) => ({ e, sc: score(e) }))
    .sort((a, b) => b.sc - a.sc || a.e.seq.startS - b.e.seq.startS || a.e.ep.assetId.localeCompare(b.e.ep.assetId));
  const pool: PoolEntry[] = [];
  let have = 0;
  let count = 0;
  const needCount = (o.neededShots ?? 0) * POOL_SHOT_MIN;
  for (const { e } of fights) {
    // para quando já tem imagem e cenas suficientes; senão junta a próxima luta mais forte
    if (have >= neededS * POOL_ROOM && count >= needCount) break;
    pool.push(e);
    have += e.usableS;
    count += e.shotCount;
  }
  return pool.sort((a, b) => a.ep.assetId.localeCompare(b.ep.assetId) || a.seq.startS - b.seq.startS);
}

/** Define de onde saem as cenas (lutas escolhidas ou tudo) e o perfil de intensidade delas. */
export function planFootage(eps: EpisodeInput[], o: Pick<GenerateOptions, 'style' | 'intensity' | 'durationS' | 'focus' | 'sequenceIds' | 'exclude' | 'seed' | 'characters'>, m?: MusicAnalysis): FootagePlan {
  const style = styleDef(o.style);
  const exclude = new Set(o.exclude ?? []);
  const warnings: string[] = [];
  const wantFight = (o.focus ?? 'fight') === 'fight' && o.style !== 'discurso';
  // quantos cortes o vídeo terá, pela música (no trecho padrão: serve de estimativa)
  const neededShots = m ? makeSlots(m, chooseMusicRange(m, o.durationS, null), style, o.intensity).length : 0;
  const jitterSeed = ((o.seed * 40503) ^ 0x9e3779b9) >>> 0;
  let wanted: Set<string> | null = o.characters?.length ? new Set(o.characters.map(normLabel)) : null;
  const countMatches = () => {
    let n = 0;
    for (const ep of eps) {
      if (exclude.has(ep.assetId)) continue;
      for (const sh of ep.analysis.shots) if (sh.endS - sh.startS >= MIN_SHOT_S && !sh.tags.includes('escura') && hasCharacter(ep, sh, wanted!)) n++;
    }
    return n;
  };
  // poucas cenas com esses personagens: melhor usar todas (e avisar) do que um vídeo repetido ou vazio
  if (wanted) {
    const have = countMatches();
    if (have < Math.max(8, Math.round(neededShots * 0.3))) {
      warnings.push(`Só achei ${have} cena(s) identificadas com ${o.characters!.join(', ')} (o vídeo pede ~${neededShots} cortes). Mantive o filtro para não misturar personagens; analise mais cenas ou selecione outros personagens.`);
    }
  }
  let pool: PoolEntry[] = [];
  if (wantFight) {
    pool = chooseSequences(eps, o.durationS, { sequenceIds: o.sequenceIds, exclude, jitter: rng(jitterSeed), neededShots, wanted });
    if (!pool.length) warnings.push('Não achei uma luta bem definida nos episódios: usei cenas de vários pontos. Escolha as lutas à mão ou use "Misturar".');
  }
  const mode: FootagePlan['mode'] = pool.length ? 'fight' : 'mix';
  const intensities: number[] = [];
  if (mode === 'fight') for (const e of pool) for (const sh of usableShots(e.ep, e.seq, wanted)) intensities.push(effectiveShotIntensity(e.ep, sh));
  else
    for (const ep of eps) {
      if (exclude.has(ep.assetId)) continue;
      for (const sh of ep.analysis.shots) if (sh.endS - sh.startS >= MIN_SHOT_S && !sh.tags.includes('escura') && (!wanted || hasCharacter(ep, sh, wanted))) intensities.push(effectiveShotIntensity(ep, sh));
    }
  const boost = [-0.1, 0, 0.05, 0.1][o.intensity]!;
  return { wanted, mode, pool, fit: { intensities, lowI: Math.max(0, style.targetIntensity[0] + boost), highI: Math.min(1, style.targetIntensity[1] + boost) }, warnings };
}

// ---------------------------------------------------------------- trecho da música que combina

export interface RangeSuggestion {
  startS: number;
  endS: number;
  /** 0..1 */
  score: number;
  reasons: string[];
}

/**
 * Compara janelas da música (começando em compassos) com as cenas que existem:
 * (40%) o drop cai em ~40% do vídeo; (35%) a energia que a janela pede é a
 * intensidade que as cenas escolhidas realmente têm; (25%) começa/termina em
 * limite de seção. Devolve as melhores, sem janelas quase iguais.
 */
export function suggestMusicRanges(m: MusicAnalysis, durationS: number, fit: FootageFit | null, limit = 3): RangeSuggestion[] {
  const D = Math.min(durationS, m.durationS);
  let starts = m.downbeats.filter((d) => d + D <= m.durationS + 0.01);
  if (starts.length < 3) starts = Array.from({ length: Math.max(1, Math.floor((m.durationS - D) / 2) + 1) }, (_, i) => i * 2);
  const N = 12;
  const footage = fit ? [...fit.intensities].sort((a, b) => a - b) : [];
  const qAt = (k: number) => footage[Math.min(footage.length - 1, Math.floor(((k + 0.5) / N) * footage.length))]!;
  const out: RangeSuggestion[] = starts.map((s0) => {
    const reasons: string[] = [];
    const drop = m.drops.find((d) => d > s0 + 1 && d < s0 + D - 1);
    let dropScore = 0;
    if (drop !== undefined) {
      dropScore = 1 - Math.min(1, Math.abs((drop - s0) / D - 0.4) / 0.4);
      if (dropScore > 0.6) reasons.push(`drop aos ${Math.round(((drop - s0) / D) * 100)}% do vídeo`);
    }
    let fitScore = 0.5;
    if (fit && footage.length) {
      const wanted = Array.from({ length: N }, (_, k) => fit.lowI + (fit.highI - fit.lowI) * energyAt(m, s0 + ((k + 0.5) / N) * D)).sort((a, b) => a - b);
      const dist = wanted.reduce((a, w, k) => a + Math.abs(w - qAt(k)), 0) / N;
      fitScore = 1 - Math.min(1, dist / 0.5);
      if (fitScore > 0.75) reasons.push('a energia da música combina com a força das cenas escolhidas');
    }
    const startsOnSection = s0 < 0.4 || m.sections.some((x) => Math.abs(x.startS - s0) < 0.4);
    const endsOnSection = Math.abs(m.durationS - (s0 + D)) < 0.8 || m.sections.some((x) => Math.abs(x.endS - (s0 + D)) < 0.8);
    if (startsOnSection) reasons.push('começa no início de uma parte da música');
    if (endsOnSection) reasons.push('termina no fim de uma parte');
    const score = 0.4 * dropScore + 0.35 * fitScore + 0.25 * ((startsOnSection ? 0.6 : 0) + (endsOnSection ? 0.4 : 0));
    return { startS: s0, endS: s0 + D, score: Math.round(score * 1000) / 1000, reasons };
  });
  out.sort((a, b) => b.score - a.score || a.startS - b.startS);
  const picked: RangeSuggestion[] = [];
  for (const c of out) {
    if (picked.every((p) => Math.abs(p.startS - c.startS) >= D * 0.5)) picked.push(c);
    if (picked.length >= limit) break;
  }
  return picked;
}

// ---------------------------------------------------------------- faixa de áudio da fala

/** Índice da faixa de áudio do idioma pedido, ou null (deixa a faixa padrão). */
export function pickAudioStream(ep: EpisodeInput, lang: 'original' | 'pt' = 'original'): number | null {
  return pickAudioStreamByLanguage(ep.audioStreams ?? [], lang);
}

function findTracks(p: Project) {
  const visual = p.tracks.filter((t) => t.kind === 'video');
  const v1 = visual.at(-1);
  const text = p.tracks.find((t) => t.kind === 'text');
  const music = p.tracks.find((t) => t.kind === 'audio' && t.role === 'music') ?? p.tracks.find((t) => t.kind === 'audio');
  const voice = p.tracks.find((t) => t.kind === 'audio' && t.role === 'voice') ?? p.tracks.filter((t) => t.kind === 'audio')[1];
  const sfx = p.tracks.find((t) => t.kind === 'audio' && t.role === 'sfx');
  return { v1, text, music, voice, sfx };
}

function baseClip(trackId: string, assetId: string | null, startS: number, durS: number, srcIn: number, reason: string, extra: Partial<Clip> = {}): Clip {
  return {
    id: newId('clp'),
    trackId,
    assetId,
    timelineStartUs: us(startS),
    durationUs: Math.max(1000, us(durS)),
    sourceInUs: us(srcIn),
    sourceOutUs: us(srcIn) + Math.max(1000, us(durS)),
    speed: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
    audio: { gainDb: 0, fadeInUs: 0, fadeOutUs: 0, pitchSemitones: 0, streamIndex: null },
    effects: [],
    transitionIn: null,
    keyframes: {},
    text: null,
    origin: 'ai',
    reason,
    confidence: null,
    label: null,
    ...extra,
  };
}

function fx(effect: string, params: Record<string, number>): EffectInstance {
  return { id: newId('fx'), effect, enabled: true, params };
}

function gradeFx(grade: StyleDef['grade']): EffectInstance[] {
  if (grade === 'bw') return [fx('color', { brightness: 0, contrast: 1.15, saturation: 0 })];
  if (grade === 'warm') return [fx('color', { brightness: 0.02, contrast: 1.08, saturation: 1.15 }), fx('vignette', { strength: 0.35 })];
  if (grade === 'punchy') return [fx('color', { brightness: 0, contrast: 1.12, saturation: 1.25 })];
  return [];
}

function textClip(trackId: string, startS: number, durS: number, text: string, H: number, kind: 'word' | 'line', reason: string): Clip {
  const word = kind === 'word';
  return baseClip(trackId, null, startS, durS, 0, reason, {
    transform: { x: 0, y: word ? 0 : Math.round(H * 0.36), scale: 1, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
    text: {
      text: word ? text.toUpperCase() : text,
      font: word ? 'Georgia' : 'Manrope Variable',
      size: Math.round(H * (word ? 0.12 : 0.045)),
      color: '#ffffff',
      outlineColor: '#000000',
      outlineWidth: word ? 2 : 3,
      shadow: true,
      animationIn: word ? 'pop' : 'fade',
      animationOut: word ? null : 'fade',
    },
  });
}

/** Gera a montagem. Não mexe em nada: devolve os comandos para aplicar (um único desfazer). */
export function generateAmv(project: Project, music: MusicInput, episodes: EpisodeInput[], opts: GenerateOptions): GenerateResult {
  const r = generateInner(project, music, episodes, opts);
  // episódio horizontal em projeto vertical/quadrado: preenche o quadro em vez de faixas pretas
  const video = new Set(project.tracks.filter((t) => t.kind === 'video').map((t) => t.id));
  for (const c of r.commands) {
    if (c.type !== 'clip.add' || !c.clip.assetId || !video.has(c.clip.trackId)) continue;
    const asset = project.assets.find((a) => a.id === c.clip.assetId);
    if (asset) c.clip.transform = { ...c.clip.transform, scale: defaultScale(project, asset) };
  }
  return r;
}

interface VoiceBlock {
  ep: EpisodeInput;
  s: SpeechSegment;
  /** Onde a fala toca na timeline (s). */
  atS: number;
  len: number;
  /** Extensão da imagem (pode ser um pouco maior que a fala, para não sobrar fresta). */
  from: number;
  to: number;
  preDrop: boolean;
}

const DUCK_DB = -16;
const VOICE_GAP_S = 1.5;

function generateInner(project: Project, music: MusicInput, episodes: EpisodeInput[], opts: GenerateOptions): GenerateResult {
  const style = styleDef(opts.style);
  const warnings: string[] = [];
  const rand = rng(opts.seed);
  const { v1, text, music: musicTrack, voice, sfx: sfxTrack } = findTracks(project);
  if (!v1 || !musicTrack) throw new Error('o projeto precisa de uma trilha de vídeo e uma de música');
  const H = project.settings.height;
  const exclude = new Set(opts.exclude ?? []);
  const m = music.analysis;
  const beatOffsetS = Math.max(-500, Math.min(500, opts.beatOffsetMs ?? 0)) / 1000;

  // ---------------------------------------------------------------- de onde saem as cenas
  const plan = planFootage(episodes, opts, m);
  warnings.push(...plan.warnings);
  const fight = plan.mode === 'fight';
  const poolEps = new Set(plan.pool.map((e) => e.ep.assetId));
  const seqKeyOf = (ep: EpisodeInput, shot: Shot) => {
    const e = plan.pool.find((x) => x.ep.assetId === ep.assetId && shot.startS >= x.seq.startS - 1e-3 && shot.endS <= x.seq.endS + 1e-3);
    return e ? `${ep.assetId}#${e.seq.id}` : `${ep.assetId}#-`;
  };
  /** Fala só vale se vier da luta escolhida (ou de perto dela): senão mistura personagens/cenas. */
  const nearPool = (ep: EpisodeInput, sp: SpeechSegment) => !fight || plan.pool.some((e) => e.ep.assetId === ep.assetId && sp.startS >= e.seq.startS - 15 && sp.endS <= e.seq.endS + 5);

  // ---------------------------------------------------------------- trecho da música
  let range: [number, number];
  if (opts.musicStartS !== null) range = chooseMusicRange(m, opts.durationS, opts.musicStartS);
  else if (fight) {
    const best = suggestMusicRanges(m, opts.durationS, plan.fit, 1)[0];
    range = best ? [best.startS, best.endS] : chooseMusicRange(m, opts.durationS, null);
  } else range = chooseMusicRange(m, opts.durationS, null);
  const D = range[1] - range[0];
  const dropAbs = m.drops.map((d) => d + beatOffsetS).find((d) => d > range[0] + 1 && d < range[1] - 1) ?? null;
  const dropT = dropAbs === null ? null : dropAbs - range[0];
  if (dropT === null) warnings.push('A música não tem um drop claro nesse trecho: a montagem segue a energia da música.');
  if (opts.style === 'letra' && !opts.lyrics?.length) warnings.push('Sem a letra com tempo (LRC), o estilo "letra" corta na batida mas não escreve as palavras. Importe a letra em Legendas.');
  const lang = opts.voiceLang ?? 'original';
  const streamFor = (ep: EpisodeInput) => pickAudioStream(ep, lang);
  if (lang === 'pt' ? episodes.some((e) => (e.audioStreams?.length ?? 0) > 1 && streamFor(e) === null) : false) warnings.push('Um episódio não tem faixa de áudio em português identificada: usei a faixa padrão dele.');

  const cmds: Command[] = [];
  // limpa as trilhas que a geração preenche (o projeto anterior fica salvo como versão pelo app)
  const filled = new Set([v1.id, musicTrack.id, voice?.id, text?.id, sfxTrack?.id].filter(Boolean) as string[]);
  for (const c of project.clips) if (filled.has(c.trackId)) cmds.push({ type: 'clip.remove', clipId: c.id });

  // ---------------------------------------------------------------- música
  const fadeOut = Math.min(2, D * 0.08);
  const musicClip = baseClip(musicTrack.id, music.assetId, 0, D, range[0], `Trecho ${fmt(range[0])}–${fmt(range[1])} de ${music.name}${dropT !== null ? `: drop em ${fmt(dropT)} do vídeo` : ''}`, {
    audio: { gainDb: opts.style === 'discurso' ? -14 : 0, fadeInUs: range[0] > 0.5 ? us(0.3) : 0, fadeOutUs: us(fadeOut), pitchSemitones: 0, streamIndex: null },
  });

  // ---------------------------------------------------------------- falas (antes do drop e intercaladas)
  const blocks: VoiceBlock[] = [];
  const wantVoice = opts.useSpeech && voice && opts.style !== 'discurso';
  const totalVoice = wantVoice ? Math.max(0, Math.min(5, Math.round(opts.voiceMoments ?? (style.speechBeforeDrop ? 1 : 0)))) : 0;
  if (wantVoice && totalVoice > 0 && style.speechBeforeDrop && dropT !== null) {
    let pick = pickSpeech(episodes, Math.min(4, dropT - 0.2), exclude, nearPool);
    if (!pick && fight) pick = pickSpeech(episodes, Math.min(4, dropT - 0.2), exclude, (ep) => poolEps.has(ep.assetId));
    if (pick) {
      const len = pick.s.endS - pick.s.startS;
      blocks.push({ ep: pick.ep, s: pick.s, atS: dropT - len, len, from: dropT - len, to: dropT, preDrop: true });
    } else warnings.push('Nenhuma fala marcante encontrada nos episódios (legendas embutidas ajudam muito).');
  }
  const extraWanted = totalVoice - blocks.length;
  if (wantVoice && extraWanted > 0) {
    const taken = new Set(blocks.map((b) => `${b.ep.assetId}@${b.s.startS}`));
    const lines = episodes
      .filter((e) => e.hasAudio && !exclude.has(e.assetId))
      .flatMap((ep) => ep.analysis.speech.filter((sp) => nearPool(ep, sp) || (fight && poolEps.has(ep.assetId))).map((sp) => ({ ep, sp })))
      .filter(({ sp }) => sp.endS - sp.startS >= 0.8 && sp.endS - sp.startS <= 4)
      .filter(({ ep, sp }) => !taken.has(`${ep.assetId}@${sp.startS}`))
      .sort((a, b) => b.sp.impact - a.sp.impact || a.sp.startS - b.sp.startS);
    // onde cabe: começa num compasso, trecho calmo da música, afastado das outras falas e do drop
    const quiet = (a: number, b: number) => {
      let sum = 0;
      let n = 0;
      for (let t = a; t < b; t += m.energyStepS) {
        sum += energyAt(m, range[0] + t);
        n++;
      }
      return n ? sum / n : 1;
    };
    const free = (a: number, b: number) => blocks.every((x) => b <= x.from - VOICE_GAP_S || a >= x.to + VOICE_GAP_S) && (dropT === null || b <= dropT - 0.5 || a >= dropT + 2.5);
    const limit = blocks[0] ? blocks[0].atS : D;
    const downs = m.downbeats.map((d) => d + beatOffsetS - range[0]).filter((t) => t >= 1.5 && t <= D - 3);
    let placed = 0;
    for (const { ep, sp } of lines) {
      if (placed >= extraWanted) break;
      const len = sp.endS - sp.startS;
      const ideal = (limit * (placed + 1)) / (extraWanted + 1);
      const fits = downs.filter((t) => t + len <= limit - VOICE_GAP_S && free(t, t + len) && quiet(t, t + len) < 0.6).sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal));
      if (!fits.length) continue;
      blocks.push({ ep, s: sp, atS: fits[0]!, len, from: fits[0]!, to: fits[0]! + len, preDrop: false });
      placed++;
    }
    // sem nenhuma fala disponível o aviso de "nenhuma fala marcante" já cobre; só avisa se havia falas e não coube
    if (placed < extraWanted && lines.length > 0) warnings.push(`Só coube ${placed + blocks.filter((b) => b.preDrop).length} de ${totalVoice} falas: faltou trecho calmo na música ou fala marcante na luta escolhida.`);
  }
  blocks.sort((a, b) => a.atS - b.atS);
  // a música abaixa durante cada fala e volta depois (no drop, rampa curta para o golpe entrar forte)
  if (blocks.length) {
    const kf: { atUs: number; value: number; easing: 'linear' }[] = [];
    for (const b of blocks) {
      const a = b.atS;
      const end = b.preDrop ? dropT! : b.atS + b.len;
      kf.push({ atUs: us(Math.max(0, a - 0.35)), value: 0, easing: 'linear' }, { atUs: us(a), value: DUCK_DB, easing: 'linear' });
      if (b.preDrop) kf.push({ atUs: us(end - 0.06), value: DUCK_DB, easing: 'linear' }, { atUs: us(end), value: 0, easing: 'linear' });
      else kf.push({ atUs: us(end), value: DUCK_DB, easing: 'linear' }, { atUs: us(end + 0.4), value: 0, easing: 'linear' });
    }
    musicClip.keyframes['audio.gainDb'] = kf;
  }
  cmds.push({ type: 'clip.add', clip: musicClip });

  // ---------------------------------------------------------------- estilo discurso: as falas são a espinha
  const used = new Set<string>();
  let clipsMade = 0;
  if (opts.style === 'discurso' && voice) {
    const lines = episodes
      .filter((e) => e.hasAudio && !exclude.has(e.assetId))
      .flatMap((ep) => ep.analysis.speech.map((s) => ({ ep, s })))
      .filter((x) => x.s.endS - x.s.startS >= 0.8 && x.s.endS - x.s.startS <= 6)
      .sort((x, y) => y.s.impact - x.s.impact + (rand() - 0.5) * 0.1);
    let t = 0.4;
    const chosen: typeof lines = [];
    for (const l of lines) {
      if (t >= D - 0.8) break;
      const len = l.s.endS - l.s.startS;
      if (t + len > D) continue;
      chosen.push(l);
      t += len + 0.35;
    }
    if (!chosen.length) warnings.push('O estilo discurso precisa de falas: importe episódios com legenda ou com falas claras.');
    t = 0.4;
    for (const { ep, s } of chosen) {
      const len = s.endS - s.startS;
      const reason = `Fala ${s.text ? `"${s.text.replace(/\n/g, ' ')}" ` : ''}de ${ep.name} ${fmt(s.startS)} (impacto ${s.impact.toFixed(2)})`;
      cmds.push({ type: 'clip.add', clip: baseClip(v1.id, ep.assetId, t, len + 0.35, s.startS, reason, { effects: [...gradeFx(style.grade)] }) });
      cmds.push({ type: 'clip.add', clip: baseClip(voice.id, ep.assetId, t, len, s.startS, reason, { audio: { gainDb: 2, fadeInUs: us(0.05), fadeOutUs: us(0.1), pitchSemitones: 0, streamIndex: streamFor(ep) } }) });
      if (opts.showText && text && s.text) {
        // legenda em pedaços de até 3 palavras, no ritmo da fala
        const words = s.text.replace(/\n/g, ' ').split(/\s+/);
        const groups: string[] = [];
        for (let i = 0; i < words.length; i += 3) groups.push(words.slice(i, i + 3).join(' '));
        const step = len / groups.length;
        groups.forEach((g, i) => cmds.push({ type: 'clip.add', clip: textClip(text.id, t + i * step, step, g, H, 'line', 'Legenda da fala') }));
      }
      used.add(`${ep.assetId}@${s.startS}`);
      clipsMade++;
      t += len + 0.35;
    }
    return { commands: cmds, summary: { clips: clipsMade, cuts: clipsMade, speech: chosen[0]?.s.text ?? null, musicRange: range, drop: dropT, focus: 'mix', fights: [], voices: chosen.length, hitsSynced: 0, sfx: 0 }, warnings };
  }

  // ---------------------------------------------------------------- cortes na batida
  const REPEAT_WARNING = 'Poucas cenas para o tamanho do vídeo: algumas se repetem. Importe mais episódios ou escolha mais lutas.';
  const slots = makeSlots(m, range, style, opts.intensity, opts.lyrics, beatOffsetS);
  const candidates: Candidate[] = [];
  const consider = (ep: EpisodeInput, shot: Shot) => {
    const id = `${ep.assetId}@${shot.startS}`;
    if (exclude.has(id) || shot.endS - shot.startS < 0.25 || shot.tags.includes('escura')) return;
    if (plan.wanted && !hasCharacter(ep, shot, plan.wanted)) return;
    candidates.push({ ep, shot, id, seq: fight ? seqKeyOf(ep, shot) : '' });
  };
  if (fight) {
    for (const e of plan.pool) for (const sh of e.ep.analysis.shots) if (sh.startS >= e.seq.startS - 1e-3 && sh.endS <= e.seq.endS + 1e-3) consider(e.ep, sh);
  } else {
    for (const ep of episodes) {
      if (exclude.has(ep.assetId)) continue;
      for (const shot of ep.analysis.shots) consider(ep, shot);
    }
  }
  if (!candidates.length) {
    warnings.push(plan.wanted
      ? `Nenhuma cena analisada corresponde aos personagens selecionados (${[...plan.wanted].join(', ')}); não misturei outros personagens.`
      : 'Nenhuma cena analisada ainda: espere a análise dos episódios terminar.');
    return { commands: cmds, summary: { clips: 0, cuts: 0, speech: null, musicRange: range, drop: dropT, focus: plan.mode, fights: [], voices: 0, hitsSynced: 0, sfx: 0 }, warnings };
  }
  const { lowI, highI } = plan.fit;
  const boost = 0; // já embutido em plan.fit
  let prev: Candidate | null = null;
  let prevSrcEnd = 0;

  // a imagem de cada fala é de quem fala: tira os cortes que encostam nela (sem deixar fresta)
  for (const b of blocks) {
    for (const sl of slots) {
      if (sl.startS < b.from && sl.endS > b.from && b.from - sl.startS < 0.2) b.from = sl.startS;
      if (sl.startS < b.to && sl.endS > b.to && sl.endS - b.to < 0.2) b.to = sl.endS;
    }
    // a imagem não pode começar antes do início do episódio
    b.from = Math.max(b.from, b.atS - b.s.startS);
  }
  const visualSlots: Slot[] = [];
  for (const sl of slots) {
    let pieces: Slot[] = [sl];
    for (const b of blocks) {
      pieces = pieces.flatMap((pc) => {
        if (b.to <= pc.startS + 0.01 || b.from >= pc.endS - 0.01) return [pc];
        const out: Slot[] = [];
        if (b.from - pc.startS > 0.01) out.push({ ...pc, endS: b.from });
        if (pc.endS - b.to > 0.01) out.push({ ...pc, startS: b.to, isDrop: false, word: undefined });
        return out;
      });
    }
    visualSlots.push(...pieces);
  }

  // cenas curtas demais para um slot longo (intro lenta, episódio com cortes rápidos):
  // divide o slot na batida mais perto do meio, para nunca deixar buraco
  const longest = Math.max(...candidates.map((c) => c.shot.endS - c.shot.startS));
  const fitSlots: Slot[] = [];
  const splitFit = (sl: Slot) => {
    const len = sl.endS - sl.startS;
    if (len * 0.6 <= longest || len < 0.5) return void fitSlots.push(sl);
    const mid = (sl.startS + sl.endS) / 2;
    let cut = mid;
    let bestD = Infinity;
    for (const mb of m.beats) {
      const b = mb + beatOffsetS - range[0];
      if (b <= sl.startS + 0.25 || b >= sl.endS - 0.25) continue;
      const d = Math.abs(b - mid);
      if (d < bestD) [bestD, cut] = [d, b];
    }
    splitFit({ ...sl, endS: cut });
    splitFit({ ...sl, startS: cut, isDrop: false, word: undefined });
  };
  for (const sl of visualSlots) splitFit(sl);

  // em luta, a ordem do episódio conta a história: andar para a frente é bom, voltar é ruim
  const narr = fight ? Math.max(0.7, style.narrative) : style.narrative;
  let syncedHits = 0;
  let hitSlots = 0;
  /** Para os efeitos sonoros: onde cada corte/golpe aconteceu na timeline. */
  const cutsLog: { startS: number; len: number; energy: number; intensity: number; isDrop: boolean; hitAtS: number | null }[] = [];

  for (const sl of fitSlots) {
    const len = sl.endS - sl.startS;
    const target = Math.min(1, Math.max(0, lowI + (highI - lowI) * sl.energy + boost + (sl.isDrop ? 0.15 : 0)));
    let best: { c: Candidate; score: number; srcIn: number } | null = null;
    for (const c of candidates) {
      if (used.has(c.id)) continue;
      const shotLen = c.shot.endS - c.shot.startS;
      // dá para usar câmera lenta até 0,6× se a cena for um pouco curta
      if (shotLen < len * 0.6) continue;
      const sceneIntensity = effectiveShotIntensity(c.ep, c.shot);
      let score = 1 - Math.abs(target - sceneIntensity) * 1.6;
      if (sl.isDrop && c.shot.tags.includes('impacto')) score += 0.5;
      if (sl.energy > 0.7 && c.shot.tags.includes('ação')) score += 0.15;
      if (sl.energy < 0.35 && c.shot.tags.includes('calma')) score += 0.2;
      if (c.shot.tags.includes('fala') && style.id !== 'discurso') score -= 0.08;
      // visão (se rodou): cena que não é luta não entra nos golpes; serve de respiro nos trechos calmos
      const vis = visionOf(c.ep, c.shot);
      if (vis) score += vis.fight ? (sl.energy > 0.5 ? 0.1 : 0) : sl.energy > 0.5 ? -0.35 : 0.1;
      if (vis && (vis.confidence ?? 0) >= 0.55) {
        if (sl.energy >= 0.65 && (vis.action === 'combate' || vis.action === 'perseguição')) score += 0.14;
        if (sl.energy <= 0.35 && (vis.action === 'diálogo' || vis.action === 'ambiente' || vis.action === 'preparação')) score += 0.12;
        if (style.id === 'emocional' && (vis.emotion === 'tristeza' || vis.emotion === 'calma')) score += 0.12;
        if (style.id === 'superacao' && vis.emotion === 'determinação') score += 0.12;
      }
      if (prev && prev.ep.assetId === c.ep.assetId) {
        score -= 0.12;
        // narrativa: andar para frente no mesmo episódio é bom; voltar é ruim
        if (c.shot.startS < prevSrcEnd) score -= 0.15 * narr;
        else score += 0.1 * narr;
      }
      if (fight && prev) {
        if (prev.seq === c.seq) {
          // continua na mesma luta; perto de onde parou, para frente, lê como uma luta só
          score += 0.3;
          if (c.shot.startS >= prevSrcEnd - 0.05) score += 0.25 * Math.exp(-(c.shot.startS - prevSrcEnd) / 12);
          else score -= 0.25;
        } else score -= 0.1;
      }
      score += (rand() - 0.5) * 0.12;
      if (!best || score > best.score) {
        // trecho dentro da cena: evita o primeiro quadro (corte) e pega o miolo
        const room = Math.max(0, shotLen - len);
        const srcIn = c.shot.startS + Math.min(0.12, room) + room * 0.25 * rand();
        best = { c, score, srcIn };
      }
    }
    if (!best) {
      // acabaram as cenas novas: reaproveita (evita a anterior quando há outra opção)
      if (!warnings.includes(REPEAT_WARNING)) warnings.push(REPEAT_WARNING);
      used.clear();
      const fits = candidates.filter((x) => x.shot.endS - x.shot.startS >= len * 0.6);
      const c = fits.find((x) => x.id !== prev?.id) ?? fits[0];
      if (!c) continue;
      // outro pedaço da mesma cena, para não parecer congelado
      const room = Math.max(0, c.shot.endS - c.shot.startS - len);
      best = { c, score: 0, srcIn: c.shot.startS + room * rand() };
    }
    const { c } = best;
    const sceneIntensity = effectiveShotIntensity(c.ep, c.shot);
    const shotLen = c.shot.endS - c.shot.startS;
    const speed = shotLen >= len ? 1 : Math.max(0.6, shotLen / len);
    const srcLen = len * speed;

    // golpe na batida: o instante de maior movimento da cena cai logo depois do corte (que está na batida)
    let srcIn = best.srcIn;
    let hit = false;
    const wantsHit = opts.hitSync !== false && (sl.isDrop || sl.energy >= 0.5 || c.shot.tags.includes('impacto')) && c.shot.motion >= 0.3 && Number.isFinite(c.shot.peakS);
    if (wantsHit) {
      hitSlots++;
      const lead = sl.isDrop ? 0.04 : Math.min(0.12, Math.max(0.05, len * 0.25));
      const want = c.shot.peakS - lead * speed;
      const lo = c.shot.startS + Math.min(0.08, Math.max(0, shotLen - srcLen));
      const hi = c.shot.endS - srcLen;
      if (hi >= lo) {
        const at = Math.min(hi, Math.max(lo, want));
        if (Math.abs(at - want) / speed <= 0.15) {
          srcIn = at;
          hit = true;
          syncedHits++;
        }
      }
    }

    const effects: EffectInstance[] = [...gradeFx(style.grade)];
    const fxOn = opts.useEffects && style.impactFx > 0;
    if (fxOn && sl.isDrop) {
      effects.push(fx('flash', { duration: 0.2, white: 1, strength: 1 }), fx('shake', { intensity: 22, frequency: 14, duration: 0.45 }));
    } else if (fxOn && sl.energy > 0.7 && c.shot.tags.includes('impacto') && rand() < 0.45 * style.impactFx) {
      effects.push(fx('shake', { intensity: 14, frequency: 12, duration: Math.min(0.35, len) }));
    } else if (fxOn && sl.energy > 0.55 && len >= 0.8 && rand() < 0.3 * style.impactFx) {
      effects.push(fx('zoom', { from: 1, to: 1.15, ease: 1 }));
    }
    const transition = style.transition === 'dissolve' && clipsMade > 0 ? { transition: 'dissolve', durationUs: us(Math.min(0.6, len / 3)), params: {} } : null;
    const why = [
      sl.isDrop ? `Drop em ${fmt(sl.startS)}` : `${sl.section || 'trecho'} (energia ${sl.energy.toFixed(2)})`,
      `cena de ${c.shot.tags.join('/') || 'intensidade'} ${sceneIntensity.toFixed(2)}`,
      `${c.ep.name} ${fmt(c.shot.startS)}`,
      visionOf(c.ep, c.shot)?.action ? `ação ${visionOf(c.ep, c.shot)!.action}` : null,
      visionOf(c.ep, c.shot)?.emotion ? `emoção ${visionOf(c.ep, c.shot)!.emotion}` : null,
      fight ? 'luta escolhida' : null,
      visionOf(c.ep, c.shot)?.characters.length ? `com ${visionOf(c.ep, c.shot)!.characters.join(' e ')}` : null,
      hit ? 'golpe na batida' : null,
      speed < 1 ? `câmera lenta ${speed.toFixed(2)}×` : null,
    ]
      .filter(Boolean)
      .join(' — ');
    const clip = baseClip(v1.id, c.ep.assetId, sl.startS, len, srcIn, why, { speed, sourceOutUs: us(srcIn) + us(srcLen), effects, transitionIn: transition, confidence: Math.max(0, Math.min(1, best.score)) });
    clip.sourceOutUs = clip.sourceInUs + Math.round(clip.durationUs * speed);
    cmds.push({ type: 'clip.add', clip });
    if (opts.showText && text && sl.word) cmds.push({ type: 'clip.add', clip: textClip(text.id, sl.startS, len, sl.word, H, 'word', 'Palavra da letra') });
    used.add(c.id);
    cutsLog.push({ startS: sl.startS, len, energy: sl.energy, intensity: c.shot.intensity, isDrop: sl.isDrop, hitAtS: hit ? sl.startS + (c.shot.peakS - srcIn) / speed : null });
    prev = c;
    prevSrcEnd = srcIn + srcLen;
    clipsMade++;
  }
  if (opts.hitSync !== false && hitSlots > 0 && syncedHits < hitSlots * 0.5) warnings.push(`Só ${syncedHits} de ${hitSlots} cortes fortes tiveram o golpe encaixado na batida (as cenas escolhidas têm o golpe longe do começo).`);


  // ---------------------------------------------------------------- efeitos sonoros
  const sfxCount = sfxTrack && opts.useSfx !== false && opts.sfxAssets ? placeSfx() : 0;
  function placeSfx(): number {
    const assets = opts.sfxAssets!;
    const r2 = rng(((opts.seed * 2654435761) ^ 0x51f15e) >>> 0); // sorteio próprio: não mexe na escolha das cenas
    type Cand = { kind: SfxKind; startS: number; srcIn: number; durS: number; gainDb: number; prio: number; why: string };
    const cands: Cand[] = [];
    const anchored = (kind: SfxKind, atS: number, gainDb: number, prio: number, why: string) => {
      let start = atS - SFX_ANCHOR_S[kind];
      let srcIn = 0;
      if (start < 0) {
        srcIn = -start; // começa no meio do efeito para o ponto-chave cair no instante certo
        start = 0;
      }
      const dur = Math.min(SFX_DURATION_S[kind] - srcIn, D - start);
      if (assets[kind] && dur > 0.05) cands.push({ kind, startS: start, srcIn, durS: dur, gainDb, prio, why });
    };
    const hasPreDropVoice = blocks.some((b) => b.preDrop);
    if (dropT !== null) {
      anchored('impact', dropT, 0, 1000, 'Impacto no drop');
      // a subida termina quando o impacto começa; não entra por cima da fala que vem antes do drop
      if (!hasPreDropVoice) anchored('riser', dropT - SFX_ANCHOR_S.impact, -5, 900, 'Subida até o drop');
    }
    // golpes e whoosh são seletivos: os cortes mais fortes primeiro, com respiro entre eles
    const perHit = Math.min(1, 0.35 + 0.65 * style.impactFx);
    for (const c of cutsLog) {
      if (c.isDrop) continue;
      if (c.hitAtS !== null && c.energy >= 0.5 && r2() < 0.5 * perHit) anchored('hit', c.hitAtS, -7, 50 + 40 * c.intensity, 'Golpe');
      else if (c.len >= 0.9 && c.energy >= 0.3 && c.energy < 0.8 && r2() < 0.22 * perHit) anchored('whoosh', c.startS, -9, 30, 'Whoosh antes do corte');
    }
    // resolve conflitos: o mais importante primeiro; nada por cima de fala nem de outro efeito (mesma trilha)
    cands.sort((a, b) => b.prio - a.prio || a.startS - b.startS);
    const kept: Cand[] = [];
    const maxN = Math.max(4, Math.ceil(D / 1.6));
    const SPACING_S = 0.75; // entre golpes/whoosh (impacto e subida ficam de fora)
    for (const c of cands) {
      if (kept.length >= maxN) break;
      const end = c.startS + c.durS;
      // 20 ms de tolerância: o impacto começa 4 ms antes do drop, onde a fala e a subida terminam
      if (blocks.some((b) => c.startS < b.atS + b.len - 0.02 && end > b.atS + 0.02)) continue;
      if (kept.some((k) => c.startS < k.startS + k.durS - 0.02 && end > k.startS + 0.02)) continue;
      const soft = c.kind === 'hit' || c.kind === 'whoosh';
      if (soft && kept.some((k) => (k.kind === 'hit' || k.kind === 'whoosh') && Math.abs(k.startS - c.startS) < SPACING_S)) continue;
      kept.push(c);
    }
    kept.sort((a, b) => a.startS - b.startS);
    for (const k of kept) {
      cmds.push({
        type: 'clip.add',
        clip: baseClip(sfxTrack!.id, assets[k.kind]!, k.startS, k.durS, k.srcIn, `Efeito sonoro: ${k.why}`, {
          audio: { gainDb: k.gainDb, fadeInUs: k.kind === 'riser' ? us(0.08) : 0, fadeOutUs: k.kind === 'riser' ? 0 : us(0.03), pitchSemitones: 0, streamIndex: null },
        }),
      });
    }
    return kept.length;
  }

  // ---------------------------------------------------------------- falas + imagem do personagem
  for (const b of blocks) {
    const { ep, s } = b;
    const reason = b.preDrop
      ? `Fala marcante antes do drop: ${s.text ? `"${s.text.replace(/\n/g, ' ')}"` : s.kind} — ${ep.name} ${fmt(s.startS)}; música abaixada durante a fala`
      : `Fala intercalada: ${s.text ? `"${s.text.replace(/\n/g, ' ')}"` : s.kind} — ${ep.name} ${fmt(s.startS)}; música abaixada`;
    const lead = b.atS - b.from;
    cmds.push({ type: 'clip.add', clip: baseClip(v1.id, ep.assetId, b.from, b.to - b.from, Math.max(0, s.startS - lead), reason, { effects: gradeFx(style.grade) }) });
    cmds.push({ type: 'clip.add', clip: baseClip(voice!.id, ep.assetId, b.atS, b.len, s.startS, reason, { audio: { gainDb: b.preDrop ? 3 : 2, fadeInUs: us(0.05), fadeOutUs: us(0.08), pitchSemitones: 0, streamIndex: streamFor(ep) } }) });
    if (opts.showText && text && s.text && style.subtitles !== 'none') cmds.push({ type: 'clip.add', clip: textClip(text.id, b.atS, b.len, s.text, H, 'line', 'Legenda da fala') });
    clipsMade++;
  }

  // legenda da música (se tiver a letra e o estilo não for "letra")
  if (opts.showText && text && opts.lyrics?.length && style.id !== 'letra' && style.subtitles !== 'none') {
    for (const c of opts.lyrics) {
      if (!Number.isFinite(c.startS) || c.endS <= range[0] || c.startS >= range[1]) continue;
      const a = Math.max(0, c.startS - range[0]);
      const b = Math.min(D, c.endS - range[0]);
      if (blocks.some((x) => a < x.atS + x.len && b > x.atS)) continue;
      cmds.push({ type: 'clip.add', clip: textClip(text.id, a, b - a, c.text, H, 'line', 'Letra da música') });
    }
  }

  const firstSpeech = blocks.find((b) => b.preDrop) ?? blocks[0];
  return {
    commands: cmds,
    summary: {
      clips: clipsMade,
      cuts: Math.max(0, clipsMade - 1),
      speech: firstSpeech ? (firstSpeech.s.text ?? firstSpeech.s.kind) : null,
      musicRange: range,
      drop: dropT,
      focus: plan.mode,
      fights: plan.pool.map((e) => `${e.ep.name} ${fmt(e.seq.startS)}–${fmt(e.seq.endS)}`),
      voices: blocks.length,
      hitsSynced: syncedHits,
      sfx: sfxCount,
    },
    warnings: [...new Set(warnings)],
  };
}

export type { Track };
