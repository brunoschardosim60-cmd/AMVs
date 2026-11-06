import { etaSeconds, type JobSnapshot } from '@amv/media';
import { ChevronDown, ChevronUp, CircleCheck, CircleX, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { useApp, useSessionVersion } from '../../store';
import { IconButton, Progress } from '../../ui/controls';

function eta(j: JobSnapshot): string | null {
  if (j.status !== 'running' || j.progress === null || !j.startedAt) return null;
  const s = etaSeconds(j.progress, Date.now() - j.startedAt);
  if (s === null) return null;
  if (s < 60) return `${Math.max(1, Math.round(s))} s`;
  return `${Math.round(s / 60)} min`;
}

function JobRow({ j, onCancel }: { j: JobSnapshot; onCancel: () => void }) {
  const active = j.status === 'running' || j.status === 'queued';
  const left = eta(j);
  return (
    <li className="grid grid-cols-[18px_1fr_200px_72px_32px] items-center gap-3 px-4 py-1.5 text-xs">
      {j.status === 'running' && <Loader2 size={14} className="animate-spin text-azure" />}
      {j.status === 'queued' && <span className="size-2 justify-self-center rounded-full bg-faint" />}
      {j.status === 'done' && <CircleCheck size={14} className="text-ok" />}
      {(j.status === 'failed' || j.status === 'cancelled') && <CircleX size={14} className={j.status === 'failed' ? 'text-danger' : 'text-muted'} />}
      <span className="min-w-0">
        <span className="block truncate text-ink-soft">{j.label}</span>
        {j.status === 'failed' && <span className="block truncate text-danger" title={j.error ?? ''}>{j.error}</span>}
      </span>
      {j.status === 'running' ? <Progress value={j.progress} live /> : <span className="text-muted">{{ queued: 'na fila', done: 'pronto', failed: 'falhou', cancelled: 'cancelado', running: '' }[j.status]}</span>}
      <span className="tnum text-right text-muted">
        {j.status === 'running' && j.progress !== null ? `${Math.round(j.progress * 100)}%` : ''}
        {left ? ` · ${left}` : ''}
      </span>
      {active ? (
        <IconButton label="Cancelar" className="size-6" onClick={onCancel}>
          <X size={13} />
        </IconButton>
      ) : (
        <span />
      )}
    </li>
  );
}

export function JobsDock() {
  const session = useApp((s) => s.session);
  useSessionVersion(session);
  const [open, setOpen] = useState(false);
  if (!session) return null;

  const jobs = session.queue.list();
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
  const running = jobs.filter((j) => j.status === 'running');
  const failed = jobs.filter((j) => j.status === 'failed');
  const current = running[0];

  return (
    <section className="shrink-0 border-t border-line bg-panel" aria-label="Processamento">
      <div className="flex h-9 items-center gap-3 px-4 text-xs">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          {active.length ? (
            <>
              <Loader2 size={14} className="shrink-0 animate-spin text-azure" />
              <span className="shrink-0 text-ink-soft">
                Processando <span className="tnum">{active.length}</span> {active.length === 1 ? 'tarefa' : 'tarefas'}
              </span>
              {current && (
                <>
                  <span className="min-w-0 truncate text-muted">{current.label}</span>
                  <span className="w-40 shrink-0">
                    <Progress value={current.progress} live />
                  </span>
                </>
              )}
            </>
          ) : (
            <>
              <CircleCheck size={14} className={failed.length ? 'text-warn' : 'text-ok'} />
              <span className="text-muted">
                {failed.length ? `${failed.length} tarefa(s) falharam` : session.project.assets.length ? 'Mídia pronta para edição' : 'Nenhuma tarefa em andamento'}
              </span>
            </>
          )}
          <span className="ml-auto text-muted">{open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</span>
        </button>
      </div>
      {open && (
        <div className="max-h-56 overflow-y-auto border-t border-line-soft py-1">
          {jobs.length ? (
            <ul>
              {[...jobs].reverse().map((j) => (
                <JobRow key={j.id} j={j} onCancel={() => session.queue.cancel(j.id)} />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-xs text-muted">Nenhuma tarefa nesta sessão.</p>
          )}
          {jobs.some((j) => j.status !== 'running' && j.status !== 'queued') && (
            <div className="px-4 py-1.5">
              <button type="button" className="text-xs text-muted hover:text-ink" onClick={() => session.queue.clearFinished()}>
                Limpar concluídas
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
