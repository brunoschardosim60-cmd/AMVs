import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../core/errors';

interface State {
  error: Error | null;
  componentStack: string;
}

/**
 * Se uma tela quebrar, mostra o erro em vez de deixar a janela vazia, e deixa
 * voltar sem fechar o app. O projeto aberto continua na memória (e no autosave).
 */
export class ErrorBoundary extends Component<{ children: ReactNode; area: string; onReset?: () => void }, State> {
  override state: State = { error: null, componentStack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? '' });
    reportError(`tela ${this.props.area}`, error, info.componentStack ?? '');
  }

  private reset = () => {
    this.setState({ error: null, componentStack: '' });
    this.props.onReset?.();
  };

  override render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    const details = `${error.name}: ${error.message}\n\n${error.stack ?? ''}\n\nComponentes:${componentStack}`;
    return (
      <div className="h-full overflow-y-auto p-10">
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold">Esta tela encontrou um erro</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Seu projeto não foi perdido. Copie os detalhes e envie para correção; depois volte para continuar.
          </p>
          <p className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm break-words text-danger">{error.message}</p>
          <div className="mt-4 flex gap-2">
            <button type="button" className="h-9 rounded-control bg-violet px-3.5 text-sm font-medium text-white hover:bg-violet-strong" onClick={() => void navigator.clipboard.writeText(details)}>
              Copiar detalhes
            </button>
            <button type="button" className="h-9 rounded-control border border-line bg-raised px-3.5 text-sm font-medium hover:bg-hover" onClick={this.reset}>
              Voltar
            </button>
          </div>
          <pre className="mt-4 max-h-80 overflow-auto rounded-md bg-base p-3 text-2xs leading-relaxed whitespace-pre-wrap text-muted select-text">{details}</pre>
        </div>
      </div>
    );
  }
}
