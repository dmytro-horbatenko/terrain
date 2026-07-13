import { Link, Outlet } from '@tanstack/react-router';
import { useStreak } from '../api/hooks';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◎', exact: true },
  { to: '/topics', label: 'Topics', icon: '☰', exact: false },
  { to: '/roadmap', label: 'Roadmap', icon: '⊹', exact: false },
  { to: '/export', label: 'Export', icon: '↗', exact: false },
  { to: '/import', label: 'Import', icon: '↘', exact: false },
  { to: '/courses', label: 'Courses', icon: '⬒', exact: false },
  { to: '/settings', label: 'Settings', icon: '⚙', exact: false },
] as const;

function StreakChip() {
  const { data } = useStreak();
  return (
    <div className="streak-chip">
      <div className="row gap-2">
        <span style={{ fontSize: 15 }}>🔥</span>
        <b>{data ? data.currentStreak : '—'} day streak</b>
      </div>
      <div className="faint" style={{ fontSize: 12 }}>
        🛡️ {data?.freezeBalance ?? 0} freezes · best {data?.longestStreak ?? 0}
      </div>
    </div>
  );
}

export function Layout() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">T</span>Terrain
        </div>
        {NAV.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeOptions={{ exact: n.exact }}
            className="nav-link"
            activeProps={{ className: 'nav-link active' }}
          >
            <span className="nav-ico">{n.icon}</span>
            {n.label}
          </Link>
        ))}
        <StreakChip />
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
