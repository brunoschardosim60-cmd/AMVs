import { describe, expect, it } from 'vitest';
import { canonicalizeEpisodeVision } from '../src/characters.js';

describe('biblioteca de personagens do projeto', () => {
  it('resolve grafias reconhecidas para o nome canônico sem alterar o cache original', () => {
    const vision = {
      version: 'v2' as const,
      model: 'local',
      shots: {
        t100: { characters: ['garoto de cabelo branco', 'asta'], fight: true, note: '' },
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

    expect(canonicalizeEpisodeVision(vision, library)?.shots.t100?.characters).toEqual(['Asta', 'Asta']);
    expect(vision.shots.t100.characters).toEqual(['garoto de cabelo branco', 'asta']);
    expect(canonicalizeEpisodeVision(null, library)).toBeUndefined();
  });
});
