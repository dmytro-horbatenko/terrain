import { useState } from 'react';
import { useImportApply, useImportPreview } from '../../api/hooks';
import { Card, ErrorBox, Spinner, useToast } from '../../components';
import type { ImportPlan, ImportResult } from '../../api/types';
import {
  NewTopicsSection,
  NextSessionSection,
  NoteSummariesSection,
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

  const onPreview = () => {
    setApplyResult(null);
    importPreview.mutate(text, {
      onSuccess: (p) => setPlan(p),
      onError: () => setPlan(null),
    });
  };

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
              onClick={onPreview}
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
              <div>{applyResult.noteSummariesApplied}</div>
              <div className="kpi-label">note summaries</div>
            </div>
            <div className="kpi">
              <div>{applyResult.nextSessionStored ? '✓' : '—'}</div>
              <div className="kpi-label">
                {applyResult.nextSessionStored ? 'next focus stored' : 'no next focus'}
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
