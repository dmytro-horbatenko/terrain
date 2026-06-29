import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { TopicWithMeta } from '../../api/types';

export type GhostNodeData = {
  topic: TopicWithMeta;
  chapterTitle: string | null;
};

export type GhostNodeType = Node<GhostNodeData, 'ghost'>;

/**
 * A dimmed stand-in for a visible leaf's prerequisite that lives outside the
 * current drill level. Click navigates to its chapter (handled by the screen).
 */
export default function GhostNode({ data }: NodeProps<GhostNodeType>) {
  const { topic, chapterTitle } = data;
  return (
    <div
      className="rf-node"
      title={chapterTitle ? `Go to ${chapterTitle}` : undefined}
      style={{ opacity: 0.45, borderStyle: 'dashed', cursor: 'pointer' }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="rf-title">{topic.title}</div>
      <div className="rf-meta">{chapterTitle ? `in ${chapterTitle}` : 'elsewhere'}</div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
