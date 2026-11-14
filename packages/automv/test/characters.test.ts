import { describe, expect, it } from 'vitest';
import { canonicalizeEpisodeVision } from '../src/characters.js';

describe('biblioteca de personagens do projeto', () => {
  it('resolve aliases confirmados para o nome canônico, remove duplicatas e preserva o cache', () => {
    const vision = {
      version: 'v2' as const,
      model: 'local',
      shots: {
        t100: { characters: ['garoto de cabelo branco', 'asta', ' Asta '], fight: true, note: '' },
      },
    };
    const library = [{
      id: 'asta',
      name: 'Asta',
      aliases: ['garoto de cabelo branco'],
      evidence: [],
      confidence: 0.8,
      confirmed: true,
    }];

    expect(canonicalizeEpisodeVision(vision, library)?.shots.t100?.characters).toEqual(['Asta']);
    expect(vision.shots.t100.characters).toEqual(['garoto de cabelo branco', 'asta', ' Asta ']);
    expect(canonicalizeEpisodeVision(null, library)).toBeUndefined();
  });

  it('não promove sugestões não confirmadas a identidade canônica', () => {
    const vision = {
      version: 'v2' as const,
      model: 'local',
      shots: {
        t200: { characters: ['garoto de cabelo branco', 'Asta', 'personagem desconhecido'], fight: false, note: '' },
      },
    };
    const library = [{
      id: 'asta',
      name: 'Asta',
      aliases: ['garoto de cabelo branco'],
      evidence: [],
      confidence: 0.4,
      confirmed: false,
    }];

    expect(canonicalizeEpisodeVision(vision, library)?.shots.t200?.characters)
      .toEqual(['garoto de cabelo branco', 'Asta', 'personagem desconhecido']);
  });

  it('deduplica labels equivalentes sem diferenciar maiúsculas e acentos', () => {
    const vision = {
      version: 'v2' as const,
      model: 'local',
      shots: {
        t300: { characters: ['José', 'jose', ' JOSÉ '], fight: false, note: '' },
      },
    };

    expect(canonicalizeEpisodeVision(vision, [])?.shots.t300?.characters).toEqual(['José']);
  });
});
