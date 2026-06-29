import { useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { TopicWithMeta } from '../../api/types';
import { topicColor, topicGlyph } from '../../components';

export type TopicNodeData = {
  topic: TopicWithMeta;
  selected: boolean;
  isNextUp?: boolean;
  onKeep?: (id: string) => void;
  onSetAside?: (id: string) => void;
  onRestore?: (id: string) => void;
  onDelete?: (id: string) => void;
};

export type TopicNodeType = Node<TopicNodeData, 'topic'>;

/**
 * Custom @xyflow/react node ("topic"). Status glyph + title + meta row.
 * Tentative (imported, un-curated) nodes get a dashed border, a ✦ marker and
 * hover Keep / Set-aside controls; parked (set-aside) nodes render muted with
 * Restore / Delete controls. aiContext surfaces as the node tooltip.
 */
export default function TopicNode({ data }: NodeProps<TopicNodeType>) {
  const { topic, selected, isNextUp, onKeep, onSetAside, onRestore, onDelete } = data;
  const [hover, setHover] = useState(false);
  const blocked = topic.labels.blocked;
  const color = topicColor(topic.status, blocked);
  const glyph = topicGlyph(topic.status, blocked);

  const tentative = topic.aiProposed && topic.status !== 'archived';
  const parked = topic.aiProposed && topic.status === 'archived';

  return (
    <div
      className={'rf-node' + (selected ? ' selected' : '')}
      title={topic.aiContext ?? undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        borderLeft: `4px solid ${color}`,
        border: tentative ? `1px dashed ${color}` : undefined,
        borderLeftWidth: 4,
        // Emphasis: startable/active pop; mastered and blocked recede.
        opacity: parked || blocked || topic.status === 'mastered' ? 0.55 : 1,
        boxShadow: isNextUp ? '0 0 0 2px var(--st-active)' : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="rf-title">
        <span style={{ color, marginRight: 6 }}>{glyph}</span>
        {topic.title}
      </div>
      <div className="rf-meta">
        <span>{topic.topicType}</span>
        {topic.aiProposed && (
          <span title="Imported from Claude" style={{ marginLeft: 6, color: 'var(--st-active)' }}>
            ✦
          </span>
        )}
      </div>

      {tentative && hover && (onKeep || onSetAside) && (
        <div className="rf-actions row gap-1" style={{ marginTop: 6 }}>
          {onKeep && (
            <button
              className="btn btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                onKeep(topic.id);
              }}
            >
              ✓ Keep
            </button>
          )}
          {onSetAside && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={(e) => {
                e.stopPropagation();
                onSetAside(topic.id);
              }}
            >
              ✗ Set aside
            </button>
          )}
        </div>
      )}

      {parked && hover && (onRestore || onDelete) && (
        <div className="rf-actions row gap-1" style={{ marginTop: 6 }}>
          {onRestore && (
            <button
              className="btn btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                onRestore(topic.id);
              }}
            >
              ↩ Restore
            </button>
          )}
          {onDelete && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(topic.id);
              }}
            >
              🗑 Delete
            </button>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
