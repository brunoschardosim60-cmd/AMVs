/**
 * Análise de música: força de ataque (fluxo espectral) → BPM por autocorrelação →
 * batidas por programação dinâmica (Ellis 2007) → compassos (4/4) → energia →
 * seções e drop. Tudo determinístico, sem modelo de IA.
 */
import { mean, movingAverage, normalize, percentile, rmsFrames, stft, toDb } from './dsp.js';

export const MUSIC_ANALYSIS_VERSION = 'm4';

export type SectionLabel = 'intro' | 'verso' | 'pré-refrão' | 'refrão' | 'drop' | 'ponte' | 'final';
export type MusicEventType = 'onset' | 'impact' | 'growth' | 'pause' | 'drop' | 'section-change' | 'rhythm-change';
export type FrequencyBand = 'low' | 'mid' | 'high';

export interface MusicEvent {
  atS: number;
  type: MusicEventType;
  /** Heurística baseada nos sinais locais; não é uma probabilidade calibrada. */
  confidence: number;
  strength: number;
  durationS?: number;
  /** Banda espectral dominante do ataque, não identifica um instrumento. */
  band?: FrequencyBand;
  direction?: 'faster' | 'slower';
}

export interface Section {
  startS: number;
  endS: number;
  label: SectionLabel;
  /** Energia média 0..1 (relativa à música). */
  energy: number;
}

export interface MusicAnalysis {
  version: string;
  durationS: number;
  bpm: number;
  /** 0..1: quão clara é a pulsação. */
  bpmConfidence: number;
  beats: number[];
  downbeats: number[];
  /** Energia 0..1 a cada `energyStepS`. */
  energy: number[];
  energyStepS: number;
  sections: Section[];
  /** Instantes de drop (entrada forte depois de construção), do mais forte ao mais fraco. */
  drops: number[];
  /** Eventos derivados do envelope e da curva de energia. Ausente em caches antigos. */
  events?: MusicEvent[];
  /** Intensidade geral 0..100 (média da energia + densidade de ataques). */
  intensity: number;
  /** Volume médio aproximado (dBFS RMS). */
  loudnessDb: number;
}

/** Ajusta a grade detectada sem alterar a análise de energia e seções. */
export function correctTempoOctave(analysis: MusicAnalysis, direction: 'double' | 'half'): MusicAnalysis {
  const factor = direction === 'double' ? 2 : 0.5;
  const bpm = analysis.bpm * factor;
  if (bpm < 30 || bpm > 300) throw new RangeError('O BPM corrigido precisa ficar entre 30 e 300.');
  const beats = direction === 'double'
    ? analysis.beats.flatMap((beat, i, all) => i + 1 < all.length ? [beat, (beat + all[i + 1]!) / 2] : [beat])
    : analysis.beats.filter((_, i) => i % 2 === 0);
  const downbeats = direction === 'double'
    ? analysis.downbeats
    : analysis.downbeats.filter((_, i) => i % 2 === 0);
  return { ...analysis, bpm, beats, downbeats, bpmConfidence: 1 };
}

/** Recria a grade de batidas com BPM e fase definidos pelo usuário. */
export function setManualTempo(analysis: MusicAnalysis, bpm: number, anchorS: number): MusicAnalysis {
  if (!Number.isFinite(bpm) || bpm < 30 || bpm > 300) throw new RangeError('O BPM precisa ficar entre 30 e 300.');
  if (!Number.isFinite(anchorS) || anchorS < 0 || anchorS >= analysis.durationS) throw new RangeError('O ponto inicial da batida não é válido.');
  const period = 60 / bpm;
  const firstIndex = Math.ceil(-anchorS / period);
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let i = firstIndex; ; i++) {
    const time = anchorS + i * period;
    if (time >= analysis.durationS) break;
    if (time < 0) continue;
    beats.push(time);
    if (i % 4 === 0) downbeats.push(time);
  }
  if (!beats.length) throw new RangeError('Não foi possível gerar batidas para esse trecho.');
  return { ...analysis, bpm, bpmConfidence: 1, beats, downbeats };
}

export interface OnsetEnvelope {
  env: Float32Array;
  bands: [Float32Array, Float32Array, Float32Array];
  /** Quadros por segundo do envelope. */
  rate: number;
  /**
   * Deslocamento (s) do quadro 0 até o ataque que ele detecta. O quadro f cobre
   * [f·hop, f·hop+janela) e o fluxo compara com o quadro f-1: o pico aparece
   * meia janela + 1 salto depois do início do ataque. Medido com cliques sintéticos:
   * com só meia janela, toda batida saía ~24 ms adiantada.
   */
  offsetS: number;
}

/** Envelope de ataques: fluxo espectral positivo em log, suavizado. */
export function onsetEnvelope(samples: Float32Array, sampleRate: number): OnsetEnvelope {
  const hop = 512;
  const spec = stft(samples, sampleRate, 2048, hop);
  const n = spec.mags.length;
  // fluxo por faixa (grave, médio, agudo), cada uma normalizada: o bumbo pesa tanto quanto a caixa
  const binHz = sampleRate / spec.size;
  const bands: [number, number][] = [
    [Math.max(1, Math.round(30 / binHz)), Math.round(200 / binHz)],
    [Math.round(200 / binHz), Math.round(2000 / binHz)],
    [Math.round(2000 / binHz), Math.min(spec.size / 2, Math.round(8000 / sampleRate * spec.size))],
  ];
  const env = new Float32Array(n);
  const bandEnvelopes: Float32Array[] = [];
  for (const [lo, hi] of bands) {
    const band = new Float32Array(n);
    let prevB: Float32Array | null = null;
    for (let f = 0; f < n; f++) {
      const m = spec.mags[f]!;
      const lm = new Float32Array(hi - lo);
      for (let i = lo; i < hi; i++) lm[i - lo] = Math.log1p(100 * m[i]!);
      if (prevB) {
        let s2 = 0;
        for (let i = 0; i < lm.length; i++) {
          const d = lm[i]! - prevB[i]!;
          if (d > 0) s2 += d;
        }
        band[f] = s2;
      }
      prevB = lm;
    }
    const nb = normalize(band);
    bandEnvelopes.push(nb);
    for (let f = 0; f < n; f++) env[f] = env[f]! + nb[f]!;
  }
  // remove a tendência local (deixa só os picos)
  const trend = movingAverage(env, 8);
  for (let i = 0; i < n; i++) env[i] = Math.max(0, env[i]! - trend[i]!);
  return {
    env: normalize(env),
    bands: bandEnvelopes as OnsetEnvelope['bands'],
    rate: sampleRate / hop,
    offsetS: (2048 / 2 + hop) / sampleRate,
  };
}

/** BPM por autocorrelação do envelope, com preferência suave por 90–160 BPM. */
export function estimateTempo(o: OnsetEnvelope, minBpm = 60, maxBpm = 200): { bpm: number; confidence: number } {
  const { env, rate } = o;
  const minLag = Math.floor((60 * rate) / maxBpm);
  const maxLag = Math.ceil((60 * rate) / minBpm);
  const ac: number[] = [];
  const m = mean(env);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < env.length; i++) s += (env[i]! - m) * (env[i + lag]! - m);
    ac.push(s / (env.length - lag));
  }
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < ac.length; i++) {
    const lag = minLag + i;
    const bpm = (60 * rate) / lag;
    // prior log-normal centrado em 120 BPM
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    // reforço por harmônico (lag*2) ajuda a não cair no dobro/metade errado
    const h2 = i + lag < ac.length ? ac[i + lag]! : 0;
    const score = (ac[i]! + 0.5 * Math.max(0, h2)) * prior;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  // refinamento sub-quadro (parábola)
  const i = best - minLag;
  let lag = best;
  if (i > 0 && i < ac.length - 1) {
    const a = ac[i - 1]!;
    const b = ac[i]!;
    const c = ac[i + 1]!;
    const d = a - 2 * b + c;
    if (d !== 0) lag += (0.5 * (a - c)) / d;
  }
  // erro de oitava: se a metade do período também pulsa forte, o tempo real é o dobro
  const acAt = (l: number) => {
    const k = Math.round(l) - minLag;
    return k >= 0 && k < ac.length ? ac[k]! : (() => {
      let s2 = 0;
      const L = Math.round(l);
      for (let q = 0; q + L < env.length; q++) s2 += (env[q]! - m) * (env[q + L]! - m);
      return s2 / Math.max(1, env.length - L);
    })();
  };
  if ((60 * rate) / lag < 100 && acAt(lag / 2) > 0.3 * acAt(lag)) lag /= 2;
  const peak = ac[i] ?? 0;
  const confidence = Math.max(0, Math.min(1, peak / (Math.max(...ac.map(Math.abs)) || 1)));
  const sorted = [...ac].sort((x, y) => y - x);
  const contrast = sorted[0]! > 0 ? 1 - Math.max(0, mean(sorted.slice(Math.floor(sorted.length / 2)))) / sorted[0]! : 0;
  return { bpm: (60 * rate) / lag, confidence: Math.max(0, Math.min(1, 0.5 * confidence + 0.5 * contrast)) };
}

/** Batidas por programação dinâmica: cada batida num pico de ataque, espaçadas ~1 período. */
export function trackBeats(o: OnsetEnvelope, bpm: number, tightness = 100): number[] {
  const { env, rate } = o;
  const period = (60 * rate) / bpm;
  const n = env.length;
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let best = 0;
    let arg = -1;
    const lo = Math.max(0, Math.round(i - 2 * period));
    const hi = Math.round(i - period / 2);
    for (let j = lo; j <= hi; j++) {
      const pen = -tightness * Math.pow(Math.log((i - j) / period), 2);
      const v = score[j]! + pen;
      if (arg < 0 || v > best) {
        best = v;
        arg = j;
      }
    }
    score[i] = env[i]! + (arg >= 0 ? Math.max(0, best) : 0);
    back[i] = arg >= 0 && best > 0 ? arg : -1;
  }
  // começa do melhor ponto no último período
  let end = n - 1;
  let bestEnd = -Infinity;
  for (let i = Math.max(0, Math.floor(n - period)); i < n; i++) {
    if (score[i]! > bestEnd) {
      bestEnd = score[i]!;
      end = i;
    }
  }
  const beats: number[] = [];
  for (let i = end; i >= 0; i = back[i]!) {
    // refina o pico entre quadros (parábola): sem isso o erro chega a meio quadro de análise (~12 ms)
    const a = env[i - 1] ?? env[i]!;
    const b = env[i]!;
    const c = env[i + 1] ?? env[i]!;
    const d = a - 2 * b + c;
    const frac = d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0;
    beats.push((i + frac) / rate + o.offsetS);
    if (back[i] === -1) break;
  }
  beats.reverse();
  // completa para trás até o início com o período, se a música começa com pausa
  return beats;
}

/** Compassos 4/4: escolhe a fase (0–3) cujas batidas têm mais ataque/grave. */
export function downbeatsFrom(beats: number[], o: OnsetEnvelope): number[] {
  if (beats.length < 8) return beats.filter((_, i) => i % 4 === 0);
  const strength = beats.map((t) => {
    const i = Math.round((t - o.offsetS) * o.rate);
    let s = 0;
    for (let k = -2; k <= 2; k++) s += o.env[i + k] ?? 0;
    return s;
  });
  let bestPhase = 0;
  let best = -1;
  for (let ph = 0; ph < 4; ph++) {
    let s = 0;
    let c = 0;
    for (let i = ph; i < beats.length; i += 4) {
      s += strength[i]!;
      c++;
    }
    if (c && s / c > best) {
      best = s / c;
      bestPhase = ph;
    }
  }
  return beats.filter((_, i) => i % 4 === bestPhase);
}

/** Energia (RMS em dB normalizada 0..1) a cada `stepS`. */
export function energyCurve(samples: Float32Array, sampleRate: number, stepS = 0.25): { energy: number[]; loudnessDb: number } {
  const win = Math.max(1, Math.round(sampleRate * stepS));
  const rms = rmsFrames(samples, win);
  const db = Array.from(rms, toDb);
  const lo = percentile(db, 5);
  const hi = percentile(db, 98);
  const span = Math.max(6, hi - lo);
  const energy = db.map((d) => Math.max(0, Math.min(1, (d - lo) / span)));
  return { energy: Array.from(movingAverage(energy, 2)), loudnessDb: toDb(Math.sqrt(mean(Array.from(rms, (r) => r * r)))) };
}

/**
 * Seções: divide nos compassos onde a energia muda bastante (blocos de 4 ou 8
 * compassos) e dá nome pela energia relativa e posição. Drop = maior salto de
 * energia num início de compasso, depois de um trecho mais baixo.
 */
export function findSections(downbeats: number[], energy: number[], stepS: number, durationS: number, beats: number[] = []): { sections: Section[]; drops: number[] } {
  const eAt = (a: number, b: number) => {
    const i0 = Math.floor(a / stepS);
    const i1 = Math.max(i0 + 1, Math.floor(b / stepS));
    return mean(energy.slice(i0, i1));
  };
  // ---- drops, com precisão de batida: compara os 4 s antes e depois de CADA batida (não só a
  // cada 4 compassos: um drop fora dessa grade era perdido ou saía 1-2 s atrasado)
  const downSet = new Set(downbeats.map((d) => Math.round(d * 100)));
  const cand = (beats.length >= 8 ? beats : downbeats).filter((t) => t >= 4 && t <= durationS - 2);
  const hiE = percentile(energy, 75);
  const scored = cand
    .map((t) => {
      const before = eAt(Math.max(0, t - 4), t);
      const after = eAt(t, Math.min(durationS, t + 4));
      return { at: t, jump: after - before, after, score: after - before + (downSet.has(Math.round(t * 100)) ? 0.02 : 0) };
    })
    .filter((c) => c.jump > 0.12 && c.after >= hiE - 0.05)
    .sort((a, b) => b.score - a.score);
  const jumps: { at: number; jump: number }[] = [];
  for (const c of scored) if (jumps.every((j) => Math.abs(j.at - c.at) >= 8)) jumps.push({ at: c.at, jump: c.jump });
  const drops = jumps.slice(0, 6).map((j) => j.at);

  // seções: blocos de 4 compassos (ou 8 s se não houver compassos confiáveis), com um limite exatamente em cada drop
  const base: number[] = downbeats.length >= 8 ? downbeats.filter((_, i) => i % 4 === 0) : Array.from({ length: Math.ceil(durationS / 8) }, (_, i) => i * 8);
  const grid = [...base.filter((g) => drops.every((d) => Math.abs(g - d) >= 2)), ...drops, 0].sort((a, b) => a - b);
  const uniq: number[] = [];
  for (const g of grid) if (!uniq.length || g - uniq.at(-1)! > 0.01) uniq.push(g);
  grid.length = 0;
  grid.push(...uniq, durationS);
  // junta blocos vizinhos com energia parecida (nunca atravessa um drop)
  const dropAt = new Set(drops);
  const blocks: { s: number; e: number; en: number }[] = [];
  for (let i = 0; i + 1 < grid.length; i++) {
    const s = grid[i]!;
    const e = grid[i + 1]!;
    if (e - s < 0.5) continue;
    const en = eAt(s, e);
    const prev = blocks.at(-1);
    if (prev && !dropAt.has(s) && Math.abs(prev.en - en) < 0.08) {
      prev.e = e;
      prev.en = eAt(prev.s, e);
    } else blocks.push({ s, e, en });
  }
  const ens = blocks.map((b) => b.en);
  const hi = percentile(ens, 75);
  const lo = percentile(ens, 30);
  const dropSet = new Set(drops.slice(0, 3));

  if (blocks[0]) blocks[0].s = 0;
  const sections: Section[] = blocks.map((b, i) => {
    let label: SectionLabel;
    if (i === 0 && b.en <= hi) label = 'intro';
    else if (i === blocks.length - 1 && b.en < hi) label = 'final';
    else if (dropSet.has(b.s)) label = drops[0] === b.s && b.en >= hi ? 'drop' : 'refrão';
    else if (b.en >= hi) label = 'refrão';
    else if (blocks[i + 1] && dropSet.has(blocks[i + 1]!.s)) label = 'pré-refrão';
    else if (b.en <= lo && i > 0) label = 'ponte';
    else label = 'verso';
    return { startS: b.s, endS: b.e, label, energy: Math.round(b.en * 100) / 100 };
  });
  return { sections, drops };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function detectMusicEvents(
  onset: OnsetEnvelope,
  energy: number[],
  stepS: number,
  durationS: number,
  bpmConfidence: number,
  sections: Section[],
  drops: number[],
): MusicEvent[] {
  const events: MusicEvent[] = [];
  const energyAt = (atS: number) => energy[Math.max(0, Math.min(energy.length - 1, Math.floor(atS / stepS)))] ?? 0;
  const onsetThreshold = Math.max(0.24, onset.env.reduce((sum, value) => sum + value, 0) / Math.max(1, onset.env.length) * 2.5);
  const minGap = Math.max(1, Math.round(onset.rate * 0.075));
  let lastPeak = -minGap;
  for (let i = 1; i + 1 < onset.env.length; i++) {
    const strength = onset.env[i]!;
    if (strength < onsetThreshold || strength < onset.env[i - 1]! || strength <= onset.env[i + 1]!) continue;
    if (i - lastPeak < minGap) continue;
    lastPeak = i;
    const atS = i / onset.rate + onset.offsetS;
    if (atS < 0 || atS >= durationS) continue;
    const bandStrengths = onset.bands.map((band) => band[i] ?? 0);
    const bandIndex = bandStrengths.indexOf(Math.max(...bandStrengths));
    const band: FrequencyBand = bandIndex === 0 ? 'low' : bandIndex === 1 ? 'mid' : 'high';
    const confidence = clamp01(strength * (0.5 + 0.5 * bpmConfidence));
    events.push({ atS, type: 'onset', confidence, strength, band });
    if (band === 'low' && strength >= 0.62 && energyAt(atS) >= 0.55) {
      events.push({ atS, type: 'impact', confidence: clamp01(confidence * energyAt(atS)), strength, band });
    }
  }

  const growthCandidates: { atS: number; strength: number }[] = [];
  for (let atS = 0; atS + 4 <= durationS; atS += 1) {
    const levels = Array.from({ length: 4 }, (_, second) =>
      median(Array.from({ length: Math.max(1, Math.round(1 / stepS)) }, (_, i) => energyAt(atS + second + i * stepS))),
    );
    const rises = levels.slice(1).map((level, index) => level - levels[index]!);
    const rise = levels.at(-1)! - levels[0]!;
    const largestStep = Math.max(...rises);
    if (rise >= 0.16 && rises.filter((delta) => delta > 0.015).length >= 2
      && largestStep < rise * 0.7 && rises.every((delta) => delta >= -0.08)) {
      growthCandidates.push({ atS, strength: rise });
    }
  }
  for (let i = 0; i < growthCandidates.length;) {
    const first = growthCandidates[i]!;
    let end = first.atS + 4;
    let strength = first.strength;
    while (i + 1 < growthCandidates.length && growthCandidates[i + 1]!.atS <= end) {
      i++;
      end = Math.max(end, growthCandidates[i]!.atS + 4);
      strength = Math.max(strength, growthCandidates[i]!.strength);
    }
    events.push({
      atS: first.atS,
      type: 'growth',
      durationS: Math.min(durationS - first.atS, end - first.atS),
      confidence: clamp01(0.45 + strength),
      strength,
    });
    i++;
  }

  let pauseStart: number | null = null;
  for (let i = 0; i <= energy.length; i++) {
    const atS = i * stepS;
    const quiet = i < energy.length && energy[i]! <= 0.08;
    if (quiet && pauseStart === null) pauseStart = atS;
    if ((!quiet || i === energy.length) && pauseStart !== null) {
      const duration = Math.min(durationS, atS) - pauseStart;
      if (duration >= 0.5) {
        events.push({
          atS: pauseStart,
          type: 'pause',
          durationS: duration,
          confidence: clamp01(0.55 + Math.min(0.35, (0.5 - median(energy)) * 0.7)),
          strength: clamp01(1 - median(energy.slice(Math.floor(pauseStart / stepS), i))),
        });
      }
      pauseStart = null;
    }
  }

  for (const atS of drops) {
    const before = median(Array.from({ length: 16 }, (_, i) => energyAt(Math.max(0, atS - 4 + i * stepS))));
    const after = median(Array.from({ length: 16 }, (_, i) => energyAt(atS + i * stepS)));
    const rise = Math.max(0, after - before);
    events.push({ atS, type: 'drop', confidence: clamp01(0.5 + rise), strength: rise });
  }
  for (const [index, section] of sections.slice(1).entries()) {
    events.push({
      atS: section.startS,
      type: 'section-change',
      confidence: 0.55,
      strength: Math.abs(section.energy - (sections[index]?.energy ?? section.energy)),
    });
  }

  const onsets = events.filter((event) => event.type === 'onset').map((event) => event.atS);
  let lastRhythmChangeS = -Infinity;
  for (let atS = 4; atS + 4 <= durationS; atS += 2) {
    const before = onsets.filter((time) => time >= atS - 4 && time < atS).map((time, i, all) => i ? time - all[i - 1]! : 0).filter((value) => value > 0);
    const after = onsets.filter((time) => time >= atS && time < atS + 4).map((time, i, all) => i ? time - all[i - 1]! : 0).filter((value) => value > 0);
    if (before.length < 3 || after.length < 3) continue;
    const previousInterval = median(before);
    const nextInterval = median(after);
    const variation = Math.abs(nextInterval - previousInterval) / Math.max(0.01, previousInterval);
    if (variation >= 0.3 && atS - lastRhythmChangeS >= 4) {
      events.push({
        atS,
        type: 'rhythm-change',
        confidence: clamp01(0.45 + variation * 0.35),
        strength: variation,
        direction: nextInterval < previousInterval ? 'faster' : 'slower',
      });
      lastRhythmChangeS = atS;
    }
  }

  return events
    .filter((event) => Number.isFinite(event.atS) && event.atS >= 0 && event.atS < durationS)
    .sort((a, b) => a.atS - b.atS || a.type.localeCompare(b.type));
}

/** Análise completa a partir de PCM mono float. */
export function analyzeMusic(samples: Float32Array, sampleRate: number): MusicAnalysis {
  const durationS = samples.length / sampleRate;
  const o = onsetEnvelope(samples, sampleRate);
  let { bpm, confidence } = estimateTempo(o);
  // leva para a faixa usual de edição (70–180)
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  const beats = trackBeats(o, bpm);
  const downbeats = downbeatsFrom(beats, o);
  const stepS = 0.25;
  const { energy, loudnessDb } = energyCurve(samples, sampleRate, stepS);
  const { sections, drops } = findSections(downbeats, energy, stepS, durationS, beats);
  const events = detectMusicEvents(o, energy, stepS, durationS, confidence, sections, drops);
  const onsetDensity = mean(Array.from(o.env).map((v) => (v > 0.3 ? 1 : 0))) * o.rate; // ataques/s
  const intensity = Math.round(Math.max(0, Math.min(100, 70 * mean(energy) + 6 * Math.min(5, onsetDensity))));
  return {
    version: MUSIC_ANALYSIS_VERSION,
    durationS,
    bpm: Math.round(bpm * 10) / 10,
    bpmConfidence: Math.round(confidence * 100) / 100,
    beats: beats.map((b) => Math.round(b * 1000) / 1000),
    downbeats: downbeats.map((b) => Math.round(b * 1000) / 1000),
    energy: energy.map((e) => Math.round(e * 1000) / 1000),
    energyStepS: stepS,
    sections,
    drops: drops.map((d) => Math.round(d * 1000) / 1000),
    events: events.map((event) => ({
      ...event,
      atS: Math.round(event.atS * 1000) / 1000,
      ...(event.durationS === undefined ? {} : { durationS: Math.round(event.durationS * 1000) / 1000 }),
      confidence: Math.round(event.confidence * 100) / 100,
      strength: Math.round(event.strength * 1000) / 1000,
    })),
    intensity,
    loudnessDb: Math.round(loudnessDb * 10) / 10,
  };
}
