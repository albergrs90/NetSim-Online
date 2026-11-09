/**
 * NetSim Online — core domain model.
 *
 * Every topology saved, imported or exported by the application is described
 * exclusively by the types in this file. Keep them serialisable (plain JSON)
 * so that the persistence layer can round-trip a full network without loss.
 */

export type DeviceType = 'router' | 'switch' | 'server' | 'pc';

export type DeviceStatus = 'online' | 'offline';

export type LinkState = 'up' | 'cut';

export type CableType = 'copper' | 'fiber';

export type Protocol = 'ping' | 'traceroute';

export type HopRole = 'source' | 'switch' | 'router' | 'destination' | 'dropped';

export type LogLevel = 'info' | 'success' | 'warning' | 'error';

export type LogScope = 'system' | 'topology' | 'engine' | 'persistence';

export type PanelTab = 'inspector' | 'simulation' | 'console';

export type EdgeHealth = 'active' | 'cut' | 'offline';

/** A layer-3 interface belonging to a device (eth0, eth1, ...). */
export interface NetworkInterface {
  id: string;
  /** Interface label rendered in the inspector, e.g. "eth0". */
  name: string;
  /** Dotted-quad IPv4 address. Empty string means "unassigned". */
  ipAddress: string;
  /** Dotted-quad subnet mask, e.g. 255.255.255.0. */
  subnetMask: string;
  /** Default gateway for hosts. Empty string for none. */
  gateway: string;
  /** Colon separated MAC address, e.g. 02:42:ac:11:00:0a. */
  macAddress: string;
}

/** A static or automatically derived entry in a router's routing table. */
export interface RoutingEntry {
  id: string;
  /** Destination network in CIDR notation, e.g. 192.168.10.0/24 or 0.0.0.0/0. */
  destinationCidr: string;
  /** Next-hop IPv4 address. "connected" routes use the interface address. */
  nextHop: string;
  /** Interface name the route is reachable through. */
  interfaceName: string;
  metric: number;
  type: 'connected' | 'static';
}

/** A simulated network device placed on the canvas. */
export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  /** Ordered list of network interfaces (a router typically has two or more). */
  interfaces: NetworkInterface[];
  isOnline: boolean;
  /** Canvas position in React Flow flow coordinates. */
  position: { x: number; y: number };
  /** Router-only static routes. Connected routes are derived by the engine. */
  routingTable: RoutingEntry[];
  /** Optional free-form description shown in the inspector. */
  description?: string;
}

/** A physical cable between two devices. */
export interface Connection {
  id: string;
  source: string;
  target: string;
  /** React Flow handle ids (kept for compatibility with custom nodes). */
  sourceHandle?: string | null;
  targetHandle?: string | null;
  /** Interface ids used by the routing engine to resolve the segment. */
  sourceInterfaceId?: string;
  targetInterfaceId?: string;
  isEnabled: boolean;
  cableType: CableType;
  label?: string;
}

/** One hop in a simulated packet path. */
export interface NetworkHop {
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  ip: string;
  role: HopRole;
  /** Cumulative latency in milliseconds from the source. */
  latencyMs: number;
  note: string;
}

/** A packet travelling through the topology. */
export interface Packet {
  id: string;
  protocol: Protocol;
  sourceId: string;
  targetId: string;
  sourceIp: string;
  targetIp: string;
  status: 'in-transit' | 'delivered' | 'dropped';
  createdAt: number;
  path: NetworkHop[];
}

/** Aggregated outcome of a ping / traceroute run. */
export interface SimulationResult {
  id: string;
  protocol: Protocol;
  success: boolean;
  sourceId: string;
  targetId: string;
  sourceName: string;
  targetName: string;
  /** Ordered device ids, including source and destination. */
  path: string[];
  /** Ordered connection ids for each physical link used. */
  edgePath: string[];
  hops: NetworkHop[];
  /** Round-trip time in milliseconds (0 when the request failed). */
  roundTripMs: number;
  /** Human readable summary shown in the UI. */
  message: string;
  /** Extra engine diagnostics (route lookups, subnet checks, ...). */
  details: string[];
  packet: Packet;
  timestamp: number;
}

/** A pair of interfaces that share an IPv4 address inside one broadcast domain. */
export interface IpConflict {
  ip: string;
  a: { deviceId: string; deviceName: string; interfaceId: string; interfaceName: string };
  b: { deviceId: string; deviceName: string; interfaceId: string; interfaceName: string };
}

export interface DeviceAlert {
  deviceId: string;
  level: 'warning' | 'error';
  message: string;
}

/** Pre-computed network health used by the UI. */
export interface NetworkHealth {
  conflicts: IpConflict[];
  deviceAlerts: Record<string, string[]>;
  edgeHealth: Record<string, EdgeHealth>;
  broadcastDomains: string[][];
  onlineDevices: number;
  totalDevices: number;
  activeLinks: number;
  totalLinks: number;
  healthy: boolean;
}

export interface LogEntry {
  id: string;
  level: LogLevel;
  scope: LogScope;
  message: string;
  timestamp: number;
}

/** Animation instruction attached to one edge for the current packet. */
export interface EdgePacketPass {
  runId: string;
  direction: 'forward' | 'backward';
  /** Which leg of the exchange this animation belongs to. */
  phase: 'request' | 'reply';
  beginMs: number;
  durationMs: number;
  color: string;
}

export interface ActivePacket {
  runId: string;
  protocol: Protocol;
  path: string[];
  passesByEdge: Record<string, EdgePacketPass[]>;
  /** Wall-clock timestamp used for cleanup. */
  startedAt: number;
}

/** Serialised topology file format. */
export interface TopologyFile {
  format: 'netsim-online';
  version: 1;
  exportedAt: string;
  name?: string;
  devices: Device[];
  connections: Connection[];
}

/** A one-click, pre-built scenario. */
export interface NetworkTemplate {
  id: string;
  name: string;
  description: string;
  difficulty: 'starter' | 'intermediate' | 'advanced';
  deviceCount: number;
  /** Device names preselected in the simulation panel after loading. */
  suggestedSource?: string;
  suggestedTarget?: string;
  build: () => { devices: Device[]; connections: Connection[] };
}
