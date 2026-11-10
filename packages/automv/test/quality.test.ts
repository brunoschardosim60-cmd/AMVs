import { describe, expect, it } from 'vitest';
import type { EpisodeAnalysis, MusicAnalysis } from '@amv/analysis';
import { applyCommand, AssetSchema, ClipSchema, createProject, type Project } from '@amv/project';
import { evaluateAudiovisualQuality } from '../src/quality.js';

const S = 1_000_000;

function fixture() {
  let project: Project = createProject({ name: 'quality', settings: { width: 320, height: 180, fps: { num: 30, den: 1 } } });
  const videoTrack = project.tracks.find((track) => track.kind === 'video' && track.name === 'V1')!;
  const musicTrack = project.tracks.find((track) => track.role === 'music')!;
  const textTrack = project.tracks.find((track) => track.kind === 'text')!;
  const asset = (id: string, kind: 'video' | 'audio') => AssetSchema.parse({
    id, name: id, path: `${id}.media`, hash: id, kind, status: 'ok', importedAt: '', tags: [], favorite: false, error: null,
    probe: {
      container: 'test', durationUs: 20 * S, sizeBytes: 1, bitRate: null,
      video: kind === 'video' ? { codec: 'h264', profile: null, width: 320, height: 180, pixFmt: 'yuv420p', bitDepth: 8, fps: { num: 30, den: 1 }, avgFps: null, vfr: false, frameCount: 600 } : null,
      audio: kind === 'audio' ? [{ index: 0, codec: 'aac', sampleRate: 48000, channels: 2, channelLayout: 'stereo', language: null, title: null }] : [],
      subtitles: [], tags: {},
    },
  });
  for (const media of [asset('episode', 'video'), asset('song', 'audio')]) project = applyCommand(project, { type: 'asset.add', asset: media }).project;
  const clip = (id: string, trackId: string, assetId: string | null, start: number, duration: number, sourceIn = 0, extra: Record<string, unknown> = {}) =>
    ClipSchema.parse({
      id, trackId, assetId, timelineStartUs: start * S, durationUs: duration * S, sourceInUs: sourceIn * S, sourceOutUs: (sourceIn + duration) * S,
      origin: 'user', ...extra,
    });
  project = applyCommand(project, {
    type: 'batch',
    commands: [
      { type: 'clip.add', clip: clip('shot-a', videoTrack.id, 'episode', 0, 2) },
      { type: 'clip.add', clip: clip('shot-b', videoTrack.id, 'episode', 2.7, 1, 0.2, { reason: 'golpe na batida' }) },
      { type: 'clip.add', clip: clip('music', musicTrack.id, 'song', 0, 5) },
      { type: 'clip.add', clip: clip('subtitle-a', textTrack.id, null, 0.5, 2, 0, { text: { text: 'Primeira fala' } }) },
      { type: 'clip.add', clip: clip('subtitle-b', textTrack.id, null, 1.5, 2, 0, { text: { text: 'Segunda fala' } }) },
    ],
  }).project;

  const episode: EpisodeAnalysis = {
    version: 'test', durationS: 20,
    shots: [{ startS: 0, endS: 5, motion: 0.5, loud: 0.5, intensity: 0.7, brightness: 0.8, tags: ['ação'], line: null, peakS: 1 }],
    sequences: [], speech: [], subtitles: [], intensityCurve: [], curveStepS: 1,
  };
  const music: MusicAnalysis = {
    version: 'test', durationS: 20, bpm: 120, bpmConfidence: 0.9,
    beats: Array.from({ length: 40 }, (_, index) => index * 0.5),
    downbeats: [], energy: Array(80).fill(0.5), energyStepS: 0.25,
    sections: [{ startS: 0, endS: 20, label: 'verso', energy: 0.5 }],
    drops: [], events: [], intensity: 50, loudnessDb: -12,
  };
  return { project, episode, music };
}

describe('avaliador audiovisual', () => {
  it('relata lacuna visual, repetição e uma sincronização declarada fora da janela', () => {
    const { project, episode, music } = fixture();
    const report = evaluateAudiovisualQuality({
      project,
      episodes: new Map([['episode', episode]]),
      music: new Map([['song', music]]),
    });
    expect(report.issues.map((item) => item.type)).toContain('lacuna visual');
    expect(report.issues.map((item) => item.type)).toContain('mesma cena reutilizada');
    expect(report.issues.map((item) => item.type)).toContain('sincronia declarada fora da janela');
    expect(report.issues.every((item) => item.startUs <= item.endUs && item.evidence.length > 0 && item.suggestion.length > 0)).toBe(true);
    expect(report.coverage.narrative.status).toBe('partial');
    expect(report.coverage['preview-export'].status).toBe('partial');
  });

  it('gera comando local e undoável para resolver sobreposição de legendas', () => {
    const { project, episode, music } = fixture();
    const report = evaluateAudiovisualQuality({
      project,
      episodes: new Map([['episode', episode]]),
      music: new Map([['song', music]]),
    });
    const subtitleIssue = report.issues.find((item) => item.dimension === 'subtitles');
    expect(subtitleIssue?.fix?.commands).toHaveLength(1);
    const fixed = applyCommand(project, subtitleIssue!.fix!.commands[0]!).project;
    const repaired = fixed.clips.find((clip) => clip.id === 'subtitle-a')!;
    expect(repaired.durationUs).toBe(1 * S);
    expect(repaired.timelineStartUs + repaired.durationUs).toBe(1.5 * S);
  });

  it('não inventa problemas de sincronização sem justificativa do clipe ou BPM confiável', () => {
    const { project, episode, music } = fixture();
    const clips = project.clips.map((clip) => clip.id === 'shot-b' ? { ...clip, reason: 'cena de ação' } : clip);
    const noClaim: Project = { ...project, clips };
    const report = evaluateAudiovisualQuality({
      project: noClaim,
      episodes: new Map([['episode', episode]]),
      music: new Map([['song', { ...music, bpmConfidence: 0.2 }]]),
    });
    expect(report.issues.some((item) => item.dimension === 'music-sync')).toBe(false);
  });

  it('só sinaliza densidade quando os cortes muito curtos formam uma sequência', () => {
    const { project, episode, music } = fixture();
    const template = project.clips.find((clip) => clip.id === 'shot-a')!;
    const createShort = (id: string, startS: number, sourceS: number) => ClipSchema.parse({
      ...template,
      id,
      timelineStartUs: startS * S,
      durationUs: 100_000,
      sourceInUs: sourceS * S,
      sourceOutUs: sourceS * S + 100_000,
    });
    const replaceShots = (starts: number[]) => ({
      ...project,
      clips: [
        ...project.clips.filter((clip) => clip.trackId !== template.trackId),
        ...starts.map((start, index) => createShort(`short-${index}`, start, index / 10)),
      ],
    });
    const analyze = (next: Project) => evaluateAudiovisualQuality({
      project: next,
      episodes: new Map([['episode', episode]]),
      music: new Map([['song', music]]),
    });
    expect(analyze(replaceShots([0, 2, 4])).issues.some((item) => item.dimension === 'cut-density')).toBe(false);
    expect(analyze(replaceShots([0, 0.1, 0.2])).issues.some((item) => item.dimension === 'cut-density')).toBe(true);
  });
});
