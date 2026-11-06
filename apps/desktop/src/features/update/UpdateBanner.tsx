import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { Download, RefreshCw, X } from 'lucide-react';
import { create } from 'zustand';
import { useEffect } from 'react';
import { useApp } from '../../store';
import { Button, IconButton, Progress } from '../../ui/controls';

type Phase = 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'error';

interface UpdateState {
  version: string | null;
  phase: Phase;
  update: Update | null;
  progress: number | null;
  error: string | null;
  dismissed: boolean;
  check(manual: boolean): Promise<void>;
  install(): Promise<void>;
  dismiss(): void;
}

export const useUpdate = create<UpdateState>((set, get) => ({
  version: null,
  phase: 'idle',
  update: null,
  progress: null,
  error: null,
  dismissed: false,

  async check(manual) {
    if (get().phase === 'checking' || get().phase === 'downloading') return;
    set({ phase: 'checking', error: null });
    try {
      const update = await check();
      if (update) {
        set({ phase: 'available', update, dismissed: false });
      } else {
        set({ phase: 'idle' });
        if (manual) useApp.getState().toast({ tone: 'ok', title: 'Você está na versão mais recente' });
      }
    } catch (e) {
      // sem internet ou GitHub fora do ar: não incomoda na verificação automática
      set({ phase: 'idle' });
      if (manual) useApp.getState().toast({ tone: 'error', title: 'Não foi possível procurar atualizações', body: String(e) });
    }
  },

  async install() {
    const { update } = get();
    if (!update) return;
    // nada se perde: alterações pendentes vão para o arquivo de recuperação,
    // que o app oferece restaurar ao abrir o projeto depois de reiniciar
    const session = useApp.getState().session;
    if (session?.dirty) await session.autosave().catch(() => undefined);

    let total = 0;
    let done = 0;
    set({ phase: 'downloading', progress: 0 });
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
        else if (ev.event === 'Progress') {
          done += ev.data.chunkLength;
          set({ progress: total ? done / total : null });
        } else if (ev.event === 'Finished') set({ phase: 'installing', progress: 1 });
      });
      await relaunch();
    } catch (e) {
      set({ phase: 'error', error: String(e) });
    }
  },

  dismiss() {
    set({ dismissed: true });
  },
}));

/** Verifica ao abrir o app e a cada 6 horas. */
export function useUpdateChecker() {
  useEffect(() => {
    void getVersion().then((version) => useUpdate.setState({ version }));
    const first = setTimeout(() => void useUpdate.getState().check(false), 3000);
    const every = setInterval(() => void useUpdate.getState().check(false), 6 * 60 * 60 * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);
}

export function UpdateBanner() {
  const { phase, update, progress, error, dismissed, install, dismiss, version } = useUpdate();
  if (dismissed || !update || phase === 'idle' || phase === 'checking') return null;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-violet/30 bg-violet/12 px-5 py-2 text-sm" role="status">
      <Download size={16} className="shrink-0 text-violet-strong" />
      {phase === 'available' && (
        <>
          <span className="min-w-0 truncate">
            <span className="font-semibold">AMV Studio {update.version}</span>
            <span className="text-ink-soft"> está disponível{version ? ` (você tem a ${version})` : ''}.</span>
            {update.body && <span className="text-muted"> {update.body.split('\n')[0]}</span>}
          </span>
          <Button size="sm" variant="primary" className="ml-auto" icon={<RefreshCw size={14} />} onClick={install}>
            Atualizar e reiniciar
          </Button>
          <IconButton label="Depois" className="size-7" onClick={dismiss}>
            <X size={14} />
          </IconButton>
        </>
      )}
      {(phase === 'downloading' || phase === 'installing') && (
        <>
          <span className="shrink-0 text-ink-soft">{phase === 'downloading' ? `Baixando a versão ${update.version}…` : 'Instalando, o app vai reiniciar…'}</span>
          <span className="ml-auto w-56">
            <Progress value={progress} live />
          </span>
        </>
      )}
      {phase === 'error' && (
        <>
          <span className="min-w-0 truncate text-danger" title={error ?? ''}>
            A atualização falhou: {error}
          </span>
          <Button size="sm" className="ml-auto" onClick={install}>
            Tentar de novo
          </Button>
          <IconButton label="Fechar" className="size-7" onClick={dismiss}>
            <X size={14} />
          </IconButton>
        </>
      )}
    </div>
  );
}
