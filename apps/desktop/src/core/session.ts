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
  type Asset,
  type Command,
  type Project,
  type ProjectSettings,
} from '@amv/project';
import type { Platform } from '../platform/types';
import { analyzeEpisodeFile, analyzeMusicFile, EPISODE_ANALYSIS_VERSION, grabFrameJpeg, MUSIC_ANALYSIS_VERSION, shotKey, toBase64, VISION_VERSION, type EpisodeAnalysis, type EpisodeVision, type MusicAnalysis } from '@amv/analysis';
import { labelScenes, type FetchLike, type ProviderConfig } from '@amv/assistant';
import { renderSfx, SFX_KINDS, SFX_LABEL, sfxFileName, toWav, type SfxKind } from '@amv/sfx';
import { rememberRecent, updateRecent } from './recents';

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
    const before = new Set(this.project.assets.map((a) => a.id));
    this.history.execute(command, label);
    this.afterChange(before);
  }

  undo(): void {
    const before = new Set(this.project.assets.map((a) => a.id));
    this.history.undo();
    this.afterChange(before);
  }

  redo(): void {
    const before = new Set(this.project.assets.map((a) => a.id));
    this.history.redo();
    this.afterChange(before);
  }

  /** Cancela jobs de mídias que saíram do projeto e reprocessa as que voltaram (undo). */
  private afterChange(before: Set<string>): void {
    const now = new Set(this.project.assets.map((a) => a.id));
    for (const id of before) if (!now.has(id)) this.queue.cancelAsset(id);
    for (const a of this.project.assets) {
      if (!before.has(a.id) && a.status !== 'missing' && !this.runtime.get(a.id)?.artifacts) void this.process(a);
    }
  }

  // ---------- salvar ----------

  async save(): Promise<void> {
    const project = { ...this.project, updatedAt: new Date().toISOString() };
    await writeAtomic(this.platform, this.path, serializeProject(project));
    this.history.markSaved();
    // o autosave vira lixo depois de salvar
    const auto = autosavePath(this.path);
    if (await this.platform.fs.exists(auto)) await this.platform.fs.remove(auto);
    await this.touchRecent();
    this.emit();
  }

  async saveAs(path: string): Promise<void> {
    this.path = withExtension(path);
    await this.save();
  }

  /** Grava `<projeto>.autosave` se houve mudança desde o último autosave. */
  async autosave(): Promise<boolean> {
    if (!this.dirty || this.history.version === this.lastAutosaveRevision) return false;
    const project = { ...this.project, updatedAt: new Date().toISOString() };
    await writeAtomic(this.platform, autosavePath(this.path), serializeProject(project));
    this.lastAutosaveRevision = this.history.version;
    return true;
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

  /**
   * As cenas de luta ainda sem rótulo, das lutas mais fortes para as mais fracas (até `max`).
   * É o que a análise com IA vai mandar para o modelo: serve também para estimar o custo.
   */
  visionTargets(assetId: string, max = 120): { startS: number; midS: number }[] {
    const ep = this.assetRuntime(assetId).episode;
    if (!ep) return [];
    const done = this.assetRuntime(assetId).vision?.shots ?? {};
    const out: { startS: number; midS: number }[] = [];
    const fights = (ep.sequences ?? []).filter((q) => q.kind === 'luta').sort((a, b) => b.intensity - a.intensity);
    for (const q of fights) {
      for (const sh of ep.shots) {
        if (sh.startS < q.startS - 1e-3 || sh.endS > q.endS + 1e-3 || sh.tags.includes('escura') || sh.endS - sh.startS < 0.25) continue;
        if (done[shotKey(sh.startS)]) continue;
        out.push({ startS: sh.startS, midS: (sh.startS + sh.endS) / 2 });
        if (out.length >= max) return out;
      }
    }
    return out;
  }

  /**
   * Manda quadros das cenas de luta a um modelo com visão e guarda quem aparece em cada uma.
   * Retoma de onde parou (cenas já rotuladas não são enviadas de novo) e salva a cada lote.
   */
  async runVision(
    assetId: string,
    o: { provider: ProviderConfig; key: string | null; fetch: FetchLike; max?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
  ): Promise<{ labeled: number; failed: number; usage: { input: number; output: number } }> {
    const asset = this.project.assets.find((a) => a.id === assetId);
    if (!asset) throw new Error('episódio não encontrado');
    const prior = await this.loadVision(assetId);
    const targets = this.visionTargets(assetId, o.max ?? 120);
    const env = await this.mediaEnv();
    const src = this.assetRuntime(assetId).artifacts?.proxyPath ?? asset.path;
    const vision: EpisodeVision = { version: VISION_VERSION, model: o.provider.model || o.provider.name, shots: { ...(prior?.shots ?? {}) } };
    const known = [...new Set(Object.values(vision.shots).flatMap((s) => s.characters))];
    const usage = { input: 0, output: 0 };
    let failed = 0;
    const BATCH = 6;
    for (let i = 0; i < targets.length; i += BATCH) {
      if (o.signal?.aborted) break;
      const chunk = targets.slice(i, i + BATCH);
      const frames: { id: string; jpegBase64: string }[] = [];
      for (const t of chunk) {
        try {
          frames.push({ id: shotKey(t.startS), jpegBase64: toBase64(await grabFrameJpeg(env.runner, src, t.midS, 448, o.signal)) });
        } catch {
          failed++; // quadro que não saiu: pula a cena, o resto segue
        }
      }
      if (!frames.length) continue;
      const r = await labelScenes(o.provider, o.key, o.fetch, frames, { batchSize: BATCH, known, signal: o.signal });
      usage.input += r.usage.input;
      usage.output += r.usage.output;
      failed += r.failed.length;
      Object.assign(vision.shots, r.labels);
      for (const c of r.characters) if (!known.includes(c)) known.push(c);
      // salva a cada lote: se cancelar ou falhar no meio, o que já foi feito fica
      await this.platform.fs.writeFile(await this.visionFile(asset), new TextEncoder().encode(JSON.stringify(vision)));
      this.runtime.set(assetId, { ...this.assetRuntime(assetId), vision: { ...vision, shots: { ...vision.shots } } });
      this.emit();
      o.onProgress?.(Math.min(targets.length, i + chunk.length), targets.length);
    }
    return { labeled: Object.keys(vision.shots).length - Object.keys(prior?.shots ?? {}).length, failed, usage };
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
    const id = newId('ver');
    const dir = this.versionsDir();
    await this.platform.fs.mkdir(dir);
    const file = joinPath(dir, `${id}.amvproj`);
    await writeAtomic(this.platform, file, serializeProject(this.project));
    this.history.execute({ type: 'version.add', version: { id, name, createdAt: new Date().toISOString(), origin: 'user', file } }, `Guardar versão "${name}"`);
    return id;
  }

  /** Volta a timeline de uma versão (clipes e marcadores). Um único desfazer. */
  async restoreVersion(versionId: string): Promise<void> {
    const v = this.project.versions.find((x) => x.id === versionId);
    if (!v) throw new Error('versão não encontrada');
    const parsed = parseProject(new TextDecoder().decode(await this.platform.fs.readFile(v.file)));
    if (!parsed.ok) throw new Error(`a versão está corrompida: ${parsed.error}`);
    const old = parsed.project;
    const assets = new Set(this.project.assets.map((a) => a.id));
    const tracks = new Set(this.project.tracks.map((t) => t.id));
    const cmds: Command[] = [
      ...this.project.clips.map((c) => ({ type: 'clip.remove' as const, clipId: c.id })),
      ...old.clips.filter((c) => tracks.has(c.trackId) && (!c.assetId || assets.has(c.assetId))).map((c) => ({ type: 'clip.add' as const, clip: c })),
    ];
    this.history.transaction(`Voltar para "${v.name}"`, cmds);
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

async function writeAtomic(platform: Platform, path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await platform.fs.writeFile(tmp, new TextEncoder().encode(text));
  await platform.fs.rename(tmp, path);
}
