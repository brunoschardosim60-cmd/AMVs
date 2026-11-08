import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NodeRunner } from '@amv/media/src/node';
import { grabFrameJpeg, toBase64 } from '../src/index.js';

let dir = '';
let video = '';
// 6 s a 10 fps: vermelho (0-2 s), verde (2-4 s), azul (4-6 s)
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'amv-frames-'));
  video = join(dir, 'cores.mp4');
  const seg = (c: string, f: string) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${c}:s=640x360:r=10:d=2`, '-pix_fmt', 'yuv420p', join(dir, f)]);
  seg('red', 'a.mp4');
  seg('lime', 'b.mp4');
  seg('blue', 'c.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(dir, 'a.mp4'), '-i', join(dir, 'b.mp4'), '-i', join(dir, 'c.mp4'), '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0', video]);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const runner = new NodeRunner();
/** Cor média do JPEG, decodificada pelo próprio ffmpeg. */
function avgColor(jpeg: Uint8Array): [number, number, number] {
  const out = execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'image2pipe', '-i', 'pipe:0', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: Buffer.from(jpeg) });
  return [out[0]!, out[1]!, out[2]!];
}

describe('quadro do vídeo para a visão', () => {
  it('devolve JPEG válido na largura pedida', async () => {
    const j = await grabFrameJpeg(runner, video, 1, 320);
    expect([j[0], j[1]]).toEqual([0xff, 0xd8]); // início de JPEG
    expect(j.length).toBeGreaterThan(500);
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', '-i', 'pipe:0'], { input: Buffer.from(j) }).toString());
    expect(info.streams[0]).toMatchObject({ width: 320, height: 180 });
  });

  it('cada instante traz o quadro daquele momento (vermelho, verde, azul)', async () => {
    const [r1, g1, b1] = avgColor(await grabFrameJpeg(runner, video, 1));
    expect(r1).toBeGreaterThan(200);
    expect(g1).toBeLessThan(60);
    const [r2, g2] = avgColor(await grabFrameJpeg(runner, video, 3));
    expect(g2).toBeGreaterThan(200);
    expect(r2).toBeLessThan(80);
    const [, , b3] = avgColor(await grabFrameJpeg(runner, video, 5));
    expect(b3).toBeGreaterThan(200);
    expect(b1).toBeLessThan(60);
  });

  it('instante depois do fim: erro claro (não JPEG vazio)', async () => {
    await expect(grabFrameJpeg(runner, video, 99)).rejects.toThrow(/nenhum quadro/);
  });

  it('cancelar interrompe', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(grabFrameJpeg(runner, video, 1, 320, ac.signal)).rejects.toThrow();
  });

  it('base64 de bytes grandes sem estourar a pilha', () => {
    const big = new Uint8Array(300_000).map((_, i) => i % 251);
    const b64 = toBase64(big);
    expect(Buffer.from(b64, 'base64').equals(Buffer.from(big))).toBe(true);
  });
});
