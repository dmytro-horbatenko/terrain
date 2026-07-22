# Terrain Mobile Web App Design

**Date:** 2026-07-12
**Status:** Approved design, pending implementation

## Goal

Make every Terrain web workflow usable on iPhone and allow Terrain to launch
from the iOS Home Screen as a standalone web app. Terrain remains online-only:
all reads and writes continue through the existing authenticated API.

## Scope

This change covers:

- responsive layouts for all existing web routes;
- an iPhone bottom navigation shell and overflow menu;
- iOS safe-area, viewport, form, modal, drawer, and touch-target behavior;
- a web app manifest and Terrain app icons; and
- mobile and installed-web-app verification.

It does not add offline storage, a service worker, background sync, push
notifications, badges, an install prompt, API changes, or a native iOS app.

## Architecture

The existing React/Vite SPA, TanStack Router routes, React Query data flow, JWT
cookie authentication, and NestJS API remain unchanged. Responsive behavior is
implemented in the existing web shell and CSS, with small semantic class names
added to screens whose inline desktop grid definitions currently prevent
responsive overrides.

No new dependency is needed. Installation metadata is served as static files
from `apps/web/public` and linked from `apps/web/index.html`.

## Application shell and navigation

At desktop widths, Terrain retains its current 220px sidebar. At widths up to
768px, the sidebar is replaced with a fixed bottom navigation bar containing:

1. Dashboard
2. Topics
3. Roadmap
4. Courses
5. More

More opens a lightweight sheet with Export, Import, Settings, and the current
streak summary. Selecting a destination closes the sheet. Tapping outside the
sheet or pressing Escape also closes it. Navigation links continue using
TanStack Router so active states, deep links, and browser history behave as
they do on desktop.

The mobile shell uses `100dvh` where available and CSS safe-area environment
variables. Main content and fixed controls must remain clear of the iPhone
notch, Safari chrome, and Home indicator in portrait and landscape. The bottom
bar includes its safe-area padding in its total height, and page content is
padded so the final control cannot sit behind it.

Mobile interactive controls have a minimum 44px touch target. Form controls
use at least 16px text on mobile to prevent Safari focus zoom. Desktop sizing
is unchanged.

## Screen behavior

### Dashboard

- Stack the Today card's two columns.
- Render KPI cards in two columns on common iPhone widths and one column only
  when the viewport is too narrow.
- Stack the struggle ratio and library cards.
- Keep the heatmap's existing intentional horizontal scrolling inside its
  card; the page itself must not scroll horizontally.

### Topics and Courses

- Wrap page headers without pushing primary actions off-screen.
- Stack filters at narrow widths and let inputs/selects fill the row.
- Allow list metadata and actions to wrap while preserving readable titles and
  reachable controls.

### Roadmap

- Preserve the existing React Flow touch pan and zoom behavior.
- Size the canvas from the available dynamic viewport height.
- Hide the minimap on phone widths to preserve canvas space; retain controls.
- Open topic details as a full-width drawer on phones.
- Allow filters, legend, and breadcrumbs to wrap without page-level horizontal
  scrolling.

### Session

- Keep the existing narrow reading column but reduce outer padding.
- Wrap action rows and keep grade/review choices large enough to tap.
- Ensure long prompts and captured text wrap or scroll within their own
  containers.

### Import, Export, Settings, and Auth

- Let forms, selectors, editors, and text areas use the available width.
- Keep long generated/exported content scrollable inside its container.
- Reduce page and card padding without changing workflow order or validation.

### Shared overlays

- Render modals as near-full-screen sheets on phones.
- Render drawers full-width on phones.
- Place toast notifications above the bottom navigation and safe area.
- Keep overlay dismissal and focus behavior unchanged.

## Installable web app metadata

Add `apps/web/public/manifest.webmanifest` containing:

- `name`: `Terrain — Learning OS`
- `short_name`: `Terrain`
- stable `id`, `start_url`, and `scope` values of `/`
- `display`: `standalone`
- Terrain background and theme colors
- 192px and 512px icons, including a maskable 512px icon

Add a dedicated 180px PNG Apple touch icon because iOS gives it precedence
over manifest icons. Icons use the existing Terrain `T` brand mark and primary
color rather than introducing a new visual identity.

Update `index.html` with the manifest link, Apple touch icon, theme color,
current iOS standalone metadata, and
`viewport-fit=cover` on the existing viewport declaration.

The app does not register a service worker. The manifest and HTTPS deployment
are sufficient for the requested iOS standalone Home Screen experience; adding
an application-shell cache while all useful data remains online would create
stale-deployment risk without meaningful offline support.

## Data and error behavior

All route data continues through the existing React Query hooks and API client.
When connectivity is absent, existing request error handling remains visible.
There is no offline mutation queue or cached-data promise.

iOS Home Screen web apps may use storage separate from the same site in the
browser. The existing `AuthGate` therefore remains responsible for showing the
login screen when the installed app does not yet have an authentication cookie.
After that initial login, authentication follows the existing flow.

## Accessibility

- Bottom navigation and More controls have explicit accessible labels and
  current/active state.
- The More sheet is keyboard dismissible and does not hide destinations from
  assistive technology.
- Focus indicators remain visible.
- Responsive changes preserve document order and do not use visual-only
  reordering.
- Touch-target enlargement applies without removing desktop keyboard behavior.

## Verification

Automated verification:

- run existing web tests;
- run `yarn workspace @terrain/web build`;
- confirm the built output includes and correctly links the manifest and icons;
- add the smallest focused test for any non-trivial new navigation state logic.

Responsive smoke verification covers 320px, 375px, 390px, 430px, and 768px
viewports plus a phone landscape viewport. Every route must render without
page-level horizontal scrolling. Intentional inner scrolling remains allowed
for the heatmap, graph canvas, editors, and long generated text.

The smoke pass covers:

- all bottom navigation destinations and the More sheet;
- Dashboard grids and Today card;
- Topics filters, rows, create/edit modal, and detail drawer;
- Roadmap pan, zoom, controls, breadcrumbs, and full-width detail drawer;
- Session actions and grade controls;
- Import, Export, Courses, Settings, and Auth forms;
- modals, toasts, keyboard focus, and portrait/landscape safe areas.

Final physical-device acceptance on iPhone:

1. Open the production HTTPS URL and add Terrain to the Home Screen.
2. Launch it without Safari browser chrome.
3. Sign in if the standalone app has separate cookie storage.
4. Navigate through every top-level destination.
5. Complete one review/session flow.
6. Confirm no important control is covered by the Home indicator or keyboard.

## References

- [Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [What's new in web apps — WWDC23](https://developer.apple.com/videos/play/wwdc2023/10120/)
- [Inspecting iOS and iPadOS](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios)

