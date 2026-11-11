import { describe, expect, it } from 'vitest';
import { DEFAULT_CREATIVE_PROFILES, creativeEmphasis, parseCreativeProfiles } from '../src/creative-profiles.js';
import { scoreSceneCandidate, type SceneScoringInput } from '../src/scoring.js';
import { styleDef } from '../src/styles.js';

const actionScene: SceneScoringInput = {
  shot: {
    startS: 1, endS: 3, motion: 0.8, loud: 0.8, intensity: 0.8, brightness: 0.5,
    tags: ['ação', 'impacto'], line: null, peakS: 2,
  },
  targetIntensity: 0.8,
  musicEnergy: 0.8,
  isDrop: false,
  narrativeRole: 'climax',
  style: styleDef('hype'),
  current: { assetId: 'episode', sequenceId: 'fight', sourceStartS: 1 },
};

describe('perfis criativos', () => {
  it('fornece perfis reutilizáveis que configuram o gerador sem alterar valores fora do perfil', () => {
    const combat = DEFAULT_CREATIVE_PROFILES.find((profile) => profile.id === 'builtin:combat')!;
    expect(combat).toMatchObject({
      style: 'hype',
      focus: 'fight',
      organizationMode: 'narrative',
      actionEmphasis: 85,
      emotionEmphasis: 35,
      preferredEmotion: 'determinação',
    });
    expect(creativeEmphasis(combat)).toEqual({ action: 85, emotion: 35, preferredEmotion: 'determinação' });
  });

  it('valida o armazenamento e recusa identificadores, nomes ou parâmetros duplicados/inválidos', () => {
    const profile = {
      ...DEFAULT_CREATIVE_PROFILES[0]!,
      id: 'custom:one',
      name: 'Meu perfil',
    };
    expect(parseCreativeProfiles([profile])).toEqual([profile]);
    expect(() => parseCreativeProfiles([profile, profile])).toThrow(/identificador|duplicado/i);
    expect(() => parseCreativeProfiles([{ ...profile, intensity: 9 }])).toThrow(/configurações inválidas/i);
    expect(() => parseCreativeProfiles([{ ...profile, id: 'builtin:combat' }])).toThrow(/identificador/i);
  });

  it('mantém compatibilidade com perfis salvos antes da opção de velocidade adaptativa', () => {
    const { adaptiveSpeed: _adaptiveSpeed, ...legacyProfile } = {
      ...DEFAULT_CREATIVE_PROFILES[0]!,
      id: 'custom:legacy',
      name: 'Perfil antigo',
    };
    expect(parseCreativeProfiles([legacyProfile])[0]?.adaptiveSpeed).toBe(true);
  });

  it('muda a prioridade de seleção somente com base nos sinais de cena disponíveis', () => {
    const balanced = scoreSceneCandidate({
      ...actionScene,
      creativeEmphasis: { action: 50, emotion: 50, preferredEmotion: null },
    });
    const actionFocused = scoreSceneCandidate({
      ...actionScene,
      creativeEmphasis: { action: 100, emotion: 0, preferredEmotion: null },
    });

    expect(balanced.total).toBe(scoreSceneCandidate(actionScene).total);
    expect(actionFocused.total).toBeGreaterThan(balanced.total);
    expect(actionFocused.reasons).toContain('peso de ação do perfil (100%) aplicado às evidências disponíveis');
  });
});
