import type { EpisodeAnalysis, MusicAnalysis } from '@amv/analysis';

/**
 * Estilos do "Gerar meu AMV", tirados das referências reais (ver docs/DECISIONS.md):
 * cada estilo é um conjunto de parâmetros, não um prompt.
 */
export type StyleId = 'hype' | 'rapido' | 'superacao' | 'letra' | 'discurso' | 'emocional';

export interface StyleDef {
  id: StyleId;
  label: string;
  description: string;
  /** Batidas por corte conforme a energia da música (baixa, média, alta). */
  beatsPerCut: [number, number, number];
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
