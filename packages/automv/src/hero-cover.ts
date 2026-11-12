import type { Shot, ShotVision } from '@amv/analysis';
import type { EpisodeInput, PoolEntry } from './generate.js';

export interface HeroCoverResult {
  assetId: string;
  episodeName: string;
  timestampS: number;
  shot: Shot;
  score: number;
  reason: string;
}

/**
 * Encontra o melhor quadro do episódio (ou da luta escolhida) para servir de capa/pôster principal.
 * Avalia estética, exposição equilibrada, riqueza de detalhes, presença de personagem centralizado
 * e pico de impacto coreográfico.
 */
export function findHeroCoverFrame(
  episodes: EpisodeInput[],
  pool?: PoolEntry[],
  visionOf?: (ep: EpisodeInput, shot: Shot) => ShotVision | undefined,
): HeroCoverResult | null {
  const candidates: { ep: EpisodeInput; shot: Shot; score: number; reason: string; timestampS: number }[] = [];

  const evaluateShot = (ep: EpisodeInput, shot: Shot) => {
    // Ignora planos extremamente curtos ou marcados como escuros demais
    const duration = shot.endS - shot.startS;
    if (duration < 0.35 || shot.tags.includes('escura')) return;

    const vision = visionOf ? visionOf(ep, shot) : undefined;
    const local = vision?.local;

    // 1. Exposição equilibrada (evita telas pretas ou clarões estourados)
    const brightness = local?.brightness ?? shot.brightness;
    if (brightness < 0.28 || brightness > 0.85) return;
    const brightnessScore = 1 - Math.min(1, Math.abs(brightness - 0.52) / 0.35);

    // 2. Riqueza de detalhes visuais e contraste
    const detailScore = local ? (local.entropy * 0.5 + local.edgeDensity * 0.5) : 0.6;

    // 3. Centralização e foco no personagem
    let characterScore = 0.5;
    if (local?.centerOfVisualMass && local.centerOfVisualMass.length === 2) {
      const [cx, cy] = local.centerOfVisualMass;
      const distFromCenter = Math.hypot(cx - 0.5, cy - 0.5);
      characterScore = Math.max(0, 1 - distFromCenter * 2.2);
    }
    if (vision?.characters.length) characterScore += 0.2;

    // 4. Dinâmica e impacto da cena
    let actionScore = shot.intensity * 0.4 + shot.motion * 0.4;
    if (shot.tags.includes('impacto')) actionScore += 0.25;
    if (vision?.action === 'combate') actionScore += 0.2;
    if (vision?.framing === 'close-up' || vision?.framing === 'medium') actionScore += 0.15;

    // Pontuação composta (pesos calibrados para apelo visual de capa)
    const totalScore =
      0.30 * actionScore +
      0.25 * brightnessScore +
      0.25 * characterScore +
      0.20 * detailScore;

    // Escolhe o instante exato do quadro: se houver pico de movimento confiável, usa-o
    let timestampS = shot.startS + duration * 0.4;
    if (Number.isFinite(shot.peakS) && shot.peakS >= shot.startS && shot.peakS <= shot.endS) {
      timestampS = shot.peakS;
    }

    const reasons: string[] = [];
    if (shot.tags.includes('impacto') || vision?.action === 'combate') reasons.push('clímax de ação');
    if (vision?.characters.length) reasons.push(`personagem em destaque (${vision.characters.join(', ')})`);
    if (characterScore >= 0.75) reasons.push('enquadramento centralizado');
    if (detailScore >= 0.65) reasons.push('alta nitidez e contraste visual');

    candidates.push({
      ep,
      shot,
      score: totalScore,
      timestampS: Math.round(timestampS * 1000) / 1000,
      reason: reasons.length ? reasons.join(' · ') : 'composição visual equilibrada',
    });
  };

  // Se houver uma luta selecionada (pool), prioriza os planos dela
  if (pool && pool.length > 0) {
    for (const entry of pool) {
      for (const shot of entry.ep.analysis.shots) {
        if (shot.startS >= entry.seq.startS - 1e-3 && shot.endS <= entry.seq.endS + 1e-3) {
          evaluateShot(entry.ep, shot);
        }
      }
    }
  }

  // Se não achou na luta ou não há pool, analisa todos os episódios disponíveis
  if (!candidates.length) {
    for (const ep of episodes) {
      for (const shot of ep.analysis.shots) {
        evaluateShot(ep, shot);
      }
    }
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]!;

  return {
    assetId: best.ep.assetId,
    episodeName: best.ep.name,
    timestampS: best.timestampS,
    shot: best.shot,
    score: Math.round(best.score * 100) / 100,
    reason: `Capa ideal: ${best.reason}`,
  };
}
