import { X } from 'lucide-react';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-violet text-white hover:bg-violet-strong disabled:bg-violet-deep disabled:text-muted',
  secondary: 'bg-raised text-ink border border-line hover:bg-hover disabled:text-faint',
  ghost: 'text-ink-soft hover:bg-raised hover:text-ink disabled:text-faint disabled:hover:bg-transparent',
  danger: 'text-danger hover:bg-danger/10 disabled:text-faint',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; icon?: ReactNode }) {
  const sz = size === 'sm' ? 'h-7 px-2.5 text-xs gap-1.5' : 'h-9 px-3.5 text-sm gap-2';
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-control font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed ${sz} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-grid size-8 place-items-center rounded-control text-ink-soft transition-colors hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:text-faint disabled:hover:bg-transparent ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Dialog({
  title,
  onClose,
  children,
  footer,
  width = 'w-[480px]',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // onClose pode mudar a cada render do pai: guarda numa ref para o foco inicial rodar UMA vez
  // (senão o foco voltaria ao primeiro botão a cada atualização, e Espaço/Enter poderiam fechar o diálogo)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, select, button:not([aria-label="Fechar"])')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/55" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`${width} max-w-[calc(100vw-32px)] rounded-panel border border-line bg-panel shadow-2xl shadow-black/50`}>
        <div className="flex items-center justify-between border-b border-line-soft px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <IconButton label="Fechar" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line-soft px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="mb-4 block last:mb-0">
      <span className="mb-1.5 block text-xs font-medium text-ink-soft">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-2xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'h-9 w-full rounded-control border border-line bg-base px-3 text-sm text-ink placeholder:text-faint focus:border-violet focus:outline-none';

export function Progress({ value, live }: { value: number | null; live?: boolean }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-base" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(value * 100)}>
      <div
        className={`h-full rounded-full bg-azure transition-[width] duration-300 ${live ? 'progress-live' : ''}`}
        style={{ width: `${value === null ? 100 : Math.max(2, value * 100)}%`, opacity: value === null ? 0.5 : 1 }}
      />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-base px-1.5 py-px font-sans text-2xs text-muted">{children}</kbd>;
}
