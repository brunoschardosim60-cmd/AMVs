import {
  AssetSchema,
  ClipSchema,
  MarkerSchema,
  ProjectSettingsSchema,
  TrackSchema,
  type Asset,
  type Clip,
  type Marker,
  type Project,
  type ProjectSettings,
  type Track,
} from './schema.js';

/**
 * Toda mutação do projeto é um Command (dado puro, serializável).
 * `applyCommand` devolve o novo projeto e o comando inverso, calculado a partir do
 * estado anterior. Undo/redo, autosave, ChangeSets da IA e testes usam isso.
 */
export type Command =
  | { type: 'project.rename'; name: string }
  | { type: 'settings.update'; patch: Partial<ProjectSettings> }
  | { type: 'asset.add'; asset: Asset; index?: number }
  | { type: 'asset.remove'; assetId: string }
  | { type: 'asset.update'; assetId: string; patch: Partial<Omit<Asset, 'id'>> }
  | { type: 'track.add'; track: Track; index?: number }
  | { type: 'track.remove'; trackId: string }
  | { type: 'track.update'; trackId: string; patch: Partial<Omit<Track, 'id'>> }
  | { type: 'clip.add'; clip: Clip; index?: number }
  | { type: 'clip.remove'; clipId: string }
  | { type: 'clip.update'; clipId: string; patch: Partial<Omit<Clip, 'id'>> }
  | { type: 'marker.add'; marker: Marker; index?: number }
  | { type: 'marker.remove'; markerId: string }
  | { type: 'marker.update'; markerId: string; patch: Partial<Omit<Marker, 'id'>> }
  | { type: 'version.add'; version: Project['versions'][number] }
  | { type: 'version.remove'; versionId: string }
  | { type: 'batch'; label?: string; commands: Command[] };

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

export interface ApplyResult {
  project: Project;
  inverse: Command;
}

function findIndex<T extends { id: string }>(list: T[], idValue: string, what: string): number {
  const i = list.findIndex((x) => x.id === idValue);
  if (i < 0) throw new CommandError(`${what} não encontrado: ${idValue}`);
  return i;
}

function insertAt<T>(list: T[], item: T, index?: number): T[] {
  const copy = list.slice();
  const at = index === undefined || index < 0 || index > copy.length ? copy.length : index;
  copy.splice(at, 0, item);
  return copy;
}

function pickPrevious<T extends object>(obj: T, patch: Partial<T>): Partial<T> {
  const prev: Partial<T> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) prev[key] = obj[key];
  return prev;
}

function assertTrackEditable(project: Project, trackId: string): Track {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new CommandError(`trilha não encontrada: ${trackId}`);
  if (track.locked) throw new CommandError(`a trilha "${track.name}" está travada`);
  return track;
}

function assertClipFitsTrack(project: Project, clip: Clip, track: Track): void {
  if (track.kind === 'text') {
    if (!clip.text) throw new CommandError('trilha de texto só aceita clipes de texto');
    return;
  }
  if (!clip.assetId) throw new CommandError('clipe de mídia precisa de um asset');
  const asset = project.assets.find((a) => a.id === clip.assetId);
  if (!asset) throw new CommandError(`asset não encontrado: ${clip.assetId}`);
  if (track.kind === 'video' && asset.kind === 'audio') {
    throw new CommandError('áudio não pode ir para uma trilha de vídeo');
  }
  if (track.kind === 'audio' && asset.kind === 'image') {
    throw new CommandError('imagem não pode ir para uma trilha de áudio');
  }
}

export function applyCommand(project: Project, command: Command): ApplyResult {
  switch (command.type) {
    case 'project.rename': {
      const name = command.name.trim();
      if (!name) throw new CommandError('o nome do projeto não pode ficar vazio');
      return {
        project: { ...project, name },
        inverse: { type: 'project.rename', name: project.name },
      };
    }

    case 'settings.update': {
      const settings = ProjectSettingsSchema.parse({ ...project.settings, ...command.patch });
      return {
        project: { ...project, settings },
        inverse: { type: 'settings.update', patch: pickPrevious(project.settings, command.patch) },
      };
    }

    case 'asset.add': {
      if (project.assets.some((a) => a.id === command.asset.id)) {
        throw new CommandError(`asset já existe: ${command.asset.id}`);
      }
      const asset = AssetSchema.parse(command.asset);
      return {
        project: { ...project, assets: insertAt(project.assets, asset, command.index) },
        inverse: { type: 'asset.remove', assetId: asset.id },
      };
    }

    case 'asset.remove': {
      const index = findIndex(project.assets, command.assetId, 'asset');
      const asset = project.assets[index]!;
      // remover um asset remove os clipes que o usam; o inverso restaura tudo no lugar
      const removedClips: Command[] = [];
      project.clips.forEach((clip, clipIndex) => {
        if (clip.assetId === asset.id) removedClips.push({ type: 'clip.add', clip, index: clipIndex });
      });
      for (const c of removedClips) {
        if (c.type === 'clip.add') assertTrackEditable(project, c.clip.trackId);
      }
      return {
        project: {
          ...project,
          assets: project.assets.filter((a) => a.id !== asset.id),
          clips: project.clips.filter((c) => c.assetId !== asset.id),
        },
        inverse: {
          type: 'batch',
          commands: [{ type: 'asset.add', asset, index }, ...removedClips],
        },
      };
    }

    case 'asset.update': {
      const index = findIndex(project.assets, command.assetId, 'asset');
      const before = project.assets[index]!;
      const after = AssetSchema.parse({ ...before, ...command.patch, id: before.id });
      const assets = project.assets.slice();
      assets[index] = after;
      return {
        project: { ...project, assets },
        inverse: { type: 'asset.update', assetId: before.id, patch: pickPrevious(before, command.patch) },
      };
    }

    case 'track.add': {
      if (project.tracks.some((t) => t.id === command.track.id)) {
        throw new CommandError(`trilha já existe: ${command.track.id}`);
      }
      const track = TrackSchema.parse(command.track);
      return {
        project: { ...project, tracks: insertAt(project.tracks, track, command.index) },
        inverse: { type: 'track.remove', trackId: track.id },
      };
    }

    case 'track.remove': {
      const index = findIndex(project.tracks, command.trackId, 'trilha');
      const track = project.tracks[index]!;
      if (track.locked) throw new CommandError(`a trilha "${track.name}" está travada`);
      const removedClips: Command[] = [];
      project.clips.forEach((clip, clipIndex) => {
        if (clip.trackId === track.id) removedClips.push({ type: 'clip.add', clip, index: clipIndex });
      });
      return {
        project: {
          ...project,
          tracks: project.tracks.filter((t) => t.id !== track.id),
          clips: project.clips.filter((c) => c.trackId !== track.id),
        },
        inverse: {
          type: 'batch',
          commands: [{ type: 'track.add', track, index }, ...removedClips],
        },
      };
    }

    case 'track.update': {
      const index = findIndex(project.tracks, command.trackId, 'trilha');
      const before = project.tracks[index]!;
      if ('kind' in command.patch && command.patch.kind !== before.kind) {
        throw new CommandError('não é possível mudar o tipo de uma trilha');
      }
      const after = TrackSchema.parse({ ...before, ...command.patch, id: before.id });
      const tracks = project.tracks.slice();
      tracks[index] = after;
      return {
        project: { ...project, tracks },
        inverse: { type: 'track.update', trackId: before.id, patch: pickPrevious(before, command.patch) },
      };
    }

    case 'clip.add': {
      if (project.clips.some((c) => c.id === command.clip.id)) {
        throw new CommandError(`clipe já existe: ${command.clip.id}`);
      }
      const clip = ClipSchema.parse(command.clip);
      const track = assertTrackEditable(project, clip.trackId);
      assertClipFitsTrack(project, clip, track);
      return {
        project: { ...project, clips: insertAt(project.clips, clip, command.index) },
        inverse: { type: 'clip.remove', clipId: clip.id },
      };
    }

    case 'clip.remove': {
      const index = findIndex(project.clips, command.clipId, 'clipe');
      const clip = project.clips[index]!;
      assertTrackEditable(project, clip.trackId);
      return {
        project: { ...project, clips: project.clips.filter((c) => c.id !== clip.id) },
        inverse: { type: 'clip.add', clip, index },
      };
    }

    case 'clip.update': {
      const index = findIndex(project.clips, command.clipId, 'clipe');
      const before = project.clips[index]!;
      assertTrackEditable(project, before.trackId);
      const after = ClipSchema.parse({ ...before, ...command.patch, id: before.id });
      if (after.trackId !== before.trackId) {
        const target = assertTrackEditable(project, after.trackId);
        assertClipFitsTrack(project, after, target);
      }
      const clips = project.clips.slice();
      clips[index] = after;
      return {
        project: { ...project, clips },
        inverse: { type: 'clip.update', clipId: before.id, patch: pickPrevious(before, command.patch) },
      };
    }

    case 'marker.add': {
      if (project.markers.some((m) => m.id === command.marker.id)) {
        throw new CommandError(`marcador já existe: ${command.marker.id}`);
      }
      const marker = MarkerSchema.parse(command.marker);
      return {
        project: { ...project, markers: insertAt(project.markers, marker, command.index) },
        inverse: { type: 'marker.remove', markerId: marker.id },
      };
    }

    case 'marker.remove': {
      const index = findIndex(project.markers, command.markerId, 'marcador');
      const marker = project.markers[index]!;
      return {
        project: { ...project, markers: project.markers.filter((m) => m.id !== marker.id) },
        inverse: { type: 'marker.add', marker, index },
      };
    }

    case 'marker.update': {
      const index = findIndex(project.markers, command.markerId, 'marcador');
      const before = project.markers[index]!;
      const after = MarkerSchema.parse({ ...before, ...command.patch, id: before.id });
      const markers = project.markers.slice();
      markers[index] = after;
      return {
        project: { ...project, markers },
        inverse: { type: 'marker.update', markerId: before.id, patch: pickPrevious(before, command.patch) },
      };
    }

    case 'version.add': {
      if (project.versions.some((v) => v.id === command.version.id)) throw new CommandError('versão já existe');
      return { project: { ...project, versions: [...project.versions, command.version] }, inverse: { type: 'version.remove', versionId: command.version.id } };
    }

    case 'version.remove': {
      const index = findIndex(project.versions, command.versionId, 'versão');
      const version = project.versions[index]!;
      return { project: { ...project, versions: project.versions.filter((v) => v.id !== version.id) }, inverse: { type: 'version.add', version } };
    }

    case 'batch': {
      // aplica em sequência; se qualquer um falhar, nada muda (projeto original é imutável)
      let current = project;
      const inverses: Command[] = [];
      for (const sub of command.commands) {
        const r = applyCommand(current, sub);
        current = r.project;
        inverses.unshift(r.inverse);
      }
      return {
        project: current,
        inverse: { type: 'batch', label: command.label, commands: inverses },
      };
    }
  }
}

/** Descrição curta em português, usada no histórico e no menu Editar. */
export function describeCommand(command: Command): string {
  switch (command.type) {
    case 'project.rename':
      return 'Renomear projeto';
    case 'settings.update':
      return 'Alterar configurações';
    case 'asset.add':
      return `Importar ${command.asset.name}`;
    case 'asset.remove':
      return 'Remover mídia';
    case 'asset.update':
      return 'Atualizar mídia';
    case 'track.add':
      return `Adicionar trilha ${command.track.name}`;
    case 'track.remove':
      return 'Remover trilha';
    case 'track.update':
      return 'Alterar trilha';
    case 'clip.add':
      return 'Adicionar clipe';
    case 'clip.remove':
      return 'Excluir clipe';
    case 'clip.update':
      return 'Editar clipe';
    case 'marker.add':
      return 'Adicionar marcador';
    case 'marker.remove':
      return 'Remover marcador';
    case 'marker.update':
      return 'Editar marcador';
    case 'version.add':
      return 'Salvar versão';
    case 'version.remove':
      return 'Apagar versão';
    case 'batch':
      return command.label ?? `${command.commands.length} alterações`;
  }
}
