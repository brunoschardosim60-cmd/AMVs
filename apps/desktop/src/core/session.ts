import {
  cachePaths,
  joinPath,
  hashFile,
  inspectFile,
  isImportable,
  JobQueue,
  prepareArtifacts,
  baseName,
  type MediaArtifacts,
  type MediaEnv,
} from '@amv/media';
import {
  isSfxAsset,
  newId,
  SFX_TAG,
  createProject,
  matchMissingAssets,
  parseProject,
  projectDurationUs,
  ProjectHistory,
  serializeProject,
  insertAsset,
  type Asset,
  type Command,
  type Project,
  type ProjectSettings,
} from '@amv/project';
import type { Platform } from '../platform/types';
import { analyzeEpisodeFile, analyzeLocalVisualFrames, analyzeMusicFile, EPISODE_ANALYSIS_VERSION, findSimilarVisualScenes, grabFrameJpeg, grabFrameRgb, LOCAL_VISION_VERSION, mergeShotVision, MUSIC_ANALYSIS_VERSION, selectLocalVisionTargets, selectVisionTargets, shotKey, toBase64, VISION_VERSION, type EpisodeAnalysis, type EpisodeVision, type MusicAnalysis, type VisionScope } from '@amv/analysis';
import { labelScenes, type FetchLike, type ProviderConfig, type SceneAnalysisContext, type SceneLyricMatch } from '@amv/assistant';
import { renderSfx, SFX_KINDS, SFX_LABEL, sfxFileName, toWav, type SfxKind } from '@amv/sfx';
import { forgetRecent, rememberRecent, updateRecent } from './recents';

export const PROJECT_EXTENSION = 'amvproj';

export interface AssetRuntime {
  artifacts: MediaArtifacts | null;
  warnings: string[];
  errors: string[];
  /** Análise da música (áudios). */
  music?: MusicAnalysis | null;
  /** Análise do episódio (vídeos): planos, falas, legendas. */
  episode?: EpisodeAnalysis | null;
  /** Quem aparece em cada cena (análise com IA com visão), se foi rodada. */
  vision?: EpisodeVision | null;
  analysis?: 'pending' | 'running' | 'done' | 'error';
  analysisError?: string;
}

export interface ImportReport {
  imported: string[];
  skipped: { path: string; reason: string }[];
  failed: { path: string; reason: string }[];
}

export type OpenResult =
  | { ok: true; recovered: boolean; missing: number }
  | { ok: false; error: string; details: string[] };

type Listener = () => void;

export interface ProjectBackup {
  path: string;
  createdAt: string;
  sizeBytes: number;
  valid: boolean;
}

export interface ProjectDependencyReport {
  missingAssets: { id: string; path: string }[];
  missingVersions: { id: string; path: string }[];
  invalidVersions: { id: string; path: string; error: string }[];
  invalidReferences: { clipId: string; reference: string }[];
  mediaUsage: { assetId: string; path: string; clipIds: string[]; missing: boolean }[];
  valid: boolean;
}

/**
 * Sessão de um projeto aberto: histórico, arquivo em disco, artefatos de mídia,
 * autosave e relocalização. Não conhece React; a UI só assina mudanças.
 */
export class ProjectSession {
  readonly history: ProjectHistory;
  readonly queue: JobQueue;
  path: string;
  private runtime = new Map<string, AssetRuntime>();
  private listeners = new Set<Listener>();
  private env: MediaEnv | null = null;
  private lastAutosaveRevision = -1;
  private disposed = false;
  private persistence: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly platform: Platform,
    project: Project,
    path: string,
    queue?: JobQueue,
  ) {
    this.history = new ProjectHistory(project);
    this.queue = queue ?? new JobQueue(2);
    this.path = path;
    this.history.subscribe(() => this.emit());
    this.queue.subscribe(() => this.emit());
  }

  // ---------- criação e abertura ----------

  static async create(
    platform: Platform,
    path: string,
    name: string,
    settings: Partial<ProjectSettings>,
  ): Promise<ProjectSession> {
    const finalPath = withExtension(path);
    const s = new ProjectSession(platform, createProject({ name, settings }), finalPath);
    await s.save();
    return s;
  }

  /**
   * Abre um projeto. Se houver autosave mais novo que o arquivo, usa o autosave
   * quando `preferAutosave` for true (a UI pergunta antes).
   */
  static async open(
    platform: Platform,
    path: string,
    preferAutosave = false,
  ): Promise<{ session: ProjectSession | null; result: OpenResult }> {
    try {
      await recoverAtomicFile(platform, path);
      await recoverAtomicFile(platform, autosavePath(path));
    } catch (error) {
      return { session: null, result: { ok: false, error: 'não foi possível recuperar a gravação interrompida', details: [String(error)] } };
    }
    const readText = async (p: string) => new TextDecoder().decode(await platform.fs.readFile(p));
    if (!(await platform.fs.exists(path))) {
      return { session: null, result: { ok: false, error: 'o arquivo do projeto não existe mais', details: [path] } };
    }
    let recovered = false;
    let text = await readText(path);
    const auto = autosavePath(path);
    if (preferAutosave && (await platform.fs.exists(auto))) {
      const autoText = await readText(auto);
      if (parseProject(autoText).ok) {
        text = autoText;
        recovered = true;
      }
    }
    const parsed = parseProject(text);
    if (!parsed.ok) return { session: null, result: { ok: false, error: parsed.error, details: parsed.details } };

    const s = new ProjectSession(platform, parsed.project, path);
    const missing = await s.checkAssets();
    // projeto recuperado ainda não está salvo no arquivo principal
    if (recovered) s.history.markUnsaved();
    await s.touchRecent();
    return { session: s, result: { ok: true, recovered, missing } };
  }

  /** Existe autosave mais recente que o arquivo salvo? */
  static async hasRecovery(platform: Platform, path: string): Promise<boolean> {
    await recoverAtomicFile(platform, path);
    await recoverAtomicFile(platform, autosavePath(path));
    const auto = autosavePath(path);
    if (!(await platform.fs.exists(auto))) return false;
    try {
      const a = parseProject(new TextDecoder().decode(await platform.fs.readFile(auto)));
      const m = parseProject(new TextDecoder().decode(await platform.fs.readFile(path)));
      if (!a.ok) return false;
      if (!m.ok) return true;
      return a.project.updatedAt > m.project.updatedAt;
    } catch {
      return false;
    }
  }

  // ---------- estado ----------

  get project(): Project {
    return this.history.project;
  }

  get dirty(): boolean {
    return this.history.dirty;
  }

  assetRuntime(id: string): AssetRuntime {
    return this.runtime.get(id) ?? { artifacts: null, warnings: [], errors: [] };
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private changeCount = 0;

  /** Incrementa a cada mudança (projeto, fila de jobs, artefatos). A UI usa para re-renderizar. */
  /** Só muda quando a UI é avisada: estável durante a renderização (senão o React entra em loop). */
  private shownCount = 0;

  get changes(): number {
    return this.shownCount;
  }

  private notifyScheduled = false;

  /** Agrupa avisos à UI: muitas mudanças seguidas viram um só re-render (evita loop de update no React). */
  private emit(): void {
    this.changeCount++;
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    setTimeout(() => {
      this.notifyScheduled = false;
      this.shownCount = this.changeCount;
      for (const l of this.listeners) l();
    }, 0);
  }

  execute(command: Command, label?: string): void {
    const before = new Map(this.project.assets.map((asset) => [asset.id, asset.path]));
    this.history.execute(command, label);
    this.afterChange(before);
  }

  undo(): void {
    const before = new Map(this.project.assets.map((asset) => [asset.id, asset.path]));
    this.history.undo();
    this.afterChange(before);
  }

  redo(): void {
    const before = new Map(this.project.assets.map((asset) => [asset.id, asset.path]));
    this.history.redo();
    this.afterChange(before);
  }

  /** Cancela jobs de mídias que saíram do projeto e reprocessa as que voltaram (undo). */
  private afterChange(before: Map<string, string>): void {
    const now = new Map(this.project.assets.map((asset) => [asset.id, asset.path]));
    for (const id of before.keys()) if (!now.has(id)) {
      this.queue.cancelAsset(id);
      this.runtime.delete(id);
    }
    for (const a of this.project.assets) {
      if ((!before.has(a.id) || before.get(a.id) !== a.path) && a.status !== 'missing') {
        this.queue.cancelAsset(a.id);
        this.runtime.delete(a.id);
        void this.process(a);
      }
    }
  }

  // ---------- salvar ----------

  async save(): Promise<void> {
    await this.enqueuePersistence(async () => {
      if (!this.dirty && await this.platform.fs.exists(this.path)) {
        const auto = autosavePath(this.path);
        if (await this.platform.fs.exists(auto)) await this.platform.fs.remove(auto);
        await this.touchRecent();
        return;
      }
      const revision = this.history.version;
      const text = serializeProject({ ...this.project, updatedAt: new Date().toISOString() });
      await this.backupCurrentFile(this.path);
      await writeAtomic(this.platform, this.path, text);
      this.history.markSaved(revision);
      if (this.history.version === revision) {
        const auto = autosavePath(this.path);
        if (await this.platform.fs.exists(auto)) await this.platform.fs.remove(auto);
      }
      await this.pruneBackups(this.path);
      await this.touchRecent();
      this.emit();
    });
  }

  async saveAs(path: string): Promise<void> {
    const target = withExtension(path);
    await this.enqueuePersistence(async () => {
      const revision = this.history.version;
      const text = serializeProject({ ...this.project, updatedAt: new Date().toISOString() });
      await this.backupCurrentFile(target);
      await writeAtomic(this.platform, target, text);
      this.path = target;
      this.history.markSaved(revision);
      const auto = autosavePath(target);
      if (this.history.version === revision && await this.platform.fs.exists(auto)) await this.platform.fs.remove(auto);
      await this.pruneBackups(target);
      await this.touchRecent();
      this.emit();
    });
  }

  /** Grava `<projeto>.autosave` se houve mudança desde o último autosave. */
  async autosave(): Promise<boolean> {
    return this.enqueuePersistence(async () => {
      const revision = this.history.version;
      if (!this.dirty || revision === this.lastAutosaveRevision) return false;
      const target = autosavePath(this.path);
      const text = serializeProject({ ...this.project, updatedAt: new Date().toISOString() });
      await writeAtomic(this.platform, target, text);
      this.lastAutosaveRevision = revision;
      return true;
    });
  }

  private enqueuePersistence<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.persistence.then(operation, operation);
    this.persistence = result.then(() => undefined, () => undefined);
    return result;
  }

  private async backupCurrentFile(path: string): Promise<void> {
    if (!(await this.platform.fs.exists(path))) return;
    const dir = backupsPath(path);
    await this.platform.fs.mkdir(dir);
    const bytes = await this.platform.fs.readFile(path);
    const backup = joinPath(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${newId('backup')}.amvproj`);
    await writeAtomicBytes(this.platform, backup, bytes);
  }

  private async pruneBackups(path: string, limit = 10): Promise<void> {
    const dir = backupsPath(path);
    if (!(await this.platform.fs.exists(dir))) return;
    const files = (await this.platform.fs.readDir(dir))
      .filter((name) => name.toLowerCase().endsWith('.amvproj'))
      .sort()
      .reverse();
    for (const name of files.slice(limit)) await this.platform.fs.remove(joinPath(dir, name));
  }

  async listBackups(): Promise<ProjectBackup[]> {
    const dir = backupsPath(this.path);
    if (!(await this.platform.fs.exists(dir))) return [];
    const names = (await this.platform.fs.readDir(dir))
      .filter((name) => name.toLowerCase().endsWith('.amvproj'))
      .sort()
      .reverse();
    const backups: ProjectBackup[] = [];
    for (const name of names) {
      const path = joinPath(dir, name);
      const text = new TextDecoder().decode(await this.platform.fs.readFile(path));
      const parsed = parseProject(text);
      const statSize = await this.platform.fs.size(path);
      const stamp = name.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/)?.[1]
        ?.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z');
      backups.push({
        path,
        createdAt: stamp && Number.isFinite(Date.parse(stamp)) ? new Date(stamp).toISOString() : new Date(0).toISOString(),
        sizeBytes: statSize,
        valid: parsed.ok,
      });
    }
    return backups;
  }

  async restoreBackup(path: string): Promise<void> {
    const backups = await this.listBackups();
    const backup = backups.find((item) => item.path === path && item.valid);
    if (!backup) throw new Error('backup não encontrado ou inválido');
    const parsed = parseProject(new TextDecoder().decode(await this.platform.fs.readFile(path)));
    if (!parsed.ok) throw new Error(`backup inválido: ${parsed.error}`);
    await this.backupCurrentFile(this.path);
    for (const asset of this.project.assets) this.queue.cancelAsset(asset.id);
    this.runtime.clear();
    const previous = new Map(this.project.assets.map((asset) => [asset.id, asset.path]));
    this.history.execute(
      { type: 'project.replace', project: { ...parsed.project, id: this.project.id } },
      'Restaurar backup',
    );
    this.afterChange(previous);
    await this.checkAssets();
    this.emit();
  }

  async validateDependencies(): Promise<ProjectDependencyReport> {
    const assetIds = new Set(this.project.assets.map((asset) => asset.id));
    const trackIds = new Set(this.project.tracks.map((track) => track.id));
    const missingAssets: ProjectDependencyReport['missingAssets'] = [];
    const mediaUsage: ProjectDependencyReport['mediaUsage'] = [];
    const invalidReferences: ProjectDependencyReport['invalidReferences'] = [];
    for (const asset of this.project.assets) {
      const missing = !(await this.platform.fs.exists(asset.path));
      if (missing) missingAssets.push({ id: asset.id, path: asset.path });
      mediaUsage.push({
        assetId: asset.id,
        path: asset.path,
        clipIds: this.project.clips.filter((clip) => clip.assetId === asset.id).map((clip) => clip.id),
        missing,
      });
    }
    for (const clip of this.project.clips) {
      if (!trackIds.has(clip.trackId)) invalidReferences.push({ clipId: clip.id, reference: `trilha ${clip.trackId}` });
      if (clip.assetId && !assetIds.has(clip.assetId)) invalidReferences.push({ clipId: clip.id, reference: `mídia ${clip.assetId}` });
    }
    const missingVersions: ProjectDependencyReport['missingVersions'] = [];
    const invalidVersions: ProjectDependencyReport['invalidVersions'] = [];
    for (const version of this.project.versions) {
      if (!(await this.platform.fs.exists(version.file))) {
        missingVersions.push({ id: version.id, path: version.file });
        continue;
      }
      const parsed = parseProject(new TextDecoder().decode(await this.platform.fs.readFile(version.file)));
      if (!parsed.ok) invalidVersions.push({ id: version.id, path: version.file, error: parsed.error });
    }
    return {
      missingAssets,
      missingVersions,
      invalidVersions,
      invalidReferences,
      mediaUsage,
      valid: !missingAssets.length && !missingVersions.length && !invalidVersions.length && !invalidReferences.length,
    };
  }

  async duplicateTo(path: string, name = `${this.project.name} (cópia)`): Promise<ProjectSession> {
    if (this.dirty) await this.save();
    const target = withExtension(path);
    const duplicate = await copyProjectTo(this.platform, this.project, this.path, target, name, newId('project'));
    const session = new ProjectSession(this.platform, duplicate, target);
    await session.checkAssets();
    await session.touchRecent();
    return session;
  }

  async archiveTo(path: string): Promise<void> {
    await this.save();
    const source = this.path;
    const target = withExtension(path);
    if (source.toLowerCase() === target.toLowerCase()) throw new Error('escolha um destino diferente para arquivar o projeto');
    const archived = await copyProjectTo(this.platform, this.project, source, target, this.project.name, this.project.id);
    this.path = target;
    this.history.reset(archived);
    const cleanupPaths = [source, `${source}.versoes`, backupsPath(source), autosavePath(source)];
    for (const oldPath of cleanupPaths) {
      if (await this.platform.fs.exists(oldPath)) await this.platform.fs.remove(oldPath);
    }
    await forgetRecent(this.platform, source);
    await this.touchRecent();
    this.emit();
  }

  private async touchRecent(): Promise<void> {
    const firstVideo = this.project.assets.find((a) => a.kind === 'video' && this.runtime.get(a.id)?.artifacts?.posterPath);
    await rememberRecent(this.platform, {
      path: this.path,
      name: this.project.name,
      openedAt: new Date().toISOString(),
      durationUs: projectDurationUs(this.project),
      assetCount: this.project.assets.length,
      posterPath: firstVideo ? this.runtime.get(firstVideo.id)!.artifacts!.posterPath : null,
    }).catch(() => undefined);
  }

  // ---------- mídia ----------

  private async mediaEnv(): Promise<MediaEnv> {
    if (!this.env) {
      this.env = { runner: this.platform.runner, fs: this.platform.fs, queue: this.queue, cacheRoot: await this.platform.cacheDir() };
    }
    return this.env;
  }

  /** Importa arquivos. Um arquivo com problema não impede os outros. */
  async importFiles(paths: string[]): Promise<ImportReport> {
    const report: ImportReport = { imported: [], skipped: [], failed: [] };
    const env = await this.mediaEnv();
    const known = new Map(this.project.assets.map((a) => [a.hash, a.name]));
    const added: Asset[] = [];

    await Promise.all(
      paths.map(async (path) => {
        if (!isImportable(path)) {
          report.skipped.push({ path, reason: 'formato não suportado' });
          return;
        }
        try {
          const { asset, warnings } = await inspectFile(env, path);
          const dup = known.get(asset.hash) ?? added.find((a) => a.hash === asset.hash)?.name;
          if (dup) {
            report.skipped.push({ path, reason: `já está no projeto como ${dup}` });
            return;
          }
          added.push(asset);
          this.runtime.set(asset.id, { artifacts: null, warnings, errors: [] });
        } catch (e) {
          report.failed.push({ path, reason: (e as Error).message });
        }
      }),
    );

    if (added.length) {
      // ordem estável: a mesma em que o usuário escolheu
      added.sort((a, b) => paths.indexOf(a.path) - paths.indexOf(b.path));
      this.history.transaction(
        added.length === 1 ? `Importar ${added[0]!.name}` : `Importar ${added.length} arquivos`,
        added.map((asset) => ({ type: 'asset.add', asset })),
      );
      report.imported = added.map((a) => a.path);
      for (const a of added) void this.process(a);
    }
    this.emit();
    return report;
  }

  /** Importa ou reutiliza um som e o coloca na trilha de efeitos numa única ação de undo. */
  async addSoundToTimeline(options: {
    path: string;
    name: string;
    rights: NonNullable<Asset['rights']>;
    startUs: number;
  }): Promise<string> {
    const { asset: inspected } = await inspectFile(await this.mediaEnv(), options.path);
    if (inspected.kind !== 'audio' || !inspected.probe?.audio.length) {
      throw new Error('o arquivo selecionado não contém áudio');
    }

    const existing = this.project.assets.find((asset) => asset.hash === inspected.hash);
    const asset: Asset = existing
      ? {
          ...existing,
          ...(existing.status === 'missing' ? {
            path: inspected.path,
            probe: inspected.probe,
            status: inspected.status,
            error: inspected.error,
          } : {}),
          rights: {
            origin: options.rights.origin || existing.rights?.origin || options.path,
            license: options.rights.license || existing.rights?.license || '',
            attribution: options.rights.attribution || existing.rights?.attribution || '',
          },
        }
      : { ...inspected, name: options.name, rights: { ...options.rights, origin: options.rights.origin || options.path } };

    let track = this.project.tracks.find((item) => item.kind === 'audio' && item.role === 'sfx');
    const commands: Command[] = [];
    if (!existing) commands.push({ type: 'asset.add', asset });
    else if (JSON.stringify(existing.rights ?? {}) !== JSON.stringify(asset.rights ?? {}) || existing.status === 'missing') {
      commands.push({
        type: 'asset.update',
        assetId: existing.id,
        patch: { rights: asset.rights, ...(existing.status === 'missing' ? { path: asset.path, probe: asset.probe, status: asset.status, error: asset.error } : {}) },
      });
    }
    if (!track) {
      track = {
        id: newId('trk'),
        kind: 'audio',
        name: 'Efeitos sonoros',
        role: 'sfx',
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
        gainDb: 0,
      };
      commands.push({ type: 'track.add', track });
    }
    if (track.locked) throw new Error(`a trilha "${track.name}" está travada`);

    const stagedProject: Project = {
      ...this.project,
      assets: existing
        ? this.project.assets.map((item) => item.id === existing.id ? asset : item)
        : [...this.project.assets, asset],
      tracks: this.project.tracks.some((item) => item.id === track.id) ? this.project.tracks : [...this.project.tracks, track],
    };
    const clipCommand = insertAsset(stagedProject, {
      assetId: asset.id,
      trackId: track.id,
      startUs: Math.max(0, Math.round(options.startUs)),
    }).find((command) => command.type === 'clip.add');
    if (!clipCommand || clipCommand.type !== 'clip.add') throw new Error('não foi possível criar o clipe de áudio');
    commands.push(clipCommand);

    this.history.transaction(`Adicionar ${options.name} à timeline`, commands);
    if (!existing || existing.status === 'missing') {
      this.runtime.set(asset.id, { artifacts: null, warnings: [], errors: [] });
      void this.process(asset);
    }
    this.emit();
    return clipCommand.clip.id;
  }


  /**
   * Garante os efeitos sonoros do app (impacto, golpe, whoosh, subida) no projeto: grava os WAV
   * uma vez na pasta de dados e os registra como mídia com a tag `sfx` (fora das listas do usuário).
   * Devolve o id do asset de cada efeito.
   */
  async ensureSfx(): Promise<Partial<Record<SfxKind, string>>> {
    const dir = joinPath(await this.platform.dataDir(), 'sfx');
    await this.platform.fs.mkdir(dir);
    const env = await this.mediaEnv();
    const ids: Partial<Record<SfxKind, string>> = {};
    const added: Asset[] = [];
    for (const kind of SFX_KINDS) {
      const path = joinPath(dir, sfxFileName(kind));
      const have = this.project.assets.find((a) => isSfxAsset(a) && a.path === path);
      if (have) {
        ids[kind] = have.id;
        continue;
      }
      if (!(await this.platform.fs.exists(path))) await this.platform.fs.writeFile(path, toWav(renderSfx(kind)));
      const { asset } = await inspectFile(env, path);
      const a: Asset = { ...asset, name: `Efeito: ${SFX_LABEL[kind]}`, tags: [...asset.tags, SFX_TAG] };
      this.runtime.set(a.id, { artifacts: null, warnings: [], errors: [] });
      ids[kind] = a.id;
      added.push(a);
    }
    if (added.length) {
      this.history.transaction('Adicionar efeitos sonoros', added.map((asset) => ({ type: 'asset.add' as const, asset })));
      for (const a of added) void this.process(a);
      this.emit();
    }
    return ids;
  }


  // ---------------------------------------------------------------- visão (IA) por cena

  private async visionFile(asset: Asset): Promise<string> {
    const env = await this.mediaEnv();
    return joinPath(cachePaths(env.cacheRoot, asset.hash, joinPath).dir, `vision-${VISION_VERSION}.json`);
  }

  /** Carrega do cache a visão já feita de um episódio (se houver). */
  async loadVision(assetId: string): Promise<EpisodeVision | null> {
    const asset = this.project.assets.find((a) => a.id === assetId);
    if (!asset) return null;
    const rt = this.assetRuntime(assetId);
    if (rt.vision !== undefined) return rt.vision;
    let v: EpisodeVision | null = null;
    try {
      const f = await this.visionFile(asset);
      if (await this.platform.fs.exists(f)) v = JSON.parse(new TextDecoder().decode(await this.platform.fs.readFile(f))) as EpisodeVision;
    } catch {
      v = null; // arquivo ilegível: refaz quando pedir
    }
    this.runtime.set(assetId, { ...this.assetRuntime(assetId), vision: v });
    this.emit();
    return v;
  }

  /** Recarrega do cache uma correção de BPM feita na biblioteca global de músicas. */
  async refreshMusicAnalysis(assetId: string): Promise<void> {
    const asset = this.project.assets.find((a) => a.id === assetId && a.kind === 'audio');
    if (!asset) throw new Error('faixa de música não encontrada no projeto');
    const env = await this.mediaEnv();
    const file = joinPath(cachePaths(env.cacheRoot, asset.hash, joinPath).dir, `analysis-${MUSIC_ANALYSIS_VERSION}.json`);
    if (!(await this.platform.fs.exists(file))) throw new Error('análise da música não encontrada no cache');
    const music = JSON.parse(new TextDecoder().decode(await this.platform.fs.readFile(file))) as MusicAnalysis;
    this.runtime.set(assetId, { ...this.assetRuntime(assetId), music, analysis: 'done' });
    this.emit();
  }

  /** Cenas sem rótulo; `includeLabeled` permite reanalisar explicitamente para cruzar letras. */
  visionTargets(assetId: string, scope: VisionScope = 'fights', max = scope === 'all' ? Infinity : 120, includeLabeled = false): { startS: number; endS: number; midS: number }[] {
    const ep = this.assetRuntime(assetId).episode;
    if (!ep) return [];
    return selectVisionTargets(ep, includeLabeled ? {} : this.assetRuntime(assetId).vision?.shots ?? {}, scope, max);
  }

  localVisionTargets(assetId: string, scope: VisionScope = 'fights', max = scope === 'all' ? Infinity : 120): { startS: number; endS: number; midS: number; samples: number[] }[] {
    const ep = this.assetRuntime(assetId).episode;
    if (!ep) return [];
    return selectLocalVisionTargets(ep, this.assetRuntime(assetId).vision?.shots ?? {}, scope, max);
  }

  /** Extrai amostras locais por cena e persiste os descritores sem exigir modelo externo. */
  async runLocalVision(
    assetId: string,
    o: { scope?: VisionScope; max?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
  ): Promise<{ analyzed: number; failed: number; frameFailures: number }> {
    const asset = this.project.assets.find((item) => item.id === assetId && item.kind === 'video');
    if (!asset) throw new Error('episódio não encontrado');
    const prior = await this.loadVision(assetId);
    const scope = o.scope ?? 'fights';
    const targets = this.localVisionTargets(assetId, scope, o.max ?? (scope === 'all' ? Infinity : 120));
    if (!targets.length) return { analyzed: 0, failed: 0, frameFailures: 0 };
    const env = await this.mediaEnv();
    const source = this.assetRuntime(assetId).artifacts?.proxyPath ?? asset.path;
    const vision: EpisodeVision = {
      version: VISION_VERSION,
      model: prior?.model ?? `local-visual-v${LOCAL_VISION_VERSION}`,
      localModel: `local-visual-v${LOCAL_VISION_VERSION}`,
      shots: { ...(prior?.shots ?? {}) },
    };
    const analysis = this.assetRuntime(assetId).episode!;
    let analyzed = 0;
    let failed = 0;
    let frameFailures = 0;

    for (let index = 0; index < targets.length; index++) {
      if (o.signal?.aborted) throw Object.assign(new Error('análise cancelada'), { name: 'AbortError' });
      const target = targets[index]!;
      const key = shotKey(target.startS);
      const shot = analysis.shots.find((item) => shotKey(item.startS) === key);
      if (!shot) continue;
      const frames = [];
      const frameTimes: number[] = [];
      for (const timeS of target.samples) {
        try {
          frames.push(await grabFrameRgb(env.runner, source, timeS, 160, o.signal));
          frameTimes.push(timeS);
        } catch (error) {
          if (o.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
          frameFailures++;
        }
      }
      if (!frames.length) {
        failed++;
        o.onProgress?.(index + 1, targets.length);
        continue;
      }
      const position = analysis.shots.indexOf(shot);
      const hasDialogue = analysis.speech.some((speech) => speech.endS > shot.startS && speech.startS < shot.endS)
        || analysis.subtitles.some((cue) => cue.endS > shot.startS && cue.startS < shot.endS);
      const local = analyzeLocalVisualFrames(frames, shot, {
        dialogue: hasDialogue,
        previousMotion: analysis.shots[position - 1]?.motion,
        nextMotion: analysis.shots[position + 1]?.motion,
      }, frameTimes);
      vision.shots[key] = { ...(vision.shots[key] ?? { characters: [], fight: false, note: '' }), ...local };
      analyzed++;

      await this.platform.fs.writeFile(await this.visionFile(asset), new TextEncoder().encode(JSON.stringify(vision)));
      this.runtime.set(assetId, { ...this.assetRuntime(assetId), vision: { ...vision, shots: { ...vision.shots } } });
      this.emit();
      o.onProgress?.(index + 1, targets.length);
    }
    if (analyzed) {
      const ranked = Object.entries(vision.shots)
        .filter(([, scene]) => !!scene.local)
        .sort(([a], [b]) => {
          const aShot = analysis.shots.find((item) => shotKey(item.startS) === a);
          const bShot = analysis.shots.find((item) => shotKey(item.startS) === b);
          return (bShot?.intensity ?? 0) - (aShot?.intensity ?? 0) || a.localeCompare(b);
        })
        .slice(0, 300);
      const matches = findSimilarVisualScenes(ranked.map(([key, scene]) => ({ key, features: scene.local! })));
      for (const [key, scene] of ranked) {
        scene.local!.similarScenes = matches[key]!.slice(0, 5);
      }
      await this.platform.fs.writeFile(await this.visionFile(asset), new TextEncoder().encode(JSON.stringify(vision)));
      this.runtime.set(assetId, { ...this.assetRuntime(assetId), vision: { ...vision, shots: { ...vision.shots } } });
      this.emit();
    }
    return { analyzed, failed, frameFailures };
  }

  /** Analisa cenas visualmente; no modo detalhado usa três quadros por cena e retoma do cache. */
  async runVision(
    assetId: string,
    o: { provider: ProviderConfig; key: string | null; fetch: FetchLike; scope?: VisionScope; max?: number; context?: SceneAnalysisContext; matchLyrics?: boolean; signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
  ): Promise<{ labeled: number; failed: number; frameFailures: number; usage: { input: number; output: number }; lyricMatches: Record<string, Record<string, SceneLyricMatch>> }> {
    const asset = this.project.assets.find((a) => a.id === assetId);
    if (!asset) throw new Error('episódio não encontrado');
    const prior = await this.loadVision(assetId);
    const scope = o.scope ?? 'fights';
    const targets = this.visionTargets(assetId, scope, o.max ?? (scope === 'all' ? Infinity : 120), o.matchLyrics);
    const env = await this.mediaEnv();
    const src = this.assetRuntime(assetId).artifacts?.proxyPath ?? asset.path;
    const vision: EpisodeVision = {
      version: VISION_VERSION,
      model: o.provider.model || o.provider.name,
      localModel: prior?.localModel,
      shots: { ...(prior?.shots ?? {}) },
    };
    const known = [...new Set(Object.values(vision.shots).flatMap((s) => s.characters))];
    const usage = { input: 0, output: 0 };
    const lyricMatches: Record<string, Record<string, SceneLyricMatch>> = {};
    let failed = 0;
    let frameFailures = 0;
    let analyzed = 0;
    const BATCH = 6;
    const FRAME_CONCURRENCY = 3;
    const samples = scope === 'all' ? [0.2, 0.5, 0.8] : [0.5];
    const scenesPerBatch = Math.max(1, Math.floor(BATCH / samples.length));
    for (let i = 0; i < targets.length; i += scenesPerBatch) {
      if (o.signal?.aborted) break;
      const chunk = targets.slice(i, i + scenesPerBatch);
      const frames: { id: string; jpegBase64: string }[] = [];
      const idsByScene = new Map<string, string[]>();
      const frameJobs: { id: string; timeS: number }[] = [];
      for (const t of chunk) {
        const key = shotKey(t.startS);
        const ids: string[] = [];
        for (const [sample, fraction] of samples.entries()) {
          const timeS = t.startS + (t.endS - t.startS) * fraction;
          const id = `${key}:${sample}`;
          frameJobs.push({ id, timeS });
          ids.push(id);
        }
        idsByScene.set(key, ids);
      }
      for (let start = 0; start < frameJobs.length; start += FRAME_CONCURRENCY) {
        const extracted = await Promise.all(frameJobs.slice(start, start + FRAME_CONCURRENCY).map(async ({ id, timeS }) => {
          try {
            return { id, jpegBase64: toBase64(await grabFrameJpeg(env.runner, src, timeS, 448, o.signal)) };
          } catch (error) {
            if (o.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
            frameFailures++;
            return null;
          }
        }));
        frames.push(...extracted.filter((frame): frame is NonNullable<typeof frame> => frame !== null));
      }
      const labels: Record<string, (typeof vision.shots)[string]> = {};
      if (frames.length) {
        const analysis = this.assetRuntime(assetId).episode;
        const sceneDialogue = chunk.map((target) => {
          const lines = [
            ...(analysis?.subtitles.filter((cue) => cue.endS > target.startS && cue.startS < target.endS).map((cue) => cue.text) ?? []),
            ...(analysis?.speech.filter((speech) => speech.text && speech.endS > target.startS && speech.startS < target.endS).map((speech) => speech.text!) ?? []),
          ];
          return { startS: target.startS, lines: [...new Set(lines)].slice(0, 2).map((line) => line.slice(0, 160)) };
        }).filter((scene) => scene.lines.length);
        const context = o.context ? { ...o.context, sceneDialogue } : undefined;
        const r = await labelScenes(o.provider, o.key, o.fetch, frames, { batchSize: BATCH, known, context, matchLyrics: o.matchLyrics, signal: o.signal });
        usage.input += r.usage.input;
        usage.output += r.usage.output;
        const failedIds = new Set(r.failed);
        for (const [key, ids] of idsByScene) {
          const sceneSamples = ids.flatMap((id) => {
            const label = r.labels[id];
            return !failedIds.has(id) && label ? [label] : [];
          });
          if (sceneSamples.length) {
            const merged = mergeShotVision(sceneSamples);
            labels[key] = {
              ...merged,
              ...(vision.shots[key]?.local ? { local: vision.shots[key]!.local } : {}),
              ...(!merged.sceneType && vision.shots[key]?.sceneType ? {
                sceneType: vision.shots[key]!.sceneType,
                sceneTypeConfidence: vision.shots[key]!.sceneTypeConfidence,
              } : {}),
            };
            analyzed++;
          } else failed++;
          if (o.matchLyrics && ids.length) {
            const values = ids.flatMap((id) => r.lyricMatches[id] ?? []);
            const byCue = new Map<string, SceneLyricMatch[]>();
            for (const value of values) byCue.set(value.cueId, [...(byCue.get(value.cueId) ?? []), value]);
            const target = chunk.find((candidate) => shotKey(candidate.startS) === key);
            if (target) {
              const matches = Object.fromEntries([...byCue].map(([cueId, matchesForCue]) => {
                const best = matchesForCue.reduce((current, value) => value.score > current.score ? value : current);
                return [cueId, { ...best, score: matchesForCue.reduce((sum, value) => sum + value.score, 0) / matchesForCue.length }];
              }));
              if (Object.keys(matches).length) lyricMatches[`${assetId}@${target.startS}`] = matches;
            }
          }
        }
        for (const c of r.characters) if (!known.includes(c)) known.push(c);
      } else {
        failed += chunk.length;
      }
      Object.assign(vision.shots, labels);
      // salva a cada lote: se cancelar ou falhar no meio, o que já foi feito fica
      await this.platform.fs.writeFile(await this.visionFile(asset), new TextEncoder().encode(JSON.stringify(vision)));
      this.runtime.set(assetId, { ...this.assetRuntime(assetId), vision: { ...vision, shots: { ...vision.shots } } });
      this.emit();
      o.onProgress?.(Math.min(targets.length, i + chunk.length), targets.length);
    }
    return { labeled: o.matchLyrics ? analyzed : Object.keys(vision.shots).length - Object.keys(prior?.shots ?? {}).length, failed, frameFailures, usage, lyricMatches };
  }

  /** Gera (ou reaproveita do cache) os artefatos de um asset e atualiza seu estado. */
  private async process(asset: Asset): Promise<void> {
    if (!asset.probe || asset.kind === 'image') {
      const rt = this.assetRuntime(asset.id);
      this.runtime.set(asset.id, { ...rt, artifacts: { posterPath: asset.path, stripPath: null, waveformPath: null, proxyPath: null, audioProxyPath: null } });
      this.setStatus(asset.id, 'ok', null);
      return;
    }
    const env = await this.mediaEnv();
    this.setStatus(asset.id, 'processing', null);
    const { artifacts, errors } = prepareArtifacts(env, { ...asset, probe: asset.probe });
    const result = await artifacts;
    const errs = await errors;
    if (this.disposed || !this.project.assets.some((a) => a.id === asset.id)) return;
    const rt = this.assetRuntime(asset.id);
    this.runtime.set(asset.id, { ...rt, artifacts: result, errors: errs });
    const cancelled = errs.length > 0 && errs.every((e) => e.endsWith('cancelado'));
    const essentialFailed = asset.kind === 'video' ? !result.proxyPath : false;
    if (cancelled) this.setStatus(asset.id, 'error', 'processamento cancelado');
    else if (essentialFailed) this.setStatus(asset.id, 'error', errs.join('; ') || 'falha ao gerar o proxy');
    else this.setStatus(asset.id, 'ok', null);
    // a miniatura do projeto nos recentes é a do primeiro vídeo
    const firstVideo = this.project.assets.find((a) => a.kind === 'video');
    if (firstVideo?.id === asset.id && result.posterPath) {
      await updateRecent(this.platform, this.path, { posterPath: result.posterPath }).catch(() => undefined);
    }
    this.emit();
    // efeitos sonoros do app não passam pela análise de música
    if (!cancelled && !essentialFailed && !isSfxAsset(asset)) void this.analyze(asset, result);
  }

  /**
   * Analisa a mídia em segundo plano (música: batidas/drop; vídeo: cenas/falas/legendas).
   * Resultado em cache por hash: reabrir o projeto não analisa de novo.
   */
  private async analyze(asset: Asset, art: MediaArtifacts): Promise<void> {
    if (!asset.probe) return;
    const env = await this.mediaEnv();
    const kind = asset.kind === 'audio' ? 'music' : 'episode';
    const version = kind === 'music' ? MUSIC_ANALYSIS_VERSION : EPISODE_ANALYSIS_VERSION;
    const dir = cachePaths(env.cacheRoot, asset.hash, joinPath).dir;
    const file = joinPath(dir, `analysis-${version}.json`);
    const setRt = (patch: Partial<AssetRuntime>) => {
      this.runtime.set(asset.id, { ...this.assetRuntime(asset.id), ...patch });
      this.emit();
    };
    try {
      if (await this.platform.fs.exists(file)) {
        const data = JSON.parse(new TextDecoder().decode(await this.platform.fs.readFile(file)));
        setRt(kind === 'music' ? { music: data, analysis: 'done' } : { episode: data, analysis: 'done' });
        return;
      }
      setRt({ analysis: 'pending' });
      const probe = asset.probe;
      const result = await this.queue.enqueue({
        key: `analysis:${asset.hash}`,
        kind: 'analysis',
        label: `${kind === 'music' ? 'Analisando a música' : 'Analisando cenas e falas'} · ${asset.name}`,
        assetId: asset.id,
        run: async ({ signal, report }) => {
          setRt({ analysis: 'running' });
          return kind === 'music'
            ? analyzeMusicFile(env.runner, asset.path, probe.durationUs / 1e6, (f, d) => report(f, d), signal)
            : analyzeEpisodeFile(env.runner, asset.path, art.proxyPath ?? asset.path, probe, (f, d) => report(f, d), signal, {
                path: joinPath(dir, `quadros-${Date.now()}.txt`),
                read: (p) => this.platform.fs.readFile(p),
                remove: (p) => this.platform.fs.remove(p),
              });
        },
      }).promise;
      await this.platform.fs.writeFile(file, new TextEncoder().encode(JSON.stringify(result)));
      setRt(kind === 'music' ? { music: result as MusicAnalysis, analysis: 'done' } : { episode: result as EpisodeAnalysis, analysis: 'done' });
    } catch (e) {
      if (this.disposed) return;
      setRt({ analysis: 'error', analysisError: (e as Error).message });
    }
  }

  /** Tenta processar de novo uma mídia que falhou ou foi cancelada. */
  retry(assetId: string): void {
    const a = this.project.assets.find((x) => x.id === assetId);
    if (a && a.status !== 'missing') void this.process(a);
  }

  private setStatus(id: string, status: Asset['status'], error: string | null): void {
    const a = this.project.assets.find((x) => x.id === id);
    if (!a || (a.status === status && a.error === error)) return;
    this.history.applySystem({ type: 'asset.update', assetId: id, patch: { status, error } });
  }

  /** Marca mídias ausentes e processa as presentes. Devolve quantas estão ausentes. */
  async checkAssets(): Promise<number> {
    let missing = 0;
    for (const a of this.project.assets) {
      const exists = await this.platform.fs.exists(a.path);
      if (!exists) {
        missing++;
        this.setStatus(a.id, 'missing', 'arquivo não encontrado');
      } else {
        if (a.status === 'missing') this.setStatus(a.id, 'processing', null);
        void this.process(this.project.assets.find((x) => x.id === a.id)!);
      }
    }
    return missing;
  }

  // ---------- relocalizar ----------

  /**
   * Aponta uma mídia ausente para outro arquivo. Confere o hash: se não for o
   * mesmo arquivo, devolve `mismatch` e só aceita com `force`.
   */
  async relocate(assetId: string, newPath: string, force = false): Promise<'ok' | 'mismatch'> {
    const asset = this.project.assets.find((a) => a.id === assetId);
    if (!asset) throw new Error('mídia não encontrada no projeto');
    const { hash } = await hashFile(this.platform.fs, newPath);
    if (hash !== asset.hash && !force) return 'mismatch';
    this.history.execute(
      { type: 'asset.update', assetId, patch: { path: newPath, name: baseName(newPath), hash, status: 'processing', error: null } },
      `Localizar ${baseName(newPath)}`,
    );
    void this.process(this.project.assets.find((a) => a.id === assetId)!);
    return 'ok';
  }

  /** Procura numa pasta (e subpastas) os arquivos de todas as mídias ausentes. */
  async relocateFromFolder(folder: string): Promise<{ found: number; stillMissing: number }> {
    const missing = this.project.assets.filter((a) => a.status === 'missing');
    if (!missing.length) return { found: 0, stillMissing: 0 };
    const files = (await this.platform.listFiles(folder, 4)).filter(isImportable);
    // só calcula hash de arquivos com o mesmo tamanho de alguma mídia ausente (barato)
    const sizes = new Set(missing.map((a) => a.probe?.sizeBytes).filter((s): s is number => !!s));
    const candidates = [];
    for (const path of files) {
      const size = await this.platform.fs.size(path);
      if (sizes.size && !sizes.has(size)) continue;
      const { hash } = await hashFile(this.platform.fs, path);
      candidates.push({ path, name: baseName(path), hash });
    }
    const matches = matchMissingAssets(missing, candidates);
    if (matches.size) {
      this.history.transaction(
        `Localizar ${matches.size} mídia(s)`,
        [...matches].map(([assetId, path]) => ({
          type: 'asset.update' as const,
          assetId,
          patch: { path, name: baseName(path), status: 'processing' as const, error: null },
        })),
      );
      for (const id of matches.keys()) void this.process(this.project.assets.find((a) => a.id === id)!);
    }
    return { found: matches.size, stillMissing: missing.length - matches.size };
  }

  // ---------- versões (o que a geração substitui fica guardado)

  private versionsDir(): string {
    return `${this.path}.versoes`;
  }

  /** Guarda a timeline atual como versão (arquivo ao lado do projeto). */
  async saveVersion(name: string): Promise<string | null> {
    if (!this.project.clips.length) return null;
    const version = await this.createVersionSnapshot(name, this.project);
    this.history.execute({ type: 'version.add', version }, `Guardar versão "${name}"`);
    return version.id;
  }

  async createVersionSnapshot(name: string, project: Project = this.project): Promise<Project['versions'][number]> {
    if (!project.clips.length) throw new Error('A timeline está vazia; não há versão para guardar.');
    const id = newId('ver');
    const dir = this.versionsDir();
    await this.platform.fs.mkdir(dir);
    const file = joinPath(dir, `${id}.amvproj`);
    await writeAtomic(this.platform, file, serializeProject(project));
    return { id, name, createdAt: new Date().toISOString(), origin: 'user', file };
  }

  async removeVersionSnapshot(file: string): Promise<void> {
    if (await this.platform.fs.exists(file)) await this.platform.fs.remove(file);
  }

  /** Volta a timeline de uma versão (clipes e marcadores). Um único desfazer. */
  async restoreVersion(versionId: string): Promise<void> {
    const v = this.project.versions.find((x) => x.id === versionId);
    if (!v) throw new Error('versão não encontrada');
    const parsed = parseProject(new TextDecoder().decode(await this.platform.fs.readFile(v.file)));
    if (!parsed.ok) throw new Error(`a versão está corrompida: ${parsed.error}`);
    const previousAssets = new Map(this.project.assets.map((asset) => [asset.id, asset.path]));
    const before = previousAssets;
    const replacement = { ...parsed.project, id: this.project.id, versions: this.project.versions };
    this.history.execute({ type: 'project.replace', project: replacement }, `Voltar para "${v.name}"`);
    this.afterChange(before);
  }

  removeAsset(assetId: string): void {
    this.execute({ type: 'asset.remove', assetId });
    this.runtime.delete(assetId);
  }

  dispose(): void {
    this.disposed = true;
    for (const a of this.project.assets) this.queue.cancelAsset(a.id);
    this.listeners.clear();
  }
}

export function withExtension(path: string): string {
  return path.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`) ? path : `${path}.${PROJECT_EXTENSION}`;
}

export function autosavePath(path: string): string {
  return `${path}.autosave`;
}

export function backupsPath(path: string): string {
  return `${path}.backups`;
}

function projectAtPath(project: Project, path: string, id: string, name: string, duplicate = false): Project {
  const dir = `${path}.versoes`;
  const now = new Date().toISOString();
  return {
    ...project,
    id,
    name,
    ...(duplicate ? { createdAt: now, updatedAt: now } : {}),
    versions: project.versions.map((version) => ({
      ...version,
      file: joinPath(dir, `${version.id}.amvproj`),
    })),
  };
}

async function copyProjectTo(platform: Platform, project: Project, sourcePath: string, path: string, name: string, id: string): Promise<Project> {
  const versionDir = `${path}.versoes`;
  const backupDir = backupsPath(path);
  if (await platform.fs.exists(path) || await platform.fs.exists(versionDir) || await platform.fs.exists(backupDir)) {
    throw new Error(`o destino do projeto ou seus dados auxiliares já existem: ${path}`);
  }
  const copied = projectAtPath(project, path, id, name, id !== project.id);
  try {
    if (project.versions.length) {
      await platform.fs.mkdir(versionDir);
      for (let index = 0; index < project.versions.length; index++) {
        const source = project.versions[index]!;
        const parsed = parseProject(new TextDecoder().decode(await platform.fs.readFile(source.file)));
        if (!parsed.ok) throw new Error(`a versão "${source.name}" não pode ser copiada: ${parsed.error}`);
        const snapshot = projectAtPath(parsed.project, path, id, parsed.project.name);
        await writeAtomic(platform, copied.versions[index]!.file, serializeProject(snapshot));
      }
    }

    const sourceBackups = backupsPath(sourcePath);
    if (sourceBackups && await platform.fs.exists(sourceBackups)) {
      await platform.fs.mkdir(backupDir);
      for (const name of (await platform.fs.readDir(sourceBackups)).filter((file) => file.toLowerCase().endsWith('.amvproj'))) {
        const source = joinPath(sourceBackups, name);
        const bytes = await platform.fs.readFile(source);
        const parsed = parseProject(new TextDecoder().decode(bytes));
        const target = joinPath(backupDir, name);
        if (parsed.ok) {
          const backupProject = projectAtPath(parsed.project, path, id, parsed.project.name);
          await writeAtomic(platform, target, serializeProject(backupProject));
        } else {
          await writeAtomicBytes(platform, target, bytes);
        }
      }
    }

    await writeAtomic(platform, path, serializeProject(copied));
    const saved = parseProject(new TextDecoder().decode(await platform.fs.readFile(path)));
    if (!saved.ok) throw new Error(`a cópia do projeto não passou na validação: ${saved.error}`);
    for (const version of saved.project.versions) {
      const snapshot = parseProject(new TextDecoder().decode(await platform.fs.readFile(version.file)));
      if (!snapshot.ok) throw new Error(`a cópia da versão "${version.name}" não passou na validação: ${snapshot.error}`);
    }
    return copied;
  } catch (error) {
    for (const ownedPath of [path, versionDir, backupDir]) {
      if (await platform.fs.exists(ownedPath)) await platform.fs.remove(ownedPath);
    }
    throw error;
  }
}

async function writeAtomic(platform: Platform, path: string, text: string): Promise<void> {
  await writeAtomicBytes(platform, path, new TextEncoder().encode(text));
}

async function writeAtomicBytes(platform: Platform, path: string, data: Uint8Array): Promise<void> {
  const tmp = `${path}.transaction.tmp`;
  const displaced = `${path}.transaction.old`;
  await recoverAtomicFile(platform, path);
  try {
    await platform.fs.writeFile(tmp, data);
    if (await platform.fs.exists(path)) await platform.fs.rename(path, displaced);
    try {
      await platform.fs.rename(tmp, path);
    } catch (error) {
      if (!(await platform.fs.exists(path)) && await platform.fs.exists(displaced)) await platform.fs.rename(displaced, path);
      throw error;
    }
    if (await platform.fs.exists(displaced)) await platform.fs.remove(displaced);
  } catch (error) {
    if (await platform.fs.exists(tmp)) await platform.fs.remove(tmp);
    throw error;
  }
}

async function recoverAtomicFile(platform: Platform, path: string): Promise<void> {
  const tmp = `${path}.transaction.tmp`;
  const displaced = `${path}.transaction.old`;
  if (await platform.fs.exists(displaced)) {
    if (await platform.fs.exists(path)) await platform.fs.remove(displaced);
    else await platform.fs.rename(displaced, path);
  }
  if (await platform.fs.exists(tmp)) await platform.fs.remove(tmp);
}
