import type { SourceOption } from '@terrain/types';
import type { SourceIssue } from '../../api/types';

export function sourceIssueSummary(issues: SourceIssue[]) {
  return {
    blocking: issues.filter((issue) => issue.blocking),
    warnings: issues.filter((issue) => !issue.blocking),
  };
}

export function safeHttpUrl(value: string) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function isSourceOptionExpired(
  option: Pick<SourceOption, 'verifiedAt' | 'recheckAfterDays'>,
) {
  return !!(
    option.verifiedAt &&
    option.recheckAfterDays &&
    Date.parse(option.verifiedAt) + option.recheckAfterDays * 86_400_000 < Date.now()
  );
}
