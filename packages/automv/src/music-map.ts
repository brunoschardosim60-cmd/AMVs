import type { MusicAnalysis, MusicEvent } from '@amv/analysis';

export interface MusicMapEvent extends MusicEvent {
  timelineS: number;
}

export interface MusicMap {
  startS: number;
  endS: number;
  energy: { timeS: number; value: number }[];
  beats: number[];
  downbeats: number[];
  sections: { startS: number; endS: number; label: string; energy: number }[];
  events: MusicMapEvent[];
}

export function buildMusicMap(analysis: MusicAnalysis, range: [number, number], offsetS = 0): MusicMap {
  const startS = Math.max(0, Math.min(analysis.durationS, range[0]));
  const endS = Math.max(startS, Math.min(analysis.durationS, range[1]));
  const durationS = endS - startS;
  const energy: MusicMap['energy'] = [];
  const step = Math.max(0.05, analysis.energyStepS);
  for (let timeS = 0; timeS < durationS; timeS += step) {
    const sourceS = startS + timeS;
    const index = Math.floor(sourceS / step);
    energy.push({ timeS, value: analysis.energy[index] ?? 0 });
  }
  energy.push({ timeS: durationS, value: analysis.energy[Math.floor(endS / step)] ?? energy.at(-1)?.value ?? 0 });
  const inRange = (timeS: number) => timeS >= startS && timeS <= endS;
  return {
    startS,
    endS,
    energy,
    beats: analysis.beats.filter(inRange).map((timeS) => timeS + offsetS - startS),
    downbeats: analysis.downbeats.filter(inRange).map((timeS) => timeS + offsetS - startS),
    sections: analysis.sections
      .filter((section) => section.endS > startS && section.startS < endS)
      .map((section) => ({
        startS: Math.max(startS, section.startS) - startS,
        endS: Math.min(endS, section.endS) - startS,
        label: section.label,
        energy: section.energy,
      })),
    events: (analysis.events ?? [])
      .filter((event) => inRange(event.atS))
      .map((event) => ({ ...event, timelineS: event.atS + offsetS - startS })),
  };
}
