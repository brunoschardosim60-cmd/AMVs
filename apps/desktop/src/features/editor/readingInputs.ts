import type { EpisodeInput, MusicInput } from '@amv/automv';
import { clipEndUs, timelineLocalAtSource } from '@amv/project';
import type { ProjectSession } from '../../core/session';

/**
 * Monta os inputs já analisados em memória da sessão (`episodes` + `musics`) sem disparar nenhum reprocessamento.
 */
export function buildSessionReadingInputs(session: ProjectSession): {
  episodes: EpisodeInput[];
  musics: MusicInput[];
} {
  const episodes: EpisodeInput[] = [];
  const musics: MusicInput[] = [];
  for (const asset of session.project.assets) {
    const rt = session.assetRuntime(asset.id);
    if (asset.kind === 'video' && rt.episode) {
      episodes.push({
        assetId: asset.id,
        name: asset.name,
        analysis: rt.episode,
        hasAudio: (asset.probe?.audio.length ?? 0) > 0,
        audioStreams: asset.probe?.audio,
        sourceFps: asset.probe?.video?.fps ?? null,
        variableFrameRate: asset.probe?.video?.vfr,
        vision: rt.vision ?? undefined,
      });
    } else if (asset.kind === 'audio' && rt.music && !asset.tags.includes('sfx')) {
      musics.push({
        assetId: asset.id,
        name: asset.name,
        analysis: rt.music,
      });
    }
  }
  return { episodes, musics };
}

/**
 * Retorna os pontos ordenados de cortes de vídeo e de batidas musicais na timeline (em microssegundos)
 * para navegação rápida por teclado (`[`/`]` entre cortes, `,`/`.` entre batidas).
 */
export function collectTimelineNavStops(session: ProjectSession): {
  cutStopsUs: number[];
  beatStopsUs: number[];
} {
  const { project } = session;
  const cutSet = new Set<number>([0]);
  for (const clip of project.clips) {
    const tr = project.tracks.find((t) => t.id === clip.trackId);
    if (tr?.kind === 'video' && !tr.hidden) {
      cutSet.add(clip.timelineStartUs);
      cutSet.add(clipEndUs(clip));
    }
  }

  const beatSet = new Set<number>();
  for (const clip of project.clips) {
    const tr = project.tracks.find((t) => t.id === clip.trackId);
    if (tr?.kind !== 'audio' || tr.role !== 'music' || !clip.assetId) continue;
    const m = session.assetRuntime(clip.assetId).music;
    if (!m) continue;
    for (const beatS of m.beats) {
      const localUs = timelineLocalAtSource(clip, Math.round(beatS * 1_000_000));
      if (localUs === null) continue;
      const tlUs = clip.timelineStartUs + localUs;
      if (tlUs >= clip.timelineStartUs && tlUs <= clipEndUs(clip)) {
        beatSet.add(Math.round(tlUs));
      }
    }
  }

  return {
    cutStopsUs: [...cutSet].sort((a, b) => a - b),
    beatStopsUs: [...beatSet].sort((a, b) => a - b),
  };
}
