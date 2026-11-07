import { joinPath } from '@amv/media';
import { evalClipLook, type Clip, type Project } from '@amv/project';
import { staticLook, type TextRasterizer } from '../../core/exporter';
import { drawTextLayer, textIsAnimated } from '../editor/textLayer';
import { useApp } from '../../store';

async function png(canvas: OffscreenCanvas): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Desenha o texto com o mesmo código do preview e grava em PNG(s). */
export const rasterizeText: TextRasterizer = async (clip: Clip, project: Project, W: number, H: number, dir: string, fps) => {
  const fs = useApp.getState().platform!.fs;
  const k = W / project.settings.width;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d')!;
  if (!textIsAnimated(clip)) {
    ctx.clearRect(0, 0, W, H);
    drawTextLayer(ctx, clip, project.settings.width, project.settings.height, k, staticLook(clip), 0.5);
    const path = joinPath(dir, 'texto.png');
    await fs.writeFile(path, await png(canvas));
    return { path, sequence: false };
  }
  const frames = Math.max(1, Math.round((clip.durationUs / 1e6) * (fps.num / fps.den)));
  for (let f = 0; f < frames; f++) {
    const localS = (f * fps.den) / fps.num;
    const look = evalClipLook(clip, localS, clip.durationUs / 1e6);
    ctx.clearRect(0, 0, W, H);
    drawTextLayer(ctx, clip, project.settings.width, project.settings.height, k, look, localS);
    await fs.writeFile(joinPath(dir, `q${String(f).padStart(5, '0')}.png`), await png(canvas));
  }
  return { path: joinPath(dir, 'q%05d.png'), sequence: true };
};
