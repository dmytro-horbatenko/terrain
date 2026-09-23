import { useEffect, useState } from 'react';
import { Link, useBlocker, useParams, useSearch } from '@tanstack/react-router';
import {
  parseProjectCheckpoint,
  projectSessionContext,
  skillCheckEvidence,
  skillCheckStudyContext,
  validateProjectCheckpoint,
  latestProjectCheckpoint,
  type ProductCurriculum,
  type ProductMilestone,
  type ProductProject,
  type ProjectCheckpointDraft,
  type ProjectProgress,
} from '@terrain/types';
import source from '../../../../../content/projects/web3-products.json';
import {
  useDashboard,
  useProjectProgress,
  useSaveProjectCheckpoint,
  useSkillChecks,
  useTopics,
  useMe,
} from '../../api/hooks';
import {
  Card,
  ErrorBox,
  Spinner,
  TopicDetailPanel,
  canLeaveTopicPanel,
  useToast,
} from '../../components';
import { ReviewFirst, useReviewChoice } from '../../components/ReviewChoice';
import { SkillChecksPanel } from '../../components/SkillChecksPanel';

const curriculum = source as ProductCurriculum;
const milestoneCount = curriculum.projects.reduce((sum, p) => sum + p.milestones.length, 0);
const hours = (project: ProductProject) =>
  [0, 1].map((i) => project.milestones.reduce((sum, m) => sum + m.hours[i], 0)).join('–');

function blankCheckpoint(
  project: ProductProject,
  milestone: ProductMilestone,
  progress?: ProjectProgress,
): ProjectCheckpointDraft {
  const saved = progress?.checkpoints.find((c) => c.milestoneId === milestone.id);
  return {
    id: crypto.randomUUID(),
    curriculumVersion: curriculum.version,
    projectId: project.id,
    milestoneId: milestone.id,
    expectedRevision: progress?.revision ?? 0,
    repositoryUrl: progress?.repositoryUrl ?? '',
    status: saved?.status ?? 'active',
    notes: saved?.notes ?? '',
    evidence: saved?.evidence ?? '',
    nextAction: saved?.nextAction ?? milestone.objective,
    reflection: saved?.reflection ?? '',
    assistance: saved?.assistance ?? '',
    checkedCriteria: saved?.checkedCriteria ?? [],
  };
}

function CheckpointEditor({
  project,
  milestone,
  progress,
}: {
  project: ProductProject;
  milestone: ProductMilestone;
  progress?: ProjectProgress;
}) {
  const [draft, setDraft] = useState(() => blankCheckpoint(project, milestone, progress));
  const [context, setContext] = useState('');
  const [raw, setRaw] = useState('');
  const [importError, setImportError] = useState('');
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const save = useSaveProjectCheckpoint();
  const { toast } = useToast();
  const dashboard = useDashboard();
  const review = useReviewChoice(dashboard.data);
  const skillChecks = useSkillChecks();
  const me = useMe();
  useBlocker({
    shouldBlockFn: () =>
      dirty &&
      !window.confirm(
        'This checkpoint has unsaved work. Save or download it to keep it. Leave this milestone?',
      ),
    enableBeforeUnload: dirty,
  });

  function edit<K extends keyof ProjectCheckpointDraft>(key: K, value: ProjectCheckpointDraft[K]) {
    setDraft((old) => ({ ...old, [key]: value }));
    setSaved(false);
    setDirty(true);
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast('Copied', 'success');
    } catch {
      toast('Select and copy the text below', 'error');
    }
  }

  function exportSession() {
    const next = { ...draft, status: 'active' as const };
    const recordedChecks = skillChecks.data?.checks
      .filter(
        (c) =>
          c.plan.target.kind === 'milestone' &&
          c.plan.target.projectId === project.id &&
          c.plan.target.milestoneId === milestone.id &&
          c.result,
      )
      .sort((a, b) => (b.assessedAt ?? '').localeCompare(a.assessedAt ?? ''))
      .slice(0, 3)
      .flatMap(skillCheckEvidence);
    const text =
      projectSessionContext(
        curriculum,
        project,
        milestone,
        next,
        me.data
          ? JSON.stringify(
              {
                name: me.data.name,
                headline: me.data.headline,
                learningStyle: me.data.learningStyle,
                codeStyle: me.data.codeStyle,
                noteSystem: me.data.noteSystem,
              },
              null,
              2,
            )
          : undefined,
      ) +
      '\n\n' +
      (recordedChecks
        ? skillCheckStudyContext(recordedChecks)
        : 'Skill check history unavailable. Do not infer that there were no prior attempts.');
    setContext(text);
    void copy(text);
  }

  function previewImport() {
    try {
      const value = validateProjectCheckpoint(parseProjectCheckpoint(raw), curriculum);
      if (value.projectId !== project.id || value.milestoneId !== milestone.id)
        throw new Error(
          'This output belongs to another milestone. Open that milestone to import it.',
        );
      if (value.expectedRevision !== (progress?.revision ?? 0))
        throw new Error(
          'This output predates newer saved work. Merge its useful notes into a fresh checkpoint instead.',
        );
      setDraft({ ...value, status: 'active' });
      setSaved(false);
      setDirty(true);
      setImportError('');
      toast('Draft loaded below. Review the evidence before saving.', 'success');
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Invalid project output');
    }
  }

  async function persist(status: 'active' | 'completed') {
    try {
      const value = validateProjectCheckpoint({ ...draft, status }, curriculum);
      const result = await save.mutateAsync(value);
      setSaved(true);
      setDirty(false);
      setDraft({ ...value, id: crypto.randomUUID(), expectedRevision: value.expectedRevision + 1 });
      setContext('');
      setRaw('');
      toast(
        result.alreadySaved
          ? 'Checkpoint already saved'
          : status === 'completed'
            ? 'Milestone completed · self-assessed'
            : 'Checkpoint saved',
        'success',
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not save checkpoint', 'error');
    }
  }

  function downloadDraft() {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.id}-${milestone.id}-checkpoint.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card title="Work on this milestone">
      <fieldset className="project-editor col gap-3" disabled={save.isPending}>
        <p className="muted">
          Work independently or copy the session brief into your AI chat. Save a checkpoint whenever
          you stop; a milestone can take many sessions.
        </p>
        {review.reviewFirst ? (
          <ReviewFirst onContinue={review.continueToday} />
        ) : (
          <button className="btn btn-primary" onClick={exportSession}>
            Copy AI session brief
          </button>
        )}
        {context && (
          <details open>
            <summary>Session brief · copy again</summary>
            <textarea
              className="input project-context"
              aria-label="Project session brief"
              value={context}
              readOnly
            />
            <button className="btn" onClick={() => void copy(context)}>
              Copy brief again
            </button>
          </details>
        )}
        <details>
          <summary>Bring back a project session</summary>
          <p className="muted">
            Paste the terrain-project block from your chat. Preview fills this form; saving is a
            separate step.
          </p>
          <textarea
            className="input project-context"
            aria-label="Project session output"
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setDirty(true);
            }}
          />
          <button className="btn" disabled={!raw.trim()} onClick={previewImport}>
            Preview project output
          </button>
          {importError && <ErrorBox error={importError} />}
        </details>
        <label className="col gap-1">
          Repository or demo URL
          <input
            className="input"
            type="url"
            value={draft.repositoryUrl}
            onChange={(e) => edit('repositoryUrl', e.target.value)}
            placeholder="https://…"
          />
        </label>
        <label className="col gap-1">
          Cumulative notes & architecture decisions
          <textarea
            className="input"
            rows={5}
            value={draft.notes}
            onChange={(e) => edit('notes', e.target.value)}
            placeholder="What exists, why you designed it this way, and what remains unresolved."
          />
        </label>
        <label className="col gap-1">
          Evidence & failure-drill results
          <textarea
            className="input"
            rows={5}
            value={draft.evidence}
            onChange={(e) => edit('evidence', e.target.value)}
            placeholder="Artifact paths or links, tests actually run, observed results and remaining failures."
          />
        </label>
        <label className="col gap-1">
          Independent defense & reflection
          <textarea
            className="input"
            rows={4}
            value={draft.reflection}
            onChange={(e) => edit('reflection', e.target.value)}
            placeholder="Answer the defense question in your own words. What could you explain or change without a walkthrough?"
          />
        </label>
        <label className="col gap-1">
          Help used in this milestone
          <select
            className="input"
            value={draft.assistance}
            required
            onChange={(e) =>
              edit('assistance', e.target.value as ProjectCheckpointDraft['assistance'])
            }
          >
            <option value="">Choose actual help</option>
            <option value="independent">Independent implementation</option>
            <option value="hints">Hints or review</option>
            <option value="pairing">Guided pairing</option>
            <option value="generated">Generated core code · independent validation needed</option>
          </select>
        </label>
        <label className="col gap-1">
          Next concrete action
          <textarea
            className="input"
            rows={3}
            value={draft.nextAction}
            onChange={(e) => edit('nextAction', e.target.value)}
          />
        </label>
        <fieldset className="project-checks">
          <legend>Acceptance criteria · confirm from evidence</legend>
          {milestone.criteria.map((c) => (
            <label key={c.id}>
              <input
                type="checkbox"
                checked={draft.checkedCriteria.includes(c.id)}
                onChange={(e) =>
                  edit(
                    'checkedCriteria',
                    e.target.checked
                      ? [...draft.checkedCriteria, c.id]
                      : draft.checkedCriteria.filter((id) => id !== c.id),
                  )
                }
              />
              <span>{c.text}</span>
            </label>
          ))}
        </fieldset>
        <p className="faint">
          Completion is self-assessed. It requires every criterion, evidence and a defense. Project
          progress does not change topic mastery or your study continuation.
        </p>
        {(progress?.revision ?? 0) > draft.expectedRevision && (
          <div className="col gap-2">
            <ErrorBox error="Newer progress exists. Download this draft, then load the saved checkpoint and merge your useful notes." />
            <button
              className="btn"
              onClick={() => {
                if (
                  window.confirm(
                    'Replace this form with the latest saved checkpoint? Download your draft first to keep unsaved work.',
                  )
                ) {
                  setDraft(blankCheckpoint(project, milestone, progress));
                  setContext('');
                  setRaw('');
                  setDirty(false);
                  setSaved(false);
                }
              }}
            >
              Load latest checkpoint
            </button>
          </div>
        )}
        <div className="row wrap gap-2">
          <button
            className="btn btn-primary"
            disabled={save.isPending || saved}
            onClick={() => void persist(draft.status)}
          >
            {save.isPending ? 'Saving…' : saved ? 'Saved' : 'Save checkpoint'}
          </button>
          <button
            className="btn"
            disabled={save.isPending || draft.status === 'completed'}
            onClick={() => void persist('completed')}
          >
            {draft.status === 'completed' ? 'Completed · self-assessed' : 'Complete milestone'}
          </button>
          {draft.status === 'completed' && (
            <button className="btn btn-ghost" onClick={() => edit('status', 'active')}>
              Reopen milestone
            </button>
          )}
          <button className="btn btn-ghost" onClick={downloadDraft}>
            Download draft
          </button>
        </div>
        {save.error && <ErrorBox error={save.error} />}
      </fieldset>
    </Card>
  );
}

export default function ProjectsScreen() {
  const { projectId } = useParams({ strict: false });
  const { milestone: milestoneId } = useSearch({ strict: false });
  const progressQ = useProjectProgress();
  const latestCheckpoint = latestProjectCheckpoint(progressQ.data ?? []);
  const lastProject = curriculum.projects.find((item) => item.id === latestCheckpoint?.projectId);
  const progressLoaded = progressQ.data !== undefined;
  const topicsQ = useTopics();
  const [topicId, setTopicId] = useState<string | null>(null);
  const [pinnedMilestoneId, setPinnedMilestoneId] = useState(milestoneId);
  const project = curriculum.projects.find((p) => p.id === projectId);
  const progress = progressQ.data?.find((p) => p.projectId === projectId);
  const activeMilestoneId = progress?.checkpoints.find((c) => c.status === 'active')?.milestoneId;
  const milestone =
    project?.milestones.find((m) => m.id === pinnedMilestoneId) ??
    project?.milestones.find((m) => m.id === activeMilestoneId) ??
    project?.milestones.find(
      (m) => !progress?.checkpoints.some((c) => c.milestoneId === m.id && c.status === 'completed'),
    ) ??
    project?.milestones[0];

  // Resolve resume once. A refetch from another tab must not replace an open draft.
  useEffect(() => {
    if (progressLoaded && milestone && !pinnedMilestoneId) setPinnedMilestoneId(milestone.id);
  }, [progressLoaded, milestone, pinnedMilestoneId]);

  const progressMessage = progressQ.isError ? (
    <div className="project-notice" role="status">
      {progressLoaded
        ? 'Saved progress could not refresh. Your open draft is preserved; saving may fail until the connection returns.'
        : 'Saved progress is unavailable. You can browse the full curriculum; saving and session export will return when the project service is available.'}{' '}
      <button className="btn btn-sm" onClick={() => void progressQ.refetch()}>
        Retry progress
      </button>
    </div>
  ) : progressQ.isLoading ? (
    <span className="muted">
      <Spinner /> Loading saved progress…
    </span>
  ) : null;

  if (projectId && !project)
    return (
      <div className="page col gap-3">
        <h1>Project not found</h1>
        <Link to="/projects">All projects</Link>
      </div>
    );

  if (project && milestoneId && !project.milestones.some((m) => m.id === milestoneId))
    return (
      <div className="page col gap-3">
        <h1>Milestone not found</h1>
        <Link to="/projects/$projectId" params={{ projectId: project.id }}>
          Open this project
        </Link>
      </div>
    );

  if (!project || !milestone)
    return (
      <div className="page col gap-3">
        <div className="project-hero">
          <span className="eyebrow">BUILD · EXPLAIN · DEFEND</span>
          <h1>{curriculum.title}</h1>
          <p>{curriculum.description}</p>
          <div className="row wrap gap-2">
            <span className="pill">12 complete systems</span>
            <span className="pill">{milestoneCount} assessed milestones</span>
            <span className="pill">Study and build at your own pace</span>
          </div>
        </div>
        {progressMessage}
        <div className="row wrap gap-2">
          <Link
            className="btn btn-primary"
            to="/projects/$projectId"
            params={{ projectId: lastProject?.id ?? 'wallet-console' }}
            search={lastProject ? {} : { milestone: 'w1' }}
          >
            {lastProject ? `Continue ${lastProject.title}` : 'Open wallet milestone W1'}
          </Link>
          <Link className="btn" to="/roadmap">
            Deep topic roadmap
          </Link>
        </div>
        <details className="card card-pad">
          <summary>How to combine study, building and review</summary>
          <div className="project-table-wrap">
            <table className="project-table">
              <thead>
                <tr>
                  <th>Weekly activity</th>
                  <th>Hours</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                {curriculum.weeklyPlan.map((row) => (
                  <tr key={row.activity}>
                    <td>{row.activity}</td>
                    <td>{row.hours}</td>
                    <td>{row.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul>
            {curriculum.assessment.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </details>
        <div className="project-grid">
          {curriculum.projects.map((p) => {
            const state = progressQ.data?.find((s) => s.projectId === p.id);
            const completed =
              state?.checkpoints.filter((c) => c.status === 'completed').length ?? 0;
            return (
              <Card key={p.id} className="project-card">
                <span className="eyebrow">{p.stage}</span>
                <h2>{p.title}</h2>
                <p className="muted">{p.brief}</p>
                <ul>
                  {p.outcomes.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
                <div className="row wrap gap-2">
                  <span className="pill">{p.milestones.length} milestones</span>
                  <span className="pill">~{hours(p)} build hours</span>
                </div>
                <p className="faint">
                  {progressQ.isSuccess
                    ? `${completed}/${p.milestones.length} completed · ${state ? 'checkpoint saved' : 'not started'}`
                    : 'Progress not loaded'}
                </p>
                <Link className="btn" to="/projects/$projectId" params={{ projectId: p.id }}>
                  {state ? 'Resume project' : 'Explore milestones'}
                </Link>
              </Card>
            );
          })}
        </div>
      </div>
    );

  const saved = progress?.checkpoints.find((c) => c.milestoneId === milestone.id);
  return (
    <div className="page col gap-3">
      <Link to="/projects">← All product projects</Link>
      <div className="project-hero">
        <span className="eyebrow">{project.stage}</span>
        <h1>{project.title}</h1>
        <p>{project.brief}</p>
        <div className="row wrap gap-2">
          <span className="pill">{project.milestones.length} milestones</span>
          <span className="pill">~{hours(project)} build hours · planning estimate</span>
        </div>
      </div>
      {progressMessage}
      <details className="card card-pad">
        <summary>Readiness, scope & primary references</summary>
        <p>{project.readiness}</p>
        <p>{project.scope}</p>
        <p className="muted">
          Suggested experience, not a lock:{' '}
          {project.prerequisites.length
            ? project.prerequisites
                .map((id) => curriculum.projects.find((p) => p.id === id)?.title)
                .join('; ')
            : 'Start here with your existing React/TypeScript experience.'}
        </p>
        <ul>
          {project.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.title}
              </a>{' '}
              — {s.scope}
            </li>
          ))}
        </ul>
        <p className="faint">
          Check current versions when beginning the milestone. Estimates cover building; deep topic
          study and reviews have their own time budget.
        </p>
      </details>
      <div className="project-workspace">
        <nav className="project-milestones" aria-label="Project milestones">
          {project.milestones.map((m) => {
            const checkpoint = progress?.checkpoints.find((c) => c.milestoneId === m.id);
            return (
              <Link
                key={m.id}
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                search={{ milestone: m.id }}
                className={`project-milestone${m.id === milestone.id ? ' selected' : ''}`}
                aria-current={m.id === milestone.id ? 'step' : undefined}
              >
                <b>{m.title}</b>
                <span>
                  {m.hours.join('–')}h ·{' '}
                  {progressQ.isSuccess
                    ? checkpoint?.status === 'completed'
                      ? 'Completed · self-assessed'
                      : checkpoint
                        ? 'In progress'
                        : 'Not started'
                    : 'Progress unavailable'}
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="col gap-3">
          <Card title={milestone.title}>
            <div className="col gap-2">
              <p>{milestone.objective}</p>
              <b>Deliverables</b>
              <ul>
                {milestone.deliverables.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
              <b>Acceptance criteria</b>
              <ul>
                {milestone.criteria.map((c) => (
                  <li key={c.id}>{c.text}</li>
                ))}
              </ul>
              <div className="project-prompt">
                <b>Architecture decision</b>
                <p>{milestone.designQuestion}</p>
              </div>
              <div className="project-prompt">
                <b>Failure drill</b>
                <p>{milestone.failureDrill}</p>
              </div>
              <div className="project-prompt">
                <b>Independent defense</b>
                <p>{milestone.defense}</p>
              </div>
              <b>Related deep study</b>
              <p className="muted">
                Open a topic to study it separately. Project completion never substitutes for topic
                assessment.
              </p>
              <div className="row wrap gap-2">
                {milestone.topicTitles.map((title) => {
                  const topic = topicsQ.data?.find(
                    (t) =>
                      t.title.toLowerCase() === title.toLowerCase() &&
                      t.domain.toLowerCase() === 'web3',
                  );
                  return topic ? (
                    <button
                      className="btn btn-sm"
                      key={title}
                      onClick={() => {
                        if (topicId === topic.id || canLeaveTopicPanel()) setTopicId(topic.id);
                      }}
                    >
                      {title}
                    </button>
                  ) : (
                    <span className="pill" key={title}>
                      {title}
                    </span>
                  );
                })}
              </div>
              {topicsQ.isError && (
                <p className="muted">
                  Topic links could not load. The reading titles are shown above.
                </p>
              )}
            </div>
          </Card>
          {saved && (
            <div className="project-notice">
              Saved {new Date(saved.createdAt).toLocaleString()} ·{' '}
              {saved.status === 'completed'
                ? 'Completed · self-assessed'
                : `Next: ${saved.nextAction}`}
            </div>
          )}
          {progressLoaded && (
            <CheckpointEditor
              key={`${project.id}/${milestone.id}`}
              project={project}
              milestone={milestone}
              progress={progress}
            />
          )}
          <SkillChecksPanel
            key={`check/${project.id}/${milestone.id}`}
            target={{ kind: 'milestone', projectId: project.id, milestoneId: milestone.id }}
            context={`Objective: ${milestone.objective}\nFailure drill: ${milestone.failureDrill}\nArchitecture: ${milestone.designQuestion}\nDefense: ${milestone.defense}`}
          />
        </div>
      </div>
      {topicId && <TopicDetailPanel topicId={topicId} onClose={() => setTopicId(null)} />}
    </div>
  );
}
