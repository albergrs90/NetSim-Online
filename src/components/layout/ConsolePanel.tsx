import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Info,
  Search,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useNetworkStore } from '../../store/useNetworkStore';
import type { LogLevel } from '../../types/network';
import { cn, formatClock } from '../../utils/format';

type FilterLevel = 'all' | LogLevel;

const LEVEL_ICON = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
} as const;

const LEVEL_STYLES: Record<LogLevel, { icon: string; text: string; scope: string }> = {
  info: { icon: 'text-slate-500', text: 'text-slate-400', scope: 'text-sky-400/50' },
  success: { icon: 'text-emerald-400', text: 'text-slate-300', scope: 'text-emerald-400/50' },
  warning: { icon: 'text-amber-400', text: 'text-amber-100/80', scope: 'text-amber-400/50' },
  error: { icon: 'text-rose-400', text: 'text-rose-200/90', scope: 'text-rose-400/50' },
};

const FILTERS: Array<{ id: FilterLevel; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'info', label: 'Info' },
  { id: 'success', label: 'Ok' },
  { id: 'warning', label: 'Warn' },
  { id: 'error', label: 'Error' },
];

export function ConsolePanel() {
  const logs = useNetworkStore((state) => state.logs);
  const clearLogs = useNetworkStore((state) => state.clearLogs);
  const showToast = useNetworkStore((state) => state.showToast);
  const [filter, setFilter] = useState<FilterLevel>('all');
  const [query, setQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return logs.filter((entry) => {
      if (filter !== 'all' && entry.level !== filter) return false;
      if (!needle) return true;
      return (
        entry.message.toLowerCase().includes(needle) ||
        entry.scope.toLowerCase().includes(needle) ||
        entry.level.includes(needle)
      );
    });
  }, [logs, filter, query]);

  const counts = useMemo(() => {
    const base: Record<FilterLevel, number> = {
      all: logs.length,
      info: 0,
      success: 0,
      warning: 0,
      error: 0,
    };
    for (const entry of logs) base[entry.level] += 1;
    return base;
  }, [logs]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [filtered.length, filter]);

  function handleCopy() {
    const text = filtered
      .map(
        (entry) =>
          `[${formatClock(entry.timestamp)}] [${entry.scope.toUpperCase()}] ${entry.level.toUpperCase()} — ${entry.message}`,
      )
      .join('\n');
    if (!text) {
      showToast('There are no log lines to copy.', 'info');
      return;
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => showToast(`Copied ${filtered.length} log line(s).`, 'success'))
        .catch(() => showToast('Clipboard access was denied.', 'error'));
    } else {
      showToast('Clipboard is not available in this browser.', 'error');
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-noc-700/70 px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Terminal size={11} className="text-cyan-300" />
            <span className="eyebrow">Event console</span>
            <span className="rounded border border-noc-600 px-1 py-px font-mono text-[8px] text-slate-500">
              {counts.all}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCopy}
              className="icon-btn !h-6 !w-6"
              title="Copy visible logs"
              aria-label="Copy visible logs"
            >
              <Clipboard size={11} />
            </button>
            <button
              type="button"
              onClick={clearLogs}
              className="icon-btn !h-6 !w-6 hover:!border-rose-500/30 hover:!bg-rose-500/10 hover:!text-rose-300"
              title="Clear console"
              aria-label="Clear console"
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>

        <div className="relative mt-2">
          <Search size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-600" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter events…"
            className="w-full rounded-md border border-noc-700 bg-noc-950/70 py-1 pl-6 pr-2 text-[10px] text-slate-300 outline-none transition placeholder:text-slate-600 focus:border-cyan-400/40"
          />
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setFilter(entry.id)}
              className={cn(
                'rounded border px-1.5 py-0.5 text-[8.5px] font-medium transition',
                filter === entry.id
                  ? 'border-cyan-400/35 bg-cyan-400/10 text-cyan-200'
                  : 'border-noc-700 text-slate-500 hover:border-noc-500 hover:text-slate-300',
              )}
            >
              {entry.label}
              <span className="ml-1 font-mono text-[7.5px] opacity-60">{counts[entry.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto font-mono">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Terminal size={20} className="text-slate-700" />
            <div className="text-[10px] text-slate-600">No events match this filter.</div>
            <button
              type="button"
              onClick={() => {
                setFilter('all');
                setQuery('');
              }}
              className="text-[9px] text-cyan-400/70 transition hover:text-cyan-300"
            >
              reset filters
            </button>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            {filtered.map((entry) => {
              const Icon = LEVEL_ICON[entry.level];
              const styles = LEVEL_STYLES[entry.level];
              return (
                <div
                  key={entry.id}
                  className="flex gap-2 px-3 py-1.5 transition hover:bg-white/[0.02]"
                >
                  <span className="w-[52px] shrink-0 pt-px text-[8.5px] text-slate-600">
                    {formatClock(entry.timestamp)}
                  </span>
                  <Icon size={10} className={cn('mt-0.5 shrink-0', styles.icon)} />
                  <div className="min-w-0 flex-1">
                    <span className={cn('mr-1.5 text-[7.5px] uppercase tracking-wider', styles.scope)}>
                      {entry.scope}
                    </span>
                    <span className={cn('break-words text-[9.5px] leading-relaxed', styles.text)}>
                      {entry.message}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-noc-700/70 px-3 py-1.5 text-[8px] uppercase tracking-wider text-slate-600">
        <span className="flex items-center gap-1">
          <span className="live-dot h-1 w-1 rounded-full bg-emerald-400" />
          live tail
        </span>
        <span className="font-mono lowercase">
          {filtered.length}/{logs.length} events
        </span>
      </div>
    </div>
  );
}
