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
export type TransitionId = 'dissolve' | 'dip_black' | 'dip_white';

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
    description: 'Brilho, contraste e saturação.',
    params: [
      { key: 'brightness', label: 'Brilho', min: -0.5, max: 0.5, step: 0.01, default: 0 },
      { key: 'contrast', label: 'Contraste', min: 0.5, max: 2, step: 0.01, default: 1.1 },
      { key: 'saturation', label: 'Saturação', min: 0, max: 2.5, step: 0.01, default: 1.2 },
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
  { id: 'dissolve', label: 'Dissolver', description: 'O clipe anterior se mistura com este.' },
  { id: 'dip_black', label: 'Passar pelo preto', description: 'Escurece e clareia no corte.' },
  { id: 'dip_white', label: 'Clarão branco', description: 'Clarão branco no corte.' },
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
    if (tr.transition === 'dissolve') out.push({ target: 'alpha', white: false, startS: 0, durS: d, from: 0, to: 1 });
    else if (tr.transition === 'dip_black' || tr.transition === 'dip_white') {
      const white = tr.transition === 'dip_white';
      // 1ª metade: o anterior (por baixo) vai para a cor e este fica invisível
      out.push({ target: 'alpha', white, startS: 0, durS: d / 2, from: 0, to: 0 });
      out.push({ target: 'overlay', white, startS: 0, durS: d / 2, from: 0, to: 1 });
      // 2ª metade: este aparece saindo da cor
      out.push({ target: 'overlay', white, startS: d / 2, durS: d / 2, from: 1, to: 0 });
    }
  }
  return out.filter((r) => r.durS > 0);
}

/** Valor da rampa no instante, ou null fora dela. */
export function rampValue(r: Ramp, localS: number): number | null {
  if (localS < r.startS || localS >= r.startS + r.durS) return null;
  const x = (localS - r.startS) / r.durS;
  return r.from + (r.to - r.from) * x;
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
  const look: ClipLook = { zoom: 1, dx: 0, dy: 0, alpha: clip.transform.opacity, overlays: [], blur: 0, brightness: 0, contrast: 1, saturation: 1, rgbSplit: 0, vignette: 0 };
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
        break;
      case 'rgb_split':
        look.rgbSplit += param(fx, 'amount');
        break;
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
  let best: C | null = null;
  for (const c of clips) {
    if (c.trackId !== clip.trackId || c.id === clip.id || !c.assetId) continue;
    const end = c.timelineStartUs + c.durationUs;
    // encostado: termina até ~1 quadro antes do início deste
    if (Math.abs(end - clip.timelineStartUs) <= 50_000) best = c;
  }
  return best;
}
