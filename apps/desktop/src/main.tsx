import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createTauriPlatform } from './platform/tauri';
import { setupErrorReporting } from './core/errors';
import { useApp } from './store';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

// O AMV Studio precisa do app desktop (FFmpeg, arquivos locais). No navegador comum,
// explica isso em vez de mostrar uma interface que não funcionaria.
const inTauri = '__TAURI_INTERNALS__' in window;

if (!inTauri) {
  root.render(
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-md">
        <img src="/favicon.png" alt="" className="mb-5 size-10" />
        <h1 className="text-xl font-semibold">O AMV Studio roda como app desktop</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Ele usa o FFmpeg e os arquivos do seu computador, o que um navegador não permite. Rode com <code className="rounded bg-raised px-1.5 py-0.5 text-xs">pnpm dev</code> na
          raiz do repositório ou instale o app.
        </p>
      </div>
    </div>,
  );
} else {
  const platform = createTauriPlatform();
  setupErrorReporting(platform, (r) =>
    useApp.getState().toast({ tone: 'error', title: 'Erro inesperado', body: `${r.where}: ${r.message}` }),
  );
  // soltar um arquivo fora da área tratada nunca pode fazer a janela "navegar" para ele
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  void useApp.getState().init(platform);
  root.render(
    <StrictMode>
      <ErrorBoundary area="principal">
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
