/**
 * Unit tests for src/engine/routing.ts — connected routes, longest-prefix
 * match, static-route usability and route decisions.
 */

import { describe, expect, it } from 'vitest';
import type { Device, RoutingEntry } from '../../types/network';
import {
  buildRoutingTable,
  cidrContains,
  connectedRoutes,
  decideRoute,
  interfaceForNetwork,
  longestPrefixMatch,
  routerReachesNetwork,
  validateRoutingEntry,
} from '../routing';

const iface = (id: string, name: string, ipAddress: string, subnetMask: string) => ({
  id,
  name,
  ipAddress,
  subnetMask,
  gateway: '',
  macAddress: '',
});

const router = (
  id: string,
  interfaces: { id: string; name: string; ipAddress: string; subnetMask: string }[],
  routingTable: RoutingEntry[] = [],
): Device => ({
  id,
  name: id,
  type: 'router',
  interfaces: interfaces.map((i) => iface(i.id, i.name, i.ipAddress, i.subnetMask)),
  isOnline: true,
  position: { x: 0, y: 0 },
  routingTable,
});

const staticRoute = (
  id: string,
  destinationCidr: string,
  nextHop: string,
  interfaceName: string,
  metric = 10,
): RoutingEntry => ({
  id,
  destinationCidr,
  nextHop,
  interfaceName,
  metric,
  type: 'static',
});

const coreRouter = () =>
  router('r1', [
    { id: 'eth0', name: 'eth0', ipAddress: '192.168.10.1', subnetMask: '255.255.255.0' },
    { id: 'eth1', name: 'eth1', ipAddress: '10.0.0.1', subnetMask: '255.255.255.252' },
  ]);

describe('cidrContains', () => {
  it('reports membership correctly', () => {
    expect(cidrContains('192.168.10.0/24', '192.168.10.55')).toBe(true);
    expect(cidrContains('192.168.10.0/24', '10.0.0.1')).toBe(false);
    expect(cidrContains('10.0.0.0/30', '10.0.0.2')).toBe(true);
    expect(cidrContains('10.0.0.0/30', '10.0.0.4')).toBe(false);
    expect(cidrContains('0.0.0.0/0', '1.2.3.4')).toBe(true);
    expect(cidrContains('not-a-cidr', '1.2.3.4')).toBe(false);
    expect(cidrContains('192.168.10.0/24', 'not-an-ip')).toBe(false);
  });
});

describe('configuredInterfaces / connectedRoutes', () => {
  it('only returns interfaces with valid IPv4 configuration', () => {
    const r = router('r1', [
      { id: 'eth0', name: 'eth0', ipAddress: '192.168.10.1', subnetMask: '255.255.255.0' },
      { id: 'eth1', name: 'eth1', ipAddress: '10.0.0.1', subnetMask: '255.255.255.252' },
      { id: 'eth2', name: 'eth2', ipAddress: '', subnetMask: '' },
      { id: 'eth3', name: 'eth3', ipAddress: '255.255.0.255', subnetMask: '255.255.0.255' },
    ]);
    expect(connectedRoutes(r).map((route) => route.interfaceName)).toEqual(['eth0', 'eth1']);
  });

  it('derives connected routes with the interface address as next hop', () => {
    const routes = connectedRoutes(coreRouter());
    expect(routes).toHaveLength(2);
    expect(routes.find((r) => r.interfaceName === 'eth0')).toMatchObject({
      destinationCidr: '192.168.10.0/24',
      nextHop: '192.168.10.1',
      type: 'connected',
      metric: 0,
    });
    expect(routes.find((r) => r.interfaceName === 'eth1')).toMatchObject({
      destinationCidr: '10.0.0.0/30',
      nextHop: '10.0.0.1',
      type: 'connected',
    });
  });
});

describe('buildRoutingTable', () => {
  it('sorts by longest prefix first, then lowest metric', () => {
    const r = router('r1', [
      { id: 'eth0', name: 'eth0', ipAddress: '192.168.10.1', subnetMask: '255.255.255.0' },
    ], [
      staticRoute('s-default', '0.0.0.0/0', '10.0.0.2', 'eth1'),
      staticRoute('s-wide', '172.16.0.0/16', '10.0.0.2', 'eth1'),
      staticRoute('s-specific', '172.16.20.0/24', '10.0.0.2', 'eth1'),
    ]);
    const table = buildRoutingTable(r);
    expect(table[0]).toMatchObject({ destinationCidr: '192.168.10.0/24', type: 'connected' });
    expect(table[1]).toMatchObject({ destinationCidr: '172.16.20.0/24', type: 'static' });
    expect(table[2]).toMatchObject({ destinationCidr: '172.16.0.0/16', type: 'static' });
    expect(table[3]).toMatchObject({ destinationCidr: '0.0.0.0/0', type: 'static' });
  });
});

describe('longestPrefixMatch', () => {
  it('picks the longest matching prefix', () => {
    const table = buildRoutingTable(coreRouter());
    expect(longestPrefixMatch(table, '192.168.10.55')?.destinationCidr).toBe('192.168.10.0/24');
    expect(longestPrefixMatch(table, '10.0.0.2')?.destinationCidr).toBe('10.0.0.0/30');
    expect(longestPrefixMatch(table, '1.2.3.4')).toBeNull();
  });
});

describe('validateRoutingEntry', () => {
  it('marks connected routes usable', () => {
    expect(validateRoutingEntry(coreRouter(), {
      id: 'c', destinationCidr: '192.168.10.0/24', nextHop: '192.168.10.1',
      interfaceName: 'eth0', metric: 0, type: 'connected',
    })).toEqual({ usable: true });
  });

  it('rejects a static route with a missing egress interface', () => {
    const result = validateRoutingEntry(coreRouter(), staticRoute('s', '172.16.0.0/16', '10.0.0.2', 'eth9'));
    expect(result.usable).toBe(false);
    expect(result.reason).toContain('does not exist');
  });

  it('rejects a static route whose egress interface is unconfigured', () => {
    const r = router('r1', [
      { id: 'eth0', name: 'eth0', ipAddress: '', subnetMask: '' },
    ]);
    const result = validateRoutingEntry(r, staticRoute('s', '172.16.0.0/16', '10.0.0.2', 'eth0'));
    expect(result.usable).toBe(false);
    expect(result.reason).toContain('no valid IPv4 configuration');
  });

  it('rejects a static route with an invalid next hop', () => {
    const result = validateRoutingEntry(coreRouter(), staticRoute('s', '172.16.0.0/16', 'not-an-ip', 'eth1'));
    expect(result.usable).toBe(false);
    expect(result.reason).toContain('not a valid IPv4 address');
  });

  it('rejects a static route whose next hop is outside the egress subnet', () => {
    const result = validateRoutingEntry(coreRouter(), staticRoute('s', '172.16.0.0/16', '9.9.9.9', 'eth1'));
    expect(result.usable).toBe(false);
    expect(result.reason).toContain("outside eth1's subnet");
  });

  it('accepts a valid static route', () => {
    const result = validateRoutingEntry(coreRouter(), staticRoute('s', '172.16.20.0/24', '10.0.0.2', 'eth1'));
    expect(result.usable).toBe(true);
  });
});

describe('decideRoute', () => {
  it('reports no routes when the table is empty', () => {
    const r = router('r1', [], []);
    const decision = decideRoute(r, '10.0.0.1');
    expect(decision.route).toBeNull();
    expect(decision.reason).toContain('has no configured routes');
  });

  it('matches a connected route', () => {
    const decision = decideRoute(coreRouter(), '192.168.10.55');
    expect(decision.route?.destinationCidr).toBe('192.168.10.0/24');
    expect(decision.route?.interfaceName).toBe('eth0');
    expect(decision.reason).toContain('Matched');
  });

  it('prefers a usable static route over a less specific connected route', () => {
    const r = coreRouter();
    r.routingTable = [staticRoute('s', '172.16.20.0/24', '10.0.0.2', 'eth1')];
    const decision = decideRoute(r, '172.16.20.20');
    expect(decision.route?.destinationCidr).toBe('172.16.20.0/24');
    expect(decision.route?.interfaceName).toBe('eth1');
  });

  it('ignores an unusable static route and reports why', () => {
    const r = coreRouter();
    r.routingTable = [staticRoute('s', '172.16.30.0/24', '9.9.9.9', 'eth1')];
    const decision = decideRoute(r, '172.16.30.5');
    expect(decision.route).toBeNull();
    expect(decision.reason).toContain('unusable');
    expect(decision.reason).toContain("outside eth1's subnet");
  });

  it('reports no route when nothing matches the target', () => {
    const decision = decideRoute(coreRouter(), '1.2.3.4');
    expect(decision.route).toBeNull();
    expect(decision.reason).toContain('has no route to 1.2.3.4');
  });

  it('returns a not-a-router decision for non-routers', () => {
    const pc = { ...coreRouter(), type: 'pc' as const, interfaces: [] };
    const decision = decideRoute(pc, '10.0.0.1');
    expect(decision.route).toBeNull();
    expect(decision.reason).toContain('is not a router');
  });
});

describe('interfaceForNetwork / routerReachesNetwork', () => {
  it('finds the interface whose network contains an address', () => {
    const iface = interfaceForNetwork(coreRouter(), '192.168.10.55');
    expect(iface?.name).toBe('eth0');
    expect(interfaceForNetwork(coreRouter(), '10.0.0.2')?.name).toBe('eth1');
    expect(interfaceForNetwork(coreRouter(), '1.2.3.4')).toBeUndefined();
  });

  it('returns true only when a matching interface exists', () => {
    expect(routerReachesNetwork(coreRouter(), '192.168.10.55')).toBe(true);
    expect(routerReachesNetwork(coreRouter(), '1.2.3.4')).toBe(false);
  });
});
