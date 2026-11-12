import type { Cue, Shot, ShotVision } from '@amv/analysis';
import type { Candidate } from './generate.js';

export interface LyricSceneMatch {
  score: number;
  reason: string;
}

export type LyricMatchMap = Record<string, Record<string, LyricSceneMatch>>;

interface SemanticTheme {
  name: string;
  keywords: string[];
  test: (candidate: Candidate, vision?: ShotVision) => { match: boolean; boost: number; reason: string };
}

const THEMES: SemanticTheme[] = [
  {
    name: 'combate',
    keywords: [
      'fight', 'luta', 'batalh', 'war', 'guerra', 'hit', 'golpe', 'strike',
      'punch', 'soco', 'kick', 'chute', 'sword', 'espada', 'blade', 'lâmina',
      'blood', 'sangue', 'kill', 'matar', 'destroy', 'destruir', 'enemy', 'inimigo',
      'smash', 'crush', 'esmagar', 'battle', 'clash',
    ],
    test: (c, vision) => {
      const isCombat = vision?.action === 'combate' || c.shot.tags.includes('impacto') || c.shot.tags.includes('ação');
      if (isCombat) {
        return {
          match: true,
          boost: vision?.action === 'combate' ? 0.85 : 0.72,
          reason: 'ação e combate visual combinam com a letra de confronto',
        };
      }
      return { match: false, boost: 0, reason: '' };
    },
  },
  {
    name: 'poder_determinação',
    keywords: [
      'power', 'poder', 'strong', 'forte', 'god', 'deus', 'king', 'rei',
      'rise', 'ergue', 'levanta', 'stand', 'never give up', 'não vou desistir',
      'hope', 'esperanç', 'dream', 'sonho', 'alive', 'vivo', 'win', 'venc',
      'champion', 'campeão', 'faith', 'fé', 'destiny', 'destino', 'unleash',
    ],
    test: (c, vision) => {
      const isDetermined = vision?.emotion === 'determinação' || (c.shot.intensity >= 0.7 && c.shot.motion >= 0.5);
      if (isDetermined) {
        return {
          match: true,
          boost: vision?.emotion === 'determinação' ? 0.88 : 0.68,
          reason: 'intensidade e expressão de determinação casam com a mensagem de superação',
        };
      }
      return { match: false, boost: 0, reason: '' };
    },
  },
  {
    name: 'fogo_calor',
    keywords: [
      'fire', 'fogo', 'flame', 'chama', 'burn', 'queim', 'blaze', 'inferno',
      'heat', 'calor', 'ember', 'brasa', 'spark', 'faísca', 'ignite', 'explos',
    ],
    test: (c, vision) => {
      const local = vision?.local;
      const dominant = local?.dominantColors ?? [];
      const hasWarmColor = dominant.some((color) => {
        const hex = color.replace('#', '');
        if (hex.length < 6) return false;
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return r > 160 && r > b * 1.5;
      });
      const highMotion = c.shot.motion >= 0.65 || c.shot.tags.includes('impacto');
      if (hasWarmColor || highMotion) {
        return {
          match: true,
          boost: hasWarmColor ? 0.8 : 0.62,
          reason: 'tonalidade de cores quentes e energia visual reforçam a temática de fogo/chamas',
        };
      }
      return { match: false, boost: 0, reason: '' };
    },
  },
  {
    name: 'escuridão_noite',
    keywords: [
      'dark', 'escur', 'shadow', 'sombr', 'night', 'noite', 'black', 'negro',
      'preto', 'abyss', 'abismo', 'void', 'vazio', 'cold', 'frio', 'blind', 'cego',
    ],
    test: (c, vision) => {
      const brightness = vision?.local?.brightness ?? c.shot.brightness;
      if (brightness < 0.38) {
        return {
          match: true,
          boost: 0.82,
          reason: 'atmosfera escura e dramática coincide com o verso de escuridão/noite',
        };
      }
      return { match: false, boost: 0, reason: '' };
    },
  },
  {
    name: 'luz_brilho',
    keywords: [
      'light', 'luz', 'shine', 'brilh', 'sun', 'sol', 'gold', 'ouro',
      'star', 'estrel', 'beam', 'raio', 'flash', 'clarão', 'lightning', 'trovão',
      'relâmpag', 'white', 'branco',
    ],
    test: (c, vision) => {
      const brightness = vision?.local?.brightness ?? c.shot.brightness;
      if (brightness > 0.62 || c.shot.tags.includes('impacto')) {
        return {
          match: true,
          boost: brightness > 0.62 ? 0.8 : 0.65,
          reason: 'iluminação intensa e claridade visual casam com o verso luminoso',
        };
      }
      return { match: false, boost: 0, reason: '' };
    },
  },
  {
    name: 'emoção_dor_lágrimas',
    keywords: [
      'cry', 'chora', 'tear', 'lágrima', 'pain', 'dor', 'hurt', 'ferid',
      'suffer', 'sofr', 'alone', 'sozinh', 'sad', 'triste', 'grief', 'luto',
      'heart', 'coração', 'bleed', 'sangr', 'broken', 'quebrad',
    ],
    test: (c, vision) => {
      const isSad = vision?.emotion === 'tristeza' || c.shot.tags.includes('calma');
      const isCloseUp = vision?.framing === 'close-up' || vision?.framing === 'extreme-close-up';
      if (isSad || isCloseUp) {
        return {
          match: true,
          boost: vision?.emotion === 'tristeza' ? 0.9 : 0.65,
          reason: 'expressão emocional e plano fechado ressoam com o teor sentimental da letra',
        };
      }
      return { match: false, boost: 0, reason: '' };
    },
  },
  {
    name: 'velocidade_movimento',
    keywords: [
      'run', 'corr', 'fast', 'rápid', 'speed', 'velocidad', 'fly', 'voa',
      'soar', 'sky', 'céu', 'wind', 'vento', 'storm', 'tempestade', 'fall',
      'cai', 'queda', 'drop', 'jump', 'pula', 'salt', 'escape', 'fugir',
    ],
    test: (c, vision) => {
      const highMotion = c.shot.motion >= 0.55 || vision?.action === 'perseguição';
      if (highMotion) {
        return {
          match: true,
          boost: 0.8,
          reason: 'velocidade e dinâmica de movimento acelerado sincronizados com a letra',
        };
      }
      return { match: false, boost: 0, reason: '' };
    },
  },
];

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Faz a correspondência semântica automática entre a letra da música e as cenas candidatas.
 * Funciona de forma totalmente local e determinística, sem depender de rede ou de chaves de API externas.
 */
export function matchLyricsSemantics(
  cues: Cue[],
  candidates: Candidate[],
  visionOf?: (c: Candidate) => ShotVision | undefined,
): LyricMatchMap {
  const result: LyricMatchMap = {};

  for (const cue of cues) {
    if (!cue.text?.trim()) continue;
    const normCue = normalizeText(cue.text);
    const cueKey = `${Math.round(cue.startS * 1000)}-${Math.round(cue.endS * 1000)}`;

    // Identifica quais temas semânticos a estrofe da letra aborda
    const activeThemes: { theme: SemanticTheme; matchCount: number }[] = [];
    for (const theme of THEMES) {
      let count = 0;
      for (const kw of theme.keywords) {
        if (normCue.includes(kw)) count++;
      }
      if (count > 0) activeThemes.push({ theme, matchCount: count });
    }

    if (!activeThemes.length) continue;

    // Avalia os candidatos para essa linha da letra
    for (const candidate of candidates) {
      const vision = visionOf ? visionOf(candidate) : undefined;
      let bestScore = 0;
      let bestReason = '';

      for (const { theme } of activeThemes) {
        const testResult = theme.test(candidate, vision);
        if (testResult.match && testResult.boost > bestScore) {
          bestScore = testResult.boost;
          bestReason = testResult.reason;
        }
      }

      // Verifica também se o personagem fala algo parecido no episódio
      const overlappingSpeech = candidate.ep.analysis.speech.find(
        (sp) => sp.startS >= candidate.shot.startS - 0.5 && sp.endS <= candidate.shot.endS + 0.5,
      );
      if (overlappingSpeech?.text) {
        const normSpeech = normalizeText(overlappingSpeech.text);
        const commonWord = activeThemes.some(({ theme }) =>
          theme.keywords.some((kw) => normSpeech.includes(kw)),
        );
        if (commonWord) {
          bestScore = Math.min(0.98, bestScore + 0.15);
          bestReason = `fala do personagem coincide tematicamente com a letra: "${cue.text}"`;
        }
      }

      if (bestScore >= 0.55) {
        result[candidate.id] ??= {};
        result[candidate.id]![cueKey] = {
          score: Math.round(bestScore * 100) / 100,
          reason: bestReason,
        };
      }
    }
  }

  return result;
}
