/**
 * NARRATIVE DIRECTOR (Camada 4 — AMV Creative Intelligence)
 *
 * Constrói o plano global de direção narrativa (linear ou não linear) a partir de
 * `SceneAnalysis[]` (múltiplos episódios) e `MusicUnderstandingResult`.
 *
 * Modelos suportados:
 * - climax_opening (abertura pelo clímax / cold open de fim de episódio)
 * - non_linear (mistura livre intencional entre episódios)
 * - flashback (presente intercalado com memórias)
 * - foreshadowing (antecipação visual/verbal antes da virada)
 * - overcoming (queda/dor → resistência → superação → conquista)
 * - rivalry (paralelismo entre protagonistas/rivais até o choque)
 * - emotional (vínculo, perda, memória e respiração longa)
 * - revenge (ferida/perda → tensão → caçada → acerto de contas)
 * - transformation (contenção/crise → despertar → forma liberada)
 * - combat_sequence (preparação → troca coreografada → clímax → consequência)
 * - dialogue_driven (falas estruturando a tese narrativa)
 * - hybrid (fusão dramática/emocional com explosão de combate)
 */
import type {
  CreativeMusicEvent,
  MusicUnderstandingResult,
  SceneAnalysis,
  SceneSemanticTag,
  SectionEditorialStrategy,
} from '@amv/analysis';
import type { NarrativeBeat, NarrativeRole } from './narrative.js';
import type { SemanticAlignmentType } from './semantic-alignment.js';
import type { OrganizationMode } from './sequence-planner.js';
import type { StyleId } from './styles.js';

export type NarrativeModelId =
  | 'climax_opening'
  | 'non_linear'
  | 'flashback'
  | 'foreshadowing'
  | 'overcoming'
  | 'rivalry'
  | 'emotional'
  | 'revenge'
  | 'transformation'
  | 'combat_sequence'
  | 'dialogue_driven'
  | 'hybrid';

export type NonLinearBeatFunction =
  | 'cold_open_climax'
  | 'origin_flashback'
  | 'conflict_setup'
  | 'foreshadowing_hint'
  | 'rising_clash'
  | 'memory_echo'
  | 'emotional_bridge'
  | 'turning_point'
  | 'apex_climax'
  | 'breathing_hold'
  | 'aftermath'
  | 'intentional_ending';

export type EndingStrategyKind =
  | 'character_gaze'
  | 'dramatic_silence'
  | 'victory'
  | 'defeat'
  | 'farewell'
  | 'dry_impact_cut'
  | 'musical_resolution';

export interface CreativeNarrativeBeat extends NarrativeBeat {
  beatId: string;
  startTime: number;
  endTime: number;
  nonLinearFunction: NonLinearBeatFunction;
  targetEmotion: string;
  targetTags: SceneSemanticTag[];
  preferredEpisodeScope: 'any' | 'late_hook' | 'early_origin' | 'cross_episode' | 'climax_payoff';
  allowCrossEpisode: boolean;
  allowIntentionalContrast: boolean;
  preferBreathingHold: boolean;
  musicalStrategy: SectionEditorialStrategy;
  suggestedSceneId: string | null;
  confidence: number;
}

export interface KeySceneAnchor {
  sceneId: string;
  episodeName: string;
  episodeIndex: number;
  startTime: number;
  endTime: number;
  isLateEpisodeHook: boolean;
  reason: string;
  alternatives: string[];
  confidence: number;
}

export interface EndingPlan {
  kind: EndingStrategyKind;
  sceneId: string | null;
  episodeName: string | null;
  reason: string;
  alternatives: string[];
}

export interface PreservedDialogueMoment {
  sceneId: string;
  episodeName: string;
  startTime: number;
  endTime: number;
  text: string;
  importance: 'essential' | 'supporting';
  reason: string;
}

export interface CreativeDirectionOverrides {
  narrativeModel?: NarrativeModelId;
  openingSceneId?: string;
  climaxSceneId?: string;
  endingSceneId?: string;
  /** Travas explícitas do usuário: índice de beat ou slot → sceneId. */
  lockedScenes?: Record<string, string>;
  /** Cenas cujas falas devem ser preservadas integralmente. */
  preservedDialogueSceneIds?: string[];
  /** Cenas rejeitadas manualmente na prévia de direção. */
  rejectedSceneIds?: string[];
  /** Força um tipo preferencial de relação música-imagem. */
  preferredAlignmentType?: SemanticAlignmentType;
  /** Ajuste fino de intensidade editorial (-1 mais respiração, +1 mais impacto). */
  intensityBias?: -1 | 0 | 1;
  /** Variação de proposta pedida pelo usuário ("Solicitar nova proposta"). */
  proposalVariant?: number;
}

export interface CreativeDirectionPlan {
  centralIdea: string;
  predominantEmotion: string;
  narrativeModel: NarrativeModelId;
  narrativeModelLabel: string;
  narrativeModelReason: string;
  musicRange: [number, number];
  dropTimelineS: number | null;
  openingSelection: KeySceneAnchor | null;
  climaxSelection: KeySceneAnchor | null;
  endingStrategy: EndingPlan;
  narrativeBeats: CreativeNarrativeBeat[];
  preservedDialogues: PreservedDialogueMoment[];
  breathingZones: Array<{ startTime: number; endTime: number; reason: string }>;
  keyMusicalMoments: Array<{ timelineS: number; type: string; description: string }>;
  confidence: number;
}

export interface BuildCreativeDirectionInput {
  scenes: SceneAnalysis[];
  musicUnderstanding: MusicUnderstandingResult;
  musicRange: [number, number];
  dropTimelineS: number | null;
  style: StyleId;
  organizationMode?: OrganizationMode;
  useSpeech?: boolean;
  overrides?: CreativeDirectionOverrides;
}

export const NARRATIVE_MODEL_LABELS: Record<NarrativeModelId, string> = {
  climax_opening: 'Abertura pelo Clímax (Não Linear)',
  non_linear: 'Mosaico Narrativo Não Linear',
  flashback: 'Presente & Memória (Flashbacks)',
  foreshadowing: 'Antecipação Dramática & Virada',
  overcoming: 'Jornada de Superação',
  rivalry: 'Rivalidade & Duelo de Perspectivas',
  emotional: 'Drama Emocional & Respiração',
  revenge: 'Cicatriz & Vingança',
  transformation: 'Despertar & Transformação',
  combat_sequence: 'Coreografia de Combate Contínua',
  dialogue_driven: 'Narrativa Conduzida por Diálogos',
  hybrid: 'Direção Híbrida (Drama + Explosão)',
};

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function hasTag(scene: SceneAnalysis, tag: SceneSemanticTag, minScore = 0.45): boolean {
  return scene.semanticTags.some((t) => t.tag === tag && t.score >= minScore);
}

/**
 * Escolhe o modelo narrativo mais coerente com a música, o material visual analisado e o modo do usuário.
 */
export function selectBestNarrativeModel(input: BuildCreativeDirectionInput): {
  model: NarrativeModelId;
  reason: string;
  confidence: number;
} {
  if (input.overrides?.narrativeModel) {
    return {
      model: input.overrides.narrativeModel,
      reason: `Modelo narrativo "${NARRATIVE_MODEL_LABELS[input.overrides.narrativeModel]}" selecionado nas diretrizes editoriais.`,
      confidence: 0.95,
    };
  }

  const eligible = input.scenes.filter((s) => !s.excluded);
  const episodesCount = new Set(eligible.map((s) => s.assetId)).size;
  const themes = new Set(input.musicUnderstanding.lyricInterpretations.flatMap((l) => l.meaning.themes));
  const variant = input.overrides?.proposalVariant ?? 0;

  if (input.style === 'discurso') {
    return {
      model: 'dialogue_driven',
      reason: 'Estilo de discurso ativo: as falas dramáticas dos personagens estruturam a tese e os capítulos da montagem.',
      confidence: 0.88,
    };
  }

  if (input.organizationMode === 'chronological') {
    const isOvercoming = input.style === 'superacao' || themes.has('superação') || themes.has('resistência');
    return {
      model: isOvercoming ? 'overcoming' : input.style === 'emocional' ? 'emotional' : 'combat_sequence',
      reason: 'Modo cronológico solicitado: progressão dramática respeitando a evolução linear dos acontecimentos.',
      confidence: 0.82,
    };
  }

  const hasLateEpisodeHook = eligible.some(
    (s) => (s.context.episodeProgress >= 0.72 || s.episodeIndex > 0)
      && (hasTag(s, 'impacto', 0.65) || hasTag(s, 'revelação', 0.6) || hasTag(s, 'confronto_emocional', 0.65) || hasTag(s, 'transformação', 0.65)),
  );
  const hasMemories = eligible.filter((s) => hasTag(s, 'memória', 0.55) || hasTag(s, 'tristeza', 0.6)).length >= 2;
  const hasTransform = eligible.some((s) => hasTag(s, 'transformação', 0.7)) || themes.has('transformação');
  const hasRevenge = themes.has('vingança') || (hasMemories && themes.has('fúria'));
  const hasOvercoming = input.style === 'superacao'
    || themes.has('superação')
    || themes.has('resistência')
    || (eligible.some((s) => s.characterState === 'debilitated') && eligible.some((s) => hasTag(s, 'impacto') || hasTag(s, 'vitória')));

  // Contagem de personagens recorrentes para rivalidade
  const charFreq = new Map<string, number>();
  for (const s of eligible) {
    for (const c of s.characterNames) charFreq.set(c, (charFreq.get(c) ?? 0) + 1);
  }
  const majorChars = [...charFreq.entries()].filter(([, n]) => n >= 2);

  const candidates: Array<{ model: NarrativeModelId; score: number; reason: string }> = [];

  if (episodesCount >= 2 && hasLateEpisodeHook) {
    candidates.push({
      model: 'climax_opening',
      score: 88,
      reason: `Múltiplos episódios (${episodesCount}) com cena forte de terço final disponível: abrir pelo clímax cria gancho imediato antes de reconstruir a origem do conflito.`,
    });
    candidates.push({
      model: 'non_linear',
      score: 84,
      reason: `Material distribuído em ${episodesCount} episódios: montagem não linear conecta momentos equivalentes de tensão, memória e impacto sem ficar presa à cronologia.`,
    });
  }
  if (input.musicUnderstanding.archetype === 'hybrid') {
    candidates.push({
      model: 'hybrid',
      score: 87,
      reason: 'Música híbrida detectada: combina introdução/ponte emocional com explosão coreográfica no clímax.',
    });
  }
  if (input.style === 'emocional' || input.musicUnderstanding.archetype === 'emotional') {
    candidates.push({
      model: hasMemories ? 'flashback' : 'emotional',
      score: 90,
      reason: hasMemories
        ? 'Tom emocional com cenas de lembrança/passado: alternar presente e flashbacks aprofunda o peso dramático.'
        : 'Música e estilo emocionais: priorizar expressões, vínculo e respiração cinematográfica.',
    });
  }
  if (hasRevenge) {
    candidates.push({
      model: 'revenge',
      score: 85,
      reason: 'Temática de ferida/vingança detectada na música e nas cenas: estruturar perda inicial → perseguição → confronto catártico.',
    });
  }
  if (hasOvercoming) {
    candidates.push({
      model: 'overcoming',
      score: 86,
      reason: 'Evidências de resistência/superação nas cenas e na música: construir queda → preparação → virada no clímax.',
    });
  }
  if (hasTransform && input.dropTimelineS !== null) {
    candidates.push({
      model: 'transformation',
      score: 83,
      reason: 'Cenas de transformação e drop musical claro: concentrar contenção na subida e liberar o despertar exatamente no drop.',
    });
  }
  if (majorChars.length >= 2 && eligible.some((s) => hasTag(s, 'combate'))) {
    candidates.push({
      model: 'rivalry',
      score: 81,
      reason: `Elenco recorrente (${majorChars.slice(0, 2).map(([c]) => c).join(' × ')}) em cenas de confronto: alternar perspectivas de rivalidade até o embate.`,
    });
  }
  if (hasLateEpisodeHook && input.dropTimelineS !== null) {
    candidates.push({
      model: 'foreshadowing',
      score: 79,
      reason: 'Drop bem definido e cenas de clímax futuro disponíveis: plantar antecipação visual antes da virada principal.',
    });
  }
  candidates.push({
    model: 'combat_sequence',
    score: 76,
    reason: 'Sequência de combate dirigida: encadear preparação, ataques, defesas e impactos sincronizados ao pulso musical.',
  });

  candidates.sort((a, b) => b.score - a.score);
  const picked = candidates[variant % candidates.length] ?? candidates[0]!;
  return {
    model: picked.model,
    reason: picked.reason,
    confidence: round3(clamp01(picked.score / 100)),
  };
}

function selectOpeningAnchor(
  scenes: SceneAnalysis[],
  model: NarrativeModelId,
  climaxSceneId: string | null,
  overrides?: CreativeDirectionOverrides,
): KeySceneAnchor | null {
  const rejected = new Set(overrides?.rejectedSceneIds ?? []);
  const pool = scenes.filter((s) => !s.excluded && !rejected.has(s.sceneId) && s.sceneId !== climaxSceneId && s.deadFrameScore < 0.6);
  if (!pool.length) return null;

  if (overrides?.openingSceneId) {
    const manual = scenes.find((s) => s.sceneId === overrides.openingSceneId);
    if (manual) {
      return {
        sceneId: manual.sceneId,
        episodeName: manual.sourceEpisode,
        episodeIndex: manual.episodeIndex,
        startTime: manual.startTime,
        endTime: manual.endTime,
        isLateEpisodeHook: manual.context.episodeProgress >= 0.65 || manual.episodeIndex > 0,
        reason: 'Cena de abertura definida manualmente pelo editor no Creative Direction Preview.',
        alternatives: pool.filter((p) => p.sceneId !== manual.sceneId).slice(0, 4).map((p) => p.sceneId),
        confidence: 0.98,
      };
    }
  }

  const scoreOpening = (s: SceneAnalysis): { score: number; reason: string } => {
    let sc = s.confidence * 25 + (s.favorite ? 15 : 0) - s.textClutterScore * 30;
    if (s.durationS >= 1.5) sc += 14;
    else if (s.durationS < 0.85) sc -= 18;
    const isLate = s.context.episodeProgress >= 0.65 || s.episodeIndex > 0;
    if (model === 'climax_opening' || model === 'non_linear' || model === 'foreshadowing') {
      if (isLate) sc += 32;
      if (hasTag(s, 'revelação') || hasTag(s, 'confronto_emocional') || hasTag(s, 'preparação_combate') || hasTag(s, 'impacto')) sc += 26;
      if (s.intensity >= 0.55 && s.intensity <= 0.92) sc += 12;
      return {
        score: sc,
        reason: isLate
          ? `Cold open não linear extraído de ${s.sourceEpisode} (${Math.round(s.context.episodeProgress * 100)}% do episódio): abre com tensão/impacto tardio para fisgar a atenção antes de voltar à origem.`
          : `Gancho dramático de abertura em ${s.sourceEpisode} (${s.context.visualIntent}).`,
      };
    }
    if (model === 'emotional' || model === 'flashback') {
      if (hasTag(s, 'memória') || hasTag(s, 'tristeza') || hasTag(s, 'despedida') || s.actionPhase === 'contemplation') sc += 30;
      if (s.movement.bodyPosition === 'wide' || s.movement.bodyPosition === 'close') sc += 12;
      return {
        score: sc,
        reason: `Abertura atmosférica/emocional em ${s.sourceEpisode}: estabelece melancolia e espaço de leitura antes da entrada principal.`,
      };
    }
    if (model === 'overcoming' || model === 'revenge') {
      if (s.characterState === 'debilitated' || hasTag(s, 'derrota') || hasTag(s, 'perda' as SceneSemanticTag) || hasTag(s, 'desespero') || hasTag(s, 'preparação_combate')) sc += 30;
      return {
        score: sc,
        reason: `Abertura estabelecendo o peso do obstáculo/ferida inicial (${s.characterState !== 'unknown' ? s.characterState : s.context.visualIntent}) para valorizar a virada futura.`,
      };
    }
    if (hasTag(s, 'preparação_combate') || hasTag(s, 'suspense') || s.cameraMotion.orientation === 'wide_establishing') sc += 28;
    return {
      score: sc,
      reason: `Abertura de atmosfera e preparação de confronto em ${s.sourceEpisode}.`,
    };
  };

  const ranked = pool
    .map((s) => ({ s, ...scoreOpening(s) }))
    .sort((a, b) => b.score - a.score || a.s.sceneId.localeCompare(b.s.sceneId));

  const pickIdx = (overrides?.proposalVariant ?? 0) % Math.min(3, ranked.length);
  const top = ranked[pickIdx] ?? ranked[0]!;
  return {
    sceneId: top.s.sceneId,
    episodeName: top.s.sourceEpisode,
    episodeIndex: top.s.episodeIndex,
    startTime: top.s.startTime,
    endTime: top.s.endTime,
    isLateEpisodeHook: top.s.context.episodeProgress >= 0.65 || top.s.episodeIndex > 0,
    reason: top.reason,
    alternatives: ranked.filter((r) => r.s.sceneId !== top.s.sceneId).slice(0, 4).map((r) => r.s.sceneId),
    confidence: round3(clamp01(top.s.confidence * 0.8 + 0.15)),
  };
}

function selectClimaxAnchor(
  scenes: SceneAnalysis[],
  dropTimelineS: number | null,
  durationS: number,
  overrides?: CreativeDirectionOverrides,
): KeySceneAnchor | null {
  const rejected = new Set(overrides?.rejectedSceneIds ?? []);
  const pool = scenes.filter((s) => !s.excluded && !rejected.has(s.sceneId) && s.deadFrameScore < 0.55);
  if (!pool.length) return null;

  if (overrides?.climaxSceneId) {
    const manual = scenes.find((s) => s.sceneId === overrides.climaxSceneId);
    if (manual) {
      return {
        sceneId: manual.sceneId,
        episodeName: manual.sourceEpisode,
        episodeIndex: manual.episodeIndex,
        startTime: manual.startTime,
        endTime: manual.endTime,
        isLateEpisodeHook: manual.context.episodeProgress >= 0.7,
        reason: 'Cena de clímax definida manualmente pelo editor no Creative Direction Preview.',
        alternatives: pool.filter((p) => p.sceneId !== manual.sceneId).slice(0, 4).map((p) => p.sceneId),
        confidence: 0.98,
      };
    }
  }

  const ranked = pool
    .map((s) => {
      let sc = s.intensity * 45 + s.confidence * 20 + (s.favorite ? 12 : 0);
      if (hasTag(s, 'impacto')) sc += 22;
      if (hasTag(s, 'transformação') || hasTag(s, 'superação') || hasTag(s, 'contra_ataque')) sc += 18;
      if (s.context.episodeProgress >= 0.65) sc += 10;
      return { s, sc };
    })
    .sort((a, b) => b.sc - a.sc || a.s.sceneId.localeCompare(b.s.sceneId));

  const top = ranked[0]!;
  const climaxAt = dropTimelineS ?? round3(durationS * 0.68);
  return {
    sceneId: top.s.sceneId,
    episodeName: top.s.sourceEpisode,
    episodeIndex: top.s.episodeIndex,
    startTime: top.s.startTime,
    endTime: top.s.endTime,
    isLateEpisodeHook: top.s.context.episodeProgress >= 0.7,
    reason: `Ápice reservado para ${climaxAt.toFixed(1)}s na timeline (${dropTimelineS !== null ? 'entrada do drop' : 'pico energético'}): ${top.s.sourceEpisode} em ${top.s.startTime.toFixed(1)}s (${top.s.actions.slice(0, 3).join(', ')}).`,
    alternatives: ranked.slice(1, 5).map((r) => r.s.sceneId),
    confidence: round3(clamp01(top.s.confidence * 0.85 + 0.12)),
  };
}

function selectEndingPlan(
  scenes: SceneAnalysis[],
  musicUnderstanding: MusicUnderstandingResult,
  musicRange: [number, number],
  usedIds: Set<string>,
  overrides?: CreativeDirectionOverrides,
): EndingPlan {
  const rejected = new Set(overrides?.rejectedSceneIds ?? []);
  const pool = scenes.filter((s) => !s.excluded && !rejected.has(s.sceneId) && !usedIds.has(s.sceneId) && s.deadFrameScore < 0.6);
  const candidatesPool = pool.length ? pool : scenes.filter((s) => !s.excluded);

  if (overrides?.endingSceneId) {
    const manual = scenes.find((s) => s.sceneId === overrides.endingSceneId);
    if (manual) {
      return {
        kind: 'musical_resolution',
        sceneId: manual.sceneId,
        episodeName: manual.sourceEpisode,
        reason: 'Encerramento definido manualmente pelo editor.',
        alternatives: candidatesPool.filter((c) => c.sceneId !== manual.sceneId).slice(0, 3).map((c) => c.sceneId),
      };
    }
  }

  const endSection = musicUnderstanding.sectionProfiles.find(
    (sec) => sec.endTime >= musicRange[1] - 0.5 && sec.startTime < musicRange[1],
  ) ?? musicUnderstanding.sectionProfiles.at(-1);
  const highEnergyEnding = (endSection?.energy ?? 0.4) >= 0.72;

  const farewellScene = candidatesPool.find((s) => hasTag(s, 'despedida', 0.6));
  const victoryScene = candidatesPool.find((s) => hasTag(s, 'vitória', 0.6) || s.characterState === 'victorious');
  const defeatScene = candidatesPool.find((s) => hasTag(s, 'derrota', 0.7) && musicUnderstanding.archetype === 'emotional');
  const gazeScene = candidatesPool.find((s) =>
    (s.movement.bodyPosition === 'close' || s.movement.bodyPosition === 'extreme-close')
    && s.movement.intensity <= 0.28,
  );
  const dryImpactScene = candidatesPool.find((s) => hasTag(s, 'impacto', 0.78));

  if (highEnergyEnding && dryImpactScene) {
    return {
      kind: 'dry_impact_cut',
      sceneId: dryImpactScene.sceneId,
      episodeName: dryImpactScene.sourceEpisode,
      reason: 'Música termina em alta energia: corte seco sincronizado em imagem de impacto final para deixar eco dramático.',
      alternatives: candidatesPool.filter((c) => c.sceneId !== dryImpactScene.sceneId).slice(0, 3).map((c) => c.sceneId),
    };
  }
  if (farewellScene && (musicUnderstanding.archetype === 'emotional' || musicUnderstanding.archetype === 'narrative')) {
    return {
      kind: 'farewell',
      sceneId: farewellScene.sceneId,
      episodeName: farewellScene.sourceEpisode,
      reason: 'Encerramento intencional por despedida/afastamento acompanhando a queda suave da música.',
      alternatives: candidatesPool.filter((c) => c.sceneId !== farewellScene.sceneId).slice(0, 3).map((c) => c.sceneId),
    };
  }
  if (victoryScene) {
    return {
      kind: 'victory',
      sceneId: victoryScene.sceneId,
      episodeName: victoryScene.sourceEpisode,
      reason: 'Resolução por conquista/estabilização após o clímax da jornada.',
      alternatives: candidatesPool.filter((c) => c.sceneId !== victoryScene.sceneId).slice(0, 3).map((c) => c.sceneId),
    };
  }
  if (defeatScene) {
    return {
      kind: 'defeat',
      sceneId: defeatScene.sceneId,
      episodeName: defeatScene.sourceEpisode,
      reason: 'Desfecho trágico intencional coerente com a melancolia predominante da faixa.',
      alternatives: candidatesPool.filter((c) => c.sceneId !== defeatScene.sceneId).slice(0, 3).map((c) => c.sceneId),
    };
  }
  if (gazeScene) {
    return {
      kind: 'character_gaze',
      sceneId: gazeScene.sceneId,
      episodeName: gazeScene.sourceEpisode,
      reason: 'Encerramento em close-up/olhar do personagem, dando tempo para a última nota respirar.',
      alternatives: candidatesPool.filter((c) => c.sceneId !== gazeScene.sceneId).slice(0, 3).map((c) => c.sceneId),
    };
  }

  const calmFallback = [...candidatesPool].sort((a, b) => a.movement.intensity - b.movement.intensity)[0] ?? null;
  return {
    kind: endSection && endSection.energy <= 0.25 ? 'dramatic_silence' : 'musical_resolution',
    sceneId: calmFallback?.sceneId ?? null,
    episodeName: calmFallback?.sourceEpisode ?? null,
    reason: 'Resolução musical progressiva sustentando plano legível sem corte abrupto acidental.',
    alternatives: candidatesPool.slice(1, 4).map((c) => c.sceneId),
  };
}

/**
 * Gera o `CreativeDirectionPlan` completo (não linear ou linear conforme o modelo),
 * incluindo abertura, capítulos (`CreativeNarrativeBeat[]`), diálogos preservados,
 * zonas de respiração cinematográfica, clímax e encerramento intencional.
 */
export function buildCreativeDirectionPlan(input: BuildCreativeDirectionInput): CreativeDirectionPlan {
  const [rangeStart, rangeEnd] = input.musicRange;
  const durationS = Math.max(1, rangeEnd - rangeStart);
  const modelChoice = selectBestNarrativeModel(input);
  const model = modelChoice.model;

  const climaxSelection = selectClimaxAnchor(input.scenes, input.dropTimelineS, durationS, input.overrides);
  const openingSelection = selectOpeningAnchor(input.scenes, model, climaxSelection?.sceneId ?? null, input.overrides);
  const usedAnchors = new Set<string>(
    [openingSelection?.sceneId, climaxSelection?.sceneId].filter((id): id is string => Boolean(id)),
  );
  const endingStrategy = selectEndingPlan(input.scenes, input.musicUnderstanding, input.musicRange, usedAnchors, input.overrides);

  // Recorta os perfis de seção musical para a janela da timeline (0..durationS)
  const rawProfiles = input.musicUnderstanding.sectionProfiles
    .filter((sec) => sec.endTime > rangeStart && sec.startTime < rangeEnd)
    .map((sec) => ({
      ...sec,
      timelineStart: round3(Math.max(0, sec.startTime - rangeStart)),
      timelineEnd: round3(Math.min(durationS, sec.endTime - rangeStart)),
    }))
    .filter((sec) => sec.timelineEnd - sec.timelineStart >= 0.4);

  // Quando a música tem uma única seção longa e o modelo é não linear/superação, divide em atos dramáticos claros
  const effectiveSegments = rawProfiles.length >= 3
    ? rawProfiles
    : (() => {
        const dropAt = input.dropTimelineS !== null && input.dropTimelineS > 2 && input.dropTimelineS < durationS - 2
          ? input.dropTimelineS
          : round3(durationS * 0.52);
        const hookEnd = round3(Math.min(dropAt * 0.38, Math.max(2.2, durationS * 0.18)));
        const buildStart = hookEnd;
        const climaxEnd = round3(Math.min(durationS - Math.max(1.8, durationS * 0.14), Math.max(dropAt + 2.5, durationS * 0.82)));
        const baseStrategy = rawProfiles[0]?.strategy ?? 'story_lyric';
        return [
          {
            index: 0,
            startTime: rangeStart,
            endTime: rangeStart + hookEnd,
            timelineStart: 0,
            timelineEnd: hookEnd,
            label: 'intro' as const,
            archetype: 'emotional' as const,
            strategy: model === 'emotional' ? 'cinematic_breathing' as const : baseStrategy,
            vocalPresence: rawProfiles[0]?.vocalPresence ?? 0.5,
            energy: 0.35,
            dominantEmotion: rawProfiles[0]?.dominantEmotion ?? 'tensão',
            allowsLongBreathing: model === 'emotional' || model === 'flashback',
            reason: 'Ato I — Gancho e estabelecimento da tese narrativa.',
          },
          {
            index: 1,
            startTime: rangeStart + buildStart,
            endTime: rangeStart + dropAt,
            timelineStart: buildStart,
            timelineEnd: dropAt,
            label: 'pré-refrão' as const,
            archetype: 'narrative' as const,
            strategy: baseStrategy,
            vocalPresence: rawProfiles[0]?.vocalPresence ?? 0.6,
            energy: 0.56,
            dominantEmotion: 'determinação' as const,
            allowsLongBreathing: false,
            reason: 'Ato II — Desenvolvimento, memória/conflito e construção até a virada.',
          },
          {
            index: 2,
            startTime: rangeStart + dropAt,
            endTime: rangeStart + climaxEnd,
            timelineStart: dropAt,
            timelineEnd: climaxEnd,
            label: 'drop' as const,
            archetype: 'combat' as const,
            strategy: 'impact_choreography' as const,
            vocalPresence: rawProfiles[0]?.vocalPresence ?? 0.7,
            energy: 0.88,
            dominantEmotion: 'catarse' as const,
            allowsLongBreathing: false,
            reason: 'Ato III — Clímax preparado e explosão dramática.',
          },
          {
            index: 3,
            startTime: rangeStart + climaxEnd,
            endTime: rangeEnd,
            timelineStart: climaxEnd,
            timelineEnd: durationS,
            label: 'final' as const,
            archetype: 'emotional' as const,
            strategy: 'cinematic_breathing' as const,
            vocalPresence: 0.3,
            energy: 0.32,
            dominantEmotion: 'solenidade' as const,
            allowsLongBreathing: true,
            reason: 'Ato IV — Consequência e encerramento intencional.',
          },
        ];
      })();

  const allowCrossEpisodeGlobal = input.organizationMode !== 'chronological';

  const narrativeBeats: CreativeNarrativeBeat[] = effectiveSegments.map((seg, idx, all) => {
    const isFirst = idx === 0;
    const isLast = idx === all.length - 1 && all.length >= 2;
    const containsDrop = input.dropTimelineS !== null
      && input.dropTimelineS >= seg.timelineStart - 0.05
      && input.dropTimelineS < seg.timelineEnd - 0.05;
    const isClimax = containsDrop || (!isFirst && !isLast && seg.energy >= 0.75);

    let role: NarrativeRole = 'development';
    let nonLinearFunction: NonLinearBeatFunction = 'rising_clash';
    let targetTags: SceneSemanticTag[] = ['combate', 'determinação'];
    let preferredEpisodeScope: CreativeNarrativeBeat['preferredEpisodeScope'] = allowCrossEpisodeGlobal ? 'cross_episode' : 'any';
    let allowIntentionalContrast = false;
    let suggestedSceneId: string | null = null;

    if (isFirst) {
      role = 'opening';
      suggestedSceneId = openingSelection?.sceneId ?? null;
      if (model === 'climax_opening') {
        nonLinearFunction = 'cold_open_climax';
        targetTags = ['revelação', 'confronto_emocional', 'impacto', 'preparação_combate'];
        preferredEpisodeScope = 'late_hook';
        allowIntentionalContrast = true;
      } else if (model === 'flashback' || model === 'revenge') {
        nonLinearFunction = 'origin_flashback';
        targetTags = ['memória', 'tristeza', 'desespero'];
        preferredEpisodeScope = 'early_origin';
      } else {
        nonLinearFunction = 'conflict_setup';
        targetTags = model === 'emotional'
          ? ['memória', 'tristeza', 'diálogo', 'descoberta']
          : ['preparação_combate', 'suspense', 'determinação'];
      }
    } else if (isClimax) {
      role = 'climax';
      nonLinearFunction = 'apex_climax';
      suggestedSceneId = climaxSelection?.sceneId ?? null;
      targetTags = model === 'emotional'
        ? ['confronto_emocional', 'revelação', 'superação', 'sacrifício']
        : model === 'transformation'
          ? ['transformação', 'impacto', 'superação']
          : ['impacto', 'ataque', 'contra_ataque', 'superação', 'combate'];
      preferredEpisodeScope = 'climax_payoff';
    } else if (isLast) {
      role = 'ending';
      nonLinearFunction = 'intentional_ending';
      suggestedSceneId = endingStrategy.sceneId;
      targetTags = endingStrategy.kind === 'dry_impact_cut'
        ? ['impacto', 'vitória']
        : ['despedida', 'vitória', 'reação', 'memória'];
    } else if (seg.allowsLongBreathing || seg.energy <= 0.38) {
      role = 'release';
      nonLinearFunction = model === 'flashback' || model === 'revenge' ? 'memory_echo' : 'breathing_hold';
      targetTags = ['memória', 'reação', 'tristeza', 'diálogo', 'despedida'];
      allowIntentionalContrast = true;
    } else if (idx === 1 && model === 'climax_opening') {
      role = 'development';
      nonLinearFunction = 'origin_flashback';
      targetTags = ['memória', 'preparação_combate', 'diálogo', 'tristeza'];
      preferredEpisodeScope = 'early_origin';
    } else if (model === 'foreshadowing' && idx === 1) {
      role = 'build';
      nonLinearFunction = 'foreshadowing_hint';
      targetTags = ['suspense', 'preparação_combate', 'revelação'];
      allowIntentionalContrast = true;
    } else if (all[idx + 1] && (input.dropTimelineS !== null && Math.abs(all[idx + 1]!.timelineStart - input.dropTimelineS) < 0.25)) {
      role = 'build';
      nonLinearFunction = 'turning_point';
      targetTags = ['preparação_combate', 'superação', 'determinação', 'suspense'];
      allowIntentionalContrast = model === 'overcoming' || model === 'revenge';
    } else {
      role = seg.energy >= 0.52 ? 'build' : 'development';
      nonLinearFunction = 'rising_clash';
      targetTags = ['combate', 'ataque', 'defesa', 'esquiva', 'determinação'];
    }

    const lockedScene = input.overrides?.lockedScenes?.[`beat:${idx}`] ?? null;
    if (lockedScene) suggestedSceneId = lockedScene;

    return {
      beatId: `nbeat-${idx}`,
      role,
      startS: seg.timelineStart,
      endS: seg.timelineEnd,
      startTime: seg.timelineStart,
      endTime: seg.timelineEnd,
      section: seg.label,
      nonLinearFunction,
      targetEmotion: seg.dominantEmotion,
      targetTags,
      preferredEpisodeScope,
      allowCrossEpisode: allowCrossEpisodeGlobal,
      allowIntentionalContrast,
      preferBreathingHold: seg.allowsLongBreathing || nonLinearFunction === 'breathing_hold',
      musicalStrategy: seg.strategy,
      suggestedSceneId,
      reason: `${seg.reason} Função narrativa: ${nonLinearFunction} (${targetTags.slice(0, 3).join(', ')}).`,
      confidence: round3(clamp01(modelChoice.confidence * 0.7 + 0.25)),
    };
  });

  // Zonas explícitas de respiração cinematográfica (pausas musicais + pontes emocionais)
  const breathingZones: CreativeDirectionPlan['breathingZones'] = [];
  for (const beat of narrativeBeats) {
    if (beat.preferBreathingHold && beat.endTime - beat.startTime >= 1.8) {
      breathingZones.push({
        startTime: beat.startTime,
        endTime: beat.endTime,
        reason: `Zona de respiração em "${beat.section}" (${beat.targetEmotion}): sustentar planos longos sem picotar na batida.`,
      });
    }
  }
  for (const ev of input.musicUnderstanding.events) {
    if (ev.eventType !== 'pause') continue;
    if (ev.endTime <= rangeStart || ev.startTime >= rangeEnd) continue;
    const pStart = round3(Math.max(0, ev.startTime - rangeStart));
    const pEnd = round3(Math.min(durationS, ev.endTime - rangeStart));
    if (pEnd - pStart >= 0.5 && !breathingZones.some((z) => pStart < z.endTime && pEnd > z.startTime)) {
      breathingZones.push({
        startTime: pStart,
        endTime: pEnd,
        reason: 'Pausa musical detectada: sustentar silêncio visual ou fala dramática sem cortes mecânicos.',
      });
    }
  }

  // Diálogos importantes a preservar sem cortar no meio da ideia
  const manualDialogueIds = new Set(input.overrides?.preservedDialogueSceneIds ?? []);
  const dialogueScenes = input.scenes
    .filter((s) => !s.excluded && s.context.hasDialogue && (s.context.dialogueImpact >= 0.45 || manualDialogueIds.has(s.sceneId)))
    .sort((a, b) => (manualDialogueIds.has(b.sceneId) ? 1 : 0) - (manualDialogueIds.has(a.sceneId) ? 1 : 0) || b.context.dialogueImpact - a.context.dialogueImpact)
    .slice(0, input.useSpeech === false ? 0 : 4);

  const preservedDialogues: PreservedDialogueMoment[] = dialogueScenes.map((s, idx) => ({
    sceneId: s.sceneId,
    episodeName: s.sourceEpisode,
    startTime: s.context.dialogueStartS ?? s.startTime,
    endTime: s.context.dialogueEndS ?? s.endTime,
    text: s.context.dialogueText ?? '(fala dramática detectada)',
    importance: manualDialogueIds.has(s.sceneId) || idx === 0 || s.context.dialogueImpact >= 0.7 ? 'essential' : 'supporting',
    reason: manualDialogueIds.has(s.sceneId)
      ? 'Fala travada pelo editor para preservação integral.'
      : `Fala dramática com alto impacto (${s.context.dialogueImpact.toFixed(2)}) preservada sem corte abrupto no meio da ideia.`,
  }));

  // Momentos musicais-chave traduzidos para a timeline
  const keyMusicalMoments: CreativeDirectionPlan['keyMusicalMoments'] = input.musicUnderstanding.events
    .filter((ev: CreativeMusicEvent) =>
      ['drop', 'build', 'pause', 'climax', 'vocal_phrase'].includes(ev.eventType)
      && ev.endTime > rangeStart
      && ev.startTime < rangeEnd,
    )
    .slice(0, 12)
    .map((ev) => ({
      timelineS: round3(Math.max(0, ev.startTime - rangeStart)),
      type: ev.eventType,
      description: ev.lyrics
        ? `Frase "${ev.lyrics.slice(0, 48)}" (${ev.semanticMeaning?.primaryTheme ?? ev.emotion})`
        : `Evento musical "${ev.eventType}" (${ev.emotion}, intensidade ${ev.intensity.toFixed(2)})`,
    }));

  const primaryThemes = [...new Set(
    input.musicUnderstanding.lyricInterpretations
      .map((l) => l.meaning.primaryTheme)
      .filter((t): t is NonNullable<typeof t> => Boolean(t)),
  )].slice(0, 3);
  const mainChars = [...new Set(input.scenes.flatMap((s) => s.characterNames))].slice(0, 3);
  const predominantEmotion = narrativeBeats.find((b) => b.role === 'climax')?.targetEmotion
    ?? input.musicUnderstanding.sectionProfiles[0]?.dominantEmotion
    ?? 'determinação';

  const centralIdea = [
    `${NARRATIVE_MODEL_LABELS[model]}`,
    mainChars.length ? `centrado em ${mainChars.join(', ')}` : 'guiado pela tensão visual dos episódios',
    primaryThemes.length ? `explorando ${primaryThemes.join(', ')}` : `conduzido pela dinâmica ${input.musicUnderstanding.archetype} da música`,
    `até desfecho por ${endingStrategy.kind.replace(/_/g, ' ')}`,
  ].join(' — ');

  return {
    centralIdea,
    predominantEmotion,
    narrativeModel: model,
    narrativeModelLabel: NARRATIVE_MODEL_LABELS[model],
    narrativeModelReason: modelChoice.reason,
    musicRange: input.musicRange,
    dropTimelineS: input.dropTimelineS,
    openingSelection,
    climaxSelection,
    endingStrategy,
    narrativeBeats,
    preservedDialogues,
    breathingZones,
    keyMusicalMoments,
    confidence: round3(clamp01(modelChoice.confidence * 0.6 + input.musicUnderstanding.archetypeConfidence * 0.4)),
  };
}
