import {
  useCourses,
  useImportCourse,
  useSetCourseDisabled,
  useCourseUpdatePreview,
  useApplyCourseUpdate,
} from '../../api/hooks';
import { Card, ErrorBox, Spinner, useToast } from '../../components';
import type { Course } from '../../api/types';
import { courseButtonState, courseDisableButtonState } from './buttonState';
import { Link } from '@tanstack/react-router';
import { StudyGuide } from '../../components/StudyGuide';

function CourseCard({ course }: { course: Course }) {
  const { toast } = useToast();
  const importCourse = useImportCourse();
  const setDisabled = useSetCourseDisabled();
  const preview = useCourseUpdatePreview();
  const applyUpdate = useApplyCourseUpdate();
  const isImportPending = importCourse.isPending && importCourse.variables === course.id;
  const importState = courseButtonState(course, isImportPending);
  const isTogglePending = setDisabled.isPending && setDisabled.variables?.id === course.id;
  const toggleState = courseDisableButtonState(course, isTogglePending);

  const onImport = () => {
    importCourse.mutate(course.id, {
      onSuccess: (summary) =>
        toast(
          `${course.title}: ${summary.topicsCreated} topics, ${summary.promptsCreated} cards added`,
          'success',
        ),
      onError: (e) => toast(e instanceof Error ? e.message : 'Import failed', 'error'),
    });
  };

  const onToggleDisabled = () => {
    const next = !course.disabled;
    setDisabled.mutate(
      { id: course.id, disabled: next },
      {
        onSuccess: () => toast(`${course.title} ${next ? 'paused' : 'resumed'}`, 'success'),
        onError: (e) => toast(e instanceof Error ? e.message : 'Update failed', 'error'),
      },
    );
  };

  return (
    <Card title={course.title} actions={<span className="pill">{course.domain}</span>}>
      <p className="muted">{course.description}</p>
      <div
        className="row course-actions"
        style={{ justifyContent: 'space-between', alignItems: 'center' }}
      >
        <span className="muted">{course.topicCount} topics</span>
        <div className="row gap-2">
          {course.imported && (
            <button
              className="btn btn-ghost"
              disabled={toggleState === 'pausing' || toggleState === 'resuming'}
              onClick={onToggleDisabled}
            >
              {(toggleState === 'pausing' || toggleState === 'resuming') && <Spinner />}
              {toggleState === 'pause' && 'Pause'}
              {toggleState === 'resume' && 'Resume'}
              {toggleState === 'pausing' && 'Pausing…'}
              {toggleState === 'resuming' && 'Resuming…'}
            </button>
          )}
          <button
            className={importState === 'added' ? 'btn btn-ghost' : 'btn btn-primary'}
            disabled={importState !== 'import'}
            onClick={onImport}
          >
            {importState === 'importing' && <Spinner />}
            {importState === 'import' && 'Import'}
            {importState === 'importing' && 'Importing…'}
            {importState === 'added' && 'Added'}
          </button>
        </div>
      </div>
      {course.imported && (
        <div className="col gap-2" style={{ marginTop: 16 }}>
          <button
            className="btn btn-ghost"
            disabled={preview.isPending || applyUpdate.isPending}
            onClick={() => preview.mutate(course.id)}
          >
            {preview.isPending ? 'Checking curriculum…' : 'Review curriculum updates'}
          </button>
          {preview.error && <ErrorBox error={preview.error} />}
          {preview.data && (
            <div className="col gap-2" aria-live="polite">
              <p className="muted">
                {preview.data.topicsCreated} new topics · {preview.data.topicsUpdated} updated
                topics · {preview.data.promptsCreated} new cards · {preview.data.promptsUpdated}{' '}
                updated cards. Your notes, review history, progress and custom edits are preserved.
              </p>
              {preview.data.changes.length > 0 && (
                <details>
                  <summary>See changes</summary>
                  <ul>
                    {preview.data.changes.map((change, index) => (
                      <li key={index}>
                        <b>{change.title}</b>:{' '}
                        {change.fields
                          .map(
                            (field) =>
                              ({
                                aiContext: 'study task',
                                sourcePlan: 'sources',
                                description: 'description',
                                curriculumOrder: 'study order',
                                parent: 'chapter',
                                'card promptText': 'review question',
                                'card answerHint': 'answer hint',
                                'card promptKind': 'question type',
                                'card url': 'practice link',
                                'card problemDifficulty': 'problem difficulty',
                                'card estimatedMinutes': 'review time estimate',
                              })[field] ?? field,
                          )
                          .join(', ')}
                        {change.prerequisites && (
                          <span>
                            {' '}
                            — requires {change.prerequisites.join('; ') || 'no earlier topics'}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {preview.data.preservedChanges.length > 0 && (
                <details>
                  <summary>{preview.data.preservedChanges.length} custom changes kept</summary>
                  <ul>
                    {preview.data.preservedChanges.map((change) => (
                      <li key={change}>{change}</li>
                    ))}
                  </ul>
                </details>
              )}
              {preview.data.issues.length > 0 && (
                <div role="alert">
                  <p>These issues need attention before this update can be applied:</p>
                  <ul>
                    {preview.data.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}
              {applyUpdate.error && <ErrorBox error={applyUpdate.error} />}
              {preview.data.topicsCreated +
                preview.data.topicsUpdated +
                preview.data.promptsCreated +
                preview.data.promptsUpdated >
                0 && (
                <button
                  className="btn btn-primary"
                  disabled={applyUpdate.isPending || preview.data.issues.length > 0}
                  onClick={() =>
                    applyUpdate.mutate(
                      { id: course.id, fingerprint: preview.data!.fingerprint },
                      {
                        onSuccess: () => {
                          preview.reset();
                          toast(
                            'Curriculum updated. Your learning progress is preserved.',
                            'success',
                          );
                        },
                      },
                    )
                  }
                >
                  {applyUpdate.isPending ? 'Updating…' : 'Apply reviewed update'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default function CoursesScreen() {
  const { data: courses, isLoading, error } = useCourses();

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  return (
    <div className="page col gap-3">
      <h1>Courses</h1>
      <p className="muted">
        Pre-authored curricula you can import into your own roadmap with one click.
      </p>
      <Card title="Web3 Product Engineering">
        <p className="muted">
          12 complete systems and 76 assessed milestones, from a wallet console to an independent
          capstone. Architecture, adversarial testing and operations run alongside deep topic study.
        </p>
        <Link className="btn btn-primary" to="/projects">
          Explore product curriculum
        </Link>
      </Card>
      <div className="col gap-3">
        {(courses ?? []).map((c) => (
          <CourseCard key={c.id} course={c} />
        ))}
      </div>
      <StudyGuide />
    </div>
  );
}
