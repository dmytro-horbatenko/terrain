import { useMutation } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { api } from '../../api/client';
import type { OAuthAuthorizationRequest } from '../../api/types';
import { Card } from '../../components';

const CLIENT_ID = /^[a-z0-9_-]{1,64}$/;
const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

function isHttpUrl(value: string): boolean {
  if (value.includes('?') || value.includes('#')) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function isValidOAuthAuthorizationRequest(request: OAuthAuthorizationRequest): boolean {
  if (
    Object.values(request).some(
      (value) => typeof value !== 'string' || value.trim().length === 0,
    ) ||
    request.response_type !== 'code' ||
    !CLIENT_ID.test(request.client_id) ||
    !isHttpUrl(request.redirect_uri) ||
    !CODE_CHALLENGE.test(request.code_challenge) ||
    request.code_challenge_method !== 'S256' ||
    !isHttpUrl(request.resource)
  ) {
    return false;
  }
  const scopes = request.scope.trim().split(/\s+/);
  const unique = new Set(scopes);
  return (
    unique.size === scopes.length &&
    unique.has('learning:read') &&
    [...unique].every((scope) => scope === 'learning:read' || scope === 'offline_access')
  );
}

export default function OAuthAuthorize() {
  const search = useSearch({ from: '/oauth/authorize' });
  const authorize = useMutation({
    mutationFn: (approved: boolean) => api.authorizeOAuth({ ...search, approved }),
    onSuccess: ({ redirectUrl }) => window.location.assign(redirectUrl),
  });
  const scopes = search.scope.trim().split(/\s+/).filter(Boolean);

  if (!isValidOAuthAuthorizationRequest(search)) {
    return (
      <div className="page" style={{ maxWidth: 560 }}>
        <h1 className="page-title">Invalid authorization request</h1>
        <Card>
          <div className="errorbox" role="alert">
            This connection request is incomplete or malformed. Return to the AI client and try
            connecting again.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <h1 className="page-title">Connect this AI client to Terrain?</h1>
      <Card>
        <div className="col gap-4">
          <p style={{ margin: 0 }}>
            Allow read-only access to your learning context and roadmap decisions.
          </p>
          <div className="col gap-1">
            <span className="field-label">Client</span>
            <span className="mono">{search.client_id}</span>
          </div>
          <div className="col gap-1">
            <span className="field-label">Requested scopes</span>
            <span>{scopes.join(', ') || 'None'}</span>
          </div>
          {authorize.isError && (
            <div className="errorbox" role="alert">
              {authorize.error instanceof Error
                ? authorize.error.message
                : 'Could not complete authorization.'}
            </div>
          )}
          <div className="row gap-2">
            <button
              className="btn btn-primary"
              disabled={authorize.isPending}
              onClick={() => authorize.mutate(true)}
            >
              Allow
            </button>
            <button
              className="btn"
              disabled={authorize.isPending}
              onClick={() => authorize.mutate(false)}
            >
              Deny
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
