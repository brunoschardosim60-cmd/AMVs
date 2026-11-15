import { describe, expect, it } from 'vitest';
import { ClipSchema, createProject } from '@amv/project';
import type { EpisodeAnalysis, MusicAnalysis } from '@amv/analysis';
import type { EpisodeInput, MusicInput } from '../src/generate.js';
import { buildCreativeBrief, reviewGeneratedAssembly } from '../src/creative-director.js';
import type { NarrativeBeat } from '../src/narrative.js';

const S = 1_000_000;

function music(): MusicInput {
  const analysis = {
    version: 'test',
    durationS: 20,
    bpm: 120,
    bpmConfidence: 0.9,
    beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
    downbeats: [0, 2],
    energy: Array(40).fill(0.5),
    energyStepS: 0.5,
    sections: [{ startS: 0, endS: 20, label: 'drop', energy: 0.85 }],
    drops: [1],
    events: [],
    intensity: 80,
    loudnessDb: -12,
  } as unknown as MusicAnalysis;
  return { assetId: 'song', name: 'song', analysis };
}

function emptyEpisode(): EpisodeInput {
  const analysis = {
    version: 'test',
    durationS: 10,
    shots: [{ startS: 0, endS: 5, motion: 0.5, loud: 0.5, intensity: 0.8, brightness: 0.5, tags: ['ação', 'impacto'], line: null, peakS: 2 }],
    sequences: [],
    speech: [],
    subtitles: [],
    intensityCurve: [],
    curveStepS: 1,
  } as unknown as EpisodeAnalysis;
  return { assetId: 'episode', name: 'episode', analysis, hasAudio: false };
}

const direction: NarrativeBeat[] = [{
  role: 'opening',
  startS: 0,
  endS: 4,
  section: 'intro',
  reason: 'Introdução detectada na análise musical.',
}];

describe('direção criativa do Auto AMV', () => {
  it('transforma o estilo em objetivo editorial e declara lacunas de evidência', () => {
    const brief = buildCreativeBrief({
      style: 'hype',
      episodes: [emptyEpisode()],
      music: music(),
      options: { durationS: 4, intensity: 2, editorialDirection: 'balanced', organizationMode: 'narrative', focus: 'mix', voiceMoments: 0 },
      direction,
    });

    expect(brief.title).toBe('Combate épico');
    expect(brief.objective).toContain('expectativa');
    expect(brief.priorities).toContain('ação e reação legíveis');
    expect(brief.evidence.scenes).toBe(1);
    expect(brief.evidence.semanticScenes).toBe(0);
    expect(brief.confidence).toBe('limited');
    expect(brief.limitations.some((item) => item.includes('rótulos semânticos'))).toBe(true);
  });

  it('faz a segunda revisão e só aplica correção segura quando a qualidade objetiva melhora', () => {
    const project = createProject({ name: 'creative-review', settings: { width: 320, height: 180, fps: { num: 30, den: 1 } } });
    const textTrack = project.tracks.find((track) => track.kind === 'text')!;
    const textClip = (id: string, startS: number) => ClipSchema.parse({
      id,
      trackId: textTrack.id,
      assetId: null,
      timelineStartUs: startS * S,
      durationUs: 2 * S,
      sourceInUs: 0,
      sourceOutUs: 2 * S,
      origin: 'ai',
      reason: 'Legenda da fala gerada',
      text: { text: id },
    });
    const commands = [
      { type: 'clip.add' as const, clip: textClip('caption-a', 0.5) },
      { type: 'clip.add' as const, clip: textClip('caption-b', 1.5) },
    ];
    const brief = buildCreativeBrief({
      style: 'discurso',
      episodes: [emptyEpisode()],
      music: music(),
      options: { durationS: 4, intensity: 2, editorialDirection: 'balanced', organizationMode: 'narrative', focus: 'mix', voiceMoments: 1 },
      direction,
    });
    const review = reviewGeneratedAssembly({
      project,
      commands,
      brief,
      direction,
      summary: {
        clips: 0, cuts: 0, speech: null, musicRange: [0, 4], drop: 1, focus: 'mix', fights: [],
        voices: 1, hitsSynced: 0, speedRamps: 0, sfx: 0, direction,
      },
      episodes: [emptyEpisode()],
      music: music(),
    });

    expect(review.generatedClipCount).toBe(2);
    expect(review.quality.issues.some((item) => item.type === 'legendas sobrepostas na mesma faixa')).toBe(false);
    expect(review.repairsApplied).toContain('Ajustar fim da legenda anterior');
    expect(review.commands.some((command) => command.type === 'clip.update' && command.clipId === 'caption-a')).toBe(true);
    expect(review.alignment.find((item) => item.criterion === 'Falas disponíveis')?.status).toBe('met');
  });
});
