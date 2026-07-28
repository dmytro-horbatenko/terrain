import { describe, expect, it } from 'vitest';
import { isValidOAuthAuthorizationRequest } from '../screens/OAuthAuthorize';
import { validateOAuthSearch } from './router';

const request = {
  response_type: 'code',
  client_id: 'claude',
  redirect_uri: 'https://client.example/callback',
  scope: 'learning:read offline_access',
  state: 'opaque-state',
  code_challenge: 'challenge'.padEnd(43, 'x'),
  code_challenge_method: 'S256',
  resource: 'https://terrain.example.com/api/mcp',
};

describe('validateOAuthSearch', () => {
  it('keeps the server-validated OAuth request strings', () => {
    const parsed = validateOAuthSearch(request);
    expect(parsed).toEqual(request);
    expect(isValidOAuthAuthorizationRequest(parsed)).toBe(true);
  });

  it('does not coerce missing or non-string query values', () => {
    expect(validateOAuthSearch({ ...request, client_id: ['claude'], state: undefined })).toEqual({
      ...request,
      client_id: '',
      state: '',
    });
  });

  it.each(Object.keys(request) as Array<keyof typeof request>)(
    'marks the request invalid when %s is absent or non-string',
    (field) => {
      for (const invalidValue of [undefined, [request[field]]]) {
        const parsed = validateOAuthSearch({ ...request, [field]: invalidValue });
        expect(isValidOAuthAuthorizationRequest(parsed)).toBe(false);
      }
    },
  );

  it.each(Object.keys(request) as Array<keyof typeof request>)(
    'marks the request invalid when %s is whitespace',
    (field) => {
      expect(isValidOAuthAuthorizationRequest({ ...request, [field]: '   ' })).toBe(false);
    },
  );

  it.each([
    ['wrong response type', { response_type: 'token' }],
    ['wrong challenge method', { code_challenge_method: 'plain' }],
    ['missing read scope', { scope: 'offline_access' }],
    ['duplicate scope', { scope: 'learning:read learning:read' }],
    ['extra scope', { scope: 'learning:read learning:write' }],
    ['malformed redirect', { redirect_uri: 'not-a-url' }],
    ['malformed resource', { resource: 'not-a-url' }],
    ['short challenge', { code_challenge: 'short' }],
    ['malformed challenge', { code_challenge: `${'x'.repeat(42)}!` }],
  ])('marks %s invalid before showing actions', (_name, override) => {
    expect(isValidOAuthAuthorizationRequest({ ...request, ...override })).toBe(false);
  });

  it.each([
    ['redirect_uri', '?'],
    ['redirect_uri', '#'],
    ['resource', '?'],
    ['resource', '#'],
  ] as const)('rejects an empty raw %s %s delimiter', (field, delimiter) => {
    expect(
      isValidOAuthAuthorizationRequest({
        ...request,
        [field]: `${request[field]}${delimiter}`,
      }),
    ).toBe(false);
  });

  it('accepts the required read scope without offline access', () => {
    expect(isValidOAuthAuthorizationRequest({ ...request, scope: 'learning:read' })).toBe(true);
  });
});
