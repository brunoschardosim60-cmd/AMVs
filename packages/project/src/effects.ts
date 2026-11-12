/**
 * Efeitos e transições — definidos UMA vez.
 *
 * `evalClipLook` dá o estado visual do clipe num instante (zoom, tremida, opacidade,
 * clarão, cor…). O preview desenha a partir disso, e o render (packages/render) gera
 * expressões do FFmpeg com as MESMAS fórmulas. Mudar uma fórmula aqui exige mudar
 * a expressão correspondente em render/src/effects.ts (há teste de paridade).
 */
import type { Clip } from './schema.js';

export type EffectId = 'zoom' | 'shake' | 'flash' | 'fade_in' | 'fade_out' | 'blur' | 'color' | 'rgb_split' | 'vignette';
export type TransitionId = 'dissolve' | 'dip_black' | 'dip_white' | 'flash' | 'whip_pan' | 'match_cut' | 'cut_on_action';
export type TransitionCurve = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
}

export interface EffectDef {
  id: EffectId;
  label: string;
  group: 'Movimento' | 'Luz' | 'Cor' | 'Estilo';
  description: string;
  params: ParamDef[];
}

export const COLOR_GRADING_PRESETS = [
  {
    id: 'cinematic-warm',
    label: 'Cinema quente',
    params: { brightness: 0, contrast: 1.08, saturation: 0.96, exposure: -0.08, temperature: 16, tint: 0, hue: 0, shadows: -0.04, midtones: 0, highlights: 0.03, vignette: 0.12 },
  },
  {
    id: 'cool',
    label: 'Frio',
    params: { brightness: 0, contrast: 1.05, saturation: 0.92, exposure: 0, temperature: -18, tint: 2, hue: 0, shadows: -0.02, midtones: 0, highlights: 0.02, vignette: 0.08 },
  },
  {
    id: 'anime-vibrant',
    label: 'Anime vibrante',
    params: { brightness: 0, contrast: 1.12, saturation: 1.12, exposure: 0.04, temperature: 0, tint: 0, hue: 0, shadows: 0, midtones: 0.02, highlights: 0, vignette: 0 },
  },
  {
    id: 'monochrome',
    label: 'Preto e branco',
    params: { brightness: 0, contrast: 1.12, saturation: 0, exposure: 0, temperature: 0, tint: 0, hue: 0, shadows: -0.02, midtones: 0, highlights: 0.02, vignette: 0.08 },
  },
] as const;

export type ColorGradingPresetId = (typeof COLOR_GRADING_PRESETS)[number]['id'];

export interface ColorGrade {
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
  temperature: number;
  tint: number;
  hue: number;
  shadows: number;
  midtones: number;
  highlights: number;
}

export function aggregateColorGrade(effects: Clip['effects']): ColorGrade {
  const grade: ColorGrade = {
    brightness: 0, contrast: 1, saturation: 1, exposure: 0, temperature: 0, tint: 0, hue: 0,
    shadows: 0, midtones: 0, highlights: 0,
  };
  for (const effect of effects) {
    if (!effect.enabled || effect.effect !== 'color') continue;
    grade.brightness += param(effect, 'brightness');
    grade.contrast *= param(effect, 'contrast');
    grade.saturation *= param(effect, 'saturation');
    grade.exposure += param(effect, 'exposure');
    grade.temperature += param(effect, 'temperature');
    grade.tint += param(effect, 'tint');
    grade.hue += param(effect, 'hue');
    grade.shadows += param(effect, 'shadows');
    grade.midtones += param(effect, 'midtones');
    grade.highlights += param(effect, 'highlights');
  }
  return grade;
}

export function isColorGradeNeutral(grade: ColorGrade): boolean {
  return grade.brightness === 0 && grade.contrast === 1 && grade.saturation === 1 && grade.exposure === 0
    && grade.temperature === 0 && grade.tint === 0 && grade.hue === 0 && grade.shadows === 0
    && grade.midtones === 0 && grade.highlights === 0;
}

/** Transformação comum do preview e do LUT gerado para a exportação. Canais em 0..1. */
export function applyColorGrade(rgb: readonly [number, number, number], grade: ColorGrade): [number, number, number] {
  const exposure = Math.pow(2, grade.exposure);
  const temperature = grade.temperature / 100;
  const tint = grade.tint / 100;
  let [r, g, b] = rgb.map((channel) => ((channel + grade.brightness) * exposure - 0.5) * grade.contrast + 0.5) as [number, number, number];
  const luma = Math.max(0, Math.min(1, 0.2126 * r + 0.7152 * g + 0.0722 * b));
  const shadows = Math.pow(1 - luma, 2);
  const midtones = Math.max(0, 1 - Math.abs(2 * luma - 1));
  const highlights = luma * luma;
  const tonal = 0.2 * (grade.shadows * shadows + grade.midtones * midtones + grade.highlights * highlights);
  r += tonal + temperature * 0.25 + tint * 0.1;
  g += tonal - tint * 0.2;
  b += tonal - temperature * 0.25 + tint * 0.1;

  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  r = y + (r - y) * grade.saturation;
  g = y + (g - y) * grade.saturation;
  b = y + (b - y) * grade.saturation;
  if (grade.hue) {
    const angle = (grade.hue * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const nr = (0.213 + 0.787 * cos - 0.213 * sin) * r + (0.715 - 0.715 * cos - 0.715 * sin) * g + (0.072 - 0.072 * cos + 0.928 * sin) * b;
    const ng = (0.213 - 0.213 * cos + 0.143 * sin) * r + (0.715 + 0.285 * cos + 0.140 * sin) * g + (0.072 - 0.072 * cos - 0.283 * sin) * b;
    const nb = (0.213 - 0.213 * cos - 0.787 * sin) * r + (0.715 - 0.715 * cos + 0.715 * sin) * g + (0.072 + 0.928 * cos + 0.072 * sin) * b;
    r = nr;
    g = ng;
    b = nb;
  }
  return [r, g, b].map((channel) => Math.max(0, Math.min(1, channel))) as [number, number, number];
}

export interface ColorGradeLut {
  size: number;
  data: Float32Array;
}

export function createColorGradeLut(grade: ColorGrade, size = 17): ColorGradeLut {
  const data = new Float32Array(size * size * size * 3);
  let offset = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const color = applyColorGrade([r / (size - 1), g / (size - 1), b / (size - 1)], grade);
        data[offset++] = color[0];
        data[offset++] = color[1];
        data[offset++] = color[2];
      }
    }
  }
  return { size, data };
}

export function sampleColorGradeLut(rgb: readonly [number, number, number], lut: ColorGradeLut): [number, number, number] {
  const { size, data } = lut;
  const coordinates = rgb.map((channel) => Math.min(size - 1, Math.max(0, channel)) * (size - 1)) as [number, number, number];
  const lower = coordinates.map(Math.floor) as [number, number, number];
  const upper = lower.map((value) => Math.min(size - 1, value + 1)) as [number, number, number];
  const fraction = coordinates.map((value, index) => value - lower[index]!) as [number, number, number];
  const sample = (r: number, g: number, b: number, channel: number) => data[((b * size + g) * size + r) * 3 + channel]!;
  const out: [number, number, number] = [0, 0, 0];
  for (let channel = 0; channel < 3; channel++) {
    let value = 0;
    for (let bz = 0; bz < 2; bz++) {
      for (let gy = 0; gy < 2; gy++) {
        for (let rx = 0; rx < 2; rx++) {
          const weight = (rx ? fraction[0] : 1 - fraction[0]) * (gy ? fraction[1] : 1 - fraction[1]) * (bz ? fraction[2] : 1 - fraction[2]);
          value += sample(rx ? upper[0] : lower[0], gy ? upper[1] : lower[1], bz ? upper[2] : lower[2], channel) * weight;
        }
      }
    }
    out[channel] = value;
  }
  return out;
}

/** Gera .cube padrão (R varia mais rápido), consumido pelo filtro LUT 3D do FFmpeg. */
export function colorGradeCube(grade: ColorGrade, size = 17): string {
  const lines = [`TITLE "AMV Studio Color Grade"`, `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  const lut = createColorGradeLut(grade, size);
  for (let index = 0; index < lut.data.length; index += 3) {
    lines.push(`${lut.data[index]!.toFixed(7)} ${lut.data[index + 1]!.toFixed(7)} ${lut.data[index + 2]!.toFixed(7)}`);
  }
  return `${lines.join('\n')}\n`;
}

export function colorGradingPreset(id: ColorGradingPresetId): (typeof COLOR_GRADING_PRESETS)[number] {
  return COLOR_GRADING_PRESETS.find((preset) => preset.id === id)!;
}

/** Compensação limitada de exposição para reduzir saltos, sem nivelar a intenção das cenas. */
export function matchSceneExposure(previousBrightness: number, currentBrightness: number): number {
  const previous = Math.min(1, Math.max(0.02, previousBrightness));
  const current = Math.min(1, Math.max(0.02, currentBrightness));
  if (Math.abs(previous - current) < 0.12) return 0;
  const correction = 0.5 * Math.log2(previous / current);
  return Math.round(Math.min(0.3, Math.max(-0.3, correction)) * 100) / 100;
}

/** Compensação cromática leve a partir dos histogramas RGB locais (4 bins por canal). */
export function matchSceneColor(previousHistogram: number[], currentHistogram: number[]): { temperature: number; tint: number } {
  if (previousHistogram.length !== 12 || currentHistogram.length !== 12) return { temperature: 0, tint: 0 };
  const channelMean = (histogram: number[], channel: number) =>
    histogram.slice(channel * 4, channel * 4 + 4).reduce((sum, weight, bin) => sum + weight * ((bin + 0.5) / 4), 0);
  const cast = (histogram: number[]) => {
    const r = channelMean(histogram, 0);
    const g = channelMean(histogram, 1);
    const b = channelMean(histogram, 2);
    return { temperature: r - b, tint: g - (r + b) / 2 };
  };
  const previous = cast(previousHistogram);
  const current = cast(currentHistogram);
  const temperatureDelta = previous.temperature - current.temperature;
  const tintDelta = previous.tint - current.tint;
  return {
    temperature: Math.abs(temperatureDelta) < 0.12 ? 0 : Math.round(Math.max(-8, Math.min(8, temperatureDelta * 20))),
    tint: Math.abs(tintDelta) < 0.12 ? 0 : Math.round(Math.max(-8, Math.min(8, -tintDelta * 20))),
  };
}

export const EFFECTS: EffectDef[] = [
  {
    id: 'zoom',
    label: 'Zoom',
    group: 'Movimento',
    description: 'Aproxima (ou afasta) a câmera ao longo do clipe.',
    params: [
      { key: 'from', label: 'Zoom inicial', min: 1, max: 3, step: 0.05, default: 1, unit: '×' },
      { key: 'to', label: 'Zoom final', min: 1, max: 3, step: 0.05, default: 1.25, unit: '×' },
      { key: 'ease', label: 'Suavidade', min: 0, max: 1, step: 1, default: 1 },
    ],
  },
  {
    id: 'shake',
    label: 'Câmera tremendo',
    group: 'Movimento',
    description: 'Tremida de impacto, mais forte no começo e diminuindo.',
    params: [
      { key: 'intensity', label: 'Intensidade', min: 0, max: 80, step: 1, default: 18, unit: 'px' },
      { key: 'frequency', label: 'Frequência', min: 1, max: 30, step: 1, default: 14, unit: 'Hz' },
      { key: 'duration', label: 'Duração', min: 0.05, max: 5, step: 0.05, default: 0.5, unit: 's' },
    ],
  },
  {
    id: 'flash',
    label: 'Clarão',
    group: 'Luz',
    description: 'Clarão no início do clipe, ótimo no corte do drop.',
    params: [
      { key: 'duration', label: 'Duração', min: 0.03, max: 1.5, step: 0.01, default: 0.18, unit: 's' },
      { key: 'white', label: 'Branco (1) ou preto (0)', min: 0, max: 1, step: 1, default: 1 },
      { key: 'strength', label: 'Força', min: 0.1, max: 1, step: 0.05, default: 1 },
    ],
  },
  {
    id: 'fade_in',
    label: 'Surgir do preto',
    group: 'Luz',
    description: 'Começa no preto e aparece.',
    params: [{ key: 'duration', label: 'Duração', min: 0.05, max: 5, step: 0.05, default: 0.5, unit: 's' }],
  },
  {
    id: 'fade_out',
    label: 'Sumir no preto',
    group: 'Luz',
    description: 'Termina escurecendo até o preto.',
    params: [{ key: 'duration', label: 'Duração', min: 0.05, max: 5, step: 0.05, default: 0.5, unit: 's' }],
  },
  {
    id: 'blur',
    label: 'Desfoque',
    group: 'Estilo',
    description: 'Desfoca a imagem inteira.',
    params: [{ key: 'amount', label: 'Quantidade', min: 0, max: 40, step: 0.5, default: 6, unit: 'px' }],
  },
  {
    id: 'color',
    label: 'Cor',
    group: 'Cor',
    description: 'Exposição, contraste, saturação, balanço de cor e controle tonal.',
    params: [
      { key: 'brightness', label: 'Brilho', min: -0.5, max: 0.5, step: 0.01, default: 0 },
      { key: 'contrast', label: 'Contraste', min: 0.5, max: 2, step: 0.01, default: 1.1 },
      { key: 'saturation', label: 'Saturação', min: 0, max: 2.5, step: 0.01, default: 1.2 },
      { key: 'exposure', label: 'Exposição', min: -3, max: 3, step: 0.05, default: 0, unit: 'EV' },
      { key: 'temperature', label: 'Temperatura', min: -100, max: 100, step: 1, default: 0 },
      { key: 'tint', label: 'Matiz verde–magenta', min: -100, max: 100, step: 1, default: 0 },
      { key: 'hue', label: 'Rotação de matiz', min: -180, max: 180, step: 1, default: 0, unit: '°' },
      { key: 'shadows', label: 'Sombras', min: -1, max: 1, step: 0.01, default: 0 },
      { key: 'midtones', label: 'Médios', min: -1, max: 1, step: 0.01, default: 0 },
      { key: 'highlights', label: 'Realces', min: -1, max: 1, step: 0.01, default: 0 },
      { key: 'vignette', label: 'Vinheta', min: 0, max: 1, step: 0.01, default: 0 },
    ],
  },
  {
    id: 'rgb_split',
    label: 'Separação RGB',
    group: 'Estilo',
    description: 'Desloca o vermelho e o azul para os lados (efeito glitch).',
    params: [{ key: 'amount', label: 'Deslocamento', min: 1, max: 40, step: 1, default: 8, unit: 'px' }],
  },
  {
    id: 'vignette',
    label: 'Vinheta',
    group: 'Estilo',
    description: 'Escurece as bordas.',
    params: [{ key: 'strength', label: 'Força', min: 0, max: 1, step: 0.05, default: 0.5 }],
  },
];

export const TRANSITIONS: { id: TransitionId; label: string; description: string }[] = [
  { id: 'dissolve', label: 'Dissolver', description: 'Mistura gradual entre as cenas.' },
  { id: 'dip_black', label: 'Passar pelo preto', description: 'As duas cenas passam pelo preto.' },
  { id: 'dip_white', label: 'Passar pelo branco', description: 'As duas cenas passam pelo branco.' },
  { id: 'flash', label: 'Flash', description: 'Clarão breve com pico configurável no corte.' },
  { id: 'whip_pan', label: 'Whip pan', description: 'Deslocamento direcional rápido entre as cenas.' },
  { id: 'match_cut', label: 'Match cut', description: 'Corte seco entre composição, cor ou escala compatíveis.' },
  { id: 'cut_on_action', label: 'Corte em ação', description: 'Corte seco que continua uma ação ou movimento.' },
];

export function effectDef(id: string): EffectDef | undefined {
  return EFFECTS.find((e) => e.id === id);
}

export function defaultParams(id: EffectId): Record<string, number> {
  const def = effectDef(id);
  return Object.fromEntries((def?.params ?? []).map((p) => [p.key, p.default]));
}

export function param(fx: { effect: string; params: Record<string, unknown> }, key: string): number {
  const v = fx.params[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return effectDef(fx.effect)?.params.find((p) => p.key === key)?.default ?? 0;
}

/** Suavização usada no zoom (mesma fórmula no FFmpeg: 0.5-0.5*cos(PI*x)). */
export function easeInOut(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return 0.5 - 0.5 * Math.cos(Math.PI * c);
}

/**
 * Rampa linear de opacidade, em segundos locais do clipe. Toda variação de luz
 * (clarão, fades, mergulho) e o dissolver são rampas: o preview calcula o valor,
 * o render vira `fade` do FFmpeg. Um dos extremos é sempre 0.
 *  - target 'overlay': camada de cor (branca/preta) por cima do clipe
 *  - target 'alpha': multiplica a opacidade do próprio clipe
 */
export interface Ramp {
  target: 'overlay' | 'alpha';
  white: boolean;
  startS: number;
  durS: number;
  from: number;
  to: number;
  curve?: TransitionCurve;
  intensity?: number;
}

export function transitionProgress(x: number, curve: TransitionCurve = 'linear', intensity = 1): number {
  const c = Math.max(0, Math.min(1, x));
  const eased = curve === 'ease-in'
    ? c * c
    : curve === 'ease-out'
      ? 1 - (1 - c) * (1 - c)
      : curve === 'ease-in-out'
        ? easeInOut(c)
        : c;
  const exponent = 1 + (1 - Math.max(0, Math.min(1, intensity))) * 3;
  return Math.pow(eased, exponent);
}

export function clipRamps(clip: Pick<Clip, 'effects' | 'transitionIn'>, durS: number): Ramp[] {
  const out: Ramp[] = [];
  for (const fx of clip.effects) {
    if (!fx.enabled) continue;
    if (fx.effect === 'flash') {
      out.push({ target: 'overlay', white: param(fx, 'white') >= 0.5, startS: 0, durS: param(fx, 'duration'), from: param(fx, 'strength'), to: 0 });
    } else if (fx.effect === 'fade_in') {
      out.push({ target: 'overlay', white: false, startS: 0, durS: param(fx, 'duration'), from: 1, to: 0 });
    } else if (fx.effect === 'fade_out') {
      const d = Math.min(durS, param(fx, 'duration'));
      out.push({ target: 'overlay', white: false, startS: durS - d, durS: d, from: 0, to: 1 });
    }
  }
  const tr = clip.transitionIn;
  if (tr && tr.durationUs > 0) {
    const d = tr.durationUs / 1e6;
    const curve = tr.params.curve === 'ease-in' || tr.params.curve === 'ease-out' || tr.params.curve === 'ease-in-out'
      ? tr.params.curve
      : 'linear';
    const intensity = Math.max(0, Math.min(1, typeof tr.params.intensity === 'number' ? tr.params.intensity : 1));
    if (tr.transition === 'dissolve') out.push({ target: 'alpha', white: false, startS: 0, durS: d, from: 0, to: 1, curve, intensity });
    else if (tr.transition === 'dip_black' || tr.transition === 'dip_white') {
      const white = tr.transition === 'dip_white';
      out.push({ target: 'alpha', white, startS: 0, durS: d, from: 0, to: 1, curve });
      out.push({ target: 'overlay', white, startS: 0, durS: d / 2, from: 0, to: intensity, curve });
      out.push({ target: 'overlay', white, startS: d / 2, durS: d / 2, from: intensity, to: 0, curve });
    } else if (tr.transition === 'flash') {
      const flashIntensity = Math.max(0, Math.min(1, typeof tr.params.intensity === 'number' ? tr.params.intensity : 0.8));
      out.push({ target: 'overlay', white: true, startS: 0, durS: d / 2, from: 0, to: flashIntensity, curve });
      out.push({ target: 'overlay', white: true, startS: d / 2, durS: d / 2, from: flashIntensity, to: 0, curve });
    }
  }
  return out.filter((r) => r.durS > 0);
}

/** Valor da rampa no instante, ou null fora dela. */
export function rampValue(r: Ramp, localS: number): number | null {
  if (localS < r.startS || localS >= r.startS + r.durS) return null;
  const x = transitionProgress((localS - r.startS) / r.durS, r.curve, r.intensity);
  return r.from + (r.to - r.from) * x;
}

export function applyWhipPan(
  look: ClipLook,
  transition: Clip['transitionIn'],
  phaseS: number,
  outgoing: boolean,
  frameWidth: number,
): ClipLook {
  if (!transition || transition.transition !== 'whip_pan' || transition.durationUs <= 0) return look;
  const durationS = transition.durationUs / 1e6;
  const curve = transition.params.curve === 'ease-in' || transition.params.curve === 'ease-out' || transition.params.curve === 'ease-in-out'
    ? transition.params.curve
    : 'ease-in-out';
  const progress = transitionProgress(phaseS / durationS, curve);
  const intensity = typeof transition.params.intensity === 'number'
    ? Math.max(0.1, Math.min(1, transition.params.intensity))
    : 0.65;
  const direction = transition.params.direction === -1 ? -1 : 1;
  const distance = frameWidth * intensity;
  const x = outgoing ? direction * distance * progress : -direction * distance * (1 - progress);
  const blur = Math.max(0, Math.min(32, typeof transition.params.blur === 'number' ? transition.params.blur : 8));
  return { ...look, dx: look.dx + x, blur: look.blur + blur };
}

export interface ClipLook {
  /** Multiplicador de zoom (≥ 1: recorte central ampliado). */
  zoom: number;
  /** Deslocamento da tremida, em px do projeto. */
  dx: number;
  dy: number;
  /** Opacidade do clipe (0..1), já com o dissolver. */
  alpha: number;
  /** Camadas de cor por cima do clipe, na ordem (de baixo para cima). */
  overlays: { white: boolean; alpha: number }[];
  blur: number;
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
  temperature: number;
  tint: number;
  hue: number;
  shadows: number;
  midtones: number;
  highlights: number;
  rgbSplit: number;
  vignette: number;
}

/** Tremida: amplitude cai linearmente até zero no fim da duração. */
export function shakeOffset(localS: number, intensity: number, frequency: number, duration: number): { dx: number; dy: number } {
  if (localS < 0 || localS >= duration) return { dx: 0, dy: 0 };
  const a = intensity * (1 - localS / duration);
  return {
    dx: a * Math.sin(2 * Math.PI * frequency * localS),
    dy: a * Math.cos(2 * Math.PI * frequency * 1.37 * localS),
  };
}

/** Fator de zoom de um efeito 'zoom' (mesma fórmula da expressão do FFmpeg). */
export function zoomAt(fx: { effect: string; params: Record<string, unknown> }, localS: number, durS: number): number {
  const from = param(fx, 'from');
  const to = param(fx, 'to');
  const x = durS > 0 ? Math.min(1, Math.max(0, localS / durS)) : 0;
  const k = param(fx, 'ease') >= 0.5 ? easeInOut(x) : x;
  return Math.max(1, from + (to - from) * k);
}

/**
 * Estado visual do clipe em `localS` segundos desde o início dele na timeline.
 * `durS` = duração do clipe na timeline.
 */
export function evalClipLook(clip: Pick<Clip, 'effects' | 'transitionIn' | 'transform'>, localS: number, durS: number): ClipLook {
  const look: ClipLook = {
    zoom: 1, dx: 0, dy: 0, alpha: clip.transform.opacity, overlays: [], blur: 0, brightness: 0, contrast: 1, saturation: 1,
    exposure: 0, temperature: 0, tint: 0, hue: 0, shadows: 0, midtones: 0, highlights: 0, rgbSplit: 0, vignette: 0,
  };
  for (const fx of clip.effects) {
    if (!fx.enabled) continue;
    switch (fx.effect) {
      case 'zoom':
        look.zoom *= zoomAt(fx, localS, durS);
        break;
      case 'shake': {
        const o = shakeOffset(localS, param(fx, 'intensity'), param(fx, 'frequency'), param(fx, 'duration'));
        look.dx += o.dx;
        look.dy += o.dy;
        break;
      }
      case 'blur':
        look.blur += param(fx, 'amount');
        break;
      case 'color':
        look.brightness += param(fx, 'brightness');
        look.contrast *= param(fx, 'contrast');
        look.saturation *= param(fx, 'saturation');
        look.exposure += param(fx, 'exposure');
        look.temperature += param(fx, 'temperature');
        look.tint += param(fx, 'tint');
        look.hue += param(fx, 'hue');
        look.shadows += param(fx, 'shadows');
        look.midtones += param(fx, 'midtones');
        look.highlights += param(fx, 'highlights');
        look.vignette = Math.max(look.vignette, param(fx, 'vignette'));
        break;
      case 'rgb_split': {
        const d = param(fx, 'duration');
        if (d <= 0 || localS < d) {
          const factor = d > 0 ? Math.max(0, 1 - localS / d) : 1;
          look.rgbSplit += param(fx, 'amount') * factor;
        }
        break;
      }
      case 'vignette':
        look.vignette = Math.max(look.vignette, param(fx, 'strength'));
        break;
    }
  }
  for (const r of clipRamps(clip, durS)) {
    const v = rampValue(r, localS);
    if (v === null) continue;
    if (r.target === 'alpha') look.alpha *= v;
    else if (v > 0) look.overlays.push({ white: r.white, alpha: Math.min(1, v) });
  }
  return look;
}

/**
 * Durante a transição de entrada, o clipe anterior da mesma trilha continua por
 * baixo (a origem dele segue além do fim). Devolve esse clipe, se encostado.
 */
export function transitionUnderlay<C extends Pick<Clip, 'id' | 'trackId' | 'timelineStartUs' | 'durationUs' | 'transitionIn' | 'assetId'>>(clips: C[], clip: C): C | null {
  if (!clip.transitionIn || clip.transitionIn.durationUs <= 0) return null;
  if (clip.transitionIn.transition === 'match_cut' || clip.transitionIn.transition === 'cut_on_action') return null;
  let best: C | null = null;
  for (const c of clips) {
    if (c.trackId !== clip.trackId || c.id === clip.id || !c.assetId) continue;
    const end = c.timelineStartUs + c.durationUs;
    // encostado: termina até ~1 quadro antes do início deste
    if (Math.abs(end - clip.timelineStartUs) <= 50_000) best = c;
  }
  return best;
}
