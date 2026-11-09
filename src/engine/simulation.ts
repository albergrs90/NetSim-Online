/**
 * Packet simulation engine.
 *
 * The simulator walks the physical graph, applies layer-2 broadcast-domain
 * rules, validates gateways and performs longest-prefix route lookups on every
 * router in the path. It returns a fully described `SimulationResult` (hops,
 * latency, reasons and the edge sequence used by the animation layer).
 */

import type {
  Connection,
  Device,
  NetworkHop,
  Packet,
  Protocol,
  SimulationResult,
} from '../types/network';
import {
  getInterfaceCidr,
  isValidIPv4,
  isValidSubnetMask,
  isSameSubnet,
  maskToPrefixLength,
} from './ip';
import { decideRoute } from './routing';
import {
  buildAdjacency,
  detectIpConflicts,
  isLinkUsable,
  otherEnd,
  primaryInterface,
  primaryIp,
} from './topology';
import { createId } from '../utils/format';

interface SimulationContext {
  deviceMap: Map<string, Device>;
  adjacency: Map<string, Connection[]>;
}

interface RawResult {
  success: boolean;
  message: string;
  path: string[];
  edgePath: string[];
  hops: NetworkHop[];
  roundTripMs: number;
  details: string[];
  sourceIp: string;
  targetIp: string;
  targetStatus: Packet['status'];
}

/** Deterministic jitter so repeated runs look realistic but stable. */
function jitter(seed: string, min = 0.1, max = 0.6): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unit = ((hash >>> 0) % 1000) / 1000;
  return min + unit * (max - min);
}

function hopIp(device: Device, targetIp: string): string {
  if (device.type === 'switch') return '—';
  if (device.type === 'router') {
    const matching = device.interfaces.find((iface) => {
      const cidr = getInterfaceCidr(iface);
      if (!cidr) return false;
      return isSameSubnet(iface.ipAddress, targetIp, iface.subnetMask);
    });
    if (matching) return matching.ipAddress;
  }
  return primaryIp(device) || '—';
}

function buildHops(
  path: string[],
  context: SimulationContext,
  targetIp: string,
  targetId: string,
  notes: Record<string, string>,
): { hops: NetworkHop[]; totalLatency: number } {
  const hops: NetworkHop[] = [];
  let latency = 0.2;

  path.forEach((deviceId, index) => {
    const device = context.deviceMap.get(deviceId);
    if (!device) return;
    if (index > 0) {
      const base = device.type === 'router' ? 1.1 : device.type === 'switch' ? 0.4 : 0.5;
      latency += base + jitter(`${deviceId}:${index}:${targetIp}`);
    }
    const role: NetworkHop['role'] =
      index === 0
        ? 'source'
        : deviceId === targetId
          ? 'destination'
          : device.type === 'router'
            ? 'router'
            : 'switch';
    hops.push({
      deviceId,
      deviceName: device.name,
      deviceType: device.type,
      ip: index === 0 ? primaryIp(device) || '—' : deviceId === targetId ? targetIp : hopIp(device, targetIp),
      role,
      latencyMs: Number(latency.toFixed(1)),
      note:
        notes[deviceId] ??
        (role === 'source'
          ? 'Echo request generated'
          : role === 'destination'
            ? 'Echo reply generated'
            : device.type === 'router'
              ? 'IPv4 forwarding'
              : 'Layer-2 forwarding'),
    });
  });

  return { hops, totalLatency: Number(latency.toFixed(1)) };
}

/** BFS over usable links; only device types in `transit` may be crossed. */
export function findPath(
  context: SimulationContext,
  sourceId: string,
  targetId: string,
  transit: ReadonlySet<Device['type']>,
): string[] | null {
  if (sourceId === targetId) return [sourceId];
  const queue: string[] = [sourceId];
  const visited = new Set<string>([sourceId]);
  const previous = new Map<string, string>();

  while (queue.length > 0) {
    const current = queue.shift() as string;
    const links = context.adjacency.get(current) ?? [];
    for (const link of links) {
      if (!isLinkUsable(link, context.deviceMap)) continue;
      const neighbor = otherEnd(link, current);
      if (visited.has(neighbor)) continue;
      const neighborDevice = context.deviceMap.get(neighbor);
      if (!neighborDevice) continue;

      const isTarget = neighbor === targetId;
      if (!isTarget && !transit.has(neighborDevice.type)) continue;

      visited.add(neighbor);
      previous.set(neighbor, current);
      if (isTarget) {
        const path: string[] = [neighbor];
        let cursor = current;
        while (cursor !== sourceId) {
          path.unshift(cursor);
          const parent = previous.get(cursor);
          if (!parent) break;
          cursor = parent;
        }
        path.unshift(sourceId);
        return path;
      }
      queue.push(neighbor);
    }
  }
  return null;
}

function resolveEdgePath(context: SimulationContext, path: string[]): string[] {
  const edges: string[] = [];
  for (let i = 0; i < path.length - 1; i += 1) {
    const from = path[i];
    const to = path[i + 1];
    const links = context.adjacency.get(from) ?? [];
    const link = links.find(
      (candidate) => otherEnd(candidate, from) === to && isLinkUsable(candidate, context.deviceMap),
    );
    if (!link) return [];
    edges.push(link.id);
  }
  return edges;
}

function findGatewayRouter(
  context: SimulationContext,
  gateway: string,
  path: string[],
): { device: Device; interfaceName: string } | null {
  for (const deviceId of path) {
    const device = context.deviceMap.get(deviceId);
    if (!device || device.type !== 'router' || !device.isOnline) continue;
    const iface = device.interfaces.find((candidate) => candidate.ipAddress === gateway);
    if (iface) return { device, interfaceName: iface.name };
  }
  return null;
}

function onlineGatewayExists(context: SimulationContext, gateway: string): boolean {
  for (const device of context.deviceMap.values()) {
    if (device.type !== 'router' || !device.isOnline) continue;
    if (device.interfaces.some((iface) => iface.ipAddress === gateway)) return true;
  }
  return false;
}

/**
 * Runs a ping or traceroute between two devices.
 * The function is pure: identical inputs produce identical paths and messages
 * (except for the timestamp / generated ids).
 */
export function simulate(
  devices: Device[],
  connections: Connection[],
  sourceId: string,
  targetId: string,
  protocol: Protocol,
): SimulationResult {
  const context: SimulationContext = {
    deviceMap: new Map(devices.map((device) => [device.id, device])),
    adjacency: buildAdjacency(connections),
  };
  const source = context.deviceMap.get(sourceId);
  const target = context.deviceMap.get(targetId);
  const conflicts = detectIpConflicts(devices, connections);
  const details: string[] = [];
  const timestamp = Date.now();

  const finish = (raw: RawResult): SimulationResult => {
    const sourceName = source?.name ?? 'Unknown';
    const targetName = target?.name ?? 'Unknown';
    const success = raw.success;
    const packet: Packet = {
      id: createId('pkt'),
      protocol,
      sourceId,
      targetId,
      sourceIp: raw.sourceIp,
      targetIp: raw.targetIp,
      status: raw.targetStatus,
      createdAt: timestamp,
      path: raw.hops,
    };
    const hopCount = raw.hops.length;
    let message = raw.message;
    if (success && protocol === 'ping') {
      message = `Reply from ${raw.targetIp}: bytes=32 time=${raw.roundTripMs.toFixed(1)}ms TTL=${Math.max(
        1,
        64 - hopCount * 2,
      )}`;
    } else if (success && protocol === 'traceroute') {
      message = `Traceroute to ${raw.targetIp} complete — ${hopCount} hops, ${raw.roundTripMs.toFixed(
        1,
      )} ms round trip.`;
    }
    return {
      id: createId('sim'),
      protocol,
      success,
      sourceId,
      targetId,
      sourceName,
      targetName,
      path: raw.path,
      edgePath: raw.edgePath,
      hops: raw.hops,
      roundTripMs: Number(raw.roundTripMs.toFixed(1)),
      message,
      details: [...details, ...raw.details],
      packet,
      timestamp,
    };
  };

  const fail = (
    message: string,
    options: {
      sourceIp?: string;
      targetIp?: string;
      path?: string[];
      edgePath?: string[];
      targetStatus?: Packet['status'];
    } = {},
  ): SimulationResult => {
    const path = options.path ?? (source && target ? [sourceId, targetId] : []);
    const hops: NetworkHop[] = [];
    if (source) {
      hops.push({
        deviceId: source.id,
        deviceName: source.name,
        deviceType: source.type,
        ip: options.sourceIp || primaryIp(source) || '—',
        role: 'source',
        latencyMs: 0.2,
        note: 'Packet originated',
      });
    }
    if (target) {
      hops.push({
        deviceId: target.id,
        deviceName: target.name,
        deviceType: target.type,
        ip: options.targetIp || primaryIp(target) || '—',
        role: 'dropped',
        latencyMs: 0,
        note: message,
      });
    }
    return finish({
      success: false,
      message,
      path,
      edgePath: options.edgePath ?? [],
      hops,
      roundTripMs: 0,
      details: [],
      sourceIp: options.sourceIp ?? (source ? primaryIp(source) : ''),
      targetIp: options.targetIp ?? (target ? primaryIp(target) : ''),
      targetStatus: options.targetStatus ?? 'dropped',
    });
  };

  if (!source || !target) {
    return fail('Simulation target not found. Select two devices and try again.');
  }
  if (sourceId === targetId) {
    return fail('Source and destination must be different devices.');
  }
  if (!source.isOnline) {
    return fail(`${source.name} is offline — no ICMP echo request can be sent.`);
  }
  if (!target.isOnline) {
    return fail(
      protocol === 'ping'
        ? 'Request Timed Out — destination host is offline.'
        : 'Destination host unreachable — device is offline.',
    );
  }

  const sourceIface = primaryInterface(source);
  const targetIface = primaryInterface(target);
  const sourceIp = sourceIface?.ipAddress ?? '';
  const targetIp = targetIface?.ipAddress ?? '';

  if (!sourceIface || !isValidIPv4(sourceIp)) {
    return fail(`${source.name} has no valid IPv4 address configured.`);
  }
  if (!targetIface || !isValidIPv4(targetIp)) {
    return fail(`${target.name} has no valid IPv4 address configured.`);
  }
  if (!isValidSubnetMask(sourceIface.subnetMask)) {
    return fail(`${source.name}/${sourceIface.name} has an invalid subnet mask.`);
  }
  if (!isValidSubnetMask(targetIface.subnetMask)) {
    return fail(`${target.name}/${targetIface.name} has an invalid subnet mask.`);
  }

  const endpointConflict = conflicts.find(
    (conflict) =>
      conflict.a.deviceId === sourceId ||
      conflict.b.deviceId === sourceId ||
      conflict.a.deviceId === targetId ||
      conflict.b.deviceId === targetId,
  );
  if (endpointConflict) {
    return fail(
      `IP conflict detected: ${endpointConflict.ip} is shared by ${endpointConflict.a.deviceName} and ${endpointConflict.b.deviceName} in the same broadcast domain.`,
      { sourceIp, targetIp },
    );
  }

  const sameSubnet = isSameSubnet(sourceIp, targetIp, sourceIface.subnetMask);
  const sourceIsRouter = source.type === 'router';
  const sourceIsHost = source.type === 'pc' || source.type === 'server';
  const targetIsHost = target.type === 'pc' || target.type === 'server';

  details.push(
    `Subnet check: ${sourceIp}/${maskToPrefixLength(sourceIface.subnetMask)} → ${targetIp}/${maskToPrefixLength(
      targetIface.subnetMask,
    )} (${sameSubnet ? 'same subnet' : 'different subnet'}).`,
  );

  if (sourceIsHost && !sourceIface.gateway) {
    details.push('Warning: no default gateway configured on the source host.');
  }

  const routeNote: Record<string, string> = {};
  const routersInPath = (path: string[]): Device[] =>
    path
      .map((id) => context.deviceMap.get(id))
      .filter((device): device is Device => Boolean(device && device.type === 'router'));

  if (sameSubnet) {
    const path = findPath(context, sourceId, targetId, new Set<Device['type']>(['switch']));
    if (!path) {
      details.push('No layer-2 path through switches was found.');
      return fail(
        'Destination Host Unreachable — no active layer-2 path between the devices. Check cables and switch power.',
        { sourceIp, targetIp },
      );
    }
    details.push(`Layer-2 path: ${path.map((id) => context.deviceMap.get(id)?.name ?? id).join(' → ')}.`);
    const edgePath = resolveEdgePath(context, path);
    const { hops, totalLatency } = buildHops(path, context, targetIp, targetId, routeNote);
    const roundTrip = totalLatency * 2 + jitter(`${sourceId}:${targetId}:rtt`, 0.2, 0.7);
    return finish({
      success: true,
      message: '',
      path,
      edgePath,
      hops,
      roundTripMs: roundTrip,
      details,
      sourceIp,
      targetIp,
      targetStatus: 'delivered',
    });
  }

  // ---- Cross-subnet: validate gateways, route lookups and the L3 path. ----

  if (sourceIsHost) {
    const gateway = sourceIface.gateway.trim();
    if (!gateway) {
      return fail(
        `No default gateway configured on ${source.name}. A router is required to reach ${targetIp}.`,
        { sourceIp, targetIp },
      );
    }
    if (!isValidIPv4(gateway) || !isSameSubnet(sourceIp, gateway, sourceIface.subnetMask)) {
      return fail(
        `Default gateway ${gateway || '(empty)'} is not reachable from ${source.name} — it must belong to ${sourceIp}/${maskToPrefixLength(
          sourceIface.subnetMask,
        )}.`,
        { sourceIp, targetIp },
      );
    }
    if (!onlineGatewayExists(context, gateway)) {
      return fail(`Default gateway ${gateway} is offline or not configured on any router.`, {
        sourceIp,
        targetIp,
      });
    }
    details.push(`Source gateway: ${gateway}.`);
  }

  if (sourceIsRouter) {
    const decision = decideRoute(source, targetIp);
    details.push(`Route lookup on ${source.name}: ${decision.reason}`);
    if (!decision.route) {
      return fail(decision.reason, { sourceIp, targetIp });
    }
  }

  if (targetIsHost) {
    const gateway = targetIface.gateway.trim();
    if (!gateway) {
      return fail(
        `Reply dropped — ${target.name} has no default gateway configured to reach ${sourceIp}.`,
        { sourceIp, targetIp },
      );
    }
    if (!isValidIPv4(gateway) || !isSameSubnet(targetIp, gateway, targetIface.subnetMask)) {
      return fail(
        `Reply dropped — the default gateway of ${target.name} is not reachable from ${targetIp}.`,
        { sourceIp, targetIp },
      );
    }
    if (!onlineGatewayExists(context, gateway)) {
      return fail(`Reply dropped — the default gateway of ${target.name} (${gateway}) is offline.`, {
        sourceIp,
        targetIp,
      });
    }
    details.push(`Target gateway: ${gateway}.`);
  }

  const path = findPath(context, sourceId, targetId, new Set<Device['type']>(['switch', 'router']));
  if (!path) {
    return fail(
      'Destination Host Unreachable — no active routed path between the subnets. Verify router interfaces and cables.',
      { sourceIp, targetIp },
    );
  }

  const routers = routersInPath(path);
  if (routers.length === 0) {
    return fail(
      `Destination Host Unreachable — ${source.name} and ${target.name} are in different subnets but no online router sits on the active path.`,
      { sourceIp, targetIp },
    );
  }

  if (sourceIsHost) {
    const gateway = sourceIface.gateway.trim();
    const gatewayRouter = findGatewayRouter(context, gateway, path);
    if (!gatewayRouter) {
      return fail(
        `Default gateway ${gateway} is not on the active path to ${targetIp}. Check the router's interfaces and cable to the source segment.`,
        { sourceIp, targetIp },
      );
    }
    const firstRouter = routers[0];
    if (firstRouter && firstRouter.id !== gatewayRouter.device.id) {
      return fail(
        `Default gateway ${gateway} is not the first router on the active path — traffic would reach ${firstRouter.name} before ${gatewayRouter.device.name}. Check the source segment cabling.`,
        { sourceIp, targetIp, path, edgePath: resolveEdgePath(context, path) },
      );
    }
    details.push(`Gateway ${gateway} resolved on ${gatewayRouter.device.name}/${gatewayRouter.interfaceName}.`);
  }

  if (targetIsHost) {
    const gateway = targetIface.gateway.trim();
    const gatewayRouter = findGatewayRouter(context, gateway, path);
    if (!gatewayRouter) {
      return fail(
        `Reply dropped — target gateway ${gateway} is not on the active path back to ${sourceIp}.`,
        { sourceIp, targetIp },
      );
    }
    const lastRouter = routers[routers.length - 1];
    if (lastRouter && lastRouter.id !== gatewayRouter.device.id) {
      return fail(
        `Reply dropped — target gateway ${gateway} does not sit on the final router of the path (${lastRouter.name}). Check the destination segment cabling.`,
        { sourceIp, targetIp, path, edgePath: resolveEdgePath(context, path) },
      );
    }
  }

  for (const router of routers) {
    const decision = decideRoute(router, targetIp);
    if (!decision.route) {
      details.push(`Route lookup on ${router.name}: ${decision.reason}`);
      return fail(decision.reason, {
        sourceIp,
        targetIp,
        path,
        edgePath: resolveEdgePath(context, path),
      });
    }
    details.push(`Route lookup on ${router.name}: ${decision.reason}`);
    routeNote[router.id] = `Route ${decision.route.destinationCidr} via ${decision.route.interfaceName}`;
  }

  const edgePath = resolveEdgePath(context, path);
  if (edgePath.length !== path.length - 1) {
    return fail('Destination Host Unreachable — one of the links on the route is down.', {
      sourceIp,
      targetIp,
      path,
    });
  }

  details.push(
    `Routed path: ${path
      .map((id) => {
        const device = context.deviceMap.get(id);
        return device ? `${device.name} (${hopIp(device, targetIp)})` : id;
      })
      .join(' → ')}.`,
  );

  const { hops, totalLatency } = buildHops(path, context, targetIp, targetId, routeNote);
  const roundTrip = totalLatency * 2 + jitter(`${sourceId}:${targetId}:rtt`, 0.2, 0.7);

  return finish({
    success: true,
    message: '',
    path,
    edgePath,
    hops,
    roundTripMs: roundTrip,
    details,
    sourceIp,
    targetIp,
    targetStatus: 'delivered',
  });
}

/** Convenience wrappers used by the store and by tests. */
export function ping(
  devices: Device[],
  connections: Connection[],
  sourceId: string,
  targetId: string,
): SimulationResult {
  return simulate(devices, connections, sourceId, targetId, 'ping');
}

export function traceroute(
  devices: Device[],
  connections: Connection[],
  sourceId: string,
  targetId: string,
): SimulationResult {
  return simulate(devices, connections, sourceId, targetId, 'traceroute');
}
