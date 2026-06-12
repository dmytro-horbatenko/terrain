import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 56;

/**
 * Run a dagre left-to-right layout over the given nodes/edges and return a new
 * array of nodes with `position` set. Edges are used only for ranking; their
 * own objects are returned untouched by the caller.
 */
export function layoutGraph<T extends Record<string, unknown>>(
  nodes: Node<T>[],
  edges: Edge[],
): Node<T>[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  // Only feed dagre edges whose endpoints are both present as nodes.
  const ids = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    if (ids.has(edge.source) && ids.has(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const p = g.node(node.id);
    return {
      ...node,
      position: {
        x: (p?.x ?? 0) - NODE_WIDTH / 2,
        y: (p?.y ?? 0) - NODE_HEIGHT / 2,
      },
    };
  });
}
