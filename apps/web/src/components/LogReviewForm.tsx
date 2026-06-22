import { useState } from 'react';
import { useLogReview } from '../api/hooks';
import { useToast } from './Toast';
import { GradePicker } from './GradePicker';
import type { Grade } from '../api/types';

/** Reusable review logger. Used on Dashboard quick-log and inside the topic
 *  detail panel. Interval previews (per-grade) are sourced from the backend
 *  via `previewIntervals` and rendered inside `GradePicker`'s buttons. */
export function LogReviewForm({
  topic,
  onLogged,
  autoFocusNote = false,
  promptId,
  previewIntervals,
}: {
  topic: { id: string; title: string };
  onLogged?: () => void;
  autoFocusNote?: boolean;
  promptId?: string;
  previewIntervals?: Record<Grade, number>;
}) {
  const [grade, setGrade] = useState<Grade | null>(null);
  const [note, setNote] = useState('');
  const [duration, setDuration] = useState('');
  const log = useLogReview();
  const { toast } = useToast();

  function submit() {
    if (grade == null) return;
    log.mutate(
      {
        topicId: topic.id,
        promptId,
        grade,
        mode: 'app_log',
        note: note.trim() || undefined,
        durationMin: duration ? Number(duration) : undefined,
      },
      {
        onSuccess: () => {
          toast(`Logged "${topic.title}" · ${grade}`, 'success');
          setGrade(null);
          setNote('');
          setDuration('');
          onLogged?.();
        },
        onError: (e) => toast(e instanceof Error ? e.message : 'Failed to log', 'error'),
      },
    );
  }

  return (
    <div className="col gap-3">
      <GradePicker value={grade} onSelect={setGrade} previews={previewIntervals} />
      <textarea
        className="textarea"
        style={{ minHeight: 56 }}
        placeholder="Confusion note (optional)"
        value={note}
        autoFocus={autoFocusNote}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="row gap-2">
        <input
          className="input"
          style={{ width: 110 }}
          type="number"
          min={0}
          placeholder="minutes"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
        />
        <button
          className="btn btn-primary right"
          disabled={grade == null || log.isPending}
          onClick={submit}
        >
          {log.isPending ? 'Logging…' : 'Log review'}
        </button>
      </div>
    </div>
  );
}
