import React, { useState, useCallback } from 'react';
import { StreamGroupForm, StreamGroupFormData } from '../components/StreamGroupForm';
import {
  useStreamGroup,
  useUpdateStreamGroup,
  useDeleteStreamGroup,
  useStreamGroupControl
} from '../hooks/useStreamGroups';
import { CapabilityGate } from '../components/CapabilityGate';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface EditStreamGroupProps {
  groupId: string;
  onBack: () => void;
  onDeleted: () => void;
}

export function EditStreamGroup({ groupId, onBack, onDeleted }: EditStreamGroupProps) {
  const { data: group, isLoading, error: loadError } = useStreamGroup(groupId);
  const updateGroup = useUpdateStreamGroup();
  const deleteGroup = useDeleteStreamGroup();
  const { start, stop, restart } = useStreamGroupControl();

  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSubmit = useCallback((formData: StreamGroupFormData) => {
    setError(null);
    updateGroup.mutate(
      {
        id: groupId,
        updates: {
          name: formData.name,
          description: formData.description || undefined,
          enabled: formData.enabled,
          members: formData.members,
          startOrder: formData.startOrder,
          stopOrder: formData.stopOrder,
          startDelayMs: formData.startDelayMs,
          stopDelayMs: formData.stopDelayMs
        }
      },
      {
        onSuccess: () => {
          // Stay on page after save
        },
        onError: (err) => {
          setError(err.message);
        }
      }
    );
  }, [groupId, updateGroup]);

  const handleDelete = useCallback(() => {
    setError(null);
    deleteGroup.mutate(groupId, {
      onSuccess: () => {
        onDeleted();
      },
      onError: (err) => {
        setError(err.message);
        setShowDeleteConfirm(false);
      }
    });
  }, [groupId, deleteGroup, onDeleted]);

  const handleStart = useCallback(async () => {
    setError(null);
    try {
      await start.mutateAsync(groupId);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [groupId, start]);

  const handleStop = useCallback(async () => {
    setError(null);
    try {
      await stop.mutateAsync(groupId);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [groupId, stop]);

  const handleRestart = useCallback(async () => {
    setError(null);
    try {
      await restart.mutateAsync(groupId);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [groupId, restart]);

  if (isLoading) {
    return (
      <div className="edit-stream-group">
        <div className="page-header">
          <button className="back-button" onClick={onBack}>Back</button>
          <h2>Edit Stream Group</h2>
        </div>
        <div className="loading">Loading group...</div>
      </div>
    );
  }

  if (loadError || !group) {
    return (
      <div className="edit-stream-group">
        <div className="page-header">
          <button className="back-button" onClick={onBack}>Back</button>
          <h2>Edit Stream Group</h2>
        </div>
        <div className="error-message">
          {loadError ? (loadError as Error).message : 'Group not found'}
        </div>
      </div>
    );
  }

  const isRunning = group.runningCount > 0;
  const isFullyRunning = group.runningCount === group.totalCount && group.totalCount > 0;

  return (
    <div className="edit-stream-group">
      <div className="page-header">
        <button className="back-button" onClick={onBack}>Back</button>
        <h2>Edit Stream Group: {group.name}</h2>
        <div className="page-actions" style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <CapabilityGate require="groups:control">
            {isFullyRunning ? (
              <>
                <button
                  className="action-button"
                  onClick={handleStop}
                  disabled={stop.isPending || !group.enabled}
                >
                  Stop All
                </button>
                <button
                  className="action-button"
                  onClick={handleRestart}
                  disabled={restart.isPending || !group.enabled}
                >
                  Restart
                </button>
              </>
            ) : isRunning ? (
              <>
                <button
                  className="action-button primary"
                  onClick={handleStart}
                  disabled={start.isPending || !group.enabled}
                >
                  Start All
                </button>
                <button
                  className="action-button"
                  onClick={handleStop}
                  disabled={stop.isPending || !group.enabled}
                >
                  Stop All
                </button>
              </>
            ) : (
              <button
                className="action-button primary"
                onClick={handleStart}
                disabled={start.isPending || !group.enabled || group.totalCount === 0}
              >
                Start All
              </button>
            )}
          </CapabilityGate>
          <CapabilityGate require="groups:delete">
            <button
              className="action-button danger"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete
            </button>
          </CapabilityGate>
        </div>
      </div>

      {error && (
        <div className="error-message" style={{ marginBottom: '16px' }}>
          {error}
        </div>
      )}

      <div className="group-status" style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
        <strong>Status:</strong>{' '}
        {group.runningCount === 0 ? (
          <span style={{ color: '#6b7280' }}>All stopped</span>
        ) : group.runningCount === group.totalCount ? (
          <span style={{ color: '#22c55e' }}>All running ({group.runningCount}/{group.totalCount})</span>
        ) : (
          <span style={{ color: '#f59e0b' }}>Partial ({group.runningCount}/{group.totalCount} running)</span>
        )}

        {group.streamStatuses.length > 0 && (
          <div style={{ marginTop: '8px', fontSize: '12px' }}>
            {group.streamStatuses.map((s) => (
              <div key={s.streamId} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: s.status === 'running' ? '#22c55e' : '#6b7280'
                  }}
                />
                <span>{s.name}</span>
                <span style={{ color: '#888' }}>({s.status})</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <StreamGroupForm
        initialData={{
          name: group.name,
          description: group.description || '',
          enabled: group.enabled,
          members: group.members,
          startOrder: group.startOrder,
          stopOrder: group.stopOrder,
          startDelayMs: group.startDelayMs,
          stopDelayMs: group.stopDelayMs
        }}
        metadata={{
          createdAt: group.createdAt,
          updatedAt: group.updatedAt,
          createdBy: group.createdBy,
          updatedBy: group.updatedBy
        }}
        onSubmit={handleSubmit}
        onCancel={onBack}
        isSubmitting={updateGroup.isPending}
        submitLabel="Save Changes"
      />

      {showDeleteConfirm && (
        <ConfirmDialog
          isOpen={true}
          title="Delete Stream Group"
          message={`Are you sure you want to delete "${group.name}"? This will not affect the streams in the group.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
}
