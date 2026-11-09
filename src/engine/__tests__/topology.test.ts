/**
 * Unit tests for src/engine/topology.ts — adjacency, broadcast domains,
 * IP conflict detection and network health.
 */

import { describe, expect, it } from 'vitest';
import type { Connection, Device, NetworkInterface } from '../../types/network';
import {
  analyzeNetwork,
  buildAdjacency,
  collectDeviceAlerts,
  computeBroadcastDomains,
  detectIpConflicts,
  isLinkUsable,
  otherEnd,
} from '../topology';

const iface = (
  id: string,
  name: string,
  ipAddress = '',
  subnetMask = '',
  gateway = '',
  macAddress = '',
): NetworkInterface => ({
  id,
  name,
  ipAddress,
  subnetMask,
  gateway,
  macAddress,
});

const device = (
  id: string,
  type: Device['type'],
  interfaces: NetworkInterface[] = [],
  isOnline = true,
): Device => ({
  id,
  name: id,
  type,
  interfaces,
  isOnline,
  position: { x: 0, y: 0 },
  routingTable: [],
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

describe('buildAdjacency / otherEnd / isLinkUsable', () => {
  it('indexes links for both endpoints', () => {
    const connections = [conn('c1', 'a', 'b')];
    const adjacency = buildAdjacency(connections);
    expect(adjacency.get('a')).toHaveLength(1);
    expect(adjacency.get('b')).toHaveLength(1);
    expect(otherEnd(connections[0], 'a')).toBe('b');
    expect(otherEnd(connections[0], 'b')).toBe('a');
  });

  it('treats disabled and offline links as unusable', () => {
    const devices = new Map([
      ['a', device('a', 'pc')],
      ['b', device('b', 'pc')],
    ]);
    const link = conn('c1', 'a', 'b');
    expect(isLinkUsable(link, devices)).toBe(true);
    expect(isLinkUsable({ ...link, isEnabled: false }, devices)).toBe(false);
    expect(
      isLinkUsable(link, new Map([['a', offline(device('a', 'pc'))], ['b', device('b', 'pc')]])),
    ).toBe(false);
  });
});

describe('computeBroadcastDomains', () => {
  it('places two hosts and a switch in one domain', () => {
    const pcA = device('pc-a', 'pc', [iface('i-a', 'eth0', '192.168.10.10', '255.255.255.0')]);
    const pcB = device('pc-b', 'pc', [iface('i-b', 'eth0', '192.168.10.20', '255.255.255.0')]);
    const sw = device('sw1', 'switch');
    const domains = computeBroadcastDomains(
      [pcA, pcB, sw],
      [conn('c1', 'pc-a', 'sw1', 'i-a'), conn('c2', 'sw1', 'pc-b', undefined, 'i-b')],
    );
    expect(domains).toHaveLength(1);
    expect(domains[0].members.map((m) => m.deviceId).sort()).toEqual(['pc-a', 'pc-b', 'sw1']);
  });

  it('keeps router interfaces in separate domains', () => {
    const pcA = device('pc-a', 'pc', [iface('i-a', 'eth0', '192.168.10.10', '255.255.255.0')]);
    const pcB = device('pc-b', 'pc', [iface('i-b', 'eth0', '10.0.0.10', '255.255.255.0')]);
    const r1 = device('r1', 'router', [
      iface('r1-eth0', 'eth0', '192.168.10.1', '255.255.255.0'),
      iface('r1-eth1', 'eth1', '10.0.0.1', '255.255.255.0'),
    ]);
    const domains = computeBroadcastDomains(
      [pcA, pcB, r1],
      [
        conn('c1', 'pc-a', 'r1', 'i-a', 'r1-eth0'),
        conn('c2', 'r1', 'pc-b', 'r1-eth1', 'i-b'),
      ],
    );
    expect(domains).toHaveLength(2);
    const byDevice = (device: Device) =>
      domains.flatMap((domain) => domain.members.filter((m) => m.deviceId === device.id));
    expect(byDevice(pcA).map((m) => m.ip)).toContain('192.168.10.10');
    expect(byDevice(pcB).map((m) => m.ip)).toContain('10.0.0.10');
  });

  it('excludes disabled cables from domains', () => {
    const pcA = device('pc-a', 'pc', [iface('i-a', 'eth0', '192.168.10.10', '255.255.255.0')]);
    const pcB = device('pc-b', 'pc', [iface('i-b', 'eth0', '192.168.10.20', '255.255.255.0')]);
    const sw = device('sw1', 'switch');
    const domains = computeBroadcastDomains(
      [pcA, pcB, sw],
      [conn('c1', 'pc-a', 'sw1', 'i-a'), conn('c2', 'sw1', 'pc-b', undefined, 'i-b', false)],
    );
    expect(domains).toHaveLength(2);
    expect(domains[0].members.map((m) => m.deviceId).sort()).toEqual(['pc-a', 'sw1']);
    expect(domains[1].members.map((m) => m.deviceId)).toEqual(['pc-b']);
  });

  it('merges a chain of switches into one domain', () => {
    const pcA = device('pc-a', 'pc', [iface('i-a', 'eth0', '10.0.0.10', '255.255.255.0')]);
    const pcB = device('pc-b', 'pc', [iface('i-b', 'eth0', '10.0.0.20', '255.255.255.0')]);
    const sw1 = device('sw1', 'switch');
    const sw2 = device('sw2', 'switch');
    const domains = computeBroadcastDomains(
      [pcA, pcB, sw1, sw2],
      [
        conn('c1', 'pc-a', 'sw1', 'i-a'),
        conn('c2', 'sw1', 'sw2'),
        conn('c3', 'sw2', 'pc-b', undefined, 'i-b'),
      ],
    );
    expect(domains).toHaveLength(1);
    expect(domains[0].members.map((m) => m.deviceId).sort()).toEqual(['pc-a', 'pc-b', 'sw1', 'sw2']);
  });
});

describe('detectIpConflicts', () => {
  const pcA = device('pc-a', 'pc', [iface('i-a', 'eth0', '10.0.0.10', '255.255.255.0')]);
  const pcB = device('pc-b', 'pc', [iface('i-b', 'eth0', '10.0.0.10', '255.255.255.0')]);
  const sw = device('sw1', 'switch');

  const connected = [pcA, pcB, sw];
  const links = [conn('c1', 'pc-a', 'sw1', 'i-a'), conn('c2', 'sw1', 'pc-b', undefined, 'i-b')];

  it('flags a duplicate IP inside the same broadcast domain', () => {
    const conflicts = detectIpConflicts(connected, links);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].ip).toBe('10.0.0.10');
    expect(conflicts[0].a.deviceName).toBe('pc-a');
    expect(conflicts[0].b.deviceName).toBe('pc-b');
  });

  it('does not flag duplicate IPs separated by a router', () => {
    const pcC = device('pc-c', 'pc', [iface('i-c', 'eth0', '10.0.0.10', '255.255.255.0')]);
    const r1 = device('r1', 'router', [
      iface('r1-eth0', 'eth0', '10.0.0.1', '255.255.255.0'),
      iface('r1-eth1', 'eth1', '10.0.0.5', '255.255.255.0'),
    ]);
    const domains = computeBroadcastDomains(
      [pcA, pcC, r1],
      [
        conn('c1', 'pc-a', 'r1', 'i-a', 'r1-eth0'),
        conn('c2', 'r1', 'pc-c', 'r1-eth1', 'i-c'),
      ],
    );
    expect(domains).toHaveLength(2);
    expect(detectIpConflicts([pcA, pcC, r1], [
      conn('c1', 'pc-a', 'r1', 'i-a', 'r1-eth0'),
      conn('c2', 'r1', 'pc-c', 'r1-eth1', 'i-c'),
    ])).toEqual([]);
  });

  it('does not flag conflicts across a cut cable', () => {
    const conflicts = detectIpConflicts(connected, [
      conn('c1', 'pc-a', 'sw1', 'i-a'),
      conn('c2', 'sw1', 'pc-b', undefined, 'i-b', false),
    ]);
    expect(conflicts).toEqual([]);
  });
});

describe('collectDeviceAlerts', () => {
  it('lists interface validation issues and conflict hints', () => {
    const pcA = device('pc-a', 'pc', [iface('i-a', 'eth0', '192.168.10.0', '255.255.255.0')]);
    const pcB = device('pc-b', 'pc', [iface('i-b', 'eth0', '192.168.10.0', '255.255.255.0')]);
    const sw = device('sw1', 'switch');
    const conflicts = detectIpConflicts(
      [pcA, pcB, sw],
      [conn('c1', 'pc-a', 'sw1', 'i-a'), conn('c2', 'sw1', 'pc-b', undefined, 'i-b')],
    );
    const alerts = collectDeviceAlerts([pcA, pcB, sw], conflicts);
    expect(alerts['pc-a']).toBeDefined();
    expect(alerts['pc-a']?.some((m) => m.includes('IP conflict'))).toBe(true);
    expect(alerts['pc-b']?.some((m) => m.includes('IP conflict'))).toBe(true);
  });
});

describe('analyzeNetwork', () => {
  const pcA = device('pc-a', 'pc', [iface('i-a', 'eth0', '10.0.0.10', '255.255.255.0')]);
  const pcB = device('pc-b', 'pc', [iface('i-b', 'eth0', '10.0.0.20', '255.255.255.0')]);
  const sw = device('sw1', 'switch');
  const links = [
    conn('c1', 'pc-a', 'sw1', 'i-a'),
    conn('c2', 'sw1', 'pc-b', undefined, 'i-b'),
  ];

  it('marks usable links active and cut links cut', () => {
    const health = analyzeNetwork(
      [pcA, pcB, sw],
      [...links, { ...links[0], id: 'c-cut', isEnabled: false }],
    );
    expect(health.edgeHealth['c1']).toBe('active');
    expect(health.edgeHealth['c-cut']).toBe('cut');
    expect(health.activeLinks).toBe(2);
    expect(health.totalLinks).toBe(3);
  });

  it('marks links to offline devices offline', () => {
    const health = analyzeNetwork(
      [offline(pcA), pcB, sw],
      links,
    );
    expect(health.edgeHealth['c1']).toBe('offline');
    expect(health.onlineDevices).toBe(2);
    expect(health.activeLinks).toBe(1);
  });

  it('reports healthy only when there are no conflicts and all links are up', () => {
    const healthy = analyzeNetwork([pcA, pcB, sw], links);
    expect(healthy.healthy).toBe(true);

    const conflict = device('pc-c', 'pc', [iface('i-c', 'eth0', '10.0.0.10', '255.255.255.0')]);
    const unhealthy = analyzeNetwork(
      [pcA, conflict, sw],
      [conn('c1', 'pc-a', 'sw1', 'i-a'), conn('c2', 'sw1', 'pc-c', undefined, 'i-c')],
    );
    expect(unhealthy.healthy).toBe(false);
    expect(unhealthy.conflicts).toHaveLength(1);
  });
});
