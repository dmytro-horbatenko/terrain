import type { CSSProperties, ReactNode } from 'react';

export function Card({
  title,
  actions,
  children,
  className = '',
  style,
  pad = true,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  pad?: boolean;
}) {
  return (
    <div className={`card ${className}`} style={style}>
      {(title || actions) && (
        <div
          className="row"
          style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}
        >
          {title && (
            <div className="card-title" style={{ margin: 0 }}>
              {title}
            </div>
          )}
          {actions && <div className="right">{actions}</div>}
        </div>
      )}
      <div className={pad ? 'card-pad' : ''}>{children}</div>
    </div>
  );
}
