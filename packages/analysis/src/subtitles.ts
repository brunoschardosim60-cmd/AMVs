/** Legendas e letras: SRT, ASS/SSA, VTT, LRC e texto puro → lista de falas com tempo. */

export interface Cue {
  startS: number;
  endS: number;
  text: string;
  language?: string | null;
  words?: CueWord[];
}

export interface CueWord {
  startS: number;
  endS: number;
  text: string;
  source: 'ass' | 'lrc' | 'whisper' | 'manual' | 'estimated';
  confidence?: number | null;
  uncertain?: boolean;
  syllables?: { startS: number; endS: number; text: string; source: 'ass' | 'manual'; confidence: number }[];
}

function ts(h: string, m: string, s: string, frac = '0'): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(`0.${frac}`);
}

function clean(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, '') // tags ASS {\i1}
    .replace(/<[^>]+>/g, '') // tags HTML <i>
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\h/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

export function parseSrt(text: string): Cue[] {
  const out: Cue[] = [];
  const re = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|\n*$)/g;
  for (const m of text.replace(/\r/g, '').matchAll(re)) {
    const t = clean(m[9]!);
    if (t) out.push({ startS: ts(m[1]!, m[2]!, m[3]!, m[4]!.padEnd(3, '0')), endS: ts(m[5]!, m[6]!, m[7]!, m[8]!.padEnd(3, '0')), text: t });
  }
  return out;
}

export function parseVtt(text: string): Cue[] {
  // VTT aceita "mm:ss.mmm" sem horas
  const norm = text.replace(/\r/g, '').replace(/(^|\s)(\d{2}):(\d{2})\.(\d{3})/g, '$100:$2:$3.$4');
  return parseSrt(norm);
}

function assKaraokeWords(raw: string, startS: number, endS: number): CueWord[] {
  const syllables: { startS: number; endS: number; text: string }[] = [];
  const tags = /\{\\(?:kf|ko|K|k)(\d+)\}/g;
  const matches = [...raw.matchAll(tags)];
  let cursor = startS;
  for (const [index, match] of matches.entries()) {
    const tagEnd = match.index! + match[0].length;
    const end = matches[index + 1]?.index ?? raw.length;
    const text = raw
      .slice(tagEnd, end)
      .replace(/\{[^}]*\}/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\\[Nn]/g, ' ')
      .replace(/\\h/g, ' ')
      .replace(/[ \t]+/g, ' ');
    const wordEnd = Math.min(endS, cursor + Number(match[1]) / 100);
    if (text && wordEnd > cursor) syllables.push({ startS: cursor, endS: wordEnd, text });
    cursor = wordEnd;
  }
  if (!syllables.length) return [];

  const combined = syllables.map((part) => part.text).join('');
  if (/[\u3040-\u30ff\u3400-\u9fff]/u.test(combined)) {
    return syllables.map((part) => ({
      ...part,
      text: part.text.trim(),
      source: 'ass' as const,
      confidence: 1,
      syllables: [{ ...part, text: part.text.trim(), source: 'ass' as const, confidence: 1 }],
    })).filter((part) => part.text);
  }

  const glyphs: { char: string; startS: number; endS: number }[] = [];
  for (const part of syllables) {
    for (const char of part.text) glyphs.push({ char, startS: part.startS, endS: part.endS });
  }
  const text = glyphs.map((glyph) => glyph.char).join('');
  const out: CueWord[] = [];
  const wordPattern = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
  for (const match of text.matchAll(wordPattern)) {
    const first = Array.from(text.slice(0, match.index)).length;
    let end = first + Array.from(match[0]).length;
    while (end < glyphs.length && /[^\p{L}\p{N}\s]/u.test(glyphs[end]!.char)) end++;
    const wordGlyphs = glyphs.slice(first, end);
    const firstGlyph = wordGlyphs[0];
    const lastGlyph = wordGlyphs.at(-1);
    if (firstGlyph && lastGlyph && lastGlyph.endS > firstGlyph.startS) {
      const wordSyllables: NonNullable<CueWord['syllables']> = [];
      for (const glyph of wordGlyphs) {
        if (/\s/u.test(glyph.char)) continue;
        const previous = wordSyllables.at(-1);
        if (previous && previous.startS === glyph.startS && previous.endS === glyph.endS) {
          previous.text += glyph.char;
        } else {
          wordSyllables.push({ text: glyph.char, startS: glyph.startS, endS: glyph.endS, source: 'ass', confidence: 1 });
        }
      }
      out.push({ text: wordGlyphs.map((glyph) => glyph.char).join(''), startS: firstGlyph.startS, endS: lastGlyph.endS, source: 'ass', confidence: 1, syllables: wordSyllables });
    }
  }
  return out;
}

export function parseAss(text: string): Cue[] {
  const out: Cue[] = [];
  let format: string[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (/^Format:/i.test(line) && format.length === 0 && /Start/i.test(line)) {
      format = line.slice(7).split(',').map((x) => x.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue:/i.test(line)) continue;
    const fields = line.slice(9).split(',');
    const f = format.length ? format : ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    const textIdx = f.indexOf('text');
    const get = (k: string) => fields[f.indexOf(k)]?.trim() ?? '';
    const rawText = fields.slice(textIdx).join(',');
    const t = clean(rawText);
    const p = (v: string) => {
      const m = v.match(/(\d+):(\d{2}):(\d{2})\.(\d{1,2})/);
      return m ? ts(m[1]!, m[2]!, m[3]!, m[4]!.padEnd(2, '0')) : NaN;
    };
    const s = p(get('start'));
    const e = p(get('end'));
    // estilos de placa/sinal/karaokê costumam ser texto na tela, não fala
    const style = get('style').toLowerCase();
    if (!t || !Number.isFinite(s) || !Number.isFinite(e) || /sign|placa|song|op|ed|title/.test(style)) continue;
    const words = assKaraokeWords(rawText, s, e);
    out.push({ startS: s, endS: e, text: t, ...(words.length ? { words } : {}) });
  }
  return out.sort((a, b) => a.startS - b.startS);
}

/** LRC: [mm:ss.xx] linha. O fim de cada linha é o começo da próxima. */
export function parseLrc(text: string, durationS?: number): Cue[] {
  const marks: { t: number; text: string; rawText: string }[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const tags = [...raw.matchAll(/\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!tags.length) continue;
    const rawText = raw.replace(/\[[^\]]*\]/g, '');
    const body = clean(rawText.replace(/<\d+:\d{2}[.:]\d+>/g, ''));
    for (const m of tags) marks.push({ t: Number(m[1]) * 60 + Number(m[2]) + Number(`0.${m[3] ?? '0'}`), text: body, rawText });
  }
  marks.sort((a, b) => a.t - b.t);
  return marks
    .map((m, i) => {
      const endS = marks[i + 1]?.t ?? durationS ?? m.t + 4;
      const timingTags = [...m.rawText.matchAll(/<(\d+):(\d{2})[.:](\d{1,3})>/g)];
      const segments = [
        ...(timingTags[0]?.index
          ? [{ startS: m.t, text: m.rawText.slice(0, timingTags[0].index) }]
          : []),
        ...timingTags.map((tag, index) => ({
          startS: Number(tag[1]) * 60 + Number(tag[2]) + Number(`0.${tag[3]}`),
          text: m.rawText.slice(tag.index! + tag[0].length, timingTags[index + 1]?.index ?? m.rawText.length),
        })),
      ];
      const hasOneWordPerTimestamp = segments.length > 0 && segments.every((segment) => clean(segment.text).trim().split(/\s+/u).filter(Boolean).length === 1);
      const words: CueWord[] = hasOneWordPerTimestamp
        ? segments.flatMap((segment, index) => {
            const startS = Math.max(m.t, segment.startS);
            const wordEndS = Math.min(endS, segments[index + 1]?.startS ?? endS);
            const wordText = clean(segment.text).trim();
            return wordEndS > startS ? [{ startS, endS: wordEndS, text: wordText, source: 'lrc' as const }] : [];
          })
        : [];
      return { startS: m.t, endS, text: m.text, ...(words.length ? { words } : {}) };
    })
    .filter((c) => c.text);
}

/** Texto sem tempo: uma linha por fala, sem tempos (startS = endS = NaN) para sincronizar depois. */
export function parsePlain(text: string): Cue[] {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((t) => ({ startS: NaN, endS: NaN, text: t }));
}

export type SubtitleFormat = 'srt' | 'ass' | 'vtt' | 'lrc' | 'txt';

export function detectFormat(name: string, text: string): SubtitleFormat {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'ass' || ext === 'ssa' || /\[Script Info\]/i.test(text)) return 'ass';
  if (ext === 'vtt' || /^WEBVTT/.test(text)) return 'vtt';
  if (ext === 'lrc' || /^\[\d+:\d{2}/m.test(text)) return 'lrc';
  if (ext === 'srt' || /-->/.test(text)) return 'srt';
  return 'txt';
}

export function parseSubtitles(name: string, text: string, durationS?: number): Cue[] {
  switch (detectFormat(name, text)) {
    case 'ass':
      return parseAss(text);
    case 'vtt':
      return parseVtt(text);
    case 'lrc':
      return parseLrc(text, durationS);
    case 'srt':
      return parseSrt(text);
    default:
      return parsePlain(text);
  }
}

function srtTime(s: number): string {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const sec = Math.floor(ms / 1000) % 60;
  const rest = ms % 1000;
  const p = (v: number, n = 2) => String(v).padStart(n, '0');
  return `${p(h)}:${p(m)}:${p(sec)},${p(rest, 3)}`;
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.startS)} --> ${srtTime(c.endS)}\n${c.text}\n`).join('\n');
}

/**
 * Decodifica bytes de legenda tentando UTF-8 (com/sem BOM), depois UTF-16 e
 * Windows-1252/Shift-JIS conforme os erros. Legendas de anime vêm em todos.
 */
export function decodeSubtitleBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // muitos bytes 0x81–0x9F seguidos de 0x40–0xFC = Shift-JIS; senão Windows-1252
    let sj = 0;
    for (let i = 0; i + 1 < bytes.length; i++) if (bytes[i]! >= 0x81 && bytes[i]! <= 0x9f && bytes[i + 1]! >= 0x40) sj++;
    try {
      return new TextDecoder(sj > 20 ? 'shift_jis' : 'windows-1252').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

/** "Frase marcante": curta, com exclamação/interrogação, ou toda em maiúsculas. */
export function impactScore(text: string): number {
  const t = text.replace(/\n/g, ' ').trim();
  const words = t.split(/\s+/).length;
  let s = 0;
  if (/[!！]/.test(t)) s += 0.45;
  if (/[?？]/.test(t)) s += 0.15;
  if (t.length > 3 && t === t.toUpperCase() && /[A-ZÁÉÍÓÚÃÕÇ]/.test(t)) s += 0.25;
  if (words <= 7) s += 0.25;
  else if (words > 16) s -= 0.2;
  if (/\b(nunca|sempre|vou|eu sou|vencer|proteger|morrer|lutar|desistir|mais forte|never|always|i will|protect|win)\b/i.test(t)) s += 0.2;
  return Math.max(0, Math.min(1, s));
}
