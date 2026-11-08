/**
 * Efeitos sonoros de AMV sintetizados por código: sem arquivos de terceiros (nada de
 * licença), determinísticos (mesma semente = mesmo som) e leves. Cada som é mono,
 * 48 kHz, normalizado a ~-1 dBFS; o volume final é decidido na montagem.
 */

export const SFX_SAMPLE_RATE = 48_000;

export type SfxKind = 'impact' | 'hit' | 'whoosh' | 'riser';

export const SFX_KINDS: SfxKind[] = ['impact', 'hit', 'whoosh', 'riser'];

export const SFX_LABEL: Record<SfxKind, string> = {
  impact: 'Impacto (drop)',
  hit: 'Golpe',
  whoosh: 'Whoosh',
  riser: 'Subida (antes do drop)',
};

/** Duração (s) de cada efeito: a montagem precisa saber para posicioná-lo. */
export const SFX_DURATION_S: Record<SfxKind, number> = { impact: 1.4, hit: 0.3, whoosh: 0.6, riser: 2.0 };

/** Instante (s, dentro do efeito) em que ele "acontece": o pico do golpe ou o fim da subida. */
export const SFX_ANCHOR_S: Record<SfxKind, number> = { impact: 0.004, hit: 0.004, whoosh: 0.42, riser: 2.0 };

function rng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => {
    // xorshift32
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

/** Filtro de estado variável (passa-banda/baixa/alta) com frequência que pode variar a cada amostra. */
class Svf {
  private low = 0;
  private band = 0;
  step(x: number, freq: number, q: number): { low: number; band: number; high: number } {
    const f = 2 * Math.sin(Math.PI * Math.min(0.45, freq / SFX_SAMPLE_RATE));
    this.low += f * this.band;
    const high = x - this.low - q * this.band;
    this.band += f * high;
    return { low: this.low, band: this.band, high };
  }
}

function finish(buf: Float32Array, peak = 0.89, fadeOutS = 0.01): Float32Array {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  const g = max > 0 ? peak / max : 0;
  const fade = Math.round(fadeOutS * SFX_SAMPLE_RATE);
  for (let i = 0; i < buf.length; i++) {
    let v = buf[i]! * g;
    const left = buf.length - 1 - i;
    if (left < fade) v *= left / fade;
    buf[i] = v;
  }
  return buf;
}

/** Gera o efeito (mono, 48 kHz, float -1..1). */
export function renderSfx(kind: SfxKind, seed = 1): Float32Array {
  const n = Math.round(SFX_DURATION_S[kind] * SFX_SAMPLE_RATE);
  const out = new Float32Array(n);
  const rnd = () => rng(seed)();
  const r = rng(seed * 7919 + kind.length);
  const noise = () => r() * 2 - 1;
  void rnd;

  if (kind === 'impact') {
    // boom grave que cai de ~135 Hz para ~45 Hz + estalo de ruído + brilho curto
    let phase = 0;
    const lp = new Svf();
    const hp = new Svf();
    for (let i = 0; i < n; i++) {
      const t = i / SFX_SAMPLE_RATE;
      phase += (2 * Math.PI * (45 + 90 * Math.exp(-t / 0.06))) / SFX_SAMPLE_RATE;
      const boom = Math.sin(phase) * Math.exp(-t / 0.34);
      const x = noise();
      const crack = lp.step(x, 5000, 0.7).low * Math.exp(-t / 0.025) * 0.9;
      const sizzle = hp.step(x, 2500, 0.7).high * Math.exp(-t / 0.09) * 0.22;
      out[i] = Math.tanh(1.6 * (boom * 1.1 + crack + sizzle));
    }
    return finish(out, 0.9, 0.05);
  }

  if (kind === 'hit') {
    let phase = 0;
    const lp = new Svf();
    for (let i = 0; i < n; i++) {
      const t = i / SFX_SAMPLE_RATE;
      phase += (2 * Math.PI * (60 + 140 * Math.exp(-t / 0.025))) / SFX_SAMPLE_RATE;
      const body = Math.sin(phase) * Math.exp(-t / 0.07);
      const slap = lp.step(noise(), 4500, 0.8).low * Math.exp(-t / 0.018);
      out[i] = Math.tanh(1.4 * (body + slap * 0.9));
    }
    return finish(out, 0.9, 0.02);
  }

  if (kind === 'whoosh') {
    // ruído com passa-banda subindo de ~350 Hz a ~5 kHz; envelope em sino que pica em ~70%
    const bp = new Svf();
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const f = 350 * Math.pow(5000 / 350, Math.pow(u, 1.4));
      const env = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 2);
      out[i] = bp.step(noise(), f, 0.35).band * env;
    }
    return finish(out, 0.85, 0.03);
  }

  // riser: subida de ruído + tom, cada vez mais alto; termina cheio, no instante do drop
  const bp = new Svf();
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const f = 300 * Math.pow(6500 / 300, u);
    const env = Math.pow(u, 2.2) * Math.min(1, i / (0.12 * SFX_SAMPLE_RATE));
    phase += (2 * Math.PI * (180 + 1500 * u * u)) / SFX_SAMPLE_RATE;
    out[i] = (bp.step(noise(), f, 0.5).band * 0.9 + Math.sin(phase) * 0.35) * env;
  }
  return finish(out, 0.85, 0.004);
}

/** WAV PCM 16 bits mono. */
export function toWav(samples: Float32Array, sampleRate = SFX_SAMPLE_RATE): Uint8Array {
  const data = samples.length * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), true);
  return new Uint8Array(buf);
}

/** Nome de arquivo estável e versionado (se o som mudar, a versão sobe e o app regrava). */
export const sfxFileName = (kind: SfxKind) => `amv-sfx-${kind}-v1.wav`;
