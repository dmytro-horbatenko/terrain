# Terrain Mobile Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Terrain web route usable on iPhone and installable as an online-only iOS Home Screen web app.

**Architecture:** Keep the existing React/Vite SPA and API flows. Add static install metadata, switch the existing desktop shell to a native-popover bottom navigation at phone widths, and add a small responsive CSS layer plus semantic classes for the few desktop-only grids.

**Tech Stack:** React 19, Vite 8, TanStack Router, TypeScript 6, CSS media queries, Web App Manifest, HTML Popover API, Vitest/build checks.

## Global Constraints

- Keep the application online-only; do not add a service worker, offline storage, background sync, push, or badges.
- Add no dependency.
- Keep the desktop sidebar and all API behavior unchanged.
- Use `display: "standalone"`, stable `id`, `start_url`, and `scope` values of `/`.
- Use a dedicated 180px Apple touch icon plus 192px and 512px manifest icons.
- Use 44px minimum mobile touch targets and 16px mobile form text.
- Support iOS safe areas in portrait and landscape with `viewport-fit=cover` and `env(safe-area-inset-*)`.
- Do not execute any commit step without explicit user confirmation, per this repository's contributor policy.

## File Map

- Create `apps/web/public/manifest.webmanifest` — install identity and display metadata.
- Create `apps/web/public/terrain-icon.svg` — single source for the existing Terrain `T` icon.
- Generate `apps/web/public/icon-192.png`, `icon-512.png`, and `apple-touch-icon.png` from that SVG.
- Modify `apps/web/index.html` — link metadata and opt into iOS safe-area layout.
- Modify `apps/web/src/app/Layout.tsx` — retain desktop sidebar and add mobile bottom navigation/More popover.
- Modify `apps/web/src/components.css` — mobile shell, overlays, touch targets, responsive screen rules.
- Modify `apps/web/src/screens/Dashboard/TodayCard.tsx` — name its two-column grid.
- Modify `apps/web/src/screens/Dashboard/index.tsx` — name KPI and analysis grids.
- Modify `apps/web/src/screens/Topics/index.tsx` — name header/filter rows for narrow layouts.
- Modify `apps/web/src/screens/Courses/index.tsx` — use the standard page container and wrap card actions.
- Modify `apps/web/src/screens/Roadmap/index.tsx` — move canvas dimensions to responsive CSS.
- Modify `apps/web/src/components/TopicDetailPanel.tsx` — name its relations grid.

---

### Task 1: Installable iOS web-app metadata

**Files:**
- Create: `apps/web/public/manifest.webmanifest`
- Create: `apps/web/public/terrain-icon.svg`
- Create: `apps/web/public/icon-192.png`
- Create: `apps/web/public/icon-512.png`
- Create: `apps/web/public/apple-touch-icon.png`
- Modify: `apps/web/index.html`

**Interfaces:**
- Consumes: Vite's native `public/` static-file copying.
- Produces: `/manifest.webmanifest`, `/icon-192.png`, `/icon-512.png`, and `/apple-touch-icon.png` in development and production builds.

- [ ] **Step 1: Record the failing metadata check**

Run:

```bash
test -f apps/web/public/manifest.webmanifest \
  && test -f apps/web/public/apple-touch-icon.png \
  && rg -q 'rel="manifest"' apps/web/index.html
```

Expected: non-zero exit because the manifest and icon do not exist.

- [ ] **Step 2: Add the manifest**

Create `apps/web/public/manifest.webmanifest`:

```json
{
  "name": "Terrain — Learning OS",
  "short_name": "Terrain",
  "id": "/",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#f6f7f9",
  "theme_color": "#4f46e5",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

- [ ] **Step 3: Add the reusable icon source and generate PNGs**

Create `apps/web/public/terrain-icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#4f46e5"/>
  <path fill="#fff" d="M132 128h248v64h-88v216h-72V192h-88z"/>
</svg>
```

Generate the three checked-in PNG assets with the already-available renderer:

```bash
rsvg-convert -w 192 -h 192 apps/web/public/terrain-icon.svg -o apps/web/public/icon-192.png
rsvg-convert -w 512 -h 512 apps/web/public/terrain-icon.svg -o apps/web/public/icon-512.png
rsvg-convert -w 180 -h 180 apps/web/public/terrain-icon.svg -o apps/web/public/apple-touch-icon.png
```

Expected: all commands exit 0. The mark stays inside the maskable icon's central safe region.

- [ ] **Step 4: Link the install metadata**

Replace the `<head>` metadata in `apps/web/index.html` with:

```html
<meta charset="UTF-8" />
<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0, viewport-fit=cover"
/>
<meta name="theme-color" content="#4f46e5" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="Terrain" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<title>Terrain — Learning OS</title>
```

- [ ] **Step 5: Validate metadata and production copying**

Run:

```bash
node -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync("apps/web/public/manifest.webmanifest"));if(m.display!=="standalone"||m.id!=="/"||m.icons.length!==2)process.exit(1)'
sips -g pixelWidth -g pixelHeight apps/web/public/icon-192.png apps/web/public/icon-512.png apps/web/public/apple-touch-icon.png
yarn workspace @terrain/web build
test -f apps/web/dist/manifest.webmanifest && test -f apps/web/dist/apple-touch-icon.png
```

Expected: JSON check exits 0; `sips` reports 192x192, 512x512, and 180x180; the web build and copied-file check pass.

- [ ] **Step 6: Commit only after explicit approval**

```bash
git add apps/web/index.html apps/web/public
git commit -m "feat(web): add installable app metadata"
```

---

### Task 2: Responsive application shell and native More menu

**Files:**
- Modify: `apps/web/src/app/Layout.tsx`
- Modify: `apps/web/src/components.css`

**Interfaces:**
- Consumes: existing `NAV` route definitions, `useStreak`, TanStack Router `Link`, and browser Popover API.
- Produces: `.mobile-nav`, `#mobile-more`, and `.mobile-more` markup consumed by the responsive CSS.

- [ ] **Step 1: Establish the browser acceptance check before editing**

With the authenticated app open, set the browser viewport to 390x844 and evaluate:

```js
(() => ({
  mobileNav: getComputedStyle(document.querySelector('.mobile-nav')).display,
  horizontalOverflow:
    document.documentElement.scrollWidth > document.documentElement.clientWidth,
}))()
```

Expected before implementation: evaluation fails because `.mobile-nav` is absent.

- [ ] **Step 2: Add the mobile navigation while retaining the desktop sidebar**

Update the import and add the mobile route lists near `NAV` in `apps/web/src/app/Layout.tsx`:

```tsx
import { Link, Outlet, useRouterState } from '@tanstack/react-router';

const MOBILE_PATHS = ['/', '/topics', '/roadmap', '/courses'] as const;
const MORE_PATHS = ['/export', '/import', '/settings'] as const;
```

Inside `Layout`, calculate the More active state and render the existing app plus the mobile navigation:

```tsx
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
```

The native popover supplies light-dismiss and Escape behavior without React state or another overlay abstraction.

- [ ] **Step 3: Add base mobile-navigation styles**

Append before the media query in `apps/web/src/components.css`:

```css
.mobile-nav {
  display: none;
}

.mobile-more {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  padding: 10px;
}

.mobile-more::backdrop {
  background: rgba(16, 24, 40, 0.3);
}

.mobile-more-head .brand {
  padding-bottom: 10px;
}
```

- [ ] **Step 4: Add the responsive shell, overlays, and shared mobile controls**

Append to `apps/web/src/components.css`:

```css
@media (max-width: 768px) {
  .app {
    display: block;
    height: 100dvh;
  }

  .sidebar {
    display: none;
  }

  .main {
    height: 100dvh;
    min-width: 0;
    overflow-x: hidden;
    padding-bottom: calc(64px + env(safe-area-inset-bottom));
  }

  .page {
    width: 100%;
    padding-top: 16px;
    padding-right: max(16px, env(safe-area-inset-right));
    padding-bottom: 24px;
    padding-left: max(16px, env(safe-area-inset-left));
  }

  .mobile-nav {
    position: fixed;
    z-index: 45;
    right: 0;
    bottom: 0;
    left: 0;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    padding-right: env(safe-area-inset-right);
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: env(safe-area-inset-left);
    border-top: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 94%, transparent);
    backdrop-filter: blur(14px);
  }

  .mobile-nav-link {
    min-width: 0;
    min-height: 64px;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    font: 550 11px/1.2 var(--font);
  }

  .mobile-nav-link.active {
    color: var(--primary);
  }

  .mobile-nav-link .nav-ico {
    width: auto;
    font-size: 18px;
  }

  .mobile-more {
    inset: auto max(8px, env(safe-area-inset-right))
      calc(72px + env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
    width: auto;
    max-width: none;
    margin: 0;
  }

  .mobile-more .nav-link {
    min-height: 44px;
  }

  .mobile-more .streak-chip {
    margin-top: 10px;
  }

  .btn,
  .seg button {
    min-height: 44px;
  }

  .input,
  .select,
  .textarea {
    font-size: 16px;
  }

  .page .row,
  .modal .row,
  .drawer .row {
    flex-wrap: wrap;
  }

  .modal-overlay {
    align-items: stretch;
    padding: max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right))
      max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
  }

  .modal {
    width: 100% !important;
    max-width: none;
    max-height: 100%;
  }

  .modal-body {
    padding: 16px;
  }

  .drawer {
    width: 100%;
    max-width: none;
    padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
      max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  }

  .toast-stack {
    right: max(12px, env(safe-area-inset-right));
    bottom: calc(76px + env(safe-area-inset-bottom));
    left: max(12px, env(safe-area-inset-left));
  }

  .toast {
    max-width: none;
  }
}
```

- [ ] **Step 5: Build and run the acceptance check**

Run:

```bash
yarn workspace @terrain/web build
```

Expected: TypeScript and Vite build pass. At 390x844, the Step 1 expression returns `{ mobileNav: "grid", horizontalOverflow: false }`. Open More, press Escape, reopen it, tap Settings, and confirm the popover closes and `/settings` becomes active.

- [ ] **Step 6: Commit only after explicit approval**

```bash
git add apps/web/src/app/Layout.tsx apps/web/src/components.css
git commit -m "feat(web): add responsive mobile shell"
```

---

### Task 3: Responsive screen layouts

**Files:**
- Modify: `apps/web/src/components.css`
- Modify: `apps/web/src/screens/Dashboard/TodayCard.tsx`
- Modify: `apps/web/src/screens/Dashboard/index.tsx`
- Modify: `apps/web/src/screens/Topics/index.tsx`
- Modify: `apps/web/src/screens/Courses/index.tsx`
- Modify: `apps/web/src/screens/Roadmap/index.tsx`
- Modify: `apps/web/src/components/TopicDetailPanel.tsx`

**Interfaces:**
- Consumes: the existing `.grid`, `.row`, `.page`, `.drawer`, and React Flow class names.
- Produces: semantic grid/canvas classes whose desktop and phone behavior is defined in one stylesheet.

- [ ] **Step 1: Verify the current narrow-layout failure**

At a 390x844 authenticated browser viewport, visit `/` and evaluate:

```js
(() => ({
  kpiColumns: getComputedStyle(document.querySelector('.page .grid:nth-of-type(2)'))
    .gridTemplateColumns,
  horizontalOverflow:
    document.documentElement.scrollWidth > document.documentElement.clientWidth,
}))()
```

Expected before implementation: the dashboard retains desktop grid sizing or over-compresses cards because its inline `gridTemplateColumns` cannot respond by intent.

- [ ] **Step 2: Name the responsive grids**

In `apps/web/src/screens/Dashboard/TodayCard.tsx`, replace the outer grid opening tag with:

```tsx
<div className="grid dashboard-today-grid">
```

In `apps/web/src/screens/Dashboard/index.tsx`, replace the KPI and analysis grid opening tags with:

```tsx
<div className="grid dashboard-kpi-grid">
```

and:

```tsx
<div className="grid dashboard-analysis-grid">
```

In `apps/web/src/components/TopicDetailPanel.tsx`, replace the relations grid opening tag with:

```tsx
<div className="grid topic-relations-grid">
```

- [ ] **Step 3: Name topic header/filter rows and put Courses in the standard page container**

In `apps/web/src/screens/Topics/index.tsx`, change the header and filter row classes to:

```tsx
<div className="row page-header" style={{ marginBottom: 16 }}>
```

```tsx
<div className="row wrap gap-3 topic-filters" style={{ marginBottom: 14 }}>
```

In `apps/web/src/screens/Courses/index.tsx`, change the screen root and course action row to:

```tsx
<div className="page col gap-3">
```

```tsx
<div className="row course-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
```

- [ ] **Step 4: Move Roadmap canvas sizing into CSS**

In `apps/web/src/screens/Roadmap/index.tsx`, replace the canvas host's inline style with:

```tsx
<div className="roadmap-canvas">
```

Keep the existing `<ReactFlow>` and its children unchanged.

- [ ] **Step 5: Add desktop defaults and phone overrides**

Append above the mobile media query in `apps/web/src/components.css`:

```css
.dashboard-today-grid,
.dashboard-analysis-grid,
.topic-relations-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.dashboard-kpi-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.roadmap-canvas {
  width: 100%;
  height: calc(100vh - 120px);
  margin-top: 12px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 12px;
}
```

Add inside the existing `@media (max-width: 768px)` block:

```css
  .dashboard-today-grid,
  .dashboard-analysis-grid,
  .topic-relations-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .dashboard-kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .page-header,
  .course-actions {
    align-items: stretch !important;
    gap: 12px;
  }

  .topic-filters > .input,
  .topic-filters > .select {
    max-width: none !important;
  }

  .list-row {
    flex-wrap: wrap;
  }

  .list-row .grow {
    min-width: 140px;
  }

  .roadmap-canvas {
    height: max(420px, calc(100dvh - 230px));
  }

  .roadmap-canvas .react-flow__minimap {
    display: none;
  }
```

Append a narrow-phone fallback after that block:

```css
@media (max-width: 360px) {
  .dashboard-kpi-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

- [ ] **Step 6: Format, build, and smoke every route**

Run:

```bash
yarn oxfmt --write apps/web/index.html apps/web/src/app/Layout.tsx apps/web/src/components.css apps/web/src/screens/Dashboard/TodayCard.tsx apps/web/src/screens/Dashboard/index.tsx apps/web/src/screens/Topics/index.tsx apps/web/src/screens/Courses/index.tsx apps/web/src/screens/Roadmap/index.tsx apps/web/src/components/TopicDetailPanel.tsx
yarn workspace @terrain/web test
yarn workspace @terrain/web build
```

Expected: formatter exits 0, all current Vitest files pass, and the production build succeeds.

At 320, 375, 390, 430, and 768px widths plus 844x390 landscape, visit Dashboard, Topics, Roadmap, Export, Import, Courses, Settings, `/session/repeat`, and Auth. For each route, evaluate:

```js
document.documentElement.scrollWidth <= document.documentElement.clientWidth
```

Expected: `true`. The heatmap, Roadmap canvas, editors, and long export text may scroll inside their own containers.

- [ ] **Step 7: Commit only after explicit approval**

```bash
git add apps/web/src/components.css apps/web/src/screens/Dashboard/TodayCard.tsx apps/web/src/screens/Dashboard/index.tsx apps/web/src/screens/Topics/index.tsx apps/web/src/screens/Courses/index.tsx apps/web/src/screens/Roadmap/index.tsx apps/web/src/components/TopicDetailPanel.tsx
git commit -m "feat(web): make screens responsive on iPhone"
```

---

### Task 4: End-to-end installed-app acceptance

**Files:**
- Verify only; no source changes expected.

**Interfaces:**
- Consumes: production HTTPS deployment, manifest assets, responsive shell, existing authentication and session workflows.
- Produces: evidence that the requested iOS workflow works on a physical iPhone.

- [ ] **Step 1: Run repository checks**

```bash
yarn workspace @terrain/web test
yarn workspace @terrain/web build
yarn lint
yarn format:check
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 2: Verify production asset responses**

After deploying the built web app, run:

```bash
test -n "$DOMAIN"
curl --fail --silent --show-error "https://$DOMAIN/manifest.webmanifest"
curl --fail --silent --show-error --output /dev/null "https://$DOMAIN/apple-touch-icon.png"
```

Expected: with `DOMAIN` loaded from the deployment environment, both requests return HTTP 200. Do not add a domain constant to the application.

- [ ] **Step 3: Verify physical iPhone installation and workflow**

On the target iPhone:

1. Open the production HTTPS URL and choose Share → Add to Home Screen.
2. Confirm the Terrain icon and name appear correctly.
3. Launch Terrain from the icon and confirm Safari browser chrome is absent.
4. Sign in if the standalone app has separate cookie storage.
5. Visit Dashboard, Topics, Roadmap, Courses, and every More destination.
6. Open and dismiss a modal, a topic drawer, and the More sheet.
7. Pan and zoom Roadmap and confirm the minimap is hidden.
8. Complete one review/session flow through copy, paste, preview, and save.
9. Rotate to landscape and confirm the notch, Home indicator, keyboard, and bottom navigation cover no important control.

Expected: every action completes online without page-level horizontal scrolling or obscured controls.
