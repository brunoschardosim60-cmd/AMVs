import { evaluateKeyframes, type Clip, type ClipLook } from '@amv/project';

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
    c.text?.wordTimings.length ||
    (c.text?.syllableAnimation && c.text.wordTimings.some((word) => word.syllables.length)) ||
    c.keyframes['transform.scale']?.length ||
    c.keyframes['transform.rotation']?.length ||
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

export function splitTimedText(
  text: string,
  wordTimings: NonNullable<Clip['text']>['wordTimings'],
): { text: string; timingIndex: number }[] | null {
  const parts: { text: string; timingIndex: number }[] = [];
  let joined = '';
  for (let index = 0; index < wordTimings.length; index++) {
    const candidate = joined + wordTimings[index]!.text;
    if (!text.startsWith(candidate)) return null;
    joined = candidate;
    parts.push({ text: wordTimings[index]!.text, timingIndex: index });
    if (joined === text) return parts;
  }
  return null;
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
  wordTimings: NonNullable<Clip['text']>['wordTimings'],
): TextLine[] {
  const lines: TextLine[] = [];
  let timingIndex = 0;
  const append = (word: string, index: number, parts: TextPart[]) => {
    const part = { word, space: '', timingIndex: index, width: measured(ctx, word, spacing) };
    if (parts.length && parts.reduce((sum, item) => sum + item.width, 0) + part.width > width) {
      lines.push({ parts: parts.splice(0), width: 0 });
    }
    parts.push(part);
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
  let alpha = look.alpha;
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
    }
    if (a === 'slide') {
      dy = 40 * (1 - x) * (1 - x);
      alpha *= x;
    }
    if (a === 'slide-left') {
      dx = -Math.min(160, projW * 0.2) * (1 - x) * (1 - x);
      alpha *= x;
    }
    if (a === 'slide-right') {
      dx = Math.min(160, projW * 0.2) * (1 - x) * (1 - x);
      alpha *= x;
    }
    if (a === 'blur') {
      blur = 14 * (1 - x);
      alpha *= Math.min(1, x * 1.5);
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
    if (b === 'pop') scale *= 0.75 + 0.25 * x;
    if (b === 'blur') blur = Math.max(blur, 12 * (1 - x));
  }
  if (alpha <= 0) return;

  const shown = t.text.slice(0, Math.max(0, visibleChars));
  const size = t.size * scale * k;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  if (blur > 0) ctx.filter = `blur(${blur * k}px)`;
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
  const wordTimings = t.wordTimings ?? [];
  const lines = layoutLines(ctx, shown, maxWidth, spacing, wordTimings);
  const lh = size * (t.lineSpacing ?? 1.18);
  const totalHeight = Math.max(lh, lines.length * lh);
  const longestLine = Math.max(0, ...lines.map((line) => line.width));
  const contentHeight = totalHeight + 2 * padding;
  const verticalLimit = Math.max(0, (projH / 2 - (t.marginY ?? 0)) * k - contentHeight / 2);
  const x = evaluateKeyframes(c.keyframes['transform.x'], atUs, c.transform.x);
  const y = evaluateKeyframes(c.keyframes['transform.y'], atUs, c.transform.y);
  const centerY = Math.max(-verticalLimit, Math.min(verticalLimit, y + look.dy + dy));

  ctx.translate((projW / 2 + x + look.dx + dx) * k, (projH / 2 + centerY) * k);
  const rotation = evaluateKeyframes(c.keyframes['transform.rotation'], atUs, c.transform.rotation);
  if (rotation) ctx.rotate((rotation * Math.PI) / 180);

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

  const nowUs = Math.round(localS * 1e6);
  const activeWord = wordTimings.findIndex((word) => {
    const reliable = !word.uncertain && (
      word.source === 'ass' || word.source === 'lrc' || word.source === 'manual' ||
      ((word.source === 'whisper' || word.source === 'estimated') && (word.confidence ?? 0) >= 0.78)
    );
    return reliable && nowUs >= word.startUs && nowUs < word.endUs;
  });
  const y0 = -((lines.length - 1) * lh) / 2;
  lines.forEach((line, lineIndex) => {
    const y = y0 + lineIndex * lh;
    const lineStart = t.alignment === 'left' ? -maxWidth / 2 : t.alignment === 'right' ? maxWidth / 2 - line.width : -line.width / 2;
    let x = lineStart;
    for (const part of line.parts) {
      const word = wordTimings[part.timingIndex];
      const active = part.timingIndex === activeWord;
      const animation = t.wordAnimation ?? 'highlight';
      const wordProgress = word ? Math.max(0, Math.min(1, (nowUs - word.startUs) / Math.max(1, word.endUs - word.startUs))) : 1;
      const defaultWordScale = active && animation === 'highlight' ? t.highlightScale ?? 1.12 : active && animation === 'pop' ? 1 + 0.12 * backOut(wordProgress) : 1;
      const wordScale = (word?.scale ?? defaultWordScale) * k;
      const wordX = x + (word?.offsetX ?? 0) * k;
      const wordY = y + (word?.offsetY ?? 0) * k;
      const wordSize = size * wordScale;
      ctx.save();
      ctx.font = `${word?.weight ?? t.weight ?? 700} ${wordSize}px "${t.font}", "Manrope Variable", system-ui, sans-serif`;
      if (active && animation === 'fade') ctx.globalAlpha *= Math.min(1, wordProgress * 3);
      if (t.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.75)';
        ctx.shadowBlur = 10 * k;
        ctx.shadowOffsetY = 3 * k;
      }
      if ((t.glowIntensity ?? 0) > 0) {
        ctx.shadowColor = t.glowColor ?? '#ffde59';
        ctx.shadowBlur = (t.glowIntensity ?? 0) * k;
      }
      if (t.outlineColor && t.outlineWidth > 0) {
        ctx.lineWidth = t.outlineWidth * 2 * k;
        ctx.strokeStyle = t.outlineColor;
        ctx.strokeText(part.word, wordX, wordY);
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
          if (t.fillStyle === 'linear-gradient') {
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
        if (t.fillStyle === 'linear-gradient' && !word?.color && !(active && animation === 'highlight')) {
          const gradient = ctx.createLinearGradient(wordX, wordY - wordSize / 2, wordX + part.width * wordScale, wordY + wordSize / 2);
          gradient.addColorStop(0, t.gradientStartColor);
          gradient.addColorStop(1, t.gradientEndColor);
          ctx.fillStyle = gradient;
        } else {
          ctx.fillStyle = word?.color ?? (active && animation === 'highlight' ? t.highlightColor ?? '#ffd166' : t.color);
        }
        drawSpaced(ctx, part.word, wordX, wordY, spacing * wordScale);
      }
      ctx.restore();
      x += part.width + measured(ctx, part.space, spacing);
    }
  });
  ctx.restore();
}
