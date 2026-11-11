import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AudioLines, Clapperboard, FolderOpen, House, LibraryBig, Music2, RefreshCw, Upload } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { HomeScreen } from './features/home/HomeScreen';
import { NewProjectDialog } from './features/home/NewProjectDialog';
import { JobsDock } from './features/jobs/JobsDock';
import { ProjectScreen } from './features/project/ProjectScreen';
import { MusicScreen } from './features/music/MusicScreen';
import { SceneLaboratory } from './features/scenes/SceneLaboratory';
import { SoundLibraryScreen } from './features/sounds/SoundLibraryScreen';
import { PlayerBar } from './features/music/player';
import { fileName, useApp } from './store';
import { Button, Dialog } from './ui/controls';
import { Toasts } from './ui/Toasts';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { UpdateBanner, useUpdate, useUpdateChecker } from './features/update/UpdateBanner';

const AUTOSAVE_MS = 30_000;

function NavButton({ label, active, disabled, onClick, children }: { label: string; active: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
      className={`relative grid size-10 place-items-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:text-faint/50 ${
        active ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink'
      }`}
    >
      {active && <span className="absolute top-2 bottom-2 -left-2 w-0.5 rounded-full bg-violet" />}
      {children}
    </button>
  );
}

function Sidebar() {
  const { screen, go, session } = useApp();
  return (
    <nav className="app-sidebar flex w-16 shrink-0 flex-col items-center gap-1 py-3" aria-label="Navegação">
      <img src="/favicon.png" alt="AMV Studio" className="mb-4 size-8" draggable={false} />
      <NavButton label="Início" active={screen === 'home'} onClick={() => go('home')}>
        <House size={19} />
      </NavButton>
      <NavButton label={session ? `Projeto: ${session.project.name}` : 'Nenhum projeto aberto'} active={screen === 'project'} disabled={!session} onClick={() => go('project')}>
        <Clapperboard size={19} />
      </NavButton>
      <NavButton label={session ? 'Laboratório de Cenas' : 'Abra um projeto para acessar o Laboratório de Cenas'} active={screen === 'scenes'} disabled={!session} onClick={() => go('scenes')}>
        <LibraryBig size={19} />
      </NavButton>
      <NavButton label="Músicas" active={screen === 'music'} onClick={() => go('music')}>
        <Music2 size={19} />
      </NavButton>
      <NavButton label="Efeitos sonoros" active={screen === 'sounds'} onClick={() => go('sounds')}>
        <AudioLines size={19} />
      </NavButton>
      <VersionButton />
    </nav>
  );
}

function VersionButton() {
  const { version, phase, update, check } = useUpdate();
  const checking = phase === 'checking';
  return (
    <button
      type="button"
      onClick={() => void check(true)}
      disabled={checking}
      title={update ? `Versão ${update.version} disponível` : 'Procurar atualizações'}
      className="mt-auto flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-muted hover:bg-raised/60 hover:text-ink"
    >
      <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
      <span className="tnum text-2xs">{version ? `v${version}` : ''}</span>
      {update && <span className="size-1.5 rounded-full bg-violet" />}
    </button>
  );
}

function RecoveryDialog() {
  const { recoveryFor, resolveRecovery } = useApp();
  if (!recoveryFor) return null;
  return (
    <Dialog
      title="Recuperar alterações?"
      onClose={() => resolveRecovery(null)}
      footer={
        <>
          <Button variant="ghost" onClick={() => resolveRecovery(false)}>
            Abrir a última versão salva
          </Button>
          <Button variant="primary" onClick={() => resolveRecovery(true)}>
            Recuperar alterações
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-soft">
        O AMV Studio fechou antes de você salvar <span className="font-semibold text-ink">{fileName(recoveryFor)}</span>. Existe um salvamento automático mais recente
        com as alterações que ficaram pendentes.
      </p>
    </Dialog>
  );
}

function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useApp.getState();
      const typing = e.target instanceof HTMLElement && e.target.matches('input, textarea, select, [contenteditable]');
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        void (e.shiftKey ? st.saveAs() : st.save());
      } else if (k === 'o') {
        e.preventDefault();
        void st.openProject();
      } else if (k === 'n') {
        e.preventDefault();
        st.setNewProjectOpen(true);
      } else if (k === 'i' && st.session) {
        e.preventDefault();
        void st.importMedia();
      } else if (k === 'z' && !typing && st.session) {
        e.preventDefault();
        if (e.shiftKey) st.session.redo();
        else st.session.undo();
      } else if (k === 'y' && !typing && st.session) {
        e.preventDefault();
        st.session.redo();
      } else if (['p', 'r', 'f', 'g', 'u', 'j'].includes(k)) {
        // atalhos do navegador que não fazem sentido no app (imprimir, recarregar, buscar…)
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function useAutosave() {
  useEffect(() => {
    const id = setInterval(() => {
      const s = useApp.getState().session;
      s?.autosave().catch((e) => useApp.getState().toast({ tone: 'error', title: 'Falha no salvamento automático', body: String(e) }));
    }, AUTOSAVE_MS);
    return () => clearInterval(id);
  }, []);
}

/** Arrastar arquivos para a janela importa direto no projeto aberto. */
function useFileDrop(): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let off: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((ev) => {
        const st = useApp.getState();
        if (ev.payload.type === 'enter' || ev.payload.type === 'over') setOver(true);
        else if (ev.payload.type === 'leave') setOver(false);
        else if (ev.payload.type === 'drop') {
          setOver(false);
          const paths = ev.payload.paths;
          const project = paths.find((p) => p.toLowerCase().endsWith('.amvproj'));
          if (project) void st.openProject(project);
          else if (st.session) {
            st.go('project');
            void st.importMedia(paths);
          } else st.toast({ tone: 'info', title: 'Abra ou crie um projeto antes de importar mídia' });
        }
      })
      .then((u) => (off = u));
    return () => off?.();
  }, []);
  return over;
}

function useCloseGuard() {
  useEffect(() => {
    let off: (() => void) | undefined;
    const win = getCurrentWindow();
    win
      .onCloseRequested(async (e) => {
        const st = useApp.getState();
        if (st.session?.dirty) {
          e.preventDefault();
          const ok = await st.closeProject();
          if (ok) await win.destroy();
        }
      })
      .then((u) => (off = u));
    return () => off?.();
  }, []);
}

export function App() {
  const { screen, session, newProjectOpen } = useApp();
  useGlobalShortcuts();
  useAutosave();
  useCloseGuard();
  const dragging = useFileDrop();
  useUpdateChecker();

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <UpdateBanner />
        <div className="min-h-0 flex-1">
          <ErrorBoundary key={screen} area={screen === 'project' ? 'do projeto' : screen === 'scenes' ? 'do Laboratório de Cenas' : screen === 'music' ? 'de músicas' : screen === 'sounds' ? 'de efeitos sonoros' : 'inicial'} onReset={() => useApp.getState().go('home')}>
            {screen === 'project' && session ? <ProjectScreen /> : screen === 'scenes' && session ? <SceneLaboratory session={session} /> : screen === 'music' ? <MusicScreen /> : screen === 'sounds' ? <SoundLibraryScreen /> : <HomeScreen />}
          </ErrorBoundary>
        </div>
        <JobsDock />
        <div className="app-player-bar shrink-0"><PlayerBar /></div>
      </main>
      {newProjectOpen && <NewProjectDialog />}
      <RecoveryDialog />
      <Toasts />
      {dragging && (
        <div className="pointer-events-none fixed inset-3 z-30 grid place-items-center rounded-xl border-2 border-dashed border-violet bg-violet/10">
          <div className="flex items-center gap-3 rounded-panel bg-panel px-5 py-3 text-sm shadow-xl">
            {session ? <Upload size={18} className="text-violet" /> : <FolderOpen size={18} className="text-violet" />}
            {session ? `Soltar para importar em "${session.project.name}"` : 'Solte um arquivo .amvproj para abrir'}
          </div>
        </div>
      )}
    </div>
  );
}
