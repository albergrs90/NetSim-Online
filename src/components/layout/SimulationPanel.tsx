import { useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  ChevronRight,
  Clock3,
  GitBranch,
  Gauge,
  Radio,
  Route,
  XCircle,
} from 'lucide-react';
import { useNetworkStore } from '../../store/useNetworkStore';
import { primaryIp } from '../../engine/topology';
import { DEVICE_THEME } from '../deviceTheme';
import type { NetworkHop, SimulationResult } from '../../types/network';
import { cn, formatDateTime, formatMs } from '../../utils/format';

const ROLE_LABEL: Record<NetworkHop['role'], string> = {
  source: 'source',
  switch: 'l2 switch',
  router: 'router',
  destination: 'destination',
  dropped: 'dropped',
};

const ROLE_STYLE: Record<NetworkHop['role'], string> = {
  source: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-300',
  switch: 'border-sky-400/20 bg-sky-400/5 text-sky-300/80',
  router: 'border-violet-400/25 bg-violet-400/10 text-violet-300',
  destination: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  dropped: 'border-rose-400/25 bg-rose-400/10 text-rose-300',
};

function ResultCard({ result }: { result: SimulationResult }) {
  const success = result.success;
  const sourceDevice = useNetworkStore((state) =>
    state.devices.find((device) => device.id === result.sourceId),
  );
  const targetDevice = useNetworkStore((state) =>
    state.devices.find((device) => device.id === result.targetId),
  );

  return (
    <div className="animate-fade-in space-y-3">
      <div
        className={cn(
          'rounded-xl border p-3',
          success
            ? 'border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 to-transparent'
            : 'border-rose-500/25 bg-gradient-to-br from-rose-500/10 to-transparent',
        )}
      >
        <div className="flex items-start gap-2.5">
          <div
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
              success
                ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                : 'border-rose-400/30 bg-rose-400/10 text-rose-300',
            )}
          >
            {success ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-slate-100">
                {success
                  ? result.protocol === 'ping'
                    ? 'Echo reply received'
                    : 'Traceroute complete'
                  : result.protocol === 'ping'
                    ? 'Request failed'
                    : 'Traceroute failed'}
              </span>
              <span
                className={cn(
                  'ml-auto rounded border px-1.5 py-px text-[8px] font-bold uppercase tracking-wider',
                  success
                    ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
                    : 'border-rose-400/25 bg-rose-400/10 text-rose-300',
                )}
              >
                {result.protocol}
              </span>
            </div>
            <p className="mt-1 font-mono text-[9.5px] leading-relaxed text-slate-400">
              {result.message}
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/5 pt-2.5">
          <div>
            <div className="flex items-center gap-1 text-[8px] uppercase tracking-wider text-slate-600">
              <Clock3 size={8} /> rtt
            </div>
            <div
              className={cn(
                'mt-0.5 font-mono text-[13px]',
                success ? 'text-emerald-300' : 'text-rose-300',
              )}
            >
              {success ? formatMs(result.roundTripMs) : 'timeout'}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1 text-[8px] uppercase tracking-wider text-slate-600">
              <GitBranch size={8} /> hops
            </div>
            <div className="mt-0.5 font-mono text-[13px] text-slate-300">{result.hops.length}</div>
          </div>
          <div>
            <div className="flex items-center gap-1 text-[8px] uppercase tracking-wider text-slate-600">
              <Gauge size={8} /> loss
            </div>
            <div
              className={cn(
                'mt-0.5 font-mono text-[13px]',
                success ? 'text-slate-300' : 'text-rose-300',
              )}
            >
              {success ? '0%' : '100%'}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-noc-700/80 bg-noc-850/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="eyebrow">Packet path</span>
          <span className="font-mono text-[8.5px] text-slate-600">
            {sourceDevice?.name ?? result.sourceName} → {targetDevice?.name ?? result.targetName}
          </span>
        </div>

        <ol className="relative">
          {result.hops.map((hop, index) => {
            const theme = DEVICE_THEME[hop.deviceType];
            const Icon = theme.icon;
            const last = index === result.hops.length - 1;
            const dropped = hop.role === 'dropped';
            return (
              <li key={`${hop.deviceId}-${index}`} className="relative flex gap-2.5 pb-3 last:pb-0">
                {!last && (
                  <span
                    className={cn(
                      'absolute left-[11px] top-6 h-[calc(100%-14px)] w-px',
                      dropped || !success
                        ? 'bg-gradient-to-b from-rose-400/30 to-rose-400/10'
                        : 'bg-gradient-to-b from-cyan-400/40 to-cyan-400/10',
                    )}
                  />
                )}
                <span
                  className={cn(
                    'relative z-10 flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-md border',
                    dropped
                      ? 'border-rose-400/30 bg-rose-400/10 text-rose-300'
                      : cn('border-white/5 bg-noc-800', theme.text),
                  )}
                >
                  <Icon size={11} />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10.5px] font-medium text-slate-200">{hop.deviceName}</span>
                    <span
                      className={cn(
                        'rounded border px-1 py-px text-[7.5px] font-semibold uppercase tracking-wider',
                        ROLE_STYLE[hop.role],
                      )}
                    >
                      {ROLE_LABEL[hop.role]}
                    </span>
                    <span className="ml-auto font-mono text-[8.5px] text-slate-500">
                      {dropped ? '—' : `+${hop.latencyMs.toFixed(1)}ms`}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[8.5px]">
                    <span className="text-slate-500">{hop.ip}</span>
                    {index === 0 && <span className="text-cyan-400/60">echo request</span>}
                    {hop.role === 'destination' && <span className="text-emerald-400/60">echo reply</span>}
                  </div>
                  <div className="mt-0.5 truncate text-[8.5px] text-slate-600">{hop.note}</div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {result.details.length > 0 && (
        <details className="group rounded-xl border border-noc-700/80 bg-noc-850/40">
          <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-[9.5px] font-medium text-slate-400 transition hover:text-slate-200">
            <span className="flex items-center gap-1.5">
              <ChevronRight size={10} className="transition group-open:rotate-90" />
              Engine diagnostics · {result.details.length}
            </span>
            <span className="font-mono text-[8px] text-slate-600">
              {formatDateTime(result.timestamp)}
            </span>
          </summary>
          <ul className="space-y-1 border-t border-noc-700/60 px-3 py-2">
            {result.details.map((detail, index) => (
              <li
                key={`${detail}-${index}`}
                className="flex items-start gap-1.5 font-mono text-[8.5px] leading-relaxed text-slate-500"
              >
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-cyan-400/30" />
                {detail}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex items-center justify-between rounded-lg border border-noc-700/60 bg-noc-950/40 px-2.5 py-1.5 font-mono text-[8px] text-slate-600">
        <span>packet {result.packet.id.replace('pkt_', '').slice(0, 8)}</span>
        <span>{result.packet.status.replace('-', ' ')}</span>
      </div>
    </div>
  );
}

export function SimulationPanel() {
  const devices = useNetworkStore((state) => state.devices);
  const simSourceId = useNetworkStore((state) => state.simSourceId);
  const simTargetId = useNetworkStore((state) => state.simTargetId);
  const simulation = useNetworkStore((state) => state.simulation);
  const isSimulating = useNetworkStore((state) => state.isSimulating);
  const setSimulationEndpoint = useNetworkStore((state) => state.setSimulationEndpoint);
  const swapSimulationEndpoints = useNetworkStore((state) => state.swapSimulationEndpoints);
  const runSimulation = useNetworkStore((state) => state.runSimulation);
  const clearSimulation = useNetworkStore((state) => state.clearSimulation);

  const sorted = useMemo(
    () =>
      [...devices].sort((a, b) => {
        const order: Record<string, number> = { router: 0, switch: 1, server: 2, pc: 3 };
        return order[a.type] - order[b.type] || a.name.localeCompare(b.name);
      }),
    [devices],
  );

  const canSimulate = Boolean(simSourceId && simTargetId && simSourceId !== simTargetId);

  return (
    <div className="space-y-3 p-3">
      <div className="rounded-xl border border-noc-700/80 bg-noc-850/40 p-3">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="eyebrow">Simulation endpoints</span>
          <span
            className={cn(
              'rounded border px-1.5 py-px font-mono text-[8px] uppercase tracking-wider',
              isSimulating
                ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300'
                : 'border-noc-600 text-slate-500',
            )}
          >
            {isSimulating ? 'transmitting' : 'idle'}
          </span>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <span className="flex h-6 w-8 shrink-0 items-center justify-center rounded border border-cyan-400/25 bg-cyan-400/10 text-[8px] font-bold text-cyan-300">
              SRC
            </span>
            <select
              value={simSourceId}
              onChange={(event) => setSimulationEndpoint('source', event.target.value)}
              className="field-input !py-1.5 !font-sans text-[11px]"
            >
              <option value="" className="bg-noc-900">
                Select source device…
              </option>
              {sorted.map((device) => (
                <option key={device.id} value={device.id} className="bg-noc-900">
                  {device.name} — {primaryIp(device) || 'no IP'}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-center">
            <button
              type="button"
              onClick={swapSimulationEndpoints}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-noc-600 bg-noc-800 text-slate-500 transition hover:border-cyan-400/40 hover:text-cyan-300"
              title="Swap endpoints"
              aria-label="Swap endpoints"
            >
              <ArrowLeftRight size={10} />
            </button>
          </div>
          <label className="flex items-center gap-2">
            <span className="flex h-6 w-8 shrink-0 items-center justify-center rounded border border-emerald-400/25 bg-emerald-400/10 text-[8px] font-bold text-emerald-300">
              DST
            </span>
            <select
              value={simTargetId}
              onChange={(event) => setSimulationEndpoint('target', event.target.value)}
              className="field-input !py-1.5 !font-sans text-[11px]"
            >
              <option value="" className="bg-noc-900">
                Select destination device…
              </option>
              {sorted.map((device) => (
                <option key={device.id} value={device.id} className="bg-noc-900">
                  {device.name} — {primaryIp(device) || 'no IP'}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => runSimulation('ping')}
            disabled={!canSimulate || isSimulating}
            className="btn btn-primary"
          >
            <Radio size={13} />
            Run ping
          </button>
          <button
            type="button"
            onClick={() => runSimulation('traceroute')}
            disabled={!canSimulate || isSimulating}
            className="btn btn-ghost"
          >
            <Route size={13} />
            Traceroute
          </button>
        </div>
        {!canSimulate && (
          <p className="mt-2 flex items-start gap-1 text-[9px] leading-snug text-slate-600">
            <AlertTriangle size={9} className="mt-0.5 shrink-0" />
            Choose two different devices to enable the simulation controls.
          </p>
        )}
      </div>

      {isSimulating && (
        <div className="flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-[10px] text-cyan-200/80">
          <Activity size={12} className="spin-slow text-cyan-300" />
          Packet traversing the canvas — watch the cable animation.
        </div>
      )}

      {simulation ? (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="eyebrow">Latest result</span>
            <button
              type="button"
              onClick={clearSimulation}
              className="text-[9px] text-slate-600 transition hover:text-rose-300"
            >
              clear
            </button>
          </div>
          <ResultCard result={simulation} />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-noc-600 bg-noc-850/20 px-4 py-7 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-noc-600 bg-noc-800 text-slate-500">
            <Activity size={18} />
          </div>
          <div className="mt-3 text-[11px] font-medium text-slate-300">No simulation yet</div>
          <p className="mx-auto mt-1 max-w-[240px] text-[9.5px] leading-relaxed text-slate-600">
            Pick two devices and run a ping. The engine resolves subnets, gateways and routing
            tables, then animates the request and reply along the exact cable path.
          </p>
          <div className="mx-auto mt-3 flex max-w-[230px] flex-col gap-1 text-left font-mono text-[8.5px] text-slate-600">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={9} className="text-emerald-400/60" /> same subnet → layer-2 path
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={9} className="text-cyan-400/60" /> cross subnet → routed path
            </span>
            <span className="flex items-center gap-1.5">
              <XCircle size={9} className="text-rose-400/60" /> cut cable → request timed out
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
