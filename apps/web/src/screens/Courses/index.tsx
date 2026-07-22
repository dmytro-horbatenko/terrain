import { useCourses, useImportCourse, useSetCourseDisabled } from '../../api/hooks';
import { Card, ErrorBox, Spinner, useToast } from '../../components';
import type { Course } from '../../api/types';
import { courseButtonState, courseDisableButtonState } from './buttonState';

function CourseCard({ course }: { course: Course }) {
  const { toast } = useToast();
  const importCourse = useImportCourse();
  const setDisabled = useSetCourseDisabled();
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
      <div className="col gap-3">
        {(courses ?? []).map((c) => (
          <CourseCard key={c.id} course={c} />
        ))}
      </div>
    </div>
  );
}
