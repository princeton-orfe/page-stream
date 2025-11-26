import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase, closeDatabase, getDatabase } from '../../../src/server/db/index';
import {
  validateScheduleCreate,
  validateScheduleUpdate,
  ScheduleValidationError,
  calculateNextRun,
  getCommonTimezones
} from '../../../src/server/schedules/schema';
import {
  createSchedule,
  getSchedule,
  getScheduleByName,
  listSchedules,
  updateSchedule,
  deleteSchedule,
  getSchedulesForTarget,
  recordScheduleExecution,
  getDueSchedules
} from '../../../src/server/schedules/storage';
import { User } from '../../../src/server/auth/types';

const testUser: User = {
  id: 'test-user',
  username: 'tester',
  roles: ['admin'],
  authSource: 'anonymous'
};

describe('Schedule Schema Validation', () => {
  describe('validateScheduleCreate', () => {
    it('should validate a minimal schedule', () => {
      const input = {
        name: 'test-schedule',
        targetType: 'stream',
        targetId: 'stream-123',
        action: 'start',
        cronExpression: '0 9 * * *'
      };
      const result = validateScheduleCreate(input);
      expect(result.name).toBe('test-schedule');
      expect(result.targetType).toBe('stream');
      expect(result.targetId).toBe('stream-123');
      expect(result.action).toBe('start');
      expect(result.cronExpression).toBe('0 9 * * *');
      expect(result.timezone).toBe('UTC');
      expect(result.enabled).toBe(true);
    });

    it('should validate a complete schedule', () => {
      const input = {
        name: 'test-schedule',
        description: 'Test description',
        enabled: false,
        targetType: 'group',
        targetId: 'group-456',
        action: 'stop',
        cronExpression: '0 18 * * 1-5',
        timezone: 'America/New_York'
      };
      const result = validateScheduleCreate(input);
      expect(result.description).toBe('Test description');
      expect(result.enabled).toBe(false);
      expect(result.targetType).toBe('group');
      expect(result.action).toBe('stop');
      expect(result.timezone).toBe('America/New_York');
    });

    it('should reject missing name', () => {
      const input = {
        targetType: 'stream',
        targetId: 'stream-123',
        action: 'start',
        cronExpression: '0 9 * * *'
      };
      expect(() => validateScheduleCreate(input))
        .toThrow(ScheduleValidationError);
    });

    it('should reject empty name', () => {
      const input = {
        name: '   ',
        targetType: 'stream',
        targetId: 'stream-123',
        action: 'start',
        cronExpression: '0 9 * * *'
      };
      expect(() => validateScheduleCreate(input))
        .toThrow('name cannot be empty');
    });

    it('should reject invalid name characters', () => {
      const input = {
        name: '$invalid-name',
        targetType: 'stream',
        targetId: 'stream-123',
        action: 'start',
        cronExpression: '0 9 * * *'
      };
      expect(() => validateScheduleCreate(input))
        .toThrow('name must start with alphanumeric');
    });

    it('should reject invalid target type', () => {
      const input = {
        name: 'test-schedule',
        targetType: 'invalid',
        targetId: 'stream-123',
        action: 'start',
        cronExpression: '0 9 * * *'
      };
      expect(() => validateScheduleCreate(input))
        .toThrow('targetType must be one of');
    });

    it('should reject invalid action', () => {
      const input = {
        name: 'test-schedule',
        targetType: 'stream',
        targetId: 'stream-123',
        action: 'invalid',
        cronExpression: '0 9 * * *'
      };
      expect(() => validateScheduleCreate(input))
        .toThrow('action must be one of');
    });

    it('should reject refresh action for non-stream targets', () => {
      const input = {
        name: 'test-schedule',
        targetType: 'group',
        targetId: 'group-123',
        action: 'refresh',
        cronExpression: '0 9 * * *'
      };
      expect(() => validateScheduleCreate(input))
        .toThrow('refresh action is only valid for stream targets');
    });

    it('should reject invalid cron expression', () => {
      const input = {
        name: 'test-schedule',
        targetType: 'stream',
        targetId: 'stream-123',
        action: 'start',
        cronExpression: 'not-a-cron'
      };
      expect(() => validateScheduleCreate(input))
        .toThrow('Invalid cron expression');
    });

    it('should reject invalid timezone', () => {
      const input = {
        name: 'test-schedule',
        targetType: 'stream',
        targetId: 'stream-123',
        action: 'start',
        cronExpression: '0 9 * * *',
        timezone: 'Invalid/Timezone'
      };
      expect(() => validateScheduleCreate(input))
        .toThrow('Invalid timezone');
    });
  });

  describe('validateScheduleUpdate', () => {
    it('should validate partial update', () => {
      const result = validateScheduleUpdate({ name: 'new-name' });
      expect(result.name).toBe('new-name');
    });

    it('should validate enabled change', () => {
      const result = validateScheduleUpdate({ enabled: false });
      expect(result.enabled).toBe(false);
    });

    it('should validate cron expression change', () => {
      const result = validateScheduleUpdate({ cronExpression: '0 10 * * *' });
      expect(result.cronExpression).toBe('0 10 * * *');
    });

    it('should reject invalid cron in update', () => {
      expect(() => validateScheduleUpdate({ cronExpression: 'invalid' }))
        .toThrow('Invalid cron expression');
    });
  });

  describe('calculateNextRun', () => {
    it('should calculate next run time', () => {
      const result = calculateNextRun('0 9 * * *', 'UTC');
      expect(result).toBeTruthy();
      const nextRun = new Date(result);
      expect(nextRun.getTime()).toBeGreaterThan(Date.now());
    });

    it('should respect timezone', () => {
      const utcResult = calculateNextRun('0 9 * * *', 'UTC');
      const nyResult = calculateNextRun('0 9 * * *', 'America/New_York');
      // These should be different times
      expect(utcResult).not.toBe(nyResult);
    });
  });

  describe('getCommonTimezones', () => {
    it('should return a list of timezones', () => {
      const timezones = getCommonTimezones();
      expect(timezones.length).toBeGreaterThan(0);
      expect(timezones).toContain('UTC');
      expect(timezones).toContain('America/New_York');
      expect(timezones).toContain('Europe/London');
    });
  });
});

describe('Schedule Storage', () => {
  let db: Database.Database;
  let streamId: string;

  beforeEach(() => {
    // Initialize database with test path
    db = initDatabase(':memory:');

    // Create a test stream config for validation
    streamId = 'test-stream-id';
    db.prepare(`
      INSERT INTO stream_configs (id, name, url, ingest, created_by)
      VALUES (?, 'test-stream', 'http://test.com', 'rtmp://test', 'system')
    `).run(streamId);
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('createSchedule', () => {
    it('should create a schedule', () => {
      const config = {
        name: 'test-schedule',
        targetType: 'stream' as const,
        targetId: streamId,
        action: 'start' as const,
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        enabled: true
      };

      const schedule = createSchedule(config, testUser);

      expect(schedule.id).toBeTruthy();
      expect(schedule.name).toBe('test-schedule');
      expect(schedule.targetType).toBe('stream');
      expect(schedule.targetId).toBe(streamId);
      expect(schedule.action).toBe('start');
      expect(schedule.cronExpression).toBe('0 9 * * *');
      expect(schedule.timezone).toBe('UTC');
      expect(schedule.enabled).toBe(true);
      expect(schedule.nextRun).toBeTruthy();
      expect(schedule.createdBy).toBe('test-user');
    });

    it('should reject duplicate name', () => {
      const config = {
        name: 'test-schedule',
        targetType: 'stream' as const,
        targetId: streamId,
        action: 'start' as const,
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        enabled: true
      };

      createSchedule(config, testUser);

      expect(() => createSchedule(config, testUser))
        .toThrow('already exists');
    });

    it('should reject non-existent target', () => {
      const config = {
        name: 'test-schedule',
        targetType: 'stream' as const,
        targetId: 'non-existent',
        action: 'start' as const,
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        enabled: true
      };

      expect(() => createSchedule(config, testUser))
        .toThrow('not found');
    });

    it('should not calculate nextRun when disabled', () => {
      const config = {
        name: 'test-schedule',
        targetType: 'stream' as const,
        targetId: streamId,
        action: 'start' as const,
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        enabled: false
      };

      const schedule = createSchedule(config, testUser);
      expect(schedule.nextRun).toBeUndefined();
    });
  });

  describe('getSchedule', () => {
    it('should get schedule by ID', () => {
      const config = {
        name: 'test-schedule',
        targetType: 'stream' as const,
        targetId: streamId,
        action: 'start' as const,
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        enabled: true
      };

      const created = createSchedule(config, testUser);
      const found = getSchedule(created.id);

      expect(found).toBeTruthy();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe('test-schedule');
    });

    it('should return null for non-existent ID', () => {
      const found = getSchedule('non-existent');
      expect(found).toBeNull();
    });
  });

  describe('getScheduleByName', () => {
    it('should get schedule by name', () => {
      const config = {
        name: 'test-schedule',
        targetType: 'stream' as const,
        targetId: streamId,
        action: 'start' as const,
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        enabled: true
      };

      createSchedule(config, testUser);
      const found = getScheduleByName('test-schedule');

      expect(found).toBeTruthy();
      expect(found!.name).toBe('test-schedule');
    });
  });

  describe('listSchedules', () => {
    beforeEach(() => {
      // Create multiple schedules
      for (let i = 1; i <= 5; i++) {
        const config = {
          name: `schedule-${i}`,
          targetType: 'stream' as const,
          targetId: streamId,
          action: (i % 2 === 0 ? 'stop' : 'start') as const,
          cronExpression: '0 9 * * *',
          timezone: 'UTC',
          enabled: i <= 3
        };
        createSchedule(config, testUser);
      }
    });

    it('should list all schedules', () => {
      const { schedules, total } = listSchedules();
      expect(schedules.length).toBe(5);
      expect(total).toBe(5);
    });

    it('should filter by enabled', () => {
      const { schedules, total } = listSchedules({ enabled: true });
      expect(schedules.length).toBe(3);
      expect(total).toBe(3);
    });

    it('should filter by targetType', () => {
      const { schedules, total } = listSchedules({ targetType: 'stream' });
      expect(schedules.length).toBe(5);
      expect(total).toBe(5);
    });

    it('should filter by targetId', () => {
      const { schedules, total } = listSchedules({ targetId: streamId });
      expect(schedules.length).toBe(5);
      expect(total).toBe(5);
    });

    it('should paginate results', () => {
      const { schedules, total } = listSchedules({ limit: 2, offset: 0 });
      expect(schedules.length).toBe(2);
      expect(total).toBe(5);
    });
  });

  describe('updateSchedule', () => {
    it('should update schedule', () => {
      const config = {
        name: 'test-schedule',
        targetType: 'stream' as const,
        targetId: streamId,
        action: 'start' as const,
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        enabled: true
      };

      const created = createSchedule(config, testUser);
      const updated = updateSchedule(created.id, { name: 'updated-schedule' }, testUser);

      expect(updated.name).toBe('updated-schedule');
      expect(updated.updatedBy).toBe('test-user');
    });

    it('should recalculate nextRun when enabled', () => {
      const config = {
        name: 'test-schedule',
        targetType: 'stream' as const,
        targetId: streamId,
        action: 'start' as const,
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        enabled: false
      };

      const created = createSchedule(config, testUser);
      expect(created.nextRun).toBeUndefined();

      const updated = updateSchedule(created.id, { enabled: true }, testUser);
      expect(updated.nextRun).toBeTruthy();
    });

    it('should reject non-existent schedule', () => {
      expect(() => updateSchedule('non-existent', { name: 'new-name' }, testUser))
        .toThrow('not found');
    });
  });

  describe('deleteSchedule', () => {
    it('should delete schedule', () => {
      const config = {
        name: 'test-schedule',
        targetType: 'stream' as const,
        targetId: streamId,
        action: 'start' as const,
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        enabled: true
      };

      const created = createSchedule(config, testUser);
      const deleted = deleteSchedule(created.id);

      expect(deleted).toBe(true);
      expect(getSchedule(created.id)).toBeNull();
    });

    it('should return false for non-existent schedule', () => {
      const deleted = deleteSchedule('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('getSchedulesForTarget', () => {
    it('should get schedules for a target', () => {
      const config1 = {
        name: 'schedule-1',
        targetType: 'stream' as const,
        targetId: streamId,
        action: 'start' as const,
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        enabled: true
      };

      const config2 = {
        name: 'schedule-2',
        targetType: 'stream' as const,
        targetId: streamId,
        action: 'stop' as const,
        cronExpression: '0 18 * * *',
        timezone: 'UTC',
        enabled: true
      };

      createSchedule(config1, testUser);
      createSchedule(config2, testUser);

      const schedules = getSchedulesForTarget('stream', streamId);
      expect(schedules.length).toBe(2);
    });
  });

  describe('recordScheduleExecution', () => {
    it('should record successful execution', () => {
      const config = {
        name: 'test-schedule',
        targetType: 'stream' as const,
        targetId: streamId,
        action: 'start' as const,
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        enabled: true
      };

      const created = createSchedule(config, testUser);
      recordScheduleExecution(created.id, 'success');

      const updated = getSchedule(created.id);
      expect(updated!.lastRun).toBeTruthy();
      expect(updated!.lastRunResult).toBe('success');
      expect(updated!.lastRunError).toBeUndefined();
    });

    it('should record failed execution', () => {
      const config = {
        name: 'test-schedule',
        targetType: 'stream' as const,
        targetId: streamId,
        action: 'start' as const,
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        enabled: true
      };

      const created = createSchedule(config, testUser);
      recordScheduleExecution(created.id, 'failure', 'Test error');

      const updated = getSchedule(created.id);
      expect(updated!.lastRunResult).toBe('failure');
      expect(updated!.lastRunError).toBe('Test error');
    });
  });

  describe('getDueSchedules', () => {
    it('should get due schedules', () => {
      // Create a schedule with a past nextRun time
      const config = {
        name: 'test-schedule',
        targetType: 'stream' as const,
        targetId: streamId,
        action: 'start' as const,
        cronExpression: '* * * * *', // Every minute
        timezone: 'UTC',
        enabled: true
      };

      const created = createSchedule(config, testUser);

      // Manually update nextRun to be in the past
      const db = getDatabase();
      const pastTime = new Date(Date.now() - 60000).toISOString();
      db.prepare('UPDATE schedules SET next_run = ? WHERE id = ?').run(pastTime, created.id);

      const dueSchedules = getDueSchedules();
      expect(dueSchedules.length).toBeGreaterThan(0);
      expect(dueSchedules[0].id).toBe(created.id);
    });

    it('should not return disabled schedules', () => {
      const config = {
        name: 'test-schedule',
        targetType: 'stream' as const,
        targetId: streamId,
        action: 'start' as const,
        cronExpression: '* * * * *',
        timezone: 'UTC',
        enabled: false
      };

      createSchedule(config, testUser);

      const dueSchedules = getDueSchedules();
      expect(dueSchedules.length).toBe(0);
    });
  });
});
