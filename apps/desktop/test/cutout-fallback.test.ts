import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectFile } from '@amv/media';
import { generateCutoutPngForSource } from '../src/core/cutout';
import { ProjectSession } from '../src/core/session';
import { nodePlatform } from './node-platform';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/generated');
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'amv-cutout-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('recorte de personagem — degradação limpa do sidecar Python', () => {
  it('propaga AbortError imediatamente quando cancelado antes ou durante o sidecar', async () => {
    const p = nodePlatform(root);
    const s = await ProjectSession.create(p, join(root, 'proj'), 'Teste', {});
    const videoPath = join(root, 'h264_30fps.mp4');
    copyFileSync(join(FIX, 'h264_30fps.mp4'), videoPath);
    const { asset } = await inspectFile(await s.mediaEnv(), videoPath);
    s.dispose();

    const controller = new AbortController();
    controller.abort();
    await expect(
      generateCutoutPngForSource(p, asset, 0.2, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('não trava indefinidamente quando o sidecar Python expira por timeout e cai para o caminho local', async () => {
    const base = nodePlatform(root);
    const hangingPlatform = {
      ...base,
      analyzer: {
        ...base.analyzer,
        start: () => new Promise<never>(() => {}),
      },
    };
    const s = await ProjectSession.create(base, join(root, 'proj2'), 'Teste2', {});
    const videoPath = join(root, 'h264_30fps.mp4');
    copyFileSync(join(FIX, 'h264_30fps.mp4'), videoPath);
    const { asset } = await inspectFile(await s.mediaEnv(), videoPath);
    s.dispose();

    const startedAt = Date.now();
    // Em ambiente Node puro (sem DOM Canvas), o caminho local falha rápido após o timeout curto do sidecar,
    // comprovando que o timeout de 80 ms destrava a execução sem pendurar a UI.
    await expect(
      generateCutoutPngForSource(hangingPlatform, asset, 0.2, { sidecarTimeoutMs: 80 }),
    ).rejects.toThrow();
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });
});
