import { useEffect } from 'react';
import type { Grade } from '../api/types';

export const GRADES: { grade: Grade; label: string; color: string; key: string }[] = [
  { grade: 'again', label: 'Again', color: '#dc2626', key: '1' },
  { grade: 'hard', label: 'Hard', color: '#f59e0b', key: '2' },
  { grade: 'good', label: 'Good', color: '#22c55e', key: '3' },
  { grade: 'easy', label: 'Easy', color: '#16a34a', key: '4' },
];

function previewLabel(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return '1d';
  return `${days}d`;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  return !!target.closest('.cm-editor');
}

/** Grade picker for the FSRS review flow: Again/Hard/Good/Easy, each showing
 *  the FSRS-projected next interval when `previews` is supplied. Also binds
 *  a global 1-4 keyboard shortcut while mounted, ignoring keystrokes aimed
 *  at text inputs or the CodeMirror scratch-pad. */
export function GradePicker({
  value,
  onSelect,
  previews,
}: {
  value: Grade | null;
  onSelect: (grade: Grade) => void;
  previews?: Record<Grade, number>;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      const match = GRADES.find((g) => g.key === e.key);
      if (match) onSelect(match.grade);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSelect]);

  return (
    <div className="grade-grid">
      {GRADES.map((item) => {
        const selected = value === item.grade;
        return (
          <button
            key={item.grade}
            type="button"
            className={`grade-btn${selected ? ' sel' : ''}`}
            style={
              selected
                ? {
                    borderColor: item.color,
                    background: `color-mix(in srgb, ${item.color} 14%, white)`,
                  }
                : undefined
            }
            onClick={() => onSelect(item.grade)}
          >
            <span className="grade-label" style={{ color: item.color }}>
              {item.label}
            </span>
            {previews && <span className="grade-sub">{previewLabel(previews[item.grade])}</span>}
          </button>
        );
      })}
    </div>
  );
}
