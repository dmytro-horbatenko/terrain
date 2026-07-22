import { Link, Outlet, useRouterState } from '@tanstack/react-router';
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

const MOBILE_PATHS = ['/', '/topics', '/roadmap', '/courses'] as const;
const MORE_PATHS = ['/export', '/import', '/settings'] as const;

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
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const moreActive = MORE_PATHS.some((path) => pathname === path);

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

      <nav className="mobile-nav" aria-label="Primary navigation">
        {NAV.filter((item) => MOBILE_PATHS.some((path) => path === item.to)).map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeOptions={{ exact: n.exact }}
            className="mobile-nav-link"
            activeProps={{ className: 'mobile-nav-link active' }}
          >
            <span className="nav-ico" aria-hidden="true">
              {n.icon}
            </span>
            <span>{n.label}</span>
          </Link>
        ))}
        <button
          className={`mobile-nav-link${moreActive ? ' active' : ''}`}
          popoverTarget="mobile-more"
          aria-label="More navigation"
          aria-current={moreActive ? 'page' : undefined}
        >
          <span className="nav-ico" aria-hidden="true">
            •••
          </span>
          <span>More</span>
        </button>
        <div id="mobile-more" className="mobile-more" popover="auto">
          <div className="mobile-more-head">
            <span className="brand">
              <span className="brand-mark">T</span>Terrain
            </span>
          </div>
          {NAV.filter((item) => MORE_PATHS.some((path) => path === item.to)).map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.exact }}
              className="nav-link"
              activeProps={{ className: 'nav-link active' }}
              onClick={() => document.getElementById('mobile-more')?.hidePopover()}
            >
              <span className="nav-ico">{n.icon}</span>
              {n.label}
            </Link>
          ))}
          <StreakChip />
        </div>
      </nav>
    </div>
  );
}
