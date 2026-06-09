import type { TopicLabels, TopicStatus } from '../api/types';
import { STATUS_META, tint, topicColor, topicGlyph } from './status';

export function StatusBadge({
  status,
  labels,
}: {
  status: TopicStatus;
  labels?: Partial<TopicLabels>;
}) {
  const blocked = !!labels?.blocked;
  const color = topicColor(status, blocked);
  const label = blocked ? 'Blocked' : STATUS_META[status].label;
  return (
    <span className="badge" style={{ background: tint(color), color }}>
      <span aria-hidden>{topicGlyph(status, blocked)}</span>
      {label}
      {labels?.reviewing && status === 'active' ? (
        <span style={{ opacity: 0.75, fontWeight: 500 }}>· reviewing</span>
      ) : null}
    </span>
  );
}
