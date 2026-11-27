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
  type EditorialDecision,
  type GlobalEditorialSolution,
} from './editing-decision-engine.js';
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
import type { SemanticAlignmentWeights } from './semantic-alignment.js';

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

export type { EditorialDecision, GlobalQualityReport, CreativeDirectionPlan, CreativeDirectionOverrides };
