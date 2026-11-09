import { useMemo } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  AlertTriangle,
  ArrowDownToLine,
  Cable,
  CircleDot,
  GripVertical,
  Plus,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { DEVICE_META, DEVICE_TYPES } from '../../data/deviceFactory';
import { DEVICE_THEME } from '../deviceTheme';
import { useNetworkStore } from '../../store/useNetworkStore';
import { useNetworkHealth } from '../../hooks/useNetworkHealth';
import { getInterfaceCidr } from '../../engine/ip';
import { cn } from '../../utils/format';
import type { DeviceType } from '../../types/network';

function StatRow({
  label,
  value,
  hint,
  tone,
  progress,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: 'green' | 'cyan' | 'red' | 'slate';
  progress?: number;
}) {
  const toneClass = {
    green: 'text-emerald-300',
    cyan: 'text-cyan-300',
    red: 'text-rose-300',
    slate: 'text-slate-300',
  }[tone];
  const barClass = {
    green: 'bg-emerald-400',
    cyan: 'bg-cyan-400',
    red: 'bg-rose-400',
    slate: 'bg-slate-500',
  }[tone];

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] text-slate-500">{label}</span>
        <span className={cn('font-mono text-[11px] font-medium', toneClass)}>{value}</span>
      </div>
      {typeof progress === 'number' && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-noc-750">
          <div
            className={cn('h-full rounded-full transition-all duration-500', barClass)}
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      )}
      {hint && <div className="mt-0.5 text-[9px] text-slate-600">{hint}</div>}
    </div>
  );
}

export function Palette() {
  const devices = useNetworkStore((state) => state.devices);
  const addDevice = useNetworkStore((state) => state.addDevice);
  const health = useNetworkHealth();
  const { screenToFlowPosition } = useReactFlow();

  const subnetCount = useMemo(() => {
    const subnets = new Set<string>();
    for (const device of devices) {
      for (const iface of device.interfaces) {
        const cidr = getInterfaceCidr(iface);
        if (cidr) subnets.add(cidr);
      }
    }
    return subnets.size;
  }, [devices]);

  const alertCount = Object.values(health.deviceAlerts).reduce(
    (total, alerts) => total + alerts.length,
    0,
  );

  function handleQuickAdd(type: DeviceType) {
    const center = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const jitter = (devices.length % 5) * 22;
    addDevice(type, { x: center.x - 109 + jitter, y: center.y - 70 + jitter });
  }

  return (
    <aside className="hidden w-[232px] shrink-0 flex-col border-r border-noc-700/70 bg-noc-900/55 md:flex lg:w-[232px] xl:w-[252px]">
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <section>
          <div className="flex items-center justify-between">
            <span className="eyebrow">Component palette</span>
            <span className="flex items-center gap-1 text-[9px] text-slate-600">
              <GripVertical size={10} />
              drag
            </span>
          </div>
          <div className="mt-2 space-y-1.5">
            {DEVICE_TYPES.map((type) => {
              const meta = DEVICE_META[type];
              const theme = DEVICE_THEME[type];
              const Icon = theme.icon;
              return (
                <button
                  key={type}
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('application/netsim-device', type);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => handleQuickAdd(type)}
                  className={cn(
                    'group flex w-full cursor-grab items-center gap-2.5 rounded-lg border border-noc-700/80 bg-noc-850/70 p-2.5 text-left transition',
                    'hover:border-noc-500 hover:bg-noc-800 active:cursor-grabbing',
                  )}
                  title={`${meta.description} — click to add, or drag onto the canvas.`}
                >
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                      theme.bg,
                      theme.border,
                      theme.text,
                    )}
                  >
                    <Icon size={15} strokeWidth={1.9} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-1">
                      <span className="text-[12px] font-semibold text-slate-200">{meta.label}</span>
                      <Plus
                        size={11}
                        className="text-slate-600 transition group-hover:text-cyan-300"
                      />
                    </span>
                    <span className="mt-0.5 block truncate text-[9.5px] text-slate-500">
                      {meta.tagline}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-noc-700/70 bg-noc-850/50 p-3">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="eyebrow">Network overview</span>
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                health.conflicts.length > 0 ? 'bg-rose-400' : 'bg-emerald-400',
              )}
            />
          </div>
          <div className="space-y-2.5">
            <StatRow
              label="Devices online"
              value={`${health.onlineDevices}/${health.totalDevices}`}
              tone="green"
              progress={health.totalDevices === 0 ? 0 : (health.onlineDevices / health.totalDevices) * 100}
            />
            <StatRow
              label="Links up"
              value={`${health.activeLinks}/${health.totalLinks}`}
              tone={health.activeLinks === health.totalLinks ? 'cyan' : 'red'}
              progress={health.totalLinks === 0 ? 0 : (health.activeLinks / health.totalLinks) * 100}
            />
            <StatRow
              label="Subnets"
              value={String(subnetCount)}
              tone="slate"
              hint={`${health.broadcastDomains.length} broadcast domain${
                health.broadcastDomains.length === 1 ? '' : 's'
              }`}
            />
            <StatRow
              label="IP conflicts"
              value={String(health.conflicts.length)}
              tone={health.conflicts.length > 0 ? 'red' : 'green'}
            />
          </div>
        </section>

        {health.conflicts.length > 0 ? (
          <section className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-rose-300">
              <AlertTriangle size={12} />
              Needs attention
            </div>
            <ul className="mt-2 space-y-1.5">
              {health.conflicts.slice(0, 2).map((conflict) => (
                <li key={`${conflict.ip}-${conflict.a.deviceId}-${conflict.b.deviceId}`} className="text-[9.5px] leading-snug text-rose-200/70">
                  <span className="font-mono text-rose-300">{conflict.ip}</span> shared by{' '}
                  {conflict.a.deviceName} and {conflict.b.deviceName}
                </li>
              ))}
            </ul>
          </section>
        ) : alertCount > 0 ? (
          <section className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-300">
              <AlertTriangle size={12} />
              {alertCount} configuration warning{alertCount === 1 ? '' : 's'}
            </div>
            <p className="mt-1 text-[9.5px] leading-snug text-amber-200/60">
              Select a device to review its interface configuration.
            </p>
          </section>
        ) : (
          <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-300">
              <ShieldCheck size={12} />
              Network healthy
            </div>
            <p className="mt-1 text-[9.5px] leading-snug text-emerald-200/50">
              No IP conflicts, invalid masks or offline devices detected.
            </p>
          </section>
        )}

        <section className="rounded-xl border border-noc-700/70 bg-noc-850/40 p-3">
          <div className="flex items-center gap-1.5">
            <Sparkles size={11} className="text-cyan-300" />
            <span className="eyebrow">Quick workflow</span>
          </div>
          <ol className="mt-2 space-y-2">
            {[
              ['Drop devices', 'Drag or click a component to place it.'],
              ['Cable ports', 'Drag from a port pill to another device.'],
              ['Configure L3', 'Select a device and edit IP / mask / gateway.'],
              ['Simulate', 'Choose SRC + DST, then run Ping or Traceroute.'],
            ].map(([title, hint], index) => (
              <li key={title} className="flex gap-2">
                <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-noc-600 bg-noc-900 font-mono text-[8px] text-cyan-300">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[10px] font-medium text-slate-300">{title}</span>
                  <span className="block text-[9px] leading-snug text-slate-600">{hint}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <div className="flex items-center justify-between rounded-lg border border-dashed border-noc-700/70 px-2.5 py-2 text-[9px] text-slate-600">
          <span className="flex items-center gap-1">
            <Cable size={10} /> Del removes selection
          </span>
          <span className="flex items-center gap-1">
            <CircleDot size={9} /> v1.0
          </span>
        </div>
      </div>

      <div className="border-t border-noc-700/70 px-3 py-2">
        <div className="flex items-center gap-1.5 text-[8.5px] uppercase tracking-wider text-slate-600">
          <ArrowDownToLine size={9} />
          React Flow · Zustand · Tailwind
        </div>
      </div>
    </aside>
  );
}
