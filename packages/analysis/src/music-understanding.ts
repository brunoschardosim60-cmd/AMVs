/**
 * MUSIC UNDERSTANDING ENGINE (Camada 1 — AMV Creative Intelligence)
 *
 * Compreende estrutura rítmica (compassos, frases, crescimentos, pausas, drops, clímax),
 * separação vocal × instrumental, interpretação semântica/emocional contextualizada de letras
 * e classificação tipológica da música (Narrativa, Emocional, Combate, Instrumental, Híbrida)
 * com troca dinâmica de estratégia editorial por seção.
 *
 * Regra estrita: nunca inventa significado semântico de letra em músicas instrumentais.
 */
import { voiceFeatures } from './episode.js';
import type { MusicAnalysis, SectionLabel } from './music.js';
import type { Cue } from './subtitles.js';
import { defaultCreativeAnalysisCache, type CreativeAnalysisCache } from './creative-cache.js';

export const MUSIC_UNDERSTANDING_VERSION = 'mu1';

export type SongArchetype =
  | 'narrative'
  | 'emotional'
  | 'combat'
  | 'instrumental'
  | 'hybrid';

export type SectionArchetype = 'narrative' | 'emotional' | 'combat' | 'instrumental';

export type SectionEditorialStrategy =
  | 'story_lyric'
  | 'cinematic_breathing'
  | 'impact_choreography'
  | 'rhythm_atmosphere';

export type MusicEmotionLabel =
  | 'determinação'
  | 'fúria'
  | 'euforia'
  | 'melancolia'
  | 'tensão'
  | 'esperança'
  | 'solenidade'
  | 'calma'
  | 'catarse'
  | 'neutro';

export type LyricSemanticTheme =
  | 'resistência'
  | 'superação'
  | 'determinação'
  | 'combate'
  | 'confronto_divino'
  | 'vingança'
  | 'fúria'
  | 'transformação'
  | 'vitória'
  | 'derrota'
  | 'perda'
  | 'solidão'
  | 'despedida'
  | 'memória'
  | 'sacrifício'
  | 'esperança'
  | 'desespero'
  | 'afeto';

export type CreativeMusicEventType =
  | 'beat'
  | 'downbeat'
  | 'bar'
  | 'section'
  | 'build'
  | 'drop'
  | 'climax'
  | 'pause'
  | 'transition'
  | 'vocal_phrase'
  | 'lyric_keyword'
  | 'instrumental_passage'
  | 'ending';

export interface LyricSemanticMeaning {
  themes: LyricSemanticTheme[];
  primaryTheme: LyricSemanticTheme | null;
  emotionalIntent: MusicEmotionLabel;
  /** Valência emocional aproximada (-1 = dor/perda/desespero, +1 = vitória/esperança/afeto). */
  valence: number;
  /** Excitação/energia emocional (0 = contemplativo, 1 = explosivo). */
  arousal: number;
  narrativeConcepts: string[];
  visualSuggestions: string[];
  heroWords: string[];
  isMetaphorical: boolean;
  contrastCandidateThemes: LyricSemanticTheme[];
  summary: string;
}

export interface CreativeMusicEvent {
  id: string;
  startTime: number;
  endTime: number;
  eventType: CreativeMusicEventType;
  lyrics: string | null;
  semanticMeaning: LyricSemanticMeaning | null;
  emotion: MusicEmotionLabel;
  intensity: number;
  confidence: number;
  sectionLabel?: SectionLabel;
}

export interface MusicBar {
  index: number;
  startTime: number;
  endTime: number;
  beats: number[];
  energy: number;
}

export interface VocalActivitySpan {
  startTime: number;
  endTime: number;
  source: 'lyrics' | 'spectral' | 'none';
  confidence: number;
}

export interface InstrumentalSpan {
  startTime: number;
  endTime: number;
  energy: number;
  confidence: number;
}

export interface SectionDirectionProfile {
  index: number;
  startTime: number;
  endTime: number;
  label: SectionLabel;
  archetype: SectionArchetype;
  strategy: SectionEditorialStrategy;
  vocalPresence: number;
  energy: number;
  dominantEmotion: MusicEmotionLabel;
  allowsLongBreathing: boolean;
  reason: string;
}

export interface LyricPhraseInterpretation {
  cueKey: string;
  startTime: number;
  endTime: number;
  text: string;
  meaning: LyricSemanticMeaning;
  confidence: number;
}

export interface AnimeMusicContextHint {
  hasFights?: boolean;
  hasEmotionalDrama?: boolean;
  characterNames?: string[];
  dominantVisualTags?: string[];
}

export interface MusicUnderstandingOptions {
  assetHash?: string;
  lyrics?: Cue[];
  /** Força modo instrumental quando o usuário ou metadado indica ausência de vocal cantado. */
  isInstrumental?: boolean;
  /** Amostras mono opcionais para estimar presença vocal espectral quando não há LRC/ASS. */
  samples?: Float32Array;
  sampleRate?: number;
  animeContext?: AnimeMusicContextHint;
  /** Incluir batidas individuais na lista de eventos (padrão: true). */
  includeBeatEvents?: boolean;
  cache?: CreativeAnalysisCache;
}

export interface MusicUnderstandingResult {
  version: typeof MUSIC_UNDERSTANDING_VERSION;
  durationS: number;
  bpm: number;
  bpmConfidence: number;
  meter: 3 | 4 | 6;
  tempoVariable: boolean;
  archetype: SongArchetype;
  archetypeConfidence: number;
  archetypeReason: string;
  isInstrumental: boolean;
  bars: MusicBar[];
  vocalSpans: VocalActivitySpan[];
  instrumentalSpans: InstrumentalSpan[];
  sectionProfiles: SectionDirectionProfile[];
  lyricInterpretations: LyricPhraseInterpretation[];
  events: CreativeMusicEvent[];
}

interface ThemeLexiconRule {
  theme: LyricSemanticTheme;
  keywords: string[];
  emotion: MusicEmotionLabel;
  valence: number;
  arousal: number;
  metaphoricalKeywords?: string[];
  narrativeConcepts: string[];
  combatVisuals: string[];
  dramaVisuals: string[];
  contrastThemes: LyricSemanticTheme[];
}

const LEXICON: ThemeLexiconRule[] = [
  {
    theme: 'resistência',
    keywords: [
      'stand', 'standing', 'endure', 'survive', 'unbroken', 'still alive', 'bleed', 'hold on', 'wont fall', 'not over',
      'de pe', 'continuar de pe', 'aguentar', 'resist', 'sobreviv', 'inabalavel', 'nao vou cair', 'mesmo ferido', 'suportar', 'taeru',
    ],
    emotion: 'determinação',
    valence: 0.25,
    arousal: 0.72,
    metaphoricalKeywords: ['shield', 'escudo', 'iron', 'ferro', 'stone', 'rocha', 'storm', 'tempestade'],
    narrativeConcepts: ['persistência sob pressão', 'recusar a queda', 'força moral diante da dor'],
    combatVisuals: ['personagem ferido permanecendo em pé', 'defesa firme contra ataque pesado', 'olhar fixo no oponente após sofrer dano'],
    dramaVisuals: ['personagem caminhando contra o vento', 'mãos cerradas tremendo', 'olhar resiliente após adversidade'],
    contrastThemes: ['derrota', 'desespero'],
  },
  {
    theme: 'superação',
    keywords: [
      'rise', 'rising', 'arise', 'get up', 'stand up', 'surpass', 'break through', 'higher', 'limit', 'beyond', 'overcome',
      'ergue', 'erga', 'levant', 'supera', 'ultrapass', 'alem do limite', 'quebrar barreiras', 'subir', 'ascensao', 'tachiagare', 'koero',
    ],
    emotion: 'determinação',
    valence: 0.65,
    arousal: 0.85,
    metaphoricalKeywords: ['wings', 'asas', 'sky', 'ceu', 'climb', 'escalar', 'chains', 'correntes'],
    narrativeConcepts: ['virada dramática', 'rompimento de limite', 'ascensão após queda'],
    combatVisuals: ['personagem se levantando do chão', 'contra-ataque decisivo', 'explosão de energia rompendo bloqueio'],
    dramaVisuals: ['personagem erguendo a cabeça para a luz', 'passo firme à frente', 'transição de dor para confiança'],
    contrastThemes: ['derrota', 'desespero'],
  },
  {
    theme: 'determinação',
    keywords: [
      'never give up', 'promise', 'oath', 'swear', 'will', 'destiny', 'protect', 'forward', 'courage', 'resolve',
      'nunca desist', 'promet', 'promessa', 'jurament', 'juro', 'proteger', 'avancar', 'coragem', 'destino', 'decid', 'mamoru', 'chikau',
    ],
    emotion: 'determinação',
    valence: 0.55,
    arousal: 0.76,
    narrativeConcepts: ['propósito inegociável', 'juramento', 'proteção de vínculo'],
    combatVisuals: ['preparação para combate', 'empunhar arma com firmeza', 'close nos olhos determinados'],
    dramaVisuals: ['diálogo de promessa', 'olhar firme no horizonte', 'gesto protetor'],
    contrastThemes: ['desespero', 'perda'],
  },
  {
    theme: 'combate',
    keywords: [
      'fight', 'battle', 'war', 'strike', 'hit', 'punch', 'slash', 'sword', 'blade', 'clash', 'enemy', 'blood', 'attack',
      'luta', 'batalh', 'guerra', 'golpe', 'soco', 'espada', 'lamina', 'confronto', 'inimigo', 'sangue', 'ataque', 'tatakai', 'yaiba',
    ],
    emotion: 'fúria',
    valence: -0.1,
    arousal: 0.92,
    metaphoricalKeywords: ['steel', 'aco', 'thunder', 'trovao'],
    narrativeConcepts: ['confronto direto', 'troca de golpes', 'choque de forças'],
    combatVisuals: ['ataque direto', 'choque de armas', 'esquiva seguida de impacto'],
    dramaVisuals: ['confronto emocional tenso', 'encarada de rivalidade'],
    contrastThemes: ['solidão', 'memória'],
  },
  {
    theme: 'confronto_divino',
    keywords: [
      'god', 'gods', 'king', 'throne', 'heaven', 'hell', 'highest', 'lowest', 'divine', 'demon', 'devil', 'almighty', 'empire',
      'deus', 'deuses', 'rei', 'trono', 'ceu', 'inferno', 'supremo', 'divino', 'demonio', 'absoluto', 'kami', 'oni', 'ouja',
    ],
    emotion: 'solenidade',
    valence: 0.1,
    arousal: 0.88,
    metaphoricalKeywords: ['crown', 'coroa', 'throne', 'trono', 'heaven', 'inferno', 'halo'],
    narrativeConcepts: ['escala mítica', 'assimetria de poder', 'desafio ao absoluto'],
    combatVisuals: ['plano aberto monumental de confronto', 'poder em escala massiva', 'antagonista imponente vs desafiante'],
    dramaVisuals: ['arquitetura grandiosa ou céu dramático', 'revelação de poder oculto'],
    contrastThemes: ['derrota', 'resistência'],
  },
  {
    theme: 'vingança',
    keywords: [
      'revenge', 'vengeance', 'payback', 'hatred', 'hate', 'unforgiven', 'hunt', 'curse', 'retribution',
      'vinganca', 'odio', 'pagar', 'cacar', 'maldicao', 'revanche', 'imperdoavel', 'nikushimi', 'fukushuu',
    ],
    emotion: 'fúria',
    valence: -0.68,
    arousal: 0.9,
    metaphoricalKeywords: ['venom', 'veneno', 'fangs', 'presas', 'ash', 'cinzas'],
    narrativeConcepts: ['acerto de contas', 'ferida transformada em fúria', 'perseguição implacável'],
    combatVisuals: ['ataque agressivo sem hesitação', 'expressão de fúria contida antes do golpe', 'memória rápida de perda seguida de impacto'],
    dramaVisuals: ['olhar sombrio em baixa luz', 'lembrança dolorosa seguida de punho fechado'],
    contrastThemes: ['afeto', 'memória'],
  },
  {
    theme: 'fúria',
    keywords: [
      'rage', 'fury', 'burn', 'burning', 'fire', 'flame', 'blaze', 'destroy', 'crush', 'scream', 'roar', 'chaos', 'wrath',
      'furia', 'raiva', 'queim', 'fogo', 'chama', 'destruir', 'esmagar', 'grit', 'caos', 'explod', 'honoo', 'ikari',
    ],
    emotion: 'fúria',
    valence: -0.45,
    arousal: 0.96,
    metaphoricalKeywords: ['fire', 'fogo', 'flame', 'chama', 'blaze', 'inferno', 'spark', 'faisca'],
    narrativeConcepts: ['explosão emocional', 'energia descontrolada', 'ruptura'],
    combatVisuals: ['impacto explosivo', 'grito de guerra', 'clarão de energia/chamas'],
    dramaVisuals: ['grito emocional', 'expressão intensa em close-up'],
    contrastThemes: ['solidão', 'despedida'],
  },
  {
    theme: 'transformação',
    keywords: [
      'awaken', 'reborn', 'transform', 'evolve', 'change', 'unleash', 'new form', 'metamorphosis', 'ignite',
      'despert', 'renasc', 'transform', 'evolu', 'mudar', 'libertar', 'nova forma', 'acender', 'kakusei',
    ],
    emotion: 'catarse',
    valence: 0.48,
    arousal: 0.9,
    metaphoricalKeywords: ['cocoon', 'casulo', 'wings', 'asas', 'phoenix', 'fenix', 'lightning', 'relampago'],
    narrativeConcepts: ['mudança de estado', 'despertar de poder', 'ruptura de identidade anterior'],
    combatVisuals: ['cena de transformação', 'mudança de aura/iluminação', 'revelação de forma despertada'],
    dramaVisuals: ['mudança de expressão de medo para firmeza', 'luz revelando o personagem'],
    contrastThemes: ['derrota', 'desespero'],
  },
  {
    theme: 'vitória',
    keywords: [
      'win', 'victory', 'triumph', 'glory', 'champion', 'conquer', 'top', 'crown', 'we made it',
      'venc', 'vitoria', 'triunfo', 'gloria', 'campeao', 'conquist', 'topo', 'coroa', 'shouri',
    ],
    emotion: 'euforia',
    valence: 0.88,
    arousal: 0.84,
    metaphoricalKeywords: ['crown', 'coroa', 'gold', 'ouro', 'summit', 'cume'],
    narrativeConcepts: ['conquista', 'culminação bem-sucedida', 'recompensa após conflito'],
    combatVisuals: ['golpe final vitorioso', 'adversário derrotado', 'postura de vitória após batalha'],
    dramaVisuals: ['sorriso de alívio', 'luz dourada de encerramento', 'reencontro'],
    contrastThemes: ['derrota', 'resistência'],
  },
  {
    theme: 'derrota',
    keywords: [
      'fall', 'fallen', 'lose', 'lost the fight', 'broken', 'shattered', 'knees', 'collapse', 'fail', 'defeat',
      'cair', 'caiu', 'queda', 'derrota', 'quebrad', 'estilhac', 'ajoelh', 'falhar', 'chao', 'makeru',
    ],
    emotion: 'melancolia',
    valence: -0.78,
    arousal: 0.48,
    metaphoricalKeywords: ['shattered', 'estilhac', 'glass', 'vidro', 'dust', 'poeira'],
    narrativeConcepts: ['queda do herói', 'custo real do conflito', 'vulnerabilidade'],
    combatVisuals: ['personagem ajoelhado ou caído', 'arma quebrada', 'impacto sofrido'],
    dramaVisuals: ['cabeça baixa na chuva/sombra', 'olhar de choque e impotência'],
    contrastThemes: ['vitória', 'superação'],
  },
  {
    theme: 'perda',
    keywords: [
      'gone', 'lost', 'death', 'die', 'dying', 'ashes', 'grave', 'fade away', 'never return', 'miss you',
      'perda', 'perdi', 'morte', 'morrer', 'cinzas', 'partiu', 'nao volta', 'falta', 'saudade', 'shi',
    ],
    emotion: 'melancolia',
    valence: -0.88,
    arousal: 0.35,
    metaphoricalKeywords: ['ashes', 'cinzas', 'petals', 'petalas', 'rain', 'chuva', 'cold', 'frio'],
    narrativeConcepts: ['ausência irreparável', 'luto', 'peso da perda'],
    combatVisuals: ['consequência trágica de batalha', 'aliado caído', 'silêncio após impacto'],
    dramaVisuals: ['lágrimas', 'objeto deixado para trás', 'plano vazio onde alguém estava'],
    contrastThemes: ['memória', 'afeto'],
  },
  {
    theme: 'solidão',
    keywords: [
      'alone', 'lonely', 'solitude', 'empty', 'void', 'shadow', 'silence', 'nobody', 'cold night', 'isolated',
      'sozinh', 'solidao', 'vazio', 'sombra', 'silencio', 'ninguem', 'noite fria', 'isolad', 'kodoku', 'hitori',
    ],
    emotion: 'melancolia',
    valence: -0.7,
    arousal: 0.25,
    metaphoricalKeywords: ['shadow', 'sombra', 'winter', 'inverno', 'echo', 'eco'],
    narrativeConcepts: ['isolamento', 'distância emocional', 'introspecção'],
    combatVisuals: ['guerreiro solitário contra muitos', 'silhueta isolada antes da luta'],
    dramaVisuals: ['plano aberto com personagem pequeno no quadro', 'olhar distante pela janela/horizonte'],
    contrastThemes: ['afeto', 'combate'],
  },
  {
    theme: 'despedida',
    keywords: [
      'goodbye', 'farewell', 'leave', 'leaving', 'last time', 'let go', 'walk away', 'parting', 'see you again',
      'adeus', 'despedida', 'partir', 'indo embora', 'ultima vez', 'deixar ir', 'ate algum dia', 'sayonara', 'wakare',
    ],
    emotion: 'melancolia',
    valence: -0.55,
    arousal: 0.34,
    narrativeConcepts: ['separação', 'encerramento de ciclo', 'aceitação dolorosa'],
    combatVisuals: ['último olhar antes de partir para o confronto', 'costas viradas caminhando para longe'],
    dramaVisuals: ['costas se afastando', 'mãos se soltando', 'sorriso triste de despedida'],
    contrastThemes: ['memória', 'afeto'],
  },
  {
    theme: 'memória',
    keywords: [
      'remember', 'memory', 'memories', 'yesterday', 'past', 'once upon', 'back then', 'echoes', 'childhood', 'nostalgia',
      'lembr', 'memoria', 'ontem', 'passado', 'aqueles dias', 'infancia', 'ecos', 'recorda', 'kioku', 'omoi',
    ],
    emotion: 'melancolia',
    valence: -0.15,
    arousal: 0.32,
    narrativeConcepts: ['flashback', 'eco do passado', 'origem da motivação'],
    combatVisuals: ['flashback curto intercalado no meio do confronto', 'lembrança do mestre/aliado'],
    dramaVisuals: ['cena de passado mais iluminada ou suave', 'olhar pensativo ativando lembrança'],
    contrastThemes: ['combate', 'transformação'],
  },
  {
    theme: 'sacrifício',
    keywords: [
      'sacrifice', 'my life for', 'last breath', 'take my pain', 'for you i fall', 'martyr', 'price to pay',
      'sacrific', 'minha vida por', 'ultimo suspiro', 'pelo seu bem', 'preco a pagar', 'dar tudo', 'gisei',
    ],
    emotion: 'catarse',
    valence: -0.25,
    arousal: 0.82,
    narrativeConcepts: ['entrega total', 'proteger ao custo de si', 'heroísmo trágico'],
    combatVisuals: ['entrar na frente de um golpe', 'ataque final exaurindo todas as forças'],
    dramaVisuals: ['sorriso sereno em meio ao perigo', 'proteção de outro personagem'],
    contrastThemes: ['esperança', 'vitória'],
  },
  {
    theme: 'esperança',
    keywords: [
      'hope', 'light', 'dawn', 'sunrise', 'tomorrow', 'future', 'star', 'shine', 'dream', 'sky',
      'esperanc', 'luz', 'aurora', 'amanhecer', 'amanha', 'futuro', 'estrela', 'brilh', 'sonho', 'hikari', 'mirai', 'yume',
    ],
    emotion: 'esperança',
    valence: 0.8,
    arousal: 0.58,
    metaphoricalKeywords: ['light', 'luz', 'dawn', 'aurora', 'sunrise', 'sun', 'sol', 'star', 'estrela'],
    narrativeConcepts: ['renovação', 'horizonte aberto', 'promessa de amanhã'],
    combatVisuals: ['luz cortando a escuridão da batalha', 'olhar erguido após a tempestade'],
    dramaVisuals: ['luz solar entrando no quadro', 'olhar para o céu aberto', 'expressão de alívio'],
    contrastThemes: ['desespero', 'solidão'],
  },
  {
    theme: 'desespero',
    keywords: [
      'despair', 'abyss', 'nightmare', 'darkness', 'drowning', 'hopeless', 'trapped', 'terror', 'fear', 'screaming inside',
      'desespero', 'abismo', 'pesadelo', 'escuridao', 'trevas', 'afog', 'sem saida', 'medo', 'pavor', 'yami', 'zetsubou',
    ],
    emotion: 'tensão',
    valence: -0.9,
    arousal: 0.78,
    metaphoricalKeywords: ['abyss', 'abismo', 'drowning', 'afog', 'chains', 'correntes', 'nightmare', 'pesadelo'],
    narrativeConcepts: ['colapso psicológico', 'ameaça esmagadora', 'ponto mais baixo do arco'],
    combatVisuals: ['personagem encurralado', 'sombra avassaladora do inimigo', 'expressão de choque/pavor'],
    dramaVisuals: ['close-up de olhos arregalados', 'cena escura e claustrofóbica'],
    contrastThemes: ['esperança', 'superação'],
  },
  {
    theme: 'afeto',
    keywords: [
      'love', 'heart', 'smile', 'together', 'embrace', 'warmth', 'bond', 'friend', 'by your side', 'gentle',
      'amor', 'coracao', 'sorriso', 'juntos', 'abraco', 'calor', 'laco', 'amigo', 'ao seu lado', 'kokoro', 'kizuna', 'egao',
    ],
    emotion: 'esperança',
    valence: 0.85,
    arousal: 0.42,
    narrativeConcepts: ['vínculo humano', 'ternura', 'razão para lutar ou viver'],
    combatVisuals: ['dupla lutando lado a lado em sincronia', 'lembrança de quem se quer proteger'],
    dramaVisuals: ['sorriso genuíno', 'dois personagens próximos', 'gesto de apoio'],
    contrastThemes: ['solidão', 'vingança'],
  },
];

const STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'are', 'with', 'that', 'this', 'from', 'into', 'your', 'just', 'like', 'when', 'what',
  'uma', 'para', 'com', 'que', 'dos', 'das', 'nos', 'nas', 'por', 'mais', 'como', 'meu', 'minha', 'seu', 'sua', 'nao', 'mas',
]);

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function phraseMatchesKeyword(normalizedText: string, tokens: string[], rawKeyword: string): boolean {
  const needleTokens = normalizeText(rawKeyword).match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!needleTokens.length || needleTokens.length > tokens.length) return false;
  if (needleTokens.length > 1) {
    for (let start = 0; start <= tokens.length - needleTokens.length; start++) {
      const ok = needleTokens.every((part, idx) =>
        part.length <= 3 ? tokens[start + idx] === part : tokens[start + idx]!.startsWith(part),
      );
      if (ok) return true;
    }
    return normalizedText.includes(needleTokens.join(' '));
  }
  const single = needleTokens[0]!;
  return tokens.some((tok) => (single.length <= 3 ? tok === single : tok.startsWith(single)));
}

function energyInWindow(music: MusicAnalysis, startS: number, endS: number): number {
  if (!music.energy.length || music.energyStepS <= 0) return 0.5;
  const i0 = Math.max(0, Math.floor(startS / music.energyStepS));
  const i1 = Math.min(music.energy.length, Math.max(i0 + 1, Math.ceil(endS / music.energyStepS)));
  let sum = 0;
  let count = 0;
  for (let i = i0; i < i1; i++) {
    sum += music.energy[i] ?? 0;
    count++;
  }
  return count ? sum / count : 0.5;
}

function inferAcousticEmotion(energy: number, bpm: number, sectionLabel?: SectionLabel, isDrop = false): MusicEmotionLabel {
  if (isDrop) return energy >= 0.78 ? 'catarse' : 'determinação';
  if (sectionLabel === 'ponte' && energy <= 0.35) return 'melancolia';
  if (sectionLabel === 'pré-refrão') return 'tensão';
  if (sectionLabel === 'final' && energy <= 0.42) return 'solenidade';
  if (energy >= 0.8 && bpm >= 132) return 'fúria';
  if (energy >= 0.72) return 'euforia';
  if (energy >= 0.52) return 'determinação';
  if (energy <= 0.25) return 'calma';
  return bpm <= 98 ? 'melancolia' : 'tensão';
}

/**
 * Interpreta o significado semântico, emocional e visual de um verso/frase da letra,
 * adaptando as sugestões visuais ao contexto da música e do anime.
 */
export function interpretLyricPhrase(
  text: string,
  context: {
    musicEnergy?: number;
    bpm?: number;
    sectionLabel?: SectionLabel;
    animeContext?: AnimeMusicContextHint;
  } = {},
): { meaning: LyricSemanticMeaning; confidence: number } {
  const clean = text.trim();
  const normalized = normalizeText(clean);
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const rawWords = clean.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
  const energy = clamp01(context.musicEnergy ?? 0.5);
  const bpm = context.bpm ?? 120;
  const preferCombat = Boolean(context.animeContext?.hasFights) && (energy >= 0.48 || !context.animeContext?.hasEmotionalDrama);

  const matchedRules: Array<{ rule: ThemeLexiconRule; hits: number; metaphorical: boolean }> = [];
  for (const rule of LEXICON) {
    let hits = 0;
    for (const kw of rule.keywords) {
      if (phraseMatchesKeyword(normalized, tokens, kw)) hits++;
    }
    let metaphorical = false;
    for (const mkw of rule.metaphoricalKeywords ?? []) {
      if (phraseMatchesKeyword(normalized, tokens, mkw)) {
        metaphorical = true;
        hits += 0.5;
      }
    }
    if (hits > 0) matchedRules.push({ rule, hits, metaphorical });
  }

  matchedRules.sort((a, b) => {
    const energyBiasA = 1 - Math.abs(a.rule.arousal - energy) * 0.35;
    const energyBiasB = 1 - Math.abs(b.rule.arousal - energy) * 0.35;
    return b.hits * energyBiasB - a.hits * energyBiasA;
  });

  const heroWords = rawWords
    .filter((w) => {
      const norm = normalizeText(w);
      return norm.length >= 4 && !STOPWORDS.has(norm);
    })
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);

  if (!matchedRules.length) {
    const fallbackEmotion = inferAcousticEmotion(energy, bpm, context.sectionLabel);
    const hasExclamation = /[!?]/.test(clean);
    return {
      meaning: {
        themes: [],
        primaryTheme: null,
        emotionalIntent: fallbackEmotion,
        valence: energy >= 0.55 ? 0.15 : -0.1,
        arousal: clamp01(energy * 0.85 + (hasExclamation ? 0.15 : 0)),
        narrativeConcepts: ['continuidade rítmica e acompanhamento vocal'],
        visualSuggestions: preferCombat
          ? ['acompanhar o fluxo da ação na cadência vocal']
          : ['sustentar expressão ou movimento do personagem durante a frase'],
        heroWords,
        isMetaphorical: false,
        contrastCandidateThemes: [],
        summary: 'Frase sem marcador temático explícito no léxico; guiada pela intenção emocional e prosódia musical.',
      },
      confidence: tokens.length >= 3 ? 0.42 : 0.3,
    };
  }

  const top = matchedRules.slice(0, 3);
  const primary = top[0]!.rule;
  const themes = top.map((item) => item.rule.theme);
  const totalWeight = top.reduce((acc, item) => acc + item.hits, 0) || 1;
  const valence = round3(top.reduce((acc, item) => acc + item.rule.valence * item.hits, 0) / totalWeight);
  const arousal = round3(clamp01(
    (top.reduce((acc, item) => acc + item.rule.arousal * item.hits, 0) / totalWeight) * 0.7 + energy * 0.3,
  ));
  const isMetaphorical = top.some((item) => item.metaphorical);
  const narrativeConcepts = [...new Set(top.flatMap((item) => item.rule.narrativeConcepts))].slice(0, 5);
  const visualSuggestions = [...new Set(top.flatMap((item) =>
    preferCombat ? [...item.rule.combatVisuals, ...item.rule.dramaVisuals.slice(0, 1)] : [...item.rule.dramaVisuals, ...item.rule.combatVisuals.slice(0, 1)],
  ))].slice(0, 5);
  const contrastCandidateThemes = [...new Set(top.flatMap((item) => item.rule.contrastThemes))].slice(0, 4);
  const confidence = round3(clamp01(0.58 + Math.min(0.34, totalWeight * 0.14)));

  return {
    meaning: {
      themes,
      primaryTheme: primary.theme,
      emotionalIntent: primary.emotion,
      valence,
      arousal,
      narrativeConcepts,
      visualSuggestions,
      heroWords,
      isMetaphorical,
      contrastCandidateThemes,
      summary: `Tema central "${primary.theme}" (${primary.emotion})${isMetaphorical ? ' com imagem metafórica' : ''}: sugere ${visualSuggestions.slice(0, 2).join(' ou ')}.`,
    },
    confidence,
  };
}

/** Constrói a grade de compassos reais a partir das batidas, downbeats e métrica (3/4, 4/4, 6/8). */
export function buildMusicBars(music: MusicAnalysis): MusicBar[] {
  const meter: 3 | 4 | 6 = music.meter ?? 4;
  const durationS = music.durationS;
  if (durationS <= 0) return [];
  const boundaries = music.downbeats.length >= 2
    ? [...music.downbeats]
    : music.beats.length >= meter
      ? music.beats.filter((_, idx) => idx % meter === 0)
      : Array.from({ length: Math.max(1, Math.ceil(durationS / (60 / Math.max(60, music.bpm) * meter))) }, (_, idx) =>
          idx * (60 / Math.max(60, music.bpm)) * meter,
        );
  const cleanBounds = boundaries.filter((t) => Number.isFinite(t) && t >= 0 && t < durationS).sort((a, b) => a - b);
  if (!cleanBounds.length || cleanBounds[0]! > 0.35) cleanBounds.unshift(0);

  const bars: MusicBar[] = [];
  for (let i = 0; i < cleanBounds.length; i++) {
    const startTime = round3(cleanBounds[i]!);
    const endTime = round3(i + 1 < cleanBounds.length ? cleanBounds[i + 1]! : durationS);
    if (endTime - startTime < 0.15) continue;
    const beatsInBar = music.beats.filter((b) => b >= startTime - 0.03 && b < endTime - 0.03);
    bars.push({
      index: bars.length,
      startTime,
      endTime,
      beats: beatsInBar,
      energy: round3(energyInWindow(music, startTime, endTime)),
    });
  }
  return bars;
}

function detectVocalAndInstrumentalSpans(
  music: MusicAnalysis,
  validLyrics: Cue[],
  isExplicitlyInstrumental: boolean,
  samples?: Float32Array,
  sampleRate?: number,
): { vocalSpans: VocalActivitySpan[]; instrumentalSpans: InstrumentalSpan[]; isInstrumental: boolean } {
  const durationS = music.durationS;
  if (isExplicitlyInstrumental) {
    return {
      vocalSpans: [],
      instrumentalSpans: durationS > 0 ? [{ startTime: 0, endTime: round3(durationS), energy: round3(energyInWindow(music, 0, durationS)), confidence: 0.95 }] : [],
      isInstrumental: true,
    };
  }

  const vocalSpans: VocalActivitySpan[] = [];
  if (validLyrics.length > 0) {
    const sorted = [...validLyrics]
      .filter((cue) => cue.text.trim().length > 0 && Number.isFinite(cue.startS) && Number.isFinite(cue.endS) && cue.endS > cue.startS)
      .sort((a, b) => a.startS - b.startS);
    for (const cue of sorted) {
      const startTime = round3(Math.max(0, cue.startS));
      const endTime = round3(Math.min(durationS, cue.endS));
      if (endTime <= startTime) continue;
      const prev = vocalSpans.at(-1);
      if (prev && startTime - prev.endTime <= 0.45) {
        prev.endTime = Math.max(prev.endTime, endTime);
      } else {
        vocalSpans.push({ startTime, endTime, source: 'lyrics', confidence: 0.92 });
      }
    }
  } else if (samples && sampleRate && samples.length >= sampleRate) {
    const vf = voiceFeatures(samples, sampleRate, 0.1);
    let activeStart = -1;
    for (let i = 0; i <= vf.t.length; i++) {
      const ratio = i < vf.t.length ? (vf.voiceRatio[i] ?? 0) : 0;
      const db = i < vf.t.length ? (vf.db[i] ?? -90) : -90;
      const hasMidVocal = ratio >= 0.58 && db > -34;
      if (hasMidVocal && activeStart < 0) {
        activeStart = vf.t[i]!;
      } else if (!hasMidVocal && activeStart >= 0) {
        const endT = i < vf.t.length ? vf.t[i]! : durationS;
        if (endT - activeStart >= 0.9) {
          vocalSpans.push({ startTime: round3(activeStart), endTime: round3(Math.min(durationS, endT)), source: 'spectral', confidence: 0.54 });
        }
        activeStart = -1;
      }
    }
  }

  const totalVocalS = vocalSpans.reduce((acc, s) => acc + (s.endTime - s.startTime), 0);
  const vocalCoverage = durationS > 0 ? totalVocalS / durationS : 0;
  const isInstrumental = validLyrics.length === 0 && vocalCoverage < 0.12;

  const instrumentalSpans: InstrumentalSpan[] = [];
  let cursor = 0;
  for (const v of vocalSpans) {
    if (v.startTime - cursor >= 0.75) {
      instrumentalSpans.push({
        startTime: round3(cursor),
        endTime: round3(v.startTime),
        energy: round3(energyInWindow(music, cursor, v.startTime)),
        confidence: validLyrics.length > 0 ? 0.88 : 0.62,
      });
    }
    cursor = Math.max(cursor, v.endTime);
  }
  if (durationS - cursor >= 0.75) {
    instrumentalSpans.push({
      startTime: round3(cursor),
      endTime: round3(durationS),
      energy: round3(energyInWindow(music, cursor, durationS)),
      confidence: validLyrics.length > 0 ? 0.88 : isInstrumental ? 0.85 : 0.62,
    });
  }

  return { vocalSpans, instrumentalSpans, isInstrumental };
}

function classifySectionProfile(
  section: { startS: number; endS: number; label: SectionLabel; energy: number },
  index: number,
  music: MusicAnalysis,
  vocalSpans: VocalActivitySpan[],
  lyricInterpretations: LyricPhraseInterpretation[],
  isSongInstrumental: boolean,
): SectionDirectionProfile {
  const dur = Math.max(0.01, section.endS - section.startS);
  const vocalOverlap = vocalSpans.reduce((sum, v) => {
    const ov = Math.min(section.endS, v.endTime) - Math.max(section.startS, v.startTime);
    return sum + Math.max(0, ov);
  }, 0);
  const vocalPresence = isSongInstrumental ? 0 : round3(clamp01(vocalOverlap / dur));
  const sectionLyrics = lyricInterpretations.filter((l) => l.endTime > section.startS && l.startTime < section.endS);
  const hasDrop = music.drops.some((d) => d >= section.startS - 0.15 && d < section.endS + 0.15);

  const combatThemes = sectionLyrics.filter((l) =>
    l.meaning.themes.some((t) => ['combate', 'fúria', 'confronto_divino', 'vingança', 'superação'].includes(t)),
  ).length;
  const emotionalThemes = sectionLyrics.filter((l) =>
    l.meaning.themes.some((t) => ['solidão', 'perda', 'despedida', 'memória', 'afeto', 'esperança'].includes(t)),
  ).length;

  let archetype: SectionArchetype;
  let strategy: SectionEditorialStrategy;
  let reason: string;

  if (isSongInstrumental || (vocalPresence < 0.15 && sectionLyrics.length === 0)) {
    if (hasDrop || section.energy >= 0.68 || (music.bpm >= 132 && section.energy >= 0.56)) {
      archetype = 'combat';
      strategy = 'impact_choreography';
      reason = `Seção "${section.label}" instrumental de alta energia (${section.energy.toFixed(2)}): priorizar coreografia de ação e impactos rítmicos.`;
    } else {
      archetype = 'instrumental';
      strategy = section.energy <= 0.36 ? 'cinematic_breathing' : 'rhythm_atmosphere';
      reason = `Passagem instrumental em "${section.label}" (energia ${section.energy.toFixed(2)}): conduzir por atmosfera visual, movimento de câmera e respiração.`;
    }
  } else if (hasDrop || section.energy >= 0.72 || (combatThemes > emotionalThemes && section.energy >= 0.52)) {
    archetype = 'combat';
    strategy = 'impact_choreography';
    reason = `Seção "${section.label}" combina alta pressão musical (${section.energy.toFixed(2)}) com intensidade dramática: sincronizar ação, ataques e viradas.`;
  } else if (section.energy <= 0.42 || section.label === 'ponte' || section.label === 'intro' || emotionalThemes > combatThemes) {
    archetype = 'emotional';
    strategy = 'cinematic_breathing';
    reason = `Seção "${section.label}" contida/emocional (energia ${section.energy.toFixed(2)}): sustentar planos expressivos e preservar respiração cinematográfica.`;
  } else {
    archetype = 'narrative';
    strategy = 'story_lyric';
    reason = `Seção "${section.label}" com condução vocal (${Math.round(vocalPresence * 100)}%): alinhar progressão narrativa e sentido da letra às cenas.`;
  }

  const dominantEmotion = sectionLyrics[0]?.meaning.emotionalIntent
    ?? inferAcousticEmotion(section.energy, music.bpm, section.label, hasDrop);
  const allowsLongBreathing = strategy === 'cinematic_breathing' || section.energy <= 0.4 || section.label === 'ponte' || section.label === 'final';

  return {
    index,
    startTime: round3(section.startS),
    endTime: round3(section.endS),
    label: section.label,
    archetype,
    strategy,
    vocalPresence,
    energy: section.energy,
    dominantEmotion,
    allowsLongBreathing,
    reason,
  };
}

function classifyOverallSongArchetype(
  music: MusicAnalysis,
  sectionProfiles: SectionDirectionProfile[],
  lyricInterpretations: LyricPhraseInterpretation[],
  isInstrumental: boolean,
): { archetype: SongArchetype; confidence: number; reason: string } {
  if (isInstrumental) {
    return {
      archetype: 'instrumental',
      confidence: lyricInterpretations.length === 0 ? 0.92 : 0.75,
      reason: 'Faixa sem letra cantada identificada: direção 100% guiada por ritmo, dinâmica, pausas, crescimentos e atmosfera, sem inventar semântica verbal.',
    };
  }

  const energies = sectionProfiles.map((s) => s.energy);
  const minE = energies.length ? Math.min(...energies) : 0.5;
  const maxE = energies.length ? Math.max(...energies) : 0.5;
  const dynamicSpan = maxE - minE;
  const distinctArchetypes = new Set(sectionProfiles.map((s) => s.archetype));
  const hasCalmEmotional = sectionProfiles.some((s) => (s.archetype === 'emotional' || s.archetype === 'instrumental') && s.energy <= 0.42);
  const hasExplosiveCombat = sectionProfiles.some((s) => s.archetype === 'combat' && s.energy >= 0.68);
  const hasSubstantialInstrumental = sectionProfiles.some((s) => s.archetype === 'instrumental' && s.endTime - s.startTime >= 4);

  if ((hasCalmEmotional && hasExplosiveCombat && dynamicSpan >= 0.28)
    || (distinctArchetypes.size >= 3 && dynamicSpan >= 0.24)
    || (lyricInterpretations.length >= 2 && hasSubstantialInstrumental && hasExplosiveCombat)) {
    return {
      archetype: 'hybrid',
      confidence: round3(clamp01(0.74 + dynamicSpan * 0.35)),
      reason: `Música híbrida detectada (contraste energético ${minE.toFixed(2)}→${maxE.toFixed(2)} entre ${distinctArchetypes.size} perfis de seção): alterna estratégia entre respiração/narrativa e impacto rítmico.`,
    };
  }

  const avgEnergy = music.energy.length ? music.energy.reduce((a, b) => a + b, 0) / music.energy.length : 0.5;
  const combatCount = sectionProfiles.filter((s) => s.archetype === 'combat').length;
  const emotionalCount = sectionProfiles.filter((s) => s.archetype === 'emotional').length;
  const uniqueThemes = new Set(lyricInterpretations.flatMap((l) => l.meaning.themes));

  if ((avgEnergy >= 0.62 && (music.bpm >= 126 || music.drops.length > 0)) || combatCount > sectionProfiles.length * 0.55) {
    return {
      archetype: 'combat',
      confidence: round3(clamp01(0.68 + avgEnergy * 0.25)),
      reason: `Música de combate/alta pressão (${music.bpm} BPM, energia média ${avgEnergy.toFixed(2)}, ${music.drops.length} drop(s)): favorece coreografia de confronto e sincronia nos acentos.`,
    };
  }

  if (avgEnergy <= 0.44 || (emotionalCount >= Math.ceil(sectionProfiles.length * 0.5) && music.bpm <= 116)) {
    return {
      archetype: 'emotional',
      confidence: round3(clamp01(0.68 + (0.5 - avgEnergy) * 0.4)),
      reason: `Música emocional/contemplativa (${music.bpm} BPM, energia média ${avgEnergy.toFixed(2)}): prioriza expressões, vínculo de personagem e sustentação de planos.`,
    };
  }

  return {
    archetype: 'narrative',
    confidence: round3(clamp01(0.66 + Math.min(0.24, uniqueThemes.size * 0.05))),
    reason: `Música narrativa com ${lyricInterpretations.length} frase(s) interpretada(s) e ${uniqueThemes.size} eixo(s) temático(s): conduz a montagem pela história e progressão dos versos.`,
  };
}

/**
 * Executa a análise completa do Music Understanding Engine sobre `MusicAnalysis` + letras opcionais.
 */
export function analyzeMusicUnderstanding(
  music: MusicAnalysis,
  options: MusicUnderstandingOptions = {},
): MusicUnderstandingResult {
  const cache = options.cache ?? defaultCreativeAnalysisCache;
  const validLyrics = options.isInstrumental
    ? []
    : (options.lyrics ?? []).filter(
        (cue) => Boolean(cue.text?.trim()) && Number.isFinite(cue.startS) && Number.isFinite(cue.endS) && cue.endS > cue.startS,
      );
  const lyricSig = validLyrics.map((c) => `${c.startS.toFixed(2)}:${c.endS.toFixed(2)}:${c.text.trim()}`).join('|');
  const ctxSig = options.animeContext
    ? `${options.animeContext.hasFights ? 1 : 0}:${options.animeContext.hasEmotionalDrama ? 1 : 0}`
    : 'none';
  const cacheKey = options.assetHash
    ? `${MUSIC_UNDERSTANDING_VERSION}:${options.assetHash}:${music.version}:${music.bpm}:${options.isInstrumental ? 'inst' : lyricSig}:${ctxSig}:${options.includeBeatEvents === false ? 'nobeats' : 'beats'}`
    : '';

  const compute = (): MusicUnderstandingResult => {
    const meter: 3 | 4 | 6 = music.meter ?? 4;
    const bars = buildMusicBars(music);
    const { vocalSpans, instrumentalSpans, isInstrumental } = detectVocalAndInstrumentalSpans(
      music,
      validLyrics,
      Boolean(options.isInstrumental),
      options.samples,
      options.sampleRate,
    );

    // Regra estrita: zero interpretação semântica de letras quando instrumental!
    const lyricInterpretations: LyricPhraseInterpretation[] = isInstrumental
      ? []
      : validLyrics.map((cue, idx) => {
          const midS = (cue.startS + cue.endS) / 2;
          const sec = music.sections.find((s) => midS >= s.startS && midS < s.endS);
          const cueEnergy = energyInWindow(music, cue.startS, cue.endS);
          const interpreted = interpretLyricPhrase(cue.text, {
            musicEnergy: cueEnergy,
            bpm: music.bpm,
            sectionLabel: sec?.label,
            animeContext: options.animeContext,
          });
          return {
            cueKey: `${Math.round(cue.startS * 1000)}:${Math.round(cue.endS * 1000)}:${idx}`,
            startTime: round3(cue.startS),
            endTime: round3(cue.endS),
            text: cue.text.trim(),
            meaning: interpreted.meaning,
            confidence: interpreted.confidence,
          };
        });

    const rawSections = music.sections.length
      ? music.sections
      : [{ startS: 0, endS: music.durationS, label: 'verso' as SectionLabel, energy: round3(energyInWindow(music, 0, music.durationS)) }];

    const sectionProfiles = rawSections.map((sec, idx) =>
      classifySectionProfile(sec, idx, music, vocalSpans, lyricInterpretations, isInstrumental),
    );

    const overall = classifyOverallSongArchetype(music, sectionProfiles, lyricInterpretations, isInstrumental);
    const events: CreativeMusicEvent[] = [];
    const sectionAt = (t: number) => sectionProfiles.find((s) => t >= s.startTime && t < s.endTime) ?? sectionProfiles.at(-1);

    // 1. Seções e Clímax/Encerramento
    for (const sec of sectionProfiles) {
      events.push({
        id: `sec-${sec.index}`,
        startTime: sec.startTime,
        endTime: sec.endTime,
        eventType: sec.label === 'final' ? 'ending' : (sec.label === 'drop' || (sec.label === 'refrão' && sec.energy >= 0.75)) ? 'climax' : 'section',
        lyrics: null,
        semanticMeaning: null,
        emotion: sec.dominantEmotion,
        intensity: sec.energy,
        confidence: round3(clamp01(0.65 + music.bpmConfidence * 0.25)),
        sectionLabel: sec.label,
      });
    }

    // 2. Compassos (bars) e Downbeats
    for (const bar of bars) {
      const sec = sectionAt(bar.startTime);
      events.push({
        id: `bar-${bar.index}`,
        startTime: bar.startTime,
        endTime: bar.endTime,
        eventType: 'bar',
        lyrics: null,
        semanticMeaning: null,
        emotion: sec?.dominantEmotion ?? 'neutro',
        intensity: bar.energy,
        confidence: round3(clamp01(music.bpmConfidence)),
        sectionLabel: sec?.label,
      });
    }
    for (const [idx, db] of music.downbeats.entries()) {
      const sec = sectionAt(db);
      events.push({
        id: `downbeat-${idx}`,
        startTime: round3(db),
        endTime: round3(Math.min(music.durationS, db + 60 / Math.max(30, music.bpm))),
        eventType: 'downbeat',
        lyrics: null,
        semanticMeaning: null,
        emotion: sec?.dominantEmotion ?? 'neutro',
        intensity: round3(energyInWindow(music, db, db + 0.35)),
        confidence: round3(clamp01(music.bpmConfidence)),
        sectionLabel: sec?.label,
      });
    }

    // 3. Batidas individuais (opcionais para consultas leves, ligadas por padrão)
    if (options.includeBeatEvents !== false) {
      const period = 60 / Math.max(30, music.bpm);
      for (const [idx, beat] of music.beats.entries()) {
        const sec = sectionAt(beat);
        events.push({
          id: `beat-${idx}`,
          startTime: round3(beat),
          endTime: round3(Math.min(music.durationS, beat + period)),
          eventType: 'beat',
          lyrics: null,
          semanticMeaning: null,
          emotion: sec?.dominantEmotion ?? 'neutro',
          intensity: round3(energyInWindow(music, beat, beat + 0.2)),
          confidence: round3(clamp01(music.bpmConfidence)),
          sectionLabel: sec?.label,
        });
      }
    }

    // 4. Eventos estruturais derivados de MusicAnalysis (builds, drops, pausas, transições)
    for (const [idx, ev] of (music.events ?? []).entries()) {
      if (ev.type === 'onset') continue;
      const startTime = round3(ev.atS);
      const endTime = round3(Math.min(music.durationS, ev.atS + (ev.durationS ?? 0.35)));
      const sec = sectionAt(startTime);
      const mappedType: CreativeMusicEventType =
        ev.type === 'growth' ? 'build'
          : ev.type === 'drop' ? 'drop'
            : ev.type === 'pause' ? 'pause'
              : ev.type === 'impact' ? 'transition'
                : 'transition';
      events.push({
        id: `mev-${idx}-${mappedType}`,
        startTime,
        endTime: Math.max(startTime + 0.05, endTime),
        eventType: mappedType,
        lyrics: null,
        semanticMeaning: null,
        emotion: mappedType === 'drop' ? 'catarse' : mappedType === 'build' ? 'tensão' : mappedType === 'pause' ? 'calma' : (sec?.dominantEmotion ?? 'neutro'),
        intensity: round3(clamp01(ev.type === 'pause' ? 0.1 : Math.max(ev.strength, energyInWindow(music, startTime, endTime)))),
        confidence: round3(clamp01(ev.confidence)),
        sectionLabel: sec?.label,
      });
    }

    // Garante que drops explícitos de `music.drops` sempre tenham um evento `drop` dedicado
    for (const [idx, dropS] of music.drops.entries()) {
      const alreadyHasDrop = events.some((e) => e.eventType === 'drop' && Math.abs(e.startTime - dropS) <= 0.08);
      if (!alreadyHasDrop) {
        const sec = sectionAt(dropS);
        events.push({
          id: `drop-${idx}`,
          startTime: round3(dropS),
          endTime: round3(Math.min(music.durationS, dropS + 1.5)),
          eventType: 'drop',
          lyrics: null,
          semanticMeaning: null,
          emotion: 'catarse',
          intensity: round3(Math.max(0.75, energyInWindow(music, dropS, dropS + 2))),
          confidence: round3(clamp01(Math.max(0.7, music.bpmConfidence))),
          sectionLabel: sec?.label,
        });
      }
    }

    // 5. Passagens instrumentais
    for (const [idx, inst] of instrumentalSpans.entries()) {
      const sec = sectionAt((inst.startTime + inst.endTime) / 2);
      events.push({
        id: `inst-${idx}`,
        startTime: inst.startTime,
        endTime: inst.endTime,
        eventType: 'instrumental_passage',
        lyrics: null,
        semanticMeaning: null,
        emotion: sec?.dominantEmotion ?? inferAcousticEmotion(inst.energy, music.bpm, sec?.label),
        intensity: inst.energy,
        confidence: inst.confidence,
        sectionLabel: sec?.label,
      });
    }

    // 6. Frases vocais e palavras-chave (SOMENTE quando não é instrumental)
    if (!isInstrumental) {
      for (const [idx, item] of lyricInterpretations.entries()) {
        const sec = sectionAt((item.startTime + item.endTime) / 2);
        events.push({
          id: `lyric-${idx}`,
          startTime: item.startTime,
          endTime: item.endTime,
          eventType: 'vocal_phrase',
          lyrics: item.text,
          semanticMeaning: item.meaning,
          emotion: item.meaning.emotionalIntent,
          intensity: item.meaning.arousal,
          confidence: item.confidence,
          sectionLabel: sec?.label,
        });

        const matchingCue = validLyrics[idx];
        if (matchingCue?.words?.length && item.meaning.heroWords.length) {
          const heroNorms = new Set(item.meaning.heroWords.map(normalizeText));
          for (const [wIdx, w] of matchingCue.words.entries()) {
            if (!heroNorms.has(normalizeText(w.text))) continue;
            events.push({
              id: `kw-${idx}-${wIdx}`,
              startTime: round3(w.startS),
              endTime: round3(Math.max(w.startS + 0.08, w.endS)),
              eventType: 'lyric_keyword',
              lyrics: w.text,
              semanticMeaning: item.meaning,
              emotion: item.meaning.emotionalIntent,
              intensity: round3(clamp01(item.meaning.arousal + 0.1)),
              confidence: round3(clamp01(Math.min(item.confidence, w.confidence ?? 0.85))),
              sectionLabel: sec?.label,
            });
          }
        }
      }
    }

    events.sort((a, b) => a.startTime - b.startTime || a.eventType.localeCompare(b.eventType));

    return {
      version: MUSIC_UNDERSTANDING_VERSION,
      durationS: music.durationS,
      bpm: music.bpm,
      bpmConfidence: music.bpmConfidence,
      meter,
      tempoVariable: Boolean(music.tempoVariable),
      archetype: overall.archetype,
      archetypeConfidence: overall.confidence,
      archetypeReason: overall.reason,
      isInstrumental,
      bars,
      vocalSpans,
      instrumentalSpans,
      sectionProfiles,
      lyricInterpretations,
      events,
    };
  };

  if (cacheKey) {
    return cache.getOrComputeMusic(cacheKey, compute).value as MusicUnderstandingResult;
  }
  return compute();
}
