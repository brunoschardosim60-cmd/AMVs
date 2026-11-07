import { CancelledError } from './runner.js';

export type JobKind = 'probe' | 'poster' | 'thumbnails' | 'waveform' | 'proxy' | 'render' | 'analysis';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** Menor = mais urgente. O usuário vê os metadados antes de esperar proxies. */
export const JOB_PRIORITY: Record<JobKind, number> = {
  probe: 0,
  poster: 1,
  thumbnails: 2,
  waveform: 3,
  proxy: 4,
  render: 5,
  analysis: 6,
};

export interface JobContext {
  signal: AbortSignal;
  /** fraction 0..1, ou null para "sem estimativa"; detail é texto curto opcional. */
  report(fraction: number | null, detail?: string): void;
}

export interface JobSnapshot {
  id: string;
  key: string;
  kind: JobKind;
  label: string;
  assetId: string | null;
  status: JobStatus;
  progress: number | null;
  detail: string | null;
  error: string | null;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface JobSpec<T> {
  /** Jobs com a mesma chave em andamento não são duplicados. */
  key: string;
  kind: JobKind;
  label: string;
  assetId?: string | null;
  run: (ctx: JobContext) => Promise<T>;
}

interface Internal<T = unknown> {
  snap: JobSnapshot;
  spec: JobSpec<T>;
  controller: AbortController;
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
  seq: number;
}

type Listener = (job: JobSnapshot) => void;

/**
 * Fila de jobs com prioridade, limite de concorrência, cancelamento real
 * (o AbortSignal mata o processo do FFmpeg) e progresso.
 */
export class JobQueue {
  private jobs = new Map<string, Internal>();
  private running = 0;
  private seq = 0;
  private listeners = new Set<Listener>();

  constructor(private concurrency = 2, private now: () => number = () => Date.now()) {}

  setConcurrency(n: number): void {
    this.concurrency = Math.max(1, n);
    this.pump();
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  list(): JobSnapshot[] {
    return [...this.jobs.values()].map((j) => ({ ...j.snap }));
  }

  get(id: string): JobSnapshot | undefined {
    const j = this.jobs.get(id);
    return j ? { ...j.snap } : undefined;
  }

  enqueue<T>(spec: JobSpec<T>): { id: string; promise: Promise<T> } {
    for (const j of this.jobs.values()) {
      if (j.spec.key === spec.key && (j.snap.status === 'queued' || j.snap.status === 'running')) {
        return { id: j.snap.id, promise: j.promise as Promise<T> };
      }
    }
    const id = `job_${++this.seq}`;
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // evita "unhandled rejection" quando ninguém aguarda o job
    promise.catch(() => undefined);
    const job: Internal<T> = {
      snap: {
        id,
        key: spec.key,
        kind: spec.kind,
        label: spec.label,
        assetId: spec.assetId ?? null,
        status: 'queued',
        progress: null,
        detail: null,
        error: null,
        queuedAt: this.now(),
        startedAt: null,
        finishedAt: null,
      },
      spec,
      controller: new AbortController(),
      promise,
      resolve,
      reject,
      seq: this.seq,
    };
    this.jobs.set(id, job as Internal);
    this.emit(job as Internal);
    this.pump();
    return { id, promise };
  }

  cancel(id: string): void {
    const j = this.jobs.get(id);
    if (!j) return;
    if (j.snap.status === 'queued') {
      this.finish(j, 'cancelled', null);
      j.reject(new CancelledError());
    } else if (j.snap.status === 'running') {
      j.controller.abort();
    }
  }

  cancelAsset(assetId: string): void {
    for (const j of this.jobs.values()) if (j.snap.assetId === assetId) this.cancel(j.snap.id);
  }

  /** Remove da lista os jobs terminados. */
  clearFinished(): void {
    for (const [id, j] of this.jobs) {
      if (j.snap.status !== 'queued' && j.snap.status !== 'running') this.jobs.delete(id);
    }
  }

  private pump(): void {
    while (this.running < this.concurrency) {
      const next = [...this.jobs.values()]
        .filter((j) => j.snap.status === 'queued')
        .sort((a, b) => JOB_PRIORITY[a.spec.kind] - JOB_PRIORITY[b.spec.kind] || a.seq - b.seq)[0];
      if (!next) return;
      this.start(next);
    }
  }

  private start(j: Internal): void {
    this.running++;
    j.snap.status = 'running';
    j.snap.startedAt = this.now();
    j.snap.progress = 0;
    this.emit(j);
    const ctx: JobContext = {
      signal: j.controller.signal,
      report: (fraction, detail) => {
        if (j.snap.status !== 'running') return;
        // progresso nunca regride na UI
        const before = j.snap.progress;
        const next = fraction === null ? null : Math.max(before ?? 0, Math.min(1, fraction));
        const detailChanged = detail !== undefined && detail !== j.snap.detail;
        // FFmpeg manda centenas de pedaços por segundo: só avisa a UI a cada 0,5%
        if (!detailChanged && next !== null && before !== null && next - before < 0.005) return;
        j.snap.progress = next;
        if (detail !== undefined) j.snap.detail = detail;
        this.emit(j);
      },
    };
    Promise.resolve()
      .then(() => j.spec.run(ctx))
      .then(
        (value) => {
          if (j.controller.signal.aborted) throw new CancelledError();
          j.snap.progress = 1;
          this.finish(j, 'done', null);
          j.resolve(value);
        },
      )
      .catch((err: unknown) => {
        const cancelled = err instanceof CancelledError || j.controller.signal.aborted;
        this.finish(j, cancelled ? 'cancelled' : 'failed', cancelled ? null : errorMessage(err));
        j.reject(cancelled ? new CancelledError() : err);
      })
      .finally(() => {
        this.running--;
        this.pump();
      });
  }

  private finish(j: Internal, status: JobStatus, error: string | null): void {
    j.snap.status = status;
    j.snap.error = error;
    j.snap.finishedAt = this.now();
    this.emit(j);
  }

  private emit(j: Internal): void {
    const snap = { ...j.snap };
    for (const l of this.listeners) l(snap);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
