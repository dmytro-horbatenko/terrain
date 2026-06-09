import type { ReactNode } from 'react';

export function Spinner() {
  return <div className="spinner" />;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="row center" style={{ padding: 40, gap: 10, color: 'var(--text-muted)' }}>
      <div className="spinner" />
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {hint && (
        <div className="muted" style={{ maxWidth: 360 }}>
          {hint}
        </div>
      )}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error ?? 'Something went wrong');
  return <div className="errorbox">⚠ {msg}</div>;
}
