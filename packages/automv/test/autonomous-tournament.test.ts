import { describe, expect, it } from 'vitest';
import { shotKey, type Cue, type EpisodeAnalysis, type LocalVisualFeatures, type MusicAnalysis, type Shot } from '@amv/analysis';
import { applyCommand, createProject, type Asset, type Project } from '@amv/project';
import {
  generateBestAmv,
  scoreSceneCandidate,
  styleDef,
  type EpisodeInput,
  type GenerateOptions,
  type MusicInput,
} from '../src/index.js';

const S = 1_000_000;

function makeLocalFeatures(hashSuffix: string, brightness = 0.52, hasSubject = true, quadrantOverride?: number): LocalVisualFeatures {
  let seed = 2166136261;
  for (let i = 0; i < hashSuffix.length; i++) {
    seed = Math.imul(seed ^ hashSuffix.charCodeAt(i), 16777619);
  }
  const quadrant = quadrantOverride ?? ((seed >>> 0) % 4);
  return {
    version: 3,
    samples: 3,
    lumaGrid: Array.from({ length: 64 }, (_, i) => {
      const gx = i % 8;
      const gy = Math.floor(i / 8);
      const qMatch = (quadrant === 0 && gx < 4 && gy < 4)
        || (quadrant === 1 && gx >= 4 && gy < 4)
        || (quadrant === 2 && gx < 4 && gy >= 4)
        || (quadrant === 3 && gx >= 4 && gy >= 4);
      return qMatch ? 0.88 : 0.12;
    }),
    edgeGrid: Array.from({ length: 16 }, (_, i) => (i % 4 === quadrant ? 0.72 : 0.08)),
    colorHistogram: [0.35, 0.35, 0.2, 0.1, 0.25, 0.35, 0.25, 0.15, 0.2, 0.3, 0.3, 0.2],
    dominantColors: ['#ff4060', '#182438'],
    brightness,
    saturation: 0.48,
    entropy: 0.62,
    edgeDensity: 0.14,
    deadFrameScore: 0.05,
    textClutterScore: 0,
    centerOfVisualMass: [0.5, 0.45],
    subjectFocus: [0.5, 0.38],
    subjectFocusConfidence: hasSubject ? 0.78 : 0.2,
    focusTrajectory: [[0.46, 0.38], [0.54, 0.38]],
    temporalMotion: 0.18,
    globalShift: [0.02, 0],
    globalMotion: 0.28,
    motionEvents: [],
    motionConfidence: 0.72,
    fingerprint: `lv3-${hashSuffix}`,
    sceneType: 'action',
    sceneTypeConfidence: 0.75,
  };
}

function makeRichFixture() {
  const beats = Array.from({ length: 120 }, (_, i) => i * 0.5);
  const energy = Array.from({ length: 240 }, (_, i) => {
    const t = i * 0.25;
    if (t < 8) return 0.24;
    if (t < 14) return 0.56;
    if (t < 26) return 0.88;
    return 0.34;
  });
  const musicAnalysis: MusicAnalysis = {
    version: 'm1',
    durationS: 60,
    bpm: 120,
    bpmConfidence: 0.92,
    beats,
    downbeats: beats.filter((_, i) => i % 4 === 0),
    energy,
    energyStepS: 0.25,
    sections: [
      { startS: 0, endS: 8, label: 'intro', energy: 0.24 },
      { startS: 8, endS: 14, label: 'verso', energy: 0.56 },
      { startS: 14, endS: 26, label: 'drop', energy: 0.88 },
      { startS: 26, endS: 60, label: 'final', energy: 0.34 },
    ],
    drops: [14],
    intensity: 76,
    loudnessDb: -11,
  };
  const music: MusicInput = { assetId: 'mus', name: 'batalha.mp3', analysis: musicAnalysis };

  const shots: Shot[] = [];
  const visionShots: Record<string, { characters: string[]; fight: boolean; note: string; local: LocalVisualFeatures }> = {};
  for (let i = 0; i < 45; i++) {
    const startS = i * 3;
    const endS = startS + 2.8;
    const intensity = i < 8 ? 0.35 + (i % 3) * 0.08 : 0.65 + ((i * 19) % 32) / 100;
    const sh: Shot = {
      startS,
      endS,
      motion: Math.min(0.95, intensity * 0.9),
      loud: intensity * 0.8,
      intensity: Math.min(0.98, intensity),
      brightness: 0.45 + ((i % 4) * 0.08),
      tags: intensity >= 0.72 ? ['ação', 'impacto'] : intensity <= 0.42 ? ['calma'] : ['ação'],
      line: null,
      peakS: startS + 0.04,
    };
    shots.push(sh);
    visionShots[shotKey(startS)] = {
      characters: ['Herói'],
      fight: i >= 6,
      note: '',
      local: makeLocalFeatures(`uniq${i}`, sh.brightness, true),
    };
  }

  const epAnalysis: EpisodeAnalysis = {
    version: 'e4',
    durationS: 140,
    shots,
    sequences: [
      { id: 'f1', kind: 'luta', startS: 18, endS: 132, shotCount: 38, intensity: 0.82, peak: 0.95 },
    ],
    speech: [
      { startS: 19, endS: 21.1, kind: 'grito', confidence: 0.92, text: 'Eu vou proteger todos aqui!', impact: 0.94 },
      { startS: 48, endS: 50.0, kind: 'fala', confidence: 0.88, text: 'Esse é o nosso limite final!', impact: 0.86 },
    ],
    subtitles: [],
    intensityCurve: [],
    curveStepS: 1,
  };
  const ep: EpisodeInput = {
    assetId: 'ep1',
    name: 'ep01.mkv',
    analysis: epAnalysis,
    hasAudio: true,
    vision: { version: 'v2', model: 'local-visual-v3', localModel: 'local-visual-v3', shots: visionShots },
  };

  let project: Project = createProject({ name: 'Modo Livre', settings: { width: 1920, height: 1080, fps: { num: 30, den: 1 } } });
  // Garante trilha V2 extra para recorte de profundidade de personagem
  if (project.tracks.filter((t) => t.kind === 'video').length < 2) {
    project = {
      ...project,
      tracks: [
        { id: 'trk_v2', name: 'V2', kind: 'video', role: null, muted: false, solo: false, locked: false, hidden: false, gainDb: 0 },
        ...project.tracks,
      ],
    };
  }
  const makeAsset = (id: string, kind: Asset['kind'], dur: number, tags: string[] = []): Asset => ({
    id,
    name: id,
    path: `/media/${id}`,
    hash: id,
    kind,
    status: 'ok',
    error: null,
    importedAt: '',
    tags,
    favorite: false,
    probe: {
      container: 'mp4',
      durationUs: dur * S,
      sizeBytes: 1000,
      bitRate: null,
      video: kind === 'video' ? { codec: 'h264', profile: null, width: 1920, height: 1080, pixFmt: 'yuv420p', bitDepth: 8, fps: { num: 30, den: 1 }, avgFps: null, vfr: false, frameCount: dur * 30 } : null,
      audio: [{ index: 1, codec: 'aac', sampleRate: 48000, channels: 2, channelLayout: 'stereo', language: 'jpn', title: null }],
      subtitles: [],
      tags: {},
    },
  });
  for (const a of [
    makeAsset('mus', 'audio', 60),
    makeAsset('ep1', 'video', 140),
    makeAsset('sfx_impact', 'audio', 2, ['sfx']),
    makeAsset('sfx_hit', 'audio', 1, ['sfx']),
    makeAsset('sfx_clash', 'audio', 1, ['sfx']),
    makeAsset('sfx_riser', 'audio', 2, ['sfx']),
    makeAsset('sfx_whoosh', 'audio', 1, ['sfx']),
  ]) {
    project = applyCommand(project, { type: 'asset.add', asset: a }).project;
  }

  const lyrics: Cue[] = [
    { startS: 2.0, endS: 5.5, text: 'Na sombra da noite silenciosa' },
    { startS: 8.5, endS: 11.2, text: 'O trovão começa a subir' },
    { startS: 14.0, endS: 16.4, text: 'CHAMA IMORTAL EXPLODE AGORA' },
    { startS: 17.0, endS: 19.6, text: 'CORTANDO O DESTINO AO MEIO' },
    { startS: 27.0, endS: 29.4, text: 'A cinza repousa no vento' },
  ];

  return { project, music, ep, lyrics };
}

describe('Modo Livre (Diretor Autônomo Unificado) & Torneio Multi-Candidato', () => {
  it('unifica cortes na batida, tipografia dinâmica por seção, blend c/ vídeo, recorte V2, falas e golpes num único AMV e elege o melhor de 5', () => {
    const { project, music, ep, lyrics } = makeRichFixture();
    const options: GenerateOptions = {
      autonomous: true,
      style: 'hype',
      intensity: 2,
      durationS: 30,
      musicStartS: 0,
      lyrics,
      useSpeech: true,
      useEffects: true,
      showText: true,
      useSfx: true,
      sfxAssets: {
        impact: 'sfx_impact',
        hit: 'sfx_hit',
        clash: 'sfx_clash',
        riser: 'sfx_riser',
        whoosh: 'sfx_whoosh',
      },
      seed: 1,
    };

    const tournament = generateBestAmv({
      project,
      music,
      episodes: [ep],
      options,
      candidateCount: 5,
    });

    expect(tournament.candidatesEvaluated).toBe(5);
    expect(tournament.allScores).toHaveLength(5);
    expect(tournament.winner.score.total).toBeGreaterThanOrEqual(tournament.allScores.at(-1)!.score);
    expect(tournament.winner.score.total).toBeGreaterThan(70);
    expect(tournament.unifiedHighlights.length).toBeGreaterThanOrEqual(2);

    const out = applyCommand(project, { type: 'batch', commands: tournament.winner.generated.commands }).project;
    const textTrack = out.tracks.find((t) => t.kind === 'text')!;
    const voiceTrack = out.tracks.find((t) => t.role === 'voice')!;
    const sfxTrack = out.tracks.find((t) => t.role === 'sfx')!;

    const lyricClips = out.clips.filter((c) => c.trackId === textTrack.id && /letra da música|palavra da letra/i.test(c.reason ?? ''));
    const speechCaptions = out.clips.filter((c) => c.trackId === textTrack.id && /legenda da fala/i.test(c.reason ?? ''));
    const distinctLyricFonts = new Set(lyricClips.map((c) => c.text?.font));
    const hasVideoBlendOrHollow = lyricClips.some((c) => c.blendMode !== 'normal' || c.text?.fillStyle === 'hollow');
    const v2Track = out.tracks.find((t) => t.kind === 'video' && t.name === 'V2') ?? out.tracks.filter((t) => t.kind === 'video')[0]!;
    const v2Cutouts = out.clips.filter((c) => c.trackId === v2Track.id);
    const sfxClips = out.clips.filter((c) => c.trackId === sfxTrack.id);
    const voiceClips = out.clips.filter((c) => c.trackId === voiceTrack.id);

    // 1. Tipografia muda conforme a seção musical (intro editorial -> subida -> explosão mesclada no drop)
    expect(distinctLyricFonts.size).toBeGreaterThanOrEqual(2);
    expect(hasVideoBlendOrHollow).toBe(true);
    // 2. Personagem destacado em V2 com letra passando atrás
    expect(v2Cutouts.length).toBeGreaterThanOrEqual(1);
    expect(lyricClips.some((c) => c.text?.behindCutout === true)).toBe(true);
    // 3. Fala dramática + legenda distinta + som de golpe real do anime + SFX de impacto
    expect(tournament.winner.generated.summary.voices).toBeGreaterThanOrEqual(1);
    expect(speechCaptions.length).toBeGreaterThanOrEqual(1);
    expect(sfxClips.length).toBeGreaterThanOrEqual(2);
    expect(voiceClips.some((c) => c.label === 'Golpe anime')).toBe(true);
    // 4. Nenhum problema crítico após revisão e auto-reparo
    expect(tournament.winner.review.quality.issues.filter((i) => i.severity === 'high')).toHaveLength(0);
  });

  it('penaliza rigorosamente clones visuais (mesma assinatura em instantes distintos) e quadros mortos', () => {
    const cloneA = makeLocalFeatures('clone999', 0.5, true, 0);
    const cloneB = { ...makeLocalFeatures('clone999', 0.5, true, 0) };
    const deadLocal = { ...makeLocalFeatures('dead000', 0.04, false, 1), deadFrameScore: 0.9, textClutterScore: 0.8 };
    const cleanLocal = makeLocalFeatures('fresh777', 0.52, true, 2);

    const baseShot: Shot = {
      startS: 10,
      endS: 13,
      motion: 0.65,
      loud: 0.6,
      intensity: 0.8,
      brightness: 0.5,
      tags: ['ação', 'impacto'],
      line: null,
      peakS: 11,
    };
    const style = styleDef('hype');

    const freshScore = scoreSceneCandidate({
      shot: baseShot,
      targetIntensity: 0.8,
      musicEnergy: 0.8,
      isDrop: false,
      style,
      current: { assetId: 'ep1', sequenceId: 'ep1#f1', sourceStartS: 10 },
      local: cleanLocal,
      recentLocals: [cloneA],
    });
    const cloneScore = scoreSceneCandidate({
      shot: baseShot,
      targetIntensity: 0.8,
      musicEnergy: 0.8,
      isDrop: false,
      style,
      current: { assetId: 'ep1', sequenceId: 'ep1#f1', sourceStartS: 25 },
      local: cloneB,
      recentLocals: [cloneA],
    });
    const deadScore = scoreSceneCandidate({
      shot: baseShot,
      targetIntensity: 0.8,
      musicEnergy: 0.8,
      isDrop: false,
      style,
      current: { assetId: 'ep1', sequenceId: 'ep1#f1', sourceStartS: 40 },
      local: deadLocal,
      recentLocals: [],
    });

    expect(freshScore.total - cloneScore.total).toBeGreaterThan(0.35);
    expect(cloneScore.reasons.some((r) => /composição visual quase idêntica/i.test(r))).toBe(true);
    expect(freshScore.total - deadScore.total).toBeGreaterThan(0.5);
    expect(deadScore.reasons.some((r) => /sem detalhe visual|créditos/i.test(r))).toBe(true);
  });
});
