import React, { useState } from 'react';
import {
  useAlertRules,
  useAlertEvents,
  useAlertRuleControl,
  useDeleteAlertRule,
  useAcknowledgeAlertEvent,
  useAcknowledgeAllAlertEvents,
  useUnacknowledgedEventCount
} from '../hooks/useAlerts';
import { CapabilityGate } from '../components/CapabilityGate';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { AlertRule, AlertEvent } from '../types';

interface AlertsProps {
  onBack: () => void;
  onEditRule?: (id: string) => void;
  onCreateRule?: () => void;
}

type TabType = 'rules' | 'events';

export function Alerts({ onBack, onEditRule, onCreateRule }: AlertsProps) {
  const [activeTab, setActiveTab] = useState<TabType>('rules');

  // Rules data
  const { data: rulesData, isLoading: rulesLoading, error: rulesError, refetch: refetchRules } = useAlertRules();
  const { enable, disable, test } = useAlertRuleControl();
  const deleteRule = useDeleteAlertRule();
  const [confirmDeleteRule, setConfirmDeleteRule] = useState<AlertRule | null>(null);

  // Events data
  const { data: eventsData, isLoading: eventsLoading, error: eventsError, refetch: refetchEvents } = useAlertEvents({ limit: 100 });
  const acknowledgeEvent = useAcknowledgeAlertEvent();
  const acknowledgeAll = useAcknowledgeAllAlertEvents();
  const { data: countData } = useUnacknowledgedEventCount();

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const clearMessages = () => {
    setActionError(null);
    setActionSuccess(null);
  };

  // Rule handlers
  const handleEnable = async (id: string) => {
    clearMessages();
    try {
      await enable.mutateAsync(id);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const handleDisable = async (id: string) => {
    clearMessages();
    try {
      await disable.mutateAsync(id);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const handleTest = async (id: string, name: string) => {
    clearMessages();
    try {
      const result = await test.mutateAsync(id);
      if (result.success) {
        setActionSuccess(`Test notifications sent successfully for "${name}"`);
      } else {
        const failed = result.results.filter(r => !r.success);
        setActionError(`Some notifications failed: ${failed.map(f => f.error).join(', ')}`);
      }
      setTimeout(() => { setActionSuccess(null); setActionError(null); }, 5000);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const handleDeleteRule = async () => {
    if (!confirmDeleteRule) return;
    clearMessages();
    try {
      await deleteRule.mutateAsync(confirmDeleteRule.id);
      setConfirmDeleteRule(null);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  // Event handlers
  const handleAcknowledge = async (id: string) => {
    clearMessages();
    try {
      await acknowledgeEvent.mutateAsync(id);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const handleAcknowledgeAll = async () => {
    clearMessages();
    try {
      const result = await acknowledgeAll.mutateAsync();
      setActionSuccess(`Acknowledged ${result.count} events`);
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  // Badge helpers
  const getSeverityBadge = (severity: string) => {
    const colors: Record<string, string> = {
      info: '#0891b2',
      warning: '#d97706',
      critical: '#dc2626'
    };
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: '4px',
          backgroundColor: colors[severity] || '#6b7280',
          color: '#fff',
          fontSize: '12px',
          fontWeight: 500
        }}
      >
        {severity}
      </span>
    );
  };

  const getTargetTypeBadge = (targetType: string) => {
    const colors: Record<string, string> = {
      stream: '#3b82f6',
      group: '#8b5cf6',
      compositor: '#06b6d4',
      any: '#6b7280'
    };
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: '4px',
          backgroundColor: colors[targetType] || '#6b7280',
          color: '#fff',
          fontSize: '12px',
          fontWeight: 500
        }}
      >
        {targetType}
      </span>
    );
  };

  const getConditionTypeBadge = (conditionType: string) => {
    const labels: Record<string, string> = {
      status_changed: 'Status Changed',
      status_is: 'Status Is',
      health_unhealthy: 'Health Unhealthy',
      restart_count: 'Restart Count',
      offline_duration: 'Offline Duration',
      schedule_failed: 'Schedule Failed'
    };
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: '4px',
          backgroundColor: '#e5e7eb',
          color: '#374151',
          fontSize: '12px'
        }}
      >
        {labels[conditionType] || conditionType}
      </span>
    );
  };

  const getStatusBadge = (enabled: boolean) => {
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: '4px',
          backgroundColor: enabled ? '#22c55e' : '#6b7280',
          color: '#fff',
          fontSize: '12px',
          fontWeight: 500
        }}
      >
        {enabled ? 'enabled' : 'disabled'}
      </span>
    );
  };

  const formatDate = (isoString: string | undefined) => {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleString();
  };

  const formatRelativeTime = (isoString: string | undefined) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.round(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const hours = Math.floor(diffMins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const isLoading = activeTab === 'rules' ? rulesLoading : eventsLoading;
  const error = activeTab === 'rules' ? rulesError : eventsError;
  const refetch = activeTab === 'rules' ? refetchRules : refetchEvents;

  const rules = rulesData?.rules || [];
  const events = eventsData?.events || [];
  const unacknowledgedCount = countData?.count || 0;

  if (isLoading) {
    return (
      <div className="alerts-page">
        <div className="page-header">
          <button className="back-button" onClick={onBack}>Back</button>
          <h2>Alerts</h2>
        </div>
        <div className="loading">Loading alerts...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alerts-page">
        <div className="page-header">
          <button className="back-button" onClick={onBack}>Back</button>
          <h2>Alerts</h2>
        </div>
        <div className="error-message">
          Error loading alerts: {error.message}
          <button onClick={() => refetch()} style={{ marginLeft: '8px' }}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="alerts-page">
      <div className="page-header">
        <button className="back-button" onClick={onBack}>Back</button>
        <h2>Alerts</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button onClick={() => refetch()} className="action-button">
            Refresh
          </button>
          {activeTab === 'rules' && (
            <CapabilityGate require="alerts:create">
              <button onClick={onCreateRule} className="action-button primary">
                New Alert Rule
              </button>
            </CapabilityGate>
          )}
          {activeTab === 'events' && unacknowledgedCount > 0 && (
            <CapabilityGate require="alerts:update">
              <button
                onClick={handleAcknowledgeAll}
                className="action-button"
                disabled={acknowledgeAll.isPending}
              >
                Acknowledge All ({unacknowledgedCount})
              </button>
            </CapabilityGate>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', marginBottom: '16px', borderBottom: '1px solid #e5e7eb' }}>
        <button
          onClick={() => setActiveTab('rules')}
          style={{
            padding: '12px 24px',
            border: 'none',
            backgroundColor: activeTab === 'rules' ? '#3b82f6' : 'transparent',
            color: activeTab === 'rules' ? '#fff' : '#6b7280',
            cursor: 'pointer',
            fontWeight: 500,
            borderRadius: '4px 4px 0 0'
          }}
        >
          Rules ({rules.length})
        </button>
        <button
          onClick={() => setActiveTab('events')}
          style={{
            padding: '12px 24px',
            border: 'none',
            backgroundColor: activeTab === 'events' ? '#3b82f6' : 'transparent',
            color: activeTab === 'events' ? '#fff' : '#6b7280',
            cursor: 'pointer',
            fontWeight: 500,
            borderRadius: '4px 4px 0 0',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          Events
          {unacknowledgedCount > 0 && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '20px',
                height: '20px',
                borderRadius: '10px',
                backgroundColor: '#ef4444',
                color: '#fff',
                fontSize: '11px',
                fontWeight: 600
              }}
            >
              {unacknowledgedCount}
            </span>
          )}
        </button>
      </div>

      {actionError && (
        <div className="error-message" style={{ marginBottom: '16px' }}>
          {actionError}
          <button onClick={() => setActionError(null)} style={{ marginLeft: '8px' }}>Dismiss</button>
        </div>
      )}

      {actionSuccess && (
        <div className="success-message" style={{
          marginBottom: '16px',
          padding: '12px',
          backgroundColor: '#dcfce7',
          color: '#166534',
          borderRadius: '4px'
        }}>
          {actionSuccess}
        </div>
      )}

      {/* Rules Tab */}
      {activeTab === 'rules' && (
        <>
          {rules.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
              <p>No alert rules configured.</p>
              <CapabilityGate require="alerts:create">
                <p style={{ marginTop: '8px' }}>
                  <button onClick={onCreateRule} className="action-button primary">
                    Create your first alert rule
                  </button>
                </p>
              </CapabilityGate>
            </div>
          ) : (
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Name</th>
                  <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Status</th>
                  <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Severity</th>
                  <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Target</th>
                  <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Condition</th>
                  <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Triggers</th>
                  <th style={{ textAlign: 'right', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
                      <div style={{ fontWeight: 500 }}>{rule.name}</div>
                      {rule.description && (
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>{rule.description}</div>
                      )}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
                      {getStatusBadge(rule.enabled)}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
                      {getSeverityBadge(rule.severity)}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
                      {getTargetTypeBadge(rule.targetType)}
                      {rule.targetId && (
                        <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                          {rule.targetId.substring(0, 8)}...
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
                      {getConditionTypeBadge(rule.condition.type)}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
                      <div>{rule.triggerCount}</div>
                      {rule.lastTriggered && (
                        <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                          Last: {formatRelativeTime(rule.lastTriggered)}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                        <CapabilityGate require="alerts:update">
                          {rule.notifications.length > 0 && (
                            <button
                              className="action-button"
                              onClick={() => handleTest(rule.id, rule.name)}
                              disabled={test.isPending}
                              title="Test notifications"
                              style={{ padding: '4px 8px', fontSize: '12px' }}
                            >
                              Test
                            </button>
                          )}
                          {rule.enabled ? (
                            <button
                              className="action-button"
                              onClick={() => handleDisable(rule.id)}
                              disabled={disable.isPending}
                              title="Disable rule"
                              style={{ padding: '4px 8px', fontSize: '12px' }}
                            >
                              Disable
                            </button>
                          ) : (
                            <button
                              className="action-button"
                              onClick={() => handleEnable(rule.id)}
                              disabled={enable.isPending}
                              title="Enable rule"
                              style={{ padding: '4px 8px', fontSize: '12px' }}
                            >
                              Enable
                            </button>
                          )}
                          <button
                            className="action-button"
                            onClick={() => onEditRule?.(rule.id)}
                            title="Edit rule"
                            style={{ padding: '4px 8px', fontSize: '12px' }}
                          >
                            Edit
                          </button>
                        </CapabilityGate>
                        <CapabilityGate require="alerts:delete">
                          <button
                            className="action-button danger"
                            onClick={() => setConfirmDeleteRule(rule)}
                            title="Delete rule"
                            style={{ padding: '4px 8px', fontSize: '12px' }}
                          >
                            Delete
                          </button>
                        </CapabilityGate>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* Events Tab */}
      {activeTab === 'events' && (
        <>
          {events.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
              <p>No alert events yet.</p>
              <p style={{ fontSize: '14px', marginTop: '8px' }}>
                Events will appear here when alert rules are triggered.
              </p>
            </div>
          ) : (
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Time</th>
                  <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Severity</th>
                  <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Target</th>
                  <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Message</th>
                  <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Status</th>
                  <th style={{ textAlign: 'right', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr
                    key={event.id}
                    style={{
                      backgroundColor: !event.acknowledgedAt ? '#fef2f2' : undefined
                    }}
                  >
                    <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
                      <div style={{ fontSize: '12px' }}>{formatRelativeTime(event.createdAt)}</div>
                      <div style={{ fontSize: '11px', color: '#9ca3af' }}>{formatDate(event.createdAt)}</div>
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
                      {getSeverityBadge(event.severity)}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
                      {getTargetTypeBadge(event.targetType)}
                      <div style={{ fontSize: '12px', marginTop: '2px' }}>{event.targetName}</div>
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
                      <div style={{ fontSize: '13px' }}>{event.message}</div>
                      <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                        Rule: {event.ruleName}
                      </div>
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
                      {event.resolvedAt ? (
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            backgroundColor: '#22c55e',
                            color: '#fff',
                            fontSize: '12px'
                          }}
                        >
                          resolved
                        </span>
                      ) : event.acknowledgedAt ? (
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            backgroundColor: '#f59e0b',
                            color: '#fff',
                            fontSize: '12px'
                          }}
                        >
                          ack'd
                        </span>
                      ) : (
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            backgroundColor: '#ef4444',
                            color: '#fff',
                            fontSize: '12px'
                          }}
                        >
                          active
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb', textAlign: 'right' }}>
                      {!event.acknowledgedAt && (
                        <CapabilityGate require="alerts:update">
                          <button
                            className="action-button"
                            onClick={() => handleAcknowledge(event.id)}
                            disabled={acknowledgeEvent.isPending}
                            style={{ padding: '4px 8px', fontSize: '12px' }}
                          >
                            Acknowledge
                          </button>
                        </CapabilityGate>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {confirmDeleteRule && (
        <ConfirmDialog
          isOpen={true}
          title="Delete Alert Rule"
          message={`Are you sure you want to delete the alert rule "${confirmDeleteRule.name}"? This action cannot be undone. Historical events will be preserved.`}
          confirmLabel="Delete"
          onConfirm={handleDeleteRule}
          onCancel={() => setConfirmDeleteRule(null)}
        />
      )}
    </div>
  );
}
