import { useCallback, useEffect, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  type Connection as RFConnection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { Activity, Cable, Circle, MousePointer2, Radio, Waypoints } from 'lucide-react';
import { useNetworkStore } from '../../store/useNetworkStore';
import { useNetworkHealth } from '../../hooks/useNetworkHealth';
import { edgeTypes, type NetworkEdge } from '../edges/NetworkEdge';
import { nodeTypes, type NetworkNode } from '../nodes/NetworkNode';
import { DEVICE_THEME } from '../deviceTheme';
import { DEVICE_TYPES } from '../../data/deviceFactory';
import type { DeviceType } from '../../types/network';
import { cn } from '../../utils/format';

function isValidDeviceType(value: string): value is DeviceType {
  return (DEVICE_TYPES as string[]).includes(value);
}

export function NetworkCanvas() {
  const devices = useNetworkStore((state) => state.devices);
  const connections = useNetworkStore((state) => state.connections);
  const selectedDeviceId = useNetworkStore((state) => state.selectedDeviceId);
  const selectedConnectionId = useNetworkStore((state) => state.selectedConnectionId);
  const simSourceId = useNetworkStore((state) => state.simSourceId);
  const simTargetId = useNetworkStore((state) => state.simTargetId);
  const activePacket = useNetworkStore((state) => state.activePacket);
  const isSimulating = useNetworkStore((state) => state.isSimulating);
  const fitRequest = useNetworkStore((state) => state.fitRequest);
  const topologyName = useNetworkStore((state) => state.topologyName);
  const moveDevice = useNetworkStore((state) => state.moveDevice);
  const deleteDevice = useNetworkStore((state) => state.deleteDevice);
  const deleteConnection = useNetworkStore((state) => state.deleteConnection);
  const addDevice = useNetworkStore((state) => state.addDevice);
  const addConnection = useNetworkStore((state) => state.addConnection);
  const selectDevice = useNetworkStore((state) => state.selectDevice);
  const selectConnection = useNetworkStore((state) => state.selectConnection);
  const health = useNetworkHealth();
  const { fitView, screenToFlowPosition } = useReactFlow();

  const nodes = useMemo<NetworkNode[]>(() => {
    const conflictIds = new Set<string>();
    for (const conflict of health.conflicts) {
      conflictIds.add(conflict.a.deviceId);
      conflictIds.add(conflict.b.deviceId);
    }
    return devices.map((device) => ({
      id: device.id,
      type: device.type,
      position: device.position,
      initialWidth: 218,
      initialHeight: 150,
      selected: selectedDeviceId === device.id,
      data: {
        device,
        alerts: health.deviceAlerts[device.id] ?? [],
        hasConflict: conflictIds.has(device.id),
        isTransmitting: activePacket?.path.includes(device.id) ?? false,
        isSimSource: simSourceId === device.id,
        isSimTarget: simTargetId === device.id,
      },
    }));
  }, [devices, health, selectedDeviceId, activePacket, simSourceId, simTargetId]);

  const edges = useMemo<NetworkEdge[]>(
    () =>
      connections.map((connection) => {
        const sourceDevice = devices.find((device) => device.id === connection.source);
        const targetDevice = devices.find((device) => device.id === connection.target);
        const sourceIfaceId =
          connection.sourceInterfaceId ?? sourceDevice?.interfaces[0]?.id ?? 'missing';
        const targetIfaceId =
          connection.targetInterfaceId ?? targetDevice?.interfaces[0]?.id ?? 'missing';
        const passes = activePacket?.passesByEdge[connection.id] ?? [];
        return {
          id: connection.id,
          source: connection.source,
          target: connection.target,
          sourceHandle: `${sourceIfaceId}-out`,
          targetHandle: `${targetIfaceId}-in`,
          type: 'network',
          selected: selectedConnectionId === connection.id,
          data: {
            health: health.edgeHealth[connection.id] ?? 'active',
            passes,
            inActivePath: passes.length > 0,
          },
        };
      }),
    [connections, devices, health, activePacket, selectedConnectionId],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<NetworkNode>[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          moveDevice(change.id, change.position);
        } else if (change.type === 'remove') {
          deleteDevice(change.id);
        }
      }
    },
    [moveDevice, deleteDevice],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<NetworkEdge>[]) => {
      for (const change of changes) {
        if (change.type === 'remove') deleteConnection(change.id);
      }
    },
    [deleteConnection],
  );

  const onConnect = useCallback(
    (connection: RFConnection) => {
      addConnection(connection);
    },
    [addConnection],
  );

  const isValidConnection = useCallback(
    (connection: RFConnection | NetworkEdge) => connection.source !== connection.target,
    [],
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const rawType = event.dataTransfer.getData('application/netsim-device');
      if (!isValidDeviceType(rawType)) return;
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addDevice(rawType, { x: point.x - 109, y: point.y - 70 });
    },
    [addDevice, screenToFlowPosition],
  );

  const onPaneClick = useCallback(() => {
    if (selectedDeviceId || selectedConnectionId) selectDevice(null);
  }, [selectedDeviceId, selectedConnectionId, selectDevice]);

  useEffect(() => {
    if (devices.length === 0) return;
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.18, maxZoom: 1.1, duration: 550 });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [fitRequest, devices.length, fitView]);

  return (
    <div className="relative h-full w-full" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow<NetworkNode, NetworkEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeClick={(_, node) => selectDevice(node.id)}
        onEdgeClick={(_, edge) => selectConnection(edge.id)}
        onPaneClick={onPaneClick}
        connectionMode={ConnectionMode.Loose}
        connectionLineStyle={{ stroke: '#22d3ee', strokeWidth: 1.5, strokeDasharray: '5 4' }}
        minZoom={0.12}
        maxZoom={1.8}
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: false }}
        className="bg-noc-950"
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.2} color="#1b2a40" />
        <Controls
          position="bottom-right"
          showInteractive={false}
          fitViewOptions={{ padding: 0.2, duration: 500 }}
        />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeStrokeWidth={2}
          maskColor="rgba(4, 7, 13, 0.72)"
          nodeColor={(node) => {
            const type = node.type as DeviceType | undefined;
            return type && type in DEVICE_THEME ? DEVICE_THEME[type].hex : '#475569';
          }}
          nodeStrokeColor={(node) => {
            const type = node.type as DeviceType | undefined;
            return type && type in DEVICE_THEME ? DEVICE_THEME[type].hex : '#475569';
          }}
          style={{ bottom: 54, right: 12, width: 168, height: 104 }}
        />

        <Panel position="top-left" className="!m-4">
          <div className="panel-surface flex items-center gap-3 rounded-xl px-3 py-2">
            <span className="flex items-center gap-1.5">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-300">
                live
              </span>
            </span>
            <span className="h-4 w-px bg-noc-700" />
            <div className="leading-tight">
              <div className="text-[11px] font-semibold text-slate-200">{topologyName}</div>
              <div className="text-[9px] text-slate-500">
                {health.onlineDevices}/{health.totalDevices} devices online · {health.activeLinks}/
                {health.totalLinks} links up
              </div>
            </div>
          </div>
        </Panel>

        <Panel position="bottom-left" className="!m-4">
          <div className="panel-surface flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl px-3 py-2 text-[9px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="h-px w-4 bg-emerald-400" />
              active
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-px w-4 border-t border-dashed border-rose-400" />
              cut
            </span>
            <span className="flex items-center gap-1.5">
              <Circle size={7} className="fill-rose-400 text-rose-400" />
              device offline
            </span>
            <span className="flex items-center gap-1.5">
              <Radio size={9} className="text-cyan-300" />
              icmp packet
            </span>
          </div>
        </Panel>

        <Panel position="top-right" className="!m-4">
          <div className="panel-surface hidden items-center gap-2 rounded-lg px-2.5 py-1.5 text-[9px] text-slate-500 lg:flex">
            <MousePointer2 size={10} />
            drag to pan
            <span className="text-slate-700">·</span>
            scroll to zoom
            <span className="text-slate-700">·</span>
            <Cable size={10} />
            drag a port to cable
          </div>
        </Panel>
      </ReactFlow>

      <div className="canvas-vignette pointer-events-none absolute inset-0" />

      {isSimulating && activePacket && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-cyan-400/30 bg-noc-900/95 px-3 py-1.5 text-[10px] font-medium text-cyan-200 shadow-glow backdrop-blur">
            <Activity size={12} className="spin-slow text-cyan-300" />
            <span className="uppercase tracking-wider">
              {activePacket.protocol === 'ping' ? 'ICMP echo in flight' : 'Traceroute probe in flight'}
            </span>
            <span className="h-1 w-1 rounded-full bg-cyan-400/60" />
            <span className="font-mono text-cyan-400/80">{activePacket.path.length} hops</span>
          </div>
        </div>
      )}

      {devices.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="max-w-sm rounded-2xl border border-dashed border-noc-600 bg-noc-900/70 px-10 py-9 text-center backdrop-blur">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/5 text-cyan-300">
              <Waypoints size={22} />
            </div>
            <h2 className="text-sm font-semibold text-slate-200">Your canvas is empty</h2>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
              Drag a device from the component palette to begin, or load one of the recruiter
              scenarios from the Templates menu.
            </p>
            <div className={cn('mt-4 flex items-center justify-center gap-2 text-[9px] text-slate-600')}>
              <MousePointer2 size={10} /> drag &amp; drop
              <span>·</span>
              <Cable size={10} /> draw cables
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
