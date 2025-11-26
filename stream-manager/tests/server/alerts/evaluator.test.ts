import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing evaluator
vi.mock('../../../src/server/alerts/storage.js', () => ({
  getEnabledAlertRules: vi.fn(),
  getAlertRulesForTarget: vi.fn(),
  createAlertEvent: vi.fn(),
  recordAlertTriggered: vi.fn(),
  getRecentEventsForRule: vi.fn(),
  resolveAlertEvent: vi.fn(),
  getActiveEvents: vi.fn()
}));

vi.mock('../../../src/server/alerts/notifications.js', () => ({
  sendNotifications: vi.fn()
}));

vi.mock('../../../src/server/docker.js', () => ({
  listStreamContainers: vi.fn(),
  getContainer: vi.fn()
}));

vi.mock('../../../src/server/config/storage.js', () => ({
  listStreamConfigs: vi.fn()
}));

vi.mock('../../../src/server/compositor/storage.js', () => ({
  listCompositorConfigs: vi.fn()
}));

import {
  startAlertEvaluator,
  stopAlertEvaluator,
  isAlertEvaluatorRunning,
  getAlertEvaluatorStatus,
  triggerScheduleFailedAlert
} from '../../../src/server/alerts/evaluator.js';
import * as storage from '../../../src/server/alerts/storage.js';
import * as notifications from '../../../src/server/alerts/notifications.js';
import * as docker from '../../../src/server/docker.js';
import * as configStorage from '../../../src/server/config/storage.js';
import * as compositorStorage from '../../../src/server/compositor/storage.js';

// Sample test data
const mockAlertRule = {
  id: 'rule-123',
  name: 'test-alert',
  enabled: true,
  targetType: 'stream' as const,
  targetId: 'config-456',
  condition: { type: 'status_changed' as const, statusTo: 'stopped' },
  severity: 'warning' as const,
  notifications: [{ type: 'webhook' as const, url: 'https://example.com/hook' }],
  cooldownMinutes: 15,
  triggerCount: 0,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  createdBy: 'test-user'
};

const mockStreamConfig = {
  id: 'config-456',
  name: 'test-stream',
  type: 'standard' as const,
  enabled: true,
  url: 'https://example.com',
  width: 1920,
  height: 1080,
  fps: 30,
  cropInfobar: 0,
  preset: 'veryfast' as const,
  videoBitrate: '2500k',
  audioBitrate: '128k',
  format: 'mpegts' as const,
  ingest: 'srt://localhost:9000',
  autoRefreshSeconds: 0,
  reconnectAttempts: 0,
  reconnectInitialDelayMs: 1000,
  reconnectMaxDelayMs: 30000,
  healthIntervalSeconds: 30,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  createdBy: 'test-user'
};

const mockContainer = {
  id: 'container-789',
  name: 'test-stream',
  status: 'running' as const,
  health: 'healthy' as const,
  created: '2024-01-01T00:00:00Z',
  image: 'page-stream:latest',
  labels: {},
  ports: []
};

describe('Alert Evaluator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Stop any running evaluator
    stopAlertEvaluator();

    // Default mock implementations
    vi.mocked(storage.getEnabledAlertRules).mockReturnValue([]);
    vi.mocked(storage.getActiveEvents).mockReturnValue([]);
    vi.mocked(docker.listStreamContainers).mockResolvedValue([]);
    vi.mocked(configStorage.listStreamConfigs).mockReturnValue({ configs: [], total: 0 });
    vi.mocked(compositorStorage.listCompositorConfigs).mockReturnValue({ configs: [], total: 0 });
    vi.mocked(notifications.sendNotifications).mockResolvedValue([]);
  });

  afterEach(() => {
    stopAlertEvaluator();
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  describe('startAlertEvaluator', () => {
    it('should start the evaluator', async () => {
      expect(isAlertEvaluatorRunning()).toBe(false);

      startAlertEvaluator();

      expect(isAlertEvaluatorRunning()).toBe(true);

      // Should run immediately
      await vi.advanceTimersByTimeAsync(0);
      expect(docker.listStreamContainers).toHaveBeenCalledTimes(1);
    });

    it('should not start twice if already running', async () => {
      startAlertEvaluator();
      await vi.advanceTimersByTimeAsync(0);

      startAlertEvaluator();
      await vi.advanceTimersByTimeAsync(0);

      // Should still only be one poll
      expect(docker.listStreamContainers).toHaveBeenCalledTimes(1);
    });

    it('should poll at regular intervals', async () => {
      startAlertEvaluator();

      // Initial run
      await vi.advanceTimersByTimeAsync(0);
      expect(docker.listStreamContainers).toHaveBeenCalledTimes(1);

      // After 30 seconds
      await vi.advanceTimersByTimeAsync(30000);
      expect(docker.listStreamContainers).toHaveBeenCalledTimes(2);

      // After another 30 seconds
      await vi.advanceTimersByTimeAsync(30000);
      expect(docker.listStreamContainers).toHaveBeenCalledTimes(3);
    });
  });

  describe('stopAlertEvaluator', () => {
    it('should stop the evaluator', async () => {
      startAlertEvaluator();
      await vi.advanceTimersByTimeAsync(0);

      expect(isAlertEvaluatorRunning()).toBe(true);

      stopAlertEvaluator();

      expect(isAlertEvaluatorRunning()).toBe(false);

      // Should not poll after stopping
      await vi.advanceTimersByTimeAsync(60000);
      expect(docker.listStreamContainers).toHaveBeenCalledTimes(1);
    });
  });

  describe('getAlertEvaluatorStatus', () => {
    it('should return status when not running', () => {
      const status = getAlertEvaluatorStatus();

      expect(status.running).toBe(false);
      expect(status.pollIntervalMs).toBe(30000);
      expect(status.trackedContainers).toBe(0);
    });

    it('should return status when running', async () => {
      vi.mocked(docker.listStreamContainers).mockResolvedValue([
        mockContainer,
        { ...mockContainer, id: 'container-2', name: 'stream-2' }
      ]);

      startAlertEvaluator();
      await vi.advanceTimersByTimeAsync(0);

      const status = getAlertEvaluatorStatus();

      expect(status.running).toBe(true);
      expect(status.trackedContainers).toBe(2);
    });
  });

  describe('Alert Evaluation', () => {
    beforeEach(() => {
      vi.mocked(configStorage.listStreamConfigs).mockReturnValue({
        configs: [mockStreamConfig],
        total: 1
      });
      vi.mocked(compositorStorage.listCompositorConfigs).mockReturnValue({
        configs: [],
        total: 0
      });
    });

    describe('status_changed condition', () => {
      it('should trigger alert when status changes to target status', async () => {
        const rule = {
          ...mockAlertRule,
          condition: { type: 'status_changed' as const, statusTo: 'stopped' }
        };
        vi.mocked(storage.getEnabledAlertRules).mockReturnValue([rule]);
        vi.mocked(storage.createAlertEvent).mockReturnValue({
          id: 'event-1',
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          targetType: 'stream',
          targetId: mockStreamConfig.id,
          targetName: mockStreamConfig.name,
          condition: rule.condition,
          message: 'Test message',
          createdAt: new Date().toISOString()
        });

        // First poll - container running
        vi.mocked(docker.listStreamContainers).mockResolvedValue([mockContainer]);
        startAlertEvaluator();
        await vi.advanceTimersByTimeAsync(0);

        // Second poll - container stopped
        vi.mocked(docker.listStreamContainers).mockResolvedValue([
          { ...mockContainer, status: 'stopped' }
        ]);
        await vi.advanceTimersByTimeAsync(30000);

        expect(storage.createAlertEvent).toHaveBeenCalled();
        expect(storage.recordAlertTriggered).toHaveBeenCalledWith(rule.id, true);
        expect(notifications.sendNotifications).toHaveBeenCalled();
      });

      it('should trigger alert when status changes from specific status', async () => {
        const rule = {
          ...mockAlertRule,
          condition: { type: 'status_changed' as const, statusFrom: 'running', statusTo: 'stopped' }
        };
        vi.mocked(storage.getEnabledAlertRules).mockReturnValue([rule]);
        vi.mocked(storage.createAlertEvent).mockReturnValue({
          id: 'event-1',
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          targetType: 'stream',
          targetId: mockStreamConfig.id,
          targetName: mockStreamConfig.name,
          condition: rule.condition,
          message: 'Test message',
          createdAt: new Date().toISOString()
        });

        // First poll - container running
        vi.mocked(docker.listStreamContainers).mockResolvedValue([mockContainer]);
        startAlertEvaluator();
        await vi.advanceTimersByTimeAsync(0);

        // Second poll - container stopped
        vi.mocked(docker.listStreamContainers).mockResolvedValue([
          { ...mockContainer, status: 'stopped' }
        ]);
        await vi.advanceTimersByTimeAsync(30000);

        expect(storage.createAlertEvent).toHaveBeenCalled();
      });

      it('should not trigger when status changes from wrong status', async () => {
        const rule = {
          ...mockAlertRule,
          condition: { type: 'status_changed' as const, statusFrom: 'restarting', statusTo: 'stopped' }
        };
        vi.mocked(storage.getEnabledAlertRules).mockReturnValue([rule]);

        // First poll - container running (not restarting)
        vi.mocked(docker.listStreamContainers).mockResolvedValue([mockContainer]);
        startAlertEvaluator();
        await vi.advanceTimersByTimeAsync(0);

        // Second poll - container stopped
        vi.mocked(docker.listStreamContainers).mockResolvedValue([
          { ...mockContainer, status: 'stopped' }
        ]);
        await vi.advanceTimersByTimeAsync(30000);

        expect(storage.createAlertEvent).not.toHaveBeenCalled();
      });
    });

    describe('health_unhealthy condition', () => {
      it('should trigger alert when health becomes unhealthy', async () => {
        const rule = {
          ...mockAlertRule,
          condition: { type: 'health_unhealthy' as const }
        };
        vi.mocked(storage.getEnabledAlertRules).mockReturnValue([rule]);
        vi.mocked(storage.createAlertEvent).mockReturnValue({
          id: 'event-1',
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          targetType: 'stream',
          targetId: mockStreamConfig.id,
          targetName: mockStreamConfig.name,
          condition: rule.condition,
          message: 'Test message',
          createdAt: new Date().toISOString()
        });

        // First poll - healthy
        vi.mocked(docker.listStreamContainers).mockResolvedValue([mockContainer]);
        startAlertEvaluator();
        await vi.advanceTimersByTimeAsync(0);

        // Second poll - unhealthy
        vi.mocked(docker.listStreamContainers).mockResolvedValue([
          { ...mockContainer, health: 'unhealthy' }
        ]);
        await vi.advanceTimersByTimeAsync(30000);

        expect(storage.createAlertEvent).toHaveBeenCalled();
      });
    });

    describe('restart_count condition', () => {
      it('should trigger alert when restart count exceeds threshold', async () => {
        const rule = {
          ...mockAlertRule,
          condition: { type: 'restart_count' as const, threshold: 3, timeWindowSeconds: 3600 }
        };
        vi.mocked(storage.getEnabledAlertRules).mockReturnValue([rule]);
        vi.mocked(storage.createAlertEvent).mockReturnValue({
          id: 'event-1',
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          targetType: 'stream',
          targetId: mockStreamConfig.id,
          targetName: mockStreamConfig.name,
          condition: rule.condition,
          message: 'Test message',
          createdAt: new Date().toISOString()
        });

        // First poll - running
        vi.mocked(docker.listStreamContainers).mockResolvedValue([mockContainer]);
        startAlertEvaluator();
        await vi.advanceTimersByTimeAsync(0);

        // Simulate restarts by cycling status
        for (let i = 0; i < 3; i++) {
          // Stop
          vi.mocked(docker.listStreamContainers).mockResolvedValue([
            { ...mockContainer, status: 'stopped' }
          ]);
          await vi.advanceTimersByTimeAsync(30000);

          // Start (counts as restart)
          vi.mocked(docker.listStreamContainers).mockResolvedValue([mockContainer]);
          await vi.advanceTimersByTimeAsync(30000);
        }

        expect(storage.createAlertEvent).toHaveBeenCalled();
      });
    });

    describe('Cooldown', () => {
      it('should respect cooldown period', async () => {
        const rule = {
          ...mockAlertRule,
          cooldownMinutes: 5,
          lastNotified: new Date(Date.now() - 60000).toISOString() // 1 minute ago
        };
        vi.mocked(storage.getEnabledAlertRules).mockReturnValue([rule]);

        // First poll - running
        vi.mocked(docker.listStreamContainers).mockResolvedValue([mockContainer]);
        startAlertEvaluator();
        await vi.advanceTimersByTimeAsync(0);

        // Second poll - stopped
        vi.mocked(docker.listStreamContainers).mockResolvedValue([
          { ...mockContainer, status: 'stopped' }
        ]);
        await vi.advanceTimersByTimeAsync(30000);

        // Should record trigger but not send notification (in cooldown)
        expect(storage.recordAlertTriggered).toHaveBeenCalledWith(rule.id, false);
        expect(notifications.sendNotifications).not.toHaveBeenCalled();
      });

      it('should send notification after cooldown expires', async () => {
        const rule = {
          ...mockAlertRule,
          cooldownMinutes: 1,
          lastNotified: new Date(Date.now() - 120000).toISOString() // 2 minutes ago
        };
        vi.mocked(storage.getEnabledAlertRules).mockReturnValue([rule]);
        vi.mocked(storage.createAlertEvent).mockReturnValue({
          id: 'event-1',
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          targetType: 'stream',
          targetId: mockStreamConfig.id,
          targetName: mockStreamConfig.name,
          condition: rule.condition,
          message: 'Test message',
          createdAt: new Date().toISOString()
        });

        // First poll - running
        vi.mocked(docker.listStreamContainers).mockResolvedValue([mockContainer]);
        startAlertEvaluator();
        await vi.advanceTimersByTimeAsync(0);

        // Second poll - stopped
        vi.mocked(docker.listStreamContainers).mockResolvedValue([
          { ...mockContainer, status: 'stopped' }
        ]);
        await vi.advanceTimersByTimeAsync(30000);

        expect(storage.recordAlertTriggered).toHaveBeenCalledWith(rule.id, true);
        expect(notifications.sendNotifications).toHaveBeenCalled();
      });
    });

    describe('Alert Resolution', () => {
      it('should resolve status_changed alerts when status changes again', async () => {
        vi.mocked(storage.getActiveEvents).mockReturnValue([{
          id: 'event-1',
          ruleId: mockAlertRule.id,
          ruleName: mockAlertRule.name,
          severity: 'warning',
          targetType: 'stream',
          targetId: mockStreamConfig.id,
          targetName: mockStreamConfig.name,
          condition: { type: 'status_changed', statusTo: 'stopped' },
          message: 'Stream stopped',
          createdAt: '2024-01-01T00:00:00Z'
        }]);

        // Container is now running again
        vi.mocked(docker.listStreamContainers).mockResolvedValue([mockContainer]);

        startAlertEvaluator();
        await vi.advanceTimersByTimeAsync(0);

        expect(storage.resolveAlertEvent).toHaveBeenCalledWith('event-1');
      });

      it('should resolve health_unhealthy alerts when health becomes healthy', async () => {
        vi.mocked(storage.getActiveEvents).mockReturnValue([{
          id: 'event-1',
          ruleId: mockAlertRule.id,
          ruleName: mockAlertRule.name,
          severity: 'warning',
          targetType: 'stream',
          targetId: mockStreamConfig.id,
          targetName: mockStreamConfig.name,
          condition: { type: 'health_unhealthy' },
          message: 'Stream unhealthy',
          createdAt: '2024-01-01T00:00:00Z'
        }]);

        // Container is healthy
        vi.mocked(docker.listStreamContainers).mockResolvedValue([
          { ...mockContainer, health: 'healthy' }
        ]);

        startAlertEvaluator();
        await vi.advanceTimersByTimeAsync(0);

        expect(storage.resolveAlertEvent).toHaveBeenCalledWith('event-1');
      });
    });
  });

  describe('triggerScheduleFailedAlert', () => {
    it('should trigger alert for schedule failure', async () => {
      const rule = {
        ...mockAlertRule,
        condition: { type: 'schedule_failed' as const }
      };
      vi.mocked(storage.getAlertRulesForTarget).mockReturnValue([rule]);
      vi.mocked(storage.createAlertEvent).mockReturnValue({
        id: 'event-1',
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        targetType: 'stream',
        targetId: 'stream-123',
        targetName: 'Test Stream',
        condition: rule.condition,
        message: 'Schedule failed',
        createdAt: new Date().toISOString()
      });

      await triggerScheduleFailedAlert('stream', 'stream-123', 'Test Stream', 'Container not found');

      expect(storage.createAlertEvent).toHaveBeenCalled();
      expect(storage.recordAlertTriggered).toHaveBeenCalledWith(rule.id, true);
      expect(notifications.sendNotifications).toHaveBeenCalled();
    });

    it('should respect cooldown for schedule failed alerts', async () => {
      const rule = {
        ...mockAlertRule,
        condition: { type: 'schedule_failed' as const },
        cooldownMinutes: 5,
        lastNotified: new Date(Date.now() - 60000).toISOString() // 1 minute ago
      };
      vi.mocked(storage.getAlertRulesForTarget).mockReturnValue([rule]);

      await triggerScheduleFailedAlert('stream', 'stream-123', 'Test Stream', 'Container not found');

      expect(storage.createAlertEvent).not.toHaveBeenCalled();
      expect(notifications.sendNotifications).not.toHaveBeenCalled();
    });
  });
});
