import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { TopicWithMeta } from '../../api/types';

export type GroupNodeData = {
  topic: TopicWithMeta;
  progress: { started: number; total: number };
  startableCount: number;
  tentativeCount: number;
  containsNextUp: boolean;
};

export type GroupNodeType = Node<GroupNodeData, 'group'>;

/**
 * Collapsed chapter node: a topic with children, shown as its whole subtree.
 * Click drills in (handled by the screen). Handles exist so aggregated edges
 * can attach, but connections can't start or end here.
 */
export default function GroupNode({ data }: NodeProps<GroupNodeType>) {
  const { topic, progress, startableCount, tentativeCount, containsNextUp } = data;
  return (
    <div
      className="rf-node"
      title={`Open ${topic.title}`}
      style={{
        borderWidth: 2,
        cursor: 'pointer',
        boxShadow: containsNextUp ? '0 0 0 2px var(--st-active)' : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="rf-title" style={{ fontWeight: 650 }}>
        {topic.title}
      </div>
      <div className="rf-meta row wrap gap-1" style={{ alignItems: 'center' }}>
        <span>
          {progress.started}/{progress.total} started
        </span>
        {startableCount > 0 && <span className="pill">▶ {startableCount} startable</span>}
        {tentativeCount > 0 && (
          <span title="Contains imported, un-curated topics" style={{ color: 'var(--st-active)' }}>
            ✦ {tentativeCount}
          </span>
        )}
        {containsNextUp && <span className="pill">Next up</span>}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
