import { describe, expect, it } from 'vitest';
import { applyCommand, ClipSchema, createProject, type Asset, type Clip, type Project } from '@amv/project';
import { planWindows, windowArgs } from '../src/index.js';

const S = 1_000_000;

function renderGraph(transition: NonNullable<Clip['transitionIn']>): string {
  let project: Project = createProject({ name: 'transições', settings: { width: 320, height: 180, fps: { num: 30, den: 1 } } });
  const asset: Asset = {
    id: 'video',
    name: 'video',
    path: 'video.mp4',
    hash: 'video',
    kind: 'video',
    probe: null,
    status: 'ok',
    error: null,
    importedAt: '',
    tags: [],
    favorite: false,
  };
  project = applyCommand(project, { type: 'asset.add', asset }).project;
  const trackId = project.tracks.find((track) => track.kind === 'video')!.id;
  const makeClip = (id: string, timelineStartUs: number, transitionIn: Clip['transitionIn']): Clip => ClipSchema.parse({
    id,
    trackId,
    assetId: asset.id,
    timelineStartUs,
    durationUs: S,
    sourceInUs: timelineStartUs,
    sourceOutUs: timelineStartUs + S,
    transitionIn,
  });
  project = applyCommand(project, {
    type: 'batch',
    commands: [
      { type: 'clip.add', clip: makeClip('outgoing', 0, null) },
      { type: 'clip.add', clip: makeClip('incoming', S, transition) },
    ],
  }).project;
  const window = planWindows(project).windows.find((candidate) => candidate.layers.some((layer) => layer.underlay))!;
  const job = windowArgs({
    project,
    window,
    fps: project.settings.fps,
    width: 320,
    height: 180,
    enc: { codec: 'h264', quality: 0 },
    output: 'transition.mp4',
    source: () => ({ path: asset.path, kind: 'video', width: 320, height: 180 }),
    textImage: () => null,
  });
  return job.args[job.args.indexOf('-filter_complex') + 1]!;
}

describe('grafo de render das transições', () => {
  it('exporta curvas de dissolve como alfa animado, sem fade linear divergente', () => {
    const graph = renderGraph({
      transition: 'dissolve',
      durationUs: 500_000,
      params: { curve: 'ease-in-out', intensity: 0.5 },
    });
    expect(graph).toContain('geq=lum=');
    expect(graph).toContain(":a='if(between(T,");
    expect(graph).toContain('cos(PI');
    expect(graph).toContain('pow(');
  });

  it('aplica whip pan direcional nas duas camadas do mesmo intervalo', () => {
    const graph = renderGraph({
      transition: 'whip_pan',
      durationUs: 400_000,
      params: { curve: 'ease-out', intensity: 0.6, direction: -1, blur: 5 },
    });
    expect(graph).toContain('gblur=sigma=5');
    expect(graph).toContain('1-(1-(');
    expect(graph.match(/overlay=x=/g)).toHaveLength(2);
  });
});
