/**
 * Compositor Configuration Schema
 * Defines the structure for compositor configurations stored in the database
 *
 * A compositor is an FFmpeg container that combines multiple SRT input streams
 * into a single output stream using filter_complex.
 */

import { EncodingPreset, OutputFormat } from '../config/schema.js';

// Compositor layout types
export type CompositorLayout = 'side-by-side' | 'stacked' | 'grid' | 'pip' | 'custom';

/**
 * Input source definition for a compositor
 */
export interface CompositorInput {
  name: string;           // Identifier for this input (e.g., 'left', 'right')
  listenPort: number;     // SRT listen port for this input (10001-10999)
  width?: number;         // Expected width (for scaling)
  height?: number;        // Expected height (for scaling)
  streamId?: string;      // Optional stream config ID that provides this input
}

/**
 * Picture-in-picture configuration
 */
export interface PipConfig {
  mainInput: string;      // Name of main (background) input
  pipInput: string;       // Name of PIP (overlay) input
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  pipScale: number;       // Scale factor for PIP (0.1 - 0.5, default 0.25)
  margin: number;         // Margin in pixels from edge (default 20)
}

/**
 * Full compositor configuration interface
 */
export interface CompositorConfig {
  // Identity
  id: string;                     // UUID, generated on create
  name: string;                   // Human-readable name (becomes container name)
  enabled: boolean;               // Whether to auto-start

  // Layout
  layout: CompositorLayout;
  inputs: CompositorInput[];      // 2-4 inputs typically
  customFilterComplex?: string;   // Custom filter_complex for 'custom' layout
  pipConfig?: PipConfig;          // Required when layout is 'pip'

  // Output dimensions
  outputWidth: number;            // Default: 1920
  outputHeight: number;           // Default: 1080
  outputFps: number;              // Default: 30

  // Encoding
  preset: EncodingPreset;         // Default: 'ultrafast' (compositor needs speed)
  videoBitrate: string;           // e.g., '3000k'
  audioBitrate: string;           // e.g., '128k'
  format: OutputFormat;           // Default: 'mpegts'

  // Output destination
  outputIngest: string;           // SRT or RTMP URL for output

  // Advanced
  extraFfmpegArgs?: string[];

  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
}

/**
 * Configuration for creating a new compositor
 */
export type CompositorConfigCreate = Omit<CompositorConfig, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>;

/**
 * Configuration for updating a compositor
 */
export type CompositorConfigUpdate = Partial<Omit<CompositorConfig, 'id' | 'createdAt' | 'createdBy'>>;

/**
 * Default values for compositor configuration
 */
export const COMPOSITOR_CONFIG_DEFAULTS: Omit<CompositorConfigCreate, 'name' | 'inputs' | 'outputIngest'> = {
  enabled: true,
  layout: 'side-by-side',
  outputWidth: 1920,
  outputHeight: 1080,
  outputFps: 30,
  preset: 'ultrafast',
  videoBitrate: '3000k',
  audioBitrate: '128k',
  format: 'mpegts'
};

/**
 * Validation error for compositor configuration
 */
export class CompositorConfigValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public value: unknown
  ) {
    super(message);
    this.name = 'CompositorConfigValidationError';
  }
}

/**
 * Validate a compositor name
 */
function validateName(name: string): void {
  if (!name || typeof name !== 'string') {
    throw new CompositorConfigValidationError('Name is required', 'name', name);
  }
  if (name.length < 1 || name.length > 100) {
    throw new CompositorConfigValidationError('Name must be 1-100 characters', 'name', name);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
    throw new CompositorConfigValidationError(
      'Name must start with alphanumeric and contain only alphanumeric, hyphens, or underscores',
      'name',
      name
    );
  }
}

/**
 * Validate an ingest URL (SRT or RTMP)
 */
function validateIngest(ingest: string, field: string): void {
  if (!ingest || typeof ingest !== 'string') {
    throw new CompositorConfigValidationError(`${field} is required`, field, ingest);
  }
  if (!ingest.startsWith('srt://') && !ingest.startsWith('rtmp://')) {
    throw new CompositorConfigValidationError(
      `${field} must be srt:// or rtmp:// URL`,
      field,
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
    throw new CompositorConfigValidationError(`${field} must be a number`, field, value);
  }
  if (value < min || value > max) {
    throw new CompositorConfigValidationError(
      `${field} must be between ${min} and ${max}`,
      field,
      value
    );
  }
}

/**
 * Validate bitrate format
 */
function validateBitrate(value: string, field: string): void {
  if (!value || typeof value !== 'string') {
    throw new CompositorConfigValidationError(`${field} is required`, field, value);
  }
  if (!/^\d+[kKmM]?$/.test(value)) {
    throw new CompositorConfigValidationError(
      `${field} must be a number optionally followed by k/K/m/M`,
      field,
      value
    );
  }
}

/**
 * Validate compositor layout
 */
function validateLayout(layout: string): asserts layout is CompositorLayout {
  const validLayouts: CompositorLayout[] = ['side-by-side', 'stacked', 'grid', 'pip', 'custom'];
  if (!validLayouts.includes(layout as CompositorLayout)) {
    throw new CompositorConfigValidationError(
      `Layout must be one of: ${validLayouts.join(', ')}`,
      'layout',
      layout
    );
  }
}

/**
 * Validate encoding preset
 */
function validatePreset(preset: string): asserts preset is EncodingPreset {
  const validPresets: EncodingPreset[] = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium'];
  if (!validPresets.includes(preset as EncodingPreset)) {
    throw new CompositorConfigValidationError(
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
    throw new CompositorConfigValidationError(
      `Format must be one of: ${validFormats.join(', ')}`,
      'format',
      format
    );
  }
}

/**
 * Validate compositor inputs
 */
function validateInputs(inputs: unknown[], layout: CompositorLayout): CompositorInput[] {
  if (!Array.isArray(inputs) || inputs.length < 2) {
    throw new CompositorConfigValidationError(
      'At least 2 inputs are required',
      'inputs',
      inputs
    );
  }

  if (inputs.length > 4) {
    throw new CompositorConfigValidationError(
      'Maximum 4 inputs are supported',
      'inputs',
      inputs
    );
  }

  // Validate layout-specific input requirements
  if (layout === 'pip' && inputs.length !== 2) {
    throw new CompositorConfigValidationError(
      'PIP layout requires exactly 2 inputs',
      'inputs',
      inputs
    );
  }

  if (layout === 'side-by-side' && inputs.length !== 2) {
    throw new CompositorConfigValidationError(
      'Side-by-side layout requires exactly 2 inputs',
      'inputs',
      inputs
    );
  }

  if (layout === 'stacked' && inputs.length !== 2) {
    throw new CompositorConfigValidationError(
      'Stacked layout requires exactly 2 inputs',
      'inputs',
      inputs
    );
  }

  const names = new Set<string>();
  const ports = new Set<number>();
  const validated: CompositorInput[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i] as Record<string, unknown>;

    // Validate name
    if (!input.name || typeof input.name !== 'string') {
      throw new CompositorConfigValidationError(
        `Input ${i} must have a name`,
        'inputs',
        inputs
      );
    }
    if (names.has(input.name)) {
      throw new CompositorConfigValidationError(
        `Duplicate input name: ${input.name}`,
        'inputs',
        inputs
      );
    }
    names.add(input.name);

    // Validate listen port
    const port = Number(input.listenPort);
    if (isNaN(port) || port < 10001 || port > 10999) {
      throw new CompositorConfigValidationError(
        `Input ${input.name} listenPort must be between 10001 and 10999`,
        'inputs',
        inputs
      );
    }
    if (ports.has(port)) {
      throw new CompositorConfigValidationError(
        `Duplicate listen port: ${port}`,
        'inputs',
        inputs
      );
    }
    ports.add(port);

    const validatedInput: CompositorInput = {
      name: input.name,
      listenPort: port
    };

    // Optional width/height
    if (input.width !== undefined) {
      const width = Number(input.width);
      if (isNaN(width) || width < 320 || width > 7680) {
        throw new CompositorConfigValidationError(
          `Input ${input.name} width must be between 320 and 7680`,
          'inputs',
          inputs
        );
      }
      validatedInput.width = width;
    }

    if (input.height !== undefined) {
      const height = Number(input.height);
      if (isNaN(height) || height < 240 || height > 4320) {
        throw new CompositorConfigValidationError(
          `Input ${input.name} height must be between 240 and 4320`,
          'inputs',
          inputs
        );
      }
      validatedInput.height = height;
    }

    // Optional stream ID reference
    if (input.streamId !== undefined && input.streamId !== null && input.streamId !== '') {
      if (typeof input.streamId !== 'string') {
        throw new CompositorConfigValidationError(
          `Input ${input.name} streamId must be a string`,
          'inputs',
          inputs
        );
      }
      validatedInput.streamId = input.streamId;
    }

    validated.push(validatedInput);
  }

  return validated;
}

/**
 * Validate PIP configuration
 */
function validatePipConfig(config: unknown, inputs: CompositorInput[]): PipConfig {
  if (!config || typeof config !== 'object') {
    throw new CompositorConfigValidationError(
      'PIP layout requires pipConfig',
      'pipConfig',
      config
    );
  }

  const c = config as Record<string, unknown>;
  const inputNames = new Set(inputs.map(i => i.name));

  // Validate mainInput
  if (!c.mainInput || typeof c.mainInput !== 'string') {
    throw new CompositorConfigValidationError(
      'pipConfig.mainInput is required',
      'pipConfig.mainInput',
      c.mainInput
    );
  }
  if (!inputNames.has(c.mainInput)) {
    throw new CompositorConfigValidationError(
      `pipConfig.mainInput "${c.mainInput}" must match an input name`,
      'pipConfig.mainInput',
      c.mainInput
    );
  }

  // Validate pipInput
  if (!c.pipInput || typeof c.pipInput !== 'string') {
    throw new CompositorConfigValidationError(
      'pipConfig.pipInput is required',
      'pipConfig.pipInput',
      c.pipInput
    );
  }
  if (!inputNames.has(c.pipInput)) {
    throw new CompositorConfigValidationError(
      `pipConfig.pipInput "${c.pipInput}" must match an input name`,
      'pipConfig.pipInput',
      c.pipInput
    );
  }
  if (c.mainInput === c.pipInput) {
    throw new CompositorConfigValidationError(
      'pipConfig.mainInput and pipConfig.pipInput must be different',
      'pipConfig',
      config
    );
  }

  // Validate position
  const validPositions = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  if (!c.position || !validPositions.includes(c.position as string)) {
    throw new CompositorConfigValidationError(
      `pipConfig.position must be one of: ${validPositions.join(', ')}`,
      'pipConfig.position',
      c.position
    );
  }

  // Validate scale (default 0.25)
  const scale = c.pipScale !== undefined ? Number(c.pipScale) : 0.25;
  if (isNaN(scale) || scale < 0.1 || scale > 0.5) {
    throw new CompositorConfigValidationError(
      'pipConfig.pipScale must be between 0.1 and 0.5',
      'pipConfig.pipScale',
      c.pipScale
    );
  }

  // Validate margin (default 20)
  const margin = c.margin !== undefined ? Number(c.margin) : 20;
  if (isNaN(margin) || margin < 0 || margin > 200) {
    throw new CompositorConfigValidationError(
      'pipConfig.margin must be between 0 and 200',
      'pipConfig.margin',
      c.margin
    );
  }

  return {
    mainInput: c.mainInput as string,
    pipInput: c.pipInput as string,
    position: c.position as PipConfig['position'],
    pipScale: scale,
    margin: margin
  };
}

/**
 * Validate a complete compositor configuration for creation
 */
export function validateCompositorConfig(config: unknown): CompositorConfigCreate {
  if (!config || typeof config !== 'object') {
    throw new CompositorConfigValidationError('Configuration must be an object', 'config', config);
  }

  const c = config as Record<string, unknown>;

  // Required fields
  validateName(c.name as string);
  validateIngest(c.outputIngest as string, 'outputIngest');

  // Layout with default
  const layout = (c.layout as string) || COMPOSITOR_CONFIG_DEFAULTS.layout;
  validateLayout(layout);

  // Inputs - required
  if (!c.inputs) {
    throw new CompositorConfigValidationError('inputs is required', 'inputs', c.inputs);
  }
  const inputs = validateInputs(c.inputs as unknown[], layout);

  // Boolean with default
  const enabled = c.enabled !== undefined ? Boolean(c.enabled) : COMPOSITOR_CONFIG_DEFAULTS.enabled;

  // Output dimensions with defaults
  const outputWidth = c.outputWidth !== undefined ? Number(c.outputWidth) : COMPOSITOR_CONFIG_DEFAULTS.outputWidth;
  const outputHeight = c.outputHeight !== undefined ? Number(c.outputHeight) : COMPOSITOR_CONFIG_DEFAULTS.outputHeight;
  const outputFps = c.outputFps !== undefined ? Number(c.outputFps) : COMPOSITOR_CONFIG_DEFAULTS.outputFps;

  validateRange(outputWidth, 'outputWidth', 320, 7680);
  validateRange(outputHeight, 'outputHeight', 240, 4320);
  validateRange(outputFps, 'outputFps', 1, 120);

  // Encoding with defaults
  const preset = (c.preset as string) || COMPOSITOR_CONFIG_DEFAULTS.preset;
  const videoBitrate = (c.videoBitrate as string) || COMPOSITOR_CONFIG_DEFAULTS.videoBitrate;
  const audioBitrate = (c.audioBitrate as string) || COMPOSITOR_CONFIG_DEFAULTS.audioBitrate;
  const format = (c.format as string) || COMPOSITOR_CONFIG_DEFAULTS.format;

  validatePreset(preset);
  validateBitrate(videoBitrate, 'videoBitrate');
  validateBitrate(audioBitrate, 'audioBitrate');
  validateFormat(format);

  // Layout-specific validation
  let pipConfig: PipConfig | undefined;
  let customFilterComplex: string | undefined;

  if (layout === 'pip') {
    pipConfig = validatePipConfig(c.pipConfig, inputs);
  }

  if (layout === 'custom') {
    if (!c.customFilterComplex || typeof c.customFilterComplex !== 'string') {
      throw new CompositorConfigValidationError(
        'Custom layout requires customFilterComplex',
        'customFilterComplex',
        c.customFilterComplex
      );
    }
    customFilterComplex = c.customFilterComplex;
  }

  // Optional extra args
  let extraFfmpegArgs: string[] | undefined;
  if (c.extraFfmpegArgs !== undefined) {
    if (!Array.isArray(c.extraFfmpegArgs)) {
      throw new CompositorConfigValidationError(
        'extraFfmpegArgs must be an array of strings',
        'extraFfmpegArgs',
        c.extraFfmpegArgs
      );
    }
    for (const arg of c.extraFfmpegArgs) {
      if (typeof arg !== 'string') {
        throw new CompositorConfigValidationError(
          'extraFfmpegArgs must contain only strings',
          'extraFfmpegArgs',
          c.extraFfmpegArgs
        );
      }
    }
    extraFfmpegArgs = c.extraFfmpegArgs;
  }

  return {
    name: c.name as string,
    enabled,
    layout,
    inputs,
    customFilterComplex,
    pipConfig,
    outputWidth,
    outputHeight,
    outputFps,
    preset,
    videoBitrate,
    audioBitrate,
    format,
    outputIngest: c.outputIngest as string,
    extraFfmpegArgs
  };
}

/**
 * Validate partial compositor configuration for updates
 */
export function validatePartialCompositorConfig(config: unknown): CompositorConfigUpdate {
  if (!config || typeof config !== 'object') {
    throw new CompositorConfigValidationError('Configuration must be an object', 'config', config);
  }

  const c = config as Record<string, unknown>;
  const result: CompositorConfigUpdate = {};

  if (c.name !== undefined) {
    validateName(c.name as string);
    result.name = c.name as string;
  }

  if (c.enabled !== undefined) {
    result.enabled = Boolean(c.enabled);
  }

  if (c.layout !== undefined) {
    validateLayout(c.layout as string);
    result.layout = c.layout as CompositorLayout;
  }

  if (c.inputs !== undefined) {
    const layout = (c.layout as CompositorLayout) || 'side-by-side';
    result.inputs = validateInputs(c.inputs as unknown[], layout);
  }

  if (c.outputIngest !== undefined) {
    validateIngest(c.outputIngest as string, 'outputIngest');
    result.outputIngest = c.outputIngest as string;
  }

  if (c.outputWidth !== undefined) {
    validateRange(Number(c.outputWidth), 'outputWidth', 320, 7680);
    result.outputWidth = Number(c.outputWidth);
  }

  if (c.outputHeight !== undefined) {
    validateRange(Number(c.outputHeight), 'outputHeight', 240, 4320);
    result.outputHeight = Number(c.outputHeight);
  }

  if (c.outputFps !== undefined) {
    validateRange(Number(c.outputFps), 'outputFps', 1, 120);
    result.outputFps = Number(c.outputFps);
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

  if (c.customFilterComplex !== undefined) {
    if (c.customFilterComplex === null || c.customFilterComplex === '') {
      result.customFilterComplex = undefined;
    } else if (typeof c.customFilterComplex === 'string') {
      result.customFilterComplex = c.customFilterComplex;
    } else {
      throw new CompositorConfigValidationError(
        'customFilterComplex must be a string',
        'customFilterComplex',
        c.customFilterComplex
      );
    }
  }

  if (c.pipConfig !== undefined) {
    if (c.pipConfig === null) {
      result.pipConfig = undefined;
    } else {
      const inputs = (result.inputs || []) as CompositorInput[];
      if (inputs.length > 0) {
        result.pipConfig = validatePipConfig(c.pipConfig, inputs);
      }
      // If no inputs in update, defer validation to storage layer
    }
  }

  if (c.extraFfmpegArgs !== undefined) {
    if (c.extraFfmpegArgs === null) {
      result.extraFfmpegArgs = undefined;
    } else if (Array.isArray(c.extraFfmpegArgs)) {
      for (const arg of c.extraFfmpegArgs) {
        if (typeof arg !== 'string') {
          throw new CompositorConfigValidationError(
            'extraFfmpegArgs must contain only strings',
            'extraFfmpegArgs',
            c.extraFfmpegArgs
          );
        }
      }
      result.extraFfmpegArgs = c.extraFfmpegArgs as string[];
    } else {
      throw new CompositorConfigValidationError(
        'extraFfmpegArgs must be an array of strings',
        'extraFfmpegArgs',
        c.extraFfmpegArgs
      );
    }
  }

  return result;
}

/**
 * Generate FFmpeg filter_complex string for a compositor configuration
 */
export function generateFilterComplex(config: CompositorConfigCreate | CompositorConfig): string {
  const { layout, inputs, outputWidth, outputHeight, pipConfig, customFilterComplex } = config;

  if (layout === 'custom' && customFilterComplex) {
    return customFilterComplex;
  }

  switch (layout) {
    case 'side-by-side': {
      // Two inputs side by side
      const halfWidth = Math.floor(outputWidth / 2);
      return `[0:v]scale=${halfWidth}:${outputHeight}[left];[1:v]scale=${halfWidth}:${outputHeight}[right];[left][right]hstack=inputs=2[outv]`;
    }

    case 'stacked': {
      // Two inputs stacked vertically
      const halfHeight = Math.floor(outputHeight / 2);
      return `[0:v]scale=${outputWidth}:${halfHeight}[top];[1:v]scale=${outputWidth}:${halfHeight}[bottom];[top][bottom]vstack=inputs=2[outv]`;
    }

    case 'grid': {
      // 2x2 grid for 4 inputs, 2 inputs = side-by-side, 3 inputs = 2 top + 1 bottom
      if (inputs.length === 2) {
        const halfWidth = Math.floor(outputWidth / 2);
        return `[0:v]scale=${halfWidth}:${outputHeight}[left];[1:v]scale=${halfWidth}:${outputHeight}[right];[left][right]hstack=inputs=2[outv]`;
      } else if (inputs.length === 3) {
        const halfWidth = Math.floor(outputWidth / 2);
        const halfHeight = Math.floor(outputHeight / 2);
        return `[0:v]scale=${halfWidth}:${halfHeight}[tl];[1:v]scale=${halfWidth}:${halfHeight}[tr];[2:v]scale=${outputWidth}:${halfHeight}[bottom];[tl][tr]hstack=inputs=2[top];[top][bottom]vstack=inputs=2[outv]`;
      } else {
        // 4 inputs - 2x2 grid
        const halfWidth = Math.floor(outputWidth / 2);
        const halfHeight = Math.floor(outputHeight / 2);
        return `[0:v]scale=${halfWidth}:${halfHeight}[tl];[1:v]scale=${halfWidth}:${halfHeight}[tr];[2:v]scale=${halfWidth}:${halfHeight}[bl];[3:v]scale=${halfWidth}:${halfHeight}[br];[tl][tr]hstack=inputs=2[top];[bl][br]hstack=inputs=2[bottom];[top][bottom]vstack=inputs=2[outv]`;
      }
    }

    case 'pip': {
      if (!pipConfig) {
        throw new Error('PIP layout requires pipConfig');
      }
      const mainIdx = inputs.findIndex(i => i.name === pipConfig.mainInput);
      const pipIdx = inputs.findIndex(i => i.name === pipConfig.pipInput);

      const pipWidth = Math.floor(outputWidth * pipConfig.pipScale);
      const pipHeight = Math.floor(outputHeight * pipConfig.pipScale);

      let overlayX: string;
      let overlayY: string;

      switch (pipConfig.position) {
        case 'top-left':
          overlayX = String(pipConfig.margin);
          overlayY = String(pipConfig.margin);
          break;
        case 'top-right':
          overlayX = `W-w-${pipConfig.margin}`;
          overlayY = String(pipConfig.margin);
          break;
        case 'bottom-left':
          overlayX = String(pipConfig.margin);
          overlayY = `H-h-${pipConfig.margin}`;
          break;
        case 'bottom-right':
          overlayX = `W-w-${pipConfig.margin}`;
          overlayY = `H-h-${pipConfig.margin}`;
          break;
      }

      return `[${mainIdx}:v]scale=${outputWidth}:${outputHeight}[main];[${pipIdx}:v]scale=${pipWidth}:${pipHeight}[pip];[main][pip]overlay=${overlayX}:${overlayY}[outv]`;
    }

    default:
      throw new Error(`Unknown layout: ${layout}`);
  }
}
