export const QUALITY: { q: number; label: string; color: string }[] = [
  { q: 0, label: 'Blackout', color: '#dc2626' },
  { q: 1, label: 'Wrong', color: '#ef4444' },
  { q: 2, label: 'Almost', color: '#f59e0b' },
  { q: 3, label: 'Effort', color: '#84cc16' },
  { q: 4, label: 'Good', color: '#22c55e' },
  { q: 5, label: 'Perfect', color: '#16a34a' },
];

export function QualityPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (q: number) => void;
}) {
  return (
    <div className="quality-grid">
      {QUALITY.map((item) => {
        const selected = value === item.q;
        return (
          <button
            key={item.q}
            type="button"
            className={`quality-btn${selected ? ' sel' : ''}`}
            style={
              selected
                ? {
                    borderColor: item.color,
                    background: `color-mix(in srgb, ${item.color} 14%, white)`,
                  }
                : undefined
            }
            onClick={() => onChange(item.q)}
          >
            <span className="quality-num" style={{ color: item.color }}>
              {item.q}
            </span>
            <span className="quality-label">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
