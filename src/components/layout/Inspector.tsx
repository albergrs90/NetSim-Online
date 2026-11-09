import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Cable,
  Check,
  ChevronDown,
  Cpu,
  Globe2,
  Layers,
  Link2,
  MousePointerClick,
  Plus,
  Power,
  Route,
  Scissors,
  ShieldAlert,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import type { Connection, Device, DeviceType, NetworkInterface } from '../../types/network';
import { useNetworkStore } from '../../store/useNetworkStore';
import { useNetworkHealth } from '../../hooks/useNetworkHealth';
import { DEVICE_META } from '../../data/deviceFactory';
import { DEVICE_THEME } from '../deviceTheme';
import {
  describeNetwork,
  getBroadcastAddress,
  isValidIPv4,
  maskToPrefixLength,
  parseCidr,
  validateInterface,
} from '../../engine/ip';
import { buildRoutingTable } from '../../engine/routing';
import { primaryIp } from '../../engine/topology';
import { cn, formatMs } from '../../utils/format';

const TYPE_ORDER: Record<DeviceType, number> = { router: 0, switch: 1, server: 2, pc: 3 };

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function SectionTitle({
  icon: Icon,
  title,
  action,
}: {
  icon: typeof Layers;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <Icon size={11} className="text-slate-500" />
        <span className="eyebrow">{title}</span>
      </div>
      {action}
    </div>
  );
}

function PowerToggle({ device }: { device: Device }) {
  const toggleDevicePower = useNetworkStore((state) => state.toggleDevicePower);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={device.isOnline}
      onClick={() => toggleDevicePower(device.id)}
      className={cn(
        'flex items-center gap-2 rounded-lg border px-2 py-1.5 transition',
        device.isOnline
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'
          : 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/15',
      )}
      title="Toggle device power — connectivity is recalculated immediately"
    >
      <Power size={12} />
      <span className="text-[10px] font-semibold">{device.isOnline ? 'ONLINE' : 'OFFLINE'}</span>
      <span
        className={cn(
          'relative h-3.5 w-6 rounded-full border transition',
          device.isOnline ? 'border-emerald-400/40 bg-emerald-400/20' : 'border-rose-400/40 bg-rose-400/10',
        )}
      >
        <span
          className={cn(
            'absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full transition-all',
            device.isOnline ? 'left-3 bg-emerald-300' : 'left-0.5 bg-rose-300',
          )}
        />
      </span>
    </button>
  );
}

function InterfaceEditor({ device, iface }: { device: Device; iface: NetworkInterface }) {
  const updateInterface = useNetworkStore((state) => state.updateInterface);
  const removeInterface = useNetworkStore((state) => state.removeInterface);
  const issues = validateInterface(iface);
  const network = describeNetwork(iface.ipAddress, iface.subnetMask);
  const prefix = maskToPrefixLength(iface.subnetMask);
  const broadcast =
    iface.ipAddress && prefix >= 0 ? getBroadcastAddress(iface.ipAddress, iface.subnetMask) : '';

  const fieldClass = (field: 'ipAddress' | 'subnetMask' | 'gateway' | 'macAddress') => {
    const issue = issues.find((candidate) => candidate.field === field);
    return cn(
      'field-input',
      issue?.level === 'error' && 'field-input-error',
      issue?.level === 'warning' && 'border-amber-400/50',
    );
  };

  return (
    <div className="rounded-xl border border-noc-700/80 bg-noc-850/50 p-3">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-noc-750 text-slate-400">
            <Link2 size={10} />
          </span>
          <span className="font-mono text-[10.5px] font-medium text-slate-300">{iface.name}</span>
          <span className="rounded border border-noc-600 px-1 py-px text-[8px] uppercase tracking-wider text-slate-500">
            {device.type === 'router' ? 'routed' : device.type === 'switch' ? 'l2' : 'access'}
          </span>
        </div>
        {device.interfaces.length > 1 && (
          <button
            type="button"
            onClick={() => removeInterface(device.id, iface.id)}
            className="icon-btn !h-6 !w-6 hover:!border-rose-500/30 hover:!bg-rose-500/10 hover:!text-rose-300"
            title="Remove interface"
            aria-label="Remove interface"
          >
            <X size={11} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="field-label">IPv4 address</span>
          <input
            value={iface.ipAddress}
            onChange={(event) =>
              updateInterface(device.id, iface.id, { ipAddress: event.target.value })
            }
            placeholder="192.168.1.10"
            spellCheck={false}
            className={fieldClass('ipAddress')}
          />
        </label>
        <label className="block">
          <span className="field-label">Subnet mask</span>
          <input
            value={iface.subnetMask}
            onChange={(event) =>
              updateInterface(device.id, iface.id, { subnetMask: event.target.value })
            }
            placeholder="255.255.255.0"
            spellCheck={false}
            className={fieldClass('subnetMask')}
          />
        </label>
        <label className="block">
          <span className="field-label">Default gateway</span>
          <input
            value={iface.gateway}
            onChange={(event) =>
              updateInterface(device.id, iface.id, { gateway: event.target.value })
            }
            placeholder={device.type === 'router' ? 'n/a' : '192.168.1.1'}
            spellCheck={false}
            className={fieldClass('gateway')}
          />
        </label>
        <label className="block">
          <span className="field-label">MAC address</span>
          <input
            value={iface.macAddress}
            onChange={(event) =>
              updateInterface(device.id, iface.id, { macAddress: event.target.value })
            }
            placeholder="02:42:ac:11:00:0a"
            spellCheck={false}
            className={fieldClass('macAddress')}
          />
        </label>
      </div>

      {issues.length > 0 && (
        <ul className="mt-2 space-y-1">
          {issues.map((issue) => (
            <li
              key={`${issue.field}-${issue.message}`}
              className={cn(
                'flex items-start gap-1 text-[9.5px] leading-snug',
                issue.level === 'error' ? 'text-rose-400' : 'text-amber-400/90',
              )}
            >
              <AlertTriangle size={9} className="mt-0.5 shrink-0" />
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/5 pt-2 font-mono text-[9px] text-slate-500">
        <span>
          net <span className={network !== '—' ? 'text-cyan-300/80' : 'text-slate-600'}>{network}</span>
        </span>
        <span>
          mask <span className="text-slate-400">/{prefix >= 0 ? prefix : '—'}</span>
        </span>
        {broadcast && prefix < 30 && (
          <span>
            bcast <span className="text-slate-500">{broadcast}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function RoutingTable({ device }: { device: Device }) {
  const addRoutingEntry = useNetworkStore((state) => state.addRoutingEntry);
  const removeRoutingEntry = useNetworkStore((state) => state.removeRoutingEntry);
  const [showForm, setShowForm] = useState(false);
  const [destination, setDestination] = useState('');
  const [nextHop, setNextHop] = useState('');
  const [metric, setMetric] = useState('10');
  const [interfaceName, setInterfaceName] = useState(device.interfaces[0]?.name ?? 'eth0');
  const [error, setError] = useState('');

  useEffect(() => {
    setInterfaceName(device.interfaces[0]?.name ?? 'eth0');
    setShowForm(false);
    setError('');
  }, [device.id, device.interfaces]);

  const table = useMemo(() => buildRoutingTable(device), [device]);

  function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (!parseCidr(destination)) {
      setError('Destination must be a valid CIDR (e.g. 10.0.0.0/24).');
      return;
    }
    if (!isValidIPv4(nextHop)) {
      setError('Next hop must be a valid IPv4 address.');
      return;
    }
    const metricValue = Number(metric);
    if (!Number.isFinite(metricValue) || metricValue < 0) {
      setError('Metric must be a non-negative number.');
      return;
    }
    addRoutingEntry(device.id, {
      destinationCidr: destination.trim(),
      nextHop: nextHop.trim(),
      interfaceName,
      metric: metricValue,
    });
    setDestination('');
    setNextHop('');
    setError('');
    setShowForm(false);
  }

  return (
    <section>
      <SectionTitle
        icon={Route}
        title="Routing table"
        action={
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="flex items-center gap-1 text-[9px] text-cyan-400/80 transition hover:text-cyan-300"
          >
            <Plus size={10} />
            static route
          </button>
        }
      />

      <div className="overflow-hidden rounded-xl border border-noc-700/80 bg-noc-850/40">
        <div className="grid grid-cols-[1fr_auto] gap-2 border-b border-noc-700/70 bg-noc-900/60 px-2.5 py-1.5 text-[8px] uppercase tracking-wider text-slate-600">
          <span>destination</span>
          <span>via</span>
        </div>
        {table.length === 0 ? (
          <div className="px-3 py-3 text-[9.5px] text-slate-600">
            No routes yet. Configure an interface to create connected routes.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {table.map((route) => (
              <div
                key={route.id}
                className="group grid grid-cols-[1fr_auto] items-center gap-2 px-2.5 py-1.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'rounded px-1 py-px font-mono text-[7.5px] uppercase',
                        route.type === 'connected'
                          ? 'bg-emerald-400/10 text-emerald-300/80'
                          : 'bg-amber-400/10 text-amber-300/80',
                      )}
                    >
                      {route.type === 'connected' ? 'C' : 'S'}
                    </span>
                    <span className="truncate font-mono text-[10px] text-slate-200">
                      {route.destinationCidr}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[8.5px] text-slate-600">
                    metric {route.metric}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <div className="text-right">
                    <div className="font-mono text-[9px] text-slate-400">
                      {route.type === 'connected' ? 'direct' : route.nextHop}
                    </div>
                    <div className="font-mono text-[8px] text-slate-600">{route.interfaceName}</div>
                  </div>
                  {route.type === 'static' && (
                    <button
                      type="button"
                      onClick={() => removeRoutingEntry(device.id, route.id)}
                      className="rounded p-0.5 text-slate-600 opacity-0 transition hover:bg-rose-500/10 hover:text-rose-300 group-hover:opacity-100"
                      title="Remove static route"
                      aria-label="Remove static route"
                    >
                      <X size={9} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {showForm && (
          <form onSubmit={handleAdd} className="space-y-2 border-t border-noc-700/70 bg-noc-900/50 p-2.5">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="field-label">Destination CIDR</span>
                <input
                  value={destination}
                  onChange={(event) => setDestination(event.target.value)}
                  placeholder="0.0.0.0/0"
                  className="field-input"
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="field-label">Next hop</span>
                <input
                  value={nextHop}
                  onChange={(event) => setNextHop(event.target.value)}
                  placeholder="10.0.0.2"
                  className="field-input"
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="field-label">Interface</span>
                <select
                  value={interfaceName}
                  onChange={(event) => setInterfaceName(event.target.value)}
                  className="field-input !py-1.5 text-[11px]"
                >
                  {device.interfaces.map((iface) => (
                    <option key={iface.id} value={iface.name} className="bg-noc-900">
                      {iface.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="field-label">Metric</span>
                <input
                  value={metric}
                  onChange={(event) => setMetric(event.target.value)}
                  className="field-input"
                  inputMode="numeric"
                />
              </label>
            </div>
            {error && <div className="text-[9px] text-rose-400">{error}</div>}
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setError('');
                }}
                className="btn btn-ghost !px-2 !py-1 text-[10px]"
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary !px-2 !py-1 text-[10px]">
                <Check size={10} /> Add route
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

function DeviceInspector({ device }: { device: Device }) {
  const updateDeviceName = useNetworkStore((state) => state.updateDeviceName);
  const updateDeviceDescription = useNetworkStore((state) => state.updateDeviceDescription);
  const addInterface = useNetworkStore((state) => state.addInterface);
  const deleteDevice = useNetworkStore((state) => state.deleteDevice);
  const health = useNetworkHealth();
  const [nameDraft, setNameDraft] = useState(device.name);
  const [descriptionDraft, setDescriptionDraft] = useState(device.description ?? '');

  useEffect(() => {
    setNameDraft(device.name);
    setDescriptionDraft(device.description ?? '');
  }, [device.id, device.name, device.description]);

  const theme = DEVICE_THEME[device.type];
  const meta = DEVICE_META[device.type];
  const Icon = theme.icon;
  const alerts = health.deviceAlerts[device.id] ?? [];

  function commitName() {
    const next = nameDraft.trim();
    if (next && next !== device.name) updateDeviceName(device.id, next);
    else setNameDraft(device.name);
  }

  return (
    <div className="space-y-4 p-3">
      <div className="rounded-xl border border-noc-700/80 bg-gradient-to-br from-noc-800/80 to-noc-900/60 p-3">
        <div className="flex items-start gap-2.5">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
              theme.bg,
              theme.border,
              theme.text,
            )}
          >
            <Icon size={18} strokeWidth={1.9} />
          </div>
          <div className="min-w-0 flex-1">
            <input
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') {
                  setNameDraft(device.name);
                  event.currentTarget.blur();
                }
              }}
              className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[15px] font-semibold tracking-tight text-slate-100 outline-none transition hover:border-noc-600 focus:border-cyan-400/50 focus:bg-noc-950/50"
              aria-label="Device name"
            />
            <div className="mt-1 flex flex-wrap items-center gap-1.5 px-1">
              <span
                className={cn(
                  'chip border px-1.5 py-px text-[8px]',
                  theme.border,
                  theme.bg,
                  theme.text,
                )}
              >
                {meta.label}
              </span>
              <span className="font-mono text-[8.5px] text-slate-600">{shortId(device.id)}</span>
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/5 pt-2.5">
          <span className="text-[9.5px] text-slate-500">
            {device.type === 'switch'
              ? 'Layer-2 forwarding device'
              : `Primary address ${primaryIp(device) || 'unassigned'}`}
          </span>
          <PowerToggle device={device} />
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-300">
            <ShieldAlert size={11} />
            Configuration warnings
          </div>
          <ul className="mt-1.5 space-y-1">
            {alerts.map((alert) => (
              <li key={alert} className="flex items-start gap-1 text-[9.5px] leading-snug text-amber-200/70">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-400/60" />
                {alert}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section>
        <SectionTitle
          icon={Cpu}
          title={`Interfaces · ${device.interfaces.length}`}
          action={
            <button
              type="button"
              onClick={() => addInterface(device.id)}
              className="flex items-center gap-1 text-[9px] text-cyan-400/80 transition hover:text-cyan-300"
            >
              <Plus size={10} />
              add
            </button>
          }
        />
        <div className="space-y-2">
          {device.interfaces.map((iface) => (
            <InterfaceEditor key={iface.id} device={device} iface={iface} />
          ))}
        </div>
        {device.type === 'switch' && (
          <p className="mt-1.5 text-[9px] leading-snug text-slate-600">
            Switches forward frames without an IP address. Assign one only if you need management
            access.
          </p>
        )}
      </section>

      {device.type === 'router' && <RoutingTable device={device} />}

      <section>
        <SectionTitle icon={Layers} title="Notes" />
        <textarea
          value={descriptionDraft}
          onChange={(event) => setDescriptionDraft(event.target.value)}
          onBlur={() => updateDeviceDescription(device.id, descriptionDraft)}
          rows={2}
          placeholder="Optional description for this device…"
          className="field-input resize-none !font-sans !text-[11px]"
        />
      </section>

      <section className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-semibold text-rose-300/90">Remove device</div>
            <div className="mt-0.5 text-[9px] text-slate-500">
              Also deletes every cable attached to {device.name}.
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Delete ${device.name} and all of its cables?`)) {
                deleteDevice(device.id);
              }
            }}
            className="btn btn-danger !px-2 !py-1 text-[10px]"
          >
            <Trash2 size={11} />
            Delete
          </button>
        </div>
      </section>
    </div>
  );
}

function CableInspector({ connection }: { connection: Connection }) {
  const devices = useNetworkStore((state) => state.devices);
  const toggleConnection = useNetworkStore((state) => state.toggleConnection);
  const deleteConnection = useNetworkStore((state) => state.deleteConnection);
  const health = useNetworkHealth();

  const source = devices.find((device) => device.id === connection.source);
  const target = devices.find((device) => device.id === connection.target);
  const sourceIface = source?.interfaces.find((iface) => iface.id === connection.sourceInterfaceId);
  const targetIface = target?.interfaces.find((iface) => iface.id === connection.targetInterfaceId);
  const status = health.edgeHealth[connection.id] ?? 'active';

  if (!source || !target) {
    return (
      <div className="p-4 text-[11px] text-slate-500">
        This cable references a device that no longer exists.
      </div>
    );
  }

  return (
    <div className="space-y-4 p-3">
      <div className="rounded-xl border border-noc-700/80 bg-gradient-to-br from-noc-800/80 to-noc-900/60 p-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10 text-cyan-300">
            <Cable size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-slate-100">Physical link</div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span
                className={cn(
                  'chip border px-1.5 py-px text-[8px]',
                  status === 'active'
                    ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
                    : 'border-rose-400/25 bg-rose-400/10 text-rose-300',
                )}
              >
                {status === 'active' ? 'up' : status === 'cut' ? 'cut' : 'offline'}
              </span>
              <span className="font-mono text-[8.5px] text-slate-600">{shortId(connection.id)}</span>
            </div>
          </div>
        </div>

        <div className="mt-3 space-y-1.5">
          {[
            { device: source, iface: sourceIface, address: primaryIp(source) },
            { device: target, iface: targetIface, address: primaryIp(target) },
          ].map((endpoint) => {
            const theme = DEVICE_THEME[endpoint.device.type];
            const EndpointIcon = theme.icon;
            return (
              <div
                key={endpoint.device.id}
                className="flex items-center gap-2 rounded-lg border border-white/5 bg-noc-950/40 px-2 py-1.5"
              >
                <EndpointIcon size={13} className={theme.text} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[10.5px] font-medium text-slate-200">
                    {endpoint.device.name}
                  </div>
                  <div className="font-mono text-[8.5px] text-slate-600">
                    {endpoint.iface?.name ?? 'port'} · {endpoint.address || 'no IP'}
                  </div>
                </div>
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    endpoint.device.isOnline ? 'bg-emerald-400' : 'bg-rose-400',
                  )}
                />
              </div>
            );
          })}
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-white/5 pt-2.5 text-[9px]">
          <div>
            <span className="text-slate-600">Media</span>
            <div className="mt-0.5 font-mono text-slate-400">{connection.cableType}</div>
          </div>
          <div>
            <span className="text-slate-600">Endpoints</span>
            <div className="mt-0.5 font-mono text-slate-400">2</div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-noc-700/80 bg-noc-850/40 p-3">
        <div className="flex items-start gap-2 text-[9.5px] leading-relaxed text-slate-500">
          <Wifi size={12} className="mt-0.5 shrink-0 text-slate-600" />
          A cut cable remains on the canvas but is excluded from pathfinding, rendered dashed red.
          Packets never traverse it until it is restored.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => toggleConnection(connection.id)}
          className={cn('btn', connection.isEnabled ? 'btn-danger' : 'btn-primary')}
        >
          {connection.isEnabled ? <Scissors size={13} /> : <Cable size={13} />}
          {connection.isEnabled ? 'Cut cable' : 'Restore cable'}
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Delete this cable from the topology?')) deleteConnection(connection.id);
          }}
          className="btn btn-ghost hover:!border-rose-500/30 hover:!text-rose-300"
        >
          <Trash2 size={13} />
          Delete
        </button>
      </div>
    </div>
  );
}

function Overview() {
  const devices = useNetworkStore((state) => state.devices);
  const connections = useNetworkStore((state) => state.connections);
  const topologyName = useNetworkStore((state) => state.topologyName);
  const simulation = useNetworkStore((state) => state.simulation);
  const selectDevice = useNetworkStore((state) => state.selectDevice);
  const setPanel = useNetworkStore((state) => state.setPanel);
  const health = useNetworkHealth();

  const sorted = useMemo(
    () =>
      [...devices].sort(
        (a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.name.localeCompare(b.name),
      ),
    [devices],
  );

  return (
    <div className="space-y-4 p-3">
      <div className="rounded-xl border border-noc-700/80 bg-gradient-to-br from-noc-800/80 to-noc-900/60 p-3">
        <div className="flex items-center gap-2">
          <Globe2 size={14} className="text-cyan-300" />
          <span className="eyebrow">Topology overview</span>
        </div>
        <div className="mt-1.5 text-[14px] font-semibold text-slate-100">{topologyName}</div>
        <div className="mt-2 grid grid-cols-3 gap-2 border-t border-white/5 pt-2.5">
          {[
            ['Devices', String(health.totalDevices)],
            ['Cables', String(health.totalLinks)],
            ['Online', `${health.onlineDevices}/${health.totalDevices}`],
          ].map(([label, value]) => (
            <div key={label}>
              <div className="text-[8.5px] uppercase tracking-wider text-slate-600">{label}</div>
              <div className="mt-0.5 font-mono text-[12px] text-slate-200">{value}</div>
            </div>
          ))}
        </div>
      </div>

      {health.conflicts.length > 0 && (
        <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-rose-300">
            <ShieldAlert size={11} />
            IP conflicts
          </div>
          <ul className="mt-1.5 space-y-1">
            {health.conflicts.map((conflict) => (
              <li
                key={`${conflict.ip}-${conflict.a.deviceId}-${conflict.b.deviceId}`}
                className="text-[9.5px] leading-snug text-rose-200/70"
              >
                <span className="font-mono text-rose-300">{conflict.ip}</span> · {conflict.a.deviceName}{' '}
                / {conflict.b.deviceName}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2 rounded-xl border border-dashed border-noc-600 bg-noc-850/30 p-3">
        <MousePointerClick size={15} className="shrink-0 text-slate-500" />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium text-slate-300">Nothing selected</div>
          <div className="mt-0.5 text-[9px] leading-snug text-slate-600">
            Click a device to edit its addressing, or click a cable to cut it.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPanel('simulation')}
          className="btn btn-ghost !px-2 !py-1 text-[9px]"
        >
          Simulate
          <ArrowRight size={10} />
        </button>
      </div>

      <section>
        <SectionTitle icon={Cpu} title={`Device directory · ${devices.length}`} />
        <div className="overflow-hidden rounded-xl border border-noc-700/80 bg-noc-850/30">
          {sorted.length === 0 ? (
            <div className="px-3 py-4 text-center text-[10px] text-slate-600">
              No devices on the canvas yet.
            </div>
          ) : (
            <div className="max-h-[420px] divide-y divide-white/5 overflow-y-auto">
              {sorted.map((device) => {
                const theme = DEVICE_THEME[device.type];
                const Icon = theme.icon;
                const ip = primaryIp(device);
                return (
                  <button
                    key={device.id}
                    type="button"
                    onClick={() => selectDevice(device.id)}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition hover:bg-noc-800/70"
                  >
                    <Icon size={12} className={theme.text} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[10.5px] text-slate-300">{device.name}</span>
                        <span className="text-[8px] uppercase tracking-wider text-slate-600">
                          {device.type}
                        </span>
                      </span>
                      <span className="block font-mono text-[8.5px] text-slate-600">
                        {ip || 'unassigned'}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        device.isOnline ? 'bg-emerald-400/80' : 'bg-rose-400',
                      )}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[8.5px] text-slate-600">
          <span>
            {connections.length} cable{connections.length === 1 ? '' : 's'} on the canvas
          </span>
          <button
            type="button"
            onClick={() => setPanel('console')}
            className="flex items-center gap-1 text-slate-500 transition hover:text-cyan-300"
          >
            <ChevronDown size={9} />
            recent activity
          </button>
        </div>
      </section>

      <div className="rounded-xl border border-noc-700/60 bg-noc-850/30 p-3">
        <div className="flex items-center gap-1.5 text-[9px] font-semibold text-slate-400">
          <Check size={10} className="text-emerald-400" />
          Live engine
        </div>
        <p className="mt-1 text-[9px] leading-relaxed text-slate-600">
          Every address change, cable toggle and power state immediately recalculates broadcast
          domains, IP conflicts and routes. Latency is measured per hop.
        </p>
        <div className="mt-2 flex items-center gap-2 font-mono text-[8.5px] text-slate-600">
          <span>last RTT</span>
          <span className="text-slate-400">
            {simulation ? formatMs(simulation.roundTripMs) : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

export function Inspector() {
  const selectedDeviceId = useNetworkStore((state) => state.selectedDeviceId);
  const selectedConnectionId = useNetworkStore((state) => state.selectedConnectionId);
  const devices = useNetworkStore((state) => state.devices);
  const connections = useNetworkStore((state) => state.connections);

  const device = selectedDeviceId
    ? devices.find((candidate) => candidate.id === selectedDeviceId)
    : undefined;
  const connection = selectedConnectionId
    ? connections.find((candidate) => candidate.id === selectedConnectionId)
    : undefined;

  if (connection) return <CableInspector connection={connection} />;
  if (device) return <DeviceInspector device={device} />;
  return <Overview />;
}
