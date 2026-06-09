import type { ReactNode } from 'react';
import { useMe } from '../api/hooks';
import { Loading } from '../components';
import AuthScreen from '../screens/Auth';

/** Gates the whole app behind a session check: no session → <AuthScreen>. */
export function AuthGate({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isLoading) return <Loading label="Loading…" />;
  if (me.isError || !me.data) return <AuthScreen />;
  return <>{children}</>;
}
