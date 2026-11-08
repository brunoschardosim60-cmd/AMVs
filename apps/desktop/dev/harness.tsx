import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/App';
import { useApp } from '../src/store';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import '../src/styles.css';
import { createBrowserPlatform } from './browser-platform';

// Roda o app REAL (mesmos componentes) num navegador, para os testes de interface.
(window as unknown as { __useApp: typeof useApp }).__useApp = useApp;
void useApp.getState().init(createBrowserPlatform());
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary area="principal">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
