import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { LearningApproach } from '@terrain/types';
import { sessionRoute } from '../../app/router';
import {
  useDashboard,
  useGenerateExport,
  useImportApply,
  useLearningContext,
  useSessionQueue,
  useStoredExport,
} from '../../api/hooks';
import { Card, ErrorBox, Loading, Spinner, useToast } from '../../components';
import type { ImportResult, PendingSession } from '../../api/types';
import { SourceIssuesPanel } from '../Import/sections';
import { useImportDraft } from '../Import/importDraft';
import { NotesHandoff } from '../Import/NotesHandoff';
import { ReviewFirst, ReviewPlan, useReviewChoice } from '../../components/ReviewChoice';
import {
  chooseInitialApproach,
  matchingPendingSession,
  needsLocalWizardReset,
  sessionQueriesReady,
} from './sessionChoice';

type Step = 'copy' | 'paste' | 'review' | 'done';

const FINALIZE_PROMPT =
  'Now output the topic notes and final learning-os block per the OUTPUT CONTRACT from the ' +
  'context I gave you at the start. Put copyable Markdown topic notes first, followed by one ' +
  'fenced ```learning-os block, echoing the sessionId. Only the last such block is imported; ' +
  'I will paste and save the longer topic notes separately.';

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
  const {
    topic,
    approach: approachOverride,
    reviewMinutes,
    reviewPromptId,
  } = sessionRoute.useSearch();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isMode = mode === 'repeat' || mode === 'learn';
  const reviewOptions = mode === 'repeat' ? { reviewMinutes, reviewPromptId } : {};
  const dashboard = useDashboard();
  const dash = dashboard.data;
  const reviewChoice = useReviewChoice(dash);
  const learningContext = useLearningContext(topic, mode === 'learn');

  const gen = useGenerateExport();
  const stored = useStoredExport();
  const apply = useImportApply();

  const [step, setStep] = useState<Step>('copy');
  const preview = useImportDraft(step === 'paste');
  const { text: pasted, setText: setPasted, plan, runPreview } = preview;
  const [exportMd, setExportMd] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<Pick<
    PendingSession,
    'id' | 'reviewPlan'
  > | null>(null);
  const [rawFallback, setRawFallback] = useState(false); // clipboard failed → show text
  const [result, setResult] = useState<ImportResult | null>(null);
  const [initialized, setInitialized] = useState(false);
  const didInit = useRef(false);

  const target = learningContext.data?.target ?? null;
  const focusTopicId = mode === 'learn' ? (target?.id ?? null) : null;
  const pendingSession =
    dash && isMode
      ? matchingPendingSession(dash.pendingSessions, mode, focusTopicId, reviewOptions)
      : undefined;
  // Resolve pending exports before requesting a new selection. A saved focused
  // session must remain resumable even if its card is no longer in the live queue.
  const customSelection = mode === 'repeat' && !!(reviewMinutes || reviewPromptId);
  const customQueue = useSessionQueue(
    reviewOptions,
    customSelection && initialized && step === 'copy' && !pendingSession && !exportMd,
  );
  const reviewQueue = customSelection ? customQueue.data : dash?.reviewQueue;
  const initialApproach = target
    ? chooseInitialApproach(approachOverride, target.approach.recommended)
    : null;
  const approachChoices: LearningApproach[] = initialApproach
    ? [initialApproach, initialApproach === 'guided' ? 'source-first' : 'guided']
    : [];
  const queriesReady = isMode
    ? sessionQueriesReady(
        mode,
        { hasData: !!dash, isFetching: dashboard.isFetching },
        {
          hasData: !!learningContext.data,
          isFetching: learningContext.isFetching,
        },
      )
    : false;

  // Initialise once the dashboard (pendingSessions) is available: resume to
  // paste if this exact session is in flight. New sessions wait for an
  // explicit review-plan or learning-approach choice.
  useEffect(() => {
    if (
      didInit.current ||
      !dash ||
      !isMode ||
      !queriesReady ||
      dashboard.error ||
      (mode === 'learn' && (!learningContext.data || learningContext.error))
    ) {
      return;
    }
    didInit.current = true;
    const pending = pendingSession;
    if (pending) {
      setActiveSession(pending);
      setStep('paste');
    } else {
      setStep('copy');
    }
    setInitialized(true);
  }, [
    dash,
    isMode,
    initialized,
    mode,
    focusTopicId,
    pendingSession,
    queriesReady,
    dashboard.error,
    learningContext.data,
    learningContext.error,
    gen,
    toast,
  ]);

  useEffect(() => {
    if (plan) setStep('review');
  }, [plan]);

  if (!isMode) {
    return <ErrorBox error={`Unknown session mode "${mode}"`} />;
  }

  const title = mode === 'repeat' ? 'Review session' : 'Learning session';

  function startLearning(approach: LearningApproach) {
    if (reviewChoice.reviewFirst) return;
    if (!target?.sessionEligible) {
      toast('This topic is not available for a learning session', 'error');
      return;
    }
    gen.mutate(
      { mode: 'learn', focusTopicId: target.id, approach },
      {
        onSuccess: (r) => {
          setActiveSession(r);
          setExportMd(r.exportMd);
        },
        onError: (e) => toast(e instanceof Error ? e.message : 'Could not build context', 'error'),
      },
    );
  }

  function startReview() {
    gen.mutate(
      { mode: 'repeat', ...reviewOptions },
      {
        onSuccess: async (r) => {
          setActiveSession(r);
          setExportMd(r.exportMd);
          const ok = await copyToClipboard(r.exportMd);
          setRawFallback(!ok);
          if (ok) setStep('paste');
          toast(
            ok ? 'Context copied — paste into a fresh chat' : 'Copy the text below',
            ok ? 'success' : 'info',
          );
        },
        onError: (e) => toast(e instanceof Error ? e.message : 'Could not build context', 'error'),
      },
    );
  }

  async function copyContext() {
    try {
      const text =
        exportMd ?? (activeSession ? (await stored.mutateAsync(activeSession.id)).exportMd : null);
      if (!text) return;
      setExportMd(text);
      const ok = await copyToClipboard(text);
      setRawFallback(!ok);
      if (ok) {
        toast('Context copied — paste into a fresh chat', 'success');
        setStep('paste');
      } else {
        toast('Clipboard unavailable — copy the text below manually', 'info');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not recover context', 'error');
    }
  }

  function save() {
    if (!plan?.applicable || preview.isPending || apply.isPending) return;
    apply.mutate(pasted, {
      onSuccess: (res) => {
        setResult(res);
        setStep('done');
      },
      onError: (e) => toast(e instanceof Error ? e.message : 'Save failed', 'error'),
    });
  }

  function resetWizard() {
    setStep('copy');
    setExportMd(null);
    setActiveSession(null);
    setRawFallback(false);
    setPasted('');
    setResult(null);
    setInitialized(false);
    didInit.current = false;
    gen.reset();
    apply.reset();
  }

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1 className="page-title">{title}</h1>

      {step === 'copy' && (
        <Card>
          <div className="col gap-3">
            <p className="muted" style={{ margin: 0 }}>
              Copy this and paste it into a fresh chat. Work through the topic or pause when you
              need to. Ask the chat to record your progress and next step, then come back and paste
              the final message.
            </p>
            {mode === 'learn' && !exportMd && target?.continuation && (
              <div className="col gap-1">
                <b>{target.continuation.resuming ? 'Resume your study' : 'Suggested first step'}</b>
                <span className="muted" style={{ whiteSpace: 'pre-wrap' }}>
                  {target.continuation.coldChallenge}
                </span>
              </div>
            )}
            {mode === 'learn' &&
              dash?.nextUp &&
              target?.id === dash.nextUp.topic.id &&
              dash.nextUp.sourcePlanStats.requiredCount > 0 && (
                <div className="faint" style={{ fontSize: 12.5 }}>
                  Source plan: {dash.nextUp.sourcePlanStats.requiredCount} source
                  {dash.nextUp.sourcePlanStats.requiredCount === 1 ? '' : 's'} · ~
                  {dash.nextUp.sourcePlanStats.estimatedMinutes} min total reading
                  {dash.nextUp.sourcePlanStats.hasExpired ? ' · catalog recheck due' : ''}
                </div>
              )}
            {dashboard.error ? (
              <ErrorBox error={dashboard.error} />
            ) : mode === 'learn' && learningContext.error ? (
              <ErrorBox error={learningContext.error} />
            ) : !initialized ? (
              <Loading
                label={
                  mode === 'learn' && !learningContext.data
                    ? 'Loading learning context…'
                    : 'Checking for an existing session…'
                }
              />
            ) : mode === 'learn' && !exportMd ? (
              !target ? (
                <ErrorBox error="No topic is available for learning." />
              ) : !target.sessionEligible ? (
                <ErrorBox error="This topic is blocked, archived, or a group." />
              ) : gen.isPending ? (
                <Loading label="Building your context…" />
              ) : reviewChoice.reviewFirst ? (
                <ReviewFirst onContinue={reviewChoice.continueToday} />
              ) : (
                <div className="col gap-3">
                  <div className="col gap-1">
                    <b>
                      Recommended:{' '}
                      {target.approach.recommended === 'guided'
                        ? 'Guided deep dive'
                        : 'Source first'}
                    </b>
                    <span className="muted">Because: {target.approach.reasons.join('; ')}</span>
                  </div>
                  <p className="muted">
                    Choose one objective and a time budget in the chat. Reading, derivation,
                    discussion, or a standalone lab can each be a session; pause and save what
                    remains at any time. Guided study uses sources as references. Source first
                    requires reading and reconstruction before teaching; valid recorded source work
                    carries forward while a topic is unfinished. Both approaches require
                    understanding and your own application before marking a topic studied.
                  </p>
                  <div className="row wrap gap-2">
                    {approachChoices.map((approach, index) => (
                      <button
                        key={approach}
                        className={index === 0 ? 'btn btn-primary' : 'btn'}
                        onClick={() => startLearning(approach)}
                      >
                        {index === 0 ? 'Start' : 'Use'}{' '}
                        {approach === 'guided' ? 'guided deep dive' : 'source first'}
                      </button>
                    ))}
                  </div>
                </div>
              )
            ) : gen.isPending && !exportMd ? (
              <Loading label="Building your context…" />
            ) : mode === 'repeat' && !exportMd && dash ? (
              <div className="col gap-3">
                {dash.reviewDay.completed && (
                  <b>Today's review commitment is complete. Extra review is optional.</b>
                )}
                {customQueue.error ? (
                  <ErrorBox error={customQueue.error} />
                ) : !reviewQueue || (customSelection && customQueue.isFetching) ? (
                  <Loading label="Selecting review cards…" />
                ) : (
                  <ReviewPlan queue={reviewQueue} />
                )}
                {!customQueue.error && !customQueue.isFetching && !!reviewQueue?.items.length && (
                  <button className="btn btn-primary" onClick={startReview}>
                    Start selected review
                  </button>
                )}
              </div>
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
            {mode === 'repeat' && activeSession?.reviewPlan && (
              <b>
                Saved review: {activeSession.reviewPlan.promptIds.length} cards · ~
                {activeSession.reviewPlan.estimatedMinutes} min
              </b>
            )}
            <p className="muted" style={{ margin: 0 }}>
              When the chat finishes, paste its final message here, including the topic notes and
              learning-os block. The import stores the compact summary; you will save the longer
              notes separately.
            </p>
            <textarea
              className="textarea mono"
              style={{ minHeight: 200 }}
              placeholder="Paste the chat's final response…"
              aria-label="Final chat response"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <div className="row gap-2" style={{ alignItems: 'center' }}>
              <button
                className="btn btn-primary"
                disabled={!pasted.trim() || preview.isPending}
                onClick={runPreview}
              >
                {preview.isPending ? (
                  <span className="row gap-2">
                    <Spinner /> Preview
                  </span>
                ) : (
                  'Preview'
                )}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={copyContext}
                disabled={stored.isPending || (!exportMd && !activeSession)}
              >
                Copy context again
              </button>
            </div>
            {rawFallback && exportMd && (
              <textarea
                aria-label="Saved session context"
                className="textarea mono"
                style={{ minHeight: 160 }}
                readOnly
                value={exportMd}
              />
            )}
            {!!preview.error && <ErrorBox error={preview.error} />}
            <div className="card card-pad col gap-2">
              <span className="faint" style={{ fontSize: 12 }}>
                The chat didn&apos;t output the learning-os block? Copy this and send it in the
                chat:
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
                    ok ? 'Copied — send it in the chat' : 'Copy failed',
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
              <PreviewStat
                n={plan.newPrompts.filter((p) => !p.duplicate).length}
                label="new cards"
              />
              <PreviewStat
                n={plan.newPrompts.filter((p) => p.duplicate).length}
                label="duplicate cards skipped"
                hideWhenZero
              />
              <PreviewStat
                n={plan.applicationEvents?.length ?? 0}
                label="problems solved"
                hideWhenZero
              />
              <PreviewStat
                n={plan.activations.filter((a) => a.willActivate).length}
                label="topics activated"
              />
              <PreviewStat n={plan.noteSummaries.length} label="summaries" hideWhenZero />
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
            <SourceIssuesPanel issues={plan.sourceIssues ?? []} />
            <div className="row gap-2">
              <button
                className="btn btn-primary"
                disabled={!plan.applicable || preview.isPending || apply.isPending}
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
              <button
                className="btn btn-ghost btn-sm"
                disabled={apply.isPending}
                onClick={() => setStep('paste')}
              >
                Back
              </button>
            </div>
          </div>
        </Card>
      )}

      {step === 'done' && result && plan && (
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
              <PreviewStat
                n={result.duplicatePromptsSkipped}
                label="duplicate cards skipped"
                hideWhenZero
              />
              <PreviewStat n={result.topicsActivated} label="topics activated" hideWhenZero />
            </div>
            <NotesHandoff plan={plan} result={result} />
            <div className="row gap-2">
              {mode === 'learn' && dash?.nextUp && (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    const nextTopic = dash.nextUp!.topic.id;
                    if (needsLocalWizardReset(topic, approachOverride, nextTopic)) {
                      resetWizard();
                      return;
                    }
                    navigate({
                      to: '/session/$mode',
                      params: { mode: 'learn' },
                      search: { topic: nextTopic },
                      replace: true,
                    });
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
