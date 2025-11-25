import { Router, Request, Response, NextFunction } from 'express';
import { requireCapability } from '../auth/index.js';
import { queryAuditLog, AuditEntry } from '../db/audit.js';

const router = Router();

// Async handler wrapper for cleaner error handling
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// GET /api/audit - Query audit log
router.get(
  '/',
  requireCapability('audit:read'),
  asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const userId = req.query.userId as string | undefined;
    const action = req.query.action as string | undefined;
    const resourceType = req.query.resourceType as string | undefined;
    const since = req.query.since as string | undefined;

    // Validate limit and offset
    if (isNaN(limit) || limit < 1 || limit > 1000) {
      res.status(400).json({ error: 'Invalid limit: must be between 1 and 1000' });
      return;
    }
    if (isNaN(offset) || offset < 0) {
      res.status(400).json({ error: 'Invalid offset: must be >= 0' });
      return;
    }

    // Validate since is a valid ISO date if provided
    if (since) {
      const sinceDate = new Date(since);
      if (isNaN(sinceDate.getTime())) {
        res.status(400).json({ error: 'Invalid since: must be a valid ISO date' });
        return;
      }
    }

    const result = queryAuditLog({
      limit,
      offset,
      userId,
      action,
      resourceType,
      since
    });

    res.json({
      entries: result.entries,
      total: result.total,
      limit,
      offset,
      hasMore: offset + result.entries.length < result.total
    });
  })
);

// GET /api/audit/actions - Get distinct actions for filter dropdown
router.get(
  '/actions',
  requireCapability('audit:read'),
  asyncHandler(async (_req, res) => {
    // This will be used by the frontend to populate filter dropdowns
    // For now, return a static list of known actions
    const knownActions = [
      'stream:start',
      'stream:stop',
      'stream:restart',
      'stream:refresh',
      'users:update_roles'
    ];
    res.json({ actions: knownActions });
  })
);

// GET /api/audit/export - Export audit log as CSV
router.get(
  '/export',
  requireCapability('audit:read'),
  asyncHandler(async (req, res) => {
    const userId = req.query.userId as string | undefined;
    const action = req.query.action as string | undefined;
    const resourceType = req.query.resourceType as string | undefined;
    const since = req.query.since as string | undefined;

    // Validate since is a valid ISO date if provided
    if (since) {
      const sinceDate = new Date(since);
      if (isNaN(sinceDate.getTime())) {
        res.status(400).json({ error: 'Invalid since: must be a valid ISO date' });
        return;
      }
    }

    // Get all matching entries (up to 10000)
    const result = queryAuditLog({
      limit: 10000,
      offset: 0,
      userId,
      action,
      resourceType,
      since
    });

    // Build CSV
    const headers = ['timestamp', 'userId', 'username', 'action', 'resourceType', 'resourceId', 'result', 'error', 'details'];
    const rows = result.entries.map((entry: AuditEntry) => [
      entry.timestamp,
      entry.userId,
      entry.username,
      entry.action,
      entry.resourceType || '',
      entry.resourceId || '',
      entry.result,
      entry.error || '',
      entry.details ? JSON.stringify(entry.details) : ''
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  })
);

export default router;
