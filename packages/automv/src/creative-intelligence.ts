/**
 * AMV CREATIVE INTELLIGENCE ENGINE — Orquestrador Modular Unificado
 *
 * Conecta todas as camadas do motor:
 * - Visual Understanding Engine (@amv/analysis)
 * - Music Understanding Engine (@amv/analysis)
 * - Semantic Alignment Engine (@amv/automv)
 * - Narrative Director (@amv/automv)
 * - Continuity & Coherence Engine (@amv/automv)
 * - Global Editing Decision Engine & Vocal Interaction (@amv/automv)
 * - Independent Global Quality Review (@amv/automv)
 *
 * Compatível com `Project`, `EpisodeInput`, `MusicInput`, `GenerateOptions` e `Command[]`
 * sem quebrar projetos existentes nem contratos públicos anteriores.
 */
import {
  analyzeEpisodeScenes,
  analyzeMusicUnderstanding,
  defaultCreativeAnalysisCache,
  shotKey,
  type CreativeAnalysisCache,
  type Cue,
  type MusicUnderstandingResult,
  type SceneAnalysis,
} from '@amv/analysis';
import { clipEndUs, sourceTimeAt, type Clip, type Project } from '@amv/project';
import {
  explainEditorialDecision,
  findAlternativeScenesForPhrase,
  solveGlobalEditorialDecisions,
  type EditorialCutType,
  type EditorialDecision,
  type GlobalEditorialSolution,
  type RejectedSceneAlternative,
  type UnifiedAudioEvent,
  type UnifiedAudioEventMap,
} from './editing-decision-engine.js';
import {
  advanceNarrativeMemory,
  createInitialNarrativeMemory,
  evaluateContinuityRelation,
  type ContinuityRelation,
} from './continuity-engine.js';
import type { EpisodeInput, GenerateOptions, MusicInput } from './generate.js';
import { chooseMusicRange, suggestMusicRanges } from './music-selection.js';
import {
  evaluateGlobalAmvQuality,
  type GlobalQualityReport,
  type GlobalQualityWeights,
} from './global-quality-review.js';
import { lyricCueKey } from './lyric-cue-key.js';
import type { LyricMatchMap } from './lyric-matcher.js';
import {
  buildCreativeDirectionPlan,
  type CreativeDirectionOverrides,
  type CreativeDirectionPlan,
} from './narrative-director.js';
import {
  evaluateSemanticAlignment,
  type SemanticAlignmentWeights,
} from './semantic-alignment.js';
import type { StyleId } from './styles.js';
import type { OrganizationMode } from './sequence-planner.js';

export interface PrepareCreativeIntelligenceInput {
  project: Project;
  music: MusicInput;
  episodes: EpisodeInput[];
  options: Pick<
    GenerateOptions,
    | 'style'
    | 'intensity'
    | 'durationS'
    | 'musicStartS'
    | 'lyrics'
    | 'useSpeech'
    | 'organizationMode'
    | 'exclude'
    | 'beatOffsetMs'
  >;
  isInstrumental?: boolean;
  overrides?: CreativeDirectionOverrides;
  semanticWeights?: Partial<SemanticAlignmentWeights>;
  qualityWeights?: Partial<GlobalQualityWeights>;
  cache?: CreativeAnalysisCache;
}

export interface CreativeDirectionSession {
  scenes: SceneAnalysis[];
  musicUnderstanding: MusicUnderstandingResult;
  plan: CreativeDirectionPlan;
  solution: GlobalEditorialSolution;
  qualityReview: GlobalQualityReport;
  lyricMatchMap: LyricMatchMap;
}

const SECOND = 1_000_000;

/**
 * Executa o pipeline completo de Inteligência Criativa (análise contextual, plano não linear,
 * solução global de decisões e avaliação independente de qualidade + auto-refinamento se necessário).
 */
export function prepareCreativeDirectionSession(
  input: PrepareCreativeIntelligenceInput,
): CreativeDirectionSession {
  const cache = input.cache ?? defaultCreativeAnalysisCache;
  const excludeSet = new Set(input.options.exclude ?? []);
  const assetById = new Map(input.project.assets.map((a) => [a.id, a]));

  // 1. Visual Understanding Engine (com cache por hash de arquivo)
  const scenes: SceneAnalysis[] = input.episodes
    .filter((ep) => !excludeSet.has(ep.assetId))
    .flatMap((ep, idx) => {
      const asset = assetById.get(ep.assetId);
      return analyzeEpisodeScenes({
        assetId: ep.assetId,
        assetHash: asset?.hash,
        sourceFile: asset?.path ?? ep.name,
        sourceEpisode: ep.name,
        episodeIndex: idx,
        analysis: ep.analysis,
        vision: ep.vision,
        characterLibrary: input.project.characterLibrary,
        sceneAnnotations: input.project.sceneAnnotations,
        cache,
      });
    })
    .map((scene) => (excludeSet.has(scene.sceneId) ? { ...scene, excluded: true } : scene));

  const hasFights = scenes.some((s) => !s.excluded && s.actions.includes('combate'));
  const hasEmotionalDrama = scenes.some(
    (s) => !s.excluded && (s.actions.includes('tristeza') || s.actions.includes('memória') || s.actions.includes('despedida')),
  );
  const characterNames = [...new Set(scenes.flatMap((s) => s.characterNames))];

  // 2. Music Understanding Engine (com cache por hash da música)
  const musicAsset = assetById.get(input.music.assetId);
  const musicUnderstanding = analyzeMusicUnderstanding(input.music.analysis, {
    assetHash: musicAsset?.hash,
    lyrics: input.options.lyrics,
    isInstrumental: input.isInstrumental,
    animeContext: {
      hasFights,
      hasEmotionalDrama,
      characterNames,
    },
    includeBeatEvents: false,
    cache,
  });

  // 3. Seleção inteligente da janela musical e do drop
  const m = input.music.analysis;
  const beatOffsetS = Math.max(-500, Math.min(500, input.options.beatOffsetMs ?? 0)) / 1000;
  let musicRange: [number, number];
  if (input.options.musicStartS !== null) {
    musicRange = chooseMusicRange(m, input.options.durationS, input.options.musicStartS);
  } else {
    const intensities = scenes.filter((s) => !s.excluded).map((s) => s.intensity);
    const fit = intensities.length
      ? {
          intensities,
          lowI: Math.min(...intensities),
          highI: Math.max(...intensities),
        }
      : null;
    const best = suggestMusicRanges(m, input.options.durationS, fit, 1)[0];
    musicRange = best ? [best.startS, best.endS] : chooseMusicRange(m, input.options.durationS, null);
  }

  const dropsInWindow = m.drops
    .map((d) => d + beatOffsetS)
    .filter((d) => d > musicRange[0] + 1 && d < musicRange[1] - 1);
  const dropAbs = dropsInWindow[0] ?? null;
  const dropTimelineS = dropAbs !== null ? Math.round((dropAbs - musicRange[0]) * 1000) / 1000 : null;

  // 4. Narrative Director (plano linear ou não linear)
  const plan = buildCreativeDirectionPlan({
    scenes,
    musicUnderstanding,
    musicRange,
    dropTimelineS,
    style: input.options.style,
    organizationMode: input.options.organizationMode ?? 'free',
    useSpeech: input.options.useSpeech,
    overrides: input.overrides,
  });

  // 5. Global Editing Decision Engine (Beam Search com memória contextual)
  let solution = solveGlobalEditorialDecisions({
    plan,
    scenes,
    musicUnderstanding,
    overrides: input.overrides,
    semanticWeights: input.semanticWeights,
  });

  // 6. Independent Global Quality Review + passada de auto-refinamento se houver clímax fraco não travado
  let qualityReview = evaluateGlobalAmvQuality({
    decisions: solution.decisions,
    scenes,
    plan,
    musicUnderstanding,
    audioMap: solution.audioMap,
    weights: input.qualityWeights,
  });

  if (
    qualityReview.findings.some((f) => f.code === 'unprepared_climax')
    && !input.overrides?.climaxSceneId
    && plan.climaxSelection?.alternatives.length
  ) {
    const refinedPlan = buildCreativeDirectionPlan({
      scenes,
      musicUnderstanding,
      musicRange,
      dropTimelineS,
      style: input.options.style,
      organizationMode: input.options.organizationMode ?? 'free',
      useSpeech: input.options.useSpeech,
      overrides: {
        ...input.overrides,
        climaxSceneId: plan.climaxSelection.alternatives[0],
      },
    });
    const refinedSolution = solveGlobalEditorialDecisions({
      plan: refinedPlan,
      scenes,
      musicUnderstanding,
      overrides: {
        ...input.overrides,
        climaxSceneId: plan.climaxSelection.alternatives[0],
      },
      semanticWeights: input.semanticWeights,
    });
    const refinedReview = evaluateGlobalAmvQuality({
      decisions: refinedSolution.decisions,
      scenes,
      plan: refinedPlan,
      musicUnderstanding,
      audioMap: refinedSolution.audioMap,
      weights: input.qualityWeights,
    });
    if (refinedReview.overallScore > qualityReview.overallScore) {
      solution = refinedSolution;
      qualityReview = refinedReview;
    }
  }

  // 7. Ponte semântica enriquecida (0..1 + explicação) compatível com `GenerateOptions.lyricSceneMatches`
  const lyricMatchMap = buildSemanticLyricMatchMap(input.options.lyrics ?? [], scenes, musicUnderstanding, plan);

  return {
    scenes,
    musicUnderstanding,
    plan,
    solution,
    qualityReview,
    lyricMatchMap,
  };
}

/**
 * Converte o Semantic Alignment Engine (5 tipos de associação) em `LyricMatchMap`
 * diretamente consumível pelo gerador de timeline.
 */
export function buildSemanticLyricMatchMap(
  cues: Cue[],
  scenes: SceneAnalysis[],
  musicUnderstanding: MusicUnderstandingResult,
  plan?: CreativeDirectionPlan,
): LyricMatchMap {
  const out: LyricMatchMap = {};
  if (!cues.length || musicUnderstanding.isInstrumental) return out;

  const vocalEvents = musicUnderstanding.events.filter((e) => e.eventType === 'vocal_phrase');
  for (const cue of cues) {
    if (!cue.text?.trim() || cue.endS <= cue.startS) continue;
    const cueKey = lyricCueKey(cue);
    const matchingEvent = vocalEvents.find(
      (ev) => Math.abs(ev.startTime - cue.startS) <= 0.25 && ev.lyrics === cue.text.trim(),
    );
    if (!matchingEvent) continue;

    const relTime = plan ? Math.max(0, cue.startS - plan.musicRange[0]) : 0;
    const beat = plan?.narrativeBeats.find((b) => relTime >= b.startTime && relTime <= b.endTime);

    for (const d of solveForCueMatch(matchingEvent, scenes, beat?.allowIntentionalContrast ?? false)) {
      if (d.score >= 62) {
        out[d.sceneId] ??= {};
        out[d.sceneId]![cueKey] = {
          score: Math.round(Math.min(1, d.score / 100) * 100) / 100,
          reason: d.explanation,
        };
      }
    }
  }
  return out;
}

function solveForCueMatch(
  event: MusicUnderstandingResult['events'][number],
  scenes: SceneAnalysis[],
  allowIntentionalContrast: boolean,
) {
  return findAlternativeScenesForPhrase({
    phraseText: event.lyrics ?? '',
    scenes,
    allowIntentionalContrast,
    limit: Math.min(24, scenes.length),
  }).map((item) => ({
    sceneId: item.scene.sceneId,
    score: item.alignment.score,
    explanation: item.alignment.explanation,
  }));
}

/**
 * Explica por que um clipe específico da timeline foi escolhido, cruzando com a `CreativeDirectionSession`
 * ou reconstruindo os sinais objetivos do clipe e da cena original.
 */
export function explainTimelineClipChoice(input: {
  project: Project;
  clip: Clip;
  session?: CreativeDirectionSession | null;
  episodes: EpisodeInput[];
}): string {
  const { clip, session, episodes } = input;
  const clipStartS = clip.timelineStartUs / SECOND;
  const clipEndS = clipEndUs(clip) / SECOND;

  if (session) {
    const matchedDecision = session.solution.decisions.find(
      (d) => Math.abs(d.startTime - clipStartS) <= 0.35 || (d.selectedSceneId.startsWith(`${clip.assetId}@`) && Math.abs(d.sourceStartTime - clip.sourceInUs / SECOND) <= 1.2),
    );
    if (matchedDecision) {
      const scene = session.scenes.find((s) => s.sceneId === matchedDecision.selectedSceneId);
      return explainEditorialDecision(matchedDecision, scene);
    }
  }

  const ep = episodes.find((e) => e.assetId === clip.assetId);
  const srcMidS = sourceTimeAt(clip, clip.durationUs / 2) / SECOND;
  const shot = ep?.analysis.shots.find((s) => srcMidS >= s.startS && srcMidS < s.endS);
  const vision = shot && ep?.vision ? ep.vision.shots[shotKey(shot.startS)] : undefined;

  const lines: string[] = [
    `Clipe na timeline (${clipStartS.toFixed(1)}s–${clipEndS.toFixed(1)}s) · Origem: ${ep?.name ?? clip.assetId ?? 'mídia'} (${(clip.sourceInUs / SECOND).toFixed(1)}s–${(clip.sourceOutUs / SECOND).toFixed(1)}s).`,
  ];
  if (clip.reason) lines.push(`Motivo registrado pelo diretor: ${clip.reason}.`);
  if (shot) {
    lines.push(`Dados medidos do plano: intensidade ${(shot.intensity * 100).toFixed(0)}%, movimento ${(shot.motion * 100).toFixed(0)}%, brilho ${(shot.brightness * 100).toFixed(0)}%, tags [${shot.tags.join(', ') || 'nenhuma'}].`);
  }
  if (vision) {
    lines.push(`Classificação visual${vision.confidence !== undefined ? ` (confiança ${Math.round(vision.confidence * 100)}%)` : ''}: ação "${vision.action ?? 'n/d'}", emoção "${vision.emotion ?? 'n/d'}"${vision.characters.length ? `, personagens: ${vision.characters.join(', ')}` : ''}.`);
  } else {
    lines.push('Confiança semântica limitada: análise de visão profunda (VLM) não foi executada neste plano.');
  }
  return lines.join('\n');
}

export interface AuditedCutDecision extends EditorialDecision {
  continuityWithNext: ContinuityRelation | null;
  clipReason: string;
}

export interface PostGenerationEditorialAudit {
  plan: CreativeDirectionPlan;
  musicUnderstanding: MusicUnderstandingResult;
  scenes: SceneAnalysis[];
  decisions: AuditedCutDecision[];
  audioMap: UnifiedAudioEventMap;
  qualityReview: GlobalQualityReport;
}

/**
 * Audita de forma independente a timeline REAL gerada (pós-montagem e auto-reparo),
 * extraindo para cada clipe de vídeo em V1: cena real escolhida, trecho musical exato,
 * alinhamento semântico, continuidade com a cena anterior E seguinte, alternativas descartadas,
 * tipo exato do corte, coexistência de falas e nota global da sequência completa.
 */
export function auditGeneratedTimelineDecisions(input: {
  project: Project;
  generatedClipIds?: ReadonlySet<string>;
  music: MusicInput;
  episodes: EpisodeInput[];
  lyrics?: Cue[];
  isInstrumental?: boolean;
  style: StyleId;
  organizationMode?: OrganizationMode;
  useSpeech?: boolean;
  overrides?: CreativeDirectionOverrides;
  semanticWeights?: Partial<SemanticAlignmentWeights>;
  qualityWeights?: Partial<GlobalQualityWeights>;
  cache?: CreativeAnalysisCache;
}): PostGenerationEditorialAudit {
  const cache = input.cache ?? defaultCreativeAnalysisCache;
  const assetById = new Map(input.project.assets.map((a) => [a.id, a]));
  const scenes: SceneAnalysis[] = input.episodes.flatMap((ep, idx) => {
    const asset = assetById.get(ep.assetId);
    return analyzeEpisodeScenes({
      assetId: ep.assetId,
      assetHash: asset?.hash,
      sourceFile: asset?.path ?? ep.name,
      sourceEpisode: ep.name,
      episodeIndex: idx,
      analysis: ep.analysis,
      vision: ep.vision,
      characterLibrary: input.project.characterLibrary,
      sceneAnnotations: input.project.sceneAnnotations,
      cache,
    });
  });

  const hasFights = scenes.some((s) => !s.excluded && s.actions.includes('combate'));
  const hasEmotionalDrama = scenes.some(
    (s) => !s.excluded && (s.actions.includes('tristeza') || s.actions.includes('memória') || s.actions.includes('despedida')),
  );
  const characterNames = [...new Set(scenes.flatMap((s) => s.characterNames))];
  const musicAsset = assetById.get(input.music.assetId);
  const musicUnderstanding = analyzeMusicUnderstanding(input.music.analysis, {
    assetHash: musicAsset?.hash,
    lyrics: input.isInstrumental ? undefined : input.lyrics,
    isInstrumental: input.isInstrumental,
    animeContext: { hasFights, hasEmotionalDrama, characterNames },
    includeBeatEvents: false,
    cache,
  });

  const tracksById = new Map(input.project.tracks.map((t) => [t.id, t]));
  const videoTracks = input.project.tracks.filter((t) => t.kind === 'video');
  const v1Id = videoTracks.at(-1)?.id;
  const filterGenerated = (c: Clip) => (!input.generatedClipIds || input.generatedClipIds.has(c.id));

  const musicClip = input.project.clips.find(
    (c) => filterGenerated(c) && tracksById.get(c.trackId)?.role === 'music' && c.assetId === input.music.assetId,
  ) ?? input.project.clips.find((c) => tracksById.get(c.trackId)?.role === 'music');

  const rangeStartS = musicClip ? musicClip.sourceInUs / SECOND : 0;
  const durationS = musicClip ? musicClip.durationUs / SECOND : Math.max(1, input.music.analysis.durationS);
  const musicRange: [number, number] = [rangeStartS, rangeStartS + durationS];

  const dropsInWindow = input.music.analysis.drops.filter((d) => d > musicRange[0] + 0.8 && d < musicRange[1] - 0.8);
  const dropAbs = dropsInWindow[0] ?? null;
  const dropTimelineS = dropAbs !== null ? Math.round((dropAbs - musicRange[0]) * 1000) / 1000 : null;

  const plan = buildCreativeDirectionPlan({
    scenes,
    musicUnderstanding,
    musicRange,
    dropTimelineS,
    style: input.style,
    organizationMode: input.organizationMode ?? 'free',
    useSpeech: input.useSpeech ?? false,
    overrides: input.overrides,
  });

  const v1Clips = input.project.clips
    .filter((c) => filterGenerated(c) && c.trackId === v1Id && Boolean(c.assetId) && !c.text)
    .sort((a, b) => a.timelineStartUs - b.timelineStartUs);

  const voiceClips = input.project.clips
    .filter((c) => filterGenerated(c) && tracksById.get(c.trackId)?.role === 'voice' && c.label !== 'Golpe anime')
    .sort((a, b) => a.timelineStartUs - b.timelineStartUs);

  const matchSceneForClip = (clip: Clip): SceneAnalysis | undefined => {
    const srcMidS = sourceTimeAt(clip, clip.durationUs / 2) / SECOND;
    const epScenes = scenes.filter((s) => s.assetId === clip.assetId);
    return epScenes.find((s) => srcMidS >= s.startTime - 0.05 && srcMidS <= s.endTime + 0.05)
      ?? epScenes.sort((a, b) => Math.abs((a.startTime + a.endTime) / 2 - srcMidS) - Math.abs((b.startTime + b.endTime) / 2 - srcMidS))[0];
  };

  const resolvedScenes = v1Clips.map(matchSceneForClip);
  const eligibleScenes = scenes.filter((s) => !s.excluded);
  const beatsRel = input.music.analysis.beats.map((b) => b - rangeStartS);

  // Mapa unificado real de áudio a partir das trilhas geradas
  const audioEvents: UnifiedAudioEvent[] = [];
  let essentialSpeechCount = 0;
  let interruptedSpeechCount = 0;
  for (const vc of voiceClips) {
    const startS = vc.timelineStartUs / SECOND;
    const endS = clipEndUs(vc) / SECOND;
    const ep = input.episodes.find((e) => e.assetId === vc.assetId);
    const srcInS = vc.sourceInUs / SECOND;
    const origSpeech = ep?.analysis.speech.find((sp) => Math.abs(sp.startS - srcInS) <= 0.35);
    const origDur = origSpeech ? origSpeech.endS - origSpeech.startS : endS - startS;
    const preservesCompleteIdea = (endS - startS) + 0.12 >= origDur;
    if (!preservesCompleteIdea) interruptedSpeechCount++;
    essentialSpeechCount++;
    const overlappedCuts = v1Clips.filter((vc1) => vc1.timelineStartUs / SECOND < endS - 0.08 && clipEndUs(vc1) / SECOND > startS + 0.08).length;
    audioEvents.push({
      id: vc.id,
      role: 'character_speech_essential',
      startTime: Math.round(startS * 1000) / 1000,
      endTime: Math.round(endS * 1000) / 1000,
      sourceSceneId: matchSceneForClip(vc)?.sceneId,
      text: origSpeech?.text ?? vc.reason ?? null,
      preservesCompleteIdea,
      spansMultipleVisualCuts: overlappedCuts >= 2,
      recommendedMusicDuckDb: -10,
      rationale: vc.reason ?? 'Fala integrada na trilha de voz com ducking musical',
    });
  }

  const multiCutVocalPhrases: UnifiedAudioEventMap['multiCutVocalPhrases'] = [];
  if (!musicUnderstanding.isInstrumental) {
    for (const ev of musicUnderstanding.events.filter((e) => e.eventType === 'vocal_phrase' && e.lyrics)) {
      const relStart = ev.startTime - rangeStartS;
      const relEnd = ev.endTime - rangeStartS;
      if (relEnd <= 0 || relStart >= durationS) continue;
      const s = Math.max(0, relStart);
      const e = Math.min(durationS, relEnd);
      const cutCount = v1Clips.filter((c) => c.timelineStartUs / SECOND < e - 0.05 && clipEndUs(c) / SECOND > s + 0.05).length;
      if (cutCount >= 2) {
        multiCutVocalPhrases.push({ lyricEventId: ev.id, text: ev.lyrics!, startTime: s, endTime: e, cutCount });
      }
      audioEvents.push({
        id: ev.id,
        role: 'song_lyrics',
        startTime: Math.round(s * 1000) / 1000,
        endTime: Math.round(e * 1000) / 1000,
        text: ev.lyrics,
        preservesCompleteIdea: true,
        spansMultipleVisualCuts: cutCount >= 2,
        recommendedMusicDuckDb: 0,
        rationale: `Frase cantada (${ev.emotion})`,
      });
    }
  }

  const audioMap: UnifiedAudioEventMap = {
    events: audioEvents.sort((a, b) => a.startTime - b.startTime),
    essentialSpeechCount,
    interruptedSpeechCount,
    multiCutVocalPhrases,
  };

  let memory = createInitialNarrativeMemory();
  const decisions: AuditedCutDecision[] = [];

  for (let i = 0; i < v1Clips.length; i++) {
    const clip = v1Clips[i]!;
    const scene = resolvedScenes[i];
    if (!scene) continue;
    const prevScene = i > 0 ? resolvedScenes[i - 1] ?? null : null;
    const nextScene = i + 1 < v1Clips.length ? resolvedScenes[i + 1] ?? null : null;
    const startS = Math.round((clip.timelineStartUs / SECOND) * 1000) / 1000;
    const endS = Math.round((clipEndUs(clip) / SECOND) * 1000) / 1000;
    const durS = Math.max(0.05, endS - startS);
    const midS = (startS + endS) / 2;
    const absStart = rangeStartS + startS;
    const absEnd = rangeStartS + endS;
    const absMid = rangeStartS + midS;

    const isDrop = dropTimelineS !== null && Math.abs(startS - dropTimelineS) <= 0.18;
    const beat = plan.narrativeBeats.find((b) => midS >= b.startTime - 0.02 && midS <= b.endTime + 0.02)
      ?? plan.narrativeBeats.at(-1)!;

    const activeMusicEvent = (() => {
      if (isDrop) {
        const d = musicUnderstanding.events.find((e) => e.eventType === 'drop' && Math.abs(e.startTime - absStart) <= 0.4);
        if (d) return d;
      }
      if (!musicUnderstanding.isInstrumental) {
        const v = musicUnderstanding.events.find(
          (e) => e.eventType === 'vocal_phrase' && e.startTime < absEnd - 0.04 && e.endTime > absStart + 0.04,
        );
        if (v) return v;
      }
      return musicUnderstanding.events.find(
        (e) => ['pause', 'build', 'climax', 'ending', 'instrumental_passage', 'section'].includes(e.eventType)
          && absMid >= e.startTime && absMid <= e.endTime,
      ) ?? {
        id: `audit-ev-${i}`,
        startTime: absStart,
        endTime: absEnd,
        eventType: 'section' as const,
        lyrics: null,
        semanticMeaning: null,
        emotion: 'determinação' as const,
        intensity: 0.5,
        confidence: 0.65,
      };
    })();

    const keywordEv = !musicUnderstanding.isInstrumental
      ? musicUnderstanding.events.find(
          (e) => e.eventType === 'lyric_keyword' && e.startTime >= absStart - 0.08 && e.startTime <= absEnd + 0.08,
        ) ?? null
      : null;

    const isNonLinearPlan = ['climax_opening', 'non_linear', 'flashback', 'foreshadowing', 'revenge', 'rivalry', 'hybrid'].includes(plan.narrativeModel);

    const semantic = evaluateSemanticAlignment(activeMusicEvent, scene, {
      weights: input.semanticWeights,
      keywordEvent: keywordEv,
      allowIntentionalContrast: beat?.allowIntentionalContrast,
      narrativeTargetTags: beat?.targetTags,
      narrativeRole: beat?.role,
      focusCharacters: characterNames,
    });

    const voiceoverBridgeActive = voiceClips.some(
      (vc) => startS > vc.timelineStartUs / SECOND + 0.05 && startS < clipEndUs(vc) / SECOND - 0.05,
    );
    const prevClip = i > 0 ? v1Clips[i - 1]! : null;
    const previousSpeechAudible = prevClip
      ? voiceClips.some(
          (vc) => vc.assetId === prevClip.assetId
            && Math.abs(vc.timelineStartUs - prevClip.timelineStartUs) <= 0.35 * SECOND,
        )
      : false;
    const transitionCue = isDrop
      ? 'entrada do drop'
      : activeMusicEvent.eventType === 'vocal_phrase' && Math.abs(activeMusicEvent.startTime - absStart) <= 0.25
        ? 'início de frase musical'
        : null;

    const continuityPrev = prevScene
      ? evaluateContinuityRelation(prevScene, scene, memory, {
          musicalTransitionCue: transitionCue,
          allowFlashback: beat?.nonLinearFunction === 'origin_flashback' || isNonLinearPlan,
          allowIntentionalContrast: beat?.allowIntentionalContrast,
          voiceoverBridgeActive,
          previousSpeechAudible,
        })
      : null;

    const currSpeechAudible = voiceClips.some(
      (vc) => vc.assetId === clip.assetId && Math.abs(vc.timelineStartUs - clip.timelineStartUs) <= 0.35 * SECOND,
    );
    const memAfterCurr = advanceNarrativeMemory(memory, scene);
    const continuityNext = nextScene
      ? evaluateContinuityRelation(scene, nextScene, memAfterCurr, {
          allowFlashback: isNonLinearPlan,
          allowIntentionalContrast: beat?.allowIntentionalContrast,
          previousSpeechAudible: currSpeechAudible,
        })
      : null;

    const isBreathingHold = durS >= 2.25 && (
      (clip.reason ?? '').includes('respiração cinematográfica')
      || plan.breathingZones.some((z) => midS >= z.startTime - 0.1 && midS <= z.endTime + 0.1)
      || (input.style === 'emocional' && activeMusicEvent.intensity <= 0.48)
    );

    const nearestBeatDiff = beatsRel.reduce((min, b) => Math.min(min, Math.abs(b - startS)), Infinity);
    const cutType: EditorialCutType = isDrop || (clip.reason ?? '').includes('golpe na batida')
      ? 'sonic_impact'
      : isBreathingHold
        ? 'breathing_hold'
        : activeMusicEvent.eventType === 'pause'
          ? 'musical_pause'
          : activeMusicEvent.eventType === 'vocal_phrase' && Math.abs(activeMusicEvent.startTime - absStart) <= 0.22
            ? 'phrase_start'
            : continuityPrev?.relationKind === 'combat_chain' && scene.actionPhase === 'reaction'
              ? 'reaction_cut'
              : continuityPrev?.relationKind === 'combat_chain'
                ? 'action_cut'
                : activeMusicEvent.eventType === 'instrumental_passage'
                  ? 'instrumental_transition'
                  : nearestBeatDiff <= 0.065
                    ? 'on_beat'
                    : 'pre_beat';

    const chosenScore = Math.round(
      Math.min(100, Math.max(0, continuityPrev ? semantic.score * 0.62 + continuityPrev.continuityScore * 0.38 : semantic.score)) * 10,
    ) / 10;

    const alternatives: RejectedSceneAlternative[] = eligibleScenes
      .filter((alt) => alt.sceneId !== scene.sceneId && alt.durationS + 1e-6 >= durS * 0.6)
      .map((alt) => {
        const altSem = evaluateSemanticAlignment(activeMusicEvent, alt, {
          weights: input.semanticWeights,
          keywordEvent: keywordEv,
          allowIntentionalContrast: beat?.allowIntentionalContrast,
          narrativeTargetTags: beat?.targetTags,
          narrativeRole: beat?.role,
          focusCharacters: characterNames,
        });
        const altCont = prevScene
          ? evaluateContinuityRelation(prevScene, alt, memory, {
              musicalTransitionCue: transitionCue,
              allowFlashback: isNonLinearPlan,
              allowIntentionalContrast: beat?.allowIntentionalContrast,
              voiceoverBridgeActive,
              previousSpeechAudible,
            })
          : null;
        const rawScore = altCont ? altSem.score * 0.62 + altCont.continuityScore * 0.38 : altSem.score;
        const alreadyUsed = memory.usedSceneIds.includes(alt.sceneId);
        const effScore = Math.round(Math.max(0, rawScore - (alreadyUsed ? 25 : 0) - (altCont?.rejected ? 25 : 0)) * 10) / 10;
        let whyRejected = `Pontuação combinada inferior no contexto (${effScore.toFixed(1)} vs ${chosenScore.toFixed(1)})`;
        if (altCont?.rejected) {
          whyRejected = `Rejeitada por quebra de continuidade (${altCont.explanation})`;
        } else if (alreadyUsed) {
          whyRejected = 'Descartada para evitar repetição visual na sequência';
        } else if (altSem.score + 5 < semantic.score) {
          whyRejected = `Menor aderência semântica/musical (${altSem.score.toFixed(0)} vs ${semantic.score.toFixed(0)})`;
        } else if (altCont && continuityPrev && altCont.continuityScore + 5 < continuityPrev.continuityScore) {
          whyRejected = `Menor continuidade com o plano anterior (${altCont.continuityScore.toFixed(0)} vs ${continuityPrev.continuityScore.toFixed(0)})`;
        } else if (effScore >= chosenScore) {
          whyRejected = 'Preterida pelo planejador de fluxo/ritmo local (encaixe de pico de movimento ou cadência da sequência)';
        }
        return {
          sceneId: alt.sceneId,
          episodeName: alt.sourceEpisode,
          startTime: alt.startTime,
          endTime: alt.endTime,
          score: effScore,
          alignmentType: altSem.alignmentType,
          whyRejected,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const musicalRelationship = isDrop
      ? `Sincronizado ao drop principal (${startS.toFixed(2)}s) via corte "${cutType}"`
      : activeMusicEvent.lyrics
        ? `Frase "${activeMusicEvent.lyrics}" (${(activeMusicEvent.startTime - rangeStartS).toFixed(1)}s–${(activeMusicEvent.endTime - rangeStartS).toFixed(1)}s) · alinhamento ${semantic.alignmentType} (${semantic.phraseSync.mode})`
        : isBreathingHold
          ? `Respiração cinematográfica sustentada (${durS.toFixed(2)}s) sobre seção "${beat?.section ?? 'calma'}"`
          : `Seção "${beat?.section ?? activeMusicEvent.eventType}" (${activeMusicEvent.emotion}, intensidade ${(activeMusicEvent.intensity * 100).toFixed(0)}%) · corte "${cutType}"`;

    const narrativeRelationship = [
      `Função "${beat?.nonLinearFunction ?? 'escalation'}" no modelo "${plan.narrativeModelLabel}"`,
      continuityPrev ? `Anterior → Atual: ${continuityPrev.explanation}` : 'Abertura da montagem',
      continuityNext ? `Atual → Seguinte: ${continuityNext.explanation}` : 'Plano de encerramento',
    ].join(' · ');

    const coherenceRisks: string[] = [];
    if (scene.confidence < 0.5) {
      coherenceRisks.push('Confiança semântica local (sem VLM externo; guiado por fluxo óptico, áudio, legendas e composição).');
    }
    if (continuityPrev?.rejected) {
      coherenceRisks.push(`Transição brusca detectada: ${continuityPrev.explanation}`);
    }

    decisions.push({
      slotIndex: i,
      selectedSceneId: scene.sceneId,
      episodeName: scene.sourceEpisode,
      clipId: clip.id,
      startTime: startS,
      endTime: endS,
      sourceStartTime: Math.round((clip.sourceInUs / SECOND) * 1000) / 1000,
      sourceEndTime: Math.round((clip.sourceOutUs / SECOND) * 1000) / 1000,
      cutType,
      isBreathingHold,
      lockedByUser: false,
      reason: clip.reason ?? semantic.explanation,
      clipReason: clip.reason ?? '',
      musicalRelationship,
      narrativeRelationship,
      semanticAlignment: semantic,
      continuityWithPrevious: continuityPrev,
      continuityWithNext: continuityNext,
      alternatives,
      coherenceRisks,
      score: chosenScore,
      confidence: Math.round((semantic.confidence * 0.55 + (continuityPrev?.confidence ?? scene.confidence) * 0.45) * 1000) / 1000,
    });

    memory = memAfterCurr;
  }

  const qualityReview = evaluateGlobalAmvQuality({
    decisions,
    scenes,
    plan,
    musicUnderstanding,
    audioMap,
    weights: input.qualityWeights,
  });

  return {
    plan,
    musicUnderstanding,
    scenes,
    decisions,
    audioMap,
    qualityReview,
  };
}

export type { EditorialDecision, GlobalQualityReport, CreativeDirectionPlan, CreativeDirectionOverrides };
