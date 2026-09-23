import { useEffect, useState } from 'react';
import { useBlocker } from '@tanstack/react-router';
import {
  independentSkillAttempt,
  skillCheckFeedbackContext,
  skillCheckPlanSchema,
  skillCheckAttemptSchema,
  skillCheckResultSchema,
  parseSkillCheckProposal,
  type SkillCheck,
  type SkillCheckPlan,
  type SkillCheckTarget,
} from '@terrain/types';
import { useSaveSkillCheck, useSkillChecks } from '../api/hooks';
import { Card } from './Card';
import { ErrorBox } from './Feedback';

function nextWeek(day: string) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
}

function useDraftGuard() {
  const [dirty, setDirty] = useState(false);
  useBlocker({
    shouldBlockFn: () =>
      dirty &&
      !window.confirm(
        'This skill check has unsaved work. Save or download the draft before leaving. Leave anyway?',
      ),
    enableBeforeUnload: dirty,
  });
  return [dirty, setDirty] as const;
}

function download(value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'terrain-skill-check-draft.json';
  link.click();
  URL.revokeObjectURL(url);
}

function NewSkillCheck({
  target,
  today,
  context,
  prior,
}: {
  target: SkillCheckTarget;
  today: string;
  context?: string;
  prior?: SkillCheck;
}) {
  const [plan, setPlan] = useState<SkillCheckPlan>(() => ({
    id: crypto.randomUUID(),
    target,
    kind: prior?.plan.kind ?? 'diagnosis',
    learnedOn: today,
    dueOn: nextWeek(today),
    task: '',
    successCriteria: '',
    allowedTools: prior?.plan.allowedTools ?? 'documentation',
  }));
  const [saved, setSaved] = useState(false);
  const [proposal, setProposal] = useState('');
  const [error, setError] = useState('');
  const save = useSaveSkillCheck();
  const [dirty, setDirty] = useDraftGuard();
  function edit<K extends keyof SkillCheckPlan>(key: K, value: SkillCheckPlan[K]) {
    setPlan((old) => ({ ...old, [key]: value }));
    setDirty(true);
  }
  async function submit() {
    try {
      const input = skillCheckPlanSchema.parse(plan);
      await save.mutateAsync({ action: 'schedule', plan: input });
      setDirty(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not schedule check');
    }
  }
  if (saved)
    return (
      <div className="col gap-2">
        <p role="status">Check scheduled for {plan.dueOn}. No skill result has been recorded.</p>
        <button
          className="btn"
          onClick={() => {
            setPlan({ ...plan, id: crypto.randomUUID(), task: '', successCriteria: '' });
            setProposal('');
            setError('');
            setSaved(false);
          }}
        >
          Plan another check
        </button>
      </div>
    );
  return (
    <form
      data-skill-dirty={dirty || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset className="skill-check-fields col gap-3" disabled={save.isPending}>
        <p className="muted">
          Choose one changed case of a mechanism you already practiced. Reserve 20–30 minutes within
          your weekly study time. Seven days is a starting suggestion.
        </p>
        <details>
          <summary>Use a tutor's practice suggestion</summary>
          <label className="col gap-1">
            Practice suggestion
            <textarea
              className="input"
              rows={4}
              maxLength={20000}
              value={proposal}
              onChange={(e) => {
                setProposal(e.target.value);
                setDirty(true);
              }}
              placeholder="Paste the tutor's terrain-practice block here."
            />
          </label>
          <button
            className="btn"
            type="button"
            disabled={!proposal.trim()}
            onClick={() => {
              try {
                const suggestion = parseSkillCheckProposal(proposal);
                if (
                  (plan.task || plan.successCriteria) &&
                  !window.confirm('Replace the task and criteria in this unsaved plan?')
                )
                  return;
                setPlan({ ...plan, ...suggestion });
                setDirty(true);
                setError('');
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Invalid practice suggestion');
              }
            }}
          >
            Fill plan from suggestion
          </button>
          <p className="faint">
            Review the task and dates below, then schedule it. Filling the form saves no learning
            result.
          </p>
        </details>
        {context && (
          <details>
            <summary>Practice context for choosing a fresh case</summary>
            <p className="skill-check-text">{context}</p>
          </details>
        )}
        {prior && (
          <p className="muted">
            Previous task: {prior.plan.task}
            <br />
            Choose a different case. Correct the exposed gap before the next check; set the original
            practice date to that work.
          </p>
        )}
        <label className="col gap-1">
          Exercise type
          <select
            className="input"
            value={plan.kind}
            onChange={(e) => edit('kind', e.target.value as SkillCheckPlan['kind'])}
          >
            <option value="diagnosis">Debug unfamiliar code</option>
            <option value="adaptation">Adapt a design to a changed constraint</option>
            <option value="comparison">Choose between confusable mechanisms</option>
            <option value="explanation">Explain and predict a changed case</option>
          </select>
        </label>
        <div className="row wrap gap-3">
          <label className="col gap-1">
            Original practice date
            <input
              className="input"
              type="date"
              required
              max={today}
              value={plan.learnedOn}
              onChange={(e) => edit('learnedOn', e.target.value)}
            />
          </label>
          <label className="col gap-1">
            Check date
            <input
              className="input"
              type="date"
              required
              min={today}
              value={plan.dueOn}
              onChange={(e) => edit('dueOn', e.target.value)}
            />
          </label>
        </div>
        <label className="col gap-1">
          Changed task
          <textarea
            className="input"
            rows={4}
            required
            minLength={20}
            maxLength={6000}
            value={plan.task}
            onChange={(e) => edit('task', e.target.value)}
            placeholder="Specify the unfamiliar inputs, failure or constraint. Include a code/artifact reference when needed. Do not include the solution."
          />
        </label>
        <label className="col gap-1">
          Observable success criteria
          <textarea
            className="input"
            rows={3}
            required
            minLength={20}
            maxLength={4000}
            value={plan.successCriteria}
            onChange={(e) => edit('successCriteria', e.target.value)}
            placeholder="What must the attempt demonstrate? For debugging: explain the cause, support it with observations, and verify a regression case."
          />
        </label>
        <label className="col gap-1">
          Allowed tools
          <select
            className="input"
            value={plan.allowedTools}
            onChange={(e) => edit('allowedTools', e.target.value as SkillCheckPlan['allowedTools'])}
          >
            <option value="documentation">
              Documentation + engineering tools, no solution assistance
            </option>
            <option value="closed_book">Closed-book reasoning, no references or assistance</option>
          </select>
        </label>
        <p className="faint">
          Scheduling preserves the task and criteria. Cancel an unattempted check and create a
          replacement to change its task or date.
        </p>
        {error && <ErrorBox error={error} />}
        <div className="row wrap gap-2">
          <button className="btn btn-primary" type="submit">
            {save.isPending ? 'Scheduling…' : 'Schedule skill check'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => download(plan)}>
            Download draft
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function SkillCheckItem({ check, today }: { check: SkillCheck; today: string }) {
  const [firstAttempt, setFirstAttempt] = useState('');
  const [evidence, setEvidence] = useState('');
  const [assistance, setAssistance] = useState('');
  const [helpDetails, setHelpDetails] = useState('');
  const [outcome, setOutcome] = useState('');
  const [feedback, setFeedback] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [error, setError] = useState('');
  const [copyText, setCopyText] = useState('');
  const [replacement, setReplacement] = useState(false);
  // Keep an acknowledged save visible even if the following query refresh fails.
  const [acknowledgedAttempt, setAcknowledgedAttempt] = useState<SkillCheck['attempt']>(null);
  const [acknowledgedResult, setAcknowledgedResult] = useState<SkillCheck['result']>(null);
  const [cancelled, setCancelled] = useState(false);
  const [baseline, setBaseline] = useState(check);
  const save = useSaveSkillCheck();
  const [dirty, setDirty] = useDraftGuard();
  useEffect(() => {
    if (!dirty) setBaseline(check);
  }, [check, dirty]);
  const current = {
    ...baseline,
    attempt: baseline.attempt ?? acknowledgedAttempt,
    result: baseline.result ?? acknowledgedResult,
  };
  const due = check.plan.dueOn <= today;
  const isCancelled = !!baseline.cancelledAt || cancelled;
  const changedElsewhere =
    dirty &&
    (baseline.attemptedAt !== check.attemptedAt ||
      baseline.assessedAt !== check.assessedAt ||
      baseline.cancelledAt !== check.cancelledAt);
  const status = isCancelled
    ? 'Cancelled'
    : current.result
      ? current.result.outcome === 'passed'
        ? 'Passed · recorded assessment'
        : 'Needs practice'
      : current.attempt
        ? 'Awaiting feedback'
        : due
          ? 'Due · no attempt yet'
          : 'Scheduled';
  const independent = current.attempt && independentSkillAttempt(check.plan, current.attempt);

  async function submit() {
    setError('');
    try {
      if (!current.attempt) {
        const attempt = skillCheckAttemptSchema.parse({
          firstAttempt,
          evidence,
          assistance,
          helpDetails,
        });
        await save.mutateAsync({ action: 'attempt', id: check.plan.id, attempt });
        setAcknowledgedAttempt(attempt);
      } else {
        const result = skillCheckResultSchema.parse({ outcome, feedback, nextAction, reviewer });
        await save.mutateAsync({ action: 'result', id: check.plan.id, result });
        setAcknowledgedResult(result);
      }
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    }
  }
  async function cancel() {
    if (
      !window.confirm(
        'Cancel this unattempted check? Download any unsaved attempt first to keep it. You can schedule a replacement.',
      )
    )
      return;
    try {
      await save.mutateAsync({ action: 'cancel', id: check.plan.id });
      setCancelled(true);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel');
    }
  }
  async function copyFeedback() {
    const text = skillCheckFeedbackContext(current);
    setCopyText(text);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* Selectable text below remains available. */
    }
  }
  return (
    <details className="skill-check-item">
      <summary>
        <b>{check.targetTitle}</b>
        <span className="muted">
          {status} · {check.plan.dueOn}
        </span>
      </summary>
      <div className="col gap-3">
        {changedElsewhere && (
          <div className="col gap-2">
            <ErrorBox error="This check changed elsewhere. Your draft is preserved; download it before loading the saved version." />
            <button
              className="btn"
              onClick={() => {
                if (
                  window.confirm(
                    'Replace this form with the saved version? Download your draft first.',
                  )
                ) {
                  setDirty(false);
                  setBaseline(check);
                  setFirstAttempt('');
                  setEvidence('');
                  setAssistance('');
                  setHelpDetails('');
                  setOutcome('');
                  setFeedback('');
                  setNextAction('');
                  setReviewer('');
                  setError('');
                }
              }}
            >
              Load saved version
            </button>
          </div>
        )}
        <p className="skill-check-text">{check.plan.task}</p>
        <p className="skill-check-text">
          <b>Success criteria:</b> {check.plan.successCriteria}
        </p>
        <p className="faint">
          Original practice: {check.plan.learnedOn} ·{' '}
          {check.plan.allowedTools === 'documentation'
            ? 'Documentation and engineering tools allowed; no hints or supplied solution.'
            : 'Closed-book; no references or assistance.'}
        </p>
        {current.attempt && (
          <div className="col gap-2">
            <b>
              Saved first attempt
              {check.attemptedAt ? ` · ${new Date(check.attemptedAt).toLocaleString()}` : ''}
            </b>
            <p className="skill-check-text">{current.attempt.firstAttempt}</p>
            <p className="skill-check-text">Observed evidence: {current.attempt.evidence}</p>
            <p className="skill-check-text">
              Help: {current.attempt.assistance} — {current.attempt.helpDetails}
            </p>
          </div>
        )}
        {current.result ? (
          <div className="col gap-2">
            <b>
              {status} · {current.result.reviewer} feedback
            </b>
            <p className="skill-check-text">{current.result.feedback}</p>
            <p className="skill-check-text">Next: {current.result.nextAction}</p>
            <p className="faint">
              You recorded this assessment against the stated criteria. Terrain has not
              independently verified it.
            </p>
          </div>
        ) : (
          !isCancelled && (
            <form
              data-skill-dirty={dirty || undefined}
              onInput={() => setDirty(true)}
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <fieldset className="skill-check-fields col gap-3" disabled={save.isPending}>
                {!current.attempt ? (
                  <>
                    <p className="muted">
                      Attempt this case before asking for feedback. Save what you tried even if it
                      failed. The saved first attempt cannot be rewritten.
                    </p>
                    {!due && (
                      <p>
                        Available on {check.plan.dueOn}. Ordinary study and project work remain
                        available.
                      </p>
                    )}
                    <label className="col gap-1">
                      First attempt · reasoning and work
                      <textarea
                        className="input"
                        rows={5}
                        required
                        minLength={20}
                        maxLength={12000}
                        value={firstAttempt}
                        onChange={(e) => setFirstAttempt(e.target.value)}
                      />
                    </label>
                    <label className="col gap-1">
                      Observed result and artifact reference
                      <textarea
                        className="input"
                        rows={3}
                        required
                        minLength={10}
                        maxLength={8000}
                        value={evidence}
                        onChange={(e) => setEvidence(e.target.value)}
                        placeholder="Actual observations, tests and results, including failures. Say when nothing was executed."
                      />
                    </label>
                    <label className="col gap-1">
                      Help used before saving this attempt
                      <select
                        className="input"
                        required
                        value={assistance}
                        onChange={(e) => setAssistance(e.target.value)}
                      >
                        <option value="">Select actual help</option>
                        <option value="none">No references or assistance</option>
                        <option value="documentation">
                          Documentation / engineering tools only
                        </option>
                        <option value="hints">Hints, review or guided pairing</option>
                        <option value="solution">Supplied solution or generated core code</option>
                      </select>
                    </label>
                    <label className="col gap-1">
                      Help details
                      <textarea
                        className="input"
                        rows={2}
                        required
                        maxLength={2000}
                        value={helpDetails}
                        onChange={(e) => setHelpDetails(e.target.value)}
                        placeholder="Name references and help received, or write None."
                      />
                    </label>
                    <button className="btn btn-primary" type="submit" disabled={!due}>
                      Save first attempt
                    </button>
                    <button className="btn btn-ghost" type="button" onClick={() => void cancel()}>
                      Cancel unattempted check
                    </button>
                  </>
                ) : (
                  <>
                    <p className="muted">
                      Assess the saved attempt against its criteria. Record uncertainty and
                      corrections here. Later feedback does not alter the help recorded for the
                      original attempt.
                    </p>
                    {!independent && (
                      <p className="muted">
                        The attempt used help beyond the allowed tools. Record needs practice, then
                        schedule a fresh independent case.
                      </p>
                    )}
                    <button className="btn" type="button" onClick={() => void copyFeedback()}>
                      Copy saved attempt for feedback
                    </button>
                    {copyText && (
                      <textarea
                        className="input"
                        rows={5}
                        readOnly
                        aria-label="Skill check feedback brief"
                        value={copyText}
                      />
                    )}
                    <label className="col gap-1">
                      Result
                      <select
                        className="input"
                        required
                        value={outcome}
                        onChange={(e) => setOutcome(e.target.value)}
                      >
                        <option value="">Choose after checking the criteria</option>
                        <option value="needs_practice">
                          Needs practice / evidence insufficient
                        </option>
                        <option value="passed" disabled={!independent}>
                          Passed this check
                        </option>
                      </select>
                    </label>
                    <label className="col gap-1">
                      Feedback source
                      <select
                        className="input"
                        required
                        value={reviewer}
                        onChange={(e) => setReviewer(e.target.value)}
                      >
                        <option value="">Select who reviewed it</option>
                        <option value="self">My own assessment</option>
                        <option value="ai">AI feedback</option>
                        <option value="human">Another engineer</option>
                      </select>
                    </label>
                    <label className="col gap-1">
                      Feedback against the criteria
                      <textarea
                        className="input"
                        rows={4}
                        required
                        minLength={20}
                        maxLength={6000}
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        placeholder="What was demonstrated? What failed or remains uncertain? Include actual reviewer feedback and later corrections."
                      />
                    </label>
                    <label className="col gap-1">
                      Next bounded action
                      <textarea
                        className="input"
                        rows={2}
                        required
                        minLength={10}
                        maxLength={2000}
                        value={nextAction}
                        onChange={(e) => setNextAction(e.target.value)}
                      />
                    </label>
                    <button className="btn btn-primary" type="submit">
                      Save assessment
                    </button>
                  </>
                )}
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() =>
                    download({
                      plan: check.plan,
                      firstAttempt,
                      evidence,
                      assistance,
                      helpDetails,
                      outcome,
                      feedback,
                      nextAction,
                      reviewer,
                    })
                  }
                >
                  Download draft
                </button>
              </fieldset>
            </form>
          )
        )}
        {error && <ErrorBox error={error} />}
        {(current.result || isCancelled) && (
          <>
            <button className="btn" type="button" onClick={() => setReplacement(true)}>
              Plan a fresh variant
            </button>
            {replacement && (
              <NewSkillCheck target={check.plan.target} today={today} prior={current} />
            )}
          </>
        )}
      </div>
    </details>
  );
}

export function SkillChecksPanel({
  target,
  context,
}: {
  target?: SkillCheckTarget;
  context?: string;
}) {
  const query = useSkillChecks();
  const [planning, setPlanning] = useState(false);
  const data = query.data;
  const checks =
    data?.checks.filter(
      (c) =>
        !target ||
        (target.kind === 'topic'
          ? c.plan.target.kind === 'topic' && c.plan.target.topicId === target.topicId
          : c.plan.target.kind === 'milestone' &&
            c.plan.target.projectId === target.projectId &&
            c.plan.target.milestoneId === target.milestoneId),
    ) ?? [];
  const pending = checks.filter((c) => !c.result && !c.cancelledAt);
  const dueCount = pending.filter((c) => c.attempt || c.plan.dueOn <= (data?.today ?? '')).length;
  return (
    <Card title="Skill checks · apply it again later">
      <div className="col gap-3">
        <p className="muted">
          Delayed practice for topics and product milestones. Save a first attempt before feedback.
          Results stay separate from delivery completion and topic mastery.
        </p>
        {query.isError && (
          <div>
            <ErrorBox error="Skill checks could not load or refresh. Your open draft is preserved." />
            <button className="btn btn-sm" onClick={() => void query.refetch()}>
              Retry skill checks
            </button>
          </div>
        )}
        {!data ? (
          !query.isError && <p>Loading skill checks…</p>
        ) : (
          <>
            <p className="faint">
              {dueCount} ready or awaiting feedback · {pending.length} pending · dates in{' '}
              {data.timezone}. Keep this inside your weekly practice block.
            </p>
            {!pending.length && (
              <p className="muted">
                No pending checks.{' '}
                {target
                  ? 'After focused practice, schedule one changed case here.'
                  : 'Open a topic or project milestone to schedule one.'}
              </p>
            )}
            {checks.map((check) => (
              <SkillCheckItem key={check.plan.id} check={check} today={data.today} />
            ))}
            {target && (
              <>
                <button className="btn" onClick={() => setPlanning(true)}>
                  Plan a delayed skill check
                </button>
                {planning && <NewSkillCheck target={target} today={data.today} context={context} />}
              </>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
