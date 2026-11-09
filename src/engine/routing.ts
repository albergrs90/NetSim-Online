/**
 * Router forwarding logic: connected route generation and longest-prefix match.
 */

import type { Device, NetworkInterface, RoutingEntry } from '../types/network';
import {
  getInterfaceCidr,
  ipToInt,
  isSameSubnet,
  isValidIPv4,
  isValidSubnetMask,
  maskToPrefixLength,
  parseCidr,
  prefixLengthToMask,
} from './ip';

/** True when an IPv4 address falls inside a CIDR network. */
export function cidrContains(cidr: string, ip: string): boolean {
  const parsed = parseCidr(cidr);
  if (!parsed || !isValidIPv4(ip)) return false;
  const mask = ipToInt(prefixLengthToMask(parsed.prefix));
  return ((ipToInt(ip) & mask) >>> 0) === ((ipToInt(parsed.network) & mask) >>> 0);
}

/** Interfaces with a valid IPv4 address and mask. */
export function configuredInterfaces(device: Device): NetworkInterface[] {
  return device.interfaces.filter(
    (iface) => isValidIPv4(iface.ipAddress) && maskToPrefixLength(iface.subnetMask) >= 0,
  );
}

/** Derives connected routes from a router's interfaces. */
export function connectedRoutes(device: Device): RoutingEntry[] {
  const routes: RoutingEntry[] = [];
  for (const iface of configuredInterfaces(device)) {
    const cidr = getInterfaceCidr(iface);
    if (!cidr) continue;
    routes.push({
      id: `${device.id}:connected:${iface.id}`,
      destinationCidr: cidr,
      nextHop: iface.ipAddress,
      interfaceName: iface.name,
      metric: 0,
      type: 'connected',
    });
  }
  return routes;
}

/** Full routing table: connected routes plus valid static routes. */
export function buildRoutingTable(device: Device): RoutingEntry[] {
  if (device.type !== 'router') return [];
  const staticRoutes = device.routingTable.filter((route) => parseCidr(route.destinationCidr) !== null);
  return [...connectedRoutes(device), ...staticRoutes].sort((a, b) => {
    const prefixA = parseCidr(a.destinationCidr)?.prefix ?? 0;
    const prefixB = parseCidr(b.destinationCidr)?.prefix ?? 0;
    if (prefixA !== prefixB) return prefixB - prefixA;
    return a.metric - b.metric;
  });
}

export interface RouteValidation {
  usable: boolean;
  reason?: string;
}

/**
 * A static route is only usable when its egress interface exists, is configured
 * and the next hop belongs to that interface's subnet. Connected routes are
 * derived from valid interfaces and are always usable.
 */
export function validateRoutingEntry(device: Device, route: RoutingEntry): RouteValidation {
  if (route.type === 'connected') return { usable: true };

  const iface = device.interfaces.find((candidate) => candidate.name === route.interfaceName);
  if (!iface) {
    return {
      usable: false,
      reason: `egress interface ${route.interfaceName || '(none)'} does not exist`,
    };
  }
  if (!isValidIPv4(iface.ipAddress) || !isValidSubnetMask(iface.subnetMask)) {
    return {
      usable: false,
      reason: `egress interface ${iface.name} has no valid IPv4 configuration`,
    };
  }
  if (!isValidIPv4(route.nextHop)) {
    return {
      usable: false,
      reason: `next hop ${route.nextHop || '(empty)'} is not a valid IPv4 address`,
    };
  }
  if (!isSameSubnet(route.nextHop, iface.ipAddress, iface.subnetMask)) {
    return {
      usable: false,
      reason: `next hop ${route.nextHop} is outside ${iface.name}'s subnet`,
    };
  }
  return { usable: true };
}

/**
 * Longest-prefix match for a destination address.
 * Static routes are considered after connected routes of the same prefix length
 * only when their metric is lower (handled by the sort).
 */
export function longestPrefixMatch(table: RoutingEntry[], targetIp: string): RoutingEntry | null {
  let best: RoutingEntry | null = null;
  let bestPrefix = -1;
  for (const route of table) {
    const parsed = parseCidr(route.destinationCidr);
    if (!parsed) continue;
    if (!cidrContains(route.destinationCidr, targetIp)) continue;
    if (parsed.prefix > bestPrefix) {
      best = route;
      bestPrefix = parsed.prefix;
    } else if (parsed.prefix === bestPrefix && best && route.metric < best.metric) {
      best = route;
    }
  }
  return best;
}

export interface RouteDecision {
  route: RoutingEntry | null;
  reason: string;
}

/** Resolves where a router would send a packet for a given destination. */
export function decideRoute(device: Device, targetIp: string): RouteDecision {
  if (device.type !== 'router') {
    return { route: null, reason: `${device.name} is not a router.` };
  }
  const table = buildRoutingTable(device);
  if (table.length === 0) {
    return { route: null, reason: `${device.name} has no configured routes.` };
  }

  const invalidStaticRoutes = table.filter(
    (candidate) => candidate.type === 'static' && !validateRoutingEntry(device, candidate).usable,
  );
  const usableTable = table.filter(
    (candidate) => candidate.type !== 'static' || validateRoutingEntry(device, candidate).usable,
  );
  const route = longestPrefixMatch(usableTable, targetIp);
  if (!route) {
    const blocked = invalidStaticRoutes.find((candidate) =>
      cidrContains(candidate.destinationCidr, targetIp),
    );
    if (blocked) {
      const validation = validateRoutingEntry(device, blocked);
      return {
        route: null,
        reason: `${device.name} static route ${blocked.destinationCidr} is unusable: ${
          validation.reason ?? 'invalid configuration'
        } (Destination network unreachable).`,
      };
    }
    return {
      route: null,
      reason: `${device.name} has no route to ${targetIp} (Destination network unreachable).`,
    };
  }
  return {
    route,
    reason: `Matched ${route.destinationCidr} via ${route.interfaceName} (metric ${route.metric}).`,
  };
}

/**
 * Returns the router interface that owns the network containing `ip`, if any.
 * Used to validate that a gateway is actually attached to the source segment.
 */
export function interfaceForNetwork(device: Device, ip: string): NetworkInterface | undefined {
  return configuredInterfaces(device).find((iface) => {
    const cidr = getInterfaceCidr(iface);
    return cidr.length > 0 && cidrContains(cidr, ip);
  });
}

/** True when a router has a configured interface on the same subnet as `ip`. */
export function routerReachesNetwork(device: Device, ip: string): boolean {
  return interfaceForNetwork(device, ip) !== undefined;
}
