import { useCourses, useImportCourse } from '../../api/hooks';
import { Card, ErrorBox, Spinner, useToast } from '../../components';
import type { Course } from '../../api/types';
import { courseButtonState } from './buttonState';

function CourseCard({ course }: { course: Course }) {
  const { toast } = useToast();
  const importCourse = useImportCourse();
  const isPending = importCourse.isPending && importCourse.variables === course.id;
  const state = courseButtonState(course, isPending);

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

  return (
    <Card title={course.title} actions={<span className="pill">{course.domain}</span>}>
      <p className="muted">{course.description}</p>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="muted">{course.topicCount} topics</span>
        <button
          className={state === 'added' ? 'btn btn-ghost' : 'btn btn-primary'}
          disabled={state !== 'import'}
          onClick={onImport}
        >
          {state === 'importing' && <Spinner />}
          {state === 'import' && 'Import'}
          {state === 'importing' && 'Importing…'}
          {state === 'added' && 'Added'}
        </button>
      </div>
    </Card>
  );
}

export default function CoursesScreen() {
  const { data: courses, isLoading, error } = useCourses();

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  return (
    <div className="col gap-3">
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
