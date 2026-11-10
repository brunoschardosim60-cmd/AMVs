/**
 * Gerar meu AMV — atribuição de cenas a trechos da música, com regras por estilo.
 * Determinístico para a mesma `seed`. Saída: Commands comuns (tudo editável depois),
 * cada clipe com `origin: 'ai'` e um `reason` legível.
 */
import { SFX_ANCHOR_S, SFX_DURATION_S, type SfxKind } from '@amv/sfx';
import { impactScore, languageFamily, normLabel, pickAudioStreamByLanguage, shotKey, type EpisodeVision, type ShotVision, type Cue, type EpisodeAnalysis, type MusicAnalysis, type Sequence, type Shot, type SpeechSegment } from '@amv/analysis';
import { defaultScale, matchSceneColor, matchSceneExposure, newId, TextContentSchema, type Clip, type Command, type EffectInstance, type Project, type Track } from '@amv/project';
import { narrativeAt, narrativeRoleLabel, planNarrative, type NarrativeBeat } from './narrative.js';
import { buildMusicMap } from './music-map.js';
import { scoreSceneCandidate, type SceneScoreBreakdown } from './scoring.js';
import { chooseSceneTransition } from './transitions.js';
import { planSequence, type OrganizationMode, type SequencePlanCandidate } from './sequence-planner.js';
import { editorialStyle, styleDef, type EditorialDirection, type StyleDef, type StyleId } from './styles.js';
import type { CreativeEmphasis } from './creative-profiles.js';

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
  /** Correspondências semânticas de letra/cena aprovadas na análise visual opcional. */
  lyricSceneMatches?: Record<string, Record<string, { score: number; reason: string }>>;
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
  /** Organização temporal: cronologia estrita, continuidade narrativa ou livre com intenção musical/visual. */
  organizationMode?: OrganizationMode;
  /** Estratégia de montagem, separada do tema/conteúdo do AMV. */
  editorialDirection?: EditorialDirection;
  /** Efeitos sonoros (subida, impacto no drop, golpes, whoosh). Padrão: ligado, se `sfxAssets` vier. */
  useSfx?: boolean;
  /**
   * Só cenas em que aparece algum destes personagens (exige a análise com visão). Se não houver
   * cenas suficientes, usa todas e avisa.
   */
  characters?: string[];
  /** Onde estão os efeitos (id do asset de cada um). Sem isso, não coloca efeito sonoro. */
  sfxAssets?: Partial<Record<SfxKind, string>>;
  /** Pesos de preferência para sinais visuais analisados; 50/50 preserva o comportamento anterior. */
  creativeEmphasis?: CreativeEmphasis;
}

export interface GenerateResult {
  commands: Command[];
  summary: { clips: number; cuts: number; speech: string | null; musicRange: [number, number]; drop: number | null; focus: 'fight' | 'mix'; fights: string[]; voices: number; hitsSynced: number; sfx: number; direction: NarrativeBeat[] };
  warnings: string[];
}

interface Slot {
  startS: number; // tempo da timeline
  endS: number;
  energy: number;
  section: string;
  isDrop: boolean;
  /** Palavra com tempo próprio da letra; só existe quando a fonte traz tempo por palavra. */
  word?: string;
  wordTiming?: NonNullable<Cue['words']>[number];
  lyricCueKey?: string;
  musicCue?: string;
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

export function lyricCueKey(cue: Cue): string {
  const text = cue.text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${Math.round(cue.startS * 100)}:${Math.round(cue.endS * 100)}:${(hash >>> 0).toString(36)}`;
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
  const musicMap = buildMusicMap(m, range, beatOffsetS);
  const drop = m.drops.map((d) => d + beatOffsetS).find((d) => d > a + 1 && d < b - 1) ?? null;
  // Só usa cortes por palavra quando a legenda tem tempos de palavra reais/importados.
  if (style.id === 'letra' && lyrics?.length) {
    const words: { t: number; endS: number; w: string; cueKey: string; timing: NonNullable<Cue['words']>[number] }[] = [];
    for (const c of lyrics) {
      if (!Number.isFinite(c.startS) || c.endS <= a || c.startS >= b) continue;
      for (const timing of c.words ?? []) {
        if (timing.endS <= a || timing.startS >= b || !timing.text.trim()) continue;
        words.push({ t: Math.max(a, timing.startS), endS: Math.min(b, timing.endS), w: timing.text, cueKey: lyricCueKey(c), timing });
      }
    }
    words.sort((left, right) => left.t - right.t);
    if (words.length >= 2) {
      const slots: Slot[] = [];
      if (words[0]!.t > a + 0.2) slots.push({ startS: 0, endS: words[0]!.t - a, energy: energyAt(m, a), section: 'intro', isDrop: false });
      let lastEnd = a;
      words.forEach((w, i) => {
        // palavra fica no máximo ~1,5 s; depois da última, volta a cortar na batida
        const end = Math.min(b, words[i + 1]?.t ?? w.endS, w.endS, w.t + 1.5);
        if (end - w.t < 0.12) return;
        slots.push({ startS: w.t - a, endS: end - a, energy: energyAt(m, w.t), section: sectionAt(m, w.t)?.label ?? '', isDrop: drop !== null && Math.abs(w.t - drop) < 0.15, word: w.w, wordTiming: w.timing, lyricCueKey: w.cueKey });
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
  const subdivision = Math.min(1, ...style.beatsPerCut);
  const beatGrid = beats.length >= 4 ? beats : Array.from({ length: Math.ceil((b - a) / 0.5) + 1 }, (_, i) => a + beatOffsetS + i * 0.5);
  const grid: number[] = [];
  for (let i = 0; i < beatGrid.length; i++) {
    const current = beatGrid[i]!;
    const next = beatGrid[i + 1];
    grid.push(current);
    if (next !== undefined && subdivision < 1) {
      for (let part = 1; part < Math.round(1 / subdivision); part++) grid.push(current + ((next - current) * part) / Math.round(1 / subdivision));
    }
  }
  const speedUp = [1.6, 1.25, 1, 0.75][intensity]!;
  const slots: Slot[] = [];
  const impacts = musicMap.events.filter((event) => event.type === 'impact');
  let i = 0;
  let slotNumber = 0;
  let cur = a;
  while (cur < b - 0.05) {
    const e = energyAt(m, cur);
    const lvl = e < 0.35 ? 0 : e < 0.7 ? 1 : 2;
    const rhythmVariation = m.events ? (style.rhythmPattern[slotNumber % style.rhythmPattern.length] ?? 1) : 1;
    let cadence = style.beatsPerCut[lvl]! * speedUp * rhythmVariation;
    const timelineS = cur - a;
    const activeGrowth = musicMap.events.find((event) =>
      event.type === 'growth' && event.confidence >= 0.55
        && timelineS >= event.timelineS && timelineS < event.timelineS + (event.durationS ?? 0),
    );
    if (activeGrowth) {
      const progress = (timelineS - activeGrowth.timelineS) / Math.max(0.1, activeGrowth.durationS ?? 1);
      cadence *= Math.max(0.55, 1 - style.buildAcceleration * progress);
    }
    const activeRhythmChange = musicMap.events.find((event) =>
      event.type === 'rhythm-change' && event.confidence >= 0.55
        && timelineS >= event.timelineS && timelineS < event.timelineS + 2,
    );
    if (activeRhythmChange) {
      cadence *= activeRhythmChange.direction === 'faster' ? 0.75 : activeRhythmChange.direction === 'slower' ? 1.25 : 1;
    }
    const activePause = musicMap.events.some((event) =>
      event.type === 'pause' && event.confidence >= 0.55
        && timelineS >= event.timelineS && timelineS < event.timelineS + (event.durationS ?? 0),
    );
    if (activePause) cadence *= style.pauseHold;
    const toDrop = drop === null ? Infinity : drop - (cur + a);
    if (toDrop > 0 && toDrop <= 2.5) {
      cadence *= Math.max(0.55, 1 - style.preDropAcceleration * (1 - toDrop / 2.5));
    }
    const inEnding = !!m.events && (sectionAt(m, cur + a)?.label === 'final' || cur >= (b - a) * 0.9);
    if (inEnding) cadence *= style.endingHold;
    let n = Math.max(1, Math.round((cadence / subdivision)));
    // não atravessa o drop: o drop sempre abre um corte novo
    let next = grid[Math.min(grid.length - 1, i + n)] ?? b;
    const accentThreshold = Math.max(0.5, 0.9 - style.accentSensitivity * 0.4);
    const accent = impacts
      .filter((event) => event.confidence >= accentThreshold)
      .map((event) => event.timelineS + a)
      .find((timeS) => timeS >= cur + style.minCutS && timeS < next - style.minCutS);
    const rhythmBoundary = style.accentSensitivity >= 0.25
      ? musicMap.events
        .filter((event) => event.type === 'rhythm-change' && event.confidence >= 0.6)
        .map((event) => event.timelineS + a)
        .find((timeS) => timeS >= cur + style.minCutS && timeS < next - style.minCutS)
      : undefined;
    const musicalBoundary = [accent, rhythmBoundary].filter((timeS): timeS is number => timeS !== undefined).sort((left, right) => left - right)[0];
    if (musicalBoundary !== undefined) next = musicalBoundary;
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
    const startS = cur - a;
    const endS = Math.min(b, next) - a;
    const cue = lyrics?.filter((item) => Number.isFinite(item.startS) && item.endS > a + startS && item.startS < a + endS)
      .sort((left, right) => Math.min(right.endS, a + endS) - Math.max(right.startS, a + startS) - (Math.min(left.endS, a + endS) - Math.max(left.startS, a + startS)))[0];
    const impactAtCut = impacts.find((event) => Math.abs(event.timelineS - timelineS) <= 0.08 && event.confidence >= accentThreshold);
    const rhythmChangeAtCut = activeRhythmChange && Math.abs(activeRhythmChange.timelineS - timelineS) <= 0.08;
    const musicCue = activePause ? 'pausa musical'
      : activeGrowth ? 'crescimento musical'
        : rhythmChangeAtCut ? `mudança de ritmo (${activeRhythmChange.direction ?? 'não classificada'})`
        : impactAtCut ? `acento espectral (${impactAtCut.band ?? 'banda não classificada'})`
          : undefined;
    slots.push({
      startS,
      endS,
      energy: e,
      section: sectionAt(m, cur)?.label ?? '',
      isDrop: drop !== null && Math.abs(cur - drop) < 0.06,
      ...(cue ? { lyricCueKey: lyricCueKey(cue) } : {}),
      ...(musicCue ? { musicCue } : {}),
    });
    slotNumber++;
    i = grid.findIndex((g) => g >= next - 0.01);
    if (i < 0) break;
    cur = next;
  }
  return slots.filter((s) => s.endS - s.startS > 0.05);
}

interface Candidate extends SequencePlanCandidate {
  ep: EpisodeInput;
  shot: Shot;
  /** Sequência de origem (`${assetId}#${sequenceId}`), inclusive no modo misturar. */
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
const MIX_SEQUENCE_DROP_BONUS = 0.5;
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
  if (visual?.confidence === undefined || visual.confidence < 0.55 || visual.visualIntensity === undefined) {
    return visual?.local ? shot.intensity * 0.8 + visual.local.temporalMotion * 0.2 : shot.intensity;
  }
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
export function planFootage(eps: EpisodeInput[], o: Pick<GenerateOptions, 'style' | 'intensity' | 'durationS' | 'focus' | 'sequenceIds' | 'exclude' | 'seed' | 'characters' | 'editorialDirection'>, m?: MusicAnalysis): FootagePlan {
  const style = editorialStyle(styleDef(o.style), o.editorialDirection ?? 'balanced');
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

function hasRequestedSpeechAudio(ep: EpisodeInput, lang: 'original' | 'pt'): boolean {
  return lang !== 'pt' || (ep.audioStreams?.length ?? 0) < 2 || pickAudioStream(ep, lang) !== null;
}

function speechTextMatchesAudio(ep: EpisodeInput, speech: SpeechSegment, lang: 'original' | 'pt'): boolean {
  if (!speech.text || !speech.language) return true;
  const textLanguage = languageFamily(speech.language);
  if (!textLanguage) return true;
  if (lang === 'pt' && textLanguage !== 'pt') return false;
  const selectedIndex = pickAudioStream(ep, lang);
  const selected = ep.audioStreams?.find((stream) => stream.index === selectedIndex)
    ?? (selectedIndex === null ? ep.audioStreams?.[0] : undefined);
  const audioLanguage = languageFamily(selected?.title) ?? languageFamily(selected?.language);
  return !audioLanguage || audioLanguage === textLanguage;
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

function generatedVoiceDuckCompensationDb(project: Project, musicTrack: Track, voiceTrack: Track | undefined): number {
  const mixTracks = project.tracks.filter((track) =>
    track.kind === 'audio' || (track.kind === 'video' && project.audioMix.includeVideoAudio),
  );
  const anySolo = mixTracks.some((track) => track.solo);
  const musicAudible = !musicTrack.muted && (!anySolo || musicTrack.solo);
  const voiceAudible = !!voiceTrack && voiceTrack.role === 'voice' && !voiceTrack.muted && (!anySolo || voiceTrack.solo);
  const automaticDuckDb = project.audioMix.duckingEnabled
    && (musicTrack.role === 'music' || musicTrack.role === 'music2')
    && musicAudible
    && voiceAudible
    ? project.audioMix.duckingAmountDb
    : 0;
  return automaticDuckDb;
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
    reverse: false,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
    blendMode: 'normal',
    mask: 'none',
    groupId: null,
    audio: { gainDb: 0, fadeInUs: 0, fadeOutUs: 0, pitchSemitones: 0, pitchMode: 'preserve', streamIndex: null },
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

function textClip(
  trackId: string,
  startS: number,
  durS: number,
  text: string,
  H: number,
  kind: 'word' | 'line',
  reason: string,
  highlight = false,
  impact = 0,
  timing?: NonNullable<Cue['words']>[number][],
  preset: 'lyrics-cinematic' | 'dialogue-dramatic' = kind === 'word' ? 'lyrics-cinematic' : 'dialogue-dramatic',
): Clip {
  const word = kind === 'word';
  const startUs = Math.round(startS * 1e6);
  const endUs = startUs + Math.max(40_000, Math.round(durS * 1e6));
  const wordTimings = (timing ?? []).flatMap((item) => {
    const a = Math.max(startUs, Math.round(item.startS * 1e6));
    const b = Math.min(endUs, Math.round(item.endS * 1e6));
    if (b <= a) return [];
    return [{
      text: item.text,
      startUs: a - startUs,
      endUs: b - startUs,
      source: item.source,
      confidence: item.confidence ?? null,
      uncertain: item.uncertain ?? (item.confidence != null && item.confidence < 0.78),
    }];
  });
  const isLyrics = preset === 'lyrics-cinematic';
  return baseClip(trackId, null, startS, durS, 0, reason, {
    transform: { x: 0, y: word ? 0 : Math.round(H * (isLyrics ? 0.22 : 0.28)), scale: 1, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
    text: TextContentSchema.parse({
      text: word ? text.toUpperCase() : text,
      font: 'Manrope Variable',
      size: Math.round(H * (word ? 0.105 : (isLyrics ? 0.09 : 0.062) * (1 + 0.25 * Math.max(0, Math.min(1, impact))))),
      weight: word ? 900 : isLyrics ? 800 : 700,
      color: highlight ? '#fff0a6' : '#ffffff',
      outlineColor: '#000000',
      outlineWidth: word ? 5 : 3,
      shadow: true,
      animationIn: 'pop',
      animationOut: 'fade',
      background: isLyrics ? 'none' : 'box',
      backgroundOpacity: 0.78,
      alignment: 'center',
      maxWidthRatio: 0.86,
      marginX: Math.round(H * 0.06),
      marginY: Math.round(H * 0.04),
      padding: Math.round(H * 0.025),
      highlightColor: highlight ? '#fff0a6' : '#ffd166',
      highlightScale: 1.18,
      timingPrecision: wordTimings.length ? 'word' : 'segment',
      wordTimings,
    }),
  });
}

function addCaptionPhrases(commands: Command[], trackId: string, startS: number, durationS: number, text: string, height: number, reason: string, impact = 0): void {
  if (!text.trim() || durationS <= 0) return;
  commands.push({ type: 'clip.add', clip: textClip(trackId, startS, durationS, text, height, 'line', reason, false, impact, undefined, 'dialogue-dramatic') });
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
  const organizationMode = opts.organizationMode ?? 'narrative';
  const editorialDirection = opts.editorialDirection ?? 'balanced';
  const style = editorialStyle(styleDef(opts.style), editorialDirection);
  const warnings: string[] = [];
  const rand = rng(opts.seed);
  const { v1, text, music: musicTrack, voice, sfx: sfxTrack } = findTracks(project);
  if (!v1 || !musicTrack) throw new Error('o projeto precisa de uma trilha de vídeo e uma de música');
  const H = project.settings.height;
  const sceneExclusions = new Set(project.sceneAnnotations
    .filter((annotation) => annotation.excludedFromAuto)
    .map((annotation) => `${annotation.assetId}@${annotation.sceneKey}`));
  const exclude = new Set(opts.exclude ?? []);
  const m = music.analysis;
  const beatOffsetS = Math.max(-500, Math.min(500, opts.beatOffsetMs ?? 0)) / 1000;
  if (m.bpmConfidence < 0.4) {
    warnings.push(`Confiança baixa na pulsação (${Math.round(m.bpmConfidence * 100)}%); os cortes seguem uma grade aproximada. Ajuste o BPM/offset manualmente ou revise os cortes antes de exportar.`);
  }

  // ---------------------------------------------------------------- de onde saem as cenas
  const plan = planFootage(episodes, { ...opts, exclude: [...exclude, ...sceneExclusions] }, m);
  warnings.push(...plan.warnings);
  const fight = plan.mode === 'fight';
  const poolEps = new Set(plan.pool.map((e) => e.ep.assetId));
  const sequenceOrders = new Map<string, number>();
  const episodeOrders = new Map(episodes.map((ep, index) => [ep.assetId, index]));
  for (const ep of episodes) {
    for (const [index, sequence] of [...(ep.analysis.sequences ?? [])].sort((a, b) => a.startS - b.startS).entries()) {
      sequenceOrders.set(`${ep.assetId}#${sequence.id}`, index);
    }
  }
  const sequenceFor = (ep: EpisodeInput, shot: Shot) => ep.analysis.sequences?.find((sequence) => shot.startS >= sequence.startS - 1e-3 && shot.endS <= sequence.endS + 1e-3);
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
  const direction = planNarrative(m, range, beatOffsetS);
  if (dropT === null) warnings.push('A música não tem um drop claro nesse trecho: a montagem segue a energia da música.');
  if (opts.style === 'letra' && !opts.lyrics?.length) warnings.push('Sem a letra com tempo (LRC), o estilo "letra" corta na batida mas não escreve as palavras. Importe a letra em Legendas.');
  const lang = opts.voiceLang ?? 'original';
  const streamFor = (ep: EpisodeInput) => pickAudioStream(ep, lang);
  if (lang === 'pt' && episodes.some((ep) => !exclude.has(ep.assetId) && !hasRequestedSpeechAudio(ep, lang))) {
    warnings.push('Há episódio sem faixa em português identificada. As falas desses episódios foram omitidas; nenhuma faixa diferente foi usada como substituta.');
  }

  const cmds: Command[] = [];
  // limpa as trilhas que a geração preenche (o projeto anterior fica salvo como versão pelo app)
  const filled = new Set([v1.id, musicTrack.id, voice?.id, text?.id, sfxTrack?.id].filter(Boolean) as string[]);
  for (const c of project.clips) if (filled.has(c.trackId)) cmds.push({ type: 'clip.remove', clipId: c.id });

  // ---------------------------------------------------------------- música
  const fadeOut = Math.min(2, D * 0.08);
  const musicClip = baseClip(musicTrack.id, music.assetId, 0, D, range[0], `Trecho ${fmt(range[0])}–${fmt(range[1])} de ${music.name}${dropT !== null ? `: drop em ${fmt(dropT)} do vídeo` : ''}`, {
    audio: { gainDb: opts.style === 'discurso' ? -14 : 0, fadeInUs: range[0] > 0.5 ? us(0.3) : 0, fadeOutUs: us(fadeOut), pitchSemitones: 0, pitchMode: 'preserve', streamIndex: null },
  });

  // ---------------------------------------------------------------- falas (antes do drop e intercaladas)
  const blocks: VoiceBlock[] = [];
  const wantVoice = opts.useSpeech && voice && opts.style !== 'discurso';
  const totalVoice = wantVoice ? Math.max(0, Math.min(5, Math.round(opts.voiceMoments ?? (style.speechBeforeDrop ? 1 : 0)))) : 0;
  if (wantVoice && totalVoice > 0 && style.speechBeforeDrop && dropT !== null) {
    const acceptSpeech = (ep: EpisodeInput) => hasRequestedSpeechAudio(ep, lang);
    let pick = pickSpeech(episodes, Math.min(4, dropT - 0.2), exclude, (ep, speech) => nearPool(ep, speech) && acceptSpeech(ep));
    if (!pick && fight) pick = pickSpeech(episodes, Math.min(4, dropT - 0.2), exclude, (ep) => poolEps.has(ep.assetId) && acceptSpeech(ep));
    if (pick) {
      const len = pick.s.endS - pick.s.startS;
      blocks.push({ ep: pick.ep, s: pick.s, atS: dropT - len, len, from: dropT - len, to: dropT, preDrop: true });
    } else warnings.push('Nenhuma fala marcante encontrada nos episódios (legendas embutidas ajudam muito).');
  }
  const extraWanted = totalVoice - blocks.length;
  if (wantVoice && extraWanted > 0) {
    const taken = new Set(blocks.map((b) => `${b.ep.assetId}@${b.s.startS}`));
    const lines = episodes
      .filter((e) => e.hasAudio && !exclude.has(e.assetId) && hasRequestedSpeechAudio(e, lang))
      .flatMap((ep) => ep.analysis.speech.filter((sp) => nearPool(ep, sp) || (fight && poolEps.has(ep.assetId))).map((sp) => ({ ep, sp })))
      .filter(({ ep, sp }) => sp.endS - sp.startS >= 0.8 && sp.endS - sp.startS <= 4 && speechTextMatchesAudio(ep, sp, lang))
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
    const musicDuckDb = DUCK_DB + generatedVoiceDuckCompensationDb(project, musicTrack, voice);
    const kf: { atUs: number; value: number; easing: 'linear' }[] = [];
    for (const b of blocks) {
      const a = b.atS;
      const end = b.preDrop ? dropT! : b.atS + b.len;
      kf.push({ atUs: us(Math.max(0, a - 0.35)), value: 0, easing: 'linear' }, { atUs: us(a), value: musicDuckDb, easing: 'linear' });
      if (b.preDrop) kf.push({ atUs: us(end - 0.06), value: musicDuckDb, easing: 'linear' }, { atUs: us(end), value: 0, easing: 'linear' });
      else kf.push({ atUs: us(end), value: musicDuckDb, easing: 'linear' }, { atUs: us(end + 0.4), value: 0, easing: 'linear' });
    }
    musicClip.keyframes['audio.gainDb'] = kf;
  }
  cmds.push({ type: 'clip.add', clip: musicClip });

  // ---------------------------------------------------------------- estilo discurso: as falas são a espinha
  const used = new Set<string>();
  let clipsMade = 0;
  if (opts.style === 'discurso' && voice) {
    const lines = episodes
      .filter((e) => e.hasAudio && !exclude.has(e.assetId) && hasRequestedSpeechAudio(e, lang))
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
      const sourceText = speechTextMatchesAudio(ep, s, lang) ? s.text : null;
      const reason = `Fala ${sourceText ? `"${sourceText.replace(/\n/g, ' ')}" ` : ''}de ${ep.name} ${fmt(s.startS)} (impacto ${s.impact.toFixed(2)})`;
      cmds.push({ type: 'clip.add', clip: baseClip(v1.id, ep.assetId, t, len + 0.35, s.startS, reason, { effects: [...gradeFx(style.grade)] }) });
      cmds.push({ type: 'clip.add', clip: baseClip(voice.id, ep.assetId, t, len, s.startS, reason, { audio: { gainDb: 2, fadeInUs: us(0.05), fadeOutUs: us(0.1), pitchSemitones: 0, pitchMode: 'preserve', streamIndex: streamFor(ep) } }) });
      if (opts.showText && text && sourceText) addCaptionPhrases(cmds, text.id, t, len, sourceText, H, 'Legenda da fala', Math.max(s.impact, impactScore(sourceText)));
      used.add(`${ep.assetId}@${s.startS}`);
      clipsMade++;
      t += len + 0.35;
    }
    return { commands: cmds, summary: { clips: clipsMade, cuts: clipsMade, speech: chosen[0] && speechTextMatchesAudio(chosen[0].ep, chosen[0].s, lang) ? chosen[0].s.text : null, musicRange: range, drop: dropT, focus: 'mix', fights: [], voices: chosen.length, hitsSynced: 0, sfx: 0, direction }, warnings };
  }

  // ---------------------------------------------------------------- cortes na batida
  const REPEAT_WARNING = 'Poucas cenas em sequência para o tamanho do vídeo: algumas se repetem. Importe mais episódios ou escolha mais lutas.';
  const slots = makeSlots(m, range, style, opts.intensity, opts.lyrics, beatOffsetS);
  const candidates: Candidate[] = [];
  const consider = (ep: EpisodeInput, shot: Shot) => {
    const id = `${ep.assetId}@${shot.startS}`;
    if (exclude.has(id) || sceneExclusions.has(`${ep.assetId}@${shotKey(shot.startS)}`) || shot.endS - shot.startS < 0.25) return;
    if (plan.wanted && !hasCharacter(ep, shot, plan.wanted)) return;
    const sequence = sequenceFor(ep, shot);
    const seq = sequence ? `${ep.assetId}#${sequence.id}` : `${ep.assetId}#-`;
    candidates.push({
      ep,
      shot,
      id,
      assetId: ep.assetId,
      sourceStartS: shot.startS,
      sourceEndS: shot.endS,
      seq,
      sequenceOrder: sequenceOrders.get(seq) ?? 0,
      episodeOrder: episodeOrders.get(ep.assetId) ?? Number.MAX_SAFE_INTEGER,
    });
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
    return { commands: cmds, summary: { clips: 0, cuts: 0, speech: null, musicRange: range, drop: dropT, focus: plan.mode, fights: [], voices: 0, hitsSynced: 0, sfx: 0, direction }, warnings };
  }
  const { lowI, highI } = plan.fit;
  const boost = 0; // já embutido em plan.fit

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

  const scoreCandidate = (sl: Slot, c: Candidate, previous: Candidate | null, previousSlot: Slot | null) => {
    const len = sl.endS - sl.startS;
    if (c.shot.endS - c.shot.startS + 1e-6 < len * 0.6) return null;
    const narrativeBeat = narrativeAt(direction, (sl.startS + sl.endS) / 2);
    const target = Math.min(1, Math.max(0, lowI + (highI - lowI) * sl.energy + boost + (sl.isDrop ? 0.15 : 0)));
    const previousVision = previous ? visionOf(previous.ep, previous.shot) : undefined;
    const currentVision = visionOf(c.ep, c.shot);
    const transitionCue = sl.isDrop
      ? 'entrada do drop'
      : previousSlot && previousSlot.section !== sl.section
        ? 'mudança de seção musical'
        : previousSlot && Math.abs(previousSlot.energy - sl.energy) >= 0.3
          ? 'contraste de energia musical'
          : null;
    const lyricMatch = sl.lyricCueKey ? opts.lyricSceneMatches?.[c.id]?.[sl.lyricCueKey] : undefined;
    const breakdown = scoreSceneCandidate({
      shot: c.shot,
      effectiveIntensity: effectiveShotIntensity(c.ep, c.shot),
      targetIntensity: target,
      musicEnergy: sl.energy,
      isDrop: sl.isDrop,
      narrativeRole: narrativeBeat?.role,
      style,
      current: { assetId: c.ep.assetId, sequenceId: c.seq, sourceStartS: c.shot.startS },
      previous: previous ? {
        assetId: previous.ep.assetId,
        sequenceId: previous.seq,
        sourceEndS: previous.shot.endS,
        vision: previousVision,
        local: previousVision?.local,
      } : undefined,
      vision: currentVision,
      local: currentVision?.local,
      lyricMatchScore: lyricMatch?.score,
      organizationMode,
      editorialDirection,
      transitionCue,
      sourceJumpS: previous?.ep.assetId === c.ep.assetId ? c.shot.startS - previous.shot.endS : null,
      creativeEmphasis: opts.creativeEmphasis,
    });
    const dropSequenceBonus = sl.isDrop && opts.focus === 'mix' && previous?.ep.assetId === c.ep.assetId && c.sequenceOrder > previous.sequenceOrder
      ? MIX_SEQUENCE_DROP_BONUS
      : 0;
    return { breakdown, score: breakdown.total + dropSequenceBonus };
  };

  const sequencePlan = planSequence(fitSlots, candidates, {
    mode: organizationMode,
    seed: opts.seed,
    score: (slot, candidate, previous, previousSlot) => scoreCandidate(slot, candidate, previous, previousSlot)?.score ?? Number.NEGATIVE_INFINITY,
    candidateWindow: organizationMode === 'narrative' && fitSlots.length > 3
      ? (slot, musicSlot, forward, progress) => {
          const byAsset = new Map<string, Candidate[]>();
          for (const candidate of forward) {
            const list = byAsset.get(candidate.assetId) ?? [];
            list.push(candidate);
            byAsset.set(candidate.assetId, list);
          }
          const window: Candidate[] = [];
          for (const [assetId, list] of byAsset) {
            const ordered = list.sort((a, b) => a.sequenceOrder - b.sequenceOrder || a.sourceStartS - b.sourceStartS);
            const progressForAsset = progress.get(assetId);
            const currentOrder = progressForAsset?.sequenceOrder ?? ordered[0]!.sequenceOrder;
            const currentSequence = ordered.filter((candidate) => candidate.sequenceOrder === currentOrder);
            if (musicSlot.isDrop || musicSlot.energy >= 0.8) {
              const isFightScene = (candidate: Candidate) => !candidate.shot.tags.includes('calma') && visionOf(candidate.ep, candidate.shot)?.fight !== false;
              if (musicSlot.isDrop) {
                const anchor = progressForAsset?.sourceEndS ?? currentSequence[0]?.sourceStartS ?? 0;
                window.push(...currentSequence.filter((candidate) => candidate.sourceStartS <= anchor + 20));
              } else {
                window.push(...currentSequence.filter(isFightScene).slice(0, 1));
              }
              const nextOrder = ordered.find((candidate) => candidate.sequenceOrder > currentOrder)?.sequenceOrder;
              if (nextOrder !== undefined) {
                const nextFight = ordered.find((candidate) => candidate.sequenceOrder === nextOrder && isFightScene(candidate));
                if (nextFight) window.push(nextFight);
              }
            } else {
              window.push(ordered[0]!);
            }
          }
          if (musicSlot.lyricCueKey) {
            window.push(...forward.filter((candidate) => (opts.lyricSceneMatches?.[candidate.id]?.[musicSlot.lyricCueKey!]?.score ?? 0) >= 0.6));
          }
          return window.length
            ? [...new Map(window.map((candidate) => [candidate.id, candidate])).values()]
            : forward.slice(0, 1);
        }
      : undefined,
  });
  if (sequencePlan.repeatedSlots.length && !warnings.includes(REPEAT_WARNING)) warnings.push(REPEAT_WARNING);
  if (sequencePlan.choices.some((candidate) => candidate === null)) {
    warnings.push('Alguns trechos da timeline ficaram sem cena compatível com a duração disponível.');
  }

  let syncedHits = 0;
  let hitSlots = 0;
  let prev: Candidate | null = null;
  let prevSlot: Slot | null = null;
  /** Para os efeitos sonoros: onde cada corte/golpe aconteceu na timeline. */
  const cutsLog: { startS: number; len: number; energy: number; intensity: number; isDrop: boolean; hitAtS: number | null; lyricCueKey?: string; lyricMatchScore?: number; lyricMatchReason?: string }[] = [];

  for (const [slotIndex, sl] of fitSlots.entries()) {
    const len = sl.endS - sl.startS;
    const c = sequencePlan.choices[slotIndex];
    if (!c) continue;
    const scored = scoreCandidate(sl, c, prev, prevSlot);
    if (!scored) continue;
    const narrativeBeat = narrativeAt(direction, (sl.startS + sl.endS) / 2);
    const target = Math.min(1, Math.max(0, lowI + (highI - lowI) * sl.energy + boost + (sl.isDrop ? 0.15 : 0)));
    const best = {
      c,
      score: scored.score,
      breakdown: scored.breakdown,
      srcIn: c.shot.startS + Math.min(0.12, Math.max(0, c.shot.endS - c.shot.startS - len)) + Math.max(0, c.shot.endS - c.shot.startS - len) * 0.25 * rand(),
    };
    const lyricMatch = sl.lyricCueKey ? opts.lyricSceneMatches?.[c.id]?.[sl.lyricCueKey] : undefined;
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
        const actualLead = (c.shot.peakS - at) / speed;
        const minLead = sl.isDrop ? 0.02 : 0.03;
        const maxLead = sl.isDrop ? 0.07 : 0.13;
        if (actualLead >= minLead && actualLead <= maxLead && Math.abs(at - want) / speed <= 0.15) {
          srcIn = at;
          hit = true;
          syncedHits++;
        }
      }
    }

    const priorGrade = project.clips.find((old) =>
      old.trackId === v1.id && old.origin === 'ai' && sl.startS * S >= old.timelineStartUs && sl.startS * S < old.timelineStartUs + old.durationUs,
    )?.effects.filter((effect) => effect.effect === 'color' || effect.effect === 'vignette') ?? [];
    const effects: EffectInstance[] = priorGrade.length
      ? priorGrade.map((effect) => ({ ...structuredClone(effect), id: newId('fx') }))
      : [...gradeFx(style.grade)];
    const exposureMatch = prev ? matchSceneExposure(prev.shot.brightness, c.shot.brightness) : 0;
    const previousLocal = prev ? visionOf(prev.ep, prev.shot)?.local : undefined;
    const currentLocal = visionOf(c.ep, c.shot)?.local;
    const colorMatch = previousLocal?.samples && previousLocal.samples >= 2 && currentLocal?.samples && currentLocal.samples >= 2
      ? matchSceneColor(previousLocal.colorHistogram, currentLocal.colorHistogram)
      : { temperature: 0, tint: 0 };
    if (exposureMatch || colorMatch.temperature || colorMatch.tint) {
      effects.push(fx('color', {
        brightness: 0, contrast: 1, saturation: 1, exposure: exposureMatch,
        temperature: colorMatch.temperature, tint: colorMatch.tint, hue: 0, shadows: 0, midtones: 0, highlights: 0, vignette: 0,
      }));
    }
    const fxOn = opts.useEffects && style.impactFx > 0;
    const visual = visionOf(c.ep, c.shot);
    const hasVisualImpact = c.shot.tags.includes('impacto') || (visual?.confidence !== undefined && visual.confidence >= 0.55 && visual.action === 'combate');
    if (fxOn && sl.isDrop) {
      const flashStrength = editorialDirection === 'cinematic' ? 0.5 : editorialDirection === 'hype' ? 1.15 : 1;
      effects.push(fx('flash', { duration: editorialDirection === 'cinematic' ? 0.12 : 0.2, white: 1, strength: flashStrength }));
      if (hasVisualImpact) {
        const shakeIntensity = editorialDirection === 'cinematic' ? 8 : editorialDirection === 'hype' ? 28 : 22;
        effects.push(fx('shake', { intensity: shakeIntensity, frequency: 14, duration: editorialDirection === 'cinematic' ? 0.2 : 0.45 }));
      }
    } else if (fxOn && editorialDirection !== 'cinematic' && sl.energy > 0.7 && hasVisualImpact && rand() < 0.45 * style.impactFx) {
      const intensity = editorialDirection === 'hype' ? 18 : 14;
      effects.push(fx('shake', { intensity, frequency: 12, duration: Math.min(0.35, len) }));
    } else if (fxOn && editorialDirection !== 'cinematic' && sl.energy > 0.55 && len >= 0.8 && rand() < 0.3 * style.impactFx) {
      effects.push(fx('zoom', { from: 1, to: 1.15, ease: 1 }));
    }
    const previousVision = prev ? visionOf(prev.ep, prev.shot) : undefined;
    const currentVision = visionOf(c.ep, c.shot);
    const transitionChoice = prev
      ? chooseSceneTransition({
          outgoing: { shot: prev.shot, local: previousVision?.local, vision: previousVision },
          incoming: { shot: c.shot, local: currentVision?.local, vision: currentVision },
          musicEnergy: sl.energy,
          isDrop: sl.isDrop,
          durationS: len,
          direction: editorialDirection,
          style: opts.style,
        })
      : null;
    const transition = transitionChoice?.transition ?? null;
    const clipEffects = transition?.transition === 'flash'
      ? effects.filter((effect) => effect.effect !== 'flash')
      : effects;
    const why = [
      narrativeBeat ? `${narrativeRoleLabel(narrativeBeat.role)} (${narrativeBeat.section})` : null,
      sl.isDrop ? `Drop em ${fmt(sl.startS)}` : `${sl.section || 'trecho'} (energia ${sl.energy.toFixed(2)})`,
      sl.musicCue ?? null,
      `cena de ${c.shot.tags.join('/') || 'intensidade'} ${sceneIntensity.toFixed(2)}`,
      `${c.ep.name} · sequência ${c.seq.split('#')[1] ?? '-'} · origem ${fmt(c.shot.startS)}`,
      visionOf(c.ep, c.shot)?.action ? `ação ${visionOf(c.ep, c.shot)!.action}` : null,
      visionOf(c.ep, c.shot)?.emotion ? `emoção ${visionOf(c.ep, c.shot)!.emotion}` : null,
      fight ? 'luta escolhida' : null,
      visionOf(c.ep, c.shot)?.characters.length ? `com ${visionOf(c.ep, c.shot)!.characters.join(' e ')}` : null,
      lyricMatch && lyricMatch.score >= 0.6 ? `combina com a letra "${opts.lyrics?.find((cue) => lyricCueKey(cue) === sl.lyricCueKey)?.text ?? ''}": ${lyricMatch.reason}` : null,
      best.breakdown.reasons.length ? `critérios: ${best.breakdown.reasons.join(', ')}` : null,
      sequencePlan.repeatedSlots.includes(slotIndex) ? 'cena repetida por falta de material novo' : null,
      hit ? 'golpe na batida' : null,
      speed < 1 ? `câmera lenta ${speed.toFixed(2)}×` : null,
      exposureMatch ? `exposição ajustada ${exposureMatch > 0 ? '+' : ''}${exposureMatch.toFixed(2)} EV pela diferença de luminosidade` : null,
      colorMatch.temperature || colorMatch.tint ? 'cor suavizada em relação à cena anterior usando histogramas visuais locais' : null,
      transitionChoice?.reason ?? null,
    ]
      .filter(Boolean)
      .join(' — ');
    const clip = baseClip(v1.id, c.ep.assetId, sl.startS, len, srcIn, why, { speed, sourceOutUs: us(srcIn) + us(srcLen), effects: clipEffects, transitionIn: transition });
    clip.sourceOutUs = clip.sourceInUs + Math.round(clip.durationUs * speed);
    cmds.push({ type: 'clip.add', clip });
    if (opts.showText && text && sl.word) {
      const timing = sl.wordTiming
        ? [{ ...sl.wordTiming, startS: sl.startS, endS: sl.endS }]
        : undefined;
      cmds.push({ type: 'clip.add', clip: textClip(text.id, sl.startS, len, sl.word, H, 'word', 'Palavra da letra', sl.isDrop, 0, timing, 'lyrics-cinematic') });
    }
    used.add(c.id);
    cutsLog.push({ startS: sl.startS, len, energy: sl.energy, intensity: c.shot.intensity, isDrop: sl.isDrop, hitAtS: hit ? sl.startS + (c.shot.peakS - srcIn) / speed : null, ...(sl.lyricCueKey ? { lyricCueKey: sl.lyricCueKey } : {}), ...(lyricMatch ? { lyricMatchScore: lyricMatch.score, lyricMatchReason: lyricMatch.reason } : {}) });
    prev = c;
    prevSlot = sl;
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
          audio: { gainDb: k.gainDb, fadeInUs: k.kind === 'riser' ? us(0.08) : 0, fadeOutUs: k.kind === 'riser' ? 0 : us(0.03), pitchSemitones: 0, pitchMode: 'preserve', streamIndex: null },
        }),
      });
    }
    return kept.length;
  }

  // ---------------------------------------------------------------- falas + imagem do personagem
  for (const b of blocks) {
    const { ep, s } = b;
    const sourceText = speechTextMatchesAudio(ep, s, lang) ? s.text : null;
    const reason = b.preDrop
      ? `Fala marcante antes do drop: ${sourceText ? `"${sourceText.replace(/\n/g, ' ')}"` : s.kind} — ${ep.name} ${fmt(s.startS)}; música abaixada durante a fala`
      : `Fala intercalada: ${sourceText ? `"${sourceText.replace(/\n/g, ' ')}"` : s.kind} — ${ep.name} ${fmt(s.startS)}; música abaixada`;
    const lead = b.atS - b.from;
    cmds.push({ type: 'clip.add', clip: baseClip(v1.id, ep.assetId, b.from, b.to - b.from, Math.max(0, s.startS - lead), reason, { effects: gradeFx(style.grade) }) });
    cmds.push({ type: 'clip.add', clip: baseClip(voice!.id, ep.assetId, b.atS, b.len, s.startS, reason, { audio: { gainDb: b.preDrop ? 3 : 2, fadeInUs: us(0.05), fadeOutUs: us(0.08), pitchSemitones: 0, pitchMode: 'preserve', streamIndex: streamFor(ep) } }) });
    if (opts.showText && text && sourceText && style.subtitles !== 'none') addCaptionPhrases(cmds, text.id, b.atS, b.len, sourceText, H, 'Legenda da fala', Math.max(s.impact, impactScore(sourceText)));
    clipsMade++;
  }

  // Legendas da música evitam os golpes principais e acompanham a grade quando perto dela.
  let skippedLyrics = 0;
  if (opts.showText && text && opts.lyrics?.length && style.id !== 'letra' && style.subtitles !== 'none') {
    const impactWindows = [
      ...(dropT === null ? [] : [{ startS: dropT - 0.12, endS: dropT + 0.2 }]),
      ...cutsLog
        .filter((cut) => cut.isDrop || (cut.energy >= 0.85 && cut.intensity >= 0.85))
        .map((cut) => {
          const at = cut.hitAtS ?? cut.startS;
          return { startS: Math.max(0, at - 0.1), endS: at + 0.2 };
        }),
    ];
    const beatsOnTimeline = m.beats.map((beat) => beat + beatOffsetS - range[0]);
    for (const c of opts.lyrics) {
      if (!Number.isFinite(c.startS) || c.endS <= range[0] || c.startS >= range[1]) continue;
      let a = Math.max(0, c.startS - range[0]);
      const b = Math.min(D, c.endS - range[0]);
      if (blocks.some((x) => a < x.atS + x.len && b > x.atS)) {
        skippedLyrics++;
        continue;
      }
      const nearestBeat = beatsOnTimeline.reduce<{ time: number; distance: number } | null>((best, beat) => {
        const distance = Math.abs(beat - a);
        return distance < (best?.distance ?? Infinity) ? { time: beat, distance } : best;
      }, null);
      if (nearestBeat && nearestBeat.distance <= 0.1 && nearestBeat.time >= 0 && nearestBeat.time < b) a = nearestBeat.time;
      const lyricKey = lyricCueKey(c);
      const lyricSceneMatch = cutsLog.find((cut) => cut.lyricCueKey === lyricKey && (cut.lyricMatchScore ?? 0) >= 0.65 && cut.startS < b && cut.startS + cut.len > a);
      if (!lyricSceneMatch && impactWindows.some((window) => a < window.endS && b > window.startS)) {
        skippedLyrics++;
        continue;
      }
      const reason = lyricSceneMatch ? `Letra da música · ${lyricSceneMatch.lyricMatchReason}` : 'Letra da música';
      const wordTimings = c.words?.map((word) => ({
        ...word,
        startS: word.startS - range[0],
        endS: word.endS - range[0],
      }));
      cmds.push({
        type: 'clip.add',
        clip: textClip(text.id, a, b - a, c.text, H, 'line', reason, true, Math.max(impactScore(c.text), lyricSceneMatch?.lyricMatchScore ?? 0), wordTimings, 'lyrics-cinematic'),
      });
    }
  }
  if (skippedLyrics) warnings.push(`${skippedLyrics} trecho(s) de letra foram omitidos para evitar sobreposição com falas ou momentos de impacto.`);

  const firstSpeech = blocks.find((b) => b.preDrop) ?? blocks[0];
  return {
    commands: cmds,
    summary: {
      clips: clipsMade,
      cuts: Math.max(0, clipsMade - 1),
      speech: firstSpeech ? (speechTextMatchesAudio(firstSpeech.ep, firstSpeech.s, lang) ? firstSpeech.s.text ?? firstSpeech.s.kind : firstSpeech.s.kind) : null,
      musicRange: range,
      drop: dropT,
      focus: plan.mode,
      fights: plan.pool.map((e) => `${e.ep.name} ${fmt(e.seq.startS)}–${fmt(e.seq.endS)}`),
      voices: blocks.length,
      hitsSynced: syncedHits,
      sfx: sfxCount,
      direction,
    },
    warnings: [...new Set(warnings)],
  };
}

export type { Track };
