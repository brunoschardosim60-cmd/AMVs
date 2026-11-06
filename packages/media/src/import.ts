import { newId, partialHash, type Asset, type ProbeInfo } from '@amv/project';
import type { JobQueue } from './jobs.js';
import {
  cachePaths,
  makeAudioProxy,
  makePoster,
  makeProxy,
  makeThumbStrip,
  makeWaveformFile,
} from './pipeline.js';
import { probeFile, probeWarnings, type ProbeResult } from './probe.js';
import { baseName, joinPath, type FileSystem, type ProcessRunner } from './runner.js';

export const IMPORT_EXTENSIONS = {
  video: ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi'],
  audio: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'],
  image: ['png', 'jpg', 'jpeg', 'webp'],
};

export const ALL_IMPORT_EXTENSIONS = [...IMPORT_EXTENSIONS.video, ...IMPORT_EXTENSIONS.audio, ...IMPORT_EXTENSIONS.image];

export function isImportable(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return ALL_IMPORT_EXTENSIONS.includes(ext);
}

export async function hashFile(fs: FileSystem, path: string): Promise<{ hash: string; size: number }> {
  const size = await fs.size(path);
  const hash = await partialHash(size, (o, l) => fs.readRange(path, o, l));
  return { hash, size };
}

export interface MediaArtifacts {
  posterPath: string | null;
  stripPath: string | null;
  waveformPath: string | null;
  proxyPath: string | null;
  audioProxyPath: string | null;
}

export interface MediaEnv {
  runner: ProcessRunner;
  fs: FileSystem;
  queue: JobQueue;
  cacheRoot: string;
}

/** Lê o arquivo e monta o Asset (sem gerar artefatos ainda). */
export async function inspectFile(env: MediaEnv, path: string): Promise<{ asset: Asset; result: ProbeResult; warnings: string[] }> {
  const { hash } = await hashFile(env.fs, path);
  const { promise } = env.queue.enqueue({
    key: `probe:${path}`,
    kind: 'probe',
    label: `Lendo ${baseName(path)}`,
    run: ({ signal }) => probeFile(env.runner, path, signal),
  });
  const result = await promise;
  const asset: Asset = {
    id: newId('ast'),
    name: baseName(path),
    path,
    hash,
    kind: result.kind,
    probe: result.probe,
    status: 'processing',
    error: null,
    importedAt: new Date().toISOString(),
    tags: [],
    favorite: false,
  };
  return { asset, result, warnings: probeWarnings(result) };
}

/**
 * Enfileira os artefatos do asset (pôster, miniaturas, waveform, proxy).
 * Reaproveita o cache quando já existe. Cada artefato é independente:
 * a falha de um não impede os outros.
 */
export function prepareArtifacts(
  env: MediaEnv,
  asset: Pick<Asset, 'id' | 'name' | 'path' | 'hash' | 'kind'> & { probe: ProbeInfo },
): { artifacts: Promise<MediaArtifacts>; errors: Promise<string[]> } {
  const paths = cachePaths(env.cacheRoot, asset.hash, joinPath);
  const errors: string[] = [];
  const { probe } = asset;
  const ready = env.fs.mkdir(paths.dir);

  const cached = async (target: string, make: () => Promise<unknown>, what: string): Promise<string | null> => {
    await ready;
    if (await env.fs.exists(target)) return target;
    try {
      await make();
      return target;
    } catch (e) {
      if ((e as Error).name !== 'CancelledError') errors.push(`${what}: ${(e as Error).message}`);
      else errors.push(`${what}: cancelado`);
      return null;
    }
  };

  const job = <T>(kind: Parameters<JobQueue['enqueue']>[0]['kind'], label: string, key: string, run: Parameters<JobQueue['enqueue']>[0]['run']) =>
    env.queue.enqueue<T>({ key: `${key}:${asset.hash}`, kind, label: `${label} · ${asset.name}`, assetId: asset.id, run: run as never }).promise;

  const hasVideo = asset.kind === 'video';
  const hasAudio = probe.audio.length > 0;

  const poster =
    asset.kind === 'image'
      ? Promise.resolve(asset.path)
      : hasVideo
        ? cached(paths.poster, () => job('poster', 'Miniatura', 'poster', ({ signal }) => makePoster(env.runner, env.fs, asset.path, paths.poster, probe, signal)), 'miniatura')
        : Promise.resolve(null);

  const strip = hasVideo
    ? cached(paths.strip, () =>
        job('thumbnails', 'Miniaturas', 'strip', async ({ signal, report }) => {
          const plan = await makeThumbStrip(env.runner, env.fs, asset.path, paths.strip, probe, report, signal);
          await env.fs.writeFile(paths.stripPlan, new TextEncoder().encode(JSON.stringify(plan)));
          return plan;
        }),
      'miniaturas da timeline')
    : Promise.resolve(null);

  const waveform = hasAudio
    ? cached(paths.waveform, () => job('waveform', 'Forma de onda', 'waveform', ({ signal, report }) => makeWaveformFile(env.runner, env.fs, asset.path, paths.waveform, probe, report, signal)), 'forma de onda')
    : Promise.resolve(null);

  const proxy = hasVideo
    ? cached(paths.proxy, () => job('proxy', 'Proxy de edição', 'proxy', ({ signal, report }) => makeProxy(env.runner, env.fs, asset.path, paths.proxy, probe, report, signal)), 'proxy')
    : Promise.resolve(null);

  const audioProxy =
    asset.kind === 'audio'
      ? (async () => {
          await ready;
          if (await env.fs.exists(paths.audioProxy)) return paths.audioProxy;
          try {
            return await job<string | null>('proxy', 'Áudio para preview', 'aproxy', ({ signal, report }) =>
              makeAudioProxy(env.runner, env.fs, asset.path, paths.audioProxy, probe, report, signal),
            );
          } catch (e) {
            errors.push(`áudio para preview: ${(e as Error).message}`);
            return null;
          }
        })()
      : Promise.resolve(null);

  const artifacts = Promise.all([poster, strip, waveform, proxy, audioProxy]).then(
    ([posterPath, stripPath, waveformPath, proxyPath, audioProxyPath]) => ({ posterPath, stripPath, waveformPath, proxyPath, audioProxyPath }),
  );
  return { artifacts, errors: artifacts.then(() => errors) };
}
