/**
 * SEMANTIC ALIGNMENT ENGINE (Camada 3 — AMV Creative Intelligence)
 *
 * Relaciona eventos musicais e frases da letra às cenas analisadas (`SceneAnalysis`)
 * por significado semântico, emocional, contextual, metafórico e contraste intencional,
 * produzindo `SemanticAlignment` normalizado de 0 a 100 com pesos configuráveis
 * e planejamento de sincronização sub-frasal.
 */
import {
  normLabel,
  type CreativeMusicEvent,
  type LyricSemanticTheme,
  type MusicEmotionLabel,
  type SceneAnalysis,
  type SceneSemanticTag,
} from '@amv/analysis';

export type SemanticAlignmentType =
  | 'literal'
  | 'metaphorical'
  | 'emotional'
  | 'contextual'
  | 'intentional_contrast';

export type PhraseSyncMode =
  | 'prep_before_lyric'
  | 'entry_during_action'
  | 'impact_on_keyword'
  | 'reaction_after_phrase'
  | 'hold_across_phrase'
  | 'rhythm_only';

export interface SemanticAlignmentWeights {
  /** Padrão: 0.25 (25%) */
  semantic: number;
  /** Padrão: 0.20 (20%) */
  emotional: number;
  /** Padrão: 0.20 (20%) */
  characterCoherence: number;
  /** Padrão: 0.15 (15%) */
  contextual: number;
  /** Padrão: 0.10 (10%) */
  generalNarrative: number;
  /** Padrão: 0.10 (10%) */
  temporalFit: number;
}

export const DEFAULT_SEMANTIC_WEIGHTS: SemanticAlignmentWeights = {
  semantic: 0.25,
  emotional: 0.20,
  characterCoherence: 0.20,
  contextual: 0.15,
  generalNarrative: 0.10,
  temporalFit: 0.10,
};

export interface SemanticAlignmentComponents {
  semantic: number;
  emotional: number;
  characterCoherence: number;
  contextual: number;
  generalNarrative: number;
  temporalFit: number;
}

export interface PhraseSyncPlan {
  mode: PhraseSyncMode;
  recommendedSourceInS: number;
  recommendedLeadInS: number;
  targetKeywordTimeS: number | null;
  rationale: string;
}

export interface SemanticAlignment {
  musicEventId: string;
  sceneId: string;
  alignmentType: SemanticAlignmentType;
  phraseSync: PhraseSyncPlan;
  /** Nota consolidada normalizada 0..100. */
  score: number;
  components: SemanticAlignmentComponents;
  explanation: string;
  confidence: number;
}

export interface SemanticAlignmentContext {
  weights?: Partial<SemanticAlignmentWeights>;
  focusCharacters?: string[];
  recentCharacters?: string[];
  narrativeTargetTags?: SceneSemanticTag[];
  narrativeRole?: string;
  /** Permite valorizar contraste dramático intencional sem penalizá-lo como erro. */
  allowIntentionalContrast?: boolean;
  /** Evento de palavra-chave associado dentro da frase, se existir. */
  keywordEvent?: CreativeMusicEvent | null;
}

const THEME_TO_SCENE_TAGS: Record<LyricSemanticTheme, SceneSemanticTag[]> = {
  resistência: ['superação', 'determinação', 'defesa', 'preparação_combate', 'combate'],
  superação: ['superação', 'determinação', 'contra_ataque', 'transformação', 'vitória'],
  determinação: ['determinação', 'preparação_combate', 'superação', 'confronto_emocional'],
  combate: ['combate', 'ataque', 'impacto', 'contra_ataque', 'defesa', 'esquiva'],
  confronto_divino: ['combate', 'impacto', 'transformação', 'revelação', 'preparação_combate'],
  vingança: ['ataque', 'combate', 'confronto_emocional', 'memória', 'determinação'],
  fúria: ['ataque', 'impacto', 'combate', 'transformação', 'confronto_emocional'],
  transformação: ['transformação', 'superação', 'impacto', 'revelação'],
  vitória: ['vitória', 'superação', 'impacto', 'felicidade'],
  derrota: ['derrota', 'desespero', 'tristeza', 'reação'],
  perda: ['tristeza', 'despedida', 'memória', 'desespero', 'reação'],
  solidão: ['tristeza', 'memória', 'despedida', 'suspense'],
  despedida: ['despedida', 'tristeza', 'memória', 'reação'],
  memória: ['memória', 'tristeza', 'felicidade', 'revelação'],
  sacrifício: ['sacrifício', 'superação', 'determinação', 'despedida'],
  esperança: ['superação', 'felicidade', 'descoberta', 'determinação', 'vitória'],
  desespero: ['desespero', 'derrota', 'suspense', 'tristeza', 'confronto_emocional'],
  afeto: ['felicidade', 'memória', 'diálogo', 'reação'],
};

const LITERAL_VISUAL_TOKENS: Array<{ lyricTerms: string[]; check: (scene: SceneAnalysis, descNorm: string) => { ok: boolean; label: string } }> = [
  {
    lyricTerms: ['sword', 'blade', 'espada', 'lamina', 'katana', 'slash', 'cort'],
    check: (scene, desc) => ({
      ok: /\b(espada|lamina|katana|sword|blade|slash|corte)\b/.test(desc) || (scene.actions.includes('ataque') && scene.intensity >= 0.68),
      label: 'golpe/arma cortante presente na ação visual',
    }),
  },
  {
    lyricTerms: ['fire', 'flame', 'burn', 'fogo', 'chama', 'queim', 'blaze', 'honoo'],
    check: (scene, desc) => {
      const warmHex = scene.dominantColors.some((hex) => {
        if (!/^#[0-9a-f]{6}$/i.test(hex)) return false;
        const r = Number.parseInt(hex.slice(1, 3), 16);
        const b = Number.parseInt(hex.slice(5, 7), 16);
        return r >= 165 && r > b * 1.45;
      });
      return {
        ok: /\b(fogo|chama|explos|fire|flame|lava|brasa)\b/.test(desc) || (warmHex && scene.brightness >= 0.4),
        label: 'chamas/paleta ígnea visível na cena',
      };
    },
  },
  {
    lyricTerms: ['tear', 'cry', 'lagrima', 'chora', 'namida'],
    check: (scene, desc) => ({
      ok: /\b(lagrima|chor|tear|cry)\b/.test(desc) || (scene.actions.includes('tristeza') && scene.movement.bodyPosition === 'close'),
      label: 'lágrimas ou close de tristeza explícito',
    }),
  },
  {
    lyricTerms: ['punch', 'hit', 'strike', 'soco', 'golpe', 'impact'],
    check: (scene, desc) => ({
      ok: /\b(soco|golpe|impacto|punch|strike|colisao)\b/.test(desc) || scene.actionPhase === 'impact',
      label: 'impacto físico direto no quadro',
    }),
  },
  {
    lyricTerms: ['light', 'sun', 'shine', 'dawn', 'luz', 'sol', 'brilh', 'aurora', 'hikari'],
    check: (scene, desc) => ({
      ok: /\b(luz|sol|aurora|clarao|brilho|light|sun)\b/.test(desc) || scene.brightness >= 0.68,
      label: 'alta luminosidade/clarão visual alinhado à letra',
    }),
  },
  {
    lyricTerms: ['dark', 'night', 'shadow', 'abyss', 'escur', 'noite', 'sombra', 'abismo', 'yami'],
    check: (scene, desc) => ({
      ok: /\b(escur|sombra|noite|abismo|dark|shadow)\b/.test(desc)
        || (scene.brightness <= 0.26 && scene.actionPhase !== 'environment' && scene.actionPhase !== 'contemplation'),
      label: 'atmosfera noturna/sombria visível na cena',
    }),
  },
  {
    lyricTerms: ['scream', 'roar', 'shout', 'grit'],
    check: (scene, desc) => ({
      ok: scene.context.dialogueKind === 'grito' || /\b(grit|scream|roar)\b/.test(desc),
      label: 'grito real do personagem detectado na cena',
    }),
  },
];

const EMOTION_COMPATIBILITY: Record<MusicEmotionLabel, string[]> = {
  determinação: ['determinação', 'raiva', 'surpresa'],
  fúria: ['raiva', 'determinação'],
  euforia: ['alegria', 'determinação', 'surpresa'],
  melancolia: ['tristeza', 'calma', 'medo'],
  tensão: ['medo', 'determinação', 'surpresa', 'raiva'],
  esperança: ['determinação', 'alegria', 'calma'],
  solenidade: ['calma', 'determinação', 'tristeza'],
  calma: ['calma', 'tristeza', 'alegria'],
  catarse: ['determinação', 'raiva', 'tristeza', 'surpresa'],
  neutro: ['neutro', 'calma', 'determinação'],
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWeights(partial?: Partial<SemanticAlignmentWeights>): SemanticAlignmentWeights {
  const merged: SemanticAlignmentWeights = {
    semantic: Math.max(0, partial?.semantic ?? DEFAULT_SEMANTIC_WEIGHTS.semantic),
    emotional: Math.max(0, partial?.emotional ?? DEFAULT_SEMANTIC_WEIGHTS.emotional),
    characterCoherence: Math.max(0, partial?.characterCoherence ?? DEFAULT_SEMANTIC_WEIGHTS.characterCoherence),
    contextual: Math.max(0, partial?.contextual ?? DEFAULT_SEMANTIC_WEIGHTS.contextual),
    generalNarrative: Math.max(0, partial?.generalNarrative ?? DEFAULT_SEMANTIC_WEIGHTS.generalNarrative),
    temporalFit: Math.max(0, partial?.temporalFit ?? DEFAULT_SEMANTIC_WEIGHTS.temporalFit),
  };
  const sum = merged.semantic + merged.emotional + merged.characterCoherence
    + merged.contextual + merged.generalNarrative + merged.temporalFit;
  if (sum <= 0) return { ...DEFAULT_SEMANTIC_WEIGHTS };
  return {
    semantic: merged.semantic / sum,
    emotional: merged.emotional / sum,
    characterCoherence: merged.characterCoherence / sum,
    contextual: merged.contextual / sum,
    generalNarrative: merged.generalNarrative / sum,
    temporalFit: merged.temporalFit / sum,
  };
}

function planPhraseSynchronization(
  event: CreativeMusicEvent,
  scene: SceneAnalysis,
  keywordEvent?: CreativeMusicEvent | null,
): PhraseSyncPlan {
  const eventDur = Math.max(0.2, event.endTime - event.startTime);
  const sceneDur = Math.max(0.2, scene.durationS);
  const peakOffsetInScene = clamp(scene.peakTime - scene.startTime, 0, sceneDur);

  if (!event.lyrics) {
    return {
      mode: 'rhythm_only',
      recommendedSourceInS: round3(scene.startTime),
      recommendedLeadInS: 0,
      targetKeywordTimeS: null,
      rationale: 'Evento instrumental/estrutural sincronizado pelo pulso e energia musical.',
    };
  }

  if (keywordEvent && (scene.actionPhase === 'impact' || scene.actionPhase === 'attack' || scene.actionPhase === 'counter' || scene.actions.includes('impacto'))) {
    const kwRelative = clamp(keywordEvent.startTime - event.startTime, 0, eventDur);
    const idealIn = clamp(scene.peakTime - kwRelative, scene.startTime, Math.max(scene.startTime, scene.endTime - Math.min(sceneDur, eventDur)));
    return {
      mode: 'impact_on_keyword',
      recommendedSourceInS: round3(idealIn),
      recommendedLeadInS: 0,
      targetKeywordTimeS: keywordEvent.startTime,
      rationale: `Ápice visual (${scene.peakTime.toFixed(2)}s) alinhado à palavra-chave "${keywordEvent.lyrics}" em ${keywordEvent.startTime.toFixed(2)}s.`,
    };
  }

  if (scene.actionPhase === 'preparation' || scene.actions.includes('preparação_combate')) {
    const leadS = Math.min(0.35, Math.max(0.12, sceneDur - eventDur * 0.7));
    return {
      mode: 'prep_before_lyric',
      recommendedSourceInS: round3(scene.startTime),
      recommendedLeadInS: round3(leadS),
      targetKeywordTimeS: null,
      rationale: 'Preparação visual antecede a entrada vocal para criar antecipação dramática.',
    };
  }

  if ((scene.actionPhase === 'contemplation' || scene.actions.includes('memória') || scene.actions.includes('despedida') || scene.actions.includes('tristeza'))
    && sceneDur >= eventDur * 0.85) {
    return {
      mode: 'hold_across_phrase',
      recommendedSourceInS: round3(scene.startTime),
      recommendedLeadInS: 0,
      targetKeywordTimeS: null,
      rationale: 'Plano sustentado durante toda a frase vocal para preservar respiração cinematográfica.',
    };
  }

  if (scene.actionPhase === 'reaction' || scene.actionPhase === 'aftermath') {
    return {
      mode: 'reaction_after_phrase',
      recommendedSourceInS: round3(scene.startTime),
      recommendedLeadInS: 0,
      targetKeywordTimeS: null,
      rationale: 'Plano de reação/consequência responde emocionalmente ao fechamento da frase.',
    };
  }

  const actionIn = clamp(scene.startTime + Math.max(0, peakOffsetInScene - eventDur * 0.45), scene.startTime, Math.max(scene.startTime, scene.endTime - Math.min(sceneDur, eventDur)));
  return {
    mode: 'entry_during_action',
    recommendedSourceInS: round3(actionIn),
    recommendedLeadInS: 0,
    targetKeywordTimeS: null,
    rationale: 'Voz entra durante o movimento contínuo da cena.',
  };
}

/**
 * Avalia o alinhamento multidimensional entre um `CreativeMusicEvent` e uma `SceneAnalysis`.
 */
export function evaluateSemanticAlignment(
  event: CreativeMusicEvent,
  scene: SceneAnalysis,
  context: SemanticAlignmentContext = {},
): SemanticAlignment {
  const weights = normalizeWeights(context.weights);
  const meaning = event.semanticMeaning;
  const lyricNorm = normalizeText(event.lyrics ?? '');
  const descNorm = normalizeText(`${scene.visualDescription} ${scene.context.dialogueText ?? ''} ${scene.actions.join(' ')}`);
  const sceneTagMap = new Map(scene.semanticTags.map((t) => [t.tag, t]));

  // 1. Componente Semântico + Tipo de Relação (literal / metaphorical / contextual / intentional_contrast / emotional)
  let alignmentType: SemanticAlignmentType = 'emotional';
  let semanticScore = 50;
  let primaryReason = '';

  const matchedLiterals = event.lyrics
    ? LITERAL_VISUAL_TOKENS.filter((rule) =>
        rule.lyricTerms.some((term) => lyricNorm.includes(normalizeText(term)))
        && rule.check(scene, descNorm).ok,
      )
    : [];
  const literalHit = matchedLiterals[0];

  let bestContextualScore = 0;
  let bestContextualTheme: LyricSemanticTheme | null = null;
  let bestMatchedTag: SceneSemanticTag | null = null;

  if (meaning?.themes.length) {
    for (const theme of meaning.themes) {
      const targetTags = THEME_TO_SCENE_TAGS[theme] ?? [];
      for (const tag of targetTags) {
        const tagEntry = sceneTagMap.get(tag);
        if (tagEntry) {
          const candidateScore = 62 + tagEntry.score * 36;
          if (candidateScore > bestContextualScore) {
            bestContextualScore = candidateScore;
            bestContextualTheme = theme;
            bestMatchedTag = tag;
          }
        }
      }
      // Regra explícita de resistência/superação contextual: personagem debilitado/em ascensão + frase de persistência
      if ((theme === 'resistência' || theme === 'superação' || theme === 'determinação')
        && (scene.characterState === 'debilitated' || scene.characterState === 'rising' || scene.context.visualIntent === 'resistência')) {
        const resilienceScore = 92;
        if (resilienceScore > bestContextualScore) {
          bestContextualScore = resilienceScore;
          bestContextualTheme = theme;
          bestMatchedTag = sceneTagMap.has('superação') ? 'superação' : 'determinação';
        }
      }
    }
  }

  // Checagem de Contraste Intencional (ex.: letra sobre vitória/esperança sobre derrota/dor ou vice-versa)
  let contrastScore = 0;
  let contrastTag: SceneSemanticTag | null = null;
  if (meaning?.contrastCandidateThemes.length) {
    for (const cTheme of meaning.contrastCandidateThemes) {
      for (const tag of THEME_TO_SCENE_TAGS[cTheme] ?? []) {
        const entry = sceneTagMap.get(tag);
        if (entry && entry.score >= 0.6) {
          const baseContrast = context.allowIntentionalContrast ? 86 : 68;
          const sc = baseContrast + entry.score * 10;
          if (sc > contrastScore) {
            contrastScore = sc;
            contrastTag = tag;
          }
        }
      }
    }
  }

  if (literalHit) {
    const checkRes = literalHit.check(scene, descNorm);
    alignmentType = 'literal';
    semanticScore = clamp(Math.max(86, bestContextualScore) + Math.min(10, (matchedLiterals.length - 1) * 5), 0, 100);
    primaryReason = `Associação literal: "${event.lyrics}" ↔ ${checkRes.label}.`;
  } else if (meaning?.isMetaphorical && bestContextualScore >= 68) {
    alignmentType = 'metaphorical';
    semanticScore = clamp(bestContextualScore + 4, 0, 100);
    primaryReason = `Associação metafórica: figura "${meaning.primaryTheme}" traduzida visualmente por ${bestMatchedTag} (${scene.context.visualIntent}).`;
  } else if (context.allowIntentionalContrast && contrastScore > bestContextualScore && contrastTag) {
    alignmentType = 'intentional_contrast';
    semanticScore = clamp(contrastScore, 0, 100);
    primaryReason = `Contraste dramático intencional: letra sobre "${meaning?.primaryTheme ?? event.emotion}" contraposta à cena de "${contrastTag}" para criar tensão narrativa.`;
  } else if (bestContextualScore >= 65 && bestContextualTheme) {
    alignmentType = 'contextual';
    semanticScore = clamp(bestContextualScore, 0, 100);
    primaryReason = `Associação contextual: sentido de "${bestContextualTheme}" da letra reforçado pela cena de ${bestMatchedTag} (estado: ${scene.characterState}).`;
  } else if (!context.allowIntentionalContrast && contrastScore >= 78 && bestContextualScore < 50 && contrastTag) {
    // Mesmo sem flag explícita, reconhece contraste possível com nota moderada sem tratá-lo como erro cego
    alignmentType = 'intentional_contrast';
    semanticScore = 64;
    primaryReason = `Contraste temático potencial entre "${meaning?.primaryTheme ?? event.emotion}" e cena de "${contrastTag}".`;
  } else {
    alignmentType = 'emotional';
    const intensityDelta = Math.abs((meaning?.arousal ?? event.intensity) - scene.intensity);
    const missedStrongTheme = Boolean(meaning?.themes.length) && bestContextualScore === 0;
    semanticScore = event.lyrics
      ? clamp((missedStrongTheme ? 44 : 58) - intensityDelta * 30, 18, 70)
      : clamp(82 - intensityDelta * 45, 35, 92);
    primaryReason = event.lyrics
      ? `Associação emocional: tom "${event.emotion}" alinhado à atmosfera visual (${scene.emotions[0]?.emotion ?? 'neutra'}).`
      : `Alinhamento musical-visual por energia (${event.intensity.toFixed(2)} ↔ ${scene.intensity.toFixed(2)}) e emoção "${event.emotion}".`;
  }

  // 2. Componente Emocional (0..100)
  const compatibleSceneEmotions = EMOTION_COMPATIBILITY[event.emotion] ?? ['neutro'];
  const matchingEmotion = scene.emotions.find((e) => compatibleSceneEmotions.includes(e.emotion));
  const arousalGap = Math.abs((meaning?.arousal ?? event.intensity) - scene.intensity);
  const emotionalScore = alignmentType === 'intentional_contrast'
    ? clamp(82 - arousalGap * 20, 55, 95)
    : clamp((matchingEmotion ? 78 + matchingEmotion.intensity * 20 : 54) - arousalGap * 28, 15, 100);

  // 3. Coerência com o Personagem (0..100)
  let characterScore = 65;
  const focusChars = (context.focusCharacters ?? []).map(normLabel).filter(Boolean);
  const recentChars = (context.recentCharacters ?? []).map(normLabel).filter(Boolean);
  const sceneChars = scene.characterNames.map(normLabel).filter(Boolean);
  if (focusChars.length > 0) {
    if (sceneChars.some((c) => focusChars.includes(c))) characterScore = 95;
    else if (sceneChars.length > 0) characterScore = 32;
    else characterScore = 55;
  } else if (recentChars.length > 0 && sceneChars.length > 0) {
    characterScore = sceneChars.some((c) => recentChars.includes(c)) ? 88 : 62;
  } else if (scene.characters.some((c) => c.confirmed)) {
    characterScore = 82;
  }

  // 4. Coerência com o Contexto da Cena (0..100)
  let contextualScore = 68;
  if (scene.deadFrameScore >= 0.55 || scene.textClutterScore >= 0.55) {
    contextualScore -= 35;
  }
  if (event.eventType === 'drop' || event.eventType === 'climax') {
    contextualScore = scene.context.hasConfrontation || scene.actions.includes('impacto') || scene.actions.includes('transformação')
      ? 94
      : 42;
  } else if (event.eventType === 'pause' || event.emotion === 'melancolia' || event.emotion === 'calma') {
    contextualScore = scene.actionPhase === 'contemplation' || scene.actionPhase === 'reaction' || scene.actionPhase === 'dialogue' || scene.actions.includes('memória')
      ? 90
      : scene.actionPhase === 'impact' && !context.allowIntentionalContrast
        ? 38
        : 65;
  } else if (bestContextualScore >= 70) {
    contextualScore = Math.min(96, bestContextualScore);
  }

  // 5. Coerência com a Narrativa Geral (0..100)
  let narrativeScore = 68;
  if (context.narrativeTargetTags?.length) {
    const matchedNarrativeTags = context.narrativeTargetTags.filter((tag) => sceneTagMap.has(tag));
    narrativeScore = matchedNarrativeTags.length > 0
      ? Math.min(98, 76 + matchedNarrativeTags.length * 10)
      : alignmentType === 'intentional_contrast' && context.allowIntentionalContrast
        ? 82
        : 46;
  }

  // 6. Encaixe Temporal (0..100)
  const eventDur = Math.max(0.2, event.endTime - event.startTime);
  const ratio = scene.durationS / eventDur;
  const temporalScore = ratio >= 0.9 && ratio <= 3.2
    ? 92
    : ratio >= 0.6
      ? 72
      : clamp(ratio * 90, 15, 65);

  const components: SemanticAlignmentComponents = {
    semantic: round1(semanticScore),
    emotional: round1(emotionalScore),
    characterCoherence: round1(characterScore),
    contextual: round1(contextualScore),
    generalNarrative: round1(narrativeScore),
    temporalFit: round1(temporalScore),
  };

  const totalScore = round1(clamp(
    components.semantic * weights.semantic
      + components.emotional * weights.emotional
      + components.characterCoherence * weights.characterCoherence
      + components.contextual * weights.contextual
      + components.generalNarrative * weights.generalNarrative
      + components.temporalFit * weights.temporalFit,
    0,
    100,
  ));

  const phraseSync = planPhraseSynchronization(event, scene, context.keywordEvent);
  const confidence = round3(clamp(event.confidence * 0.5 + scene.confidence * 0.5, 0.2, 0.98));

  return {
    musicEventId: event.id,
    sceneId: scene.sceneId,
    alignmentType,
    phraseSync,
    score: totalScore,
    components,
    explanation: `${primaryReason} (${phraseSync.rationale})`,
    confidence,
  };
}

/**
 * Ranqueia as melhores cenas para um evento musical/frase da letra.
 */
export function rankScenesForMusicEvent(
  event: CreativeMusicEvent,
  scenes: SceneAnalysis[],
  context: SemanticAlignmentContext = {},
  limit = 8,
): SemanticAlignment[] {
  return scenes
    .filter((s) => !s.excluded)
    .map((scene) => evaluateSemanticAlignment(event, scene, context))
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.sceneId.localeCompare(b.sceneId))
    .slice(0, limit);
}
