import { describe, expect, it } from 'vitest';
import { alignUntimedLyrics, alignUntimedLyricsWithFallback, promoteAlignedCuesForTypography, restyleSubtitles, subtitleClip } from './index';
import { applyCommand, createProject } from '@amv/project';

describe('local lyric alignment', () => {
  it('preserves original words and times when an existing caption receives impact styling', () => {
    const project = createProject({ name: 'Impact' });
    const track = project.tracks.find((item) => item.kind === 'text');
    if (!track) throw new Error('Missing text track');
    const clip = subtitleClip(project, track.id, 0, 1_000_000, 'Eu vou', 'legenda', null, [{ text: 'Eu', startUs: 0, endUs: 500_000, source: 'ass', confidence: 1, uncertain: false, syllables: [] }]);
    project.clips.push(clip);
    const result = applyCommand(project, { type: 'batch', commands: restyleSubtitles(project, [clip.id], 'anime-impact') }).project;
    expect(result.clips[0]?.text?.text).toBe('EU VOU');
    expect(result.clips[0]?.text?.original).toBe('Eu vou');
    expect(result.clips[0]?.text?.wordTimings[0]?.endUs).toBe(500_000);
  });
  it('rejects invalid timings and sorts valid transcribed words', () => {
    const result = alignUntimedLyrics('Eu vou vencer', [
      { start: 2, end: 3, text: 'vencer' }, { start: NaN, end: 2, text: 'ruído' },
      { start: 0, end: 1, text: 'Eu' }, { start: 1, end: 2, text: 'vou' },
      { start: 3, end: 2, text: 'erro' },
    ]);
    expect(result.matched).toBe(1);
    expect(result.cues[0]?.words?.map((word) => word.startS)).toEqual([0, 1, 2]);
  });
  it('never assigns a multi-token transcribed word to two lyric lines', () => {
    const result = alignUntimedLyrics('Eu vou\nvencer', [{ start: 1, end: 3, text: 'Eu vou vencer' }]);
    expect(result.cues).toHaveLength(1);
    expect(result.unmatched).toBe(1);
  });
  it('tolera pequenas variações de transcrição em vocais cantados sem inventar linhas ausentes', () => {
    const result = alignUntimedLyrics('Never shining tonight\nVerso totalmente diferente', [
      { start: 1, end: 1.5, text: 'Neva' },
      { start: 1.5, end: 2.1, text: 'shinin' },
      { start: 2.1, end: 2.8, text: 'tonight' },
    ]);
    expect(result.matched).toBe(1);
    expect(result.unmatched).toBe(1);
    expect(result.cues[0]).toMatchObject({ startS: 1, endS: 2.8, text: 'Never shining tonight' });
  });
  it('alinha letra colada em PT usando versão traduzida para o idioma da música e promove wordTimings', () => {
    const result = alignUntimedLyricsWithFallback(
      'Nunca vou parar\nBrilhando sob a lua',
      [
        { start: 2, end: 2.4, text: 'Never' },
        { start: 2.4, end: 2.8, text: 'gonna' },
        { start: 2.8, end: 3.4, text: 'stop' },
        { start: 4.0, end: 4.5, text: 'Shining' },
        { start: 4.5, end: 4.9, text: 'under' },
        { start: 4.9, end: 5.5, text: 'moonlight' },
      ],
      [
        { start: 2, end: 3.4, text: 'Never gonna stop' },
        { start: 4.0, end: 5.5, text: 'Shining under moonlight' },
      ],
      'Never gonna stop\nShining under moonlight',
    );
    expect(result.matched).toBe(2);
    expect(result.cues.map((c) => c.text)).toEqual(['Nunca vou parar', 'Brilhando sob a lua']);
    expect(result.cues[0]!.startS).toBe(2);
    expect(result.cues[0]!.endS).toBe(3.4);
    expect(result.cues[0]!.words?.map((w) => w.text)).toEqual(['Nunca', 'vou', 'parar']);
    expect(result.cues[0]!.words?.every((w) => w.source === 'lrc' && !w.uncertain && (w.confidence ?? 0) >= 0.9)).toBe(true);
  });
  it('distribui versos nos segmentos vocais quando o reconhecimento direto não alcança metade', () => {
    const result = alignUntimedLyricsWithFallback(
      'Primeiro verso livre\nSegundo verso livre',
      [{ start: 10, end: 11, text: 'la' }],
      [
        { start: 10, end: 13, text: 'vocais um' },
        { start: 15, end: 18, text: 'vocais dois' },
      ],
    );
    expect(result.matched).toBe(2);
    expect(result.cues[0]).toMatchObject({ startS: 10, endS: 13, text: 'Primeiro verso livre' });
    expect(result.cues[1]).toMatchObject({ startS: 15, endS: 18, text: 'Segundo verso livre' });
    const promoted = promoteAlignedCuesForTypography(result.cues);
    expect(promoted[0]!.words).toHaveLength(3);
    expect(promoted[0]!.words![0]!.source).toBe('lrc');
  });

  it('aperta início/fim da letra traduzida aos tempos reais das palavras cantadas (evita adiantar durante intro instrumental)', () => {
    const cues = promoteAlignedCuesForTypography([
      {
        startS: 4.0, // Whisper sem VAD começou 3,8s antes na introdução instrumental
        endS: 11.5,
        text: 'Pele clara,',
        words: [
          { startS: 7.8, endS: 8.4, text: 'Clear', source: 'whisper', confidence: 0.92 },
          { startS: 8.5, endS: 9.2, text: 'pale', source: 'whisper', confidence: 0.92 },
          { startS: 9.25, endS: 9.9, text: 'skin', source: 'whisper', confidence: 0.92 },
        ],
      },
    ]);
    expect(cues[0]!.startS).toBeCloseTo(7.8, 3);
    expect(cues[0]!.endS).toBeCloseTo(9.9, 3);
    expect(cues[0]!.words?.map((w) => w.text)).toEqual(['Pele', 'clara,']);
    expect(cues[0]!.words![0]!.startS).toBeCloseTo(7.8, 3);
    expect(cues[0]!.words![1]!.endS).toBeCloseTo(9.9, 3);
  });
});