/**
 * Registro de erros inesperados. Guarda os últimos em memória e grava em
 * <dados do app>/erros.log para diagnóstico (o app não envia nada para fora).
 */
import { joinPath } from '@amv/media';
import type { Platform } from '../platform/types';

export interface ErrorRecord {
  at: string;
  where: string;
  message: string;
  stack: string;
}

const recent: ErrorRecord[] = [];
let platform: Platform | null = null;
let notify: ((r: ErrorRecord) => void) | null = null;
let writing = Promise.resolve();

export function setupErrorReporting(p: Platform, onError: (r: ErrorRecord) => void): void {
  platform = p;
  notify = onError;
  window.addEventListener('error', (e) => reportError('janela', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => reportError('tarefa em segundo plano', e.reason));
}

export function recentErrors(): readonly ErrorRecord[] {
  return recent;
}

export function reportError(where: string, err: unknown, extra = ''): void {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err));
  const rec: ErrorRecord = {
    at: new Date().toISOString(),
    where,
    message: e.message,
    stack: `${e.stack ?? ''}${extra ? `\n${extra}` : ''}`,
  };
  recent.push(rec);
  if (recent.length > 50) recent.shift();
  console.error(`[AMV Studio] ${where}:`, e);
  notify?.(rec);
  const p = platform;
  if (!p) return;
  writing = writing
    .then(async () => {
      const dir = await p.dataDir();
      await p.fs.mkdir(dir);
      const file = joinPath(dir, 'erros.log');
      const old = (await p.fs.exists(file)) ? new TextDecoder().decode(await p.fs.readFile(file)) : '';
      const line = `[${rec.at}] ${rec.where}: ${rec.message}\n${rec.stack}\n\n`;
      // mantém o arquivo pequeno: últimos ~200 KB
      await p.fs.writeFile(file, new TextEncoder().encode((old + line).slice(-200_000)));
    })
    .catch(() => undefined);
}
