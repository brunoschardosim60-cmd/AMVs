import { describe, expect, it } from 'vitest';
import { parseSceneSearchFilters } from './search.js';

describe('filtros da busca semântica de cenas', () => {
  it('aceita somente filtros estruturados conhecidos', () => {
    expect(parseSceneSearchFilters(JSON.stringify({
      character: 'Asta',
      action: 'combate',
      emotion: null,
      framing: 'close-up',
      sceneType: 'action',
      text: 'olhos',
    }))).toEqual({
      character: 'Asta',
      action: 'combate',
      emotion: null,
      framing: 'close-up',
      sceneType: 'action',
      text: 'olhos',
    });
  });

  it('recusa rótulos que não existem na análise', () => {
    expect(() => parseSceneSearchFilters('{"character":null,"action":"voar","emotion":null,"framing":null,"sceneType":null,"text":null}'))
      .toThrow('A ação retornada não é suportada.');
    expect(() => parseSceneSearchFilters('não é json')).toThrow();
  });
});
