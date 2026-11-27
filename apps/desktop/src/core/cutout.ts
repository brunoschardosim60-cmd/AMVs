import { inspectFile, joinPath } from '@amv/media';
import { ALPHA_CUTOUT_TAG, clipEndUs, ClipSchema, isInternalCutoutAsset, newId, sourceTimeAt, type Asset, type Clip, type Command, type Project } from '@amv/project';
import type { Platform } from '../platform/types';
import type { ProjectSession } from './session';

export { ALPHA_CUTOUT_TAG };

export function isAlphaCutoutAsset(asset: Pick<Asset, 'tags' | 'name' | 'path'>): boolean {
  return isInternalCutoutAsset(asset);
}

/** Remove clipes V2 provisórios (`subject-focus` / `manga-slash`) e restaura `behindCutout = false` nas letras correspondentes. */
export function stripProvisionalV2Cutouts(project: Project, commands: Command[]): Command[] {
  const v2Track = project.tracks.find((t) => t.kind === 'video' && t.name === 'V2')
    ?? project.tracks.find((t) => t.kind === 'video');
  if (!v2Track) return commands;
  const removedRanges: Array<[number, number]> = [];
  const kept: Command[] = [];
  for (const cmd of commands) {
    if (
      cmd.type === 'clip.add'
      && cmd.clip.trackId === v2Track.id
      && (cmd.clip.mask === 'subject-focus' || cmd.clip.mask === 'manga-slash')
    ) {
      removedRanges.push([cmd.clip.timelineStartUs, clipEndUs(cmd.clip)]);
      continue;
    }
    kept.push(cmd);
  }
  if (!removedRanges.length) return kept;
  return kept.map((cmd) => {
    if (cmd.type !== 'clip.add' || !cmd.clip.text?.behindCutout) return cmd;
    const cStart = cmd.clip.timelineStartUs;
    const cEnd = clipEndUs(cmd.clip);
    if (!removedRanges.some(([a, b]) => cStart < b && cEnd > a)) return cmd;
    return {
      type: 'clip.add',
      clip: { ...cmd.clip, text: { ...cmd.clip.text, behindCutout: false } },
    };
  });
}

async function runWithSidecarTimeout<T>(
  work: () => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new DOMException('recorte cancelado', 'AbortError');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const raceGuard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Tempo esgotado no motor de recorte neural.')), timeoutMs);
    if (signal) {
      onAbort = () => reject(new DOMException('recorte cancelado', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  try {
    return await Promise.race([work(), raceGuard]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Gera um PNG RGBA segmentado por rede neural (`IS-Net Anime` ONNX) para o instante `sourceTimeS`.
 * Nunca usa recorte heurístico por cor de borda (que despedaçava roupas escuras e criava ruído).
 */
export async function generateCutoutPngForSource(
  platform: Platform,
  asset: Asset,
  sourceTimeS: number,
  options: { strokePx?: number; strokeColor?: string; focus?: [number, number]; sidecarTimeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ pngPath: string; engine: string }> {
  if (options.signal?.aborted) throw new DOMException('recorte cancelado', 'AbortError');
  const cutoutDir = joinPath(await platform.cacheDir(), 'cutouts');
  await platform.fs.mkdir(cutoutDir);

  const strokePx = options.strokePx ?? 0;
  const strokeColor = options.strokeColor ?? '#ffffff';
  const focus = options.focus ?? [0.5, 0.46];
  const sidecarTimeoutMs = Math.max(50, options.sidecarTimeoutMs ?? 90_000);

  return runWithSidecarTimeout(async () => {
    const conn = await platform.analyzer.start();
    if (options.signal?.aborted) throw new DOMException('recorte cancelado', 'AbortError');
    const res = await platform.http(`${conn.baseUrl}/cutout/frame`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conn.token}` },
      body: JSON.stringify({
        path: asset.path,
        ffmpeg_path: 'ffmpeg',
        output_dir: cutoutDir,
        time_s: Math.max(0, sourceTimeS),
        focus_x: Math.max(0, Math.min(1, focus[0])),
        focus_y: Math.max(0, Math.min(1, focus[1])),
        stroke_px: strokePx,
        stroke_color: strokeColor,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        detail = (JSON.parse(text) as { detail?: string }).detail ?? text;
      } catch {}
      throw new Error(`Recorte neural indisponível (${res.status}): ${detail}`);
    }
    const data = JSON.parse(text) as { path?: string; engine?: string };
    if (!data.path || !(await platform.fs.exists(data.path))) {
      throw new Error('O motor de recorte não produziu o arquivo PNG esperado.');
    }
    return { pngPath: data.path, engine: data.engine ?? 'onnx' };
  }, sidecarTimeoutMs, options.signal);
}

/**
 * Segmenta quadro a quadro um trecho em movimento com `IS-Net Anime` ONNX e devolve um vídeo
 * `.webm` VP9 com canal alfa (`yuva420p`) sincronizado 1:1 com o movimento real da cena.
 */
export async function generateCutoutClipForRange(
  platform: Platform,
  asset: Asset,
  startS: number,
  durationS: number,
  options: { fps?: number; strokePx?: number; strokeColor?: string; focus?: [number, number]; sidecarTimeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ mediaPath: string; engine: string }> {
  if (options.signal?.aborted) throw new DOMException('recorte cancelado', 'AbortError');
  const cutoutDir = joinPath(await platform.cacheDir(), 'cutouts');
  await platform.fs.mkdir(cutoutDir);

  const strokePx = options.strokePx ?? 0;
  const strokeColor = options.strokeColor ?? '#ffffff';
  const focus = options.focus ?? [0.5, 0.46];
  const fps = Math.max(12, Math.min(30, options.fps ?? 24));
  const sidecarTimeoutMs = Math.max(50, options.sidecarTimeoutMs ?? 120_000);

  return runWithSidecarTimeout(async () => {
    const conn = await platform.analyzer.start();
    if (options.signal?.aborted) throw new DOMException('recorte cancelado', 'AbortError');
    const res = await platform.http(`${conn.baseUrl}/cutout/clip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conn.token}` },
      body: JSON.stringify({
        path: asset.path,
        ffmpeg_path: 'ffmpeg',
        output_dir: cutoutDir,
        start_s: Math.max(0, startS),
        duration_s: Math.max(0.12, Math.min(2.5, durationS)),
        fps,
        focus_x: Math.max(0, Math.min(1, focus[0])),
        focus_y: Math.max(0, Math.min(1, focus[1])),
        stroke_px: strokePx,
        stroke_color: strokeColor,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        detail = (JSON.parse(text) as { detail?: string }).detail ?? text;
      } catch {}
      throw new Error(`Recorte neural em vídeo indisponível (${res.status}): ${detail}`);
    }
    const data = JSON.parse(text) as { path?: string; engine?: string };
    if (!data.path || !(await platform.fs.exists(data.path))) {
      throw new Error('O motor de recorte não produziu o vídeo transparente esperado.');
    }
    return { mediaPath: data.path, engine: data.engine ?? 'onnx' };
  }, sidecarTimeoutMs, options.signal);
}

/**
 * Converte os clipes de destaque em `V2` criados pelo gerador em recortes neurais transparentes em movimento
 * (`IS-Net Anime` + VP9 Alpha 1:1 com `V1`). Se o motor neural não estiver disponível, remove o `V2`
 * provisório e restaura `behindCutout = false` nas letras para nunca deixar máscaras falsas ou recortes quebrados.
 */
export async function upgradeGeneratedV2Cutouts(
  platform: Platform,
  session: ProjectSession,
  project: Project,
  commands: Command[],
  focusByClipId?: Map<string, [number, number]>,
): Promise<{ commands: Command[]; upgraded: number; engine: string | null }> {
  const v2Track = project.tracks.find((t) => t.kind === 'video' && t.name === 'V2')
    ?? project.tracks.find((t) => t.kind === 'video');
  if (!v2Track) return { commands, upgraded: 0, engine: null };

  const targetAddIndices: number[] = [];
  for (let i = 0; i < commands.length && targetAddIndices.length < 3; i++) {
    const cmd = commands[i]!;
    if (
      cmd.type === 'clip.add'
      && cmd.clip.trackId === v2Track.id
      && cmd.clip.assetId
      && (cmd.clip.mask === 'subject-focus' || cmd.clip.mask === 'manga-slash')
    ) {
      targetAddIndices.push(i);
    }
  }
  if (!targetAddIndices.length) return { commands, upgraded: 0, engine: null };

  const env = await session.mediaEnv();
  const extraAssets: Command[] = [];
  const nextCommands: (Command | null)[] = [...commands];
  const failedRangesUs: Array<[number, number]> = [];
  let upgraded = 0;
  let lastEngine: string | null = null;

  // Executa em série para compartilhar o primeiro download/sessão do modelo ONNX sem corrida
  for (const cmdIdx of targetAddIndices) {
    const cmd = nextCommands[cmdIdx];
    if (!cmd || cmd.type !== 'clip.add' || !cmd.clip.assetId) continue;
    const clip = cmd.clip;
    const asset = project.assets.find((a) => a.id === clip.assetId);
    if (!asset || asset.kind !== 'video' || asset.status === 'missing') {
      nextCommands[cmdIdx] = null;
      failedRangesUs.push([clip.timelineStartUs, clipEndUs(clip)]);
      continue;
    }
    try {
      const srcStartS = Math.max(0, clip.sourceInUs / 1e6);
      const srcSpanS = Math.max(0.15, (clip.sourceOutUs - clip.sourceInUs) / 1e6);
      const srcFps = asset.probe?.video?.fps
        ? asset.probe.video.fps.num / Math.max(1, asset.probe.video.fps.den)
        : project.settings.fps.num / Math.max(1, project.settings.fps.den);
      const { mediaPath, engine } = await generateCutoutClipForRange(platform, asset, srcStartS, srcSpanS, {
        fps: Math.min(30, Math.max(15, srcFps)),
        strokePx: 0,
        focus: focusByClipId?.get(clip.id),
      });
      const inspected = await inspectFile(env, mediaPath);
      const cutoutAsset: Asset = {
        ...inspected.asset,
        name: `Recorte V2 · ${asset.name}`,
        status: 'ok',
        error: null,
        tags: [...new Set([...inspected.asset.tags, ALPHA_CUTOUT_TAG])],
      };
      extraAssets.push({ type: 'asset.add', asset: cutoutAsset });
      const cutSpanUs = Math.max(40_000, clip.sourceOutUs - clip.sourceInUs);
      nextCommands[cmdIdx] = {
        type: 'clip.add',
        clip: {
          ...clip,
          assetId: cutoutAsset.id,
          sourceInUs: 0,
          sourceOutUs: cutSpanUs,
          mask: 'none',
          reason: `Personagem recortado por IA (${engine}) em movimento 1:1 com letra atrás`,
        },
      };
      upgraded++;
      lastEngine = engine;
    } catch {
      // Sem modelo neural disponível: remove a camada V2 provisória e volta a letra para a frente limpa
      nextCommands[cmdIdx] = null;
      failedRangesUs.push([clip.timelineStartUs, clipEndUs(clip)]);
    }
  }

  if (failedRangesUs.length > 0) {
    for (let i = 0; i < nextCommands.length; i++) {
      const cmd = nextCommands[i];
      if (!cmd || cmd.type !== 'clip.add' || !cmd.clip.text?.behindCutout) continue;
      const cStart = cmd.clip.timelineStartUs;
      const cEnd = clipEndUs(cmd.clip);
      const overlapsFailed = failedRangesUs.some(([a, b]) => cStart < b && cEnd > a);
      if (overlapsFailed) {
        nextCommands[i] = {
          type: 'clip.add',
          clip: { ...cmd.clip, text: { ...cmd.clip.text, behindCutout: false } },
        };
      }
    }
  }

  const filtered = nextCommands.filter((c): c is Command => c !== null);
  const removedClipIds = new Set(
    filtered.flatMap((c) => (c.type === 'clip.remove' ? [c.clipId] : [])),
  );
  const usedAssetIds = new Set<string>();
  for (const existingClip of project.clips) {
    if (!removedClipIds.has(existingClip.id) && existingClip.assetId) usedAssetIds.add(existingClip.assetId);
  }
  for (const cmd of filtered) {
    if (cmd.type === 'clip.add' && cmd.clip.assetId) usedAssetIds.add(cmd.clip.assetId);
  }
  const orphanRemovals: Command[] = project.assets
    .filter((a) => isInternalCutoutAsset(a) && !usedAssetIds.has(a.id))
    .map((a) => ({ type: 'asset.remove' as const, assetId: a.id }));

  return { commands: [...extraAssets, ...filtered, ...orphanRemovals], upgraded, engine: lastEngine };
}

/**
 * Recorta o personagem do clipe selecionado em movimento (`IS-Net Anime` ONNX -> WebM VP9 transparente),
 * posiciona em `V2` alinhado 1:1 com o vídeo de `V1` (sem contorno artificial branco nem imagem estática)
 * e coloca automaticamente as letras/legendas sobrepostas atrás do personagem (`behindCutout = true`).
 */
export async function createCharacterCutoutOnV2(
  platform: Platform,
  session: ProjectSession,
  clip: Clip,
  playheadUs: number,
  options: { durationS?: number; strokePx?: number; strokeColor?: string; focus?: [number, number] } = {},
): Promise<{ assetId: string; clipId: string; engine: string }> {
  const project = session.project;
  const asset = project.assets.find((a) => a.id === clip.assetId);
  if (!asset || asset.kind !== 'video') throw new Error('Selecione um clipe de vídeo para recortar o personagem.');
  const v2 = project.tracks.find((t) => t.kind === 'video' && t.name === 'V2')
    ?? project.tracks.find((t) => t.kind === 'video' && t.id !== clip.trackId);
  if (!v2) throw new Error('Adicione ou mantenha uma trilha de vídeo superior (V2) para colocar o recorte.');

  const clampedStartUs = Math.max(clip.timelineStartUs, Math.min(clipEndUs(clip) - 80_000, playheadUs));
  const localOffsetUs = Math.max(0, clampedStartUs - clip.timelineStartUs);
  const remainingTlS = Math.max(0.15, (clipEndUs(clip) - clampedStartUs) / 1e6);
  const timelineDurS = Math.min(remainingTlS, options.durationS ?? Math.min(1.2, remainingTlS));
  const durUs = Math.max(80_000, Math.round(timelineDurS * 1e6));
  const srcStartUs = sourceTimeAt(clip, localOffsetUs);
  const srcEndUs = sourceTimeAt(clip, Math.min(clip.durationUs, localOffsetUs + durUs));
  const srcStartS = Math.min(srcStartUs, srcEndUs) / 1e6;
  const srcSpanS = Math.max(0.15, Math.abs(srcEndUs - srcStartUs) / 1e6);
  const srcFps = asset.probe?.video?.fps
    ? asset.probe.video.fps.num / Math.max(1, asset.probe.video.fps.den)
    : project.settings.fps.num / Math.max(1, project.settings.fps.den);

  const { mediaPath, engine } = await generateCutoutClipForRange(platform, asset, srcStartS, srcSpanS, {
    fps: Math.min(30, Math.max(15, srcFps)),
    strokePx: options.strokePx ?? 0,
    strokeColor: options.strokeColor,
    focus: options.focus,
  });

  const env = await session.mediaEnv();
  const { asset: inspected } = await inspectFile(env, mediaPath);
  const existing = session.project.assets.find((a) => a.hash === inspected.hash);
  const cutoutAsset: Asset = existing ?? {
    ...inspected,
    name: `Recorte V2 · ${asset.name}`,
    status: 'ok',
    error: null,
    tags: [...new Set([...inspected.tags, ALPHA_CUTOUT_TAG])],
  };

  const startUs = clampedStartUs;
  const endUs = startUs + durUs;
  const cutoutClipId = newId('clp');
  const commands: Command[] = [];

  if (!existing) {
    commands.push({ type: 'asset.add', asset: cutoutAsset });
  }
  for (const prev of session.project.clips) {
    if (prev.trackId === v2.id && prev.timelineStartUs < endUs && clipEndUs(prev) > startUs) {
      commands.push({ type: 'clip.remove', clipId: prev.id });
    }
  }

  // Reaproveita keyframes deslocados em -localOffsetUs para manter alinhamento 1:1 com V1
  const shiftedKeyframes: Clip['keyframes'] = {};
  for (const [kPath, kList] of Object.entries(clip.keyframes)) {
    if (!kPath.startsWith('transform.')) continue;
    shiftedKeyframes[kPath] = kList
      .map((kf) => ({ ...kf, atUs: Math.max(0, kf.atUs - localOffsetUs) }))
      .filter((kf, idx, arr) => idx === 0 || kf.atUs > arr[idx - 1]!.atUs);
  }

  commands.push({
    type: 'clip.add',
    clip: ClipSchema.parse({
      id: cutoutClipId,
      trackId: v2.id,
      assetId: cutoutAsset.id,
      timelineStartUs: startUs,
      durationUs: durUs,
      sourceInUs: 0,
      sourceOutUs: Math.round(srcSpanS * 1e6),
      speed: clip.speed,
      label: `Recorte IA · ${asset.name}`,
      reason: `Personagem recortado por IA (${engine}) em movimento 1:1 com letra atrás`,
      audio: { gainDb: -60, fadeInUs: 0, fadeOutUs: 0, pitchSemitones: 0, pitchMode: 'preserve', streamIndex: null },
      effects: clip.effects.filter((fx) => fx.effect === 'color'),
      transform: { ...clip.transform },
      keyframes: shiftedKeyframes,
    }),
  });

  for (const tClip of session.project.clips) {
    if (!tClip.text) continue;
    if (tClip.timelineStartUs < endUs && clipEndUs(tClip) > startUs && !tClip.text.behindCutout) {
      commands.push({
        type: 'clip.update',
        clipId: tClip.id,
        patch: { text: { ...tClip.text, behindCutout: true } },
      });
    }
  }

  session.execute({ type: 'batch', commands }, 'Destacar personagem recortado (V2)');
  return { assetId: cutoutAsset.id, clipId: cutoutClipId, engine };
}
