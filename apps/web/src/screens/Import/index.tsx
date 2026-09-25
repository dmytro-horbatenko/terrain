import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useImportApply } from '../../api/hooks';
import { Card, ErrorBox, Spinner, useToast } from '../../components';
import type { ImportPlan, ImportResult } from '../../api/types';
import { useImportDraft } from './importDraft';
import { NotesHandoff } from './NotesHandoff';
import {
  ActivationsSection,
  NewTopicsSection,
  NextSessionSection,
  NoteSummariesSection,
  ProposedCardsSection,
  ReviewsSection,
  SourceEvidenceSection,
  SourceIssuesPanel,
  UnresolvedPanel,
} from './sections';

export default function ImportScreen() {
  const [applyResult, setApplyResult] = useState<ImportResult | null>(null);
  const [appliedPlan, setAppliedPlan] = useState<ImportPlan | null>(null);

  const { toast } = useToast();
  const importApply = useImportApply();
  const importPreview = useImportDraft(!importApply.isPending);
  const { text, setText, plan, runPreview } = importPreview;

  const onApply = () => {
    if (!plan?.applicable || importPreview.isPending || importApply.isPending) return;
    importApply.mutate(text, {
      onSuccess: (res) => {
        setAppliedPlan(plan);
        setApplyResult(res);
        toast('Imported', 'success');
      },
      onError: (e) => toast(e instanceof Error ? e.message : 'Import failed', 'error'),
    });
  };

  const canApply = !!plan?.applicable && !importPreview.isPending && !applyResult;

  return (
    <div className="page">
      <h1 className="page-title">Import session</h1>
      <p className="page-sub">
        Paste the chat session output or its JSON block, preview the deterministic diff, then
        confirm to apply.
      </p>

      <div className="col gap-4">
        {/* 2. Paste + Preview */}
        <Card>
          <div className="col gap-3">
            <textarea
              className="textarea mono"
              style={{ minHeight: 180, width: '100%' }}
              placeholder="Paste chat output here…"
              aria-label="Chat session output"
              disabled={importApply.isPending}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setApplyResult(null);
              }}
            />
            <div className="row gap-3">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!text.trim() || importPreview.isPending || importApply.isPending}
                onClick={runPreview}
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
            {!!importPreview.error && <ErrorBox error={importPreview.error} />}
          </div>
        </Card>

        {/* 3. Diff sections */}
        {plan && (
          <>
            <ReviewsSection reviews={plan.reviews} />
            <NewTopicsSection topics={plan.newTopics} />
            <SourceEvidenceSection evidence={plan.sourceEvidence ?? []} />
            <SourceIssuesPanel issues={plan.sourceIssues ?? []} />
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
                  {!canApply && !plan.alreadyImported && !applyResult && (
                    <span className="faint">Resolve all items above before importing.</span>
                  )}
                </div>
              </div>
            </Card>
          </>
        )}

        {/* 6. Apply result */}
        {applyResult && appliedPlan && (
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
                {applyResult.duplicatePromptsSkipped > 0 && (
                  <div className="kpi">
                    <div>{applyResult.duplicatePromptsSkipped}</div>
                    <div className="kpi-label">duplicate cards skipped</div>
                  </div>
                )}
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
                  <div>{applyResult.sourceEvidenceApplied}</div>
                  <div className="kpi-label">source reconstructions stored</div>
                </div>
                <div className="kpi">
                  <div>{applyResult.nextSessionStored ? '✓' : '—'}</div>
                  <div className="kpi-label">
                    {applyResult.nextSessionStored ? 'next focus stored' : 'no next focus'}
                  </div>
                </div>
              </div>

              <NotesHandoff plan={appliedPlan} result={applyResult} />
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
