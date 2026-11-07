/** Utilitários de processamento de sinal (sem dependências). */

/** FFT complexa in-place, radix-2. `re` e `im` com tamanho potência de 2. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

export function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

export interface Spectrogram {
  /** Magnitudes por quadro: frames × bins. */
  mags: Float32Array[];
  hop: number;
  size: number;
  sampleRate: number;
}

/** STFT de magnitude. */
export function stft(samples: Float32Array, sampleRate: number, size = 1024, hop = 512): Spectrogram {
  const win = hann(size);
  const frames = Math.max(0, Math.floor((samples.length - size) / hop) + 1);
  const mags: Float32Array[] = [];
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  for (let f = 0; f < frames; f++) {
    const o = f * hop;
    for (let i = 0; i < size; i++) {
      re[i] = samples[o + i]! * win[i]!;
      im[i] = 0;
    }
    fft(re, im);
    const m = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) m[i] = Math.hypot(re[i]!, im[i]!);
    mags.push(m);
  }
  return { mags, hop, size, sampleRate };
}

export function movingAverage(x: ArrayLike<number>, radius: number): Float32Array {
  const n = x.length;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i]! + x[i]!;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(n, i + radius + 1);
    out[i] = (pre[hi]! - pre[lo]!) / (hi - lo);
  }
  return out;
}

export function normalize(x: Float32Array): Float32Array {
  let max = 0;
  for (const v of x) if (v > max) max = v;
  const out = new Float32Array(x.length);
  if (max > 0) for (let i = 0; i < x.length; i++) out[i] = x[i]! / max;
  return out;
}

export function percentile(x: ArrayLike<number>, p: number): number {
  const a = Array.from(x).sort((m, n) => m - n);
  if (!a.length) return 0;
  return a[Math.min(a.length - 1, Math.max(0, Math.round((p / 100) * (a.length - 1))))]!;
}

export function mean(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]!;
  return x.length ? s / x.length : 0;
}

/** RMS em janelas de `win` amostras. */
export function rmsFrames(samples: Float32Array, win: number): Float32Array {
  const n = Math.floor(samples.length / win);
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * win; i < (f + 1) * win; i++) s += samples[i]! * samples[i]!;
    out[f] = Math.sqrt(s / win);
  }
  return out;
}

export const toDb = (v: number) => 20 * Math.log10(Math.max(v, 1e-9));
