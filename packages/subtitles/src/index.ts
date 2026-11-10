import type { Cue } from '@amv/analysis';
import { applyCommand, clearRange as clearTimelineRange, clipEndUs, newId, TextContentSchema, timelineLocalAtSource, type Clip, type Command, type Project, type TextWordTiming } from '@amv/project';

/**
 * Legendas na timeline: são clipes de texto comuns na trilha de texto.
 * Aqui ficam as operações puras (importar, puxar do episódio, ajustar tempo,
 * estilo para todas, exportar). Tudo devolve Commands — um desfazer por ação.
 */

const S = 1_000_000;
const us = (s: number) => Math.round(s * S);

export type SubtitleLook =
  | 'legenda' | 'destaque' | 'palavra' | 'karaoke' | 'lyrics-cinematic' | 'dialogue-dramatic' | 'impact-typography'
  | 'section-intro' | 'section-verse' | 'section-chorus' | 'section-climax';

export const LOOKS: { id: SubtitleLook; label: string; description: string }[] = [
  { id: 'legenda', label: 'Legenda', description: 'Embaixo, contorno preto, discreta.' },
  { id: 'destaque', label: 'Destaque', description: 'No meio, grande, com sombra. Para frases de impacto.' },
  { id: 'palavra', label: 'Palavra', description: 'Maiúsculas enormes, entra com pulo. Estilo letra na tela.' },
  { id: 'karaoke', label: 'Letra', description: 'Embaixo, maior, amarelo claro. Para letra da música.' },
  { id: 'lyrics-cinematic', label: 'Lyrics Cinematic', description: 'Letra grande com realce palavra a palavra.' },
  { id: 'dialogue-dramatic', label: 'Dialogue Dramatic', description: 'Fala legível com caixa escura e contorno.' },
  { id: 'impact-typography', label: 'Impact Typography', description: 'Texto central grande com entrada pop.' },
  { id: 'section-intro', label: 'Intro', description: 'Título espaçado e cinematográfico; edite o estilo no Inspector após aplicar.' },
  { id: 'section-verse', label: 'Verso', description: 'Legenda discreta em área segura; edite o estilo no Inspector após aplicar.' },
  { id: 'section-chorus', label: 'Refrão', description: 'Letra com realce gradual; edite o estilo no Inspector após aplicar.' },
  { id: 'section-climax', label: 'Clímax', description: 'Tipografia de impacto com gradiente e glow; edite o estilo no Inspector após aplicar.' },
];

export interface UntimedLyricAlignment {
  cues: Cue[];
  matched: number;
  uncertain: number;
  unmatched: number;
}

type CueWord = NonNullable<Cue['words']>[number];

function lyricTokens(text: string, characters: boolean): string[] {
  const normalized = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  if (characters) return Array.from(normalized).filter((part) => /[\p{L}\p{N}]/u.test(part));
  return normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function editDistance(a: string[], b: string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** Alinha linhas de letra a palavras transcritas localmente, em ordem e com score explícito. */
export function alignUntimedLyrics(
  lyrics: string,
  transcriptWords: { start: number; end: number; text: string }[],
): UntimedLyricAlignment {
  const lines = lyrics.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
  const script = `${lyrics} ${transcriptWords.map((word) => word.text).join(' ')}`;
  const characters = /[\u3040-\u30ff\u3400-\u9fff]/u.test(script);
  const spoken = transcriptWords.flatMap((word, wordIndex) =>
    lyricTokens(word.text, characters).map((token) => ({ token, wordIndex })),
  );
  let cursor = 0;
  let matched = 0;
  let uncertain = 0;
  const cues: Cue[] = [];

  for (const line of lines) {
    const target = lyricTokens(line, characters);
    if (!target.length || cursor >= spoken.length) continue;
    const lengthSlack = characters ? Math.max(2, Math.ceil(target.length * 0.12)) : Math.max(2, Math.ceil(target.length * 0.3));
    const minLength = Math.max(1, target.length - lengthSlack);
    const maxLength = target.length + lengthSlack;
    let best: { start: number; end: number; score: number } | null = null;
    for (let start = cursor; start < spoken.length; start++) {
      for (let length = minLength; length <= maxLength && start + length <= spoken.length; length++) {
        const candidate = spoken.slice(start, start + length).map((word) => word.token);
        const score = 1 - editDistance(target, candidate) / Math.max(target.length, candidate.length);
        const bestLength = best ? best.end - best.start : 0;
        const closerLength = Math.abs(length - target.length) < Math.abs(bestLength - target.length);
        const tiedLonger = Math.abs(length - target.length) === Math.abs(bestLength - target.length) && length > bestLength;
        if (!best || score > best.score || (score === best.score && (closerLength || tiedLonger))) {
          best = { start, end: start + length, score };
        }
      }
    }
    if (!best || best.score < 0.55) continue;
    const matchedWords = [...new Set(spoken.slice(best.start, best.end).map((word) => word.wordIndex))]
      .map((wordIndex) => transcriptWords[wordIndex]!)
      .filter((word) => word.end > word.start);
    const first = matchedWords[0];
    const last = matchedWords.at(-1);
    if (!first || !last) continue;
    if (!Number.isFinite(first.start) || !Number.isFinite(last.end) || last.end <= first.start) continue;
    cues.push({
      startS: Math.max(0, first.start),
      endS: Math.max(first.start, last.end),
      text: line,
      words: matchedWords.map((word) => ({
        startS: word.start,
        endS: word.end,
        text: word.text,
        source: 'whisper',
        confidence: best!.score,
        uncertain: best!.score < 0.78,
      })),
    });
    matched++;
    if (best.score < 0.78) uncertain++;
    cursor = best.end;
  }

  return { cues, matched, uncertain, unmatched: lines.length - matched };
}

export function lookText(look: SubtitleLook, H: number, text: string): { transform: Clip['transform']; text: NonNullable<Clip['text']> } {
  const t = (y: number) => ({ x: 0, y: Math.round(H * y), scale: 1, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } });
  const content = (values: Partial<NonNullable<Clip['text']>> & { text: string }) => TextContentSchema.parse(values);
  switch (look) {
    case 'destaque':
      return { transform: t(0), text: content({ text, font: 'Manrope Variable', size: Math.round(H * 0.075), color: '#ffffff', outlineColor: '#000000', outlineWidth: 4, shadow: true, animationIn: 'pop', animationOut: 'fade' }) };
    case 'palavra':
      return { transform: t(0), text: content({ text: text.toUpperCase(), font: 'Georgia', size: Math.round(H * 0.12), color: '#ffffff', outlineColor: '#000000', outlineWidth: 2, shadow: true, animationIn: 'pop', animationOut: null }) };
    case 'karaoke':
      return { transform: t(0.34), text: content({ text, font: 'Manrope Variable', size: Math.round(H * 0.055), color: '#fff3b0', outlineColor: '#000000', outlineWidth: 4, shadow: true, animationIn: 'fade', animationOut: 'fade' }) };
    case 'lyrics-cinematic':
      return { transform: t(0.22), text: content({ text, font: 'Manrope Variable', size: Math.round(H * 0.09), weight: 800, color: '#ffffff', outlineColor: '#08090c', outlineWidth: 3, shadow: true, animationIn: 'pop', animationOut: 'fade', highlightColor: '#ffd166', highlightScale: 1.18, alignment: 'center', maxWidthRatio: 0.9, marginX: Math.round(H * 0.06), background: 'none' }) };
    case 'dialogue-dramatic':
      return { transform: t(0.28), text: content({ text, font: 'Manrope Variable', size: Math.round(H * 0.062), weight: 700, color: '#ffffff', outlineColor: '#000000', outlineWidth: 2, shadow: true, animationIn: 'fade', animationOut: 'fade', background: 'box', backgroundOpacity: 0.78, alignment: 'center', maxWidthRatio: 0.82, marginX: Math.round(H * 0.08), padding: Math.round(H * 0.025), lineSpacing: 1.22 }) };
    case 'impact-typography':
      return { transform: t(0), text: content({ text: text.toUpperCase(), font: 'Manrope Variable', size: Math.round(H * 0.14), weight: 900, color: '#ffffff', outlineColor: '#050505', outlineWidth: 5, shadow: true, animationIn: 'pop', animationOut: 'fade', background: 'box', backgroundOpacity: 0.68, alignment: 'center', maxWidthRatio: 0.88, marginX: Math.round(H * 0.06), padding: Math.round(H * 0.03), highlightColor: '#ffe066', highlightScale: 1.25 }) };
    case 'section-intro':
      return { transform: t(-0.2), text: content({ text: text.toUpperCase(), font: 'Manrope Variable', size: Math.round(H * 0.08), weight: 700, color: '#ffffff', outlineColor: '#11131a', outlineWidth: 2, shadow: true, animationIn: 'slide', animationOut: 'fade', fillStyle: 'linear-gradient', gradientStartColor: '#fff2bd', gradientEndColor: '#e5a84b', glowColor: '#ffd36e', glowIntensity: 4, letterSpacing: 4, alignment: 'center', section: 'intro' }) };
    case 'section-verse':
      return { transform: t(0.34), text: content({ text, font: 'Manrope Variable', size: Math.round(H * 0.05), color: '#ffffff', outlineColor: '#000000', outlineWidth: 3, shadow: true, animationIn: 'fade', animationOut: 'fade', background: 'box', backgroundOpacity: 0.58, alignment: 'center', section: 'verse' }) };
    case 'section-chorus':
      return { transform: t(0.18), text: content({ text, font: 'Manrope Variable', size: Math.round(H * 0.085), weight: 800, color: '#ffffff', outlineColor: '#08090c', outlineWidth: 3, shadow: true, animationIn: 'pop', animationOut: 'fade', fillStyle: 'linear-gradient', gradientStartColor: '#fff2a6', gradientEndColor: '#ff78bc', glowColor: '#ff91d0', glowIntensity: 8, highlightColor: '#ffffff', highlightScale: 1.16, wordAnimation: 'highlight', alignment: 'center', section: 'chorus' }) };
    case 'section-climax':
      return { transform: t(0), text: content({ text: text.toUpperCase(), font: 'Manrope Variable', size: Math.round(H * 0.13), weight: 900, color: '#ffffff', outlineColor: '#08090c', outlineWidth: 5, shadow: true, animationIn: 'pop', animationOut: 'blur', fillStyle: 'linear-gradient', gradientStartColor: '#fff4bd', gradientEndColor: '#ff4b57', glowColor: '#ff503c', glowIntensity: 18, highlightColor: '#ffffff', highlightScale: 1.2, wordAnimation: 'pop', background: 'none', alignment: 'center', section: 'climax' }) };
    default:
      return { transform: t(0.38), text: content({ text, font: 'Manrope Variable', size: Math.round(H * 0.045), color: '#ffffff', outlineColor: '#000000', outlineWidth: 3, shadow: false, animationIn: null, animationOut: null }) };
  }
}

export function subtitleClip(
  project: Project,
  trackId: string,
  startUs: number,
  durUs: number,
  text: string,
  look: SubtitleLook,
  label: string | null = null,
  wordTimings: TextWordTiming[] = [],
): Clip {
  const l = lookText(look, project.settings.height, text);
  return {
    id: newId('clp'),
    trackId,
    assetId: null,
    timelineStartUs: Math.max(0, startUs),
    durationUs: Math.max(40_000, durUs),
    sourceInUs: 0,
    sourceOutUs: Math.max(40_000, durUs),
    speed: 1,
    reverse: false,
    transform: l.transform,
    blendMode: 'normal',
    mask: 'none',
    groupId: null,
    audio: { gainDb: 0, fadeInUs: 0, fadeOutUs: 0, pitchSemitones: 0, pitchMode: 'preserve', streamIndex: null },
    effects: [],
    transitionIn: null,
    keyframes: {},
    text: {
      ...l.text,
      textSource: 'original',
      manualText: null,
      translations: {},
      original: text,
      wordTimings,
      timingPrecision: wordTimings.length ? 'word' : 'segment',
    },
    origin: 'user',
    reason: null,
    confidence: null,
    label,
  };
}

export function textTracks(project: Project) {
  return project.tracks.filter((t) => t.kind === 'text');
}

/** Clipes de texto de uma trilha, em ordem de tempo. */
export function subtitleClips(project: Project, trackId: string): Clip[] {
  return project.clips.filter((c) => c.trackId === trackId && c.text).sort((a, b) => a.timelineStartUs - b.timelineStartUs);
}

/** Limpa cues: ordena, tira vazias, corta sobreposição (legenda seguinte vence). */
export function normalizeCues(cues: Cue[]): Cue[] {
  const out = cues
    .filter((c) => c.text.trim() && Number.isFinite(c.startS) && Number.isFinite(c.endS) && c.endS > c.startS)
    .map((c) => ({ ...c, text: c.text.replace(/\r/g, '').trim() }))
    .sort((a, b) => a.startS - b.startS);
  for (let i = 0; i + 1 < out.length; i++) if (out[i]!.endS > out[i + 1]!.startS) out[i]!.endS = out[i + 1]!.startS;
  return out.filter((c) => c.endS - c.startS >= 0.04);
}

export interface PlaceOptions {
  trackId: string;
  /** Onde o tempo 0 da legenda cai na timeline. */
  offsetUs: number;
  look: SubtitleLook;
  /** Só entra o que estiver dentro deste trecho da timeline. */
  windowUs?: [number, number];
  label?: string;
}

/** Coloca legendas na trilha (substituindo o que já estava naquele trecho). */
export function placeCues(project: Project, cues: Cue[], opts: PlaceOptions): Command[] {
  const items = normalizeCues(cues)
    .map((c) => ({ a: opts.offsetUs + us(c.startS), b: opts.offsetUs + us(c.endS), text: c.text, words: c.words }))
    .map((c) => (opts.windowUs ? { ...c, a: Math.max(c.a, opts.windowUs[0]), b: Math.min(c.b, opts.windowUs[1]) } : c))
    .filter((c) => c.b - c.a >= 40_000 && c.b > 0);
  if (!items.length) return [];
  const from = Math.max(0, Math.min(...items.map((c) => c.a)));
  const to = Math.max(...items.map((c) => c.b));
  return [
    ...clearTimelineRange(project, opts.trackId, from, to),
    ...items.map((c) => {
      const clipStartUs = Math.max(0, c.a);
      const clipEnd = c.b;
      const wordTimings = (c.words ?? []).flatMap((word) => {
        const startUs = Math.max(clipStartUs, opts.offsetUs + us(word.startS));
        const endUs = Math.min(clipEnd, opts.offsetUs + us(word.endS));
        if (endUs <= startUs) return [];
        return [{
          text: word.text,
          startUs: startUs - clipStartUs,
          endUs: endUs - clipStartUs,
          source: word.source,
          confidence: word.confidence ?? null,
          uncertain: word.uncertain ?? (word.confidence != null && word.confidence < 0.78),
          syllables: (word.syllables ?? []).flatMap((syllable) => {
            const syllableStartUs = Math.max(clipStartUs, opts.offsetUs + us(syllable.startS));
            const syllableEndUs = Math.min(clipEnd, opts.offsetUs + us(syllable.endS));
            if (syllableEndUs <= syllableStartUs) return [];
            return [{
              text: syllable.text,
              startUs: syllableStartUs - clipStartUs,
              endUs: syllableEndUs - clipStartUs,
              source: syllable.source,
              confidence: syllable.confidence,
              uncertain: false,
            }];
          }),
        }];
      });
      return {
        type: 'clip.add' as const,
        clip: subtitleClip(project, opts.trackId, clipStartUs, clipEnd - clipStartUs, c.text, opts.look, opts.label ?? null, wordTimings),
      };
    }),
  ];
}

/**
 * As falas certas para um clipe de episódio: pega as legendas do trecho de origem
 * do clipe e coloca exatamente onde ele está na timeline (considera a velocidade).
 */
export function cuesForClip(clip: Clip, episodeCues: Cue[]): Cue[] {
  const srcA = Math.min(clip.sourceInUs, clip.sourceOutUs) / S;
  const srcB = Math.max(clip.sourceInUs, clip.sourceOutUs) / S;
  const t0 = clip.timelineStartUs / S;
  const out: Cue[] = [];
  for (const c of episodeCues) {
    if (c.endS <= srcA || c.startS >= srcB) continue;
    const a = Math.max(c.startS, srcA);
    const b = Math.min(c.endS, srcB);
    const localA = timelineLocalAtSource(clip, a * S);
    const localB = timelineLocalAtSource(clip, b * S);
    if (localA === null || localB === null || localA === localB) continue;
    const words = c.words?.flatMap((word) => {
      const wordStart = Math.max(word.startS, a);
      const wordEnd = Math.min(word.endS, b);
      if (wordEnd <= wordStart) return [];
      const localStart = timelineLocalAtSource(clip, wordStart * S);
      const localEnd = timelineLocalAtSource(clip, wordEnd * S);
      if (localStart === null || localEnd === null || localStart === localEnd) return [];
      return [{
        ...word,
        startS: t0 + Math.min(localStart, localEnd) / S,
        endS: t0 + Math.max(localStart, localEnd) / S,
      }];
    });
    out.push({
      startS: t0 + Math.min(localA, localB) / S,
      endS: t0 + Math.max(localA, localB) / S,
      text: c.text,
      ...(words?.length ? { words } : {}),
    });
  }
  return out;
}

/** Puxa as legendas embutidas dos clipes escolhidos para a trilha de legendas. */
export function pullClipSubtitles(project: Project, clips: Clip[], cuesByAsset: Map<string, Cue[]>, trackId: string, look: SubtitleLook = 'legenda'): { commands: Command[]; count: number } {
  const all: Cue[] = [];
  for (const c of clips) {
    if (!c.assetId) continue;
    all.push(...cuesForClip(c, cuesByAsset.get(c.assetId) ?? []));
  }
  if (!all.length) return { commands: [], count: 0 };
  const commands: Command[] = [];
  let p = project;
  // cada clipe substitui só o próprio trecho
  for (const c of clips) {
    const cues = c.assetId ? cuesForClip(c, cuesByAsset.get(c.assetId) ?? []) : [];
    if (!cues.length) continue;
    const cmds = placeCues(p, cues, { trackId, offsetUs: 0, look, windowUs: [c.timelineStartUs, clipEndUs(c)], label: 'Fala do episódio' });
    commands.push(...cmds);
    p = applyAll(p, cmds);
  }
  return { commands, count: all.length };
}

function applyAll(p: Project, cmds: Command[]): Project {
  return applyCommand(p, { type: 'batch', commands: cmds }).project;
}

/** Desloca legendas no tempo (corrige atraso). Não deixa passar do zero. */
export function shiftSubtitles(project: Project, clipIds: string[], deltaUs: number): Command[] {
  const clips = project.clips.filter((c) => clipIds.includes(c.id));
  if (!clips.length) return [];
  const minStart = Math.min(...clips.map((c) => c.timelineStartUs));
  const d = Math.max(-minStart, deltaUs);
  // ordem evita sobreposição temporária
  const ordered = clips.sort((a, b) => (d > 0 ? b.timelineStartUs - a.timelineStartUs : a.timelineStartUs - b.timelineStartUs));
  return ordered.map((c) => ({ type: 'clip.update' as const, clipId: c.id, patch: { timelineStartUs: c.timelineStartUs + d } }));
}

/** Mesmo visual para várias legendas (mantém o texto de cada uma). */
export function restyleSubtitles(project: Project, clipIds: string[], look: SubtitleLook): Command[] {
  const H = project.settings.height;
  return project.clips
    .filter((c) => clipIds.includes(c.id) && c.text)
    .map((c) => {
      const raw = look === 'palavra' || look === 'section-climax' ? c.text!.text.toUpperCase() : c.text!.text;
      const l = lookText(look, H, raw);
      return {
        type: 'clip.update' as const,
        clipId: c.id,
        patch: {
          transform: l.transform,
          text: {
            ...l.text,
            text: raw,
            original: c.text!.original,
            lang: c.text!.lang,
            textSource: c.text!.textSource,
            manualText: c.text!.manualText,
            translations: c.text!.translations,
            wordTimings: c.text!.wordTimings,
            timingPrecision: c.text!.timingPrecision,
          },
        },
      };
    });
}

/** Trilha → legendas (tempo da timeline), para exportar SRT/LRC. */
export function trackCues(project: Project, trackId: string): Cue[] {
  return subtitleClips(project, trackId).map((c) => ({ startS: c.timelineStartUs / S, endS: clipEndUs(c) / S, text: c.text!.text }));
}

function lrcTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(2).padStart(5, '0')}`;
}

export function toLrc(cues: Cue[]): string {
  return cues.map((c) => `[${lrcTime(c.startS)}]${c.text.replace(/\n/g, ' ')}`).join('\n') + '\n';
}

export function toVtt(cues: Cue[]): string {
  const t = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s - h * 3600 - m * 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${r.toFixed(3).padStart(6, '0')}`;
  };
  return 'WEBVTT\n\n' + cues.map((c) => `${t(c.startS)} --> ${t(c.endS)}\n${c.text}\n`).join('\n');
}

/** Avisos de leitura: muito rápido para ler, muito comprido. */
export function readability(text: string, durS: number): string | null {
  const chars = text.replace(/\s+/g, ' ').trim().length;
  if (durS > 0 && chars / durS > 20) return `rápido demais para ler (${Math.round(chars / durS)} caracteres/s)`;
  if (text.split('\n').some((l) => l.length > 48)) return 'linha comprida: quebre em duas';
  return null;
}

// ---------------------------------------------------------------- idioma / tradução

export const SUBTITLE_LANGS: { code: string; label: string }[] = [
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'en', label: 'Inglês' },
  { code: 'es', label: 'Espanhol' },
  { code: 'ja', label: 'Japonês' },
  { code: 'fr', label: 'Francês' },
  { code: 'de', label: 'Alemão' },
  { code: 'it', label: 'Italiano' },
  { code: 'ko', label: 'Coreano' },
  { code: 'zh', label: 'Chinês' },
];

export const langLabel = (code: string) => SUBTITLE_LANGS.find((l) => l.code === code)?.label ?? code;

/** Texto original de uma legenda (antes de qualquer tradução). */
export const originalText = (c: Clip) => c.text?.original ?? c.text?.text ?? '';

export type SubtitleTextVariant =
  | { type: 'original' }
  | { type: 'translation'; lang: string }
  | { type: 'manual' };

export function editSubtitleTextManually(
  current: NonNullable<Clip['text']>,
  text: string,
): NonNullable<Clip['text']> {
  return {
    ...current,
    text,
    textSource: 'manual',
    manualText: text,
    original: current.original ?? current.text,
    lang: undefined,
    wordTimings: [],
    timingPrecision: 'segment',
  };
}

export function selectSubtitleTextVariant(
  current: NonNullable<Clip['text']>,
  variant: SubtitleTextVariant,
): NonNullable<Clip['text']> {
  if (variant.type === 'original' && current.original !== undefined) {
    return { ...current, text: current.original, textSource: 'original', lang: undefined, wordTimings: [], timingPrecision: 'segment' };
  }
  if (variant.type === 'translation' && current.translations[variant.lang] !== undefined) {
    return { ...current, text: current.translations[variant.lang]!, textSource: 'translation', lang: variant.lang, wordTimings: [], timingPrecision: 'segment' };
  }
  if (variant.type === 'manual' && current.manualText !== null) {
    return { ...current, text: current.manualText, textSource: 'manual', lang: undefined, wordTimings: [], timingPrecision: 'segment' };
  }
  return current;
}

/**
 * Troca o texto das legendas pelas traduções (mesma ordem de `clips`; null = mantém).
 * O original fica guardado no próprio clipe: dá para voltar ou traduzir para outro idioma
 * a partir dele (sem traduzir uma tradução). Um desfazer só.
 */
export function applyTranslation(clips: Clip[], translations: (string | null)[], lang: string): Command[] {
  const cmds: Command[] = [];
  clips.forEach((c, i) => {
    const t = translations[i];
    if (!c.text || t === null || t === undefined || !t.trim()) return;
    cmds.push({
      type: 'clip.update',
      clipId: c.id,
      patch: {
        text: {
          ...c.text,
          text: t,
          textSource: 'translation',
          translations: { ...c.text.translations, [lang]: t },
          original: c.text.original ?? c.text.text,
          lang,
          wordTimings: [],
          timingPrecision: 'segment',
        },
      },
    });
  });
  return cmds;
}

/** Volta as legendas traduzidas ao texto original. */
export function restoreOriginals(clips: Clip[]): Command[] {
  return clips
    .filter((c) => c.text?.original !== undefined && c.text.textSource !== 'original')
    .map((c) => ({
      type: 'clip.update' as const,
      clipId: c.id,
      patch: {
        text: {
          ...c.text!,
          text: c.text!.original!,
          textSource: 'original' as const,
          lang: undefined,
          wordTimings: [],
          timingPrecision: 'segment' as const,
        },
      },
    }));
}
