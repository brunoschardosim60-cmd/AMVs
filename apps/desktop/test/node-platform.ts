import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { NodeRunner, nodeFs } from '@amv/media/src/node';
import type { Dialogs, Platform } from '../src/platform/types';

/** Plataforma real para testes: FFmpeg do sistema + node:fs. Diálogos são roteirizados. */
export function nodePlatform(root: string, answers: Partial<Dialogs> = {}): Platform {
  const nope = async () => {
    throw new Error('diálogo não esperado no teste');
  };
  return {
    runner: new NodeRunner(),
    fs: nodeFs,
    dialogs: {
      openProject: nope,
      saveProjectAs: nope,
      pickMedia: nope,
      pickFile: nope,
      pickFolder: nope,
      saveFile: nope,
      confirm: async () => true,
      ...answers,
    },
    cacheDir: async () => join(root, 'cache'),
    dataDir: async () => join(root, 'data'),
    fileUrl: (p) => `file://${p}`,
    reveal: async () => undefined,
    openFile: async () => undefined,
    async listFiles(dir, depth) {
      const out: string[] = [];
      const walk = async (d: string, level: number) => {
        for (const e of await readdir(d, { withFileTypes: true })) {
          const p = join(d, e.name);
          if (e.isDirectory()) {
            if (level < depth) await walk(p, level + 1);
          } else out.push(p);
        }
      };
      await walk(dir, 0);
      return out;
    },
  };
}
