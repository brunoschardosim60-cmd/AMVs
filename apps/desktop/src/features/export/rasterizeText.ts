import { joinPath } from '@amv/media';
import { evalClipLook, type Clip, type Project } from '@amv/project';
import { staticLook, type TextRasterizer } from '../../core/exporter';
import { drawTextLayer, textIsAnimated, textSteadyKey } from '../editor/textLayer';
import { useApp } from '../../store';

async function png(canvas: OffscreenCanvas): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

const WRITE_BATCH = 16;

/** Desenha o texto com o mesmo código do preview e grava em PNG(s). */
export const rasterizeText: TextRasterizer = async (clip: Clip, project: Project, W: number, H: number, dir: string, fps) => {
  const platform = useApp.getState().platform;
  if (!platform) throw new Error('Plataforma indisponível para exportar texto.');
  const fs = platform.fs;
  await document.fonts.ready;
  const k = W / project.settings.width;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Não foi possível desenhar as legendas.');
  if (!textIsAnimated(clip)) {
    ctx.clearRect(0, 0, W, H);
    drawTextLayer(ctx, clip, project.settings.width, project.settings.height, k, staticLook(clip), 0.5);
    const path = joinPath(dir, 'texto.png');
    await fs.writeFile(path, await png(canvas));
    return { path, sequence: false };
  }
  const frames = Math.max(1, Math.ceil((clip.durationUs / 1e6) * (fps.num / fps.den)));
  const clipDurS = clip.durationUs / 1e6;
  const steadyCache = new Map<string, Uint8Array>();
  let pendingWrites: Promise<void>[] = [];

  for (let f = 0; f < frames; f++) {
    const localS = (f * fps.den) / fps.num;
    const look = evalClipLook(clip, localS, clipDurS);
    const lookIsSteady =
      look.overlays.length === 0
      && look.dx === 0
      && look.dy === 0
      && Math.abs(look.alpha - clip.transform.opacity) < 1e-6;
    const steadyKey = lookIsSteady ? textSteadyKey(clip, localS) : null;
    let bytes = steadyKey !== null ? steadyCache.get(steadyKey) : undefined;
    if (!bytes) {
      ctx.clearRect(0, 0, W, H);
      drawTextLayer(ctx, clip, project.settings.width, project.settings.height, k, look, localS);
      bytes = await png(canvas);
      if (steadyKey !== null) steadyCache.set(steadyKey, bytes);
    }
    const framePath = joinPath(dir, `q${String(f).padStart(5, '0')}.png`);
    pendingWrites.push(fs.writeFile(framePath, bytes));
    if (pendingWrites.length >= WRITE_BATCH) {
      await Promise.all(pendingWrites);
      pendingWrites = [];
    }
  }
  if (pendingWrites.length > 0) {
    await Promise.all(pendingWrites);
  }
  return { path: joinPath(dir, 'q%05d.png'), sequence: true };
};
