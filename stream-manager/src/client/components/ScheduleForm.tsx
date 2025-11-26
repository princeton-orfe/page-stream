import React, { useState, useEffect } from 'react';
import { Schedule, ScheduleTargetType, ScheduleAction } from '../types';
import { ScheduleCreateInput, ScheduleUpdateInput, useTimezones, usePreviewNextRun } from '../hooks/useSchedules';
import { useStreamConfigs } from '../hooks/useStreamConfig';
import { useStreamGroups } from '../hooks/useStreamGroups';
import { useCompositors } from '../hooks/useCompositors';

interface ScheduleFormProps {
  schedule?: Schedule;
  onSubmit: (data: ScheduleCreateInput | ScheduleUpdateInput) => Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
  submitError?: string | null;
}

// Common cron presets for quick selection
const CRON_PRESETS = [
  { label: 'Every minute', value: '* * * * *' },
  { label: 'Every 5 minutes', value: '*/5 * * * *' },
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every day at midnight', value: '0 0 * * *' },
  { label: 'Every day at 6 AM', value: '0 6 * * *' },
  { label: 'Every day at 6 PM', value: '0 18 * * *' },
  { label: 'Every Monday at 9 AM', value: '0 9 * * 1' },
  { label: 'First day of month at midnight', value: '0 0 1 * *' }
];

export function ScheduleForm({
  schedule,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitError
}: ScheduleFormProps) {
  const isEditing = !!schedule;

  // Form state
  const [name, setName] = useState(schedule?.name || '');
  const [description, setDescription] = useState(schedule?.description || '');
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true);
  const [targetType, setTargetType] = useState<ScheduleTargetType>(schedule?.targetType || 'stream');
  const [targetId, setTargetId] = useState(schedule?.targetId || '');
  const [action, setAction] = useState<ScheduleAction>(schedule?.action || 'start');
  const [cronExpression, setCronExpression] = useState(schedule?.cronExpression || '0 * * * *');
  const [timezone, setTimezone] = useState(schedule?.timezone || 'UTC');

  // Data for target selection
  const { data: streamsData } = useStreamConfigs();
  const { data: groupsData } = useStreamGroups();
  const { data: compositorsData } = useCompositors();
  const { data: timezonesData } = useTimezones();

  // Preview next run time
  const previewNextRun = usePreviewNextRun();
  const [previewedNextRun, setPreviewedNextRun] = useState<string | null>(null);
  const [cronError, setCronError] = useState<string | null>(null);

  // Update preview when cron or timezone changes
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (cronExpression.trim()) {
        try {
          const result = await previewNextRun.mutateAsync({ cronExpression, timezone });
          setPreviewedNextRun(result.nextRun);
          setCronError(null);
        } catch (e) {
          setPreviewedNextRun(null);
          setCronError((e as Error).message);
        }
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [cronExpression, timezone]);

  // Reset target ID when target type changes
  useEffect(() => {
    if (!isEditing) {
      setTargetId('');
    }
  }, [targetType, isEditing]);

  // Get available targets based on type
  const getTargetOptions = () => {
    switch (targetType) {
      case 'stream':
        return (streamsData?.configs || []).map(s => ({
          id: s.id,
          name: s.name,
          enabled: s.enabled
        }));
      case 'group':
        return (groupsData?.groups || []).map(g => ({
          id: g.id,
          name: g.name,
          enabled: g.enabled
        }));
      case 'compositor':
        return (compositorsData?.configs || []).map((c: { id: string; name: string; enabled: boolean }) => ({
          id: c.id,
          name: c.name,
          enabled: c.enabled
        }));
      default:
        return [];
    }
  };

  // Get available actions based on target type
  const getAvailableActions = (): ScheduleAction[] => {
    if (targetType === 'stream') {
      return ['start', 'stop', 'refresh'];
    }
    return ['start', 'stop'];
  };

  // Reset action if current one becomes invalid
  useEffect(() => {
    const validActions = getAvailableActions();
    if (!validActions.includes(action)) {
      setAction(validActions[0]);
    }
  }, [targetType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (cronError) {
      return; // Don't submit with invalid cron
    }

    const data: ScheduleCreateInput | ScheduleUpdateInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      enabled,
      targetType,
      targetId,
      action,
      cronExpression: cronExpression.trim(),
      timezone
    };

    await onSubmit(data);
  };

  const formatPreviewDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString();
  };

  const targetOptions = getTargetOptions();
  const availableActions = getAvailableActions();
  const timezones = timezonesData?.timezones || ['UTC'];

  return (
    <form onSubmit={handleSubmit} className="schedule-form">
      {submitError && (
        <div className="error-message" style={{ marginBottom: '16px' }}>
          {submitError}
        </div>
      )}

      {/* Basic Info Section */}
      <div className="form-section">
        <h3>Basic Information</h3>

        <div className="form-group">
          <label htmlFor="name">Name *</label>
          <input
            type="text"
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g., Start morning stream"
            style={{ width: '100%', padding: '8px' }}
          />
        </div>

        <div className="form-group">
          <label htmlFor="description">Description</label>
          <input
            type="text"
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            style={{ width: '100%', padding: '8px' }}
          />
        </div>

        <div className="form-group">
          <label>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            {' '}Enabled
          </label>
        </div>
      </div>

      {/* Target Section */}
      <div className="form-section" style={{ marginTop: '24px' }}>
        <h3>Target</h3>

        <div className="form-group">
          <label htmlFor="targetType">Target Type *</label>
          <select
            id="targetType"
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as ScheduleTargetType)}
            style={{ width: '100%', padding: '8px' }}
          >
            <option value="stream">Stream</option>
            <option value="group">Group</option>
            <option value="compositor">Compositor</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="targetId">Target *</label>
          <select
            id="targetId"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            required
            style={{ width: '100%', padding: '8px' }}
          >
            <option value="">-- Select a {targetType} --</option>
            {targetOptions.map((target: { id: string; name: string; enabled: boolean }) => (
              <option key={target.id} value={target.id}>
                {target.name} {!target.enabled && '(disabled)'}
              </option>
            ))}
          </select>
          {targetOptions.length === 0 && (
            <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>
              No {targetType}s available. Create one first.
            </div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="action">Action *</label>
          <select
            id="action"
            value={action}
            onChange={(e) => setAction(e.target.value as ScheduleAction)}
            style={{ width: '100%', padding: '8px' }}
          >
            {availableActions.map(a => (
              <option key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>
            ))}
          </select>
          {targetType !== 'stream' && action === 'refresh' && (
            <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
              Refresh action is only available for streams
            </div>
          )}
        </div>
      </div>

      {/* Schedule Section */}
      <div className="form-section" style={{ marginTop: '24px' }}>
        <h3>Schedule</h3>

        <div className="form-group">
          <label htmlFor="cronExpression">Cron Expression *</label>
          <input
            type="text"
            id="cronExpression"
            value={cronExpression}
            onChange={(e) => setCronExpression(e.target.value)}
            required
            placeholder="e.g., 0 9 * * 1-5"
            style={{
              width: '100%',
              padding: '8px',
              fontFamily: 'monospace',
              borderColor: cronError ? '#ef4444' : undefined
            }}
          />
          {cronError && (
            <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
              {cronError}
            </div>
          )}
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
            Format: minute hour day-of-month month day-of-week
          </div>
        </div>

        <div className="form-group">
          <label>Quick Presets</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
            {CRON_PRESETS.map(preset => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setCronExpression(preset.value)}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  backgroundColor: cronExpression === preset.value ? '#3b82f6' : '#f3f4f6',
                  color: cronExpression === preset.value ? '#fff' : '#374151',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="timezone">Timezone</label>
          <select
            id="timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            style={{ width: '100%', padding: '8px' }}
          >
            {timezones.map(tz => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>

        {previewedNextRun && !cronError && (
          <div style={{
            marginTop: '16px',
            padding: '12px',
            backgroundColor: '#f0fdf4',
            borderRadius: '4px',
            border: '1px solid #bbf7d0'
          }}>
            <div style={{ fontWeight: 500, color: '#166534' }}>Next Run</div>
            <div style={{ color: '#15803d' }}>{formatPreviewDate(previewedNextRun)}</div>
          </div>
        )}
      </div>

      {/* Form Actions */}
      <div className="form-actions" style={{ marginTop: '24px', display: 'flex', gap: '8px' }}>
        <button
          type="submit"
          className="action-button primary"
          disabled={isSubmitting || !!cronError || !targetId}
          style={{ padding: '10px 20px' }}
        >
          {isSubmitting ? 'Saving...' : (isEditing ? 'Update Schedule' : 'Create Schedule')}
        </button>
        <button
          type="button"
          className="action-button"
          onClick={onCancel}
          disabled={isSubmitting}
          style={{ padding: '10px 20px' }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
