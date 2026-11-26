import { describe, expect, it } from 'vitest';
import type { EpisodeAnalysis, MusicAnalysis, Shot } from '@amv/analysis';
import { applyCommand, clipEndUs, createProject, type Asset, type Project } from '@amv/project';
import {
  buildCreativeBrief,
  generateBestAmv,
  planSequence,
  reviewGeneratedAssembly,
  scoreAssemblyQuality,
  scoreSceneCandidate,
  STYLES,
  type EpisodeInput,
  type GenerateResult,
  type MusicInput,
} from '../src/index.js';

const S = 1_000_000;

function makeMusic(durationS = 16): MusicInput {
  const beats = Array.from({ length: durationS * 2 }, (_, i) => i * 0.5);
  const energy = Array.from({ length: durationS * 4 }, (_, i) => (i * 0.25 >= 8 ? 0.9 : 0.35));
  const analysis: MusicAnalysis = {
    version: 'm1',
    durationS,
    bpm: 120,
    bpmConfidence: 0.9,
    beats,
    downbeats: beats.filter((_, i) => i % 4 === 0),
    energy,
    energyStepS: 0.25,
    sections: [
      { startS: 0, endS: 8, label: 'intro', energy: 0.35 },
      { startS: 8, endS: durationS, label: 'drop', energy: 0.9 },
    ],
    drops: [8],
    intensity: 75,
    loudnessDb: -12,
  };
  return { assetId: 'mus_1', name: 'musica.mp3', analysis };
}

function makeEpisode(id: string, shotCount: number): EpisodeInput {
  const shots: Shot[] = Array.from({ length: shotCount }, (_, i) => {
    const intensity = 0.3 + ((i * 23) % 65) / 100;
    return {
      startS: i * 3,
      endS: i * 3 + 2.8,
      motion: intensity,
      loud: intensity,
      intensity,
      brightness: 0.45,
      tags: i % 2 === 0 ? ['ação', 'impacto'] : ['calma'],
      line: null,
      peakS: i * 3 + 1.2,
    };
  });
  const durationS = shotCount * 3;
  const analysis: EpisodeAnalysis = {
    version: 'e2',
    durationS,
    shots,
    sequences: [{ id: `${id}_seq1`, startS: 0, endS: durationS, kind: 'luta', intensity: 0.78, peak: 0.9, shotCount }],
    subtitles: [],
    intensityCurve: [],
    curveStepS: 1,
    speech: [
      { startS: 1.0, endS: 2.6, kind: 'fala', confidence: 0.88, text: 'Eu não vou desistir agora!', impact: 0.82 },
    ],
  };
  return { assetId: id, name: `${id}.mkv`, analysis, hasAudio: true };
}

function makeAsset(id: string, kind: Asset['kind'], durS: number, status: Asset['status'] = 'ok'): Asset {
  return {
    id,
    name: id,
    path: `/m/${id}`,
    hash: id,
    kind,
    status,
    error: status === 'missing' ? 'arquivo não encontrado' : null,
    importedAt: '',
    tags: [],
    favorite: false,
    probe: status === 'missing'
      ? null
      : {
          container: 'x',
          durationUs: durS * S,
          sizeBytes: 1,
          bitRate: null,
          video: kind === 'video'
            ? {
                codec: 'h264',
                profile: null,
                width: 1920,
                height: 1080,
                pixFmt: null,
                bitDepth: 8,
                fps: { num: 24, den: 1 },
                avgFps: null,
                vfr: false,
                frameCount: null,
              }
            : null,
          audio: [{ index: 1, codec: 'aac', sampleRate: 48000, channels: 2, channelLayout: null, language: null, title: null }],
          subtitles: [],
          tags: {},
        },
  };
}

describe('Fase 5 — robustez numérica, listas vazias e invariantes do planejador', () => {
  it('scoreSceneCandidate nunca devolve NaN ou Infinity mesmo com entradas degeneradas', () => {
    const style = STYLES.find((s) => s.id === 'hype')!;
    const result = scoreSceneCandidate({
      shot: {
        startS: 0,
        endS: 0,
        motion: Number.NaN,
        loud: Number.NaN,
        brightness: Number.NaN,
        intensity: Number.NaN,
        tags: ['impacto'],
        line: null,
        peakS: 0,
      },
      effectiveIntensity: Number.NaN,
      targetIntensity: Number.POSITIVE_INFINITY,
      musicEnergy: Number.NaN,
      isDrop: true,
      style,
      current: { assetId: 'ep1', sequenceId: 's1', sourceStartS: 0 },
      lyricMatchScore: Number.NaN,
      slotDurationS: 0,
      creativeEmphasis: { action: Number.NaN, emotion: Number.NEGATIVE_INFINITY, preferredEmotion: null },
    });

    expect(Number.isFinite(result.music)).toBe(true);
    expect(Number.isFinite(result.action)).toBe(true);
    expect(Number.isFinite(result.actionWeight)).toBe(true);
    expect(Number.isFinite(result.emotionWeight)).toBe(true);
    expect(Number.isFinite(result.lyric)).toBe(true);
    expect(Number.isFinite(result.total)).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('scoreAssemblyQuality nunca divide por zero em timeline vazia ou cortes zerados', () => {
    const project = createProject({ name: 'EmptyScore' });
    const music = makeMusic(12);
    const emptySummary: GenerateResult['summary'] = {
      clips: 0,
      cuts: 0,
      speech: null,
      musicRange: [0, 12],
      drop: null,
      focus: 'mix',
      fights: [],
      voices: 0,
      hitsSynced: 0,
      speedRamps: 0,
      sfx: 0,
      direction: [],
    };
    const brief = buildCreativeBrief({
      style: 'hype',
      episodes: [],
      music,
      options: { durationS: 12, intensity: 2 },
      direction: [],
      hasTimedLyrics: false,
    });
    const review = reviewGeneratedAssembly({
      project,
      commands: [],
      brief,
      direction: [],
      summary: emptySummary,
      episodes: [],
      music,
    });
    const score = scoreAssemblyQuality({
      project,
      generatedClipIds: new Set(),
      summary: emptySummary,
      brief,
      review,
      episodes: [],
      hasLyrics: false,
      sfxRequested: false,
    });

    for (const val of Object.values(score)) {
      expect(Number.isFinite(val)).toBe(true);
    }
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(100);
  });

  it('planSequence lida com listas de slots ou candidatos vazias sem falhar', () => {
    expect(
      planSequence([], [{ id: 'c1', assetId: 'a', episodeOrder: 0, sequenceOrder: 0, sourceStartS: 0, sourceEndS: 2 }], {
        mode: 'narrative',
        seed: 1,
        score: () => 1,
      }),
    ).toEqual({ choices: [], repeatedSlots: [], totalScore: 0 });

    expect(
      planSequence(['s1', 's2'], [], {
        mode: 'narrative',
        seed: 1,
        score: () => 1,
      }),
    ).toEqual({ choices: [null, null], repeatedSlots: [], totalScore: 0 });
  });

  it('gera timeline V1 contínua sem buracos em episódio curto (sem OP/ED reservado), ignora mídia ausente e preserva reason + confidence', () => {
    let p: Project = createProject({ name: 'ShortEp', settings: { width: 1920, height: 1080, fps: { num: 30, den: 1 } } });
    const music = makeMusic(12);
    const shortEp = makeEpisode('ep_short', 6); // 18 s (< 3 min): sem reserva de OP/ED
    for (const asset of [
      makeAsset('mus_1', 'audio', 12, 'ok'),
      makeAsset('ep_short', 'video', 18, 'ok'),
      makeAsset('ep_missing', 'video', 18, 'missing'),
    ]) {
      p = applyCommand(p, { type: 'asset.add', asset }).project;
    }

    const best = generateBestAmv({
      project: p,
      music,
      episodes: [shortEp],
      options: {
        style: 'hype',
        durationS: 12,
        musicStartS: 0,
        intensity: 2,
        useSpeech: true,
        voiceMoments: 2,
        useEffects: true,
        showText: true,
        focus: 'mix',
        hitSync: true,
        lyrics: [
          { startS: 0.5, endS: 3.5, text: 'Levanta do chão' },
          { startS: 8.0, endS: 11.5, text: 'Hora da virada final' },
        ],
        seed: 42,
        autonomous: true,
      },
      candidateCount: 2,
    });

    const applied = applyCommand(p, {
      type: 'batch',
      commands: best.winner.generated.commands,
    }).project;

    const v1Id = applied.tracks.find((t) => t.name === 'V1')!.id;
    const v1Clips = applied.clips
      .filter((c) => c.trackId === v1Id)
      .sort((a, b) => a.timelineStartUs - b.timelineStartUs);

    expect(v1Clips.length).toBeGreaterThan(2);
    expect(v1Clips[0]!.timelineStartUs).toBe(0);
    for (let i = 1; i < v1Clips.length; i++) {
      const gapUs = v1Clips[i]!.timelineStartUs - clipEndUs(v1Clips[i - 1]!);
      expect(Math.abs(gapUs)).toBeLessThanOrEqual(2_000);
    }

    const aiClips = applied.clips.filter((c) => c.origin === 'ai');
    expect(aiClips.length).toBeGreaterThan(0);
    for (const clip of aiClips) {
      expect(typeof clip.reason).toBe('string');
      expect(clip.reason!.trim().length).toBeGreaterThan(0);
      if (clip.confidence !== null && clip.confidence !== undefined) {
        expect(Number.isFinite(clip.confidence)).toBe(true);
        expect(clip.confidence).toBeGreaterThanOrEqual(0);
        expect(clip.confidence).toBeLessThanOrEqual(1);
      }
      expect(clip.assetId).not.toBe('ep_missing');
    }
    // Decisões apoiadas por confiança medida (ex.: fala detectada) preservam confidence numérico
    const voiceTrackId = applied.tracks.find((t) => t.kind === 'audio' && t.role === 'voice')?.id;
    const voiceClips = aiClips.filter((c) => c.trackId === voiceTrackId);
    for (const vc of voiceClips) {
      expect(typeof vc.confidence).toBe('number');
    }
  });
});
