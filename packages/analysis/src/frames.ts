import type { ProcessRunner } from '@amv/media';
import { CancelledError, ToolError } from '@amv/media';

/**
 * Um quadro do vídeo como JPEG (para mostrar a um modelo com visão). `-ss` antes do `-i`
 * pula direto para perto do instante (rápido, mesmo em episódios longos).
 */
export async function grabFrameJpeg(runner: ProcessRunner, path: string, timeS: number, width = 448, signal?: AbortSignal): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const r = await runner.run(
    'ffmpeg',
    ['-hide_banner', '-nostdin', '-loglevel', 'error', '-ss', Math.max(0, timeS).toFixed(3), '-i', path, '-frames:v', '1', '-an', '-vf', `scale=${width}:-2`, '-q:v', '4', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'],
    {
      signal,
      onStdoutBytes: (b) => {
        chunks.push(b.slice());
        total += b.length;
      },
    },
  );
  if (signal?.aborted) throw new CancelledError();
  if (
    !total &&
    /Could not open encoder before EOF|Nothing was written into output file, because at least one of its streams received no packets/i.test(
      r.stderr,
    )
  ) {
    throw new Error(`nenhum quadro em ${timeS.toFixed(2)} s (o instante passa do fim do vídeo?)`);
  }
  if (r.code !== 0) throw new ToolError('ffmpeg', r.code, r.stderr);
  if (!total) throw new Error(`nenhum quadro em ${timeS.toFixed(2)} s (o instante passa do fim do vídeo?)`);
  const all = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  return all;
}

export const toBase64 = (u: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
