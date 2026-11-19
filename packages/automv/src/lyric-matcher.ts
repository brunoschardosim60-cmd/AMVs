import type { Cue, ShotVision } from '@amv/analysis';
import type { Candidate } from './generate.js';
import { lyricCueKey } from './lyric-cue-key.js';

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

function normalizeText(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function trustedVision(vision: ShotVision | undefined): vision is ShotVision & { confidence: number } {
  const confidence = vision?.confidence;
  return typeof confidence === 'number' && Number.isFinite(confidence) && confidence >= 0.55 && confidence <= 1;
}

/** Prefixes/stems are allowed, but only at token boundaries; no substring matches. */
function keywordMatches(text: string, keyword: string): boolean {
  const tokens = normalizeText(text).match(/[\p{L}\p{N}]+/gu) ?? [];
  const needle = normalizeText(keyword).match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!needle.length || needle.length > tokens.length) return false;
  for (let start = 0; start <= tokens.length - needle.length; start++) {
    if (needle.every((part, index) => (
      part.length <= 3
        ? tokens[start + index] === part
        : tokens[start + index]!.startsWith(part)
    ))) return true;
  }
  return false;
}

function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => keywordMatches(text, keyword));
}

function hasDeterminedExpression(vision: ShotVision | undefined): boolean {
  if (!trustedVision(vision)) return false;
  return (vision.expressions ?? []).some((expression) =>
    expression.confidence >= 0.55
      && ['determinacao', 'determined', 'determination'].includes(normalizeText(expression.label)),
  );
}

const THEMES: SemanticTheme[] = [
  {
    name: 'combate',
    keywords: [
      'fight', 'luta', 'batalh', 'war', 'guerra', 'hit', 'golpe', 'strike',
      'punch', 'soco', 'kick', 'chute', 'sword', 'espada', 'blade', 'lamina',
      'blood', 'sangue', 'kill', 'matar', 'destroy', 'destruir', 'enemy', 'inimigo',
      'smash', 'crush', 'esmagar', 'battle', 'clash', 'demon', 'demonio', 'devil',
      'magic', 'magia', 'spell', 'feitico', 'attack', 'ataque', 'slash', 'cortar',
      'defeat', 'derrotar', 'confronto', 'corrente', 'chain',
    ],
    test: (candidate, vision) => {
      const semanticCombat = trustedVision(vision) && vision.action === 'combate';
      const taggedCombat = candidate.shot.tags.includes('impacto') || candidate.shot.tags.includes('ação');
      if (semanticCombat || taggedCombat) return {
        match: true,
        boost: semanticCombat ? 0.86 : 0.7,
        reason: semanticCombat
          ? 'ação de combate identificada pela análise visual confiável'
          : 'tag local de ação/impacto compatível com a letra de confronto',
      };
      return { match: false, boost: 0, reason: '' };
    },
  },
  {
    name: 'poder_determinacao',
    keywords: [
      'power', 'poder', 'strong', 'forte', 'god', 'deus', 'king', 'rei',
      'rise', 'ergue', 'erga', 'levanta', 'stand', 'never give up', 'nao vou desistir',
      'arise', 'despert', 'surpass', 'superar',
      'hope', 'esperanc', 'dream', 'sonho', 'alive', 'vivo', 'win', 'venc',
      'champion', 'campeao', 'faith', 'fe', 'destiny', 'destino', 'unleash',
      'limit', 'limite', 'courage', 'coragem', 'force', 'forca', 'glory', 'gloria',
    ],
    test: (candidate, vision) => {
      const emotion = trustedVision(vision) && vision.emotion === 'determinação';
      const expression = hasDeterminedExpression(vision);
      const localHighImpact = Boolean(
        vision?.local
        && (vision.confidence === undefined || vision.confidence >= 0.55)
        && vision.local.entropy >= 0.58
        && vision.local.saturation >= 0.5
        && candidate.shot.intensity >= 0.72,
      );
      if (emotion || expression || localHighImpact) return {
        match: true,
        boost: emotion ? 0.88 : expression ? 0.78 : 0.68,
        reason: emotion
          ? 'emoção de determinação identificada com confiança suficiente'
          : expression
            ? 'expressão de determinação identificada com confiança suficiente'
            : 'energia visual e contraste altos combinam com verso de superação/poder',
      };
      return { match: false, boost: 0, reason: '' };
    },
  },
  {
    name: 'fogo_calor',
    keywords: [
      'fire', 'fogo', 'flame', 'chama', 'burn', 'queim', 'blaze', 'inferno',
      'heat', 'calor', 'ember', 'brasa', 'spark', 'faisca', 'ignite', 'explos',
    ],
    test: (_candidate, vision) => {
      const explicit = trustedVision(vision) && containsAny(
        vision.note,
        ['fire', 'fogo', 'flame', 'chama', 'queim', 'incendio', 'lava', 'brasa', 'explos'],
      );
      const hasWarmPalette = (vision?.local?.dominantColors ?? []).some((hex) => {
        if (!/^#[0-9a-f]{6}$/i.test(hex)) return false;
        const r = Number.parseInt(hex.slice(1, 3), 16);
        const b = Number.parseInt(hex.slice(5, 7), 16);
        return r >= 160 && r > b * 1.45;
      });
      const localWarmth = Boolean(
        vision?.local
        && (vision.confidence === undefined || vision.confidence >= 0.55)
        && vision.local.saturation >= 0.55
        && vision.local.brightness >= 0.42
        && hasWarmPalette,
      );
      if (explicit || localWarmth) return {
        match: true,
        boost: explicit ? 0.78 : 0.7,
        reason: explicit
          ? 'descrição visual confiável menciona fogo, chama ou explosão'
          : 'paleta quente e saturada local combina com cena de fogo/energia',
      };
      return { match: false, boost: 0, reason: '' };
    },
  },
  {
    name: 'escuridao_noite',
    keywords: [
      'dark', 'escur', 'shadow', 'sombr', 'night', 'noite', 'black', 'negro', 'preto',
      'abyss', 'abismo', 'void', 'vazio', 'fear', 'medo', 'death', 'morte', 'die', 'morrer',
      'monster', 'monstro', 'nightmare', 'pesadelo', 'trevas', 'despair', 'desespero',
    ],
    test: (candidate, vision) => {
      const brightness = vision?.local?.brightness ?? candidate.shot.brightness;
      if (Number.isFinite(brightness) && brightness < 0.38) return {
        match: true,
        boost: 0.72,
        reason: 'baixa luminância local combina com a atmosfera escura citada na letra',
      };
      return { match: false, boost: 0, reason: '' };
    },
  },
  {
    name: 'luz_brilho',
    keywords: [
      'light', 'luz', 'shine', 'brilh', 'sun', 'sol', 'gold', 'ouro', 'star', 'estrel',
      'beam', 'raio', 'flash', 'clarao', 'lightning', 'trovao', 'relampag', 'white', 'branco',
      'sacred', 'sagrado', 'heaven', 'divin',
    ],
    test: (candidate, vision) => {
      const brightness = vision?.local?.brightness ?? candidate.shot.brightness;
      if (Number.isFinite(brightness) && brightness > 0.68) return {
        match: true,
        boost: 0.76,
        reason: 'alta luminância local combina com a imagem luminosa citada na letra',
      };
      return { match: false, boost: 0, reason: '' };
    },
  },
  {
    name: 'emocao_dor_lagrimas',
    keywords: [
      'cry', 'chora', 'tear', 'lagrima', 'pain', 'dor', 'hurt', 'ferid', 'suffer', 'sofr',
      'alone', 'sozinh', 'sad', 'triste', 'grief', 'luto', 'heart', 'coracao',
      'bleed', 'sangr', 'broken', 'quebrad', 'solidao', 'adeus', 'goodbye', 'scar', 'cicatriz',
      'scream', 'gritar', 'angust', 'salvar', 'save',
    ],
    test: (candidate, vision) => {
      const emotion = trustedVision(vision) && vision.emotion === 'tristeza';
      const expression = trustedVision(vision) && (vision.expressions ?? []).some((item) =>
        item.confidence >= 0.55 && ['tristeza', 'sad', 'crying', 'chorando'].includes(normalizeText(item.label)),
      );
      const localQuietDrama = Boolean(
        vision?.local
        && (vision.confidence === undefined || vision.confidence >= 0.55)
        && candidate.shot.tags.includes('calma')
        && (vision.local.brightness ?? candidate.shot.brightness) < 0.45
        && (vision.local.saturation ?? 0.5) < 0.45,
      );
      if (emotion || expression || localQuietDrama) return {
        match: true,
        boost: emotion ? 0.9 : expression ? 0.8 : 0.66,
        reason: emotion || expression
          ? 'tristeza reconhecida por emoção ou expressão visual confiável'
          : 'tom contido e dessaturado combina com verso dramático/emocional',
      };
      return { match: false, boost: 0, reason: '' };
    },
  },
  {
    name: 'velocidade_movimento',
    // 'drop' sozinho costuma indicar o drop musical, não uma queda física do personagem.
    keywords: [
      'run', 'corr', 'fast', 'rapid', 'speed', 'velocidad', 'fly', 'voa', 'soar', 'sky', 'ceu',
      'wind', 'vento', 'storm', 'tempestade', 'fall', 'cai', 'queda', 'jump', 'pula', 'salt',
      'escape', 'fugir', 'come on', 'rush', 'dash',
    ],
    test: (candidate, vision) => {
      const chase = trustedVision(vision) && vision.action === 'perseguição';
      const motion = Number.isFinite(candidate.shot.motion) && candidate.shot.motion >= 0.55;
      if (chase || motion) return {
        match: true,
        boost: chase ? 0.86 : 0.72,
        reason: chase ? 'perseguição identificada pela análise visual confiável' : 'movimento medido na cena combina com a ideia de velocidade',
      };
      return { match: false, boost: 0, reason: '' };
    },
  },
];

function matchedSpeech(candidate: Candidate, themes: SemanticTheme[]): boolean {
  const shot = candidate.shot;
  const duration = Math.max(0, shot.endS - shot.startS);
  return candidate.ep.analysis.speech.some((speech) => {
    if (!speech.text?.trim() || !Number.isFinite(speech.confidence) || speech.confidence < 0.65) return false;
    const overlap = Math.min(shot.endS, speech.endS) - Math.max(shot.startS, speech.startS);
    if (overlap < Math.min(0.25, duration * 0.25)) return false;
    return themes.some((theme) => theme.keywords.some((keyword) => keywordMatches(speech.text!, keyword)));
  });
}

/** Local thematic cue: not a probability score and not a speaker-identity system. */
export function matchLyricsSemantics(
  cues: Cue[],
  candidates: Candidate[],
  visionOf?: (candidate: Candidate) => ShotVision | undefined,
): LyricMatchMap {
  const result: LyricMatchMap = {};
  for (const cue of cues) {
    if (!cue.text?.trim() || !Number.isFinite(cue.startS) || !Number.isFinite(cue.endS) || cue.endS <= cue.startS) continue;
    const themes = THEMES.filter((theme) => theme.keywords.some((keyword) => keywordMatches(cue.text, keyword)));
    if (!themes.length) continue;
    const cueKey = lyricCueKey(cue);

    for (const candidate of candidates) {
      const vision = visionOf ? visionOf(candidate) : undefined;
      let bestScore = 0;
      let bestReason = '';
      for (const theme of themes) {
        const match = theme.test(candidate, vision);
        if (match.match && match.boost > bestScore) {
          bestScore = match.boost;
          bestReason = match.reason;
        }
      }
      if (matchedSpeech(candidate, themes)) {
        const speechReason = 'fala reconhecida no mesmo plano reforça o tema lexical da letra (sem identificar quem fala)';
        if (bestScore < 0.58) {
          bestScore = 0.58;
          bestReason = speechReason;
        } else {
          // Keep the stronger visual rationale; speech is corroborating evidence, not a replacement.
          bestReason = bestReason ? bestReason + '; ' + speechReason : speechReason;
        }
      }
      if (bestScore >= 0.55) {
        result[candidate.id] ??= {};
        result[candidate.id]![cueKey] = { score: Math.round(bestScore * 100) / 100, reason: bestReason };
      }
    }
  }
  return result;
}
