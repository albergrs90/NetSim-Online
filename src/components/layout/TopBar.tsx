import { useRef, type ChangeEvent } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  Download,
  Network,
  Radio,
  RotateCcw,
  Route,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { useNetworkStore } from '../../store/useNetworkStore';
import { useNetworkHealth } from '../../hooks/useNetworkHealth';
import { primaryIp } from '../../engine/topology';
import { downloadTopology, parseTopologyFile, readFileAsText } from '../../data/persistence';
import { TemplateMenu } from './TemplateMenu';
import { cn } from '../../utils/format';

export function TopBar() {
  const devices = useNetworkStore((state) => state.devices);
  const connections = useNetworkStore((state) => state.connections);
  const topologyName = useNetworkStore((state) => state.topologyName);
  const simSourceId = useNetworkStore((state) => state.simSourceId);
  const simTargetId = useNetworkStore((state) => state.simTargetId);
  const isSimulating = useNetworkStore((state) => state.isSimulating);
  const setSimulationEndpoint = useNetworkStore((state) => state.setSimulationEndpoint);
  const swapSimulationEndpoints = useNetworkStore((state) => state.swapSimulationEndpoints);
  const runSimulation = useNetworkStore((state) => state.runSimulation);
  const importTopology = useNetworkStore((state) => state.importTopology);
  const resetWorkspace = useNetworkStore((state) => state.resetWorkspace);
  const showToast = useNetworkStore((state) => state.showToast);
  const addLog = useNetworkStore((state) => state.addLog);
  const health = useNetworkHealth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSimulate = Boolean(simSourceId && simTargetId && simSourceId !== simTargetId);

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const result = parseTopologyFile(text);
      if (!result.ok) {
        addLog('error', 'persistence', `Import failed: ${result.error}`);
        showToast(result.error, 'error');
        return;
      }
      importTopology(result.topology.name, result.topology.devices, result.topology.connections);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read the file.';
      addLog('error', 'persistence', `Import failed: ${message}`);
      showToast(message, 'error');
    } finally {
      event.target.value = '';
    }
  }

  function handleExport() {
    try {
      const filename = downloadTopology(devices, connections, topologyName);
      addLog('success', 'persistence', `Topology exported as ${filename}.`);
      showToast(`Exported ${filename}.`, 'success');
    } catch {
      showToast('Export failed. Check your browser download settings.', 'error');
      addLog('error', 'persistence', 'Export failed.');
    }
  }

  function handleReset() {
    if (window.confirm('Clear the current topology? This cannot be undone unless you exported it.')) {
      resetWorkspace();
    }
  }

  return (
    <header className="relative z-30 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-noc-700/70 bg-noc-900/80 px-3 py-2 shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl lg:px-4 xl:h-[62px] xl:flex-nowrap xl:gap-3 xl:py-0">
      <div className="flex shrink-0 items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/30 bg-gradient-to-br from-cyan-400/20 via-noc-800 to-emerald-400/10 shadow-glow">
          <Network size={19} className="text-cyan-300" strokeWidth={1.9} />
        </div>
        <div className="hidden leading-none min-[430px]:block">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[13px] font-bold tracking-[0.16em] text-white">NETSIM</span>
            <span className="text-[13px] font-light tracking-[0.16em] text-cyan-300">ONLINE</span>
          </div>
          <div className="mt-1 text-[8px] font-medium uppercase tracking-[0.24em] text-slate-500">
            network operations center
          </div>
        </div>
      </div>

      <div className="hidden h-8 w-px shrink-0 bg-noc-700/80 lg:block" />

      <div className="order-3 flex w-full min-w-0 items-center justify-center xl:order-none xl:w-auto xl:flex-1">
        <div className="panel-surface flex min-w-0 items-center gap-1 rounded-xl p-1">
          <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-noc-700/80 bg-noc-950/70 px-2 py-1">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-cyan-400/10 text-[9px] font-bold text-cyan-300">
              SRC
            </span>
            <select
              aria-label="Simulation source"
              value={simSourceId}
              onChange={(event) => setSimulationEndpoint('source', event.target.value)}
              className="w-[112px] cursor-pointer appearance-none bg-transparent text-[11px] text-slate-200 outline-none 2xl:w-[144px]"
            >
              <option value="" className="bg-noc-900">
                Source device
              </option>
              {devices.map((device) => (
                <option key={device.id} value={device.id} className="bg-noc-900 text-slate-200">
                  {device.name}
                  {primaryIp(device) ? ` · ${primaryIp(device)}` : ''}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={swapSimulationEndpoints}
            className="icon-btn !h-7 !w-7 shrink-0"
            title="Swap source and destination"
            aria-label="Swap source and destination"
          >
            <ArrowLeftRight size={12} />
          </button>

          <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-noc-700/80 bg-noc-950/70 px-2 py-1">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-emerald-400/10 text-[9px] font-bold text-emerald-300">
              DST
            </span>
            <select
              aria-label="Simulation destination"
              value={simTargetId}
              onChange={(event) => setSimulationEndpoint('target', event.target.value)}
              className="w-[112px] cursor-pointer appearance-none bg-transparent text-[11px] text-slate-200 outline-none 2xl:w-[144px]"
            >
              <option value="" className="bg-noc-900">
                Destination
              </option>
              {devices.map((device) => (
                <option key={device.id} value={device.id} className="bg-noc-900 text-slate-200">
                  {device.name}
                  {primaryIp(device) ? ` · ${primaryIp(device)}` : ''}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => runSimulation('ping')}
            disabled={!canSimulate || isSimulating}
            className="btn btn-primary !h-8 shrink-0 !px-2.5"
            title="Send an ICMP echo request"
          >
            <Radio size={13} />
            <span className="hidden md:inline">Ping</span>
          </button>
          <button
            type="button"
            onClick={() => runSimulation('traceroute')}
            disabled={!canSimulate || isSimulating}
            className="btn btn-ghost !h-8 shrink-0 !px-2.5"
            title="Trace the routed path hop by hop"
          >
            <Route size={13} />
            <span className="hidden 2xl:inline">Traceroute</span>
          </button>
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {health.conflicts.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              const conflict = health.conflicts[0];
              showToast(
                `IP conflict: ${conflict.ip} on ${conflict.a.deviceName} and ${conflict.b.deviceName}.`,
                'error',
              );
            }}
            className="flex items-center gap-1.5 rounded-lg border border-rose-500/35 bg-rose-500/10 px-2.5 py-1.5 text-[10px] font-semibold text-rose-300 transition hover:bg-rose-500/20"
            title={health.conflicts
              .map((conflict) => `${conflict.ip}: ${conflict.a.deviceName} / ${conflict.b.deviceName}`)
              .join('\n')}
          >
            <ShieldAlert size={13} />
            <span className="hidden sm:inline">
              {health.conflicts.length} conflict{health.conflicts.length > 1 ? 's' : ''}
            </span>
            <span className="sm:hidden">{health.conflicts.length}</span>
          </button>
        ) : (
          <span
            className="hidden items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5 text-[10px] font-semibold text-emerald-300 sm:flex"
            title="No IP conflicts detected in any broadcast domain"
          >
            <ShieldCheck size={13} />
            healthy
          </span>
        )}

        <span className="mx-0.5 hidden h-6 w-px bg-noc-700/80 sm:block" />

        <TemplateMenu />

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            void handleImport(event);
          }}
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="icon-btn"
          title="Import topology (.json)"
          aria-label="Import topology"
        >
          <Upload size={15} />
        </button>
        <button
          type="button"
          onClick={handleExport}
          className="icon-btn"
          title="Export topology (.json)"
          aria-label="Export topology"
        >
          <Download size={15} />
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="icon-btn hover:!border-rose-500/30 hover:!bg-rose-500/10 hover:!text-rose-300"
          title="Reset workspace"
          aria-label="Reset workspace"
        >
          <RotateCcw size={15} />
        </button>

        <span
          className={cn(
            'ml-1 hidden items-center gap-1 rounded border px-1.5 py-1 font-mono text-[8px] uppercase tracking-wider xl:flex',
            isSimulating
              ? 'border-cyan-400/30 text-cyan-300'
              : 'border-noc-600 text-slate-500',
          )}
          title="Simulation engine status"
        >
          <CheckCircle2 size={9} />
          {isSimulating ? 'tx' : 'ready'}
        </span>
      </div>
    </header>
  );
}
