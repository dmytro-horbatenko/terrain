import { useState } from 'react';
import { useBlocker } from '@tanstack/react-router';
import type { AppEvent, AppEventKind } from '../api/types';
import { useAddAppEvent, useSettings } from '../api/hooks';
import { useToast } from './Toast';
import { formatDateTime, isUrl } from '../lib/format';
import { PRACTICE_ASSISTANCE, practiceEventInput, type PracticeDraft } from './practiceEvidence';

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
  const { data: settings } = useSettings();
  const { toast } = useToast();

  const empty: PracticeDraft = {
    kind: 'problem_solved',
    description: '',
    url: '',
    artifact: '',
    command: '',
    result: '',
    assistance: '',
    nextAction: '',
  };
  const [draft, setDraft] = useState<PracticeDraft>(empty);
  const dirty = Object.entries(draft).some(([key, value]) => key !== 'kind' && !!value);
  useBlocker({
    shouldBlockFn: ({ current, next }) =>
      current.pathname !== next.pathname &&
      dirty &&
      !window.confirm(
        'Your practice record has unsaved work. Save it before leaving. Leave anyway?',
      ),
    enableBeforeUnload: dirty,
  });
  const edit = <K extends keyof PracticeDraft>(key: K, value: PracticeDraft[K]) =>
    setDraft((old) => ({ ...old, [key]: value }));
  const latestArtifact = events
    .filter((event) => isUrl(event.url))
    .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))[0];

  const submit = () => {
    if (add.isPending) return;
    let input;
    try {
      input = practiceEventInput(draft);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Check the practice record', 'error');
      return;
    }
    add.mutate(input, {
      onSuccess: () => {
        toast('Application event added', 'success');
        setDraft({ ...empty, kind: draft.kind });
      },
      onError: (e) => toast(e instanceof Error ? e.message : 'Could not add event', 'error'),
    });
  };

  return (
    <div className="card card-pad col gap-3" data-practice-dirty={dirty || undefined}>
      <div className="card-title" style={{ margin: 0 }}>
        Practice & artifacts ({events.length})
      </div>

      {latestArtifact && (
        <div className="col gap-1">
          <a href={latestArtifact.url!} target="_blank" rel="noreferrer">
            Continue from saved artifact ↗
          </a>
          <span className="faint">
            Recorded {formatDateTime(latestArtifact.appliedAt, settings?.timezone)}
          </span>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{latestArtifact.description}</p>
        </div>
      )}

      {events.length === 0 ? (
        <span className="faint">
          No application events yet — log where you used this topic for real.
        </span>
      ) : (
        <div className="col gap-1 scroll-y" style={{ maxHeight: 160 }}>
          {events.map((e) => (
            <div key={e.id} className="row gap-2" style={{ alignItems: 'baseline' }}>
              <span className="pill nowrap">{KIND_LABEL[e.kind]}</span>
              <span className="grow" style={{ whiteSpace: 'pre-wrap' }}>
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
                {formatDateTime(e.appliedAt, settings?.timezone)}
              </span>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset
          className="col gap-2"
          disabled={add.isPending}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <b>Record actual practice</b>
          <div className="row gap-2">
            <select
              className="select"
              aria-label="Practice kind"
              style={{ width: 160 }}
              value={draft.kind}
              onChange={(e) => edit('kind', e.target.value as AppEventKind)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <input
              className="input grow"
              aria-label="Work performed"
              required
              maxLength={6000}
              placeholder="What did you do independently, and what help did you use?"
              value={draft.description}
              onChange={(e) => edit('description', e.target.value)}
            />
          </div>
          <div className="row gap-2">
            <input
              className="input grow"
              aria-label="Practice artifact link"
              type="url"
              maxLength={2000}
              placeholder="Evidence link (optional) — project artifact, test, PR…"
              value={draft.url}
              onChange={(e) => edit('url', e.target.value)}
            />
          </div>
          <details>
            <summary>Code, checks and continuation (optional)</summary>
            <div className="col gap-2" style={{ marginTop: 8 }}>
              <label className="col gap-1">
                File and version
                <input
                  className="input"
                  value={draft.artifact}
                  maxLength={1000}
                  placeholder="Relative file path and commit, if available"
                  onChange={(e) => edit('artifact', e.target.value)}
                />
              </label>
              <label className="col gap-1">
                Check command
                <input
                  className="input mono"
                  value={draft.command}
                  maxLength={1000}
                  placeholder="The command you actually ran"
                  onChange={(e) => edit('command', e.target.value)}
                />
              </label>
              <label className="col gap-1">
                Observed result
                <textarea
                  className="input"
                  rows={2}
                  value={draft.result}
                  maxLength={3000}
                  placeholder="What passed, failed or remains unverified?"
                  onChange={(e) => edit('result', e.target.value)}
                />
              </label>
              <label className="col gap-1">
                Help used
                <select
                  className="select"
                  value={draft.assistance}
                  onChange={(e) =>
                    edit('assistance', e.target.value as PracticeDraft['assistance'])
                  }
                >
                  <option value="">Not recorded</option>
                  {Object.entries(PRACTICE_ASSISTANCE).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col gap-1">
                Next step
                <input
                  className="input"
                  value={draft.nextAction}
                  maxLength={1500}
                  placeholder="One concrete action to resume on any computer"
                  onChange={(e) => edit('nextAction', e.target.value)}
                />
              </label>
            </div>
          </details>
          <p className="faint" style={{ margin: 0 }}>
            Save and push your code before switching computers. Prefer a link to a specific commit.
            Results here are your record; Terrain does not run the command or verify independence.
          </p>
          <button
            className="btn btn-sm btn-primary"
            type="submit"
            style={{ alignSelf: 'flex-start' }}
            disabled={add.isPending || !draft.description.trim()}
          >
            {add.isPending ? 'Saving…' : 'Save practice'}
          </button>
        </fieldset>
      </form>
    </div>
  );
}
