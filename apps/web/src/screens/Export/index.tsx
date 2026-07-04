import { useMemo, useState } from 'react';
import { useGenerateExport, useTopics } from '../../api/hooks';
import { Card, useToast, Loading, ErrorBox } from '../../components';
import type { ExportResult, TopicWithMeta } from '../../api/types';

type Mode = 'full' | 'domain' | 'focus' | 'repeat' | 'learn';

export default function ExportScreen() {
  const { toast } = useToast();
  const topicsQ = useTopics();
  const generate = useGenerateExport();

  const [mode, setMode] = useState<Mode>('full');
  const [domain, setDomain] = useState<string>('');
  const [focusTopicId, setFocusTopicId] = useState<string>('');
  const [result, setResult] = useState<ExportResult | null>(null);

  const topics: TopicWithMeta[] = topicsQ.data ?? [];

  const domains = useMemo(() => {
    const set = new Set<string>();
    for (const t of topics) if (t.domain) set.add(t.domain);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [topics]);

  const sortedTopics = useMemo(
    () => [...topics].sort((a, b) => a.title.localeCompare(b.title)),
    [topics],
  );

  // Keep the domain selection valid as data loads; fall back to the first domain.
  const effectiveDomain = domain || domains[0] || '';

  const canGenerate =
    !generate.isPending &&
    (mode === 'full' ||
      (mode === 'domain' && !!effectiveDomain) ||
      (mode === 'focus' && !!focusTopicId) ||
      mode === 'repeat' ||
      mode === 'learn');

  function handleGenerate() {
    const args: { mode?: string; focusTopicId?: string } = {};
    if (mode === 'domain') {
      if (!effectiveDomain) {
        toast('Pick a domain first', 'error');
        return;
      }
      args.mode = 'domain:' + effectiveDomain;
    } else if (mode === 'focus') {
      if (!focusTopicId) {
        toast('Pick a focus topic first', 'error');
        return;
      }
      args.focusTopicId = focusTopicId;
    } else if (mode === 'repeat') {
      args.mode = 'repeat';
    } else if (mode === 'learn') {
      args.mode = 'learn';
      if (focusTopicId) args.focusTopicId = focusTopicId;
    }
    generate.mutate(args, {
      onSuccess: (data) => {
        setResult(data);
        toast('Export generated', 'success');
      },
      onError: (err) => {
        toast(err instanceof Error ? err.message : 'Export failed', 'error');
      },
    });
  }

  const hasClipboard = typeof navigator !== 'undefined' && !!navigator.clipboard?.writeText;

  function handleCopy() {
    if (!result) return;
    if (!hasClipboard) {
      toast('Select the text below and copy manually', 'info');
      return;
    }
    navigator.clipboard
      .writeText(result.exportMd)
      .then(() => toast('Copied to clipboard', 'success'))
      .catch(() => toast('Could not copy — select the text manually', 'error'));
  }

  return (
    <div className="page">
      <h1 className="page-title">Session export</h1>
      <p className="page-sub">
        Generate the context block below, paste it into a fresh Claude.ai session, then bring
        Claude&apos;s reply back to the Import screen to log reviews and new topics.
      </p>

      <Card title="Mode">
        <div className="col gap-3">
          <div className="seg" role="tablist">
            <button
              className={mode === 'full' ? 'on' : ''}
              onClick={() => setMode('full')}
              type="button"
            >
              Full
            </button>
            <button
              className={mode === 'domain' ? 'on' : ''}
              onClick={() => setMode('domain')}
              type="button"
            >
              By domain
            </button>
            <button
              className={mode === 'focus' ? 'on' : ''}
              onClick={() => setMode('focus')}
              type="button"
            >
              Focus topic
            </button>
            <button
              className={mode === 'repeat' ? 'on' : ''}
              onClick={() => setMode('repeat')}
              type="button"
            >
              Repeat today
            </button>
            <button
              className={mode === 'learn' ? 'on' : ''}
              onClick={() => setMode('learn')}
              type="button"
            >
              Learn next
            </button>
          </div>

          {mode === 'full' && (
            <p className="muted" style={{ margin: 0 }}>
              Exports your entire learning landscape — every active and planned topic, due reviews,
              and streak context.
            </p>
          )}

          {mode === 'domain' && (
            <div className="col gap-2">
              <label className="field-label" htmlFor="export-domain">
                Domain
              </label>
              {topicsQ.isLoading ? (
                <Loading label="Loading domains…" />
              ) : domains.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  No topics yet — add one on the Topics screen, or run a Full export and let Claude
                  propose your roadmap.
                </p>
              ) : (
                <select
                  id="export-domain"
                  className="select"
                  value={effectiveDomain}
                  onChange={(e) => setDomain(e.target.value)}
                  style={{ maxWidth: 360 }}
                >
                  {domains.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
              <p className="muted" style={{ margin: 0 }}>
                Narrows the export to a single domain so the session stays focused on one area.
              </p>
            </div>
          )}

          {mode === 'focus' && (
            <div className="col gap-2">
              <label className="field-label" htmlFor="export-focus">
                Focus topic
              </label>
              {topicsQ.isLoading ? (
                <Loading label="Loading topics…" />
              ) : sortedTopics.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  No topics yet — add one on the Topics screen, or run a Full export and let Claude
                  propose your roadmap.
                </p>
              ) : (
                <select
                  id="export-focus"
                  className="select"
                  value={focusTopicId}
                  onChange={(e) => setFocusTopicId(e.target.value)}
                  style={{ maxWidth: 480 }}
                >
                  <option value="">Select a topic…</option>
                  {sortedTopics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                      {t.domain ? ` — ${t.domain}` : ''}
                    </option>
                  ))}
                </select>
              )}
              <p className="muted" style={{ margin: 0 }}>
                Pins this topic and its prerequisites at the top and adds an explicit SESSION GOAL
                so Claude drives toward mastering it.
              </p>
            </div>
          )}

          {mode === 'repeat' && (
            <p className="muted" style={{ margin: 0 }}>
              Today&apos;s interleaved review queue plus a conduct script — Claude quizzes you card
              by card and records your self-grades.
            </p>
          )}

          {mode === 'learn' && (
            <div className="col gap-2">
              <label className="field-label" htmlFor="export-learn-topic">
                Topic to learn
              </label>
              <select
                id="export-learn-topic"
                className="select"
                value={focusTopicId}
                onChange={(e) => setFocusTopicId(e.target.value)}
                style={{ maxWidth: 480 }}
              >
                <option value="">Next Up (default)</option>
                {sortedTopics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                    {t.domain ? ` — ${t.domain}` : ''}
                  </option>
                ))}
              </select>
              <p className="muted" style={{ margin: 0 }}>
                A teaching session for one new topic: where it fits, what it builds on, and
                instructions for Claude to propose cards and mark it studied.
              </p>
            </div>
          )}

          {topicsQ.isError && <ErrorBox error={topicsQ.error} />}

          <div className="row">
            <button
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={!canGenerate}
              type="button"
            >
              {generate.isPending ? 'Generating…' : 'Generate export'}
            </button>
          </div>
        </div>
      </Card>

      {result && (
        <Card
          title={
            <span className="row gap-2 center">
              <span>Export ready</span>
              <span className="mono faint" style={{ fontSize: 12 }}>
                {result.id}
              </span>
            </span>
          }
          actions={
            <button className="btn btn-sm" onClick={handleCopy} type="button">
              Copy
            </button>
          }
        >
          {!hasClipboard && (
            <p className="muted" style={{ marginTop: 0 }}>
              Clipboard access is unavailable here — select all of the text below and copy it
              manually.
            </p>
          )}
          <pre
            className="mono scroll-y"
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 520,
              fontSize: 12,
              lineHeight: 1.5,
              padding: 14,
              margin: 0,
              background: 'var(--surface-2)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {result.exportMd}
          </pre>
        </Card>
      )}
    </div>
  );
}
