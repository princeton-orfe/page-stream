import React, { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useStreamConfigs } from '../hooks/useStreamConfig';
import { GroupMember, GroupStartOrder, GroupStopOrder } from '../types';

export interface StreamGroupFormData {
  name: string;
  description: string;
  enabled: boolean;
  members: GroupMember[];
  startOrder: GroupStartOrder;
  stopOrder: GroupStopOrder;
  startDelayMs: number;
  stopDelayMs: number;
}

export const DEFAULT_FORM_DATA: StreamGroupFormData = {
  name: '',
  description: '',
  enabled: true,
  members: [],
  startOrder: 'parallel',
  stopOrder: 'parallel',
  startDelayMs: 1000,
  stopDelayMs: 1000
};

interface Props {
  initialData?: Partial<StreamGroupFormData>;
  onSubmit: (data: StreamGroupFormData) => void;
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

export function StreamGroupForm({
  initialData,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel = 'Save',
  readOnly = false,
  metadata
}: Props) {
  const [formData, setFormData] = useState<StreamGroupFormData>({
    ...DEFAULT_FORM_DATA,
    ...initialData
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { hasCapability } = useAuth();
  const { data: streamConfigsData } = useStreamConfigs();

  const canEdit = !readOnly && (hasCapability('groups:create') || hasCapability('groups:update'));
  const streamConfigs = streamConfigsData?.configs || [];

  // Initialize members from initialData when stream configs load
  useEffect(() => {
    if (initialData?.members && streamConfigs.length > 0) {
      setFormData(prev => ({
        ...prev,
        members: initialData.members || []
      }));
    }
  }, [initialData?.members, streamConfigs.length]);

  const updateField = useCallback(<K extends keyof StreamGroupFormData>(
    field: K,
    value: StreamGroupFormData[K]
  ) => {
    setFormData(prev => ({ ...prev, [field]: value }));
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

    if (!formData.name || formData.name.trim() === '') {
      newErrors.name = 'Name is required';
    } else if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(formData.name)) {
      newErrors.name = 'Name must start with alphanumeric and contain only alphanumeric, hyphens, or underscores';
    }

    if (formData.members.length === 0) {
      newErrors.members = 'At least one stream must be selected';
    }

    if (formData.startDelayMs < 0 || formData.startDelayMs > 60000) {
      newErrors.startDelayMs = 'Start delay must be between 0 and 60000 ms';
    }

    if (formData.stopDelayMs < 0 || formData.stopDelayMs > 60000) {
      newErrors.stopDelayMs = 'Stop delay must be between 0 and 60000 ms';
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

  const handleAddMember = useCallback((streamId: string) => {
    if (formData.members.some(m => m.streamId === streamId)) return;

    const newMember: GroupMember = {
      streamId,
      position: formData.members.length
    };
    updateField('members', [...formData.members, newMember]);
  }, [formData.members, updateField]);

  const handleRemoveMember = useCallback((streamId: string) => {
    const newMembers = formData.members
      .filter(m => m.streamId !== streamId)
      .map((m, i) => ({ ...m, position: i }));
    updateField('members', newMembers);
  }, [formData.members, updateField]);

  const handleMoveMember = useCallback((streamId: string, direction: 'up' | 'down') => {
    const idx = formData.members.findIndex(m => m.streamId === streamId);
    if (idx === -1) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === formData.members.length - 1) return;

    const newMembers = [...formData.members];
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    [newMembers[idx], newMembers[swapIdx]] = [newMembers[swapIdx], newMembers[idx]];

    // Update positions
    newMembers.forEach((m, i) => { m.position = i; });
    updateField('members', newMembers);
  }, [formData.members, updateField]);

  const handleMemberDelayChange = useCallback((streamId: string, delayMs: number | undefined) => {
    const newMembers = formData.members.map(m =>
      m.streamId === streamId ? { ...m, delayMs } : m
    );
    updateField('members', newMembers);
  }, [formData.members, updateField]);

  const availableStreams = streamConfigs.filter(
    config => !formData.members.some(m => m.streamId === config.id)
  );

  const getStreamName = (streamId: string) => {
    const config = streamConfigs.find(c => c.id === streamId);
    return config?.name || streamId;
  };

  return (
    <form className="stream-group-form" onSubmit={handleSubmit}>
      <div className="form-section">
        <h3>Basic Information</h3>

        <div className="form-group">
          <label htmlFor="name">Name *</label>
          <input
            id="name"
            type="text"
            className={`form-input ${errors.name ? 'error' : ''}`}
            value={formData.name}
            onChange={(e) => updateField('name', e.target.value)}
            disabled={!canEdit || isSubmitting}
            placeholder="my-stream-group"
          />
          {errors.name && <span className="form-error">{errors.name}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            className="form-input"
            value={formData.description}
            onChange={(e) => updateField('description', e.target.value)}
            disabled={!canEdit || isSubmitting}
            placeholder="Optional description for this group"
            rows={2}
          />
        </div>

        <div className="form-group">
          <label>
            <input
              type="checkbox"
              checked={formData.enabled}
              onChange={(e) => updateField('enabled', e.target.checked)}
              disabled={!canEdit || isSubmitting}
            />
            {' '}Enabled
          </label>
          <span className="form-help">Disabled groups cannot be started</span>
        </div>
      </div>

      <div className="form-section">
        <h3>Member Streams</h3>

        <div className="form-group">
          <label>Add Stream</label>
          <select
            className="form-input"
            value=""
            onChange={(e) => {
              if (e.target.value) handleAddMember(e.target.value);
            }}
            disabled={!canEdit || isSubmitting || availableStreams.length === 0}
          >
            <option value="">Select a stream to add...</option>
            {availableStreams.map(config => (
              <option key={config.id} value={config.id}>
                {config.name}
              </option>
            ))}
          </select>
        </div>

        {errors.members && (
          <div className="form-error" style={{ marginBottom: '8px' }}>{errors.members}</div>
        )}

        {formData.members.length > 0 && (
          <div className="members-list">
            <table className="data-table" style={{ fontSize: '12px' }}>
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>#</th>
                  <th>Stream</th>
                  <th style={{ width: '120px' }}>Delay (ms)</th>
                  <th style={{ width: '100px' }}>Order</th>
                  <th style={{ width: '60px' }}>Remove</th>
                </tr>
              </thead>
              <tbody>
                {formData.members.map((member, idx) => (
                  <tr key={member.streamId}>
                    <td>{idx + 1}</td>
                    <td>{getStreamName(member.streamId)}</td>
                    <td>
                      <input
                        type="number"
                        className="form-input"
                        style={{ width: '100px', padding: '2px 4px' }}
                        value={member.delayMs ?? ''}
                        placeholder="default"
                        onChange={(e) => {
                          const val = e.target.value ? parseInt(e.target.value) : undefined;
                          handleMemberDelayChange(member.streamId, val);
                        }}
                        disabled={!canEdit || isSubmitting}
                        min={0}
                        max={60000}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="action-button small"
                        onClick={() => handleMoveMember(member.streamId, 'up')}
                        disabled={!canEdit || isSubmitting || idx === 0}
                        style={{ marginRight: '4px' }}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className="action-button small"
                        onClick={() => handleMoveMember(member.streamId, 'down')}
                        disabled={!canEdit || isSubmitting || idx === formData.members.length - 1}
                      >
                        Down
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="action-button small danger"
                        onClick={() => handleRemoveMember(member.streamId)}
                        disabled={!canEdit || isSubmitting}
                      >
                        X
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {formData.members.length === 0 && (
          <div className="empty-state" style={{ padding: '16px', fontSize: '12px' }}>
            No streams added yet. Select streams from the dropdown above.
          </div>
        )}
      </div>

      <div className="form-section">
        <h3>Start/Stop Order</h3>

        <div className="form-row" style={{ display: 'flex', gap: '16px' }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label htmlFor="startOrder">Start Order</label>
            <select
              id="startOrder"
              className="form-input"
              value={formData.startOrder}
              onChange={(e) => updateField('startOrder', e.target.value as GroupStartOrder)}
              disabled={!canEdit || isSubmitting}
            >
              <option value="parallel">Parallel - Start all at once</option>
              <option value="sequential">Sequential - Start one by one</option>
            </select>
          </div>

          <div className="form-group" style={{ flex: 1 }}>
            <label htmlFor="stopOrder">Stop Order</label>
            <select
              id="stopOrder"
              className="form-input"
              value={formData.stopOrder}
              onChange={(e) => updateField('stopOrder', e.target.value as GroupStopOrder)}
              disabled={!canEdit || isSubmitting}
            >
              <option value="parallel">Parallel - Stop all at once</option>
              <option value="sequential">Sequential - Stop one by one</option>
              <option value="reverse">Reverse - Stop in reverse order</option>
            </select>
          </div>
        </div>

        <div className="form-row" style={{ display: 'flex', gap: '16px' }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label htmlFor="startDelayMs">Start Delay (ms)</label>
            <input
              id="startDelayMs"
              type="number"
              className={`form-input ${errors.startDelayMs ? 'error' : ''}`}
              value={formData.startDelayMs}
              onChange={(e) => updateField('startDelayMs', parseInt(e.target.value) || 0)}
              disabled={!canEdit || isSubmitting}
              min={0}
              max={60000}
            />
            {errors.startDelayMs && <span className="form-error">{errors.startDelayMs}</span>}
            <span className="form-help">Default delay between sequential starts</span>
          </div>

          <div className="form-group" style={{ flex: 1 }}>
            <label htmlFor="stopDelayMs">Stop Delay (ms)</label>
            <input
              id="stopDelayMs"
              type="number"
              className={`form-input ${errors.stopDelayMs ? 'error' : ''}`}
              value={formData.stopDelayMs}
              onChange={(e) => updateField('stopDelayMs', parseInt(e.target.value) || 0)}
              disabled={!canEdit || isSubmitting}
              min={0}
              max={60000}
            />
            {errors.stopDelayMs && <span className="form-error">{errors.stopDelayMs}</span>}
            <span className="form-help">Default delay between sequential stops</span>
          </div>
        </div>
      </div>

      {metadata && (
        <div className="form-section metadata">
          <h3>Metadata</h3>
          <div className="metadata-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
            {metadata.createdAt && (
              <div>
                <strong>Created:</strong> {new Date(metadata.createdAt).toLocaleString()}
              </div>
            )}
            {metadata.createdBy && (
              <div>
                <strong>Created by:</strong> {metadata.createdBy}
              </div>
            )}
            {metadata.updatedAt && (
              <div>
                <strong>Updated:</strong> {new Date(metadata.updatedAt).toLocaleString()}
              </div>
            )}
            {metadata.updatedBy && (
              <div>
                <strong>Updated by:</strong> {metadata.updatedBy}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="form-actions" style={{ marginTop: '24px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="action-button"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </button>
        {canEdit && (
          <button
            type="submit"
            className="action-button primary"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Saving...' : submitLabel}
          </button>
        )}
      </div>
    </form>
  );
}
