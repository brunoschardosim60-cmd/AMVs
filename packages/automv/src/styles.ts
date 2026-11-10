import type { EpisodeAnalysis, MusicAnalysis } from '@amv/analysis';

/**
 * Estilos do "Gerar meu AMV", tirados das referências reais (ver docs/DECISIONS.md):
 * cada estilo é um conjunto de parâmetros, não um prompt.
 */
export type StyleId = 'hype' | 'rapido' | 'superacao' | 'letra' | 'discurso' | 'emocional';
export type EditorialDirection = 'cinematic' | 'balanced' | 'hype';

export interface StyleDef {
  id: StyleId;
  label: string;
  description: string;
  /** Batidas por corte conforme a energia da música (baixa, média, alta). */
  beatsPerCut: [number, number, number];
  /** Variação determinística do agrupamento de batidas, sem jitter nos cortes. */
  rhythmPattern: [number, number, number, number];
  /** Quanto alongar planos durante pausas detectadas. */
  pauseHold: number;
  /** Quanto acelerar os cortes ao longo de um crescimento detectado. */
  buildAcceleration: number;
  /** Quanto acelerar nos instantes anteriores a um drop. */
  preDropAcceleration: number;
  /** Quanto alongar planos no encerramento musical. */
  endingHold: number;
  /** Sensibilidade a ataques fortes, sem transformar todo onset em corte. */
  accentSensitivity: number;
  /** Corte nunca menor que isto (s). */
  minCutS: number;
  /** Intensidade de cena desejada (0..1) para energia baixa e alta da música. */
  targetIntensity: [number, number];
  /** Fala marcante antes do drop, com a música abaixada. */
  speechBeforeDrop: boolean;
  /** Transição padrão entre cenas. */
  transition: 'cut' | 'dissolve';
  /** Efeitos de impacto (clarão/tremida no drop, zoom em batidas fortes). */
  impactFx: number;
  /** Mostrar legendas das falas usadas. */
  subtitles: 'none' | 'lines' | 'words';
  /** Cor geral. */
  grade: 'none' | 'warm' | 'bw' | 'punchy';
  /** Prefere seguir a ordem do episódio (crescendo narrativo). */
  narrative: number;
  /** Sinal visual que recebe prioridade na escolha da cena. */
  sceneBias?: 'impact' | 'emotion';
}

export const STYLES: StyleDef[] = [
  {
    id: 'hype',
    label: 'Hype / Luta',
    description: 'Cortes rápidos na batida, vários animes, clarão e tremida nos impactos. Calmo no começo, explode no drop.',
    beatsPerCut: [4, 2, 1],
    rhythmPattern: [1, 1.25, 0.75, 1],
    pauseHold: 1.35,
    buildAcceleration: 0.28,
    preDropAcceleration: 0.22,
    endingHold: 1.5,
    accentSensitivity: 0.62,
    minCutS: 0.22,
    targetIntensity: [0.3, 0.95],
    speechBeforeDrop: true,
    transition: 'cut',
    impactFx: 1,
    subtitles: 'lines',
    grade: 'punchy',
    narrative: 0.15,
  },
  {
    id: 'rapido',
    label: 'Impacto rápido',
    description: 'Cortes de meia batida para destacar socos, golpes e impactos; desacelera nos trechos calmos da música.',
    beatsPerCut: [1, 0.5, 0.5],
    rhythmPattern: [1, 1, 1, 1],
    pauseHold: 1.25,
    buildAcceleration: 0.15,
    preDropAcceleration: 0.12,
    endingHold: 1.4,
    accentSensitivity: 0.88,
    minCutS: 0.2,
    targetIntensity: [0.55, 0.98],
    speechBeforeDrop: true,
    transition: 'cut',
    impactFx: 0.8,
    subtitles: 'lines',
    grade: 'punchy',
    narrative: 0.15,
    sceneBias: 'impact',
  },
  {
    id: 'superacao',
    label: 'Superação',
    description: 'Começa pesado e lento, frase marcante antes da virada, depois cenas de vitória. Cor quente.',
    beatsPerCut: [8, 4, 2],
    rhythmPattern: [1.25, 1, 0.75, 1],
    pauseHold: 1.7,
    buildAcceleration: 0.38,
    preDropAcceleration: 0.32,
    endingHold: 1.8,
    accentSensitivity: 0.48,
    minCutS: 0.35,
    targetIntensity: [0.2, 0.85],
    speechBeforeDrop: true,
    transition: 'cut',
    impactFx: 0.7,
    subtitles: 'lines',
    grade: 'warm',
    narrative: 0.6,
  },
  {
    id: 'letra',
    label: 'Letra na tela',
    description: 'Uma palavra grande da letra a cada corte, cada uma numa cena diferente. Precisa da letra com tempo (LRC).',
    beatsPerCut: [2, 1, 1],
    rhythmPattern: [1, 1, 0.8, 1.2],
    pauseHold: 1.4,
    buildAcceleration: 0.18,
    preDropAcceleration: 0.18,
    endingHold: 1.4,
    accentSensitivity: 0.58,
    minCutS: 0.25,
    targetIntensity: [0.4, 0.9],
    speechBeforeDrop: false,
    transition: 'cut',
    impactFx: 0.5,
    subtitles: 'words',
    grade: 'none',
    narrative: 0,
  },
  {
    id: 'discurso',
    label: 'Discurso motivacional',
    description: 'As falas dos personagens contam a história, com a música baixa por baixo e legenda em pedaços. Preto e branco.',
    beatsPerCut: [8, 8, 4],
    rhythmPattern: [1.25, 1, 1.25, 0.75],
    pauseHold: 1.8,
    buildAcceleration: 0.15,
    preDropAcceleration: 0.1,
    endingHold: 2,
    accentSensitivity: 0.25,
    minCutS: 0.8,
    targetIntensity: [0.2, 0.6],
    speechBeforeDrop: false,
    transition: 'cut',
    impactFx: 0.2,
    subtitles: 'words',
    grade: 'bw',
    narrative: 0.8,
  },
  {
    id: 'emocional',
    label: 'Emocional',
    description: 'Poucos cortes, cenas longas e transições suaves.',
    beatsPerCut: [16, 8, 8],
    rhythmPattern: [1.25, 0.8, 1.4, 0.8],
    pauseHold: 2,
    buildAcceleration: 0.12,
    preDropAcceleration: 0.08,
    endingHold: 2.2,
    accentSensitivity: 0.2,
    minCutS: 1.5,
    targetIntensity: [0.05, 0.45],
    speechBeforeDrop: false,
    transition: 'dissolve',
    impactFx: 0,
    subtitles: 'lines',
    grade: 'none',
    narrative: 0.4,
    sceneBias: 'emotion',
  },
];

export function styleDef(id: StyleId): StyleDef {
  return STYLES.find((s) => s.id === id)!;
}

export function editorialStyle(style: StyleDef, direction: EditorialDirection): StyleDef {
  if (direction === 'balanced') return style;
  if (direction === 'cinematic') {
    return {
      ...style,
      beatsPerCut: style.beatsPerCut.map((beats) => Math.max(1.5, Math.round(beats * 1.6))) as StyleDef['beatsPerCut'],
      rhythmPattern: style.rhythmPattern.map((beats) => Math.max(0.75, Math.round(beats * 1.15 * 4) / 4)) as StyleDef['rhythmPattern'],
      minCutS: Math.max(0.7, style.minCutS),
      pauseHold: style.pauseHold * 1.15,
      buildAcceleration: style.buildAcceleration * 0.75,
      preDropAcceleration: style.preDropAcceleration * 0.75,
      endingHold: style.endingHold * 1.2,
      accentSensitivity: style.accentSensitivity * 0.65,
      transition: 'dissolve',
      impactFx: style.impactFx * 0.35,
      narrative: Math.max(0.75, style.narrative),
      sceneBias: style.sceneBias === 'emotion' ? 'emotion' : undefined,
    };
  }
  return {
    ...style,
    beatsPerCut: style.beatsPerCut.map((beats) => Math.max(0.5, Math.round(beats * 0.55 * 2) / 2)) as StyleDef['beatsPerCut'],
    rhythmPattern: style.rhythmPattern.map((beats) => Math.max(0.5, Math.round(beats * 0.85 * 4) / 4)) as StyleDef['rhythmPattern'],
    minCutS: Math.min(0.22, style.minCutS),
    pauseHold: Math.max(1, style.pauseHold * 0.85),
    buildAcceleration: Math.min(0.5, style.buildAcceleration * 1.2),
    preDropAcceleration: Math.min(0.35, style.preDropAcceleration * 1.2),
    endingHold: Math.max(1.1, style.endingHold * 0.85),
    accentSensitivity: Math.min(1, style.accentSensitivity * 1.25),
    transition: 'cut',
    impactFx: Math.min(1.25, style.impactFx * 1.25),
    narrative: Math.max(0.5, style.narrative),
    sceneBias: 'impact',
  };
}

export interface StyleEvidence {
  analysis: EpisodeAnalysis;
  visual?: { shots: Record<string, { emotion?: string }> };
}

export interface StyleRecommendation {
  style: StyleId;
  confidence: number;
  reason: string;
}

/** Recomendação local e determinística, explicada pelos sinais já disponíveis no projeto. */
export function recommendStyle(episodes: StyleEvidence[], music: MusicAnalysis, hasLyrics: boolean): StyleRecommendation {
  const shots = episodes.flatMap((episode) => episode.analysis.shots);
  const speech = episodes.flatMap((episode) => episode.analysis.speech);
  const vision = episodes.flatMap((episode) => Object.values(episode.visual?.shots ?? {}));
  const rate = (count: number, total: number) => total ? count / total : 0;
  const impactRate = rate(shots.filter((shot) => shot.tags.includes('impacto') || shot.tags.includes('ação')).length, shots.length);
  const calmRate = rate(shots.filter((shot) => shot.tags.includes('calma')).length, shots.length);
  const sadRate = rate(vision.filter((shot) => shot.emotion === 'tristeza' || shot.emotion === 'calma').length, vision.length);
  const speechRate = Math.min(1, speech.length / Math.max(1, music.durationS / 12));
  const highTempo = Math.max(0, Math.min(1, (music.bpm - 90) / 80));
  const energy = Math.max(0, Math.min(1, music.intensity / 100));
  const scores: Record<StyleId, number> = {
    hype: 0.25 * impactRate + 0.35 * energy + 0.25 * highTempo + 0.15 * (1 - calmRate),
    rapido: 0.5 * impactRate + 0.3 * highTempo + 0.2 * energy,
    superacao: 0.3 * impactRate + 0.25 * speechRate + 0.25 * energy + 0.2 * (music.drops.length ? 1 : 0),
    letra: (hasLyrics ? 0.72 : 0) + 0.18 * energy + 0.1 * impactRate,
    discurso: 0.6 * speechRate + 0.2 * calmRate + 0.2 * (1 - energy),
    emocional: 0.38 * calmRate + 0.32 * sadRate + 0.2 * (1 - energy) + 0.1 * (1 - highTempo),
  };
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) as [StyleId, number][];
  const [style, top] = ranked[0]!;
  const gap = Math.max(0, top - (ranked[1]?.[1] ?? 0));
  const confidence = Math.max(0.35, Math.min(0.95, 0.45 + gap * 1.6));
  const evidence: Record<StyleId, string> = {
    hype: `energia ${Math.round(energy * 100)}% e cenas de ação/impacto`,
    rapido: `BPM ${Math.round(music.bpm)} e ${Math.round(impactRate * 100)}% das cenas com ação/impacto`,
    superacao: `${speech.length} falas, energia ${Math.round(energy * 100)}%${music.drops.length ? ' e drop detectado' : ''}`,
    letra: hasLyrics ? 'letra sincronizada disponível' : 'música com energia compatível',
    discurso: `${speech.length} falas detectadas e energia ${Math.round(energy * 100)}%`,
    emocional: `${Math.round(calmRate * 100)}% de cenas calmas${vision.length ? ` e ${Math.round(sadRate * 100)}% de cenas visuais tristes/calmas` : ''}`,
  };
  return { style, confidence: Math.round(confidence * 100) / 100, reason: evidence[style] };
}
