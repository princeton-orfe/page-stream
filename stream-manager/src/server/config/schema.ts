/**
 * Stream Configuration Schema
 * Defines the structure for stream configurations stored in the database
 */

// Stream types supported by page-stream
export type StreamType = 'standard' | 'compositor-source' | 'compositor';

// FFmpeg encoding presets
export type EncodingPreset = 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium';

// Output format types
export type OutputFormat = 'mpegts' | 'flv';

/**
 * Full stream configuration interface
 */
export interface StreamConfig {
  // Identity
  id: string;                    // UUID, generated on create
  name: string;                  // Human-readable name (becomes container name)
  type: StreamType;
  enabled: boolean;              // Whether to auto-start

  // Content
  url: string;                   // Page URL or file path
  injectCss?: string;            // Path to CSS file
  injectJs?: string;             // Path to JS file

  // Display
  width: number;                 // Default: 1920
  height: number;                // Default: 1080
  fps: number;                   // Default: 30
  cropInfobar: number;           // Default: 0

  // Encoding
  preset: EncodingPreset;        // Default: 'veryfast'
  videoBitrate: string;          // e.g., '2500k'
  audioBitrate: string;          // e.g., '128k'
  format: OutputFormat;          // Default: 'mpegts'

  // Output
  ingest: string;                // SRT or RTMP URL

  // Behavior
  autoRefreshSeconds: number;    // 0 = disabled
  reconnectAttempts: number;     // 0 = infinite
  reconnectInitialDelayMs: number;
  reconnectMaxDelayMs: number;
  healthIntervalSeconds: number;

  // Advanced
  extraFfmpegArgs?: string[];
  inputFfmpegFlags?: string;
  display?: string;              // X11 display, auto-assigned if not specified

  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy: string;             // User ID who created
  updatedBy?: string;            // User ID who last updated
}

/**
 * Configuration for creating a new stream (excludes auto-generated fields)
 */
export type StreamConfigCreate = Omit<StreamConfig, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>;

/**
 * Configuration for updating a stream (all fields optional except what's being changed)
 */
export type StreamConfigUpdate = Partial<Omit<StreamConfig, 'id' | 'createdAt' | 'createdBy'>>;

/**
 * Default values for stream configuration
 */
export const STREAM_CONFIG_DEFAULTS: Omit<StreamConfigCreate, 'name' | 'url' | 'ingest'> = {
  type: 'standard',
  enabled: true,
  width: 1920,
  height: 1080,
  fps: 30,
  cropInfobar: 0,
  preset: 'veryfast',
  videoBitrate: '2500k',
  audioBitrate: '128k',
  format: 'mpegts',
  autoRefreshSeconds: 0,
  reconnectAttempts: 0,
  reconnectInitialDelayMs: 1000,
  reconnectMaxDelayMs: 30000,
  healthIntervalSeconds: 30
};

/**
 * Validation error for stream configuration
 */
export class StreamConfigValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public value: unknown
  ) {
    super(message);
    this.name = 'StreamConfigValidationError';
  }
}

/**
 * Validate a stream name
 */
function validateName(name: string): void {
  if (!name || typeof name !== 'string') {
    throw new StreamConfigValidationError('Name is required', 'name', name);
  }
  if (name.length < 1 || name.length > 100) {
    throw new StreamConfigValidationError('Name must be 1-100 characters', 'name', name);
  }
  // Container name compatible (alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
    throw new StreamConfigValidationError(
      'Name must start with alphanumeric and contain only alphanumeric, hyphens, or underscores',
      'name',
      name
    );
  }
}

/**
 * Validate a URL (page URL or file path)
 */
function validateUrl(url: string): void {
  if (!url || typeof url !== 'string') {
    throw new StreamConfigValidationError('URL is required', 'url', url);
  }
  // Allow http(s)://, file://, or absolute paths
  if (!url.startsWith('http://') && !url.startsWith('https://') &&
      !url.startsWith('file://') && !url.startsWith('/')) {
    throw new StreamConfigValidationError(
      'URL must be http(s)://, file://, or an absolute path',
      'url',
      url
    );
  }
}

/**
 * Validate an ingest URL (SRT or RTMP)
 */
function validateIngest(ingest: string): void {
  if (!ingest || typeof ingest !== 'string') {
    throw new StreamConfigValidationError('Ingest URL is required', 'ingest', ingest);
  }
  if (!ingest.startsWith('srt://') && !ingest.startsWith('rtmp://')) {
    throw new StreamConfigValidationError(
      'Ingest must be srt:// or rtmp:// URL',
      'ingest',
      ingest
    );
  }
}

/**
 * Validate numeric range
 */
function validateRange(
  value: number,
  field: string,
  min: number,
  max: number
): void {
  if (typeof value !== 'number' || isNaN(value)) {
    throw new StreamConfigValidationError(`${field} must be a number`, field, value);
  }
  if (value < min || value > max) {
    throw new StreamConfigValidationError(
      `${field} must be between ${min} and ${max}`,
      field,
      value
    );
  }
}

/**
 * Validate bitrate format (e.g., '2500k', '5M')
 */
function validateBitrate(value: string, field: string): void {
  if (!value || typeof value !== 'string') {
    throw new StreamConfigValidationError(`${field} is required`, field, value);
  }
  if (!/^\d+[kKmM]?$/.test(value)) {
    throw new StreamConfigValidationError(
      `${field} must be a number optionally followed by k/K/m/M (e.g., '2500k')`,
      field,
      value
    );
  }
}

/**
 * Validate stream type
 */
function validateStreamType(type: string): asserts type is StreamType {
  const validTypes: StreamType[] = ['standard', 'compositor-source', 'compositor'];
  if (!validTypes.includes(type as StreamType)) {
    throw new StreamConfigValidationError(
      `Type must be one of: ${validTypes.join(', ')}`,
      'type',
      type
    );
  }
}

/**
 * Validate encoding preset
 */
function validatePreset(preset: string): asserts preset is EncodingPreset {
  const validPresets: EncodingPreset[] = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium'];
  if (!validPresets.includes(preset as EncodingPreset)) {
    throw new StreamConfigValidationError(
      `Preset must be one of: ${validPresets.join(', ')}`,
      'preset',
      preset
    );
  }
}

/**
 * Validate output format
 */
function validateFormat(format: string): asserts format is OutputFormat {
  const validFormats: OutputFormat[] = ['mpegts', 'flv'];
  if (!validFormats.includes(format as OutputFormat)) {
    throw new StreamConfigValidationError(
      `Format must be one of: ${validFormats.join(', ')}`,
      'format',
      format
    );
  }
}

/**
 * Validate optional path (CSS or JS injection)
 */
function validateOptionalPath(value: string | undefined, field: string): void {
  if (value !== undefined && value !== null && value !== '') {
    if (typeof value !== 'string') {
      throw new StreamConfigValidationError(`${field} must be a string`, field, value);
    }
    // Must be an absolute path or relative to known location
    if (!value.startsWith('/') && !value.startsWith('./')) {
      throw new StreamConfigValidationError(
        `${field} must be an absolute path or start with ./`,
        field,
        value
      );
    }
  }
}

/**
 * Validate X11 display format
 */
function validateDisplay(display: string | undefined): void {
  if (display !== undefined && display !== null && display !== '') {
    if (!/^:\d+$/.test(display)) {
      throw new StreamConfigValidationError(
        'Display must be in format :N (e.g., :99)',
        'display',
        display
      );
    }
  }
}

/**
 * Validate a complete stream configuration for creation
 */
export function validateStreamConfig(config: unknown): StreamConfigCreate {
  if (!config || typeof config !== 'object') {
    throw new StreamConfigValidationError('Configuration must be an object', 'config', config);
  }

  const c = config as Record<string, unknown>;

  // Required fields
  validateName(c.name as string);
  validateUrl(c.url as string);
  validateIngest(c.ingest as string);

  // Type with default
  const type = (c.type as string) || STREAM_CONFIG_DEFAULTS.type;
  validateStreamType(type);

  // Boolean with default
  const enabled = c.enabled !== undefined ? Boolean(c.enabled) : STREAM_CONFIG_DEFAULTS.enabled;

  // Display settings with defaults
  const width = c.width !== undefined ? Number(c.width) : STREAM_CONFIG_DEFAULTS.width;
  const height = c.height !== undefined ? Number(c.height) : STREAM_CONFIG_DEFAULTS.height;
  const fps = c.fps !== undefined ? Number(c.fps) : STREAM_CONFIG_DEFAULTS.fps;
  const cropInfobar = c.cropInfobar !== undefined ? Number(c.cropInfobar) : STREAM_CONFIG_DEFAULTS.cropInfobar;

  validateRange(width, 'width', 320, 7680);
  validateRange(height, 'height', 240, 4320);
  validateRange(fps, 'fps', 1, 120);
  validateRange(cropInfobar, 'cropInfobar', 0, 1000);

  // Encoding settings with defaults
  const preset = (c.preset as string) || STREAM_CONFIG_DEFAULTS.preset;
  const videoBitrate = (c.videoBitrate as string) || STREAM_CONFIG_DEFAULTS.videoBitrate;
  const audioBitrate = (c.audioBitrate as string) || STREAM_CONFIG_DEFAULTS.audioBitrate;
  const format = (c.format as string) || STREAM_CONFIG_DEFAULTS.format;

  validatePreset(preset);
  validateBitrate(videoBitrate, 'videoBitrate');
  validateBitrate(audioBitrate, 'audioBitrate');
  validateFormat(format);

  // Behavior settings with defaults
  const autoRefreshSeconds = c.autoRefreshSeconds !== undefined
    ? Number(c.autoRefreshSeconds) : STREAM_CONFIG_DEFAULTS.autoRefreshSeconds;
  const reconnectAttempts = c.reconnectAttempts !== undefined
    ? Number(c.reconnectAttempts) : STREAM_CONFIG_DEFAULTS.reconnectAttempts;
  const reconnectInitialDelayMs = c.reconnectInitialDelayMs !== undefined
    ? Number(c.reconnectInitialDelayMs) : STREAM_CONFIG_DEFAULTS.reconnectInitialDelayMs;
  const reconnectMaxDelayMs = c.reconnectMaxDelayMs !== undefined
    ? Number(c.reconnectMaxDelayMs) : STREAM_CONFIG_DEFAULTS.reconnectMaxDelayMs;
  const healthIntervalSeconds = c.healthIntervalSeconds !== undefined
    ? Number(c.healthIntervalSeconds) : STREAM_CONFIG_DEFAULTS.healthIntervalSeconds;

  validateRange(autoRefreshSeconds, 'autoRefreshSeconds', 0, 86400);
  validateRange(reconnectAttempts, 'reconnectAttempts', 0, 1000);
  validateRange(reconnectInitialDelayMs, 'reconnectInitialDelayMs', 100, 60000);
  validateRange(reconnectMaxDelayMs, 'reconnectMaxDelayMs', 1000, 300000);
  validateRange(healthIntervalSeconds, 'healthIntervalSeconds', 5, 3600);

  // Optional fields
  const injectCss = c.injectCss as string | undefined;
  const injectJs = c.injectJs as string | undefined;
  const display = c.display as string | undefined;
  const extraFfmpegArgs = c.extraFfmpegArgs as string[] | undefined;
  const inputFfmpegFlags = c.inputFfmpegFlags as string | undefined;

  validateOptionalPath(injectCss, 'injectCss');
  validateOptionalPath(injectJs, 'injectJs');
  validateDisplay(display);

  // Validate extraFfmpegArgs is array of strings
  if (extraFfmpegArgs !== undefined) {
    if (!Array.isArray(extraFfmpegArgs)) {
      throw new StreamConfigValidationError(
        'extraFfmpegArgs must be an array of strings',
        'extraFfmpegArgs',
        extraFfmpegArgs
      );
    }
    for (const arg of extraFfmpegArgs) {
      if (typeof arg !== 'string') {
        throw new StreamConfigValidationError(
          'extraFfmpegArgs must contain only strings',
          'extraFfmpegArgs',
          extraFfmpegArgs
        );
      }
    }
  }

  // Validate inputFfmpegFlags is string
  if (inputFfmpegFlags !== undefined && typeof inputFfmpegFlags !== 'string') {
    throw new StreamConfigValidationError(
      'inputFfmpegFlags must be a string',
      'inputFfmpegFlags',
      inputFfmpegFlags
    );
  }

  return {
    name: c.name as string,
    type,
    enabled,
    url: c.url as string,
    injectCss: injectCss || undefined,
    injectJs: injectJs || undefined,
    width,
    height,
    fps,
    cropInfobar,
    preset,
    videoBitrate,
    audioBitrate,
    format,
    ingest: c.ingest as string,
    autoRefreshSeconds,
    reconnectAttempts,
    reconnectInitialDelayMs,
    reconnectMaxDelayMs,
    healthIntervalSeconds,
    extraFfmpegArgs: extraFfmpegArgs || undefined,
    inputFfmpegFlags: inputFfmpegFlags || undefined,
    display: display || undefined
  };
}

/**
 * Validate partial stream configuration for updates
 */
export function validatePartialStreamConfig(config: unknown): StreamConfigUpdate {
  if (!config || typeof config !== 'object') {
    throw new StreamConfigValidationError('Configuration must be an object', 'config', config);
  }

  const c = config as Record<string, unknown>;
  const result: StreamConfigUpdate = {};

  // Validate each field if present
  if (c.name !== undefined) {
    validateName(c.name as string);
    result.name = c.name as string;
  }

  if (c.type !== undefined) {
    validateStreamType(c.type as string);
    result.type = c.type as StreamType;
  }

  if (c.enabled !== undefined) {
    result.enabled = Boolean(c.enabled);
  }

  if (c.url !== undefined) {
    validateUrl(c.url as string);
    result.url = c.url as string;
  }

  if (c.ingest !== undefined) {
    validateIngest(c.ingest as string);
    result.ingest = c.ingest as string;
  }

  if (c.injectCss !== undefined) {
    if (c.injectCss === null || c.injectCss === '') {
      result.injectCss = undefined;
    } else {
      validateOptionalPath(c.injectCss as string, 'injectCss');
      result.injectCss = c.injectCss as string;
    }
  }

  if (c.injectJs !== undefined) {
    if (c.injectJs === null || c.injectJs === '') {
      result.injectJs = undefined;
    } else {
      validateOptionalPath(c.injectJs as string, 'injectJs');
      result.injectJs = c.injectJs as string;
    }
  }

  if (c.width !== undefined) {
    validateRange(Number(c.width), 'width', 320, 7680);
    result.width = Number(c.width);
  }

  if (c.height !== undefined) {
    validateRange(Number(c.height), 'height', 240, 4320);
    result.height = Number(c.height);
  }

  if (c.fps !== undefined) {
    validateRange(Number(c.fps), 'fps', 1, 120);
    result.fps = Number(c.fps);
  }

  if (c.cropInfobar !== undefined) {
    validateRange(Number(c.cropInfobar), 'cropInfobar', 0, 1000);
    result.cropInfobar = Number(c.cropInfobar);
  }

  if (c.preset !== undefined) {
    validatePreset(c.preset as string);
    result.preset = c.preset as EncodingPreset;
  }

  if (c.videoBitrate !== undefined) {
    validateBitrate(c.videoBitrate as string, 'videoBitrate');
    result.videoBitrate = c.videoBitrate as string;
  }

  if (c.audioBitrate !== undefined) {
    validateBitrate(c.audioBitrate as string, 'audioBitrate');
    result.audioBitrate = c.audioBitrate as string;
  }

  if (c.format !== undefined) {
    validateFormat(c.format as string);
    result.format = c.format as OutputFormat;
  }

  if (c.autoRefreshSeconds !== undefined) {
    validateRange(Number(c.autoRefreshSeconds), 'autoRefreshSeconds', 0, 86400);
    result.autoRefreshSeconds = Number(c.autoRefreshSeconds);
  }

  if (c.reconnectAttempts !== undefined) {
    validateRange(Number(c.reconnectAttempts), 'reconnectAttempts', 0, 1000);
    result.reconnectAttempts = Number(c.reconnectAttempts);
  }

  if (c.reconnectInitialDelayMs !== undefined) {
    validateRange(Number(c.reconnectInitialDelayMs), 'reconnectInitialDelayMs', 100, 60000);
    result.reconnectInitialDelayMs = Number(c.reconnectInitialDelayMs);
  }

  if (c.reconnectMaxDelayMs !== undefined) {
    validateRange(Number(c.reconnectMaxDelayMs), 'reconnectMaxDelayMs', 1000, 300000);
    result.reconnectMaxDelayMs = Number(c.reconnectMaxDelayMs);
  }

  if (c.healthIntervalSeconds !== undefined) {
    validateRange(Number(c.healthIntervalSeconds), 'healthIntervalSeconds', 5, 3600);
    result.healthIntervalSeconds = Number(c.healthIntervalSeconds);
  }

  if (c.display !== undefined) {
    if (c.display === null || c.display === '') {
      result.display = undefined;
    } else {
      validateDisplay(c.display as string);
      result.display = c.display as string;
    }
  }

  if (c.extraFfmpegArgs !== undefined) {
    if (c.extraFfmpegArgs === null) {
      result.extraFfmpegArgs = undefined;
    } else if (Array.isArray(c.extraFfmpegArgs)) {
      for (const arg of c.extraFfmpegArgs) {
        if (typeof arg !== 'string') {
          throw new StreamConfigValidationError(
            'extraFfmpegArgs must contain only strings',
            'extraFfmpegArgs',
            c.extraFfmpegArgs
          );
        }
      }
      result.extraFfmpegArgs = c.extraFfmpegArgs as string[];
    } else {
      throw new StreamConfigValidationError(
        'extraFfmpegArgs must be an array of strings',
        'extraFfmpegArgs',
        c.extraFfmpegArgs
      );
    }
  }

  if (c.inputFfmpegFlags !== undefined) {
    if (c.inputFfmpegFlags === null || c.inputFfmpegFlags === '') {
      result.inputFfmpegFlags = undefined;
    } else if (typeof c.inputFfmpegFlags === 'string') {
      result.inputFfmpegFlags = c.inputFfmpegFlags;
    } else {
      throw new StreamConfigValidationError(
        'inputFfmpegFlags must be a string',
        'inputFfmpegFlags',
        c.inputFfmpegFlags
      );
    }
  }

  return result;
}
