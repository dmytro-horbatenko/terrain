/** A neutral summary of self-rated reviews; missing evidence is not a zero score. */
export function Gauge({ value, reviewCount }: { value: number | null; reviewCount: number }) {
  if (value === null) return <p className="muted">No recent reviews</p>;
  return (
    <div className="col gap-2">
      <b style={{ fontSize: 26 }}>{Math.round(value * 100)}% rated Again</b>
      <span className="muted">{reviewCount} self-rated reviews</span>
    </div>
  );
}
