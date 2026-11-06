import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useApp } from '../store';

const TONE = {
  info: { icon: Info, color: 'text-azure' },
  ok: { icon: CheckCircle2, color: 'text-ok' },
  warn: { icon: AlertTriangle, color: 'text-warn' },
  error: { icon: XCircle, color: 'text-danger' },
};

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[360px] flex-col gap-2" aria-live="polite">
      {toasts.slice(-5).map((t) => {
        const { icon: Icon, color } = TONE[t.tone];
        return (
          <div key={t.id} className="pointer-events-auto flex gap-3 rounded-panel border border-line bg-raised px-3.5 py-3 shadow-xl shadow-black/40">
            <Icon size={18} className={`mt-px shrink-0 ${color}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t.title}</p>
              {t.body && <p className="mt-0.5 text-xs break-words whitespace-pre-line text-muted">{t.body}</p>}
            </div>
            <button type="button" aria-label="Dispensar" className="shrink-0 text-faint hover:text-ink" onClick={() => dismiss(t.id)}>
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
