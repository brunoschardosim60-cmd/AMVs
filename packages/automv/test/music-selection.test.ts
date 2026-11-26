import { describe, expect, it } from 'vitest';
import type { EpisodeAnalysis, MusicAnalysis } from '@amv/analysis';
import { applyCommand, automaticDuckingGain, createProject, evaluateKeyframes, type Asset, type Project } from '@amv/project';
import {
  buildProjectMusicDuckingCommands,
  chooseMusicRange,
  generateAmv,
  suggestMusicRanges,
  type EpisodeInput,
  type MusicInput,
} from '../src/index.js';

const S = 1_000_000;

function makeProject(): Project {
  let p = createProject({ name: 'mix-smart', settings: { width: 1920, height: 1080, fps: { num: 30, den: 1 } } });
  const mkAsset = (id: string, kind: Asset['kind'], durS: number): Asset => ({
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
      sizeBytes: 1,
      bitRate: null,
      video: kind === 'video' ? { codec: 'h264', profile: null, width: 1920, height: 1080, pixFmt: null, bitDepth: 8, fps: { num: 24, den: 1 }, avgFps: null, vfr: false, frameCount: null } : null,
      audio: [{ index: 1, codec: 'aac', sampleRate: 48000, channels: 2, channelLayout: null, language: 'jpn', title: null }],
      subtitles: [],
      tags: {},
    },
  });
  p = applyCommand(p, { type: 'asset.add', asset: mkAsset('mus', 'audio', 150) }).project;
  p = applyCommand(p, { type: 'asset.add', asset: mkAsset('ep1', 'video', 240) }).project;
  return p;
}

function makeEpisode(): EpisodeInput {
  const shots = Array.from({ length: 40 }, (_, i) => ({
    startS: i * 4,
    endS: i * 4 + 3.6,
    motion: 0.75,
    loud: 0.7,
    intensity: 0.78,
    brightness: 0.52,
    tags: ['ação', 'impacto'] as ('ação' | 'impacto')[],
    line: null,
    peakS: i * 4 + 1.2,
  }));
  const analysis: EpisodeAnalysis = {
    version: 'e2',
    durationS: 160,
    shots,
    sequences: [{ id: 's1', kind: 'luta', startS: 0, endS: 160, intensity: 0.8, peak: 0.9, shotCount: 40 }],
    subtitles: [],
    intensityCurve: [],
    curveStepS: 1,
    speech: [
      { startS: 12, endS: 14, kind: 'fala', confidence: 0.92, text: 'Eu vou superar tudo agora!', impact: 0.92 },
      { startS: 32, endS: 34, kind: 'fala', confidence: 0.9, text: 'Ainda não acabou!', impact: 0.88 },
    ],
  };
  return { assetId: 'ep1', name: 'ep1.mkv', analysis, hasAudio: true };
}

describe('seleção inteligente da melhor parte da música e anti-abafamento', () => {
  it('escolhe o drop/refrão realmente mais forte quando há um transiente fraco na introdução', () => {
    const beats = Array.from({ length: 300 }, (_, i) => i * 0.5);
    const energy = Array.from({ length: 600 }, (_, i) => {
      const t = i * 0.25;
      if (t < 15) return 0.2;
      if (t < 30) return 0.42; // falso drop fraco em 15s
      if (t < 70) return 0.25;
      if (t < 115) return 0.94; // verdadeiro clímax/drop em 70s
      return 0.3;
    });
    const m: MusicAnalysis = {
      version: 'm1',
      durationS: 150,
      bpm: 120,
      bpmConfidence: 0.92,
      beats,
      downbeats: beats.filter((_, i) => i % 4 === 0),
      energy,
      energyStepS: 0.25,
      sections: [
        { startS: 0, endS: 30, label: 'intro', energy: 0.3 },
        { startS: 30, endS: 70, label: 'verso', energy: 0.25 },
        { startS: 70, endS: 115, label: 'refrão', energy: 0.94 },
        { startS: 115, endS: 150, label: 'final', energy: 0.3 },
      ],
      drops: [15, 70],
      intensity: 78,
      loudnessDb: -11,
    };

    const [startS, endS] = chooseMusicRange(m, 30, null);
    expect(endS - startS).toBe(30);
    // O clímax em 70s deve cair dentro da janela escolhida (~40% de 30s -> início perto de 58s)
    expect(startS).toBeGreaterThanOrEqual(52);
    expect(startS).toBeLessThanOrEqual(62);
  });

  it('encontra o refrão de maior energia mesmo quando a música não tem drops explícitos', () => {
    const beats = Array.from({ length: 240 }, (_, i) => i * 0.5);
    const energy = Array.from({ length: 480 }, (_, i) => {
      const t = i * 0.25;
      return t >= 64 && t < 96 ? 0.92 : 0.22;
    });
    const m: MusicAnalysis = {
      version: 'm1',
      durationS: 120,
      bpm: 120,
      bpmConfidence: 0.9,
      beats,
      downbeats: beats.filter((_, i) => i % 4 === 0),
      energy,
      energyStepS: 0.25,
      sections: [
        { startS: 0, endS: 64, label: 'intro', energy: 0.22 },
        { startS: 64, endS: 96, label: 'refrão', energy: 0.92 },
        { startS: 96, endS: 120, label: 'final', energy: 0.22 },
      ],
      drops: [],
      intensity: 68,
      loudnessDb: -12,
    };

    const [startS, endS] = chooseMusicRange(m, 30, null);
    expect(startS).toBeGreaterThanOrEqual(48);
    expect(endS).toBeGreaterThanOrEqual(78);

    const suggestions = suggestMusicRanges(m, 30, null, 3);
    expect(suggestions[0]!.startS).toBeGreaterThanOrEqual(46);
    expect(suggestions[0]!.reasons.join(' ')).toMatch(/refrão|energia|pico/i);
  });

  it('silencia cortes visuais em V1 (-60 dB) para não vazar BGM do anime nem abafar a música com auto-ducking', () => {
    const p = makeProject();
    const beats = Array.from({ length: 180 }, (_, i) => i * 0.5);
    const musicInput: MusicInput = {
      assetId: 'mus',
      name: 'musica.mp3',
      analysis: {
        version: 'm1',
        durationS: 90,
        bpm: 120,
        bpmConfidence: 0.9,
        beats,
        downbeats: beats.filter((_, i) => i % 4 === 0),
        energy: Array.from({ length: 360 }, (_, i) => (i * 0.25 < 40 ? 0.25 : 0.9)),
        energyStepS: 0.25,
        sections: [{ startS: 0, endS: 40, label: 'intro', energy: 0.25 }, { startS: 40, endS: 90, label: 'drop', energy: 0.9 }],
        drops: [40],
        intensity: 75,
        loudnessDb: -12,
      },
    };
    const res = generateAmv(p, musicInput, [makeEpisode()], {
      style: 'hype',
      intensity: 2,
      durationS: 30,
      musicStartS: 28,
      useSpeech: false,
      useEffects: true,
      showText: false,
      seed: 1,
    });
    const out = applyCommand(p, { type: 'batch', commands: res.commands }).project;
    const v1Id = out.tracks.find((t) => t.name === 'V1')!.id;
    const musicTrackId = out.tracks.find((t) => t.role === 'music')!.id;
    const v1Clips = out.clips.filter((c) => c.trackId === v1Id);
    expect(v1Clips.length).toBeGreaterThan(5);
    expect(v1Clips.every((c) => c.audio.gainDb === -60)).toBe(true);
    // A música permanece em volume total (ganho linear 1,0) sem ser abafada pelos cortes de V1
    expect(automaticDuckingGain(out, musicTrackId, 15 * S)).toBe(1);
  });

  it('recalcula pós-geração os presets de ducking da música (off, gentle, smart, deep)', () => {
    const p = makeProject();
    const beats = Array.from({ length: 180 }, (_, i) => i * 0.5);
    const analysis: MusicAnalysis = {
      version: 'm1',
      durationS: 90,
      bpm: 120,
      bpmConfidence: 0.9,
      beats,
      downbeats: beats.filter((_, i) => i % 4 === 0),
      energy: Array.from({ length: 360 }, (_, i) => (i * 0.25 < 40 ? 0.25 : 0.9)),
      energyStepS: 0.25,
      sections: [{ startS: 0, endS: 40, label: 'intro', energy: 0.25 }, { startS: 40, endS: 90, label: 'drop', energy: 0.9 }],
      drops: [40],
      intensity: 75,
      loudnessDb: -12,
    };
    const res = generateAmv(p, { assetId: 'mus', name: 'musica.mp3', analysis }, [makeEpisode()], {
      style: 'hype',
      intensity: 2,
      durationS: 30,
      musicStartS: 26, // drop em 14s na timeline
      useSpeech: true,
      voiceMoments: 2,
      speechVisualMode: 'voiceover',
      useEffects: true,
      showText: true,
      seed: 3,
    });
    let out = applyCommand(p, { type: 'batch', commands: res.commands }).project;
    const musicTrackId = out.tracks.find((t) => t.role === 'music')!.id;
    const voiceTrackId = out.tracks.find((t) => t.role === 'voice')!.id;
    const musicClip = out.clips.find((c) => c.trackId === musicTrackId)!;
    const postVoice = out.clips.find((c) => c.trackId === voiceTrackId && c.timelineStartUs > 14 * S);
    if (postVoice) {
      // No refrão pós-drop de alta energia, o ducking padrão/smart protege a música (>= -10 dB em vez de -16 dB)
      const midVoiceUs = postVoice.timelineStartUs + Math.round(postVoice.durationUs / 2);
      expect(evaluateKeyframes(musicClip.keyframes['audio.gainDb'], midVoiceUs, 0)).toBeGreaterThanOrEqual(-10);
    }

    // Preset 'off': limpa qualquer queda de volume na música (0 dB do início ao fim)
    const offCmds = buildProjectMusicDuckingCommands(out, musicClip.id, 'off', analysis);
    out = applyCommand(out, { type: 'batch', commands: offCmds }).project;
    const cleanMusic = out.clips.find((c) => c.id === musicClip.id)!;
    expect(cleanMusic.keyframes['audio.gainDb']).toBeUndefined();
    expect(cleanMusic.audio.duckingMode).toBe('manual');

    // Preset 'gentle': redução suave de -6 dB
    const gentleCmds = buildProjectMusicDuckingCommands(out, musicClip.id, 'gentle', analysis);
    out = applyCommand(out, { type: 'batch', commands: gentleCmds }).project;
    const gentleMusic = out.clips.find((c) => c.id === musicClip.id)!;
    expect(gentleMusic.keyframes['audio.gainDb']?.some((k) => k.value >= -7.5 && k.value <= -6)).toBe(true);
  });
});
