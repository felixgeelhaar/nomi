import { useMemo, useRef } from "react";import type { StepDefinition } from "@/types/api";

interface PlanGraphProps {
  steps: StepDefinition[];
  onSelectStep?: (stepID: string) => void;
  selectedStepID?: string;
}

interface NodeLayout {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tool?: string;
}

interface EdgeLayout {
  from: string;
  to: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 48;
const LAYER_GAP = 80;
const NODE_GAP = 16;

/**
 * Topological sort with layer assignment (minimum layer for each node).
 * Returns nodes ordered by layer, then by original order.
 */
function layoutDAG(steps: StepDefinition[]): NodeLayout[] {
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();

  steps.forEach((s) => {
    inDegree.set(s.id, 0);
    children.set(s.id, []);
  });

  steps.forEach((s) => {
    (s.depends_on ?? []).forEach((depID) => {
      if (stepMap.has(depID)) {
        const count = inDegree.get(s.id) ?? 0;
        inDegree.set(s.id, count + 1);
        children.set(depID, [...(children.get(depID) ?? []), s.id]);
      }
    });
  });

  // Layer assignment (longest path from roots)
  const layer = new Map<string, number>();
  const queue: string[] = [];
  steps.forEach((s) => {
    if ((inDegree.get(s.id) ?? 0) === 0) {
      layer.set(s.id, 0);
      queue.push(s.id);
    }
  });

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const currLayer = layer.get(curr) ?? 0;
    (children.get(curr) ?? []).forEach((childID) => {
      const newLayer = currLayer + 1;
      if ((layer.get(childID) ?? 0) < newLayer) {
        layer.set(childID, newLayer);
      }
      const deg = inDegree.get(childID)!;
      inDegree.set(childID, deg - 1);
      if (deg - 1 === 0) {
        queue.push(childID);
      }
    });
  }

  // Group by layer
  const layers = new Map<number, string[]>();
  steps.forEach((s) => {
    const l = layer.get(s.id) ?? 0;
    layers.set(l, [...(layers.get(l) ?? []), s.id]);
  });

  // Sort layers by original order within each layer
  const sortedLayers = [...layers.entries()].sort(([a], [b]) => a - b);
  const orderMap = new Map(steps.map((s, i) => [s.id, s.order ?? i]));

  const nodes: NodeLayout[] = [];
  sortedLayers.forEach(([, ids]) => {
    const sorted = ids.sort(
      (a, b) => (orderMap.get(a) ?? 0) - (orderMap.get(b) ?? 0),
    );
    sorted.forEach((id) => {
      const step = stepMap.get(id)!;
      nodes.push({
        id,
        title: step.title,
        x: 0,
        y: 0,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        tool: step.expected_tool,
      });
    });
  });

  // Assign positions
  const layerNodes = new Map<number, NodeLayout[]>();
  nodes.forEach((n) => {
    const l = layer.get(n.id) ?? 0;
    layerNodes.set(l, [...(layerNodes.get(l) ?? []), n]);
  });

  const totalLayers = Math.max(...[...layerNodes.keys()]) + 1;
  const totalHeight =
    totalLayers * (NODE_HEIGHT + LAYER_GAP) - LAYER_GAP;

  let currentY = 20;
  for (let l = 0; l < totalLayers; l++) {
    const layerSteps = layerNodes.get(l) ?? [];
    const layerHeight =
      layerSteps.length * (NODE_HEIGHT + NODE_GAP) - NODE_GAP;
    const startY = currentY + (totalHeight - layerHeight) / 2;

    layerSteps.forEach((node, i) => {
      node.y = startY + i * (NODE_HEIGHT + NODE_GAP);
      node.x = 20;
    });
    currentY += (NODE_HEIGHT + LAYER_GAP) + layerHeight;
  }

  return nodes;
}

function getEdges(steps: StepDefinition[], nodes: NodeLayout[]): EdgeLayout[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edges: EdgeLayout[] = [];

  steps.forEach((s) => {
    (s.depends_on ?? []).forEach((depID) => {
      const from = nodeMap.get(depID);
      const to = nodeMap.get(s.id);
      if (from && to) {
        edges.push({
          from: depID,
          to: s.id,
          fromX: from.x + from.width,
          fromY: from.y + from.height / 2,
          toX: to.x,
          toY: to.y + to.height / 2,
        });
      }
    });
  });

  return edges;
}

export function PlanGraph({
  steps,
  onSelectStep,
  selectedStepID,
}: PlanGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const nodes = useMemo(() => layoutDAG(steps), [steps]);
  const edges = useMemo(() => getEdges(steps, nodes), [steps, nodes]);

  const svgHeight =
    nodes.length > 0
      ? Math.max(
          ...nodes.map((n) => n.y + n.height),
        ) + 20
      : 100;

  // Simple arrow marker
  const markerID = "arrowhead";

  const svgWidth =
    nodes.length > 0
      ? Math.max(
          ...nodes.map((n) => n.x + n.width),
        ) + 20
      : 200;

  return (
    <div className="overflow-x-auto border rounded-md bg-background/50 p-2">
      <svg
        ref={svgRef}
        width={svgWidth}
        height={svgHeight}
        className="min-w-full"
        role="img"
        aria-label={`Plan graph with ${steps.length} steps`}
      >
        <defs>
          <marker
            id={markerID}
            markerWidth="10"
            markerHeight="7"
            refX="10"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#6b7280" />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map((edge, i) => {
          const midX = (edge.fromX + edge.toX) / 2;
          return (
            <g key={`edge-${i}`}>
              <path
                d={`M ${edge.fromX} ${edge.fromY} C ${midX} ${edge.fromY}, ${midX} ${edge.toY}, ${edge.toX} ${edge.toY}`}
                fill="none"
                stroke="#6b7280"
                strokeWidth="1.5"
                markerEnd={`url(#${markerID})`}
                aria-hidden="true"
              />
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const isSelected = node.id === selectedStepID;
          return (
            <g
              key={node.id}
              onClick={() => onSelectStep?.(node.id)}
              className="cursor-pointer"
              role="button"
              aria-label={`Step: ${node.title}`}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  onSelectStep?.(node.id);
                }
              }}
            >
              <rect
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx="6"
                ry="6"
                fill={isSelected ? "#3b82f6" : "#ffffff"}
                stroke={isSelected ? "#2563eb" : "#d1d5db"}
                strokeWidth="1.5"
              />
              <text
                x={node.x + node.width / 2}
                y={node.y + node.height / 2 - 4}
                textAnchor="middle"
                className="text-xs font-medium fill-gray-900"
                style={{ fontSize: "11px", pointerEvents: "none" }}
              >
                {node.title.length > 25
                  ? node.title.slice(0, 22) + "..."
                  : node.title}
              </text>
              {node.tool && (
                <text
                  x={node.x + node.width / 2}
                  y={node.y + node.height / 2 + 10}
                  textAnchor="middle"
                  className="text-[10px] fill-gray-500"
                  style={{ fontSize: "9px", pointerEvents: "none" }}
                >
                  {node.tool}
                </text>
              )}
            </g>
          );
        })}

        {/* Empty state */}
        {steps.length === 0 && (
          <text
            x={svgWidth / 2}
            y={svgHeight / 2}
            textAnchor="middle"
            className="text-xs fill-muted-foreground"
          >
            No steps in plan
          </text>
        )}
      </svg>
    </div>
  );
}
