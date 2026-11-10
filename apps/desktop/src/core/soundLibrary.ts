import { AUDIO_EXTENSIONS } from '@amv/music';
import { hashFile, inspectFile, JobQueue, joinPath } from '@amv/media';
import { newId } from '@amv/project';
import { emptySoundLibrary, parseSoundLibrary, type SoundCategory, type SoundEntry, type SoundLibrary } from '@amv/sound-design';
import { reportError } from './errors';
import type { Platform } from '../platform/types';

const FILE = 'biblioteca-sons.json';

export class SoundLibraryStore {
  library: SoundLibrary = emptySoundLibrary();
  private listeners = new Set<() => void>();
  private revision = 0;
  private shown = 0;
  private loaded: Promise<void> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private notifyScheduled = false;
  private readonly queue = new JobQueue(1);

  constructor(private readonly platform: Platform) {}

  get changes(): number { return this.shown; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.revision++;
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    setTimeout(() => {
      this.notifyScheduled = false;
      this.shown = this.revision;
      for (const listener of this.listeners) listener();
    }, 0);
  }

  private async file(): Promise<string> {
    return joinPath(await this.platform.dataDir(), FILE);
  }

  load(): Promise<void> {
    this.loaded ??= (async () => {
      const path = await this.file();
      if (await this.platform.fs.exists(path)) {
        this.library = parseSoundLibrary(new TextDecoder().decode(await this.platform.fs.readFile(path)));
      }
      this.emit();
    })();
    return this.loaded;
  }

  private changed(): void {
    this.emit();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.flush().catch((error: unknown) => reportError('gravação da biblioteca de efeitos sonoros', error));
    }, 400);
  }

  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const path = await this.file();
    await this.platform.fs.mkdir(await this.platform.dataDir());
    const temporary = `${path}.tmp`;
    await this.platform.fs.writeFile(temporary, new TextEncoder().encode(JSON.stringify(this.library)));
    await this.platform.fs.rename(temporary, path);
  }

  async add(paths: string[]): Promise<{ added: number; duplicates: number; skipped: number; failed: { path: string; reason: string }[] }> {
    await this.load();
    const candidates: string[] = [];
    const failed: { path: string; reason: string }[] = [];
    let skipped = 0;
    for (const path of paths) {
      const ext = path.split('.').pop()?.toLowerCase() ?? '';
      if (AUDIO_EXTENSIONS.includes(ext)) candidates.push(path);
      else {
        try {
          const files = await this.platform.listFiles(path, 6);
          const audioFiles = files.filter((file) => AUDIO_EXTENSIONS.includes(file.split('.').pop()?.toLowerCase() ?? ''));
          candidates.push(...audioFiles);
          if (!audioFiles.length) skipped++;
        } catch (error) {
          failed.push({ path, reason: (error as Error).message });
        }
      }
    }

    let added = 0;
    let duplicates = 0;
    const hashes = new Set(this.library.sounds.map((sound) => sound.hash));
    for (const path of candidates) {
      try {
        const { hash } = await hashFile(this.platform.fs, path);
        const duplicate = this.library.sounds.find((sound) => sound.hash === hash);
        if (hashes.has(hash)) {
          if (duplicate && duplicate.path !== path && !(await this.platform.fs.exists(duplicate.path))) duplicate.path = path;
          duplicates++;
          continue;
        }
        const { asset } = await inspectFile({ runner: this.platform.runner, fs: this.platform.fs, queue: this.queue, cacheRoot: await this.platform.cacheDir() }, path);
        if (asset.kind !== 'audio' || !asset.probe?.audio.length) {
          skipped++;
          continue;
        }
        const name = asset.name;
        const sound: SoundEntry = {
          id: newId('snd'),
          path,
          hash,
          name,
          durationUs: asset.probe.durationUs,
          category: 'other',
          tags: [],
          origin: path,
          license: '',
          attribution: '',
          notes: '',
          addedAt: new Date().toISOString(),
        };
        this.library.sounds.push(sound);
        hashes.add(hash);
        added++;
        this.changed();
      } catch (error) {
        failed.push({ path, reason: (error as Error).message });
      }
    }
    if (added || duplicates) this.changed();
    return { added, duplicates, skipped, failed };
  }

  update(id: string, patch: Partial<Pick<SoundEntry, 'name' | 'category' | 'tags' | 'origin' | 'license' | 'attribution' | 'notes'>>): void {
    const sound = this.library.sounds.find((item) => item.id === id);
    if (!sound) throw new Error('efeito sonoro não encontrado');
    if (patch.category && !['whoosh', 'impact', 'explosion', 'riser', 'hit', 'ambience', 'transition', 'silence', 'other'].includes(patch.category)) {
      throw new Error('categoria de efeito sonoro inválida');
    }
    Object.assign(sound, patch, patch.tags ? { tags: patch.tags.map((tag) => tag.trim()).filter(Boolean) } : {});
    this.changed();
  }

  remove(id: string): void {
    this.library.sounds = this.library.sounds.filter((sound) => sound.id !== id);
    this.changed();
  }

  get(id: string): SoundEntry | undefined {
    return this.library.sounds.find((sound) => sound.id === id);
  }
}

export type { SoundCategory };
