import type { FileSystem, ProcessRunner, RunOptions, RunResult, Tool } from '@amv/media';
import { ALL_IMPORT_EXTENSIONS, joinPath } from '@amv/media';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { appCacheDir, appDataDir } from '@tauri-apps/api/path';
import { ask, open, save } from '@tauri-apps/plugin-dialog';
import * as tfs from '@tauri-apps/plugin-fs';
import { Command } from '@tauri-apps/plugin-shell';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import type { AnalyzerConnection, Platform, SpeechProgress, SpeechTranscript } from './types';

/** O plugin entrega string, Uint8Array ou (para bytes que não são UTF-8) um array de números. */
function toBytes(data: unknown): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return Uint8Array.from(data as number[]);
  return new TextEncoder().encode(String(data ?? ''));
}

/** FFmpeg/FFprobe empacotados como sidecar (src-tauri/binaries). */
const tauriRunner: ProcessRunner = {
  async run(tool: Tool, args: string[], options: RunOptions = {}): Promise<RunResult> {
    if (options.signal?.aborted) return { code: null, stdout: '', stderr: 'cancelado' };
    const raw = !!options.onStdoutBytes;
    const cmd = raw
      ? Command.sidecar(`binaries/${tool}`, args, { encoding: 'raw' })
      : Command.sidecar(`binaries/${tool}`, args);
    let stdout = '';
    let stderr = '';
    // nomes de arquivo em Windows-1252/Shift-JIS não são UTF-8 válido: não pode quebrar
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const asText = (data: unknown) => (typeof data === 'string' ? data : decoder.decode(toBytes(data)));
    cmd.stdout.on('data', (data: unknown) => {
      if (raw) {
        options.onStdoutBytes!(toBytes(data));
        return;
      }
      // sem "raw", o plugin entrega uma linha por evento, sem a quebra
      const text = asText(data) + '\n';
      stdout += text;
      options.onStdout?.(text);
    });
    cmd.stderr.on('data', (data: unknown) => {
      const text = asText(data) + '\n';
      stderr = (stderr + text).slice(-64_000);
      options.onStderr?.(text);
    });
    return new Promise<RunResult>((resolve, reject) => {
      cmd.on('close', ({ code }) => resolve({ code, stdout, stderr }));
      cmd.on('error', (e) => reject(new Error(String(e))));
      cmd
        .spawn()
        .then((child) => {
          options.signal?.addEventListener('abort', () => void child.kill(), { once: true });
        })
        .catch((e) => reject(new Error(`não foi possível iniciar o ${tool}: ${e}`)));
    });
  },
};

const tauriFs: FileSystem = {
  exists: (p) => tfs.exists(p),
  mkdir: (p) => tfs.mkdir(p, { recursive: true }),
  writeFile: (p, d) => tfs.writeFile(p, d),
  readFile: (p) => tfs.readFile(p),
  rename: (a, b) => tfs.rename(a, b),
  remove: (p) => tfs.remove(p, { recursive: true }),
  readDir: async (p) => (await tfs.readDir(p)).map((e) => e.name),
  size: async (p) => (await tfs.stat(p)).size,
  async readRange(path, offset, length) {
    const fh = await tfs.open(path, { read: true });
    try {
      await fh.seek(offset, tfs.SeekMode.Start);
      const buf = new Uint8Array(length);
      let read = 0;
      while (read < length) {
        const n = await fh.read(buf.subarray(read));
        if (n === null || n === 0) break;
        read += n;
      }
      return buf.subarray(0, read);
    } finally {
      await fh.close();
    }
  },
};

export function createTauriPlatform(): Platform {
  let cache: string | null = null;
  let data: string | null = null;
  const analyzer = {
    async start(): Promise<AnalyzerConnection> {
      const connection = await invoke<AnalyzerConnection>('analyzer_start');
      let lastError = 'o servidor não respondeu';
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          const response = await tauriFetch(`${connection.baseUrl}/health`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${connection.token}` },
            connectTimeout: 1_000,
          });
          if (response.ok) return connection;
          lastError = `respondeu ${response.status}`;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      throw new Error(`o analisador local iniciou, mas não ficou pronto: ${lastError}`);
    },
    async transcribe(
      connection: AnalyzerConnection,
      request: { path: string; model: string; language?: string },
      options: { signal?: AbortSignal; onProgress?: (progress: SpeechProgress) => void } = {},
    ): Promise<SpeechTranscript> {
      const { signal, onProgress } = options;
      const headers = { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' };
      let jobId: string | null = null;
      const readJson = async <T>(response: Response): Promise<T> => {
        const text = await response.text();
        if (!response.ok) {
          let detail = text;
          try {
            detail = (JSON.parse(text) as { detail?: string }).detail ?? text;
          } catch {
            // Mantém a resposta original para facilitar o diagnóstico.
          }
          throw new Error(`transcrição respondeu ${response.status}: ${detail}`);
        }
        return JSON.parse(text) as T;
      };
      try {
        if (signal?.aborted) throw new DOMException('transcrição cancelada', 'AbortError');
        const started = await readJson<{ job_id: string }>(
          await tauriFetch(`${connection.baseUrl}/speech/jobs`, {
            method: 'POST',
            headers,
            body: JSON.stringify(request),
            signal,
            connectTimeout: 15_000,
          }),
        );
        jobId = started.job_id;
        while (true) {
          if (signal?.aborted) throw new DOMException('transcrição cancelada', 'AbortError');
          await new Promise<void>((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout>;
            const onAbort = () => {
              clearTimeout(timer);
              signal?.removeEventListener('abort', onAbort);
              reject(new DOMException('transcrição cancelada', 'AbortError'));
            };
            timer = setTimeout(() => {
              signal?.removeEventListener('abort', onAbort);
              resolve();
            }, 400);
            if (signal?.aborted) {
              onAbort();
              return;
            }
            signal?.addEventListener('abort', onAbort, { once: true });
          });
          const progress = await readJson<SpeechProgress>(
            await tauriFetch(`${connection.baseUrl}/speech/jobs/${started.job_id}`, {
              method: 'GET',
              headers,
              signal,
              connectTimeout: 5_000,
            }),
          );
          onProgress?.(progress);
          if (progress.status === 'completed' && progress.result) return progress.result;
          if (progress.status === 'failed') throw new Error(progress.error ?? 'falha sem detalhe na transcrição');
          if (progress.status === 'cancelled') throw new DOMException('transcrição cancelada', 'AbortError');
        }
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
          if (jobId) {
            try {
              await tauriFetch(`${connection.baseUrl}/speech/jobs/${jobId}`, {
                method: 'DELETE',
                headers,
                connectTimeout: 5_000,
              });
              for (let attempt = 0; attempt < 20; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 250));
                const progress = await readJson<SpeechProgress>(
                  await tauriFetch(`${connection.baseUrl}/speech/jobs/${jobId}`, {
                    method: 'GET',
                    headers,
                    connectTimeout: 5_000,
                  }),
                );
                onProgress?.(progress);
                if (progress.status !== 'queued' && progress.status !== 'running') break;
                if (attempt === 19) await invoke<void>('analyzer_stop');
              }
            } catch (cancelError) {
              try {
                await invoke<void>('analyzer_stop');
              } catch (stopError) {
                throw new AggregateError([cancelError, stopError], 'não foi possível cancelar a transcrição nem encerrar o analisador');
              }
            }
          } else {
            await invoke<void>('analyzer_stop');
          }
          throw new DOMException('transcrição cancelada', 'AbortError');
        }
        throw error;
      }
    },
    stop: () => invoke<void>('analyzer_stop'),
  };
  return {
    runner: tauriRunner,
    fs: tauriFs,
    dialogs: {
      async openProject() {
        const r = await open({ multiple: false, filters: [{ name: 'Projeto AMV Studio', extensions: ['amvproj'] }] });
        return typeof r === 'string' ? r : null;
      },
      async saveProjectAs(defaultName) {
        return (await save({ defaultPath: `${defaultName}.amvproj`, filters: [{ name: 'Projeto AMV Studio', extensions: ['amvproj'] }] })) ?? null;
      },
      async pickMedia() {
        const r = await open({ multiple: true, filters: [{ name: 'Vídeo, áudio e imagem', extensions: ALL_IMPORT_EXTENSIONS }] });
        return Array.isArray(r) ? r : r ? [r] : [];
      },
      async pickFile(title, extensions) {
        const r = await open({ title, multiple: false, filters: [{ name: extensions.map((e) => '.' + e).join(' '), extensions }] });
        return typeof r === 'string' ? r : null;
      },
      async pickFolder(title) {
        const r = await open({ title, directory: true, multiple: false });
        return typeof r === 'string' ? r : null;
      },
      async saveFile(title, defaultName, filters) {
        return (await save({ title, defaultPath: defaultName, filters })) ?? null;
      },
      confirm: (message, title) => ask(message, { title, kind: 'warning', okLabel: 'Continuar', cancelLabel: 'Cancelar' }),
    },
    async cacheDir() {
      cache ??= joinPath(await appCacheDir(), 'media');
      return cache;
    },
    async dataDir() {
      data ??= await appDataDir();
      return data;
    },
    fileUrl: (p) => convertFileSrc(p),
    secrets: {
      get: (name) => invoke<string | null>('secret_get', { name }),
      set: (name, value) => invoke<void>('secret_set', { name, value }),
      delete: (name) => invoke<void>('secret_delete', { name }),
    },
    analyzer,
    http: (url, init) => tauriFetch(url, { method: init.method, headers: init.headers, body: init.method === 'GET' ? undefined : init.body, signal: init.signal, connectTimeout: 15_000 }),
    reveal: (p) => revealItemInDir(p),
    openFile: (p) => openPath(p),
    async listFiles(dir, depth) {
      const out: string[] = [];
      const walk = async (d: string, level: number) => {
        let entries: tfs.DirEntry[];
        try {
          entries = await tfs.readDir(d);
        } catch {
          return; // pasta sem permissão: ignora
        }
        for (const e of entries) {
          const p = joinPath(d, e.name);
          if (e.isDirectory) {
            if (level < depth) await walk(p, level + 1);
          } else if (e.isFile) out.push(p);
        }
      };
      await walk(dir, 0);
      return out;
    },
  };
}
