import type { HeatmapCell } from '../api/types';

// Classic GitHub-contribution palette: index 0 = no activity.
const PALETTE = ['var(--hm-empty, #ebedf0)', '#9be9a8', '#40c463', '#30a14e', '#216e39'];

function level(count: number, max: number): number {
  if (count <= 0) return 0;
  if (max <= 1) return 4;
  const r = count / max;
  if (r > 0.66) return 4;
  if (r > 0.33) return 3;
  return r > 0 ? 2 : 1;
}

/**
 * Activity heatmap — a dense reviews-per-day calendar over the trailing window.
 * `cells` is the dense, oldest-first series from GET /metrics/heatmap; columns
 * are weeks (Mon→Sun rows).
 */
export function Heatmap({ cells }: { cells: HeatmapCell[] }) {
  if (cells.length === 0) return <span className="faint">No review history yet.</span>;

  const max = cells.reduce((m, c) => Math.max(m, c.count), 0);
  const total = cells.reduce((sum, c) => sum + c.count, 0);

  // Pad leading blanks so the first cell lands on its weekday (week starts Mon).
  const first = new Date(cells[0].date + 'T00:00:00');
  const lead = (first.getDay() + 6) % 7; // Mon=0 … Sun=6
  const padded: (HeatmapCell | null)[] = [...Array<null>(lead).fill(null), ...cells];

  const weeks: (HeatmapCell | null)[][] = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));

  return (
    <div className="col gap-2">
      <div className="row gap-1" style={{ overflowX: 'auto', paddingBottom: 4 }}>
        {weeks.map((week, wi) => (
          <div key={wi} className="col gap-1">
            {Array.from({ length: 7 }, (_, di) => {
              const cell = week[di];
              if (!cell) return <span key={di} style={{ width: 11, height: 11 }} />;
              return (
                <span
                  key={di}
                  title={`${cell.count} review${cell.count === 1 ? '' : 's'} · ${cell.date}`}
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 2,
                    background: PALETTE[level(cell.count, max)],
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="row gap-2" style={{ alignItems: 'center', fontSize: 12 }}>
        <span className="faint">{total} reviews</span>
        <span className="row gap-1 right" style={{ alignItems: 'center' }}>
          <span className="faint">less</span>
          {PALETTE.map((c, i) => (
            <span key={i} style={{ width: 11, height: 11, borderRadius: 2, background: c }} />
          ))}
          <span className="faint">more</span>
        </span>
      </div>
    </div>
  );
}
