/**
 * Implementações Node de ProcessRunner e FileSystem — para testes, scripts e CI.
 * NÃO é importado pelo app (o app usa o sidecar e o fs do Tauri).
 */
import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import type { FileSystem, ProcessRunner, RunOptions, RunResult, Tool } from './runner.js';

export interface NodeRunnerOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
}

export class NodeRunner implements ProcessRunner {
  constructor(private readonly opts: NodeRunnerOptions = {}) {}

  run(tool: Tool, args: string[], options: RunOptions = {}): Promise<RunResult> {
    const bin =
      tool === 'ffmpeg'
        ? this.opts.ffmpegPath ?? process.env.AMV_FFMPEG ?? 'ffmpeg'
        : this.opts.ffprobePath ?? process.env.AMV_FFPROBE ?? 'ffprobe';
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        resolve({ code: null, stdout: '', stderr: 'cancelado' });
        return;
      }
      const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let stdout = '';
      let stderr = '';
      const onAbort = () => child.kill('SIGKILL');
      options.signal?.addEventListener('abort', onAbort, { once: true });
      child.stdout.on('data', (buf: Buffer) => {
        if (options.onStdoutBytes) {
          options.onStdoutBytes(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        } else {
          const text = buf.toString('utf8');
          stdout += text;
          options.onStdout?.(text);
        }
      });
      child.stderr.on('data', (buf: Buffer) => {
        const text = buf.toString('utf8');
        // guarda só o final do stderr (pode ser enorme)
        stderr = (stderr + text).slice(-64_000);
        options.onStderr?.(text);
      });
      child.on('error', (e) => {
        options.signal?.removeEventListener('abort', onAbort);
        reject(e);
      });
      child.on('close', (code) => {
        options.signal?.removeEventListener('abort', onAbort);
        resolve({ code, stdout, stderr });
      });
    });
  }
}

export const nodeFs: FileSystem = {
  async exists(path) {
    try {
      await fsp.access(path);
      return true;
    } catch {
      return false;
    }
  },
  async mkdir(path) {
    await fsp.mkdir(path, { recursive: true });
  },
  async writeFile(path, data) {
    await fsp.writeFile(path, data);
  },
  async readFile(path) {
    return new Uint8Array(await fsp.readFile(path));
  },
  async rename(from, to) {
    await fsp.rename(from, to);
  },
  async remove(path) {
    await fsp.rm(path, { force: true, recursive: true });
  },
  async readDir(path) {
    return fsp.readdir(path);
  },
  async size(path) {
    return (await fsp.stat(path)).size;
  },
  async readRange(path, offset, length) {
    const fh = await fsp.open(path, 'r');
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, offset);
      return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
    } finally {
      await fh.close();
    }
  },
};
