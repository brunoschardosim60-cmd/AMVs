import type { Cue } from '@amv/analysis';
import { applyCommand, clipEndUs, newId, type Clip, type Command, type Project } from '@amv/project';

/**
 * Legendas na timeline: são clipes de texto comuns na trilha de texto.
 * Aqui ficam as operações puras (importar, puxar do episódio, ajustar tempo,
 * estilo para todas, exportar). Tudo devolve Commands — um desfazer por ação.
 */

const S = 1_000_000;
const us = (s: number) => Math.round(s * S);

export type SubtitleLook = 'legenda' | 'destaque' | 'palavra' | 'karaoke';

export const LOOKS: { id: SubtitleLook; label: string; description: string }[] = [
  { id: 'legenda', label: 'Legenda', description: 'Embaixo, contorno preto, discreta.' },
  { id: 'destaque', label: 'Destaque', description: 'No meio, grande, com sombra. Para frases de impacto.' },
  { id: 'palavra', label: 'Palavra', description: 'Maiúsculas enormes, entra com pulo. Estilo letra na tela.' },
  { id: 'karaoke', label: 'Letra', description: 'Embaixo, maior, amarelo claro. Para letra da música.' },
];

export interface UntimedLyricAlignment {
  cues: Cue[];
  matched: number;
  uncertain: number;
  unmatched: number;
}

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
    const first = transcriptWords[spoken[best.start]!.wordIndex]!;
    const last = transcriptWords[spoken[best.end - 1]!.wordIndex]!;
    if (!Number.isFinite(first.start) || !Number.isFinite(last.end) || last.end <= first.start) continue;
    cues.push({ startS: Math.max(0, first.start), endS: Math.max(first.start, last.end), text: line });
    matched++;
    if (best.score < 0.78) uncertain++;
    cursor = best.end;
  }

  return { cues, matched, uncertain, unmatched: lines.length - matched };
}

export function lookText(look: SubtitleLook, H: number, text: string): { transform: Clip['transform']; text: NonNullable<Clip['text']> } {
  const t = (y: number) => ({ x: 0, y: Math.round(H * y), scale: 1, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } });
  switch (look) {
    case 'destaque':
      return { transform: t(0), text: { text, font: 'Manrope Variable', size: Math.round(H * 0.075), color: '#ffffff', outlineColor: '#000000', outlineWidth: 4, shadow: true, animationIn: 'pop', animationOut: 'fade' } };
    case 'palavra':
      return { transform: t(0), text: { text: text.toUpperCase(), font: 'Georgia', size: Math.round(H * 0.12), color: '#ffffff', outlineColor: '#000000', outlineWidth: 2, shadow: true, animationIn: 'pop', animationOut: null } };
    case 'karaoke':
      return { transform: t(0.34), text: { text, font: 'Manrope Variable', size: Math.round(H * 0.055), color: '#fff3b0', outlineColor: '#000000', outlineWidth: 4, shadow: true, animationIn: 'fade', animationOut: 'fade' } };
    default:
      return { transform: t(0.38), text: { text, font: 'Manrope Variable', size: Math.round(H * 0.045), color: '#ffffff', outlineColor: '#000000', outlineWidth: 3, shadow: false, animationIn: null, animationOut: null } };
  }
}

export function subtitleClip(project: Project, trackId: string, startUs: number, durUs: number, text: string, look: SubtitleLook, label: string | null = null): Clip {
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
    transform: l.transform,
    audio: { gainDb: 0, fadeInUs: 0, fadeOutUs: 0, pitchSemitones: 0, streamIndex: null },
    effects: [],
    transitionIn: null,
    keyframes: {},
    text: l.text,
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

/** Remove (e encurta) clipes da trilha que caem no intervalo. */
function clearRange(project: Project, trackId: string, fromUs: number, toUs: number): Command[] {
  const cmds: Command[] = [];
  for (const c of project.clips) {
    if (c.trackId !== trackId) continue;
    const a = c.timelineStartUs;
    const b = clipEndUs(c);
    if (b <= fromUs || a >= toUs) continue;
    if (a >= fromUs && b <= toUs) cmds.push({ type: 'clip.remove', clipId: c.id });
    else if (a < fromUs) cmds.push({ type: 'clip.update', clipId: c.id, patch: { durationUs: fromUs - a, sourceOutUs: c.sourceInUs + (fromUs - a) } });
    else cmds.push({ type: 'clip.update', clipId: c.id, patch: { timelineStartUs: toUs, durationUs: b - toUs, sourceOutUs: c.sourceInUs + (b - toUs) } });
  }
  return cmds;
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
    .map((c) => ({ a: opts.offsetUs + us(c.startS), b: opts.offsetUs + us(c.endS), text: c.text }))
    .map((c) => (opts.windowUs ? { ...c, a: Math.max(c.a, opts.windowUs[0]), b: Math.min(c.b, opts.windowUs[1]) } : c))
    .filter((c) => c.b - c.a >= 40_000 && c.b > 0);
  if (!items.length) return [];
  const from = Math.max(0, Math.min(...items.map((c) => c.a)));
  const to = Math.max(...items.map((c) => c.b));
  return [
    ...clearRange(project, opts.trackId, from, to),
    ...items.map((c) => ({ type: 'clip.add' as const, clip: subtitleClip(project, opts.trackId, c.a, c.b - Math.max(0, c.a), c.text, opts.look, opts.label ?? null) })),
  ];
}

/**
 * As falas certas para um clipe de episódio: pega as legendas do trecho de origem
 * do clipe e coloca exatamente onde ele está na timeline (considera a velocidade).
 */
export function cuesForClip(clip: Clip, episodeCues: Cue[]): Cue[] {
  const srcA = clip.sourceInUs / S;
  const srcB = clip.sourceOutUs / S;
  const t0 = clip.timelineStartUs / S;
  const out: Cue[] = [];
  for (const c of episodeCues) {
    if (c.endS <= srcA || c.startS >= srcB) continue;
    const a = Math.max(c.startS, srcA);
    const b = Math.min(c.endS, srcB);
    out.push({ startS: t0 + (a - srcA) / clip.speed, endS: t0 + (b - srcA) / clip.speed, text: c.text });
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
      const raw = look === 'palavra' ? c.text!.text.toUpperCase() : c.text!.text;
      const l = lookText(look, H, raw);
      return { type: 'clip.update' as const, clipId: c.id, patch: { transform: l.transform, text: l.text } };
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
    cmds.push({ type: 'clip.update', clipId: c.id, patch: { text: { ...c.text, text: t, original: c.text.original ?? c.text.text, lang } } });
  });
  return cmds;
}

/** Volta as legendas traduzidas ao texto original. */
export function restoreOriginals(clips: Clip[]): Command[] {
  return clips
    .filter((c) => c.text?.original !== undefined)
    .map((c) => {
      const { original, lang: _lang, ...rest } = c.text!;
      return { type: 'clip.update' as const, clipId: c.id, patch: { text: { ...rest, text: original! } } };
    });
}
