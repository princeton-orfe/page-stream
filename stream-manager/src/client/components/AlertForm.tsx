import React, { useState, useEffect } from 'react';
import {
  AlertRule,
  AlertTargetType,
  AlertConditionType,
  AlertSeverity,
  AlertCondition,
  NotificationChannel,
  WebhookNotification,
  EmailNotification
} from '../types';
import { AlertRuleCreateInput, AlertRuleUpdateInput } from '../hooks/useAlerts';
import { useStreamConfigs } from '../hooks/useStreamConfig';
import { useStreamGroups } from '../hooks/useStreamGroups';
import { useCompositors } from '../hooks/useCompositors';

interface AlertFormProps {
  alertRule?: AlertRule;
  onSubmit: (data: AlertRuleCreateInput | AlertRuleUpdateInput) => Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
  submitError?: string | null;
}

const CONDITION_TYPES: { value: AlertConditionType; label: string; description: string }[] = [
  { value: 'status_changed', label: 'Status Changed', description: 'Alert when container status changes' },
  { value: 'status_is', label: 'Status Is', description: 'Alert when container has specific status for a duration' },
  { value: 'health_unhealthy', label: 'Health Unhealthy', description: 'Alert when container health check fails' },
  { value: 'restart_count', label: 'Restart Count', description: 'Alert when container restarts too many times' },
  { value: 'offline_duration', label: 'Offline Duration', description: 'Alert when container is offline for too long' },
  { value: 'schedule_failed', label: 'Schedule Failed', description: 'Alert when a scheduled action fails' }
];

const CONTAINER_STATUSES = ['running', 'stopped', 'restarting', 'exited'];

const SEVERITIES: { value: AlertSeverity; label: string; color: string }[] = [
  { value: 'info', label: 'Info', color: '#0891b2' },
  { value: 'warning', label: 'Warning', color: '#d97706' },
  { value: 'critical', label: 'Critical', color: '#dc2626' }
];

export function AlertForm({
  alertRule,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitError
}: AlertFormProps) {
  const isEditing = !!alertRule;

  // Form state - basic
  const [name, setName] = useState(alertRule?.name || '');
  const [description, setDescription] = useState(alertRule?.description || '');
  const [enabled, setEnabled] = useState(alertRule?.enabled ?? true);
  const [targetType, setTargetType] = useState<AlertTargetType>(alertRule?.targetType || 'any');
  const [targetId, setTargetId] = useState(alertRule?.targetId || '');
  const [severity, setSeverity] = useState<AlertSeverity>(alertRule?.severity || 'warning');
  const [cooldownMinutes, setCooldownMinutes] = useState(alertRule?.cooldownMinutes ?? 15);

  // Condition state
  const [conditionType, setConditionType] = useState<AlertConditionType>(alertRule?.condition.type || 'status_changed');
  const [statusFrom, setStatusFrom] = useState(alertRule?.condition.statusFrom || '');
  const [statusTo, setStatusTo] = useState(alertRule?.condition.statusTo || '');
  const [status, setStatus] = useState(alertRule?.condition.status || 'stopped');
  const [durationSeconds, setDurationSeconds] = useState(alertRule?.condition.durationSeconds ?? 300);
  const [threshold, setThreshold] = useState(alertRule?.condition.threshold ?? 3);
  const [timeWindowSeconds, setTimeWindowSeconds] = useState(alertRule?.condition.timeWindowSeconds ?? 3600);

  // Notification state
  const [notifications, setNotifications] = useState<NotificationChannel[]>(alertRule?.notifications || []);
  const [newNotificationType, setNewNotificationType] = useState<'webhook' | 'email'>('webhook');
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [newEmailRecipients, setNewEmailRecipients] = useState('');

  // Data for target selection
  const { data: streamsData } = useStreamConfigs();
  const { data: groupsData } = useStreamGroups();
  const { data: compositorsData } = useCompositors();

  // Reset target ID when target type changes to 'any'
  useEffect(() => {
    if (targetType === 'any') {
      setTargetId('');
    }
  }, [targetType]);

  // Get available targets based on type
  const getTargetOptions = () => {
    switch (targetType) {
      case 'stream':
        return (streamsData?.configs || []).map(s => ({
          id: s.id,
          name: s.name
        }));
      case 'group':
        return (groupsData?.groups || []).map(g => ({
          id: g.id,
          name: g.name
        }));
      case 'compositor':
        return (compositorsData?.configs || []).map((c: { id: string; name: string }) => ({
          id: c.id,
          name: c.name
        }));
      default:
        return [];
    }
  };

  const buildCondition = (): AlertCondition => {
    const condition: AlertCondition = { type: conditionType };

    switch (conditionType) {
      case 'status_changed':
        if (statusFrom) condition.statusFrom = statusFrom;
        if (statusTo) condition.statusTo = statusTo;
        break;
      case 'status_is':
        condition.status = status;
        if (durationSeconds > 0) condition.durationSeconds = durationSeconds;
        break;
      case 'health_unhealthy':
        if (durationSeconds > 0) condition.durationSeconds = durationSeconds;
        break;
      case 'restart_count':
        condition.threshold = threshold;
        condition.timeWindowSeconds = timeWindowSeconds;
        break;
      case 'offline_duration':
        condition.durationSeconds = durationSeconds;
        break;
      case 'schedule_failed':
        // No additional params
        break;
    }

    return condition;
  };

  const addNotification = () => {
    if (newNotificationType === 'webhook' && newWebhookUrl.trim()) {
      try {
        new URL(newWebhookUrl);
        const webhook: WebhookNotification = {
          type: 'webhook',
          url: newWebhookUrl.trim()
        };
        setNotifications([...notifications, webhook]);
        setNewWebhookUrl('');
      } catch {
        alert('Invalid URL format');
      }
    } else if (newNotificationType === 'email' && newEmailRecipients.trim()) {
      const emails = newEmailRecipients.split(',').map(e => e.trim()).filter(e => e);
      if (emails.length > 0) {
        const email: EmailNotification = {
          type: 'email',
          recipients: emails
        };
        setNotifications([...notifications, email]);
        setNewEmailRecipients('');
      }
    }
  };

  const removeNotification = (index: number) => {
    setNotifications(notifications.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const data: AlertRuleCreateInput | AlertRuleUpdateInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      enabled,
      targetType,
      targetId: targetId || undefined,
      condition: buildCondition(),
      severity,
      notifications,
      cooldownMinutes
    };

    await onSubmit(data);
  };

  const targetOptions = getTargetOptions();

  return (
    <form onSubmit={handleSubmit} className="alert-form">
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
            placeholder="e.g., Stream offline alert"
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

        <div className="form-group">
          <label htmlFor="severity">Severity</label>
          <select
            id="severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as AlertSeverity)}
            style={{ width: '100%', padding: '8px' }}
          >
            {SEVERITIES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Target Section */}
      <div className="form-section" style={{ marginTop: '24px' }}>
        <h3>Target</h3>

        <div className="form-group">
          <label htmlFor="targetType">Target Type</label>
          <select
            id="targetType"
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as AlertTargetType)}
            style={{ width: '100%', padding: '8px' }}
          >
            <option value="any">Any (All Streams & Compositors)</option>
            <option value="stream">Stream</option>
            <option value="group">Group</option>
            <option value="compositor">Compositor</option>
          </select>
        </div>

        {targetType !== 'any' && (
          <div className="form-group">
            <label htmlFor="targetId">Specific Target (optional)</label>
            <select
              id="targetId"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              style={{ width: '100%', padding: '8px' }}
            >
              <option value="">All {targetType}s</option>
              {targetOptions.map((target: { id: string; name: string }) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Condition Section */}
      <div className="form-section" style={{ marginTop: '24px' }}>
        <h3>Condition</h3>

        <div className="form-group">
          <label htmlFor="conditionType">Condition Type *</label>
          <select
            id="conditionType"
            value={conditionType}
            onChange={(e) => setConditionType(e.target.value as AlertConditionType)}
            style={{ width: '100%', padding: '8px' }}
          >
            {CONDITION_TYPES.map(ct => (
              <option key={ct.value} value={ct.value}>{ct.label}</option>
            ))}
          </select>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
            {CONDITION_TYPES.find(ct => ct.value === conditionType)?.description}
          </div>
        </div>

        {/* Condition-specific fields */}
        {conditionType === 'status_changed' && (
          <>
            <div className="form-group">
              <label htmlFor="statusFrom">From Status (optional)</label>
              <select
                id="statusFrom"
                value={statusFrom}
                onChange={(e) => setStatusFrom(e.target.value)}
                style={{ width: '100%', padding: '8px' }}
              >
                <option value="">Any status</option>
                {CONTAINER_STATUSES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="statusTo">To Status (optional)</label>
              <select
                id="statusTo"
                value={statusTo}
                onChange={(e) => setStatusTo(e.target.value)}
                style={{ width: '100%', padding: '8px' }}
              >
                <option value="">Any status</option>
                {CONTAINER_STATUSES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </>
        )}

        {conditionType === 'status_is' && (
          <>
            <div className="form-group">
              <label htmlFor="status">Status *</label>
              <select
                id="status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                style={{ width: '100%', padding: '8px' }}
              >
                {CONTAINER_STATUSES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="durationSeconds">Duration (seconds)</label>
              <input
                type="number"
                id="durationSeconds"
                value={durationSeconds}
                onChange={(e) => setDurationSeconds(parseInt(e.target.value) || 0)}
                min={0}
                style={{ width: '100%', padding: '8px' }}
              />
            </div>
          </>
        )}

        {conditionType === 'health_unhealthy' && (
          <div className="form-group">
            <label htmlFor="durationSeconds">Duration (seconds, optional)</label>
            <input
              type="number"
              id="durationSeconds"
              value={durationSeconds}
              onChange={(e) => setDurationSeconds(parseInt(e.target.value) || 0)}
              min={0}
              style={{ width: '100%', padding: '8px' }}
            />
          </div>
        )}

        {conditionType === 'restart_count' && (
          <>
            <div className="form-group">
              <label htmlFor="threshold">Restart Threshold *</label>
              <input
                type="number"
                id="threshold"
                value={threshold}
                onChange={(e) => setThreshold(parseInt(e.target.value) || 1)}
                min={1}
                style={{ width: '100%', padding: '8px' }}
              />
            </div>
            <div className="form-group">
              <label htmlFor="timeWindowSeconds">Time Window (seconds)</label>
              <input
                type="number"
                id="timeWindowSeconds"
                value={timeWindowSeconds}
                onChange={(e) => setTimeWindowSeconds(parseInt(e.target.value) || 3600)}
                min={60}
                style={{ width: '100%', padding: '8px' }}
              />
              <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                Alert if container restarts {threshold} times within {Math.floor(timeWindowSeconds / 60)} minutes
              </div>
            </div>
          </>
        )}

        {conditionType === 'offline_duration' && (
          <div className="form-group">
            <label htmlFor="durationSeconds">Offline Duration (seconds) *</label>
            <input
              type="number"
              id="durationSeconds"
              value={durationSeconds}
              onChange={(e) => setDurationSeconds(parseInt(e.target.value) || 60)}
              min={1}
              style={{ width: '100%', padding: '8px' }}
            />
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
              Alert if container is offline for more than {Math.floor(durationSeconds / 60)} minutes
            </div>
          </div>
        )}
      </div>

      {/* Cooldown Section */}
      <div className="form-section" style={{ marginTop: '24px' }}>
        <h3>Cooldown</h3>
        <div className="form-group">
          <label htmlFor="cooldownMinutes">Cooldown (minutes)</label>
          <input
            type="number"
            id="cooldownMinutes"
            value={cooldownMinutes}
            onChange={(e) => setCooldownMinutes(parseInt(e.target.value) || 0)}
            min={0}
            style={{ width: '100%', padding: '8px' }}
          />
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
            Minimum time between notifications for this alert (0 = no cooldown)
          </div>
        </div>
      </div>

      {/* Notifications Section */}
      <div className="form-section" style={{ marginTop: '24px' }}>
        <h3>Notifications</h3>

        {/* Existing notifications */}
        {notifications.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            {notifications.map((notif, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  backgroundColor: '#f3f4f6',
                  borderRadius: '4px',
                  marginBottom: '8px'
                }}
              >
                <div>
                  <span style={{ fontWeight: 500 }}>{notif.type}: </span>
                  {notif.type === 'webhook' && (notif as WebhookNotification).url}
                  {notif.type === 'email' && (notif as EmailNotification).recipients.join(', ')}
                </div>
                <button
                  type="button"
                  onClick={() => removeNotification(index)}
                  style={{
                    padding: '4px 8px',
                    backgroundColor: '#ef4444',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add notification */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <div style={{ width: '120px' }}>
            <label>Type</label>
            <select
              value={newNotificationType}
              onChange={(e) => setNewNotificationType(e.target.value as 'webhook' | 'email')}
              style={{ width: '100%', padding: '8px' }}
            >
              <option value="webhook">Webhook</option>
              <option value="email">Email</option>
            </select>
          </div>

          {newNotificationType === 'webhook' && (
            <div style={{ flex: 1 }}>
              <label>Webhook URL</label>
              <input
                type="url"
                value={newWebhookUrl}
                onChange={(e) => setNewWebhookUrl(e.target.value)}
                placeholder="https://example.com/webhook"
                style={{ width: '100%', padding: '8px' }}
              />
            </div>
          )}

          {newNotificationType === 'email' && (
            <div style={{ flex: 1 }}>
              <label>Email Recipients (comma-separated)</label>
              <input
                type="text"
                value={newEmailRecipients}
                onChange={(e) => setNewEmailRecipients(e.target.value)}
                placeholder="user@example.com, user2@example.com"
                style={{ width: '100%', padding: '8px' }}
              />
            </div>
          )}

          <button
            type="button"
            onClick={addNotification}
            style={{
              padding: '8px 16px',
              backgroundColor: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Add
          </button>
        </div>

        {notifications.length === 0 && (
          <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '8px' }}>
            No notifications configured. Alert events will still be recorded.
          </div>
        )}
      </div>

      {/* Form Actions */}
      <div className="form-actions" style={{ marginTop: '24px', display: 'flex', gap: '8px' }}>
        <button
          type="submit"
          className="action-button primary"
          disabled={isSubmitting || !name.trim()}
          style={{ padding: '10px 20px' }}
        >
          {isSubmitting ? 'Saving...' : (isEditing ? 'Update Alert Rule' : 'Create Alert Rule')}
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
