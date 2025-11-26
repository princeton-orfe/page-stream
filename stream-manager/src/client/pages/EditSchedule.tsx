import React, { useState } from 'react';
import { ScheduleForm } from '../components/ScheduleForm';
import { useSchedule, useUpdateSchedule, ScheduleUpdateInput } from '../hooks/useSchedules';

interface EditScheduleProps {
  scheduleId: string;
  onBack: () => void;
  onSuccess: () => void;
}

export function EditSchedule({ scheduleId, onBack, onSuccess }: EditScheduleProps) {
  const { data: schedule, isLoading, error: loadError } = useSchedule(scheduleId);
  const updateSchedule = useUpdateSchedule();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (data: ScheduleUpdateInput) => {
    setError(null);
    try {
      await updateSchedule.mutateAsync({ id: scheduleId, updates: data as ScheduleUpdateInput });
      onSuccess();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (isLoading) {
    return (
      <div className="edit-schedule-page">
        <div className="page-header">
          <button className="back-button" onClick={onBack}>Back</button>
          <h2>Edit Schedule</h2>
        </div>
        <div className="loading">Loading schedule...</div>
      </div>
    );
  }

  if (loadError || !schedule) {
    return (
      <div className="edit-schedule-page">
        <div className="page-header">
          <button className="back-button" onClick={onBack}>Back</button>
          <h2>Edit Schedule</h2>
        </div>
        <div className="error-message">
          {loadError ? `Error: ${loadError.message}` : 'Schedule not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="edit-schedule-page">
      <div className="page-header">
        <button className="back-button" onClick={onBack}>Back</button>
        <h2>Edit Schedule: {schedule.name}</h2>
      </div>
      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '16px' }}>
        <ScheduleForm
          schedule={schedule}
          onSubmit={handleSubmit}
          onCancel={onBack}
          isSubmitting={updateSchedule.isPending}
          submitError={error}
        />
      </div>
    </div>
  );
}
