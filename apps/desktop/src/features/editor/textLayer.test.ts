import { describe, expect, it } from 'vitest';
import type { TextWordTiming } from '@amv/project';
import { splitTimedText } from './textLayer.js';

const timing = (text: string, startUs: number): TextWordTiming => ({
  text,
  startUs,
  endUs: startUs + 200_000,
  source: 'ass',
  confidence: 1,
  uncertain: false,
  color: null,
  scale: null,
  offsetX: null,
  offsetY: null,
  weight: null,
  syllables: [],
});

describe('segmentos de texto cronometrados', () => {
  it('mantém segmentos ASS contíguos em escrita sem espaços', () => {
    expect(splitTimedText('夢をつかめ', [timing('夢を', 0), timing('つかめ', 200_000)])).toEqual([
      { text: '夢を', timingIndex: 0 },
      { text: 'つかめ', timingIndex: 1 },
    ]);
  });

  it('preserva pontuação junto da sílaba que recebeu o tempo ASS', () => {
    expect(splitTimedText('vencer!', [timing('ven', 0), timing('cer!', 200_000)])).toEqual([
      { text: 'ven', timingIndex: 0 },
      { text: 'cer!', timingIndex: 1 },
    ]);
  });

  it('não força timestamps quando os segmentos não correspondem ao texto', () => {
    expect(splitTimedText('texto atual', [timing('texto antigo', 0)])).toBeNull();
  });
});
