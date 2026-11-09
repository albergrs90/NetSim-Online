import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { AlertTriangle, CircleDot, PowerOff } from 'lucide-react';
import type { Device, DeviceType } from '../../types/network';
import { DEVICE_META } from '../../data/deviceFactory';
import { DEVICE_THEME } from '../deviceTheme';
import { getInterfaceCidr } from '../../engine/ip';
import { primaryInterface, primaryIp } from '../../engine/topology';
import { cn } from '../../utils/format';

export interface NetworkNodeData extends Record<string, unknown> {
  device: Device;
  alerts: string[];
  hasConflict: boolean;
  isTransmitting: boolean;
  isSimSource: boolean;
  isSimTarget: boolean;
}

export type NetworkNode = Node<NetworkNodeData, DeviceType>;

function DeviceNodeComponent({ data, selected }: NodeProps<NetworkNode>) {
  const { device, alerts, hasConflict, isTransmitting, isSimSource, isSimTarget } = data;
  const theme = DEVICE_THEME[device.type];
  const meta = DEVICE_META[device.type];
  const Icon = theme.icon;
  const iface = primaryInterface(device);
  const ip = primaryIp(device);
  const cidr = iface && ip ? getInterfaceCidr(iface) : '';
  const gateway = iface?.gateway ?? '';
  const offline = !device.isOnline;
  const hasAlerts = alerts.length > 0;

  return (
    <div
      className={cn(
        'group relative w-[218px] rounded-xl border bg-gradient-to-br from-noc-800 to-noc-900 text-left shadow-panel transition duration-200',
        'hover:border-noc-500',
        selected ? 'border-cyan-400/70 ring-2 ring-cyan-400/25' : 'border-noc-700',
        hasConflict && 'node-conflict border-rose-500/60',
        isTransmitting && !hasConflict && 'node-transmitting border-cyan-400/60',
        offline && 'opacity-70',
      )}
    >
      <div
        className="absolute inset-x-4 -top-px h-px"
        style={{
          background: `linear-gradient(90deg, transparent, ${theme.hex}aa, transparent)`,
        }}
      />

      {(isSimSource || isSimTarget) && (
        <div className="absolute -top-2 right-3 flex gap-1">
          {isSimSource && (
            <span className="rounded bg-cyan-400 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-noc-950 shadow">
              src
            </span>
          )}
          {isSimTarget && (
            <span className="rounded bg-emerald-400 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-noc-950 shadow">
              dst
            </span>
          )}
        </div>
      )}

      <div className="flex items-start gap-2.5 px-3.5 pb-2.5 pt-3">
        <div
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
            theme.bg,
            theme.border,
            theme.text,
          )}
        >
          <Icon size={17} strokeWidth={1.9} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold tracking-tight text-slate-100">
              {device.name}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className={cn('text-[9px] font-semibold uppercase tracking-[0.16em]', theme.text)}>
              {meta.label}
            </span>
            <span className="text-[9px] text-slate-600">/</span>
            <span className="truncate text-[9px] text-slate-500">{iface?.name ?? 'no port'}</span>
            <span
              className={cn(
                'ml-auto flex shrink-0 items-center gap-1 rounded border px-1 py-px text-[7px] font-bold uppercase tracking-[0.1em]',
                offline
                  ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                  : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300/90',
              )}
              title={offline ? 'Offline' : 'Online'}
            >
              <span
                className={cn(
                  'h-1 w-1 rounded-full',
                  offline ? 'bg-rose-400' : 'live-dot bg-emerald-400',
                )}
              />
              {offline ? 'offline' : 'online'}
            </span>
          </div>
        </div>
      </div>

      <div className="mx-3.5 space-y-1 rounded-lg border border-white/5 bg-noc-950/50 px-2.5 py-2 font-mono text-[10.5px] leading-relaxed">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-600">IP</span>
          <span className={cn('truncate', ip ? 'text-slate-200' : 'text-slate-600')}>
            {ip || 'unassigned'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-600">NET</span>
          <span className={cn('truncate', cidr ? 'text-slate-400' : 'text-slate-600')}>
            {cidr || '—'}
          </span>
        </div>
        {device.type !== 'switch' && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-600">{device.type === 'router' ? 'IFS' : 'GW'}</span>
            <span className={cn('truncate', gateway ? 'text-slate-400' : 'text-slate-600')}>
              {device.type === 'router' ? device.interfaces.length : gateway || 'none'}
            </span>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2 border-t border-white/5 px-3.5 py-2">
        <span className="flex items-center gap-1 text-[8.5px] font-semibold uppercase tracking-[0.14em] text-slate-600">
          <CircleDot size={9} />
          ports
        </span>
        <div className="flex flex-1 justify-end gap-1">
          {device.interfaces.map((deviceIface) => (
            <div
              key={deviceIface.id}
              className="relative flex h-4 items-center gap-1 rounded border border-noc-700/70 bg-noc-900 px-1.5"
              title={`${deviceIface.name} · ${deviceIface.ipAddress || 'no IP'}`}
            >
              <span
                className={cn(
                  'h-1 w-1 rounded-full',
                  deviceIface.ipAddress ? theme.dot : 'bg-slate-600',
                )}
              />
              <span className="font-mono text-[8px] text-slate-500">{deviceIface.name}</span>
              <Handle
                type="target"
                id={`${deviceIface.id}-in`}
                position={Position.Bottom}
                className="netsim-port"
                style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
              />
              <Handle
                type="source"
                id={`${deviceIface.id}-out`}
                position={Position.Bottom}
                className="netsim-port"
                style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
              />
            </div>
          ))}
        </div>
      </div>

      {hasAlerts && (
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-b-xl border-t px-3.5 py-1.5 text-[9.5px] font-medium',
            hasConflict
              ? 'border-rose-500/20 bg-rose-500/10 text-rose-300'
              : 'border-amber-500/20 bg-amber-500/5 text-amber-300/90',
          )}
          title={alerts.join('\n')}
        >
          <AlertTriangle size={10} className="shrink-0" />
          <span className="truncate">{alerts[0]}</span>
        </div>
      )}

      {offline && (
        <div className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-rose-500/50 bg-noc-900 text-rose-400 shadow">
          <PowerOff size={10} />
        </div>
      )}
    </div>
  );
}

export function RouterNode(props: NodeProps<NetworkNode>) {
  return <DeviceNodeComponent {...props} />;
}

export function SwitchNode(props: NodeProps<NetworkNode>) {
  return <DeviceNodeComponent {...props} />;
}

export function ServerNode(props: NodeProps<NetworkNode>) {
  return <DeviceNodeComponent {...props} />;
}

export function PCNode(props: NodeProps<NetworkNode>) {
  return <DeviceNodeComponent {...props} />;
}

export const nodeTypes = {
  router: RouterNode,
  switch: SwitchNode,
  server: ServerNode,
  pc: PCNode,
};
