import { Activity, AlertTriangle, SlidersHorizontal, Terminal } from 'lucide-react';
import { useNetworkStore } from '../../store/useNetworkStore';
import { useNetworkHealth } from '../../hooks/useNetworkHealth';
import { Inspector } from './Inspector';
import { SimulationPanel } from './SimulationPanel';
import { ConsolePanel } from './ConsolePanel';
import { cn } from '../../utils/format';
import type { PanelTab } from '../../types/network';

const TABS: Array<{ id: PanelTab; label: string; icon: typeof SlidersHorizontal }> = [
  { id: 'inspector', label: 'Inspector', icon: SlidersHorizontal },
  { id: 'simulation', label: 'Simulation', icon: Activity },
  { id: 'console', label: 'Console', icon: Terminal },
];

export function RightPanel() {
  const panel = useNetworkStore((state) => state.panel);
  const setPanel = useNetworkStore((state) => state.setPanel);
  const simulation = useNetworkStore((state) => state.simulation);
  const logs = useNetworkStore((state) => state.logs);
  const isSimulating = useNetworkStore((state) => state.isSimulating);
  const health = useNetworkHealth();

  const errorCount = logs.filter((entry) => entry.level === 'error').length;
  const warningCount = logs.filter((entry) => entry.level === 'warning').length;

  return (
    <aside className="hidden w-[352px] shrink-0 flex-col border-l border-noc-700/70 bg-noc-900/55 lg:flex xl:w-[392px]">
      <div className="flex shrink-0 items-center gap-0.5 border-b border-noc-700/70 px-2 py-1.5">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = panel === tab.id;
          const alertBadge =
            tab.id === 'inspector'
              ? health.conflicts.length
              : tab.id === 'console'
                ? errorCount + warningCount
                : 0;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPanel(tab.id)}
              className={cn(
                'relative flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[10.5px] font-medium transition',
                active
                  ? 'bg-noc-750/80 text-slate-100'
                  : 'text-slate-500 hover:bg-noc-800/60 hover:text-slate-300',
              )}
            >
              <Icon size={12} className={active ? 'text-cyan-300' : undefined} />
              {tab.label}
              {tab.id === 'simulation' && simulation && (
                <span
                  className={cn(
                    'h-1 w-1 rounded-full',
                    simulation.success ? 'bg-emerald-400' : 'bg-rose-400',
                  )}
                />
              )}
              {tab.id === 'simulation' && isSimulating && (
                <span className="h-1 w-1 animate-pulse rounded-full bg-cyan-400" />
              )}
              {alertBadge > 0 && tab.id !== 'simulation' && (
                <span
                  className={cn(
                    'flex min-w-[14px] items-center justify-center rounded-full px-1 py-px font-mono text-[7.5px]',
                    tab.id === 'inspector'
                      ? 'bg-rose-500/20 text-rose-300'
                      : 'bg-amber-500/15 text-amber-300',
                  )}
                >
                  {alertBadge > 99 ? '99+' : alertBadge}
                </span>
              )}
              {active && (
                <span className="absolute inset-x-3 -bottom-[7px] h-px bg-gradient-to-r from-transparent via-cyan-400/70 to-transparent" />
              )}
            </button>
          );
        })}
      </div>

      <div
        className={cn(
          'min-h-0 flex-1',
          panel === 'console' ? 'overflow-hidden' : 'overflow-y-auto',
        )}
      >
        {panel === 'inspector' && <Inspector />}
        {panel === 'simulation' && <SimulationPanel />}
        {panel === 'console' && <ConsolePanel />}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-noc-700/70 px-3 py-1.5 text-[8px] uppercase tracking-wider text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="h-1 w-1 rounded-full bg-emerald-400" />
          engine online
        </span>
        <span className="flex items-center gap-1">
          {health.conflicts.length > 0 ? (
            <>
              <AlertTriangle size={8} className="text-rose-400" />
              <span className="text-rose-400/80">{health.conflicts.length} conflict</span>
            </>
          ) : (
            <span>{health.totalLinks} links monitored</span>
          )}
        </span>
      </div>
    </aside>
  );
}
