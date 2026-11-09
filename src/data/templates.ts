/**
 * Recruiter-ready topologies. Every template is built from scratch on load and
 * comes with fully configured addressing, gateways and (when required) routes.
 */

import type {
  Connection,
  Device,
  DeviceType,
  NetworkInterface,
  NetworkTemplate,
  RoutingEntry,
} from '../types/network';
import { seededMac } from '../engine/ip';

interface HostSpec {
  id: string;
  name: string;
  type: Extract<DeviceType, 'pc' | 'server'>;
  x: number;
  y: number;
  ip: string;
  mask?: string;
  gateway: string;
  seed: number;
}

function iface(
  id: string,
  name: string,
  ip: string,
  mask: string,
  gateway: string,
  seed: number,
): NetworkInterface {
  return {
    id,
    name,
    ipAddress: ip,
    subnetMask: mask,
    gateway,
    macAddress: seededMac(seed),
  };
}

function host(spec: HostSpec): Device {
  return {
    id: spec.id,
    name: spec.name,
    type: spec.type,
    isOnline: true,
    position: { x: spec.x, y: spec.y },
    routingTable: [],
    interfaces: [
      iface(
        `${spec.id}-eth0`,
        'eth0',
        spec.ip,
        spec.mask ?? '255.255.255.0',
        spec.gateway,
        spec.seed,
      ),
    ],
  };
}

function switchDevice(id: string, name: string, x: number, y: number, seed: number): Device {
  return {
    id,
    name,
    type: 'switch',
    isOnline: true,
    position: { x, y },
    routingTable: [],
    interfaces: [
      {
        id: `${id}-port`,
        name: 'port-1',
        ipAddress: '',
        subnetMask: '255.255.255.0',
        gateway: '',
        macAddress: seededMac(seed),
      },
    ],
  };
}

function routerDevice(
  id: string,
  name: string,
  x: number,
  y: number,
  interfaces: NetworkInterface[],
  routingTable: RoutingEntry[] = [],
): Device {
  return {
    id,
    name,
    type: 'router',
    isOnline: true,
    position: { x, y },
    routingTable,
    interfaces,
  };
}

function link(
  id: string,
  source: Device,
  target: Device,
  sourceInterfaceId?: string,
  targetInterfaceId?: string,
  isEnabled = true,
): Connection {
  return {
    id,
    source: source.id,
    target: target.id,
    sourceHandle: null,
    targetHandle: null,
    sourceInterfaceId,
    targetInterfaceId,
    isEnabled,
    cableType: 'copper',
    label: `${source.name} ↔ ${target.name}`,
  };
}

function buildCorporateOffice(): { devices: Device[]; connections: Connection[] } {
  const router = routerDevice(
    'corp-router',
    'RTR-CORE',
    430,
    20,
    [
      iface('corp-router-eth0', 'eth0', '192.168.10.1', '255.255.255.0', '', 101),
      iface('corp-router-eth1', 'eth1', '192.168.20.1', '255.255.255.0', '', 102),
    ],
  );
  const switchA = switchDevice('corp-swa', 'SW-FINANCE', 60, 240, 111);
  const switchB = switchDevice('corp-swb', 'SW-ENGINEERING', 880, 240, 112);

  const devices: Device[] = [router, switchA, switchB];
  const connections: Connection[] = [
    link('corp-l-r-a', router, switchA, 'corp-router-eth0', 'corp-swa-port'),
    link('corp-l-r-b', router, switchB, 'corp-router-eth1', 'corp-swb-port'),
  ];

  const leftColumns = [-170, 65, 300];
  const rightColumns = [660, 895, 1130];
  const rows = [445, 630, 815, 1000];

  const buildHost = (
    subnet: 'a' | 'b',
    index: number,
    seed: number,
    hostType: 'pc' | 'server',
  ): Device => {
    const columns = subnet === 'a' ? leftColumns : rightColumns;
    const column = columns[index % columns.length];
    const row = rows[Math.floor(index / columns.length)];
    const thirdOctet = subnet === 'a' ? 10 : 20;
    const ip = `192.168.${thirdOctet}.${11 + index}`;
    const id = `corp-${subnet}-${hostType}-${index + 1}`;
    const ordinal = hostType === 'server' ? index - 7 : index + 1;
    const name =
      hostType === 'server'
        ? `SRV-${subnet.toUpperCase()}-${String(ordinal).padStart(2, '0')}`
        : `PC-${subnet.toUpperCase()}-${String(ordinal).padStart(2, '0')}`;
    return host({
      id,
      name,
      type: hostType,
      x: column,
      y: row,
      ip,
      gateway: `192.168.${thirdOctet}.1`,
      seed,
    });
  };

  for (let index = 0; index < 8; index += 1) {
    devices.push(buildHost('a', index, 200 + index, 'pc'));
  }
  devices.push(buildHost('a', 8, 208, 'server'));
  devices.push(buildHost('a', 9, 209, 'server'));

  for (let index = 0; index < 8; index += 1) {
    devices.push(buildHost('b', index, 300 + index, 'pc'));
  }
  devices.push(buildHost('b', 8, 308, 'server'));
  devices.push(buildHost('b', 9, 309, 'server'));

  for (const device of devices) {
    if (device.type !== 'pc' && device.type !== 'server') continue;
    const switchDeviceRef = device.interfaces[0].ipAddress.startsWith('192.168.10.') ? switchA : switchB;
    connections.push(
      link(`corp-l-${device.id}`, switchDeviceRef, device, switchDeviceRef.interfaces[0].id, device.interfaces[0].id),
    );
  }

  return { devices, connections };
}

function buildBrokenNetwork(): { devices: Device[]; connections: Connection[] } {
  const router = routerDevice(
    'broken-router',
    'RTR-EDGE',
    380,
    10,
    [
      iface('broken-router-eth0', 'eth0', '10.10.0.1', '255.255.255.0', '', 401),
      iface('broken-router-eth1', 'eth1', '10.10.1.1', '255.255.255.0', '', 402),
    ],
  );
  const core = switchDevice('broken-sw-core', 'SW-CORE', 250, 240, 411);
  const isolated = switchDevice('broken-sw-iso', 'SW-ISOLATED', 760, 240, 412);

  const alpha = host({
    id: 'broken-alpha',
    name: 'PC-ALPHA',
    type: 'pc',
    x: -20,
    y: 450,
    ip: '10.10.0.10',
    gateway: '10.10.0.1',
    seed: 421,
  });
  const bravo = host({
    id: 'broken-bravo',
    name: 'PC-BRAVO',
    type: 'pc',
    x: -20,
    y: 670,
    ip: '10.10.0.10',
    gateway: '10.10.0.1',
    seed: 422,
  });
  const charlie = host({
    id: 'broken-charlie',
    name: 'PC-CHARLIE',
    type: 'pc',
    x: 260,
    y: 450,
    ip: '10.10.0.12',
    gateway: '10.10.0.1',
    seed: 423,
  });
  const delta = host({
    id: 'broken-delta',
    name: 'PC-DELTA',
    type: 'pc',
    x: 260,
    y: 670,
    ip: '10.10.0.13',
    gateway: '10.10.0.1',
    seed: 424,
  });
  delta.isOnline = false;

  const file = host({
    id: 'broken-file',
    name: 'SRV-FILE',
    type: 'server',
    x: 740,
    y: 450,
    ip: '10.10.0.20',
    gateway: '10.10.0.1',
    seed: 425,
  });
  const echo = host({
    id: 'broken-echo',
    name: 'PC-ECHO',
    type: 'pc',
    x: 740,
    y: 670,
    ip: '10.10.0.14',
    gateway: '10.10.0.1',
    seed: 426,
  });
  const backup = host({
    id: 'broken-backup',
    name: 'SRV-BACKUP',
    type: 'server',
    x: 700,
    y: 10,
    ip: '10.10.1.10',
    gateway: '10.10.1.1',
    seed: 427,
  });

  const devices = [router, core, isolated, alpha, bravo, charlie, delta, file, echo, backup];
  const connections: Connection[] = [
    link('broken-l-r-c', router, core, 'broken-router-eth0', 'broken-sw-core-port'),
    link('broken-l-r-b', router, backup, 'broken-router-eth1', 'broken-backup-eth0'),
    link('broken-l-a', core, alpha, 'broken-sw-core-port', 'broken-alpha-eth0'),
    link('broken-l-b', core, bravo, 'broken-sw-core-port', 'broken-bravo-eth0'),
    link('broken-l-c', core, charlie, 'broken-sw-core-port', 'broken-charlie-eth0'),
    link('broken-l-d', core, delta, 'broken-sw-core-port', 'broken-delta-eth0'),
    link('broken-l-uplink', core, isolated, 'broken-sw-core-port', 'broken-sw-iso-port', false),
    link('broken-l-file', isolated, file, 'broken-sw-iso-port', 'broken-file-eth0'),
    link('broken-l-echo', isolated, echo, 'broken-sw-iso-port', 'broken-echo-eth0'),
  ];

  return { devices, connections };
}

function buildTwoSiteWan(): { devices: Device[]; connections: Connection[] } {
  const routerA = routerDevice(
    'wan-router-a',
    'RTR-HQ',
    260,
    10,
    [
      iface('wan-router-a-eth0', 'eth0', '172.16.10.1', '255.255.255.0', '', 501),
      iface('wan-router-a-eth1', 'eth1', '10.0.0.1', '255.255.255.252', '', 502),
    ],
    [
      {
        id: 'wan-route-a',
        destinationCidr: '172.16.20.0/24',
        nextHop: '10.0.0.2',
        interfaceName: 'eth1',
        metric: 10,
        type: 'static',
      },
    ],
  );
  const routerB = routerDevice(
    'wan-router-b',
    'RTR-BRANCH',
    820,
    10,
    [
      iface('wan-router-b-eth0', 'eth0', '172.16.20.1', '255.255.255.0', '', 511),
      iface('wan-router-b-eth1', 'eth1', '10.0.0.2', '255.255.255.252', '', 512),
    ],
    [
      {
        id: 'wan-route-b',
        destinationCidr: '172.16.10.0/24',
        nextHop: '10.0.0.1',
        interfaceName: 'eth1',
        metric: 10,
        type: 'static',
      },
    ],
  );
  const switchHq = switchDevice('wan-sw-hq', 'SW-HQ', 230, 230, 521);
  const switchBranch = switchDevice('wan-sw-branch', 'SW-BRANCH', 790, 230, 522);

  const hqHosts = [
    host({
      id: 'wan-hq-pc1',
      name: 'PC-HQ-01',
      type: 'pc',
      x: -20,
      y: 440,
      ip: '172.16.10.10',
      gateway: '172.16.10.1',
      seed: 531,
    }),
    host({
      id: 'wan-hq-pc2',
      name: 'PC-HQ-02',
      type: 'pc',
      x: 240,
      y: 440,
      ip: '172.16.10.11',
      gateway: '172.16.10.1',
      seed: 532,
    }),
    host({
      id: 'wan-hq-srv',
      name: 'SRV-HQ',
      type: 'server',
      x: 500,
      y: 440,
      ip: '172.16.10.20',
      gateway: '172.16.10.1',
      seed: 533,
    }),
  ];
  const branchHosts = [
    host({
      id: 'wan-br-pc1',
      name: 'PC-BR-01',
      type: 'pc',
      x: 660,
      y: 440,
      ip: '172.16.20.10',
      gateway: '172.16.20.1',
      seed: 541,
    }),
    host({
      id: 'wan-br-pc2',
      name: 'PC-BR-02',
      type: 'pc',
      x: 920,
      y: 440,
      ip: '172.16.20.11',
      gateway: '172.16.20.1',
      seed: 542,
    }),
    host({
      id: 'wan-br-srv',
      name: 'SRV-BRANCH',
      type: 'server',
      x: 1180,
      y: 440,
      ip: '172.16.20.20',
      gateway: '172.16.20.1',
      seed: 543,
    }),
  ];

  const devices = [routerA, routerB, switchHq, switchBranch, ...hqHosts, ...branchHosts];
  const connections: Connection[] = [
    link('wan-l-a-sw', routerA, switchHq, 'wan-router-a-eth0', 'wan-sw-hq-port'),
    link('wan-l-b-sw', routerB, switchBranch, 'wan-router-b-eth0', 'wan-sw-branch-port'),
    link('wan-l-a-b', routerA, routerB, 'wan-router-a-eth1', 'wan-router-b-eth1'),
  ];
  for (const device of hqHosts) {
    connections.push(link(`wan-l-${device.id}`, switchHq, device, 'wan-sw-hq-port', device.interfaces[0].id));
  }
  for (const device of branchHosts) {
    connections.push(link(`wan-l-${device.id}`, switchBranch, device, 'wan-sw-branch-port', device.interfaces[0].id));
  }

  return { devices, connections };
}

export const NETWORK_TEMPLATES: NetworkTemplate[] = [
  {
    id: 'corporate-office',
    name: 'Corporate Office',
    description:
      '1 core router, 2 access switches and 20 hosts across two /24 subnets. A healthy baseline for testing ping and traceroute.',
    difficulty: 'starter',
    deviceCount: 23,
    suggestedSource: 'PC-A-01',
    suggestedTarget: 'SRV-B-02',
    build: buildCorporateOffice,
  },
  {
    id: 'broken-network',
    name: 'Broken Network Demo',
    description:
      'A troubleshooting lab: duplicate IP (PC-ALPHA / PC-BRAVO), a cut uplink to SW-ISOLATED, an offline PC and a routed backup server.',
    difficulty: 'intermediate',
    deviceCount: 10,
    suggestedSource: 'PC-CHARLIE',
    suggestedTarget: 'PC-ALPHA',
    build: buildBrokenNetwork,
  },
  {
    id: 'two-site-wan',
    name: 'Two-Site WAN',
    description:
      'Two sites joined by a point-to-point /30 link with static routes between 172.16.10.0/24 and 172.16.20.0/24.',
    difficulty: 'advanced',
    deviceCount: 10,
    suggestedSource: 'PC-HQ-01',
    suggestedTarget: 'SRV-BRANCH',
    build: buildTwoSiteWan,
  },
];

export function getTemplate(id: string): NetworkTemplate | undefined {
  return NETWORK_TEMPLATES.find((template) => template.id === id);
}
