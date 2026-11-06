import { applyCommand, describeCommand, type Command } from './commands.js';
import type { Project } from './schema.js';

export interface HistoryEntry {
  label: string;
  forward: Command;
  inverse: Command;
}

export interface HistoryOptions {
  /** Máximo de passos de undo guardados. */
  limit?: number;
}

type Listener = (project: Project) => void;

/**
 * Histórico com undo/redo baseado em comandos.
 * Uma `transaction` agrupa vários comandos num único passo de undo
 * (ex.: arrastar um clipe, aplicar um ChangeSet da IA).
 */
export class ProjectHistory {
  private current: Project;
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private readonly limit: number;
  private listeners = new Set<Listener>();
  /** Incrementa a cada mudança; serve para detectar "projeto mudou desde X". */
  private revision = 0;
  private savedRevision = 0;

  constructor(project: Project, options: HistoryOptions = {}) {
    this.current = project;
    this.limit = options.limit ?? 300;
  }

  get project(): Project {
    return this.current;
  }

  get version(): number {
    return this.revision;
  }

  get dirty(): boolean {
    return this.revision !== this.savedRevision;
  }

  markSaved(): void {
    this.savedRevision = this.revision;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | null {
    return this.past.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.future.at(-1)?.label ?? null;
  }

  get entries(): readonly HistoryEntry[] {
    return this.past;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Executa um comando. Lança CommandError sem alterar nada se for inválido. */
  execute(command: Command, label?: string): Project {
    const { project, inverse } = applyCommand(this.current, command);
    this.past.push({ label: label ?? describeCommand(command), forward: command, inverse });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    return this.commit(project);
  }

  /** Agrupa vários comandos num só passo de undo. */
  transaction(label: string, commands: Command[]): Project {
    return this.execute({ type: 'batch', label, commands }, label);
  }

  undo(): Project {
    const entry = this.past.pop();
    if (!entry) return this.current;
    const { project } = applyCommand(this.current, entry.inverse);
    this.future.push(entry);
    return this.commit(project);
  }

  redo(): Project {
    const entry = this.future.pop();
    if (!entry) return this.current;
    const { project, inverse } = applyCommand(this.current, entry.forward);
    this.past.push({ ...entry, inverse });
    return this.commit(project);
  }

  /**
   * Aplica uma mudança do SISTEMA (não do usuário) sem criar passo de undo:
   * ex.: "proxy terminou, mídia pronta", "arquivo não encontrado ao abrir".
   * Não marca o projeto como modificado: é estado recalculado ao abrir.
   * Lança CommandError se inválido.
   */
  applySystem(command: Command): Project {
    const wasClean = !this.dirty;
    const { project } = applyCommand(this.current, command);
    this.current = project;
    this.revision += 1;
    if (wasClean) this.savedRevision = this.revision;
    this.emit();
    return project;
  }

  /** Força o estado "não salvo" (ex.: projeto recuperado de autosave). */
  markUnsaved(): void {
    this.savedRevision = -1;
    this.emit();
  }

  /** Substitui o projeto sem histórico (abrir arquivo, recuperar autosave). */
  reset(project: Project): void {
    this.current = project;
    this.past = [];
    this.future = [];
    this.revision = 0;
    this.savedRevision = 0;
    this.emit();
  }

  private commit(project: Project): Project {
    this.current = project;
    this.revision += 1;
    this.emit();
    return project;
  }

  private emit(): void {
    for (const l of this.listeners) l(this.current);
  }
}
