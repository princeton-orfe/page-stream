import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import {
  DEFAULT_AUTH_CONFIG,
  createAnonymousUser,
  extractOAuth2ProxyUser,
  extractAzureEasyAuthUser,
  extractGenericProxyUser,
  extractUserFromRequest
} from '../../../src/server/auth/extractors.js';

// Helper to create mock request with headers
function mockRequest(headers: Record<string, string>): Request {
  return { headers } as Request;
}

describe('Auth Extractors', () => {
  describe('DEFAULT_AUTH_CONFIG', () => {
    it('should have mode set to none by default', () => {
      expect(DEFAULT_AUTH_CONFIG.mode).toBe('none');
    });

    it('should have default header names', () => {
      expect(DEFAULT_AUTH_CONFIG.headers.userId).toBe('x-forwarded-user');
      expect(DEFAULT_AUTH_CONFIG.headers.email).toBe('x-forwarded-email');
      expect(DEFAULT_AUTH_CONFIG.headers.groups).toBe('x-forwarded-groups');
      expect(DEFAULT_AUTH_CONFIG.headers.name).toBe('x-forwarded-preferred-username');
    });

    it('should have default role mapping', () => {
      expect(DEFAULT_AUTH_CONFIG.roleMapping.defaultRole).toBe('viewer');
      expect(DEFAULT_AUTH_CONFIG.roleMapping.anonymousRole).toBeNull();
      expect(DEFAULT_AUTH_CONFIG.roleMapping.groupRoles).toEqual({});
    });
  });

  describe('createAnonymousUser', () => {
    it('should create anonymous user with given roles', () => {
      const user = createAnonymousUser(['admin']);

      expect(user.id).toBe('anonymous');
      expect(user.username).toBe('Anonymous');
      expect(user.roles).toEqual(['admin']);
      expect(user.authSource).toBe('anonymous');
    });

    it('should handle multiple roles', () => {
      const user = createAnonymousUser(['viewer', 'operator']);
      expect(user.roles).toEqual(['viewer', 'operator']);
    });
  });

  describe('extractOAuth2ProxyUser', () => {
    it('should return null when user header is missing', () => {
      const req = mockRequest({});
      const user = extractOAuth2ProxyUser(req, DEFAULT_AUTH_CONFIG);
      expect(user).toBeNull();
    });

    it('should extract user from oauth2-proxy headers', () => {
      const req = mockRequest({
        'x-forwarded-user': 'jdoe',
        'x-forwarded-email': 'jdoe@example.com',
        'x-forwarded-preferred-username': 'John Doe',
        'x-forwarded-groups': 'admins,developers'
      });

      const user = extractOAuth2ProxyUser(req, DEFAULT_AUTH_CONFIG);

      expect(user).not.toBeNull();
      expect(user?.id).toBe('jdoe');
      expect(user?.username).toBe('John Doe');
      expect(user?.email).toBe('jdoe@example.com');
      expect(user?.groups).toEqual(['admins', 'developers']);
      expect(user?.authSource).toBe('header');
      expect(user?.roles).toEqual([]);  // Roles resolved later by middleware
    });

    it('should use userId as username when name header is missing', () => {
      const req = mockRequest({
        'x-forwarded-user': 'jdoe'
      });

      const user = extractOAuth2ProxyUser(req, DEFAULT_AUTH_CONFIG);
      expect(user?.username).toBe('jdoe');
    });

    it('should handle custom header names from config', () => {
      const config = {
        ...DEFAULT_AUTH_CONFIG,
        headers: {
          ...DEFAULT_AUTH_CONFIG.headers,
          userId: 'x-custom-user',
          email: 'x-custom-email'
        }
      };

      const req = mockRequest({
        'x-custom-user': 'custom-user-id',
        'x-custom-email': 'custom@example.com'
      });

      const user = extractOAuth2ProxyUser(req, config);
      expect(user?.id).toBe('custom-user-id');
      expect(user?.email).toBe('custom@example.com');
    });

    it('should trim whitespace from group names', () => {
      const req = mockRequest({
        'x-forwarded-user': 'jdoe',
        'x-forwarded-groups': ' admins , developers , managers '
      });

      const user = extractOAuth2ProxyUser(req, DEFAULT_AUTH_CONFIG);
      expect(user?.groups).toEqual(['admins', 'developers', 'managers']);
    });
  });

  describe('extractAzureEasyAuthUser', () => {
    it('should return null when no Azure headers present', () => {
      const req = mockRequest({});
      const user = extractAzureEasyAuthUser(req);
      expect(user).toBeNull();
    });

    it('should extract user from x-ms-client-principal-name header only', () => {
      const req = mockRequest({
        'x-ms-client-principal-name': 'jdoe@example.com'
      });

      const user = extractAzureEasyAuthUser(req);

      expect(user).not.toBeNull();
      expect(user?.id).toBe('jdoe@example.com');
      expect(user?.username).toBe('jdoe@example.com');
      expect(user?.authSource).toBe('header');
    });

    it('should decode base64 principal header', () => {
      const principalData = {
        userId: 'azure-user-id',
        userDetails: 'jdoe@contoso.com',
        claims: [
          { typ: 'email', val: 'jdoe@contoso.com' },
          { typ: 'groups', val: 'admins' },
          { typ: 'groups', val: 'developers' }
        ]
      };

      const base64Principal = Buffer.from(JSON.stringify(principalData)).toString('base64');

      const req = mockRequest({
        'x-ms-client-principal': base64Principal,
        'x-ms-client-principal-name': 'John Doe'
      });

      const user = extractAzureEasyAuthUser(req);

      expect(user).not.toBeNull();
      expect(user?.id).toBe('azure-user-id');
      expect(user?.username).toBe('John Doe');
      expect(user?.email).toBe('jdoe@contoso.com');
      expect(user?.groups).toEqual(['admins', 'developers']);
    });

    it('should handle malformed base64 gracefully', () => {
      const req = mockRequest({
        'x-ms-client-principal': 'not-valid-base64!!!',
        'x-ms-client-principal-name': 'John Doe'
      });

      const user = extractAzureEasyAuthUser(req);

      expect(user).not.toBeNull();
      expect(user?.username).toBe('John Doe');
      expect(user?.id).toBe('John Doe');
    });

    it('should handle malformed JSON in base64 gracefully', () => {
      const invalidJson = Buffer.from('not valid json').toString('base64');

      const req = mockRequest({
        'x-ms-client-principal': invalidJson,
        'x-ms-client-principal-name': 'John Doe'
      });

      const user = extractAzureEasyAuthUser(req);

      expect(user).not.toBeNull();
      expect(user?.username).toBe('John Doe');
    });

    it('should extract email from standard XML claim type', () => {
      const principalData = {
        claims: [
          {
            typ: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
            val: 'jdoe@contoso.com'
          }
        ]
      };

      const base64Principal = Buffer.from(JSON.stringify(principalData)).toString('base64');

      const req = mockRequest({
        'x-ms-client-principal': base64Principal,
        'x-ms-client-principal-name': 'John Doe'
      });

      const user = extractAzureEasyAuthUser(req);
      expect(user?.email).toBe('jdoe@contoso.com');
    });

    it('should extract groups from Microsoft claim type', () => {
      const principalData = {
        claims: [
          {
            typ: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups',
            val: 'group-id-1'
          },
          {
            typ: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups',
            val: 'group-id-2'
          }
        ]
      };

      const base64Principal = Buffer.from(JSON.stringify(principalData)).toString('base64');

      const req = mockRequest({
        'x-ms-client-principal': base64Principal,
        'x-ms-client-principal-name': 'John Doe'
      });

      const user = extractAzureEasyAuthUser(req);
      expect(user?.groups).toEqual(['group-id-1', 'group-id-2']);
    });
  });

  describe('extractGenericProxyUser', () => {
    it('should return null when no user header present', () => {
      const req = mockRequest({});
      const user = extractGenericProxyUser(req, DEFAULT_AUTH_CONFIG);
      expect(user).toBeNull();
    });

    it('should extract from x-remote-user header', () => {
      const req = mockRequest({
        'x-remote-user': 'jdoe',
        'x-remote-email': 'jdoe@example.com',
        'x-remote-groups': 'admins,developers'
      });

      const user = extractGenericProxyUser(req, DEFAULT_AUTH_CONFIG);

      expect(user).not.toBeNull();
      expect(user?.id).toBe('jdoe');
      expect(user?.username).toBe('jdoe');
      expect(user?.email).toBe('jdoe@example.com');
      expect(user?.groups).toEqual(['admins', 'developers']);
    });

    it('should extract from remote-user header (without x- prefix)', () => {
      const req = mockRequest({
        'remote-user': 'jdoe'
      });

      const user = extractGenericProxyUser(req, DEFAULT_AUTH_CONFIG);
      expect(user?.id).toBe('jdoe');
    });

    it('should fall back to configured userId header', () => {
      const req = mockRequest({
        'x-forwarded-user': 'jdoe'
      });

      const user = extractGenericProxyUser(req, DEFAULT_AUTH_CONFIG);
      expect(user?.id).toBe('jdoe');
    });
  });

  describe('extractUserFromRequest', () => {
    it('should return null when no headers present', () => {
      const req = mockRequest({});
      const user = extractUserFromRequest(req, DEFAULT_AUTH_CONFIG);
      expect(user).toBeNull();
    });

    it('should prefer Azure EasyAuth headers over oauth2-proxy', () => {
      const req = mockRequest({
        'x-ms-client-principal-name': 'Azure User',
        'x-forwarded-user': 'oauth2-user'
      });

      const user = extractUserFromRequest(req, DEFAULT_AUTH_CONFIG);
      expect(user?.username).toBe('Azure User');
    });

    it('should try oauth2-proxy when Azure headers not present', () => {
      const req = mockRequest({
        'x-forwarded-user': 'oauth2-user',
        'x-forwarded-preferred-username': 'OAuth2 User'
      });

      const user = extractUserFromRequest(req, DEFAULT_AUTH_CONFIG);
      expect(user?.username).toBe('OAuth2 User');
    });

    it('should fall back to generic proxy headers', () => {
      const req = mockRequest({
        'x-remote-user': 'generic-user'
      });

      const user = extractUserFromRequest(req, DEFAULT_AUTH_CONFIG);
      expect(user?.id).toBe('generic-user');
    });
  });
});
