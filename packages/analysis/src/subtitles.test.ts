import { describe, expect, it } from 'vitest';
import { parseAss, parseLrc, parseVtt } from './subtitles';

describe('subtitle files', () => {
  it('keeps imported song styles and dialogue styles containing ed, while filtering signs', () => {
    const file = '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Song,,0,0,0,,{\\k100}Hello {\\k100}world\nDialogue: 0,0:00:03.00,0:00:03.50,Sign,,0,0,0,,PLACA\nDialogue: 0,0:00:04.00,0:00:06.00,Default-Red,,0,0,0,,Stay here';
    expect(parseAss(file).map((cue) => cue.text)).toEqual(['Hello world', 'Stay here']);
    expect(parseAss(file, true).map((cue) => cue.text)).toEqual(['Stay here']);
  });
  it('applies LRC millisecond offsets to lines and reliable words', () => {
    const cues = parseLrc('[offset:-250]\n[00:01.00]<00:01.00>Hello <00:02.00>world\n[00:03.00]Next', 5);
    expect(cues[0]?.startS).toBe(0.75);
    expect(cues[0]?.words?.map((word) => [word.startS, word.endS])).toEqual([[0.75, 1.75], [1.75, 2.75]]);
    expect(cues[1]?.endS).toBe(5);
  });
  it('reads short VTT timestamps', () => {
    expect(parseVtt('WEBVTT\n\n00:01.200 --> 00:02.500\nOlá\n')[0]).toEqual({ startS: 1.2, endS: 2.5, text: 'Olá' });
  });
});