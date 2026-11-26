import { evalClipLook, evaluateKeyframes, type Clip, type ClipLook } from '@amv/project';

export const TEXT_ANIMATIONS_IN = [
  { id: '', label: 'Nenhuma' },
  { id: 'fade', label: 'Surgir' },
  { id: 'pop', label: 'Pop' },
  { id: 'slide', label: 'Subir' },
  { id: 'slide-left', label: 'Entrar da esquerda' },
  { id: 'slide-right', label: 'Entrar da direita' },
  { id: 'blur', label: 'Desfoque para foco' },
  { id: 'typewriter', label: 'Máquina de escrever' },
] as const;

export const TEXT_ANIMATIONS_OUT = [
  { id: '', label: 'Nenhuma' },
  { id: 'fade', label: 'Sumir' },
  { id: 'slide', label: 'Descer' },
  { id: 'pop', label: 'Reduzir' },
  { id: 'blur', label: 'Desfocar' },
] as const;

/** Texto tem algo que muda com o tempo? (decide entre 1 imagem ou sequência na exportação) */
export function textIsAnimated(c: Clip): boolean {
  return !!(
    c.text?.animationIn ||
    c.text?.animationOut ||
    c.text?.sheen ||
    (c.text?.chromaticAberration ?? 0) > 0 ||
    c.text?.wordTimings.length ||
    (c.text?.syllableAnimation && c.text.wordTimings.some((word) => word.syllables.length)) ||
    c.keyframes['transform.scale']?.length ||
    c.keyframes['transform.rotation']?.length ||
    c.keyframes['transform.x']?.length ||
    c.keyframes['transform.y']?.length ||
    c.keyframes['transform.opacity']?.length ||
    c.effects.some((f) => f.enabled && f.effect === 'shake') ||
    c.transitionIn
  );
}

/** Índice da palavra ativa (só timings confiáveis) no instante `nowUs`, ou -1. */
export function activeWordIndex(wordTimings: NonNullable<Clip['text']>['wordTimings'], nowUs: number): number {
  return wordTimings.findIndex((word) => {
    const reliable = !word.uncertain && (
      word.source === 'ass' || word.source === 'lrc' || word.source === 'manual' ||
      ((word.source === 'whisper' || word.source === 'estimated') && (word.confidence ?? 0) >= 0.55)
    );
    return reliable && nowUs >= word.startUs && nowUs < word.endUs;
  });
}

/**
 * Chave de "estado estável" do texto: quando o desenho só depende da palavra ativa
 * (sem entrada/saída/keyframes/shake/brilho animado), devolve uma chave para cachear o frame.
 * Devolve null se o desenho muda a cada frame.
 */
export function textSteadyKey(c: Clip, localS: number): string | null {
  const t = c.text;
  if (!t) return null;
  const dur = c.durationUs / 1e6;
  const inS = t.animationIn ? Math.min((t.animationInUs ?? 300_000) / 1e6, dur * 0.4) : 0;
  const outS = t.animationOut ? Math.min((t.animationOutUs ?? 250_000) / 1e6, dur * 0.25) : 0;
  const trS = c.transitionIn ? c.transitionIn.durationUs / 1e6 : 0;
  if (localS < Math.max(inS, trS) || localS > dur - outS) return null;
  if (t.animationIn === 'typewriter' || t.sheen || (t.chromaticAberration ?? 0) > 0) return null;
  if (t.syllableAnimation && t.wordTimings.some((w) => w.syllables.length)) return null;
  if (t.wordTimings.length && t.wordAnimation !== 'none' && t.wordAnimation !== 'highlight') return null;
  if (
    c.keyframes['transform.scale']?.length || c.keyframes['transform.rotation']?.length ||
    c.keyframes['transform.x']?.length || c.keyframes['transform.y']?.length ||
    c.keyframes['transform.opacity']?.length || c.effects.some((f) => f.enabled && f.effect === 'shake')
  ) return null;
  return String(t.wordTimings.length ? activeWordIndex(t.wordTimings, Math.round(localS * 1e6)) : -1);
}

/** Indica se o preview pode pré-renderizar os glifos num sprite recortado e animar só a transformação por quadro. */
export function canUseTextSprite(c: Clip): boolean {
  const t = c.text;
  if (!t || !t.text.trim()) return false;
  if (t.background === 'full' || t.animationIn === 'typewriter') return false;
  if (t.syllableAnimation && t.wordTimings.some((w) => w.syllables.length > 0)) return false;
  return true;
}

export interface TextSpriteEnvelope {
  alpha: number;
  relScale: number;
  baseScale: number;
  x: number;
  centerY: number;
  rotation: number;
  activeWord: number;
}

/** Avalia opacidade, escala, deslocamento e rotação de entrada/saída/keyframes sem redesenhar os glifos. */
export function evalTextEnvelope(
  c: Clip,
  projW: number,
  projH: number,
  localS: number,
  look: ClipLook,
): TextSpriteEnvelope | null {
  const t = c.text;
  if (!t || !t.text.trim()) return null;
  const dur = Math.max(0.001, c.durationUs / 1e6);
  const inDuration = Math.min((t.animationInUs ?? 300_000) / 1e6, dur * 0.4);
  const outDuration = Math.min((t.animationOutUs ?? 250_000) / 1e6, dur * 0.25);
  let alpha = c.transform.opacity > 0
    ? look.alpha / c.transform.opacity
    : evalClipLook({ ...c, transform: { ...c.transform, opacity: 1 } }, localS, dur).alpha;
  const atUs = Math.round(localS * 1e6);
  const baseScale = Math.max(0.1, c.transform.scale || 1);
  let scale = evaluateKeyframes(c.keyframes['transform.scale'], atUs, baseScale);
  alpha *= Math.max(0, Math.min(1, evaluateKeyframes(c.keyframes['transform.opacity'], atUs, c.transform.opacity)));
  let dx = 0;
  let dy = 0;

  const a = t.animationIn;
  if (a && inDuration > 0 && localS < inDuration) {
    const u = Math.max(0, localS / inDuration);
    if (a === 'fade') alpha *= u;
    else if (a === 'pop') {
      scale *= 0.6 + 0.4 * backOut(u);
      alpha *= Math.min(1, u * 2);
    } else if (a === 'slide') {
      dy = 40 * (1 - u) * (1 - u);
      alpha *= u;
    } else if (a === 'slide-left') {
      dx = -Math.min(160, projW * 0.2) * (1 - u) * (1 - u);
      alpha *= u;
    } else if (a === 'slide-right') {
      dx = Math.min(160, projW * 0.2) * (1 - u) * (1 - u);
      alpha *= u;
    } else if (a === 'blur') {
      alpha *= Math.min(1, u * 1.5);
    }
  }
  const b = t.animationOut;
  if (b && outDuration > 0 && dur - localS < outDuration) {
    const u = Math.max(0, (dur - localS) / outDuration);
    if (b === 'fade') alpha *= u;
    else if (b === 'slide') {
      dy += 30 * (1 - u);
      alpha *= u;
    } else if (b === 'pop') {
      scale *= 0.75 + 0.25 * u;
    } else if (b === 'blur') {
      alpha *= u;
    }
  }
  if (alpha <= 0) return null;

  const est = estimateTextBounds(
    { ...c, transform: { ...c.transform, x: 0, y: 0, scale, rotation: 0 }, keyframes: {} },
    projW,
    projH,
    0,
  );
  const contentH = est?.height ?? Math.max(24, t.size * scale * 1.5);
  const verticalLimit = Math.max(0, projH / 2 - (t.marginY ?? 0) - contentH / 2);
  const x = evaluateKeyframes(c.keyframes['transform.x'], atUs, c.transform.x) + look.dx + dx;
  const y = evaluateKeyframes(c.keyframes['transform.y'], atUs, c.transform.y);
  const centerY = Math.max(-verticalLimit, Math.min(verticalLimit, y + look.dy + dy));
  const rotation = evaluateKeyframes(c.keyframes['transform.rotation'], atUs, c.transform.rotation);
  const wordTimings = t.wordTimings ?? [];
  const activeWord = wordTimings.length ? activeWordIndex(wordTimings, atUs) : -1;
  return {
    alpha: Math.min(1, alpha),
    relScale: scale / baseScale,
    baseScale,
    x,
    centerY,
    rotation,
    activeWord,
  };
}

/** Renderiza uma única vez os glifos (com extrusão, contorno duplo, sombra e glow) num canvas recortado. */
export function renderTextSpriteCanvas(
  createCanvas: (w: number, h: number) => HTMLCanvasElement,
  c: Clip,
  projW: number,
  projH: number,
  k: number,
  activeWord: number,
): HTMLCanvasElement | null {
  const t = c.text;
  if (!t || !t.text.trim()) return null;
  const baseScale = Math.max(0.1, c.transform.scale || 1);
  const est = estimateTextBounds(
    { ...c, transform: { ...c.transform, x: 0, y: 0, scale: baseScale, rotation: 0 }, keyframes: {} },
    projW,
    projH,
    0,
  );
  const fxMarginProj =
    Math.max(36, t.size * baseScale * 0.55)
    + (t.extrudeDepth ?? 0) * 2
    + (t.glowIntensity ?? 0) * 2.5
    + ((t.outlineWidth ?? 0) + (t.outerOutlineWidth ?? 0)) * 4
    + (t.chromaticAberration ?? 0) * 3;
  const spriteProjW = t.background === 'bar'
    ? projW
    : Math.min(projW * 1.15, (est?.width ?? projW * 0.9) * 1.18 + fxMarginProj * 2);
  const spriteProjH = Math.min(projH * 1.15, (est?.height ?? t.size * baseScale * 2.4) * 1.25 + fxMarginProj * 2);
  const spriteW = Math.max(8, Math.ceil(spriteProjW * k));
  const spriteH = Math.max(8, Math.ceil(spriteProjH * k));
  const canvas = createCanvas(spriteW, spriteH);
  const sCtx = canvas.getContext('2d');
  if (!sCtx) return null;

  const dur = Math.max(0.5, c.durationUs / 1e6);
  const sampleLocalS = Math.max(0.25, dur * 0.5);
  const sampleUs = Math.round(sampleLocalS * 1e6);
  const syntheticTimings = (t.wordTimings ?? []).map((w, idx) =>
    idx === activeWord
      ? { ...w, source: 'manual' as const, confidence: 1, uncertain: false, startUs: 0, endUs: sampleUs + 10_000 }
      : { ...w, startUs: -20_000, endUs: -10_000 },
  );
  const canonicalClip: Clip = {
    ...c,
    blendMode: 'normal',
    mask: 'none',
    effects: [],
    transitionIn: null,
    keyframes: {},
    durationUs: Math.max(1_000_000, c.durationUs),
    transform: { ...c.transform, x: 0, y: 0, scale: baseScale, rotation: 0, opacity: 1 },
    text: {
      ...t,
      animationIn: null,
      animationOut: null,
      wordTimings: syntheticTimings,
    },
  };
  const neutralLook = evalClipLook(canonicalClip, sampleLocalS, canonicalClip.durationUs / 1e6);
  sCtx.save();
  sCtx.translate(spriteW / 2 - (projW / 2) * k, spriteH / 2 - (projH / 2) * k);
  drawTextLayer(sCtx, canonicalClip, projW, projH, k, neutralLook, sampleLocalS);
  sCtx.restore();
  return canvas;
}

function backOut(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

interface TextPart {
  word: string;
  space: string;
  timingIndex: number;
  width: number;
}

interface TextLine {
  parts: TextPart[];
  width: number;
}

export function splitTimedText(
  text: string,
  wordTimings: NonNullable<Clip['text']>['wordTimings'],
): { text: string; timingIndex: number }[] | null {
  const parts: { text: string; timingIndex: number }[] = [];
  let joined = '';
  for (let index = 0; index < wordTimings.length; index++) {
    const timing = wordTimings[index];
    if (!timing) continue;
    const piece = timing.text.trim();
    const candidate = joined + piece;
    if (!text.normalize('NFC').toLowerCase().startsWith(candidate.normalize('NFC').toLowerCase())) return null;
    joined = candidate;
    parts.push({ text: text.slice(joined.length - piece.length, joined.length), timingIndex: index });
    if (joined.length === text.length) return parts;
  }
  return null;
}

interface GraphemeSegmenterLike {
  segment(input: string): Iterable<{ segment: string }>;
}
type GraphemeSegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: 'grapheme' },
) => GraphemeSegmenterLike;

/** Breaks overlong tokens at grapheme boundaries (important for CJK scripts). */
export function splitOverlongText(
  text: string,
  maxWidth: number,
  measure: (value: string) => number,
): string[] {
  if (!text) return [];
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return [text];
  const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenterConstructor }).Segmenter;
  const units = Segmenter
    ? Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (part) => part.segment)
    : Array.from(text);
  const lines: string[] = [];
  let current = '';
  for (const unit of units) {
    if (current && measure(current + unit) > maxWidth) {
      lines.push(current);
      current = unit;
    } else current += unit;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text];
}

const glyphWidthCache = new Map<string, number>();

function charWidthCached(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, char: string): number {
  if (!('letterSpacing' in (ctx as object))) return (ctx as CanvasRenderingContext2D).measureText(char).width;
  const key = `${ctx.font}\0${char}`;
  let w = glyphWidthCache.get(key);
  if (w === undefined) {
    w = ctx.measureText(char).width;
    if (glyphWidthCache.size > 4096) glyphWidthCache.clear();
    glyphWidthCache.set(key, w);
  }
  return w;
}

function measured(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, text: string, spacing: number): number {
  if (!spacing) return ctx.measureText(text).width;
  const chars = Array.from(text);
  return chars.reduce((width, char) => width + charWidthCached(ctx, char), 0) + Math.max(0, chars.length - 1) * spacing;
}

function drawSpaced(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
): void {
  if (!spacing) {
    ctx.fillText(text, x, y);
    return;
  }
  if ('letterSpacing' in ctx && (ctx.shadowBlur ?? 0) > 0) {
    const prev = (ctx as CanvasRenderingContext2D).letterSpacing;
    (ctx as CanvasRenderingContext2D).letterSpacing = `${spacing}px`;
    ctx.fillText(text, x, y);
    (ctx as CanvasRenderingContext2D).letterSpacing = prev;
    return;
  }
  for (const char of Array.from(text)) {
    ctx.fillText(char, x, y);
    x += charWidthCached(ctx, char) + spacing;
  }
}

function strokeSpaced(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
): void {
  if (!spacing) {
    ctx.strokeText(text, x, y);
    return;
  }
  if ('letterSpacing' in ctx && (ctx.shadowBlur ?? 0) > 0) {
    const prev = (ctx as CanvasRenderingContext2D).letterSpacing;
    (ctx as CanvasRenderingContext2D).letterSpacing = `${spacing}px`;
    ctx.strokeText(text, x, y);
    (ctx as CanvasRenderingContext2D).letterSpacing = prev;
    return;
  }
  for (const char of Array.from(text)) {
    ctx.strokeText(char, x, y);
    x += charWidthCached(ctx, char) + spacing;
  }
}

function layoutLines(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  width: number,
  spacing: number,
  wordTimings: NonNullable<Clip['text']>['wordTimings'],
): TextLine[] {
  const lines: TextLine[] = [];
  let timingIndex = 0;
  const append = (word: string, index: number, parts: TextPart[]) => {
    const chunks = splitOverlongText(word, width, (value) => measured(ctx, value, spacing));
    for (const chunk of chunks) {
      const part = { word: chunk, space: '', timingIndex: index, width: measured(ctx, chunk, spacing) };
      if (parts.length && parts.reduce((sum, item) => sum + item.width, 0) + part.width > width) {
        lines.push({ parts: parts.splice(0), width: 0 });
      }
      parts.push(part);
    }
  };
  for (const paragraph of text.split('\n')) {
    const parts: TextPart[] = [];
    for (const match of paragraph.matchAll(/\S+|\s+/gu)) {
      const token = match[0];
      if (/^\s+$/u.test(token)) {
        const previous = parts.at(-1);
        if (previous) {
          previous.space += token;
          previous.width += measured(ctx, token, spacing);
        }
        continue;
      }
      const timedParts = splitTimedText(token, wordTimings.slice(timingIndex));
      if (timedParts) {
        for (const timedPart of timedParts) {
          append(timedPart.text, timingIndex + timedPart.timingIndex, parts);
        }
        timingIndex += timedParts.length;
      } else {
        append(token, timingIndex, parts);
        timingIndex++;
      }
    }
    if (parts.length) lines.push({ parts, width: 0 });
    else if (!paragraph) lines.push({ parts: [], width: 0 });
  }
  for (const line of lines) line.width = line.parts.reduce((sum, part) => sum + part.width, 0);
  return lines;
}

/**
 * Desenha um clipe de texto. Usado pelo preview E pela exportação (que gera PNGs com
 * este mesmo desenho), então o resultado é idêntico. `k` = escala projeto → canvas.
 */
export function drawTextLayer(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, c: Clip, projW: number, projH: number, k: number, look: ClipLook, localS: number): void {
  const t = c.text;
  if (!t || !t.text.trim()) return;
  const dur = c.durationUs / 1e6;
  const inDuration = Math.min((t.animationInUs ?? 300_000) / 1e6, dur * 0.4);
  const outDuration = Math.min((t.animationOutUs ?? 250_000) / 1e6, dur * 0.25);
  // look.alpha already includes base opacity; keyframes replace that base, not multiply it twice.
  let alpha = c.transform.opacity > 0
    ? look.alpha / c.transform.opacity
    : evalClipLook({ ...c, transform: { ...c.transform, opacity: 1 } }, localS, dur).alpha;
  const atUs = Math.round(localS * 1e6);
  let scale = evaluateKeyframes(c.keyframes['transform.scale'], atUs, c.transform.scale);
  alpha *= Math.max(0, Math.min(1, evaluateKeyframes(c.keyframes['transform.opacity'], atUs, c.transform.opacity)));
  let dy = 0;
  let dx = 0;
  let blur = 0;
  let visibleChars = Infinity;

  const a = t.animationIn;
  if (a && localS < inDuration) {
    const x = Math.max(0, localS / inDuration);
    if (a === 'fade') alpha *= x;
    if (a === 'pop') {
      scale *= 0.6 + 0.4 * backOut(x);
      alpha *= Math.min(1, x * 2);
      if (x < 0.45) blur = Math.max(blur, 4 * (1 - x / 0.45));
    }
    if (a === 'slide') {
      dy = 40 * (1 - x) * (1 - x);
      alpha *= x;
      if (x < 0.5) blur = Math.max(blur, 5 * (1 - x / 0.5));
    }
    if (a === 'slide-left') {
      dx = -Math.min(160, projW * 0.2) * (1 - x) * (1 - x);
      alpha *= x;
      if (x < 0.55) blur = Math.max(blur, 8 * (1 - x / 0.55));
    }
    if (a === 'slide-right') {
      dx = Math.min(160, projW * 0.2) * (1 - x) * (1 - x);
      alpha *= x;
      if (x < 0.55) blur = Math.max(blur, 8 * (1 - x / 0.55));
    }
    if (a === 'blur') {
      blur = 14 * (1 - x);
      alpha *= Math.min(1, x * 1.5);
    }
  }
  if (a === 'typewriter') {
    const span = Math.min(1.5, dur * 0.6);
    visibleChars = Math.floor((localS / span) * Array.from(t.text).length);
  }
  const b = t.animationOut;
  if (b && dur - localS < outDuration) {
    const x = Math.max(0, (dur - localS) / outDuration);
    if (b === 'fade') alpha *= x;
    if (b === 'slide') {
      dy += 30 * (1 - x);
      alpha *= x;
    }
    if (b === 'pop') scale *= 0.75 + 0.25 * x;
    if (b === 'blur') blur = Math.max(blur, 12 * (1 - x));
  }
  if (alpha <= 0) return;

  const shown = Array.from(t.text).slice(0, Math.max(0, visibleChars)).join('');
  let size = t.size * scale * k;
  const baseFontStyle = t.italic ? 'italic ' : '';
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  if (blur > 0) ctx.filter = `blur(${blur * k}px)`;
  if (t.background === 'full') {
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }
  ctx.font = `${baseFontStyle}${t.weight ?? 700} ${size}px "${t.font}", "Manrope Variable", system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const spacing = (t.letterSpacing ?? 0) * k;
  const padding = (t.padding ?? 24) * k;
  const maxWidth = Math.max(size, Math.min(projW * (t.maxWidthRatio ?? 0.9), projW - 2 * (t.marginX ?? 48)) * k);
  const wordTimings = t.wordTimings ?? [];
  let lines = layoutLines(ctx, shown, maxWidth, spacing, wordTimings);
  const safeHeight = Math.max(1, (projH - 2 * (t.marginY ?? 0)) * k - 2 * padding);
  // Reflow long dialogue until the entire block fits; preview and export share this layout.
  for (let attempt = 0; attempt < 12 && lines.length * size * (t.lineSpacing ?? 1.18) > safeHeight; attempt++) {
    size *= Math.min(0.9, safeHeight / (lines.length * size * (t.lineSpacing ?? 1.18)));
    ctx.font = `${baseFontStyle}${t.weight ?? 700} ${size}px "${t.font}", "Manrope Variable", system-ui, sans-serif`;
    lines = layoutLines(ctx, shown, maxWidth, spacing, wordTimings);
  }
  const lh = size * (t.lineSpacing ?? 1.18);
  const totalHeight = Math.max(lh, lines.length * lh);
  const longestLine = Math.max(0, ...lines.map((line) => line.width));
  const contentHeight = totalHeight + 2 * padding;
  const verticalLimit = Math.max(0, projH / 2 - (t.marginY ?? 0) - contentHeight / (2 * k));
  const x = evaluateKeyframes(c.keyframes['transform.x'], atUs, c.transform.x);
  const y = evaluateKeyframes(c.keyframes['transform.y'], atUs, c.transform.y);
  const centerY = Math.max(-verticalLimit, Math.min(verticalLimit, y + look.dy + dy));

  ctx.translate((projW / 2 + x + look.dx + dx) * k, (projH / 2 + centerY) * k);
  const rotation = evaluateKeyframes(c.keyframes['transform.rotation'], atUs, c.transform.rotation);
  if (rotation) ctx.rotate((rotation * Math.PI) / 180);

  if (t.slashBanner && ctx.beginPath && ctx.lineTo) {
    ctx.save();
    const bw = longestLine + padding * 2.4;
    const bh = totalHeight + padding * 1.4;
    const skew = bh * 0.28;
    const by = -bh / 2;
    ctx.globalAlpha *= Math.max(0.55, t.backgroundOpacity ?? 0.78);
    ctx.fillStyle = '#07080d';
    ctx.beginPath();
    ctx.moveTo(-bw / 2 + skew, by);
    ctx.lineTo(bw / 2 + skew, by);
    ctx.lineTo(bw / 2 - skew, by + bh);
    ctx.lineTo(-bw / 2 - skew, by + bh);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.strokeStyle = t.outerOutlineColor ?? t.glowColor ?? '#ff4d6d';
    ctx.lineWidth = Math.max(2, 3 * k);
    ctx.stroke();
    ctx.restore();
  } else if (t.background === 'bar' || t.background === 'box') {
    ctx.save();
    ctx.globalAlpha *= t.backgroundOpacity;
    ctx.fillStyle = '#000000';
    const y = -totalHeight / 2 - padding;
    if (t.background === 'bar') {
      ctx.fillRect(-projW * k / 2, y, projW * k, totalHeight + 2 * padding);
    } else {
      ctx.fillRect(-longestLine / 2 - padding, y, longestLine + 2 * padding, totalHeight + 2 * padding);
    }
    ctx.restore();
  }

  const nowUs = Math.round(localS * 1e6);
  const activeWord = activeWordIndex(wordTimings, nowUs);

  const y0 = -((lines.length - 1) * lh) / 2;
  // Escolhe a palavra "Hero" (última palavra forte >= 3 letras, ou maior palavra da frase) quando heroWord=true
  const allParts = lines.flatMap((l) => l.parts);
  let heroTimingIdx = -1;
  if (t.heroWord && allParts.length >= 2) {
    for (let idx = allParts.length - 1; idx >= 0; idx--) {
      const cleanLen = allParts[idx]!.word.replace(/[^\p{L}\p{N}]/gu, '').length;
      if (cleanLen >= 3) {
        heroTimingIdx = allParts[idx]!.timingIndex;
        break;
      }
    }
    if (heroTimingIdx < 0) heroTimingIdx = allParts[allParts.length - 1]!.timingIndex;
  }
  const sheenPhase = t.sheen && dur > 0 ? Math.max(0, Math.min(1, localS / dur)) : -1;
  const punchDecay = localS < 0.22 ? 1 - (localS / 0.22) * 0.65 : 0.35;
  const caShift = (t.chromaticAberration ?? 0) * punchDecay * k;

  lines.forEach((line, lineIndex) => {
    const y = y0 + lineIndex * lh;
    const lineStart = t.alignment === 'left' ? -maxWidth / 2 : t.alignment === 'right' ? maxWidth / 2 - line.width : -line.width / 2;
    let x = lineStart;
    for (const part of line.parts) {
      const word = wordTimings[part.timingIndex];
      const active = part.timingIndex === activeWord;
      const isHero = heroTimingIdx >= 0 && part.timingIndex === heroTimingIdx;
      const animation = t.wordAnimation ?? 'highlight';
      const wordProgress = word ? Math.max(0, Math.min(1, (nowUs - word.startUs) / Math.max(1, word.endUs - word.startUs))) : 1;
      const defaultWordScale = active && animation === 'highlight' ? t.highlightScale ?? 1.12 : active && animation === 'pop' ? 1 + 0.12 * backOut(wordProgress) : 1;
      const heroBoost = isHero ? (t.heroScale ?? 1.24) : 1;
      const wordScale = (word?.scale ?? defaultWordScale) * heroBoost;
      const wordX = x + (word?.offsetX ?? 0) * k;
      const wordY = y + (word?.offsetY ?? 0) * k;
      const wordSize = size * wordScale;
      const wordFont = isHero && t.heroFont ? t.heroFont : t.font;
      const wordItalic = isHero ? (t.heroItalic || t.italic) : t.italic;
      const wordIsHollow = t.fillStyle === 'hollow' && !isHero && !(active && animation === 'highlight');
      ctx.save();
      if (isHero && t.heroTiltDeg && ctx.translate && ctx.rotate) {
        const cx = wordX + (part.width * heroBoost) / 2;
        ctx.translate(cx, wordY);
        ctx.rotate((t.heroTiltDeg * Math.PI) / 180);
        ctx.translate(-cx, -wordY);
      }
      ctx.font = `${wordItalic ? 'italic ' : ''}${word?.weight ?? t.weight ?? 700} ${wordSize}px "${wordFont}", "Manrope Variable", system-ui, sans-serif`;
      if (active && animation === 'fade') ctx.globalAlpha *= Math.min(1, wordProgress * 3);

      // 1. Extrusão 3D / sombra dura diagonal (em modo hollow desenha apenas aramado externo)
      const extrudeSteps = Math.min(16, Math.round((t.extrudeDepth ?? 0) * k));
      if (extrudeSteps > 0 && !wordIsHollow) {
        ctx.save();
        ctx.fillStyle = t.extrudeColor ?? '#08080c';
        ctx.strokeStyle = t.extrudeColor ?? '#08080c';
        ctx.lineWidth = Math.max(1, (t.outlineWidth || 2) * 1.8 * k);
        for (let step = extrudeSteps; step >= 1; step--) {
          strokeSpaced(ctx, part.word, wordX + step * 0.85, wordY + step, spacing * wordScale);
          drawSpaced(ctx, part.word, wordX + step * 0.85, wordY + step, spacing * wordScale);
        }
        ctx.restore();
      }

      if (wordIsHollow) {
        // Texto Vazado / Vidro Neon: o vídeo brilha por dentro da letra com borda luminosa dupla
        ctx.save();
        if ((t.glowIntensity ?? 0) > 0 || t.shadow) {
          ctx.shadowColor = t.glowColor ?? '#00f0ff';
          ctx.shadowBlur = Math.max(10, t.glowIntensity ?? 12) * k;
          ctx.shadowOffsetY = 0;
        }
        ctx.lineWidth = Math.max(2.5, (t.outlineWidth || 3) * 1.35 * k);
        ctx.strokeStyle = t.outerOutlineColor ?? t.glowColor ?? t.gradientEndColor ?? '#38bdf8';
        strokeSpaced(ctx, part.word, wordX, wordY, spacing * wordScale);
        ctx.shadowBlur = 0;
        ctx.lineWidth = Math.max(1.5, (t.outlineWidth || 3) * 0.72 * k);
        ctx.strokeStyle = t.color || '#ffffff';
        strokeSpaced(ctx, part.word, wordX, wordY, spacing * wordScale);
        ctx.globalAlpha *= 0.14;
        ctx.fillStyle = t.gradientStartColor ?? t.color ?? '#ffffff';
        drawSpaced(ctx, part.word, wordX, wordY, spacing * wordScale);
        ctx.restore();
        ctx.restore();
        x += part.width * (isHero ? heroBoost : 1);
        continue;
      }

      // 2. Contorno externo duplo (filete neon / branco / dourado por fora da borda escura)
      if (t.outerOutlineColor && (t.outerOutlineWidth ?? 0) > 0) {
        ctx.save();
        ctx.lineWidth = ((t.outlineWidth ?? 0) + (t.outerOutlineWidth ?? 0)) * 2 * k;
        ctx.strokeStyle = t.outerOutlineColor;
        strokeSpaced(ctx, part.word, wordX, wordY, spacing * wordScale);
        ctx.restore();
      }

      if (t.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.85)';
        ctx.shadowBlur = 10 * k;
        ctx.shadowOffsetY = 3 * k;
      }
      if (t.outlineColor && t.outlineWidth > 0) {
        ctx.lineWidth = t.outlineWidth * 2 * k;
        ctx.strokeStyle = t.outlineColor;
        strokeSpaced(ctx, part.word, wordX, wordY, spacing * wordScale);
      }

      // 3. Aberração cromática / RGB Split nas bordas da palavra
      if (caShift >= 0.4) {
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.globalAlpha *= 0.72;
        ctx.fillStyle = '#00f0ff';
        drawSpaced(ctx, part.word, wordX - caShift, wordY - caShift * 0.25, spacing * wordScale);
        ctx.fillStyle = '#ff1f5a';
        drawSpaced(ctx, part.word, wordX + caShift, wordY + caShift * 0.25, spacing * wordScale);
        ctx.restore();
      }

      if ((t.glowIntensity ?? 0) > 0) {
        ctx.shadowColor = t.glowColor ?? '#ffde59';
        ctx.shadowBlur = (t.glowIntensity ?? 0) * (isHero ? 1.25 : 1) * k;
        ctx.shadowOffsetY = 0;
      }
      const useSyllables = !!t.syllableAnimation && !!word && !word.uncertain &&
        (word.source === 'ass' || word.source === 'manual') && (word.confidence ?? 0) >= 0.95 &&
        word.syllables.length > 0 && word.syllables.map((item) => item.text).join('') === part.word &&
        word.syllables.every((item) => !item.uncertain && item.confidence !== null && item.confidence >= 0.95);
      const syllables = useSyllables ? word.syllables : [];
      if (syllables.length) {
        let syllableX = wordX;
        const syllableIndex = syllables.findIndex((item) => nowUs >= item.startUs && nowUs < item.endUs);
        for (const [index, syllable] of syllables.entries()) {
          const glyphWidth = measured(ctx, syllable.text, spacing * wordScale);
          const activeSyllable = index === syllableIndex;
          if (t.fillStyle === 'linear-gradient' && ctx.createLinearGradient) {
            const gradient = ctx.createLinearGradient(syllableX, wordY - wordSize / 2, syllableX + glyphWidth, wordY + wordSize / 2);
            gradient.addColorStop(0, t.gradientStartColor);
            gradient.addColorStop(1, t.gradientEndColor);
            ctx.fillStyle = activeSyllable ? (t.highlightColor ?? '#ffd166') : gradient;
          } else {
            ctx.fillStyle = activeSyllable ? (t.highlightColor ?? '#ffd166') : (word?.color ?? t.color);
          }
          drawSpaced(ctx, syllable.text, syllableX, wordY, spacing * wordScale);
          syllableX += glyphWidth;
        }
      } else {
        const customHeroColor = isHero && t.heroColor ? t.heroColor : null;
        if (customHeroColor && !(active && animation === 'highlight')) {
          ctx.fillStyle = customHeroColor;
        } else if (t.fillStyle === 'linear-gradient' && !word?.color && !(active && animation === 'highlight') && ctx.createLinearGradient) {
          const gradient = ctx.createLinearGradient(wordX, wordY - wordSize / 2, wordX + part.width * wordScale, wordY + wordSize / 2);
          gradient.addColorStop(0, t.gradientStartColor);
          if (sheenPhase >= 0) {
            const pos = Math.max(0.08, Math.min(0.92, sheenPhase));
            gradient.addColorStop(Math.max(0, pos - 0.08), t.gradientStartColor);
            gradient.addColorStop(pos, '#ffffff');
            gradient.addColorStop(Math.min(1, pos + 0.08), t.gradientEndColor);
          }
          gradient.addColorStop(1, t.gradientEndColor);
          ctx.fillStyle = gradient;
        } else if (sheenPhase >= 0 && !word?.color && ctx.createLinearGradient) {
          const baseCol = active && animation === 'highlight' ? (t.highlightColor ?? '#ffd166') : t.color;
          const sheenX0 = wordX - part.width * 0.3 + (part.width * wordScale * 1.6) * sheenPhase;
          const gradient = ctx.createLinearGradient(sheenX0 - wordSize * 0.6, wordY - wordSize / 2, sheenX0 + wordSize * 0.6, wordY + wordSize / 2);
          gradient.addColorStop(0, baseCol);
          gradient.addColorStop(0.5, '#ffffff');
          gradient.addColorStop(1, baseCol);
          ctx.fillStyle = gradient;
        } else {
          ctx.fillStyle = word?.color ?? (active && animation === 'highlight' ? t.highlightColor ?? '#ffd166' : t.color);
        }
        drawSpaced(ctx, part.word, wordX, wordY, spacing * wordScale);
      }
      ctx.restore();
      x += part.width * (isHero ? heroBoost : 1);
    }
  });
  ctx.restore();
}

/**
 * Estima a caixa delimitadora de um clipe de texto em coordenadas do projeto (`projW × projH`)
 * para seleção direta por clique, arrasto e alças de redimensionamento/rotação no Preview.
 */
export function estimateTextBounds(
  c: Clip,
  projW: number,
  projH: number,
  localUs: number,
): { centerX: number; centerY: number; width: number; height: number; rotation: number; x: number; y: number; scale: number } | null {
  const t = c.text;
  if (!t || !t.text.trim()) return null;
  const x = evaluateKeyframes(c.keyframes['transform.x'], localUs, c.transform.x);
  const y = evaluateKeyframes(c.keyframes['transform.y'], localUs, c.transform.y);
  const scale = evaluateKeyframes(c.keyframes['transform.scale'], localUs, c.transform.scale);
  const rotation = evaluateKeyframes(c.keyframes['transform.rotation'], localUs, c.transform.rotation);
  const size = Math.max(16, t.size * scale);
  const maxWidth = Math.max(size * 2, Math.min(projW * (t.maxWidthRatio ?? 0.9), projW - 2 * (t.marginX ?? 48)));
  const avgCharW = size * (/Cinzel|Playfair|Montserrat|Manrope/i.test(t.font) ? 0.56 : 0.48) + (t.letterSpacing ?? 0);
  const rawParagraphs = t.text.split('\n');
  let estLines = 0;
  let maxLineW = size * 2;
  for (const para of rawParagraphs) {
    const pw = Math.max(size * 1.4, Array.from(para.trim()).length * avgCharW * (t.heroWord ? 1.12 : 1));
    const wrapped = Math.max(1, Math.ceil(pw / maxWidth));
    estLines += wrapped;
    maxLineW = Math.max(maxLineW, Math.min(maxWidth, pw));
  }
  const padding = Math.max(16, t.padding ?? 24);
  const lh = size * (t.lineSpacing ?? 1.18);
  const totalH = Math.max(lh, estLines * lh) + 2 * padding;
  const totalW = Math.min(projW * 0.96, maxLineW + 2 * padding);
  const verticalLimit = Math.max(0, projH / 2 - (t.marginY ?? 0) - totalH / 2);
  const clampedY = Math.max(-verticalLimit, Math.min(verticalLimit, y));
  return {
    centerX: projW / 2 + x,
    centerY: projH / 2 + clampedY,
    width: totalW,
    height: totalH,
    rotation,
    x,
    y: clampedY,
    scale,
  };
}
