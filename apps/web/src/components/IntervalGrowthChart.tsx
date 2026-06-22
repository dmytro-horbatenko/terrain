import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Review } from '../api/types';
import { formatDate } from '../lib/format';

/**
 * FSRS interval growth over a topic's review history — reads the historical
 * `intervalAfter` facts (never recomputed) so the curve reflects what actually
 * happened. Evidence reviews (no scheduling effect) have a null interval and
 * are excluded. Chronological (oldest → newest). Renders nothing below 2 points.
 */
export function IntervalGrowthChart({ reviews }: { reviews: Review[] }) {
  const data = [...reviews]
    .filter((r) => r.intervalAfter != null)
    .reverse()
    .map((r, i) => ({
      i,
      interval: r.intervalAfter,
      date: formatDate(r.reviewedAt),
    }));

  if (data.length < 2) return null;

  return (
    <div style={{ width: '100%', height: 170 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line, #e5e7eb)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: 'var(--text-faint)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--line, #e5e7eb)' }}
            minTickGap={24}
          />
          <YAxis
            width={42}
            tick={{ fontSize: 10, fill: 'var(--text-faint)' }}
            tickLine={false}
            axisLine={false}
            unit="d"
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: '1px solid var(--line, #e5e7eb)',
            }}
            formatter={(value) => [`${value}d`, 'Interval']}
            labelFormatter={(label) => `${label}`}
          />
          <Line
            type="monotone"
            dataKey="interval"
            stroke="var(--primary, #4f46e5)"
            strokeWidth={2}
            dot={{ r: 2.5, fill: 'var(--primary, #4f46e5)' }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
