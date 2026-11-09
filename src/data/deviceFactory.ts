/**
 * Device factory: sensible defaults for newly dropped devices, including
 * automatic address assignment so a fresh topology is immediately usable.
 */

import type { Device, DeviceType, NetworkInterface } from '../types/network';
import {
  getInterfaceCidr,
  getNetworkAddress,
  intToIp,
  ipToInt,
  isValidIPv4,
  isValidSubnetMask,
  isSameSubnet,
  randomMac,
} from '../engine/ip';
import { primaryInterface } from '../engine/topology';
import { createId } from '../utils/format';

export interface DeviceMeta {
  label: string;
  plural: string;
  prefix: string;
  tagline: string;
  description: string;
}

export const DEVICE_META: Record<DeviceType, DeviceMeta> = {
  router: {
    label: 'Router',
    plural: 'Routers',
    prefix: 'RTR',
    tagline: 'Inter-subnet forwarding',
    description: 'Routes packets between subnets using its routing table.',
  },
  switch: {
    label: 'Switch',
    plural: 'Switches',
    prefix: 'SW',
    tagline: 'Layer-2 broadcast domain',
    description: 'Forwards frames between every device attached to its ports.',
  },
  server: {
    label: 'Server',
    plural: 'Servers',
    prefix: 'SRV',
    tagline: 'Service endpoint',
    description: 'Hosts application services on a static IPv4 address.',
  },
  pc: {
    label: 'PC',
    plural: 'PCs',
    prefix: 'PC',
    tagline: 'Client workstation',
    description: 'End-user workstation used as a ping source or destination.',
  },
};

export const DEVICE_TYPES: DeviceType[] = ['router', 'switch', 'server', 'pc'];

function nextDeviceName(devices: Device[], meta: DeviceMeta): string {
  const used = new Set(devices.map((device) => device.name));
  let index = devices.filter((device) => device.name.startsWith(meta.prefix)).length + 1;
  let name = `${meta.prefix}-${String(index).padStart(2, '0')}`;
  while (used.has(name)) {
    index += 1;
    name = `${meta.prefix}-${String(index).padStart(2, '0')}`;
  }
  return name;
}

function uniqueMac(devices: Device[]): string {
  const used = new Set(
    devices.flatMap((device) => device.interfaces.map((iface) => iface.macAddress.toLowerCase())),
  );
  let mac = randomMac();
  let attempts = 0;
  while (used.has(mac.toLowerCase()) && attempts < 20) {
    mac = randomMac();
    attempts += 1;
  }
  return mac;
}

export function makeInterface(
  name: string,
  ipAddress = '',
  subnetMask = '255.255.255.0',
  gateway = '',
  macAddress = '',
): NetworkInterface {
  return {
    id: createId('if'),
    name,
    ipAddress,
    subnetMask,
    gateway,
    macAddress: macAddress || randomMac(),
  };
}

function usedAddresses(devices: Device[]): Set<string> {
  const used = new Set<string>();
  for (const device of devices) {
    for (const iface of device.interfaces) {
      if (isValidIPv4(iface.ipAddress)) used.add(iface.ipAddress);
    }
  }
  return used;
}

function nextFreeHostIp(
  used: Set<string>,
  network: string,
  mask: string,
  reservedGateway: string,
): string {
  const base = ipToInt(network);
  for (let host = 10; host < 250; host += 1) {
    const candidate = intToIp((base + host) >>> 0);
    if (used.has(candidate) || candidate === reservedGateway) continue;
    if (!isValidSubnetMask(mask)) continue;
    if (isSameSubnet(candidate, network, mask)) return candidate;
  }
  return network;
}

interface SubnetCandidate {
  network: string;
  mask: string;
  gateway: string;
  hostCount: number;
}

function routerSubnetCandidates(devices: Device[]): SubnetCandidate[] {
  const candidates: SubnetCandidate[] = [];
  for (const device of devices) {
    if (device.type !== 'router') continue;
    for (const iface of device.interfaces) {
      if (!isValidIPv4(iface.ipAddress) || !isValidSubnetMask(iface.subnetMask)) continue;
      const network = getNetworkAddress(iface.ipAddress, iface.subnetMask);
      if (!network) continue;
      const hostCount = devices.filter((other) => {
        const otherIface = primaryInterface(other);
        return Boolean(
          otherIface &&
            isValidIPv4(otherIface.ipAddress) &&
            isSameSubnet(otherIface.ipAddress, network, iface.subnetMask),
        );
      }).length;
      candidates.push({ network, mask: iface.subnetMask, gateway: iface.ipAddress, hostCount });
    }
  }
  return candidates;
}

function assignHostAddress(devices: Device[]): { ip: string; mask: string; gateway: string } {
  const used = usedAddresses(devices);
  const candidates = routerSubnetCandidates(devices).sort((a, b) => a.hostCount - b.hostCount);
  if (candidates.length > 0) {
    const subnet = candidates[0];
    return {
      ip: nextFreeHostIp(used, subnet.network, subnet.mask, subnet.gateway),
      mask: subnet.mask,
      gateway: subnet.gateway,
    };
  }
  const mask = '255.255.255.0';
  return {
    ip: nextFreeHostIp(used, '192.168.1.0', mask, ''),
    mask,
    gateway: '',
  };
}

function nextRouterNetworks(devices: Device[]): [string, string] {
  const configuredRanges = new Set<number>();
  for (const device of devices) {
    for (const iface of device.interfaces) {
      const cidr = getInterfaceCidr(iface);
      if (!cidr) continue;
      const octets = cidr.split('/')[0].split('.');
      if (octets[0] === '192' && octets[1] === '168') configuredRanges.add(Number(octets[2]));
    }
  }
  let thirdOctet = 10;
  while (configuredRanges.has(thirdOctet) || configuredRanges.has(thirdOctet + 10)) {
    thirdOctet += 10;
    if (thirdOctet > 230) break;
  }
  return [`192.168.${thirdOctet}.0`, `192.168.${thirdOctet + 10}.0`];
}

export function createDevice(
  type: DeviceType,
  position: { x: number; y: number },
  devices: Device[],
): Device {
  const meta = DEVICE_META[type];
  const id = createId('dev');
  const name = nextDeviceName(devices, meta);
  const mac = uniqueMac(devices);

  const base = {
    id,
    name,
    type,
    isOnline: true,
    position,
    routingTable: [],
    interfaces: [] as NetworkInterface[],
  } satisfies Omit<Device, 'interfaces'> & { interfaces: NetworkInterface[] };

  if (type === 'router') {
    const [netA, netB] = nextRouterNetworks(devices);
    const mask = '255.255.255.0';
    const ifaceA: NetworkInterface = {
      id: createId('if'),
      name: 'eth0',
      ipAddress: `${netA.split('.').slice(0, 3).join('.')}.1`,
      subnetMask: mask,
      gateway: '',
      macAddress: mac,
    };
    const ifaceB: NetworkInterface = {
      id: createId('if'),
      name: 'eth1',
      ipAddress: `${netB.split('.').slice(0, 3).join('.')}.1`,
      subnetMask: mask,
      gateway: '',
      macAddress: uniqueMac([...devices, { ...base, interfaces: [ifaceA] }]),
    };
    return { ...base, interfaces: [ifaceA, ifaceB] };
  }

  if (type === 'switch') {
    return {
      ...base,
      interfaces: [
        {
          id: createId('if'),
          name: 'port-1',
          ipAddress: '',
          subnetMask: '255.255.255.0',
          gateway: '',
          macAddress: mac,
        },
      ],
    };
  }

  const address = assignHostAddress(devices);
  return {
    ...base,
    interfaces: [
      {
        id: createId('if'),
        name: 'eth0',
        ipAddress: address.ip,
        subnetMask: address.mask,
        gateway: address.gateway,
        macAddress: mac,
      },
    ],
  };
}

/** Creates a new router interface with a free /24 network. */
export function createRouterInterface(device: Device, devices: Device[]): NetworkInterface {
  const [net] = nextRouterNetworks(devices);
  const third = net.split('.').slice(0, 3).join('.');
  return {
    id: createId('if'),
    name: `eth${device.interfaces.length}`,
    ipAddress: `${third}.1`,
    subnetMask: '255.255.255.0',
    gateway: '',
    macAddress: uniqueMac(devices),
  };
}

export function cloneTopology<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
