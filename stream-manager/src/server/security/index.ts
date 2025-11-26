import { getDatabase } from '../db/index.js';

// Security event types
export type SecurityEventType =
  | 'auth:success'
  | 'auth:failure'
  | 'auth:anonymous'
  | 'permission:denied'
  | 'rate_limit:exceeded'
  | 'trusted_proxy:violation'
  | 'suspicious:activity';

export interface SecurityEvent {
  id: number;
  timestamp: string;
  eventType: SecurityEventType;
  userId?: string;
  username?: string;
  ipAddress: string;
  userAgent?: string;
  requestPath: string;
  requestMethod: string;
  details?: Record<string, unknown>;
  severity: 'info' | 'warning' | 'critical';
}

interface SecurityEventRow {
  id: number;
  timestamp: string;
  event_type: string;
  user_id: string | null;
  username: string | null;
  ip_address: string;
  user_agent: string | null;
  request_path: string;
  request_method: string;
  details: string | null;
  severity: string;
}

interface CountRow {
  count: number;
}

// Log a security event to the database
export function logSecurityEvent(
  eventType: SecurityEventType,
  options: {
    userId?: string;
    username?: string;
    ipAddress: string;
    userAgent?: string;
    requestPath: string;
    requestMethod: string;
    details?: Record<string, unknown>;
    severity?: 'info' | 'warning' | 'critical';
  }
): void {
  // Try to get database, silently fail if not initialized (e.g., in tests)
  let db;
  try {
    db = getDatabase();
  } catch {
    // Database not initialized - skip logging
    return;
  }

  // Default severity based on event type
  const defaultSeverity: Record<SecurityEventType, 'info' | 'warning' | 'critical'> = {
    'auth:success': 'info',
    'auth:failure': 'warning',
    'auth:anonymous': 'info',
    'permission:denied': 'warning',
    'rate_limit:exceeded': 'warning',
    'trusted_proxy:violation': 'critical',
    'suspicious:activity': 'critical',
  };

  const severity = options.severity || defaultSeverity[eventType];

  try {
    db.prepare(`
      INSERT INTO security_events (
        event_type, user_id, username, ip_address, user_agent,
        request_path, request_method, details, severity
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventType,
      options.userId || null,
      options.username || null,
      options.ipAddress,
      options.userAgent || null,
      options.requestPath,
      options.requestMethod,
      options.details ? JSON.stringify(options.details) : null,
      severity
    );
  } catch {
    // Silently fail if table doesn't exist (e.g., in tests)
  }
}

// Query security events
export function querySecurityEvents(options: {
  limit?: number;
  offset?: number;
  eventType?: SecurityEventType;
  userId?: string;
  ipAddress?: string;
  severity?: 'info' | 'warning' | 'critical';
  since?: string;
}): { events: SecurityEvent[]; total: number } {
  const db = getDatabase();

  let where = '1=1';
  const params: (string | number)[] = [];

  if (options.eventType) {
    where += ' AND event_type = ?';
    params.push(options.eventType);
  }
  if (options.userId) {
    where += ' AND user_id = ?';
    params.push(options.userId);
  }
  if (options.ipAddress) {
    where += ' AND ip_address = ?';
    params.push(options.ipAddress);
  }
  if (options.severity) {
    where += ' AND severity = ?';
    params.push(options.severity);
  }
  if (options.since) {
    where += ' AND timestamp >= ?';
    params.push(options.since);
  }

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM security_events WHERE ${where}`).get(...params) as CountRow;
  const total = countRow.count;

  const limit = options.limit || 100;
  const offset = options.offset || 0;

  const rows = db.prepare(`
    SELECT * FROM security_events
    WHERE ${where}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as SecurityEventRow[];

  return {
    events: rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      eventType: row.event_type as SecurityEventType,
      userId: row.user_id || undefined,
      username: row.username || undefined,
      ipAddress: row.ip_address,
      userAgent: row.user_agent || undefined,
      requestPath: row.request_path,
      requestMethod: row.request_method,
      details: row.details ? JSON.parse(row.details) : undefined,
      severity: row.severity as 'info' | 'warning' | 'critical',
    })),
    total,
  };
}

// Get security summary for dashboard
export function getSecuritySummary(since?: string): {
  totalEvents: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  recentCritical: SecurityEvent[];
  topOffendingIps: Array<{ ip: string; count: number }>;
} {
  const db = getDatabase();

  const sinceClause = since ? 'WHERE timestamp >= ?' : '';
  const params = since ? [since] : [];

  // Total count
  const totalRow = db.prepare(`SELECT COUNT(*) as count FROM security_events ${sinceClause}`).get(...params) as CountRow;

  // By type
  interface TypeCountRow { event_type: string; count: number }
  const typeRows = db.prepare(`
    SELECT event_type, COUNT(*) as count
    FROM security_events
    ${sinceClause}
    GROUP BY event_type
  `).all(...params) as TypeCountRow[];

  const byType: Record<string, number> = {};
  for (const row of typeRows) {
    byType[row.event_type] = row.count;
  }

  // By severity
  interface SeverityCountRow { severity: string; count: number }
  const severityRows = db.prepare(`
    SELECT severity, COUNT(*) as count
    FROM security_events
    ${sinceClause}
    GROUP BY severity
  `).all(...params) as SeverityCountRow[];

  const bySeverity: Record<string, number> = {};
  for (const row of severityRows) {
    bySeverity[row.severity] = row.count;
  }

  // Recent critical events
  const criticalRows = db.prepare(`
    SELECT * FROM security_events
    WHERE severity = 'critical'
    ${since ? 'AND timestamp >= ?' : ''}
    ORDER BY timestamp DESC
    LIMIT 10
  `).all(...params) as SecurityEventRow[];

  const recentCritical = criticalRows.map(row => ({
    id: row.id,
    timestamp: row.timestamp,
    eventType: row.event_type as SecurityEventType,
    userId: row.user_id || undefined,
    username: row.username || undefined,
    ipAddress: row.ip_address,
    userAgent: row.user_agent || undefined,
    requestPath: row.request_path,
    requestMethod: row.request_method,
    details: row.details ? JSON.parse(row.details) : undefined,
    severity: row.severity as 'info' | 'warning' | 'critical',
  }));

  // Top offending IPs (non-successful auth)
  interface IpCountRow { ip_address: string; count: number }
  const ipRows = db.prepare(`
    SELECT ip_address, COUNT(*) as count
    FROM security_events
    WHERE event_type IN ('auth:failure', 'permission:denied', 'rate_limit:exceeded', 'trusted_proxy:violation', 'suspicious:activity')
    ${since ? 'AND timestamp >= ?' : ''}
    GROUP BY ip_address
    ORDER BY count DESC
    LIMIT 10
  `).all(...params) as IpCountRow[];

  const topOffendingIps = ipRows.map(row => ({
    ip: row.ip_address,
    count: row.count,
  }));

  return {
    totalEvents: totalRow.count,
    byType,
    bySeverity,
    recentCritical,
    topOffendingIps,
  };
}

// Convert JavaScript Date to SQLite timestamp format (YYYY-MM-DD HH:MM:SS)
function toSqliteTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

// Get failed auth attempts for an IP in a time window (for detecting brute force)
export function getFailedAuthAttemptsForIp(ipAddress: string, windowMinutes: number = 15): number {
  const db = getDatabase();

  const since = toSqliteTimestamp(new Date(Date.now() - windowMinutes * 60 * 1000));

  const row = db.prepare(`
    SELECT COUNT(*) as count
    FROM security_events
    WHERE ip_address = ?
      AND event_type = 'auth:failure'
      AND timestamp >= ?
  `).get(ipAddress, since) as CountRow;

  return row.count;
}

// Get users with elevated privileges (admin role)
export function getElevatedPrivilegeUsers(): Array<{ userId: string; username: string; roles: string[]; lastSeen?: string }> {
  const db = getDatabase();

  interface UserRoleRow {
    user_id: string;
    username: string;
    last_seen: string | null;
    role_id: string;
  }

  const rows = db.prepare(`
    SELECT u.id as user_id, u.username, u.last_seen, ur.role_id
    FROM users u
    JOIN user_roles ur ON u.id = ur.user_id
    WHERE ur.role_id IN ('admin', 'editor', 'operator')
    ORDER BY u.username
  `).all() as UserRoleRow[];

  // Group by user
  const userMap = new Map<string, { userId: string; username: string; roles: string[]; lastSeen?: string }>();

  for (const row of rows) {
    const existing = userMap.get(row.user_id);
    if (existing) {
      existing.roles.push(row.role_id);
    } else {
      userMap.set(row.user_id, {
        userId: row.user_id,
        username: row.username,
        roles: [row.role_id],
        lastSeen: row.last_seen || undefined,
      });
    }
  }

  return Array.from(userMap.values());
}

// Get unusual activity patterns
export function getUnusualActivityPatterns(since?: string): {
  highFrequencyUsers: Array<{ userId: string; username: string; requestCount: number }>;
  afterHoursActivity: Array<{ userId: string; username: string; timestamp: string; requestPath: string }>;
  unusualEndpoints: Array<{ requestPath: string; count: number }>;
} {
  const db = getDatabase();

  // Default to last 24 hours - convert to SQLite format if generating
  const sinceValue = since || toSqliteTimestamp(new Date(Date.now() - 24 * 60 * 60 * 1000));

  // High frequency users (more than 1000 requests in the time window)
  interface FrequencyRow { user_id: string; username: string; request_count: number }
  const frequencyRows = db.prepare(`
    SELECT user_id, username, COUNT(*) as request_count
    FROM security_events
    WHERE timestamp >= ?
      AND user_id IS NOT NULL
    GROUP BY user_id, username
    HAVING COUNT(*) > 1000
    ORDER BY request_count DESC
    LIMIT 20
  `).all(sinceValue) as FrequencyRow[];

  const highFrequencyUsers = frequencyRows.map(row => ({
    userId: row.user_id,
    username: row.username,
    requestCount: row.request_count,
  }));

  // After hours activity (between 11 PM and 6 AM local time, based on timestamp hour)
  interface AfterHoursRow { user_id: string; username: string; timestamp: string; request_path: string }
  const afterHoursRows = db.prepare(`
    SELECT user_id, username, timestamp, request_path
    FROM security_events
    WHERE timestamp >= ?
      AND user_id IS NOT NULL
      AND (
        CAST(strftime('%H', timestamp) AS INTEGER) >= 23
        OR CAST(strftime('%H', timestamp) AS INTEGER) < 6
      )
      AND event_type NOT IN ('auth:success', 'auth:anonymous')
    ORDER BY timestamp DESC
    LIMIT 50
  `).all(sinceValue) as AfterHoursRow[];

  const afterHoursActivity = afterHoursRows.map(row => ({
    userId: row.user_id,
    username: row.username,
    timestamp: row.timestamp,
    requestPath: row.request_path,
  }));

  // Unusual endpoints (admin/sensitive endpoints with high access counts)
  interface EndpointRow { request_path: string; count: number }
  const endpointRows = db.prepare(`
    SELECT request_path, COUNT(*) as count
    FROM security_events
    WHERE timestamp >= ?
      AND (
        request_path LIKE '%/admin%'
        OR request_path LIKE '%/users%'
        OR request_path LIKE '%/roles%'
        OR request_path LIKE '%/audit%'
        OR request_path LIKE '%/security%'
      )
    GROUP BY request_path
    ORDER BY count DESC
    LIMIT 20
  `).all(sinceValue) as EndpointRow[];

  const unusualEndpoints = endpointRows.map(row => ({
    requestPath: row.request_path,
    count: row.count,
  }));

  return {
    highFrequencyUsers,
    afterHoursActivity,
    unusualEndpoints,
  };
}
