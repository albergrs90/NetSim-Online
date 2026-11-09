/**
 * Global network state (Zustand).
 *
 * The store owns the topology, selection, logs, simulation result and the
 * packet-animation schedule. All network calculations are delegated to the
 * pure engine in `src/engine`.
 */

import { create } from 'zustand';
import type { Connection as RFConnection } from '@xyflow/react';
import type {
  ActivePacket,
  Connection,
  Device,
  DeviceType,
  EdgePacketPass,
  LogEntry,
  LogLevel,
  LogScope,
  NetworkInterface,
  PanelTab,
  Protocol,
  RoutingEntry,
  SimulationResult,
} from '../types/network';
import { createDevice, createRouterInterface } from '../data/deviceFactory';
import { NETWORK_TEMPLATES, getTemplate } from '../data/templates';
import { primaryInterface, primaryIp, resolveInterface } from '../engine/topology';
import { simulate } from '../engine/simulation';
import { isSameSubnet, isValidIPv4 } from '../engine/ip';
import { createId } from '../utils/format';

export interface ToastMessage {
  id: string;
  message: string;
  tone: 'success' | 'error' | 'info';
}

interface NetworkState {
  topologyName: string;
  devices: Device[];
  connections: Connection[];
  selectedDeviceId: string | null;
  selectedConnectionId: string | null;
  logs: LogEntry[];
  simulation: SimulationResult | null;
  activePacket: ActivePacket | null;
  isSimulating: boolean;
  simSourceId: string;
  simTargetId: string;
  panel: PanelTab;
  toast: ToastMessage | null;
  /** Incremented whenever the canvas should fit the whole topology. */
  fitRequest: number;
}

interface NetworkActions {
  addDevice: (type: DeviceType, position: { x: number; y: number }) => string;
  updateDeviceName: (id: string, name: string) => void;
  updateDeviceDescription: (id: string, description: string) => void;
  toggleDevicePower: (id: string) => void;
  moveDevice: (id: string, position: { x: number; y: number }) => void;
  deleteDevice: (id: string) => void;
  updateInterface: (deviceId: string, interfaceId: string, patch: Partial<Omit<NetworkInterface, 'id'>>) => void;
  addInterface: (deviceId: string) => void;
  removeInterface: (deviceId: string, interfaceId: string) => void;
  addRoutingEntry: (
    deviceId: string,
    entry: Pick<RoutingEntry, 'destinationCidr' | 'nextHop' | 'interfaceName' | 'metric'>,
  ) => void;
  removeRoutingEntry: (deviceId: string, routeId: string) => void;
  selectDevice: (id: string | null) => void;
  selectConnection: (id: string | null) => void;
  addConnection: (params: RFConnection) => void;
  toggleConnection: (id: string) => void;
  deleteConnection: (id: string) => void;
  setSimulationEndpoint: (side: 'source' | 'target', id: string) => void;
  swapSimulationEndpoints: () => void;
  runSimulation: (protocol: Protocol) => void;
  clearSimulation: () => void;
  setPanel: (panel: PanelTab) => void;
  addLog: (level: LogLevel, scope: LogScope, message: string) => void;
  clearLogs: () => void;
  showToast: (message: string, tone: ToastMessage['tone']) => void;
  dismissToast: () => void;
  loadTemplate: (id: string) => void;
  importTopology: (name: string, devices: Device[], connections: Connection[]) => void;
  resetWorkspace: () => void;
  requestFitView: () => void;
}

export type NetworkStore = NetworkState & NetworkActions;

const MAX_LOGS = 250;

function makeLog(level: LogLevel, scope: LogScope, message: string): LogEntry {
  return {
    id: createId('log'),
    level,
    scope,
    message,
    timestamp: Date.now(),
  };
}

function withLog(state: NetworkState, entry: LogEntry): Pick<NetworkState, 'logs'> {
  return { logs: [...state.logs, entry].slice(-MAX_LOGS) };
}

function suggestEndpoints(devices: Device[]): { source: string; target: string } {
  const hosts = devices.filter(
    (device) =>
      (device.type === 'pc' || device.type === 'server') &&
      device.isOnline &&
      isValidIPv4(primaryIp(device)),
  );
  if (hosts.length === 0) return { source: '', target: '' };
  const source = hosts[0];
  const sourceIface = primaryInterface(source);
  const target =
    hosts.find((host) => {
      const iface = primaryInterface(host);
      if (!iface || !sourceIface) return false;
      return !isSameSubnet(sourceIface.ipAddress, iface.ipAddress, sourceIface.subnetMask);
    }) ?? hosts[1] ?? hosts[0];
  return { source: source.id, target: target.id };
}

function findByName(devices: Device[], name?: string): Device | undefined {
  if (!name) return undefined;
  return devices.find((device) => device.name === name);
}

function buildActivePacket(
  result: SimulationResult,
  connections: Connection[],
): ActivePacket | null {
  if (result.edgePath.length === 0) return null;
  const runId = createId('run');
  const passesByEdge: Record<string, EdgePacketPass[]> = {};
  const isTraceroute = result.protocol === 'traceroute';
  const step = isTraceroute ? 620 : 380;
  const duration = isTraceroute ? 600 : 460;
  const requestColor = result.success ? '#22d3ee' : '#f87171';

  // Cables are stored source → target, but a packet may traverse them in the
  // opposite direction (e.g. host → switch). Resolve the geometric direction
  // for every step so animateMotion always follows the request's real path.
  const connectionById = new Map(connections.map((connection) => [connection.id, connection]));
  const forwardEdges = new Set<string>();
  result.edgePath.forEach((edgeId, index) => {
    const connection = connectionById.get(edgeId);
    if (!connection) return;
    const from = result.path[index];
    const to = result.path[index + 1];
    if (connection.source === from && connection.target === to) forwardEdges.add(edgeId);
  });
  const travelDirection = (edgeId: string, request: boolean): 'forward' | 'backward' => {
    const geometricForward = forwardEdges.has(edgeId);
    if (request) return geometricForward ? 'forward' : 'backward';
    return geometricForward ? 'backward' : 'forward';
  };

  const pushPass = (edgeId: string, pass: EdgePacketPass): void => {
    const list = passesByEdge[edgeId];
    if (list) list.push(pass);
    else passesByEdge[edgeId] = [pass];
  };

  result.edgePath.forEach((edgeId, index) => {
    pushPass(edgeId, {
      runId,
      direction: travelDirection(edgeId, true),
      phase: 'request',
      beginMs: 120 + index * step,
      durationMs: duration,
      color: requestColor,
    });
  });

  if (result.success && result.protocol === 'ping') {
    const reverseStart = 120 + result.edgePath.length * step + 420;
    [...result.edgePath].reverse().forEach((edgeId, index) => {
      pushPass(edgeId, {
        runId,
        direction: travelDirection(edgeId, false),
        phase: 'reply',
        beginMs: reverseStart + index * step,
        durationMs: duration,
        color: '#34d399',
      });
    });
  }

  return {
    runId,
    protocol: result.protocol,
    path: result.path,
    passesByEdge,
    startedAt: Date.now(),
  };
}

function packetLifetime(packet: ActivePacket): number {
  let latest = 0;
  for (const passes of Object.values(packet.passesByEdge)) {
    for (const pass of passes) {
      latest = Math.max(latest, pass.beginMs + pass.durationMs);
    }
  }
  return Math.min(12000, latest + 1200);
}

let animationTimer: ReturnType<typeof setTimeout> | null = null;
let busyTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimers(): void {
  if (animationTimer) clearTimeout(animationTimer);
  if (busyTimer) clearTimeout(busyTimer);
  animationTimer = null;
  busyTimer = null;
}

const initialTemplate = getTemplate('corporate-office') ?? NETWORK_TEMPLATES[0];
const initialTopology = initialTemplate.build();
const initialSource = findByName(initialTopology.devices, initialTemplate.suggestedSource);
const initialTarget = findByName(initialTopology.devices, initialTemplate.suggestedTarget);

export const useNetworkStore = create<NetworkStore>((set, get) => ({
  topologyName: initialTemplate.name,
  devices: initialTopology.devices,
  connections: initialTopology.connections,
  selectedDeviceId: null,
  selectedConnectionId: null,
  logs: [
    makeLog('info', 'system', 'NetSim Online NOC initialized. Simulation engine ready.'),
    makeLog('success', 'persistence', `Template "${initialTemplate.name}" loaded automatically.`),
  ],
  simulation: null,
  activePacket: null,
  isSimulating: false,
  simSourceId: initialSource?.id ?? '',
  simTargetId: initialTarget?.id ?? '',
  panel: 'inspector',
  toast: null,
  fitRequest: 0,

  addDevice: (type, position) => {
    const device = createDevice(type, position, get().devices);
    set((state) => ({
      devices: [...state.devices, device],
      selectedDeviceId: device.id,
      selectedConnectionId: null,
      panel: 'inspector',
      activePacket: null,
      ...withLog(state, makeLog('info', 'topology', `${device.name} (${type}) added to the canvas.`)),
    }));
    return device.id;
  },

  updateDeviceName: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((state) => ({
      devices: state.devices.map((device) =>
        device.id === id ? { ...device, name: trimmed } : device,
      ),
      ...withLog(state, makeLog('info', 'topology', `Device renamed to ${trimmed}.`)),
    }));
  },

  updateDeviceDescription: (id, description) => {
    set((state) => ({
      devices: state.devices.map((device) => (device.id === id ? { ...device, description } : device)),
    }));
  },

  toggleDevicePower: (id) => {
    const device = get().devices.find((candidate) => candidate.id === id);
    if (!device) return;
    const nextState = !device.isOnline;
    set((state) => ({
      devices: state.devices.map((candidate) =>
        candidate.id === id ? { ...candidate, isOnline: nextState } : candidate,
      ),
      activePacket: null,
      ...withLog(
        state,
        makeLog(
          nextState ? 'success' : 'warning',
          'topology',
          `${device.name} powered ${nextState ? 'ON' : 'OFF'}. Connectivity recalculated.`,
        ),
      ),
    }));
  },

  moveDevice: (id, position) => {
    set((state) => ({
      devices: state.devices.map((device) => (device.id === id ? { ...device, position } : device)),
    }));
  },

  deleteDevice: (id) => {
    const device = get().devices.find((candidate) => candidate.id === id);
    if (!device) return;
    set((state) => {
      const remainingConnections = state.connections.filter(
        (connection) => connection.source !== id && connection.target !== id,
      );
      return {
        devices: state.devices.filter((candidate) => candidate.id !== id),
        connections: remainingConnections,
        selectedDeviceId: state.selectedDeviceId === id ? null : state.selectedDeviceId,
        selectedConnectionId: null,
        activePacket: null,
        simSourceId: state.simSourceId === id ? '' : state.simSourceId,
        simTargetId: state.simTargetId === id ? '' : state.simTargetId,
        ...withLog(
          state,
          makeLog(
            'warning',
            'topology',
            `${device.name} removed along with ${state.connections.length - remainingConnections.length} cable(s).`,
          ),
        ),
      };
    });
  },

  updateInterface: (deviceId, interfaceId, patch) => {
    set((state) => ({
      devices: state.devices.map((device) =>
        device.id === deviceId
          ? {
              ...device,
              interfaces: device.interfaces.map((iface) =>
                iface.id === interfaceId ? { ...iface, ...patch } : iface,
              ),
            }
          : device,
      ),
      activePacket: null,
    }));
  },

  addInterface: (deviceId) => {
    const device = get().devices.find((candidate) => candidate.id === deviceId);
    if (!device) return;
    const iface =
      device.type === 'router'
        ? createRouterInterface(device, get().devices)
        : {
            ...createRouterInterface(device, get().devices),
            name: `eth${device.interfaces.length}`,
            ipAddress: '',
            subnetMask: '255.255.255.0',
            gateway: '',
          };
    set((state) => ({
      devices: state.devices.map((candidate) =>
        candidate.id === deviceId
          ? { ...candidate, interfaces: [...candidate.interfaces, iface] }
          : candidate,
      ),
      ...withLog(state, makeLog('info', 'topology', `${device.name}: interface ${iface.name} added.`)),
    }));
  },

  removeInterface: (deviceId, interfaceId) => {
    const device = get().devices.find((candidate) => candidate.id === deviceId);
    if (!device || device.interfaces.length <= 1) return;
    const remaining = device.interfaces.filter((iface) => iface.id !== interfaceId);
    set((state) => ({
      devices: state.devices.map((candidate) =>
        candidate.id === deviceId ? { ...candidate, interfaces: remaining } : candidate,
      ),
      connections: state.connections.map((connection) => {
        if (connection.sourceInterfaceId !== interfaceId && connection.targetInterfaceId !== interfaceId) {
          return connection;
        }
        return {
          ...connection,
          sourceInterfaceId:
            connection.source === deviceId && connection.sourceInterfaceId === interfaceId
              ? remaining[0]?.id
              : connection.sourceInterfaceId,
          targetInterfaceId:
            connection.target === deviceId && connection.targetInterfaceId === interfaceId
              ? remaining[0]?.id
              : connection.targetInterfaceId,
        };
      }),
      activePacket: null,
      ...withLog(state, makeLog('warning', 'topology', `${device.name}: interface removed.`)),
    }));
  },

  addRoutingEntry: (deviceId, entry) => {
    const device = get().devices.find((candidate) => candidate.id === deviceId);
    if (!device) return;
    const route: RoutingEntry = {
      id: createId('route'),
      destinationCidr: entry.destinationCidr,
      nextHop: entry.nextHop,
      interfaceName: entry.interfaceName,
      metric: entry.metric,
      type: 'static',
    };
    set((state) => ({
      devices: state.devices.map((candidate) =>
        candidate.id === deviceId
          ? { ...candidate, routingTable: [...candidate.routingTable, route] }
          : candidate,
      ),
      ...withLog(
        state,
        makeLog('info', 'topology', `${device.name}: static route ${route.destinationCidr} via ${route.nextHop} added.`),
      ),
    }));
  },

  removeRoutingEntry: (deviceId, routeId) => {
    const device = get().devices.find((candidate) => candidate.id === deviceId);
    if (!device) return;
    set((state) => ({
      devices: state.devices.map((candidate) =>
        candidate.id === deviceId
          ? { ...candidate, routingTable: candidate.routingTable.filter((route) => route.id !== routeId) }
          : candidate,
      ),
      ...withLog(state, makeLog('warning', 'topology', `${device.name}: static route removed.`)),
    }));
  },

  selectDevice: (id) => {
    set({ selectedDeviceId: id, selectedConnectionId: null, panel: 'inspector' });
  },

  selectConnection: (id) => {
    set({ selectedDeviceId: null, selectedConnectionId: id, panel: 'inspector' });
  },

  addConnection: (params) => {
    const { devices, connections } = get();
    if (!params.source || !params.target || params.source === params.target) return;
    const sourceDevice = devices.find((device) => device.id === params.source);
    const targetDevice = devices.find((device) => device.id === params.target);
    if (!sourceDevice || !targetDevice) return;

    const duplicate = connections.some(
      (connection) =>
        (connection.source === params.source && connection.target === params.target) ||
        (connection.source === params.target && connection.target === params.source),
    );
    if (duplicate) {
      get().addLog(
        'warning',
        'topology',
        `A cable between ${sourceDevice.name} and ${targetDevice.name} already exists.`,
      );
      get().showToast('A cable already exists between these devices.', 'info');
      return;
    }

    const sourceIface = resolveInterface(sourceDevice, params.sourceHandle);
    const targetIface = resolveInterface(targetDevice, params.targetHandle);
    const connection: Connection = {
      id: createId('link'),
      source: sourceDevice.id,
      target: targetDevice.id,
      sourceHandle: params.sourceHandle,
      targetHandle: params.targetHandle,
      sourceInterfaceId: sourceIface?.id,
      targetInterfaceId: targetIface?.id,
      isEnabled: true,
      cableType: 'copper',
      label: `${sourceDevice.name} ↔ ${targetDevice.name}`,
    };
    set((state) => ({
      connections: [...state.connections, connection],
      activePacket: null,
      ...withLog(
        state,
        makeLog(
          'success',
          'topology',
          `Cable established: ${sourceDevice.name}${sourceIface ? `/${sourceIface.name}` : ''} ↔ ${targetDevice.name}${
            targetIface ? `/${targetIface.name}` : ''
          }.`,
        ),
      ),
    }));
  },

  toggleConnection: (id) => {
    const connection = get().connections.find((candidate) => candidate.id === id);
    if (!connection) return;
    const nextEnabled = !connection.isEnabled;
    const source = get().devices.find((device) => device.id === connection.source);
    const target = get().devices.find((device) => device.id === connection.target);
    set((state) => ({
      connections: state.connections.map((candidate) =>
        candidate.id === id ? { ...candidate, isEnabled: nextEnabled } : candidate,
      ),
      activePacket: null,
      ...withLog(
        state,
        makeLog(
          nextEnabled ? 'success' : 'warning',
          'topology',
          `Cable ${nextEnabled ? 'restored' : 'cut'}: ${source?.name ?? connection.source} ↔ ${
            target?.name ?? connection.target
          }.`,
        ),
      ),
    }));
  },

  deleteConnection: (id) => {
    const connection = get().connections.find((candidate) => candidate.id === id);
    if (!connection) return;
    const source = get().devices.find((device) => device.id === connection.source);
    const target = get().devices.find((device) => device.id === connection.target);
    set((state) => ({
      connections: state.connections.filter((candidate) => candidate.id !== id),
      selectedConnectionId: state.selectedConnectionId === id ? null : state.selectedConnectionId,
      activePacket: null,
      ...withLog(
        state,
        makeLog(
          'warning',
          'topology',
          `Cable removed: ${source?.name ?? connection.source} ↔ ${target?.name ?? connection.target}.`,
        ),
      ),
    }));
  },

  setSimulationEndpoint: (side, id) => {
    if (side === 'source') set({ simSourceId: id });
    else set({ simTargetId: id });
  },

  swapSimulationEndpoints: () => {
    set((state) => ({ simSourceId: state.simTargetId, simTargetId: state.simSourceId }));
  },

  runSimulation: (protocol) => {
    const { devices, connections, simSourceId, simTargetId } = get();
    if (!simSourceId || !simTargetId) {
      get().showToast('Select both a source and a destination first.', 'error');
      get().addLog('error', 'engine', 'Cannot run simulation: source or destination is not selected.');
      return;
    }
    if (simSourceId === simTargetId) {
      get().showToast('Source and destination must be different devices.', 'error');
      return;
    }

    const source = devices.find((device) => device.id === simSourceId);
    const target = devices.find((device) => device.id === simTargetId);
    if (!source || !target) {
      get().showToast('The selected device no longer exists.', 'error');
      return;
    }

    clearTimers();
    const result = simulate(devices, connections, simSourceId, simTargetId, protocol);
    const packet = buildActivePacket(result, connections);

    set({
      simulation: result,
      activePacket: packet,
      isSimulating: true,
      panel: 'simulation',
    });

    get().addLog(
      'info',
      'engine',
      `${protocol === 'ping' ? 'PING' : 'TRACEROUTE'} ${source.name} (${primaryIp(source) || 'no IP'}) → ${
        target.name
      } (${primaryIp(target) || 'no IP'})`,
    );
    for (const detail of result.details) {
      get().addLog('info', 'engine', detail);
    }
    get().addLog(
      result.success ? 'success' : 'error',
      'engine',
      result.success ? result.message : `Simulation failed: ${result.message}`,
    );

    const busyDuration = packet ? packetLifetime(packet) : 700;
    busyTimer = setTimeout(() => {
      set({ isSimulating: false });
      busyTimer = null;
    }, busyDuration);
    if (packet) {
      animationTimer = setTimeout(() => {
        set({ activePacket: null });
        animationTimer = null;
      }, busyDuration);
    }
  },

  clearSimulation: () => {
    clearTimers();
    set({ simulation: null, activePacket: null, isSimulating: false });
  },

  setPanel: (panel) => set({ panel }),

  addLog: (level, scope, message) => {
    set((state) => withLog(state, makeLog(level, scope, message)));
  },

  clearLogs: () => {
    set({ logs: [makeLog('info', 'system', 'Console cleared.')] });
  },

  showToast: (message, tone) => {
    set({ toast: { id: createId('toast'), message, tone } });
  },

  dismissToast: () => set({ toast: null }),

  loadTemplate: (id) => {
    const template = getTemplate(id);
    if (!template) {
      get().showToast('Template not found.', 'error');
      return;
    }
    clearTimers();
    const { devices, connections } = template.build();
    const source = findByName(devices, template.suggestedSource);
    const target = findByName(devices, template.suggestedTarget);
    const fallback = suggestEndpoints(devices);
    set((state) => ({
      topologyName: template.name,
      devices,
      connections,
      selectedDeviceId: null,
      selectedConnectionId: null,
      simulation: null,
      activePacket: null,
      isSimulating: false,
      simSourceId: source?.id ?? fallback.source,
      simTargetId: target?.id ?? fallback.target,
      panel: 'inspector',
      fitRequest: state.fitRequest + 1,
      ...withLog(
        state,
        makeLog(
          'success',
          'persistence',
          `Template "${template.name}" loaded — ${devices.length} devices, ${connections.length} cables.`,
        ),
      ),
    }));
    get().showToast(`Loaded "${template.name}".`, 'success');
  },

  importTopology: (name, devices, connections) => {
    clearTimers();
    const suggested = suggestEndpoints(devices);
    set((state) => ({
      topologyName: name,
      devices,
      connections,
      selectedDeviceId: null,
      selectedConnectionId: null,
      simulation: null,
      activePacket: null,
      isSimulating: false,
      simSourceId: suggested.source,
      simTargetId: suggested.target,
      panel: 'inspector',
      fitRequest: state.fitRequest + 1,
      ...withLog(
        state,
        makeLog(
          'success',
          'persistence',
          `Imported "${name}" — ${devices.length} devices, ${connections.length} cables.`,
        ),
      ),
    }));
    get().showToast(`Imported "${name}".`, 'success');
  },

  resetWorkspace: () => {
    clearTimers();
    set((state) => ({
      topologyName: 'Untitled Network',
      devices: [],
      connections: [],
      selectedDeviceId: null,
      selectedConnectionId: null,
      simulation: null,
      activePacket: null,
      isSimulating: false,
      simSourceId: '',
      simTargetId: '',
      panel: 'inspector',
      fitRequest: state.fitRequest + 1,
      ...withLog(state, makeLog('warning', 'system', 'Workspace cleared. Add devices from the palette to start.')),
    }));
  },

  requestFitView: () => {
    set((state) => ({ fitRequest: state.fitRequest + 1 }));
  },
}));
