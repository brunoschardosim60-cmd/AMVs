import type { Clip, ClipLook } from '@amv/project';

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
  return !!(c.text?.animationIn || c.text?.animationOut || c.effects.some((f) => f.enabled && f.effect === 'shake') || c.transitionIn);
}

function backOut(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/**
 * Desenha um clipe de texto. Usado pelo preview E pela exportação (que gera PNGs com
 * este mesmo desenho), então o resultado é idêntico. `k` = escala projeto → canvas.
 */
export function drawTextLayer(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, c: Clip, projW: number, projH: number, k: number, look: ClipLook, localS: number): void {
  const t = c.text;
  if (!t || !t.text.trim()) return;
  const dur = c.durationUs / 1e6;
  let alpha = look.alpha;
  let scale = c.transform.scale;
  let dy = 0;
  let visibleChars = Infinity;

  const a = t.animationIn;
  if (a && localS < IN_S) {
    const x = Math.max(0, localS / IN_S);
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
  if (b && dur - localS < OUT_S) {
    const x = Math.max(0, (dur - localS) / OUT_S);
    if (b === 'fade') alpha *= x;
    if (b === 'slide') {
      dy += 30 * (1 - x);
      alpha *= x;
    }
  }
  if (alpha <= 0) return;

  const shown = t.text.slice(0, Math.max(0, visibleChars));
  const lines = shown.split('\n');
  const size = t.size * scale * k;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.translate((projW / 2 + c.transform.x + look.dx) * k, (projH / 2 + c.transform.y + look.dy + dy) * k);
  if (c.transform.rotation) ctx.rotate((c.transform.rotation * Math.PI) / 180);
  ctx.font = `700 ${size}px "${t.font}", "Manrope Variable", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const lh = size * 1.18;
  const y0 = -((lines.length - 1) * lh) / 2;
  lines.forEach((line, i) => {
    const y = y0 + i * lh;
    if (t.shadow) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.75)';
      ctx.shadowBlur = 10 * k;
      ctx.shadowOffsetY = 3 * k;
      ctx.fillStyle = t.color;
      ctx.fillText(line, 0, y);
      ctx.restore();
    }
    if (t.outlineColor && t.outlineWidth > 0) {
      ctx.lineWidth = t.outlineWidth * 2 * k;
      ctx.strokeStyle = t.outlineColor;
      ctx.strokeText(line, 0, y);
    }
    ctx.fillStyle = t.color;
    ctx.fillText(line, 0, y);
  });
  ctx.restore();
}
