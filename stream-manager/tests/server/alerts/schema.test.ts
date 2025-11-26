import { describe, it, expect } from 'vitest';
import {
  validateAlertRuleCreate,
  validateAlertRuleUpdate,
  formatAlertMessage,
  AlertValidationError,
  ALERT_RULE_DEFAULTS,
  AlertRule
} from '../../../src/server/alerts/schema.js';

describe('AlertRule Schema', () => {
  const validConfig = {
    name: 'test-alert',
    targetType: 'stream' as const,
    condition: { type: 'status_changed' as const }
  };

  describe('validateAlertRuleCreate', () => {
    it('should accept valid minimal config', () => {
      const result = validateAlertRuleCreate(validConfig);

      expect(result.name).toBe('test-alert');
      expect(result.targetType).toBe('stream');
      expect(result.condition.type).toBe('status_changed');
    });

    it('should apply defaults for optional fields', () => {
      const result = validateAlertRuleCreate(validConfig);

      expect(result.enabled).toBe(ALERT_RULE_DEFAULTS.enabled);
      expect(result.severity).toBe(ALERT_RULE_DEFAULTS.severity);
      expect(result.cooldownMinutes).toBe(ALERT_RULE_DEFAULTS.cooldownMinutes);
      expect(result.notifications).toEqual([]);
    });

    it('should accept full config with all fields', () => {
      const fullConfig = {
        ...validConfig,
        description: 'Test alert description',
        enabled: false,
        targetId: 'stream-123',
        condition: {
          type: 'status_changed' as const,
          statusFrom: 'running',
          statusTo: 'stopped'
        },
        severity: 'critical' as const,
        cooldownMinutes: 30,
        notifications: [
          { type: 'webhook' as const, url: 'https://example.com/hook' }
        ]
      };

      const result = validateAlertRuleCreate(fullConfig);

      expect(result.name).toBe('test-alert');
      expect(result.description).toBe('Test alert description');
      expect(result.enabled).toBe(false);
      expect(result.targetId).toBe('stream-123');
      expect(result.condition.statusFrom).toBe('running');
      expect(result.condition.statusTo).toBe('stopped');
      expect(result.severity).toBe('critical');
      expect(result.cooldownMinutes).toBe(30);
      expect(result.notifications).toHaveLength(1);
    });

    describe('name validation', () => {
      it('should reject empty name', () => {
        expect(() => validateAlertRuleCreate({ ...validConfig, name: '' }))
          .toThrow(AlertValidationError);
      });

      it('should reject name with only whitespace', () => {
        expect(() => validateAlertRuleCreate({ ...validConfig, name: '   ' }))
          .toThrow(AlertValidationError);
      });

      it('should reject name starting with special character', () => {
        expect(() => validateAlertRuleCreate({ ...validConfig, name: '-invalid' }))
          .toThrow(AlertValidationError);
      });

      it('should reject name with invalid characters', () => {
        expect(() => validateAlertRuleCreate({ ...validConfig, name: 'test@alert' }))
          .toThrow(AlertValidationError);
      });

      it('should reject name exceeding 100 characters', () => {
        expect(() => validateAlertRuleCreate({ ...validConfig, name: 'a'.repeat(101) }))
          .toThrow(AlertValidationError);
      });

      it('should accept name with hyphens, underscores, and spaces', () => {
        const result = validateAlertRuleCreate({ ...validConfig, name: 'test-alert_1 name' });
        expect(result.name).toBe('test-alert_1 name');
      });

      it('should trim whitespace from name', () => {
        const result = validateAlertRuleCreate({ ...validConfig, name: '  test-alert  ' });
        expect(result.name).toBe('test-alert');
      });
    });

    describe('description validation', () => {
      it('should accept undefined description', () => {
        const result = validateAlertRuleCreate(validConfig);
        expect(result.description).toBeUndefined();
      });

      it('should accept valid description', () => {
        const result = validateAlertRuleCreate({ ...validConfig, description: 'A test description' });
        expect(result.description).toBe('A test description');
      });

      it('should reject description exceeding 500 characters', () => {
        expect(() => validateAlertRuleCreate({ ...validConfig, description: 'a'.repeat(501) }))
          .toThrow(AlertValidationError);
      });

      it('should convert empty description to undefined', () => {
        const result = validateAlertRuleCreate({ ...validConfig, description: '   ' });
        expect(result.description).toBeUndefined();
      });

      it('should reject non-string description', () => {
        expect(() => validateAlertRuleCreate({ ...validConfig, description: 123 }))
          .toThrow(AlertValidationError);
      });
    });

    describe('enabled validation', () => {
      it('should reject non-boolean enabled', () => {
        expect(() => validateAlertRuleCreate({ ...validConfig, enabled: 'yes' }))
          .toThrow(AlertValidationError);
      });

      it('should accept true', () => {
        const result = validateAlertRuleCreate({ ...validConfig, enabled: true });
        expect(result.enabled).toBe(true);
      });

      it('should accept false', () => {
        const result = validateAlertRuleCreate({ ...validConfig, enabled: false });
        expect(result.enabled).toBe(false);
      });
    });

    describe('targetType validation', () => {
      it('should reject missing targetType', () => {
        const { targetType, ...config } = validConfig;
        expect(() => validateAlertRuleCreate(config))
          .toThrow(AlertValidationError);
      });

      it('should accept stream targetType', () => {
        const result = validateAlertRuleCreate({ ...validConfig, targetType: 'stream' });
        expect(result.targetType).toBe('stream');
      });

      it('should accept group targetType', () => {
        const result = validateAlertRuleCreate({ ...validConfig, targetType: 'group' });
        expect(result.targetType).toBe('group');
      });

      it('should accept compositor targetType', () => {
        const result = validateAlertRuleCreate({ ...validConfig, targetType: 'compositor' });
        expect(result.targetType).toBe('compositor');
      });

      it('should accept any targetType', () => {
        const result = validateAlertRuleCreate({ ...validConfig, targetType: 'any' });
        expect(result.targetType).toBe('any');
      });

      it('should reject invalid targetType', () => {
        expect(() => validateAlertRuleCreate({ ...validConfig, targetType: 'invalid' }))
          .toThrow(AlertValidationError);
      });
    });

    describe('targetId validation', () => {
      it('should accept undefined targetId', () => {
        const result = validateAlertRuleCreate(validConfig);
        expect(result.targetId).toBeUndefined();
      });

      it('should accept valid targetId', () => {
        const result = validateAlertRuleCreate({ ...validConfig, targetId: 'stream-123' });
        expect(result.targetId).toBe('stream-123');
      });

      it('should convert empty targetId to undefined', () => {
        const result = validateAlertRuleCreate({ ...validConfig, targetId: '   ' });
        expect(result.targetId).toBeUndefined();
      });

      it('should reject non-string targetId', () => {
        expect(() => validateAlertRuleCreate({ ...validConfig, targetId: 123 }))
          .toThrow(AlertValidationError);
      });
    });

    describe('severity validation', () => {
      it('should accept info severity', () => {
        const result = validateAlertRuleCreate({ ...validConfig, severity: 'info' });
        expect(result.severity).toBe('info');
      });

      it('should accept warning severity', () => {
        const result = validateAlertRuleCreate({ ...validConfig, severity: 'warning' });
        expect(result.severity).toBe('warning');
      });

      it('should accept critical severity', () => {
        const result = validateAlertRuleCreate({ ...validConfig, severity: 'critical' });
        expect(result.severity).toBe('critical');
      });

      it('should reject invalid severity', () => {
        expect(() => validateAlertRuleCreate({ ...validConfig, severity: 'error' }))
          .toThrow(AlertValidationError);
      });
    });

    describe('cooldownMinutes validation', () => {
      it('should accept zero cooldown', () => {
        const result = validateAlertRuleCreate({ ...validConfig, cooldownMinutes: 0 });
        expect(result.cooldownMinutes).toBe(0);
      });

      it('should accept positive cooldown', () => {
        const result = validateAlertRuleCreate({ ...validConfig, cooldownMinutes: 60 });
        expect(result.cooldownMinutes).toBe(60);
      });

      it('should reject negative cooldown', () => {
        expect(() => validateAlertRuleCreate({ ...validConfig, cooldownMinutes: -1 }))
          .toThrow(AlertValidationError);
      });

      it('should reject non-number cooldown', () => {
        expect(() => validateAlertRuleCreate({ ...validConfig, cooldownMinutes: '15' }))
          .toThrow(AlertValidationError);
      });
    });

    describe('condition validation', () => {
      it('should reject missing condition', () => {
        const { condition, ...config } = validConfig;
        expect(() => validateAlertRuleCreate(config))
          .toThrow(AlertValidationError);
      });

      it('should reject non-object condition', () => {
        expect(() => validateAlertRuleCreate({ ...validConfig, condition: 'status_changed' }))
          .toThrow(AlertValidationError);
      });

      it('should reject null condition', () => {
        expect(() => validateAlertRuleCreate({ ...validConfig, condition: null }))
          .toThrow(AlertValidationError);
      });

      it('should reject missing condition type', () => {
        expect(() => validateAlertRuleCreate({ ...validConfig, condition: {} }))
          .toThrow(AlertValidationError);
      });

      it('should reject invalid condition type', () => {
        expect(() => validateAlertRuleCreate({ ...validConfig, condition: { type: 'invalid' } }))
          .toThrow(AlertValidationError);
      });

      describe('status_changed condition', () => {
        it('should accept without statusFrom/statusTo', () => {
          const result = validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'status_changed' }
          });
          expect(result.condition.type).toBe('status_changed');
        });

        it('should accept valid statusFrom', () => {
          const result = validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'status_changed', statusFrom: 'running' }
          });
          expect(result.condition.statusFrom).toBe('running');
        });

        it('should accept valid statusTo', () => {
          const result = validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'status_changed', statusTo: 'stopped' }
          });
          expect(result.condition.statusTo).toBe('stopped');
        });

        it('should reject invalid statusFrom', () => {
          expect(() => validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'status_changed', statusFrom: 'invalid' }
          })).toThrow(AlertValidationError);
        });

        it('should reject invalid statusTo', () => {
          expect(() => validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'status_changed', statusTo: 'invalid' }
          })).toThrow(AlertValidationError);
        });
      });

      describe('status_is condition', () => {
        it('should require status field', () => {
          expect(() => validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'status_is' }
          })).toThrow(AlertValidationError);
        });

        it('should accept valid status', () => {
          const result = validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'status_is', status: 'stopped' }
          });
          expect(result.condition.status).toBe('stopped');
        });

        it('should reject invalid status', () => {
          expect(() => validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'status_is', status: 'invalid' }
          })).toThrow(AlertValidationError);
        });

        it('should accept optional durationSeconds', () => {
          const result = validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'status_is', status: 'stopped', durationSeconds: 300 }
          });
          expect(result.condition.durationSeconds).toBe(300);
        });

        it('should reject negative durationSeconds', () => {
          expect(() => validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'status_is', status: 'stopped', durationSeconds: -1 }
          })).toThrow(AlertValidationError);
        });
      });

      describe('health_unhealthy condition', () => {
        it('should accept without additional fields', () => {
          const result = validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'health_unhealthy' }
          });
          expect(result.condition.type).toBe('health_unhealthy');
        });

        it('should accept optional durationSeconds', () => {
          const result = validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'health_unhealthy', durationSeconds: 60 }
          });
          expect(result.condition.durationSeconds).toBe(60);
        });
      });

      describe('restart_count condition', () => {
        it('should require threshold', () => {
          expect(() => validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'restart_count' }
          })).toThrow(AlertValidationError);
        });

        it('should reject threshold less than 1', () => {
          expect(() => validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'restart_count', threshold: 0 }
          })).toThrow(AlertValidationError);
        });

        it('should accept valid threshold', () => {
          const result = validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'restart_count', threshold: 5 }
          });
          expect(result.condition.threshold).toBe(5);
        });

        it('should accept optional timeWindowSeconds', () => {
          const result = validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'restart_count', threshold: 5, timeWindowSeconds: 3600 }
          });
          expect(result.condition.timeWindowSeconds).toBe(3600);
        });

        it('should reject timeWindowSeconds less than 60', () => {
          expect(() => validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'restart_count', threshold: 5, timeWindowSeconds: 30 }
          })).toThrow(AlertValidationError);
        });
      });

      describe('offline_duration condition', () => {
        it('should require durationSeconds', () => {
          expect(() => validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'offline_duration' }
          })).toThrow(AlertValidationError);
        });

        it('should reject durationSeconds less than 1', () => {
          expect(() => validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'offline_duration', durationSeconds: 0 }
          })).toThrow(AlertValidationError);
        });

        it('should accept valid durationSeconds', () => {
          const result = validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'offline_duration', durationSeconds: 300 }
          });
          expect(result.condition.durationSeconds).toBe(300);
        });
      });

      describe('schedule_failed condition', () => {
        it('should accept without additional fields', () => {
          const result = validateAlertRuleCreate({
            ...validConfig,
            condition: { type: 'schedule_failed' }
          });
          expect(result.condition.type).toBe('schedule_failed');
        });
      });
    });

    describe('notifications validation', () => {
      it('should accept empty notifications array', () => {
        const result = validateAlertRuleCreate({ ...validConfig, notifications: [] });
        expect(result.notifications).toEqual([]);
      });

      it('should reject non-array notifications', () => {
        expect(() => validateAlertRuleCreate({ ...validConfig, notifications: {} }))
          .toThrow(AlertValidationError);
      });

      describe('webhook notifications', () => {
        it('should accept valid webhook', () => {
          const result = validateAlertRuleCreate({
            ...validConfig,
            notifications: [{ type: 'webhook', url: 'https://example.com/hook' }]
          });
          expect(result.notifications[0].type).toBe('webhook');
          expect((result.notifications[0] as { url: string }).url).toBe('https://example.com/hook');
        });

        it('should accept http url', () => {
          const result = validateAlertRuleCreate({
            ...validConfig,
            notifications: [{ type: 'webhook', url: 'http://example.com/hook' }]
          });
          expect((result.notifications[0] as { url: string }).url).toBe('http://example.com/hook');
        });

        it('should reject invalid url', () => {
          expect(() => validateAlertRuleCreate({
            ...validConfig,
            notifications: [{ type: 'webhook', url: 'not-a-url' }]
          })).toThrow(AlertValidationError);
        });

        it('should reject non-http(s) url', () => {
          expect(() => validateAlertRuleCreate({
            ...validConfig,
            notifications: [{ type: 'webhook', url: 'ftp://example.com' }]
          })).toThrow(AlertValidationError);
        });

        it('should reject missing url', () => {
          expect(() => validateAlertRuleCreate({
            ...validConfig,
            notifications: [{ type: 'webhook' }]
          })).toThrow(AlertValidationError);
        });

        it('should accept optional headers', () => {
          const result = validateAlertRuleCreate({
            ...validConfig,
            notifications: [{
              type: 'webhook',
              url: 'https://example.com/hook',
              headers: { 'Authorization': 'Bearer token' }
            }]
          });
          expect((result.notifications[0] as { headers?: Record<string, string> }).headers)
            .toEqual({ 'Authorization': 'Bearer token' });
        });

        it('should reject non-object headers', () => {
          expect(() => validateAlertRuleCreate({
            ...validConfig,
            notifications: [{
              type: 'webhook',
              url: 'https://example.com/hook',
              headers: 'invalid'
            }]
          })).toThrow(AlertValidationError);
        });

        it('should accept POST method', () => {
          const result = validateAlertRuleCreate({
            ...validConfig,
            notifications: [{
              type: 'webhook',
              url: 'https://example.com/hook',
              method: 'POST'
            }]
          });
          expect((result.notifications[0] as { method?: string }).method).toBe('POST');
        });

        it('should accept PUT method', () => {
          const result = validateAlertRuleCreate({
            ...validConfig,
            notifications: [{
              type: 'webhook',
              url: 'https://example.com/hook',
              method: 'PUT'
            }]
          });
          expect((result.notifications[0] as { method?: string }).method).toBe('PUT');
        });

        it('should reject invalid method', () => {
          expect(() => validateAlertRuleCreate({
            ...validConfig,
            notifications: [{
              type: 'webhook',
              url: 'https://example.com/hook',
              method: 'GET'
            }]
          })).toThrow(AlertValidationError);
        });
      });

      describe('email notifications', () => {
        it('should accept valid email', () => {
          const result = validateAlertRuleCreate({
            ...validConfig,
            notifications: [{ type: 'email', recipients: ['test@example.com'] }]
          });
          expect(result.notifications[0].type).toBe('email');
          expect((result.notifications[0] as { recipients: string[] }).recipients)
            .toEqual(['test@example.com']);
        });

        it('should accept multiple recipients', () => {
          const result = validateAlertRuleCreate({
            ...validConfig,
            notifications: [{
              type: 'email',
              recipients: ['a@example.com', 'b@example.com']
            }]
          });
          expect((result.notifications[0] as { recipients: string[] }).recipients)
            .toHaveLength(2);
        });

        it('should reject empty recipients array', () => {
          expect(() => validateAlertRuleCreate({
            ...validConfig,
            notifications: [{ type: 'email', recipients: [] }]
          })).toThrow(AlertValidationError);
        });

        it('should reject missing recipients', () => {
          expect(() => validateAlertRuleCreate({
            ...validConfig,
            notifications: [{ type: 'email' }]
          })).toThrow(AlertValidationError);
        });

        it('should reject invalid email address', () => {
          expect(() => validateAlertRuleCreate({
            ...validConfig,
            notifications: [{ type: 'email', recipients: ['invalid-email'] }]
          })).toThrow(AlertValidationError);
        });

        it('should accept optional subject', () => {
          const result = validateAlertRuleCreate({
            ...validConfig,
            notifications: [{
              type: 'email',
              recipients: ['test@example.com'],
              subject: 'Alert: ${rule.name}'
            }]
          });
          expect((result.notifications[0] as { subject?: string }).subject)
            .toBe('Alert: ${rule.name}');
        });

        it('should reject non-string subject', () => {
          expect(() => validateAlertRuleCreate({
            ...validConfig,
            notifications: [{
              type: 'email',
              recipients: ['test@example.com'],
              subject: 123
            }]
          })).toThrow(AlertValidationError);
        });
      });

      it('should reject unknown notification type', () => {
        expect(() => validateAlertRuleCreate({
          ...validConfig,
          notifications: [{ type: 'sms', number: '+1234567890' }]
        })).toThrow(AlertValidationError);
      });

      it('should reject non-object notification', () => {
        expect(() => validateAlertRuleCreate({
          ...validConfig,
          notifications: ['webhook']
        })).toThrow(AlertValidationError);
      });
    });

    it('should reject non-object input', () => {
      expect(() => validateAlertRuleCreate('string')).toThrow(AlertValidationError);
      expect(() => validateAlertRuleCreate(null)).toThrow(AlertValidationError);
      expect(() => validateAlertRuleCreate(undefined)).toThrow(AlertValidationError);
    });
  });

  describe('validateAlertRuleUpdate', () => {
    it('should accept empty updates', () => {
      const result = validateAlertRuleUpdate({});
      expect(Object.keys(result).length).toBe(0);
    });

    it('should validate only provided fields', () => {
      const result = validateAlertRuleUpdate({ name: 'new-name', severity: 'critical' });
      expect(result.name).toBe('new-name');
      expect(result.severity).toBe('critical');
      expect(result.enabled).toBeUndefined();
    });

    it('should allow clearing optional fields with null', () => {
      const result = validateAlertRuleUpdate({
        description: null,
        targetId: null
      });
      expect(result.description).toBeUndefined();
      expect(result.targetId).toBeUndefined();
    });

    it('should allow clearing optional fields with empty string', () => {
      const result = validateAlertRuleUpdate({
        description: '',
        targetId: ''
      });
      expect(result.description).toBeUndefined();
      expect(result.targetId).toBeUndefined();
    });

    it('should still validate values when provided', () => {
      expect(() => validateAlertRuleUpdate({ name: '-invalid' }))
        .toThrow(AlertValidationError);

      expect(() => validateAlertRuleUpdate({ severity: 'invalid' }))
        .toThrow(AlertValidationError);
    });

    it('should validate condition update', () => {
      const result = validateAlertRuleUpdate({
        condition: { type: 'restart_count', threshold: 10 }
      });
      expect(result.condition?.type).toBe('restart_count');
      expect(result.condition?.threshold).toBe(10);
    });

    it('should validate notifications update', () => {
      const result = validateAlertRuleUpdate({
        notifications: [{ type: 'webhook', url: 'https://example.com' }]
      });
      expect(result.notifications).toHaveLength(1);
    });

    it('should reject non-object input', () => {
      expect(() => validateAlertRuleUpdate('string')).toThrow(AlertValidationError);
      expect(() => validateAlertRuleUpdate(null)).toThrow(AlertValidationError);
    });
  });

  describe('AlertValidationError', () => {
    it('should include field name', () => {
      try {
        validateAlertRuleCreate({ ...validConfig, name: '-invalid' });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AlertValidationError);
        const error = err as AlertValidationError;
        expect(error.field).toBe('name');
      }
    });

    it('should include error message', () => {
      try {
        validateAlertRuleCreate({ ...validConfig, name: '' });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AlertValidationError);
        const error = err as AlertValidationError;
        expect(error.message).toContain('name');
      }
    });
  });

  describe('formatAlertMessage', () => {
    const baseRule: AlertRule = {
      id: 'rule-1',
      name: 'Test Rule',
      enabled: true,
      targetType: 'stream',
      condition: { type: 'status_changed' },
      severity: 'warning',
      notifications: [],
      cooldownMinutes: 15,
      triggerCount: 0,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      createdBy: 'user-1'
    };

    it('should format status_changed message', () => {
      const rule = {
        ...baseRule,
        condition: { type: 'status_changed' as const, statusFrom: 'running', statusTo: 'stopped' }
      };
      const msg = formatAlertMessage(rule, 'my-stream');
      expect(msg).toContain('WARNING');
      expect(msg).toContain('my-stream');
      expect(msg).toContain('running');
      expect(msg).toContain('stopped');
    });

    it('should format status_changed message without statusFrom', () => {
      const rule = {
        ...baseRule,
        condition: { type: 'status_changed' as const, statusTo: 'stopped' }
      };
      const msg = formatAlertMessage(rule, 'my-stream');
      expect(msg).toContain('changed to stopped');
    });

    it('should format status_is message', () => {
      const rule = {
        ...baseRule,
        condition: { type: 'status_is' as const, status: 'stopped', durationSeconds: 300 }
      };
      const msg = formatAlertMessage(rule, 'my-stream');
      expect(msg).toContain('has been stopped');
      expect(msg).toContain('5 minutes');
    });

    it('should format health_unhealthy message', () => {
      const rule = {
        ...baseRule,
        condition: { type: 'health_unhealthy' as const }
      };
      const msg = formatAlertMessage(rule, 'my-stream');
      expect(msg).toContain('health check is unhealthy');
    });

    it('should format restart_count message', () => {
      const rule = {
        ...baseRule,
        condition: { type: 'restart_count' as const, threshold: 5, timeWindowSeconds: 3600 }
      };
      const msg = formatAlertMessage(rule, 'my-stream', { restartCount: 6 });
      expect(msg).toContain('restarted 6 times');
      expect(msg).toContain('1 hour');
    });

    it('should format offline_duration message', () => {
      const rule = {
        ...baseRule,
        condition: { type: 'offline_duration' as const, durationSeconds: 600 }
      };
      const msg = formatAlertMessage(rule, 'my-stream');
      expect(msg).toContain('offline');
      expect(msg).toContain('10 minutes');
    });

    it('should format schedule_failed message', () => {
      const rule = {
        ...baseRule,
        condition: { type: 'schedule_failed' as const }
      };
      const msg = formatAlertMessage(rule, 'my-stream', { error: 'Container not found' });
      expect(msg).toContain('failed');
      expect(msg).toContain('Container not found');
    });

    it('should format severity correctly', () => {
      const criticalRule = { ...baseRule, severity: 'critical' as const };
      const msg = formatAlertMessage(criticalRule, 'my-stream');
      expect(msg).toContain('CRITICAL');
    });

    it('should format duration in seconds', () => {
      const rule = {
        ...baseRule,
        condition: { type: 'offline_duration' as const, durationSeconds: 45 }
      };
      const msg = formatAlertMessage(rule, 'my-stream');
      expect(msg).toContain('45 seconds');
    });

    it('should format duration in hours and minutes', () => {
      const rule = {
        ...baseRule,
        condition: { type: 'offline_duration' as const, durationSeconds: 5430 }
      };
      const msg = formatAlertMessage(rule, 'my-stream');
      expect(msg).toContain('1 hour');
      expect(msg).toContain('30 minutes');
    });
  });
});
