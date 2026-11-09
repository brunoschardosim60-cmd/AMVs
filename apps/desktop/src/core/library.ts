import { analyzeMusicFile, correctTempoOctave, MUSIC_ANALYSIS_VERSION, setManualTempo, type MusicAnalysis } from '@amv/analysis';
import { cachePaths, hashFile, JobQueue, joinPath, probeFile } from '@amv/media';
import { AUDIO_EXTENSIONS, emptyLibrary, newTrack, parseLibrary, summarize, type Library, type LibraryTrack, type Playlist } from '@amv/music';
import { newId } from '@amv/project';
import type { Platform } from '../platform/types';

const FILE = 'biblioteca-musicas.json';

/**
 * Biblioteca global de músicas (fica fora dos projetos, na pasta de dados do app).
 * Guarda referência aos arquivos — nunca copia. Analisa em segundo plano e
 * reaproveita o mesmo cache da análise dos projetos.
 */
export class MusicLibrary {
  lib: Library = emptyLibrary();
  readonly queue = new JobQueue(1);
  private listeners = new Set<() => void>();
  private version = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private notifyScheduled = false;
  private loaded: Promise<void> | null = null;
  /** Análise completa em memória (para "usar no projeto" e para o detalhe). */
  private full = new Map<string, MusicAnalysis>();

  constructor(private readonly platform: Platform) {
    this.queue.subscribe(() => this.emit());
  }

  /** Estável durante a renderização; só muda quando a UI é avisada. */
  private shown = 0;

  get changes(): number {
    return this.shown;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.version++;
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    setTimeout(() => {
      this.notifyScheduled = false;
      this.shown = this.version;
      for (const l of this.listeners) l();
    }, 0);
  }

  private async file(): Promise<string> {
    return joinPath(await this.platform.dataDir(), FILE);
  }

  load(): Promise<void> {
    this.loaded ??= (async () => {
      const f = await this.file();
      if (await this.platform.fs.exists(f)) this.lib = parseLibrary(new TextDecoder().decode(await this.platform.fs.readFile(f)));
      // confere arquivos sumidos e retoma análises que não terminaram
      for (const t of this.lib.tracks) {
        const exists = await this.platform.fs.exists(t.path).catch(() => false);
        if (!exists) t.status = 'missing';
        else if (t.status === 'missing') t.status = t.summary ? 'ok' : 'analyzing';
        if (exists && !t.summary && t.status !== 'error') this.analyze(t.id);
      }
      this.emit();
    })();
    return this.loaded;
  }

  private changed(): void {
    this.emit();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), 400);
  }

  async flush(): Promise<void> {
    const f = await this.file();
    await this.platform.fs.mkdir(await this.platform.dataDir());
    const tmp = `${f}.tmp`;
    await this.platform.fs.writeFile(tmp, new TextEncoder().encode(JSON.stringify(this.lib)));
    await this.platform.fs.rename(tmp, f);
  }

  track(id: string): LibraryTrack | undefined {
    return this.lib.tracks.find((t) => t.id === id);
  }

  /** Adiciona arquivos e pastas (pastas: procura músicas até 6 níveis). Devolve quantas entraram. */
  async add(paths: string[]): Promise<{ added: number; duplicates: number; skipped: number }> {
    await this.load();
    const files: string[] = [];
    for (const p of paths) {
      const ext = p.split('.').pop()?.toLowerCase() ?? '';
      if (AUDIO_EXTENSIONS.includes(ext)) files.push(p);
      else {
        try {
          files.push(...(await this.platform.listFiles(p, 6)).filter((f) => AUDIO_EXTENSIONS.includes(f.split('.').pop()?.toLowerCase() ?? '')));
        } catch {
          /* não é pasta */
        }
      }
    }
    let added = 0;
    let duplicates = 0;
    let skipped = 0;
    for (const path of files) {
      try {
        const { hash } = await hashFile(this.platform.fs, path);
        const dup = this.lib.tracks.find((t) => t.hash === hash);
        if (dup) {
          if (dup.status === 'missing') {
            dup.path = path;
            dup.status = dup.summary ? 'ok' : 'analyzing';
          }
          duplicates++;
          continue;
        }
        const { probe } = await probeFile(this.platform.runner, path);
        if (!probe.audio.length) {
          skipped++;
          continue;
        }
        const t = newTrack(newId('mus'), path, hash, probe.durationUs / 1e6, probe.tags, new Date().toISOString());
        t.status = 'analyzing';
        this.lib.tracks.push(t);
        added++;
        this.changed();
        this.analyze(t.id);
      } catch {
        skipped++;
      }
    }
    this.changed();
    return { added, duplicates, skipped };
  }

  private async cacheFile(hash: string): Promise<string> {
    const root = await this.platform.cacheDir();
    return joinPath(cachePaths(root, hash, joinPath).dir, `analysis-${MUSIC_ANALYSIS_VERSION}.json`);
  }

  /** Análise completa (do cache ou rodando de novo). */
  async analysis(id: string): Promise<MusicAnalysis | null> {
    const t = this.track(id);
    if (!t) return null;
    const mem = this.full.get(t.hash);
    if (mem) return mem;
    const file = await this.cacheFile(t.hash);
    if (await this.platform.fs.exists(file)) {
      try {
        const a = JSON.parse(new TextDecoder().decode(await this.platform.fs.readFile(file))) as MusicAnalysis;
        this.full.set(t.hash, a);
        return a;
      } catch {
        /* cache estragado: analisa de novo */
      }
    }
    return null;
  }

  async correctTempo(id: string, direction: 'double' | 'half'): Promise<void> {
    const t = this.track(id);
    if (!t) throw new Error('música não encontrada na biblioteca');
    const current = await this.analysis(id);
    if (!current) throw new Error('a análise da música ainda não está disponível');
    await this.saveCorrectedAnalysis(t.hash, correctTempoOctave(current, direction));
  }

  async setManualTempo(id: string, bpm: number, anchorS: number): Promise<void> {
    const t = this.track(id);
    if (!t) throw new Error('música não encontrada na biblioteca');
    const current = await this.analysis(id);
    if (!current) throw new Error('a análise da música ainda não está disponível');
    await this.saveCorrectedAnalysis(t.hash, setManualTempo(current, bpm, anchorS));
  }

  private async saveCorrectedAnalysis(hash: string, analysis: MusicAnalysis): Promise<void> {
    const file = await this.cacheFile(hash);
    const dir = file.slice(0, Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')));
    await this.platform.fs.mkdir(dir);
    const tmp = `${file}.tmp`;
    await this.platform.fs.writeFile(tmp, new TextEncoder().encode(JSON.stringify(analysis)));
    await this.platform.fs.rename(tmp, file);
    this.full.set(hash, analysis);
    for (const t of this.lib.tracks) if (t.hash === hash) t.summary = summarize(analysis);
    this.changed();
  }

  analyze(id: string): void {
    const t = this.track(id);
    if (!t) return;
    void (async () => {
      try {
        let a = await this.analysis(id);
        if (!a) {
          const file = await this.cacheFile(t.hash);
          a = await this.queue.enqueue({
            key: `lib-analysis:${t.hash}`,
            kind: 'analysis',
            label: `Analisando ${t.name}`,
            run: ({ signal, report }) => analyzeMusicFile(this.platform.runner, t.path, t.durationS, (f, d) => report(f, d), signal),
          }).promise;
          await this.platform.fs.mkdir(file.slice(0, Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))));
          await this.platform.fs.writeFile(file, new TextEncoder().encode(JSON.stringify(a)));
          this.full.set(t.hash, a);
        }
        t.summary = summarize(a);
        t.status = 'ok';
        t.error = null;
      } catch (e) {
        t.status = 'error';
        t.error = (e as Error).message;
      }
      this.changed();
    })();
  }

  update(ids: string[], patch: Partial<Pick<LibraryTrack, 'favorite' | 'rating' | 'tags' | 'emotion' | 'notes' | 'genre' | 'title' | 'artist'>>): void {
    for (const t of this.lib.tracks) if (ids.includes(t.id)) Object.assign(t, patch);
    this.changed();
  }

  remove(ids: string[]): void {
    this.lib.tracks = this.lib.tracks.filter((t) => !ids.includes(t.id));
    for (const p of this.lib.playlists) p.trackIds = p.trackIds.filter((x) => !ids.includes(x));
    this.changed();
  }

  played(id: string): void {
    const t = this.track(id);
    if (!t) return;
    t.playCount++;
    t.lastPlayedAt = new Date().toISOString();
    this.changed();
  }

  markUsed(id: string, projectName: string): void {
    const t = this.track(id);
    if (t && !t.usedIn.includes(projectName)) {
      t.usedIn.push(projectName);
      this.changed();
    }
  }

  createPlaylist(name: string, trackIds: string[] = []): Playlist {
    const p: Playlist = { id: newId('pl'), name: name.trim() || 'Nova playlist', trackIds: [...new Set(trackIds)], createdAt: new Date().toISOString() };
    this.lib.playlists.push(p);
    this.changed();
    return p;
  }

  renamePlaylist(id: string, name: string): void {
    const p = this.lib.playlists.find((x) => x.id === id);
    if (p && name.trim()) p.name = name.trim();
    this.changed();
  }

  deletePlaylist(id: string): void {
    this.lib.playlists = this.lib.playlists.filter((p) => p.id !== id);
    this.changed();
  }

  addToPlaylist(id: string, trackIds: string[]): void {
    const p = this.lib.playlists.find((x) => x.id === id);
    if (!p) return;
    for (const t of trackIds) if (!p.trackIds.includes(t)) p.trackIds.push(t);
    this.changed();
  }

  removeFromPlaylist(id: string, trackIds: string[]): void {
    const p = this.lib.playlists.find((x) => x.id === id);
    if (!p) return;
    p.trackIds = p.trackIds.filter((t) => !trackIds.includes(t));
    this.changed();
  }
}
