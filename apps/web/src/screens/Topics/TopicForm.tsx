import { useId, useState, type FormEvent } from 'react';
import { useCreateTopic } from '../../api/hooks';
import { useToast, TypeAutocomplete } from '../../components';
import { TOPIC_STATUSES } from '../../api/types';
import type { CreateTopicInput, TopicStatus, TopicWithMeta } from '../../api/types';
import { STATUS_META } from '../../components';

/** Controlled create-topic form. Lives inside the Add-topic Modal. */
export function TopicForm({
  topics,
  domains,
  onClose,
}: {
  topics: TopicWithMeta[];
  domains: string[];
  onClose: () => void;
}) {
  const create = useCreateTopic();
  const { toast } = useToast();
  const domainListId = useId();

  const [title, setTitle] = useState('');
  const [domain, setDomain] = useState(domains[0] ?? '');
  const [topicType, setTopicType] = useState('');
  const [status, setStatus] = useState<TopicStatus>('planned');
  const [description, setDescription] = useState('');
  const [noteRef, setNoteRef] = useState('');
  const [parentId, setParentId] = useState('');

  const trimmedTitle = title.trim();
  const canSubmit = !!trimmedTitle && !create.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    const payload: CreateTopicInput = {
      title: trimmedTitle,
      domain: domain.trim(),
      topicType: topicType.trim(),
    };
    if (status !== 'planned') payload.status = status;
    if (description.trim()) payload.description = description.trim();
    if (noteRef.trim()) payload.noteRef = noteRef.trim();
    if (parentId) payload.parentId = parentId;

    create.mutate(payload, {
      onSuccess: () => {
        onClose();
        toast('Topic created', 'success');
      },
      onError: (err) =>
        toast(err instanceof Error ? err.message : 'Failed to create topic', 'error'),
    });
  };

  return (
    <form onSubmit={submit} className="col gap-3">
      <div className="col gap-1">
        <label className="field-label">Title *</label>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Binary search invariants"
          autoFocus
          required
        />
      </div>

      <div className="row gap-3">
        <div className="col gap-1 grow">
          <label className="field-label">Domain</label>
          <input
            className="input"
            list={domainListId}
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="e.g. Algorithms"
          />
          <datalist id={domainListId}>
            {domains.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </div>
        <div className="col gap-1 grow">
          <label className="field-label">Type</label>
          <TypeAutocomplete value={topicType} onChange={setTopicType} />
        </div>
      </div>

      <div className="row gap-3">
        <div className="col gap-1 grow">
          <label className="field-label">Status</label>
          <select
            className="select"
            value={status}
            onChange={(e) => setStatus(e.target.value as TopicStatus)}
          >
            {TOPIC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
        </div>
        <div className="col gap-1 grow">
          <label className="field-label">Parent topic</label>
          <select className="select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">— none —</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="col gap-1">
        <label className="field-label">Description</label>
        <textarea
          className="textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Optional notes about what this covers…"
        />
      </div>

      <div className="col gap-1">
        <label className="field-label">Note reference</label>
        <input
          className="input"
          value={noteRef}
          onChange={(e) => setNoteRef(e.target.value)}
          placeholder="URL or note id (optional)"
        />
      </div>

      <div className="row right gap-2" style={{ marginTop: 4 }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          {create.isPending ? 'Creating…' : 'Create topic'}
        </button>
      </div>
    </form>
  );
}
