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
  | 'anime-dialogue' | 'anime-impact' | 'anime-blend' | 'anime-katana' | 'anime-neon' | 'anime-manga' | 'anime-gold-epic'
  | 'section-intro' | 'section-verse' | 'section-chorus' | 'section-climax';

export const LOOKS: { id: SubtitleLook; label: string; description: string }[] = [
  { id: 'anime-blend', label: 'Anime · mesclado c/ vídeo', description: 'Inversão negativa/luz viva + vazado + Playfair itálico.' },
  { id: 'anime-impact', label: 'Anime · impacto brutal', description: 'Russo One + Hero em Permanent Marker, 3D e RGB split.' },
  { id: 'anime-katana', label: 'Anime · katana brush', description: 'Pincel Permanent Marker inclinado + faixa slash.' },
  { id: 'anime-neon', label: 'Anime · neon vazado', description: 'Teko 700 vazado + Hero em Bungee com luz ciano/magenta.' },
  { id: 'anime-gold-epic', label: 'Anime · ouro épico', description: 'Cinzel + Playfair itálico dourado 3D com reflexo sheen.' },
  { id: 'anime-manga', label: 'Anime · slash mangá', description: 'Black Ops One 3D em faixa katana diagonal.' },
  { id: 'lyrics-cinematic', label: 'Cinema editorial', description: 'Montserrat + Hero em Playfair Display itálico.' },
  { id: 'anime-dialogue', label: 'Fala do personagem', description: 'Itálico cinematográfico limpo na base, sem caixa pesada.' },
  { id: 'legenda', label: 'Legenda simples', description: 'Base discreta com contorno.' },
  { id: 'destaque', label: 'Destaque', description: 'Central grande com pop.' },
  { id: 'palavra', label: 'Palavra', description: 'Caixa alta gigante com pulo.' },
  { id: 'karaoke', label: 'Letra', description: 'Base amarela para música.' },
  { id: 'dialogue-dramatic', label: 'Diálogo dramático', description: 'Fala na base com destaque sutil.' },
  { id: 'impact-typography', label: 'Impact Typography', description: 'Anton gigante central.' },
  { id: 'section-intro', label: 'Intro', description: 'Cinzel espaçado cinematográfico.' },
  { id: 'section-verse', label: 'Verso', description: 'Discreto na base.' },
  { id: 'section-chorus', label: 'Refrão', description: 'Gradiente vibrante no refrão.' },
  { id: 'section-climax', label: 'Clímax', description: 'Russo One explosivo com RGB split e glow.' },
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

function tokenCost(a: string, b: string): number {
  if (a === b) return 0;
  // Tolerância leve para erros de 1–2 letras comuns ao transcrever voz cantada sobre música,
  // mantendo custo >= 0,45 para que casamentos aproximados sejam marcados como incertos.
  if (a.length >= 4 && b.length >= 4) {
    if (a.startsWith(b) || b.startsWith(a)) {
      const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
      if (ratio >= 0.72) return 0.45;
    }
    if (Math.abs(a.length - b.length) <= 2) {
      let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
      for (let i = 1; i <= a.length; i++) {
        const curr = [i];
        for (let j = 1; j <= b.length; j++) {
          curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = curr;
      }
      const dist = prev[b.length]!;
      const maxLen = Math.max(a.length, b.length);
      if (maxLen >= 5 && dist <= 2) return Math.max(0.45, dist / maxLen);
      if (dist === 1) return 0.68;
    }
  }
  return 1;
}

function editDistance(a: string[], b: string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + tokenCost(a[i - 1]!, b[j - 1]!),
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

function alignUntimedLyricsIndexed(
  lyrics: string,
  transcriptWords: { start: number; end: number; text: string }[],
): { cues: Cue[]; lineIndices: number[]; matched: number; uncertain: number; unmatched: number } {
  const lines = lyrics.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
  transcriptWords = transcriptWords
    .filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end) && word.start >= 0 && word.end > word.start && word.text.trim())
    .sort((a, b) => a.start - b.start);
  const script = `${lyrics} ${transcriptWords.map((word) => word.text).join(' ')}`;
  const characters = /[\u3040-\u30ff\u3400-\u9fff]/u.test(script);
  const spoken = transcriptWords.flatMap((word, wordIndex) =>
    lyricTokens(word.text, characters).map((token) => ({ token, wordIndex })),
  );
  let cursor = 0;
  let matched = 0;
  let uncertain = 0;
  const cues: Cue[] = [];
  const lineIndices: number[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
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
      .flatMap((wordIndex) => transcriptWords[wordIndex] ? [transcriptWords[wordIndex]] : []);
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
        confidence: best.score,
        uncertain: best.score < 0.78,
      })),
    });
    lineIndices.push(lineIdx);
    matched++;
    if (best.score < 0.78) uncertain++;
    const lastWordIndex = spoken[best.end - 1]?.wordIndex;
    cursor = best.end;
    // A transcribed word must never supply timestamps to two different lyric lines.
    while (lastWordIndex !== undefined && spoken[cursor]?.wordIndex === lastWordIndex) cursor++;
  }

  return { cues, lineIndices, matched, uncertain, unmatched: lines.length - matched };
}

/** Alinha linhas de letra a palavras transcritas localmente, em ordem e com score explícito. */
export function alignUntimedLyrics(
  lyrics: string,
  transcriptWords: { start: number; end: number; text: string }[],
): UntimedLyricAlignment {
  const { cues, matched, uncertain, unmatched } = alignUntimedLyricsIndexed(lyrics, transcriptWords);
  return { cues, matched, uncertain, unmatched };
}

function splitDisplayWords(text: string): string[] {
  const ws = text.trim().match(/\S+/gu) ?? [];
  if (ws.length > 1 || !/[\u3040-\u30ff\u3400-\u9fff]/u.test(text)) return ws;
  return Array.from(text.trim()).filter((ch) => !/\s/u.test(ch));
}

/**
 * Garante timings por palavra compatíveis com o texto exibido para que as tipografias
 * animadas (karaoke, realce palavra a palavra e estilo "letra") funcionem mesmo após tradução.
 */
export function promoteAlignedCuesForTypography(cues: Cue[]): Cue[] {
  return cues.map((cue) => {
    const tokens = splitDisplayWords(cue.text);
    const existing = (cue.words ?? []).filter(
      (word) => Number.isFinite(word.startS) && Number.isFinite(word.endS) && word.endS > word.startS,
    );
    // Aperta os limites da linha aos tempos reais das palavras cantadas (evita que o Whisper sem VAD
    // antecipe a legenda em 2–4s durante introduções instrumentais antes do vocal começar).
    const hasRealVocalWords = existing.length > 0 && existing.some((w) => w.source !== 'estimated');
    const firstWordStart = hasRealVocalWords ? existing[0]!.startS : cue.startS;
    const lastWordEnd = hasRealVocalWords ? existing[existing.length - 1]!.endS : cue.endS;
    const startS = Math.max(0, hasRealVocalWords && firstWordStart >= cue.startS && firstWordStart < cue.endS - 0.04 ? firstWordStart : cue.startS);
    const endS = Math.max(startS + 0.04, hasRealVocalWords && lastWordEnd > startS + 0.04 && lastWordEnd <= cue.endS + 0.05 ? lastWordEnd : cue.endS);
    if (!tokens.length) return { ...cue, startS, endS };

    if (existing.length === tokens.length) {
      const words: CueWord[] = tokens.map((token, idx) => {
        const w = existing[idx]!;
        const wStart = Math.max(startS, Math.min(endS - 0.01, w.startS));
        const wEnd = Math.max(wStart + 0.01, Math.min(endS, w.endS));
        return {
          startS: wStart,
          endS: wEnd,
          text: token,
          source: 'lrc',
          confidence: 0.95,
          uncertain: false,
        };
      });
      return { ...cue, startS, endS, words };
    }

    const weights = tokens.map((token) => Math.max(1, Array.from(token).length));
    const totalWeight = weights.reduce((acc, w) => acc + w, 0);

    // Quando há palavras vocais reais (ex.: música em inglês/japonês traduzida para PT-BR com outro número de palavras),
    // interpola ao longo dos intervalos vocais reais preservando pausas internas da voz cantada.
    if (existing.length >= 2) {
      const activeSpans = existing.map((w) => ({
        start: Math.max(startS, Math.min(endS, w.startS)),
        end: Math.max(startS, Math.min(endS, w.endS)),
      })).filter((s) => s.end - s.start > 0.005);
      const totalActive = activeSpans.reduce((acc, s) => acc + (s.end - s.start), 0);
      if (totalActive >= 0.04) {
        const vocalTimeAt = (frac: number): number => {
          let rem = Math.max(0, Math.min(1, frac)) * totalActive;
          for (const sp of activeSpans) {
            const d = sp.end - sp.start;
            if (rem <= d + 1e-9) return sp.start + rem;
            rem -= d;
          }
          return activeSpans[activeSpans.length - 1]!.end;
        };
        let accW = 0;
        const words: CueWord[] = tokens.map((token, idx) => {
          const f0 = accW / totalWeight;
          accW += weights[idx]!;
          const f1 = accW / totalWeight;
          const wStart = idx === 0 ? activeSpans[0]!.start : vocalTimeAt(f0);
          const wEnd = idx === tokens.length - 1 ? activeSpans[activeSpans.length - 1]!.end : Math.max(wStart + 0.02, vocalTimeAt(f1));
          return {
            startS: wStart,
            endS: Math.max(wStart + 0.02, wEnd),
            text: token,
            source: 'lrc',
            confidence: 0.95,
            uncertain: false,
          };
        });
        return { ...cue, startS, endS, words };
      }
    }

    const totalDur = endS - startS;
    let cursor = startS;
    const words: CueWord[] = tokens.map((token, idx) => {
      const share = (weights[idx]! / totalWeight) * totalDur;
      const wStart = cursor;
      const wEnd = idx === tokens.length - 1 ? endS : Math.min(endS, Math.max(wStart + 0.02, wStart + share));
      cursor = wEnd;
      return {
        startS: wStart,
        endS: wEnd,
        text: token,
        source: 'lrc',
        confidence: 0.95,
        uncertain: false,
      };
    });
    return { ...cue, startS, endS, words };
  });
}

function buildVocalSpans(
  transcriptWords: { start: number; end: number; text: string }[],
  transcriptSegments?: { start: number; end: number; text: string }[],
): { start: number; end: number; text?: string }[] {
  const words = transcriptWords
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .sort((a, b) => a.start - b.start);

  const segs = (transcriptSegments ?? [])
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start + 0.05)
    .sort((a, b) => a.start - b.start);

  if (segs.length) {
    return segs.flatMap((s) => {
      const segTokens = s.text.trim().split(/\s+/).filter(Boolean);
      const inSeg = words.filter((w) => w.start >= s.start - 0.05 && w.end <= s.end + 0.05);
      // Quando todas as palavras do segmento têm timestamp real, aperta início/fim para cortar silêncio instrumental pré-vocal
      if (inSeg.length > 0 && inSeg.length >= segTokens.length) {
        const subSpans: { start: number; end: number }[] = [];
        let curStart = Math.max(0, inSeg[0]!.start);
        let curEnd = inSeg[0]!.end;
        for (let i = 1; i < inSeg.length; i++) {
          if (inSeg[i]!.start - curEnd > 0.65) {
            subSpans.push({ start: curStart, end: curEnd });
            curStart = Math.max(0, inSeg[i]!.start);
          }
          curEnd = Math.max(curEnd, inSeg[i]!.end);
        }
        subSpans.push({ start: curStart, end: curEnd });
        return subSpans;
      }
      return [{ start: Math.max(0, s.start), end: s.end }];
    });
  }

  if (!words.length) return [];
  const spans: { start: number; end: number }[] = [];
  let curStart = Math.max(0, words[0]!.start);
  let curEnd = words[0]!.end;
  for (let i = 1; i < words.length; i++) {
    const w = words[i]!;
    if (w.start - curEnd > 0.8) {
      spans.push({ start: curStart, end: curEnd });
      curStart = Math.max(0, w.start);
    }
    curEnd = Math.max(curEnd, w.end);
  }
  spans.push({ start: curStart, end: curEnd });
  return spans;
}

function distributeLinesAcrossSpans(
  lines: string[],
  spans: { start: number; end: number }[],
  windowStart: number,
  windowEnd: number,
): Cue[] {
  if (!lines.length || windowEnd - windowStart < 0.08) return [];
  const activeSpans = spans
    .map((s) => ({ start: Math.max(windowStart, s.start), end: Math.min(windowEnd, s.end) }))
    .filter((s) => s.end - s.start >= 0.08);

  if (activeSpans.length >= lines.length && lines.length === 1) {
    return [{
      startS: activeSpans[0]!.start,
      endS: activeSpans[activeSpans.length - 1]!.end,
      text: lines[0]!,
    }];
  }

  if (activeSpans.length >= lines.length) {
    // Agrupa os segmentos vocais na mesma ordem para cada verso.
    const out: Cue[] = [];
    for (let i = 0; i < lines.length; i++) {
      const fromIdx = Math.floor((i * activeSpans.length) / lines.length);
      const toIdx = Math.max(fromIdx, Math.floor(((i + 1) * activeSpans.length) / lines.length) - 1);
      const s = activeSpans[fromIdx]!.start;
      const e = Math.max(s + 0.1, activeSpans[toIdx]!.end);
      out.push({ startS: s, endS: e, text: lines[i]! });
    }
    return out;
  }

  // Menos spans do que linhas: concatena o tempo vocal contínuo proporcionalmente ao texto.
  const sourceSpans = activeSpans.length ? activeSpans : [{ start: windowStart, end: windowEnd }];
  const weights = lines.map((line) => Math.max(1, Array.from(line).length));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const totalVocal = sourceSpans.reduce((a, s) => a + (s.end - s.start), 0);
  if (totalVocal < 0.08) return [];

  const vocalAt = (offset: number): number => {
    let rem = Math.max(0, Math.min(totalVocal, offset));
    for (const s of sourceSpans) {
      const len = s.end - s.start;
      if (rem <= len + 1e-9) return s.start + rem;
      rem -= len;
    }
    return sourceSpans[sourceSpans.length - 1]!.end;
  };

  let accWeight = 0;
  return lines.map((line, i) => {
    const startOffset = (accWeight / totalWeight) * totalVocal;
    accWeight += weights[i]!;
    const endOffset = (accWeight / totalWeight) * totalVocal;
    const startS = vocalAt(startOffset);
    const endS = Math.max(startS + 0.08, vocalAt(endOffset));
    return { startS, endS, text: line };
  });
}

/**
 * Alinha letras sem tempo suportando letra traduzida para o idioma da música e fallback
 * distribuído sobre os segmentos vocais detectados pelo Whisper.
 */
export function alignUntimedLyricsWithFallback(
  lyrics: string,
  transcriptWords: { start: number; end: number; text: string }[],
  transcriptSegments?: { start: number; end: number; text: string }[],
  translatedLyricsForMatching?: string,
): UntimedLyricAlignment {
  const origLines = lyrics.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (!origLines.length) return { cues: [], matched: 0, uncertain: 0, unmatched: 0 };

  let indexed = alignUntimedLyricsIndexed(lyrics, transcriptWords);

  if (translatedLyricsForMatching?.trim()) {
    const transLines = translatedLyricsForMatching.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
    const transIndexed = alignUntimedLyricsIndexed(translatedLyricsForMatching, transcriptWords);
    const useTranslated = transLines.length === origLines.length
      ? transIndexed.matched >= indexed.matched
      : transIndexed.matched > indexed.matched;
    if (useTranslated && transIndexed.matched > 0) {
      const remappedCues: Cue[] = [];
      const remappedIndices: number[] = [];
      transIndexed.cues.forEach((cue, idx) => {
        const lineIdx = transIndexed.lineIndices[idx]!;
        const mappedText = origLines[lineIdx];
        if (!mappedText) return;
        remappedCues.push({ ...cue, text: mappedText });
        remappedIndices.push(lineIdx);
      });
      indexed = {
        cues: remappedCues,
        lineIndices: remappedIndices,
        matched: remappedCues.length,
        uncertain: transIndexed.uncertain,
        unmatched: origLines.length - remappedCues.length,
      };
    }
  }

  const vocalSpans = buildVocalSpans(transcriptWords, transcriptSegments);
  if (indexed.matched >= origLines.length * 0.5 && indexed.cues.length > 0) {
    const cues = promoteAlignedCuesForTypography(indexed.cues);
    return {
      cues,
      matched: indexed.matched,
      uncertain: indexed.uncertain,
      unmatched: origLines.length - indexed.matched,
    };
  }

  if (!vocalSpans.length) {
    const cues = promoteAlignedCuesForTypography(indexed.cues);
    return {
      cues,
      matched: indexed.matched,
      uncertain: indexed.uncertain,
      unmatched: origLines.length - indexed.matched,
    };
  }

  const minVocal = vocalSpans[0]!.start;
  const maxVocal = vocalSpans[vocalSpans.length - 1]!.end;
  const finalCues: Cue[] = [];
  let fallbackCount = 0;

  // Ancoragem híbrida em ordem usando eventuais versos já casados + distribuição nos segmentos vocais.
  let prevLine = -1;
  let prevEnd = minVocal;
  const anchors = indexed.cues.map((cue, idx) => ({ lineIdx: indexed.lineIndices[idx]!, cue }));
  for (const anchor of [...anchors, { lineIdx: origLines.length, cue: null as Cue | null }]) {
    const gapLines = origLines.slice(prevLine + 1, anchor.lineIdx);
    const windowEnd = anchor.cue ? anchor.cue.startS : maxVocal;
    if (gapLines.length && windowEnd - prevEnd >= 0.08) {
      const distributed = distributeLinesAcrossSpans(gapLines, vocalSpans, prevEnd, windowEnd);
      for (const item of distributed) {
        finalCues.push(item);
        fallbackCount++;
      }
    }
    if (anchor.cue) {
      finalCues.push(anchor.cue);
      prevEnd = anchor.cue.endS;
    }
    prevLine = anchor.lineIdx;
  }

  const normalized = normalizeCues(finalCues);
  const cues = promoteAlignedCuesForTypography(normalized);
  return {
    cues,
    matched: cues.length,
    uncertain: indexed.uncertain + fallbackCount,
    unmatched: Math.max(0, origLines.length - cues.length),
  };
}

export function lookText(look: SubtitleLook, H: number, text: string): { transform: Clip['transform']; text: NonNullable<Clip['text']>; blendMode?: Clip['blendMode'] } {
  const t = (y: number, rotation = 0) => ({ x: 0, y: Math.round(H * y), scale: 1, rotation, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } });
  const content = (values: Partial<NonNullable<Clip['text']>> & { text: string }) => TextContentSchema.parse(values);
  switch (look) {
    case 'anime-blend':
      return {
        transform: t(0),
        blendMode: 'difference',
        text: content({
          text: text.toUpperCase(),
          font: 'Russo One',
          size: Math.round(H * 0.12),
          weight: 900,
          color: '#ffffff',
          outlineColor: '#000000',
          outlineWidth: 2,
          fillStyle: 'hollow',
          sheen: true,
          heroWord: true,
          heroFont: 'Playfair Display Variable',
          heroItalic: true,
          heroScale: 1.28,
          heroColor: '#ffffff',
          shadow: false,
          animationIn: 'pop',
          animationOut: 'blur',
          animationInUs: 160_000,
          animationOutUs: 140_000,
          highlightColor: '#ffffff',
          highlightScale: 1.2,
          glowColor: '#ffffff',
          glowIntensity: 10,
          letterSpacing: 2,
          marginX: Math.round(H * 0.06),
          marginY: Math.round(H * 0.06),
          maxWidthRatio: 0.86,
          background: 'none',
          section: 'climax',
        }),
      };
    case 'anime-katana':
      return {
        transform: t(0.04, -2),
        blendMode: 'normal',
        text: content({
          text: text.toUpperCase(),
          font: 'Permanent Marker',
          size: Math.round(H * 0.115),
          weight: 700,
          color: '#fff8eb',
          outlineColor: '#090408',
          outlineWidth: 5,
          outerOutlineColor: '#ff3b5c',
          outerOutlineWidth: 1.6,
          extrudeDepth: 4,
          extrudeColor: '#17040a',
          chromaticAberration: 3.5,
          slashBanner: false,
          heroWord: true,
          heroFont: 'Russo One',
          heroScale: 1.22,
          heroColor: '#ffbe0b',
          heroTiltDeg: -3,
          shadow: true,
          animationIn: 'slide-left',
          animationOut: 'fade',
          animationInUs: 150_000,
          animationOutUs: 110_000,
          highlightColor: '#ffbe0b',
          highlightScale: 1.2,
          glowColor: '#ff3b5c',
          glowIntensity: 12,
          letterSpacing: 1,
          marginX: Math.round(H * 0.06),
          marginY: Math.round(H * 0.06),
          maxWidthRatio: 0.86,
          background: 'none',
        }),
      };
    case 'anime-dialogue':
      return {
        transform: t(0.36),
        blendMode: 'normal',
        text: content({
          text,
          font: 'Montserrat Variable',
          italic: true,
          size: Math.round(H * 0.048),
          weight: 700,
          color: '#fef9c3',
          outlineColor: '#06080f',
          outlineWidth: 4,
          outerOutlineColor: '#38bdf8',
          outerOutlineWidth: 0.8,
          shadow: true,
          animationIn: 'fade',
          animationOut: 'fade',
          animationInUs: 120_000,
          animationOutUs: 100_000,
          marginX: Math.round(H * 0.07),
          marginY: Math.round(H * 0.05),
          maxWidthRatio: 0.86,
          lineSpacing: 1.2,
          background: 'none',
        }),
      };
    case 'anime-impact':
      return { transform: t(0), blendMode: 'normal', text: content({ text: text.toUpperCase(), font: 'Russo One', size: Math.round(H * 0.115), weight: 900, color: '#fff4e6', outlineColor: '#14090d', outlineWidth: 5, outerOutlineColor: '#ff3355', outerOutlineWidth: 1.6, extrudeDepth: 4, extrudeColor: '#1a050a', chromaticAberration: 3.2, heroWord: true, heroFont: 'Permanent Marker', heroScale: 1.24, heroColor: '#ff5c77', heroTiltDeg: -3, shadow: true, animationIn: 'pop', animationOut: 'fade', animationInUs: 180_000, animationOutUs: 120_000, highlightColor: '#ff5364', highlightScale: 1.18, glowColor: '#ff5364', glowIntensity: 12, marginX: Math.round(H * 0.07), marginY: Math.round(H * 0.06), maxWidthRatio: 0.84, background: 'none' }) };
    case 'anime-neon':
      return { transform: t(0.1), blendMode: 'screen', text: content({ text: text.toUpperCase(), font: 'Teko', size: Math.round(H * 0.13), weight: 900, color: '#e0fbff', outlineColor: '#041019', outlineWidth: 4, outerOutlineColor: '#00f0ff', outerOutlineWidth: 1.4, chromaticAberration: 2.6, sheen: true, heroWord: true, heroFont: 'Bungee', heroScale: 1.14, heroColor: '#ff4d9d', shadow: true, animationIn: 'pop', animationOut: 'blur', animationInUs: 160_000, animationOutUs: 120_000, fillStyle: 'hollow', gradientStartColor: '#e0ffff', gradientEndColor: '#38bdf8', highlightColor: '#ff4d9d', highlightScale: 1.18, wordAnimation: 'pop', glowColor: '#00e5ff', glowIntensity: 18, letterSpacing: 3, marginX: Math.round(H * 0.06), marginY: Math.round(H * 0.05), maxWidthRatio: 0.86, background: 'none', section: 'chorus' }) };
    case 'anime-manga':
      return { transform: t(0.22), blendMode: 'normal', text: content({ text: text.toUpperCase(), font: 'Black Ops One', size: Math.round(H * 0.092), weight: 900, color: '#ffffff', outlineColor: '#090a0d', outlineWidth: 5, outerOutlineColor: '#ffe047', outerOutlineWidth: 1.6, extrudeDepth: 5, extrudeColor: '#000000', slashBanner: true, shadow: true, animationIn: 'slide-left', animationOut: 'fade', animationInUs: 140_000, animationOutUs: 100_000, background: 'none', backgroundOpacity: 0.82, highlightColor: '#ffe047', highlightScale: 1.16, letterSpacing: 2, padding: Math.round(H * 0.024), marginX: Math.round(H * 0.07), marginY: Math.round(H * 0.05), maxWidthRatio: 0.84 }) };
    case 'anime-gold-epic':
      return { transform: t(0), blendMode: 'normal', text: content({ text: text.toUpperCase(), font: 'Cinzel Variable', size: Math.round(H * 0.105), weight: 900, color: '#fff7d1', outlineColor: '#1a0e04', outlineWidth: 5, outerOutlineColor: '#fde68a', outerOutlineWidth: 1.2, extrudeDepth: 3, extrudeColor: '#241202', sheen: true, heroWord: true, heroFont: 'Playfair Display Variable', heroItalic: true, heroScale: 1.25, shadow: true, animationIn: 'pop', animationOut: 'blur', animationInUs: 200_000, animationOutUs: 150_000, fillStyle: 'linear-gradient', gradientStartColor: '#fff9d6', gradientEndColor: '#f59e0b', highlightColor: '#ffffff', highlightScale: 1.2, wordAnimation: 'highlight', glowColor: '#f59e0b', glowIntensity: 14, letterSpacing: 3, marginX: Math.round(H * 0.06), marginY: Math.round(H * 0.06), maxWidthRatio: 0.86, background: 'none', section: 'climax' }) };
    case 'destaque':
      return { transform: t(0), blendMode: 'normal', text: content({ text, font: 'Russo One', size: Math.round(H * 0.08), weight: 800, color: '#ffffff', outlineColor: '#000000', outlineWidth: 4, shadow: true, animationIn: 'pop', animationOut: 'fade' }) };
    case 'palavra':
      return { transform: t(0), blendMode: 'normal', text: content({ text: text.toUpperCase(), font: 'Anton', size: Math.round(H * 0.12), color: '#ffffff', outlineColor: '#000000', outlineWidth: 4, extrudeDepth: 3, shadow: true, animationIn: 'pop', animationOut: null }) };
    case 'karaoke':
      return { transform: t(0.34), blendMode: 'normal', text: content({ text, font: 'Montserrat Variable', size: Math.round(H * 0.055), weight: 800, color: '#fff3b0', outlineColor: '#000000', outlineWidth: 4, shadow: true, animationIn: 'fade', animationOut: 'fade' }) };
    case 'lyrics-cinematic':
      return { transform: t(0.18), blendMode: 'normal', text: content({ text, font: 'Montserrat Variable', size: Math.round(H * 0.085), weight: 800, color: '#ffffff', outlineColor: '#08090c', outlineWidth: 3.5, sheen: true, heroWord: true, heroFont: 'Playfair Display Variable', heroItalic: true, heroScale: 1.28, heroColor: '#ffe066', shadow: true, animationIn: 'pop', animationOut: 'fade', highlightColor: '#ffd166', highlightScale: 1.18, alignment: 'center', maxWidthRatio: 0.9, marginX: Math.round(H * 0.06), background: 'none' }) };
    case 'dialogue-dramatic':
      return { transform: t(0.34), blendMode: 'normal', text: content({ text, font: 'Playfair Display Variable', italic: true, size: Math.round(H * 0.056), weight: 700, color: '#fef3c7', outlineColor: '#05070c', outlineWidth: 4, shadow: true, animationIn: 'fade', animationOut: 'fade', background: 'none', alignment: 'center', maxWidthRatio: 0.84, marginX: Math.round(H * 0.08), padding: Math.round(H * 0.02), lineSpacing: 1.22 }) };
    case 'impact-typography':
      return { transform: t(0), blendMode: 'normal', text: content({ text: text.toUpperCase(), font: 'Russo One', size: Math.round(H * 0.13), weight: 900, color: '#ffffff', outlineColor: '#050505', outlineWidth: 5, extrudeDepth: 4, chromaticAberration: 3, shadow: true, animationIn: 'pop', animationOut: 'fade', background: 'none', alignment: 'center', maxWidthRatio: 0.88, marginX: Math.round(H * 0.06), padding: Math.round(H * 0.03), highlightColor: '#ffe066', highlightScale: 1.25 }) };
    case 'section-intro':
      return { transform: t(-0.2), blendMode: 'normal', text: content({ text: text.toUpperCase(), font: 'Cinzel Variable', size: Math.round(H * 0.08), weight: 700, color: '#ffffff', outlineColor: '#11131a', outlineWidth: 2, sheen: true, shadow: true, animationIn: 'slide', animationOut: 'fade', fillStyle: 'linear-gradient', gradientStartColor: '#fff2bd', gradientEndColor: '#e5a84b', glowColor: '#ffd36e', glowIntensity: 6, letterSpacing: 4, alignment: 'center', section: 'intro' }) };
    case 'section-verse':
      return { transform: t(0.34), blendMode: 'normal', text: content({ text, font: 'Montserrat Variable', size: Math.round(H * 0.052), weight: 700, color: '#ffffff', outlineColor: '#000000', outlineWidth: 3.5, shadow: true, animationIn: 'fade', animationOut: 'fade', background: 'none', alignment: 'center', section: 'verse' }) };
    case 'section-chorus':
      return { transform: t(0.16), blendMode: 'normal', text: content({ text, font: 'Teko', size: Math.round(H * 0.115), weight: 700, color: '#ffffff', outlineColor: '#08090c', outlineWidth: 4, sheen: true, shadow: true, animationIn: 'pop', animationOut: 'fade', fillStyle: 'linear-gradient', gradientStartColor: '#fff2a6', gradientEndColor: '#ff78bc', glowColor: '#ff91d0', glowIntensity: 12, highlightColor: '#ffffff', highlightScale: 1.16, wordAnimation: 'highlight', letterSpacing: 2, alignment: 'center', section: 'chorus' }) };
    case 'section-climax':
      return { transform: t(0), blendMode: 'normal', text: content({ text: text.toUpperCase(), font: 'Russo One', size: Math.round(H * 0.125), weight: 900, color: '#ffffff', outlineColor: '#08090c', outlineWidth: 5, extrudeDepth: 4, chromaticAberration: 3.5, shadow: true, animationIn: 'pop', animationOut: 'blur', fillStyle: 'linear-gradient', gradientStartColor: '#fff4bd', gradientEndColor: '#ff4b57', glowColor: '#ff503c', glowIntensity: 18, highlightColor: '#ffffff', highlightScale: 1.2, wordAnimation: 'pop', background: 'none', alignment: 'center', section: 'climax' }) };
    default:
      return { transform: t(0.36), blendMode: 'normal', text: content({ text, font: 'Montserrat Variable', size: Math.round(H * 0.046), weight: 700, color: '#ffffff', outlineColor: '#000000', outlineWidth: 3.5, shadow: true, animationIn: null, animationOut: null, background: 'none' }) };
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
    blendMode: l.blendMode ?? 'normal',
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
      const currentText = c.text;
      if (!currentText) return { type: 'batch' as const, commands: [] };
      const uppercase = ['palavra', 'section-climax', 'impact-typography', 'anime-blend', 'anime-katana', 'anime-impact', 'anime-neon', 'anime-manga', 'anime-gold-epic'].includes(look);
      const raw = uppercase ? currentText.text.toUpperCase() : currentText.text;
      const l = lookText(look, H, raw);
      return {
        type: 'clip.update' as const,
        clipId: c.id,
        patch: {
          transform: l.transform,
          blendMode: l.blendMode ?? 'normal',
          text: {
            ...l.text,
            behindCutout: c.text!.behindCutout,
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

/** Avisos de leitura: velocidade e linhas longas/altas. */
export function readability(text: string, durS: number): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(normalized).length;
  if (durS > 0 && chars / durS > 20) return 'rápido demais para ler (' + Math.round(chars / durS) + ' caracteres/s)';
  const lines = text.replace(/\r/g, '').split('\n');
  if (lines.length > 2) return 'legenda com mais de duas linhas: divida em trechos menores';
  if (lines.some((line) => Array.from(line).length > 45)) return 'linha comprida (mais de 45 caracteres): quebre em duas';
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

/**
 * Estima o deslocamento global ótimo (dentro de `±maxShiftS`) que aproxima os inícios
 * das legendas das batidas musicais da timeline, útil quando uma letra .LRC/.SRT chega
 * uniformemente adiantada ou atrasada em relação à música.
 */
export function autoSyncSubtitlesToBeats(
  project: Project,
  clipIds: string[],
  beatsS: number[],
  maxShiftS = 0.5,
): { shiftUs: number; commands: Command[] } {
  const validBeats = beatsS.filter((b) => Number.isFinite(b) && b >= 0).sort((a, b) => a - b);
  const targets = project.clips.filter((c) => clipIds.includes(c.id) && c.text);
  if (!validBeats.length || !targets.length) return { shiftUs: 0, commands: [] };

  const nearestDist = (t: number): number => {
    let lo = 0;
    let hi = validBeats.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (validBeats[mid]! < t) lo = mid + 1;
      else hi = mid;
    }
    let best = Math.abs(validBeats[lo]! - t);
    if (lo > 0) best = Math.min(best, Math.abs(validBeats[lo - 1]! - t));
    return best;
  };

  let bestShiftS = 0;
  let bestScore = Infinity;
  const stepS = 0.02;
  for (let shiftS = -maxShiftS; shiftS <= maxShiftS + 1e-9; shiftS += stepS) {
    let score = 0;
    for (const c of targets) {
      const shiftedS = Math.max(0, c.timelineStartUs / S + shiftS);
      score += nearestDist(shiftedS);
    }
    // Leve preferência por deslocamentos menores em caso de empate
    score += Math.abs(shiftS) * 0.05;
    if (score < bestScore) {
      bestScore = score;
      bestShiftS = shiftS;
    }
  }
  const shiftUs = Math.round(bestShiftS * S);
  if (Math.abs(shiftUs) < 15_000) return { shiftUs: 0, commands: [] };
  return { shiftUs, commands: shiftSubtitles(project, clipIds, shiftUs) };
}

export * from './post-edit.js';
