/**
 * IPv4 / CIDR utilities shared by the routing engine and the UI.
 * All helpers are pure and never throw on malformed input.
 */

import type { NetworkInterface } from '../types/network';

const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

const MAC_PATTERN = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

/** True when the string is a syntactically valid dotted-quad IPv4 address. */
export function isValidIPv4(value: string): boolean {
  return IPV4_PATTERN.test(value.trim());
}

/** Converts an IPv4 address to an unsigned 32-bit integer. Returns 0 when invalid. */
export function ipToInt(ip: string): number {
  if (!isValidIPv4(ip)) return 0;
  return ip
    .trim()
    .split('.')
    .reduce((acc, octet) => (acc * 256 + Number(octet)) >>> 0, 0);
}

/** Converts an unsigned 32-bit integer back to dotted-quad notation. */
export function intToIp(value: number): string {
  const n = value >>> 0;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** True when the dotted mask is contiguous (e.g. 255.255.255.0). */
export function isValidSubnetMask(mask: string): boolean {
  if (!isValidIPv4(mask)) return false;
  const value = ipToInt(mask);
  // A valid mask is a run of 1s followed by a run of 0s.
  const inverted = (~value >>> 0) >>> 0;
  return ((inverted + 1) & inverted) === 0;
}

/** Converts a valid dotted mask to prefix length (0-32). Returns -1 when invalid. */
export function maskToPrefixLength(mask: string): number {
  if (!isValidSubnetMask(mask)) return -1;
  return ipToInt(mask)
    .toString(2)
    .split('')
    .filter((bit) => bit === '1').length;
}

/** Converts a prefix length to a dotted subnet mask. */
export function prefixLengthToMask(prefix: number): string {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return '0.0.0.0';
  const value = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return intToIp(value);
}

/** Parses "192.168.1.0/24" into its network address and prefix length. */
export function parseCidr(cidr: string): { network: string; prefix: number } | null {
  const [rawIp, rawPrefix] = cidr.trim().split('/');
  if (!rawIp || rawPrefix === undefined) return null;
  if (!isValidIPv4(rawIp)) return null;
  const prefix = Number(rawPrefix);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefixLengthToMask(prefix);
  return { network: intToIp(ipToInt(rawIp) & ipToInt(mask)), prefix };
}

/** Returns the network address for an IP + dotted mask. */
export function getNetworkAddress(ip: string, mask: string): string {
  if (!isValidIPv4(ip) || !isValidSubnetMask(mask)) return '';
  return intToIp((ipToInt(ip) & ipToInt(mask)) >>> 0);
}

/** Returns the broadcast address for an IP + dotted mask. */
export function getBroadcastAddress(ip: string, mask: string): string {
  if (!isValidIPv4(ip) || !isValidSubnetMask(mask)) return '';
  const network = (ipToInt(ip) & ipToInt(mask)) >>> 0;
  const hostMask = (~ipToInt(mask) >>> 0) >>> 0;
  return intToIp((network | hostMask) >>> 0);
}

/** Returns "<network>/<prefix>" for an interface, or an empty string. */
export function getInterfaceCidr(iface: Pick<NetworkInterface, 'ipAddress' | 'subnetMask'>): string {
  const prefix = maskToPrefixLength(iface.subnetMask);
  const network = getNetworkAddress(iface.ipAddress, iface.subnetMask);
  if (prefix < 0 || !network) return '';
  return `${network}/${prefix}`;
}

/** True when both addresses belong to the same subnet for the given mask. */
export function isSameSubnet(ipA: string, ipB: string, mask: string): boolean {
  if (!isValidIPv4(ipA) || !isValidIPv4(ipB) || !isValidSubnetMask(mask)) return false;
  const m = ipToInt(mask);
  return ((ipToInt(ipA) & m) >>> 0) === ((ipToInt(ipB) & m) >>> 0);
}

/** True when the address is neither the network id nor the broadcast address. */
export function isUsableHostAddress(ip: string, mask: string): boolean {
  if (!isValidIPv4(ip) || !isValidSubnetMask(mask)) return false;
  const prefix = maskToPrefixLength(mask);
  if (prefix >= 31) return true; // /31 and /32 are point-to-point / loopback style
  const network = getNetworkAddress(ip, mask);
  const broadcast = getBroadcastAddress(ip, mask);
  return ip !== network && ip !== broadcast;
}

/** True for a valid colon-separated MAC address. */
export function isValidMac(mac: string): boolean {
  return MAC_PATTERN.test(mac.trim());
}

/** Generates a locally administered unicast MAC address. */
export function randomMac(): string {
  const octets = Array.from({ length: 6 }, () => Math.floor(Math.random() * 256));
  octets[0] = (octets[0] & 0xfc) | 0x02;
  return octets.map((value) => value.toString(16).padStart(2, '0')).join(':');
}

/** Deterministic MAC from a seed, useful for templates and stable auto-assignment. */
export function seededMac(seed: number): string {
  const octets = [0x02, 0x42, (seed >> 24) & 255, (seed >> 16) & 255, (seed >> 8) & 255, seed & 255];
  return octets.map((value) => value.toString(16).padStart(2, '0')).join(':');
}

export interface InterfaceValidation {
  field: 'ipAddress' | 'subnetMask' | 'gateway' | 'macAddress';
  message: string;
  level: 'error' | 'warning';
}

/** Validates one interface and returns every issue found (may be empty). */
export function validateInterface(iface: NetworkInterface): InterfaceValidation[] {
  const issues: InterfaceValidation[] = [];
  const hasIp = iface.ipAddress.trim().length > 0;
  const hasMask = iface.subnetMask.trim().length > 0;

  if (hasIp && !isValidIPv4(iface.ipAddress)) {
    issues.push({ field: 'ipAddress', level: 'error', message: 'Invalid IPv4 address format.' });
  }
  if (hasMask && !isValidSubnetMask(iface.subnetMask)) {
    issues.push({
      field: 'subnetMask',
      level: 'error',
      message: 'Subnet mask must be contiguous (e.g. 255.255.255.0).',
    });
  }
  if (hasIp && hasMask && isValidIPv4(iface.ipAddress) && isValidSubnetMask(iface.subnetMask)) {
    if (!isUsableHostAddress(iface.ipAddress, iface.subnetMask)) {
      issues.push({
        field: 'ipAddress',
        level: 'error',
        message: 'Address is the network or broadcast address and cannot be assigned to a host.',
      });
    }
    if (iface.gateway.trim().length > 0) {
      if (!isValidIPv4(iface.gateway)) {
        issues.push({ field: 'gateway', level: 'error', message: 'Invalid gateway IPv4 address.' });
      } else {
        if (!isSameSubnet(iface.ipAddress, iface.gateway, iface.subnetMask)) {
          issues.push({
            field: 'gateway',
            level: 'error',
            message: 'Gateway is outside the interface subnet.',
          });
        }
        if (iface.gateway === iface.ipAddress) {
          issues.push({
            field: 'gateway',
            level: 'warning',
            message: 'Gateway points at the interface itself.',
          });
        }
      }
    }
  }
  if (iface.macAddress.trim().length > 0 && !isValidMac(iface.macAddress)) {
    issues.push({ field: 'macAddress', level: 'error', message: 'MAC must use aa:bb:cc:dd:ee:ff format.' });
  }
  return issues;
}

/** Short textual description of an interface's network, e.g. "192.168.10.0/24". */
export function describeNetwork(ip: string, mask: string): string {
  const network = getNetworkAddress(ip, mask);
  const prefix = maskToPrefixLength(mask);
  return network && prefix >= 0 ? `${network}/${prefix}` : '—';
}
