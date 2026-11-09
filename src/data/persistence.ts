/**
 * JSON persistence: schema validation, normalisation and file download.
 * Imports are defensive — a malformed file never crashes the canvas.
 */

import type {
  CableType,
  Connection,
  Device,
  DeviceType,
  NetworkInterface,
  RoutingEntry,
  TopologyFile,
} from '../types/network';
import { seededMac } from '../engine/ip';
import { resolveInterface } from '../engine/topology';
import { createId } from '../utils/format';

const DEVICE_TYPES: readonly DeviceType[] = ['router', 'switch', 'server', 'pc'];
const MAX_DEVICES = 500;
const MAX_CONNECTIONS = 1500;

export interface ImportedTopology {
  name: string;
  devices: Device[];
  connections: Connection[];
}

export type ImportResult =
  | { ok: true; topology: ImportedTopology }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseInterface(raw: unknown, deviceIndex: number, interfaceIndex: number): NetworkInterface {
  if (!isRecord(raw)) {
    throw new Error(`Device #${deviceIndex + 1}: interface #${interfaceIndex + 1} is not an object.`);
  }
  const id = readString(raw.id) || createId('if');
  return {
    id,
    name: readString(raw.name) || `eth${interfaceIndex}`,
    ipAddress: readString(raw.ipAddress),
    subnetMask: readString(raw.subnetMask) || '255.255.255.0',
    gateway: readString(raw.gateway),
    macAddress: readString(raw.macAddress) || seededMac(deviceIndex * 31 + interfaceIndex + 1),
  };
}

function parseRoutingTable(raw: unknown): RoutingEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: RoutingEntry[] = [];
  raw.forEach((entry) => {
    if (!isRecord(entry)) return;
    if (entry.type !== 'static') return;
    const destinationCidr = readString(entry.destinationCidr);
    if (!destinationCidr) return;
    entries.push({
      id: readString(entry.id) || createId('route'),
      destinationCidr,
      nextHop: readString(entry.nextHop),
      interfaceName: readString(entry.interfaceName) || 'eth0',
      metric: readNumber(entry.metric, 10),
      type: 'static',
    });
  });
  return entries;
}

function parseDevice(raw: unknown, index: number): Device {
  if (!isRecord(raw)) {
    throw new Error(`Device #${index + 1} is not a valid object.`);
  }
  const id = readString(raw.id);
  const name = readString(raw.name);
  const type = readString(raw.type) as DeviceType;
  if (!id) throw new Error(`Device #${index + 1} is missing an id.`);
  if (!name) throw new Error(`Device #${index + 1} is missing a name.`);
  if (!DEVICE_TYPES.includes(type)) {
    throw new Error(`Device "${name}" has an unknown type "${String(raw.type)}".`);
  }

  const rawInterfaces = Array.isArray(raw.interfaces) ? raw.interfaces : [];
  const interfaces = rawInterfaces.map((iface, ifaceIndex) => parseInterface(iface, index, ifaceIndex));
  if (interfaces.length === 0) {
    interfaces.push({
      id: createId('if'),
      name: type === 'switch' ? 'port-1' : 'eth0',
      ipAddress: '',
      subnetMask: '255.255.255.0',
      gateway: '',
      macAddress: seededMac(index + 1),
    });
  }

  const position = isRecord(raw.position) ? raw.position : {};

  return {
    id,
    name,
    type,
    isOnline: readBoolean(raw.isOnline, true),
    position: { x: readNumber(position.x), y: readNumber(position.y) },
    routingTable: type === 'router' ? parseRoutingTable(raw.routingTable) : [],
    interfaces,
    description: readString(raw.description) || undefined,
  };
}

function parseConnections(
  raw: unknown,
  devices: Device[],
): Connection[] {
  if (!Array.isArray(raw)) return [];
  const deviceMap = new Map(devices.map((device) => [device.id, device]));
  const connections: Connection[] = [];
  const seenIds = new Set<string>();

  raw.forEach((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Connection #${index + 1} is not a valid object.`);
    }
    const source = readString(entry.source);
    const target = readString(entry.target);
    const sourceDevice = deviceMap.get(source);
    const targetDevice = deviceMap.get(target);
    if (!sourceDevice || !targetDevice) {
      throw new Error(`Connection #${index + 1} references a device that does not exist.`);
    }
    if (source === target) {
      throw new Error(`Connection #${index + 1} connects "${sourceDevice.name}" to itself.`);
    }
    let id = readString(entry.id) || createId('link');
    if (seenIds.has(id)) id = createId('link');
    seenIds.add(id);

    const sourceHandle = readString(entry.sourceHandle) || null;
    const targetHandle = readString(entry.targetHandle) || null;
    const sourceInterface =
      resolveInterface(sourceDevice, readString(entry.sourceInterfaceId) || sourceHandle) ??
      sourceDevice.interfaces[0];
    const targetInterface =
      resolveInterface(targetDevice, readString(entry.targetInterfaceId) || targetHandle) ??
      targetDevice.interfaces[0];

    const cableType: CableType = entry.cableType === 'fiber' ? 'fiber' : 'copper';

    connections.push({
      id,
      source,
      target,
      sourceHandle,
      targetHandle,
      sourceInterfaceId: sourceInterface?.id,
      targetInterfaceId: targetInterface?.id,
      isEnabled: readBoolean(entry.isEnabled, true),
      cableType,
      label: readString(entry.label) || undefined,
    });
  });

  return connections;
}

/** Validates and normalises an untrusted topology document. */
export function parseTopologyFile(text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The file is not valid JSON. Check the syntax and try again.' };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: 'The topology file must contain a JSON object with "devices" and "connections".' };
  }
  if (typeof parsed.format === 'string' && parsed.format !== 'netsim-online') {
    return { ok: false, error: `Unsupported file format "${parsed.format}". Expected a NetSim Online export.` };
  }

  const rawDevices = parsed.devices;
  if (!Array.isArray(rawDevices)) {
    return { ok: false, error: 'Missing "devices" array in the topology file.' };
  }
  if (rawDevices.length === 0) {
    return { ok: false, error: 'The topology file contains no devices.' };
  }
  if (rawDevices.length > MAX_DEVICES) {
    return { ok: false, error: `Topology is too large (${rawDevices.length} devices). Limit is ${MAX_DEVICES}.` };
  }

  let devices: Device[];
  try {
    devices = rawDevices.map((device, index) => parseDevice(device, index));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to parse devices.' };
  }

  const ids = new Set<string>();
  for (const device of devices) {
    if (ids.has(device.id)) {
      return { ok: false, error: `Duplicate device id "${device.id}" found in the file.` };
    }
    ids.add(device.id);
  }

  if (!Array.isArray(parsed.connections)) {
    return { ok: false, error: 'Missing "connections" array in the topology file.' };
  }
  if (parsed.connections.length > MAX_CONNECTIONS) {
    return { ok: false, error: `Topology has too many connections (${parsed.connections.length}).` };
  }

  let connections: Connection[];
  try {
    connections = parseConnections(parsed.connections, devices);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to parse connections.' };
  }

  return {
    ok: true,
    topology: {
      name: readString(parsed.name) || 'Imported Network',
      devices,
      connections,
    },
  };
}

/** Serialises the current workspace into the export format. */
export function serializeTopology(
  devices: Device[],
  connections: Connection[],
  name: string,
): string {
  const document: TopologyFile = {
    format: 'netsim-online',
    version: 1,
    exportedAt: new Date().toISOString(),
    name,
    devices,
    connections,
  };
  return JSON.stringify(document, null, 2);
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'topology'
  );
}

/** Triggers a browser download of the current topology. */
export function downloadTopology(devices: Device[], connections: Connection[], name: string): string {
  const json = serializeTopology(devices, connections, name);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const filename = `${slugify(name)}-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return filename;
}

/** Opens a file picker and returns the selected file's text. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Unable to read the selected file.'));
    reader.readAsText(file);
  });
}
