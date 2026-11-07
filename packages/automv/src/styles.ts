/**
 * Estilos do "Gerar meu AMV", tirados das referências reais (ver docs/DECISIONS.md):
 * cada estilo é um conjunto de parâmetros, não um prompt.
 */
export type StyleId = 'hype' | 'superacao' | 'letra' | 'discurso' | 'emocional';

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
  },
];

export function styleDef(id: StyleId): StyleDef {
  return STYLES.find((s) => s.id === id)!;
}
