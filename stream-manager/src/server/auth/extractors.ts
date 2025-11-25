import type { Request } from 'express';
import { User, AuthConfig } from './types.js';

// Default configuration
export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  mode: 'none',
  headers: {
    userId: 'x-forwarded-user',
    email: 'x-forwarded-email',
    groups: 'x-forwarded-groups',
    name: 'x-forwarded-preferred-username'
  },
  roleMapping: {
    groupRoles: {},
    defaultRole: 'viewer',
    anonymousRole: null
  },
  trustedProxies: ['127.0.0.1', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']
};

// Anonymous user (used when auth is disabled or no headers present)
export function createAnonymousUser(roles: string[]): User {
  return {
    id: 'anonymous',
    username: 'Anonymous',
    roles,
    authSource: 'anonymous'
  };
}

// Extract user from oauth2-proxy headers
export function extractOAuth2ProxyUser(req: Request, config: AuthConfig): User | null {
  const userId = req.headers[config.headers.userId] as string;
  if (!userId) return null;

  const email = req.headers[config.headers.email] as string;
  const name = req.headers[config.headers.name] as string;
  const groupsHeader = req.headers[config.headers.groups] as string;
  const groups = groupsHeader ? groupsHeader.split(',').map(g => g.trim()) : [];

  return {
    id: userId,
    username: name || userId,
    email,
    groups,
    roles: [],  // Will be resolved by middleware
    authSource: 'header'
  };
}

// Extract user from Azure EasyAuth headers
export function extractAzureEasyAuthUser(req: Request): User | null {
  // Azure passes a base64-encoded JSON in X-MS-CLIENT-PRINCIPAL
  const principalHeader = req.headers['x-ms-client-principal'] as string;
  const nameHeader = req.headers['x-ms-client-principal-name'] as string;

  if (!principalHeader && !nameHeader) return null;

  let userId = nameHeader || 'unknown';
  let email: string | undefined;
  let groups: string[] = [];

  if (principalHeader) {
    try {
      const decoded = JSON.parse(Buffer.from(principalHeader, 'base64').toString('utf8'));
      userId = decoded.userId || decoded.userDetails || nameHeader || 'unknown';

      // Extract claims
      const claims = decoded.claims || [];
      const emailClaim = claims.find((c: { typ: string; val: string }) =>
        c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress' ||
        c.typ === 'email'
      );
      if (emailClaim) email = emailClaim.val;

      // Extract groups
      const groupClaims = claims.filter((c: { typ: string; val: string }) =>
        c.typ === 'groups' ||
        c.typ === 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups'
      );
      groups = groupClaims.map((c: { val: string }) => c.val);
    } catch {
      // Fall back to just the name header
    }
  }

  return {
    id: userId,
    username: nameHeader || userId,
    email,
    groups,
    roles: [],
    authSource: 'header'
  };
}

// Extract user from generic reverse proxy headers
export function extractGenericProxyUser(req: Request, config: AuthConfig): User | null {
  // Try common header patterns
  const userId =
    req.headers['x-remote-user'] as string ||
    req.headers['remote-user'] as string ||
    req.headers[config.headers.userId] as string;

  if (!userId) return null;

  const email = req.headers['x-remote-email'] as string;
  const groupsHeader = req.headers['x-remote-groups'] as string;
  const groups = groupsHeader ? groupsHeader.split(',').map(g => g.trim()) : [];

  return {
    id: userId,
    username: userId,
    email,
    groups,
    roles: [],
    authSource: 'header'
  };
}

// Main extraction function - tries all extractors
export function extractUserFromRequest(req: Request, config: AuthConfig): User | null {
  // Try Azure EasyAuth first (most specific headers)
  let user = extractAzureEasyAuthUser(req);
  if (user) return user;

  // Try oauth2-proxy style
  user = extractOAuth2ProxyUser(req, config);
  if (user) return user;

  // Try generic proxy
  user = extractGenericProxyUser(req, config);
  if (user) return user;

  return null;
}
