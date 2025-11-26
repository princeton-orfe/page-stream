import React, { useState } from 'react';
import { useSchedules, useScheduleControl, useDeleteSchedule } from '../hooks/useSchedules';
import { CapabilityGate } from '../components/CapabilityGate';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Schedule } from '../types';

interface SchedulesProps {
  onBack: () => void;
  onEdit?: (id: string) => void;
  onCreate?: () => void;
}

export function Schedules({ onBack, onEdit, onCreate }: SchedulesProps) {
  const { data, isLoading, error, refetch } = useSchedules();
  const { trigger, enable, disable } = useScheduleControl();
  const deleteSchedule = useDeleteSchedule();
  const [confirmDelete, setConfirmDelete] = useState<Schedule | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const clearMessages = () => {
    setActionError(null);
    setActionSuccess(null);
  };

  const handleTrigger = async (id: string, name: string) => {
    clearMessages();
    try {
      await trigger.mutateAsync(id);
      setActionSuccess(`Schedule "${name}" triggered successfully`);
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

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

  const handleDelete = async () => {
    if (!confirmDelete) return;
    clearMessages();
    try {
      await deleteSchedule.mutateAsync(confirmDelete.id);
      setConfirmDelete(null);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const getStatusBadge = (schedule: Schedule) => {
    if (!schedule.enabled) {
      return (
        <span
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: '4px',
            backgroundColor: '#6b7280',
            color: '#fff',
            fontSize: '12px',
            fontWeight: 500
          }}
        >
          disabled
        </span>
      );
    }
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: '4px',
          backgroundColor: '#22c55e',
          color: '#fff',
          fontSize: '12px',
          fontWeight: 500
        }}
      >
        enabled
      </span>
    );
  };

  const getLastRunBadge = (schedule: Schedule) => {
    if (!schedule.lastRunResult) {
      return (
        <span style={{ color: '#9ca3af', fontSize: '12px' }}>
          Never run
        </span>
      );
    }
    if (schedule.lastRunResult === 'success') {
      return (
        <span
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: '4px',
            backgroundColor: '#22c55e',
            color: '#fff',
            fontSize: '12px',
            fontWeight: 500
          }}
        >
          success
        </span>
      );
    }
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: '4px',
          backgroundColor: '#ef4444',
          color: '#fff',
          fontSize: '12px',
          fontWeight: 500
        }}
        title={schedule.lastRunError}
      >
        failed
      </span>
    );
  };

  const getTargetTypeBadge = (targetType: string) => {
    const colors: Record<string, string> = {
      stream: '#3b82f6',
      group: '#8b5cf6',
      compositor: '#06b6d4'
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

  const getActionBadge = (action: string) => {
    const colors: Record<string, string> = {
      start: '#22c55e',
      stop: '#ef4444',
      refresh: '#f59e0b'
    };
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: '4px',
          backgroundColor: colors[action] || '#6b7280',
          color: '#fff',
          fontSize: '12px',
          fontWeight: 500
        }}
      >
        {action}
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
    const diffMs = date.getTime() - now.getTime();
    const diffMins = Math.round(diffMs / 60000);

    if (diffMins < 0) {
      const absMins = Math.abs(diffMins);
      if (absMins < 60) return `${absMins}m ago`;
      const hours = Math.floor(absMins / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    } else {
      if (diffMins < 60) return `in ${diffMins}m`;
      const hours = Math.floor(diffMins / 60);
      if (hours < 24) return `in ${hours}h`;
      const days = Math.floor(hours / 24);
      return `in ${days}d`;
    }
  };

  if (isLoading) {
    return (
      <div className="schedules-page">
        <div className="page-header">
          <button className="back-button" onClick={onBack}>Back</button>
          <h2>Schedules</h2>
        </div>
        <div className="loading">Loading schedules...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="schedules-page">
        <div className="page-header">
          <button className="back-button" onClick={onBack}>Back</button>
          <h2>Schedules</h2>
        </div>
        <div className="error-message">
          Error loading schedules: {error.message}
          <button onClick={() => refetch()} style={{ marginLeft: '8px' }}>Retry</button>
        </div>
      </div>
    );
  }

  const schedules = data?.schedules || [];

  return (
    <div className="schedules-page">
      <div className="page-header">
        <button className="back-button" onClick={onBack}>Back</button>
        <h2>Schedules ({schedules.length})</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button onClick={() => refetch()} className="action-button">
            Refresh
          </button>
          <CapabilityGate require="schedules:create">
            <button onClick={onCreate} className="action-button primary">
              New Schedule
            </button>
          </CapabilityGate>
        </div>
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

      {schedules.length === 0 ? (
        <div className="empty-state" style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
          <p>No schedules configured.</p>
          <CapabilityGate require="schedules:create">
            <p style={{ marginTop: '8px' }}>
              <button onClick={onCreate} className="action-button primary">
                Create your first schedule
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
              <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Target</th>
              <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Action</th>
              <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Cron</th>
              <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Next Run</th>
              <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Last Run</th>
              <th style={{ textAlign: 'right', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((schedule) => (
              <tr key={schedule.id}>
                <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
                  <div style={{ fontWeight: 500 }}>{schedule.name}</div>
                  {schedule.description && (
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>{schedule.description}</div>
                  )}
                </td>
                <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
                  {getStatusBadge(schedule)}
                </td>
                <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
                  {getTargetTypeBadge(schedule.targetType)}
                  <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                    {schedule.targetId.substring(0, 8)}...
                  </div>
                </td>
                <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
                  {getActionBadge(schedule.action)}
                </td>
                <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
                  <code style={{ fontSize: '12px', backgroundColor: '#f3f4f6', padding: '2px 4px', borderRadius: '2px' }}>
                    {schedule.cronExpression}
                  </code>
                  <div style={{ fontSize: '11px', color: '#9ca3af' }}>{schedule.timezone}</div>
                </td>
                <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
                  {schedule.enabled && schedule.nextRun ? (
                    <div>
                      <div style={{ fontSize: '12px' }}>{formatRelativeTime(schedule.nextRun)}</div>
                      <div style={{ fontSize: '11px', color: '#9ca3af' }}>{formatDate(schedule.nextRun)}</div>
                    </div>
                  ) : (
                    <span style={{ color: '#9ca3af', fontSize: '12px' }}>-</span>
                  )}
                </td>
                <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb' }}>
                  {getLastRunBadge(schedule)}
                  {schedule.lastRun && (
                    <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                      {formatRelativeTime(schedule.lastRun)}
                    </div>
                  )}
                </td>
                <td style={{ padding: '8px', borderBottom: '1px solid #e5e7eb', textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                    <CapabilityGate require="schedules:update">
                      <button
                        className="action-button"
                        onClick={() => handleTrigger(schedule.id, schedule.name)}
                        disabled={trigger.isPending}
                        title="Run now"
                        style={{ padding: '4px 8px', fontSize: '12px' }}
                      >
                        Run
                      </button>
                      {schedule.enabled ? (
                        <button
                          className="action-button"
                          onClick={() => handleDisable(schedule.id)}
                          disabled={disable.isPending}
                          title="Disable schedule"
                          style={{ padding: '4px 8px', fontSize: '12px' }}
                        >
                          Disable
                        </button>
                      ) : (
                        <button
                          className="action-button"
                          onClick={() => handleEnable(schedule.id)}
                          disabled={enable.isPending}
                          title="Enable schedule"
                          style={{ padding: '4px 8px', fontSize: '12px' }}
                        >
                          Enable
                        </button>
                      )}
                      <button
                        className="action-button"
                        onClick={() => onEdit?.(schedule.id)}
                        title="Edit schedule"
                        style={{ padding: '4px 8px', fontSize: '12px' }}
                      >
                        Edit
                      </button>
                    </CapabilityGate>
                    <CapabilityGate require="schedules:delete">
                      <button
                        className="action-button danger"
                        onClick={() => setConfirmDelete(schedule)}
                        title="Delete schedule"
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

      {confirmDelete && (
        <ConfirmDialog
          isOpen={true}
          title="Delete Schedule"
          message={`Are you sure you want to delete the schedule "${confirmDelete.name}"? This action cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
