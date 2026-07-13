export type CourseButtonState = 'import' | 'importing' | 'added';

export function courseButtonState(
  course: { imported: boolean },
  isPending: boolean,
): CourseButtonState {
  if (isPending) return 'importing';
  return course.imported ? 'added' : 'import';
}
