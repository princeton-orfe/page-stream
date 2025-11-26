import { Router, Request, Response, NextFunction } from 'express';
import { requireCapability } from '../auth/index.js';
import {
  querySecurityEvents,
  getSecuritySummary,
  getElevatedPrivilegeUsers,
  getUnusualActivityPatterns,
  SecurityEventType,
} from '../security/index.js';

const router = Router();

// Async handler wrapper for cleaner error handling
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// GET /api/security/events - List security events (admin only)
router.get(
  '/events',
  requireCapability('audit:read'),
  asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const eventType = req.query.eventType as SecurityEventType | undefined;
    const userId = req.query.userId as string | undefined;
    const ipAddress = req.query.ipAddress as string | undefined;
    const severity = req.query.severity as 'info' | 'warning' | 'critical' | undefined;
    const since = req.query.since as string | undefined;

    const result = querySecurityEvents({
      limit,
      offset,
      eventType,
      userId,
      ipAddress,
      severity,
      since,
    });

    res.json(result);
  })
);

// GET /api/security/summary - Security dashboard summary (admin only)
router.get(
  '/summary',
  requireCapability('audit:read'),
  asyncHandler(async (req, res) => {
    const since = req.query.since as string | undefined;
    const summary = getSecuritySummary(since);
    res.json(summary);
  })
);

// GET /api/security/elevated-users - Users with elevated privileges (admin only)
router.get(
  '/elevated-users',
  requireCapability('users:list'),
  asyncHandler(async (_req, res) => {
    const users = getElevatedPrivilegeUsers();
    res.json({ users });
  })
);

// GET /api/security/unusual-activity - Unusual activity patterns (admin only)
router.get(
  '/unusual-activity',
  requireCapability('audit:read'),
  asyncHandler(async (req, res) => {
    const since = req.query.since as string | undefined;
    const patterns = getUnusualActivityPatterns(since);
    res.json(patterns);
  })
);

// GET /api/security/audit - Full security audit report (admin only)
router.get(
  '/audit',
  requireCapability('audit:read'),
  requireCapability('users:list'),
  asyncHandler(async (req, res) => {
    // Default to last 24 hours
    const hoursBack = parseInt(req.query.hours as string) || 24;
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

    // Gather all security information
    const summary = getSecuritySummary(since);
    const elevatedUsers = getElevatedPrivilegeUsers();
    const unusualActivity = getUnusualActivityPatterns(since);
    const recentEvents = querySecurityEvents({ limit: 100, since });

    res.json({
      generatedAt: new Date().toISOString(),
      periodStart: since,
      periodHours: hoursBack,
      summary,
      elevatedUsers,
      unusualActivity,
      recentEvents: recentEvents.events,
      recommendations: generateRecommendations(summary, elevatedUsers, unusualActivity),
    });
  })
);

// Generate security recommendations based on the audit data
function generateRecommendations(
  summary: ReturnType<typeof getSecuritySummary>,
  elevatedUsers: ReturnType<typeof getElevatedPrivilegeUsers>,
  unusualActivity: ReturnType<typeof getUnusualActivityPatterns>
): string[] {
  const recommendations: string[] = [];

  // Check for high number of auth failures
  const authFailures = summary.byType['auth:failure'] || 0;
  if (authFailures > 100) {
    recommendations.push(
      `High number of authentication failures (${authFailures}). Consider investigating potential brute force attempts.`
    );
  }

  // Check for trusted proxy violations
  const proxyViolations = summary.byType['trusted_proxy:violation'] || 0;
  if (proxyViolations > 0) {
    recommendations.push(
      `${proxyViolations} trusted proxy violation(s) detected. Review your proxy configuration and ensure auth headers are only accepted from trusted sources.`
    );
  }

  // Check for rate limit violations
  const rateLimitExceeded = summary.byType['rate_limit:exceeded'] || 0;
  if (rateLimitExceeded > 50) {
    recommendations.push(
      `High number of rate limit violations (${rateLimitExceeded}). Consider adjusting rate limits or investigating abusive clients.`
    );
  }

  // Check for too many admins
  const adminCount = elevatedUsers.filter(u => u.roles.includes('admin')).length;
  if (adminCount > 5) {
    recommendations.push(
      `${adminCount} users have admin privileges. Consider applying the principle of least privilege.`
    );
  }

  // Check for stale admin accounts
  const staleAdmins = elevatedUsers.filter(u => {
    if (!u.lastSeen) return true;
    const lastSeen = new Date(u.lastSeen);
    const daysSinceLastSeen = (Date.now() - lastSeen.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceLastSeen > 30 && u.roles.includes('admin');
  });
  if (staleAdmins.length > 0) {
    recommendations.push(
      `${staleAdmins.length} admin user(s) haven't been seen in over 30 days. Consider reviewing their access.`
    );
  }

  // Check for high-frequency users
  if (unusualActivity.highFrequencyUsers.length > 0) {
    recommendations.push(
      `${unusualActivity.highFrequencyUsers.length} user(s) with unusually high request counts detected. Verify this is expected behavior.`
    );
  }

  // Check for after-hours activity
  if (unusualActivity.afterHoursActivity.length > 10) {
    recommendations.push(
      `Significant after-hours activity detected (${unusualActivity.afterHoursActivity.length} events). Review if this is expected.`
    );
  }

  // Check for critical events
  const criticalCount = summary.bySeverity['critical'] || 0;
  if (criticalCount > 0) {
    recommendations.push(
      `${criticalCount} critical security event(s) detected. Immediate review recommended.`
    );
  }

  if (recommendations.length === 0) {
    recommendations.push('No significant security concerns detected in the review period.');
  }

  return recommendations;
}

export default router;
