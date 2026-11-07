/**
 * Análise de episódio a partir de estatísticas por quadro (vídeo) e PCM (áudio):
 * cortes de cena → planos; movimento, clarões e volume por plano → intensidade;
 * falas e gritos por energia na faixa de voz (ou pelas legendas, quando houver).
 */
import { mean, movingAverage, percentile, rmsFrames, stft, toDb } from './dsp.js';
import { impactScore, type Cue } from './subtitles.js';

export const EPISODE_ANALYSIS_VERSION = 'e1';

export interface FrameStat {
  t: number;
  /** Diferença para o quadro anterior (0..1) — cortes. */
  scene: number;
  /** Diferença média de luma (0..255) — movimento. */
  ydif: number;
  /** Luma média (0..255) — clarões e cenas escuras. */
  yavg: number;
}

export type ShotTag = 'ação' | 'impacto' | 'fala' | 'grito' | 'calma' | 'clarão' | 'escura';

export interface Shot {
  startS: number;
  endS: number;
  /** 0..1 relativos ao episódio. */
  motion: number;
  loud: number;
  /** 0..1 — o que o Auto AMV usa para escolher cenas de impacto. */
  intensity: number;
  brightness: number;
  tags: ShotTag[];
  /** Fala de legenda dentro do plano, se houver. */
  line: string | null;
}

export interface SpeechSegment {
  startS: number;
  endS: number;
  kind: 'fala' | 'grito';
  confidence: number;
  text: string | null;
  /** 0..1 — quão "marcante" (curta, exclamação, grito). */
  impact: number;
}

export interface EpisodeAnalysis {
  version: string;
  durationS: number;
  shots: Shot[];
  speech: SpeechSegment[];
  /** Legendas embutidas lidas do arquivo (se texto). */
  subtitles: Cue[];
  /** Intensidade 0..1 a cada `curveStepS` (para gráficos). */
  intensityCurve: number[];
  curveStepS: number;
}

/** Cortes: picos de `scene` acima do limiar, com intervalo mínimo. */
export function detectCuts(frames: FrameStat[], threshold = 0.32, minGapS = 0.35): number[] {
  const cuts: number[] = [];
  for (let i = 1; i + 1 < frames.length; i++) {
    const f = frames[i]!;
    if (f.scene < threshold) continue;
    if (f.scene < frames[i - 1]!.scene || f.scene < frames[i + 1]!.scene) continue;
    if (cuts.length && f.t - cuts.at(-1)! < minGapS) continue;
    cuts.push(f.t);
  }
  return cuts;
}

/** Energia de voz por quadro de áudio (dB) e razão da faixa 300–3400 Hz. */
export function voiceFeatures(samples: Float32Array, sampleRate: number, hopS = 0.032): { t: number[]; db: number[]; voiceRatio: number[] } {
  const size = 1024;
  const hop = Math.round(sampleRate * hopS);
  const spec = stft(samples, sampleRate, size, hop);
  const binHz = sampleRate / size;
  const v0 = Math.round(300 / binHz);
  const v1 = Math.round(3400 / binHz);
  const rms = rmsFrames(samples, hop);
  const t: number[] = [];
  const db: number[] = [];
  const voiceRatio: number[] = [];
  for (let f = 0; f < spec.mags.length; f++) {
    const m = spec.mags[f]!;
    let all = 0;
    let voice = 0;
    for (let i = 1; i < m.length; i++) {
      const e = m[i]! * m[i]!;
      all += e;
      if (i >= v0 && i <= v1) voice += e;
    }
    t.push((f * hop + size / 2) / sampleRate);
    db.push(toDb(rms[f] ?? 0));
    voiceRatio.push(all > 0 ? voice / all : 0);
  }
  return { t, db, voiceRatio };
}

/**
 * Falas e gritos sem IA: trechos com energia acima do ruído de fundo e espectro
 * concentrado na faixa de voz. Gritos = os trechos de voz mais altos. É heurístico:
 * a confiança fica moderada e as legendas (quando existem) têm prioridade.
 */
export function detectSpeech(feat: { t: number[]; db: number[]; voiceRatio: number[] }, subtitles: Cue[] = []): SpeechSegment[] {
  const out: SpeechSegment[] = [];
  if (subtitles.length) {
    // legendas: tempo exato e texto
    const loudAt = (a: number, b: number) => {
      const xs: number[] = [];
      for (let i = 0; i < feat.t.length; i++) if (feat.t[i]! >= a && feat.t[i]! <= b) xs.push(feat.db[i]!);
      return xs.length ? percentile(xs, 90) : -90;
    };
    const louds = subtitles.map((c) => loudAt(c.startS, c.endS));
    const shoutLevel = percentile(louds, 88);
    subtitles.forEach((c, i) => {
      const shout = louds[i]! >= shoutLevel && louds[i]! > -25;
      out.push({ startS: c.startS, endS: c.endS, kind: shout ? 'grito' : 'fala', confidence: 0.9, text: c.text, impact: Math.min(1, impactScore(c.text) + (shout ? 0.25 : 0)) });
    });
    return out;
  }
  const n = feat.t.length;
  if (!n) return out;
  const floor = percentile(feat.db, 20);
  const smoothRatio = movingAverage(feat.voiceRatio, 4);
  const smoothDb = movingAverage(feat.db, 3);
  const isVoice = (i: number) => smoothRatio[i]! > 0.55 && smoothDb[i]! > floor + 12;
  let start = -1;
  let gap = 0;
  const minLen = 0.3;
  const step = n > 1 ? feat.t[1]! - feat.t[0]! : 0.032;
  for (let i = 0; i <= n; i++) {
    const v = i < n && isVoice(i);
    if (v) {
      if (start < 0) start = i;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      // tolera pausas curtas entre palavras (até ~0,25 s)
      if (gap * step > 0.25 || i === n) {
        const end = i - gap;
        const a = feat.t[start]!;
        const b = feat.t[Math.max(start, end)]! + step;
        if (b - a >= minLen) out.push({ startS: a, endS: b, kind: 'fala', confidence: 0.55, text: null, impact: 0 });
        start = -1;
        gap = 0;
      }
    }
  }
  // gritos: os 12% mais altos entre os trechos de voz
  const peakOf = (s: SpeechSegment) => {
    const xs: number[] = [];
    for (let i = 0; i < n; i++) if (feat.t[i]! >= s.startS && feat.t[i]! <= s.endS) xs.push(feat.db[i]!);
    return xs.length ? percentile(xs, 90) : -90;
  };
  const peaks = out.map(peakOf);
  const lvl = percentile(peaks, 88);
  out.forEach((s, i) => {
    const dur = s.endS - s.startS;
    if (peaks[i]! >= lvl && peaks[i]! > floor + 25) {
      s.kind = 'grito';
      s.confidence = 0.5;
    }
    // curto e alto = marcante
    s.impact = Math.max(0, Math.min(1, (s.kind === 'grito' ? 0.6 : 0.2) + (dur < 2.5 ? 0.2 : 0) + (peaks[i]! - floor) / 120));
  });
  return out;
}

/** Junta tudo em planos com intensidade e etiquetas. */
export function buildEpisodeAnalysis(frames: FrameStat[], durationS: number, audioDb: { t: number[]; db: number[] }, speech: SpeechSegment[], subtitles: Cue[]): EpisodeAnalysis {
  const cuts = detectCuts(frames);
  const bounds = [0, ...cuts, durationS];
  const ydifHi = Math.max(1, percentile(frames.map((f) => f.ydif), 95));
  const dbLo = percentile(audioDb.db, 10);
  const dbHi = Math.max(dbLo + 6, percentile(audioDb.db, 98));
  const shots: Shot[] = [];
  let fi = 0;
  let ai = 0;
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = bounds[k]!;
    const b = bounds[k + 1]!;
    if (b - a < 0.2) continue;
    const fs: FrameStat[] = [];
    while (fi < frames.length && frames[fi]!.t < b) {
      if (frames[fi]!.t >= a) fs.push(frames[fi]!);
      fi++;
    }
    const dbs: number[] = [];
    while (ai < audioDb.t.length && audioDb.t[ai]! < b) {
      if (audioDb.t[ai]! >= a) dbs.push(audioDb.db[ai]!);
      ai++;
    }
    // ignora o primeiro quadro (é o corte)
    const motionRaw = mean(fs.slice(1).map((f) => f.ydif));
    const motion = Math.min(1, motionRaw / ydifHi);
    const loud = dbs.length ? Math.max(0, Math.min(1, (percentile(dbs, 90) - dbLo) / (dbHi - dbLo))) : 0;
    const brightness = mean(fs.map((f) => f.yavg)) / 255;
    const flash = fs.some((f, i) => i > 0 && f.yavg - fs[i - 1]!.yavg > 40);
    const inShot = speech.filter((s) => s.startS < b && s.endS > a);
    const tags: ShotTag[] = [];
    if (motion > 0.55) tags.push('ação');
    if (motion > 0.45 && loud > 0.7) tags.push('impacto');
    if (inShot.some((s) => s.kind === 'grito')) tags.push('grito');
    else if (inShot.length) tags.push('fala');
    if (motion < 0.15 && loud < 0.45) tags.push('calma');
    if (flash) tags.push('clarão');
    if (brightness < 0.12) tags.push('escura');
    const intensity = Math.max(0, Math.min(1, 0.55 * motion + 0.3 * loud + (flash ? 0.1 : 0) + (tags.includes('grito') ? 0.1 : 0) - (brightness < 0.06 ? 0.2 : 0)));
    const line = inShot.find((s) => s.text)?.text ?? null;
    shots.push({ startS: a, endS: b, motion: r2(motion), loud: r2(loud), intensity: r2(intensity), brightness: r2(brightness), tags, line });
  }
  const step = 1;
  const curve: number[] = [];
  for (let t = 0; t < durationS; t += step) curve.push(shots.find((s) => t >= s.startS && t < s.endS)?.intensity ?? 0);
  return { version: EPISODE_ANALYSIS_VERSION, durationS, shots, speech, subtitles, intensityCurve: Array.from(movingAverage(curve, 2), r2), curveStepS: step };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
