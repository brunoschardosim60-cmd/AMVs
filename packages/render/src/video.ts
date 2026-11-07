/**
 * Comando do FFmpeg para UMA janela do plano. Usa os arquivos ORIGINAIS.
 * As fórmulas espelham `evalClipLook` / `clipRamps` de @amv/project.
 */
import { clipRamps, param, type Clip, type Project, type Rational, type Ramp } from '@amv/project';
import type { Layer, Window } from './plan.js';

export interface AssetSource {
  path: string;
  kind: 'video' | 'audio' | 'image';
  width: number;
  height: number;
}

export interface VideoEncoding {
  codec: 'h264' | 'h265' | 'prores';
  /** 0 = rascunho rápido, 1 = alta, 2 = máxima. */
  quality: 0 | 1 | 2;
}

export interface WindowJob {
  args: string[];
  /** Quantas camadas realmente entraram (para diagnóstico). */
  layerCount: number;
}

const n = (v: number, d = 6) => Number(v.toFixed(d)).toString();
const even = (v: number) => Math.max(2, 2 * Math.round(v / 2));

export function encodingArgs(enc: VideoEncoding, fps: Rational): string[] {
  const g = String(Math.max(1, Math.round((2 * fps.num) / fps.den)));
  if (enc.codec === 'prores') {
    return ['-c:v', 'prores_ks', '-profile:v', enc.quality === 2 ? '4' : '3', '-pix_fmt', enc.quality === 2 ? 'yuva444p10le' : 'yuv422p10le', '-vendor', 'apl0'];
  }
  if (enc.codec === 'h265') {
    const crf = ['26', '20', '17'][enc.quality]!;
    const preset = ['veryfast', 'medium', 'slow'][enc.quality]!;
    return ['-c:v', 'libx265', '-preset', preset, '-crf', crf, '-pix_fmt', 'yuv420p', '-g', g, '-x265-params', 'log-level=error', '-tag:v', 'hvc1'];
  }
  const crf = ['23', '18', '15'][enc.quality]!;
  const preset = ['veryfast', 'medium', 'slow'][enc.quality]!;
  return ['-c:v', 'libx264', '-preset', preset, '-crf', crf, '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-g', g];
}

/** Expressão do FFmpeg para o zoom no tempo local T (mesma fórmula de zoomAt). */
function zoomExpr(clip: Clip, T: string): string | null {
  const parts: string[] = [];
  const durS = clip.durationUs / 1e6;
  for (const fx of clip.effects) {
    if (!fx.enabled || fx.effect !== 'zoom') continue;
    const from = param(fx, 'from');
    const to = param(fx, 'to');
    const X = `clip((${T})/${n(durS)},0,1)`;
    const K = param(fx, 'ease') >= 0.5 ? `(0.5-0.5*cos(PI*${X}))` : X;
    parts.push(`max(1,${n(from)}+${n(to - from)}*${K})`);
  }
  return parts.length ? parts.join('*') : null;
}

/** Deslocamento da tremida (mesma fórmula de shakeOffset). */
function shakeExpr(clip: Clip, T: string, axis: 'x' | 'y'): string {
  const parts: string[] = [];
  for (const fx of clip.effects) {
    if (!fx.enabled || fx.effect !== 'shake') continue;
    const I = param(fx, 'intensity');
    const F = param(fx, 'frequency');
    const D = param(fx, 'duration');
    const wave = axis === 'x' ? `sin(2*PI*${n(F)}*(${T}))` : `cos(2*PI*${n(F * 1.37)}*(${T}))`;
    parts.push(`if(lt(${T},${n(D)})*gte(${T},0),${n(I)}*(1-(${T})/${n(D)})*${wave},0)`);
  }
  return parts.length ? parts.join('+') : '0';
}

function sum(clip: Clip, effect: string, key: string): number {
  return clip.effects.filter((f) => f.enabled && f.effect === effect).reduce((a, f) => a + param(f, key), 0);
}
function prod(clip: Clip, effect: string, key: string): number {
  return clip.effects.filter((f) => f.enabled && f.effect === effect).reduce((a, f) => a * param(f, key), 1);
}

/**
 * Pré-rolagem: se a janela começa no meio de uma rampa, a camada começa antes
 * (no início da rampa) e depois é cortada — o `fade` do FFmpeg não aceita início negativo.
 */
function prerollS(ramps: Ramp[], L0: number): number {
  let p = 0;
  for (const r of ramps) if (r.startS < L0 && L0 < r.startS + r.durS) p = Math.max(p, L0 - r.startS);
  return p;
}

export interface WindowInput {
  project: Project;
  window: Window;
  fps: Rational;
  width: number;
  height: number;
  enc: VideoEncoding;
  output: string;
  source(assetId: string): AssetSource | null;
  /** PNG do tamanho do quadro com o texto já desenhado (mesmo desenho do preview). */
  textImage(clip: Clip): string | null;
}

export function windowArgs(o: WindowInput): WindowJob {
  const { project, window: w, fps, width: W, height: H } = o;
  const P = project.settings;
  const kx = W / P.width; // escala projeto → saída (exportar em outra resolução)
  const Dw = w.durUs / 1e6;
  const FPS = `${fps.num}/${fps.den}`;
  const inputs: string[] = [];
  const filters: string[] = [];
  let inputIdx = 0;
  let cur = 'base';
  filters.push(`color=c=${P.background.replace('#', '0x')}:s=${W}x${H}:r=${FPS}:d=${n(Dw + 1, 3)},format=yuv420p[base]`);
  let layerCount = 0;

  const overlayOnto = (label: string, x: string, y: string, enable?: string) => {
    const out = `v${filters.length}`;
    filters.push(`[${cur}][${label}]overlay=x='${x}':y='${y}':eval=frame:eof_action=pass:format=yuv420${enable ? `:enable='${enable}'` : ''}[${out}]`);
    cur = out;
  };

  for (const layer of w.layers) {
    const c = layer.clip;
    const L0 = layer.localStartUs / 1e6;
    const durS = c.durationUs / 1e6;
    const ramps = layer.underlay ? [] : clipRamps(c, durS);
    const p = prerollS(ramps, L0);
    const Ls = L0 - p; // tempo local do clipe no início da cadeia
    const chainLen = p + Dw;
    const tr = c.transform;
    const lbl = `l${inputIdx}`;
    const chain: string[] = [];
    let srcW = W;
    let srcH = H;

    if (c.text) {
      const png = o.textImage(c);
      if (!png) continue;
      inputs.push('-loop', '1', '-framerate', FPS, '-t', n(chainLen + 0.1, 3), '-i', png);
      chain.push(`[${inputIdx}:v]setpts=PTS-STARTPTS`, 'format=yuva420p');
    } else {
      if (!c.assetId) continue;
      const src = o.source(c.assetId);
      if (!src || src.kind === 'audio') continue;
      srcW = src.width;
      srcH = src.height;
      if (src.kind === 'image') {
        inputs.push('-loop', '1', '-framerate', FPS, '-t', n(chainLen + 0.1, 3), '-i', src.path);
        chain.push(`[${inputIdx}:v]setpts=PTS-STARTPTS`);
      } else {
        const srcStart = (c.sourceInUs + Ls * 1e6 * c.speed) / 1e6;
        inputs.push('-ss', n(Math.max(0, srcStart), 6), '-t', n(chainLen * c.speed + 0.5, 3), '-i', src.path);
        chain.push(`[${inputIdx}:v:0]setpts=(PTS-STARTPTS)/${n(c.speed)}`);
      }
      chain.push(`fps=${FPS}:round=near`);
      // recorte
      const cr = tr.crop;
      const cw = srcW * (1 - cr.left - cr.right);
      const ch = srcH * (1 - cr.top - cr.bottom);
      if (cr.left || cr.right || cr.top || cr.bottom) {
        chain.push(`crop=${even(cw)}:${even(ch)}:${Math.round(srcW * cr.left)}:${Math.round(srcH * cr.top)}`);
      }
      // cor antes de mexer em alfa
      const b = sum(c, 'color', 'brightness');
      const ct = prod(c, 'color', 'contrast');
      const sat = prod(c, 'color', 'saturation');
      if (c.effects.some((f) => f.enabled && f.effect === 'color')) chain.push(`eq=brightness=${n(b)}:contrast=${n(ct)}:saturation=${n(sat)}`);
      // encaixa (contain) no quadro do projeto e aplica a escala
      const fit = Math.min(P.width / cw, P.height / ch);
      const LW = even(cw * fit * tr.scale * kx);
      const LH = even(ch * fit * tr.scale * kx);
      chain.push(`scale=${LW}:${LH}:flags=bicubic`, 'setsar=1');
      const z = zoomExpr(c, `it+${n(Ls)}`);
      if (z) chain.push(`zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${LW}x${LH}:fps=${FPS}`);
      const blur = sum(c, 'blur', 'amount');
      if (blur > 0) chain.push(`gblur=sigma=${n(blur * kx, 3)}`);
      const rgb = Math.round(sum(c, 'rgb_split', 'amount') * kx);
      if (rgb > 0) chain.push('format=gbrp', `rgbashift=rh=${-rgb}:bh=${rgb}`);
      const vig = Math.max(0, ...c.effects.filter((f) => f.enabled && f.effect === 'vignette').map((f) => param(f, 'strength')));
      if (vig > 0) chain.push(`vignette=angle=${n((vig * Math.PI) / 2.5, 4)}`);
      chain.push('format=yuva420p');
    }
    if (tr.rotation) {
      const a = n((tr.rotation * Math.PI) / 180, 6);
      chain.push(`rotate=a=${a}:ow=rotw(${a}):oh=roth(${a}):c=none`);
    }
    if (tr.opacity < 1) chain.push(`colorchannelmixer=aa=${n(tr.opacity, 4)}`);
    // rampas de opacidade do próprio clipe (dissolver / mergulho)
    for (const r of ramps) {
      if (r.target !== 'alpha') continue;
      const st = r.startS - Ls;
      if (st + r.durS <= 1e-6 || st >= chainLen) continue;
      // todas as rampas de alfa começam em 0: antes do fim ficam invisíveis/subindo
      if (r.to > r.from) chain.push(`fade=t=in:st=${n(Math.max(0, st))}:d=${n(r.durS)}:alpha=1`);
      else chain.push(`fade=t=in:st=${n(Math.max(0, st + r.durS))}:d=${n(1 / (2 * (fps.num / fps.den)))}:alpha=1`);
    }
    if (p > 0) chain.push(`trim=start=${n(p)}`, 'setpts=PTS-STARTPTS');
    filters.push(`${chain.join(',')}[${lbl}]`);
    inputIdx++;
    layerCount++;

    // posição: centro + deslocamento + tremida (tempo da janela t → local t+L0)
    const T = `t+${n(L0)}`;
    const x = c.text ? `${n(tr.x * kx * 0)}+${shakeExpr(c, T, 'x')}*${n(kx)}` : `(W-w)/2+${n(tr.x * kx)}+(${shakeExpr(c, T, 'x')})*${n(kx)}`;
    const y = c.text ? `${n(0)}+${shakeExpr(c, T, 'y')}*${n(kx)}` : `(H-h)/2+${n(tr.y * kx)}+(${shakeExpr(c, T, 'y')})*${n(kx)}`;
    overlayOnto(lbl, x, y);

    // camadas de cor (clarão, fades, mergulho) por cima do clipe
    for (const r of ramps) {
      if (r.target !== 'overlay') continue;
      const st = r.startS - Ls;
      if (st + r.durS <= 1e-6 || st >= chainLen) continue;
      const peak = Math.max(r.from, r.to);
      const fade = r.to > r.from ? `fade=t=in:st=${n(Math.max(0, st))}:d=${n(r.durS)}:alpha=1` : `fade=t=out:st=${n(Math.max(0, st))}:d=${n(r.durS)}:alpha=1`;
      const cl = `c${filters.length}`;
      filters.push(
        `color=c=${r.white ? 'white' : 'black'}:s=${W}x${H}:r=${FPS}:d=${n(chainLen + 0.1, 3)},format=yuva420p,colorchannelmixer=aa=${n(peak, 4)},${fade}${p > 0 ? `,trim=start=${n(p)},setpts=PTS-STARTPTS` : ''}[${cl}]`,
      );
      const a = Math.max(0, r.startS - L0);
      const b = r.startS + r.durS - L0;
      overlayOnto(cl, '0', '0', `between(t,${n(a)},${n(b - 1e-4)})`);
    }
  }

  const args = [
    '-hide_banner',
    '-nostdin',
    '-y',
    ...inputs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    `[${cur}]`,
    '-frames:v',
    String(w.frames),
    '-r',
    FPS,
    ...encodingArgs(o.enc, fps),
    '-an',
    '-progress',
    'pipe:1',
    '-nostats',
    '-loglevel',
    'error',
    '-f',
    o.enc.codec === 'prores' ? 'mov' : 'mp4',
    o.output,
  ];
  return { args, layerCount };
}

export type { Layer };
