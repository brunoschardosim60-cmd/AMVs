import { describe, expect, it } from 'vitest';
import { alignUntimedLyrics } from './index';
import { restyleSubtitles, subtitleClip } from './index';
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
});