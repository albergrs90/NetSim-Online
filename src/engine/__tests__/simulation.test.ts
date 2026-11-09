/**
 * Unit tests for src/engine/simulation.ts — ping and traceroute with
 * gateway validation, routing-table lookups and failure handling.
 */

import { describe, expect, it } from 'vitest';
import type { Connection, Device, NetworkInterface } from '../../types/network';
import { ping, traceroute } from '../simulation';

const iface = (
  id: string,
  name: string,
  ipAddress: string,
  subnetMask: string,
  gateway = '',
  macAddress = '',
): NetworkInterface => ({ id, name, ipAddress, subnetMask, gateway, macAddress });

const device = (
  id: string,
  type: Device['type'],
  interfaces: NetworkInterface[] = [],
  isOnline = true,
  routingTable: never[] = [],
): Device => ({
  id,
  name: id,
  type,
  interfaces,
  isOnline,
  position: { x: 0, y: 0 },
  routingTable,
});

const conn = (
  id: string,
  source: string,
  target: string,
  sourceInterfaceId?: string,
  targetInterfaceId?: string,
  isEnabled = true,
): Connection => ({
  id,
  source,
  target,
  sourceHandle: null,
  targetHandle: null,
  sourceInterfaceId,
  targetInterfaceId,
  isEnabled,
  cableType: 'copper',
});

const offline = (d: Device) => ({ ...d, isOnline: false });

/**
 * WAN-like fixture:
 *
 * pc-a(192.168.10.10/24, gw .1) — sw1 — r1(eth0 .1/24, eth1 10.0.0.1/30)
 *                                                                   |
 *                                                                   |
 * r2(eth0 10.0.0.2/30, eth1 172.16.20.1/24) — sw2 — srv(172.16.20.20/24, gw .1)
 *
 * Static routes: r1 -> 172.16.20.0/24 via 10.0.0.2 (eth1)
 *                r2 -> 192.168.10.0/24 via 10.0.0.1 (eth0)
 */
function buildNetwork() {
  const pcA = device('pc-a', 'pc', [iface('i-pc-a', 'eth0', '192.168.10.10', '255.255.255.0', '192.168.10.1')]);
  const pcB = device('pc-b', 'pc', [iface('i-pc-b', 'eth0', '192.168.10.11', '255.255.255.0', '192.168.10.1')]);
  const srv = device('srv', 'server', [iface('i-srv', 'eth0', '172.16.20.20', '255.255.255.0', '172.16.20.1')]);
  const sw1 = device('sw1', 'switch');
  const sw2 = device('sw2', 'switch');
  const r1 = device('r1', 'router', [
    iface('r1-eth0', 'eth0', '192.168.10.1', '255.255.255.0'),
    iface('r1-eth1', 'eth1', '10.0.0.1', '255.255.255.252'),
  ]);
  const r2 = device('r2', 'router', [
    iface('r2-eth0', 'eth0', '10.0.0.2', '255.255.255.252'),
    iface('r2-eth1', 'eth1', '172.16.20.1', '255.255.255.0'),
  ]);

  r1.routingTable = [
    { id: 'r1-static-wan', destinationCidr: '172.16.20.0/24', nextHop: '10.0.0.2', interfaceName: 'eth1', metric: 10, type: 'static' },
  ];
  r2.routingTable = [
    { id: 'r2-static-lan', destinationCidr: '192.168.10.0/24', nextHop: '10.0.0.1', interfaceName: 'eth0', metric: 10, type: 'static' },
  ];

  const connections = [
    conn('c1', 'pc-a', 'sw1', 'i-pc-a'),
    conn('c2', 'pc-b', 'sw1', 'i-pc-b'),
    conn('c3', 'sw1', 'r1', undefined, 'r1-eth0'),
    conn('c4', 'r1', 'r2', 'r1-eth1', 'r2-eth0'),
    conn('c5', 'r2', 'sw2', 'r2-eth1'),
    conn('c6', 'sw2', 'srv', undefined, 'i-srv'),
  ];

  return { devices: [pcA, pcB, srv, sw1, sw2, r1, r2], connections };
}

describe('ping / traceroute — same subnet (layer 2)', () => {
  it('pings successfully through a switch', () => {
    const { devices, connections } = buildNetwork();
    const result = ping(devices, connections, 'pc-a', 'pc-b');
    expect(result.success).toBe(true);
    expect(result.path).toEqual(['pc-a', 'sw1', 'pc-b']);
    expect(result.hops.map((h) => h.role)).toEqual(['source', 'switch', 'destination']);
    expect(result.packet.status).toBe('delivered');
    expect(result.roundTripMs).toBeGreaterThan(0);
    expect(result.message).toContain('Reply from 192.168.10.11');
  });

  it('traces the same layer-2 path', () => {
    const { devices, connections } = buildNetwork();
    const result = traceroute(devices, connections, 'pc-a', 'pc-b');
    expect(result.success).toBe(true);
    expect(result.protocol).toBe('traceroute');
    expect(result.message).toContain('Traceroute to 192.168.10.11 complete');
  });
});

describe('ping / traceroute — cross-subnet (layer 3)', () => {
  it('routes successfully through two routers with static routes', () => {
    const { devices, connections } = buildNetwork();
    const result = ping(devices, connections, 'pc-a', 'srv');
    expect(result.success).toBe(true);
    expect(result.path).toEqual(['pc-a', 'sw1', 'r1', 'r2', 'sw2', 'srv']);
    expect(result.hops.map((h) => h.deviceId)).toEqual(['pc-a', 'sw1', 'r1', 'r2', 'sw2', 'srv']);
    expect(result.packet.status).toBe('delivered');
    expect(result.roundTripMs).toBeGreaterThan(0);
    expect(result.message).toContain('Reply from 172.16.20.20');
    expect(result.details.some((d) => d.includes('Route lookup on r1'))).toBe(true);
    expect(result.details.some((d) => d.includes('Route lookup on r2'))).toBe(true);
  });

  it('traces the routed path hop by hop', () => {
    const { devices, connections } = buildNetwork();
    const result = traceroute(devices, connections, 'pc-a', 'srv');
    expect(result.success).toBe(true);
    expect(result.hops.length).toBe(6);
    expect(result.message).toContain('complete — 6 hops');
  });

  it('requires a source default gateway', () => {
    const { devices, connections } = buildNetwork();
    const noGateway = device('pc-no-gw', 'pc', [
      iface('i', 'eth0', '192.168.10.50', '255.255.255.0', ''),
    ]);
    const result = ping([...devices, noGateway], connections, 'pc-no-gw', 'srv');
    expect(result.success).toBe(false);
    expect(result.message).toContain('No default gateway');
  });

  it('requires the target to have a default gateway for replies', () => {
    const { devices, connections } = buildNetwork();
    const noGatewaySrv = device('srv-no-gw', 'server', [
      iface('i', 'eth0', '172.16.20.50', '255.255.255.0', ''),
    ]);
    // Replace srv with the gateway-less variant.
    const result = ping(
      devices.map((d) => (d.id === 'srv' ? noGatewaySrv : d)),
      connections,
      'pc-a',
      'srv-no-gw',
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain('no default gateway');
  });

  it('fails with no route when a router lacks a matching entry', () => {
    const { devices, connections } = buildNetwork();
    const r1NoRoute = device('r1', 'router', [
      iface('r1-eth0', 'eth0', '192.168.10.1', '255.255.255.0'),
      iface('r1-eth1', 'eth1', '10.0.0.1', '255.255.255.252'),
    ]);
    const result = ping(
      devices.map((d) => (d.id === 'r1' ? r1NoRoute : d)),
      connections,
      'pc-a',
      'srv',
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain('has no route to 172.16.20.20');
  });

  it('fails when a link on the routed path is cut', () => {
    const { devices, connections } = buildNetwork();
    const result = ping(
      devices,
      connections.map((c) => (c.id === 'c4' ? { ...c, isEnabled: false } : c)),
      'pc-a',
      'srv',
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain('Host Unreachable');
  });
});

describe('ping / traceroute — device state', () => {
  it('refuses to ping an offline source', () => {
    const { devices, connections } = buildNetwork();
    const result = ping(devices, connections, 'offline-pc', 'srv');
    expect(result.success).toBe(false);
  });

  it('times out on an offline destination', () => {
    const { devices, connections } = buildNetwork();
    const offlineSrv = offline(devices.find((d) => d.id === 'srv')!);
    const result2 = ping(
      devices.map((d) => (d.id === 'srv' ? offlineSrv : d)),
      connections,
      'pc-a',
      'srv',
    );
    expect(result2.success).toBe(false);
    expect(result2.message).toContain('offline');
    expect(result2.packet.status).toBe('dropped');
  });

  it('rejects simulating a device to itself', () => {
    const { devices, connections } = buildNetwork();
    const result = ping(devices, connections, 'pc-a', 'pc-a');
    expect(result.success).toBe(false);
    expect(result.message).toContain('different devices');
  });
});

describe('ping — IP conflict', () => {
  it('fails when the source shares an IP in the same broadcast domain', () => {
    const { devices, connections } = buildNetwork();
    const duplicate = device('pc-dup', 'pc', [
      iface('i-dup', 'eth0', '192.168.10.10', '255.255.255.0', '192.168.10.1'),
    ]);
    const result = ping(
      [...devices, duplicate],
      [...connections, conn('c7', 'pc-dup', 'sw1', 'i-dup')],
      'pc-dup',
      'srv',
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain('IP conflict');
    expect(result.message).toContain('192.168.10.10');
  });
});
