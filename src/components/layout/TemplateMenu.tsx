import { useEffect, useRef, useState } from 'react';
import {
  Building2,
  ChevronDown,
  Globe2,
  Layers,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { NETWORK_TEMPLATES } from '../../data/templates';
import { useNetworkStore } from '../../store/useNetworkStore';
import { cn } from '../../utils/format';

const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  'corporate-office': Building2,
  'broken-network': ShieldAlert,
  'two-site-wan': Globe2,
};

const DIFFICULTY_STYLES = {
  starter: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  intermediate: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
  advanced: 'border-violet-400/25 bg-violet-400/10 text-violet-300',
} as const;

export function TemplateMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadTemplate = useNetworkStore((state) => state.loadTemplate);
  const resetWorkspace = useNetworkStore((state) => state.resetWorkspace);
  const currentName = useNetworkStore((state) => state.topologyName);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn('btn btn-ghost', open && 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200')}
        title="Load a recruiter template"
      >
        <Layers size={14} />
        <span className="hidden xl:inline">Templates</span>
        <ChevronDown size={12} className={cn('transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="panel-surface absolute right-0 top-full z-50 mt-2 w-[360px] animate-slide-up rounded-xl p-2">
          <div className="px-2 pb-2 pt-1">
            <div className="eyebrow">Recruiter scenarios</div>
            <p className="mt-1 text-[10px] text-slate-500">
              One click loads a complete, pre-configured topology.
            </p>
          </div>
          <div className="space-y-1">
            {NETWORK_TEMPLATES.map((template) => {
              const Icon = TEMPLATE_ICONS[template.id] ?? Layers;
              const active = currentName === template.name;
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => {
                    loadTemplate(template.id);
                    setOpen(false);
                  }}
                  className={cn(
                    'group flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition',
                    active
                      ? 'border-cyan-400/30 bg-cyan-400/5'
                      : 'border-transparent hover:border-noc-600 hover:bg-noc-800/80',
                  )}
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-noc-600 bg-noc-850 text-slate-400 group-hover:text-cyan-300">
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[12px] font-semibold text-slate-200">
                        {template.name}
                      </span>
                      <span
                        className={cn(
                          'ml-auto shrink-0 rounded border px-1.5 py-px text-[8px] font-bold uppercase tracking-wider',
                          DIFFICULTY_STYLES[template.difficulty],
                        )}
                      >
                        {template.difficulty}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-snug text-slate-500">
                      {template.description}
                    </span>
                    <span className="mt-1 block font-mono text-[9px] text-slate-600">
                      {template.deviceCount} devices · {template.suggestedSource} → {template.suggestedTarget}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 border-t border-noc-700/70 px-1 pt-2">
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Clear the current topology and start from a blank canvas?')) {
                  resetWorkspace();
                  setOpen(false);
                }
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[10.5px] text-slate-500 transition hover:bg-rose-500/5 hover:text-rose-300"
            >
              <Trash2 size={12} />
              Start from a blank workspace
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
