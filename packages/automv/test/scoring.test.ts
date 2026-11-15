import { describe, expect, it } from 'vitest';
import { LOCAL_VISION_VERSION, type LocalVisualFeatures, type Shot, type ShotVision } from '@amv/analysis';
import { editorialStyle, styleDef } from '../src/styles.js';
import { scoreSceneCandidate, type SceneScoringInput } from '../src/scoring.js';

const shot: Shot = {
  startS: 4,
  endS: 7,
  motion: 0.8,
  loud: 0.7,
  intensity: 0.8,
  brightness: 0.5,
  tags: ['ação', 'impacto'],
  line: null,
  peakS: 5.5,
};

const base: SceneScoringInput = {
  shot,
  targetIntensity: 0.8,
  musicEnergy: 0.9,
  isDrop: false,
  narrativeRole: 'climax',
  style: styleDef('hype'),
  current: { assetId: 'ep', sequenceId: 'fight-1', sourceStartS: 4 },
};

function vision(overrides: Partial<ShotVision> = {}): ShotVision {
  return {
    characters: [],
    fight: true,
    note: '',
    confidence: 0.9,
    ...overrides,
  };
}

function localMotion(directionDeg: number, confidence = 0.9): LocalVisualFeatures {
  const event = {
    startS: 1,
    endS: 2,
    cameraMotion: 'pan-horizontal' as const,
    directionDeg,
    speed: 0.08,
    scaleSpeed: 0,
    confidence,
    subjectMotion: { directionDeg: null, speed: 0, confidence: 0 },
    apparentScaleChange: 'none' as const,
    abruptFramingChange: false,
  };
  return {
    version: LOCAL_VISION_VERSION,
    samples: 3,
    lumaGrid: [],
    edgeGrid: [],
    colorHistogram: [],
    brightness: 0.5,
    saturation: 0.4,
    entropy: 0.6,
    edgeDensity: 0.3,
    centerOfVisualMass: [0.5, 0.5],
    temporalMotion: 0.3,
    globalShift: [0, 0],
    globalMotion: 0.2,
    motionEvents: [event],
    motionConfidence: confidence,
    fingerprint: `motion-${directionDeg}`,
    sceneType: 'action',
    sceneTypeConfidence: 0.7,
  };
}

describe('pontuação contextual de cenas', () => {
  it('usa composição e movimento locais para evitar cortes visualmente repetidos', () => {
    const features: LocalVisualFeatures = {
      version: LOCAL_VISION_VERSION,
      samples: 3,
      lumaGrid: Array.from({ length: 64 }, (_, index) => index < 32 ? 0.2 : 0.8),
      edgeGrid: Array.from({ length: 16 }, (_, index) => index % 4 === 1 ? 0.7 : 0.1),
      colorHistogram: [0.2, 0.2, 0.2, 0.4, 0.25, 0.25, 0.25, 0.25, 0.3, 0.3, 0.2, 0.2],
      brightness: 0.5,
      saturation: 0.4,
      entropy: 0.6,
      edgeDensity: 0.3,
      centerOfVisualMass: [0.5, 0.5],
      temporalMotion: 0.35,
      globalShift: [0.02, 0],
      globalMotion: 0.2,
      motionEvents: [],
      motionConfidence: 0,
      fingerprint: 'lv1-same',
      sceneType: 'action',
      sceneTypeConfidence: 0.7,
    };
    const result = scoreSceneCandidate({
      ...base,
      local: features,
      previous: { assetId: 'ep', sequenceId: 'fight-1', sourceEndS: 3.9, local: features },
    });
    expect(result.visual).toBeLessThan(0);
    expect(result.reasons).toContain('penalidade por repetição de composição visual semelhante');
  });

  it('usa classificação local com confiança moderada na escolha contextual', () => {
    const candidateShot = { ...shot, tags: [] as Shot['tags'] };
    const localAction: LocalVisualFeatures = {
      version: LOCAL_VISION_VERSION,
      samples: 1,
      lumaGrid: [],
      edgeGrid: [],
      colorHistogram: [],
      brightness: 0.5,
      saturation: 0.4,
      entropy: 0.6,
      edgeDensity: 0.3,
      centerOfVisualMass: [0.5, 0.5],
      temporalMotion: 0.7,
      globalShift: [0, 0],
      globalMotion: 0.2,
      motionEvents: [],
      motionConfidence: 0,
      fingerprint: 'lv1-action',
      sceneType: 'action',
      sceneTypeConfidence: 0.72,
    };
    const withoutLocal = scoreSceneCandidate({ ...base, shot: candidateShot });
    const withLocal = scoreSceneCandidate({ ...base, shot: candidateShot, local: localAction });

    expect(withLocal.action).toBeGreaterThan(withoutLocal.action);
  });

  it('aplica a ênfase emocional do perfil a emoções visuais confiáveis', () => {
    const emotionalShot = { ...shot, tags: ['calma'] as Shot['tags'] };
    const emotionalVision = vision({ fight: false, emotion: 'tristeza' });
    const balanced = scoreSceneCandidate({ ...base, shot: emotionalShot, style: styleDef('emocional'), vision: emotionalVision });
    const emotionFocused = scoreSceneCandidate({
      ...base,
      shot: emotionalShot,
      style: styleDef('emocional'),
      vision: emotionalVision,
      creativeEmphasis: { action: 0, emotion: 100, preferredEmotion: 'tristeza' },
    });

    expect(emotionFocused.total).toBeGreaterThan(balanced.total);
    expect(emotionFocused.reasons).toContain('peso emocional do perfil (100%) aplicado às evidências disponíveis');
    expect(emotionFocused.reasons).toContain('emoção principal do perfil identificada com confiança (tristeza)');
  });

  it('direções editoriais aplicam parâmetros de montagem diferentes', () => {
    const baseStyle = styleDef('hype');
    const cinematic = editorialStyle(baseStyle, 'cinematic');
    const balanced = editorialStyle(baseStyle, 'balanced');
    const hype = editorialStyle(baseStyle, 'hype');

    expect(balanced).toBe(baseStyle);
    expect(cinematic.beatsPerCut[2]).toBeGreaterThan(baseStyle.beatsPerCut[2]);
    expect(cinematic.transition).toBe('dissolve');
    expect(cinematic.impactFx).toBeLessThan(baseStyle.impactFx);
    expect(hype.beatsPerCut[2]).toBeLessThan(baseStyle.beatsPerCut[2]);
    expect(hype.transition).toBe('cut');
    expect(hype.impactFx).toBeGreaterThan(baseStyle.impactFx);
  });

  it('correspondência forte de letra pesa mais que um match abaixo do ponto neutro', () => {
    const matching = scoreSceneCandidate({ ...base, lyricMatchScore: 1 });
    const unrelated = scoreSceneCandidate({ ...base, lyricMatchScore: 0 });

    expect(matching.total - unrelated.total).toBeCloseTo(2);
    expect(matching.reasons).toContain('correspondência opcional entre letra e cena');
    expect(unrelated.reasons).toContain('correspondência opcional letra/cena abaixo do ponto neutro');
  });

  it('decompõe encaixe musical, ação e narrativa sem chamar o total de confiança', () => {
    const breakdown = scoreSceneCandidate(base);
    expect(breakdown.music).toBe(1);
    expect(breakdown.action).toBe(0.15);
    expect(breakdown.narrative).toBe(0.28);
    expect(breakdown.total).toBe(breakdown.music + breakdown.action + breakdown.emotion + breakdown.narrative);
    expect(breakdown.reasons).toContain('energia visual próxima da meta musical');
    expect(breakdown).not.toHaveProperty('quality');
  });

  it('usa o objetivo editorial de ascensão para favorecer preparação, ação e consequência com evidência confiável', () => {
    const plainShot = { ...shot, tags: [] as Shot['tags'] };
    const neutralBuild = scoreSceneCandidate({
      ...base,
      shot: plainShot,
      style: styleDef('superacao'),
      narrativeRole: 'build',
    });
    const preparationBuild = scoreSceneCandidate({
      ...base,
      shot: plainShot,
      style: styleDef('superacao'),
      narrativeRole: 'build',
      vision: vision({ fight: false, action: 'preparação', sceneType: 'tension' }),
    });
    expect(preparationBuild.narrative).toBeGreaterThan(neutralBuild.narrative);
    expect(preparationBuild.reasons).toContain('brief de ascensão: preparação/tensão favorecida antes da virada');

    const neutralClimax = scoreSceneCandidate({
      ...base,
      shot: plainShot,
      style: styleDef('superacao'),
      narrativeRole: 'climax',
    });
    const actionClimax = scoreSceneCandidate({
      ...base,
      shot: plainShot,
      style: styleDef('superacao'),
      narrativeRole: 'climax',
      vision: vision({ fight: true, action: 'combate' }),
    });
    expect(actionClimax.action).toBeGreaterThan(neutralClimax.action);
    expect(actionClimax.reasons).toContain('brief de ascensão: ação/determinação confiável favorecida no clímax');

    const untrusted = scoreSceneCandidate({
      ...base,
      shot: plainShot,
      style: styleDef('superacao'),
      narrativeRole: 'build',
      vision: vision({ fight: false, action: 'preparação', sceneType: 'tension', confidence: 0.4 }),
    });
    expect(untrusted.narrative).toBe(neutralBuild.narrative);
  });

  it('usa intenção de discurso e de letra para priorizar fala e correspondência semântica', () => {
    const talkShot = { ...shot, tags: ['fala'] as Shot['tags'] };
    const speech = scoreSceneCandidate({
      ...base,
      shot: talkShot,
      style: styleDef('discurso'),
      narrativeRole: 'build',
      vision: vision({ fight: false, action: 'diálogo', sceneType: 'dialogue' }),
    });
    expect(speech.narrative).toBeGreaterThan(0);
    expect(speech.reasons).toContain('brief de discurso: cena de diálogo confiável favorecida para conduzir a mensagem');

    const matchedLyrics = scoreSceneCandidate({
      ...base,
      style: styleDef('letra'),
      lyricMatchScore: 1,
    });
    const unrelatedLyrics = scoreSceneCandidate({
      ...base,
      style: styleDef('letra'),
      lyricMatchScore: 0,
    });
    expect(matchedLyrics.total - unrelatedLyrics.total).toBeCloseTo(2.6);
    expect(matchedLyrics.reasons).toContain('correspondência semântica reforçada pelo objetivo de sincronizar a letra');
  });

  it('recompensa progressão de cena e só usa personagem/ação visual com confiança suficiente', () => {
    const previousVision = vision({ characters: ['Asta'], action: 'preparação' });
    const currentVision = vision({ characters: ['asta'], action: 'combate' });
    const withContinuity = scoreSceneCandidate({
      ...base,
      vision: currentVision,
      previous: { assetId: 'ep', sequenceId: 'fight-1', sourceEndS: 3.95, vision: previousVision },
    });
    const withoutContinuity = scoreSceneCandidate(base);
    expect(withContinuity.transition).toBeGreaterThan(withoutContinuity.transition);
    expect(withContinuity.reasons).toContain('continuidade visual sugerida entre preparação/ação/reação');
    expect(withContinuity.reasons).toContain('continuidade de personagens na cena (mesmos personagens no corte)');

    const uncertain = scoreSceneCandidate({
      ...base,
      style: styleDef('emocional'),
      vision: vision({ emotion: 'tristeza', confidence: 0.54 }),
    });
    expect(uncertain.emotion).toBe(0);
    expect(uncertain.reasons.some((reason) => reason.includes('emoção visual'))).toBe(false);
  });

  it('favorece personagens recorrentes em vários planos recentes, sem exigir elenco idêntico', () => {
    const currentVision = vision({ characters: ['Asta'] });
    const onePriorMatch = scoreSceneCandidate({
      ...base,
      vision: currentVision,
      recentCharacters: [['Asta'], ['Yuno'], ['Noelle']],
    });
    const recurringAcrossShots = scoreSceneCandidate({
      ...base,
      vision: currentVision,
      recentCharacters: [['Asta'], ['Yuno'], ['asta'], ['Noelle']],
    });
    expect(recurringAcrossShots.transition).toBeGreaterThan(onePriorMatch.transition);
    expect(recurringAcrossShots.reasons).toContain('personagem recorrente confirmado em múltiplos planos recentes');
    expect(onePriorMatch.reasons).toContain('personagem reaparece após um corte intermediário');
  });

  it('registra a troca de episódio como diversidade sem fingir match visual', () => {
    const breakdown = scoreSceneCandidate({
      ...base,
      current: { assetId: 'ep2', sequenceId: 'fight-2', sourceStartS: 0 },
      previous: { assetId: 'ep1', sequenceId: 'fight-1', sourceEndS: 12 },
    });
    expect(breakdown.diversity).toBe(0);
    expect(breakdown.transition).toBe(-0.1);
    expect(breakdown.reasons).toContain('penalidade de transição por retrocesso ou troca de sequência');
  });

  it('desencoraja troca de episódio sem quebra musical quando não há continuidade visual confiável', () => {
    const withoutBoundary = scoreSceneCandidate({
      ...base,
      organizationMode: 'narrative',
      current: { assetId: 'ep2', sequenceId: 'fight-2', sourceStartS: 0 },
      previous: { assetId: 'ep1', sequenceId: 'fight-1', sourceEndS: 12 },
    });
    const withBoundary = scoreSceneCandidate({
      ...base,
      organizationMode: 'narrative',
      transitionCue: 'mudança de seção musical',
      current: { assetId: 'ep2', sequenceId: 'fight-2', sourceStartS: 0 },
      previous: { assetId: 'ep1', sequenceId: 'fight-1', sourceEndS: 12 },
    });

    expect(withoutBoundary.transition).toBeCloseTo(-0.32);
    expect(withoutBoundary.reasons).toContain('troca de episódio sem uma nova frase ou acento musical');
    expect(withBoundary.transition).toBeCloseTo(-0.1);
  });

  it('separa tag heurística de calma de uma emoção identificada por visão', () => {
    const calmShot = { ...shot, intensity: 0.2, tags: ['calma'] as Shot['tags'] };
    const heuristic = scoreSceneCandidate({ ...base, shot: calmShot, style: styleDef('emocional') });
    expect(heuristic.emotion).toBe(0.24);
    expect(heuristic.reasons).toContain('tag local de cena calma (heurística, não emoção identificada)');

    const identified = scoreSceneCandidate({
      ...base,
      shot: calmShot,
      style: styleDef('emocional'),
      vision: vision({ emotion: 'tristeza', confidence: 0.9 }),
    });
    expect(identified.emotion).toBe(0.68);
    expect(identified.reasons).toContain('emoção visual identificada (tristeza)');
  });

  it('ignora confiança visual inválida ou acima do intervalo documentado', () => {
    for (const confidence of [Number.NaN, Number.POSITIVE_INFINITY, 1.1]) {
      const breakdown = scoreSceneCandidate({
        ...base,
        style: styleDef('emocional'),
        vision: vision({ emotion: 'tristeza', confidence }),
      });
      expect(breakdown.emotion).toBe(0);
    }
  });

  it('favorece continuidade de movimento e aceita contraste direcional em acentos musicais', () => {
    const previous = { assetId: 'ep', sequenceId: 'fight-1', sourceEndS: 3.9, local: localMotion(0) };
    const matched = scoreSceneCandidate({ ...base, previous, local: localMotion(20) });
    const opposing = scoreSceneCandidate({ ...base, previous, local: localMotion(180) });
    const contrasted = scoreSceneCandidate({
      ...base,
      transitionCue: 'entrada do drop',
      previous,
      local: localMotion(180),
    });
    const uncertain = scoreSceneCandidate({ ...base, previous: { ...previous, local: localMotion(0, 0.4) }, local: localMotion(0) });

    expect(matched.reasons).toContain('continuidade de movimento com direção semelhante entre cenas');
    expect(opposing.reasons).toContain('possível interrupção de movimento sem contraste musical explícito');
    expect(contrasted.reasons).toContain('contraste de movimento alinhado a uma mudança musical');
    expect(uncertain.reasons.some((reason) => reason.includes('movimento'))).toBe(false);
  });

  it('discrimina luta de cenas calmas conforme a energia da música', () => {
    const calmShot = { ...shot, intensity: 0.2, tags: ['calma'] as Shot['tags'] };
    const impactShot = { ...shot, intensity: 0.85, tags: ['impacto', 'ação'] as Shot['tags'] };

    // Em trecho intenso (>= 0.70): penaliza cena calma
    const calmInHype = scoreSceneCandidate({ ...base, shot: calmShot, musicEnergy: 0.85 });
    expect(calmInHype.reasons).toContain('cena calma evitada em trecho de alta energia musical');
    expect(calmInHype.action).toBeLessThan(0);

    // Em trecho calmo (<= 0.35): penaliza impacto de luta e favorece calma
    const impactInQuiet = scoreSceneCandidate({ ...base, shot: impactShot, musicEnergy: 0.25 });
    expect(impactInQuiet.reasons).toContain('impacto evitado em trecho calmo da música');

    const calmInQuiet = scoreSceneCandidate({ ...base, shot: calmShot, musicEnergy: 0.25 });
    expect(calmInQuiet.action).toBeGreaterThan(0);
  });

  it('recompensa continuidade coreográfica em cortes sequenciais imediatos da mesma luta', () => {
    const previous = { assetId: 'ep', sequenceId: 'fight-1', sourceEndS: 4.0 };
    const immediateCut = scoreSceneCandidate({
      ...base,
      current: { assetId: 'ep', sequenceId: 'fight-1', sourceStartS: 5.0 },
      previous,
    });
    const distantCut = scoreSceneCandidate({
      ...base,
      current: { assetId: 'ep', sequenceId: 'fight-1', sourceStartS: 15.0 },
      previous,
    });

    expect(immediateCut.transition).toBeGreaterThan(distantCut.transition);
    expect(immediateCut.reasons).toContain('continuidade coreográfica de combate em sequência imediata');
  });
});

describe('qualidade técnica básica da cena', () => {
  it('penaliza pouca visibilidade, superexposição e falta de movimento em trecho agitado', () => {
    const normal = scoreSceneCandidate(base);
    const dark = scoreSceneCandidate({ ...base, shot: { ...shot, brightness: 0.12 } });
    const blown = scoreSceneCandidate({ ...base, shot: { ...shot, brightness: 0.98 } });
    const still = scoreSceneCandidate({ ...base, shot: { ...shot, motion: 0.01 } });
    expect(dark.total).toBeLessThan(normal.total);
    expect(blown.total).toBeLessThan(normal.total);
    expect(still.total).toBeLessThan(normal.total);
    expect(dark.reasons.join(' ')).toMatch(/escura/);
  });

  it('não penaliza brilho e movimento dentro da faixa normal', () => {
    const normal = scoreSceneCandidate(base);
    const ordinary = scoreSceneCandidate({ ...base, shot: { ...shot, brightness: 0.48, motion: 0.7 } });
    expect(ordinary.total).toBeCloseTo(normal.total, 5);
  });
});
