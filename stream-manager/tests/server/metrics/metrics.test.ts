/**
 * Tests for Prometheus metrics endpoint
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';

// Mock the database and external modules - must be before imports
vi.mock('../../../src/server/docker.js', () => ({
  listStreamContainers: vi.fn().mockResolvedValue([])
}));

vi.mock('../../../src/server/db/users.js', () => ({
  getActiveUsersCount: vi.fn().mockReturnValue(5),
  getRecentApiRequestsByUser: vi.fn().mockReturnValue([
    { userId: 'user1', username: 'alice', requestCount: 100 },
    { userId: 'user2', username: 'bob', requestCount: 50 }
  ])
}));

vi.mock('../../../src/server/alerts/storage.js', () => ({
  getAlertRuleCount: vi.fn().mockReturnValue(10),
  getAlertEventCountByState: vi.fn().mockReturnValue({
    active: 3,
    acknowledged: 2,
    resolved: 15
  })
}));

vi.mock('../../../src/server/schedules/storage.js', () => ({
  getScheduleStats: vi.fn().mockReturnValue({
    total: 8,
    enabled: 5,
    disabled: 3
  })
}));

vi.mock('../../../src/server/groups/storage.js', () => ({
  getGroupCount: vi.fn().mockReturnValue(4)
}));

import metricsRouter, {
  aggregateContainerMetrics,
  escapeLabel,
  formatPrometheusMetrics,
  metricsState,
  METRICS_CACHE_TTL
} from '../../../src/server/metrics/index.js';
import { StreamContainer } from '../../../src/server/docker.js';

describe('Prometheus Metrics', () => {
  describe('escapeLabel', () => {
    it('escapes backslashes', () => {
      expect(escapeLabel('path\\to\\file')).toBe('path\\\\to\\\\file');
    });

    it('escapes double quotes', () => {
      expect(escapeLabel('say "hello"')).toBe('say \\"hello\\"');
    });

    it('escapes newlines', () => {
      expect(escapeLabel('line1\nline2')).toBe('line1\\nline2');
    });

    it('handles multiple special characters', () => {
      expect(escapeLabel('a\\b"c\nd')).toBe('a\\\\b\\"c\\nd');
    });

    it('returns empty string unchanged', () => {
      expect(escapeLabel('')).toBe('');
    });

    it('returns normal string unchanged', () => {
      expect(escapeLabel('normal-user_123')).toBe('normal-user_123');
    });
  });

  describe('aggregateContainerMetrics', () => {
    it('aggregates empty container list', () => {
      const result = aggregateContainerMetrics([]);
      expect(result).toEqual({
        total: 0,
        byStatus: { running: 0, stopped: 0, restarting: 0, exited: 0 },
        byHealth: { healthy: 0, unhealthy: 0, starting: 0, none: 0 }
      });
    });

    it('counts containers by status', () => {
      const containers: StreamContainer[] = [
        { id: '1', name: 'c1', status: 'running', health: 'none', created: '', image: '', labels: {}, ports: [] },
        { id: '2', name: 'c2', status: 'running', health: 'none', created: '', image: '', labels: {}, ports: [] },
        { id: '3', name: 'c3', status: 'stopped', health: 'none', created: '', image: '', labels: {}, ports: [] },
        { id: '4', name: 'c4', status: 'exited', health: 'none', created: '', image: '', labels: {}, ports: [] }
      ];

      const result = aggregateContainerMetrics(containers);
      expect(result.total).toBe(4);
      expect(result.byStatus.running).toBe(2);
      expect(result.byStatus.stopped).toBe(1);
      expect(result.byStatus.exited).toBe(1);
      expect(result.byStatus.restarting).toBe(0);
    });

    it('counts containers by health', () => {
      const containers: StreamContainer[] = [
        { id: '1', name: 'c1', status: 'running', health: 'healthy', created: '', image: '', labels: {}, ports: [] },
        { id: '2', name: 'c2', status: 'running', health: 'healthy', created: '', image: '', labels: {}, ports: [] },
        { id: '3', name: 'c3', status: 'running', health: 'unhealthy', created: '', image: '', labels: {}, ports: [] },
        { id: '4', name: 'c4', status: 'running', health: 'starting', created: '', image: '', labels: {}, ports: [] },
        { id: '5', name: 'c5', status: 'stopped', health: 'none', created: '', image: '', labels: {}, ports: [] }
      ];

      const result = aggregateContainerMetrics(containers);
      expect(result.byHealth.healthy).toBe(2);
      expect(result.byHealth.unhealthy).toBe(1);
      expect(result.byHealth.starting).toBe(1);
      expect(result.byHealth.none).toBe(1);
    });
  });

  describe('formatPrometheusMetrics', () => {
    beforeEach(() => {
      // Reset metrics state for each test
      metricsState.lastCollectionTime = Date.now();
      metricsState.containerMetrics = {
        total: 5,
        byStatus: { running: 3, stopped: 1, restarting: 0, exited: 1 },
        byHealth: { healthy: 2, unhealthy: 1, starting: 0, none: 2 }
      };
      metricsState.userMetrics = {
        activeUsers: 5,
        requestsByUser: [
          { userId: 'user1', username: 'alice', requestCount: 100 }
        ]
      };
      metricsState.alertMetrics = {
        rulesTotal: 10,
        eventsByState: { active: 3, acknowledged: 2, resolved: 15 }
      };
      metricsState.scheduleMetrics = {
        total: 8,
        enabled: 5,
        disabled: 3
      };
      metricsState.groupMetrics = {
        total: 4
      };
    });

    it('formats container metrics in Prometheus format', () => {
      const output = formatPrometheusMetrics();

      expect(output).toContain('# HELP stream_manager_containers_total');
      expect(output).toContain('# TYPE stream_manager_containers_total gauge');
      expect(output).toContain('stream_manager_containers_total 5');

      expect(output).toContain('stream_manager_containers_by_status{status="running"} 3');
      expect(output).toContain('stream_manager_containers_by_status{status="stopped"} 1');
      expect(output).toContain('stream_manager_containers_by_status{status="exited"} 1');

      expect(output).toContain('stream_manager_containers_by_health{health="healthy"} 2');
      expect(output).toContain('stream_manager_containers_by_health{health="unhealthy"} 1');
    });

    it('formats user metrics', () => {
      const output = formatPrometheusMetrics();

      expect(output).toContain('# HELP stream_manager_active_users');
      expect(output).toContain('stream_manager_active_users 5');
    });

    it('includes per-user request metrics when enabled', () => {
      const originalEnv = process.env.METRICS_INCLUDE_USER_REQUESTS;
      process.env.METRICS_INCLUDE_USER_REQUESTS = 'true';

      const output = formatPrometheusMetrics();

      expect(output).toContain('stream_manager_api_requests_by_user{user="alice"} 100');

      process.env.METRICS_INCLUDE_USER_REQUESTS = originalEnv;
    });

    it('excludes per-user request metrics when disabled', () => {
      const originalEnv = process.env.METRICS_INCLUDE_USER_REQUESTS;
      delete process.env.METRICS_INCLUDE_USER_REQUESTS;

      const output = formatPrometheusMetrics();

      expect(output).not.toContain('stream_manager_api_requests_by_user');

      process.env.METRICS_INCLUDE_USER_REQUESTS = originalEnv;
    });

    it('formats alert metrics', () => {
      const output = formatPrometheusMetrics();

      expect(output).toContain('# HELP stream_manager_alert_rules_total');
      expect(output).toContain('stream_manager_alert_rules_total 10');

      expect(output).toContain('stream_manager_alert_events_by_state{state="active"} 3');
      expect(output).toContain('stream_manager_alert_events_by_state{state="acknowledged"} 2');
      expect(output).toContain('stream_manager_alert_events_by_state{state="resolved"} 15');
    });

    it('formats schedule metrics', () => {
      const output = formatPrometheusMetrics();

      expect(output).toContain('stream_manager_schedules_total 8');
      expect(output).toContain('stream_manager_schedules_enabled 5');
      expect(output).toContain('stream_manager_schedules_disabled 3');
    });

    it('formats group metrics', () => {
      const output = formatPrometheusMetrics();

      expect(output).toContain('stream_manager_groups_total 4');
    });

    it('includes application info', () => {
      const output = formatPrometheusMetrics();

      expect(output).toContain('# HELP stream_manager_info');
      expect(output).toContain('stream_manager_info{version="1.0.0"} 1');
    });

    it('outputs valid Prometheus format with timestamps', () => {
      const output = formatPrometheusMetrics();

      // Each metric line should have a timestamp
      const lines = output.split('\n').filter(l => l && !l.startsWith('#'));
      for (const line of lines) {
        // Metric format: name{labels} value timestamp
        const parts = line.split(' ');
        expect(parts.length).toBeGreaterThanOrEqual(2);
        // Last part should be a number (timestamp)
        const timestamp = parseInt(parts[parts.length - 1]);
        expect(timestamp).toBeGreaterThan(0);
      }
    });
  });

  describe('API endpoint', () => {
    let app: Express;
    const originalMetricsApiKey = process.env.METRICS_API_KEY;
    const originalMetricsEnabled = process.env.METRICS_ENABLED;

    beforeEach(() => {
      delete process.env.METRICS_API_KEY;
      delete process.env.METRICS_ENABLED;

      app = express();
      app.use('/metrics', metricsRouter);
    });

    afterEach(() => {
      if (originalMetricsApiKey !== undefined) {
        process.env.METRICS_API_KEY = originalMetricsApiKey;
      } else {
        delete process.env.METRICS_API_KEY;
      }

      if (originalMetricsEnabled !== undefined) {
        process.env.METRICS_ENABLED = originalMetricsEnabled;
      } else {
        delete process.env.METRICS_ENABLED;
      }
    });

    it('returns metrics in Prometheus format', async () => {
      const res = await request(app)
        .get('/metrics')
        .expect(200);

      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.text).toContain('# HELP stream_manager_');
      expect(res.text).toContain('# TYPE stream_manager_');
    });

    it('allows access without API key when not configured', async () => {
      delete process.env.METRICS_API_KEY;

      const res = await request(app)
        .get('/metrics')
        .expect(200);

      expect(res.headers['content-type']).toContain('text/plain');
    });

    it('rejects access without API key when configured', async () => {
      process.env.METRICS_API_KEY = 'secret-key';

      const res = await request(app)
        .get('/metrics')
        .expect(401);

      expect(res.body.error).toBe('Invalid or missing API key');
    });

    it('accepts valid Bearer token', async () => {
      process.env.METRICS_API_KEY = 'secret-key';

      const res = await request(app)
        .get('/metrics')
        .set('Authorization', 'Bearer secret-key')
        .expect(200);

      expect(res.headers['content-type']).toContain('text/plain');
    });

    it('rejects invalid Bearer token', async () => {
      process.env.METRICS_API_KEY = 'secret-key';

      await request(app)
        .get('/metrics')
        .set('Authorization', 'Bearer wrong-key')
        .expect(401);
    });

    it('accepts valid api_key query parameter', async () => {
      process.env.METRICS_API_KEY = 'secret-key';

      const res = await request(app)
        .get('/metrics?api_key=secret-key')
        .expect(200);

      expect(res.headers['content-type']).toContain('text/plain');
    });

    it('rejects invalid api_key query parameter', async () => {
      process.env.METRICS_API_KEY = 'secret-key';

      await request(app)
        .get('/metrics?api_key=wrong-key')
        .expect(401);
    });

    it('returns 404 when metrics are disabled', async () => {
      process.env.METRICS_ENABLED = 'false';

      const res = await request(app)
        .get('/metrics')
        .expect(404);

      expect(res.body.error).toBe('Metrics endpoint is disabled');
    });
  });

  describe('Metrics caching', () => {
    it('has a 15 second cache TTL', () => {
      expect(METRICS_CACHE_TTL).toBe(15000);
    });
  });
});
