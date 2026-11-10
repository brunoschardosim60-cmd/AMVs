import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SoundLibraryStore } from '../src/core/soundLibrary';
import { nodePlatform } from './node-platform';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/generated');
let root: string;
let soundPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'amv-sound-library-'));
  mkdirSync(join(root, 'sounds', 'sub'), { recursive: true });
  soundPath = join(root, 'sounds', 'sub', 'impact.wav');
  copyFileSync(join(FIX, 'click_120bpm.wav'), soundPath);
});

afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));

describe('biblioteca de efeitos sonoros', () => {
  it('importa por referência, deduplica, persiste direitos e remove sem apagar o original', async () => {
    const platform = nodePlatform(root);
    const library = new SoundLibraryStore(platform);
    await library.load();
    expect(await library.add([join(root, 'sounds')])).toMatchObject({ added: 1, duplicates: 0, skipped: 0, failed: [] });
    const sound = library.library.sounds[0]!;
    expect(sound.path).toBe(soundPath);
    expect(sound.durationUs).toBeGreaterThan(0);

    library.update(sound.id, {
      category: 'impact',
      tags: ['golpe', ' grave '],
      origin: 'Biblioteca de testes',
      license: 'CC BY 4.0',
      attribution: 'Artista',
    });
    expect(await library.add([soundPath])).toMatchObject({ added: 0, duplicates: 1 });
    await library.flush();

    const reopened = new SoundLibraryStore(platform);
    await reopened.load();
    expect(reopened.get(sound.id)).toMatchObject({
      category: 'impact',
      tags: ['golpe', 'grave'],
      origin: 'Biblioteca de testes',
      license: 'CC BY 4.0',
      attribution: 'Artista',
    });

    reopened.remove(sound.id);
    await reopened.flush();
    expect(await platform.fs.exists(soundPath)).toBe(true);
    const empty = new SoundLibraryStore(platform);
    await empty.load();
    expect(empty.library.sounds).toEqual([]);
  });
});
