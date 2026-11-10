import { describe, expect, it } from 'vitest';
import type { MusicAnalysis } from '@amv/analysis';
import { narrativeAt, narrativeRoleLabel, planNarrative } from '../src/narrative.js';

const music: MusicAnalysis = {
  version: 'test',
  durationS: 100,
  bpm: 120,
  bpmConfidence: 0.9,
  beats: [],
  downbeats: [],
  energy: [],
  energyStepS: 0.25,
  sections: [
    { startS: 0, endS: 20, label: 'intro', energy: 0.2 },
    { startS: 20, endS: 30, label: 'pré-refrão', energy: 0.55 },
    { startS: 30, endS: 60, label: 'drop', energy: 0.9 },
    { startS: 60, endS: 80, label: 'ponte', energy: 0.35 },
    { startS: 80, endS: 100, label: 'final', energy: 0.2 },
  ],
  drops: [30],
  intensity: 60,
  loudnessDb: -12,
};

describe('direção narrativa musical', () => {
  it('planeja a arcada a partir das seções e do drop observados', () => {
    const plan = planNarrative(music, [10, 90]);
    expect(plan.map((beat) => beat.role)).toEqual(['opening', 'build', 'climax', 'release', 'ending']);
    expect(plan[0]).toMatchObject({ startS: 0, endS: 10, section: 'intro' });
    expect(plan[2]?.reason).toContain('Drop detectado');
    expect(narrativeRoleLabel(narrativeAt(plan, 25)?.role ?? 'development')).toBe('Clímax');
  });

  it('mantém desenvolvimento genérico quando a análise não identificou seções', () => {
    const plan = planNarrative({ ...music, sections: [], drops: [] }, [0, 12]);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ role: 'development', startS: 0, endS: 12 });
    expect(plan[0]?.reason).toContain('não identificou seções');
  });

  it('aplica o deslocamento manual de batida às fronteiras narrativas', () => {
    const plan = planNarrative(music, [0, 50], 0.1);
    expect(plan[1]?.startS).toBeCloseTo(20.1);
    expect(plan[2]?.startS).toBeCloseTo(30.1);
  });
});
