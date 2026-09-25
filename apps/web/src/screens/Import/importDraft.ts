import { useCallback, useEffect, useReducer, useRef } from 'react';
import { extractLearningOsBlock } from '@terrain/types';
import { useImportPreview } from '../../api/hooks';
import type { ImportPlan } from '../../api/types';

export type ImportDraft = {
  text: string;
  attempted: boolean;
  requestId: number | null;
  plan: ImportPlan | null;
  error: unknown;
};
type Action =
  | { type: 'change'; text: string }
  | { type: 'preview'; requestId: number; text: string }
  | { type: 'success'; requestId: number; plan: ImportPlan }
  | { type: 'error'; requestId: number; error: unknown };

export const emptyImportDraft: ImportDraft = {
  text: '',
  attempted: false,
  requestId: null,
  plan: null,
  error: null,
};

export function hasImportContent(text: string): boolean {
  return extractLearningOsBlock(text) !== null || text.trimStart().startsWith('{');
}

export function importDraftReducer(state: ImportDraft, action: Action): ImportDraft {
  switch (action.type) {
    case 'change':
      return { ...emptyImportDraft, text: action.text };
    case 'preview':
      return state.text === action.text
        ? { ...state, attempted: true, requestId: action.requestId, plan: null, error: null }
        : state;
    case 'success':
      return state.requestId === action.requestId
        ? { ...state, requestId: null, plan: action.plan }
        : state;
    case 'error':
      return state.requestId === action.requestId
        ? { ...state, requestId: null, error: action.error }
        : state;
  }
}

export function useImportDraft(autoPreview = true) {
  const [draft, dispatch] = useReducer(importDraftReducer, emptyImportDraft);
  const { mutateAsync } = useImportPreview();
  const nextRequestId = useRef(0);
  const setText = useCallback((text: string) => dispatch({ type: 'change', text }), []);
  const runPreview = useCallback(() => {
    const requestId = ++nextRequestId.current;
    dispatch({ type: 'preview', requestId, text: draft.text });
    void mutateAsync(draft.text).then(
      (plan) => dispatch({ type: 'success', requestId, plan }),
      (error) => dispatch({ type: 'error', requestId, error }),
    );
  }, [draft.text, mutateAsync]);

  useEffect(() => {
    if (!autoPreview || draft.attempted || !hasImportContent(draft.text)) return;
    const timer = setTimeout(runPreview, 600);
    return () => clearTimeout(timer);
  }, [autoPreview, draft.attempted, draft.text, runPreview]);

  return { ...draft, setText, runPreview, isPending: draft.requestId !== null };
}
