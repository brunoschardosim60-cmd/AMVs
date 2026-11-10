import { evaluateKeyframes, type Clip, type ClipLook } from '@amv/project';

export const TEXT_ANIMATIONS_IN = [
  { id: '', label: 'Nenhuma' },
  { id: 'fade', label: 'Surgir' },
  { id: 'pop', label: 'Pop' },
  { id: 'slide', label: 'Subir' },
  { id: 'typewriter', label: 'Máquina de escrever' },
] as const;

export const TEXT_ANIMATIONS_OUT = [
  { id: '', label: 'Nenhuma' },
  { id: 'fade', label: 'Sumir' },
  { id: 'slide', label: 'Descer' },
] as const;

const IN_S = 0.3;
const OUT_S = 0.25;

/** Texto tem algo que muda com o tempo? (decide entre 1 imagem ou sequência na exportação) */
export function textIsAnimated(c: Clip): boolean {
  return !!(
    c.text?.animationIn ||
    c.text?.animationOut ||
    c.text?.wordTimings.length ||
    c.keyframes['transform.x']?.length ||
    c.keyframes['transform.y']?.length ||
    c.effects.some((f) => f.enabled && f.effect === 'shake') ||
    c.transitionIn
  );
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

function measured(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, text: string, spacing: number): number {
  if (!spacing) return ctx.measureText(text).width;
  const chars = Array.from(text);
  return chars.reduce((width, char) => width + ctx.measureText(char).width, 0) + Math.max(0, chars.length - 1) * spacing;
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
  for (const char of Array.from(text)) {
    ctx.fillText(char, x, y);
    x += ctx.measureText(char).width + spacing;
  }
}

function layoutLines(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  width: number,
  spacing: number,
): TextLine[] {
  const lines: TextLine[] = [];
  let wordIndex = 0;
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
      const part = { word: token, space: '', timingIndex: wordIndex++, width: measured(ctx, token, spacing) };
      if (parts.length && parts.reduce((sum, item) => sum + item.width, 0) + part.width > width) {
        lines.push({ parts: parts.splice(0), width: 0 });
      }
      parts.push(part);
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
  const inDuration = Math.min(IN_S, dur * 0.4);
  const outDuration = Math.min(OUT_S, dur * 0.25);
  let alpha = look.alpha;
  let scale = c.transform.scale;
  let dy = 0;
  let visibleChars = Infinity;

  const a = t.animationIn;
  if (a && localS < inDuration) {
    const x = Math.max(0, localS / inDuration);
    if (a === 'fade') alpha *= x;
    if (a === 'pop') {
      scale *= 0.6 + 0.4 * backOut(x);
      alpha *= Math.min(1, x * 2);
    }
    if (a === 'slide') {
      dy = 40 * (1 - x) * (1 - x);
      alpha *= x;
    }
  }
  if (a === 'typewriter') {
    const span = Math.min(1.5, dur * 0.6);
    visibleChars = Math.floor((localS / span) * t.text.length);
  }
  const b = t.animationOut;
  if (b && dur - localS < outDuration) {
    const x = Math.max(0, (dur - localS) / outDuration);
    if (b === 'fade') alpha *= x;
    if (b === 'slide') {
      dy += 30 * (1 - x);
      alpha *= x;
    }
  }
  if (alpha <= 0) return;

  const shown = t.text.slice(0, Math.max(0, visibleChars));
  const size = t.size * scale * k;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  if (t.background === 'full') {
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }
  ctx.font = `${t.weight ?? 700} ${size}px "${t.font}", "Manrope Variable", system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const spacing = (t.letterSpacing ?? 0) * k;
  const padding = (t.padding ?? 24) * k;
  const maxWidth = Math.max(size, Math.min(projW * (t.maxWidthRatio ?? 0.9), projW - 2 * (t.marginX ?? 48)) * k);
  const lines = layoutLines(ctx, shown, maxWidth, spacing);
  const lh = size * (t.lineSpacing ?? 1.18);
  const totalHeight = Math.max(lh, lines.length * lh);
  const longestLine = Math.max(0, ...lines.map((line) => line.width));
  const contentHeight = totalHeight + 2 * padding;
  const verticalLimit = Math.max(0, (projH / 2 - (t.marginY ?? 0)) * k - contentHeight / 2);
  const atUs = Math.round(localS * 1e6);
  const x = evaluateKeyframes(c.keyframes['transform.x'], atUs, c.transform.x);
  const y = evaluateKeyframes(c.keyframes['transform.y'], atUs, c.transform.y);
  const centerY = Math.max(-verticalLimit, Math.min(verticalLimit, y + look.dy + dy));

  ctx.translate((projW / 2 + x + look.dx) * k, (projH / 2 + centerY) * k);
  if (c.transform.rotation) ctx.rotate((c.transform.rotation * Math.PI) / 180);

  if (t.background === 'bar' || t.background === 'box') {
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

  const wordTimings = t.wordTimings ?? [];
  const nowUs = Math.round(localS * 1e6);
  const activeWord = wordTimings.findIndex((word) => nowUs >= word.startUs && nowUs < word.endUs);
  const y0 = -((lines.length - 1) * lh) / 2;
  lines.forEach((line, lineIndex) => {
    const y = y0 + lineIndex * lh;
    const lineStart = t.alignment === 'left' ? -maxWidth / 2 : t.alignment === 'right' ? maxWidth / 2 - line.width : -line.width / 2;
    let x = lineStart;
    for (const part of line.parts) {
      const word = wordTimings[part.timingIndex];
      const active = part.timingIndex === activeWord;
      const wordScale = (word?.scale ?? (active ? t.highlightScale ?? 1.12 : 1)) * k;
      const wordX = x + (word?.offsetX ?? 0) * k;
      const wordY = y + (word?.offsetY ?? 0) * k;
      const wordSize = size * wordScale;
      ctx.save();
      ctx.font = `${word?.weight ?? t.weight ?? 700} ${wordSize}px "${t.font}", "Manrope Variable", system-ui, sans-serif`;
      if (t.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.75)';
        ctx.shadowBlur = 10 * k;
        ctx.shadowOffsetY = 3 * k;
      }
      if (t.outlineColor && t.outlineWidth > 0) {
        ctx.lineWidth = t.outlineWidth * 2 * k;
        ctx.strokeStyle = t.outlineColor;
        ctx.strokeText(part.word, wordX, wordY);
      }
      ctx.fillStyle = word?.color ?? (active ? t.highlightColor ?? '#ffd166' : t.color);
      drawSpaced(ctx, part.word, wordX, wordY, spacing * wordScale);
      ctx.restore();
      x += part.width + measured(ctx, part.space, spacing);
    }
  });
  ctx.restore();
}
