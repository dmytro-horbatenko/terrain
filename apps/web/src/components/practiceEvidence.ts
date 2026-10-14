import type { AppEventKind, CreateAppEventInput } from '../api/types';

export const PRACTICE_ASSISTANCE = {
  independent: 'Independent work',
  documentation: 'Documentation and engineering tools',
  hints: 'Hints',
  pairing: 'Pairing',
  generated: 'Generated core code; independent validation still needed',
} as const;

export interface PracticeDraft {
  kind: AppEventKind;
  description: string;
  url: string;
  artifact: string;
  command: string;
  result: string;
  assistance: keyof typeof PRACTICE_ASSISTANCE | '';
  nextAction: string;
}

export function practiceEventInput(draft: PracticeDraft): CreateAppEventInput {
  if (!draft.description.trim()) throw new Error('Describe the work you actually performed.');
  const url = draft.url.trim();
  if (url) {
    try {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('protocol');
    } catch {
      throw new Error('Use a complete http or https link to your artifact.');
    }
  }
  const details = [
    ['Code / version', draft.artifact],
    ['Check command', draft.command],
    ['Observed result', draft.result],
    ['Help used', draft.assistance ? PRACTICE_ASSISTANCE[draft.assistance] : ''],
    ['Next step', draft.nextAction],
  ].filter(([, value]) => value.trim());
  return {
    kind: draft.kind,
    description: [
      draft.description.trim(),
      details.map(([label, value]) => `${label}: ${value.trim()}`).join('\n'),
    ]
      .filter(Boolean)
      .join('\n\n'),
    url: url || undefined,
  };
}
