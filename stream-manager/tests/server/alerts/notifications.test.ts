import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  sendNotifications,
  testNotificationChannel
} from '../../../src/server/alerts/notifications.js';
import type { AlertRule, AlertEvent, WebhookNotification, EmailNotification } from '../../../src/server/alerts/schema.js';

// Sample test data
const mockAlertRule: AlertRule = {
  id: 'rule-123',
  name: 'test-alert',
  enabled: true,
  targetType: 'stream',
  targetId: 'stream-456',
  condition: { type: 'status_changed', statusTo: 'stopped' },
  severity: 'warning',
  notifications: [],
  cooldownMinutes: 15,
  triggerCount: 0,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  createdBy: 'test-user'
};

const mockAlertEvent: AlertEvent = {
  id: 'event-123',
  ruleId: 'rule-123',
  ruleName: 'test-alert',
  severity: 'warning',
  targetType: 'stream',
  targetId: 'stream-456',
  targetName: 'Test Stream',
  condition: { type: 'status_changed', statusTo: 'stopped' },
  message: '[WARNING] Stream "Test Stream" status changed to stopped',
  details: { containerStatus: 'stopped', restartCount: 2 },
  createdAt: '2024-01-01T00:00:00Z'
};

describe('Alert Notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment variables
    vi.stubEnv('SMTP_HOST', '');
    vi.stubEnv('SMTP_USER', '');
    vi.stubEnv('SMTP_PASS', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  describe('sendNotifications', () => {
    describe('Webhook notifications', () => {
      it('should send webhook notification successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200
        });

        const rule: AlertRule = {
          ...mockAlertRule,
          notifications: [
            { type: 'webhook', url: 'https://example.com/hook' }
          ]
        };

        const results = await sendNotifications(rule, mockAlertEvent);

        expect(results).toHaveLength(1);
        expect(results[0].success).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          'https://example.com/hook',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'Content-Type': 'application/json',
              'User-Agent': 'StreamManager-Alerts/1.0'
            }),
            body: expect.any(String)
          })
        );

        // Verify payload structure
        const call = mockFetch.mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body.event).toBe('alert_triggered');
        expect(body.timestamp).toBe(mockAlertEvent.createdAt);
        expect(body.alert.id).toBe(mockAlertEvent.id);
        expect(body.alert.ruleName).toBe(mockAlertEvent.ruleName);
        expect(body.alert.severity).toBe(mockAlertEvent.severity);
        expect(body.alert.message).toBe(mockAlertEvent.message);
      });

      it('should use PUT method when specified', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200
        });

        const rule: AlertRule = {
          ...mockAlertRule,
          notifications: [
            { type: 'webhook', url: 'https://example.com/hook', method: 'PUT' }
          ]
        };

        await sendNotifications(rule, mockAlertEvent);

        expect(mockFetch).toHaveBeenCalledWith(
          'https://example.com/hook',
          expect.objectContaining({
            method: 'PUT'
          })
        );
      });

      it('should include custom headers', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200
        });

        const rule: AlertRule = {
          ...mockAlertRule,
          notifications: [
            {
              type: 'webhook',
              url: 'https://example.com/hook',
              headers: {
                'Authorization': 'Bearer secret-token',
                'X-Custom-Header': 'custom-value'
              }
            }
          ]
        };

        await sendNotifications(rule, mockAlertEvent);

        const call = mockFetch.mock.calls[0];
        expect(call[1].headers).toMatchObject({
          'Authorization': 'Bearer secret-token',
          'X-Custom-Header': 'custom-value'
        });
      });

      it('should return failure for non-ok response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: vi.fn().mockResolvedValue('Internal Server Error')
        });

        const rule: AlertRule = {
          ...mockAlertRule,
          notifications: [
            { type: 'webhook', url: 'https://example.com/hook' }
          ]
        };

        const results = await sendNotifications(rule, mockAlertEvent);

        expect(results).toHaveLength(1);
        expect(results[0].success).toBe(false);
        expect(results[0].error).toContain('500');
      });

      it('should handle fetch errors', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const rule: AlertRule = {
          ...mockAlertRule,
          notifications: [
            { type: 'webhook', url: 'https://example.com/hook' }
          ]
        };

        const results = await sendNotifications(rule, mockAlertEvent);

        expect(results).toHaveLength(1);
        expect(results[0].success).toBe(false);
        expect(results[0].error).toBe('Network error');
      });
    });

    describe('Email notifications', () => {
      it('should handle email notification without SMTP', async () => {
        const rule: AlertRule = {
          ...mockAlertRule,
          notifications: [
            { type: 'email', recipients: ['test@example.com'] }
          ]
        };

        const results = await sendNotifications(rule, mockAlertEvent);

        // Without SMTP configured, should fail
        expect(results).toHaveLength(1);
        expect(results[0].success).toBe(false);
        expect(results[0].error).toContain('SMTP_HOST');
      });

      it('should succeed with SMTP configured but no credentials (dev mode)', async () => {
        vi.stubEnv('SMTP_HOST', 'smtp.example.com');

        const rule: AlertRule = {
          ...mockAlertRule,
          notifications: [
            { type: 'email', recipients: ['test@example.com'] }
          ]
        };

        const results = await sendNotifications(rule, mockAlertEvent);

        // In dev mode without credentials, should succeed (just logs)
        expect(results).toHaveLength(1);
        expect(results[0].success).toBe(true);
      });
    });

    describe('Multiple notifications', () => {
      it('should send multiple notifications', async () => {
        mockFetch
          .mockResolvedValueOnce({ ok: true, status: 200 })
          .mockResolvedValueOnce({ ok: true, status: 200 });

        const rule: AlertRule = {
          ...mockAlertRule,
          notifications: [
            { type: 'webhook', url: 'https://example.com/hook1' },
            { type: 'webhook', url: 'https://example.com/hook2' }
          ]
        };

        const results = await sendNotifications(rule, mockAlertEvent);

        expect(results).toHaveLength(2);
        expect(results.every(r => r.success)).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      it('should continue sending even if one fails', async () => {
        mockFetch
          .mockRejectedValueOnce(new Error('First webhook failed'))
          .mockResolvedValueOnce({ ok: true, status: 200 });

        const rule: AlertRule = {
          ...mockAlertRule,
          notifications: [
            { type: 'webhook', url: 'https://example.com/hook1' },
            { type: 'webhook', url: 'https://example.com/hook2' }
          ]
        };

        const results = await sendNotifications(rule, mockAlertEvent);

        expect(results).toHaveLength(2);
        expect(results[0].success).toBe(false);
        expect(results[1].success).toBe(true);
      });
    });

    it('should handle empty notifications array', async () => {
      const rule: AlertRule = {
        ...mockAlertRule,
        notifications: []
      };

      const results = await sendNotifications(rule, mockAlertEvent);

      expect(results).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('testNotificationChannel', () => {
    describe('Webhook testing', () => {
      it('should test webhook successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200
        });

        const channel: WebhookNotification = {
          type: 'webhook',
          url: 'https://example.com/hook'
        };

        const result = await testNotificationChannel(channel);

        expect(result.success).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          'https://example.com/hook',
          expect.objectContaining({
            method: 'POST',
            body: expect.any(String)
          })
        );

        // Verify test payload
        const call = mockFetch.mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body.alert.ruleName).toBe('Test Alert Rule');
        expect(body.alert.message).toContain('test');
      });

      it('should return failure for webhook test failure', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: vi.fn().mockResolvedValue('Not Found')
        });

        const channel: WebhookNotification = {
          type: 'webhook',
          url: 'https://example.com/nonexistent'
        };

        const result = await testNotificationChannel(channel);

        expect(result.success).toBe(false);
        expect(result.error).toContain('404');
      });

      it('should return failure for network error', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

        const channel: WebhookNotification = {
          type: 'webhook',
          url: 'https://example.com/hook'
        };

        const result = await testNotificationChannel(channel);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Connection refused');
      });
    });

    describe('Email testing', () => {
      it('should fail test without SMTP config', async () => {
        const channel: EmailNotification = {
          type: 'email',
          recipients: ['test@example.com']
        };

        const result = await testNotificationChannel(channel);

        expect(result.success).toBe(false);
        expect(result.error).toContain('SMTP_HOST');
      });

      it('should succeed test with SMTP host configured', async () => {
        vi.stubEnv('SMTP_HOST', 'smtp.example.com');

        const channel: EmailNotification = {
          type: 'email',
          recipients: ['test@example.com']
        };

        const result = await testNotificationChannel(channel);

        // In dev mode, succeeds without actually sending
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Webhook payload format', () => {
    it('should include all required fields in payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200
      });

      const rule: AlertRule = {
        ...mockAlertRule,
        notifications: [
          { type: 'webhook', url: 'https://example.com/hook' }
        ]
      };

      await sendNotifications(rule, mockAlertEvent);

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);

      // Check structure
      expect(body).toHaveProperty('event', 'alert_triggered');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('alert');

      // Check alert object
      expect(body.alert).toHaveProperty('id', mockAlertEvent.id);
      expect(body.alert).toHaveProperty('ruleName', mockAlertEvent.ruleName);
      expect(body.alert).toHaveProperty('severity', mockAlertEvent.severity);
      expect(body.alert).toHaveProperty('targetType', mockAlertEvent.targetType);
      expect(body.alert).toHaveProperty('targetId', mockAlertEvent.targetId);
      expect(body.alert).toHaveProperty('targetName', mockAlertEvent.targetName);
      expect(body.alert).toHaveProperty('message', mockAlertEvent.message);
      expect(body.alert).toHaveProperty('condition');
      expect(body.alert).toHaveProperty('details');
    });

    it('should handle events without details', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200
      });

      const eventWithoutDetails: AlertEvent = {
        ...mockAlertEvent,
        details: undefined
      };

      const rule: AlertRule = {
        ...mockAlertRule,
        notifications: [
          { type: 'webhook', url: 'https://example.com/hook' }
        ]
      };

      await sendNotifications(rule, eventWithoutDetails);

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);

      expect(body.alert.details).toBeUndefined();
    });
  });
});
