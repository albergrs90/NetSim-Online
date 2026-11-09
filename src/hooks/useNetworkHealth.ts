import { useEffect, useMemo, useRef } from 'react';
import type { IpConflict } from '../types/network';
import { analyzeNetwork } from '../engine/topology';
import { useNetworkStore } from '../store/useNetworkStore';

/** Memoised network health for the current topology. */
export function useNetworkHealth() {
  const devices = useNetworkStore((state) => state.devices);
  const connections = useNetworkStore((state) => state.connections);
  return useMemo(() => analyzeNetwork(devices, connections), [devices, connections]);
}

function conflictKey(conflict: IpConflict): string {
  return [conflict.ip, conflict.a.deviceId, conflict.b.deviceId].sort().join('|');
}

/**
 * Emits console warnings once per unique IP conflict and a recovery message
 * when the last conflict disappears.
 */
export function useConflictLogger(conflicts: IpConflict[]): void {
  const addLog = useNetworkStore((state) => state.addLog);
  const seen = useRef<Set<string>>(new Set());
  const hadConflicts = useRef(false);

  useEffect(() => {
    const current = new Set(conflicts.map(conflictKey));

    for (const conflict of conflicts) {
      const key = conflictKey(conflict);
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      addLog(
        'warning',
        'engine',
        `IP conflict detected: ${conflict.ip} is assigned to ${conflict.a.deviceName} and ${conflict.b.deviceName} in the same broadcast domain.`,
      );
    }

    for (const key of Array.from(seen.current)) {
      if (!current.has(key)) seen.current.delete(key);
    }

    if (current.size === 0 && hadConflicts.current) {
      addLog('success', 'engine', 'All IP conflicts resolved. Broadcast domains are clean.');
    }
    hadConflicts.current = current.size > 0;
  }, [conflicts, addLog]);
}
