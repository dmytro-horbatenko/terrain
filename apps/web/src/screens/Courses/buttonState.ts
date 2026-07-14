export type CourseButtonState = 'import' | 'importing' | 'added';

export function courseButtonState(
  course: { imported: boolean },
  isPending: boolean,
): CourseButtonState {
  if (isPending) return 'importing';
  return course.imported ? 'added' : 'import';
}

export type CourseDisableButtonState = 'pause' | 'pausing' | 'resume' | 'resuming';

/** `course.disabled` reflects the pre-mutation (server) state, so while a
 *  toggle is pending it still tells us which direction the toggle is going. */
export function courseDisableButtonState(
  course: { disabled: boolean },
  isPending: boolean,
): CourseDisableButtonState {
  if (isPending) return course.disabled ? 'resuming' : 'pausing';
  return course.disabled ? 'resume' : 'pause';
}
