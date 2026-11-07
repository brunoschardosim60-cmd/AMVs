/** Legendas e letras: SRT, ASS/SSA, VTT, LRC e texto puro → lista de falas com tempo. */

export interface Cue {
  startS: number;
  endS: number;
  text: string;
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
    const t = clean(fields.slice(textIdx).join(','));
    const p = (v: string) => {
      const m = v.match(/(\d+):(\d{2}):(\d{2})\.(\d{1,2})/);
      return m ? ts(m[1]!, m[2]!, m[3]!, m[4]!.padEnd(2, '0')) : NaN;
    };
    const s = p(get('start'));
    const e = p(get('end'));
    // estilos de placa/sinal/karaokê costumam ser texto na tela, não fala
    const style = get('style').toLowerCase();
    if (!t || !Number.isFinite(s) || !Number.isFinite(e) || /sign|placa|song|karaoke|op|ed|title/.test(style)) continue;
    out.push({ startS: s, endS: e, text: t });
  }
  return out.sort((a, b) => a.startS - b.startS);
}

/** LRC: [mm:ss.xx] linha. O fim de cada linha é o começo da próxima. */
export function parseLrc(text: string, durationS?: number): Cue[] {
  const marks: { t: number; text: string }[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const tags = [...raw.matchAll(/\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!tags.length) continue;
    const body = clean(raw.replace(/\[[^\]]*\]/g, '').replace(/<\d+:\d{2}[.:]\d+>/g, ''));
    for (const m of tags) marks.push({ t: Number(m[1]) * 60 + Number(m[2]) + Number(`0.${m[3] ?? '0'}`), text: body });
  }
  marks.sort((a, b) => a.t - b.t);
  return marks
    .map((m, i) => ({ startS: m.t, endS: marks[i + 1]?.t ?? durationS ?? m.t + 4, text: m.text }))
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
