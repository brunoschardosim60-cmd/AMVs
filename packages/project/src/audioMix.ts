import { clipEndUs } from './timeline.js';
import type { Project } from './schema.js';

function isAudibleTrack(project: Project, trackId: string): boolean {
  const track = project.tracks.find((item) => item.id === trackId);
  if (!track || track.kind === 'text' || (track.kind === 'video' && !project.audioMix.includeVideoAudio) || track.muted) return false;
  const anySolo = project.tracks.some((item) => (item.kind === 'audio' || (item.kind === 'video' && project.audioMix.includeVideoAudio)) && item.solo);
  return !anySolo || track.solo;
}

function isVoiceClip(project: Project, clip: Project['clips'][number]): boolean {
  const track = project.tracks.find((item) => item.id === clip.trackId);
  if (track?.role === 'voice') return true;
  const asset = project.assets.find((item) => item.id === clip.assetId);
  return track?.kind === 'video' && project.audioMix.includeVideoAudio && !!asset?.probe?.audio.length;
}

/** Linear gain reduction from audible voice clips for a music track at timeline time. */
export function automaticDuckingGain(project: Project, targetTrackId: string, atUs: number): number {
  const settings = project.audioMix;
  const target = project.tracks.find((track) => track.id === targetTrackId);
  if (!settings.duckingEnabled || target?.role !== 'music' && target?.role !== 'music2' || !isAudibleTrack(project, targetTrackId)) return 1;

  const attackUs = settings.duckingAttackMs * 1000;
  const releaseUs = settings.duckingReleaseMs * 1000;
  const reducedGain = 10 ** (-settings.duckingAmountDb / 20);
  let gain = 1;
  for (const clip of project.clips) {
    const track = project.tracks.find((item) => item.id === clip.trackId);
    if (!track || !isVoiceClip(project, clip) || !clip.assetId || !isAudibleTrack(project, track.id)) continue;
    const start = clip.timelineStartUs;
    const end = clipEndUs(clip);
    let candidate = 1;
    if (atUs < start && attackUs > 0 && atUs >= start - attackUs) {
      candidate = 1 - (1 - reducedGain) * (atUs - (start - attackUs)) / attackUs;
    } else if (atUs >= start && atUs < end) {
      candidate = reducedGain;
    } else if (atUs >= end && releaseUs > 0 && atUs < end + releaseUs) {
      candidate = reducedGain + (1 - reducedGain) * (atUs - end) / releaseUs;
    }
    gain = Math.min(gain, candidate);
  }
  return gain;
}

/** FFmpeg volume expression matching automaticDuckingGain over clip-local time `t`. */
export function automaticDuckingExpression(project: Project, targetTrackId: string, targetStartUs: number): string | null {
  const settings = project.audioMix;
  const target = project.tracks.find((track) => track.id === targetTrackId);
  if (!settings.duckingEnabled || (target?.role !== 'music' && target?.role !== 'music2') || !isAudibleTrack(project, targetTrackId)) return null;

  const attack = settings.duckingAttackMs / 1000;
  const release = settings.duckingReleaseMs / 1000;
  const reduced = 10 ** (-settings.duckingAmountDb / 20);
  const expressions: string[] = [];
  for (const clip of project.clips) {
    const track = project.tracks.find((item) => item.id === clip.trackId);
    if (!track || !isVoiceClip(project, clip) || !clip.assetId || !isAudibleTrack(project, track.id)) continue;
    const start = (clip.timelineStartUs - targetStartUs) / 1e6;
    const end = (clipEndUs(clip) - targetStartUs) / 1e6;
    const attackStart = start - attack;
    const fadeIn = attack > 0
      ? `if(lt(t,${start}),1-(1-${reduced})*(t-${attackStart})/${attack},${reduced})`
      : `${reduced}`;
    const fadeOut = release > 0
      ? `if(lt(t,${end + release}),${reduced}+(1-${reduced})*(t-${end})/${release},1)`
      : '1';
    expressions.push(`if(lt(t,${attackStart}),1,if(lt(t,${end}),${fadeIn},${fadeOut}))`);
  }
  if (expressions.length === 0) return null;
  return expressions.reduce((combined, expression) => `min(${combined},${expression})`, '1');
}
