import { describe, expect, it } from 'vitest';
import { parseAss } from '../src/subtitles.js';

const ass = (content: string) => `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:02.00,0:00:04.50,Karaoke,,0,0,0,,${content}\n`;

describe('temporização de karaokê ASS', () => {
  it('preserva sílabas e pontuação no fim da palavra', () => {
    expect(parseAss(ass('{\\k20}ven{\\k30}cer!'))[0]?.words).toEqual([
      {
        text: 'vencer!',
        startS: 2,
        endS: 2.5,
        source: 'ass',
        confidence: 1,
        syllables: [
          { text: 'ven', startS: 2, endS: 2.2, source: 'ass', confidence: 1 },
          { text: 'cer!', startS: 2.2, endS: 2.5, source: 'ass', confidence: 1 },
        ],
      },
    ]);
  });

  it('preserva runs japoneses contíguos sem inventar tempos', () => {
    expect(parseAss(ass('{\\k20}夢を{\\k30}つかめ'))[0]?.words).toEqual([
      { text: '夢を', startS: 2, endS: 2.2, source: 'ass', confidence: 1, syllables: [{ text: '夢を', startS: 2, endS: 2.2, source: 'ass', confidence: 1 }] },
      { text: 'つかめ', startS: 2.2, endS: 2.5, source: 'ass', confidence: 1, syllables: [{ text: 'つかめ', startS: 2.2, endS: 2.5, source: 'ass', confidence: 1 }] },
    ]);
  });
});
