import { clipEndUs, newId, sourceTimeAt, type Clip, type Command, type EffectInstance, type Project } from '@amv/project';
import type { EpisodeInput } from './generate.js';
import type { QualityReport } from './quality.js';

const SECOND = 1_000_000;

export interface AutoRepairResult {
  commands: Command[];
  repairsApplied: string[];
}

function findSourceShot(episode: EpisodeInput | undefined, clip: Clip) {
  if (!episode) return undefined;
  const sourceMidS = sourceTimeAt(clip, clip.durationUs / 2) / SECOND;
  return episode.analysis.shots.find((item) => sourceMidS >= item.startS && sourceMidS < item.endS)
    ?? episode.analysis.shots.find((item) => sourceMidS >= item.startS - 0.05 && sourceMidS <= item.endS + 0.05);
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
 * 2. Sequências de micro-cortes (< 180 ms) na trilha de vídeo (mescla pares contíguos sem invadir o plano seguinte).
 * 3. Repetições do mesmo trecho de cena (troca o clipe repetido para outro plano inédito do mesmo episódio).
 * 4. Sobreposições de legendas/textos (aplica os comandos seguros já sugeridos pelo avaliador).
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
    const prevShot = findSourceShot(episodeById.get(prevClip.assetId), prevClip);
    const currShot = findSourceShot(episodeById.get(currClip.assetId), currClip);
    if (!prevShot || !currShot || !Number.isFinite(prevShot.brightness) || !Number.isFinite(currShot.brightness)) continue;
    const prevB = effectiveBrightness(prevShot.brightness, prevClip);
    const currB = effectiveBrightness(currShot.brightness, currClip);
    const diff = prevB - currB;
    if (Math.abs(diff) < 0.25) continue;
    // Compensa parcialmente para aproximar a luminância sem estourar nem escurecer demais
    const targetDelta = diff * 0.65;
    const exposure = Math.round(Math.max(-0.65, Math.min(0.65, targetDelta / 0.35)) * 100) / 100;
    if (Math.abs(exposure) < 0.05) continue;
    const existingColorIdx = currClip.effects.findIndex((fx) => fx.effect === 'color');
    let nextEffects: EffectInstance[];
    if (existingColorIdx >= 0) {
      const existing = currClip.effects[existingColorIdx]!;
      const prevExp = typeof existing.params.exposure === 'number' && Number.isFinite(existing.params.exposure) ? existing.params.exposure : 0;
      const mergedExp = Math.round(Math.max(-0.65, Math.min(0.65, prevExp + exposure)) * 100) / 100;
      nextEffects = currClip.effects.slice();
      nextEffects[existingColorIdx] = {
        ...existing,
        enabled: true,
        params: {
          ...existing.params,
          exposure: mergedExp,
          shadows: mergedExp > 0 ? Math.max(Number(existing.params.shadows ?? 0), 0.08) : Number(existing.params.shadows ?? 0),
          highlights: mergedExp < 0 ? Math.min(Number(existing.params.highlights ?? 0), -0.06) : Number(existing.params.highlights ?? 0),
        },
      };
    } else {
      nextEffects = [
        ...currClip.effects,
        {
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
        },
      ];
    }
    commands.push({
      type: 'clip.update',
      clipId: currId,
      patch: { effects: nextEffects },
    });
    brightnessFixedIds.add(currId);
    brightnessFixCount++;
  }
  if (brightnessFixCount > 0) {
    repairsApplied.push(`Exposição suavizada automaticamente em ${brightnessFixCount} transição(ões) com salto de luminosidade.`);
  }

  // 2. Redução de sequências de micro-cortes (< 180 ms): mescla pares contíguos sem ultrapassar o shot nem a mídia
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
      // Só mescla clipes realmente contíguos (sem pular lacunas)
      if (Math.abs(clipEndUs(first) - second.timelineStartUs) > 10_000) continue;
      const asset = project.assets.find((a) => a.id === first.assetId);
      const maxAssetUs = asset?.probe?.durationUs ?? Infinity;
      const ep = episodeById.get(first.assetId);
      const shot = findSourceShot(ep, first);
      const maxShotUs = shot ? Math.round(shot.endS * SECOND) : Infinity;
      const maxAllowedUs = Math.min(maxAssetUs, maxShotUs);
      const mergedDurUs = first.durationUs + second.durationUs;
      const neededSourceOutUs = first.sourceInUs + Math.round(mergedDurUs * (first.speed || 1));
      if (neededSourceOutUs > maxAllowedUs + 1_000) continue;
      commands.push({
        type: 'clip.update',
        clipId: first.id,
        patch: { durationUs: mergedDurUs, sourceOutUs: Math.min(maxAllowedUs, neededSourceOutUs) },
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

  // 3. Troca automática de cenas repetidas (ou quadros sem definição visual) por planos inéditos e nítidos
  const usedShotRanges = new Map<string, Array<[number, number]>>();
  const usedFingerprints = new Set<string>();
  for (const clip of project.clips) {
    if (!clip.assetId || removedIds.has(clip.id)) continue;
    const list = usedShotRanges.get(clip.assetId) ?? [];
    list.push([clip.sourceInUs / SECOND, clip.sourceOutUs / SECOND]);
    usedShotRanges.set(clip.assetId, list);
    const ep = episodeById.get(clip.assetId);
    const shot = findSourceShot(ep, clip);
    const fp = shot ? ep?.vision?.shots[`t${Math.round(shot.startS * 100)}`]?.local?.fingerprint : undefined;
    if (fp) usedFingerprints.add(fp);
  }
  const overlapsUsed = (assetId: string, startS: number, endS: number) =>
    (usedShotRanges.get(assetId) ?? []).some(([a, b]) => startS < b - 0.1 && endS > a + 0.1);
  const replacedRepeatIds = new Set<string>();
  let repeatFixCount = 0;
  let deadFrameFixCount = 0;
  for (const issue of report.issues) {
    const isRepeat = issue.dimension === 'repetition' && issue.clipIds.length >= 2;
    const isDeadFrame = issue.dimension === 'visual' && issue.type === 'quadro sem definição visual' && issue.clipIds.length >= 1;
    if (!isRepeat && !isDeadFrame) continue;
    const targetClipIds = isRepeat ? issue.clipIds.slice(1) : issue.clipIds;
    for (const dupId of targetClipIds) {
      if (!generatedIds.has(dupId) || removedIds.has(dupId) || replacedRepeatIds.has(dupId)) continue;
      const clip = clipById.get(dupId);
      if (!clip?.assetId) continue;
      const ep = episodeById.get(clip.assetId);
      if (!ep) continue;
      const neededS = (clip.durationUs * (clip.speed || 1)) / SECOND;
      const altShot = ep.analysis.shots
        .filter((s) => {
          if (s.endS - s.startS < neededS + 0.02 || s.tags.includes('escura') || overlapsUsed(clip.assetId!, s.startS, s.startS + neededS)) return false;
          const local = ep.vision?.shots[`t${Math.round(s.startS * 100)}`]?.local;
          if ((local?.deadFrameScore ?? 0) >= 0.65) return false;
          if ((local?.textClutterScore ?? 0) >= 0.65) return false;
          if (local?.fingerprint && usedFingerprints.has(local.fingerprint)) return false;
          return true;
        })
        .sort((a, b) => b.intensity - a.intensity)[0];
      if (!altShot) continue;
      const newSourceInUs = Math.round(altShot.startS * SECOND);
      const newSourceOutUs = newSourceInUs + Math.round(neededS * SECOND);
      commands.push({
        type: 'clip.update',
        clipId: clip.id,
        patch: { sourceInUs: newSourceInUs, sourceOutUs: newSourceOutUs },
      });
      const list = usedShotRanges.get(clip.assetId) ?? [];
      list.push([altShot.startS, altShot.startS + neededS]);
      usedShotRanges.set(clip.assetId, list);
      const newFp = ep.vision?.shots[`t${Math.round(altShot.startS * 100)}`]?.local?.fingerprint;
      if (newFp) usedFingerprints.add(newFp);
      replacedRepeatIds.add(clip.id);
      if (isDeadFrame) deadFrameFixCount++;
      else repeatFixCount++;
    }
  }
  if (repeatFixCount > 0) {
    repairsApplied.push(`${repeatFixCount} cena(s) repetida(s) substituída(s) automaticamente por planos inéditos.`);
  }
  if (deadFrameFixCount > 0) {
    repairsApplied.push(`${deadFrameFixCount} quadro(s) sem nitidez substituído(s) por cenas limpas.`);
  }

  // 4. Correções seguras de duração em legendas sobrepostas
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
