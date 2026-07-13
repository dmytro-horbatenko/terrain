import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { Layout } from './Layout';
import Dashboard from '../screens/Dashboard';
import Topics from '../screens/Topics';
import Roadmap from '../screens/Roadmap';
import ExportScreen from '../screens/Export';
import ImportScreen from '../screens/Import';
import CoursesScreen from '../screens/Courses';
import Settings from '../screens/Settings';
import SessionWizard from '../screens/Session';

const rootRoute = createRootRoute({ component: Layout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Dashboard,
});
const topicsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/topics',
  component: Topics,
});
const roadmapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/roadmap',
  component: Roadmap,
});
const exportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/export',
  component: ExportScreen,
});
const importRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/import',
  component: ImportScreen,
});
const coursesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/courses',
  component: CoursesScreen,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: Settings,
});
export const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/session/$mode',
  component: SessionWizard,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  topicsRoute,
  roadmapRoute,
  exportRoute,
  importRoute,
  coursesRoute,
  settingsRoute,
  sessionRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
