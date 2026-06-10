/** Struggle-ratio gauge with a target band (default 40–60%). */
export function Gauge({ value, band = [0.4, 0.6] }: { value: number; band?: [number, number] }) {
  const v = Math.max(0, Math.min(1, value));
  const inBand = v >= band[0] && v <= band[1];
  const stateColor = inBand ? 'var(--ok)' : 'var(--warn)';
  const stateText = inBand ? 'in target' : v < band[0] ? 'too easy' : 'too hard';
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{Math.round(v * 100)}%</span>
        <span
          className="pill"
          style={{
            background: `color-mix(in srgb, ${stateColor} 16%, white)`,
            color: stateColor,
          }}
        >
          {stateText}
        </span>
      </div>
      <div className="gauge-track">
        <div
          className="gauge-band"
          style={{ left: `${band[0] * 100}%`, width: `${(band[1] - band[0]) * 100}%` }}
        />
        <div className="gauge-fill" style={{ width: `${v * 100}%` }} />
      </div>
      <div
        className="row faint"
        style={{ justifyContent: 'space-between', fontSize: 11, marginTop: 5 }}
      >
        <span>0%</span>
        <span>target 40–60%</span>
        <span>100%</span>
      </div>
    </div>
  );
}
