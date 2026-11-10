import { describe, expect, it } from 'vitest';
import { applyCommand, AssetSchema, ClipSchema, createProject, newId, type Project } from '@amv/project';
import { planWindows } from '../src/plan.js';
import { windowArgs } from '../src/video.js';

describe('LUT de color grading', () => {
  it('liga a LUT 3D à janela do FFmpeg sem depender de CUDA', () => {
    let project: Project = createProject({ name: 'lut', settings: { width: 320, height: 180, fps: { num: 30, den: 1 } } });
    const videoTrack = project.tracks.find((track) => track.kind === 'video')!;
    const asset = AssetSchema.parse({
      id: 'asset-video',
      name: 'scene.mp4',
      path: 'scene.mp4',
      hash: 'scene',
      kind: 'video',
      status: 'ok',
      importedAt: '',
      probe: {
        container: 'mp4',
        durationUs: 1_000_000,
        sizeBytes: 1,
        bitRate: null,
        video: { codec: 'h264', profile: null, width: 320, height: 180, pixFmt: 'yuv420p', bitDepth: 8, fps: { num: 30, den: 1 }, avgFps: null, vfr: false, frameCount: 30 },
        audio: [],
        subtitles: [],
        tags: {},
      },
    });
    project = applyCommand(project, { type: 'asset.add', asset }).project;
    project = applyCommand(project, {
      type: 'clip.add',
      clip: ClipSchema.parse({
        id: newId('clip'),
        trackId: videoTrack.id,
        assetId: asset.id,
        timelineStartUs: 0,
        durationUs: 1_000_000,
        sourceInUs: 0,
        sourceOutUs: 1_000_000,
        effects: [{ id: 'grade', effect: 'color', enabled: true, params: { exposure: 0.3, temperature: 12 } }],
      }),
    }).project;

    const window = planWindows(project).windows[0]!;
    const job = windowArgs({
      project,
      window,
      fps: project.settings.fps,
      width: 320,
      height: 180,
      enc: { codec: 'h264', quality: 0 },
      output: 'out.mp4',
      source: () => ({ path: 'scene.mp4', kind: 'video', width: 320, height: 180 }),
      textImage: () => null,
      colorLutPath: () => 'C:\\Temp\\grade.cube',
    });
    const filter = job.args[job.args.indexOf('-filter_complex') + 1]!;
    expect(filter).toContain("lut3d=file='C\\:/Temp/grade.cube':interp=trilinear");
    expect(filter).not.toContain('cuda');
  });
});
