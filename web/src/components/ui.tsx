import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Loader2, X } from "lucide-react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover shadow-sm",
  secondary: "bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-2",
  ghost: "text-muted hover:text-ink hover:bg-surface-2",
  danger: "bg-danger-soft text-danger hover:brightness-95 border border-transparent",
  soft: "bg-accent-soft text-accent-text hover:brightness-[0.97]",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean; icon?: ReactNode }
>(function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest }, ref) {
  const sizes = { sm: "h-8 px-3 text-[0.8125rem] gap-1.5 rounded-lg", md: "h-10 px-4 text-sm gap-2 rounded-xl", lg: "h-12 px-5 text-[0.95rem] gap-2 rounded-xl" };
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none",
        sizes[size],
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: "sm" | "md" }>(
  function IconButton({ label, active, size = "md", className, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        className={cx(
          "inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
          size === "sm" ? "size-8" : "size-10",
          active ? "bg-accent-soft text-accent-text" : "text-muted hover:text-ink hover:bg-surface-2",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

/**
 * Label + a single form control. Wrapping the control in the <label> associates them for screen
 * readers without every caller wiring up ids. Don't put groups of buttons inside a Field —
 * clicking the label would activate the first one.
 */
export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  const hintId = useId();
  const body = (
    <>
      <span className="block text-sm font-medium text-ink">{label}</span>
      {children}
    </>
  );
  return (
    <div className="space-y-1.5">
      {htmlFor ? (
        <>
          <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
            {label}
          </label>
          {children}
        </>
      ) : (
        <label className="block space-y-1.5">{body}</label>
      )}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={hintId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const inputBase =
  "w-full rounded-xl border border-line bg-surface px-3.5 text-[0.95rem] text-ink placeholder:text-faint transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(inputBase, "h-11", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(inputBase, "py-2.5 leading-relaxed", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(inputBase, "h-11 pr-8", className)} {...rest}>
      {children}
    </select>
  );
});

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "accent" | "warn" | "danger" | "ok"; children: ReactNode; className?: string }) {
  const tones = {
    neutral: "bg-surface-2 text-muted border-line",
    accent: "bg-accent-soft text-accent-text border-transparent",
    warn: "bg-warn-soft text-warn border-transparent",
    danger: "bg-danger-soft text-danger border-transparent",
    ok: "bg-ok-soft text-ok border-transparent",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

export function Card({ children, className, as: As = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <As className={cx("rounded-2xl border border-line bg-surface shadow-soft", className)}>{children}</As>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-4 animate-spin text-muted", className)} aria-label="Loading" />;
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 rounded-2xl bg-surface-2 p-3 text-muted">{icon}</div>}
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {children && <div className="mt-1.5 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-[1.75rem]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-surface-3")}
      >
        <span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5.5" : "translate-x-0.5")} />
      </button>
    </div>
  );
}

/** Accessible modal built on <dialog>: focus trapping, Esc to close, scroll locking for free. */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        "m-auto w-[calc(100%-2rem)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-[2px]",
        wide ? "max-w-2xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="font-display text-lg font-semibold">{title}</h2>
            <IconButton label="Close" size="sm" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function ProgressDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`Step ${current + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cx("h-1.5 rounded-full transition-all", i === current ? "w-6 bg-accent" : i < current ? "w-1.5 bg-accent/60" : "w-1.5 bg-line-strong")} />
      ))}
    </div>
  );
}
