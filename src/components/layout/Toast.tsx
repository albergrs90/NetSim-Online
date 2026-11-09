import { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useNetworkStore } from '../../store/useNetworkStore';
import { cn } from '../../utils/format';

const TONE_ICON = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
} as const;

const TONE_STYLE = {
  success: 'border-emerald-500/35 bg-noc-900/95 text-emerald-200',
  error: 'border-rose-500/40 bg-noc-900/95 text-rose-200',
  info: 'border-cyan-500/30 bg-noc-900/95 text-cyan-200',
} as const;

export function Toast() {
  const toast = useNetworkStore((state) => state.toast);
  const dismissToast = useNetworkStore((state) => state.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => dismissToast(), 4800);
    return () => window.clearTimeout(timer);
  }, [toast, dismissToast]);

  if (!toast) return null;
  const Icon = TONE_ICON[toast.tone];

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[100] w-[min(92vw,380px)]">
      <div
        key={toast.id}
        className={cn(
          'pointer-events-auto flex animate-slide-up items-start gap-2.5 rounded-xl border px-3 py-2.5 shadow-panel backdrop-blur-xl',
          TONE_STYLE[toast.tone],
        )}
        role="status"
      >
        <Icon size={15} className="mt-0.5 shrink-0" />
        <p className="min-w-0 flex-1 text-[11px] leading-relaxed">{toast.message}</p>
        <button
          type="button"
          onClick={dismissToast}
          className="rounded p-0.5 text-slate-500 transition hover:bg-white/5 hover:text-slate-200"
          aria-label="Dismiss notification"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
