import React, { useState, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';

// Stream configuration types matching server schema
export type StreamType = 'standard' | 'compositor-source' | 'compositor';
export type EncodingPreset = 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium';
export type OutputFormat = 'mpegts' | 'flv';

export interface StreamFormData {
  name: string;
  type: StreamType;
  enabled: boolean;
  url: string;
  injectCss?: string;
  injectJs?: string;
  width: number;
  height: number;
  fps: number;
  cropInfobar: number;
  preset: EncodingPreset;
  videoBitrate: string;
  audioBitrate: string;
  format: OutputFormat;
  ingest: string;
  autoRefreshSeconds: number;
  reconnectAttempts: number;
  reconnectInitialDelayMs: number;
  reconnectMaxDelayMs: number;
  healthIntervalSeconds: number;
  extraFfmpegArgs?: string[];
  inputFfmpegFlags?: string;
  display?: string;
}

export const DEFAULT_FORM_DATA: StreamFormData = {
  name: '',
  type: 'standard',
  enabled: true,
  url: '',
  width: 1920,
  height: 1080,
  fps: 30,
  cropInfobar: 0,
  preset: 'veryfast',
  videoBitrate: '2500k',
  audioBitrate: '128k',
  format: 'mpegts',
  ingest: '',
  autoRefreshSeconds: 0,
  reconnectAttempts: 0,
  reconnectInitialDelayMs: 1000,
  reconnectMaxDelayMs: 30000,
  healthIntervalSeconds: 30
};

interface Props {
  initialData?: Partial<StreamFormData>;
  onSubmit: (data: StreamFormData) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
  readOnly?: boolean;
  metadata?: {
    createdAt?: string;
    updatedAt?: string;
    createdBy?: string;
    updatedBy?: string;
  };
}

type TabId = 'basic' | 'encoding' | 'behavior' | 'advanced';

const TABS: { id: TabId; label: string }[] = [
  { id: 'basic', label: 'Basic' },
  { id: 'encoding', label: 'Encoding' },
  { id: 'behavior', label: 'Behavior' },
  { id: 'advanced', label: 'Advanced' }
];

export function StreamForm({
  initialData,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel = 'Save',
  readOnly = false,
  metadata
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('basic');
  const [formData, setFormData] = useState<StreamFormData>({
    ...DEFAULT_FORM_DATA,
    ...initialData
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { hasCapability } = useAuth();

  const canEdit = !readOnly && (hasCapability('streams:create') || hasCapability('streams:update'));

  const updateField = useCallback(<K extends keyof StreamFormData>(
    field: K,
    value: StreamFormData[K]
  ) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when field is modified
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }, [errors]);

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    // Name validation
    if (!formData.name || formData.name.trim() === '') {
      newErrors.name = 'Name is required';
    } else if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(formData.name)) {
      newErrors.name = 'Name must start with alphanumeric and contain only alphanumeric, hyphens, or underscores';
    }

    // URL validation
    if (!formData.url || formData.url.trim() === '') {
      newErrors.url = 'URL is required';
    } else if (
      !formData.url.startsWith('http://') &&
      !formData.url.startsWith('https://') &&
      !formData.url.startsWith('file://') &&
      !formData.url.startsWith('/')
    ) {
      newErrors.url = 'URL must be http(s)://, file://, or an absolute path';
    }

    // Ingest validation
    if (!formData.ingest || formData.ingest.trim() === '') {
      newErrors.ingest = 'Ingest URL is required';
    } else if (
      !formData.ingest.startsWith('srt://') &&
      !formData.ingest.startsWith('rtmp://')
    ) {
      newErrors.ingest = 'Ingest must be srt:// or rtmp:// URL';
    }

    // Numeric validations
    if (formData.width < 320 || formData.width > 7680) {
      newErrors.width = 'Width must be between 320 and 7680';
    }
    if (formData.height < 240 || formData.height > 4320) {
      newErrors.height = 'Height must be between 240 and 4320';
    }
    if (formData.fps < 1 || formData.fps > 120) {
      newErrors.fps = 'FPS must be between 1 and 120';
    }

    // Bitrate validation
    if (!/^\d+[kKmM]?$/.test(formData.videoBitrate)) {
      newErrors.videoBitrate = 'Invalid bitrate format (e.g., 2500k)';
    }
    if (!/^\d+[kKmM]?$/.test(formData.audioBitrate)) {
      newErrors.audioBitrate = 'Invalid bitrate format (e.g., 128k)';
    }

    // Display validation
    if (formData.display && !/^:\d+$/.test(formData.display)) {
      newErrors.display = 'Display must be in format :N (e.g., :99)';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onSubmit(formData);
    }
  }, [formData, validate, onSubmit]);

  const renderBasicTab = () => (
    <div className="form-section">
      <div className="form-group">
        <label htmlFor="name">Name *</label>
        <input
          id="name"
          type="text"
          value={formData.name}
          onChange={(e) => updateField('name', e.target.value)}
          placeholder="my-stream"
          disabled={!canEdit}
          className={errors.name ? 'error' : ''}
        />
        {errors.name && <span className="form-error">{errors.name}</span>}
        <span className="form-hint">Container-compatible name (alphanumeric, hyphens, underscores)</span>
      </div>

      <div className="form-group">
        <label htmlFor="type">Type</label>
        <select
          id="type"
          value={formData.type}
          onChange={(e) => updateField('type', e.target.value as StreamType)}
          disabled={!canEdit}
        >
          <option value="standard">Standard</option>
          <option value="compositor-source">Compositor Source</option>
          <option value="compositor">Compositor</option>
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="url">Page URL *</label>
        <input
          id="url"
          type="text"
          value={formData.url}
          onChange={(e) => updateField('url', e.target.value)}
          placeholder="https://example.com/page"
          disabled={!canEdit}
          className={errors.url ? 'error' : ''}
        />
        {errors.url && <span className="form-error">{errors.url}</span>}
        <span className="form-hint">HTTP(S) URL, file:// path, or absolute path</span>
      </div>

      <div className="form-group">
        <label htmlFor="ingest">Ingest URL *</label>
        <input
          id="ingest"
          type="text"
          value={formData.ingest}
          onChange={(e) => updateField('ingest', e.target.value)}
          placeholder="srt://host:port?streamid=..."
          disabled={!canEdit}
          className={errors.ingest ? 'error' : ''}
        />
        {errors.ingest && <span className="form-error">{errors.ingest}</span>}
        <span className="form-hint">SRT or RTMP URL for streaming output</span>
      </div>

      <div className="form-group checkbox-group">
        <label>
          <input
            type="checkbox"
            checked={formData.enabled}
            onChange={(e) => updateField('enabled', e.target.checked)}
            disabled={!canEdit}
          />
          <span>Enabled (auto-start when deployed)</span>
        </label>
      </div>
    </div>
  );

  const renderEncodingTab = () => (
    <div className="form-section">
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="width">Width</label>
          <input
            id="width"
            type="number"
            value={formData.width}
            onChange={(e) => updateField('width', parseInt(e.target.value) || 0)}
            min={320}
            max={7680}
            disabled={!canEdit}
            className={errors.width ? 'error' : ''}
          />
          {errors.width && <span className="form-error">{errors.width}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="height">Height</label>
          <input
            id="height"
            type="number"
            value={formData.height}
            onChange={(e) => updateField('height', parseInt(e.target.value) || 0)}
            min={240}
            max={4320}
            disabled={!canEdit}
            className={errors.height ? 'error' : ''}
          />
          {errors.height && <span className="form-error">{errors.height}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="fps">FPS</label>
          <input
            id="fps"
            type="number"
            value={formData.fps}
            onChange={(e) => updateField('fps', parseInt(e.target.value) || 0)}
            min={1}
            max={120}
            disabled={!canEdit}
            className={errors.fps ? 'error' : ''}
          />
          {errors.fps && <span className="form-error">{errors.fps}</span>}
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label htmlFor="preset">Encoding Preset</label>
          <select
            id="preset"
            value={formData.preset}
            onChange={(e) => updateField('preset', e.target.value as EncodingPreset)}
            disabled={!canEdit}
          >
            <option value="ultrafast">Ultra Fast</option>
            <option value="superfast">Super Fast</option>
            <option value="veryfast">Very Fast</option>
            <option value="faster">Faster</option>
            <option value="fast">Fast</option>
            <option value="medium">Medium</option>
          </select>
          <span className="form-hint">Faster = lower quality, lower CPU</span>
        </div>

        <div className="form-group">
          <label htmlFor="format">Output Format</label>
          <select
            id="format"
            value={formData.format}
            onChange={(e) => updateField('format', e.target.value as OutputFormat)}
            disabled={!canEdit}
          >
            <option value="mpegts">MPEG-TS (SRT)</option>
            <option value="flv">FLV (RTMP)</option>
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label htmlFor="videoBitrate">Video Bitrate</label>
          <input
            id="videoBitrate"
            type="text"
            value={formData.videoBitrate}
            onChange={(e) => updateField('videoBitrate', e.target.value)}
            placeholder="2500k"
            disabled={!canEdit}
            className={errors.videoBitrate ? 'error' : ''}
          />
          {errors.videoBitrate && <span className="form-error">{errors.videoBitrate}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="audioBitrate">Audio Bitrate</label>
          <input
            id="audioBitrate"
            type="text"
            value={formData.audioBitrate}
            onChange={(e) => updateField('audioBitrate', e.target.value)}
            placeholder="128k"
            disabled={!canEdit}
            className={errors.audioBitrate ? 'error' : ''}
          />
          {errors.audioBitrate && <span className="form-error">{errors.audioBitrate}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="cropInfobar">Crop Infobar (px)</label>
          <input
            id="cropInfobar"
            type="number"
            value={formData.cropInfobar}
            onChange={(e) => updateField('cropInfobar', parseInt(e.target.value) || 0)}
            min={0}
            max={1000}
            disabled={!canEdit}
          />
          <span className="form-hint">Pixels to crop from bottom</span>
        </div>
      </div>
    </div>
  );

  const renderBehaviorTab = () => (
    <div className="form-section">
      <div className="form-group">
        <label htmlFor="autoRefreshSeconds">Auto Refresh (seconds)</label>
        <input
          id="autoRefreshSeconds"
          type="number"
          value={formData.autoRefreshSeconds}
          onChange={(e) => updateField('autoRefreshSeconds', parseInt(e.target.value) || 0)}
          min={0}
          max={86400}
          disabled={!canEdit}
        />
        <span className="form-hint">0 = disabled. Automatically refresh the page at this interval.</span>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label htmlFor="reconnectAttempts">Reconnect Attempts</label>
          <input
            id="reconnectAttempts"
            type="number"
            value={formData.reconnectAttempts}
            onChange={(e) => updateField('reconnectAttempts', parseInt(e.target.value) || 0)}
            min={0}
            max={1000}
            disabled={!canEdit}
          />
          <span className="form-hint">0 = infinite</span>
        </div>

        <div className="form-group">
          <label htmlFor="reconnectInitialDelayMs">Initial Delay (ms)</label>
          <input
            id="reconnectInitialDelayMs"
            type="number"
            value={formData.reconnectInitialDelayMs}
            onChange={(e) => updateField('reconnectInitialDelayMs', parseInt(e.target.value) || 0)}
            min={100}
            max={60000}
            disabled={!canEdit}
          />
        </div>

        <div className="form-group">
          <label htmlFor="reconnectMaxDelayMs">Max Delay (ms)</label>
          <input
            id="reconnectMaxDelayMs"
            type="number"
            value={formData.reconnectMaxDelayMs}
            onChange={(e) => updateField('reconnectMaxDelayMs', parseInt(e.target.value) || 0)}
            min={1000}
            max={300000}
            disabled={!canEdit}
          />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="healthIntervalSeconds">Health Check Interval (seconds)</label>
        <input
          id="healthIntervalSeconds"
          type="number"
          value={formData.healthIntervalSeconds}
          onChange={(e) => updateField('healthIntervalSeconds', parseInt(e.target.value) || 0)}
          min={5}
          max={3600}
          disabled={!canEdit}
        />
        <span className="form-hint">How often to report health status</span>
      </div>
    </div>
  );

  const renderAdvancedTab = () => (
    <div className="form-section">
      <div className="form-group">
        <label htmlFor="display">X11 Display</label>
        <input
          id="display"
          type="text"
          value={formData.display || ''}
          onChange={(e) => updateField('display', e.target.value || undefined)}
          placeholder=":99 (auto-assigned if empty)"
          disabled={!canEdit}
          className={errors.display ? 'error' : ''}
        />
        {errors.display && <span className="form-error">{errors.display}</span>}
        <span className="form-hint">Leave empty for auto-assignment</span>
      </div>

      <div className="form-group">
        <label htmlFor="injectCss">Inject CSS Path</label>
        <input
          id="injectCss"
          type="text"
          value={formData.injectCss || ''}
          onChange={(e) => updateField('injectCss', e.target.value || undefined)}
          placeholder="/path/to/styles.css"
          disabled={!canEdit}
        />
        <span className="form-hint">Absolute path to CSS file to inject into page</span>
      </div>

      <div className="form-group">
        <label htmlFor="injectJs">Inject JS Path</label>
        <input
          id="injectJs"
          type="text"
          value={formData.injectJs || ''}
          onChange={(e) => updateField('injectJs', e.target.value || undefined)}
          placeholder="/path/to/script.js"
          disabled={!canEdit}
        />
        <span className="form-hint">Absolute path to JavaScript file to inject into page</span>
      </div>

      <div className="form-group">
        <label htmlFor="inputFfmpegFlags">Input FFmpeg Flags</label>
        <input
          id="inputFfmpegFlags"
          type="text"
          value={formData.inputFfmpegFlags || ''}
          onChange={(e) => updateField('inputFfmpegFlags', e.target.value || undefined)}
          placeholder="-thread_queue_size 512"
          disabled={!canEdit}
        />
        <span className="form-hint">Additional FFmpeg input flags</span>
      </div>

      <div className="form-group">
        <label htmlFor="extraFfmpegArgs">Extra FFmpeg Arguments</label>
        <textarea
          id="extraFfmpegArgs"
          value={(formData.extraFfmpegArgs || []).join('\n')}
          onChange={(e) => {
            const lines = e.target.value.split('\n').filter(l => l.trim());
            updateField('extraFfmpegArgs', lines.length > 0 ? lines : undefined);
          }}
          placeholder="-filter:v 'setpts=PTS-STARTPTS'&#10;-tune zerolatency"
          rows={4}
          disabled={!canEdit}
        />
        <span className="form-hint">One argument per line</span>
      </div>

      {metadata && (
        <div className="form-metadata">
          <h4>Metadata</h4>
          <dl className="metadata-grid">
            {metadata.createdAt && (
              <>
                <dt>Created</dt>
                <dd>{new Date(metadata.createdAt).toLocaleString()}</dd>
              </>
            )}
            {metadata.createdBy && (
              <>
                <dt>Created By</dt>
                <dd>{metadata.createdBy}</dd>
              </>
            )}
            {metadata.updatedAt && (
              <>
                <dt>Last Updated</dt>
                <dd>{new Date(metadata.updatedAt).toLocaleString()}</dd>
              </>
            )}
            {metadata.updatedBy && (
              <>
                <dt>Updated By</dt>
                <dd>{metadata.updatedBy}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case 'basic':
        return renderBasicTab();
      case 'encoding':
        return renderEncodingTab();
      case 'behavior':
        return renderBehaviorTab();
      case 'advanced':
        return renderAdvancedTab();
    }
  };

  return (
    <form className="stream-form" onSubmit={handleSubmit}>
      <div className="form-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`form-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="form-content">
        {renderTabContent()}
      </div>

      <div className="form-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </button>
        {canEdit && (
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Saving...' : submitLabel}
          </button>
        )}
      </div>
    </form>
  );
}
