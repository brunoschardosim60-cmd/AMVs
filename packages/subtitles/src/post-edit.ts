import { clipEndUs, newId, TrackSchema, type Clip, type Command, type Project, type TextWordTiming } from '@amv/project';
import { editSubtitleTextManually, subtitleClip, subtitleClips, type SubtitleLook } from './index.js';

export interface SubtitleStyleBatchPatch {
  font?: string;
  sizeDelta?: number;
  size?: number;
  color?: string;
  outlineColor?: string;
  outlineWidth?: number;
  glowColor?: string;
  glowIntensity?: number;
  italic?: boolean;
  behindCutout?: boolean;
  zone?: 'top' | 'center' | 'bottom';
  blendMode?: Clip['blendMode'];
  caseMode?: 'upper' | 'lower' | 'sentence';
}

function splitWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function zoneOffsetY(height: number, zone: 'top' | 'center' | 'bottom'): number {
  if (zone === 'top') return -Math.round(height * 0.34);
  if (zone === 'bottom') return Math.round(height * 0.34);
  return 0;
}

function buildProportionalWordTimings(text: string, durationUs: number): TextWordTiming[] {
  const words = splitWords(text);
  if (words.length === 0 || durationUs < words.length * 10_000) return [];
  const weights = words.map((w) => Math.max(1, Array.from(w).length));
  const totalW = weights.reduce((a, b) => a + b, 0);
  let cursor = 0;
  return words.map((word, idx) => {
    const share = Math.round((weights[idx]! / totalW) * durationUs);
    const startUs = cursor;
    const maxEndForIdx = durationUs - (words.length - 1 - idx) * 5_000;
    const endUs = idx === words.length - 1
      ? durationUs
      : Math.max(startUs + 5_000, Math.min(maxEndForIdx, startUs + share));
    cursor = endUs;
    return {
      text: word,
      startUs,
      endUs,
      source: 'manual',
      confidence: 1,
      uncertain: false,
      syllables: [],
    };
  });
}

function applyCaseMode(text: string, mode: 'upper' | 'lower' | 'sentence'): string {
  if (mode === 'upper') return text.toLocaleUpperCase('pt-BR');
  if (mode === 'lower') return text.toLocaleLowerCase('pt-BR');
  const lower = text.toLocaleLowerCase('pt-BR');
  return lower.replace(/(^\s*\p{L}|[.!?]\s+\p{L})/gu, (m) => m.toLocaleUpperCase('pt-BR'));
}

/** Formata clipes de legenda (1 por linha) para o editor em lote de letra inteira. */
export function formatSubtitlesForBulkEdit(clips: Clip[]): string {
  return [...clips]
    .filter((c) => Boolean(c.text))
    .sort((a, b) => a.timelineStartUs - b.timelineStartUs)
    .map((c) => c.text!.text.replace(/\r/g, '').replace(/\n/g, ' / '))
    .join('\n');
}

function cleanBulkInputLine(raw: string): string {
  // Aceita opcionalmente prefixos LRC [00:12.34] colados pelo usuário
  return raw
    .replace(/^\s*\[(\d{1,2}:\d{2}(?:[.:]\d{1,3})?)\]\s*/, '')
    .replace(/\s+\/\s+/g, '\n')
    .trim();
}

/**
 * Substitui ou edita em lote as letras/legendas de uma trilha a partir de um bloco de texto
 * (1 linha por clipe), preservando os tempos, cores e animações existentes.
 */
export function replaceSubtitlesTextBulk(
  project: Project,
  trackId: string,
  rawLinesText: string,
  clipIds?: string[],
): { commands: Command[]; updated: number; added: number; removed: number } {
  const allOnTrack = subtitleClips(project, trackId);
  const targets = clipIds?.length
    ? allOnTrack.filter((c) => clipIds.includes(c.id))
    : allOnTrack;
  const lines = rawLinesText
    .replace(/\r/g, '')
    .split('\n')
    .map(cleanBulkInputLine)
    .filter(Boolean);

  if (lines.length === 0) return { commands: [], updated: 0, added: 0, removed: 0 };

  const commands: Command[] = [];
  let updated = 0;
  let added = 0;
  let removed = 0;

  const commonCount = Math.min(lines.length, targets.length);
  for (let i = 0; i < commonCount; i++) {
    const clip = targets[i]!;
    const line = lines[i]!;
    if (!clip.text || clip.text.text === line) continue;
    const edited = editSubtitleTextManually(clip.text, line);
    const keepWords = clip.text.wordTimings.length > 0 || clip.text.timingPrecision === 'word';
    const nextWords = keepWords ? buildProportionalWordTimings(line, clip.durationUs) : [];
    commands.push({
      type: 'clip.update',
      clipId: clip.id,
      patch: {
        text: {
          ...edited,
          wordTimings: nextWords,
          timingPrecision: nextWords.length ? 'word' : 'manual',
        },
      },
    });
    updated++;
  }

  if (lines.length < targets.length) {
    for (let i = lines.length; i < targets.length; i++) {
      commands.push({ type: 'clip.remove', clipId: targets[i]!.id });
      removed++;
    }
  } else if (lines.length > targets.length) {
    const template = targets.at(-1) ?? allOnTrack.at(-1);
    let cursorUs = template ? clipEndUs(template) + 60_000 : 0;
    const defaultDurUs = 1_800_000;
    for (let i = targets.length; i < lines.length; i++) {
      const line = lines[i]!;
      const base = subtitleClip(project, trackId, cursorUs, defaultDurUs, line, 'lyrics-cinematic');
      const created: Clip = template?.text
        ? {
            ...base,
            blendMode: template.blendMode,
            transform: { ...template.transform },
            text: {
              ...template.text,
              text: line,
              original: line,
              manualText: line,
              textSource: 'manual',
              translations: {},
              wordTimings: buildProportionalWordTimings(line, defaultDurUs),
              timingPrecision: 'manual',
            },
          }
        : base;
      commands.push({ type: 'clip.add', clip: created });
      cursorUs += defaultDurUs + 60_000;
      added++;
    }
  }

  return { commands, updated, added, removed };
}

/**
 * Explode frases selecionadas em clipes individuais palavra a palavra (Kinetic Typography),
 * alinhando cortes internos às batidas próximas quando disponíveis.
 */
export function explodeSubtitlesToWords(
  project: Project,
  clipIds: string[],
  opts?: { maxWordsPerChunk?: number; beatsS?: number[] },
): { commands: Command[]; createdCount: number } {
  const targets = project.clips
    .filter((c) => clipIds.includes(c.id) && Boolean(c.text))
    .sort((a, b) => a.timelineStartUs - b.timelineStartUs);
  const commands: Command[] = [];
  let createdCount = 0;
  const beatsUs = (opts?.beatsS ?? []).filter(Number.isFinite).map((s) => Math.round(s * 1_000_000));

  for (const clip of targets) {
    const t = clip.text!;
    const words = splitWords(t.text);
    if (words.length < 2 || clip.durationUs < 160_000) continue;
    const chunkSize = opts?.maxWordsPerChunk ?? (words.length <= 5 && clip.durationUs >= words.length * 140_000 ? 1 : 2);
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += chunkSize) {
      chunks.push(words.slice(i, i + chunkSize).join(' '));
    }
    if (chunks.length < 2) continue;

    const boundariesUs: number[] = [clip.timelineStartUs];
    if (t.wordTimings.length === words.length && chunkSize === 1) {
      for (let i = 1; i < words.length; i++) {
        boundariesUs.push(clip.timelineStartUs + t.wordTimings[i]!.startUs);
      }
    } else {
      const weights = chunks.map((ch) => Math.max(2, Array.from(ch).length + 1));
      const total = weights.reduce((a, b) => a + b, 0);
      let acc = 0;
      for (let i = 0; i < chunks.length - 1; i++) {
        acc += weights[i]!;
        boundariesUs.push(clip.timelineStartUs + Math.round((acc / total) * clip.durationUs));
      }
    }
    boundariesUs.push(clipEndUs(clip));

    for (let i = 1; i < boundariesUs.length - 1; i++) {
      const cur = boundariesUs[i]!;
      const nearBeat = beatsUs.find((b) => Math.abs(b - cur) <= 75_000);
      if (nearBeat !== undefined && nearBeat - boundariesUs[i - 1]! >= 90_000 && boundariesUs[i + 1]! - nearBeat >= 90_000) {
        boundariesUs[i] = nearBeat;
      }
    }

    commands.push({ type: 'clip.remove', clipId: clip.id });
    for (let i = 0; i < chunks.length; i++) {
      const startUs = boundariesUs[i]!;
      const durUs = boundariesUs[i + 1]! - startUs;
      if (durUs < 45_000) continue;
      const chunkText = chunks[i]!;
      commands.push({
        type: 'clip.add',
        clip: {
          ...clip,
          id: newId('clp'),
          timelineStartUs: startUs,
          durationUs: durUs,
          sourceInUs: 0,
          sourceOutUs: durUs,
          origin: 'user',
          text: {
            ...t,
            text: chunkText,
            original: chunkText,
            manualText: chunkText,
            textSource: 'manual',
            animationIn: t.animationIn ?? 'pop',
            animationInUs: Math.min(160_000, Math.round(durUs * 0.35)),
            animationOutUs: Math.min(110_000, Math.round(durUs * 0.25)),
            wordTimings: buildProportionalWordTimings(chunkText, durUs),
            timingPrecision: 'word',
          },
        },
      });
      createdCount++;
    }
  }

  return { commands, createdCount };
}

/** Junta 2 ou mais legendas selecionadas na mesma trilha em uma única frase contínua. */
export function mergeSubtitlesIntoPhrase(
  project: Project,
  clipIds: string[],
): { commands: Command[]; mergedClipId: string | null } {
  const selected = project.clips
    .filter((c) => clipIds.includes(c.id) && Boolean(c.text))
    .sort((a, b) => a.timelineStartUs - b.timelineStartUs);
  if (selected.length < 2) return { commands: [], mergedClipId: null };
  const trackId = selected[0]!.trackId;
  const sameTrack = selected.filter((c) => c.trackId === trackId);
  if (sameTrack.length < 2) return { commands: [], mergedClipId: null };

  const first = sameTrack[0]!;
  const startUs = first.timelineStartUs;
  const endUs = Math.max(...sameTrack.map((c) => clipEndUs(c)));
  const durUs = Math.max(80_000, endUs - startUs);
  const joinedText = sameTrack.map((c) => c.text!.text.trim()).filter(Boolean).join(' ');
  const wordTimings: TextWordTiming[] = [];
  for (const c of sameTrack) {
    const localStart = Math.max(0, c.timelineStartUs - startUs);
    const localEnd = Math.min(durUs, clipEndUs(c) - startUs);
    if (localEnd > localStart) {
      wordTimings.push({
        text: c.text!.text.trim(),
        startUs: localStart,
        endUs: localEnd,
        source: 'manual',
        confidence: 1,
        uncertain: false,
        syllables: [],
      });
    }
  }

  const mergedId = newId('clp');
  const commands: Command[] = [
    ...sameTrack.map((c) => ({ type: 'clip.remove' as const, clipId: c.id })),
    {
      type: 'clip.add',
      clip: {
        ...first,
        id: mergedId,
        timelineStartUs: startUs,
        durationUs: durUs,
        sourceInUs: 0,
        sourceOutUs: durUs,
        origin: 'user',
        text: {
          ...first.text!,
          text: joinedText,
          original: joinedText,
          manualText: joinedText,
          textSource: 'manual',
          wordTimings,
          timingPrecision: wordTimings.length ? 'word' : 'segment',
        },
      },
    },
  ];
  return { commands, mergedClipId: mergedId };
}

/** Divide uma legenda em duas no ponto da agulha (ou exatamente na metade se fora do clipe). */
export function splitSubtitleAt(
  project: Project,
  clipId: string,
  splitTimelineUs?: number,
): { commands: Command[]; createdClipIds: [string, string] | null } {
  const clip = project.clips.find((c) => c.id === clipId && Boolean(c.text));
  if (!clip || !clip.text || clip.durationUs < 160_000) return { commands: [], createdClipIds: null };
  const startUs = clip.timelineStartUs;
  const endUs = clipEndUs(clip);
  const validAt = splitTimelineUs !== undefined
    && splitTimelineUs >= startUs + 80_000
    && splitTimelineUs <= endUs - 80_000
    ? Math.round(splitTimelineUs)
    : Math.round((startUs + endUs) / 2);

  const words = splitWords(clip.text.text);
  const ratio = (validAt - startUs) / clip.durationUs;
  const splitIdx = words.length >= 2 ? Math.max(1, Math.min(words.length - 1, Math.round(words.length * ratio))) : 0;
  const leftText = words.length >= 2 ? words.slice(0, splitIdx).join(' ') : clip.text.text;
  const rightText = words.length >= 2 ? words.slice(splitIdx).join(' ') : clip.text.text;
  const durA = validAt - startUs;
  const durB = endUs - validAt;
  const idA = newId('clp');
  const idB = newId('clp');

  const mkPart = (id: string, tlStart: number, dur: number, txt: string): Clip => ({
    ...clip,
    id,
    timelineStartUs: tlStart,
    durationUs: dur,
    sourceInUs: 0,
    sourceOutUs: dur,
    origin: 'user',
    text: {
      ...clip.text!,
      text: txt,
      original: txt,
      manualText: txt,
      textSource: 'manual',
      wordTimings: buildProportionalWordTimings(txt, dur),
      timingPrecision: 'manual',
    },
  });

  return {
    commands: [
      { type: 'clip.remove', clipId: clip.id },
      { type: 'clip.add', clip: mkPart(idA, startUs, durA, leftText) },
      { type: 'clip.add', clip: mkPart(idB, validAt, durB, rightText) },
    ],
    createdClipIds: [idA, idB],
  };
}

/** Converte caixa (MAIÚSCULAS / minúsculas / Frase) preservando timings por palavra. */
export function transformSubtitlesCase(
  project: Project,
  clipIds: string[],
  mode: 'upper' | 'lower' | 'sentence',
): Command[] {
  const cmds: Command[] = [];
  for (const clip of project.clips) {
    if (!clipIds.includes(clip.id) || !clip.text) continue;
    const nextText = applyCaseMode(clip.text.text, mode);
    if (nextText === clip.text.text) continue;
    const nextWords = clip.text.wordTimings.map((w) => ({
      ...w,
      text: applyCaseMode(w.text, mode),
    }));
    cmds.push({
      type: 'clip.update',
      clipId: clip.id,
      patch: {
        text: {
          ...clip.text,
          text: nextText,
          manualText: nextText,
          textSource: 'manual',
          wordTimings: nextWords,
        },
      },
    });
  }
  return cmds;
}

/** Atualiza propriedades visuais em lote (fonte, tamanho, cor, posição, atrás do personagem) sem resetar o resto. */
export function patchSubtitlesStyle(
  project: Project,
  clipIds: string[],
  patch: SubtitleStyleBatchPatch,
): Command[] {
  const H = project.settings.height || 1080;
  const cmds: Command[] = [];
  for (const clip of project.clips) {
    if (!clipIds.includes(clip.id) || !clip.text) continue;
    const t = clip.text;
    const nextSize = patch.size !== undefined
      ? Math.max(12, Math.min(380, Math.round(patch.size)))
      : patch.sizeDelta !== undefined
        ? Math.max(12, Math.min(380, Math.round(t.size + patch.sizeDelta)))
        : t.size;
    const nextTransform = patch.zone !== undefined
      ? { ...clip.transform, y: zoneOffsetY(H, patch.zone) }
      : clip.transform;
    const nextTextVal = patch.caseMode ? applyCaseMode(t.text, patch.caseMode) : t.text;
    const nextWords = patch.caseMode
      ? t.wordTimings.map((w) => ({ ...w, text: applyCaseMode(w.text, patch.caseMode!) }))
      : t.wordTimings;
    cmds.push({
      type: 'clip.update',
      clipId: clip.id,
      patch: {
        ...(patch.zone !== undefined ? { transform: nextTransform } : {}),
        ...(patch.blendMode !== undefined ? { blendMode: patch.blendMode } : {}),
        text: {
          ...t,
          ...(patch.caseMode ? { text: nextTextVal, manualText: nextTextVal, textSource: 'manual' as const, wordTimings: nextWords } : {}),
          ...(patch.font !== undefined ? { font: patch.font } : {}),
          size: nextSize,
          ...(patch.color !== undefined ? { color: patch.color } : {}),
          ...(patch.outlineColor !== undefined ? { outlineColor: patch.outlineColor } : {}),
          ...(patch.outlineWidth !== undefined ? { outlineWidth: patch.outlineWidth } : {}),
          ...(patch.glowColor !== undefined ? { glowColor: patch.glowColor } : {}),
          ...(patch.glowIntensity !== undefined ? { glowIntensity: patch.glowIntensity } : {}),
          ...(patch.italic !== undefined ? { italic: patch.italic } : {}),
          ...(patch.behindCutout !== undefined ? { behindCutout: patch.behindCutout } : {}),
        },
      },
    });
  }
  return cmds;
}

/** Copia o estilo visual exato de uma legenda para outras legendas (mantendo o texto de cada uma). */
export function copyClipStyleToSubtitles(
  project: Project,
  sourceClipId: string,
  targetClipIds: string[],
): Command[] {
  const src = project.clips.find((c) => c.id === sourceClipId && Boolean(c.text));
  if (!src || !src.text) return [];
  const st = src.text;
  const cmds: Command[] = [];
  for (const clip of project.clips) {
    if (clip.id === src.id || !targetClipIds.includes(clip.id) || !clip.text) continue;
    cmds.push({
      type: 'clip.update',
      clipId: clip.id,
      patch: {
        blendMode: src.blendMode,
        transform: { ...clip.transform, y: src.transform.y, rotation: src.transform.rotation },
        text: {
          ...st,
          text: clip.text.text,
          original: clip.text.original,
          manualText: clip.text.manualText,
          textSource: clip.text.textSource,
          translations: clip.text.translations,
          lang: clip.text.lang,
          behindCutout: clip.text.behindCutout,
          wordTimings: clip.text.wordTimings,
          timingPrecision: clip.text.timingPrecision,
        },
      },
    });
  }
  return cmds;
}

function isDialogueSubtitleClip(clip: Clip): boolean {
  const why = `${clip.reason ?? ''} ${clip.label ?? ''}`.toLowerCase();
  if (/legenda da fala|fala do epis[oó]dio|di[aá]logo/.test(why)) return true;
  if (/letra da m[uú]sica|palavra da letra|vocais|\.lrc/.test(why)) return false;
  return Boolean(clip.text?.italic && clip.transform.y > 100);
}

/**
 * Separa em 1 clique as Letras da Música e as Legendas de Fala do anime em trilhas de texto
 * independentes para estilizar, ocultar ou bloquear cada camada separadamente.
 */
export function separateLyricsAndDialogueTracks(project: Project): {
  commands: Command[];
  movedCount: number;
  dialogueTrackId: string | null;
} {
  const textTrks = project.tracks.filter((t) => t.kind === 'text');
  if (textTrks.length === 0) return { commands: [], movedCount: 0, dialogueTrackId: null };

  const primaryTrack = textTrks[0]!;
  const allTextClips = subtitleClips(project, primaryTrack.id);
  const dialogueClips = allTextClips.filter(isDialogueSubtitleClip);
  const lyricClips = allTextClips.filter((c) => !isDialogueSubtitleClip(c));
  if (dialogueClips.length === 0 || lyricClips.length === 0) {
    return { commands: [], movedCount: 0, dialogueTrackId: null };
  }

  const commands: Command[] = [];
  let dialogueTrack = textTrks.find((t) => t.id !== primaryTrack.id && /fala|di[aá]logo/i.test(t.name));
  if (!dialogueTrack) {
    dialogueTrack = TrackSchema.parse({
      id: newId('trk'),
      kind: 'text',
      name: 'Falas do Anime',
    });
    const insertIdx = project.tracks.findIndex((t) => t.id === primaryTrack.id);
    commands.push({ type: 'track.add', track: dialogueTrack, index: Math.max(0, insertIdx + 1) });
  }
  if (primaryTrack.name === 'Legendas') {
    commands.push({ type: 'track.update', trackId: primaryTrack.id, patch: { name: 'Letras da Música' } });
  }
  for (const c of dialogueClips) {
    commands.push({ type: 'clip.update', clipId: c.id, patch: { trackId: dialogueTrack.id } });
  }
  return { commands, movedCount: dialogueClips.length, dialogueTrackId: dialogueTrack.id };
}

/** Insere uma nova legenda editável no cursor (ou logo no primeiro espaço livre da trilha). */
export function insertBlankSubtitleAt(
  project: Project,
  trackId: string,
  playheadUs: number,
  look: SubtitleLook = 'anime-impact',
  initialText = 'Novo texto',
): { commands: Command[]; clipId: string } {
  const existing = subtitleClips(project, trackId);
  let startUs = Math.max(0, Math.round(playheadUs));
  let durUs = 1_600_000;

  const blocking = existing.find((c) => startUs >= c.timelineStartUs && startUs < clipEndUs(c));
  if (blocking) {
    startUs = clipEndUs(blocking) + 20_000;
  }
  const nextAfter = existing.find((c) => c.timelineStartUs > startUs);
  if (nextAfter && nextAfter.timelineStartUs - startUs < durUs) {
    durUs = Math.max(120_000, nextAfter.timelineStartUs - startUs - 10_000);
  }
  const base = subtitleClip(project, trackId, startUs, durUs, initialText, look);
  const nearest = existing.find((c) => c.timelineStartUs <= startUs) ?? existing[0];
  const styled: Clip = nearest?.text
    ? {
        ...base,
        blendMode: nearest.blendMode,
        transform: { ...nearest.transform },
        text: {
          ...nearest.text,
          text: initialText,
          original: initialText,
          manualText: initialText,
          textSource: 'manual',
          translations: {},
          wordTimings: buildProportionalWordTimings(initialText, durUs),
          timingPrecision: 'manual',
        },
      }
    : base;

  return {
    commands: [{ type: 'clip.add', clip: styled }],
    clipId: styled.id,
  };
}
