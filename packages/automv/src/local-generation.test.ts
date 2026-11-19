import { describe, expect, it } from 'vitest';
import { createProject, applyCommand, AssetSchema } from '@amv/project';
import type { MusicAnalysis, EpisodeAnalysis } from '@amv/analysis';
import { generateAmv, makeSlots } from './generate';
import { STYLES } from './styles';
import { layoutLyrics } from './lyrics-layout';
import { planSequence } from './sequence-planner';

const music: MusicAnalysis = { version: 'm5', durationS: 10, bpm: 120, bpmConfidence: 1, beats: Array.from({ length: 20 }, (_, i) => i * 0.5), downbeats: [0, 2, 4, 6, 8], energy: Array(20).fill(0.8), energyStepS: 0.5, sections: [{ startS: 0, endS: 10, label: 'refrão', energy: 0.8 }], drops: [7.3], intensity: 80, loudnessDb: -18 };
const episode: EpisodeAnalysis = { version: 'e4', durationS: 60, shots: Array.from({ length: 10 }, (_, i) => ({ startS: i * 6, endS: i * 6 + 6, motion: 0.8, loud: 0.8, intensity: 0.8, brightness: 0.5, tags: ['ação', 'impacto'], line: null, peakS: i * 6 + 2 })), sequences: [], speech: [], subtitles: [], intensityCurve: [], curveStepS: 0.5 };

describe('local Auto AMV', () => {
  it('uses fewer rapid cuts when measured tempo confidence is low', () => {
    const style = STYLES.find((item) => item.id === 'hype');
    if (!style) throw new Error('Missing style');
    const low = makeSlots({ ...music, bpmConfidence: 0.2, drops: [] }, [0, 10], style, 3);
    const high = makeSlots({ ...music, bpmConfidence: 1, drops: [] }, [0, 10], style, 3);
    expect(low.length).toBeLessThan(high.length);
    expect(low.at(-1)?.endS).toBe(10);
  });
  it('preserves off-grid drops and covers the final tail', () => {
    const style = STYLES.find((item) => item.id === 'emocional');
    if (!style) throw new Error('Missing style');
    const slots = makeSlots(music, [0, 10], style, 0);
    expect(slots.some((slot) => slot.startS === 7.3 && slot.isDrop)).toBe(true);
    expect(slots.at(-1)?.endS).toBe(10);
    for (let i = 1; i < slots.length; i++) expect(slots[i]?.startS).toBe(slots[i - 1]?.endS);
  });
  it('keeps exact lyric times and splits only around dialogue', () => {
    const cues = layoutLyrics([{ startS: 5, endS: 9, text: 'Stay with me', words: [{ startS: 5, endS: 6, text: 'Stay', source: 'lrc' }] }], [4, 10], [{ atS: 2, len: 1 }]);
    expect(cues.map((cue) => [cue.startS, cue.endS])).toEqual([[1, 2], [3, 5]]);
    expect(cues[0]?.words?.[0]?.startS).toBe(1);
    expect(layoutLyrics([{ startS: 5, endS: 5.3, text: 'Hey' }], [4, 10], [])[0]?.endS).toBeCloseTo(1.3);
  });
  it('uses unused earlier footage before repeating in narrative mode', () => {
    const candidates = [{ id: 'early', assetId: 'ep', episodeOrder: 0, sequenceOrder: 0, sourceStartS: 0, sourceEndS: 2 }, { id: 'late', assetId: 'ep', episodeOrder: 0, sequenceOrder: 1, sourceStartS: 10, sourceEndS: 12 }];
    const options = { seed: 1, beamWidth: 1, score: (slot: number, candidate: typeof candidates[number]) => slot === 0 && candidate.id === 'late' ? 100 : 1 };
    const narrative = planSequence([0, 1], candidates, { ...options, mode: 'narrative' });
    expect(narrative.choices.map((choice) => choice?.id)).toEqual(['late', 'early']);
    expect(narrative.repeatedSlots).toEqual([]);
    expect(planSequence([0, 1], candidates, { ...options, mode: 'chronological' }).choices[1]).toBeNull();
  });
  it('does not generate decorative effects with effects disabled and keeps lyrics over the drop', () => {
    const project = createProject({ name: 'Regression' });
    project.assets = ['music', 'ep'].map((id) => AssetSchema.parse({ id, name: id, path: `/tmp/${id}`, hash: id, kind: id === 'music' ? 'audio' : 'video', probe: null, status: 'ok', importedAt: project.createdAt }));
    const result = generateAmv(project, { assetId: 'music', name: 'Music', analysis: music }, [{ assetId: 'ep', name: 'Episode', analysis: episode, hasAudio: false }], { style: 'hype', durationS: 10, musicStartS: 0, intensity: 2, seed: 1, useSpeech: false, useEffects: false, showText: true, focus: 'mix', organizationMode: 'free', lyrics: [{ startS: 7, endS: 8, text: 'At the drop' }] });
    const updated = applyCommand(project, { type: 'batch', commands: result.commands }).project;
    const videos = updated.clips.filter((clip) => clip.assetId === 'ep');
    expect(videos.length).toBeGreaterThan(0);
    expect(videos.every((clip) => clip.effects.length === 0 && (!clip.transitionIn || ['match_cut', 'cut_on_action'].includes(clip.transitionIn.transition)))).toBe(true);
    const lyric = updated.clips.find((clip) => clip.text?.text === 'At the drop');
    expect(lyric?.timelineStartUs).toBe(7_000_000);
    expect(lyric?.durationUs).toBe(1_000_000);
    const aligned = videos.filter((clip) => clip.reason?.includes('golpe na batida'));
    expect(aligned.length).toBeGreaterThan(0);
    for (const clip of aligned) {
      const shot = episode.shots.find((item) => clip.sourceInUs >= item.startS * 1e6 && clip.sourceInUs < item.endS * 1e6);
      expect(Math.abs((shot?.peakS ?? -10) * 1e6 - clip.sourceInUs) / clip.speed).toBeLessThanOrEqual(1e6 / 30);
    }
  });
});