/**
 * Gerar meu AMV — atribuição de cenas a trechos da música, com regras por estilo.
 * Determinístico para a mesma `seed`. Saída: Commands comuns (tudo editável depois),
 * cada clipe com `origin: 'ai'` e um `reason` legível.
 */
import { SFX_ANCHOR_S, SFX_DURATION_S, type SfxKind } from '@amv/sfx';
import { impactScore, languageFamily, normLabel, pickAudioStreamByLanguage, shotKey, type EpisodeVision, type ShotVision, type Cue, type EpisodeAnalysis, type MusicAnalysis, type Sequence, type Shot, type SpeechSegment } from '@amv/analysis';
import { defaultScale, matchSceneColor, matchSceneExposure, newId, speedCurveIntegral, speedCurveTotal, TextContentSchema, timelineLocalAtSource, type Clip, type Command, type EffectInstance, type Keyframe, type Project, type Track } from '@amv/project';
import { narrativeAt, narrativeRoleLabel, planNarrative, type NarrativeBeat } from './narrative.js';
import { buildMusicMap } from './music-map.js';
import { scoreSceneCandidate, type SceneScoreBreakdown } from './scoring.js';
import { chooseSceneTransition } from './transitions.js';
import { planSequence, type SequencePlanCandidate } from './sequence-planner.js';
import type { OrganizationMode } from './sequence-planner.js';
export type { OrganizationMode } from './sequence-planner.js';
import { editorialStyle, recommendStyle, styleDef, type EditorialDirection, type StyleDef, type StyleId } from './styles.js';
import type { CreativeEmphasis } from './creative-profiles.js';
import { matchLyricsSemantics } from './lyric-matcher.js';
import { lyricCueKey } from './lyric-cue-key.js';
import { layoutLyrics } from './lyrics-layout.js';
import { reliableBeatGrid } from './beat-confidence.js';
import { refineImpactEffects } from './impact-effects.js';
export { lyricCueKey } from './lyric-cue-key.js';

export interface EpisodeInput {
  assetId: string;
  name: string;
  analysis: EpisodeAnalysis;
  hasAudio: boolean;
  /** FPS médio/racional medido pelo probe; necessário para rampas automáticas sem inventar quadros. */
  sourceFps?: { num: number; den: number } | null;
  /** Rampas automáticas são evitadas em VFR, cuja cadência local não é garantida pelo FPS médio. */
  variableFrameRate?: boolean;
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

export type LyricTypographyStyle =
  | 'lyrics-cinematic'
  | 'anime-blend'
  | 'anime-impact'
  | 'anime-katana'
  | 'anime-neon'
  | 'anime-manga'
  | 'anime-gold-epic'
  | 'anime-dialogue';

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
  /** Traduções automáticas das falas selecionadas, indexadas por `${assetId}@${startS}`. */
  speechTranslations?: Record<string, string>;
  /** Idioma das traduções automáticas das falas (ex.: pt-BR, en, es). */
  speechTranslationLanguage?: string;
  useSpeech: boolean;
  useEffects: boolean;
  showText: boolean;
  /** Exibir legendas para as falas (desmarcar evita cobrir hardsubs do vídeo). Padrão: true. */
  showSpeechCaptions?: boolean;
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
  /** Aplica rampas de velocidade só quando a ação e a cadência da fonte são confiáveis. */
  adaptiveSpeed?: boolean;
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
  /** Modo de sonorização: 'hits-only' enfatiza apenas golpes/impactos sincronizados; 'full' inclui whoosh/subida; 'off' desliga. */
  sfxMode?: 'hits-only' | 'full' | 'off';
  /** Extrai também um micro-burst (0,24 s) do áudio real do golpe no anime nos impactos sincronizados. */
  animeHitAudio?: boolean;
  /**
   * Só cenas em que aparece algum destes personagens (exige a análise com visão). Se não houver
   * cenas suficientes, usa todas e avisa.
   */
  characters?: string[];
  /** Onde estão os efeitos (id do asset de cada um). Sem isso, não coloca efeito sonoro. */
  sfxAssets?: Partial<Record<SfxKind, string>>;
  /** Pesos de preferência para sinais visuais analisados; 50/50 preserva o comportamento anterior. */
  creativeEmphasis?: CreativeEmphasis;
  /** Estilo tipográfico opcional para letras da música na geração automática. */
  lyricStyle?: LyricTypographyStyle;
  /** Exibição das letras na tela: explosão cinética (1-2 palavras no centro) ou versos rítmicos. */
  lyricDisplayMode?: 'kinetic-words' | 'rhythmic-phrases';
  /** Como as falas interagem com o vídeo: 'voiceover' mantém os cortes de ação na batida em V1 enquanto a voz narra por cima; 'hybrid' mostra a cena da fala só antes do drop e narra nas demais; 'scene' mostra o vídeo original da fala em V1. */
  speechVisualMode?: 'voiceover' | 'hybrid' | 'scene';
  /** Coloca o personagem destacado em V2 no drop com a letra passando atrás dele (Depth Text). */
  depthCutoutOnDrop?: boolean;
  /** Modo Livre (Diretor Autônomo): unifica automaticamente ritmo, tipografia dinâmica por seção, falas, recortes V2, efeitos e sons. */
  autonomous?: boolean;
  /** Adapta tipografia e sonorização dinamicamente por seção musical (ligado automaticamente no Modo Livre). */
  dynamicTypography?: boolean;
}

export interface GenerateResult {
  commands: Command[];
  summary: { clips: number; cuts: number; speech: string | null; musicRange: [number, number]; drop: number | null; focus: 'fight' | 'mix'; fights: string[]; voices: number; hitsSynced: number; speedRamps: number; sfx: number; direction: NarrativeBeat[] };
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


type TimedLyricWord = NonNullable<Cue['words']>[number];

/** Explicit ASS/LRC/manual timings are trusted; Whisper requires high confidence and no uncertainty flag. */
function hasReliableWordTiming(word: TimedLyricWord): boolean {
  if (word.uncertain === true) return false;
  if (word.source === 'ass' || word.source === 'lrc' || word.source === 'manual') return true;
  return word.source === 'whisper'
    && typeof word.confidence === 'number'
    && Number.isFinite(word.confidence)
    && word.confidence >= 0.9;
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
    const db = (m.downbeats ?? []).filter((d) => d <= s0).at(-1);
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
  // Só usa cortes por palavra com timings confiáveis (ASS/LRC/manual ou Whisper ≥0,90).
  if (style.id === 'letra' && lyrics?.length) {
    const words: { t: number; endS: number; w: string; cueKey: string; timing: NonNullable<Cue['words']>[number] }[] = [];
    for (const c of lyrics) {
      if (!Number.isFinite(c.startS) || c.endS <= a || c.startS >= b) continue;
      for (const timing of c.words ?? []) {
        if (!hasReliableWordTiming(timing) || timing.endS <= a || timing.startS >= b || !timing.text.trim()) continue;
        words.push({ t: Math.max(a, timing.startS), endS: Math.min(b, timing.endS), w: timing.text, cueKey: lyricCueKey(c), timing });
      }
    }
    words.sort((left, right) => left.t - right.t);
    if (words.length >= 2) {
      const slots: Slot[] = [];
      let cursor = a;
      const appendBeatSlots = (fromS: number, toS: number) => {
        if (toS - fromS <= 0.05) return;
        // Mantém imagem durante pausas entre palavras; os cortes continuam seguindo a grade musical.
        for (const slot of makeSlots(m, [fromS, toS], style, intensity, undefined, beatOffsetS)) {
          slots.push({ ...slot, startS: slot.startS + (fromS - a), endS: slot.endS + (fromS - a) });
        }
      };
      words.forEach((w, i) => {
        if (w.t > cursor + 0.05) appendBeatSlots(cursor, w.t);
        const wordStart = Math.max(cursor, w.t);
        cursor = wordStart;
        // palavra fica no máximo ~1,5 s; planos sem palavra continuam em cortes normais.
        const end = Math.min(b, words[i + 1]?.t ?? w.endS, w.endS, wordStart + 1.5);
        if (end - wordStart < 0.12) return;
        slots.push({
          startS: wordStart - a,
          endS: end - a,
          energy: energyAt(m, wordStart),
          section: sectionAt(m, wordStart)?.label ?? '',
          isDrop: drop !== null && Math.abs(wordStart - drop) < 0.15,
          word: w.w,
          wordTiming: w.timing,
          lyricCueKey: w.cueKey,
        });
        cursor = end;
      });
      if (cursor < b - 0.05) appendBeatSlots(cursor, b);
      return slots.sort((left, right) => left.startS - right.startS);
    }
  }
  const beats = m.beats.map((t) => t + beatOffsetS).filter((t) => t >= a - 0.01 && t <= b + 0.01);
  const sectionEdges = m.sections.flatMap((section) => [section.startS, section.endS]).map((t) => t + beatOffsetS);
  const confidentRhythm = reliableBeatGrid(m);
  const subdivision = confidentRhythm ? Math.min(1, ...style.beatsPerCut) : 1;
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
  // downbeats para agrupamento por frase musical (tipicamente 4 compassos)
  const downbeatsInRange = m.downbeats.map((d) => d + beatOffsetS).filter((d) => d >= a && d <= b);
  const phraseLength = downbeatsInRange.length >= 8 ? 4 : downbeatsInRange.length >= 4 ? 2 : 0;
  const phraseStarts = new Set<number>();
  if (phraseLength > 0) {
    for (let i = 0; i < downbeatsInRange.length; i += phraseLength) phraseStarts.add(downbeatsInRange[i]!);
  }
  let i = 0;
  let slotNumber = 0;
  let cur = a;
  while (cur < b - 0.05) {
    const e = energyAt(m, cur);
    const lvl = e < 0.35 ? 0 : e < 0.7 ? 1 : 2;
    const rhythmVariation = m.events ? (style.rhythmPattern[slotNumber % style.rhythmPattern.length] ?? 1) : 1;
    let cadence = style.beatsPerCut[lvl]! * speedUp * rhythmVariation;
    if (!confidentRhythm) cadence = Math.max(2, cadence);
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
    const toDrop = drop === null ? Infinity : drop - cur;
    if (toDrop > 0 && toDrop <= 2.5) {
      cadence *= Math.max(0.55, 1 - style.preDropAcceleration * (1 - toDrop / 2.5));
    }
    const inEnding = !!m.events && (sectionAt(m, cur)?.label === 'final' || timelineS >= (b - a) * 0.9);
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
    // Início de frase musical é um ponto editorial de transição, mesmo quando não coincide com o corte previsto.
    const phraseBoundary = [...phraseStarts].find((timeS) => timeS > cur + 0.05 && timeS < next - 0.05);
    if (phraseBoundary !== undefined) next = phraseBoundary;
    if (next <= cur + 0.05) next = b;
    if (drop !== null && cur < drop && next > drop) next = drop;
    const sectionEdge = sectionEdges.find((edge) => edge > cur + 0.05 && edge < next - 0.05);
    if (sectionEdge !== undefined) next = sectionEdge;
    const startS = cur - a;
    const endS = Math.min(b, next) - a;
    const cue = lyrics?.filter((item) => Number.isFinite(item.startS) && item.endS > a + startS && item.startS < a + endS)
      .sort((left, right) => Math.min(right.endS, a + endS) - Math.max(right.startS, a + startS) - (Math.min(left.endS, a + endS) - Math.max(left.startS, a + startS)))[0];
    const impactAtCut = impacts.find((event) => Math.abs(event.timelineS - timelineS) <= 0.08 && event.confidence >= accentThreshold);
    const rhythmChangeAtCut = activeRhythmChange && Math.abs(activeRhythmChange.timelineS - timelineS) <= 0.08;
    const isPhraseStart = [...phraseStarts].some((timeS) => Math.abs(timeS - cur) <= 0.08);
    const musicCue = activePause ? 'pausa musical'
      : activeGrowth ? 'crescimento musical'
        : rhythmChangeAtCut ? `mudança de ritmo (${activeRhythmChange.direction ?? 'não classificada'})`
        : impactAtCut ? `acento espectral (${impactAtCut.band ?? 'banda não classificada'})`
          : isPhraseStart ? 'início de frase musical'
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
    if (i < 0) i = grid.length - 1;
    cur = next;
  }
  return slots.filter((s) => s.endS - s.startS > 0.05);
}

export interface Candidate extends SequencePlanCandidate {
  ep: EpisodeInput;
  shot: Shot;
  /** Sequência de origem (`${assetId}#${sequenceId}`), inclusive no modo misturar. */
  seq: string;
}

/**
 * Pontua a qualidade editorial de uma fala sem confundir volume/grito com significado.
 * É uma heurística linguística leve: não tenta inferir emoção nem traduzir o conteúdo.
 */
export function scoreSpeechCandidate(s: SpeechSegment): number {
  const duration = Math.max(0, s.endS - s.startS);
  const durationFit = Math.max(0, 1 - Math.abs(duration - 2.2) / 4.5);
  const confidence = Math.max(0, Math.min(1, Number.isFinite(s.confidence) ? s.confidence : 0));
  const impact = Math.max(0, Math.min(1, Number.isFinite(s.impact) ? s.impact : 0));
  const rawText = s.text?.trim() ?? '';
  const normalized = rawText.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[¿¡]/g, '').replace(/[^\p{L}\p{N}' ]/gu, ' ').replace(/\s+/g, ' ').trim();
  const words = normalized ? normalized.split(' ') : [];
  const filler = new Set(['ah', 'oh', 'ei', 'hey', 'vamos', 'sim', 'nao', 'yes', 'yeah', 'no', 'uh', 'ha', 'huh', 'argh', 'okay', 'ok']);
  let textQuality = words.length === 0 ? 0.12
    : words.length === 1 ? 0.05
      : words.length === 2 ? 0.22
        : words.length <= 9 ? 0.76
          : words.length <= 14 ? 0.56 : 0.36;
  if (words.length <= 2 && words.every((word) => filler.has(word))) textQuality = 0.02;
  if (words.length >= 3 && /[.!?…]\s*$/.test(rawText)) textQuality = Math.min(1, textQuality + 0.05);
  if (/\b(nao vou|nunca vou|eu juro|eu prometo|desist|proteger|salvar|vencer|fight|never|i will|i won't|no matter|impossible|protect|save)\b/.test(normalized)) {
    textQuality = Math.min(1, textQuality + 0.12);
  }
  return confidence * 0.2 + impact * 0.2 + durationFit * 0.2 + textQuality * 0.4 + (s.kind === 'grito' ? 0.02 : 0);
}

/** Escolhe uma fala marcante antes do drop, priorizando frase compreensível, legendada e completa. */
export function pickSpeech(
  eps: EpisodeInput[],
  maxS: number,
  exclude: Set<string>,
  accept?: (ep: EpisodeInput, s: SpeechSegment) => boolean,
  preferCaptioned = false,
): { ep: EpisodeInput; s: SpeechSegment } | null {
  let best: { ep: EpisodeInput; s: SpeechSegment; score: number } | null = null;
  for (const ep of eps) {
    if (!ep.hasAudio || exclude.has(ep.assetId)) continue;
    for (const s of ep.analysis.speech) {
      const d = s.endS - s.startS;
      if (d < 0.6 || d > maxS) continue;
      if (accept && !accept(ep, s)) continue;
      const captionBonus = preferCaptioned && (s.text?.trim().length ?? 0) >= 3 ? 0.32 : 0;
      const score = scoreSpeechCandidate(s) + captionBonus;
      if (!best || score > best.score || (score === best.score && s.startS < best.s.startS)) best = { ep, s, score };
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

/**
 * Combina a leitura temática local com combinações explícitas (visão/IA/editor). As explícitas
 * vencem por cena+verso, mas não apagam a leitura local das demais cenas — um mapa parcial ou
 * vazio vindo da interface não pode desligar o encaixe local da letra.
 */
export function mergeLyricMatches(
  local: GenerateOptions['lyricSceneMatches'],
  explicit: GenerateOptions['lyricSceneMatches'],
): GenerateOptions['lyricSceneMatches'] {
  if (!local) return explicit;
  if (!explicit) return local;
  const out: NonNullable<GenerateOptions['lyricSceneMatches']> = {};
  for (const [scene, cues] of Object.entries(local)) out[scene] = { ...cues };
  for (const [scene, cues] of Object.entries(explicit)) out[scene] = { ...(out[scene] ?? {}), ...cues };
  return out;
}

const parentShotStartS = new WeakMap<Shot, number>();
const visionOf = (ep: EpisodeInput, shot: Shot): ShotVision | undefined =>
  ep.vision?.shots[shotKey(shot.startS)]
  ?? (parentShotStartS.has(shot) ? ep.vision?.shots[shotKey(parentShotStartS.get(shot)!)] : undefined);

/**
 * Garante diferenciação visual clara entre letra da música e legenda de fala
 * quando ambas aparecem no mesmo AMV (posição, cor, fonte e estilo distintos).
 */
function resolveSpeechPreset(
  lyricStyle: LyricTypographyStyle | undefined,
  hasLyrics: boolean,
): LyricTypographyStyle | 'dialogue-dramatic' {
  if (hasLyrics) {
    const chosenLyric = lyricStyle ?? 'lyrics-cinematic';
    return chosenLyric === 'anime-dialogue' ? 'anime-impact' : 'anime-dialogue';
  }
  return lyricStyle && lyricStyle !== 'lyrics-cinematic' ? lyricStyle : 'dialogue-dramatic';
}

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
  const score = (e: PoolEntry) => {
    // Balancear intensidade com cobertura: evitar que lutas com poucas cenas muito fortes
    // dominem o pool, deixando pouco material para a timeline inteira.
    // A intensidade continua dominante, cobertura é tiebreaker.
    const coverageBonus = Math.min(0.08, (e.shotCount / Math.max(1, (o.neededShots ?? 10))) * 0.12);
    return 0.55 * e.seq.intensity + 0.25 * e.seq.peak + 0.12 * Math.min(1, e.usableS / (neededS * POOL_ROOM)) + coverageBonus + (o.jitter ? (o.jitter() - 0.5) * 0.16 : 0);
  };
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
  // Se as lutas não forem suficientes para cobrir o vídeo solicitado (ex.: 45s ou 60s),
  // complementa com as sequências mais dinâmicas restantes para evitar repetições desnecessárias.
  if (have < neededS * POOL_ROOM && fights.length > 0) {
    const remaining = all
      // No foco em luta, complementar só com outras lutas. Incluir sequências
      // calmas aqui contaminava o pool e quebrava a promessa de foco editorial.
      .filter((e) => e.seq.kind === 'luta'
        && !pool.some((p) => p.ep.assetId === e.ep.assetId && p.seq.id === e.seq.id))
      .map((e) => ({ e, sc: score(e) }))
      .sort((a, b) => b.sc - a.sc);
    for (const { e } of remaining) {
      if (have >= neededS * POOL_ROOM && count >= needCount) break;
      pool.push(e);
      have += e.usableS;
      count += e.shotCount;
    }
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

/**
 * A subtitle/transcription language only controls whether its text is displayed.
 * Em animes legendados (áudio original japonês + legenda embutida PT/EN), a legenda
 * traduzida DEVE aparecer normalmente; só rejeita quando o usuário pediu explicitamente
 * dublagem em português (`lang === 'pt'`) e o texto está em outro idioma.
 */
function speechCaptionMatchesAudio(ep: EpisodeInput, speech: SpeechSegment, lang: 'original' | 'pt'): boolean {
  if (!speech.text || !speech.language) return true;
  const textLanguage = languageFamily(speech.language);
  if (!textLanguage) return true;
  if (lang === 'pt' && textLanguage !== 'pt') return false;
  return true;
}

function findTracks(p: Project) {
  const visual = p.tracks.filter((t) => t.kind === 'video');
  const v1 = visual.at(-1);
  const v2 = visual.length >= 2 && visual[0]?.id !== v1?.id ? visual[0] : undefined;
  const text = p.tracks.find((t) => t.kind === 'text');
  const music = p.tracks.find((t) => t.kind === 'audio' && t.role === 'music') ?? p.tracks.find((t) => t.kind === 'audio');
  const voice = p.tracks.find((t) => t.kind === 'audio' && t.role === 'voice') ?? p.tracks.filter((t) => t.kind === 'audio')[1];
  const sfx = p.tracks.find((t) => t.kind === 'audio' && t.role === 'sfx');
  return { v1, v2, text, music, voice, sfx };
}

function generatedVoiceAndMusicAreAudible(project: Project, musicTrack: Track, voiceTrack: Track | undefined): boolean {
  const mixTracks = project.tracks.filter((track) =>
    track.kind === 'audio' || (track.kind === 'video' && project.audioMix.includeVideoAudio),
  );
  const anySolo = mixTracks.some((track) => track.solo);
  const musicAudible = !musicTrack.muted && (!anySolo || musicTrack.solo);
  const voiceAudible = !!voiceTrack && !voiceTrack.muted && (!anySolo || voiceTrack.solo);
  return musicAudible && voiceAudible;
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

function selectedVideoAudio(streamIndex: number | null, gainDb = 0): Clip['audio'] {
  return { gainDb, fadeInUs: 0, fadeOutUs: 0, pitchSemitones: 0, pitchMode: 'preserve', streamIndex };
}

function adaptiveSpeedCurve(durationUs: number, impactAtUs: number, minimumFactor: number): Keyframe[] {
  const impact = Math.max(0, Math.min(durationUs, impactAtUs));
  const slowStart = Math.max(0, impact - 100_000);
  const slowEnd = Math.min(durationUs, impact + 45_000);
  const recover = Math.min(durationUs, impact + 220_000);
  const points: Keyframe[] = [
    { atUs: 0, value: 1.08, easing: 'linear' },
    { atUs: slowStart, value: 1.08, easing: 'ease-in-out' },
    { atUs: impact, value: minimumFactor, easing: 'ease-in-out' },
    { atUs: slowEnd, value: minimumFactor, easing: 'hold' },
    { atUs: recover, value: 1.12, easing: 'ease-in-out' },
    { atUs: durationUs, value: 1.12, easing: 'linear' },
  ];
  return points
    .map((point) => ({ ...point, atUs: Math.max(0, Math.min(durationUs, point.atUs)) }))
    .filter((point, index, all) => index === 0 || point.atUs > all[index - 1]!.atUs);
}

function accelerationCurve(durationUs: number): Keyframe[] {
  return [
    { atUs: 0, value: 0.9, easing: 'ease-in-out' },
    { atUs: durationUs, value: 1.45, easing: 'linear' },
  ];
}

function impactZoomCurve(durationUs: number, impactAtUs: number, baseScale: number, strength: number): Keyframe[] {
  const impact = Math.max(0, Math.min(durationUs, impactAtUs));
  const peakAt = impact <= 0 ? Math.min(durationUs, 40_000) : impact;
  const points: { atUs: number; value: number; easing: Keyframe['easing'] }[] = [
    { atUs: 0, value: baseScale, easing: 'linear' },
    ...(peakAt > 80_000 ? [{ atUs: peakAt - 80_000, value: baseScale, easing: 'ease-in-out' as const }] : []),
    { atUs: peakAt, value: baseScale * (1 + strength), easing: 'ease-out' },
    { atUs: Math.min(durationUs, peakAt + 100_000), value: baseScale * (1 + strength * 0.45), easing: 'ease-in-out' },
    { atUs: Math.min(durationUs, peakAt + 260_000), value: baseScale, easing: 'linear' },
  ];
  return points
    .map((point) => ({ ...point, atUs: Math.max(0, Math.min(durationUs, point.atUs)) }))
    .filter((point, index, all) => index === 0 || point.atUs > all[index - 1]!.atUs);
}

function beatPunchCurve(durationUs: number, baseScale: number, strength: number): Keyframe[] {
  const decayUs = Math.min(Math.round(durationUs * 0.35), 110_000);
  const points: { atUs: number; value: number; easing: Keyframe['easing'] }[] = [
    { atUs: 0, value: baseScale * (1 + strength), easing: 'ease-out' },
    { atUs: decayUs, value: baseScale, easing: 'ease-in-out' },
    { atUs: durationUs, value: baseScale, easing: 'linear' },
  ];
  return points
    .map((point) => ({ ...point, atUs: Math.max(0, Math.min(durationUs, point.atUs)) }))
    .filter((point, index, all) => index === 0 || point.atUs > all[index - 1]!.atUs);
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

function buildProportionalWordTimings(
  text: string,
  durUs: number,
  source: NonNullable<Clip['text']>['wordTimings'][number]['source'],
) {
  const tokens = text.trim().match(/\S+/gu) ?? [];
  if (tokens.length < 2 || durUs <= 40_000) return [];
  const weights = tokens.map((tok) => Math.max(1, Array.from(tok).length + 1));
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  let cursorUs = 0;
  return tokens.map((token, idx) => {
    const shareUs = Math.round((weights[idx]! / totalWeight) * durUs);
    const startUs = cursorUs;
    const endUs = idx === tokens.length - 1 ? durUs : Math.min(durUs, Math.max(startUs + 20_000, startUs + shareUs));
    cursorUs = endUs;
    return {
      text: token,
      startUs,
      endUs,
      source,
      confidence: 0.9,
      uncertain: false,
    };
  });
}

function splitKineticChunks(text: string, durS: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1 || durS < 0.32) return words.length ? [words.join(' ')] : [];
  const canDoSingleWords = words.length <= 4 && durS / words.length >= 0.24;
  if (canDoSingleWords) {
    // Une apenas preposições/artigos muito curtos (<= 2 letras) para manter ritmo forte
    const merged: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const curr = words[i]!;
      if (curr.length <= 2 && i + 1 < words.length && words.length > 2) {
        merged.push(`${curr} ${words[i + 1]!}`);
        i++;
      } else {
        merged.push(curr);
      }
    }
    return merged;
  }
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w1 = words[i]!;
    const w2 = words[i + 1];
    if (w2 && w1.length + w2.length <= 12) {
      chunks.push(`${w1} ${w2}`);
      i++;
    } else {
      chunks.push(w1);
    }
  }
  return chunks;
}

interface SceneTypographyPalette {
  accent: string;
  highlight: string;
  brightness: number;
  focusY: number | null;
}

function parseHexRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHexRgb(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function extractScenePalette(local?: ShotVision['local']): SceneTypographyPalette | null {
  if (!local) return null;
  let bestRgb: [number, number, number] | null = null;
  let bestScore = -1;
  for (const hex of local.dominantColors ?? []) {
    const rgb = parseHexRgb(hex);
    if (!rgb) continue;
    const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number];
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const sat = mx - mn;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const score = sat * 1.8 + (luma >= 0.12 && luma <= 0.88 ? 0.35 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestRgb = rgb;
    }
  }
  if (!bestRgb) return null;
  const [r, g, b] = bestRgb;
  const avg = (r + g + b) / 3;
  // Amplifica croma e luminância para produzir um acento vibrante que conversa com a cena
  const boostR = Math.min(255, Math.max(60, avg + (r - avg) * 1.85 + 42));
  const boostG = Math.min(255, Math.max(60, avg + (g - avg) * 1.85 + 42));
  const boostB = Math.min(255, Math.max(60, avg + (b - avg) * 1.85 + 42));
  const accent = toHexRgb(boostR, boostG, boostB);
  const highlight = toHexRgb(
    boostR * 0.45 + 255 * 0.55,
    boostG * 0.45 + 250 * 0.55,
    boostB * 0.45 + 235 * 0.55,
  );
  const focusY = local.subjectFocus && (local.subjectFocusConfidence ?? 0) >= 0.5
    ? local.subjectFocus[1]
    : null;
  return {
    accent,
    highlight,
    brightness: Number.isFinite(local.brightness) ? local.brightness : 0.45,
    focusY,
  };
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
  preset: LyricTypographyStyle | 'dialogue-dramatic' = kind === 'word' ? 'lyrics-cinematic' : 'dialogue-dramatic',
  translation?: SubtitleTranslations | string | null,
  useEffects = true,
  kineticSpeechWords = false,
  scenePalette?: SceneTypographyPalette | null,
): Clip {
  const word = kind === 'word';
  const startUs = Math.round(startS * 1e6);
  const durUs = Math.max(40_000, Math.round(durS * 1e6));
  const endUs = startUs + durUs;
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
  const isLyrics = preset !== 'dialogue-dramatic' && preset !== 'anime-dialogue';
  const isClimaxImpact = highlight || impact >= 0.75 || preset === 'anime-impact' || preset === 'anime-blend' || preset === 'anime-katana' || preset === 'anime-gold-epic';
  const isDialogue = preset === 'dialogue-dramatic' || preset === 'anime-dialogue';
  const sizeMultiplier = 1 + (isClimaxImpact ? 0.35 : 0.25) * Math.max(0, Math.min(1, impact));
  const presetBaseSize: Record<LyricTypographyStyle | 'dialogue-dramatic', number> = {
    'lyrics-cinematic': 0.09,
    'dialogue-dramatic': impact < 0.45 ? 0.052 : 0.058,
    'anime-dialogue': 0.048,
    'anime-blend': 0.118,
    'anime-impact': 0.112,
    'anime-katana': 0.112,
    'anime-neon': 0.125,
    'anime-manga': 0.09,
    'anime-gold-epic': 0.11,
  };
  const baseSize = word ? (preset === 'anime-neon' ? 0.132 : 0.118) : presetBaseSize[preset];
  const glowIntensity = !useEffects ? 0
    : preset === 'anime-neon' ? 18
      : preset === 'anime-gold-epic' ? 14
        : preset === 'anime-katana' || preset === 'anime-impact' ? 12
          : preset === 'anime-blend' ? 10
            : isClimaxImpact ? Math.round(12 + 16 * Math.max(0, Math.min(1, impact))) : 0;
  const transObj: Record<string, string> | undefined = typeof translation === 'string'
    ? { pt: translation }
    : (translation as Record<string, string> | null | undefined) ?? undefined;
  const preferredTranslation = ['pt', 'pt-BR', 'en']
    .map((language) => [language, transObj?.[language]] as const)
    .find((entry) => !!entry[1]?.trim());
  const translationEntry = preferredTranslation ?? Object.entries(transObj ?? {}).find(([, value]) => !!value?.trim());
  const translationLanguage = translationEntry?.[0];
  const chosenTranslation = translationEntry?.[1];
  const displayText = chosenTranslation && chosenTranslation !== text ? chosenTranslation : text;
  const uppercase = word || ['anime-blend', 'anime-impact', 'anime-katana', 'anime-neon', 'anime-manga', 'anime-gold-epic'].includes(preset);
  let yRatio = word || preset === 'anime-blend' || preset === 'anime-impact' || preset === 'anime-gold-epic' ? 0
    : preset === 'anime-katana' ? 0.04
      : preset === 'anime-neon' ? 0.1
        : preset === 'anime-manga' ? 0.22
          : preset === 'anime-dialogue' ? 0.36
            : isLyrics ? 0.2 : 0.34;
  // Se o rosto do personagem estiver no terço superior-central, desce levemente a letra para não cobrir os olhos
  if (isLyrics && scenePalette?.focusY !== null && scenePalette?.focusY !== undefined && Math.abs(yRatio) < 0.08) {
    if (scenePalette.focusY < 0.44) yRatio = 0.13;
    else if (scenePalette.focusY > 0.62) yRatio = -0.09;
  }
  const sceneAccent = useEffects && isLyrics ? scenePalette?.accent : undefined;
  const sceneHighlight = useEffects && isLyrics ? scenePalette?.highlight : undefined;

  const color = preset === 'anime-blend' ? '#ffffff'
    : preset === 'anime-neon' ? '#e0fbff'
      : preset === 'anime-impact' || preset === 'anime-katana' ? '#fff6eb'
        : preset === 'anime-gold-epic' ? '#fff7d1'
          : preset === 'anime-dialogue' || preset === 'dialogue-dramatic' ? '#fef9c3'
            : highlight ? '#fff0a6' : '#ffffff';
  const outlineColor = preset === 'anime-neon' ? '#041019'
    : preset === 'anime-impact' || preset === 'anime-katana' ? '#12070b'
      : preset === 'anime-gold-epic' ? '#1a0e04'
        : '#05070c';
  const highlightColor = sceneAccent ?? (preset === 'anime-neon' ? '#ff4d9d'
    : preset === 'anime-impact' || preset === 'anime-katana' ? '#ff5364'
      : preset === 'anime-manga' ? '#ffe047'
        : highlight ? '#fff0a6' : '#ffd166');
  const gradientStartColor = sceneHighlight ?? (preset === 'anime-neon' ? '#e0ffff'
    : preset === 'anime-gold-epic' ? '#fff9d6'
      : highlight ? '#fff8cc' : '#ffe259');
  const gradientEndColor = sceneAccent ?? (preset === 'anime-neon' ? '#38bdf8'
    : preset === 'anime-gold-epic' ? '#f59e0b'
      : highlight ? '#ffd166' : '#ff6b6b');
  const glowColor = sceneAccent ?? (preset === 'anime-neon' ? '#00d4ff'
    : preset === 'anime-impact' || preset === 'anime-katana' ? '#ff4d6d'
      : preset === 'anime-gold-epic' ? '#f59e0b'
        : preset === 'anime-blend' ? '#ffffff'
          : highlight ? '#ffd166' : '#ff7a00');
  const fillStyle: 'solid' | 'linear-gradient' | 'hollow' = useEffects && preset === 'anime-blend'
    ? 'hollow'
    : (preset === 'anime-neon' || preset === 'anime-gold-epic' || (isClimaxImpact && !word && preset !== 'anime-manga' && !isDialogue))
      ? 'linear-gradient'
      : 'solid';
  const font = preset === 'anime-gold-epic'
    ? 'Cinzel Variable'
    : preset === 'anime-impact' || preset === 'anime-blend'
      ? 'Russo One'
      : preset === 'anime-katana'
        ? 'Permanent Marker'
        : preset === 'anime-neon'
          ? 'Teko'
          : preset === 'anime-manga'
            ? 'Black Ops One'
            : preset === 'dialogue-dramatic'
              ? 'Playfair Display Variable'
              : 'Montserrat Variable';
  const proFxOn = useEffects && !isDialogue;
  const outerOutlineColor = !proFxOn
    ? (preset === 'anime-dialogue' ? '#38bdf8' : null)
    : preset === 'anime-impact' || preset === 'anime-katana' ? (sceneAccent ?? '#ff3355')
      : preset === 'anime-neon' ? (sceneAccent ?? '#00f0ff')
        : preset === 'anime-manga' ? (sceneAccent ?? '#ffe047')
          : preset === 'anime-gold-epic' ? '#fde68a'
            : preset === 'anime-blend' ? (sceneAccent ?? '#ffffff')
              : null;
  const outerOutlineWidth = outerOutlineColor ? (preset === 'anime-dialogue' ? 0.8 : preset === 'anime-manga' ? 1.7 : 1.4) : 0;
  const extrudeDepth = !proFxOn || fillStyle === 'hollow' ? 0
    : preset === 'anime-manga' ? 5
      : preset === 'anime-impact' || preset === 'anime-katana' ? 4
        : preset === 'anime-gold-epic' ? 3
          : word ? 2.5 : 0;
  const extrudeColor = preset === 'anime-impact' || preset === 'anime-katana' ? '#1a050a' : preset === 'anime-gold-epic' ? '#241202' : '#000000';
  const chromaticAberration = !proFxOn ? 0
    : preset === 'anime-impact' || preset === 'anime-katana' ? (isClimaxImpact || word ? 3.5 : 2)
      : preset === 'anime-neon' ? 2.6
        : isClimaxImpact && word ? 2.2 : 0;
  const sheen = proFxOn && (preset === 'anime-blend' || preset === 'anime-neon' || preset === 'anime-gold-epic' || preset === 'lyrics-cinematic');
  const slashBanner = proFxOn && preset === 'anime-manga';
  const italic = isDialogue;
  const heroWord = proFxOn && (!word || text.trim().includes(' ')) && (
    preset === 'anime-blend' || preset === 'anime-impact' || preset === 'anime-katana' || preset === 'anime-neon' || preset === 'anime-gold-epic' || preset === 'lyrics-cinematic'
  );
  const heroFont = preset === 'anime-blend' || preset === 'anime-gold-epic' || preset === 'lyrics-cinematic'
    ? 'Playfair Display Variable'
    : preset === 'anime-impact'
      ? 'Permanent Marker'
      : preset === 'anime-katana'
        ? 'Russo One'
        : preset === 'anime-neon'
          ? 'Bungee'
          : null;
  const heroItalic = preset === 'anime-blend' || preset === 'anime-gold-epic' || preset === 'lyrics-cinematic';
  const heroColor = preset === 'anime-blend'
    ? '#ffffff'
    : sceneAccent ?? (preset === 'anime-impact' ? '#ff5c77' : preset === 'anime-katana' ? '#ffbe0b' : preset === 'anime-neon' ? '#ff4d9d' : preset === 'lyrics-cinematic' ? '#ffe066' : null);
  const heroTiltDeg = preset === 'anime-impact' || preset === 'anime-katana' ? -3 : 0;
  const blendMode: Clip['blendMode'] = !proFxOn
    ? 'normal'
    : preset === 'anime-blend'
      ? ((scenePalette?.brightness ?? 0.5) >= 0.34 || isClimaxImpact ? 'difference' : 'screen')
      : preset === 'anime-neon'
        ? 'screen'
        : (preset === 'anime-impact' && word && isClimaxImpact && (scenePalette?.brightness ?? 0) >= 0.62)
          ? 'difference'
          : 'normal';

  const renderedText = uppercase ? displayText.toUpperCase() : displayText;
  const effectiveWordTimings = kineticSpeechWords && !word && wordTimings.length === 0
    ? buildProportionalWordTimings(renderedText, durUs, 'estimated')
    : displayText === text
      ? wordTimings
      : (wordTimings.length > 0 || kineticSpeechWords) && !word
        ? buildProportionalWordTimings(renderedText, durUs, wordTimings[0]?.source ?? 'estimated')
        : [];

  const textScaleKeyframes: Keyframe[] | undefined = useEffects && (
    (word && durUs >= 140_000)
    || (isLyrics && isClimaxImpact && durUs >= 400_000)
    || (kineticSpeechWords && !isDialogue && durUs >= 220_000)
  )
    ? [
        { atUs: 0, value: word ? 1.28 : kineticSpeechWords ? 1.2 : 1.12, easing: 'ease-out' },
        { atUs: Math.min(durUs, word ? 120_000 : kineticSpeechWords ? 160_000 : 180_000), value: 1, easing: 'ease-in-out' },
        { atUs: durUs, value: 1, easing: 'linear' },
      ]
    : undefined;

  return baseClip(trackId, null, startS, durS, 0, reason, {
    blendMode,
    transform: { x: 0, y: Math.round(H * yRatio), scale: 1, rotation: preset === 'anime-katana' && proFxOn ? -2 : 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
    ...(textScaleKeyframes ? { keyframes: { 'transform.scale': textScaleKeyframes } } : {}),
    text: TextContentSchema.parse({
      text: renderedText,
      font,
      italic,
      size: Math.round(H * baseSize * sizeMultiplier),
      weight: preset === 'anime-neon' ? 700 : word || isClimaxImpact || preset === 'anime-manga' ? 900 : isLyrics ? 800 : 700,
      color,
      outlineColor,
      outlineWidth: preset === 'anime-blend' ? 2.5 : word || preset === 'anime-impact' || preset === 'anime-katana' || preset === 'anime-manga' || preset === 'anime-gold-epic' ? 5 : 4,
      outerOutlineColor,
      outerOutlineWidth,
      extrudeDepth,
      extrudeColor,
      chromaticAberration,
      sheen,
      slashBanner,
      heroWord,
      heroFont,
      heroItalic,
      heroScale: preset === 'anime-neon' ? 1.14 : 1.25,
      heroColor,
      heroTiltDeg,
      shadow: blendMode !== 'difference',
      animationIn: preset === 'anime-manga' || preset === 'anime-katana' ? 'slide-left' : isDialogue ? 'fade' : 'pop',
      animationOut: preset === 'anime-gold-epic' ? 'blur' : 'fade',
      background: 'none',
      backgroundOpacity: 0.78,
      alignment: 'center',
      maxWidthRatio: 0.86,
      marginX: Math.round(H * 0.06),
      marginY: Math.round(H * 0.04),
      padding: Math.round(H * 0.025),
      highlightColor,
      highlightScale: isClimaxImpact ? 1.25 : 1.18,
      wordAnimation: kineticSpeechWords ? (isDialogue ? 'highlight' : 'pop') : 'highlight',
      fillStyle,
      gradientStartColor,
      gradientEndColor,
      glowColor,
      glowIntensity,
      section: isClimaxImpact ? 'climax' : word || preset === 'anime-neon' ? 'chorus' : 'verse',
      letterSpacing: word || preset === 'anime-neon' || preset === 'anime-manga' || preset === 'anime-blend' ? 2 : preset === 'anime-gold-epic' ? 3 : 0,
      timingPrecision: effectiveWordTimings.length ? 'word' : 'segment',
      wordTimings: effectiveWordTimings,
      ...(transObj
        ? {
            textSource: chosenTranslation && chosenTranslation !== text ? ('translation' as const) : ('original' as const),
            original: text,
            lang: translationLanguage ?? 'pt',
            translations: transObj ?? {},
          }
        : {}),
    }),
  });
}

export interface SubtitleTranslations {
  [language: string]: string | undefined;
  pt?: string;
  en?: string;
}

export function findSubtitleTranslations(ep: EpisodeInput, startS: number, endS: number): SubtitleTranslations | null {
  const translations: SubtitleTranslations = {};
  for (const c of ep.analysis.subtitles ?? []) {
    if (c.startS < endS && c.endS > startS && c.text.trim()) {
      const lang = c.language?.toLowerCase();
      if ((lang === 'pt' || lang === 'por' || lang === 'pt-br') && !translations.pt) {
        translations.pt = c.text.trim();
      } else if ((lang === 'en' || lang === 'eng') && !translations.en) {
        translations.en = c.text.trim();
      }
    }
  }
  return Object.keys(translations).length > 0 ? translations : null;
}

function speechTranslation(ep: EpisodeInput, speech: SpeechSegment, opts: GenerateOptions): SubtitleTranslations | null {
  const translated = opts.speechTranslations?.[`${ep.assetId}@${speech.startS}`]?.trim();
  if (translated) return { [opts.speechTranslationLanguage ?? 'pt']: translated };
  if (opts.speechTranslationLanguage) return null;
  return findSubtitleTranslations(ep, speech.startS, speech.endS);
}

function speechCaptionText(ep: EpisodeInput, speech: SpeechSegment, lang: 'original' | 'pt', opts: GenerateOptions): string | null {
  if (!speechCaptionMatchesAudio(ep, speech, lang)) return null;
  if (speechTranslation(ep, speech, opts)) return speech.text?.trim() || null;
  return speech.text;
}

function addCaptionPhrases(
  commands: Command[],
  trackId: string,
  startS: number,
  durationS: number,
  text: string,
  height: number,
  reason: string,
  impact = 0,
  translations?: SubtitleTranslations | string | null,
  preset: LyricTypographyStyle | 'dialogue-dramatic' = 'dialogue-dramatic',
  useEffects = true,
  kineticSpeechWords = false,
): void {
  if (!text.trim() || durationS <= 0) return;
  commands.push({
    type: 'clip.add',
    clip: textClip(trackId, startS, durationS, text, height, 'line', reason, false, impact, undefined, preset, translations, useEffects, kineticSpeechWords),
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
    if (asset) {
      const base = defaultScale(project, asset);
      const userScale = c.clip.transform.scale || 1;
      c.clip.transform = { ...c.clip.transform, scale: base * userScale };
      if (c.clip.keyframes['transform.scale']?.length) {
        c.clip.keyframes['transform.scale'] = c.clip.keyframes['transform.scale'].map((frame) => ({
          ...frame,
          value: frame.value * base,
        }));
      }
    }
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
/** Referência aproximada de voz em dB RMS (percentil 90), não LUFS. */
const VOICE_REF_DB = -18;
/** Correção conservadora para diferenças entre episódios; limita boost/cut para reduzir risco de clipping. */
export function voiceGainDb(baseDb: number, loudnessDb: number | undefined): number {
  if (loudnessDb === undefined || !Number.isFinite(loudnessDb)) return baseDb;
  const correction = Math.max(-4, Math.min(4, (VOICE_REF_DB - loudnessDb) * 0.65));
  return Math.round((baseDb + correction) * 10) / 10;
}
const VOICE_GAP_S = 1.5;

/** Agrupa intervalos de voz próximos para manter a música abaixada em pausas curtas sem efeito gangorra. */
function buildDuckingKeyframes(
  intervals: { startS: number; endS: number; preDrop?: boolean }[],
  mergeGapS: number,
  rampDownS: number,
  rampUpAfterS: number,
): Keyframe[] {
  const ordered = [...intervals].sort((a, b) => a.startS - b.startS);
  const groups: { startS: number; endS: number; preDrop: boolean }[] = [];
  for (const curr of ordered) {
    const prev = groups.at(-1);
    if (prev && !prev.preDrop && !curr.preDrop && curr.startS - prev.endS <= mergeGapS) {
      prev.endS = Math.max(prev.endS, curr.endS);
    } else {
      groups.push({ startS: curr.startS, endS: curr.endS, preDrop: !!curr.preDrop });
    }
  }
  const kf: Keyframe[] = [];
  for (const g of groups) {
    const startUs = us(g.startS);
    const downUs = us(Math.max(0, g.startS - rampDownS));
    const prevEndUs = kf.at(-1)?.atUs ?? -1;
    if (g.startS > 0 && downUs > prevEndUs) {
      kf.push({ atUs: downUs, value: 0, easing: 'linear' });
    }
    if (startUs > (kf.at(-1)?.atUs ?? -1)) {
      kf.push({ atUs: startUs, value: DUCK_DB, easing: 'linear' });
    }
    if (g.preDrop) {
      kf.push(
        { atUs: us(g.endS - 0.06), value: DUCK_DB, easing: 'linear' },
        { atUs: us(g.endS), value: 0, easing: 'linear' },
      );
    } else {
      kf.push(
        { atUs: us(g.endS), value: DUCK_DB, easing: 'linear' },
        { atUs: us(g.endS + rampUpAfterS), value: 0, easing: 'linear' },
      );
    }
  }
  return kf;
}

export function resolveAutonomousOptions(
  music: MusicInput,
  episodes: EpisodeInput[],
  base: GenerateOptions,
): GenerateOptions {
  const m = music.analysis;
  const excludedSet = new Set(base.exclude ?? []);
  const activeEps = episodes.filter((ep) => !excludedSet.has(ep.assetId));
  const hasFights = activeEps.some((ep) => (ep.analysis.sequences ?? []).some((seq) => seq.kind === 'luta'));
  const avgEnergy = m.energy.length ? m.energy.reduce((a, b) => a + b, 0) / m.energy.length : 0.5;
  // Avalia o estilo rítmico/narrativo real sem deixar a presença de letra sequestrar os cortes na batida
  const rec = recommendStyle(activeEps.map((ep) => ({ analysis: ep.analysis, visual: ep.vision })), m, false);
  let style: StyleId = rec.style;
  if (style === 'discurso' && (hasFights || avgEnergy >= 0.45)) {
    style = avgEnergy >= 0.64 ? 'hype' : 'superacao';
  }
  const intensity: 0 | 1 | 2 | 3 = m.bpm >= 138 || avgEnergy >= 0.72
    ? 3
    : m.bpm <= 95 && avgEnergy <= 0.35
      ? 1
      : 2;
  const editorialDirection: EditorialDirection = style === 'emocional' || style === 'discurso'
    ? 'cinematic'
    : hasFights || avgEnergy >= 0.56 || m.drops.length > 0
      ? 'hype'
      : 'balanced';
  const focus: 'fight' | 'mix' = base.sequenceIds?.length
    ? 'fight'
    : hasFights && style !== 'discurso'
      ? 'fight'
      : 'mix';
  const strongSpeeches = activeEps
    .filter((ep) => ep.hasAudio)
    .flatMap((ep) => ep.analysis.speech)
    .filter((sp) => {
      const len = sp.endS - sp.startS;
      return len >= 0.65 && len <= 4.2 && scoreSpeechCandidate(sp) >= 0.36;
    });
  const autoVoiceCount = strongSpeeches.length === 0
    ? 0
    : base.durationS >= 42 && strongSpeeches.length >= 3
      ? 3
      : base.durationS >= 22 && strongSpeeches.length >= 2
        ? 2
        : 1;
  return {
    ...base,
    style,
    intensity,
    editorialDirection,
    organizationMode: 'narrative',
    focus,
    useSpeech: autoVoiceCount > 0,
    voiceMoments: autoVoiceCount,
    speechVisualMode: 'hybrid',
    useEffects: true,
    showText: base.showText !== false,
    showSpeechCaptions: base.showSpeechCaptions !== false,
    hitSync: true,
    adaptiveSpeed: true,
    depthCutoutOnDrop: true,
    animeHitAudio: true,
    useSfx: base.useSfx !== false,
    sfxMode: base.sfxMode === 'off' ? 'off' : 'hits-only',
    lyricStyle: 'anime-blend',
    dynamicTypography: true,
  };
}

function generateInner(project: Project, music: MusicInput, episodes: EpisodeInput[], rawOpts: GenerateOptions): GenerateResult {
  const opts = rawOpts.autonomous ? resolveAutonomousOptions(music, episodes, rawOpts) : rawOpts;
  const organizationMode = opts.organizationMode ?? 'narrative';
  const editorialDirection = opts.editorialDirection ?? 'balanced';
  const style = editorialStyle(styleDef(opts.style), editorialDirection);
  const warnings: string[] = [];
  const rand = rng(opts.seed);
  const { v1, v2, text, music: musicTrack, voice, sfx: sfxTrack } = findTracks(project);
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
  if (m.tempoVariable) {
    warnings.push('Andamento variável detectado na música; os cortes seguem as batidas reais em vez de um BPM fixo.');
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
  /** Quando há filtro de personagem, a fala só entra se a cena correspondente tiver um dos personagens pedidos. */
  const speechMatchesWanted = (ep: EpisodeInput, sp: SpeechSegment) => {
    if (!plan.wanted) return true;
    const mid = (sp.startS + sp.endS) / 2;
    const shot = ep.analysis.shots.find((sh) => mid >= sh.startS - 0.1 && mid <= sh.endS + 0.1)
      ?? ep.analysis.shots.find((sh) => sh.startS < sp.endS && sh.endS > sp.startS);
    return !!shot && hasCharacter(ep, shot, plan.wanted);
  };
  const strictFightSelection = Boolean(opts.sequenceIds?.length);

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
  if (!reliableBeatGrid(m)) warnings.push('Ritmo com baixa confiança: subdivisões rápidas foram evitadas. Revise as batidas e o ajuste de tempo antes de exportar.');
  if (dropT === null) warnings.push('A música não tem um drop claro nesse trecho: a montagem segue a energia da música.');
  if (opts.style === 'letra' && !opts.lyrics?.length) warnings.push('Sem a letra com tempo (LRC), o estilo "letra" corta na batida mas não escreve as palavras. Importe a letra em Legendas.');
  const lang = opts.voiceLang ?? 'original';
  const streamFor = (ep: EpisodeInput) => pickAudioStream(ep, lang);
  const measuredVoiceLevel = (ep: EpisodeInput, speech: SpeechSegment) =>
    ep.analysis.speechAudioStreamIndex === streamFor(ep) ? speech.loudnessDb : undefined;
  if (lang === 'pt' && episodes.some((ep) => !exclude.has(ep.assetId) && !hasRequestedSpeechAudio(ep, lang))) {
    warnings.push('Há episódio sem faixa em português identificada. As falas desses episódios foram omitidas; nenhuma faixa diferente foi usada como substituta.');
  }

  const cmds: Command[] = [];
  // limpa as trilhas que a geração preenche (e recortes de IA anteriores em V2, preservando camadas manuais do usuário)
  const filled = new Set([v1.id, musicTrack.id, voice?.id, text?.id, sfxTrack?.id].filter(Boolean) as string[]);
  for (const c of project.clips) {
    if (filled.has(c.trackId) || (v2 && c.trackId === v2.id && c.origin === 'ai')) {
      cmds.push({ type: 'clip.remove', clipId: c.id });
    }
  }

  // ---------------------------------------------------------------- música
  const fadeOut = Math.min(2, D * 0.08);
  const musicClip = baseClip(musicTrack.id, music.assetId, 0, D, range[0], `Trecho ${fmt(range[0])}–${fmt(range[1])} de ${music.name}${dropT !== null ? `: drop em ${fmt(dropT)} do vídeo` : ''}`, {
    audio: { gainDb: 0, fadeInUs: range[0] > 0.5 ? us(0.3) : 0, fadeOutUs: us(fadeOut), pitchSemitones: 0, pitchMode: 'preserve', streamIndex: null },
  });

  // ---------------------------------------------------------------- falas (antes do drop e intercaladas / narração sobre cortes)
  const blocks: VoiceBlock[] = [];
  const speechVisualMode = opts.speechVisualMode ?? 'scene';
  const showSpeechVideo = (b: VoiceBlock) => speechVisualMode === 'voiceover' ? false : speechVisualMode === 'hybrid' ? b.preDrop : true;
  const wantVoice = opts.useSpeech && voice && opts.style !== 'discurso';
  const totalVoice = wantVoice ? Math.max(0, Math.min(6, Math.round(opts.voiceMoments ?? (style.speechBeforeDrop ? 1 : 0)))) : 0;
  const preferCaptionedSpeech = Boolean(opts.showText && opts.showSpeechCaptions !== false);
  if (wantVoice && totalVoice > 0 && style.speechBeforeDrop && dropT !== null) {
    const acceptSpeech = (ep: EpisodeInput, speech: SpeechSegment) =>
      hasRequestedSpeechAudio(ep, lang) && speechMatchesWanted(ep, speech);
    let pick = pickSpeech(episodes, Math.min(4, dropT - 0.2), exclude, (ep, speech) => nearPool(ep, speech) && acceptSpeech(ep, speech), preferCaptionedSpeech);
    if (!pick && fight && !strictFightSelection && !plan.wanted) {
      pick = pickSpeech(episodes, Math.min(4, dropT - 0.2), exclude, (ep, speech) =>
        poolEps.has(ep.assetId) && acceptSpeech(ep, speech), preferCaptionedSpeech);
    }
    if (pick) {
      const len = pick.s.endS - pick.s.startS;
      blocks.push({ ep: pick.ep, s: pick.s, atS: dropT - len, len, from: dropT - len, to: dropT, preDrop: true });
    } else warnings.push('Nenhuma fala marcante encontrada nos episódios (legendas embutidas ajudam muito).');
  }
  const extraWanted = totalVoice - blocks.length;
  if (wantVoice && extraWanted > 0) {
    const taken = new Set(blocks.map((b) => `${b.ep.assetId}@${b.s.startS}`));
    const speechRank = (s: SpeechSegment) => scoreSpeechCandidate(s) + (preferCaptionedSpeech && (s.text?.trim().length ?? 0) >= 3 ? 0.32 : 0);
    const lines = episodes
      .filter((e) => e.hasAudio && !exclude.has(e.assetId) && hasRequestedSpeechAudio(e, lang))
      .flatMap((ep) => ep.analysis.speech
        .filter((sp) => speechMatchesWanted(ep, sp) && (nearPool(ep, sp) || (fight && !strictFightSelection && !plan.wanted && poolEps.has(ep.assetId))))
        .map((sp) => ({ ep, sp })))
      .filter(({ sp }) => sp.endS - sp.startS >= 0.8 && sp.endS - sp.startS <= 4)
      .filter(({ ep, sp }) => !taken.has(`${ep.assetId}@${sp.startS}`))
      .sort((a, b) => speechRank(b.sp) - speechRank(a.sp) || a.sp.startS - b.sp.startS);
    // onde cabe: começa num compasso, prefere janelas com menos vocal cantado / respiro rítmico e afastado das outras falas e do drop
    const quiet = (a: number, b: number) => {
      let sum = 0;
      let n = 0;
      for (let t = a; t < b; t += m.energyStepS) {
        sum += energyAt(m, range[0] + t);
        n++;
      }
      return n ? sum / n : 1;
    };
    const vocalDensity = (a: number, b: number) => {
      if (!opts.lyrics?.length || b <= a) return 0;
      const absA = range[0] + a;
      const absB = range[0] + b;
      let covered = 0;
      for (const cue of opts.lyrics) {
        if (!Number.isFinite(cue.startS) || !Number.isFinite(cue.endS)) continue;
        const ov = Math.min(absB, cue.endS) - Math.max(absA, cue.startS);
        if (ov > 0) covered += ov;
      }
      return Math.min(1, covered / (b - a));
    };
    const free = (a: number, b: number) => blocks.every((x) => b <= x.from - VOICE_GAP_S || a >= x.to + VOICE_GAP_S) && (dropT === null || b <= dropT - 0.5 || a >= dropT + 1.2);
    const allowPostDropSpeech = speechVisualMode !== 'scene';
    const limit = allowPostDropSpeech ? Math.max(1.5, D - 0.6) : (blocks[0] ? blocks[0].atS : D);
    const downs = m.downbeats.map((d) => d + beatOffsetS - range[0]).filter((t) => t >= 1.5 && t <= D - (allowPostDropSpeech ? 1.2 : 3));
    const fallbackGrid = downs.length >= 2
      ? downs
      : Array.from({ length: Math.max(1, Math.floor((D - (allowPostDropSpeech ? 2.5 : 4.5)) / 2)) }, (_, idx) => 1.5 + idx * 2);
    let placed = 0;
    for (const { ep, sp } of lines) {
      if (placed >= extraWanted) break;
      const len = sp.endS - sp.startS;
      const ideal = (limit * (placed + 1)) / (extraWanted + 1);
      const slotLimit = allowPostDropSpeech ? limit : limit - VOICE_GAP_S;
      const validSlots = fallbackGrid.filter((t) => t + len <= slotLimit && free(t, t + len));
      if (!validSlots.length) continue;
      const calmFits = validSlots.filter((t) => quiet(t, t + len) < 0.6 && vocalDensity(t, t + len) <= 0.45).sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal));
      // Em voiceover/hybrid encaixa inclusive na ação pós-drop, priorizando janelas de menor colisão vocal com o cantor.
      const slotCost = (t: number) => vocalDensity(t, t + len) * 1.25 + (Math.abs(t - ideal) / Math.max(1, D)) * 1.1;
      const pickedAt = allowPostDropSpeech
        ? [...validSlots].sort((a, b) => slotCost(a) - slotCost(b))[0]
        : (calmFits[0] ?? [...validSlots].sort((a, b) => quiet(a, a + len) + vocalDensity(a, a + len) * 0.6 - (quiet(b, b + len) + vocalDensity(b, b + len) * 0.6) || Math.abs(a - ideal) - Math.abs(b - ideal))[0]);
      if (pickedAt === undefined) continue;
      blocks.push({ ep, s: sp, atS: pickedAt, len, from: pickedAt, to: pickedAt + len, preDrop: false });
      placed++;
    }
    // sem nenhuma fala disponível o aviso de "nenhuma fala marcante" já cobre; só avisa se havia falas e não coube
    if (placed < extraWanted && lines.length > 0) warnings.push(`Só coube ${placed + blocks.filter((b) => b.preDrop).length} de ${totalVoice} falas: faltou trecho livre na música ou fala marcante na luta escolhida.`);
  }
  blocks.sort((a, b) => a.atS - b.atS);
  // a música abaixa durante cada fala e só volta quando há respiro real (evita gangorra em pausas curtas)
  if (blocks.length && generatedVoiceAndMusicAreAudible(project, musicTrack, voice)) {
    musicClip.keyframes['audio.gainDb'] = buildDuckingKeyframes(
      blocks.map((b) => ({ startS: b.atS, endS: b.preDrop ? dropT! : b.atS + b.len, preDrop: b.preDrop })),
      2.2,
      0.35,
      0.4,
    );
    musicClip.audio.duckingMode = 'manual';
  }
  // ---------------------------------------------------------------- estilo discurso: as falas são a espinha
  const used = new Set<string>();
  let clipsMade = 0;
  if (opts.style === 'discurso' && voice) {
    const allLines = episodes
      .filter((e) => e.hasAudio && !exclude.has(e.assetId) && hasRequestedSpeechAudio(e, lang))
      .flatMap((ep) => ep.analysis.speech.map((s) => ({ ep, s })))
      .filter((x) => x.s.endS - x.s.startS >= 0.8 && x.s.endS - x.s.startS <= 6 && (!plan.wanted || speechMatchesWanted(x.ep, x.s)));
    const focusPool = chooseSequences(episodes, D, { sequenceIds: opts.sequenceIds, exclude, wanted: plan.wanted });
    const inFocus = (ep: EpisodeInput, s: SpeechSegment) => focusPool.some((e) => e.ep.assetId === ep.assetId && s.startS >= e.seq.startS - 15 && s.endS <= e.seq.endS + 5);
    const primaryLines = focusPool.length ? allLines.filter(({ ep, s }) => inFocus(ep, s)) : allLines;
    const secondaryLines = focusPool.length ? allLines.filter(({ ep, s }) => !inFocus(ep, s)) : [];
    const byScore = (a: { ep: EpisodeInput; s: SpeechSegment }, b: { ep: EpisodeInput; s: SpeechSegment }) =>
      scoreSpeechCandidate(b.s) - scoreSpeechCandidate(a.s) || a.s.startS - b.s.startS;
    const orderedPool = [...primaryLines.sort(byScore), ...secondaryLines.sort(byScore)];
    let t = 0;
    const chosen: typeof orderedPool = [];
    for (const l of orderedPool) {
      if (t >= D - 0.8) break;
      const len = l.s.endS - l.s.startS;
      if (t + len > D) continue;
      chosen.push(l);
      t += len + 0.35;
    }
    // Ordena cronologicamente para o discurso preservar começo, meio e fim.
    chosen.sort((a, b) => (episodeOrders.get(a.ep.assetId) ?? 0) - (episodeOrders.get(b.ep.assetId) ?? 0) || a.s.startS - b.s.startS);
    if (!chosen.length) warnings.push('O estilo discurso precisa de falas: importe episódios com legenda ou com falas claras.');
    t = 0;
    const speechIntervals: { startS: number; endS: number }[] = [];
    for (const { ep, s } of chosen) {
      const len = s.endS - s.startS;
      const startS = t;
      speechIntervals.push({ startS, endS: startS + len });
      const sourceText = speechCaptionText(ep, s, lang, opts);
      const reason = `Fala ${sourceText ? `"${sourceText.replace(/\n/g, ' ')}" ` : ''}de ${ep.name} ${fmt(s.startS)} (impacto ${s.impact.toFixed(2)})`;
      cmds.push({
        type: 'clip.add',
        clip: baseClip(v1.id, ep.assetId, t, len + 0.35, s.startS, reason, {
          effects: opts.useEffects ? [...gradeFx(style.grade)] : [],
          audio: selectedVideoAudio(streamFor(ep), -60),
        }),
      });
      cmds.push({ type: 'clip.add', clip: baseClip(voice.id, ep.assetId, t, len, s.startS, reason, { audio: { gainDb: voiceGainDb(2, measuredVoiceLevel(ep, s)), fadeInUs: us(0.05), fadeOutUs: us(0.1), pitchSemitones: 0, pitchMode: 'preserve', streamIndex: streamFor(ep), voiceIsolation: opts.useEffects !== false, echoTail: false } }) });
      const subtitleTranslations = speechTranslation(ep, s, opts);
      const speechPreset = resolveSpeechPreset(opts.lyricStyle, Boolean(opts.lyrics?.length));
      if (opts.showText && opts.showSpeechCaptions !== false && text && sourceText) addCaptionPhrases(cmds, text.id, t, len, sourceText, H, 'Legenda da fala', Math.max(s.impact, impactScore(sourceText)), subtitleTranslations, speechPreset, opts.useEffects);
      used.add(`${ep.assetId}@${s.startS}`);
      clipsMade++;
      t += len + 0.35;
    }
    if (speechIntervals.length && generatedVoiceAndMusicAreAudible(project, musicTrack, voice)) {
      musicClip.keyframes['audio.gainDb'] = buildDuckingKeyframes(speechIntervals, 2.5, 0.1, 0.25);
      musicClip.audio.duckingMode = 'manual';
    }
    cmds.push({ type: 'clip.add', clip: musicClip });
    return { commands: cmds, summary: { clips: clipsMade, cuts: clipsMade, speech: chosen[0] && speechCaptionMatchesAudio(chosen[0].ep, chosen[0].s, lang) ? chosen[0].s.text : null, musicRange: range, drop: dropT, focus: 'mix', fights: [], voices: chosen.length, hitsSynced: 0, speedRamps: 0, sfx: 0, direction }, warnings };
  }
  cmds.push({ type: 'clip.add', clip: musicClip });

  // ---------------------------------------------------------------- cortes na batida
  const REPEAT_WARNING = 'Poucas cenas em sequência para o tamanho do vídeo: algumas se repetem. Importe mais episódios ou escolha mais lutas.';
  const slots = makeSlots(m, range, style, opts.intensity, opts.lyrics, beatOffsetS);
  const candidates: Candidate[] = [];
  const opEdReserve: Candidate[] = [];
  const darkReserve: Candidate[] = [];
  const consider = (ep: EpisodeInput, shot: Shot) => {
    const id = `${ep.assetId}@${shot.startS}`;
    const shotDur = shot.endS - shot.startS;
    if (exclude.has(id) || sceneExclusions.has(`${ep.assetId}@${shotKey(shot.startS)}`) || shotDur < 0.25) return;
    if (plan.wanted && !hasCharacter(ep, shot, plan.wanted)) return;
    const sequence = sequenceFor(ep, shot);
    const seq = sequence ? `${ep.assetId}#${sequence.id}` : `${ep.assetId}#-`;
    const localFeatures = visionOf(ep, shot)?.local;
    const isDeadFrame = (localFeatures?.deadFrameScore ?? 0) >= 0.8;
    const isClutteredCredit = !strictFightSelection && (localFeatures?.textClutterScore ?? 0) >= 0.72;
    // Em episódios completos (>= 18 min), desprioriza janelas típicas de abertura/encerramento (créditos)
    // exceto quando o usuário selecionou manualmente uma luta específica ali.
    const isLikelyOpEd = !strictFightSelection
      && ep.analysis.durationS >= 1080
      && (shot.startS < 92 || shot.endS > ep.analysis.durationS - 92);
    const targetList = shot.tags.includes('escura') || isDeadFrame
      ? darkReserve
      : isLikelyOpEd || isClutteredCredit
        ? opEdReserve
        : candidates;
    const sequenceOrder = sequenceOrders.get(seq) ?? 0;
    const episodeOrder = episodeOrders.get(ep.assetId) ?? Number.MAX_SAFE_INTEGER;
    // Subdivide planos longos em trechos não sobrepostos nos estilos de corte dinâmico
    // (mantém planos longos inteiros em estilos lentos como Emocional).
    const sliceCount = style.minCutS < 1.0 && shotDur >= 4.4 ? Math.min(4, Math.floor(shotDur / 2.2)) : 1;
    if (sliceCount <= 1) {
      targetList.push({
        ep,
        shot,
        id,
        assetId: ep.assetId,
        sourceStartS: shot.startS,
        sourceEndS: shot.endS,
        seq,
        sequenceOrder,
        episodeOrder,
      });
      return;
    }
    const sliceLen = shotDur / sliceCount;
    for (let i = 0; i < sliceCount; i++) {
      const sStart = Math.round((shot.startS + i * sliceLen) * 1000) / 1000;
      const sEnd = i === sliceCount - 1 ? shot.endS : Math.round((shot.startS + (i + 1) * sliceLen) * 1000) / 1000;
      const subShot: Shot = i === 0 ? { ...shot, startS: shot.startS, endS: sEnd } : { ...shot, startS: sStart, endS: sEnd };
      if (i > 0) parentShotStartS.set(subShot, shot.startS);
      targetList.push({
        ep,
        shot: subShot,
        id: i === 0 ? id : `${ep.assetId}@${sStart}`,
        assetId: ep.assetId,
        sourceStartS: subShot.startS,
        sourceEndS: subShot.endS,
        seq,
        sequenceOrder,
        episodeOrder,
      });
    }
  };
  if (fight) {
    for (const e of plan.pool) for (const sh of e.ep.analysis.shots) if (sh.startS >= e.seq.startS - 1e-3 && sh.endS <= e.seq.endS + 1e-3) consider(e.ep, sh);
  } else {
    for (const ep of episodes) {
      if (exclude.has(ep.assetId)) continue;
      for (const shot of ep.analysis.shots) consider(ep, shot);
    }
  }
  if (!candidates.length && fight && !strictFightSelection && !plan.wanted) {
    // Fallback automático apenas quando o usuário não travou luta específica nem personagem
    for (const ep of episodes) {
      if (exclude.has(ep.assetId)) continue;
      for (const shot of ep.analysis.shots) consider(ep, shot);
    }
    if (candidates.length) {
      warnings.push('A luta selecionada tinha poucas cenas aproveitáveis: usei cenas dinâmicas do restante do episódio para preencher o vídeo.');
    }
  }
  if (!candidates.length && opEdReserve.length) {
    candidates.push(...opEdReserve);
  }
  if (!candidates.length && darkReserve.length) {
    candidates.push(...darkReserve);
    warnings.push('Só havia cenas muito escuras disponíveis; usei-as como último recurso. Importe mais episódios para aumentar a variedade.');
  }
  if (!candidates.length) {
    warnings.push(plan.wanted
      ? `Nenhuma cena analisada corresponde aos personagens selecionados (${[...plan.wanted].join(', ')}); não misturei outros personagens.`
      : 'Nenhuma cena analisada ainda: espere a análise dos episódios terminar.');
    return { commands: cmds, summary: { clips: 0, cuts: 0, speech: null, musicRange: range, drop: dropT, focus: plan.mode, fights: [], voices: 0, hitsSynced: 0, speedRamps: 0, sfx: 0, direction }, warnings };
  }
  const { lowI, highI } = plan.fit;
  const boost = 0; // já embutido em plan.fit

  // a imagem de cada fala só substitui V1 quando `showSpeechVideo(b)` estiver ativo (em voiceover, V1 segue nos cortes musicais)
  const visualBlocks = blocks.filter(showSpeechVideo);
  for (const b of visualBlocks) {
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
    for (const b of visualBlocks) {
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
  // Quantiza todas as fronteiras à grade de frames. A mesma fronteira compartilhada
  // recebe sempre o mesmo arredondamento, evitando lacunas e sobreposições acumuladas.
  {
    const frameS = project.settings.fps.den / project.settings.fps.num;
    if (Number.isFinite(frameS) && frameS > 0) {
      for (const slot of fitSlots) {
        const start = Math.round(slot.startS / frameS) * frameS;
        const end = Math.round(slot.endS / frameS) * frameS;
        if (end - start >= frameS - 1e-9) {
          slot.startS = start;
          slot.endS = end;
        }
      }
    }
  }

  const effectiveLyricMatches = mergeLyricMatches(
    opts.lyrics && opts.lyrics.length > 0 ? matchLyricsSemantics(opts.lyrics, candidates, (c) => visionOf(c.ep, c.shot)) : undefined,
    opts.lyricSceneMatches,
  );

  const RECENT_WINDOW = 6;

  const scoreCandidate = (
    sl: Slot,
    c: Candidate,
    previous: Candidate | null,
    previousSlot: Slot | null,
    history: readonly Candidate[] = [],
  ) => {
    const len = sl.endS - sl.startS;
    const shotLen = c.shot.endS - c.shot.startS;
    // O retiming mínimo é 0,6x: abaixo disso o source range ultrapassa o plano e invade a cena seguinte.
    if (shotLen + 1e-6 < len * 0.6) return null;
    const narrativeBeat = narrativeAt(direction, (sl.startS + sl.endS) / 2);
    const target = Math.min(1, Math.max(0, lowI + (highI - lowI) * sl.energy + boost + (sl.isDrop ? 0.15 : 0)));
    const previousVision = previous ? visionOf(previous.ep, previous.shot) : undefined;
    const currentVision = visionOf(c.ep, c.shot);
    const transitionCue = sl.isDrop
      ? 'entrada do drop'
      : sl.musicCue === 'início de frase musical'
        ? 'início de frase musical'
        : previousSlot && previousSlot.section !== sl.section
          ? 'mudança de seção musical'
          : previousSlot && Math.abs(previousSlot.energy - sl.energy) >= 0.3
            ? 'contraste de energia musical'
            : null;
    const lyricMatch = sl.lyricCueKey ? effectiveLyricMatches?.[c.id]?.[sl.lyricCueKey] : undefined;
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
      recentSceneIds: history.slice(-RECENT_WINDOW).reverse().map((item) => item.ep.assetId + '@' + item.shot.startS),
      recentFramings: history.slice(-RECENT_WINDOW).reverse().flatMap((item) => {
        const framing = visionOf(item.ep, item.shot)?.framing;
        return framing ? [framing] : [];
      }),
      recentCharacters: history.slice(-5, -1).flatMap((item) => {
        const recentVision = visionOf(item.ep, item.shot);
        const confidence = recentVision?.confidence;
        return recentVision && typeof confidence === 'number'
          && Number.isFinite(confidence) && confidence >= 0.55 && confidence <= 1
          ? [recentVision.characters]
          : [];
      }),
      slotDurationS: len,
      recentIntensities: history.slice(-4).map((item) => effectiveShotIntensity(item.ep, item.shot)),
      recentLocals: history.slice(-RECENT_WINDOW, -1).flatMap((item) => {
        const recentLocal = visionOf(item.ep, item.shot)?.local;
        return recentLocal ? [recentLocal] : [];
      }),
    });
    const dropSequenceBonus = sl.isDrop && opts.focus === 'mix' && previous?.ep.assetId === c.ep.assetId && c.sequenceOrder > previous.sequenceOrder
      ? MIX_SEQUENCE_DROP_BONUS
      : 0;
    return { breakdown, score: breakdown.total + dropSequenceBonus };
  };

  const sequencePlan = planSequence(fitSlots, candidates, {
    // No foco em lutas, percorre as sequências escolhidas em ordem de origem.
    // O modo narrativo podia começar pela luta mais forte e, ao esgotá-la,
    // considerar a luta anterior inacessível, repetindo cenas da primeira.
    mode: fight ? 'chronological' : organizationMode,
    seed: opts.seed,
    score: (slot, candidate, previous, previousSlot, history) => scoreCandidate(slot, candidate, previous, previousSlot, history)?.score ?? Number.NEGATIVE_INFINITY,
    candidateWindow: fight
      ? (_slotIndex, musicSlot, forward) => {
          // No foco em lutas, percorre começo (Ato I), escalada/clímax (Ato II) e desfecho (Ato III)
          // em ordem cronológica estrita sem ficar preso apenas nos primeiros 30% da luta.
          const ordered = [...forward].sort((a, b) =>
            a.episodeOrder - b.episodeOrder || a.sourceStartS - b.sourceStartS,
          );
          const slotDuration = musicSlot.endS - musicSlot.startS;
          const fits = ordered.filter((candidate) =>
            candidate.sourceEndS - candidate.sourceStartS + 1e-6 >= slotDuration * 0.6,
          );
          if (!fits.length) return [];
          const remainingSlots = Math.max(1, fitSlots.length - _slotIndex);
          const stride = Math.max(1, Math.floor(fits.length / remainingSlots));
          const windowSize = Math.min(fits.length, Math.max(5, Math.min(12, stride * 2 + 3)));
          let windowFits: Candidate[];
          if (fits.length > remainingSlots * 1.35 && fitSlots.length >= 6) {
            const nearSlice = fits.slice(0, Math.ceil(windowSize * 0.5));
            const pacedStart = Math.min(
              Math.max(0, fits.length - Math.ceil(windowSize * 0.5)),
              Math.max(1, stride - 1),
            );
            const pacedSlice = fits.slice(pacedStart, pacedStart + Math.ceil(windowSize * 0.5));
            const endSlice = _slotIndex >= Math.floor(fitSlots.length * 0.85) ? fits.slice(-3) : [];
            windowFits = [...new Map([...nearSlice, ...pacedSlice, ...endSlice].map((c) => [c.id, c])).values()];
          } else {
            windowFits = fits.slice(0, windowSize);
          }
          const highEnergy = musicSlot.isDrop || musicSlot.energy >= 0.7;
          if (highEnergy) {
            // Respeita rótulos explícitos de "não é luta". Análises antigas não
            // registram confidence; nesse formato, o booleano explícito continua
            // sendo o sinal disponível (mesma regra usada pelo score de cenas).
            const actionFits = windowFits.filter((candidate) => {
              const visual = visionOf(candidate.ep, candidate.shot);
              const usableFightLabel = visual && (
                visual.confidence === undefined
                || (typeof visual.confidence === 'number'
                  && Number.isFinite(visual.confidence)
                  && visual.confidence >= 0.55
                  && visual.confidence <= 1)
              );
              return !(usableFightLabel && visual.fight === false);
            });
            return actionFits.length ? actionFits : windowFits;
          }
          return windowFits;
        }
      : organizationMode === 'narrative' && fitSlots.length > 3
      ? (slotIndex, musicSlot, forward, progress) => {
          const byAsset = new Map<string, Candidate[]>();
          for (const candidate of forward) {
            const list = byAsset.get(candidate.assetId) ?? [];
            list.push(candidate);
            byAsset.set(candidate.assetId, list);
          }

          const window: Candidate[] = [];
          const sectionChanged = slotIndex > 0 && fitSlots[slotIndex - 1]!.section !== musicSlot.section;
          const atEditorialBoundary = musicSlot.isDrop || musicSlot.musicCue === 'início de frase musical' || sectionChanged;
          const highEnergy = musicSlot.isDrop || musicSlot.energy >= 0.8;

          const trustedVisualOf = (candidate: Candidate) => {
            const visual = visionOf(candidate.ep, candidate.shot);
            return visual && typeof visual.confidence === 'number'
              && Number.isFinite(visual.confidence) && visual.confidence >= 0.55 && visual.confidence <= 1
              ? visual
              : undefined;
          };
          const isActionScene = (candidate: Candidate) => {
            const visual = trustedVisualOf(candidate);
            if (candidate.shot.tags.includes('calma') || candidate.shot.tags.includes('fala')) return false;
            if (visual?.fight === false) return false;
            return candidate.shot.tags.includes('ação')
              || candidate.shot.tags.includes('impacto')
              || visual?.action === 'combate'
              || visual?.action === 'perseguição'
              || visual?.fight === true;
          };
          const isQuietOrSetupScene = (candidate: Candidate) => {
            const visual = trustedVisualOf(candidate);
            return candidate.shot.tags.includes('calma')
              || candidate.shot.tags.includes('fala')
              || visual?.fight === false
              || visual?.action === 'preparação'
              || visual?.action === 'reação'
              || visual?.action === 'diálogo'
              || visual?.action === 'ambiente'
              || visual?.sceneType === 'tension'
              || visual?.sceneType === 'dialogue'
              || visual?.sceneType === 'reaction';
          };

          const appendChoices = (preferred: Candidate[], fallback: Candidate[], limit: number) => {
            const chosen = preferred.slice(0, limit);
            const ids = new Set(chosen.map((candidate) => candidate.id));
            for (const candidate of fallback) {
              if (chosen.length >= limit) break;
              if (!ids.has(candidate.id)) {
                chosen.push(candidate);
                ids.add(candidate.id);
              }
            }
            window.push(...chosen);
          };

          for (const [assetId, list] of byAsset) {
            const ordered = list.sort((a, b) => a.sequenceOrder - b.sequenceOrder || a.sourceStartS - b.sourceStartS);
            const progressForAsset = progress.get(assetId);
            const currentOrder = progressForAsset?.sequenceOrder ?? ordered[0]!.sequenceOrder;
            const currentSequence = ordered.filter((candidate) => candidate.sequenceOrder === currentOrder);
            const anchor = progressForAsset?.sourceEndS ?? currentSequence[0]?.sourceStartS ?? ordered[0]!.sourceStartS;
            const lookAheadS = musicSlot.isDrop ? 24 : highEnergy ? 16 : 12;
            const nearby = currentSequence.filter((candidate) =>
              candidate.sourceStartS >= anchor - 0.05 && candidate.sourceStartS <= anchor + lookAheadS,
            );

            // O planejador agora compara várias opções próximas: não força a primeira cena cronológica.
            const preferred = highEnergy ? nearby.filter(isActionScene) : nearby.filter(isQuietOrSetupScene);
            appendChoices(preferred, nearby, musicSlot.isDrop ? 7 : highEnergy ? 5 : 4);

            // Mudanças musicais explícitas podem abrir a sequência seguinte, mas sem saltar por ela inteira.
            if (atEditorialBoundary) {
              const nextOrder = ordered.find((candidate) => candidate.sequenceOrder > currentOrder)?.sequenceOrder;
              if (nextOrder !== undefined) {
                const nextSequence = ordered.filter((candidate) => candidate.sequenceOrder === nextOrder);
                const nextPreferred = highEnergy ? nextSequence.filter(isActionScene) : nextSequence.filter(isQuietOrSetupScene);
                appendChoices(nextPreferred, nextSequence, musicSlot.isDrop ? 2 : 1);
              }
            }
          }

          if (musicSlot.lyricCueKey) {
            const lyricAlternatives = forward
              .map((candidate) => ({
                candidate,
                score: effectiveLyricMatches?.[candidate.id]?.[musicSlot.lyricCueKey!]?.score ?? 0,
              }))
              .filter((item) => item.score >= 0.6)
              .sort((a, b) => b.score - a.score || a.candidate.sourceStartS - b.candidate.sourceStartS)
              .slice(0, 2);
            window.push(...lyricAlternatives.map((item) => item.candidate));
          }

          return [...new Map(window.map((candidate) => [candidate.id, candidate])).values()].slice(0, 16);
        }
      : undefined,
  });
  if (sequencePlan.repeatedSlots.length && !warnings.includes(REPEAT_WARNING)) warnings.push(REPEAT_WARNING);
  let syncedHits = 0;
  let hitSlots = 0;
  let speedRamps = 0;
  let lastImpactFxS = Number.NEGATIVE_INFINITY;
  let lastDecorativeTransitionS = Number.NEGATIVE_INFINITY;
  let prev: Candidate | null = null;
  let prevSlot: Slot | null = null;
  /** Para os efeitos sonoros e tipografia reativa: onde cada corte/golpe/paleta aconteceu na timeline. */
  const cutsLog: {
    startS: number;
    len: number;
    energy: number;
    intensity: number;
    isDrop: boolean;
    hitAtS: number | null;
    peakSrcS: number | null;
    assetId: string;
    hasAudio: boolean;
    streamIndex: number | null;
    palette: SceneTypographyPalette | null;
    hasSubject: boolean;
    transitionKind: string | null;
    lyricCueKey?: string;
    lyricMatchScore?: number;
    lyricMatchReason?: string;
  }[] = [];

  const selectedHistory: Candidate[] = [];
  const usedIntervals = new Map<string, Array<[number, number]>>();
  const usedFingerprints = new Set<string>();
  const lastUsedSlot = new Map<string, number>();
  const overlapsUsedInterval = (assetId: string, startS: number, endS: number): boolean => {
    const list = usedIntervals.get(assetId);
    if (!list) return false;
    return list.some(([a, b]) => startS < b - 0.15 && endS > a + 0.15);
  };
  let rescuedSlots = 0;
  let darkRescuedSlots = 0;
  let unfilledSlots = 0;
  const rescueSlot = (slot: Slot, currentSlotIndex: number): { candidate: Candidate; scored: NonNullable<ReturnType<typeof scoreCandidate>> } | null => {
    const isForwardForFight = (candidate: Candidate) => !fight || !prev
      || candidate.episodeOrder > prev.episodeOrder
      || (candidate.episodeOrder === prev.episodeOrder && candidate.sourceStartS >= prev.sourceEndS - 0.05);
    const isFresh = (candidate: Candidate) =>
      !used.has(candidate.id) && !overlapsUsedInterval(candidate.assetId, candidate.sourceStartS, candidate.sourceEndS);
    const isVisuallyUnique = (candidate: Candidate) => {
      const fp = visionOf(candidate.ep, candidate.shot)?.local?.fingerprint;
      return !fp || !usedFingerprints.has(fp);
    };
    const isEdgeSlot = currentSlotIndex === 0 || currentSlotIndex === fitSlots.length - 1;
    // Primeiro tenta material inédito E visualmente único (sem fingerprint clonado).
    // Só repete depois que não há mais nenhuma cena inédita capaz de caber no slot.
    const tiers: ((candidate: Candidate) => boolean)[] = [
      (candidate) => isFresh(candidate) && isVisuallyUnique(candidate) && candidate.id !== prev?.id && isForwardForFight(candidate),
      (candidate) => isFresh(candidate) && isVisuallyUnique(candidate) && candidate.id !== prev?.id,
      (candidate) => isFresh(candidate) && candidate.id !== prev?.id && isForwardForFight(candidate),
      (candidate) => isFresh(candidate) && candidate.id !== prev?.id,
      (candidate) => candidate.id !== prev?.id,
      () => true,
    ];
    for (const accepts of tiers) {
      let best: { candidate: Candidate; scored: NonNullable<ReturnType<typeof scoreCandidate>>; rank: number } | null = null;
      for (const candidate of candidates) {
        if (!accepts(candidate)) continue;
        // Não há bypass do limite 0,6×: uma reserva nunca pode invadir o plano seguinte.
        const scored = scoreCandidate(slot, candidate, prev, prevSlot, selectedHistory);
        if (!scored) continue;
        const lastIdx = lastUsedSlot.get(candidate.id);
        const recencyPenalty = lastIdx === undefined ? 0 : Math.max(0, 12 - (currentSlotIndex - lastIdx)) * 0.15;
        const darkEdgePenalty = isEdgeSlot && candidate.shot.brightness < 0.22 ? 0.8 : 0;
        const rank = scored.score - recencyPenalty - darkEdgePenalty;
        if (!best || rank > best.rank) best = { candidate, scored, rank };
      }
      if (best) return { candidate: best.candidate, scored: best.scored };
    }
    // Cenas quase pretas só entram como último recurso quando nenhum plano normal
    // consegue preencher este slot sem ultrapassar sua fonte.
    let darkBest: { candidate: Candidate; scored: NonNullable<ReturnType<typeof scoreCandidate>> } | null = null;
    for (const candidate of darkReserve) {
      const scored = scoreCandidate(slot, candidate, prev, prevSlot, selectedHistory);
      if (!scored) continue;
      if (!darkBest || scored.score > darkBest.scored.score) darkBest = { candidate, scored };
    }
    if (darkBest) {
      darkRescuedSlots++;
      return darkBest;
    }
    return null;
  };
  for (const [slotIndex, sl] of fitSlots.entries()) {
    const len = sl.endS - sl.startS;
    let c = sequencePlan.choices[slotIndex];
    let scored = c ? scoreCandidate(sl, c, prev, prevSlot, selectedHistory) : null;
    if (!c || !scored) {
      const rescue = rescueSlot(sl, slotIndex);
      if (!rescue) {
        unfilledSlots++;
        continue;
      }
      c = rescue.candidate;
      scored = {
        ...rescue.scored,
        breakdown: {
          ...rescue.scored.breakdown,
          reasons: [...rescue.scored.breakdown.reasons, 'cena de reserva escolhida sem ultrapassar a fonte'],
        },
      };
      rescuedSlots++;
    }
    const narrativeBeat = narrativeAt(direction, (sl.startS + sl.endS) / 2);
    const target = Math.min(1, Math.max(0, lowI + (highI - lowI) * sl.energy + boost + (sl.isDrop ? 0.15 : 0)));
    const best = {
      c,
      score: scored.score,
      breakdown: scored.breakdown,
      srcIn: (() => {
        // Seleção inteligente de srcIn: escolher a parte mais interessante da cena
        const margin = Math.max(0, c.shot.endS - c.shot.startS - len);
        if (margin < 0.08) return c.shot.startS; // cena quase do mesmo tamanho: começa no início
        const pickFreeWindow = (preferred: number): number => {
          const clamped = Math.max(c.shot.startS, Math.min(c.shot.endS - len, preferred));
          if (!overlapsUsedInterval(c.assetId, clamped, clamped + len)) return clamped;
          const step = Math.max(0.25, margin / 6);
          for (let candidateIn = c.shot.startS; candidateIn <= c.shot.endS - len + 1e-6; candidateIn += step) {
            if (!overlapsUsedInterval(c.assetId, candidateIn, candidateIn + len)) return candidateIn;
          }
          return clamped;
        };
        const jitter = margin * 0.15 * (rand() - 0.5); // variação por seed
        const visual = visionOf(c.ep, c.shot);
        const local = visual?.local;
        // Se tem motion events, centralizar no evento de maior velocidade/confiança
        const motionEvent = local?.motionEvents
          ?.filter((ev) => ev.startS >= c.shot.startS && ev.endS <= c.shot.endS && ev.confidence >= 0.55)
          .sort((a, b) => b.speed * b.confidence - a.speed * a.confidence)[0];
        if (motionEvent) {
          const eventCenter = (motionEvent.startS + motionEvent.endS) / 2;
          return pickFreeWindow(eventCenter - len * 0.4 + jitter);
        }
        // Se tem peakS confiável, enquadrar o pico no primeiro terço
        if (Number.isFinite(c.shot.peakS) && c.shot.peakS >= c.shot.startS && c.shot.peakS <= c.shot.endS) {
          return pickFreeWindow(c.shot.peakS - len * 0.3 + jitter);
        }
        // Fallback: pequeno offset variável sem ser totalmente aleatório
        return pickFreeWindow(c.shot.startS + Math.min(0.12, margin) + margin * 0.25 * rand());
      })(),
    };
    const lyricMatch = sl.lyricCueKey ? effectiveLyricMatches?.[c.id]?.[sl.lyricCueKey] : undefined;
    const sceneIntensity = effectiveShotIntensity(c.ep, c.shot);
    const shotLen = c.shot.endS - c.shot.startS;
    const speed = shotLen >= len ? 1 : Math.max(0.6, shotLen / len);
    const srcLen = len * speed;

    // golpe na batida: o instante de maior movimento da cena cai no corte (na batida) ou numa batida interna do plano
    let srcIn = best.srcIn;
    let hit = false;
    let internalBeatHit = false;
    const wantsHit = opts.hitSync !== false && (sl.isDrop || sl.energy >= 0.5 || c.shot.tags.includes('impacto')) && c.shot.motion >= 0.3 && Number.isFinite(c.shot.peakS);
    if (wantsHit) {
      hitSlots++;
      const want = c.shot.peakS;
      const lo = Math.max(c.shot.startS, Math.min(want, c.shot.startS + Math.min(0.08, Math.max(0, shotLen - srcLen))));
      const hi = c.shot.endS - srcLen;
      if (hi >= lo) {
        const at = Math.min(hi, Math.max(lo, want));
        const actualLead = (c.shot.peakS - at) / speed;
        const toleranceS = project.settings.fps.den / project.settings.fps.num;
        if (Math.abs(actualLead) <= toleranceS && Math.abs(at - want) / speed <= toleranceS) {
          srcIn = at;
          hit = true;
          syncedHits++;
        }
      }
    }
    let motionCropReason: string | null = null;
    if (!hit && shotLen > srcLen) {
      const local = visionOf(c.ep, c.shot)?.local;
      const motionEvent = local?.motionEvents
        .filter((event) =>
          event.startS >= c.shot.startS
          && event.endS <= c.shot.endS
          && event.confidence >= 0.6
          && event.subjectMotion.confidence >= 0.6
          && event.subjectMotion.speed >= 0.025,
        )
        .sort((left, right) =>
          right.subjectMotion.speed * right.subjectMotion.confidence
          - left.subjectMotion.speed * left.subjectMotion.confidence,
        )[0];
      if (motionEvent) {
        const eventCenterS = (motionEvent.startS + motionEvent.endS) / 2;
        const sourceLoS = c.shot.startS + Math.min(0.08, Math.max(0, shotLen - srcLen));
        const sourceHiS = c.shot.endS - srcLen;
        const preferredStartS = eventCenterS - srcLen * 0.45;
        const motionStartS = Math.max(sourceLoS, Math.min(sourceHiS, preferredStartS));
        if (eventCenterS >= motionStartS && eventCenterS <= motionStartS + srcLen) {
          srcIn = motionStartS;
          motionCropReason = 'recorte guiado por movimento localizado com confiança';
        }
      } else if (wantsHit) {
        const lo = c.shot.startS;
        const hi = c.shot.endS - srcLen;
        const toleranceS = project.settings.fps.den / project.settings.fps.num;
        const internalBeat = m.beats
          .map((b) => b + beatOffsetS - range[0])
          .find((b) => b >= sl.startS + 0.14 && b <= sl.endS - 0.08 && c.shot.peakS - (b - sl.startS) * speed >= lo - toleranceS && c.shot.peakS - (b - sl.startS) * speed <= hi + toleranceS);
        if (internalBeat !== undefined && hi >= lo) {
          const wantInternal = Math.min(hi, Math.max(lo, c.shot.peakS - (internalBeat - sl.startS) * speed));
          if (Math.abs((c.shot.peakS - wantInternal) / speed - (internalBeat - sl.startS)) <= toleranceS) {
            srcIn = wantInternal;
            internalBeatHit = true;
            syncedHits++;
          }
        }
      }
    }
    let speedKeyframes: Keyframe[] = [];
    let adaptiveSpeedReason: string | null = null;
    let visualScaleKeyframes: Keyframe[] = [];
    let visualImpactReason: string | null = null;
    const visual = visionOf(c.ep, c.shot);
    const sourceFps = c.ep.sourceFps && c.ep.sourceFps.den > 0 ? c.ep.sourceFps.num / c.ep.sourceFps.den : 0;
    const projectFps = project.settings.fps.num / project.settings.fps.den;
    const fpsRatio = sourceFps / projectFps;
    const canRetimingBeSmooth = opts.adaptiveSpeed !== false
      && !c.ep.variableFrameRate
      && Number.isFinite(fpsRatio)
      && fpsRatio >= 1.5
      && speed === 1
      && shotLen >= len
      && len >= 0.35;
    const reliablePreparation = narrativeBeat?.role === 'build'
      && visual?.action === 'preparação'
      && (visual.confidence ?? 0) >= 0.75;
    if (canRetimingBeSmooth && reliablePreparation && fpsRatio >= 2) {
      speedKeyframes = accelerationCurve(us(len));
      adaptiveSpeedReason = 'aceleração progressiva numa preparação identificada';
    } else if (canRetimingBeSmooth) {
      const reliableImpact = (visual?.action === 'combate' && (visual.confidence ?? 0) >= 0.7)
        || (c.shot.tags.includes('impacto') && c.shot.motion >= 0.65);
      if (reliableImpact && Number.isFinite(c.shot.peakS) && c.shot.peakS >= c.shot.startS && c.shot.peakS < c.shot.endS) {
        const impactAtS = hit
          ? 0
          : Math.min(len * 0.45, Math.max(0.08, len * 0.35));
        const minimumFactor = Math.max(0.65, Math.min(0.9, 1.2 / fpsRatio));
        speedKeyframes = adaptiveSpeedCurve(us(len), us(impactAtS), minimumFactor);
        const candidateClip = baseClip(v1.id, c.ep.assetId, sl.startS, len, srcIn, '', {
          keyframes: { speed: speedKeyframes },
        });
        candidateClip.sourceOutUs = candidateClip.sourceInUs + candidateClip.durationUs;
        const sourceLoUs = us(c.shot.startS + Math.min(0.08, Math.max(0, shotLen - len)));
        const sourceHiUs = us(c.shot.endS) - candidateClip.durationUs;
        const desiredSourceInUs = us(c.shot.peakS) - Math.round(candidateClip.durationUs * speedCurveIntegral(candidateClip, us(impactAtS)) / speedCurveTotal(candidateClip));
        const alignedSourceInUs = Math.max(sourceLoUs, Math.min(sourceHiUs, desiredSourceInUs));
        candidateClip.sourceInUs = alignedSourceInUs;
        candidateClip.sourceOutUs = alignedSourceInUs + candidateClip.durationUs;
        const alignedImpactUs = timelineLocalAtSource(candidateClip, us(c.shot.peakS));
        const alignmentToleranceUs = Math.round(S / projectFps);
        if (alignedImpactUs !== null && Math.abs(alignedImpactUs - us(impactAtS)) <= alignmentToleranceUs) {
          srcIn = alignedSourceInUs / S;
          speedKeyframes = candidateClip.keyframes.speed ?? [];
          adaptiveSpeedReason = 'câmera lenta breve no impacto com o golpe preservado no corte musical';
        } else {
          speedKeyframes = [];
        }
      }
    }

    const priorGrade = project.clips.find((old) =>
      old.trackId === v1.id && old.origin === 'ai' && sl.startS * S >= old.timelineStartUs && sl.startS * S < old.timelineStartUs + old.durationUs,
    )?.effects.filter((effect) => effect.effect === 'color' || effect.effect === 'vignette') ?? [];
    const effects: EffectInstance[] = !opts.useEffects ? [] : priorGrade.length
      ? priorGrade.map((effect) => ({ ...structuredClone(effect), id: newId('fx') }))
      : [...gradeFx(style.grade)];
    const exposureMatch = prev ? matchSceneExposure(prev.shot.brightness, c.shot.brightness) : 0;
    const previousLocal = prev ? visionOf(prev.ep, prev.shot)?.local : undefined;
    const currentLocal = visionOf(c.ep, c.shot)?.local;
    const colorMatch = previousLocal?.samples && previousLocal.samples >= 2 && currentLocal?.samples && currentLocal.samples >= 2
      ? matchSceneColor(previousLocal.colorHistogram, currentLocal.colorHistogram)
      : { temperature: 0, tint: 0 };
    if (opts.useEffects && (exposureMatch || colorMatch.temperature || colorMatch.tint)) {
      effects.push(fx('color', {
        brightness: 0, contrast: 1, saturation: 1, exposure: exposureMatch,
        temperature: colorMatch.temperature, tint: colorMatch.tint, hue: 0, shadows: 0, midtones: 0, highlights: 0, vignette: 0,
      }));
    }
    if (opts.useEffects && c.shot.brightness < 0.25 && Number.isFinite(c.shot.brightness)) {
      effects.push(fx('color', {
        brightness: 0, contrast: 1.03, saturation: 1,
        exposure: Math.round(Math.min(0.45, (0.25 - c.shot.brightness) * 2.2) * 100) / 100,
        temperature: 0, tint: 0, hue: 0, shadows: 0.16, midtones: 0.04, highlights: 0, vignette: 0,
      }));
    }
    if (opts.useEffects && !priorGrade.length && !effects.some((effect) => effect.effect === 'color' || effect.effect === 'vignette')) {
      if (sl.isDrop || sl.energy >= 0.75) {
        effects.push(fx('color', { brightness: 0, contrast: 1.06, saturation: 1.1 }));
      } else if (sl.energy <= 0.3 && (style.id === 'emocional' || style.id === 'discurso')) {
        effects.push(fx('vignette', { strength: 0.16 }));
      }
    }
    const fxOn = opts.useEffects && style.impactFx > 0 && sl.startS - lastImpactFxS >= 0.8;
    const hasVisualImpact = c.shot.tags.includes('impacto') || (visual?.confidence !== undefined && visual.confidence >= 0.55 && visual.action === 'combate');
    let impactLocalUs: number | null = null;
    if (Number.isFinite(c.shot.peakS) && c.shot.peakS >= srcIn && c.shot.peakS <= srcIn + len * speed) {
      const speedProbe = baseClip(v1.id, c.ep.assetId, sl.startS, len, srcIn, '', {
        speed,
        sourceOutUs: us(srcIn + len * speed),
        keyframes: speedKeyframes.length ? { speed: speedKeyframes } : {},
      });
      if (speedKeyframes.length) speedProbe.sourceOutUs = speedProbe.sourceInUs + speedProbe.durationUs;
      impactLocalUs = timelineLocalAtSource(speedProbe, us(c.shot.peakS));
    }
    // Recorte/punch-in de personagem SOMENTE quando há evidência visual confiável de personagem/rosto
    // (evita deslocar para cantos falsos usando apenas centróide de contraste sem sujeito confirmado).
    let punchScale = 1;
    let punchX = 0;
    let punchY = 0;
    let characterFramingReason: string | null = null;
    const confirmedCharacter = Boolean(
      visual
      && typeof visual.confidence === 'number'
      && Number.isFinite(visual.confidence)
      && visual.confidence >= 0.55
      && ((visual.faceCount ?? 0) >= 1 || visual.characters.length > 0),
    );
    const focusPoint = currentLocal?.subjectFocus ?? currentLocal?.centerOfVisualMass;
    const hasFocusPoint = Boolean(focusPoint && focusPoint.length === 2 && Number.isFinite(focusPoint[0]) && Number.isFinite(focusPoint[1]));
    const hasLocalSubject = (currentLocal?.subjectFocusConfidence ?? 0) >= 0.58;
    const isVerticalProject = project.settings.height > project.settings.width;
    const wantsCharacterPunch = Boolean(
      opts.useEffects
      && (confirmedCharacter || (hasLocalSubject && isVerticalProject))
      && editorialDirection !== 'cinematic'
      && ((hit && sl.energy >= 0.65)
        || (sl.isDrop && hasVisualImpact)
        || (c.shot.tags.includes('impacto') && sl.energy >= 0.6)
        || (visual?.framing === 'close-up' && sl.energy >= 0.55)
        || isVerticalProject),
    );
    let panKeyframesX: Keyframe[] = [];
    if (wantsCharacterPunch) {
      punchScale = sl.isDrop || (hit && sl.energy >= 0.85) ? 1.12 : 1.07;
      if (hasFocusPoint) {
        const [cx, cy] = focusPoint!;
        const maxShiftX = Math.max((punchScale - 1) * project.settings.width * 0.45, isVerticalProject ? project.settings.width * 0.28 : 0);
        const maxShiftY = (punchScale - 1) * project.settings.height * 0.4;
        punchX = Math.round(Math.max(-maxShiftX, Math.min(maxShiftX, -(cx - 0.5) * project.settings.width)));
        punchY = Math.round(Math.max(-maxShiftY, Math.min(maxShiftY, -(cy - 0.5) * project.settings.height)));
        const traj = currentLocal?.focusTrajectory;
        if (traj && len >= 0.65 && Math.abs(traj[1][0] - traj[0][0]) >= 0.12) {
          const xStart = Math.round(Math.max(-maxShiftX, Math.min(maxShiftX, -(traj[0][0] - 0.5) * project.settings.width)));
          const xEnd = Math.round(Math.max(-maxShiftX, Math.min(maxShiftX, -(traj[1][0] - 0.5) * project.settings.width)));
          if (Math.abs(xEnd - xStart) >= 12) {
            panKeyframesX = [
              { atUs: 0, value: xStart, easing: 'ease-in-out' },
              { atUs: us(len), value: xEnd, easing: 'ease-in-out' },
            ];
          }
        }
      }
      characterFramingReason = confirmedCharacter
        ? 'recorte focado no personagem com análise visual confiável'
        : 'auto-reframe focado no sujeito/rosto de anime';
    }

    if (fxOn && hit && hasVisualImpact && impactLocalUs !== null) {
      const zoomStrength = editorialDirection === 'cinematic' ? 0.035 : editorialDirection === 'hype' ? 0.075 : 0.055;
      visualScaleKeyframes = impactZoomCurve(us(len), impactLocalUs, punchScale, zoomStrength);
      visualImpactReason = 'zoom de impacto animado no golpe sincronizado';
    } else if (fxOn && !visualScaleKeyframes.length && editorialDirection !== 'cinematic' && style.impactFx >= 0.7) {
      if (sl.isDrop || (sl.energy >= 0.8 && (sl.musicCue?.includes('acento') || len <= 0.5))) {
        const punchStrength = editorialDirection === 'hype' ? 0.04 : 0.025;
        visualScaleKeyframes = beatPunchCurve(us(len), punchScale, punchStrength);
        visualImpactReason = 'micro-pulso rítmico no ataque da batida';
      }
    }
    if (fxOn && sl.isDrop) {
      const flashStrength = editorialDirection === 'cinematic' ? 0.5 : editorialDirection === 'hype' ? 1.15 : 1;
      effects.push(fx('flash', { duration: editorialDirection === 'cinematic' ? 0.12 : 0.2, white: 1, strength: flashStrength }));
      if (hasVisualImpact) {
        const shakeIntensity = editorialDirection === 'cinematic' ? 8 : editorialDirection === 'hype' ? 28 : 22;
        effects.push(fx('shake', { intensity: shakeIntensity, frequency: 14, duration: editorialDirection === 'cinematic' ? 0.2 : 0.45 }));
      }
      if (editorialDirection !== 'cinematic') {
        effects.push(fx('rgb_split', { amount: editorialDirection === 'hype' ? 14 : 9, duration: 0.25 }));
      }
    } else if (fxOn && editorialDirection !== 'cinematic' && hit && sl.energy >= 0.65 && hasVisualImpact) {
      const visualConfidence = Math.max(visual?.confidence ?? 0, c.shot.motion);
      const intensity = (editorialDirection === 'hype' ? 8 : 5) + Math.round(visualConfidence * (editorialDirection === 'hype' ? 12 : 8));
      effects.push(fx('shake', { intensity, frequency: 12, duration: Math.min(0.22, len) }));
      if (sl.energy >= 0.78 && editorialDirection === 'hype') {
        effects.push(fx('rgb_split', { amount: 8, duration: Math.min(0.18, len) }));
      }
    }
    if (effects.some((effect) => ['flash', 'shake', 'rgb_split'].includes(effect.effect)) || visualScaleKeyframes.length) lastImpactFxS = sl.startS;
    const previousVision = prev ? visionOf(prev.ep, prev.shot) : undefined;
    const currentVision = visionOf(c.ep, c.shot);
    const transitionChoice = prev
      ? chooseSceneTransition({
          outgoing: { shot: prev.shot, local: previousVision?.local, vision: previousVision },
          incoming: { shot: c.shot, local: currentVision?.local, vision: currentVision },
          musicEnergy: sl.energy,
          isDrop: sl.isDrop,
          durationS: Math.min(len, prevSlot ? prevSlot.endS - prevSlot.startS : len),
          direction: editorialDirection,
          style: opts.style,
        })
      : null;
    let transition = transitionChoice?.transition ?? null;
    const decorative = transition && !['match_cut', 'cut_on_action'].includes(transition.transition);
    if (decorative) {
      if (!opts.useEffects || sl.startS - lastDecorativeTransitionS < 1.2) transition = null;
      else lastDecorativeTransitionS = sl.startS;
    }
    const clipEffects = refineImpactEffects(effects, len, visualScaleKeyframes.length > 0, transition, sl.isDrop);
    // Arco Início → Meio → Fim: abertura do preto e encerramento suave no preto
    if (opts.useEffects && D >= 8 && slotIndex === 0 && !clipEffects.some((e) => e.effect === 'fade_in')) {
      clipEffects.push(fx('fade_in', { duration: Math.round(Math.min(0.45, len * 0.65) * 100) / 100 }));
    }
    if (opts.useEffects && D >= 8 && slotIndex === fitSlots.length - 1 && !clipEffects.some((e) => e.effect === 'fade_out')) {
      clipEffects.push(fx('fade_out', { duration: Math.round(Math.min(0.65, len * 0.75) * 100) / 100 }));
    }
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
      hit ? 'golpe na batida' : internalBeatHit ? 'impacto sincronizado na batida interna' : null,
      characterFramingReason,
      motionCropReason,
      speed < 1 ? `câmera lenta ${speed.toFixed(2)}×` : null,
      adaptiveSpeedReason,
      visualImpactReason,
      exposureMatch ? `exposição ajustada ${exposureMatch > 0 ? '+' : ''}${exposureMatch.toFixed(2)} EV pela diferença de luminosidade` : null,
      colorMatch.temperature || colorMatch.tint ? 'cor suavizada em relação à cena anterior usando histogramas visuais locais' : null,
      transitionChoice?.reason ?? null,
    ]
      .filter(Boolean)
      .join(' — ');
    const wasReused = used.has(c.id);
    const effectivePunchScale = wasReused && punchScale === 1 ? 1.12 : punchScale;
    const clip = baseClip(v1.id, c.ep.assetId, sl.startS, len, srcIn, why, {
      speed,
      sourceOutUs: us(srcIn) + us(srcLen),
      effects: clipEffects,
      transitionIn: transition,
      audio: selectedVideoAudio(streamFor(c.ep)),
      transform: {
        x: punchX,
        y: punchY,
        scale: effectivePunchScale,
        rotation: 0,
        opacity: 1,
        crop: { left: 0, top: 0, right: 0, bottom: 0 },
      },
    });
    clip.sourceOutUs = clip.sourceInUs + Math.round(clip.durationUs * speed);
    if (speedKeyframes.length) {
      clip.keyframes.speed = speedKeyframes;
      clip.sourceOutUs = clip.sourceInUs + clip.durationUs;
      speedRamps++;
    }
    // Push-in/pull-out cinematográfico em planos mais longos sem impacto (mantém a imagem viva
    // mesmo sem IA de visão externa, respeitando useEffects=false).
    if (opts.useEffects && !visualScaleKeyframes.length && len >= 1.1 && !sl.isDrop) {
      const strength = Math.min(0.065, 0.028 + len * 0.008);
      const out = slotIndex % 2 === 1;
      const from = out ? punchScale * (1 + strength) : punchScale;
      const to = out ? punchScale : punchScale * (1 + strength);
      visualScaleKeyframes = [
        { atUs: 0, value: from, easing: 'ease-in-out' },
        { atUs: us(len), value: to, easing: 'linear' },
      ];
      clip.reason = `${clip.reason} — movimento de câmera suave no plano`;
    }
    const slotScenePalette = extractScenePalette(currentLocal);
    if (visualScaleKeyframes.length) clip.keyframes['transform.scale'] = visualScaleKeyframes;
    if (panKeyframesX.length) clip.keyframes['transform.x'] = panKeyframesX;
    cmds.push({ type: 'clip.add', clip });
    if (opts.showText && text && sl.word) {
      const timing = sl.wordTiming
        ? [{ ...sl.wordTiming, startS: sl.startS, endS: sl.endS }]
        : undefined;
      cmds.push({ type: 'clip.add', clip: textClip(text.id, sl.startS, len, sl.word, H, 'word', 'Palavra da letra', sl.isDrop, sl.energy, timing, opts.lyricStyle ?? 'lyrics-cinematic', undefined, opts.useEffects, false, slotScenePalette) });
    }
    used.add(c.id);
    if (currentLocal?.fingerprint && currentLocal.entropy >= 0.16) {
      usedFingerprints.add(currentLocal.fingerprint);
    }
    lastUsedSlot.set(c.id, slotIndex);
    const intervalsForAsset = usedIntervals.get(c.assetId) ?? [];
    intervalsForAsset.push([srcIn, srcIn + srcLen]);
    usedIntervals.set(c.assetId, intervalsForAsset);
    // Mantém o mesmo histórico usado pelo planejador para justificar a escolha.
    selectedHistory.push(c);
    if (selectedHistory.length > RECENT_WINDOW) selectedHistory.shift();
    const anyHitSynced = hit || internalBeatHit;
    const impactAtUs = anyHitSynced ? timelineLocalAtSource(clip, us(c.shot.peakS)) : null;
    cutsLog.push({
      startS: sl.startS,
      len,
      energy: sl.energy,
      intensity: c.shot.intensity,
      isDrop: sl.isDrop,
      hitAtS: impactAtUs === null ? null : sl.startS + impactAtUs / S,
      peakSrcS: anyHitSynced && Number.isFinite(c.shot.peakS) ? c.shot.peakS : null,
      assetId: c.ep.assetId,
      hasAudio: c.ep.hasAudio,
      streamIndex: streamFor(c.ep),
      palette: slotScenePalette,
      hasSubject: confirmedCharacter || hasLocalSubject,
      transitionKind: transition?.transition ?? null,
      ...(sl.lyricCueKey ? { lyricCueKey: sl.lyricCueKey } : {}),
      ...(lyricMatch ? { lyricMatchScore: lyricMatch.score, lyricMatchReason: lyricMatch.reason } : {}),
    });
    prev = c;
    prevSlot = sl;
    clipsMade++;
  }
  if (rescuedSlots > 0) warnings.push(`${rescuedSlots} trecho(s) foram preenchidos com cenas de reserva; pode haver repetição ou salto narrativo. Revise esses cortes.`);
  if (darkRescuedSlots > 0) warnings.push(`${darkRescuedSlots} trecho(s) precisaram usar cenas muito escuras porque nenhum plano normal tinha duração suficiente.`);
  if (unfilledSlots > 0) warnings.push(`${unfilledSlots} trecho(s) continuaram sem cena: não havia plano com duração suficiente para preencher sem ultrapassar a fonte. Importe mais episódios ou reduza a duração.`);
  if (opts.hitSync !== false && hitSlots > 0 && syncedHits < hitSlots * 0.5) warnings.push(`Só ${syncedHits} de ${hitSlots} cortes fortes tiveram o golpe encaixado na batida (as cenas escolhidas têm o golpe longe do começo).`);


  // ---------------------------------------------------------------- efeitos sonoros (golpes, impactos e transições reais)
  const sfxCount = sfxTrack && opts.useSfx !== false && opts.sfxMode !== 'off' && opts.sfxAssets ? placeSfx() : 0;
  function placeSfx(): number {
    const assets = opts.sfxAssets!;
    const hitsOnly = opts.sfxMode === 'hits-only';
    const unifiedSfx = Boolean(opts.autonomous || opts.dynamicTypography);
    const r2 = rng(((opts.seed * 2654435761) ^ 0x51f15e) >>> 0); // sorteio próprio: não mexe na escolha das cenas
    type Cand = { kind: SfxKind; startS: number; srcIn: number; durS: number; gainDb: number; prio: number; why: string; animeBurst?: { assetId: string; peakSrcS: number; streamIndex: number | null } };
    const cands: Cand[] = [];
    const anchored = (kind: SfxKind, atS: number, gainDb: number, prio: number, why: string, animeBurst?: Cand['animeBurst']) => {
      let start = atS - SFX_ANCHOR_S[kind];
      let srcIn = 0;
      if (start < 0) {
        srcIn = -start;
        start = 0;
      }
      const dur = Math.min(SFX_DURATION_S[kind] - srcIn, D - start);
      if (assets[kind] && dur > 0.05) cands.push({ kind, startS: start, srcIn, durS: dur, gainDb, prio, why, animeBurst });
    };
    const hasPreDropVoice = blocks.some((b) => b.preDrop);
    if (dropT !== null) {
      anchored('impact', dropT, 0, 1000, 'Impacto no drop');
      // Em Modo Livre coloca subida até o drop apenas quando não há fala dramática pré-drop; em 'hits-only' manual mantém seco.
      if ((!hitsOnly || unifiedSfx) && !hasPreDropVoice) anchored('riser', dropT - SFX_ANCHOR_S.impact, -5.5, 900, 'Subida até o drop');
    }
    const perHit = Math.min(1, 0.35 + 0.65 * style.impactFx);
    let hitIdx = 0;
    for (const c of cutsLog) {
      if (c.isDrop) continue;
      if (hitsOnly || unifiedSfx) {
        if (c.hitAtS !== null && c.energy >= 0.45) {
          const hitKind: SfxKind = assets.clash && hitIdx % 3 === 1 ? 'clash' : 'hit';
          hitIdx++;
          const burst = opts.animeHitAudio !== false && c.hasAudio && c.peakSrcS !== null
            ? { assetId: c.assetId, peakSrcS: c.peakSrcS, streamIndex: c.streamIndex }
            : undefined;
          anchored(hitKind, c.hitAtS, -5.5, 80 + 40 * c.intensity, hitKind === 'clash' ? 'Golpe cortante na batida' : 'Golpe na batida', burst);
        } else if (
          unifiedSfx
          && (c.transitionKind === 'whip_pan' || c.transitionKind === 'zoom_through')
          && c.energy >= 0.38
          && c.energy <= 0.85
        ) {
          anchored('whoosh', c.startS, -9.5, 45, `Transição rápida (${c.transitionKind})`);
        }
      } else {
        if (c.hitAtS !== null && c.energy >= 0.5 && r2() < 0.5 * perHit) anchored('hit', c.hitAtS, -6, 50 + 40 * c.intensity, 'Golpe');
        else if (c.len >= 0.9 && c.energy >= 0.3 && c.energy < 0.8 && r2() < 0.22 * perHit) anchored('whoosh', c.startS, -9, 30, 'Whoosh antes do corte');
      }
    }
    cands.sort((a, b) => b.prio - a.prio || a.startS - b.startS);
    const kept: Cand[] = [];
    const maxN = hitsOnly ? Math.max(6, Math.ceil(D / 1.1)) : Math.max(4, Math.ceil(D / 1.6));
    const SPACING_S = hitsOnly ? 0.45 : 0.75;
    for (const c of cands) {
      if (kept.length >= maxN) break;
      const end = c.startS + c.durS;
      if (blocks.some((b) => c.startS < b.atS + b.len - 0.02 && end > b.atS + 0.02)) continue;
      if (kept.some((k) => c.startS < k.startS + k.durS - 0.02 && end > k.startS + 0.02)) continue;
      const soft = c.kind === 'hit' || c.kind === 'clash' || c.kind === 'whoosh';
      if (soft && kept.some((k) => (k.kind === 'hit' || k.kind === 'clash' || k.kind === 'whoosh') && Math.abs(k.startS - c.startS) < SPACING_S)) continue;
      kept.push(c);
    }
    kept.sort((a, b) => a.startS - b.startS);
    const usedVoiceBursts: Array<[number, number]> = blocks.map((b) => [b.atS - 0.08, b.atS + b.len + 0.08]);
    for (const k of kept) {
      cmds.push({
        type: 'clip.add',
        clip: baseClip(sfxTrack!.id, assets[k.kind]!, k.startS, k.durS, k.srcIn, `Efeito sonoro: ${k.why}`, {
          audio: { gainDb: k.gainDb, fadeInUs: k.kind === 'riser' ? us(0.08) : 0, fadeOutUs: k.kind === 'riser' ? 0 : us(0.03), pitchSemitones: 0, pitchMode: 'preserve', streamIndex: null },
        }),
      });
      // Micro-burst do impacto real do episódio (apenas o transiente do golpe 0,24s na trilha de voz livre)
      if (k.animeBurst && voice && opts.style !== 'discurso') {
        const burstDur = 0.24;
        const burstStart = Math.max(0, Math.min(D - burstDur, k.startS - 0.03));
        const burstSrcIn = Math.max(0, k.animeBurst.peakSrcS - 0.04);
        const overlapsVoice = usedVoiceBursts.some(([a, b]) => burstStart < b && burstStart + burstDur > a);
        if (!overlapsVoice && burstDur > 0.1) {
          usedVoiceBursts.push([burstStart - 0.15, burstStart + burstDur + 0.15]);
          cmds.push({
            type: 'clip.add',
            clip: baseClip(voice.id, k.animeBurst.assetId, burstStart, burstDur, burstSrcIn, 'Som real do golpe no anime (imersão)', {
              label: 'Golpe anime',
              audio: {
                gainDb: -7.5,
                fadeInUs: us(0.025),
                fadeOutUs: us(0.09),
                pitchSemitones: 0,
                pitchMode: 'preserve',
                streamIndex: k.animeBurst.streamIndex,
              },
            }),
          });
        }
      }
    }
    return kept.length;
  }

  // ---------------------------------------------------------------- falas + imagem (ou narração por cima dos cortes musicais)
  for (const b of blocks) {
    const { ep, s } = b;
    const sourceText = speechCaptionText(ep, s, lang, opts);
    const subtitleTranslations = speechTranslation(ep, s, opts);
    const visualSpeech = showSpeechVideo(b);
    const reason = b.preDrop
      ? `Fala marcante antes do drop: ${sourceText ? `"${sourceText.replace(/\n/g, ' ')}"` : s.kind} — ${ep.name} ${fmt(s.startS)}; música abaixada durante a fala`
      : `${visualSpeech ? 'Fala intercalada' : 'Narração sobre cortes de ação'}: ${sourceText ? `"${sourceText.replace(/\n/g, ' ')}"` : s.kind} — ${ep.name} ${fmt(s.startS)}; música abaixada`;
    if (visualSpeech) {
      const lead = b.atS - b.from;
      const voiceDurS = Math.max(0.05, b.to - b.from);
      const voicePunchScale = opts.useEffects ? 1.06 : 1;
      const voiceClip = baseClip(v1.id, ep.assetId, b.from, voiceDurS, Math.max(0, s.startS - lead), reason, {
        effects: opts.useEffects ? gradeFx(style.grade) : [],
        audio: selectedVideoAudio(streamFor(ep), -60),
        transform: {
          x: 0,
          y: 0,
          scale: voicePunchScale,
          rotation: 0,
          opacity: 1,
          crop: { left: 0, top: 0, right: 0, bottom: 0 },
        },
      });
      if (opts.useEffects && voiceDurS >= 0.6) {
        voiceClip.keyframes['transform.scale'] = [
          { atUs: 0, value: voicePunchScale, easing: 'ease-in-out' },
          { atUs: us(voiceDurS), value: Math.round(voicePunchScale * 1.05 * 1000) / 1000, easing: 'linear' },
        ];
      }
      cmds.push({ type: 'clip.add', clip: voiceClip });
    }
    cmds.push({ type: 'clip.add', clip: baseClip(voice!.id, ep.assetId, b.atS, b.len, s.startS, reason, { audio: { gainDb: voiceGainDb(b.preDrop ? 3 : 2, measuredVoiceLevel(ep, s)), fadeInUs: us(0.05), fadeOutUs: us(0.08), pitchSemitones: 0, pitchMode: 'preserve', streamIndex: streamFor(ep), voiceIsolation: opts.useEffects !== false, echoTail: Boolean(opts.useEffects !== false && b.preDrop) } }) });
    const speechPreset = resolveSpeechPreset(opts.lyricStyle, Boolean(opts.lyrics?.length));
    if (opts.showText && opts.showSpeechCaptions !== false && text && sourceText && style.subtitles !== 'none') addCaptionPhrases(cmds, text.id, b.atS, b.len, sourceText, H, 'Legenda da fala', Math.max(s.impact, impactScore(sourceText)), subtitleTranslations, speechPreset, opts.useEffects, true);
    if (visualSpeech) clipsMade++;
  }

  // Sung timing is authoritative: decorative impacts must not erase or delay the lyrics.
  if (opts.showText && text && opts.lyrics?.length && style.subtitles !== 'none') {
    const timedWordCueKeys = new Set(slots.filter((slot) => slot.word && slot.lyricCueKey).map((slot) => slot.lyricCueKey));
    const chosenLyricStyle = opts.lyricStyle ?? 'lyrics-cinematic';
    const timelineBeats = m.beats.map((t) => t + beatOffsetS - range[0]).filter((t) => t >= 0 && t <= D);
    const cutAtTime = (timeS: number) =>
      cutsLog.find((cut) => timeS >= cut.startS && timeS < cut.startS + cut.len);
    const paletteAtTime = (timeS: number): SceneTypographyPalette | null =>
      cutAtTime(timeS)?.palette ?? null;
    for (const [cueIdx, cue] of layoutLyrics(opts.lyrics, range, blocks).entries()) {
      const originalCue = opts.lyrics.find((item) => item.text === cue.text && item.startS - range[0] <= cue.startS + 1e-6 && item.endS - range[0] >= cue.endS - 1e-6);
      const cueKey = originalCue ? lyricCueKey(originalCue) : undefined;
      if (style.id === 'letra' && cueKey && timedWordCueKeys.has(cueKey)) continue;
      const lyricSceneMatch = cueKey
        ? cutsLog.find((cut) => cut.lyricCueKey === cueKey && (cut.lyricMatchScore ?? 0) >= 0.65 && cut.startS < cue.endS && cut.startS + cut.len > cue.startS)
        : undefined;
      const cueDur = cue.endS - cue.startS;
      const cueMidS = (cue.startS + cue.endS) / 2;
      const cueEnergy = energyAt(m, range[0] + cueMidS);
      const cueRole = narrativeAt(direction, cueMidS)?.role;
      const cueNearDrop = dropT !== null && cue.startS <= dropT + 2.2 && cue.endS >= dropT - 0.25;
      const activeCut = cutAtTime(cueMidS);
      const cueWordsCount = cue.text.trim().split(/\s+/).filter(Boolean).length;
      const cueImpact = Math.max(impactScore(cue.text), lyricSceneMatch?.lyricMatchScore ?? 0);

      // Em Modo Livre, adapta automaticamente tipografia + modo de exibição conforme a seção musical e a cena
      const isDynamicTypo = Boolean(opts.autonomous || opts.dynamicTypography);
      let effectiveDisplayMode = opts.lyricDisplayMode ?? 'rhythmic-phrases';
      let effectiveCueStyle: LyricTypographyStyle = chosenLyricStyle;
      if (isDynamicTypo) {
        if (cueNearDrop || cueEnergy >= 0.72 || cueRole === 'climax') {
          effectiveDisplayMode = 'kinetic-words';
          const brightOrSubject = cueNearDrop || (activeCut?.palette?.brightness ?? 0.5) >= 0.36 || Boolean(activeCut?.hasSubject);
          effectiveCueStyle = brightOrSubject
            ? (cueIdx % 4 === 3 && activeCut?.hitAtS !== null ? 'anime-impact' : 'anime-blend')
            : (cueIdx % 2 === 0 ? 'anime-impact' : 'anime-katana');
        } else if (cueEnergy >= 0.45 || cueRole === 'build') {
          if (cueWordsCount <= 4 || cueImpact >= 0.68) {
            effectiveDisplayMode = 'kinetic-words';
            effectiveCueStyle = cueIdx % 2 === 0 ? 'anime-katana' : 'anime-neon';
          } else {
            effectiveDisplayMode = 'rhythmic-phrases';
            effectiveCueStyle = (activeCut?.palette?.brightness ?? 0.5) < 0.36 ? 'anime-neon' : 'anime-gold-epic';
          }
        } else {
          effectiveDisplayMode = 'rhythmic-phrases';
          effectiveCueStyle = cueRole === 'opening' || cueRole === 'ending' ? 'anime-gold-epic' : 'lyrics-cinematic';
        }
      }

      if (effectiveDisplayMode === 'kinetic-words' && cueDur >= 0.25) {
        const chunks = splitKineticChunks(cue.text, cueDur);
        if (chunks.length >= 2) {
          const tokens = cue.text.trim().split(/\s+/).filter(Boolean);
          const timedWords = cue.words?.length === tokens.length ? cue.words : null;
          const kineticPreset: LyricTypographyStyle = effectiveCueStyle === 'lyrics-cinematic' ? 'anime-impact' : effectiveCueStyle;
          const boundaries: number[] = [cue.startS];
          if (timedWords) {
            let tokenOffset = 0;
            for (let i = 0; i < chunks.length - 1; i++) {
              const chunkTokens = chunks[i]!.split(/\s+/).filter(Boolean).length;
              tokenOffset += chunkTokens;
              const boundaryWord = timedWords[tokenOffset];
              const rawBoundary = boundaryWord ? boundaryWord.startS : boundaries[i]! + cueDur / chunks.length;
              boundaries.push(rawBoundary);
            }
          } else {
            const weights = chunks.map((chunk) => Math.max(2, Array.from(chunk).length + 2));
            const totalWeight = weights.reduce((acc, w) => acc + w, 0);
            let cursor = cue.startS;
            for (let i = 0; i < chunks.length - 1; i++) {
              cursor += (weights[i]! / totalWeight) * cueDur;
              boundaries.push(cursor);
            }
          }
          boundaries.push(cue.endS);

          // Ajusta divisões internas à batida mais próxima (até 80 ms) sem comprimir palavras.
          for (let i = 1; i < boundaries.length - 1; i++) {
            const current = boundaries[i]!;
            const nearestBeat = timelineBeats.find((b) => Math.abs(b - current) <= 0.08);
            if (nearestBeat !== undefined && nearestBeat - boundaries[i - 1]! >= 0.18 && boundaries[i + 1]! - nearestBeat >= 0.18) {
              boundaries[i] = nearestBeat;
            }
          }

          for (let i = 0; i < chunks.length; i++) {
            const cStart = boundaries[i]!;
            const cEnd = boundaries[i + 1]!;
            const cDur = cEnd - cStart;
            if (cDur < 0.08) continue;
            const hasDrop = dropT !== null && cStart <= dropT + 0.15 && cEnd >= dropT - 0.15;
            const chunkMidS = (cStart + cEnd) / 2;
            const chunkCut = cutAtTime(chunkMidS);
            const chunkPreset: LyricTypographyStyle = isDynamicTypo && hasDrop
              ? 'anime-blend'
              : isDynamicTypo && chunkCut?.hitAtS !== null && i % 2 === 1
                ? 'anime-impact'
                : kineticPreset;
            const kineticReason = lyricSceneMatch ? `Palavra da letra · ${lyricSceneMatch.lyricMatchReason}` : 'Palavra da letra';
            cmds.push({
              type: 'clip.add',
              clip: textClip(
                text.id,
                cStart,
                cDur,
                chunks[i]!,
                H,
                'word',
                kineticReason,
                true,
                Math.max(0.65, cueImpact, hasDrop ? 1 : 0),
                undefined,
                chunkPreset,
                undefined,
                opts.useEffects,
                false,
                paletteAtTime(chunkMidS),
              ),
            });
          }
          continue;
        }
      }

      const reason = lyricSceneMatch ? `Letra da música · ${lyricSceneMatch.lyricMatchReason}` : 'Letra da música';
      const wordTimings = cue.words?.filter(hasReliableWordTiming);
      cmds.push({
        type: 'clip.add',
        clip: textClip(
          text.id,
          cue.startS,
          cueDur,
          cue.text,
          H,
          'line',
          reason,
          true,
          cueImpact,
          wordTimings,
          effectiveCueStyle,
          undefined,
          opts.useEffects,
          false,
          paletteAtTime(cueMidS),
        ),
      });
    }
    const omitted = opts.lyrics.filter((cue) => cue.endS > range[0] && cue.startS < range[1] && blocks.some((block) => cue.startS - range[0] < block.atS + block.len && cue.endS - range[0] > block.atS)).length;
    if (omitted) warnings.push(`${omitted} verso(s) foram divididos ou omitidos apenas durante falas para evitar sobreposição de textos.`);

    // Depth Cutout em V2: destaca o personagem na frente da letra gigante no Drop e nos picos de impacto da música
    if (opts.depthCutoutOnDrop && opts.useEffects !== false && v2) {
      const anchorMomentsS: number[] = [];
      if (dropT !== null) anchorMomentsS.push(dropT);
      for (const cut of [...cutsLog].sort((a, b) => (b.energy + b.intensity) - (a.energy + a.intensity))) {
        if (anchorMomentsS.length >= 4) break;
        if (!cut.hasSubject && cut.energy < 0.78) continue;
        if (anchorMomentsS.some((t) => Math.abs(t - cut.startS) < 4.5)) continue;
        anchorMomentsS.push(cut.startS);
      }
      const placedV2Ranges: Array<[number, number]> = [];
      for (const [momentIdx, momentS] of anchorMomentsS.entries()) {
        const momentUs = us(momentS);
        const momentEndUs = momentUs + us(0.75);
        const v1TargetCmd = cmds.find(
          (cmd): cmd is Extract<Command, { type: 'clip.add' }> =>
            cmd.type === 'clip.add'
            && cmd.clip.trackId === v1.id
            && Boolean(cmd.clip.assetId)
            && cmd.clip.timelineStartUs <= momentUs + 50_000
            && cmd.clip.timelineStartUs + cmd.clip.durationUs > momentUs + 120_000,
        );
        const lyricCmdsAtMoment = cmds.filter(
          (cmd): cmd is Extract<Command, { type: 'clip.add' }> =>
            cmd.type === 'clip.add'
            && cmd.clip.trackId === text.id
            && Boolean(cmd.clip.text)
            && /letra da música|palavra da letra/i.test(cmd.clip.reason ?? '')
            && cmd.clip.timelineStartUs < momentEndUs
            && cmd.clip.timelineStartUs + cmd.clip.durationUs > momentUs,
        );
        if (!v1TargetCmd || lyricCmdsAtMoment.length === 0) continue;
        const base = v1TargetCmd.clip;
        const cutDurUs = Math.min(base.durationUs, us(0.72));
        const v2Start = base.timelineStartUs;
        const v2End = v2Start + cutDurUs;
        if (placedV2Ranges.some(([a, b]) => v2Start < b && v2End > a)) continue;
        placedV2Ranges.push([v2Start, v2End]);
        for (const lc of lyricCmdsAtMoment) {
          lc.clip.text = { ...lc.clip.text!, behindCutout: true };
        }
        const maskKind: Clip['mask'] = momentIdx % 2 === 1 && (opts.autonomous || chosenLyricStyle === 'anime-katana')
          ? 'manga-slash'
          : 'subject-focus';
        const v2Clip = baseClip(
          v2.id,
          base.assetId,
          v2Start / S,
          cutDurUs / S,
          base.sourceInUs / S,
          momentS === dropT
            ? 'Destaque de personagem em V2 no drop (letra passando atrás)'
            : 'Recorte de profundidade em V2 (letra mesclada atrás do personagem)',
          {
            speed: base.speed,
            sourceOutUs: base.sourceInUs + Math.round(cutDurUs * base.speed),
            mask: maskKind,
            audio: { ...base.audio, gainDb: -60 },
            transform: { ...base.transform, scale: Math.max(1.06, base.transform.scale * 1.04) },
            keyframes: {
              'transform.scale': [
                { atUs: 0, value: Math.max(1.06, base.transform.scale * 1.04), easing: 'ease-out' },
                { atUs: cutDurUs, value: Math.max(1.14, base.transform.scale * 1.12), easing: 'linear' },
              ],
            },
          },
        );
        cmds.push({ type: 'clip.add', clip: v2Clip });
      }
    }
  }

  const firstSpeech = blocks.find((b) => b.preDrop) ?? blocks[0];
  return {
    commands: cmds,
    summary: {
      clips: clipsMade,
      cuts: Math.max(0, clipsMade - 1),
      speech: firstSpeech ? (speechCaptionMatchesAudio(firstSpeech.ep, firstSpeech.s, lang) ? firstSpeech.s.text ?? firstSpeech.s.kind : firstSpeech.s.kind) : null,
      musicRange: range,
      drop: dropT,
      focus: plan.mode,
      fights: plan.pool.map((e) => `${e.ep.name} ${fmt(e.seq.startS)}–${fmt(e.seq.endS)}`),
      voices: blocks.length,
      hitsSynced: syncedHits,
      speedRamps,
      sfx: sfxCount,
      direction,
    },
    warnings: [...new Set(warnings)],
  };
}

export type { Track };
