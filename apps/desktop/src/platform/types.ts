import type { FileSystem, ProcessRunner } from '@amv/media';
import type { FetchLike } from '@amv/assistant';

/**
 * Tudo que o app precisa do sistema operacional. Em produção vem do Tauri
 * (platform/tauri.ts); nos testes, de Node com FFmpeg real.
 */
export interface Dialogs {
  openProject(): Promise<string | null>;
  saveProjectAs(defaultName: string): Promise<string | null>;
  pickMedia(): Promise<string[]>;
  pickFile(title: string, extensions: string[]): Promise<string | null>;
  pickFolder(title: string): Promise<string | null>;
  saveFile(title: string, defaultName: string, filters: { name: string; extensions: string[] }[]): Promise<string | null>;
  confirm(message: string, title: string): Promise<boolean>;
}

export interface AnalyzerConnection {
  baseUrl: string;
  token: string;
}

export interface SpeechTranscript {
  language: string | null;
  language_probability: number;
  duration: number;
  segments: { start: number; end: number; text: string; words: { start: number; end: number; text: string }[] }[];
}

export interface SpeechProgress {
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
  progress: number;
  duration: number;
  result: SpeechTranscript | null;
  error: string | null;
}

export interface Platform {
  runner: ProcessRunner;
  fs: FileSystem;
  dialogs: Dialogs;
  /** Pasta de cache (proxies, miniaturas, waveforms). */
  cacheDir(): Promise<string>;
  /** Pasta de dados do app (lista de recentes). */
  dataDir(): Promise<string>;
  /** URL que o webview consegue carregar para um arquivo local. */
  fileUrl(path: string): string;
  /** Lista arquivos de uma pasta, recursivamente até `depth` níveis. */
  listFiles(dir: string, depth: number): Promise<string[]>;
  /** Mostra o arquivo no gerenciador de arquivos do sistema. */
  reveal(path: string): Promise<void>;
  /** Abre o arquivo no programa padrão (ex.: o player de vídeo). */
  openFile(path: string): Promise<void>;
  /** Cofre do sistema (Gerenciador de Credenciais no Windows) para chaves de API. */
  secrets: {
    get(name: string): Promise<string | null>;
    set(name: string, value: string): Promise<void>;
    delete(name: string): Promise<void>;
  };
  analyzer: {
    start(): Promise<AnalyzerConnection>;
    transcribe(
      connection: AnalyzerConnection,
      request: { path: string; model: string; language?: string },
      options?: { signal?: AbortSignal; onProgress?: (progress: SpeechProgress) => void },
    ): Promise<SpeechTranscript>;
    stop(): Promise<void>;
  };
  /** HTTP fora do webview (sem CORS), para os provedores de IA. */
  http: FetchLike;
}
