import { describe, expect, it } from 'vitest';
import { shotKey, type EpisodeAnalysis, type LocalVisualFeatures, type MusicAnalysis, type Shot } from '@amv/analysis';
import { applyCommand, ClipSchema, createProject, type Asset, type Project } from '@amv/project';
import {
  alignClipPeakToNearestBeat,
  buildFullTimelineAutoRepair,
  buildProjectReadingSummary,
  findBestReplacementShots,
  harmonizeTextClipsWithScenes,
  readPlayheadInsight,
  type EpisodeInput,
  type MusicInput,
} from '../src/index.js';

const S = 1_000_000;

function makeLocalFeatures(opts: {
  id: string;
  brightness?: number;
  focusY?: number;
  dominantColors?: string[];
  deadFrameScore?: number;
  quadrant?: number;
}): LocalVisualFeatures {
  const q = opts.quadrant ?? 0;
  return {
    version: 3,
    samples: 3,
    lumaGrid: Array.from({ length: 64 }, (_, i) => {
      const gx = i % 8;
      const gy = Math.floor(i / 8);
      const hit = (q === 0 && gx < 4 && gy < 4)
        || (q === 1 && gx >= 4 && gy < 4)
        || (q === 2 && gx < 4 && gy >= 4)
        || (q === 3 && gx >= 4 && gy >= 4);
      return hit ? 0.85 : 0.15;
    }),
    edgeGrid: Array.from({ length: 16 }, (_, i) => (i % 4 === q ? 0.7 : 0.1)),
    colorHistogram: [0.3, 0.3, 0.2, 0.2, 0.25, 0.25, 0.25, 0.25, 0.2, 0.3, 0.3, 0.2],
    dominantColors: opts.dominantColors ?? ['#ff3355', '#102030'],
    brightness: opts.brightness ?? 0.5,
    saturation: 0.55,
    entropy: 0.65,
    edgeDensity: 0.16,
    deadFrameScore: opts.deadFrameScore ?? 0.04,
    textClutterScore: 0,
    centerOfVisualMass: [0.5, opts.focusY ?? 0.48],
    subjectFocus: [0.5, opts.focusY ?? 0.5],
    subjectFocusConfidence: 0.82,
    focusTrajectory: [[0.48, opts.focusY ?? 0.5], [0.52, opts.focusY ?? 0.5]],
    temporalMotion: 0.22,
    globalShift: [0.02, 0],
    globalMotion: 0.3,
    motionEvents: [{
      startS: 0,
      endS: 2,
      cameraMotion: 'zoom-in',
      directionDeg: null,
      speed: 0.4,
      scaleSpeed: 0.25,
      confidence: 0.75,
      subjectMotion: { directionDeg: null, speed: 0.3, confidence: 0.7 },
      apparentScaleChange: 'in',
      abruptFramingChange: false,
    }],
    motionConfidence: 0.75,
    fingerprint: `fp-${opts.id}`,
    sceneType: 'action',
    sceneTypeConfidence: 0.8,
  };
}

function makeFixture() {
  const beats = Array.from({ length: 40 }, (_, i) => i * 0.5);
  const musicAnalysis: MusicAnalysis = {
    version: 'm1',
    durationS: 20,
    bpm: 120,
    bpmConfidence: 0.95,
    beats,
    downbeats: beats.filter((_, i) => i % 4 === 0),
    energy: Array.from({ length: 80 }, (_, i) => (i * 0.25 >= 4 ? 0.86 : 0.35)),
    energyStepS: 0.25,
    sections: [
      { startS: 0, endS: 4, label: 'intro', energy: 0.35 },
      { startS: 4, endS: 20, label: 'drop', energy: 0.86 },
    ],
    drops: [4],
    intensity: 80,
    loudnessDb: -11,
  };
  const music: MusicInput = { assetId: 'mus', name: 'track.mp3', analysis: musicAnalysis };

  const shots: Shot[] = [
    { startS: 0, endS: 4, motion: 0.75, loud: 0.6, intensity: 0.82, brightness: 0.84, tags: ['ação', 'impacto'], line: null, peakS: 1.35 },
    { startS: 4, endS: 8, motion: 0.82, loud: 0.7, intensity: 0.88, brightness: 0.52, tags: ['ação', 'impacto'], line: null, peakS: 5.2 },
    { startS: 8, endS: 12, motion: 0.86, loud: 0.72, intensity: 0.9, brightness: 0.48, tags: ['ação', 'impacto'], line: null, peakS: 9.1 },
    { startS: 12, endS: 16, motion: 0.45, loud: 0.3, intensity: 0.42, brightness: 0.46, tags: ['calma'], line: null, peakS: 13.0 },
  ];

  const visionShots = {
    [shotKey(0)]: {
      characters: ['Gojo'],
      fight: true,
      note: '',
      local: makeLocalFeatures({ id: 's0', brightness: 0.84, focusY: 0.5, dominantColors: ['#00d4ff', '#101828'], quadrant: 0 }),
    },
    [shotKey(4)]: {
      characters: ['Sukuna'],
      fight: true,
      note: '',
      local: makeLocalFeatures({ id: 's1', brightness: 0.52, focusY: 0.38, dominantColors: ['#ff2e54', '#1a0c12'], quadrant: 1 }),
    },
    [shotKey(8)]: {
      characters: ['Yuji'],
      fight: true,
      note: '',
      local: makeLocalFeatures({ id: 's2', brightness: 0.48, focusY: 0.42, dominantColors: ['#ff8800', '#121010'], quadrant: 2 }),
    },
    [shotKey(12)]: {
      characters: ['Megumi'],
      fight: false,
      note: '',
      local: makeLocalFeatures({ id: 's3', brightness: 0.46, focusY: 0.45, dominantColors: ['#4488ff', '#0a1020'], quadrant: 3 }),
    },
  };

  const epAnalysis: EpisodeAnalysis = {
    version: 'e4',
    durationS: 20,
    shots,
    sequences: [{ id: 'seq1', kind: 'luta', startS: 0, endS: 12, shotCount: 3, intensity: 0.86, peak: 0.9 }],
    speech: [],
    subtitles: [],
    intensityCurve: [],
    curveStepS: 1,
  };
  const ep: EpisodeInput = {
    assetId: 'ep1',
    name: 'ep01.mp4',
    analysis: epAnalysis,
    hasAudio: true,
    vision: { version: 'v2', model: 'local-visual-v3', localModel: 'local-visual-v3', shots: visionShots },
  };

  let project: Project = createProject({ name: 'Reading Test', settings: { width: 1920, height: 1080, fps: { num: 30, den: 1 } } });
  const makeAsset = (id: string, kind: Asset['kind'], durS: number): Asset => ({
    id,
    name: id,
    path: `/media/${id}`,
    hash: id,
    kind,
    status: 'ok',
    error: null,
    importedAt: '',
    tags: [],
    favorite: false,
    probe: {
      container: 'mp4',
      durationUs: durS * S,
      sizeBytes: 1000,
      bitRate: null,
      video: kind === 'video' ? { codec: 'h264', profile: null, width: 1920, height: 1080, pixFmt: 'yuv420p', bitDepth: 8, fps: { num: 30, den: 1 }, avgFps: null, vfr: false, frameCount: durS * 30 } : null,
      audio: [{ index: 1, codec: 'aac', sampleRate: 48000, channels: 2, channelLayout: 'stereo', language: 'jpn', title: null }],
      subtitles: [],
      tags: {},
    },
  });

  project = applyCommand(project, { type: 'asset.add', asset: makeAsset('mus', 'audio', 20) }).project;
  project = applyCommand(project, { type: 'asset.add', asset: makeAsset('ep1', 'video', 20) }).project;

  const v1Track = project.tracks.filter((t) => t.kind === 'video').at(-1)!;
  const musicTrack = project.tracks.find((t) => t.role === 'music')!;
  const textTrack = project.tracks.find((t) => t.kind === 'text')!;

  project = applyCommand(project, {
    type: 'clip.add',
    clip: ClipSchema.parse({
      id: 'c_mus',
      trackId: musicTrack.id,
      assetId: 'mus',
      name: 'track.mp3',
      timelineStartUs: 0,
      durationUs: 10 * S,
      sourceInUs: 0,
      sourceOutUs: 10 * S,
      origin: 'user',
    }),
  }).project;

  // Clipe de vídeo no drop (4.0s..6.0s) usando shot 0 (claro + rosto no centro 0.5, peak em 1.35s)
  project = applyCommand(project, {
    type: 'clip.add',
    clip: ClipSchema.parse({
      id: 'c_v1',
      trackId: v1Track.id,
      assetId: 'ep1',
      name: 'Cena 1',
      timelineStartUs: 4 * S,
      durationUs: 2 * S,
      sourceInUs: 0.2 * S,
      sourceOutUs: 2.2 * S,
      muted: true,
      origin: 'user',
    }),
  }).project;

  // Clipe de texto rápido e centralizado sobre o rosto em cena muito clara
  project = applyCommand(project, {
    type: 'clip.add',
    clip: ClipSchema.parse({
      id: 'c_txt',
      trackId: textTrack.id,
      assetId: null,
      name: 'Letra',
      timelineStartUs: 4 * S,
      durationUs: 0.4 * S,
      sourceInUs: 0,
      sourceOutUs: 0.4 * S,
      origin: 'user',
      text: {
        text: 'EXPANSÃO DE DOMÍNIO INFINITO',
        font: 'Russo One',
        weight: 800,
        size: 110,
        color: '#ffffff',
        outlineColor: '#000000',
        outlineWidth: 2,
        shadow: true,
        align: 'center',
        background: 'none',
        backgroundColor: '#000000',
        backgroundOpacity: 0.5,
        fillStyle: 'linear-gradient',
        gradientStartColor: '#ffffff',
        gradientEndColor: '#ffaa00',
        glowColor: '#ffffff',
        glowStrength: 0.6,
        highlightColor: '#ffaa00',
      },
    }),
  }).project;

  return { project, ep, music };
}

describe('reading & smart helpers', () => {
  it('reads music beat lock, active scene sharpness/palette and text reading/face collision at playhead', () => {
    const { project, ep, music } = makeFixture();
    const insight = readPlayheadInsight({
      project,
      playheadUs: 4 * S,
      episodes: [ep],
      musics: [music],
    });

    expect(insight.music).not.toBeNull();
    expect(insight.music!.sectionLabel).toBe('drop');
    expect(insight.music!.beatStatus).toBe('locked');
    expect(insight.music!.beatDeltaMs).toBe(0);

    expect(insight.scene).not.toBeNull();
    expect(insight.scene!.sharpness).toBeGreaterThan(0.9);
    expect(insight.scene!.dominantColors[0]).toBe('#00d4ff');

    expect(insight.text).not.toBeNull();
    expect(insight.text!.readingPace).toBe('too-fast');
    expect(insight.text!.contrastStatus).toBe('covers-face');
    expect(insight.text!.suggestion).toBeTruthy();
  });

  it('harmonizes text clips with scene palette, shifts off character face, applies negative blend on bright scenes, and is idempotent', () => {
    const { project, ep } = makeFixture();
    const first = harmonizeTextClipsWithScenes({ project, episodes: [ep] });
    expect(first.updatedCount).toBe(1);
    expect(first.extendedForReading).toBe(1);

    let updated = project;
    for (const cmd of first.commands) updated = applyCommand(updated, cmd).project;

    const txt = updated.clips.find((c) => c.id === 'c_txt')!;
    expect(txt.transform.y).not.toBe(0);
    expect(txt.blendMode).toBe('difference');
    expect(txt.durationUs).toBeGreaterThan(0.9 * S);
    expect(txt.text!.glowColor).not.toBe('#ffffff');

    const second = harmonizeTextClipsWithScenes({ project: updated, episodes: [ep] });
    expect(second.updatedCount).toBe(0);
  });

  it('aligns a video clip peak (hit) onto the nearest musical beat inside the clip', () => {
    const { project, ep, music } = makeFixture();
    const aligned = alignClipPeakToNearestBeat({
      project,
      clipId: 'c_v1',
      episodes: [ep],
      musics: [music],
    });
    expect(aligned).not.toBeNull();
    const updated = applyCommand(project, aligned!.command).project;
    const v1 = updated.clips.find((c) => c.id === 'c_v1')!;
    // First beat in [4.0s..6.0s] is 4.0s -> sourceInUs should land at shot.peakS (1.35s)
    expect(v1.sourceInUs).toBeCloseTo(1.35 * S, -3);
  });

  it('recommends unused, visually distinct replacement shots matching the musical energy', () => {
    const { project, ep, music } = makeFixture();
    const replacements = findBestReplacementShots({
      project,
      clipId: 'c_v1',
      episodes: [ep],
      musics: [music],
      limit: 3,
    });
    expect(replacements.length).toBeGreaterThanOrEqual(2);
    // Shots 1 (4..8s, 0.88) and 2 (8..12s, 0.90) match the 0.86 drop energy better than calm shot 3 (0.42)
    expect(replacements[0]!.startS).toBeGreaterThanOrEqual(4);
    expect(replacements[0]!.intensity).toBeGreaterThan(0.8);
  });

  it('builds project reading summary and full auto-repair commands', () => {
    const { project, ep, music } = makeFixture();
    const summary = buildProjectReadingSummary({
      project,
      episodes: [ep],
      musics: [music],
    });
    expect(summary.totalVideoClips).toBe(1);
    expect(summary.uniqueScenes).toBe(1);
    expect(summary.fastTextCount).toBe(1);
    expect(summary.lowContrastOrFaceTextCount).toBe(1);
    expect(summary.score.total).toBeGreaterThan(0);

    const repair = buildFullTimelineAutoRepair({
      project,
      episodes: [ep],
      musics: [music],
    });
    expect(Array.isArray(repair.commands)).toBe(true);
  });
});
