import { useEffect, useState, type ReactNode } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { useNextPrompt } from '../api/hooks';
import type { Grade, Prompt } from '../api/types';

const tabKeymap = keymap.of([indentWithTab]);

/** The recall-then-reveal step for one card: shows the prompt, a scratch
 *  area, and only renders `children` (the grade form) after Reveal. Used by
 *  ReviewGate (topic-scoped fetch) and ReviewSession (card-scoped fetch). */
export function PromptRecall({
  prompt,
  previewIntervals,
  children,
}: {
  prompt: Prompt;
  previewIntervals: Record<Grade, number>;
  children: (promptId?: string, previewIntervals?: Record<Grade, number>) => ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  const [scratch, setScratch] = useState('');

  useEffect(() => {
    setRevealed(false);
    setScratch('');
  }, [prompt.id]);

  return (
    <div className="col gap-3">
      <div className="card card-pad col gap-2">
        <div className="card-title" style={{ margin: 0 }}>
          Recall
        </div>
        <div>{prompt.promptText}</div>
        {!revealed && (
          <>
            {prompt.promptKind === 'code' ? (
              <CodeMirror
                value={scratch}
                onChange={setScratch}
                extensions={[tabKeymap]}
                height="160px"
                placeholder="Write the solution before revealing (not saved)"
              />
            ) : (
              <textarea
                className="textarea"
                style={{ minHeight: 56 }}
                placeholder="Try to answer before revealing (not saved)"
                value={scratch}
                onChange={(e) => setScratch(e.target.value)}
              />
            )}
            <button className="btn btn-primary right" onClick={() => setRevealed(true)}>
              Reveal
            </button>
          </>
        )}
        {revealed && prompt.answerHint && <div className="faint">{prompt.answerHint}</div>}
      </div>
      {revealed && children(prompt.id, previewIntervals)}
    </div>
  );
}

/** Gates review submission behind a recall-then-reveal step when the topic
 *  has a due/new prompt. Falls back to rendering `children` immediately when
 *  the topic has none (evidence-only review), so today's review flow is
 *  unaffected. */
export function ReviewGate({
  topic,
  children,
}: {
  topic: { id: string };
  children: (promptId?: string, previewIntervals?: Record<Grade, number>) => ReactNode;
}) {
  const { data, isLoading } = useNextPrompt(topic.id);

  if (isLoading) return null;
  if (!data) return <>{children()}</>;

  return (
    <PromptRecall prompt={data.prompt} previewIntervals={data.previewIntervals}>
      {children}
    </PromptRecall>
  );
}
