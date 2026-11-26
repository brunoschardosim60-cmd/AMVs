import { inspectFile, joinPath } from '@amv/media';
import { clipEndUs, ClipSchema, newId, sourceTimeAt, type Asset, type Clip, type Command, type Project } from '@amv/project';
import type { Platform } from '../platform/types';
import type { ProjectSession } from './session';

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.trim().replace(/^#/, '');
  if (clean.length === 3) {
    return [
      parseInt(clean[0]! + clean[0]!, 16) || 255,
      parseInt(clean[1]! + clean[1]!, 16) || 255,
      parseInt(clean[2]! + clean[2]!, 16) || 255,
    ];
  }
  if (clean.length === 6) {
    return [
      parseInt(clean.slice(0, 2), 16) || 255,
      parseInt(clean.slice(2, 4), 16) || 255,
      parseInt(clean.slice(4, 6), 16) || 255,
    ];
  }
  return [255, 255, 255];
}

async function canvasAnimeCutoutPng(
  rawPngBytes: Uint8Array,
  strokePx = 4,
  strokeColor = '#ffffff',
  focus: [number, number] = [0.5, 0.46],
): Promise<Uint8Array> {
  const blob = new Blob([rawPngBytes as BlobPart], { type: 'image/png' });
  const bmp = await createImageBitmap(blob);
  const w = bmp.width;
  const h = bmp.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();

  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  const bw = Math.max(2, Math.round(w * 0.07));
  const bh = Math.max(2, Math.round(h * 0.07));

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let samples = 0;
  const addSample = (x: number, y: number) => {
    const idx = (y * w + x) * 4;
    rSum += data[idx]!;
    gSum += data[idx + 1]!;
    bSum += data[idx + 2]!;
    samples++;
  };
  for (let y = 0; y < bh; y += 2) for (let x = 0; x < w; x += 4) addSample(x, y);
  for (let y = bh; y < h; y += 4) {
    for (let x = 0; x < bw; x += 2) addSample(x, y);
    for (let x = w - bw; x < w; x += 2) addSample(x, y);
  }
  const bgR = (rSum / Math.max(1, samples)) / 255;
  const bgG = (gSum / Math.max(1, samples)) / 255;
  const bgB = (bSum / Math.max(1, samples)) / 255;
  const fx = Math.max(0.22, Math.min(0.78, focus[0]));
  const fy = Math.max(0.22, Math.min(0.72, focus[1]));

  const alpha = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ny = (y / Math.max(1, h - 1) - fy) / 0.46;
    for (let x = 0; x < w; x++) {
      const nx = (x / Math.max(1, w - 1) - fx) / 0.34;
      const p = y * w + x;
      const idx = p * 4;
      const r = data[idx]! / 255;
      const g = data[idx + 1]! / 255;
      const b = data[idx + 2]! / 255;
      const dist = Math.hypot(r - bgR, g - bgG, b - bgB);
      let edge = 0;
      if (x > 0 && x < w - 1 && y > 0 && y < h - 1) {
        const lL = (0.299 * data[idx - 4]! + 0.587 * data[idx - 3]! + 0.114 * data[idx - 2]!) / 255;
        const lR = (0.299 * data[idx + 4]! + 0.587 * data[idx + 5]! + 0.114 * data[idx + 6]!) / 255;
        const lU = (0.299 * data[idx - w * 4]! + 0.587 * data[idx - w * 4 + 1]! + 0.114 * data[idx - w * 4 + 2]!) / 255;
        const lD = (0.299 * data[idx + w * 4]! + 0.587 * data[idx + w * 4 + 1]! + 0.114 * data[idx + w * 4 + 2]!) / 255;
        edge = Math.min(1, (Math.abs(lR - lL) + Math.abs(lD - lU)) * 2.4);
      }
      const ell = Math.max(0, Math.min(1, 1.35 - (nx * nx + ny * ny)));
      const core = Math.max(0, Math.min(1, 1 - (nx * nx * 2.2 + ny * ny * 2)));
      const score = (Math.min(1.2, dist * 2.5) + edge * 0.45) * (0.25 + 0.75 * ell);
      const baseA = Math.max(0, Math.min(1, (score - 0.25) / 0.32));
      alpha[p] = Math.max(baseA, core * Math.min(1, dist * 3 + edge));
    }
  }

  const [sr, sg, sb] = parseHexRgb(strokeColor);
  const rad = Math.max(0, Math.min(8, Math.round(strokePx)));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const a = alpha[p]!;
      let ring = 0;
      if (rad > 0 && a < 0.98) {
        let dMax = a;
        for (const dy of [-rad, 0, rad]) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (const dx of [-rad, 0, rad]) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const v = alpha[yy * w + xx]!;
            if (v > dMax) dMax = v;
          }
        }
        ring = Math.max(0, dMax - a);
      }
      const totalA = Math.min(1, a + ring);
      const idx = p * 4;
      if (totalA > 1e-4) {
        data[idx] = Math.min(255, Math.round((data[idx]! * a + sr * ring) / totalA));
        data[idx + 1] = Math.min(255, Math.round((data[idx + 1]! * a + sg * ring) / totalA));
        data[idx + 2] = Math.min(255, Math.round((data[idx + 2]! * a + sb * ring) / totalA));
        data[idx + 3] = Math.min(255, Math.round(totalA * 255));
      } else {
        data[idx + 3] = 0;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const outBlob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao codificar PNG RGBA'))), 'image/png'),
  );
  return new Uint8Array(await outBlob.arrayBuffer());
}

/**
 * Gera um PNG RGBA com fundo transparente e contorno nítido do personagem para o instante `sourceTimeS`.
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

  const strokePx = options.strokePx ?? 4;
  const strokeColor = options.strokeColor ?? '#ffffff';
  const sidecarTimeoutMs = Math.max(50, options.sidecarTimeoutMs ?? 12_000);
  let pngPath: string | null = null;
  let engine = 'canvas-matting';

  // Tenta primeiro o sidecar Python (/cutout/frame com suporte a ONNX DirectML GPU), degradando em timeout/indisponibilidade
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout no sidecar de recorte')), sidecarTimeoutMs);
    });
    try {
      const sidecarWork = (async () => {
        const conn = await platform.analyzer.start();
        if (options.signal?.aborted) throw new DOMException('recorte cancelado', 'AbortError');
        const res = await platform.http(`${conn.baseUrl}/cutout/frame`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conn.token}` },
          body: JSON.stringify({
            path: asset.path,
            ffmpeg_path: 'ffmpeg',
            output_dir: cutoutDir,
            time_s: sourceTimeS,
            stroke_px: strokePx,
            stroke_color: strokeColor,
          }),
        });
        if (res.ok) {
          const data = JSON.parse(await res.text()) as { path?: string; engine?: string };
          if (data.path && (await platform.fs.exists(data.path))) {
            pngPath = data.path;
            engine = data.engine ?? 'analyzer';
          }
        }
      })();
      await Promise.race([sidecarWork, timeoutPromise]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError' || options.signal?.aborted) throw err;
    // Fallback local abaixo quando o sidecar não está ativo, expira ou FFmpeg não está no PATH do sidecar
  }

  if (!pngPath) {
    const stamp = `${asset.id}-${Math.round(sourceTimeS * 1000)}`;
    const rawFramePath = joinPath(cutoutDir, `raw-${stamp}.png`);
    const outFramePath = joinPath(cutoutDir, `cutout-${stamp}.png`);
    const ff = await platform.runner.run('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-ss', sourceTimeS.toFixed(3), '-i', asset.path,
      '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2", rawFramePath,
    ]);
    if (ff.code !== 0 || !(await platform.fs.exists(rawFramePath))) {
      throw new Error(`Não consegui extrair o quadro do vídeo: ${ff.stderr.trim() || ff.code}`);
    }
    try {
      const rawBytes = await platform.fs.readFile(rawFramePath);
      const rgbaPng = await canvasAnimeCutoutPng(rawBytes, strokePx, strokeColor, options.focus);
      await platform.fs.writeFile(outFramePath, rgbaPng);
      pngPath = outFramePath;
    } finally {
      try {
        await platform.fs.remove(rawFramePath);
      } catch {}
    }
  }
  return { pngPath, engine };
}

/**
 * Converte automaticamente os clipes de destaque em `V2` criados pelo gerador em recortes transparentes
 * reais (`PNG RGBA` com contorno) dentro do mesmo lote de comandos da geração (um único Ctrl+Z).
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
  const nextCommands = [...commands];
  let upgraded = 0;
  let lastEngine: string | null = null;

  await Promise.all(
    targetAddIndices.map(async (cmdIdx) => {
      const cmd = nextCommands[cmdIdx];
      if (!cmd || cmd.type !== 'clip.add' || !cmd.clip.assetId) return;
      const clip = cmd.clip;
      const asset = project.assets.find((a) => a.id === clip.assetId);
      if (!asset || asset.kind !== 'video' || asset.status === 'missing') return;
      try {
        const sourceS = Math.max(0, (clip.sourceInUs + Math.round(clip.durationUs * 0.2)) / 1e6);
        const { pngPath, engine } = await generateCutoutPngForSource(platform, asset, sourceS, {
          focus: focusByClipId?.get(clip.id),
        });
        const inspected = await inspectFile(env, pngPath);
        const cutoutAsset: Asset = { ...inspected.asset, name: `Recorte · ${asset.name}` };
        extraAssets.push({ type: 'asset.add', asset: cutoutAsset });
        nextCommands[cmdIdx] = {
          type: 'clip.add',
          clip: {
            ...clip,
            assetId: cutoutAsset.id,
            sourceInUs: 0,
            sourceOutUs: clip.durationUs,
            mask: 'none',
            speed: 1,
            reason: `Recorte transparente real (${engine}) em V2 com letra atrás`,
          },
        };
        upgraded++;
        lastEngine = engine;
      } catch {
        // Mantém a máscara geométrica de fallback se algum quadro falhar
      }
    }),
  );

  if (!extraAssets.length) return { commands, upgraded: 0, engine: null };
  return { commands: [...extraAssets, ...nextCommands], upgraded, engine: lastEngine };
}

/**
 * Extrai o quadro do clipe no instante atual, recorta o personagem (usando ONNX/DirectML no sidecar
 * quando disponível ou matting local em Canvas), importa o PNG RGBA em `V2` com punch de escala
 * e marca automaticamente as legendas/letras sobrepostas com `behindCutout = true`.
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

  const clampedPlayheadUs = Math.max(clip.timelineStartUs, Math.min(clipEndUs(clip) - 1_000, playheadUs));
  const localUs = Math.max(0, clampedPlayheadUs - clip.timelineStartUs);
  const sourceTimeS = sourceTimeAt(clip, localUs) / 1e6;
  const { pngPath, engine } = await generateCutoutPngForSource(platform, asset, sourceTimeS, {
    strokePx: options.strokePx,
    strokeColor: options.strokeColor,
    focus: options.focus,
  });

  await session.importFiles([pngPath]);
  const importedAsset = session.project.assets.find((a) => a.path === pngPath);
  if (!importedAsset) throw new Error('Não consegui importar a camada recortada no projeto.');

  const durUs = Math.round((options.durationS ?? 0.65) * 1e6);
  const startUs = clampedPlayheadUs;
  const endUs = startUs + durUs;
  const cutoutClipId = newId('clp');

  const commands: Command[] = [];
  // Remove sobreposição prévia em V2 nesse intervalo
  for (const existing of session.project.clips) {
    if (existing.trackId === v2.id && existing.timelineStartUs < endUs && clipEndUs(existing) > startUs) {
      commands.push({ type: 'clip.remove', clipId: existing.id });
    }
  }

  commands.push({
    type: 'clip.add',
    clip: ClipSchema.parse({
      id: cutoutClipId,
      trackId: v2.id,
      assetId: importedAsset.id,
      timelineStartUs: startUs,
      durationUs: durUs,
      sourceInUs: 0,
      sourceOutUs: durUs,
      label: `Cutout · ${asset.name}`,
      reason: `Personagem recortado (${engine}) com contorno e texto atrás`,
      transform: { x: 0, y: 0, scale: 1.04, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
      keyframes: {
        'transform.scale': [
          { atUs: 0, value: 1.04, easing: 'ease-out' },
          { atUs: durUs, value: 1.14, easing: 'linear' },
        ],
      },
    }),
  });

  // Marca textos/letras sobrepostos para passarem ATRÁS do personagem recortado!
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

  session.history.transaction('Destacar personagem recortado (V2)', commands);
  return { assetId: importedAsset.id, clipId: cutoutClipId, engine };
}
