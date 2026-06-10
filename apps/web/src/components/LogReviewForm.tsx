import { useState } from 'react';
import { useLogReview } from '../api/hooks';
import { useToast } from './Toast';
import { QualityPicker } from './QualityPicker';
import { previewReview } from '../lib/sr';
import { formatDate } from '../lib/format';
import type { SrBearing } from '../lib/sr';

type SrTopic = SrBearing & { id: string; title: string };

/** Reusable review logger with a live SM-2 projection. Used on Dashboard
 *  quick-log and inside the topic detail panel. */
export function LogReviewForm({
  topic,
  onLogged,
  autoFocusNote = false,
  promptId,
}: {
  topic: SrTopic;
  onLogged?: () => void;
  autoFocusNote?: boolean;
  promptId?: string;
}) {
  const [quality, setQuality] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [duration, setDuration] = useState('');
  const log = useLogReview();
  const { toast } = useToast();

  const preview = quality != null ? previewReview(topic, quality) : null;

  function submit() {
    if (quality == null) return;
    log.mutate(
      {
        topicId: topic.id,
        promptId,
        quality,
        mode: 'app_log',
        note: note.trim() || undefined,
        durationMin: duration ? Number(duration) : undefined,
      },
      {
        onSuccess: () => {
          toast(`Logged "${topic.title}" · q${quality}`, 'success');
          setQuality(null);
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
      <QualityPicker value={quality} onChange={setQuality} />
      {preview && (
        <div className="sr-preview">
          interval{' '}
          <b>
            {topic.interval}d → {preview.interval}d
          </b>{' '}
          · next review <b>{formatDate(preview.nextReviewAt?.toISOString())}</b>
        </div>
      )}
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
          disabled={quality == null || log.isPending}
          onClick={submit}
        >
          {log.isPending ? 'Logging…' : 'Log review'}
        </button>
      </div>
    </div>
  );
}
