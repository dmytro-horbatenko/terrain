export function Sparkline({
  values,
  width = 120,
  height = 30,
  color = 'var(--primary)',
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (values.length === 0) return <span className="faint">—</span>;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const pad = 3;
  const h = height - pad * 2;
  const pts = values.map((v, i) => `${i * step},${pad + h - ((v - min) / span) * h}`).join(' ');
  const last = values[values.length - 1];
  const lastX = (values.length - 1) * step;
  const lastY = pad + h - ((last - min) / span) * h;
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </svg>
  );
}
