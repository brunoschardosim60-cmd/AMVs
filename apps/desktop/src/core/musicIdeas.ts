import { joinPath } from '@amv/media';
import type { MusicIdea } from '@amv/music';
import type { Platform } from '../platform/types';

/** Ideias de música (links do YouTube/Spotify) ficam em ideias-musica.json na pasta do app. */
async function file(p: Platform) {
  return joinPath(await p.dataDir(), 'ideias-musica.json');
}

export async function loadMusicIdeas(p: Platform): Promise<MusicIdea[]> {
  try {
    const f = await file(p);
    if (!(await p.fs.exists(f))) return [];
    const raw = JSON.parse(new TextDecoder().decode(await p.fs.readFile(f))) as unknown;
    return Array.isArray(raw) ? (raw as MusicIdea[]).filter((x) => x && typeof x.title === 'string' && typeof x.url === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveMusicIdeas(p: Platform, ideas: MusicIdea[]): Promise<void> {
  await p.fs.mkdir(await p.dataDir());
  const f = await file(p);
  await p.fs.writeFile(`${f}.tmp`, new TextEncoder().encode(JSON.stringify(ideas, null, 2)));
  await p.fs.rename(`${f}.tmp`, f);
}
