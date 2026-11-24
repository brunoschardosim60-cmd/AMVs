import { describe, expect, it } from 'vitest';
import type { EpisodeAnalysis } from '@amv/analysis';
import { applyCommand, AssetSchema, ClipSchema, createProject, type Command } from '@amv/project';
import { autoRepairAssembly, evaluateAudiovisualQuality, type EpisodeInput } from '../src/index.js';

function baseProject() {
  const project = createProject({ name: 'Teste Auto-Repair', settings: { width: 1920, height: 1080, fps: { num: 24, den: 1 } } });
  const v1 = project.tracks.find((t) => t.kind === 'video')!;
  const asset = AssetSchema.parse({
    id: 'ep1',
    name: 'ep1.mp4',
    path: '/tmp/ep1.mp4',
    hash: 'ep1',
    kind: 'video',
    status: 'ok',
    importedAt: '',
    tags: [],
    favorite: false,
    error: null,
    probe: {
      container: 'mp4',
      durationUs: 60_000_000,
      sizeBytes: 10_000_000,
      bitRate: 1_000_000,
      video: { codec: 'h264', profile: null, width: 1920, height: 1080, pixFmt: 'yuv420p', bitDepth: 8, fps: { num: 24, den: 1 }, avgFps: null, vfr: false, frameCount: 1440 },
      audio: [{ index: 1, codec: 'aac', channels: 2, channelLayout: 'stereo', sampleRate: 48000, language: 'jpn', title: null }],
      subtitles: [],
      tags: {},
    },
  });
  project.assets.push(asset);
  return { project, v1 };
}

function makeClip(id: string, trackId: string, startUs: number, durationUs: number, sourceInUs: number) {
  return ClipSchema.parse({
    id,
    trackId,
    assetId: 'ep1',
    timelineStartUs: startUs,
    durationUs,
    sourceInUs,
    sourceOutUs: sourceInUs + durationUs,
    speed: 1,
    origin: 'ai',
  });
}

describe('autoRepairAssembly', () => {
  it('suaviza automaticamente saltos de luminosidade e remove o aviso na reavaliação', () => {
    const { project, v1 } = baseProject();
    const c1 = makeClip('c1', v1.id, 0, 1_000_000, 0);
    const c2 = makeClip('c2', v1.id, 1_000_000, 1_000_000, 5_000_000);
    project.clips.push(c1, c2);

    const analysis: EpisodeAnalysis = {
      version: 'e4',
      durationS: 60,
      shots: [
        { startS: 0, endS: 4, intensity: 0.5, motion: 0.5, loud: 0.5, peakS: 2, brightness: 0.72, line: null, tags: ['ação'] },
        { startS: 4, endS: 8, intensity: 0.5, motion: 0.5, loud: 0.5, peakS: 6, brightness: 0.25, line: null, tags: ['ação'] },
      ],
      speech: [],
      subtitles: [],
      intensityCurve: [],
      curveStepS: 0.5,
      sequences: [],
    };
    const ep: EpisodeInput = { assetId: 'ep1', name: 'ep1.mp4', hasAudio: true, analysis };
    const episodesMap = new Map([[ep.assetId, ep.analysis]]);

    const before = evaluateAudiovisualQuality({ project, episodes: episodesMap });
    expect(before.issues.some((i) => i.type === 'salto de luminosidade')).toBe(true);

    const repair = autoRepairAssembly(project, new Set(['c1', 'c2']), [ep], before);
    expect(repair.commands.length).toBeGreaterThan(0);
    expect(repair.repairsApplied.some((r) => /luminosidade/i.test(r))).toBe(true);

    const afterProject = applyCommand(project, {
      type: 'batch',
      label: 'auto-repair',
      commands: repair.commands as Command[],
    }).project;
    const after = evaluateAudiovisualQuality({ project: afterProject, episodes: episodesMap });
    expect(after.issues.some((i) => i.type === 'salto de luminosidade')).toBe(false);
  });

  it('mescla sequências de micro-cortes abaixo de 180 ms quando há margem na fonte', () => {
    const { project, v1 } = baseProject();
    const clips = [
      makeClip('m1', v1.id, 0, 120_000, 0),
      makeClip('m2', v1.id, 120_000, 120_000, 1_000_000),
      makeClip('m3', v1.id, 240_000, 120_000, 2_000_000),
      makeClip('m4', v1.id, 360_000, 120_000, 3_000_000),
    ];
    project.clips.push(...clips);

    const before = evaluateAudiovisualQuality({ project, episodes: new Map() });
    expect(before.issues.some((i) => i.dimension === 'cut-density')).toBe(true);

    const repair = autoRepairAssembly(project, new Set(clips.map((c) => c.id)), [], before);
    expect(repair.repairsApplied.some((r) => /micro-corte/i.test(r))).toBe(true);

    const afterProject = applyCommand(project, {
      type: 'batch',
      label: 'auto-repair',
      commands: repair.commands as Command[],
    }).project;
    const after = evaluateAudiovisualQuality({ project: afterProject, episodes: new Map() });
    expect(after.issues.some((i) => i.dimension === 'cut-density')).toBe(false);
  });

  it('substitui automaticamente cenas repetidas por planos inéditos do mesmo episódio', () => {
    const { project, v1 } = baseProject();
    // Dois clipes apontando para o mesmo shot (0..4s)
    const c1 = makeClip('r1', v1.id, 0, 1_000_000, 500_000);
    const c2 = makeClip('r2', v1.id, 1_000_000, 1_000_000, 600_000);
    project.clips.push(c1, c2);

    const analysis: EpisodeAnalysis = {
      version: 'e4',
      durationS: 60,
      shots: [
        { startS: 0, endS: 4, intensity: 0.7, motion: 0.6, loud: 0.5, peakS: 2, brightness: 0.55, line: null, tags: ['ação'] },
        { startS: 4, endS: 9, intensity: 0.85, motion: 0.8, loud: 0.7, peakS: 6, brightness: 0.55, line: null, tags: ['ação'] },
      ],
      speech: [],
      subtitles: [],
      intensityCurve: [],
      curveStepS: 0.5,
      sequences: [],
    };
    const ep: EpisodeInput = { assetId: 'ep1', name: 'ep1.mp4', hasAudio: true, analysis };
    const episodesMap = new Map([[ep.assetId, ep.analysis]]);

    const before = evaluateAudiovisualQuality({ project, episodes: episodesMap });
    expect(before.issues.some((i) => i.dimension === 'repetition')).toBe(true);

    const repair = autoRepairAssembly(project, new Set(['r1', 'r2']), [ep], before);
    expect(repair.repairsApplied.some((r) => /repetida/i.test(r))).toBe(true);

    const afterProject = applyCommand(project, {
      type: 'batch',
      label: 'auto-repair',
      commands: repair.commands as Command[],
    }).project;
    const after = evaluateAudiovisualQuality({ project: afterProject, episodes: episodesMap });
    expect(after.issues.some((i) => i.dimension === 'repetition')).toBe(false);
  });
});
