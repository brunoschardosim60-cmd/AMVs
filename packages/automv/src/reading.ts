import { shotKey, visualSimilarity, type EpisodeVision } from '@amv/analysis';
import { clipEndUs, sourceTimeAt, timelineLocalAtSource, type Clip, type Command, type Project } from '@amv/project';
import { autoRepairAssembly } from './auto-repair.js';
import { buildCreativeBrief, reviewGeneratedAssembly } from './creative-director.js';
import type { EpisodeInput, MusicInput } from './generate.js';
import { planNarrative } from './narrative.js';
import { evaluateAudiovisualQuality, type QualityReport } from './quality.js';
import { scoreAssemblyQuality, type AssemblyScoreBreakdown } from './tournament.js';

const SECOND = 1_000_000;

export interface PlayheadMusicReading {
  musicName: string;
  bpm: number;
  sectionLabel: string;
  energy: number;
  beatDeltaMs: number | null;
  beatStatus: 'locked' | 'near' | 'off' | 'unknown';
  nearestBeatTimelineUs: number | null;
  nextDropInS: number | null;
}

export interface PlayheadSceneReading {
  clipId: string;
  episodeName: string;
  sourceTimeS: number;
  intensity: number;
  motion: number;
  brightness: number;
  sharpness: number;
  cameraMotion: string | null;
  dominantColors: string[];
  subjectFocus: [number, number] | null;
  peakTimelineUs: number | null;
  peakBeatDeltaMs: number | null;
}

export interface PlayheadTextReading {
  clipId: string;
  text: string;
  charsPerSecond: number;
  wordsPerMinute: number;
  readingPace: 'comfortable' | 'fast' | 'too-fast' | 'too-short';
  contrastStatus: 'good' | 'low-contrast' | 'covers-face';
  suggestion: string | null;
}

export interface PlayheadReadingInsight {
  music: PlayheadMusicReading | null;
  scene: PlayheadSceneReading | null;
  text: PlayheadTextReading | null;
}

export interface ProjectReadingSummary {
  score: AssemblyScoreBreakdown;
  quality: QualityReport;
  totalVideoClips: number;
  uniqueScenes: number;
  beatLockedCuts: number;
  beatLockedRate: number;
  syncedHitPeaks: number;
  textClipsCount: number;
  fastTextCount: number;
  lowContrastOrFaceTextCount: number;
  averageCps: number;
}

export interface SuggestedReplacementShot {
  assetId: string;
  episodeName: string;
  startS: number;
  endS: number;
  peakS: number;
  recommendedInS: number;
  intensity: number;
  tags: string[];
  score: number;
  reason: string;
}

function parseHexLuma(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function boostPaletteColor(hex: string): { accent: string; highlight: string } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const avg = (r + g + b) / 3;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (rr: number, gg: number, bb: number) =>
    `#${[clamp(rr), clamp(gg), clamp(bb)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const br = Math.min(255, Math.max(65, avg + (r - avg) * 1.85 + 42));
  const bg = Math.min(255, Math.max(65, avg + (g - avg) * 1.85 + 42));
  const bb = Math.min(255, Math.max(65, avg + (b - avg) * 1.85 + 42));
  return {
    accent: toHex(br, bg, bb),
    highlight: toHex(br * 0.45 + 255 * 0.55, bg * 0.45 + 250 * 0.55, bb * 0.45 + 235 * 0.55),
  };
}

function findSourceShot(episode: EpisodeInput | undefined, sourceS: number) {
  if (!episode) return undefined;
  return episode.analysis.shots.find((s) => sourceS >= s.startS && sourceS < s.endS)
    ?? episode.analysis.shots.find((s) => sourceS >= s.startS - 0.05 && sourceS <= s.endS + 0.05);
}

function timelineBeatsForMusicClip(musicClip: Clip, music: MusicInput): number[] {
  const out: number[] = [];
  for (const beatS of music.analysis.beats) {
    const localUs = timelineLocalAtSource(musicClip, Math.round(beatS * SECOND));
    if (localUs === null) continue;
    const tlUs = musicClip.timelineStartUs + localUs;
    if (tlUs >= musicClip.timelineStartUs && tlUs <= clipEndUs(musicClip)) out.push(tlUs);
  }
  return out.sort((a, b) => a - b);
}

function nearestBeatUs(targetUs: number, beatsUs: readonly number[]): { beatUs: number; deltaMs: number } | null {
  if (!beatsUs.length) return null;
  let bestUs = beatsUs[0]!;
  let bestAbs = Math.abs(targetUs - bestUs);
  for (let i = 1; i < beatsUs.length; i++) {
    const d = Math.abs(targetUs - beatsUs[i]!);
    if (d < bestAbs) {
      bestAbs = d;
      bestUs = beatsUs[i]!;
    }
  }
  return { beatUs: bestUs, deltaMs: Math.round(((targetUs - bestUs) / 1000) * 10) / 10 };
}

/**
 * Lê simultaneamente música, cena ativa e legibilidade/contraste do texto no instante do playhead.
 */
export function readPlayheadInsight(input: {
  project: Project;
  playheadUs: number;
  episodes: EpisodeInput[];
  musics: MusicInput[];
}): PlayheadReadingInsight {
  const { project, playheadUs, episodes, musics } = input;
  const epById = new Map(episodes.map((ep) => [ep.assetId, ep]));
  const musicById = new Map(musics.map((m) => [m.assetId, m]));
  const tracksById = new Map(project.tracks.map((t) => [t.id, t]));
  const videoTracks = project.tracks.filter((t) => t.kind === 'video' && !t.hidden);
  const v1Track = videoTracks.at(-1);

  const activeMusicClip = project.clips.find((c) => {
    const tr = tracksById.get(c.trackId);
    return tr?.kind === 'audio' && tr.role === 'music' && !tr.muted
      && c.assetId && playheadUs >= c.timelineStartUs && playheadUs < clipEndUs(c);
  });
  let musicReading: PlayheadMusicReading | null = null;
  let beatsUs: number[] = [];
  if (activeMusicClip?.assetId) {
    const mInput = musicById.get(activeMusicClip.assetId);
    if (mInput) {
      const m = mInput.analysis;
      const localUs = Math.max(0, playheadUs - activeMusicClip.timelineStartUs);
      const srcS = sourceTimeAt(activeMusicClip, localUs) / SECOND;
      const eIdx = Math.min(m.energy.length - 1, Math.max(0, Math.floor(srcS / Math.max(0.05, m.energyStepS))));
      const energy = m.energy[eIdx] ?? 0;
      const sec = m.sections.find((s) => srcS >= s.startS && srcS < s.endS) ?? m.sections.at(-1);
      beatsUs = timelineBeatsForMusicClip(activeMusicClip, mInput);
      const near = nearestBeatUs(playheadUs, beatsUs);
      const absMs = near ? Math.abs(near.deltaMs) : null;
      const nextDropSrc = m.drops.find((d) => d >= srcS - 0.05);
      let nextDropInS: number | null = null;
      if (nextDropSrc !== undefined) {
        const dropLocalUs = timelineLocalAtSource(activeMusicClip, Math.round(nextDropSrc * SECOND));
        if (dropLocalUs !== null) {
          nextDropInS = Math.max(0, Math.round(((activeMusicClip.timelineStartUs + dropLocalUs - playheadUs) / SECOND) * 10) / 10);
        }
      }
      musicReading = {
        musicName: mInput.name,
        bpm: Math.round(m.bpm),
        sectionLabel: sec?.label ?? 'trecho',
        energy: Math.round(energy * 100) / 100,
        beatDeltaMs: near ? near.deltaMs : null,
        beatStatus: absMs === null ? 'unknown' : absMs <= 45 ? 'locked' : absMs <= 110 ? 'near' : 'off',
        nearestBeatTimelineUs: near ? near.beatUs : null,
        nextDropInS,
      };
    }
  }

  const activeVideoClip = v1Track
    ? project.clips.find((c) => c.trackId === v1Track.id && c.assetId && playheadUs >= c.timelineStartUs && playheadUs < clipEndUs(c))
    : undefined;
  let sceneReading: PlayheadSceneReading | null = null;
  if (activeVideoClip?.assetId) {
    const ep = epById.get(activeVideoClip.assetId);
    const localUs = Math.max(0, playheadUs - activeVideoClip.timelineStartUs);
    const srcS = sourceTimeAt(activeVideoClip, localUs) / SECOND;
    const shot = findSourceShot(ep, srcS);
    const vision = shot ? ep?.vision?.shots[shotKey(shot.startS)] : undefined;
    const local = vision?.local;
    const activeMotion = local?.motionEvents?.find((ev) => srcS >= ev.startS - 0.2 && srcS <= ev.endS + 0.2 && ev.confidence >= 0.55)
      ?? local?.motionEvents?.[0];
    let peakTimelineUs: number | null = null;
    let peakBeatDeltaMs: number | null = null;
    if (shot && Number.isFinite(shot.peakS)) {
      const peakLocalUs = timelineLocalAtSource(activeVideoClip, Math.round(shot.peakS * SECOND));
      if (peakLocalUs !== null && peakLocalUs >= 0 && peakLocalUs <= activeVideoClip.durationUs) {
        peakTimelineUs = activeVideoClip.timelineStartUs + peakLocalUs;
        const nearPeakBeat = nearestBeatUs(peakTimelineUs, beatsUs);
        if (nearPeakBeat) peakBeatDeltaMs = nearPeakBeat.deltaMs;
      }
    }
    sceneReading = {
      clipId: activeVideoClip.id,
      episodeName: ep?.name ?? activeVideoClip.assetId,
      sourceTimeS: Math.round(srcS * 100) / 100,
      intensity: Math.round((shot?.intensity ?? 0) * 100) / 100,
      motion: Math.round((shot?.motion ?? 0) * 100) / 100,
      brightness: Math.round((local?.brightness ?? shot?.brightness ?? 0.5) * 100) / 100,
      sharpness: Math.round((1 - (local?.deadFrameScore ?? 0)) * 100) / 100,
      cameraMotion: activeMotion && activeMotion.cameraMotion !== 'unknown' ? activeMotion.cameraMotion : null,
      dominantColors: local?.dominantColors ?? [],
      subjectFocus: local?.subjectFocus && (local.subjectFocusConfidence ?? 0) >= 0.5 ? local.subjectFocus : null,
      peakTimelineUs,
      peakBeatDeltaMs,
    };
  }

  const activeTextClip = project.clips.find((c) => {
    const tr = tracksById.get(c.trackId);
    return tr?.kind === 'text' && !tr.hidden && Boolean(c.text) && playheadUs >= c.timelineStartUs && playheadUs < clipEndUs(c);
  });
  let textReading: PlayheadTextReading | null = null;
  if (activeTextClip?.text) {
    const clean = activeTextClip.text.text.replace(/\s+/g, ' ').trim();
    const durS = Math.max(0.05, activeTextClip.durationUs / SECOND);
    const chars = Array.from(clean.replace(/\s+/g, '')).length;
    const words = clean ? clean.split(/\s+/).length : 0;
    const cps = Math.round((chars / durS) * 10) / 10;
    const wpm = Math.round((words / durS) * 60);
    const readingPace: PlayheadTextReading['readingPace'] = durS < 0.32 && words >= 2
      ? 'too-short'
      : cps > 23
        ? 'too-fast'
        : cps > 17
          ? 'fast'
          : 'comfortable';

    let contrastStatus: PlayheadTextReading['contrastStatus'] = 'good';
    let suggestion: string | null = null;
    const H = Math.max(1, project.settings.height);
    const textNormY = 0.5 + activeTextClip.transform.y / H;
    if (
      sceneReading?.subjectFocus
      && !activeTextClip.text.behindCutout
      && Math.abs(textNormY - sceneReading.subjectFocus[1]) < 0.11
    ) {
      contrastStatus = 'covers-face';
      suggestion = 'O texto passa sobre o rosto do personagem; use Harmonizar c/ cena ou ative Atrás V2.';
    } else if (sceneReading && sceneReading.brightness >= 0.78 && activeTextClip.blendMode === 'normal') {
      const textLuma = parseHexLuma(activeTextClip.text.color) ?? 1;
      if (textLuma >= 0.75 && activeTextClip.text.outlineWidth < 4 && activeTextClip.text.background === 'none') {
        contrastStatus = 'low-contrast';
        suggestion = 'Cena muito clara sob texto claro; mescle em Negativo (difference) ou aumente o contorno.';
      }
    }
    if (!suggestion && (readingPace === 'too-fast' || readingPace === 'too-short')) {
      suggestion = `Leitura muito rápida (${cps} chars/s); alongue a duração ou divida em 2 partes.`;
    }

    textReading = {
      clipId: activeTextClip.id,
      text: clean,
      charsPerSecond: cps,
      wordsPerMinute: wpm,
      readingPace,
      contrastStatus,
      suggestion,
    };
  }

  return { music: musicReading, scene: sceneReading, text: textReading };
}

/**
 * Gera um diagnóstico completo de leitura da montagem atual na timeline (nota 0..100, batidas, CPS, clones e reparos).
 */
export function buildProjectReadingSummary(input: {
  project: Project;
  episodes: EpisodeInput[];
  musics: MusicInput[];
}): ProjectReadingSummary {
  const { project, episodes, musics } = input;
  const epMap = new Map(episodes.map((e) => [e.assetId, e.analysis]));
  const visionMap = new Map(episodes.flatMap((e) => (e.vision ? [[e.assetId, e.vision] as const] : [])));
  const musicMap = new Map(musics.map((m) => [m.assetId, m.analysis]));
  const quality = evaluateAudiovisualQuality({ project, episodes: epMap, visions: visionMap, music: musicMap });

  const tracksById = new Map(project.tracks.map((t) => [t.id, t]));
  const videoTracks = project.tracks.filter((t) => t.kind === 'video');
  const v1Id = videoTracks.at(-1)?.id;
  const v1Clips = project.clips
    .filter((c) => c.trackId === v1Id && Boolean(c.assetId))
    .sort((a, b) => a.timelineStartUs - b.timelineStartUs);
  const musicClip = project.clips.find((c) => tracksById.get(c.trackId)?.role === 'music' && Boolean(c.assetId));
  const activeMusic = musicClip?.assetId ? musics.find((m) => m.assetId === musicClip.assetId) : musics[0];
  const beatsUs = musicClip && activeMusic ? timelineBeatsForMusicClip(musicClip, activeMusic) : [];

  const epById = new Map(episodes.map((e) => [e.assetId, e]));
  const uniqueSceneSet = new Set<string>();
  let beatLockedCuts = 0;
  let syncedHitPeaks = 0;
  for (const [idx, clip] of v1Clips.entries()) {
    const ep = epById.get(clip.assetId!);
    const midS = sourceTimeAt(clip, clip.durationUs / 2) / SECOND;
    const shot = findSourceShot(ep, midS);
    if (shot) uniqueSceneSet.add(`${clip.assetId}:${Math.round(shot.startS * 10)}`);
    else uniqueSceneSet.add(`${clip.assetId}:${Math.round(clip.sourceInUs / 100_000)}`);

    if (idx > 0 && beatsUs.length) {
      const near = nearestBeatUs(clip.timelineStartUs, beatsUs);
      if (near && Math.abs(near.deltaMs) <= 55) beatLockedCuts++;
    }
    if (shot && Number.isFinite(shot.peakS) && beatsUs.length) {
      const peakLocalUs = timelineLocalAtSource(clip, Math.round(shot.peakS * SECOND));
      if (peakLocalUs !== null && peakLocalUs >= 0 && peakLocalUs <= clip.durationUs) {
        const nearPeak = nearestBeatUs(clip.timelineStartUs + peakLocalUs, beatsUs);
        if (nearPeak && Math.abs(nearPeak.deltaMs) <= 55) syncedHitPeaks++;
      }
    }
  }

  const textClips = project.clips.filter((c) => tracksById.get(c.trackId)?.kind === 'text' && Boolean(c.text));
  let fastTextCount = 0;
  let lowContrastOrFaceTextCount = 0;
  let cpsSum = 0;
  for (const tc of textClips) {
    const insight = readPlayheadInsight({
      project,
      playheadUs: tc.timelineStartUs + Math.round(tc.durationUs / 2),
      episodes,
      musics,
    });
    if (insight.text) {
      cpsSum += insight.text.charsPerSecond;
      if (insight.text.readingPace === 'too-fast' || insight.text.readingPace === 'too-short') fastTextCount++;
      if (insight.text.contrastStatus !== 'good') lowContrastOrFaceTextCount++;
    }
  }

  const cutsCount = Math.max(0, v1Clips.length - 1);
  const beatLockedRate = cutsCount > 0 ? Math.round((beatLockedCuts / cutsCount) * 100) : 100;

  let score: AssemblyScoreBreakdown = { technical: 28, sync: 20, diversity: 20, narrative: 14, multimodal: 10, total: 92 };
  if (activeMusic && v1Clips.length > 0) {
    const rangeStartS = musicClip ? musicClip.sourceInUs / SECOND : 0;
    const rangeEndS = musicClip ? Math.min(activeMusic.analysis.durationS, (musicClip.sourceOutUs || musicClip.durationUs) / SECOND) : Math.min(activeMusic.analysis.durationS, 30);
    const direction = planNarrative(activeMusic.analysis, [rangeStartS, Math.max(rangeStartS + 1, rangeEndS)], 0);
    const voiceClipsCount = project.clips.filter((c) => tracksById.get(c.trackId)?.role === 'voice').length;
    const sfxClipsCount = project.clips.filter((c) => tracksById.get(c.trackId)?.role === 'sfx').length;
    const hasLyrics = textClips.some((c) => /letra|palavra/i.test(c.reason ?? '') || (c.text?.size ?? 0) >= project.settings.height * 0.075);
    const brief = buildCreativeBrief({
      style: 'hype',
      episodes,
      music: activeMusic,
      options: {
        durationS: Math.max(1, Math.round((rangeEndS - rangeStartS) * 10) / 10),
        intensity: 2,
        editorialDirection: 'hype',
        organizationMode: 'narrative',
        focus: 'fight',
        voiceMoments: voiceClipsCount,
      },
      direction,
      hasTimedLyrics: hasLyrics,
    });
    const dummySummary = {
      clips: v1Clips.length,
      cuts: cutsCount,
      speech: null,
      musicRange: [rangeStartS, rangeEndS] as [number, number],
      drop: activeMusic.analysis.drops.find((d) => d >= rangeStartS && d <= rangeEndS) ?? null,
      focus: 'fight' as const,
      fights: [],
      voices: voiceClipsCount,
      hitsSynced: syncedHitPeaks,
      speedRamps: v1Clips.filter((c) => (c.keyframes.speed?.length ?? 0) >= 2).length,
      sfx: sfxClipsCount,
      direction,
    };
    const review = reviewGeneratedAssembly({
      project: { ...project, clips: [] },
      commands: project.clips.map((clip) => ({ type: 'clip.add' as const, clip })),
      brief,
      direction,
      summary: dummySummary,
      episodes,
      music: activeMusic,
    });
    score = scoreAssemblyQuality({
      project,
      generatedClipIds: new Set(project.clips.map((c) => c.id)),
      summary: dummySummary,
      brief,
      review: { ...review, quality },
      episodes,
      hasLyrics,
      sfxRequested: sfxClipsCount > 0,
    });
  }

  return {
    score,
    quality,
    totalVideoClips: v1Clips.length,
    uniqueScenes: uniqueSceneSet.size,
    beatLockedCuts,
    beatLockedRate,
    syncedHitPeaks,
    textClipsCount: textClips.length,
    fastTextCount,
    lowContrastOrFaceTextCount,
    averageCps: textClips.length ? Math.round((cpsSum / textClips.length) * 10) / 10 : 0,
  };
}

/**
 * Executa auto-reparo completo sobre os clipes atuais da timeline (exposição, micro-cortes, cenas repetidas,
 * quadros sem nitidez, sobreposição de legendas e fade de encerramento).
 */
export function buildFullTimelineAutoRepair(input: {
  project: Project;
  episodes: EpisodeInput[];
  musics: MusicInput[];
}): { commands: Command[]; repairsApplied: string[] } {
  const { project, episodes, musics } = input;
  const unlockedTrackIds = new Set(project.tracks.filter((t) => !t.locked).map((t) => t.id));
  const editableIds = new Set(project.clips.filter((c) => unlockedTrackIds.has(c.trackId)).map((c) => c.id));
  const epMap = new Map(episodes.map((e) => [e.assetId, e.analysis]));
  const visionMap = new Map(episodes.flatMap((e) => (e.vision ? [[e.assetId, e.vision] as const] : [])));
  const musicMap = new Map(musics.map((m) => [m.assetId, m.analysis]));
  const report = evaluateAudiovisualQuality({ project, episodes: epMap, visions: visionMap, music: musicMap });
  const baseRepair = autoRepairAssembly(project, editableIds, episodes, report);
  const commands = [...baseRepair.commands];
  const repairsApplied = [...baseRepair.repairsApplied];

  // Inclui também correção 1-clique de encerramento abrupto caso exista e a trilha esteja destravada
  const abruptEnding = report.issues.find((i) => i.type === 'encerramento abrupto' && i.fix && i.clipIds.every((id) => editableIds.has(id)));
  if (abruptEnding?.fix) {
    commands.push(...abruptEnding.fix.commands);
    repairsApplied.push(abruptEnding.fix.label);
  }
  return { commands, repairsApplied };
}

/**
 * Desliza a origem (slip) de um clipe de vídeo para cravar o golpe/pico de movimento (`shot.peakS`)
 * exatamente na batida musical mais próxima dentro da janela do clipe, sem alterar sua posição na timeline.
 */
export function alignClipPeakToNearestBeat(input: {
  project: Project;
  clipId: string;
  episodes: EpisodeInput[];
  musics: MusicInput[];
}): { command: Command; beatTimelineS: number; peakSourceS: number } | null {
  const { project, clipId, episodes, musics } = input;
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip?.assetId) return null;
  const ep = episodes.find((e) => e.assetId === clip.assetId);
  if (!ep) return null;
  const midSrcS = sourceTimeAt(clip, clip.durationUs / 2) / SECOND;
  const shot = findSourceShot(ep, midSrcS);
  if (!shot || !Number.isFinite(shot.peakS)) return null;

  const tracksById = new Map(project.tracks.map((t) => [t.id, t]));
  const musicClip = project.clips.find((c) => tracksById.get(c.trackId)?.role === 'music' && Boolean(c.assetId));
  const activeMusic = musicClip?.assetId ? musics.find((m) => m.assetId === musicClip.assetId) : undefined;
  const beatsUs = musicClip && activeMusic ? timelineBeatsForMusicClip(musicClip, activeMusic) : [];
  const candidateBeatsUs = beatsUs.filter((b) => b >= clip.timelineStartUs - 40_000 && b <= clipEndUs(clip) - 40_000);
  const targetBeatUs = candidateBeatsUs[0] ?? clip.timelineStartUs;
  const offsetInClipS = Math.max(0, (targetBeatUs - clip.timelineStartUs) / SECOND);
  const speed = Math.max(0.1, clip.speed || 1);
  const srcLenS = (clip.durationUs / SECOND) * speed;
  const asset = project.assets.find((a) => a.id === clip.assetId);
  const maxAssetS = asset?.probe?.durationUs ? asset.probe.durationUs / SECOND : shot.endS;
  const desiredInS = shot.peakS - offsetInClipS * speed;
  const upperBoundS = Math.max(0, Math.min(maxAssetS, Math.max(shot.endS, shot.startS + srcLenS)) - srcLenS);
  const clampedInS = Math.max(0, Math.min(upperBoundS, Math.max(shot.startS, desiredInS)));
  if (!Number.isFinite(clampedInS) || clampedInS < 0) return null;
  const newSourceInUs = Math.round(clampedInS * SECOND);
  const newSourceOutUs = newSourceInUs + Math.round(srcLenS * SECOND);
  if (Math.abs(newSourceInUs - clip.sourceInUs) < 8_000) return null;
  return {
    command: {
      type: 'clip.update',
      clipId: clip.id,
      patch: {
        sourceInUs: newSourceInUs,
        sourceOutUs: newSourceOutUs,
        reason: `${clip.reason ? `${clip.reason} — ` : ''}golpe sincronizado na batida (${(targetBeatUs / SECOND).toFixed(2)}s)`,
      },
    },
    beatTimelineS: Math.round((targetBeatUs / SECOND) * 100) / 100,
    peakSourceS: Math.round(shot.peakS * 100) / 100,
  };
}

/**
 * Harmoniza automaticamente clipes de texto/letra com a cena de vídeo sob eles:
 * - Adapta glow/destaque/gradiente à paleta dominante do quadro (`dominantColors`)
 * - Desvia verticalmente se estiver cobrindo o rosto do personagem (`subjectFocus`)
 * - Reforça contraste ou ativa mesclagem `difference` em fundos estourados
 * - Alonga suavemente legendas rápidas demais (`CPS > 21`) quando há espaço livre na trilha
 */
export function harmonizeTextClipsWithScenes(input: {
  project: Project;
  episodes: EpisodeInput[];
  clipIds?: string[];
}): { commands: Command[]; updatedCount: number; extendedForReading: number } {
  const { project, episodes, clipIds } = input;
  const epById = new Map(episodes.map((ep) => [ep.assetId, ep]));
  const tracksById = new Map(project.tracks.map((t) => [t.id, t]));
  const videoTracks = project.tracks.filter((t) => t.kind === 'video' && !t.hidden);
  const v1Track = videoTracks.at(-1);
  const wantedIds = clipIds?.length ? new Set(clipIds) : null;
  const H = Math.max(1, project.settings.height);

  const textClips = project.clips
    .filter((c) => {
      const tr = tracksById.get(c.trackId);
      return tr?.kind === 'text' && !tr.locked && Boolean(c.text) && (!wantedIds || wantedIds.has(c.id));
    })
    .sort((a, b) => a.timelineStartUs - b.timelineStartUs);

  const commands: Command[] = [];
  let updatedCount = 0;
  let extendedForReading = 0;

  for (const tc of textClips) {
    const textSpec = tc.text!;
    const midUs = tc.timelineStartUs + Math.round(tc.durationUs / 2);
    const v1Clip = v1Track
      ? project.clips.find((c) => c.trackId === v1Track.id && c.assetId && midUs >= c.timelineStartUs && midUs < clipEndUs(c))
      : undefined;
    const ep = v1Clip?.assetId ? epById.get(v1Clip.assetId) : undefined;
    const srcS = v1Clip ? sourceTimeAt(v1Clip, Math.max(0, midUs - v1Clip.timelineStartUs)) / SECOND : 0;
    const shot = v1Clip ? findSourceShot(ep, srcS) : undefined;
    const local = shot ? ep?.vision?.shots[shotKey(shot.startS)]?.local : undefined;

    const nextTextPatch: NonNullable<Clip['text']> = { ...textSpec };
    let nextTransform = { ...tc.transform };
    let nextBlendMode = tc.blendMode;
    let nextDurationUs = tc.durationUs;
    let changed = false;

    // 1. Paleta reativa da cena (apenas para letras/títulos, mantendo legendas de fala legíveis na base)
    const isBottomDialogue = tc.transform.y >= H * 0.28 && textSpec.size <= H * 0.068;
    const palette = local?.dominantColors?.map(boostPaletteColor).find(Boolean) ?? null;
    if (palette && !isBottomDialogue) {
      if (nextTextPatch.glowColor !== palette.accent) {
        nextTextPatch.glowColor = palette.accent;
        changed = true;
      }
      if (nextTextPatch.highlightColor !== palette.accent) {
        nextTextPatch.highlightColor = palette.accent;
        changed = true;
      }
      if (nextTextPatch.fillStyle === 'linear-gradient') {
        if (nextTextPatch.gradientStartColor !== palette.highlight || nextTextPatch.gradientEndColor !== palette.accent) {
          nextTextPatch.gradientStartColor = palette.highlight;
          nextTextPatch.gradientEndColor = palette.accent;
          changed = true;
        }
      }
      if (nextTextPatch.outerOutlineColor && nextTextPatch.outerOutlineColor !== palette.accent) {
        nextTextPatch.outerOutlineColor = palette.accent;
        changed = true;
      }
      if (nextTextPatch.heroWord && nextTextPatch.heroColor && nextTextPatch.heroColor !== '#ffffff' && nextTextPatch.heroColor !== palette.accent) {
        nextTextPatch.heroColor = palette.accent;
        changed = true;
      }
    }

    // 2. Desvia do rosto do personagem quando centralizado sobre o foco facial
    const focusY = local?.subjectFocus && (local.subjectFocusConfidence ?? 0) >= 0.52 ? local.subjectFocus[1] : null;
    const currentNormY = 0.5 + tc.transform.y / H;
    if (focusY !== null && !isBottomDialogue && !textSpec.behindCutout && Math.abs(currentNormY - focusY) < 0.11) {
      const targetNormY = focusY < 0.46 ? 0.64 : 0.36;
      const targetY = Math.round((targetNormY - 0.5) * H);
      if (targetY !== nextTransform.y) {
        nextTransform = { ...nextTransform, y: targetY };
        changed = true;
      }
    }

    // 3. Garante contraste em quadros muito claros/explosões
    const brightness = local?.brightness ?? shot?.brightness ?? 0.5;
    if (brightness >= 0.78 && tc.blendMode === 'normal') {
      if (!isBottomDialogue && textSpec.size >= H * 0.085) {
        nextBlendMode = 'difference';
        nextTextPatch.color = '#ffffff';
        nextTextPatch.shadow = false;
        changed = true;
      } else {
        const nextWidth = Math.max(4.5, textSpec.outlineWidth);
        if (nextWidth !== textSpec.outlineWidth || textSpec.outlineColor !== '#05070c') {
          nextTextPatch.outlineWidth = nextWidth;
          nextTextPatch.outlineColor = '#05070c';
          changed = true;
        }
      }
    }

    // 4. Melhora tempo de leitura (CPS > 21 ou < 0.5s) usando fresta livre na mesma trilha
    const cleanChars = Array.from(textSpec.text.replace(/\s+/g, '')).length;
    const durS = tc.durationUs / SECOND;
    const cps = cleanChars / Math.max(0.05, durS);
    if (cleanChars >= 6 && (cps > 21 || durS < 0.52)) {
      const sameTrackLater = project.clips
        .filter((other) => other.trackId === tc.trackId && other.id !== tc.id && other.timelineStartUs >= clipEndUs(tc) - 1_000)
        .sort((a, b) => a.timelineStartUs - b.timelineStartUs)[0];
      const maxEndUs = sameTrackLater ? sameTrackLater.timelineStartUs - 40_000 : clipEndUs(tc) + 900_000;
      const idealDurUs = Math.round(Math.max(0.6, cleanChars / 16.5) * SECOND);
      const allowedDurUs = Math.min(idealDurUs, maxEndUs - tc.timelineStartUs);
      if (allowedDurUs > tc.durationUs + 60_000) {
        nextDurationUs = allowedDurUs;
        extendedForReading++;
        changed = true;
      }
    }

    if (changed) {
      updatedCount++;
      commands.push({
        type: 'clip.update',
        clipId: tc.id,
        patch: {
          text: nextTextPatch,
          transform: nextTransform,
          blendMode: nextBlendMode,
          ...(nextDurationUs !== tc.durationUs ? { durationUs: nextDurationUs, sourceOutUs: nextDurationUs } : {}),
        },
      });
    }
  }

  return { commands, updatedCount, extendedForReading };
}

/**
 * Sugere os melhores planos inéditos e visualmente distintos dos episódios analisados
 * para substituir o clipe selecionado na timeline mantendo a energia musical e continuidade.
 */
export function findBestReplacementShots(input: {
  project: Project;
  clipId: string;
  episodes: EpisodeInput[];
  musics: MusicInput[];
  limit?: number;
}): SuggestedReplacementShot[] {
  const { project, clipId, episodes, musics, limit = 4 } = input;
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return [];
  const neededS = (clip.durationUs * (clip.speed || 1)) / SECOND;
  const insight = readPlayheadInsight({
    project,
    playheadUs: clip.timelineStartUs + Math.round(clip.durationUs / 2),
    episodes,
    musics,
  });
  const targetEnergy = insight.music?.energy ?? 0.65;

  const usedRanges = new Map<string, Array<[number, number]>>();
  const usedFingerprints = new Set<string>();
  const epById = new Map(episodes.map((e) => [e.assetId, e]));
  for (const other of project.clips) {
    if (!other.assetId || other.id === clip.id) continue;
    const list = usedRanges.get(other.assetId) ?? [];
    list.push([other.sourceInUs / SECOND, other.sourceOutUs / SECOND]);
    usedRanges.set(other.assetId, list);
    const ep = epById.get(other.assetId);
    const shot = findSourceShot(ep, sourceTimeAt(other, other.durationUs / 2) / SECOND);
    const fp = shot ? ep?.vision?.shots[shotKey(shot.startS)]?.local?.fingerprint : undefined;
    if (fp) usedFingerprints.add(fp);
  }

  const currentEp = clip.assetId ? epById.get(clip.assetId) : undefined;
  const currentShot = currentEp ? findSourceShot(currentEp, sourceTimeAt(clip, clip.durationUs / 2) / SECOND) : undefined;
  const currentLocal = currentShot ? currentEp?.vision?.shots[shotKey(currentShot.startS)]?.local : undefined;

  const suggestions: SuggestedReplacementShot[] = [];
  for (const ep of episodes) {
    const isFullEp = ep.analysis.durationS >= 1080;
    for (const shot of ep.analysis.shots) {
      const dur = shot.endS - shot.startS;
      if (dur < neededS * 0.85 || shot.tags.includes('escura')) continue;
      if (isFullEp && (shot.startS < 92 || shot.endS > ep.analysis.durationS - 92)) continue;
      const overlaps = (usedRanges.get(ep.assetId) ?? []).some(([a, b]) => shot.startS < b - 0.1 && shot.endS > a + 0.1);
      if (overlaps) continue;
      const vision: EpisodeVision['shots'][string] | undefined = ep.vision?.shots[shotKey(shot.startS)];
      const local = vision?.local;
      if ((local?.deadFrameScore ?? 0) >= 0.6) continue;
      if ((local?.textClutterScore ?? 0) >= 0.6) continue;
      if (local?.fingerprint && usedFingerprints.has(local.fingerprint)) continue;
      if (currentLocal && local && visualSimilarity(currentLocal, local) >= 0.9) continue;

      const energyFit = 1 - Math.abs(targetEnergy - shot.intensity);
      const impactBonus = targetEnergy >= 0.65 && shot.tags.includes('impacto') ? 0.22 : 0;
      const sharpnessBonus = (1 - (local?.deadFrameScore ?? 0.15)) * 0.12;
      const sameEpBonus = ep.assetId === clip.assetId ? 0.06 : 0;
      const score = Math.round((energyFit * 0.65 + impactBonus + sharpnessBonus + sameEpBonus) * 100) / 100;

      const recommendedInS = Number.isFinite(shot.peakS) && shot.peakS >= shot.startS && shot.peakS <= shot.endS - neededS
        ? Math.max(shot.startS, Math.min(shot.endS - neededS, shot.peakS))
        : shot.startS;
      const reasons: string[] = [];
      if (Math.abs(targetEnergy - shot.intensity) <= 0.18) reasons.push(`intensidade ${(shot.intensity * 100).toFixed(0)}% compatível com a música`);
      if (shot.tags.includes('impacto')) reasons.push('golpe/impacto limpo');
      if (vision?.characters?.length) reasons.push(vision.characters.slice(0, 2).join(', '));
      if (!reasons.length) reasons.push('plano inédito e nítido');

      suggestions.push({
        assetId: ep.assetId,
        episodeName: ep.name,
        startS: shot.startS,
        endS: shot.endS,
        peakS: shot.peakS,
        recommendedInS: Math.round(recommendedInS * 100) / 100,
        intensity: shot.intensity,
        tags: shot.tags,
        score,
        reason: reasons.join(' · '),
      });
    }
  }

  return suggestions.sort((a, b) => b.score - a.score || b.intensity - a.intensity).slice(0, limit);
}
