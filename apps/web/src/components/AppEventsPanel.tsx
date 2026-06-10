import { useState } from 'react';
import type { AppEvent, AppEventKind } from '../api/types';
import { useAddAppEvent } from '../api/hooks';
import { useToast } from './Toast';
import { formatDateTime, isUrl } from '../lib/format';

const KIND_LABEL: Record<AppEventKind, string> = {
  project_usage: 'Project usage',
  problem_solved: 'Problem solved',
  audit_exercise: 'Audit / exercise',
  real_debugging: 'Real debugging',
};

const KINDS = Object.keys(KIND_LABEL) as AppEventKind[];

/**
 * Application events for a topic (the "application" mastery condition): a list of
 * past events plus a compact add form. Each event records how the topic was used
 * in the real world — a project, a solved problem, an audit, a debugging session.
 */
export function AppEventsPanel({ topicId, events }: { topicId: string; events: AppEvent[] }) {
  const add = useAddAppEvent(topicId);
  const { toast } = useToast();

  const [kind, setKind] = useState<AppEventKind>('problem_solved');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');

  const submit = () => {
    const desc = description.trim();
    if (!desc) return;
    add.mutate(
      { kind, description: desc, url: url.trim() || undefined },
      {
        onSuccess: () => {
          toast('Application event added', 'success');
          setDescription('');
          setUrl('');
        },
        onError: (e) => toast(e instanceof Error ? e.message : 'Could not add event', 'error'),
      },
    );
  };

  return (
    <div className="card card-pad col gap-3">
      <div className="card-title" style={{ margin: 0 }}>
        Application events ({events.length})
      </div>

      {events.length === 0 ? (
        <span className="faint">
          No application events yet — log where you used this topic for real.
        </span>
      ) : (
        <div className="col gap-1 scroll-y" style={{ maxHeight: 160 }}>
          {events.map((e) => (
            <div key={e.id} className="row gap-2" style={{ alignItems: 'baseline' }}>
              <span className="pill nowrap">{KIND_LABEL[e.kind]}</span>
              <span className="grow">
                {e.description}
                {isUrl(e.url) && (
                  <a
                    href={e.url!}
                    target="_blank"
                    rel="noreferrer"
                    className="faint"
                    style={{ marginLeft: 6, fontSize: 12 }}
                  >
                    ↗
                  </a>
                )}
              </span>
              <span className="faint nowrap" style={{ fontSize: 12 }}>
                {formatDateTime(e.appliedAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="col gap-2">
        <div className="row gap-2">
          <select
            className="select"
            style={{ width: 160 }}
            value={kind}
            onChange={(e) => setKind(e.target.value as AppEventKind)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <input
            className="input grow"
            placeholder="What did you do?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        <div className="row gap-2">
          <input
            className="input grow"
            placeholder="Link (optional) — PR, LeetCode, issue…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <button
            className="btn btn-sm btn-primary"
            disabled={add.isPending || !description.trim()}
            onClick={submit}
          >
            {add.isPending ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
