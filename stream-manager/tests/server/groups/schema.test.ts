import { describe, it, expect } from 'vitest';
import {
  validateStreamGroupCreate,
  validateStreamGroupUpdate,
  StreamGroupValidationError,
  STREAM_GROUP_DEFAULTS
} from '../../../src/server/groups/schema.js';

describe('Stream Group Schema Validation', () => {
  describe('validateStreamGroupCreate', () => {
    it('should validate a minimal valid config', () => {
      const config = {
        name: 'test-group',
        members: [
          { streamId: 'stream-1', position: 0 },
          { streamId: 'stream-2', position: 1 }
        ]
      };

      const validated = validateStreamGroupCreate(config);
      expect(validated.name).toBe('test-group');
      expect(validated.enabled).toBe(STREAM_GROUP_DEFAULTS.enabled);
      expect(validated.startOrder).toBe(STREAM_GROUP_DEFAULTS.startOrder);
      expect(validated.stopOrder).toBe(STREAM_GROUP_DEFAULTS.stopOrder);
      expect(validated.members.length).toBe(2);
    });

    it('should validate a full config with all fields', () => {
      const config = {
        name: 'full-group',
        description: 'A fully configured stream group',
        enabled: false,
        members: [
          { streamId: 'stream-1', position: 0, delayMs: 500 },
          { streamId: 'stream-2', position: 1, delayMs: 1000 },
          { streamId: 'stream-3', position: 2 }
        ],
        startOrder: 'sequential',
        stopOrder: 'reverse',
        startDelayMs: 2000,
        stopDelayMs: 3000
      };

      const validated = validateStreamGroupCreate(config);
      expect(validated.name).toBe('full-group');
      expect(validated.description).toBe('A fully configured stream group');
      expect(validated.enabled).toBe(false);
      expect(validated.startOrder).toBe('sequential');
      expect(validated.stopOrder).toBe('reverse');
      expect(validated.startDelayMs).toBe(2000);
      expect(validated.stopDelayMs).toBe(3000);
      expect(validated.members.length).toBe(3);
      expect(validated.members[0].delayMs).toBe(500);
    });

    it('should reject missing name', () => {
      const config = {
        members: [
          { streamId: 'stream-1', position: 0 }
        ]
      };

      expect(() => validateStreamGroupCreate(config)).toThrow(StreamGroupValidationError);
      try {
        validateStreamGroupCreate(config);
      } catch (e) {
        expect((e as StreamGroupValidationError).field).toBe('name');
      }
    });

    it('should reject empty name', () => {
      const config = {
        name: '   ',
        members: [
          { streamId: 'stream-1', position: 0 }
        ]
      };

      expect(() => validateStreamGroupCreate(config)).toThrow(/cannot be empty/);
    });

    it('should reject name with spaces', () => {
      const config = {
        name: 'invalid name',
        members: [
          { streamId: 'stream-1', position: 0 }
        ]
      };

      expect(() => validateStreamGroupCreate(config)).toThrow(/must start with alphanumeric/);
    });

    it('should reject name starting with special character', () => {
      const config = {
        name: '-invalid',
        members: [
          { streamId: 'stream-1', position: 0 }
        ]
      };

      expect(() => validateStreamGroupCreate(config)).toThrow(/must start with alphanumeric/);
    });

    it('should accept name with underscores and hyphens', () => {
      const config = {
        name: 'valid_group-name',
        members: [
          { streamId: 'stream-1', position: 0 }
        ]
      };

      const validated = validateStreamGroupCreate(config);
      expect(validated.name).toBe('valid_group-name');
    });

    it('should reject name exceeding 100 characters', () => {
      const config = {
        name: 'a'.repeat(101),
        members: [
          { streamId: 'stream-1', position: 0 }
        ]
      };

      expect(() => validateStreamGroupCreate(config)).toThrow(/cannot exceed 100 characters/);
    });

    it('should reject missing members', () => {
      const config = {
        name: 'test-group'
      };

      expect(() => validateStreamGroupCreate(config)).toThrow(/members is required/);
    });

    it('should reject empty members array', () => {
      const config = {
        name: 'test-group',
        members: []
      };

      expect(() => validateStreamGroupCreate(config)).toThrow(/cannot be empty/);
    });

    it('should reject members exceeding 50 items', () => {
      const members = Array.from({ length: 51 }, (_, i) => ({
        streamId: `stream-${i}`,
        position: i
      }));

      const config = {
        name: 'test-group',
        members
      };

      expect(() => validateStreamGroupCreate(config)).toThrow(/cannot exceed 50 items/);
    });

    it('should reject member without streamId', () => {
      const config = {
        name: 'test-group',
        members: [
          { position: 0 }
        ]
      };

      expect(() => validateStreamGroupCreate(config)).toThrow(/requires streamId/);
    });

    it('should reject member with invalid position', () => {
      const config = {
        name: 'test-group',
        members: [
          { streamId: 'stream-1', position: -1 }
        ]
      };

      expect(() => validateStreamGroupCreate(config)).toThrow(/non-negative position/);
    });

    it('should reject member with invalid delayMs', () => {
      const config = {
        name: 'test-group',
        members: [
          { streamId: 'stream-1', position: 0, delayMs: -100 }
        ]
      };

      expect(() => validateStreamGroupCreate(config)).toThrow(/delayMs must be non-negative/);
    });

    it('should reject duplicate stream IDs', () => {
      const config = {
        name: 'test-group',
        members: [
          { streamId: 'stream-1', position: 0 },
          { streamId: 'stream-1', position: 1 }
        ]
      };

      expect(() => validateStreamGroupCreate(config)).toThrow(/Duplicate streamId/);
    });

    it('should sort members by position', () => {
      const config = {
        name: 'test-group',
        members: [
          { streamId: 'stream-3', position: 2 },
          { streamId: 'stream-1', position: 0 },
          { streamId: 'stream-2', position: 1 }
        ]
      };

      const validated = validateStreamGroupCreate(config);
      expect(validated.members[0].streamId).toBe('stream-1');
      expect(validated.members[1].streamId).toBe('stream-2');
      expect(validated.members[2].streamId).toBe('stream-3');
    });

    it('should reject invalid startOrder', () => {
      const config = {
        name: 'test-group',
        members: [
          { streamId: 'stream-1', position: 0 }
        ],
        startOrder: 'invalid'
      };

      expect(() => validateStreamGroupCreate(config)).toThrow(/must be "parallel" or "sequential"/);
    });

    it('should reject invalid stopOrder', () => {
      const config = {
        name: 'test-group',
        members: [
          { streamId: 'stream-1', position: 0 }
        ],
        stopOrder: 'invalid'
      };

      expect(() => validateStreamGroupCreate(config)).toThrow(/must be "parallel", "sequential", or "reverse"/);
    });

    it('should validate all stopOrder values', () => {
      ['parallel', 'sequential', 'reverse'].forEach(stopOrder => {
        const config = {
          name: 'test-group',
          members: [{ streamId: 'stream-1', position: 0 }],
          stopOrder
        };
        expect(() => validateStreamGroupCreate(config)).not.toThrow();
      });
    });

    it('should reject negative startDelayMs', () => {
      const config = {
        name: 'test-group',
        members: [
          { streamId: 'stream-1', position: 0 }
        ],
        startDelayMs: -1
      };

      expect(() => validateStreamGroupCreate(config)).toThrow(/must be a number between 0 and 60000/);
    });

    it('should reject startDelayMs exceeding 60000', () => {
      const config = {
        name: 'test-group',
        members: [
          { streamId: 'stream-1', position: 0 }
        ],
        startDelayMs: 60001
      };

      expect(() => validateStreamGroupCreate(config)).toThrow(/must be a number between 0 and 60000/);
    });

    it('should reject negative stopDelayMs', () => {
      const config = {
        name: 'test-group',
        members: [
          { streamId: 'stream-1', position: 0 }
        ],
        stopDelayMs: -1
      };

      expect(() => validateStreamGroupCreate(config)).toThrow(/must be a number between 0 and 60000/);
    });

    it('should reject description exceeding 500 characters', () => {
      const config = {
        name: 'test-group',
        description: 'a'.repeat(501),
        members: [
          { streamId: 'stream-1', position: 0 }
        ]
      };

      expect(() => validateStreamGroupCreate(config)).toThrow(/cannot exceed 500 characters/);
    });

    it('should trim whitespace from name and description', () => {
      const config = {
        name: '  test-group  ',
        description: '  A description  ',
        members: [
          { streamId: 'stream-1', position: 0 }
        ]
      };

      const validated = validateStreamGroupCreate(config);
      expect(validated.name).toBe('test-group');
      expect(validated.description).toBe('A description');
    });

    it('should convert empty description to undefined', () => {
      const config = {
        name: 'test-group',
        description: '   ',
        members: [
          { streamId: 'stream-1', position: 0 }
        ]
      };

      const validated = validateStreamGroupCreate(config);
      expect(validated.description).toBeUndefined();
    });
  });

  describe('validateStreamGroupUpdate', () => {
    it('should validate partial updates', () => {
      const updates = {
        name: 'new-name',
        enabled: false
      };

      const validated = validateStreamGroupUpdate(updates);
      expect(validated.name).toBe('new-name');
      expect(validated.enabled).toBe(false);
    });

    it('should validate description updates', () => {
      const updates = {
        description: 'New description'
      };

      const validated = validateStreamGroupUpdate(updates);
      expect(validated.description).toBe('New description');
    });

    it('should allow null description to clear it', () => {
      const updates = {
        description: null
      };

      const validated = validateStreamGroupUpdate(updates);
      expect(validated.description).toBeUndefined();
    });

    it('should validate members update', () => {
      const updates = {
        members: [
          { streamId: 'new-stream-1', position: 0 },
          { streamId: 'new-stream-2', position: 1 }
        ]
      };

      const validated = validateStreamGroupUpdate(updates);
      expect(validated.members?.length).toBe(2);
    });

    it('should sort members by position in update', () => {
      const updates = {
        members: [
          { streamId: 'stream-2', position: 1 },
          { streamId: 'stream-1', position: 0 }
        ]
      };

      const validated = validateStreamGroupUpdate(updates);
      expect(validated.members?.[0].streamId).toBe('stream-1');
      expect(validated.members?.[1].streamId).toBe('stream-2');
    });

    it('should reject duplicate stream IDs in update', () => {
      const updates = {
        members: [
          { streamId: 'stream-1', position: 0 },
          { streamId: 'stream-1', position: 1 }
        ]
      };

      expect(() => validateStreamGroupUpdate(updates)).toThrow(/Duplicate streamId/);
    });

    it('should reject empty members in update', () => {
      const updates = {
        members: []
      };

      expect(() => validateStreamGroupUpdate(updates)).toThrow(/cannot be empty/);
    });

    it('should validate startOrder update', () => {
      const updates = {
        startOrder: 'sequential'
      };

      const validated = validateStreamGroupUpdate(updates);
      expect(validated.startOrder).toBe('sequential');
    });

    it('should validate stopOrder update', () => {
      const updates = {
        stopOrder: 'reverse'
      };

      const validated = validateStreamGroupUpdate(updates);
      expect(validated.stopOrder).toBe('reverse');
    });

    it('should validate delay updates', () => {
      const updates = {
        startDelayMs: 5000,
        stopDelayMs: 3000
      };

      const validated = validateStreamGroupUpdate(updates);
      expect(validated.startDelayMs).toBe(5000);
      expect(validated.stopDelayMs).toBe(3000);
    });

    it('should reject invalid values in updates', () => {
      const updates = {
        startDelayMs: 100000 // Above maximum
      };

      expect(() => validateStreamGroupUpdate(updates)).toThrow(/must be a number between/);
    });

    it('should return empty object for empty update', () => {
      const validated = validateStreamGroupUpdate({});
      expect(Object.keys(validated).length).toBe(0);
    });
  });
});
