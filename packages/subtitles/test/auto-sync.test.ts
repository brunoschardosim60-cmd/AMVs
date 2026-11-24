import { describe, expect, it } from 'vitest';
import { applyCommand, ClipSchema, createProject, TextContentSchema } from '@amv/project';
import { autoSyncSubtitlesToBeats } from '../src/index.js';

describe('autoSyncSubtitlesToBeats', () => {
  it('estima deslocamento global quando legendas estão uniformemente atrasadas em relação às batidas', () => {
    const project = createProject({ name: 'sync', settings: { width: 1920, height: 1080, fps: { num: 30, den: 1 } } });
    const textTrack = project.tracks.find((t) => t.kind === 'text')!;
    const makeSub = (id: string, startS: number) => ClipSchema.parse({
      id,
      trackId: textTrack.id,
      assetId: null,
      timelineStartUs: Math.round(startS * 1e6),
      durationUs: 1_000_000,
      sourceInUs: 0,
      sourceOutUs: 1_000_000,
      text: TextContentSchema.parse({ text: `Linha ${id}` }),
    });
    // Batidas em 1.0, 2.0, 3.0, 4.0 — legendas atrasadas em +220 ms
    const clips = [makeSub('s1', 1.22), makeSub('s2', 2.22), makeSub('s3', 3.22)];
    project.clips.push(...clips);

    const res = autoSyncSubtitlesToBeats(project, clips.map((c) => c.id), [1, 2, 3, 4], 0.5);
    expect(res.shiftUs).toBeCloseTo(-220_000, -4);
    expect(res.commands.length).toBe(3);

    const out = applyCommand(project, { type: 'batch', commands: res.commands }).project;
    expect(out.clips.find((c) => c.id === 's1')!.timelineStartUs).toBeCloseTo(1_000_000, -4);
  });
});
