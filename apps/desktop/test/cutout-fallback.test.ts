import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectFile } from '@amv/media';
import { ClipSchema, TextContentSchema } from '@amv/project';
import { generateCutoutPngForSource, upgradeGeneratedV2Cutouts } from '../src/core/cutout';
import { ProjectSession, sanitizeLoadedProject } from '../src/core/session';
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

  it('remove V2 provisório e restaura texto na frente sem inventar recorte quebrado quando ONNX está indisponível', async () => {
    const base = nodePlatform(root);
    const offlineAnalyzerPlatform = {
      ...base,
      analyzer: {
        ...base.analyzer,
        start: () => Promise.reject(new Error('sidecar indisponível')),
      },
    };
    const s = await ProjectSession.create(offlineAnalyzerPlatform, join(root, 'proj3'), 'Teste3', {});
    const videoPath = join(root, 'h264_30fps.mp4');
    copyFileSync(join(FIX, 'h264_30fps.mp4'), videoPath);
    await s.importFiles([videoPath]);
    const asset = s.project.assets[0]!;
    const v2Track = s.project.tracks.find((t) => t.name === 'V2')!;
    const textTrack = s.project.tracks.find((t) => t.kind === 'text')!;

    const v2Clip = ClipSchema.parse({
      id: 'clp_v2_test',
      trackId: v2Track.id,
      assetId: asset.id,
      timelineStartUs: 0,
      durationUs: 600_000,
      sourceInUs: 0,
      sourceOutUs: 600_000,
      mask: 'subject-focus',
    });
    const lyricClip = ClipSchema.parse({
      id: 'clp_txt_test',
      trackId: textTrack.id,
      assetId: null,
      timelineStartUs: 0,
      durationUs: 600_000,
      sourceInUs: 0,
      sourceOutUs: 600_000,
      text: TextContentSchema.parse({ text: 'EXPLODE', behindCutout: true }),
    });

    const upgraded = await upgradeGeneratedV2Cutouts(offlineAnalyzerPlatform, s, s.project, [
      { type: 'clip.add', clip: lyricClip },
      { type: 'clip.add', clip: v2Clip },
    ]);
    s.dispose();

    expect(upgraded.upgraded).toBe(0);
    // Nenhum asset quebrado adicionado e clipe V2 provisório removido
    expect(upgraded.commands.some((c) => c.type === 'asset.add')).toBe(false);
    expect(upgraded.commands.some((c) => c.type === 'clip.add' && c.clip.id === 'clp_v2_test')).toBe(false);
    // A letra volta para a frente limpa (behindCutout = false)
    const updatedLyric = upgraded.commands.find((c) => c.type === 'clip.add' && c.clip.id === 'clp_txt_test');
    expect(updatedLyric?.type === 'clip.add' && updatedLyric.clip.text?.behindCutout).toBe(false);
  }, 20_000);

  it('higieniza projetos legados ao abrir: remove recortes canvas-matting quebrados, órfãos, cores duplicadas e sobreposições de 1 us', async () => {
    const base = nodePlatform(root);
    const s = await ProjectSession.create(base, join(root, 'proj4'), 'Legado', {});
    const v1 = s.project.tracks.find((t) => t.name === 'V1')!;
    const v2 = s.project.tracks.find((t) => t.name === 'V2')!;
    const txt = s.project.tracks.find((t) => t.kind === 'text')!;
    s.dispose();

    const dirty = {
      ...s.project,
      assets: [
        { id: 'ep1', name: 'Ep05.mkv', path: '/tmp/ep05.mkv', hash: 'h1', kind: 'video' as const, probe: null, status: 'ok' as const, error: null, importedAt: '', tags: [], favorite: false },
        { id: 'cut_legacy', name: 'Recorte · Ep05.mkv', path: '/tmp/cutouts/cutout-ep1-100.png', hash: 'h2', kind: 'image' as const, probe: null, status: 'processing' as const, error: null, importedAt: '', tags: [], favorite: false },
      ],
      clips: [
        ClipSchema.parse({
          id: 'c1',
          trackId: v1.id,
          assetId: 'ep1',
          timelineStartUs: 0,
          durationUs: 366_667,
          sourceInUs: 0,
          sourceOutUs: 366_667,
          origin: 'ai',
          effects: [
            { id: 'fx1', effect: 'color', enabled: true, params: { exposure: 0.2 } },
            { id: 'fx2', effect: 'color', enabled: true, params: { exposure: 0.15 } },
          ],
        }),
        ClipSchema.parse({
          id: 'c2',
          trackId: v1.id,
          assetId: 'ep1',
          timelineStartUs: 366_666,
          durationUs: 333_334,
          sourceInUs: 500_000,
          sourceOutUs: 833_334,
          origin: 'ai',
        }),
        ClipSchema.parse({
          id: 'c_v2_bad',
          trackId: v2.id,
          assetId: 'cut_legacy',
          timelineStartUs: 0,
          durationUs: 300_000,
          sourceInUs: 0,
          sourceOutUs: 300_000,
          origin: 'ai',
          reason: 'Recorte transparente real (canvas-matting) em V2 com letra atrás',
        }),
        ClipSchema.parse({
          id: 'c_txt',
          trackId: txt.id,
          assetId: null,
          timelineStartUs: 0,
          durationUs: 300_000,
          sourceInUs: 0,
          sourceOutUs: 300_000,
          text: TextContentSchema.parse({ text: 'CHAMA', behindCutout: true }),
        }),
      ],
    };

    const cleaned = sanitizeLoadedProject(dirty);
    expect(cleaned.assets.map((a) => a.id)).toEqual(['ep1']);
    expect(cleaned.clips.some((c) => c.id === 'c_v2_bad')).toBe(false);
    const cleanedC1 = cleaned.clips.find((c) => c.id === 'c1')!;
    const cleanedC2 = cleaned.clips.find((c) => c.id === 'c2')!;
    const cleanedTxt = cleaned.clips.find((c) => c.id === 'c_txt')!;
    expect(cleanedC1.effects.filter((fx) => fx.effect === 'color')).toHaveLength(1);
    expect(cleanedC1.timelineStartUs + cleanedC1.durationUs).toBeLessThanOrEqual(cleanedC2.timelineStartUs);
    expect(cleanedTxt.text?.behindCutout).toBe(false);
  });
});
