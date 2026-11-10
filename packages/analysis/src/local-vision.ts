import type { EpisodeAnalysis, Shot } from './episode.js';
import type { LocalSceneType, ShotVision, VisionScope, VisionTarget } from './vision.js';

export const LOCAL_VISION_VERSION = 3;
const GRID_W = 8;
const GRID_H = 8;
const FLOW_W = 32;
const FLOW_H = 18;

export type CameraMotionType =
  | 'pan-horizontal'
  | 'pan-vertical'
  | 'zoom-in'
  | 'zoom-out'
  | 'rotation'
  | 'travelling'
  | 'static'
  | 'unknown';

export interface MotionEvent {
  startS: number;
  endS: number;
  cameraMotion: CameraMotionType;
  /** Direção do movimento aparente do conteúdo, em graus; 0° aponta para a direita. */
  directionDeg: number | null;
  /** Velocidade aparente normalizada pela diagonal do quadro, por segundo. */
  speed: number;
  scaleSpeed: number;
  /** Confiança da estimativa de fluxo (0..1), não da causa física do movimento. */
  confidence: number;
  /** Movimento localizado após remover a translação global; não identifica personagens. */
  subjectMotion: { directionDeg: number | null; speed: number; confidence: number };
  /** Zoom aparente; câmera e aproximação de um objeto não são distinguíveis em 2D. */
  apparentScaleChange: 'in' | 'out' | 'none' | 'unknown';
  abruptFramingChange: boolean;
}

export interface RgbFrame {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface LocalVisualFeatures {
  version: typeof LOCAL_VISION_VERSION;
  samples: number;
  lumaGrid: number[];
  edgeGrid: number[];
  colorHistogram: number[];
  /** Paleta aproximada por quantização RGB 4×4×4 dos quadros amostrados. */
  dominantColors?: string[];
  brightness: number;
  saturation: number;
  entropy: number;
  edgeDensity: number;
  centerOfVisualMass: [number, number];
  temporalMotion: number;
  globalShift: [number, number];
  globalMotion: number;
  motionEvents: MotionEvent[];
  motionConfidence: number;
  fingerprint: string;
  sceneType: LocalSceneType;
  sceneTypeConfidence: number;
  similarScenes?: SimilarVisualScene[];
}

export interface SimilarVisualScene {
  key: string;
  similarity: number;
}

export interface LocalVisionTarget extends VisionTarget {
  samples: number[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function quantizeHash(values: number[]): string {
  let hash = 2166136261;
  for (const value of values) {
    hash = Math.imul(hash ^ Math.round(clamp01(value) * 31), 16777619);
  }
  return `lv3-${(hash >>> 0).toString(36)}`;
}

function luminance(frame: RgbFrame, x: number, y: number): number {
  const offset = (y * frame.width + x) * 3;
  return (0.2126 * frame.data[offset]! + 0.7152 * frame.data[offset + 1]! + 0.0722 * frame.data[offset + 2]!) / 255;
}

function describeFrame(frame: RgbFrame): {
  luma: number[];
  edges: number[];
  histogram: number[];
  rgbBins: number[];
  brightness: number;
  saturation: number;
  entropy: number;
  edgeDensity: number;
  center: [number, number];
} {
  if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width < 2 || frame.height < 2
    || frame.data.length !== frame.width * frame.height * 3) {
    throw new Error('quadro RGB inválido');
  }
  const luma = Array.from({ length: GRID_W * GRID_H }, () => 0);
  const counts = Array.from({ length: luma.length }, () => 0);
  const histogram = Array.from({ length: 12 }, () => 0);
  const rgbBins = Array.from({ length: 64 }, () => 0);
  const bins = Array.from({ length: 32 }, () => 0);
  let brightness = 0;
  let saturation = 0;
  const step = Math.max(1, Math.floor(Math.min(frame.width, frame.height) / 48));
  let pixels = 0;
  for (let y = 0; y < frame.height; y += step) {
    for (let x = 0; x < frame.width; x += step) {
      const offset = (y * frame.width + x) * 3;
      const r = frame.data[offset]! / 255;
      const g = frame.data[offset + 1]! / 255;
      const b = frame.data[offset + 2]! / 255;
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const cellX = Math.min(GRID_W - 1, Math.floor(x * GRID_W / frame.width));
      const cellY = Math.min(GRID_H - 1, Math.floor(y * GRID_H / frame.height));
      const cell = cellY * GRID_W + cellX;
      luma[cell]! += gray;
      counts[cell]!++;
      histogram[Math.min(3, Math.floor(r * 4))]!++;
      histogram[4 + Math.min(3, Math.floor(g * 4))]!++;
      histogram[8 + Math.min(3, Math.floor(b * 4))]!++;
      rgbBins[Math.min(3, Math.floor(r * 4)) * 16 + Math.min(3, Math.floor(g * 4)) * 4 + Math.min(3, Math.floor(b * 4))]!++;
      bins[Math.min(31, Math.floor(gray * 32))]!++;
      brightness += gray;
      saturation += Math.max(r, g, b) - Math.min(r, g, b);
      pixels++;
    }
  }
  for (let i = 0; i < luma.length; i++) luma[i] = counts[i] ? luma[i]! / counts[i]! : 0;
  for (let channel = 0; channel < 3; channel++) {
    const start = channel * 4;
    const total = histogram.slice(start, start + 4).reduce((sum, count) => sum + count, 0) || 1;
    for (let i = start; i < start + 4; i++) histogram[i] = histogram[i]! / total;
  }
  const histogramTotal = bins.reduce((sum, count) => sum + count, 0) || 1;
  const rgbTotal = pixels || 1;
  for (let i = 0; i < rgbBins.length; i++) rgbBins[i] = rgbBins[i]! / rgbTotal;
  const entropy = -bins.reduce((sum, count) => {
    if (!count) return sum;
    const p = count / histogramTotal;
    return sum + p * Math.log2(p);
  }, 0) / 5;

  const edges = Array.from({ length: 16 }, () => 0);
  let edgeSum = 0;
  let edgeSamples = 0;
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const x0 = Math.max(1, Math.floor(gx * frame.width / 4));
      const x1 = Math.min(frame.width - 1, Math.floor((gx + 1) * frame.width / 4));
      const y0 = Math.max(1, Math.floor(gy * frame.height / 4));
      const y1 = Math.min(frame.height - 1, Math.floor((gy + 1) * frame.height / 4));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y += step) {
        for (let x = x0; x < x1; x += step) {
          const dx = Math.abs(luminance(frame, x + 1, y) - luminance(frame, x - 1, y));
          const dy = Math.abs(luminance(frame, x, y + 1) - luminance(frame, x, y - 1));
          const magnitude = Math.min(1, (dx + dy) * 2);
          sum += magnitude;
          n++;
          edgeSum += magnitude;
          edgeSamples++;
        }
      }
      edges[gy * 4 + gx] = n ? sum / n : 0;
    }
  }
  let massX = 0;
  let massY = 0;
  let massWeight = 0;
  for (let y = 0; y < frame.height; y += step * 2) {
    for (let x = 0; x < frame.width; x += step * 2) {
      const weight = Math.abs(luminance(frame, Math.min(frame.width - 1, x + 1), y) - luminance(frame, Math.max(0, x - 1), y))
        + Math.abs(luminance(frame, x, Math.min(frame.height - 1, y + 1)) - luminance(frame, x, Math.max(0, y - 1))) + 0.001;
      massX += (x / Math.max(1, frame.width - 1)) * weight;
      massY += (y / Math.max(1, frame.height - 1)) * weight;
      massWeight += weight;
    }
  }
  return {
    luma,
    edges,
    histogram,
    rgbBins,
    brightness: pixels ? brightness / pixels : 0,
    saturation: pixels ? saturation / pixels : 0,
    entropy: clamp01(entropy),
    edgeDensity: edgeSum / Math.max(1, edgeSamples),
    center: [massWeight ? massX / massWeight : 0.5, massWeight ? massY / massWeight : 0.5],
  };
}

function estimateShift(a: number[], b: number[]): [number, number, number] {
  let bestX = 0;
  let bestY = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      let error = 0;
      let n = 0;
      for (let y = 2; y < GRID_H - 2; y++) {
        for (let x = 2; x < GRID_W - 2; x++) {
          const otherX = x + dx;
          const otherY = y + dy;
          if (otherX < 0 || otherX >= GRID_W || otherY < 0 || otherY >= GRID_H) continue;
          error += Math.abs(a[y * GRID_W + x]! - b[otherY * GRID_W + otherX]!);
          n++;
        }
      }
      const score = n ? error / n : 1;
      if (score < best) {
        best = score;
        bestX = dx;
        bestY = dy;
      }
    }
  }
  return [bestX / GRID_W, bestY / GRID_H, clamp01(best)];
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function grayGrid(frame: RgbFrame): number[] {
  const values: number[] = [];
  for (let y = 0; y < FLOW_H; y++) {
    const sourceY = Math.min(frame.height - 1, Math.floor((y + 0.5) * frame.height / FLOW_H));
    for (let x = 0; x < FLOW_W; x++) {
      const sourceX = Math.min(frame.width - 1, Math.floor((x + 0.5) * frame.width / FLOW_W));
      values.push(luminance(frame, sourceX, sourceY));
    }
  }
  return values;
}

interface FlowVector {
  x: number;
  y: number;
  dx: number;
  dy: number;
  uniqueness: number;
}

function estimateSparseFlow(a: number[], b: number[]): { vectors: FlowVector[]; support: number } {
  const vectors: FlowVector[] = [];
  let candidates = 0;
  const at = (data: number[], x: number, y: number) => data[y * FLOW_W + x]!;
  for (let y = 3; y < FLOW_H - 3; y += 3) {
    for (let x = 3; x < FLOW_W - 3; x += 4) {
      candidates++;
      let texture = 0;
      for (let py = -1; py <= 1; py++) {
        for (let px = -1; px <= 1; px++) {
          texture += Math.abs(at(a, x + px + 1, y + py) - at(a, x + px - 1, y + py))
            + Math.abs(at(a, x + px, y + py + 1) - at(a, x + px, y + py - 1));
        }
      }
      if (texture / 18 < 0.025) continue;

      let best = Number.POSITIVE_INFINITY;
      let second = Number.POSITIVE_INFINITY;
      let bestX = 0;
      let bestY = 0;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (x + dx < 1 || x + dx >= FLOW_W - 1 || y + dy < 1 || y + dy >= FLOW_H - 1) continue;
          let error = 0;
          for (let py = -1; py <= 1; py++) {
            for (let px = -1; px <= 1; px++) {
              error += Math.abs(at(a, x + px, y + py) - at(b, x + dx + px, y + dy + py));
            }
          }
          error /= 9;
          if (error < best) {
            second = best;
            best = error;
            bestX = dx;
            bestY = dy;
          } else if (error < second) second = error;
        }
      }
      const uniqueness = clamp01((second - best) / Math.max(0.04, second));
      if (best > 0.22 || uniqueness < 0.08) continue;
      vectors.push({ x, y, dx: bestX, dy: bestY, uniqueness });
    }
  }
  return { vectors, support: vectors.length / Math.max(1, candidates) };
}

function estimateMotionEvent(previous: RgbFrame, current: RgbFrame, startS: number, endS: number): MotionEvent {
  const unknown: MotionEvent = {
    startS, endS, cameraMotion: 'unknown', directionDeg: null, speed: 0, scaleSpeed: 0, confidence: 0,
    subjectMotion: { directionDeg: null, speed: 0, confidence: 0 },
    apparentScaleChange: 'unknown', abruptFramingChange: false,
  };
  const duration = endS - startS;
  if (duration <= 0 || previous.width !== current.width || previous.height !== current.height) return unknown;
  const { vectors, support } = estimateSparseFlow(grayGrid(previous), grayGrid(current));
  if (vectors.length < 5) return unknown;

  const dx = median(vectors.map((vector) => vector.dx));
  const dy = median(vectors.map((vector) => vector.dy));
  const residuals = vectors.map((vector) => Math.hypot(vector.dx - dx, vector.dy - dy));
  const inlierRatio = residuals.filter((residual) => residual <= 1.5).length / vectors.length;
  const uniqueness = median(vectors.map((vector) => vector.uniqueness));
  const supportConfidence = Math.min(1, support / 0.25);
  const diagonal = Math.hypot(FLOW_W, FLOW_H);
  const speed = Math.hypot(dx, dy) / diagonal / duration;
  const directionDeg = speed > 0.002 ? Math.atan2(dy, dx) * 180 / Math.PI : null;

  let radial = 0;
  let tangential = 0;
  const radialFlows: number[] = [];
  const tangentialFlows: number[] = [];
  for (const vector of vectors) {
    const rx = vector.x - (FLOW_W - 1) / 2;
    const ry = vector.y - (FLOW_H - 1) / 2;
    const radius = Math.max(1, Math.hypot(rx, ry));
    radialFlows.push((vector.dx * rx + vector.dy * ry) / radius);
    tangentialFlows.push((-vector.dx * ry + vector.dy * rx) / radius);
  }
  radial = median(radialFlows);
  tangential = median(tangentialFlows);
  const radialSpeed = Math.abs(radial) / diagonal / duration;
  const rotationSpeed = Math.abs(tangential) / diagonal / duration;
  const radialAgreement = radialFlows.filter((value) => Math.sign(value) === Math.sign(radial) && Math.abs(value) >= 0.5).length / vectors.length;
  const rotationAgreement = tangentialFlows.filter((value) => Math.sign(value) === Math.sign(tangential) && Math.abs(value) >= 0.5).length / vectors.length;
  const translationConfidence = supportConfidence * 0.35 + inlierRatio * 0.4 + uniqueness * 0.25;
  const zoomConfidence = supportConfidence * 0.25 + radialAgreement * 0.5 + uniqueness * 0.25;
  const rotationConfidence = supportConfidence * 0.25 + rotationAgreement * 0.5 + uniqueness * 0.25;
  const confidence = clamp01(Math.max(
    translationConfidence,
    radialSpeed >= 0.006 ? zoomConfidence : 0,
    rotationSpeed >= 0.006 ? rotationConfidence : 0,
  ));
  const movingResiduals = vectors
    .map((vector, index) => ({ vector, residual: residuals[index]! }))
    .filter((item) => item.residual >= 0.75);
  const subjectSpeed = (movingResiduals.length ? median(movingResiduals.map((item) => item.residual)) : 0) / diagonal / duration;
  const subjectRatio = movingResiduals.length / vectors.length;
  const subjectConfidence = clamp01(confidence * Math.min(1, subjectRatio / 0.25) * Math.min(1, subjectSpeed / 0.025));
  const subjectDirectionX = movingResiduals.length
    ? median(movingResiduals.map(({ vector }) => vector.dx - dx))
    : 0;
  const subjectDirectionY = movingResiduals.length
    ? median(movingResiduals.map(({ vector }) => vector.dy - dy))
    : 0;
  const motionThreshold = 0.006;
  const apparentScaleChange = radialSpeed < motionThreshold ? 'none' : radial > 0 ? 'in' : 'out';

  let cameraMotion: CameraMotionType = 'unknown';
  if (confidence >= 0.6) {
    if (speed < motionThreshold && radialSpeed < motionThreshold && rotationSpeed < motionThreshold) {
      cameraMotion = 'static';
    } else if (rotationSpeed > Math.max(speed * 0.65, motionThreshold)) {
      cameraMotion = 'rotation';
    } else if (radialSpeed > Math.max(speed * 0.25, 0.008)) {
      cameraMotion = radial > 0 ? 'zoom-in' : 'zoom-out';
    } else if (Math.hypot(dx, dy) >= 1.5 && subjectSpeed > speed * 0.9) {
      cameraMotion = 'travelling';
    } else if (Math.abs(dx) > Math.abs(dy) * 1.35) {
      cameraMotion = 'pan-horizontal';
    } else if (Math.abs(dy) > Math.abs(dx) * 1.35) {
      cameraMotion = 'pan-vertical';
    } else {
      cameraMotion = 'travelling';
    }
  }
  return {
    startS,
    endS,
    cameraMotion,
    directionDeg,
    speed: clamp01(speed),
    scaleSpeed: clamp01(radialSpeed),
    confidence,
    subjectMotion: {
      directionDeg: subjectConfidence >= 0.6 && subjectSpeed > motionThreshold
        ? Math.atan2(subjectDirectionY, subjectDirectionX) * 180 / Math.PI
        : null,
      speed: clamp01(subjectSpeed),
      confidence: subjectConfidence,
    },
    apparentScaleChange: confidence >= 0.6 ? apparentScaleChange : 'unknown',
    abruptFramingChange: confidence >= 0.6
      && (Math.hypot(dx, dy) / diagonal >= 0.06 || radialSpeed >= 0.1 || rotationSpeed >= 0.1),
  };
}

export function inferLocalSceneType(
  shot: Pick<Shot, 'motion' | 'intensity' | 'brightness' | 'tags'>,
  context: { dialogue?: boolean; previousMotion?: number; nextMotion?: number } = {},
): { type: LocalSceneType; confidence: number } {
  if (context.dialogue) {
    if (shot.motion < 0.22 && shot.intensity < 0.45) return { type: 'dialogue', confidence: 0.68 };
    if (shot.motion < 0.35) return { type: 'reaction', confidence: 0.58 };
  }
  if (shot.tags.includes('impacto') || (shot.motion >= 0.58 && shot.intensity >= 0.55)) {
    return { type: 'action', confidence: shot.tags.includes('impacto') ? 0.82 : 0.62 };
  }
  const risingMotion = (context.nextMotion ?? shot.motion) > (context.previousMotion ?? shot.motion) + 0.15;
  if (shot.brightness < 0.24 && (shot.motion >= 0.3 || risingMotion)) return { type: 'tension', confidence: 0.48 };
  if (shot.motion < 0.3 && context.previousMotion !== undefined && context.previousMotion >= 0.45) {
    return { type: 'reaction', confidence: 0.52 };
  }
  if (shot.motion < 0.2 && shot.intensity < 0.38) return { type: 'contemplation', confidence: 0.58 };
  return { type: 'environment', confidence: 0.4 };
}

export function analyzeLocalVisualFrames(
  frames: RgbFrame[],
  shot: Shot,
  context: { dialogue?: boolean; previousMotion?: number; nextMotion?: number } = {},
  sampleTimesS?: number[],
): { local: LocalVisualFeatures; sceneType: LocalSceneType; sceneTypeConfidence: number } {
  if (!frames.length) throw new Error('é preciso pelo menos um quadro para análise visual local');
  const descriptions = frames.map(describeFrame);
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const vectorAverage = (key: 'luma' | 'edges' | 'histogram' | 'rgbBins') =>
    descriptions[0]![key].map((_, i) => average(descriptions.map((item) => item[key][i]!)));
  const lumaGrid = vectorAverage('luma');
  const edgeGrid = vectorAverage('edges');
  const colorHistogram = vectorAverage('histogram');
  const colorBins = vectorAverage('rgbBins');
  const dominantColors = colorBins
    .map((weight, index) => ({ weight, index }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
    .filter((item) => item.weight > 0)
    .map(({ index }) => {
      const r = Math.round(((index >> 4) + 0.5) * 255 / 4);
      const g = Math.round(((index >> 2 & 3) + 0.5) * 255 / 4);
      const b = Math.round(((index & 3) + 0.5) * 255 / 4);
      return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
    });
  let temporalMotion = 0;
  let shiftX = 0;
  let shiftY = 0;
  let globalMotion = 0;
  const motionEvents: MotionEvent[] = [];
  for (let i = 1; i < descriptions.length; i++) {
    const prev = descriptions[i - 1]!;
    const current = descriptions[i]!;
    temporalMotion += average(prev.luma.map((value, j) => Math.abs(value - current.luma[j]!)));
    const [dx, dy, residual] = estimateShift(prev.luma, current.luma);
    shiftX += dx;
    shiftY += dy;
    globalMotion += clamp01(Math.hypot(dx, dy) * 2 + residual * 0.6);
    const startS = sampleTimesS?.[i - 1] ?? shot.startS + (shot.endS - shot.startS) * (i - 1) / Math.max(1, descriptions.length - 1);
    const endS = sampleTimesS?.[i] ?? shot.startS + (shot.endS - shot.startS) * i / Math.max(1, descriptions.length - 1);
    motionEvents.push(estimateMotionEvent(frames[i - 1]!, frames[i]!, startS, endS));
  }
  const transitions = Math.max(1, descriptions.length - 1);
  const sceneType = inferLocalSceneType(shot, context);
  const scalar = [
    ...lumaGrid,
    ...edgeGrid,
    ...colorHistogram,
    ...colorBins,
    average(descriptions.map((item) => item.brightness)),
    average(descriptions.map((item) => item.saturation)),
    average(descriptions.map((item) => item.entropy)),
    average(descriptions.map((item) => item.edgeDensity)),
    average(descriptions.map((item) => item.center[0])),
    average(descriptions.map((item) => item.center[1])),
    temporalMotion / transitions,
    shiftX / transitions + 0.5,
    shiftY / transitions + 0.5,
  ];
  return {
    sceneType: sceneType.type,
    sceneTypeConfidence: sceneType.confidence,
    local: {
      version: LOCAL_VISION_VERSION,
      samples: frames.length,
      lumaGrid,
      edgeGrid,
      colorHistogram,
      dominantColors,
      brightness: average(descriptions.map((item) => item.brightness)),
      saturation: average(descriptions.map((item) => item.saturation)),
      entropy: average(descriptions.map((item) => item.entropy)),
      edgeDensity: average(descriptions.map((item) => item.edgeDensity)),
      centerOfVisualMass: [
        average(descriptions.map((item) => item.center[0])),
        average(descriptions.map((item) => item.center[1])),
      ],
      temporalMotion: clamp01(temporalMotion / transitions),
      globalShift: [shiftX / transitions, shiftY / transitions],
      globalMotion: clamp01(globalMotion / transitions),
      motionEvents,
      motionConfidence: motionEvents.length ? average(motionEvents.map((event) => event.confidence)) : 0,
      fingerprint: quantizeHash(scalar),
      sceneType: sceneType.type,
      sceneTypeConfidence: sceneType.confidence,
    },
  };
}

export function visualSimilarity(a: LocalVisualFeatures, b: LocalVisualFeatures): number {
  const distance = (left: number[], right: number[]) => {
    if (left.length !== right.length) return 1;
    return left.reduce((sum, value, i) => sum + Math.abs(value - right[i]!), 0) / Math.max(1, left.length);
  };
  const spatial = distance(a.lumaGrid, b.lumaGrid);
  const edges = distance(a.edgeGrid, b.edgeGrid);
  const color = distance(a.colorHistogram, b.colorHistogram);
  const motion = Math.abs(a.temporalMotion - b.temporalMotion);
  const structure = spatial * 0.4 + edges * 0.4 + motion * 0.2;
  return clamp01(1 - (structure * 1.1 + color * 0.08));
}

export function findSimilarVisualScenes(
  entries: { key: string; features: LocalVisualFeatures }[],
  threshold = 0.88,
): Record<string, SimilarVisualScene[]> {
  const result: Record<string, SimilarVisualScene[]> = Object.fromEntries(entries.map(({ key }) => [key, []]));
  for (let i = 0; i < entries.length; i++) {
    const a = entries[i]!;
    for (let j = i + 1; j < entries.length; j++) {
      const b = entries[j]!;
      if (a.key === b.key || a.features.sceneType !== b.features.sceneType) continue;
      const similarity = visualSimilarity(a.features, b.features);
      if (similarity >= threshold) {
        result[a.key]!.push({ key: b.key, similarity });
        result[b.key]!.push({ key: a.key, similarity });
      }
    }
  }
  for (const matches of Object.values(result)) matches.sort((a, b) => b.similarity - a.similarity || a.key.localeCompare(b.key));
  return result;
}

export function selectLocalVisionTargets(
  episode: EpisodeAnalysis,
  labeled: Record<string, ShotVision>,
  scope: VisionScope = 'fights',
  max = scope === 'all' ? Infinity : 120,
): LocalVisionTarget[] {
  if (max <= 0) return [];
  const eligible = scope === 'all'
    ? episode.shots
    : (episode.sequences ?? [])
      .filter((sequence) => sequence.kind === 'luta')
      .flatMap((sequence) => episode.shots.filter((shot) =>
        shot.startS >= sequence.startS - 1e-3 && shot.endS <= sequence.endS + 1e-3,
      ));
  const seen = new Set<string>();
  const candidates = eligible
    .filter((shot) => {
      const key = `t${Math.round(shot.startS * 100)}`;
      if (seen.has(key) || shot.endS - shot.startS < 0.25) return false;
      seen.add(key);
      return labeled[key]?.local?.version !== LOCAL_VISION_VERSION;
    })
    .sort((a, b) => {
      const score = (shot: Shot) => shot.intensity * 0.5 + shot.motion * 0.35 + (shot.tags.includes('impacto') ? 0.15 : 0);
      return score(b) - score(a) || a.startS - b.startS;
    })
    .slice(0, max)
    .sort((a, b) => a.startS - b.startS);
  return candidates.map((shot) => {
    const duration = shot.endS - shot.startS;
    const fractions = duration >= 2.5
      ? [0.1, 0.3, 0.5, 0.7, 0.9]
      : duration >= 1.2 ? [0.15, 0.5, 0.85] : [0.5];
    return {
      startS: shot.startS,
      endS: shot.endS,
      midS: (shot.startS + shot.endS) / 2,
      samples: fractions.map((fraction) => shot.startS + duration * fraction),
    };
  });
}
