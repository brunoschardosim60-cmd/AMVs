import { describe, expect, it } from 'vitest';
import { renderSfx, SFX_ANCHOR_S, SFX_DURATION_S, SFX_KINDS, SFX_SAMPLE_RATE as SR, sfxFileName, toWav } from '../src/index.js';

/** Energia (soma de |X|²) entre f1 e f2 Hz, por DFT direta de uma janela (suficiente para um teste). */
function band(x: Float32Array, from: number, len: number, f1: number, f2: number): number {
  const n = len;
  let e = 0;
  const k1 = Math.floor((f1 * n) / SR);
  const k2 = Math.ceil((f2 * n) / SR);
  for (let k = k1; k <= k2; k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      const v = x[from + i]! * w;
      re += v * Math.cos((2 * Math.PI * k * i) / n);
      im -= v * Math.sin((2 * Math.PI * k * i) / n);
    }
    e += re * re + im * im;
  }
  return e;
}
const rms = (x: Float32Array, a: number, b: number) => Math.sqrt(x.slice(a, b).reduce((s, v) => s + v * v, 0) / Math.max(1, b - a));
/** Centroide espectral aproximado: média ponderada de frequência por energia em faixas. */
function centroid(x: Float32Array, from: number, len = 2048): number {
  const edges = [100, 250, 500, 1000, 2000, 4000, 8000];
  let num = 0;
  let den = 0;
  for (let b = 0; b < edges.length - 1; b++) {
    const e = band(x, from, len, edges[b]!, edges[b + 1]!);
    num += e * Math.sqrt(edges[b]! * edges[b + 1]!);
    den += e;
  }
  return den ? num / den : 0;
}

describe('efeitos sonoros sintetizados', () => {
  it.each(SFX_KINDS)('%s: duração certa, sem estourar, sem silêncio, sem DC', (kind) => {
    const x = renderSfx(kind);
    expect(x.length).toBe(Math.round(SFX_DURATION_S[kind] * SR));
    const peak = Math.max(...x.map(Math.abs));
    expect(peak).toBeGreaterThan(0.8);
    expect(peak).toBeLessThanOrEqual(0.9);
    expect(Math.abs(x.reduce((s, v) => s + v, 0) / x.length)).toBeLessThan(0.01);
    expect(x.every(Number.isFinite)).toBe(true);
    expect(Math.abs(x.at(-1)!)).toBeLessThan(0.01); // termina sem estalo
  });

  it('determinístico: mesma semente, mesmo som; outra semente, outro ruído', () => {
    expect(renderSfx('whoosh', 3)).toEqual(renderSfx('whoosh', 3));
    expect(renderSfx('whoosh', 3)).not.toEqual(renderSfx('whoosh', 4));
  });

  it('impacto: golpe no começo (pico nos primeiros 30 ms) e graves dominam', () => {
    const x = renderSfx('impact');
    const first = x.slice(0, Math.round(0.03 * SR));
    expect(Math.max(...first.map(Math.abs))).toBeGreaterThan(0.6);
    const win = 4096;
    const low = band(x, Math.round(0.02 * SR), win, 30, 200);
    const high = band(x, Math.round(0.02 * SR), win, 2000, 8000);
    expect(low).toBeGreaterThan(high * 3);
    // cai: a cauda é bem mais fraca que o início
    expect(rms(x, Math.round(0.9 * SR), Math.round(1.1 * SR))).toBeLessThan(rms(x, 0, Math.round(0.2 * SR)) * 0.2);
  });

  it('golpe: curto e grave-médio, bem mais curto que o impacto', () => {
    const x = renderSfx('hit');
    expect(x.length / SR).toBeLessThan(0.35);
    expect(rms(x, Math.round(0.2 * SR), x.length)).toBeLessThan(rms(x, 0, Math.round(0.08 * SR)) * 0.3);
  });

  it('whoosh: o brilho sobe ao longo do som (começa grave, termina agudo) e pica no meio-fim', () => {
    const x = renderSfx('whoosh');
    const early = centroid(x, Math.round(0.08 * SR));
    const late = centroid(x, Math.round(0.4 * SR));
    expect(late).toBeGreaterThan(early * 1.5);
    const peakAt = x.reduce((best, v, i) => (Math.abs(v) > Math.abs(x[best]!) ? i : best), 0) / SR;
    expect(peakAt).toBeGreaterThan(0.25);
    expect(peakAt).toBeLessThan(0.55);
  });

  it('subida: cada quarto é mais alto que o anterior e o brilho sobe; termina cheio', () => {
    const x = renderSfx('riser');
    const q = x.length / 4;
    const levels = [0, 1, 2, 3].map((k) => rms(x, Math.round(k * q), Math.round((k + 1) * q)));
    for (let i = 1; i < 4; i++) expect(levels[i]!).toBeGreaterThan(levels[i - 1]!);
    expect(levels[3]!).toBeGreaterThan(levels[0]! * 5);
    expect(centroid(x, Math.round(1.8 * SR))).toBeGreaterThan(centroid(x, Math.round(0.4 * SR)));
    // ponto de ancoragem = fim: o drop entra exatamente quando a subida termina
    expect(SFX_ANCHOR_S.riser).toBe(SFX_DURATION_S.riser);
  });

  it('WAV: cabeçalho PCM 16 bits correto e amostras ida e volta', () => {
    const x = renderSfx('hit');
    const w = toWav(x);
    const dv = new DataView(w.buffer);
    const tag = (o: number) => String.fromCharCode(w[o]!, w[o + 1]!, w[o + 2]!, w[o + 3]!);
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(dv.getUint16(20, true)).toBe(1);
    expect(dv.getUint16(22, true)).toBe(1);
    expect(dv.getUint32(24, true)).toBe(SR);
    expect(dv.getUint16(34, true)).toBe(16);
    expect(dv.getUint32(40, true)).toBe(x.length * 2);
    expect(w.length).toBe(44 + x.length * 2);
    for (const i of [0, 100, 1000, x.length - 1]) expect(Math.abs(dv.getInt16(44 + i * 2, true) / 32767 - x[i]!)).toBeLessThan(1 / 32000);
  });

  it('nomes de arquivo estáveis e versionados', () => {
    expect(SFX_KINDS.map(sfxFileName)).toEqual(['amv-sfx-impact-v1.wav', 'amv-sfx-hit-v1.wav', 'amv-sfx-whoosh-v1.wav', 'amv-sfx-riser-v1.wav']);
  });
});
