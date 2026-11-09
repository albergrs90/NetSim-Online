import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Position,
  useInternalNode,
  type Edge,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';
import { Scissors, WifiOff } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { EdgeHealth, EdgePacketPass } from '../../types/network';

export interface NetworkEdgeData extends Record<string, unknown> {
  health: EdgeHealth;
  passes: EdgePacketPass[];
  inActivePath: boolean;
}

export type NetworkEdge = Edge<NetworkEdgeData>;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface Anchor extends Point {
  position: Position;
}

function nodeRect(node: InternalNode | null | undefined): Rect | null {
  if (!node) return null;
  const position = node.internals.positionAbsolute;
  const width = node.measured?.width ?? 218;
  const height = node.measured?.height ?? 140;
  return { x: position.x, y: position.y, width, height };
}

function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Finds where the line from the rect centre to `towards` crosses the border. */
function borderAnchor(rect: Rect, towards: Point): Anchor {
  const center = centerOf(rect);
  const dx = towards.x - center.x;
  const dy = towards.y - center.y;
  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;

  if (dx === 0 && dy === 0) {
    return { x: center.x, y: center.y, position: Position.Right };
  }

  const clamp = (value: number, min: number, max: number): number =>
    Math.min(Math.max(value, min), max);

  // Bias towards top/bottom anchors so hierarchical (switch → host) links look
  // like a structured cabling tree instead of crossing diagonally.
  if (Math.abs(dy) >= Math.abs(dx) * 0.6) {
    const y = center.y + (dy > 0 ? halfHeight : -halfHeight);
    const offsetX = dy !== 0 ? (dx * halfHeight) / Math.abs(dy) : 0;
    return {
      x: clamp(center.x + offsetX, rect.x + 14, rect.x + rect.width - 14),
      y,
      position: dy > 0 ? Position.Bottom : Position.Top,
    };
  }

  const x = center.x + (dx > 0 ? halfWidth : -halfWidth);
  const offsetY = dx !== 0 ? (dy * halfWidth) / Math.abs(dx) : 0;
  return {
    x,
    y: clamp(center.y + offsetY, rect.y + 14, rect.y + rect.height - 14),
    position: dx > 0 ? Position.Right : Position.Left,
  };
}

function edgeColors(
  health: EdgeHealth,
  selected: boolean,
  inActivePath: boolean,
): { stroke: string; width: number; dash?: string; opacity: number } {
  if (selected) return { stroke: '#22d3ee', width: 2.4, opacity: 1 };
  if (health === 'cut') return { stroke: '#f87171', width: 2, dash: '6 5', opacity: 0.95 };
  if (health === 'offline') return { stroke: '#fb7185', width: 1.8, dash: '2 5', opacity: 0.8 };
  if (inActivePath) return { stroke: '#67e8f9', width: 2.4, opacity: 1 };
  return { stroke: '#34d399', width: 1.8, opacity: 0.8 };
}

export function NetworkEdgeComponent({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
}: EdgeProps<NetworkEdge>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const health: EdgeHealth = data?.health ?? 'active';
  const passes: EdgePacketPass[] = data?.passes ?? [];
  const inActivePath = Boolean(data?.inActivePath);

  const sourceRect = nodeRect(sourceNode);
  const targetRect = nodeRect(targetNode);

  let path: string;
  let labelX: number;
  let labelY: number;
  let reversePath: string;

  if (sourceRect && targetRect) {
    const sourceAnchor = borderAnchor(sourceRect, centerOf(targetRect));
    const targetAnchor = borderAnchor(targetRect, centerOf(sourceRect));

    [path, labelX, labelY] = getBezierPath({
      sourceX: sourceAnchor.x,
      sourceY: sourceAnchor.y,
      sourcePosition: sourceAnchor.position,
      targetX: targetAnchor.x,
      targetY: targetAnchor.y,
      targetPosition: targetAnchor.position,
      curvature: 0.3,
    });
    [reversePath] = getBezierPath({
      sourceX: targetAnchor.x,
      sourceY: targetAnchor.y,
      sourcePosition: targetAnchor.position,
      targetX: sourceAnchor.x,
      targetY: sourceAnchor.y,
      targetPosition: sourceAnchor.position,
      curvature: 0.3,
    });
  } else {
    [path, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition: Position.Right,
      targetX,
      targetY,
      targetPosition: Position.Left,
      curvature: 0.3,
    });
    reversePath = getBezierPath({
      sourceX: targetX,
      sourceY: targetY,
      sourcePosition: Position.Right,
      targetX: sourceX,
      targetY: sourceY,
      targetPosition: Position.Left,
      curvature: 0.3,
    })[0];
  }

  const colors = edgeColors(health, Boolean(selected), inActivePath);
  const style: CSSProperties = {
    stroke: colors.stroke,
    strokeWidth: colors.width,
    strokeDasharray: colors.dash,
    opacity: colors.opacity,
  };

  return (
    <>
      <BaseEdge id={id} path={path} style={style} interactionWidth={20} />
      {inActivePath && health === 'active' && (
        <path
          d={path}
          fill="none"
          stroke="#a5f3fc"
          strokeWidth={1.4}
          strokeDasharray="2 10"
          strokeLinecap="round"
          opacity={0.85}
          className="network-edge-flow pointer-events-none"
        />
      )}

      {passes.map((pass, index) => {
        const motionPath = pass.direction === 'forward' ? path : reversePath;
        return (
          <g
            key={`${pass.runId}:${pass.direction}:${pass.beginMs}:${index}`}
            opacity={0}
            style={{ color: pass.color }}
            className="pointer-events-none"
          >
            <animate
              attributeName="opacity"
              begin={`${pass.beginMs}ms`}
              dur="1ms"
              values="0;1"
              fill="freeze"
            />
            <circle r={9} fill={pass.color} opacity={0.16} className="packet-halo" />
            <circle r={4.5} fill={pass.color} opacity={0.35} />
            <circle r={2.3} fill="#f8fafc" className="packet-core" />
            <animateMotion
              path={motionPath}
              begin={`${pass.beginMs}ms`}
              dur={`${pass.durationMs}ms`}
              fill="freeze"
              repeatCount="1"
            />
          </g>
        );
      })}

      {(health === 'cut' || health === 'offline') && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider shadow-lg"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              borderColor: health === 'cut' ? 'rgba(248,113,113,0.45)' : 'rgba(251,113,133,0.35)',
              background: 'rgba(8,13,22,0.92)',
              color: health === 'cut' ? '#fca5a5' : '#fda4af',
            }}
          >
            {health === 'cut' ? <Scissors size={9} /> : <WifiOff size={9} />}
            {health === 'cut' ? 'cut' : 'offline'}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = {
  network: NetworkEdgeComponent,
};
