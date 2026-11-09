/**
 * Unit tests for src/engine/ip.ts — pure IPv4 / CIDR utilities.
 */

import { describe, expect, it } from 'vitest';
import {
  describeNetwork,
  getBroadcastAddress,
  getInterfaceCidr,
  getNetworkAddress,
  intToIp,
  ipToInt,
  isSameSubnet,
  isValidIPv4,
  isValidMac,
  isValidSubnetMask,
  isUsableHostAddress,
  maskToPrefixLength,
  parseCidr,
  prefixLengthToMask,
  randomMac,
  seededMac,
  validateInterface,
} from '../ip';
import type { NetworkInterface } from '../../types/network';

describe('isValidIPv4', () => {
  it('accepts valid dotted-quad addresses', () => {
    expect(isValidIPv4('192.168.1.1')).toBe(true);
    expect(isValidIPv4('0.0.0.0')).toBe(true);
    expect(isValidIPv4('255.255.255.255')).toBe(true);
    expect(isValidIPv4(' 10.0.0.1 ')).toBe(true);
  });
  it('rejects invalid addresses', () => {
    expect(isValidIPv4('')).toBe(false);
    expect(isValidIPv4('256.1.1.1')).toBe(false);
    expect(isValidIPv4('192.168.1')).toBe(false);
    expect(isValidIPv4('192.168.1.1.1')).toBe(false);
    expect(isValidIPv4('01.02.03.04')).toBe(false);
    expect(isValidIPv4('not-an-ip')).toBe(false);
  });
});

describe('ipToInt / intToIp', () => {
  it('round-trips an address', () => {
    expect(intToIp(ipToInt('192.168.10.10'))).toBe('192.168.10.10');
    expect(ipToInt(intToIp(0x0a00000a))).toBe(0x0a00000a);
  });
  it('returns 0 for invalid input', () => {
    expect(ipToInt('not-an-ip')).toBe(0);
  });
});

describe('isValidSubnetMask', () => {
  it('accepts contiguous masks', () => {
    expect(isValidSubnetMask('255.255.255.0')).toBe(true);
    expect(isValidSubnetMask('255.255.255.252')).toBe(true);
    expect(isValidSubnetMask('0.0.0.0')).toBe(true);
    expect(isValidSubnetMask('255.255.255.255')).toBe(true);
  });
  it('rejects non-contiguous and invalid masks', () => {
    expect(isValidSubnetMask('255.255.0.255')).toBe(false);
    expect(isValidSubnetMask('255.255.256.0')).toBe(false);
    expect(isValidSubnetMask('not-a-mask')).toBe(false);
  });
});

describe('maskToPrefixLength / prefixLengthToMask', () => {
  it('converts mask <-> prefix', () => {
    expect(maskToPrefixLength('255.255.255.0')).toBe(24);
    expect(maskToPrefixLength('255.255.255.252')).toBe(30);
    expect(maskToPrefixLength('0.0.0.0')).toBe(0);
    expect(maskToPrefixLength('255.255.255.255')).toBe(32);
    expect(maskToPrefixLength('255.255.0.255')).toBe(-1);

    expect(prefixLengthToMask(24)).toBe('255.255.255.0');
    expect(prefixLengthToMask(30)).toBe('255.255.255.252');
    expect(prefixLengthToMask(0)).toBe('0.0.0.0');
    expect(prefixLengthToMask(32)).toBe('255.255.255.255');
    expect(prefixLengthToMask(-1)).toBe('0.0.0.0');
    expect(prefixLengthToMask(33)).toBe('0.0.0.0');
    expect(prefixLengthToMask(1.5)).toBe('0.0.0.0');
  });
});

describe('parseCidr', () => {
  it('parses valid CIDR and returns the network address', () => {
    expect(parseCidr('192.168.10.0/24')).toEqual({ network: '192.168.10.0', prefix: 24 });
    expect(parseCidr('10.0.0.0/30')).toEqual({ network: '10.0.0.0', prefix: 30 });
    expect(parseCidr('192.168.10.10/24')).toEqual({ network: '192.168.10.0', prefix: 24 });
  });
  it('rejects invalid input', () => {
    expect(parseCidr('not-a-cidr')).toBeNull();
    expect(parseCidr('192.168.10.0')).toBeNull();
    expect(parseCidr('192.168.10.0/33')).toBeNull();
    expect(parseCidr('256.0.0.0/24')).toBeNull();
  });
});

describe('getNetworkAddress / getBroadcastAddress', () => {
  it('computes network and broadcast for a /24', () => {
    expect(getNetworkAddress('192.168.10.10', '255.255.255.0')).toBe('192.168.10.0');
    expect(getBroadcastAddress('192.168.10.10', '255.255.255.0')).toBe('192.168.10.255');
  });
  it('computes network and broadcast for a /30', () => {
    expect(getNetworkAddress('10.0.0.1', '255.255.255.252')).toBe('10.0.0.0');
    expect(getBroadcastAddress('10.0.0.1', '255.255.255.252')).toBe('10.0.0.3');
  });
  it('returns empty string for invalid input', () => {
    expect(getNetworkAddress('bad', '255.255.255.0')).toBe('');
    expect(getBroadcastAddress('192.168.10.10', 'bad')).toBe('');
  });
});

describe('getInterfaceCidr', () => {
  it('returns "<network>/<prefix>" for a configured interface', () => {
    expect(
      getInterfaceCidr({ ipAddress: '192.168.10.10', subnetMask: '255.255.255.0' }),
    ).toBe('192.168.10.0/24');
  });
  it('returns empty string when unconfigured', () => {
    expect(getInterfaceCidr({ ipAddress: '', subnetMask: '' })).toBe('');
    expect(getInterfaceCidr({ ipAddress: '1.2.3.4', subnetMask: '255.255.0.255' })).toBe('');
  });
});

describe('isSameSubnet', () => {
  it('returns true for addresses in the same subnet', () => {
    expect(isSameSubnet('192.168.10.10', '192.168.10.20', '255.255.255.0')).toBe(true);
  });
  it('returns false for addresses in different subnets', () => {
    expect(isSameSubnet('192.168.10.10', '10.0.0.1', '255.255.255.0')).toBe(false);
  });
  it('returns false for invalid input', () => {
    expect(isSameSubnet('bad', '192.168.10.20', '255.255.255.0')).toBe(false);
    expect(isSameSubnet('192.168.10.10', '192.168.10.20', '255.255.0.255')).toBe(false);
  });
});

describe('isUsableHostAddress', () => {
  it('rejects network and broadcast addresses', () => {
    expect(isUsableHostAddress('192.168.10.0', '255.255.255.0')).toBe(false);
    expect(isUsableHostAddress('192.168.10.255', '255.255.255.0')).toBe(false);
  });
  it('accepts a usable host address', () => {
    expect(isUsableHostAddress('192.168.10.10', '255.255.255.0')).toBe(true);
  });
  it('accepts any address on /31 and /32', () => {
    expect(isUsableHostAddress('10.0.0.0', '255.255.255.254')).toBe(true);
    expect(isUsableHostAddress('10.0.0.1', '255.255.255.254')).toBe(true);
    expect(isUsableHostAddress('10.0.0.1', '255.255.255.255')).toBe(true);
  });
});

describe('isValidMac', () => {
  it('accepts valid MAC addresses', () => {
    expect(isValidMac('02:42:ac:11:00:0a')).toBe(true);
    expect(isValidMac('AA:BB:CC:DD:EE:FF')).toBe(true);
  });
  it('rejects invalid MAC addresses', () => {
    expect(isValidMac('')).toBe(false);
    expect(isValidMac('02:42:ac:11:00:gg')).toBe(false);
    expect(isValidMac('02-42-ac-11-00-0a')).toBe(false);
  });
});

describe('randomMac / seededMac', () => {
  it('randomMac returns a locally administered unicast MAC', () => {
    const mac = randomMac();
    expect(isValidMac(mac)).toBe(true);
    const firstOctet = parseInt(mac.split(':')[0], 16);
    expect(firstOctet & 0x01).toBe(0); // unicast
    expect(firstOctet & 0x02).toBe(0x02); // locally administered
  });
  it('seededMac is deterministic', () => {
    expect(seededMac(1)).toBe(seededMac(1));
    expect(seededMac(1)).not.toBe(seededMac(2));
  });
});

const baseIface = (overrides: Partial<NetworkInterface> = {}): NetworkInterface => ({
  id: 'eth0',
  name: 'eth0',
  ipAddress: '192.168.10.10',
  subnetMask: '255.255.255.0',
  gateway: '192.168.10.1',
  macAddress: '02:42:ac:11:00:0a',
  ...overrides,
});

describe('validateInterface', () => {
  it('accepts a fully valid interface', () => {
    expect(validateInterface(baseIface())).toEqual([]);
  });
  it('reports an invalid IPv4 address', () => {
    expect(validateInterface(baseIface({ ipAddress: '999.1.1.1' }))).toEqual([
      expect.objectContaining({ field: 'ipAddress', level: 'error' }),
    ]);
  });
  it('reports a non-contiguous subnet mask', () => {
    expect(validateInterface(baseIface({ subnetMask: '255.255.0.255' }))).toEqual([
      expect.objectContaining({ field: 'subnetMask', level: 'error' }),
    ]);
  });
  it('rejects network and broadcast addresses', () => {
    expect(validateInterface(baseIface({ ipAddress: '192.168.10.0' }))).toEqual([
      expect.objectContaining({ field: 'ipAddress', level: 'error' }),
    ]);
    expect(validateInterface(baseIface({ ipAddress: '192.168.10.255' }))).toEqual([
      expect.objectContaining({ field: 'ipAddress', level: 'error' }),
    ]);
  });
  it('rejects a gateway outside the interface subnet', () => {
    expect(
      validateInterface(baseIface({ gateway: '10.0.0.1' })),
    ).toEqual([expect.objectContaining({ field: 'gateway', level: 'error' })]);
  });
  it('warns when the gateway points at the interface itself', () => {
    expect(validateInterface(baseIface({ gateway: '192.168.10.10' }))).toEqual([
      expect.objectContaining({ field: 'gateway', level: 'warning' }),
    ]);
  });
  it('rejects an invalid MAC address', () => {
    expect(validateInterface(baseIface({ macAddress: 'not-a-mac' }))).toEqual([
      expect.objectContaining({ field: 'macAddress', level: 'error' }),
    ]);
  });
  it('allows empty optional fields', () => {
    expect(
      validateInterface(baseIface({ ipAddress: '', subnetMask: '', gateway: '', macAddress: '' })),
    ).toEqual([]);
  });
});

describe('describeNetwork', () => {
  it('returns "<network>/<prefix>"', () => {
    expect(describeNetwork('192.168.10.10', '255.255.255.0')).toBe('192.168.10.0/24');
  });
  it('returns an em dash when unconfigured', () => {
    expect(describeNetwork('', '')).toBe('—');
  });
});
