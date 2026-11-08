import type { FileSystem, ProcessRunner, RunOptions, RunResult, Tool } from '@amv/media';
import { joinPath } from '@amv/media';
import type { Platform } from '../src/platform/types';

const BRIDGE = (import.meta.env.VITE_BRIDGE as string | undefined) ?? 'http://localhost:1421';

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const r = await fetch(`${BRIDGE}/rpc`, { method: 'POST', body: JSON.stringify({ method, args }) });
  const j = (await r.json()) as { result?: T; error?: string };
  if (!r.ok) throw new Error(j.error ?? `ponte ${r.status}`);
  return j.result as T;
}
const b64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const runner: ProcessRunner = {
  async run(tool: Tool, args: string[], o: RunOptions = {}): Promise<RunResult> {
    const r = await call<{ code: number | null; stdout: string; stderr: string }>('run', tool, args);
    const bytes = unb64(r.stdout);
    if (o.onStdoutBytes) o.onStdoutBytes(bytes);
    const stdout = new TextDecoder().decode(bytes);
    if (!o.onStdoutBytes) o.onStdout?.(stdout);
    o.onStderr?.(r.stderr);
    return { code: r.code, stdout: o.onStdoutBytes ? '' : stdout, stderr: r.stderr };
  },
};

const fs: FileSystem = {
  exists: (p) => call('exists', p),
  mkdir: (p) => call('mkdir', p),
  writeFile: (p, d) => call('writeFile', p, b64(d)),
  readFile: async (p) => unb64(await call<string>('readFile', p)),
  rename: (a, b) => call('rename', a, b),
  remove: (p) => call('remove', p),
  readDir: (p) => call('readDir', p),
  size: (p) => call('size', p),
  readRange: async (p, o, l) => unb64(await call<string>('readRange', p, o, l)),
};

/** Respostas dos diálogos, controladas pelo teste (window.__dialogs). */
type Answers = { pickMedia?: string[]; pickFile?: string | null; saveFile?: string | null; confirm?: boolean };
const answers = (): Answers => ((window as unknown as { __dialogs?: Answers }).__dialogs ??= {});

export function createBrowserPlatform(): Platform {
  const secrets = new Map<string, string>();
  return {
    runner,
    fs,
    dialogs: {
      openProject: async () => null,
      saveProjectAs: async (n) => `/tmp/amv-harness/${n}.amvproj`,
      pickMedia: async () => answers().pickMedia ?? [],
      pickFile: async () => answers().pickFile ?? null,
      pickFolder: async () => '/tmp/amv-harness',
      saveFile: async () => answers().saveFile ?? null,
      confirm: async () => answers().confirm ?? true,
    },
    cacheDir: async () => '/tmp/amv-harness/cache',
    dataDir: async () => '/tmp/amv-harness/data',
    fileUrl: (p) => `${BRIDGE}/file?path=${encodeURIComponent(p)}`,
    listFiles: (d, depth) => call('listFiles', d, depth),
    reveal: async () => undefined,
    openFile: async () => undefined,
    secrets: { get: async (k) => secrets.get(k) ?? null, set: async (k, v) => void secrets.set(k, v), delete: async (k) => void secrets.delete(k) },
    http: async (url, init) => {
      const r = await fetch(url, { method: init.method, headers: init.headers, body: init.method === 'GET' ? undefined : init.body, signal: init.signal });
      return { ok: r.ok, status: r.status, text: () => r.text() };
    },
  };
}
