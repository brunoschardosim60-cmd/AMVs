/**
 * Comando do FFmpeg para UMA janela do plano. Usa os arquivos ORIGINAIS.
 * As fórmulas espelham `evalClipLook` / `clipRamps` de @amv/project.
 */
import { clipRamps, hasSpeedCurve, orderedKeyframes, param, sourceTimeAt, speedProgressAt, timelineLocalAtProgress, type Clip, type Keyframe, type Project, type Rational, type Ramp, type TransitionCurve } from '@amv/project';
import type { ProcessRunner } from '@amv/media';
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
  encoder?: 'auto' | 'cpu' | 'amf' | 'nvenc' | 'qsv';
  rateControl?: 'crf' | 'bitrate';
  crf?: number;
  bitrateK?: number;
  container?: 'mp4' | 'mkv' | 'mov';
}

export type HardwareEncoder = Exclude<NonNullable<VideoEncoding['encoder']>, 'auto' | 'cpu'>;
export type ResolvedVideoEncoder = 'cpu' | HardwareEncoder;

const HARDWARE_ENCODERS: Record<HardwareEncoder, { h264: string; h265: string }> = {
  amf: { h264: 'h264_amf', h265: 'hevc_amf' },
  nvenc: { h264: 'h264_nvenc', h265: 'hevc_nvenc' },
  qsv: { h264: 'h264_qsv', h265: 'hevc_qsv' },
};

function cpuEncoder(codec: VideoEncoding['codec']): string {
  return codec === 'h265' ? 'libx265' : codec === 'prores' ? 'prores_ks' : 'libx264';
}

function hardwareEncoder(encoder: HardwareEncoder, codec: Exclude<VideoEncoding['codec'], 'prores'>): string {
  return HARDWARE_ENCODERS[encoder][codec];
}

async function testEncoder(runner: ProcessRunner, name: string, rateControl: VideoEncoding['rateControl'] = 'crf'): Promise<boolean> {
  const args = ['-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=1', '-frames:v', '1', '-c:v', name];
  if (name.endsWith('_amf')) args.push('-rc', rateControl === 'bitrate' ? 'cbr' : 'cqp', ...(rateControl === 'bitrate' ? ['-b:v', '500k'] : ['-qp_i', '28', '-qp_p', '28']));
  else if (name.endsWith('_nvenc')) args.push('-preset', 'p1', ...(rateControl === 'bitrate' ? ['-b:v', '500k'] : ['-rc', 'vbr', '-cq', '28', '-b:v', '0']));
  else if (name.endsWith('_qsv')) args.push('-preset', 'veryfast', ...(rateControl === 'bitrate' ? ['-b:v', '500k'] : ['-global_quality', '28']));
  args.push('-f', 'null', '-');
  const result = await runner.run('ffmpeg', args);
  return result.code === 0;
}

/** Reporta somente encoders que existem no build e passam por uma codificação real curta. */
export async function availableHardwareEncoders(
  runner: ProcessRunner,
  codec: Exclude<VideoEncoding['codec'], 'prores'>,
  rateControl: VideoEncoding['rateControl'] = 'crf',
): Promise<HardwareEncoder[]> {
  const listed = await runner.run('ffmpeg', ['-hide_banner', '-encoders']);
  if (listed.code !== 0) throw new Error(`Não foi possível consultar os encoders do FFmpeg: ${listed.stderr.trim()}`);
  const available: HardwareEncoder[] = [];
  for (const candidate of ['amf', 'nvenc', 'qsv'] as const) {
    const encoder = hardwareEncoder(candidate, codec);
    if (!new RegExp(`\\b${encoder}\\b`).test(`${listed.stdout}\n${listed.stderr}`)) continue;
    if (await testEncoder(runner, encoder, rateControl)) available.push(candidate);
  }
  return available;
}

export async function resolveVideoEncoder(runner: ProcessRunner, encoding: VideoEncoding): Promise<ResolvedVideoEncoder> {
  if (encoding.codec === 'prores') return 'cpu';
  const target = encoding.encoder ?? 'cpu';
  if (target === 'cpu') return 'cpu';
  const available = await availableHardwareEncoders(runner, encoding.codec, encoding.rateControl);
  if (target === 'auto') return available[0] ?? 'cpu';
  if (!available.includes(target)) {
    throw new Error(`O encoder ${target.toUpperCase()} não está disponível ou falhou no teste do FFmpeg. Escolha CPU ou outro encoder disponível.`);
  }
  return target;
}

export interface WindowJob {
  args: string[];
  /** Quantas camadas realmente entraram (para diagnóstico). */
  layerCount: number;
}

const n = (v: number, d = 6) => Number(v.toFixed(d)).toString();
const even = (v: number) => Math.max(2, 2 * Math.round(v / 2));

function keyframeExpr(keyframes: Keyframe[] | undefined, fallback: number, T: string): string {
  const sorted = orderedKeyframes(keyframes);
  if (!sorted.length) return n(fallback);
  let expression = n(sorted.at(-1)!.value);
  for (let i = sorted.length - 1; i > 0; i--) {
    const previous = sorted[i - 1]!;
    const next = sorted[i]!;
    const endS = next.atUs / 1e6;
    const spanS = (next.atUs - previous.atUs) / 1e6;
    const t = `clip(((${T})-${n(previous.atUs / 1e6)})/${n(spanS)},0,1)`;
    const eased =
      next.easing === 'hold' ? '0' :
      next.easing === 'ease-in' ? `((${t})*(${t}))` :
      next.easing === 'ease-out' ? `(1-(1-(${t}))*(1-(${t})))` :
      next.easing === 'ease-in-out' ? `(0.5-0.5*cos(PI*(${t})))` : t;
    const value = `(${n(previous.value)}+(${n(next.value - previous.value)})*${eased})`;
    expression = `if(lt(${T},${n(endS)}),${value},${expression})`;
  }
  const first = sorted[0]!;
  return `if(lt(${T},${n(first.atUs / 1e6)}),${n(first.value)},${expression})`;
}

function maskExpr(mask: Clip['mask']): string | null {
  switch (mask) {
    case 'circle': return 'if(lt(pow((X-W/2)/(W/2),2)+pow((Y-H/2)/(H/2),2),1),1,0)';
    case 'left': return 'if(lt(X,W/2),1,0)';
    case 'right': return 'if(gte(X,W/2),1,0)';
    case 'top': return 'if(lt(Y,H/2),1,0)';
    case 'bottom': return 'if(gte(Y,H/2),1,0)';
    default: return null;
  }
}

function speedCurveSetptsExpr(clip: Clip, localStartS: number, durationS: number, sourceSpanS: number): string {
  const steps = 64;
  const startUs = Math.round(localStartS * 1e6);
  const endUs = Math.round((localStartS + durationS) * 1e6);
  const startProgress = speedProgressAt(clip, startUs);
  const endProgress = speedProgressAt(clip, endUs);
  const values = Array.from({ length: steps + 1 }, (_, index) => {
    const progress = startProgress + (endProgress - startProgress) * index / steps;
    return timelineLocalAtProgress(clip, progress) / 1e6 - localStartS;
  });
  let expression = n(values[steps]!);
  for (let index = steps - 1; index >= 0; index--) {
    const from = index * sourceSpanS / steps;
    const to = (index + 1) * sourceSpanS / steps;
    const fraction = `clip((T-${n(from)})/${n(to - from)},0,1)`;
    const value = `(${n(values[index]!)}+(${n(values[index + 1]! - values[index]!)}*${fraction}))`;
    expression = `if(lt(T,${n(to)}),${value},${expression})`;
  }
  return expression;
}

export function encodingArgs(enc: VideoEncoding, fps: Rational): string[] {
  const g = String(Math.max(1, Math.round((2 * fps.num) / fps.den)));
  if (enc.codec === 'prores') {
    return ['-c:v', 'prores_ks', '-profile:v', enc.quality === 2 ? '4' : '3', '-pix_fmt', enc.quality === 2 ? 'yuva444p10le' : 'yuv422p10le', '-vendor', 'apl0'];
  }
  const target = enc.encoder && enc.encoder !== 'auto' ? enc.encoder : 'cpu';
  const crf = enc.crf ?? (enc.codec === 'h265' ? [26, 20, 17][enc.quality]! : [23, 18, 15][enc.quality]!);
  const rate = enc.rateControl ?? 'crf';
  const bitrate = enc.bitrateK ?? 8000;
  const rateArgs = rate === 'bitrate' ? ['-b:v', `${bitrate}k`, '-maxrate', `${Math.round(bitrate * 1.15)}k`, '-bufsize', `${bitrate * 2}k`] : [];
  if (target !== 'cpu') {
    const name = hardwareEncoder(target, enc.codec);
    const quality = ['speed', 'balanced', 'quality'][enc.quality]!;
    if (target === 'amf') {
      return ['-c:v', name, '-quality', quality, ...(rate === 'bitrate' ? rateArgs : ['-rc', 'cqp', '-qp_i', String(crf), '-qp_p', String(crf)]), '-pix_fmt', 'yuv420p', '-g', g];
    }
    if (target === 'nvenc') {
      return ['-c:v', name, '-preset', `p${enc.quality === 0 ? 1 : enc.quality === 1 ? 4 : 7}`, ...(rate === 'bitrate' ? rateArgs : ['-rc', 'vbr', '-cq', String(crf), '-b:v', '0']), '-pix_fmt', 'yuv420p', '-g', g, ...(enc.codec === 'h265' && (enc.container ?? 'mp4') === 'mp4' ? ['-tag:v', 'hvc1'] : [])];
    }
    return ['-c:v', name, '-preset', ['veryfast', 'medium', 'veryslow'][enc.quality]!, ...(rate === 'bitrate' ? rateArgs : ['-global_quality', String(crf)]), '-pix_fmt', 'yuv420p', '-g', g, ...(enc.codec === 'h265' && (enc.container ?? 'mp4') === 'mp4' ? ['-tag:v', 'hvc1'] : [])];
  }
  const preset = ['veryfast', 'medium', 'slow'][enc.quality]!;
  return [
    '-c:v', cpuEncoder(enc.codec), '-preset', preset,
    ...(rate === 'bitrate' ? rateArgs : ['-crf', String(crf)]),
    '-pix_fmt', 'yuv420p', ...(enc.codec === 'h264' ? ['-profile:v', 'high'] : (enc.container ?? 'mp4') === 'mp4' ? ['-tag:v', 'hvc1'] : []),
    '-g', g,
    ...(enc.codec === 'h265' ? ['-x265-params', 'log-level=error'] : []),
  ];
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

function transitionCurve(value: unknown): TransitionCurve {
  return value === 'ease-in' || value === 'ease-out' || value === 'ease-in-out' ? value : 'linear';
}

function transitionNumber(transition: Clip['transitionIn'], key: string, fallback: number): number {
  const value = transition?.params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function curveExpr(x: string, curve: TransitionCurve): string {
  const c = `clip(${x},0,1)`;
  if (curve === 'ease-in') return `((${c})*(${c}))`;
  if (curve === 'ease-out') return `(1-(1-(${c}))*(1-(${c})))`;
  if (curve === 'ease-in-out') return `(0.5-0.5*cos(PI*(${c})))`;
  return c;
}

function rampValueExpr(ramp: Ramp, startS: number, peak = 1): string {
  const curve = curveExpr(`(T-${n(startS)})/${n(ramp.durS)}`, ramp.curve ?? 'linear');
  const intensity = ramp.intensity === undefined ? 1 : Math.max(0, Math.min(1, ramp.intensity));
  const x = intensity < 1 ? `pow(${curve},${n(1 + (1 - intensity) * 3)})` : curve;
  return `(${n(ramp.from)}+(${n(ramp.to - ramp.from)})*${x})/${n(peak)}`;
}

function whipOffsetExpr(layer: Layer, windowStartUs: number, scale: number, width: number): string {
  const transition = layer.transition;
  if (!transition || transition.transition !== 'whip_pan' || transition.durationUs <= 0) return '0';
  const durationS = transition.durationUs / 1e6;
  const phaseStartS = (windowStartUs - layer.transitionStartUs) / 1e6;
  const progress = curveExpr(`(t+${n(phaseStartS)})/${n(durationS)}`, transitionCurve(transition.params.curve));
  const intensity = Math.min(1, Math.max(0.1, transitionNumber(transition, 'intensity', 0.65)));
  const direction = transition.params.direction === -1 ? -1 : 1;
  const distance = n(width * scale * intensity);
  return layer.underlay
    ? `${direction}*${distance}*${progress}`
    : `${-direction}*${distance}*(1-${progress})`;
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
  colorLutPath?(clip: Clip): string | null;
  /**
   * Texto já desenhado (mesmo desenho do preview), do tamanho do quadro.
   * `sequence`: um PNG por quadro do clipe (`%05d`, quadro 0 = início do clipe), já com
   * animação, opacidade e tremida; senão, uma imagem só.
   */
  textImage(clip: Clip): { path: string; sequence: boolean } | null;
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

  const overlayOnto = (label: string, x: string, y: string, enable?: string, blendMode: Clip['blendMode'] = 'normal') => {
    if (blendMode === 'normal') {
      const out = `v${filters.length}`;
      filters.push(`[${cur}][${label}]overlay=x='${x}':y='${y}':eval=frame:eof_action=pass:format=yuv420${enable ? `:enable='${enable}'` : ''}[${out}]`);
      cur = out;
      return;
    }

    const transparent = `transparent${filters.length}`;
    const fullLayer = `full${filters.length}`;
    const topLayer = `toplayer${filters.length}`;
    const alphaLayer = `alphalayer${filters.length}`;
    const alpha = `alpha${filters.length}`;
    const topRgb = `toprgb${filters.length}`;
    const bottomRgb = `bottomrgb${filters.length}`;
    const blendedRgb = `blendrgb${filters.length}`;
    const blended = `blend${filters.length}`;
    const next = `v${filters.length}`;
    filters.push(`color=c=black@0:s=${W}x${H}:r=${FPS}:d=${n(Dw + 1, 3)},format=yuva420p[${transparent}]`);
    filters.push(`[${transparent}][${label}]overlay=x='${x}':y='${y}':eval=frame:eof_action=pass:format=auto${enable ? `:enable='${enable}'` : ''}[${fullLayer}]`);
    filters.push(`[${fullLayer}]split=2[${topLayer}][${alphaLayer}]`);
    filters.push(`[${topLayer}]format=gbrp[${topRgb}]`);
    filters.push(`[${cur}]format=gbrp[${bottomRgb}]`);
    filters.push(`[${topRgb}][${bottomRgb}]blend=all_mode=${blendMode}[${blendedRgb}]`);
    filters.push(`[${alphaLayer}]alphaextract[${alpha}]`);
    filters.push(`[${blendedRgb}][${alpha}]alphamerge[${blended}]`);
    filters.push(`[${cur}][${blended}]overlay=x=0:y=0:eval=frame:eof_action=pass:format=yuv420[${next}]`);
    cur = next;
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

    let textBaked = false;
    if (c.text) {
      const img = o.textImage(c);
      if (!img) continue;
      if (img.sequence) {
        textBaked = true;
        const startFrame = Math.max(0, Math.round((Ls * fps.num) / fps.den));
        inputs.push('-framerate', FPS, '-start_number', String(startFrame), '-i', img.path);
      } else {
        inputs.push('-loop', '1', '-framerate', FPS, '-t', n(chainLen + 0.1, 3), '-i', img.path);
      }
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
      } else if (hasSpeedCurve(c) || c.reverse) {
        const sourceAtStart = sourceTimeAt(c, Math.round(Ls * 1e6));
        const sourceAtEnd = sourceTimeAt(c, Math.round((Ls + chainLen) * 1e6));
        const sourceStart = Math.min(sourceAtStart, sourceAtEnd) / 1e6;
        const sourceSpan = Math.abs(sourceAtEnd - sourceAtStart) / 1e6;
        const frameDuration = fps.den / fps.num;
        inputs.push(
          '-ss', n(Math.max(0, sourceStart), 6),
          '-t', n(Math.max(frameDuration, sourceSpan) + frameDuration, 6),
          '-i', src.path,
        );
        if (sourceSpan < frameDuration / 2) {
          chain.push(
            `[${inputIdx}:v:0]trim=end_frame=1`,
            'setpts=PTS-STARTPTS',
            `tpad=stop_mode=clone:stop_duration=${n(chainLen + frameDuration)}`,
          );
        } else {
          chain.push(`[${inputIdx}:v:0]trim=duration=${n(sourceSpan + frameDuration)}`, 'setpts=PTS-STARTPTS');
          if (c.reverse) chain.push('reverse', 'setpts=PTS-STARTPTS');
          if (hasSpeedCurve(c)) {
            const expression = speedCurveSetptsExpr(c, Ls, chainLen, sourceSpan);
            chain.push(`setpts='(${expression})/TB'`);
          } else {
            chain.push(`setpts=(PTS-STARTPTS)/${n(c.speed)}`);
          }
        }
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
      // encaixa (contain) no quadro do projeto e aplica a escala
      const fit = Math.min(P.width / cw, P.height / ch);
      const LW = even(cw * fit * tr.scale * kx);
      const LH = even(ch * fit * tr.scale * kx);
      chain.push(`scale=${LW}:${LH}:flags=bicubic`, 'setsar=1');
      const z = zoomExpr(c, `it+${n(Ls)}`);
      if (z) chain.push(`zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${LW}x${LH}:fps=${FPS}`);
      const lutPath = o.colorLutPath?.(c);
      if (lutPath) {
        const escapedPath = lutPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
        chain.push(`format=rgb24,lut3d=file='${escapedPath}':interp=trilinear`);
      }
      const whipBlur = layer.transition?.transition === 'whip_pan'
        ? Math.max(0, Math.min(32, transitionNumber(layer.transition, 'blur', 8)))
        : 0;
      const blur = sum(c, 'blur', 'amount') + whipBlur;
      if (blur > 0) chain.push(`gblur=sigma=${n(blur * kx, 3)}`);
      const rgb = Math.round(sum(c, 'rgb_split', 'amount') * kx);
      if (rgb > 0) chain.push('format=gbrp', `rgbashift=rh=${-rgb}:bh=${rgb}`);
      const vig = Math.max(
        0,
        ...c.effects.filter((f) => f.enabled && f.effect === 'color').map((f) => param(f, 'vignette')),
        ...c.effects.filter((f) => f.enabled && f.effect === 'vignette').map((f) => param(f, 'strength')),
      );
      if (vig > 0) chain.push(`vignette=angle=${n((vig * Math.PI) / 2.5, 4)}`);
      chain.push('format=yuva420p');
      const alphaMask = maskExpr(c.mask);
      if (alphaMask) chain.push(`geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*(${alphaMask})'`);
      const opacityFrames = c.keyframes['transform.opacity'];
      if (tr.opacity < 1 || opacityFrames?.length) {
        const opacity = keyframeExpr(opacityFrames, tr.opacity, `T+${n(Ls)}`);
        chain.push(`geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*clip(${opacity},0,1)'`);
      }
      for (const r of ramps) {
        if (r.target !== 'alpha' || textBaked) continue;
        const st = r.startS - Ls;
        if (st + r.durS <= 1e-6 || st >= chainLen) continue;
        const expression = rampValueExpr(r, st);
        chain.push(`geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(between(T,${n(st)},${n(st + r.durS)}),alpha(X,Y)*(${expression}),alpha(X,Y))'`);
      }
    }
    const rotationFrames = c.text ? undefined : c.keyframes['transform.rotation'];
    if (tr.rotation || rotationFrames?.length) {
      const maxRotation = Math.max(Math.abs(tr.rotation), ...(rotationFrames ?? []).map((keyframe) => Math.abs(keyframe.value)));
      const maxAngle = n((maxRotation * Math.PI) / 180, 6);
      const angle = rotationFrames?.length
        ? `(${keyframeExpr(rotationFrames, tr.rotation, `n*${fps.den}/${fps.num}+${n(Ls)}`)})*PI/180`
        : n((tr.rotation * Math.PI) / 180, 6);
      chain.push(`rotate=a='${angle}':ow=rotw(${maxAngle}):oh=roth(${maxAngle}):c=none`);
    }
    const scaleFrames = c.text ? undefined : c.keyframes['transform.scale'];
    if (scaleFrames?.length) {
      const scale = keyframeExpr(scaleFrames, tr.scale, `n*${fps.den}/${fps.num}+${n(Ls)}`);
      chain.push(`scale=w='max(2,trunc(iw*(${scale})/${n(tr.scale)}/2)*2)':h='max(2,trunc(ih*(${scale})/${n(tr.scale)}/2)*2)':eval=frame:flags=bicubic`, 'setsar=1');
    }
    const opacityFrames = c.keyframes['transform.opacity'];
    if (c.text && !textBaked && (tr.opacity < 1 || opacityFrames?.length)) {
      const opacity = keyframeExpr(opacityFrames, tr.opacity, `T+${n(Ls)}`);
      chain.push(`geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*clip(${opacity},0,1)'`);
    }
    const alphaMask = maskExpr(c.mask);
    if (alphaMask && c.text) chain.push(`geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*(${alphaMask})'`);
    if (p > 0) chain.push(`trim=start=${n(p)}`, 'setpts=PTS-STARTPTS');
    filters.push(`${chain.join(',')}[${lbl}]`);
    inputIdx++;
    layerCount++;

    // posição: centro + deslocamento + tremida (tempo da janela t → local t+L0)
    const T = `t+${n(L0)}`;
    // texto: a imagem já tem o quadro inteiro com a posição desenhada
    const animatedX = keyframeExpr(c.keyframes['transform.x'], tr.x, T);
    const animatedY = keyframeExpr(c.keyframes['transform.y'], tr.y, T);
    const whipX = whipOffsetExpr(layer, w.startUs, kx, W);
    const x = c.text ? (textBaked ? whipX : `(${shakeExpr(c, T, 'x')})*${n(kx)}+(${whipX})`) : `(W-w)/2+(${animatedX})*${n(kx)}+(${shakeExpr(c, T, 'x')})*${n(kx)}+(${whipX})`;
    const y = c.text ? (textBaked ? '0' : `(${shakeExpr(c, T, 'y')})*${n(kx)}`) : `(H-h)/2+(${animatedY})*${n(kx)}+(${shakeExpr(c, T, 'y')})*${n(kx)}`;
    overlayOnto(lbl, x, y, undefined, c.blendMode);

    // camadas de cor (clarão, fades, mergulho) por cima do clipe
    for (const r of ramps) {
      if (r.target !== 'overlay') continue;
      const st = r.startS - Ls;
      if (st + r.durS <= 1e-6 || st >= chainLen) continue;
      const peak = Math.max(r.from, r.to);
      const expression = rampValueExpr(r, st, peak);
      const cl = `c${filters.length}`;
      filters.push(
        `color=c=${r.white ? 'white' : 'black'}:s=${W}x${H}:r=${FPS}:d=${n(chainLen + 0.1, 3)},format=yuva420p,colorchannelmixer=aa=${n(peak, 4)},geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(between(T,${n(st)},${n(st + r.durS)}),alpha(X,Y)*(${expression}),0)'${p > 0 ? `,trim=start=${n(p)},setpts=PTS-STARTPTS` : ''}[${cl}]`,
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
