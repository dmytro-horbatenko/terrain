import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { sessionRoute } from '../../app/router';
import { useDashboard, useGenerateExport, useImportApply, useImportPreview } from '../../api/hooks';
import { Card, ErrorBox, Loading, Spinner, useToast } from '../../components';
import type { ImportPlan, ImportResult } from '../../api/types';
import { initialStep } from './initialStep';

type Step = 'copy' | 'paste' | 'review' | 'done';

const FINALIZE_PROMPT =
  'Now output the final learning-os block per the OUTPUT CONTRACT from the context I gave ' +
  'you at the start — one fenced ```learning-os block, echoing the sessionId. Prose may ' +
  'surround it; only the last such block is read.';

async function copyToClipboard(text: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function SessionWizard() {
  const { mode } = sessionRoute.useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: dash } = useDashboard();

  const gen = useGenerateExport();
  const preview = useImportPreview();
  const apply = useImportApply();

  const [step, setStep] = useState<Step>('copy');
  const [exportMd, setExportMd] = useState<string | null>(null);
  const [rawFallback, setRawFallback] = useState(false); // clipboard failed → show text
  const [pasted, setPasted] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const didInit = useRef(false);
  const lastPreviewed = useRef<string | null>(null);

  const isMode = mode === 'repeat' || mode === 'learn';

  // Initialise once the dashboard (pendingSessions) is available: resume to
  // paste if a session for this mode is in flight, else generate a fresh export.
  useEffect(() => {
    if (didInit.current || !dash || !isMode) return;
    didInit.current = true;
    const start = initialStep(dash.pendingSessions, mode);
    setStep(start);
    if (start === 'copy') {
      gen.mutate(
        { mode },
        {
          onSuccess: (r) => setExportMd(r.exportMd),
          onError: (e) =>
            toast(e instanceof Error ? e.message : 'Could not build context', 'error'),
        },
      );
    }
  }, [dash, isMode, mode, gen, toast]);

  // Auto-preview once the pasted text contains a learning-os fence or JSON.
  useEffect(() => {
    if (step !== 'paste') return;
    if (!/^\s*(?:```\s*learning-os|\{)/.test(pasted) || pasted === lastPreviewed.current) return;
    const t = setTimeout(() => runPreview(pasted), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasted, step]);

  if (!isMode) {
    return <ErrorBox error={`Unknown session mode "${mode}"`} />;
  }

  const title = mode === 'repeat' ? 'Review session' : 'Learning session';

  function regenerate() {
    gen.mutate(
      { mode },
      {
        onSuccess: async (r) => {
          setExportMd(r.exportMd);
          const ok = await copyToClipboard(r.exportMd);
          setRawFallback(!ok);
          toast(
            ok ? 'Context copied — paste into a fresh Claude chat' : 'Copy the text below',
            ok ? 'success' : 'info',
          );
        },
        onError: (e) => toast(e instanceof Error ? e.message : 'Could not build context', 'error'),
      },
    );
  }

  async function copyContext() {
    if (!exportMd) return;
    const ok = await copyToClipboard(exportMd);
    setRawFallback(!ok);
    if (ok) {
      toast('Context copied — paste into a fresh Claude chat', 'success');
      setStep('paste');
    } else {
      toast('Clipboard unavailable — copy the text below manually', 'info');
    }
  }

  function runPreview(raw: string) {
    lastPreviewed.current = raw;
    preview.mutate(raw, {
      onSuccess: (p) => {
        setPlan(p);
        setStep('review');
      },
      onError: () => setPlan(null),
    });
  }

  function save() {
    apply.mutate(pasted, {
      onSuccess: (res) => {
        setResult(res);
        setStep('done');
      },
      onError: (e) => toast(e instanceof Error ? e.message : 'Save failed', 'error'),
    });
  }

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1 className="page-title">{title}</h1>

      {step === 'copy' && (
        <Card>
          <div className="col gap-3">
            <p className="muted" style={{ margin: 0 }}>
              Copy this and paste it into a fresh Claude chat. Do the full session — Claude will
              quiz you, ask for an implementation, and have you solve problems. When you&apos;re
              done, come back and paste Claude&apos;s final message.
            </p>
            {mode === 'learn' && dash?.nextUp && dash.nextUp.sourcePlanStats.requiredCount > 0 && (
              <div className="faint" style={{ fontSize: 12.5 }}>
                {dash.nextUp.sourcePlanStats.requiredCount} required source
                {dash.nextUp.sourcePlanStats.requiredCount === 1 ? '' : 's'} · ~
                {dash.nextUp.sourcePlanStats.estimatedMinutes} min intake
                {dash.nextUp.sourcePlanStats.hasExpired ? ' · verification needed' : ''}
              </div>
            )}
            {gen.isPending && !exportMd ? (
              <Loading label="Building your context…" />
            ) : (
              <>
                <div className="row gap-2">
                  <button className="btn btn-primary" disabled={!exportMd} onClick={copyContext}>
                    Copy context
                  </button>
                  <button className="btn" onClick={() => setStep('paste')}>
                    I&apos;ve started the session
                  </button>
                </div>
                {rawFallback && exportMd && (
                  <textarea
                    className="textarea mono"
                    style={{ minHeight: 160 }}
                    readOnly
                    value={exportMd}
                  />
                )}
              </>
            )}
          </div>
        </Card>
      )}

      {step === 'paste' && (
        <Card>
          <div className="col gap-3">
            <p className="muted" style={{ margin: 0 }}>
              When Claude finishes, paste its final message here.
            </p>
            <textarea
              className="textarea mono"
              style={{ minHeight: 200 }}
              placeholder="Paste Claude's final response…"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <div className="row gap-2" style={{ alignItems: 'center' }}>
              <button
                className="btn btn-primary"
                disabled={!pasted.trim() || preview.isPending}
                onClick={() => runPreview(pasted)}
              >
                {preview.isPending ? (
                  <span className="row gap-2">
                    <Spinner /> Preview
                  </span>
                ) : (
                  'Preview'
                )}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={regenerate}>
                Copy context again
              </button>
            </div>
            {preview.isError && <ErrorBox error={preview.error} />}
            <div className="card card-pad col gap-2">
              <span className="faint" style={{ fontSize: 12 }}>
                Claude didn&apos;t output the learning-os block? Copy this and send it to Claude:
              </span>
              <div className="mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                {FINALIZE_PROMPT}
              </div>
              <button
                className="btn btn-sm"
                style={{ alignSelf: 'flex-start' }}
                onClick={async () => {
                  const ok = await copyToClipboard(FINALIZE_PROMPT);
                  toast(
                    ok ? 'Copied — send it to Claude' : 'Copy failed',
                    ok ? 'success' : 'error',
                  );
                }}
              >
                Copy message
              </button>
            </div>
          </div>
        </Card>
      )}

      {step === 'review' && plan && (
        <Card title="Preview">
          <div className="col gap-3">
            <div className="stat-strip">
              <PreviewStat n={plan.reviews.length} label="reviews" />
              <PreviewStat
                n={plan.newTopics.filter((t) => !t.alreadyExists).length}
                label="new topics"
              />
              <PreviewStat n={plan.newPrompts.length} label="new cards" />
              <PreviewStat
                n={plan.applicationEvents?.length ?? 0}
                label="problems solved"
                hideWhenZero
              />
              <PreviewStat
                n={plan.activations.filter((a) => a.willActivate).length}
                label="topics activated"
              />
              <PreviewStat n={plan.noteSummaries.length} label="notes" hideWhenZero />
            </div>
            {plan.newTopics.filter((t) => !t.alreadyExists).length > 0 ? (
              <div className="col gap-1">
                <span className="faint">Proposed topics:</span>
                {plan.newTopics
                  .filter((t) => !t.alreadyExists)
                  .map((t, i) => (
                    <span key={i} className="faint" style={{ fontSize: 12 }}>
                      • {t.title}
                      {t.parentTitle ? ` — under ${t.parentTitle}` : ''}
                      {t.prerequisiteTitles.length > 0
                        ? ` (requires: ${t.prerequisiteTitles.join(', ')})`
                        : ''}
                    </span>
                  ))}
              </div>
            ) : null}
            {plan.unresolved.length > 0 ? (
              <div className="col gap-1">
                <span className="faint">Resolve these before saving:</span>
                {plan.unresolved.map((u, i) => (
                  <span key={i} className="faint" style={{ fontSize: 12 }}>
                    • {u.context}: {u.title ?? u.ref} ({u.reason})
                  </span>
                ))}
              </div>
            ) : null}
            <div className="row gap-2">
              <button
                className="btn btn-primary"
                disabled={!plan.applicable || apply.isPending}
                onClick={save}
              >
                {apply.isPending ? (
                  <span className="row gap-2">
                    <Spinner /> Save
                  </span>
                ) : (
                  'Save'
                )}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setStep('paste')}>
                Back
              </button>
            </div>
          </div>
        </Card>
      )}

      {step === 'done' && result && (
        <Card
          title={
            <span className="row gap-2" style={{ color: 'var(--st-mastered)' }}>
              ✓ Saved
            </span>
          }
          style={{ borderColor: 'var(--st-mastered)' }}
        >
          <div className="col gap-3">
            <div className="stat-strip">
              <PreviewStat n={result.reviewsApplied} label="reviews" />
              <PreviewStat n={result.topicsCreated.length} label="new topics" hideWhenZero />
              <PreviewStat n={result.promptsCreated} label="new cards" hideWhenZero />
              <PreviewStat n={result.topicsActivated} label="topics activated" hideWhenZero />
            </div>
            <div className="row gap-2">
              {mode === 'learn' && dash?.nextUp && (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    // reset and start a fresh learn session for the new next-up topic
                    setResult(null);
                    setPlan(null);
                    setPasted('');
                    setExportMd(null);
                    didInit.current = false;
                    setStep('copy');
                  }}
                >
                  Learn next: {dash.nextUp.topic.title}
                </button>
              )}
              <button className="btn" onClick={() => navigate({ to: '/' })}>
                Back to dashboard
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function PreviewStat({
  n,
  label,
  hideWhenZero,
}: {
  n: number;
  label: string;
  hideWhenZero?: boolean;
}) {
  if (hideWhenZero && n === 0) return null;
  return (
    <div className="kpi">
      <div>{n}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}
