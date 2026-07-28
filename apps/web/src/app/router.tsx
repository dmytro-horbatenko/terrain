import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import type { LearningApproach } from '@terrain/types';
import type { OAuthAuthorizationRequest } from '../api/types';
import { Layout } from './Layout';
import Dashboard from '../screens/Dashboard';
import Topics from '../screens/Topics';
import Roadmap from '../screens/Roadmap';
import ExportScreen from '../screens/Export';
import ImportScreen from '../screens/Import';
import CoursesScreen from '../screens/Courses';
import Settings from '../screens/Settings';
import OAuthAuthorize from '../screens/OAuthAuthorize';
import SessionWizard from '../screens/Session';
import { sessionIdentity } from '../screens/Session/sessionChoice';

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

const searchString = (value: unknown) => (typeof value === 'string' ? value : '');

export function validateOAuthSearch(search: Record<string, unknown>): OAuthAuthorizationRequest {
  return {
    response_type: searchString(search.response_type),
    client_id: searchString(search.client_id),
    redirect_uri: searchString(search.redirect_uri),
    scope: searchString(search.scope),
    state: searchString(search.state),
    code_challenge: searchString(search.code_challenge),
    code_challenge_method: searchString(search.code_challenge_method),
    resource: searchString(search.resource),
  };
}

const oauthAuthorizeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/oauth/authorize',
  validateSearch: validateOAuthSearch,
  component: OAuthAuthorize,
});

export const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/session/$mode',
  validateSearch: (
    search: Record<string, unknown>,
  ): { topic?: string; approach?: LearningApproach } => {
    const topic =
      typeof search.topic === 'string' && search.topic.trim() ? search.topic.trim() : undefined;
    const approach =
      search.approach === 'guided' || search.approach === 'source-first'
        ? (search.approach as LearningApproach)
        : undefined;
    return {
      ...(topic ? { topic } : {}),
      ...(approach ? { approach } : {}),
    };
  },
  remountDeps: ({ params, search }) => sessionIdentity(params.mode, search.topic, search.approach),
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
  oauthAuthorizeRoute,
  sessionRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
