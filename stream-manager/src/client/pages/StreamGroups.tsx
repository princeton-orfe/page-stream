import React, { useState } from 'react';
import { useStreamGroups, useStreamGroupControl, useDeleteStreamGroup } from '../hooks/useStreamGroups';
import { CapabilityGate } from '../components/CapabilityGate';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StreamGroupWithStatus } from '../types';

interface StreamGroupsProps {
  onBack: () => void;
  onEdit?: (id: string) => void;
  onCreate?: () => void;
}

export function StreamGroups({ onBack, onEdit, onCreate }: StreamGroupsProps) {
  const { data, isLoading, error, refetch } = useStreamGroups();
  const { start, stop, restart } = useStreamGroupControl();
  const deleteGroup = useDeleteStreamGroup();
  const [confirmDelete, setConfirmDelete] = useState<StreamGroupWithStatus | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleStart = async (id: string) => {
    setActionError(null);
    try {
      await start.mutateAsync(id);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const handleStop = async (id: string) => {
    setActionError(null);
    try {
      await stop.mutateAsync(id);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const handleRestart = async (id: string) => {
    setActionError(null);
    try {
      await restart.mutateAsync(id);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setActionError(null);
    try {
      await deleteGroup.mutateAsync(confirmDelete.id);
      setConfirmDelete(null);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const getGroupStatusBadge = (group: StreamGroupWithStatus) => {
    if (group.runningCount === 0) {
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
          stopped
        </span>
      );
    }
    if (group.runningCount === group.totalCount) {
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
          running
        </span>
      );
    }
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: '4px',
          backgroundColor: '#f59e0b',
          color: '#fff',
          fontSize: '12px',
          fontWeight: 500
        }}
      >
        partial ({group.runningCount}/{group.totalCount})
      </span>
    );
  };

  const getEnabledBadge = (enabled: boolean) => {
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: '4px',
          backgroundColor: enabled ? '#3b82f6' : '#9ca3af',
          color: '#fff',
          fontSize: '12px',
          fontWeight: 500
        }}
      >
        {enabled ? 'enabled' : 'disabled'}
      </span>
    );
  };

  const getOrderLabel = (order: string) => {
    const labels: Record<string, string> = {
      'parallel': 'Parallel',
      'sequential': 'Sequential',
      'reverse': 'Reverse'
    };
    return labels[order] || order;
  };

  if (isLoading) {
    return (
      <div className="stream-groups-page">
        <div className="page-header">
          <button className="back-button" onClick={onBack}>Back</button>
          <h2>Stream Groups</h2>
        </div>
        <div className="loading">Loading stream groups...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stream-groups-page">
        <div className="page-header">
          <button className="back-button" onClick={onBack}>Back</button>
          <h2>Stream Groups</h2>
        </div>
        <div className="error-message">Failed to load stream groups: {(error as Error).message}</div>
      </div>
    );
  }

  const groups = data?.groups || [];

  return (
    <div className="stream-groups-page">
      <div className="page-header">
        <button className="back-button" onClick={onBack}>Back</button>
        <h2>Stream Groups</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button className="action-button" onClick={() => refetch()}>
            Refresh
          </button>
          <CapabilityGate require="groups:create">
            <button className="action-button primary" onClick={onCreate}>
              New Group
            </button>
          </CapabilityGate>
        </div>
      </div>

      {actionError && (
        <div className="error-message" style={{ marginBottom: '16px' }}>
          {actionError}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="empty-state">
          <p>No stream groups configured yet.</p>
          <CapabilityGate require="groups:create">
            <p>Click "New Group" to create one.</p>
          </CapabilityGate>
        </div>
      ) : (
        <div className="stream-group-list">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Streams</th>
                <th>Order</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id}>
                  <td>
                    <strong>{group.name}</strong>
                    <br />
                    <small style={{ color: '#888' }}>
                      {getEnabledBadge(group.enabled)}
                    </small>
                  </td>
                  <td>
                    <div style={{ fontSize: '12px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {group.description || '-'}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: '12px' }}>
                      {group.totalCount} stream{group.totalCount !== 1 ? 's' : ''}
                    </div>
                    <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
                      {group.streamStatuses.slice(0, 3).map((s, i) => (
                        <span key={s.streamId}>
                          {i > 0 && ', '}
                          {s.name}
                        </span>
                      ))}
                      {group.totalCount > 3 && ` +${group.totalCount - 3} more`}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: '12px' }}>
                      Start: {getOrderLabel(group.startOrder)}
                    </div>
                    <div style={{ fontSize: '12px' }}>
                      Stop: {getOrderLabel(group.stopOrder)}
                    </div>
                  </td>
                  <td>{getGroupStatusBadge(group)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      <CapabilityGate require="groups:control">
                        {group.runningCount === group.totalCount && group.totalCount > 0 ? (
                          <>
                            <button
                              className="action-button small"
                              onClick={() => handleStop(group.id)}
                              disabled={stop.isPending || !group.enabled}
                            >
                              Stop All
                            </button>
                            <button
                              className="action-button small"
                              onClick={() => handleRestart(group.id)}
                              disabled={restart.isPending || !group.enabled}
                            >
                              Restart
                            </button>
                          </>
                        ) : group.runningCount > 0 ? (
                          <>
                            <button
                              className="action-button small primary"
                              onClick={() => handleStart(group.id)}
                              disabled={start.isPending || !group.enabled}
                            >
                              Start All
                            </button>
                            <button
                              className="action-button small"
                              onClick={() => handleStop(group.id)}
                              disabled={stop.isPending || !group.enabled}
                            >
                              Stop All
                            </button>
                          </>
                        ) : (
                          <button
                            className="action-button small primary"
                            onClick={() => handleStart(group.id)}
                            disabled={start.isPending || !group.enabled || group.totalCount === 0}
                          >
                            Start All
                          </button>
                        )}
                      </CapabilityGate>
                      <CapabilityGate require="groups:update">
                        <button
                          className="action-button small"
                          onClick={() => onEdit?.(group.id)}
                        >
                          Edit
                        </button>
                      </CapabilityGate>
                      <CapabilityGate require="groups:delete">
                        <button
                          className="action-button small danger"
                          onClick={() => setConfirmDelete(group)}
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
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          isOpen={true}
          title="Delete Stream Group"
          message={`Are you sure you want to delete "${confirmDelete.name}"? This will not affect the streams in the group.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
