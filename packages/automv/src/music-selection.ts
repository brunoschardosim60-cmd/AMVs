import type { MusicAnalysis } from '@amv/analysis';
import { clipEndUs, INAUDIBLE_CLIP_GAIN_DB, type Clip, type Command, type Keyframe, type Project } from '@amv/project';

const S = 1_000_000;
const us = (s: number) => Math.round(s * S);

export type MusicDuckingPreset = 'smart' | 'gentle' | 'deep' | 'off';

export interface MusicFootageFit {
  intensities: number[];
  lowI: number;
  highI: number;
}

export interface RangeSuggestion {
  startS: number;
  endS: number;
  /** 0..1 */
  score: number;
  reasons: string[];
}

function sampleEnergy(m: MusicAnalysis, t: number): number {
  if (!m.energy.length || !Number.isFinite(m.energyStepS) || m.energyStepS <= 0) return 0.5;
  const idx = Math.min(m.energy.length - 1, Math.max(0, Math.floor(t / m.energyStepS)));
  const val = m.energy[idx];
  return typeof val === 'number' && Number.isFinite(val) ? val : 0;
}

export function averageMusicEnergy(m: MusicAnalysis, fromS: number, toS: number): number {
  const step = m.energyStepS > 0 ? m.energyStepS : 0.25;
  const start = Math.max(0, fromS);
  const end = Math.min(m.durationS, Math.max(start + step * 0.5, toS));
  let sum = 0;
  let count = 0;
  for (let t = start; t < end; t += step) {
    sum += sampleEnergy(m, t);
    count++;
  }
  return count > 0 ? sum / count : sampleEnergy(m, start);
}

function isChorusLabel(label: string): boolean {
  return /refr[aã]o|chorus|cl[ií]max|drop|coro|hook|pico/i.test(label);
}

/** Pontua a força real de um ponto de impacto/refrão para encontrar a melhor parte da música. */
export function scoreClimaxMoment(m: MusicAnalysis, anchorS: number, durationS: number): number {
  const postSpan = Math.min(14, Math.max(4, durationS * 0.42));
  const preSpan = Math.min(10, Math.max(3, durationS * 0.28));
  const postEnergy = averageMusicEnergy(m, anchorS, anchorS + postSpan);
  const preEnergy = averageMusicEnergy(m, Math.max(0, anchorS - preSpan), anchorS);
  const contrast = Math.max(0, postEnergy - preEnergy);
  const sec = m.sections.find((s) => anchorS >= s.startS - 0.5 && anchorS < s.endS);
  const secBonus = sec && isChorusLabel(sec.label) ? 0.08 : 0;
  return postEnergy * 0.65 + contrast * 0.35 + secBonus;
}

/**
 * Encontra o ponto principal de explosão/refrão da música mesmo quando há múltiplos drops
 * (ignorando transientes fracos na introdução) ou quando `m.drops` está vazio.
 */
export function pickBestMusicAnchorS(
  m: MusicAnalysis,
  durationS: number,
): { anchorS: number; hasClimax: boolean } {
  const D = Math.max(1, Math.min(durationS, m.durationS));
  if (m.drops.length === 1) {
    return { anchorS: m.drops[0]!, hasClimax: true };
  }
  if (m.drops.length > 1) {
    let bestDrop = m.drops[0]!;
    let bestScore = -1;
    for (const d of m.drops) {
      const sc = scoreClimaxMoment(m, d, D);
      if (sc > bestScore + 1e-6) {
        bestScore = sc;
        bestDrop = d;
      }
    }
    return { anchorS: bestDrop, hasClimax: true };
  }

  // Sem drops explícitos: verifica se a música tem contraste energético ou seção de refrão/clímax
  let minE = Infinity;
  let maxE = -Infinity;
  for (const v of m.energy) {
    if (!Number.isFinite(v)) continue;
    if (v < minE) minE = v;
    if (v > maxE) maxE = v;
  }
  const chorusSections = m.sections.filter((s) => isChorusLabel(s.label) && s.endS - s.startS >= 3);
  if ((!Number.isFinite(maxE) || maxE - minE < 0.1) && chorusSections.length === 0) {
    return { anchorS: 0, hasClimax: false };
  }

  const candidates = new Set<number>();
  for (const s of chorusSections) candidates.add(s.startS);
  const grid = m.downbeats.length >= 4
    ? m.downbeats
    : Array.from({ length: Math.max(1, Math.floor(m.durationS / 2)) }, (_, i) => i * 2);
  for (const t of grid) {
    if (t >= 2 && t <= Math.max(2, m.durationS - Math.min(6, D * 0.3))) candidates.add(t);
  }
  let bestAnchor = 0;
  let bestScore = -1;
  for (const c of candidates) {
    const sc = scoreClimaxMoment(m, c, D);
    if (sc > bestScore + 1e-6) {
      bestScore = sc;
      bestAnchor = c;
    }
  }
  return { anchorS: bestAnchor, hasClimax: bestScore > 0 };
}

/** Escolhe o trecho da música: o melhor drop/refrão cai em ~40% do vídeo, começando num compasso. */
export function chooseMusicRange(m: MusicAnalysis, durationS: number, startS: number | null): [number, number] {
  const D = Math.min(durationS, m.durationS);
  let s0 = startS ?? 0;
  if (startS === null) {
    const best = pickBestMusicAnchorS(m, D);
    if (best.hasClimax) {
      s0 = Math.max(0, best.anchorS - 0.4 * D);
      const db = (m.downbeats ?? []).filter((d) => d <= s0).at(-1);
      if (db !== undefined) s0 = db;
    }
  }
  s0 = Math.max(0, Math.min(s0, m.durationS - D));
  return [s0, s0 + D];
}

function windowClimaxQuality(m: MusicAnalysis, s0: number, D: number): {
  score: number;
  peakAtS: number | null;
  hasChorus: boolean;
  hasBuild: boolean;
} {
  const step = Math.max(1, D / 10);
  let bestPeak = 0;
  let peakAtS: number | null = null;
  for (let t = s0 + Math.min(1.5, D * 0.15); t <= s0 + D - Math.min(2, D * 0.2); t += step) {
    const segE = averageMusicEnergy(m, t, Math.min(s0 + D, t + Math.max(3, D * 0.3)));
    if (segE > bestPeak) {
      bestPeak = segE;
      peakAtS = t;
    }
  }
  const firstHalf = averageMusicEnergy(m, s0, s0 + D * 0.38);
  const secondHalf = averageMusicEnergy(m, s0 + D * 0.38, s0 + D * 0.88);
  const build = Math.max(0, secondHalf - firstHalf);
  const hasChorus = m.sections.some((sec) => isChorusLabel(sec.label) && sec.endS > s0 + 2 && sec.startS < s0 + D - 2);
  const score = Math.min(1, bestPeak * 0.65 + build * 0.55 + (hasChorus ? 0.14 : 0));
  return { score, peakAtS, hasChorus, hasBuild: build >= 0.15 };
}

/**
 * Compara janelas da música (começando em compassos) com as cenas disponíveis e com os picos
 * de clímax/refrão da faixa para encontrar os melhores trechos sem abafar nem perder o drop.
 */
export function suggestMusicRanges(
  m: MusicAnalysis,
  durationS: number,
  fit: MusicFootageFit | null,
  limit = 3,
): RangeSuggestion[] {
  const D = Math.min(durationS, m.durationS);
  let starts = m.downbeats.filter((d) => d + D <= m.durationS + 0.01);
  if (starts.length < 3) {
    starts = Array.from({ length: Math.max(1, Math.floor((m.durationS - D) / 2) + 1) }, (_, i) => i * 2);
  }
  const N = 12;
  const footage = fit ? [...fit.intensities].sort((a, b) => a - b) : [];
  const qAt = (k: number) => footage[Math.min(footage.length - 1, Math.floor(((k + 0.5) / N) * footage.length))]!;

  const out: RangeSuggestion[] = starts.map((s0) => {
    const reasons: string[] = [];
    const dropsInWindow = m.drops.filter((d) => d > s0 + 1 && d < s0 + D - 1);
    let dropScore = 0;
    const climax = windowClimaxQuality(m, s0, D);
    if (dropsInWindow.length > 0) {
      for (const d of dropsInWindow) {
        const posScore = 1 - Math.min(1, Math.abs((d - s0) / D - 0.4) / 0.4);
        if (posScore > dropScore) dropScore = posScore;
      }
      const bestDropInWin = dropsInWindow.sort(
        (a, b) => Math.abs((a - s0) / D - 0.4) - Math.abs((b - s0) / D - 0.4),
      )[0]!;
      if (dropScore > 0.6) {
        reasons.push(`drop aos ${Math.round(((bestDropInWin - s0) / D) * 100)}% do vídeo`);
      }
    } else if (m.drops.length === 0 && climax.score >= 0.45) {
      dropScore = climax.score * 0.78;
      if (climax.hasChorus) reasons.push('pega o refrão/clímax principal da música');
      else if (climax.hasBuild) reasons.push('subida dinâmica até o pico de energia');
      else reasons.push('trecho de maior energia da música');
    }

    let fitScore = 0.35 + 0.65 * climax.score;
    if (fit && footage.length) {
      const wanted = Array.from(
        { length: N },
        (_, k) => fit.lowI + (fit.highI - fit.lowI) * sampleEnergy(m, s0 + ((k + 0.5) / N) * D),
      ).sort((a, b) => a - b);
      const dist = wanted.reduce((acc, w, k) => acc + Math.abs(w - qAt(k)), 0) / N;
      fitScore = 1 - Math.min(1, dist / 0.5);
      if (fitScore > 0.75) reasons.push('a energia da música combina com a força das cenas escolhidas');
    } else if (climax.score >= 0.65 && !reasons.some((r) => r.includes('energia') || r.includes('refrão'))) {
      reasons.push('refrão/clímax forte e bem definido');
    }

    const startsOnSection = s0 < 0.4 || m.sections.some((x) => Math.abs(x.startS - s0) < 0.4);
    const endsOnSection = Math.abs(m.durationS - (s0 + D)) < 0.8 || m.sections.some((x) => Math.abs(x.endS - (s0 + D)) < 0.8);
    if (startsOnSection) reasons.push('começa no início de uma parte da música');
    if (endsOnSection) reasons.push('termina no fim de uma parte');

    const score = 0.4 * dropScore + 0.35 * fitScore + 0.25 * ((startsOnSection ? 0.6 : 0) + (endsOnSection ? 0.4 : 0));
    return { startS: s0, endS: s0 + D, score: Math.round(score * 1000) / 1000, reasons };
  });

  out.sort((a, b) => b.score - a.score || a.startS - b.startS);
  const picked: RangeSuggestion[] = [];
  for (const c of out) {
    if (picked.every((p) => Math.abs(p.startS - c.startS) >= D * 0.5)) picked.push(c);
    if (picked.length >= limit) break;
  }
  return picked;
}

export interface DuckingIntervalInput {
  startS: number;
  endS: number;
  preDrop?: boolean;
  /** Energia média da música neste trecho (0..1) para evitar abafar o refrão/drop. */
  musicEnergy?: number;
}

function resolveGroupDuckDb(
  preset: MusicDuckingPreset | undefined,
  preDrop: boolean,
  musicEnergy: number | undefined,
): number {
  if (preset === 'off') return 0;
  if (preset === 'gentle') return preDrop ? -7.5 : -6;
  if (preset === 'deep') return -16;
  if (preset === 'smart') {
    if (preDrop) return -13;
    if ((musicEnergy ?? 0) >= 0.68) return -8.5;
    return -11.5;
  }
  // Padrão: preserva -16 dB em falas antes do drop e trechos calmos, mas protege o clímax alto (>= 0,68) contra abafamento excessivo
  if (!preDrop && (musicEnergy ?? 0) >= 0.68) return -9.5;
  return -16;
}

/**
 * Agrupa intervalos de voz próximos sem atravessar o drop e aplica redução musical inteligente
 * para que a voz seja ouvida com clareza sem abafar a melhor parte da música.
 */
export function buildSmartDuckingKeyframes(
  intervals: DuckingIntervalInput[],
  mergeGapS: number,
  rampDownS: number,
  rampUpAfterS: number,
  options?: { preset?: MusicDuckingPreset; dropTimelineS?: number | null },
): Keyframe[] {
  const preset = options?.preset;
  if (preset === 'off' || intervals.length === 0) return [];
  const dropS = options?.dropTimelineS ?? null;
  const ordered = [...intervals].sort((a, b) => a.startS - b.startS);
  const groups: { startS: number; endS: number; preDrop: boolean; maxEnergy: number | undefined }[] = [];

  for (const curr of ordered) {
    const prev = groups.at(-1);
    const crossesDrop = prev && dropS !== null && prev.endS <= dropS + 0.05 && curr.startS >= dropS - 0.05;
    if (prev && !prev.preDrop && !curr.preDrop && !crossesDrop && curr.startS - prev.endS <= mergeGapS) {
      prev.endS = Math.max(prev.endS, curr.endS);
      if (curr.musicEnergy !== undefined) {
        prev.maxEnergy = prev.maxEnergy === undefined ? curr.musicEnergy : Math.max(prev.maxEnergy, curr.musicEnergy);
      }
    } else {
      groups.push({
        startS: curr.startS,
        endS: curr.endS,
        preDrop: !!curr.preDrop,
        maxEnergy: curr.musicEnergy,
      });
    }
  }

  const kf: Keyframe[] = [];
  for (const g of groups) {
    const duckDb = resolveGroupDuckDb(preset, g.preDrop, g.maxEnergy);
    if (duckDb === 0) continue;
    const startUs = us(g.startS);
    const downUs = us(Math.max(0, g.startS - rampDownS));
    const prevEndUs = kf.at(-1)?.atUs ?? -1;
    if (g.startS > 0 && downUs > prevEndUs) {
      kf.push({ atUs: downUs, value: 0, easing: 'linear' });
    }
    if (startUs > (kf.at(-1)?.atUs ?? -1)) {
      kf.push({ atUs: startUs, value: duckDb, easing: 'linear' });
    }
    if (g.preDrop) {
      kf.push(
        { atUs: us(Math.max(g.startS, g.endS - 0.06)), value: duckDb, easing: 'linear' },
        { atUs: us(g.endS), value: 0, easing: 'linear' },
      );
    } else {
      kf.push(
        { atUs: us(g.endS), value: duckDb, easing: 'linear' },
        { atUs: us(g.endS + rampUpAfterS), value: 0, easing: 'linear' },
      );
    }
  }
  return kf;
}

/**
 * Recalcula no editor (pós-geração) a automação de volume da música em 1 clique:
 * - 'off': música 100% limpa sem abafar (0 dB);
 * - 'gentle': redução sutil (-6 dB) nas falas;
 * - 'smart': protege o refrão/drop e reduz moderadamente nos respiros;
 * - 'deep': foco máximo nas falas (-16 dB).
 */
export function buildProjectMusicDuckingCommands(
  project: Project,
  musicClipId: string,
  preset: MusicDuckingPreset,
  musicAnalysis?: MusicAnalysis | null,
): Command[] {
  const musicClip = project.clips.find((c) => c.id === musicClipId);
  if (!musicClip) return [];

  if (preset === 'off') {
    const nextKf = { ...musicClip.keyframes };
    delete nextKf['audio.gainDb'];
    return [{
      type: 'clip.update',
      clipId: musicClip.id,
      patch: {
        audio: { ...musicClip.audio, duckingMode: 'manual' },
        keyframes: nextKf,
      },
    }];
  }

  const clipStartS = musicClip.timelineStartUs / S;
  const clipEndS = clipEndUs(musicClip) / S;
  const srcStartS = musicClip.sourceInUs / S;
  const speed = musicClip.speed || 1;
  const dropAbs = musicAnalysis?.drops.find((d) => d > srcStartS + 1 && d < srcStartS + (clipEndS - clipStartS) * speed - 1) ?? null;
  const dropLocalS = dropAbs !== null ? (dropAbs - srcStartS) / speed : null;

  const voiceIntervals: DuckingIntervalInput[] = [];
  for (const c of project.clips) {
    if (c.id === musicClip.id || !c.assetId) continue;
    const tr = project.tracks.find((t) => t.id === c.trackId);
    if (!tr || tr.muted) continue;
    const isAudible = c.audio.gainDb > INAUDIBLE_CLIP_GAIN_DB
      || Boolean(c.keyframes['audio.gainDb']?.some((k) => k.value > INAUDIBLE_CLIP_GAIN_DB));
    if (!isAudible) continue;
    const isVoiceOrScene = tr.role === 'voice' || (tr.kind === 'video' && project.audioMix.includeVideoAudio);
    if (!isVoiceOrScene) continue;
    // Ignora micro-bursts curtíssimos de impacto ("Golpe anime" <= 0,32s) para não abafar a batida da música
    if (c.label === 'Golpe anime' || c.durationUs <= 320_000) continue;
    const ovStartS = Math.max(clipStartS, c.timelineStartUs / S) - clipStartS;
    const ovEndS = Math.min(clipEndS, clipEndUs(c) / S) - clipStartS;
    if (ovEndS - ovStartS < 0.08) continue;
    const preDrop = dropLocalS !== null && Math.abs(ovEndS - dropLocalS) <= 0.35;
    const musicEnergy = musicAnalysis
      ? averageMusicEnergy(musicAnalysis, srcStartS + ovStartS * speed, srcStartS + ovEndS * speed)
      : undefined;
    voiceIntervals.push({ startS: ovStartS, endS: ovEndS, preDrop, musicEnergy });
  }

  const kf = buildSmartDuckingKeyframes(voiceIntervals, 2.0, 0.3, 0.35, {
    preset,
    dropTimelineS: dropLocalS,
  });
  const nextKf = { ...musicClip.keyframes };
  if (kf.length > 0) nextKf['audio.gainDb'] = kf;
  else delete nextKf['audio.gainDb'];

  return [{
    type: 'clip.update',
    clipId: musicClip.id,
    patch: {
      audio: { ...musicClip.audio, duckingMode: 'manual' },
      keyframes: nextKf,
    },
  }];
}
