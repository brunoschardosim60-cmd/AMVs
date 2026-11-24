import { newId, sourceTimeAt, type Clip, type Command, type EffectInstance, type Project } from '@amv/project';
import type { EpisodeInput } from './generate.js';
import type { QualityReport } from './quality.js';

const SECOND = 1_000_000;

export interface AutoRepairResult {
  commands: Command[];
  repairsApplied: string[];
}

function findShotBrightness(episode: EpisodeInput | undefined, clip: Clip): number | null {
  if (!episode) return null;
  const sourceMidS = sourceTimeAt(clip, clip.durationUs / 2) / SECOND;
  const shot = episode.analysis.shots.find((item) => sourceMidS >= item.startS && sourceMidS < item.endS)
    ?? episode.analysis.shots.find((item) => sourceMidS >= item.startS - 0.05 && sourceMidS <= item.endS + 0.05);
  return shot && Number.isFinite(shot.brightness) ? shot.brightness : null;
}

function effectiveBrightness(raw: number, clip: Clip): number {
  let delta = 0;
  for (const fx of clip.effects) {
    if (fx.effect !== 'color') continue;
    if (typeof fx.params.exposure === 'number' && Number.isFinite(fx.params.exposure)) delta += fx.params.exposure * 0.35;
    if (typeof fx.params.brightness === 'number' && Number.isFinite(fx.params.brightness)) delta += fx.params.brightness;
  }
  return Math.max(0, Math.min(1, raw + delta));
}

/**
 * Corrige automaticamente problemas objetivos detectados pela avaliação audiovisual:
 * 1. Saltos bruscos de luminosidade entre clipes consecutivos (ajusta exposição limitada a ±0,65 EV).
 * 2. Sequências de micro-cortes (< 180 ms) na trilha de vídeo (alonga o clipe anterior quando há margem na fonte).
 * 3. Sobreposições de legendas/textos (aplica os comandos seguros já sugeridos pelo avaliador).
 */
export function autoRepairAssembly(
  project: Project,
  generatedIds: ReadonlySet<string>,
  episodes: EpisodeInput[],
  report: QualityReport,
): AutoRepairResult {
  const episodeById = new Map(episodes.map((ep) => [ep.assetId, ep]));
  const clipById = new Map(project.clips.map((clip) => [clip.id, clip]));
  const commands: Command[] = [];
  const repairsApplied: string[] = [];

  // 1. Correção de saltos de luminosidade (exposição suave e limitada para manter cores naturais)
  const brightnessFixedIds = new Set<string>();
  let brightnessFixCount = 0;
  for (const issue of report.issues) {
    if (issue.dimension !== 'visual' || issue.type !== 'salto de luminosidade') continue;
    if (issue.clipIds.length < 2) continue;
    const prevId = issue.clipIds[0]!;
    const currId = issue.clipIds[1]!;
    if (!generatedIds.has(currId) || brightnessFixedIds.has(currId)) continue;
    const prevClip = clipById.get(prevId);
    const currClip = clipById.get(currId);
    if (!prevClip?.assetId || !currClip?.assetId) continue;
    const prevRaw = findShotBrightness(episodeById.get(prevClip.assetId), prevClip);
    const currRaw = findShotBrightness(episodeById.get(currClip.assetId), currClip);
    if (prevRaw === null || currRaw === null) continue;
    const prevB = effectiveBrightness(prevRaw, prevClip);
    const currB = effectiveBrightness(currRaw, currClip);
    const diff = prevB - currB;
    if (Math.abs(diff) < 0.25) continue;
    // Compensa parcialmente para aproximar a luminância sem estourar nem escurecer demais
    const targetDelta = diff * 0.65;
    const exposure = Math.round(Math.max(-0.65, Math.min(0.65, targetDelta / 0.35)) * 100) / 100;
    if (Math.abs(exposure) < 0.05) continue;
    const colorEffect: EffectInstance = {
      id: newId('fx'),
      effect: 'color',
      enabled: true,
      params: {
        brightness: 0,
        contrast: 1,
        saturation: 1,
        exposure,
        temperature: 0,
        tint: 0,
        hue: 0,
        shadows: exposure > 0 ? 0.08 : 0,
        midtones: 0,
        highlights: exposure < 0 ? -0.06 : 0,
        vignette: 0,
      },
    };
    commands.push({
      type: 'clip.update',
      clipId: currId,
      patch: { effects: [...currClip.effects, colorEffect] },
    });
    brightnessFixedIds.add(currId);
    brightnessFixCount++;
  }
  if (brightnessFixCount > 0) {
    repairsApplied.push(`Exposição suavizada automaticamente em ${brightnessFixCount} transição(ões) com salto de luminosidade.`);
  }

  // 2. Redução de sequências de micro-cortes (< 180 ms): mescla pares adjacentes quando há margem na fonte
  const removedIds = new Set<string>();
  let microCutFixCount = 0;
  for (const issue of report.issues) {
    if (issue.dimension !== 'cut-density' || issue.clipIds.length < 3) continue;
    const run = issue.clipIds
      .map((id) => clipById.get(id))
      .filter((clip): clip is Clip => Boolean(clip && generatedIds.has(clip.id) && !removedIds.has(clip.id)));
    for (let i = 0; i + 1 < run.length; i += 2) {
      const first = run[i]!;
      const second = run[i + 1]!;
      if (removedIds.has(first.id) || removedIds.has(second.id)) continue;
      if (!first.assetId) continue;
      const asset = project.assets.find((a) => a.id === first.assetId);
      const maxSourceUs = asset?.probe?.durationUs ?? Infinity;
      const mergedDurUs = first.durationUs + second.durationUs;
      const neededSourceOutUs = first.sourceInUs + Math.round(mergedDurUs * (first.speed || 1));
      if (neededSourceOutUs > maxSourceUs) continue;
      commands.push({
        type: 'clip.update',
        clipId: first.id,
        patch: { durationUs: mergedDurUs, sourceOutUs: neededSourceOutUs },
      });
      commands.push({
        type: 'clip.remove',
        clipId: second.id,
      });
      removedIds.add(second.id);
      microCutFixCount++;
    }
  }
  if (microCutFixCount > 0) {
    repairsApplied.push(`${microCutFixCount} micro-corte(s) abaixo de 180 ms mesclado(s) para manter a ação legível.`);
  }

  // 3. Correções seguras de duração em legendas sobrepostas
  const durationUpdates = new Map<string, number>();
  const subtitleLabels = new Set<string>();
  for (const item of report.issues) {
    if (!item.fix || !item.clipIds.length || !item.clipIds.every((id) => generatedIds.has(id))) continue;
    for (const command of item.fix.commands) {
      if (command.type !== 'clip.update' || !generatedIds.has(command.clipId) || removedIds.has(command.clipId)) continue;
      const patchKeys = Object.keys(command.patch);
      if (patchKeys.length !== 1 || patchKeys[0] !== 'durationUs') continue;
      const durationUs = command.patch.durationUs;
      if (typeof durationUs !== 'number' || !Number.isFinite(durationUs) || durationUs < 1_000) continue;
      const prior = durationUpdates.get(command.clipId);
      durationUpdates.set(command.clipId, prior === undefined ? durationUs : Math.min(prior, durationUs));
      subtitleLabels.add(item.fix.label);
    }
  }
  for (const [clipId, durationUs] of durationUpdates) {
    commands.push({ type: 'clip.update', clipId, patch: { durationUs } });
  }
  repairsApplied.push(...subtitleLabels);

  return { commands, repairsApplied };
}
