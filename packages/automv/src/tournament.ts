import { shotKey } from '@amv/analysis';
import { applyCommand, clipEndUs, sourceTimeAt, type Clip, type Project } from '@amv/project';
import { buildCreativeBrief, qualityIssueSummary, reviewGeneratedAssembly, type CreativeBrief, type CreativeReview } from './creative-director.js';
import {
  auditGeneratedTimelineDecisions,
  prepareCreativeDirectionSession,
  type PostGenerationEditorialAudit,
} from './creative-intelligence.js';
import { generateAmv, resolveAutonomousOptions, type EpisodeInput, type GenerateOptions, type GenerateResult, type MusicInput } from './generate.js';

const SECOND = 1_000_000;

export interface AssemblyScoreBreakdown {
  /** Zero defeitos técnicos (sem lacunas, sem saltos de luz, sem sobreposições): 0..28 */
  technical: number;
  /** Precisão de batida, impactos encaixados e entrada no drop: 0..24 */
  sync: number;
  /** Diversidade real de planos e assinaturas visuais sem clones: 0..20 */
  diversity: number;
  /** Arco começo → meio → clímax → encerramento com contraste: 0..16 */
  narrative: number;
  /** Fusão multimodal (música + falas + tipografia dinâmica + V2 + SFX): 0..12 */
  multimodal: number;
  /** Nota final consolidada: 0..100 */
  total: number;
}

export interface TournamentCandidateResult {
  seed: number;
  label: string;
  options: GenerateOptions;
  generated: GenerateResult;
  brief: CreativeBrief;
  review: CreativeReview;
  score: AssemblyScoreBreakdown;
  editorialAudit: PostGenerationEditorialAudit;
}

export interface GenerateBestAmvResult {
  winner: TournamentCandidateResult;
  candidatesEvaluated: number;
  allScores: Array<{ seed: number; label: string; score: number; issues: { high: number; medium: number; low: number } }>;
  unifiedHighlights: string[];
}

function findShotForClip(ep: EpisodeInput | undefined, clip: Clip) {
  if (!ep) return undefined;
  const midS = sourceTimeAt(clip, clip.durationUs / 2) / SECOND;
  return ep.analysis.shots.find((s) => midS >= s.startS && midS < s.endS)
    ?? ep.analysis.shots.find((s) => midS >= s.startS - 0.05 && midS <= s.endS + 0.05);
}

export function scoreAssemblyQuality(input: {
  project: Project;
  generatedClipIds: ReadonlySet<string>;
  summary: GenerateResult['summary'];
  brief: CreativeBrief;
  review: CreativeReview;
  episodes: EpisodeInput[];
  hasLyrics: boolean;
  sfxRequested: boolean;
}): AssemblyScoreBreakdown {
  const { project, generatedClipIds, summary, brief, review, episodes, hasLyrics, sfxRequested } = input;
  const epById = new Map(episodes.map((ep) => [ep.assetId, ep]));
  const tracksById = new Map(project.tracks.map((t) => [t.id, t]));
  const aiClips = project.clips.filter((c) => generatedClipIds.has(c.id));
  const videoTracks = project.tracks.filter((t) => t.kind === 'video');
  const v1Id = videoTracks.at(-1)?.id;
  const v2Id = videoTracks.length >= 2 && videoTracks[0]?.id !== v1Id ? videoTracks[0]?.id : undefined;

  const v1Clips = aiClips
    .filter((c) => c.trackId === v1Id && Boolean(c.assetId))
    .sort((a, b) => a.timelineStartUs - b.timelineStartUs);
  const v2Clips = v2Id ? aiClips.filter((c) => c.trackId === v2Id && Boolean(c.assetId)) : [];
  const textClips = aiClips.filter((c) => tracksById.get(c.trackId)?.kind === 'text' && Boolean(c.text));

  // 1. Rigor Técnico (0..28)
  const counts = qualityIssueSummary(review.quality.issues);
  const issuePenalty = counts.high * 16 + counts.medium * 6.5 + counts.low * 2.2;
  const technical = Math.max(0, Math.min(28, 28 - issuePenalty));

  // 2. Sincronia Rítmica & Golpes na Batida (0..24)
  const safeCuts = Number.isFinite(summary.cuts) && summary.cuts > 0 ? summary.cuts : 0;
  const safeHits = Number.isFinite(summary.hitsSynced) && summary.hitsSynced > 0 ? summary.hitsSynced : 0;
  const targetHitCount = Math.max(1, safeCuts * 0.35);
  const hitRatio = safeCuts > 0 ? Math.min(1, safeHits / targetHitCount) : 0;
  const metChecks = review.alignment.filter((item) => item.status === 'met').length;
  const alignmentRatio = review.alignment.length ? metChecks / review.alignment.length : 0.7;
  const dropBonus = summary.drop !== null ? 4 : 2.5;
  const sync = Math.max(0, Math.min(24, hitRatio * 15 + alignmentRatio * 5 + dropBonus));

  // 3. Diversidade Visual & Anti-Clone (0..20)
  const uniqueSources = new Set<string>();
  const uniqueFingerprints = new Set<string>();
  let fpEligible = 0;
  for (const clip of v1Clips) {
    const ep = epById.get(clip.assetId!);
    const shot = findShotForClip(ep, clip);
    if (shot) {
      uniqueSources.add(`${clip.assetId}:${Math.round(shot.startS * 10)}`);
      const local = ep?.vision?.shots[shotKey(shot.startS)]?.local;
      if (local?.fingerprint && local.entropy >= 0.16) {
        fpEligible++;
        uniqueFingerprints.add(local.fingerprint);
      }
    } else {
      uniqueSources.add(`${clip.assetId}:${Math.round(clip.sourceInUs / 100_000)}`);
    }
  }
  const sourceUniqueness = v1Clips.length ? uniqueSources.size / v1Clips.length : 0;
  const fpUniqueness = fpEligible >= 2 ? uniqueFingerprints.size / fpEligible : sourceUniqueness;
  const diversity = Math.max(0, Math.min(20, sourceUniqueness * 12 + fpUniqueness * 8));

  // 4. Progressão Narrativa em 3 Atos (0..16)
  let arcContrastScore = 4;
  if (v1Clips.length >= 4) {
    const totalDurUs = Math.max(1, clipEndUs(v1Clips.at(-1)!) - v1Clips[0]!.timelineStartUs);
    const start0 = v1Clips[0]!.timelineStartUs;
    const openingIntensities: number[] = [];
    const climaxIntensities: number[] = [];
    for (const clip of v1Clips) {
      const ep = epById.get(clip.assetId!);
      const shot = findShotForClip(ep, clip);
      if (!shot || !Number.isFinite(shot.intensity)) continue;
      const rel = (clip.timelineStartUs - start0) / totalDurUs;
      if (rel <= 0.25) openingIntensities.push(shot.intensity);
      else if (rel >= 0.32 && rel <= 0.82) climaxIntensities.push(shot.intensity);
    }
    if (openingIntensities.length && climaxIntensities.length) {
      const avgOpen = openingIntensities.reduce((a, b) => a + b, 0) / openingIntensities.length;
      const avgPeak = Math.max(...climaxIntensities) * 0.5
        + (climaxIntensities.reduce((a, b) => a + b, 0) / climaxIntensities.length) * 0.5;
      const delta = avgPeak - avgOpen;
      arcContrastScore = delta >= 0.12 ? 6.5 : delta >= 0 ? 4.8 : 2;
    }
  }
  const populatedBeats = brief.arc.filter((beat) =>
    v1Clips.some((c) => c.timelineStartUs < beat.endS * SECOND && clipEndUs(c) > beat.startS * SECOND),
  ).length;
  const arcCoverage = brief.arc.length ? (populatedBeats / brief.arc.length) * 5.5 : 4.5;
  const hasFadeIn = v1Clips[0]?.effects.some((fx) => fx.enabled && fx.effect === 'fade_in') ?? false;
  const hasFadeOut = v1Clips.at(-1)?.effects.some((fx) => fx.enabled && fx.effect === 'fade_out') ?? false;
  const bookendScore = (hasFadeIn ? 2 : 0.8) + (hasFadeOut ? 2 : 0.8);
  const narrative = Math.max(0, Math.min(16, arcContrastScore + arcCoverage + bookendScore));

  // 5. Coesão Multimodal Unificada (0..12)
  const anySpeechAvailable = episodes.some((ep) => ep.hasAudio && ep.analysis.speech.length > 0);
  const speechScore = !anySpeechAvailable ? 3 : summary.voices > 0 ? 3.5 : 1.5;
  const lyricClips = textClips.filter((c) => /letra da música|palavra da letra/i.test(c.reason ?? ''));
  const distinctFonts = new Set(lyricClips.map((c) => `${c.text?.font}:${c.blendMode}:${c.text?.fillStyle}`)).size;
  const typoScore = !hasLyrics
    ? 3.5
    : distinctFonts >= 2
      ? 3.5
      : lyricClips.length > 0
        ? 2.4
        : 0.5;
  const cutoutScore = !hasLyrics ? 2.5 : v2Clips.length > 0 ? 2.5 : 1.2;
  const sfxScore = !sfxRequested ? 2.5 : summary.sfx > 0 ? 2.5 : 1;
  const multimodal = Math.max(0, Math.min(12, speechScore + typoScore + cutoutScore + sfxScore));

  const round1 = (n: number) => Math.round(n * 10) / 10;
  const total = Math.min(100, Math.max(0, Math.round((technical + sync + diversity + narrative + multimodal) * 10) / 10));
  return {
    technical: round1(technical),
    sync: round1(sync),
    diversity: round1(diversity),
    narrative: round1(narrative),
    multimodal: round1(multimodal),
    total,
  };
}

function buildUnifiedHighlights(
  winner: TournamentCandidateResult,
  project: Project,
  candidatesEvaluated: number,
): string[] {
  const highlights: string[] = [];
  const added = winner.review.commands.flatMap((cmd) => cmd.type === 'clip.add' ? [cmd.clip] : []);
  const v2Masks = added.filter((c) => c.mask === 'subject-focus' || c.mask === 'manga-slash').length;
  const blendTexts = added.filter((c) => c.text && (c.blendMode !== 'normal' || c.text.fillStyle === 'hollow')).length;
  const distinctFonts = new Set(added.flatMap((c) => c.text ? [c.text.font] : [])).size;
  const animeBursts = added.filter((c) => c.label === 'Golpe anime').length;

  highlights.push(`Melhor montagem eleita entre ${candidatesEvaluated} variações (nota ${winner.score.total.toFixed(0)}/100)`);
  if (winner.generated.summary.hitsSynced > 0) {
    highlights.push(`${winner.generated.summary.hitsSynced} impacto(s) cravados na batida${animeBursts > 0 ? ` + ${animeBursts} som(ns) reais dos golpes` : ''}`);
  }
  if (distinctFonts >= 2 || blendTexts > 0) {
    highlights.push(
      `Tipografia adaptativa (${distinctFonts} famílias${blendTexts > 0 ? ` · ${blendTexts} mesclada(s) ao vídeo` : ''}${v2Masks > 0 ? ` · ${v2Masks} recorte(s) V2 de personagem` : ''})`,
    );
  } else if (v2Masks > 0) {
    highlights.push(`${v2Masks} destaque(s) de profundidade em V2`);
  }
  if (winner.generated.summary.voices > 0) {
    const voiceTrack = project.tracks.find((t) => t.kind === 'audio' && t.role === 'voice');
    if (voiceTrack) {
      highlights.push(`${winner.generated.summary.voices} fala(s) integradas com isolamento vocal, ducking musical e legenda dedicada`);
    }
  }
  return highlights;
}

/**
 * Gera múltiplas variações candidatas determinísticas, executa revisão + auto-reparo
 * em cada uma e elege objetivamente o melhor AMV gerado.
 */
export function generateBestAmv(input: {
  project: Project;
  music: MusicInput;
  episodes: EpisodeInput[];
  options: GenerateOptions;
  candidateCount?: number;
}): GenerateBestAmvResult {
  const { project, music, episodes, options } = input;
  const count = Math.max(1, Math.min(8, input.candidateCount ?? (options.autonomous ? 5 : 3)));
  const baseResolved = options.autonomous ? resolveAutonomousOptions(music, episodes, options) : options;
  const hasSpeeches = episodes.some((ep) => ep.hasAudio && ep.analysis.speech.length > 0);
  const hasFights = episodes.some((ep) => (ep.analysis.sequences ?? []).some((seq) => seq.kind === 'luta'));

  const variations: Array<{ label: string; opts: GenerateOptions }> = [];
  const seedOffsets = [0, 17, 53, 97, 149, 211, 277, 347];
  for (let i = 0; i < count; i++) {
    const seed = options.seed + seedOffsets[i]!;
    if (!options.autonomous || i === 0) {
      variations.push({
        label: options.autonomous ? 'Diretor Mestre · Equilíbrio Total' : `Semente ${seed}`,
        opts: { ...options, seed },
      });
      continue;
    }
    if (i === 1) {
      variations.push({
        label: 'Diretor Mestre · Máximo Impacto Rítmico',
        opts: {
          ...baseResolved,
          autonomous: false,
          dynamicTypography: true,
          seed,
          intensity: Math.min(3, baseResolved.intensity + 1) as 0 | 1 | 2 | 3,
        },
      });
    } else if (i === 2 && hasSpeeches && hasFights) {
      variations.push({
        label: 'Diretor Mestre · Ascensão & Virada Dramática',
        opts: {
          ...baseResolved,
          autonomous: false,
          dynamicTypography: true,
          style: baseResolved.style === 'hype' ? 'superacao' : 'hype',
          seed,
        },
      });
    } else if (i === 3) {
      variations.push({
        label: 'Diretor Mestre · Fluidez Coreográfica',
        opts: {
          ...baseResolved,
          autonomous: true,
          seed,
        },
      });
    } else {
      variations.push({
        label: `Diretor Mestre · Alternativa ${i + 1}`,
        opts: {
          ...baseResolved,
          autonomous: true,
          seed,
        },
      });
    }
  }

  const evaluated: TournamentCandidateResult[] = [];
  const sessionBySignature = new Map<string, NonNullable<GenerateOptions['creativeSession']>>();
  if (options.creativeSession) {
    const initSig = `${options.style}:${options.intensity}:${options.organizationMode ?? 'free'}:${Boolean(options.isInstrumental)}`;
    sessionBySignature.set(initSig, options.creativeSession);
  }
  for (const variant of variations) {
    const resolvedPre = variant.opts.autonomous ? resolveAutonomousOptions(music, episodes, variant.opts) : variant.opts;
    const sig = `${resolvedPre.style}:${resolvedPre.intensity}:${resolvedPre.organizationMode ?? 'free'}:${Boolean(resolvedPre.isInstrumental)}`;
    let activeSession = variant.opts.creativeSession && sig === `${options.style}:${options.intensity}:${options.organizationMode ?? 'free'}:${Boolean(options.isInstrumental)}`
      ? variant.opts.creativeSession
      : sessionBySignature.get(sig);
    if (!activeSession) {
      activeSession = prepareCreativeDirectionSession({
        project,
        music,
        episodes,
        options: {
          style: resolvedPre.style,
          intensity: resolvedPre.intensity,
          durationS: resolvedPre.durationS,
          musicStartS: resolvedPre.musicStartS,
          lyrics: resolvedPre.isInstrumental ? undefined : resolvedPre.lyrics,
          useSpeech: resolvedPre.useSpeech,
          organizationMode: resolvedPre.organizationMode,
          exclude: resolvedPre.exclude,
          beatOffsetMs: resolvedPre.beatOffsetMs,
        },
        isInstrumental: resolvedPre.isInstrumental,
        overrides: resolvedPre.creativeOverrides,
      });
      sessionBySignature.set(sig, activeSession);
    }
    const variantOptsWithIntelligence: GenerateOptions = {
      ...variant.opts,
      creativeSession: activeSession,
    };
    const generated = generateAmv(project, music, episodes, variantOptsWithIntelligence);
    const effectiveOpts = variantOptsWithIntelligence.autonomous
      ? resolveAutonomousOptions(music, episodes, variantOptsWithIntelligence)
      : variantOptsWithIntelligence;
    const brief = buildCreativeBrief({
      style: effectiveOpts.style,
      episodes,
      music,
      options: {
        durationS: effectiveOpts.durationS,
        intensity: effectiveOpts.intensity,
        editorialDirection: effectiveOpts.editorialDirection,
        organizationMode: effectiveOpts.organizationMode,
        focus: effectiveOpts.focus,
        voiceMoments: effectiveOpts.voiceMoments,
      },
      direction: generated.summary.direction,
      hasTimedLyrics: Boolean(!effectiveOpts.isInstrumental && effectiveOpts.lyrics?.length),
    });
    const review = reviewGeneratedAssembly({
      project,
      commands: generated.commands,
      brief,
      direction: generated.summary.direction,
      summary: generated.summary,
      episodes,
      music,
    });
    const finalGenerated: GenerateResult = {
      ...generated,
      commands: review.commands,
    };
    const generatedIds = new Set(
      review.commands.flatMap((cmd) => (cmd.type === 'clip.add' ? [cmd.clip.id] : [])),
    );
    const preview = applyCommand(project, {
      type: 'batch',
      label: 'Avaliação de candidato do torneio',
      commands: review.commands,
    }).project;
    const editorialAudit = auditGeneratedTimelineDecisions({
      project: preview,
      generatedClipIds: generatedIds,
      music,
      episodes,
      lyrics: effectiveOpts.isInstrumental ? undefined : effectiveOpts.lyrics,
      isInstrumental: effectiveOpts.isInstrumental,
      style: effectiveOpts.style,
      organizationMode: effectiveOpts.organizationMode,
      useSpeech: effectiveOpts.useSpeech,
      overrides: effectiveOpts.creativeOverrides,
    });
    const baseScore = scoreAssemblyQuality({
      project: preview,
      generatedClipIds: generatedIds,
      summary: generated.summary,
      brief,
      review,
      episodes,
      hasLyrics: Boolean(!effectiveOpts.isInstrumental && effectiveOpts.lyrics?.length),
      sfxRequested: Boolean(effectiveOpts.useSfx !== false && effectiveOpts.sfxMode !== 'off' && effectiveOpts.sfxAssets),
    });
    const blendedTotal = Math.round((baseScore.total * 0.75 + editorialAudit.qualityReview.overallScore * 0.25) * 10) / 10;
    const score: AssemblyScoreBreakdown = {
      ...baseScore,
      total: Math.min(100, Math.max(0, blendedTotal)),
    };
    evaluated.push({
      seed: variant.opts.seed,
      label: variant.label,
      options: effectiveOpts,
      generated: finalGenerated,
      brief,
      review,
      score,
      editorialAudit,
    });
  }

  evaluated.sort((a, b) => b.score.total - a.score.total || b.score.technical - a.score.technical || a.seed - b.seed);
  const winner = evaluated[0]!;
  return {
    winner,
    candidatesEvaluated: evaluated.length,
    allScores: evaluated.map((item) => ({
      seed: item.seed,
      label: item.label,
      score: item.score.total,
      issues: qualityIssueSummary(item.review.quality.issues),
    })),
    unifiedHighlights: buildUnifiedHighlights(winner, project, evaluated.length),
  };
}
