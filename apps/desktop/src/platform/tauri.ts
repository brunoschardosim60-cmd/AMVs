import type { FileSystem, ProcessRunner, RunOptions, RunResult, Tool } from '@amv/media';
import { ALL_IMPORT_EXTENSIONS, joinPath } from '@amv/media';
import { convertFileSrc } from '@tauri-apps/api/core';
import { appCacheDir, appDataDir } from '@tauri-apps/api/path';
import { ask, open, save } from '@tauri-apps/plugin-dialog';
import * as tfs from '@tauri-apps/plugin-fs';
import { Command } from '@tauri-apps/plugin-shell';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import type { Platform } from './types';

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
    const decoder = new TextDecoder();
    cmd.stdout.on('data', (data: string | Uint8Array) => {
      if (raw) {
        options.onStdoutBytes!(typeof data === 'string' ? new TextEncoder().encode(data) : data);
        return;
      }
      // sem "raw", o plugin entrega uma linha por evento, sem a quebra
      const text = (typeof data === 'string' ? data : decoder.decode(data)) + '\n';
      stdout += text;
      options.onStdout?.(text);
    });
    cmd.stderr.on('data', (data: string | Uint8Array) => {
      const text = (typeof data === 'string' ? data : decoder.decode(data)) + '\n';
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
        const r = await open({ title, multiple: false, filters: [{ name: 'Mídia', extensions }] });
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
