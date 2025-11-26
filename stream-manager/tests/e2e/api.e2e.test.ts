/**
 * E2E API Tests
 *
 * These tests run against a real stream-manager instance.
 * They verify the API endpoints work correctly in a production-like environment.
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';

// Helper for making API requests
async function api(path: string, options: RequestInit = {}) {
  const url = `${API_BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return {
    status: response.status,
    headers: response.headers,
    body: response.headers.get('content-type')?.includes('application/json')
      ? await response.json()
      : await response.text(),
  };
}

describe('E2E: Health Check', () => {
  it('should return health status', async () => {
    const response = await api('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.authMode).toBeDefined();
  });
});

describe('E2E: Authentication', () => {
  it('should return anonymous user without auth headers', async () => {
    const response = await api('/api/auth/me');

    expect(response.status).toBe(200);
    expect(response.body.user).toBeDefined();
    expect(response.body.user.id).toBe('anonymous');
    expect(response.body.capabilities).toBeDefined();
    expect(Array.isArray(response.body.capabilities)).toBe(true);
  });

  it('should authenticate via proxy headers', async () => {
    const response = await api('/api/auth/me', {
      headers: {
        'x-forwarded-user': 'e2e-test-user',
        'x-forwarded-email': 'e2e@test.example.com',
        'x-forwarded-preferred-username': 'E2E Test User',
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe('e2e-test-user');
    expect(response.body.user.email).toBe('e2e@test.example.com');
    expect(response.body.user.username).toBe('E2E Test User');
  });

  it('should return roles list', async () => {
    const response = await api('/api/auth/roles');

    expect(response.status).toBe(200);
    expect(response.body.roles).toBeDefined();
    expect(Array.isArray(response.body.roles)).toBe(true);

    // Should have built-in roles
    const roleNames = response.body.roles.map((r: { name: string }) => r.name);
    expect(roleNames).toContain('viewer');
    expect(roleNames).toContain('operator');
    expect(roleNames).toContain('admin');
  });
});

describe('E2E: Streams API', () => {
  it('should list streams', async () => {
    const response = await api('/api/streams');

    expect(response.status).toBe(200);
    expect(response.body.streams).toBeDefined();
    expect(Array.isArray(response.body.streams)).toBe(true);
    expect(response.body.timestamp).toBeDefined();
  });

  it('should return 404 for non-existent stream', async () => {
    const response = await api('/api/streams/non-existent-container-id');

    expect(response.status).toBe(404);
  });
});

describe('E2E: Templates API', () => {
  it('should list templates', async () => {
    const response = await api('/api/templates');

    expect(response.status).toBe(200);
    expect(response.body.templates).toBeDefined();
    expect(Array.isArray(response.body.templates)).toBe(true);
  });
});

describe('E2E: Alerts API', () => {
  it('should list alert rules', async () => {
    const response = await api('/api/alerts/rules');

    expect(response.status).toBe(200);
    expect(response.body.rules).toBeDefined();
    expect(Array.isArray(response.body.rules)).toBe(true);
  });

  it('should list alert history', async () => {
    const response = await api('/api/alerts/history');

    expect(response.status).toBe(200);
    expect(response.body.alerts).toBeDefined();
    expect(Array.isArray(response.body.alerts)).toBe(true);
  });
});

describe('E2E: Audit Log API', () => {
  it('should list audit logs (viewer cannot access)', async () => {
    // Viewer role doesn't have audit:view capability
    const response = await api('/api/audit');

    // Should be forbidden for viewer role
    expect(response.status).toBe(403);
  });

  it('should allow admin to view audit logs', async () => {
    const response = await api('/api/audit', {
      headers: {
        'x-forwarded-user': 'admin-user',
        'x-forwarded-groups': 'admin',
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.entries).toBeDefined();
    expect(Array.isArray(response.body.entries)).toBe(true);
  });
});

describe('E2E: Metrics Endpoint', () => {
  it('should expose Prometheus metrics', async () => {
    const response = await api('/metrics');

    expect(response.status).toBe(200);
    expect(typeof response.body).toBe('string');
    expect(response.body).toContain('stream_manager_');
    expect(response.body).toContain('# HELP');
    expect(response.body).toContain('# TYPE');
  });
});

describe('E2E: RBAC Enforcement', () => {
  it('should deny viewer from creating streams', async () => {
    const response = await api('/api/streams', {
      method: 'POST',
      body: JSON.stringify({
        name: 'test-stream',
        config: {
          url: 'https://example.com',
          width: 1920,
          height: 1080,
        },
      }),
    });

    expect(response.status).toBe(403);
  });

  it('should deny viewer from stopping containers', async () => {
    const response = await api('/api/streams/some-container-id/stop', {
      method: 'POST',
    });

    // 403 for unauthorized, or 404 if container doesn't exist (either is valid)
    expect([403, 404]).toContain(response.status);
  });
});

describe('E2E: Security Headers', () => {
  it('should include security headers', async () => {
    const response = await api('/api/health');

    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });

  it('should include CORS headers for allowed origins', async () => {
    const url = `${API_BASE_URL}/api/health`;
    const response = await fetch(url, {
      headers: {
        'Origin': 'http://localhost:3000',
      },
    });

    // CORS should be configured
    expect(response.headers.get('access-control-allow-origin')).toBeTruthy();
  });
});
