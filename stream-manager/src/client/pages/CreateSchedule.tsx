import React, { useState } from 'react';
import { ScheduleForm } from '../components/ScheduleForm';
import { useCreateSchedule, ScheduleCreateInput, ScheduleUpdateInput } from '../hooks/useSchedules';

interface CreateScheduleProps {
  onBack: () => void;
  onSuccess: () => void;
}

export function CreateSchedule({ onBack, onSuccess }: CreateScheduleProps) {
  const createSchedule = useCreateSchedule();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (data: ScheduleCreateInput | ScheduleUpdateInput) => {
    setError(null);
    try {
      await createSchedule.mutateAsync(data as ScheduleCreateInput);
      onSuccess();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="create-schedule-page">
      <div className="page-header">
        <button className="back-button" onClick={onBack}>Back</button>
        <h2>Create Schedule</h2>
      </div>
      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '16px' }}>
        <ScheduleForm
          onSubmit={handleSubmit}
          onCancel={onBack}
          isSubmitting={createSchedule.isPending}
          submitError={error}
        />
      </div>
    </div>
  );
}
