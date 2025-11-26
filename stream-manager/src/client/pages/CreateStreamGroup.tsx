import React, { useState, useCallback } from 'react';
import { StreamGroupForm, StreamGroupFormData } from '../components/StreamGroupForm';
import { useCreateStreamGroup } from '../hooks/useStreamGroups';

interface CreateStreamGroupProps {
  onBack: () => void;
  onCreated: (groupId: string) => void;
}

export function CreateStreamGroup({ onBack, onCreated }: CreateStreamGroupProps) {
  const createGroup = useCreateStreamGroup();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback((formData: StreamGroupFormData) => {
    setError(null);
    createGroup.mutate(
      {
        name: formData.name,
        description: formData.description || undefined,
        enabled: formData.enabled,
        members: formData.members,
        startOrder: formData.startOrder,
        stopOrder: formData.stopOrder,
        startDelayMs: formData.startDelayMs,
        stopDelayMs: formData.stopDelayMs
      },
      {
        onSuccess: (group) => {
          onCreated(group.id);
        },
        onError: (err) => {
          setError(err.message);
        }
      }
    );
  }, [createGroup, onCreated]);

  return (
    <div className="create-stream-group">
      <div className="page-header">
        <button className="back-button" onClick={onBack}>Back</button>
        <h2>Create Stream Group</h2>
      </div>

      {error && (
        <div className="error-message" style={{ marginBottom: '16px' }}>
          {error}
        </div>
      )}

      <StreamGroupForm
        onSubmit={handleSubmit}
        onCancel={onBack}
        isSubmitting={createGroup.isPending}
        submitLabel="Create Group"
      />
    </div>
  );
}
