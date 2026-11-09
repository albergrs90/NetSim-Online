import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { TopBar } from './components/layout/TopBar';
import { Palette } from './components/layout/Palette';
import { RightPanel } from './components/layout/RightPanel';
import { NetworkCanvas } from './components/canvas/NetworkCanvas';
import { Toast } from './components/layout/Toast';
import { useNetworkHealth, useConflictLogger } from './hooks/useNetworkHealth';
import { useNetworkStore } from './store/useNetworkStore';

export default function App() {
  const health = useNetworkHealth();
  useConflictLogger(health.conflicts);
  const topologyName = useNetworkStore((state) => state.topologyName);

  useEffect(() => {
    document.title = `NetSim Online — ${topologyName}`;
  }, [topologyName]);

  return (
    <ReactFlowProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-noc-950 text-slate-200">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <Palette />
          <main className="relative min-w-0 flex-1">
            <NetworkCanvas />
          </main>
          <RightPanel />
        </div>
        <Toast />
      </div>
    </ReactFlowProvider>
  );
}
