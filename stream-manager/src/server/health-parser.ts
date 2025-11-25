export interface HealthStatus {
  timestamp: string;
  uptimeSec: number;
  ingest: string;
  protocol: 'SRT' | 'RTMP' | 'FILE' | 'UNKNOWN';
  restartAttempt: number;
  lastFfmpegExitCode: number | null;
  retrying: boolean;
  infobarDismissTried?: boolean;
}

interface RawHealthPayload {
  type?: string;
  ts?: string;
  uptimeSec?: number;
  ingest?: string;
  protocol?: string;
  restartAttempt?: number;
  lastFfmpegExitCode?: number | null;
  retrying?: boolean;
  infobarDismissTried?: boolean;
}

const HEALTH_PREFIX = '[health]';

function normalizeProtocol(protocol?: string): HealthStatus['protocol'] {
  if (!protocol) return 'UNKNOWN';
  const upper = protocol.toUpperCase();
  if (upper === 'SRT') return 'SRT';
  if (upper === 'RTMP') return 'RTMP';
  if (upper === 'FILE') return 'FILE';
  return 'UNKNOWN';
}

/**
 * Parse a single log line, return HealthStatus if it's a health line, null otherwise
 */
export function parseHealthLine(line: string): HealthStatus | null {
  // Try [health] prefixed format first
  let jsonStr: string | null = null;

  if (line.includes(HEALTH_PREFIX)) {
    const idx = line.indexOf(HEALTH_PREFIX);
    jsonStr = line.slice(idx + HEALTH_PREFIX.length).trim();
  } else if (line.trim().startsWith('{')) {
    // Try raw JSON line
    jsonStr = line.trim();
  }

  if (!jsonStr) {
    return null;
  }

  try {
    const payload = JSON.parse(jsonStr) as RawHealthPayload;

    // Validate it's a health payload
    if (payload.type !== 'health' && payload.uptimeSec === undefined) {
      return null;
    }

    return {
      timestamp: payload.ts || new Date().toISOString(),
      uptimeSec: payload.uptimeSec ?? 0,
      ingest: payload.ingest || '',
      protocol: normalizeProtocol(payload.protocol),
      restartAttempt: payload.restartAttempt ?? 0,
      lastFfmpegExitCode: payload.lastFfmpegExitCode ?? null,
      retrying: payload.retrying ?? false,
      infobarDismissTried: payload.infobarDismissTried
    };
  } catch {
    // Malformed JSON, ignore
    return null;
  }
}

/**
 * Extract all health entries from an array of log lines
 * Returns entries in chronological order (oldest first)
 */
export function extractHealthHistory(lines: string[]): HealthStatus[] {
  const history: HealthStatus[] = [];

  for (const line of lines) {
    const health = parseHealthLine(line);
    if (health) {
      history.push(health);
    }
  }

  // Sort by timestamp ascending (oldest first)
  history.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return history;
}

/**
 * Get the most recent health status from log lines
 * Returns null if no health entries found
 */
export function getLatestHealth(lines: string[]): HealthStatus | null {
  const history = extractHealthHistory(lines);
  return history.length > 0 ? history[history.length - 1] : null;
}

/**
 * Classify log line type for highlighting
 */
export function classifyLogLine(line: string): 'health' | 'error' | 'warn' | 'info' | 'normal' {
  const lowerLine = line.toLowerCase();

  if (line.includes(HEALTH_PREFIX)) {
    return 'health';
  }

  if (
    lowerLine.includes('error') ||
    lowerLine.includes('exception') ||
    lowerLine.includes('failed') ||
    lowerLine.includes('fatal')
  ) {
    return 'error';
  }

  if (
    lowerLine.includes('warn') ||
    lowerLine.includes('warning') ||
    lowerLine.includes('deprecated')
  ) {
    return 'warn';
  }

  if (
    lowerLine.includes('info') ||
    lowerLine.includes('starting') ||
    lowerLine.includes('connected') ||
    lowerLine.includes('ready')
  ) {
    return 'info';
  }

  return 'normal';
}
