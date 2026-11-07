import { joinPath } from '@amv/media';
import type { Platform } from '../platform/types';

export interface RecentProject {
  path: string;
  name: string;
  openedAt: string;
  durationUs: number;
  assetCount: number;
  posterPath: string | null;
  favorite: boolean;
}

const FILE = 'recentes.json';
const MAX = 30;

async function file(p: Platform) {
  const dir = await p.dataDir();
  await p.fs.mkdir(dir);
  return joinPath(dir, FILE);
}

export async function loadRecents(p: Platform): Promise<RecentProject[]> {
  const path = await file(p);
  if (!(await p.fs.exists(path))) return [];
  try {
    const list = JSON.parse(new TextDecoder().decode(await p.fs.readFile(path))) as RecentProject[];
    return Array.isArray(list) ? list.filter((r) => typeof r?.path === 'string') : [];
  } catch {
    // lista corrompida não pode impedir o app de abrir
    return [];
  }
}

async function write(p: Platform, list: RecentProject[]): Promise<void> {
  const path = await file(p);
  const tmp = `${path}.tmp`;
  await p.fs.writeFile(tmp, new TextEncoder().encode(JSON.stringify(list, null, 2)));
  await p.fs.rename(tmp, path);
}

/**
 * Toda alteração é ler → modificar → gravar. Duas ao mesmo tempo (ex.: salvar o
 * projeto enquanto a miniatura fica pronta) perderiam dados, então passam por uma fila.
 */
let queue: Promise<unknown> = Promise.resolve();
function modify(p: Platform, fn: (list: RecentProject[]) => RecentProject[]): Promise<RecentProject[]> {
  const run = queue.then(async () => {
    const next = fn(await loadRecents(p));
    await write(p, next);
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}

export function rememberRecent(p: Platform, entry: Omit<RecentProject, 'favorite'>): Promise<RecentProject[]> {
  return modify(p, (list) => {
    const prev = list.find((r) => r.path === entry.path);
    // não perde a miniatura já conhecida se a nova ainda não existe
    const posterPath = entry.posterPath ?? prev?.posterPath ?? null;
    return [{ ...entry, posterPath, favorite: prev?.favorite ?? false }, ...list.filter((r) => r.path !== entry.path)].slice(0, MAX);
  });
}

export function updateRecent(p: Platform, path: string, patch: Partial<RecentProject>): Promise<RecentProject[]> {
  return modify(p, (list) => list.map((r) => (r.path === path ? { ...r, ...patch } : r)));
}

export function forgetRecent(p: Platform, path: string): Promise<RecentProject[]> {
  return modify(p, (list) => list.filter((r) => r.path !== path));
}

/** Ordena favoritos primeiro, depois por data de abertura. */
export function sortRecents(list: RecentProject[]): RecentProject[] {
  return [...list].sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.openedAt.localeCompare(a.openedAt));
}
