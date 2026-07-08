import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useImportApply, useImportPreview } from '../../api/hooks';
import { Card, ErrorBox, Spinner, useToast } from '../../components';
import type { ImportPlan, ImportResult } from '../../api/types';
import {
  ActivationsSection,
  NewTopicsSection,
  NextSessionSection,
  NoteSummariesSection,
  ProposedCardsSection,
  ReviewsSection,
  UnresolvedPanel,
} from './sections';

export default function ImportScreen() {
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [applyResult, setApplyResult] = useState<ImportResult | null>(null);

  const { toast } = useToast();
  const importPreview = useImportPreview();
  const importApply = useImportApply();

  const lastPreviewed = useRef<string | null>(null);

  const runPreview = useCallback(
    (raw: string) => {
      lastPreviewed.current = raw;
      setApplyResult(null);
      importPreview.mutate(raw, {
        onSuccess: (p) => setPlan(p),
        onError: () => setPlan(null),
      });
    },
    [importPreview.mutate],
  );

  // Auto-preview: once the pasted text contains a learning-os block, the
  // deterministic read-only diff runs on its own; the button stays for
  // manual re-runs.
  useEffect(() => {
    if (!/```\s*learning-os/.test(text) || text === lastPreviewed.current) return;
    const t = setTimeout(() => runPreview(text), 600);
    return () => clearTimeout(t);
  }, [text, runPreview]);

  const onApply = () => {
    importApply.mutate(text, {
      onSuccess: (res) => {
        setApplyResult(res);
        toast('Imported', 'success');
      },
      onError: (e) => toast(e instanceof Error ? e.message : 'Import failed', 'error'),
    });
  };

  const canApply = !!plan && plan.applicable;

  return (
    <div className="page">
      <h1 className="page-title">Import session</h1>
      <p className="page-sub">
        Paste the Claude session output (it contains a fenced{' '}
        <span className="mono">learning-os</span> block), preview the deterministic diff, then
        confirm to apply.
      </p>

      <div className="col gap-4">
        {/* 2. Paste + Preview */}
        <Card>
          <div className="col gap-3">
            <textarea
              className="textarea mono"
              style={{ minHeight: 180, width: '100%' }}
              placeholder="Paste Claude output here…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="row gap-3">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!text.trim() || importPreview.isPending}
                onClick={() => runPreview(text)}
              >
                {importPreview.isPending ? (
                  <span className="row gap-2">
                    <Spinner /> Previewing…
                  </span>
                ) : (
                  'Preview'
                )}
              </button>
              {plan && <span className="faint mono">session {plan.sessionExportId}</span>}
            </div>
            {importPreview.isError && <ErrorBox error={importPreview.error} />}
          </div>
        </Card>

        {/* 3. Diff sections */}
        {plan && (
          <>
            <ReviewsSection reviews={plan.reviews} />
            <NewTopicsSection topics={plan.newTopics} />
            <ActivationsSection activations={plan.activations} />
            <ProposedCardsSection prompts={plan.newPrompts} />
            <NoteSummariesSection notes={plan.noteSummaries} />
            <NextSessionSection next={plan.nextSession} />

            {/* 4. Unresolved */}
            {plan.unresolved.length > 0 && <UnresolvedPanel items={plan.unresolved} />}

            {/* 5. Apply */}
            <Card>
              <div className="col gap-3">
                {plan.alreadyImported && (
                  <div className="faint">This session export was already imported.</div>
                )}
                <div className="row gap-3">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!canApply || importApply.isPending}
                    onClick={onApply}
                  >
                    {importApply.isPending ? (
                      <span className="row gap-2">
                        <Spinner /> Applying…
                      </span>
                    ) : (
                      'Apply import'
                    )}
                  </button>
                  {!canApply && !plan.alreadyImported && (
                    <span className="faint">Resolve all items above before importing.</span>
                  )}
                </div>
              </div>
            </Card>
          </>
        )}

        {/* 6. Apply result */}
        {applyResult && (
          <Card
            title={
              <span className="row gap-2" style={{ color: 'var(--st-mastered)' }}>
                ✓ Import applied
              </span>
            }
            style={{ borderColor: 'var(--st-mastered)' }}
          >
            <div className="col gap-3">
              <div className="stat-strip">
                <div className="kpi">
                  <div>{applyResult.reviewsApplied}</div>
                  <div className="kpi-label">reviews applied</div>
                </div>
                <div className="kpi">
                  <div>{applyResult.topicsCreated.length}</div>
                  <div className="kpi-label">new topics</div>
                </div>
                <div className="kpi">
                  <div>{applyResult.promptsCreated}</div>
                  <div className="kpi-label">new cards</div>
                </div>
                <div className="kpi">
                  <div>{applyResult.topicsActivated}</div>
                  <div className="kpi-label">topics activated</div>
                </div>
                <div className="kpi">
                  <div>{applyResult.noteSummariesApplied}</div>
                  <div className="kpi-label">note summaries</div>
                </div>
                <div className="kpi">
                  <div>{applyResult.appEventsApplied}</div>
                  <div className="kpi-label">app. events</div>
                </div>
                <div className="kpi">
                  <div>{applyResult.nextSessionStored ? '✓' : '—'}</div>
                  <div className="kpi-label">
                    {applyResult.nextSessionStored ? 'next focus stored' : 'no next focus'}
                  </div>
                </div>
              </div>

              <div className="row gap-2" style={{ alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: 12.5 }}>
                  The loop is re-armed — the Dashboard reflects these changes.
                </span>
                <Link to="/" className="btn btn-primary btn-sm">
                  Back to Dashboard
                </Link>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
