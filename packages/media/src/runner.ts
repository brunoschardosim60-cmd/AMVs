/**
 * Abstração de processo. O app usa o sidecar do Tauri; testes e scripts usam o
 * child_process do Node (ver node.ts). Nenhum outro código chama FFmpeg direto.
 */

export type Tool = 'ffmpeg' | 'ffprobe';

export interface RunOptions {
  /** Texto do stdout, em pedaços (usado para -progress). */
  onStdout?: (chunk: string) => void;
  /** Bytes crus do stdout (usado para PCM da waveform). Se definido, stdout não é acumulado como texto. */
  onStdoutBytes?: (chunk: Uint8Array) => void;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface ProcessRunner {
  run(tool: Tool, args: string[], options?: RunOptions): Promise<RunResult>;
}

/** Sistema de arquivos mínimo que o pipeline precisa (Tauri fs plugin no app, node:fs em testes). */
export interface FileSystem {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  readDir(path: string): Promise<string[]>;
  size(path: string): Promise<number>;
  readRange(path: string, offset: number, length: number): Promise<Uint8Array>;
}

export class CancelledError extends Error {
  logPath?: string;

  constructor() {
    super('cancelado');
    this.name = 'CancelledError';
  }
}

export class ToolError extends Error {
  constructor(
    public readonly tool: Tool,
    public readonly code: number | null,
    public readonly stderr: string,
    message?: string,
  ) {
    super(message ?? `${tool} falhou (código ${code}): ${lastLines(stderr)}`);
    this.name = 'ToolError';
  }
}

export function lastLines(text: string, n = 4): string {
  return text.trim().split(/\r?\n/).slice(-n).join(' | ');
}

export function joinPath(...parts: string[]): string {
  const sep = parts.some((p) => /^[A-Za-z]:\\/.test(p) || p.includes('\\')) ? '\\' : '/';
  return parts
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, '')))
    .filter(Boolean)
    .join(sep);
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
