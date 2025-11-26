/**
 * Stream Group Schema
 * Defines the structure for stream groups that allow organizing and
 * controlling multiple streams together with ordered startup/shutdown.
 */

/**
 * Order type for starting/stopping streams
 */
export type GroupStartOrder = 'parallel' | 'sequential';
export type GroupStopOrder = 'parallel' | 'sequential' | 'reverse';

/**
 * Member of a stream group with order position
 */
export interface GroupMember {
  streamId: string;       // Reference to stream config ID
  position: number;       // Order position (used when sequential)
  delayMs?: number;       // Delay before starting this member (sequential only)
}

/**
 * Full stream group configuration interface
 */
export interface StreamGroup {
  // Identity
  id: string;                     // UUID, generated on create
  name: string;                   // Human-readable name
  description?: string;           // Optional description
  enabled: boolean;               // Whether group is active

  // Members
  members: GroupMember[];         // Stream IDs in this group

  // Ordering
  startOrder: GroupStartOrder;    // How to start streams
  stopOrder: GroupStopOrder;      // How to stop streams
  startDelayMs: number;           // Default delay between sequential starts (ms)
  stopDelayMs: number;            // Default delay between sequential stops (ms)

  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
}

/**
 * Configuration for creating a new stream group
 */
export type StreamGroupCreate = Omit<StreamGroup, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>;

/**
 * Configuration for updating a stream group
 */
export type StreamGroupUpdate = Partial<Omit<StreamGroup, 'id' | 'createdAt' | 'createdBy'>>;

/**
 * Default values for stream group configuration
 */
export const STREAM_GROUP_DEFAULTS: Omit<StreamGroupCreate, 'name' | 'members'> = {
  enabled: true,
  description: undefined,
  startOrder: 'parallel',
  stopOrder: 'parallel',
  startDelayMs: 1000,
  stopDelayMs: 1000
};

/**
 * Custom validation error for stream groups
 */
export class StreamGroupValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(message);
    this.name = 'StreamGroupValidationError';
  }
}

/**
 * Validate group member
 */
function validateMember(member: unknown, index: number): GroupMember {
  if (!member || typeof member !== 'object') {
    throw new StreamGroupValidationError(`Member at index ${index} must be an object`, `members[${index}]`);
  }

  const m = member as Record<string, unknown>;

  // streamId required
  if (!m.streamId || typeof m.streamId !== 'string') {
    throw new StreamGroupValidationError(`Member at index ${index} requires streamId`, `members[${index}].streamId`);
  }

  // position required and must be non-negative
  if (typeof m.position !== 'number' || m.position < 0) {
    throw new StreamGroupValidationError(`Member at index ${index} requires non-negative position`, `members[${index}].position`);
  }

  // delayMs optional but must be non-negative
  if (m.delayMs !== undefined && (typeof m.delayMs !== 'number' || m.delayMs < 0)) {
    throw new StreamGroupValidationError(`Member at index ${index} delayMs must be non-negative`, `members[${index}].delayMs`);
  }

  return {
    streamId: m.streamId,
    position: m.position,
    delayMs: m.delayMs as number | undefined
  };
}

/**
 * Validate stream group creation input
 */
export function validateStreamGroupCreate(input: unknown): StreamGroupCreate {
  if (!input || typeof input !== 'object') {
    throw new StreamGroupValidationError('Input must be an object');
  }

  const data = input as Record<string, unknown>;

  // Name validation
  if (!data.name || typeof data.name !== 'string') {
    throw new StreamGroupValidationError('name is required and must be a string', 'name');
  }

  const name = data.name.trim();
  if (name.length === 0) {
    throw new StreamGroupValidationError('name cannot be empty', 'name');
  }
  if (name.length > 100) {
    throw new StreamGroupValidationError('name cannot exceed 100 characters', 'name');
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
    throw new StreamGroupValidationError('name must start with alphanumeric and contain only alphanumeric, underscore, or hyphen', 'name');
  }

  // Description validation (optional)
  let description: string | undefined;
  if (data.description !== undefined) {
    if (typeof data.description !== 'string') {
      throw new StreamGroupValidationError('description must be a string', 'description');
    }
    description = data.description.trim() || undefined;
    if (description && description.length > 500) {
      throw new StreamGroupValidationError('description cannot exceed 500 characters', 'description');
    }
  }

  // Enabled validation
  let enabled = STREAM_GROUP_DEFAULTS.enabled;
  if (data.enabled !== undefined) {
    if (typeof data.enabled !== 'boolean') {
      throw new StreamGroupValidationError('enabled must be a boolean', 'enabled');
    }
    enabled = data.enabled;
  }

  // Members validation
  if (!data.members || !Array.isArray(data.members)) {
    throw new StreamGroupValidationError('members is required and must be an array', 'members');
  }
  if (data.members.length === 0) {
    throw new StreamGroupValidationError('members array cannot be empty', 'members');
  }
  if (data.members.length > 50) {
    throw new StreamGroupValidationError('members array cannot exceed 50 items', 'members');
  }

  const members = data.members.map((m, i) => validateMember(m, i));

  // Check for duplicate stream IDs
  const streamIds = new Set<string>();
  for (const member of members) {
    if (streamIds.has(member.streamId)) {
      throw new StreamGroupValidationError(`Duplicate streamId: ${member.streamId}`, 'members');
    }
    streamIds.add(member.streamId);
  }

  // Sort members by position
  members.sort((a, b) => a.position - b.position);

  // Start order validation
  let startOrder = STREAM_GROUP_DEFAULTS.startOrder;
  if (data.startOrder !== undefined) {
    if (!['parallel', 'sequential'].includes(data.startOrder as string)) {
      throw new StreamGroupValidationError('startOrder must be "parallel" or "sequential"', 'startOrder');
    }
    startOrder = data.startOrder as GroupStartOrder;
  }

  // Stop order validation
  let stopOrder = STREAM_GROUP_DEFAULTS.stopOrder;
  if (data.stopOrder !== undefined) {
    if (!['parallel', 'sequential', 'reverse'].includes(data.stopOrder as string)) {
      throw new StreamGroupValidationError('stopOrder must be "parallel", "sequential", or "reverse"', 'stopOrder');
    }
    stopOrder = data.stopOrder as GroupStopOrder;
  }

  // Delay validation
  let startDelayMs = STREAM_GROUP_DEFAULTS.startDelayMs;
  if (data.startDelayMs !== undefined) {
    if (typeof data.startDelayMs !== 'number' || data.startDelayMs < 0 || data.startDelayMs > 60000) {
      throw new StreamGroupValidationError('startDelayMs must be a number between 0 and 60000', 'startDelayMs');
    }
    startDelayMs = data.startDelayMs;
  }

  let stopDelayMs = STREAM_GROUP_DEFAULTS.stopDelayMs;
  if (data.stopDelayMs !== undefined) {
    if (typeof data.stopDelayMs !== 'number' || data.stopDelayMs < 0 || data.stopDelayMs > 60000) {
      throw new StreamGroupValidationError('stopDelayMs must be a number between 0 and 60000', 'stopDelayMs');
    }
    stopDelayMs = data.stopDelayMs;
  }

  return {
    name,
    description,
    enabled,
    members,
    startOrder,
    stopOrder,
    startDelayMs,
    stopDelayMs
  };
}

/**
 * Validate partial stream group update input
 */
export function validateStreamGroupUpdate(input: unknown): StreamGroupUpdate {
  if (!input || typeof input !== 'object') {
    throw new StreamGroupValidationError('Input must be an object');
  }

  const data = input as Record<string, unknown>;
  const result: StreamGroupUpdate = {};

  // Name validation
  if (data.name !== undefined) {
    if (typeof data.name !== 'string') {
      throw new StreamGroupValidationError('name must be a string', 'name');
    }
    const name = data.name.trim();
    if (name.length === 0) {
      throw new StreamGroupValidationError('name cannot be empty', 'name');
    }
    if (name.length > 100) {
      throw new StreamGroupValidationError('name cannot exceed 100 characters', 'name');
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
      throw new StreamGroupValidationError('name must start with alphanumeric and contain only alphanumeric, underscore, or hyphen', 'name');
    }
    result.name = name;
  }

  // Description validation
  if (data.description !== undefined) {
    if (data.description !== null && typeof data.description !== 'string') {
      throw new StreamGroupValidationError('description must be a string or null', 'description');
    }
    const desc = typeof data.description === 'string' ? data.description.trim() : undefined;
    if (desc && desc.length > 500) {
      throw new StreamGroupValidationError('description cannot exceed 500 characters', 'description');
    }
    result.description = desc || undefined;
  }

  // Enabled validation
  if (data.enabled !== undefined) {
    if (typeof data.enabled !== 'boolean') {
      throw new StreamGroupValidationError('enabled must be a boolean', 'enabled');
    }
    result.enabled = data.enabled;
  }

  // Members validation
  if (data.members !== undefined) {
    if (!Array.isArray(data.members)) {
      throw new StreamGroupValidationError('members must be an array', 'members');
    }
    if (data.members.length === 0) {
      throw new StreamGroupValidationError('members array cannot be empty', 'members');
    }
    if (data.members.length > 50) {
      throw new StreamGroupValidationError('members array cannot exceed 50 items', 'members');
    }

    const members = data.members.map((m, i) => validateMember(m, i));

    // Check for duplicate stream IDs
    const streamIds = new Set<string>();
    for (const member of members) {
      if (streamIds.has(member.streamId)) {
        throw new StreamGroupValidationError(`Duplicate streamId: ${member.streamId}`, 'members');
      }
      streamIds.add(member.streamId);
    }

    // Sort members by position
    members.sort((a, b) => a.position - b.position);
    result.members = members;
  }

  // Start order validation
  if (data.startOrder !== undefined) {
    if (!['parallel', 'sequential'].includes(data.startOrder as string)) {
      throw new StreamGroupValidationError('startOrder must be "parallel" or "sequential"', 'startOrder');
    }
    result.startOrder = data.startOrder as GroupStartOrder;
  }

  // Stop order validation
  if (data.stopOrder !== undefined) {
    if (!['parallel', 'sequential', 'reverse'].includes(data.stopOrder as string)) {
      throw new StreamGroupValidationError('stopOrder must be "parallel", "sequential", or "reverse"', 'stopOrder');
    }
    result.stopOrder = data.stopOrder as GroupStopOrder;
  }

  // Delay validation
  if (data.startDelayMs !== undefined) {
    if (typeof data.startDelayMs !== 'number' || data.startDelayMs < 0 || data.startDelayMs > 60000) {
      throw new StreamGroupValidationError('startDelayMs must be a number between 0 and 60000', 'startDelayMs');
    }
    result.startDelayMs = data.startDelayMs;
  }

  if (data.stopDelayMs !== undefined) {
    if (typeof data.stopDelayMs !== 'number' || data.stopDelayMs < 0 || data.stopDelayMs > 60000) {
      throw new StreamGroupValidationError('stopDelayMs must be a number between 0 and 60000', 'stopDelayMs');
    }
    result.stopDelayMs = data.stopDelayMs;
  }

  return result;
}
