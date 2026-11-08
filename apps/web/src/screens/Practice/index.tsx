import { useState } from 'react';
import { Link, useBlocker, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  newPracticeDraft,
  parsePracticeDraft,
  practiceCheckpointSchema,
  practiceQueue,
  practiceReferenceMarkdown,
  practiceSession,
  type PracticeCheckpointInput,
  type PracticeLesson,
} from '@terrain/types';
import { api } from '../../api/client';
import { useLearningContext, usePractice, useSavePractice } from '../../api/hooks';
import { Card, ErrorBox, Loading, useToast } from '../../components';
import { SkillChecksPanel } from '../../components/SkillChecksPanel';
import './practice.css';

function download(name: string, value: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function LessonLink({ lesson }: { lesson: PracticeLesson }) {
  return (
    <Link className="practice-lesson" to="/practice/$topicId" params={{ topicId: lesson.id }}>
      <span>
        <b>{lesson.title}</b>
        <span className="muted">{lesson.chapterTitle ?? lesson.domain}</span>
      </span>
      <span className="muted">
        {lesson.latest?.checkpoint.status === 'active'
          ? 'In progress'
          : lesson.reference
            ? 'Reference saved'
            : lesson.status === 'planned'
              ? lesson.eligible
                ? 'Ready to learn'
                : 'Upcoming'
              : 'Revisit'}
      </span>
    </Link>
  );
}

function Queue({ lessons }: { lessons: PracticeLesson[] }) {
  const domains = [...new Set(lessons.map((l) => l.domain))];
  const [domain, setDomain] = useState(
    domains.find((d) => d.toLowerCase() === 'web3') ?? domains[0] ?? '',
  );
  const [search, setSearch] = useState('');
  const visible = lessons.filter((l) => l.domain === domain);
  const queue = practiceQueue(visible);
  const matches = (l: PracticeLesson) =>
    `${l.title} ${l.chapterTitle ?? ''}`.toLowerCase().includes(search.toLowerCase());
  return (
    <div className="col gap-4">
      <Card title="One implementation at a time">
        <p>
          Start with a bounded attempt, add checks, explain one failure case, then save the code
          version and next action. Existing study records stay intact.
        </p>
        <p className="muted">
          Revisit lists every studied lesson without a saved reference. Missing code is a reason to
          reconstruct it, not proof that you never learned it. New topics continue in roadmap order
          below.
        </p>
        <ol>
          <li>Attempt or resume the task.</li>
          <li>Run checks and explain the result.</li>
          <li>Save a checkpoint, even if unfinished.</li>
          <li>Use Skill checks for a later independent variation.</li>
        </ol>
        <p className="muted">
          Store implementations in your practice repository and push a backup. Terrain keeps the
          pointers and history; downloading a reference does not back up the source code.
        </p>
      </Card>
      <div className="row wrap gap-3">
        <label>
          Course{' '}
          <select className="input" value={domain} onChange={(e) => setDomain(e.target.value)}>
            {domains.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          Find a lesson{' '}
          <input
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Title or chapter"
          />
        </label>
      </div>
      <p className="muted">
        {visible.length} lessons · {visible.filter((l) => l.status !== 'planned').length} studied ·{' '}
        {queue.library.length} references · {visible.filter((l) => l.status === 'planned').length}{' '}
        not yet completed in study
      </p>
      <SkillChecksPanel overview />
      {[
        ['Continue', queue.active],
        ['Revisit studied topics', queue.recovery],
        ['Reference library', queue.library],
        ['Next lessons in roadmap order', queue.next],
      ].map(([title, entries]) => (
        <Card key={title as string} title={`${title} · ${(entries as PracticeLesson[]).length}`}>
          {(entries as PracticeLesson[]).filter(matches).map((l) => (
            <LessonLink key={l.id} lesson={l} />
          ))}
          {!(entries as PracticeLesson[]).filter(matches).length && (
            <p className="muted">No lessons in this view.</p>
          )}
        </Card>
      ))}
      <details>
        <summary>Full coverage · every lesson ({visible.length})</summary>
        <div className="col">
          {visible.filter(matches).map((l) => (
            <LessonLink key={l.id} lesson={l} />
          ))}
        </div>
      </details>
      <Link className="btn" to="/roadmap">
        Open the full roadmap
      </Link>
    </div>
  );
}

function Editor({ lesson, refresh }: { lesson: PracticeLesson; refresh: () => Promise<unknown> }) {
  const [draft, setDraft] = useState(() => newPracticeDraft(lesson, crypto.randomUUID()));
  const [dirty, setDirty] = useState(false);
  const [raw, setRaw] = useState('');
  const [proposal, setProposal] = useState<PracticeCheckpointInput | null>(null);
  const [error, setError] = useState('');
  const [importError, setImportError] = useState('');
  const [brief, setBrief] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const history = useQuery({
    queryKey: ['practice', lesson.id, 'history'],
    queryFn: () => api.getPracticeHistory(lesson.id),
    enabled: showHistory,
  });
  const context = useLearningContext(lesson.id);
  const save = useSavePractice();
  const { toast } = useToast();
  const changedElsewhere = lesson.revision !== draft.expectedRevision;
  useBlocker({
    shouldBlockFn: () =>
      (dirty || !!raw) &&
      !window.confirm(
        'This practice draft has unsaved work. Save or download it before leaving. Leave now?',
      ),
    enableBeforeUnload: dirty || !!raw,
  });

  function edit<K extends keyof PracticeCheckpointInput>(
    key: K,
    value: PracticeCheckpointInput[K],
  ) {
    setDraft((old) => ({
      ...old,
      [key]: value,
      ...(['acceptance', 'artifact', 'artifactVersion', 'command', 'result'].includes(key)
        ? { acceptanceMet: false }
        : {}),
    }));
    setDirty(true);
    setError('');
    setBrief('');
  }
  async function persist(status: PracticeCheckpointInput['status']) {
    const parsed = practiceCheckpointSchema.safeParse({ ...draft, status });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    setError('');
    try {
      await save.mutateAsync(parsed.data);
      setDraft({
        ...parsed.data,
        id: crypto.randomUUID(),
        expectedRevision: draft.expectedRevision + 1,
      });
      setDirty(false);
      setRaw('');
      setProposal(null);
      setBrief('');
      toast(
        status === 'reference' ? 'Reference saved · learner-recorded' : 'Checkpoint saved',
        'success',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Your draft is still here.');
    }
  }
  async function copySession() {
    if (!context.data || context.isError) return;
    const text = practiceSession(
      lesson,
      { ...draft, status: 'active', acceptanceMet: false },
      context.data,
    );
    setBrief(text);
    try {
      await navigator.clipboard.writeText(text);
      toast('Session brief copied', 'success');
    } catch {
      toast('Select and copy the session brief below', 'error');
    }
  }
  async function reloadSaved() {
    if (
      (dirty || raw) &&
      !window.confirm(
        'Replace this draft with the saved checkpoint? Download it first if you need to merge your changes.',
      )
    )
      return;
    const result = await api.getPractice();
    const current = result.lessons.find((l) => l.id === lesson.id);
    if (!current) throw new Error('This lesson is no longer available');
    setDraft(newPracticeDraft(current, crypto.randomUUID()));
    setDirty(false);
    setRaw('');
    setProposal(null);
    setError('');
    setBrief('');
    await refresh();
  }
  function rebuild() {
    if (
      (dirty || raw) &&
      !window.confirm('Start a fresh attempt? Download the current draft first if you need it.')
    )
      return;
    setDraft({
      ...newPracticeDraft({ ...lesson, latest: null }, crypto.randomUUID()),
      goal: draft.goal,
      acceptance: draft.acceptance,
    });
    setDirty(true);
    setRaw('');
    setProposal(null);
    setBrief('');
    setError('');
  }
  const fields: [keyof PracticeCheckpointInput, string, string][] = [
    ['goal', 'Today’s implementation goal', 'One bounded mechanism or experiment'],
    ['acceptance', 'Acceptance checks', 'Observable behavior, boundary case and failure case'],
    ['artifact', 'Code location', 'Repository and file or directory path'],
    ['artifactVersion', 'Exact code version', 'Commit hash or another immutable version'],
    ['backupUrl', 'Repository backup or commit URL', 'https://…'],
    ['command', 'Run or test command', 'The command you actually used'],
    ['result', 'Observed result', 'What passed, failed or remains unfinished'],
    [
      'reflection',
      'Your explanation / failure case',
      'Why it works; what breaks if a constraint changes',
    ],
    [
      'nextAction',
      'Next concrete action',
      'Where to resume without reconstructing the whole session',
    ],
  ];
  return (
    <div className="col gap-4">
      <Card title="Attempt → check → keep a reference">
        {lesson.status === 'planned' && (
          <p>
            This lesson is not completed in study yet. Start with guided study and its required
            sources, use the checkpoint below to keep your implementation, then import the learning
            session to record study completion.
          </p>
        )}
        <p>
          Write the core mechanism yourself. Documentation and hints are welcome; record the help
          used. A saved reference is separate from independent skill checks and topic mastery.
        </p>
        <div className="row wrap gap-2">
          <button
            className="btn btn-primary"
            disabled={
              !context.data ||
              context.isError ||
              !lesson.eligible ||
              lesson.status === 'planned' ||
              changedElsewhere ||
              save.isPending
            }
            onClick={() => void copySession()}
          >
            Copy implementation session
          </button>
          <Link
            className="btn"
            to="/session/$mode"
            params={{ mode: 'learn' }}
            search={{ topic: lesson.id }}
          >
            Open guided study & sources
          </Link>
        </div>
        {context.isPending && <p className="muted">Loading prerequisites and study context…</p>}
        {context.isError && <ErrorBox error={context.error} />}
        {!lesson.eligible && (
          <p>
            Prerequisites are unfinished. Use the roadmap to choose the next available lesson.
            Existing work can still be recorded here.
          </p>
        )}
        <details>
          <summary>Authored task and scope</summary>
          <p className="practice-pre">{lesson.scope}</p>
        </details>
        {brief && (
          <details open>
            <summary>Session brief · copy manually if needed</summary>
            <textarea
              className="input"
              aria-label="Implementation session brief"
              rows={10}
              readOnly
              value={brief}
            />
          </details>
        )}
      </Card>

      <Card title="Bring back the session result">
        <div className="col gap-3">
          <p className="muted">
            Paste the terrain-checkpoint block or your downloaded draft. Preview it before replacing
            the form. Saving remains a separate step.
          </p>
          <textarea
            className="input"
            aria-label="Practice session result"
            rows={5}
            value={raw}
            disabled={save.isPending}
            onChange={(e) => {
              setRaw(e.target.value);
              setProposal(null);
            }}
          />
          <button
            className="btn"
            disabled={!raw || save.isPending || changedElsewhere}
            onClick={() => {
              try {
                setProposal(parsePracticeDraft(raw, draft));
                setImportError('');
              } catch (e) {
                setImportError(e instanceof Error ? e.message : 'Invalid draft');
              }
            }}
          >
            Preview draft
          </button>
          {importError && <ErrorBox error={importError} />}
          {raw && (
            <button
              className="btn btn-ghost"
              onClick={() => download(`practice-result-${lesson.id}.txt`, raw, 'text/plain')}
            >
              Download pasted result
            </button>
          )}
          {proposal && (
            <>
              <pre className="practice-pre">{JSON.stringify(proposal, null, 2)}</pre>
              <button
                className="btn"
                disabled={save.isPending || changedElsewhere}
                onClick={() => {
                  setDraft(proposal);
                  setDirty(true);
                  setProposal(null);
                  setRaw('');
                  setBrief('');
                }}
              >
                Use this draft in the form
              </button>
            </>
          )}
        </div>
      </Card>

      <Card
        title={`Checkpoint · ${draft.expectedRevision ? `after revision ${draft.expectedRevision}` : 'first attempt'}`}
      >
        <div className="col gap-3">
          <p className="muted">
            Save unfinished work at any time. A reference requires a versioned artifact, checks and
            your explanation. Results are recorded by you; Terrain does not run these commands.
          </p>
          {fields.map(([key, label, placeholder]) => (
            <label className="col gap-1" key={key}>
              {label}
              <textarea
                className="input"
                rows={
                  ['goal', 'artifact', 'artifactVersion', 'backupUrl', 'command'].includes(key)
                    ? 2
                    : 3
                }
                value={draft[key] as string}
                placeholder={placeholder}
                disabled={save.isPending}
                onChange={(e) => edit(key, e.target.value)}
              />
            </label>
          ))}
          <label className="col gap-1">
            Help used
            <select
              className="input"
              value={draft.assistance}
              disabled={save.isPending}
              onChange={(e) =>
                edit('assistance', e.target.value as PracticeCheckpointInput['assistance'])
              }
            >
              <option value="unrecorded">Not recorded yet</option>
              <option value="independent">Independent attempt</option>
              <option value="hints">Hints / documentation guidance</option>
              <option value="pairing">Pairing with AI or a person</option>
              <option value="generated">Core implementation was generated</option>
            </select>
          </label>
          <label className="row gap-2">
            <input
              type="checkbox"
              checked={draft.acceptanceMet}
              disabled={save.isPending}
              onChange={(e) => edit('acceptanceMet', e.target.checked)}
            />
            I ran the acceptance checks and recorded the actual result.
          </label>
          {!draft.backupUrl && (
            <p className="muted">
              No backup is recorded. Save and push the code to your repository so this reference can
              survive a lost local folder.
            </p>
          )}
          {raw && (
            <p className="muted">
              Preview and use the pasted session result, or clear it, before saving the form.
            </p>
          )}
          {error && <ErrorBox error={error} />}
          {changedElsewhere && (
            <ErrorBox error="A newer revision is saved. Your draft has been kept. Download it, then reload and merge before saving." />
          )}
          <div className="row wrap gap-2">
            <button
              className="btn btn-primary"
              disabled={save.isPending || changedElsewhere || !!raw}
              onClick={() => void persist('active')}
            >
              Save checkpoint
            </button>
            <button
              className="btn"
              disabled={save.isPending || changedElsewhere || !!raw}
              onClick={() => void persist('reference')}
            >
              Save as reference
            </button>
            <button
              className="btn btn-ghost"
              onClick={() =>
                download(
                  `practice-${lesson.id}.json`,
                  JSON.stringify(draft, null, 2),
                  'application/json',
                )
              }
            >
              Download draft
            </button>
            <button
              className="btn btn-ghost"
              disabled={save.isPending}
              onClick={() => void reloadSaved().catch((e) => setError(e.message))}
            >
              Reload saved version
            </button>
            <button
              className="btn btn-ghost"
              disabled={save.isPending || changedElsewhere}
              onClick={rebuild}
            >
              Start a fresh attempt
            </button>
          </div>
        </div>
      </Card>

      <SkillChecksPanel
        target={{ kind: 'topic', topicId: lesson.id }}
        context={`Topic: ${lesson.title}\nAuthored scope: ${lesson.scope}\nPractice goal: ${draft.goal}\nAcceptance: ${draft.acceptance}\nChoose a changed constraint, not the same memorized solution. Do not treat a saved reference as independent competence.`}
      />

      <Card title="Saved references & history">
        {lesson.reference ? (
          <div className="col gap-2">
            <p>
              Latest reference · {new Date(lesson.reference.savedAt).toLocaleString()} ·{' '}
              {lesson.reference.checkpoint.assistance}
            </p>
            <p className="practice-pre">
              {lesson.reference.checkpoint.artifact} · {lesson.reference.checkpoint.artifactVersion}
            </p>
            {lesson.reference.checkpoint.backupUrl && (
              <a href={lesson.reference.checkpoint.backupUrl} target="_blank" rel="noreferrer">
                Open repository backup
              </a>
            )}
            <button
              className="btn"
              onClick={() =>
                download(
                  `reference-${lesson.id}.md`,
                  practiceReferenceMarkdown(lesson.title, lesson.reference!),
                )
              }
            >
              Download reference record
            </button>
          </div>
        ) : (
          <p className="muted">
            No structured reference yet. Previous topic notes and application records remain in the
            topic.
          </p>
        )}
        <button className="btn btn-ghost" onClick={() => setShowHistory(!showHistory)}>
          {showHistory ? 'Hide history' : 'Show all saved attempts'}
        </button>
        {showHistory && (
          <div className="col gap-2">
            {history.isPending && <Loading />}
            {history.isError && <ErrorBox error={history.error} />}
            {history.data?.map((saved) => (
              <details key={saved.revision}>
                <summary>
                  Revision {saved.revision} · {saved.checkpoint.status} ·{' '}
                  {new Date(saved.savedAt).toLocaleString()}
                </summary>
                <pre className="practice-pre">{practiceReferenceMarkdown(lesson.title, saved)}</pre>
                <button
                  className="btn"
                  onClick={() =>
                    download(
                      `practice-${lesson.id}-r${saved.revision}.md`,
                      practiceReferenceMarkdown(lesson.title, saved),
                    )
                  }
                >
                  Download this record
                </button>
              </details>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export default function PracticeScreen() {
  const { topicId } = useParams({ strict: false }) as { topicId?: string };
  const query = usePractice();
  if (query.isPending) return <Loading label="Loading practice…" />;
  if (query.isError)
    return (
      <div className="page">
        <ErrorBox error={query.error} />
        <button className="btn" onClick={() => void query.refetch()}>
          Retry
        </button>
      </div>
    );
  const lesson = query.data.lessons.find((l) => l.id === topicId);
  return (
    <div className="page practice-page">
      <div className="row wrap gap-2">
        <h1 className="page-title">{lesson?.title ?? 'Practice'}</h1>
      </div>
      <p className="page-sub">Build, test, explain, revisit.</p>
      {topicId ? (
        lesson ? (
          <>
            <div className="row wrap gap-2" style={{ marginBottom: 20 }}>
              <Link className="btn btn-ghost" to="/practice">
                ← Practice queue
              </Link>
              <Link className="btn btn-ghost" to="/topics/$topicId" params={{ topicId }}>
                Topic notes & evidence
              </Link>
            </div>
            <Editor key={topicId} lesson={lesson} refresh={query.refetch} />
          </>
        ) : (
          <p>
            This is not an available lesson. <Link to="/practice">Open the practice queue</Link>
          </p>
        )
      ) : (
        <Queue lessons={query.data.lessons} />
      )}
    </div>
  );
}
