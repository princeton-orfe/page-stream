import { Router, Request, Response, NextFunction } from 'express';
import { requireCapability } from '../auth/index.js';
import { listUsers, assignUserRole, removeUserRole, getRoles } from '../db/users.js';
import { logAuditEvent } from '../db/audit.js';

const router = Router();

// Async handler wrapper for cleaner error handling
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// GET /api/auth/me - Get current user info
router.get('/me', (req, res) => {
  res.json({
    user: {
      id: req.ctx.user.id,
      username: req.ctx.user.username,
      email: req.ctx.user.email,
      roles: req.ctx.user.roles,
      authSource: req.ctx.user.authSource
    },
    capabilities: Array.from(req.ctx.capabilities)
  });
});

// GET /api/auth/capabilities - List all capabilities (for UI)
router.get('/capabilities', (req, res) => {
  res.json({
    capabilities: Array.from(req.ctx.capabilities),
    // Helper booleans for common checks
    canControl: req.ctx.hasAnyCapability('streams:start', 'streams:stop'),
    canManage: req.ctx.hasAnyCapability('streams:create', 'streams:update', 'streams:delete'),
    canAdmin: req.ctx.hasCapability('users:manage')
  });
});

// GET /api/auth/users - List all users (admin only)
router.get(
  '/users',
  requireCapability('users:list'),
  asyncHandler(async (_req, res) => {
    const users = listUsers();
    res.json({ users });
  })
);

// GET /api/auth/roles - List all roles (admin only)
router.get(
  '/roles',
  requireCapability('users:list'),
  asyncHandler(async (_req, res) => {
    const roles = getRoles();
    res.json({ roles });
  })
);

// PUT /api/auth/users/:id/roles - Update user roles (admin only)
router.put(
  '/users/:id/roles',
  requireCapability('users:manage'),
  asyncHandler(async (req, res) => {
    const { roles } = req.body;
    const targetUserId = req.params.id;

    // Validate roles is an array of strings
    if (!Array.isArray(roles) || !roles.every(r => typeof r === 'string')) {
      res.status(400).json({ error: 'Invalid roles: must be an array of strings' });
      return;
    }

    // Get current users to find target
    const currentUsers = listUsers();
    const targetUser = currentUsers.find(u => u.id === targetUserId);

    if (!targetUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Calculate changes
    const toAdd = roles.filter((r: string) => !targetUser.roles.includes(r));
    const toRemove = targetUser.roles.filter((r: string) => !roles.includes(r));

    // Apply changes
    for (const roleId of toAdd) {
      assignUserRole(targetUserId, roleId, req.ctx.user.id);
    }
    for (const roleId of toRemove) {
      removeUserRole(targetUserId, roleId);
    }

    // Audit log
    logAuditEvent(req.ctx.user, 'users:update_roles', {
      resourceType: 'user',
      resourceId: targetUserId,
      details: { added: toAdd, removed: toRemove, newRoles: roles }
    });

    res.json({ success: true, roles });
  })
);

export default router;
