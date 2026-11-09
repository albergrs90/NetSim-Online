/**
 * Topology analysis: adjacency, broadcast domains, IP conflicts and health.
 * Pure functions — the UI calls `analyzeNetwork` whenever the topology changes.
 */

import type {
  Connection,
  Device,
  EdgeHealth,
  IpConflict,
  NetworkHealth,
  NetworkInterface,
} from '../types/network';
import { describeNetwork, isValidIPv4, isValidSubnetMask, validateInterface } from './ip';

export interface InterfaceRef {
  device: Device;
  iface: NetworkInterface;
}

/** Resolves a React Flow handle id to the interface it represents. */
export function resolveInterface(device: Device, handleId?: string | null): NetworkInterface | undefined {
  if (device.interfaces.length === 0) return undefined;
  if (!handleId) return device.interfaces[0];
  const exact = device.interfaces.find((iface) => iface.id === handleId);
  if (exact) return exact;
  const base = handleId.replace(/:(in|out)$/, '').replace(/-(in|out)$/, '');
  const byBase = device.interfaces.find((iface) => iface.id === base);
  if (byBase) return byBase;
  return device.interfaces[0];
}

/** Returns the interface a connection endpoint is attached to. */
export function connectionEndpointInterface(
  connection: Connection,
  side: 'source' | 'target',
  device: Device,
): NetworkInterface | undefined {
  const explicitId = side === 'source' ? connection.sourceInterfaceId : connection.targetInterfaceId;
  if (explicitId) {
    const match = device.interfaces.find((iface) => iface.id === explicitId);
    if (match) return match;
  }
  const handleId = side === 'source' ? connection.sourceHandle : connection.targetHandle;
  return resolveInterface(device, handleId);
}

/** First interface carrying a valid IPv4 address (falls back to the first one). */
export function primaryInterface(device: Device): NetworkInterface | undefined {
  return device.interfaces.find((iface) => isValidIPv4(iface.ipAddress)) ?? device.interfaces[0];
}

/** Primary IP of a device, or "—" when unassigned. */
export function primaryIp(device: Device): string {
  const iface = primaryInterface(device);
  return iface && isValidIPv4(iface.ipAddress) ? iface.ipAddress : '';
}

export function buildAdjacency(connections: Connection[]): Map<string, Connection[]> {
  const adjacency = new Map<string, Connection[]>();
  const push = (id: string, connection: Connection) => {
    const list = adjacency.get(id);
    if (list) list.push(connection);
    else adjacency.set(id, [connection]);
  };
  for (const connection of connections) {
    push(connection.source, connection);
    push(connection.target, connection);
  }
  return adjacency;
}

export function otherEnd(connection: Connection, deviceId: string): string {
  return connection.source === deviceId ? connection.target : connection.source;
}

export function isLinkUsable(connection: Connection, devices: Map<string, Device>): boolean {
  if (!connection.isEnabled) return false;
  const source = devices.get(connection.source);
  const target = devices.get(connection.target);
  return Boolean(source?.isOnline && target?.isOnline);
}

interface DsuNode {
  parent: string;
}

class DisjointSet {
  private readonly nodes = new Map<string, DsuNode>();

  find(key: string): string {
    const node = this.nodes.get(key);
    if (!node) {
      this.nodes.set(key, { parent: key });
      return key;
    }
    if (node.parent !== key) node.parent = this.find(node.parent);
    return node.parent;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.nodes.set(rootB, { parent: rootA });
  }
}

export interface BroadcastMember {
  key: string;
  deviceId: string;
  deviceName: string;
  interfaceId?: string;
  interfaceName?: string;
  ip: string;
}

export interface BroadcastDomain {
  id: string;
  members: BroadcastMember[];
}

function endpointKey(connection: Connection, side: 'source' | 'target', device: Device): string {
  if (device.type === 'switch') return `switch:${device.id}`;
  const iface = connectionEndpointInterface(connection, side, device);
  return `iface:${device.id}:${iface?.id ?? 'none'}`;
}

/**
 * Computes layer-2 broadcast domains.
 *
 * Switches act as a shared bus: every interface attached to a switch (or a chain
 * of switches) ends up in the same domain. Routers keep their interfaces
 * separated, which is what makes cross-subnet routing meaningful.
 */
export function computeBroadcastDomains(
  devices: Device[],
  connections: Connection[],
): BroadcastDomain[] {
  const deviceMap = new Map(devices.map((device) => [device.id, device]));
  const dsu = new DisjointSet();
  const members = new Map<string, BroadcastMember>();

  const register = (key: string, device: Device, iface?: NetworkInterface): void => {
    if (members.has(key)) return;
    members.set(key, {
      key,
      deviceId: device.id,
      deviceName: device.name,
      interfaceId: iface?.id,
      interfaceName: iface?.name,
      ip: iface?.ipAddress ?? '',
    });
  };

  for (const connection of connections) {
    if (!connection.isEnabled) continue;
    const source = deviceMap.get(connection.source);
    const target = deviceMap.get(connection.target);
    if (!source || !target) continue;

    const sourceKey = endpointKey(connection, 'source', source);
    const targetKey = endpointKey(connection, 'target', target);

    register(
      sourceKey,
      source,
      source.type === 'switch' ? undefined : connectionEndpointInterface(connection, 'source', source),
    );
    register(
      targetKey,
      target,
      target.type === 'switch' ? undefined : connectionEndpointInterface(connection, 'target', target),
    );
    dsu.union(sourceKey, targetKey);
  }

  // Isolated devices still belong to their own (single-host) domain.
  for (const device of devices) {
    if (device.type === 'switch') {
      register(`switch:${device.id}`, device);
    } else {
      for (const iface of device.interfaces) register(`iface:${device.id}:${iface.id}`, device, iface);
    }
  }

  const groups = new Map<string, BroadcastMember[]>();
  for (const member of members.values()) {
    const root = dsu.find(member.key);
    const group = groups.get(root);
    if (group) group.push(member);
    else groups.set(root, [member]);
  }

  return Array.from(groups.entries()).map(([root, groupMembers]) => ({
    id: root,
    members: groupMembers,
  }));
}

/** Detects duplicate IPv4 addresses inside the same broadcast domain. */
export function detectIpConflicts(devices: Device[], connections: Connection[]): IpConflict[] {
  const domains = computeBroadcastDomains(devices, connections);
  const deviceMap = new Map(devices.map((device) => [device.id, device]));
  const conflicts: IpConflict[] = [];
  const seen = new Set<string>();

  for (const domain of domains) {
    const byIp = new Map<string, BroadcastMember[]>();
    for (const member of domain.members) {
      if (!isValidIPv4(member.ip)) continue;
      const list = byIp.get(member.ip);
      if (list) list.push(member);
      else byIp.set(member.ip, [member]);
    }
    for (const [ip, list] of byIp) {
      if (list.length < 2) continue;
      for (let i = 1; i < list.length; i += 1) {
        const a = list[0];
        const b = list[i];
        const key = [ip, a.deviceId, a.interfaceId, b.deviceId, b.interfaceId].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const deviceA = deviceMap.get(a.deviceId);
        const deviceB = deviceMap.get(b.deviceId);
        if (!deviceA || !deviceB) continue;
        conflicts.push({
          ip,
          a: {
            deviceId: a.deviceId,
            deviceName: a.deviceName,
            interfaceId: a.interfaceId ?? '',
            interfaceName: a.interfaceName ?? '—',
          },
          b: {
            deviceId: b.deviceId,
            deviceName: b.deviceName,
            interfaceId: b.interfaceId ?? '',
            interfaceName: b.interfaceName ?? '—',
          },
        });
      }
    }
  }
  return conflicts;
}

/** Returns per-device validation messages and conflict hints. */
export function collectDeviceAlerts(devices: Device[], conflicts: IpConflict[]): Record<string, string[]> {
  const alerts: Record<string, string[]> = {};

  for (const device of devices) {
    const messages: string[] = [];
    for (const iface of device.interfaces) {
      const issues = validateInterface(iface);
      for (const issue of issues) {
        const message = `${iface.name}: ${issue.message}`;
        if (!messages.includes(message)) messages.push(message);
      }
    }

    if (device.type === 'pc' || device.type === 'server') {
      const iface = primaryInterface(device);
      if (!iface || !iface.ipAddress.trim()) {
        messages.push('No IPv4 address configured — this host cannot communicate.');
      }
    }

    if (device.type === 'router') {
      const configured = device.interfaces.filter(
        (iface) => isValidIPv4(iface.ipAddress) && isValidSubnetMask(iface.subnetMask),
      );
      if (configured.length < 2) {
        messages.push('Router needs at least two configured interfaces to route between subnets.');
      }
    }

    for (const conflict of conflicts) {
      if (conflict.a.deviceId === device.id || conflict.b.deviceId === device.id) {
        const other = conflict.a.deviceId === device.id ? conflict.b : conflict.a;
        messages.push(`IP conflict: ${conflict.ip} is also assigned to ${other.deviceName}.`);
      }
    }

    if (messages.length > 0) alerts[device.id] = messages;
  }

  return alerts;
}

/** One call that produces every derived health value needed by the UI. */
export function analyzeNetwork(devices: Device[], connections: Connection[]): NetworkHealth {
  const deviceMap = new Map(devices.map((device) => [device.id, device]));
  const conflicts = detectIpConflicts(devices, connections);
  const deviceAlerts = collectDeviceAlerts(devices, conflicts);
  const domains = computeBroadcastDomains(devices, connections);

  const edgeHealth: Record<string, EdgeHealth> = {};
  for (const connection of connections) {
    const source = deviceMap.get(connection.source);
    const target = deviceMap.get(connection.target);
    if (!connection.isEnabled) edgeHealth[connection.id] = 'cut';
    else if (!source?.isOnline || !target?.isOnline) edgeHealth[connection.id] = 'offline';
    else edgeHealth[connection.id] = 'active';
  }

  const onlineDevices = devices.filter((device) => device.isOnline).length;
  const activeLinks = Object.values(edgeHealth).filter((status) => status === 'active').length;

  return {
    conflicts,
    deviceAlerts,
    edgeHealth,
    broadcastDomains: domains.map((domain) => domain.members.map((member) => member.deviceName)),
    onlineDevices,
    totalDevices: devices.length,
    activeLinks,
    totalLinks: connections.length,
    healthy: conflicts.length === 0 && activeLinks === connections.length,
  };
}

/** Human readable network summary for an interface (used in tooltips). */
export function interfaceSummary(iface: NetworkInterface): string {
  if (!iface.ipAddress) return 'No address';
  return `${iface.ipAddress} · ${describeNetwork(iface.ipAddress, iface.subnetMask)}`;
}
