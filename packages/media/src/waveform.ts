/**
 * Waveform em vários níveis de zoom.
 *
 * O PCM chega em pedaços (stream do FFmpeg) e é reduzido na hora a pares min/max
 * por bucket — memória constante, mesmo para episódios inteiros.
 *
 * Formato binário (little-endian):
 *   "AMVW" | u16 versão=1 | u32 sampleRate | u32 samplesPerBucket(nível 0)
 *   | u8 níveis | para cada nível: u32 nBuckets + nBuckets × (i16 min, i16 max)
 * Cada nível tem buckets 2× maiores que o anterior.
 */

export class PeakAccumulator {
  private carry: number | null = null; // byte solto entre pedaços
  private mins: number[] = [];
  private maxs: number[] = [];
  private curMin = 32767;
  private curMax = -32768;
  private count = 0;
  totalSamples = 0;

  constructor(public readonly samplesPerBucket: number) {}

  push(chunk: Uint8Array): void {
    let i = 0;
    if (this.carry !== null && chunk.length > 0) {
      this.sample(((chunk[0]! << 8) | this.carry) << 16 >> 16);
      this.carry = null;
      i = 1;
    }
    for (; i + 1 < chunk.length; i += 2) {
      this.sample(((chunk[i + 1]! << 8) | chunk[i]!) << 16 >> 16);
    }
    if (i < chunk.length) this.carry = chunk[i]!;
  }

  private sample(v: number): void {
    if (v < this.curMin) this.curMin = v;
    if (v > this.curMax) this.curMax = v;
    this.count++;
    this.totalSamples++;
    if (this.count === this.samplesPerBucket) this.close();
  }

  private close(): void {
    this.mins.push(this.curMin);
    this.maxs.push(this.curMax);
    this.curMin = 32767;
    this.curMax = -32768;
    this.count = 0;
  }

  finish(): { mins: Int16Array; maxs: Int16Array } {
    if (this.count > 0) this.close();
    return { mins: Int16Array.from(this.mins), maxs: Int16Array.from(this.maxs) };
  }
}

export interface WaveformLevel {
  samplesPerBucket: number;
  mins: Int16Array;
  maxs: Int16Array;
}

export interface Waveform {
  sampleRate: number;
  durationUs: number;
  levels: WaveformLevel[];
}

export function buildLevels(base: WaveformLevel, minBuckets = 64): WaveformLevel[] {
  const levels = [base];
  let cur = base;
  while (cur.mins.length > minBuckets) {
    const n = Math.ceil(cur.mins.length / 2);
    const mins = new Int16Array(n);
    const maxs = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const a = 2 * i;
      const b = Math.min(a + 1, cur.mins.length - 1);
      mins[i] = Math.min(cur.mins[a]!, cur.mins[b]!);
      maxs[i] = Math.max(cur.maxs[a]!, cur.maxs[b]!);
    }
    cur = { samplesPerBucket: cur.samplesPerBucket * 2, mins, maxs };
    levels.push(cur);
  }
  return levels;
}

export function encodeWaveform(w: Waveform): Uint8Array {
  let size = 4 + 2 + 4 + 4 + 1;
  for (const l of w.levels) size += 4 + l.mins.length * 4;
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  buf.set(new TextEncoder().encode('AMVW'), 0);
  let o = 4;
  dv.setUint16(o, 1, true); o += 2;
  dv.setUint32(o, w.sampleRate, true); o += 4;
  dv.setUint32(o, w.levels[0]?.samplesPerBucket ?? 0, true); o += 4;
  dv.setUint8(o, w.levels.length); o += 1;
  for (const l of w.levels) {
    dv.setUint32(o, l.mins.length, true); o += 4;
    for (let i = 0; i < l.mins.length; i++) {
      dv.setInt16(o, l.mins[i]!, true); o += 2;
      dv.setInt16(o, l.maxs[i]!, true); o += 2;
    }
  }
  return buf;
}

export function decodeWaveform(buf: Uint8Array): Waveform {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (new TextDecoder().decode(buf.subarray(0, 4)) !== 'AMVW') throw new Error('arquivo de waveform inválido');
  let o = 4;
  const version = dv.getUint16(o, true); o += 2;
  if (version !== 1) throw new Error(`versão de waveform não suportada: ${version}`);
  const sampleRate = dv.getUint32(o, true); o += 4;
  let spb = dv.getUint32(o, true); o += 4;
  const nLevels = dv.getUint8(o); o += 1;
  const levels: WaveformLevel[] = [];
  for (let L = 0; L < nLevels; L++) {
    const n = dv.getUint32(o, true); o += 4;
    const mins = new Int16Array(n);
    const maxs = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      mins[i] = dv.getInt16(o, true); o += 2;
      maxs[i] = dv.getInt16(o, true); o += 2;
    }
    levels.push({ samplesPerBucket: spb, mins, maxs });
    spb *= 2;
  }
  const base = levels[0];
  const durationUs = base ? Math.round((base.mins.length * base.samplesPerBucket * 1e6) / sampleRate) : 0;
  return { sampleRate, durationUs, levels };
}

/** Escolhe o nível com no máximo ~1 bucket por pixel para desenhar `pxPerSecond`. */
export function pickLevel(w: Waveform, pxPerSecond: number): WaveformLevel {
  const wantSamplesPerPx = w.sampleRate / Math.max(pxPerSecond, 1e-6);
  let best = w.levels[0]!;
  for (const l of w.levels) {
    if (l.samplesPerBucket <= wantSamplesPerPx) best = l;
  }
  return best;
}
