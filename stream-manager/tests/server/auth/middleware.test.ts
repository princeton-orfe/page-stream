import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  createAuthMiddleware,
  requireCapability,
  requireAnyCapability,
  RoleStore
} from '../../../src/server/auth/middleware.js';
import { BUILT_IN_ROLES } from '../../../src/server/auth/rbac.js';
import { DEFAULT_AUTH_CONFIG, AuthConfig } from '../../../src/server/auth/extractors.js';

// Mock Express request/response
function mockRequest(headers: Record<string, string> = {}, options: {
  remoteAddress?: string;
  path?: string;
  method?: string;
} = {}): Request {
  return {
    headers,
    socket: { remoteAddress: options.remoteAddress || '127.0.0.1' },
    ip: options.remoteAddress || '127.0.0.1',
    path: options.path || '/api/test',
    method: options.method || 'GET',
  } as unknown as Request;
}

function mockResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  };
  return res as unknown as Response;
}

function mockNext(): NextFunction {
  return vi.fn() as NextFunction;
}

// Mock role store
function createMockRoleStore(options: {
  userRoles?: Record<string, string[]>;
} = {}): RoleStore {
  return {
    getRoles: vi.fn().mockResolvedValue(BUILT_IN_ROLES),
    getUserRoles: vi.fn().mockImplementation(async (userId: string) => {
      return options.userRoles?.[userId] || [];
    }),
    mapGroupsToRoles: vi.fn().mockImplementation((groups: string[], config: AuthConfig) => {
      const roles: string[] = [];
      for (const group of groups) {
        const mappedRoles = config.roleMapping.groupRoles[group];
        if (mappedRoles) roles.push(...mappedRoles);
      }
      return [...new Set(roles)];
    })
  };
}

describe('Auth Middleware', () => {
  describe('createAuthMiddleware', () => {
    it('should create admin user when mode is none', async () => {
      const config: AuthConfig = { ...DEFAULT_AUTH_CONFIG, mode: 'none' };
      const roleStore = createMockRoleStore();
      const middleware = createAuthMiddleware(config, roleStore);

      const req = mockRequest();
      const res = mockResponse();
      const next = mockNext();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.ctx).toBeDefined();
      expect(req.ctx.user.id).toBe('anonymous');
      expect(req.ctx.user.roles).toContain('admin');
      expect(req.ctx.hasCapability('users:manage')).toBe(true);
    });

    it('should extract user from headers when mode is proxy', async () => {
      const config: AuthConfig = { ...DEFAULT_AUTH_CONFIG, mode: 'proxy' };
      const roleStore = createMockRoleStore();
      const middleware = createAuthMiddleware(config, roleStore);

      const req = mockRequest({
        'x-forwarded-user': 'jdoe',
        'x-forwarded-preferred-username': 'John Doe',
        'x-forwarded-email': 'jdoe@example.com'
      });
      const res = mockResponse();
      const next = mockNext();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.ctx.user.id).toBe('jdoe');
      expect(req.ctx.user.username).toBe('John Doe');
      expect(req.ctx.user.email).toBe('jdoe@example.com');
    });

    it('should resolve roles from groups via config mapping', async () => {
      const config: AuthConfig = {
        ...DEFAULT_AUTH_CONFIG,
        mode: 'proxy',
        roleMapping: {
          ...DEFAULT_AUTH_CONFIG.roleMapping,
          groupRoles: { 'admins': ['admin'], 'operators': ['operator'] }
        }
      };
      const roleStore = createMockRoleStore();
      const middleware = createAuthMiddleware(config, roleStore);

      const req = mockRequest({
        'x-forwarded-user': 'jdoe',
        'x-forwarded-groups': 'admins,operators'
      });
      const res = mockResponse();
      const next = mockNext();

      await middleware(req, res, next);

      expect(roleStore.mapGroupsToRoles).toHaveBeenCalledWith(
        ['admins', 'operators'],
        expect.any(Object)
      );
      expect(req.ctx.user.roles).toContain('admin');
      expect(req.ctx.user.roles).toContain('operator');
    });

    it('should combine group roles with DB roles', async () => {
      const config: AuthConfig = {
        ...DEFAULT_AUTH_CONFIG,
        mode: 'proxy',
        roleMapping: {
          ...DEFAULT_AUTH_CONFIG.roleMapping,
          groupRoles: { 'operators': ['operator'] }
        }
      };
      const roleStore = createMockRoleStore({
        userRoles: { 'jdoe': ['editor'] }
      });
      const middleware = createAuthMiddleware(config, roleStore);

      const req = mockRequest({
        'x-forwarded-user': 'jdoe',
        'x-forwarded-groups': 'operators'
      });
      const res = mockResponse();
      const next = mockNext();

      await middleware(req, res, next);

      expect(req.ctx.user.roles).toContain('operator');
      expect(req.ctx.user.roles).toContain('editor');
    });

    it('should use default role when no roles resolved', async () => {
      const config: AuthConfig = {
        ...DEFAULT_AUTH_CONFIG,
        mode: 'proxy',
        roleMapping: {
          ...DEFAULT_AUTH_CONFIG.roleMapping,
          defaultRole: 'viewer'
        }
      };
      const roleStore = createMockRoleStore();
      const middleware = createAuthMiddleware(config, roleStore);

      const req = mockRequest({
        'x-forwarded-user': 'jdoe'
      });
      const res = mockResponse();
      const next = mockNext();

      await middleware(req, res, next);

      expect(req.ctx.user.roles).toContain('viewer');
    });

    it('should allow anonymous access when anonymousRole is set', async () => {
      const config: AuthConfig = {
        ...DEFAULT_AUTH_CONFIG,
        mode: 'proxy',
        roleMapping: {
          ...DEFAULT_AUTH_CONFIG.roleMapping,
          anonymousRole: 'viewer'
        }
      };
      const roleStore = createMockRoleStore();
      const middleware = createAuthMiddleware(config, roleStore);

      const req = mockRequest(); // No headers
      const res = mockResponse();
      const next = mockNext();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.ctx.user.id).toBe('anonymous');
      expect(req.ctx.user.roles).toContain('viewer');
    });

    it('should return 401 when no user and anonymous not allowed', async () => {
      const config: AuthConfig = {
        ...DEFAULT_AUTH_CONFIG,
        mode: 'proxy',
        roleMapping: {
          ...DEFAULT_AUTH_CONFIG.roleMapping,
          anonymousRole: null
        }
      };
      const roleStore = createMockRoleStore();
      const middleware = createAuthMiddleware(config, roleStore);

      const req = mockRequest(); // No headers
      const res = mockResponse();
      const next = mockNext();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Authentication required',
        message: 'No user identity found in request headers'
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next with error on exception', async () => {
      const config: AuthConfig = { ...DEFAULT_AUTH_CONFIG, mode: 'proxy' };
      const error = new Error('Database error');
      const roleStore: RoleStore = {
        getRoles: vi.fn().mockRejectedValue(error),
        getUserRoles: vi.fn(),
        mapGroupsToRoles: vi.fn()
      };
      const middleware = createAuthMiddleware(config, roleStore);

      const req = mockRequest({ 'x-forwarded-user': 'jdoe' });
      const res = mockResponse();
      const next = mockNext();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('requireCapability', () => {
    let req: Request;
    let res: Response;
    let next: NextFunction;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();
      next = mockNext();
    });

    it('should return 500 when ctx not initialized', () => {
      const middleware = requireCapability('streams:list');

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Auth context not initialized' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next when user has required capability', () => {
      // Set up context with viewer role
      req.ctx = {
        user: { id: 'jdoe', username: 'John', roles: ['viewer'], authSource: 'header' },
        capabilities: new Set(['streams:list', 'streams:read']),
        hasCapability: (cap) => ['streams:list', 'streams:read'].includes(cap),
        hasAnyCapability: (...caps) => caps.some(c => ['streams:list', 'streams:read'].includes(c)),
        hasAllCapabilities: (...caps) => caps.every(c => ['streams:list', 'streams:read'].includes(c))
      };

      const middleware = requireCapability('streams:list');

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 403 when user lacks required capability', () => {
      req.ctx = {
        user: { id: 'jdoe', username: 'John', roles: ['viewer'], authSource: 'header' },
        capabilities: new Set(['streams:list', 'streams:read']),
        hasCapability: (cap) => ['streams:list', 'streams:read'].includes(cap),
        hasAnyCapability: (...caps) => caps.some(c => ['streams:list', 'streams:read'].includes(c)),
        hasAllCapabilities: (...caps) => caps.every(c => ['streams:list', 'streams:read'].includes(c))
      };

      const middleware = requireCapability('streams:start');

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Forbidden',
        message: 'Missing required capabilities: streams:start',
        required: ['streams:start'],
        missing: ['streams:start']
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should check multiple required capabilities', () => {
      req.ctx = {
        user: { id: 'jdoe', username: 'John', roles: ['viewer'], authSource: 'header' },
        capabilities: new Set(['streams:list']),
        hasCapability: (cap) => cap === 'streams:list',
        hasAnyCapability: (...caps) => caps.includes('streams:list'),
        hasAllCapabilities: (...caps) => caps.every(c => c === 'streams:list')
      };

      const middleware = requireCapability('streams:list', 'streams:start');

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        missing: ['streams:start']
      }));
    });
  });

  describe('requireAnyCapability', () => {
    let req: Request;
    let res: Response;
    let next: NextFunction;

    beforeEach(() => {
      req = mockRequest();
      res = mockResponse();
      next = mockNext();
    });

    it('should call next when user has at least one capability', () => {
      req.ctx = {
        user: { id: 'jdoe', username: 'John', roles: ['viewer'], authSource: 'header' },
        capabilities: new Set(['streams:list']),
        hasCapability: (cap) => cap === 'streams:list',
        hasAnyCapability: (...caps) => caps.includes('streams:list'),
        hasAllCapabilities: (...caps) => caps.every(c => c === 'streams:list')
      };

      const middleware = requireAnyCapability('streams:list', 'streams:start');

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should return 403 when user has none of the capabilities', () => {
      req.ctx = {
        user: { id: 'jdoe', username: 'John', roles: ['viewer'], authSource: 'header' },
        capabilities: new Set(['streams:logs']),
        hasCapability: (cap) => cap === 'streams:logs',
        hasAnyCapability: (...caps) => caps.includes('streams:logs'),
        hasAllCapabilities: (...caps) => caps.every(c => c === 'streams:logs')
      };

      const middleware = requireAnyCapability('streams:start', 'streams:stop');

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Forbidden',
        message: 'Requires at least one of: streams:start, streams:stop',
        required: ['streams:start', 'streams:stop']
      });
    });
  });
});
