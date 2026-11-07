import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { loadRecents, sortRecents, type RecentProject } from './core/recents';
import { ProjectSession, type ImportReport } from './core/session';
import type { Platform } from './platform/types';
import { reportError } from './core/errors';
import type { ProjectSettings } from '@amv/project';
import { MusicLibrary } from './core/library';

export type Screen = 'home' | 'project' | 'music';

export interface Toast {
  id: number;
  tone: 'info' | 'ok' | 'warn' | 'error';
  title: string;
  body?: string;
}

interface AppState {
  platform: Platform | null;
  library: MusicLibrary | null;
  screen: Screen;
  session: ProjectSession | null;
  recents: RecentProject[];
  toasts: Toast[];
  /** Projeto com autosave mais novo, aguardando decisão do usuário. */
  recoveryFor: string | null;
  newProjectOpen: boolean;
  selectedAssetId: string | null;

  init(platform: Platform): Promise<void>;
  toast(t: Omit<Toast, 'id'>): void;
  dismissToast(id: number): void;
  refreshRecents(): Promise<void>;
  go(screen: Screen): void;
  setNewProjectOpen(open: boolean): void;
  selectAsset(id: string | null): void;

  createProject(name: string, settings: Partial<ProjectSettings>): Promise<void>;
  openProject(path?: string): Promise<void>;
  resolveRecovery(useAutosave: boolean | null): Promise<void>;
  closeProject(): Promise<boolean>;
  save(): Promise<void>;
  saveAs(): Promise<void>;
  importMedia(paths?: string[]): Promise<void>;
}

let toastSeq = 0;

export const useApp = create<AppState>((set, get) => ({
  platform: null,
  library: null,
  screen: 'home',
  session: null,
  recents: [],
  toasts: [],
  recoveryFor: null,
  newProjectOpen: false,
  selectedAssetId: null,

  async init(platform) {
    const library = new MusicLibrary(platform);
    set({ platform, library });
    library.load().catch((e) => reportError('biblioteca', e));
    await get().refreshRecents();
  },

  toast(t) {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    const ms = t.tone === 'error' ? 12_000 : 5_000;
    setTimeout(() => get().dismissToast(id), ms);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  async refreshRecents() {
    const p = get().platform;
    if (!p) return;
    set({ recents: sortRecents(await loadRecents(p)) });
  },

  go(screen) {
    if (screen === 'project' && !get().session) return;
    set({ screen });
  },

  setNewProjectOpen(open) {
    set({ newProjectOpen: open });
  },

  selectAsset(id) {
    set({ selectedAssetId: id });
  },

  async createProject(name, settings) {
    const p = get().platform!;
    const path = await p.dialogs.saveProjectAs(name);
    if (!path) return;
    if (!(await get().closeProject())) return;
    try {
      const session = await ProjectSession.create(p, path, name, settings);
      set({ session, screen: 'project', newProjectOpen: false, selectedAssetId: null });
      await get().refreshRecents();
    } catch (e) {
      get().toast({ tone: 'error', title: 'Não foi possível criar o projeto', body: (e as Error).message });
    }
  },

  async openProject(path) {
    const p = get().platform!;
    const target = path ?? (await p.dialogs.openProject());
    if (!target) return;
    if (get().session?.path === target) {
      set({ screen: 'project' });
      return;
    }
    if (await ProjectSession.hasRecovery(p, target)) {
      set({ recoveryFor: target });
      return;
    }
    await openInternal(target, false);
  },

  async resolveRecovery(useAutosave) {
    const target = get().recoveryFor;
    set({ recoveryFor: null });
    if (!target || useAutosave === null) return;
    await openInternal(target, useAutosave);
  },

  async closeProject() {
    const { session, platform } = get();
    if (!session) return true;
    if (session.dirty) {
      const discard = await platform!.dialogs.confirm(
        `"${session.project.name}" tem alterações não salvas. Fechar mesmo assim? As alterações ficam no arquivo de recuperação.`,
        'Fechar projeto',
      );
      if (!discard) return false;
      await session.autosave().catch(() => undefined);
    }
    session.dispose();
    set({ session: null, screen: 'home', selectedAssetId: null });
    await get().refreshRecents();
    return true;
  },

  async save() {
    const s = get().session;
    if (!s) return;
    try {
      await s.save();
      get().toast({ tone: 'ok', title: 'Projeto salvo' });
    } catch (e) {
      get().toast({ tone: 'error', title: 'Não foi possível salvar', body: (e as Error).message });
    }
  },

  async saveAs() {
    const { session, platform } = get();
    if (!session) return;
    const path = await platform!.dialogs.saveProjectAs(session.project.name);
    if (!path) return;
    try {
      await session.saveAs(path);
      get().toast({ tone: 'ok', title: 'Projeto salvo', body: session.path });
      await get().refreshRecents();
    } catch (e) {
      get().toast({ tone: 'error', title: 'Não foi possível salvar', body: (e as Error).message });
    }
  },

  async importMedia(paths) {
    const { session, platform } = get();
    if (!session) return;
    try {
      const list = paths ?? (await platform!.dialogs.pickMedia());
      if (!list.length) return;
      const report = await session.importFiles(list);
      announceImport(report);
    } catch (e) {
      reportError('importação', e);
    }
  },
}));

async function openInternal(path: string, preferAutosave: boolean) {
  const { platform, closeProject, toast, refreshRecents } = useApp.getState();
  if (!(await closeProject())) return;
  const { session, result } = await ProjectSession.open(platform!, path, preferAutosave);
  if (!result.ok || !session) {
    toast({ tone: 'error', title: `Não foi possível abrir: ${result.ok ? '' : result.error}`, body: result.ok ? undefined : result.details.slice(0, 3).join('\n') || path });
    await refreshRecents();
    return;
  }
  useApp.setState({ session, screen: 'project', selectedAssetId: null });
  if (result.recovered) toast({ tone: 'warn', title: 'Projeto recuperado', body: 'Abrimos a versão do salvamento automático. Salve para manter.' });
  if (result.missing) toast({ tone: 'warn', title: `${result.missing} mídia(s) não encontrada(s)`, body: 'Use "Localizar" para apontar onde estão os arquivos agora.' });
  await refreshRecents();
}

function announceImport(r: ImportReport) {
  const { toast } = useApp.getState();
  if (r.imported.length) toast({ tone: 'ok', title: r.imported.length === 1 ? '1 arquivo importado' : `${r.imported.length} arquivos importados` });
  for (const s of r.skipped) toast({ tone: 'info', title: `Ignorado: ${fileName(s.path)}`, body: s.reason });
  for (const f of r.failed) toast({ tone: 'error', title: `Não foi possível importar ${fileName(f.path)}`, body: f.reason });
}

export function fileName(p: string) {
  return p.split(/[\\/]/).pop() ?? p;
}

/** Re-renderiza quando o projeto, os artefatos ou a fila de jobs mudam. */
export function useSessionVersion(session: ProjectSession | null): number {
  return useSyncExternalStore(
    (cb) => (session ? session.subscribe(cb) : () => undefined),
    () => (session ? session.changes : 0),
  );
}

/** Re-renderiza quando a biblioteca de músicas muda. */
export function useLibraryVersion(library: MusicLibrary | null): number {
  return useSyncExternalStore(
    (cb) => (library ? library.subscribe(cb) : () => undefined),
    () => (library ? library.changes : 0),
  );
}
