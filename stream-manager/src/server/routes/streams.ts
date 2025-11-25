import { Router, Request, Response, NextFunction } from 'express';
import { requireCapability } from '../auth/index.js';
import { listStreamContainers, getContainer, getRecentLogs } from '../docker.js';
import { getLatestHealth, extractHealthHistory } from '../health-parser.js';

const router = Router();

// Async handler wrapper for cleaner error handling
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// GET /api/streams - List all streams
router.get(
  '/',
  requireCapability('streams:list'),
  asyncHandler(async (req, res) => {
    const streams = await listStreamContainers();
    res.json({ streams, timestamp: new Date().toISOString() });
  })
);

// GET /api/streams/:id - Get stream details
router.get(
  '/:id',
  requireCapability('streams:read'),
  asyncHandler(async (req, res) => {
    const stream = await getContainer(req.params.id);
    if (!stream) {
      res.status(404).json({ error: 'Stream not found' });
      return;
    }

    const logs = await getRecentLogs(req.params.id, 100);
    const health = getLatestHealth(logs);

    res.json({ stream, health, recentLogs: logs });
  })
);

// GET /api/streams/:id/logs
router.get(
  '/:id/logs',
  requireCapability('streams:logs'),
  asyncHandler(async (req, res) => {
    // First check if container exists
    const stream = await getContainer(req.params.id);
    if (!stream) {
      res.status(404).json({ error: 'Stream not found' });
      return;
    }

    const lines = parseInt(req.query.lines as string) || 100;
    const logs = await getRecentLogs(req.params.id, lines);
    res.json({ logs, hasMore: logs.length === lines });
  })
);

// GET /api/streams/:id/health/history
router.get(
  '/:id/health/history',
  requireCapability('streams:health'),
  asyncHandler(async (req, res) => {
    // First check if container exists
    const stream = await getContainer(req.params.id);
    if (!stream) {
      res.status(404).json({ error: 'Stream not found' });
      return;
    }

    const limit = parseInt(req.query.limit as string) || 50;
    const logs = await getRecentLogs(req.params.id, 500);
    const history = extractHealthHistory(logs).slice(0, limit);
    res.json({ history, latest: history[history.length - 1] || null });
  })
);

export default router;
