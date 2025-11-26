import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Schedule, ScheduleTargetType, ScheduleAction } from '../types';

const API_BASE = '/api/schedules';

interface ScheduleListResponse {
  schedules: Schedule[];
  total: number;
}

interface SchedulerStatus {
  running: boolean;
  pollIntervalMs: number;
}

interface TimezonesResponse {
  timezones: string[];
}

interface NextRunPreviewResponse {
  nextRun: string;
  cronExpression: string;
  timezone: string;
}

export interface ScheduleCreateInput {
  name: string;
  description?: string;
  enabled?: boolean;
  targetType: ScheduleTargetType;
  targetId: string;
  action: ScheduleAction;
  cronExpression: string;
  timezone?: string;
}

export interface ScheduleUpdateInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  targetType?: ScheduleTargetType;
  targetId?: string;
  action?: ScheduleAction;
  cronExpression?: string;
  timezone?: string;
}

// List schedules with optional filters
export function useSchedules(options?: {
  enabled?: boolean;
  targetType?: ScheduleTargetType;
  targetId?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery<ScheduleListResponse>({
    queryKey: ['schedules', options],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.enabled !== undefined) params.set('enabled', String(options.enabled));
      if (options?.targetType !== undefined) params.set('targetType', options.targetType);
      if (options?.targetId !== undefined) params.set('targetId', options.targetId);
      if (options?.limit !== undefined) params.set('limit', String(options.limit));
      if (options?.offset !== undefined) params.set('offset', String(options.offset));

      const response = await fetch(`${API_BASE}?${params}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch schedules');
      }
      return response.json();
    }
  });
}

// Get single schedule
export function useSchedule(id: string | null) {
  return useQuery<Schedule>({
    queryKey: ['schedule', id],
    queryFn: async () => {
      if (!id) throw new Error('No schedule ID');
      const response = await fetch(`${API_BASE}/${id}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch schedule');
      }
      return response.json();
    },
    enabled: !!id
  });
}

// Get schedules for a specific target
export function useSchedulesForTarget(targetType: ScheduleTargetType | null, targetId: string | null) {
  return useQuery<ScheduleListResponse>({
    queryKey: ['schedules', 'by-target', targetType, targetId],
    queryFn: async () => {
      if (!targetType || !targetId) throw new Error('Target type and ID required');
      const response = await fetch(`${API_BASE}/by-target/${targetType}/${targetId}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch schedules');
      }
      return response.json();
    },
    enabled: !!targetType && !!targetId
  });
}

// Get scheduler status
export function useSchedulerStatus() {
  return useQuery<SchedulerStatus>({
    queryKey: ['scheduler-status'],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/status`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch scheduler status');
      }
      return response.json();
    },
    refetchInterval: 30000 // Refresh every 30 seconds
  });
}

// Get available timezones
export function useTimezones() {
  return useQuery<TimezonesResponse>({
    queryKey: ['timezones'],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/timezones`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch timezones');
      }
      return response.json();
    },
    staleTime: Infinity // Timezones don't change
  });
}

// Create schedule
export function useCreateSchedule() {
  const queryClient = useQueryClient();

  return useMutation<Schedule, Error, ScheduleCreateInput>({
    mutationFn: async (input) => {
      const response = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create schedule');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    }
  });
}

// Update schedule
export function useUpdateSchedule() {
  const queryClient = useQueryClient();

  return useMutation<Schedule, Error, { id: string; updates: ScheduleUpdateInput }>({
    mutationFn: async ({ id, updates }) => {
      const response = await fetch(`${API_BASE}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update schedule');
      }
      return response.json();
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      queryClient.invalidateQueries({ queryKey: ['schedule', id] });
    }
  });
}

// Delete schedule
export function useDeleteSchedule() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, Error, string>({
    mutationFn: async (id) => {
      const response = await fetch(`${API_BASE}/${id}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to delete schedule');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    }
  });
}

// Duplicate schedule
export function useDuplicateSchedule() {
  const queryClient = useQueryClient();

  return useMutation<Schedule, Error, { id: string; name: string }>({
    mutationFn: async ({ id, name }) => {
      const response = await fetch(`${API_BASE}/${id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to duplicate schedule');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    }
  });
}

// Schedule control mutations
export function useScheduleControl() {
  const queryClient = useQueryClient();

  const trigger = useMutation<{ success: boolean; message: string }, Error, string>({
    mutationFn: async (id) => {
      const response = await fetch(`${API_BASE}/${id}/trigger`, {
        method: 'POST'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || error.error || 'Failed to trigger schedule');
      }
      return response.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      queryClient.invalidateQueries({ queryKey: ['schedule', id] });
      // Also refresh streams/groups/compositors since they may have changed
      queryClient.invalidateQueries({ queryKey: ['streams'] });
      queryClient.invalidateQueries({ queryKey: ['stream-groups'] });
      queryClient.invalidateQueries({ queryKey: ['compositors'] });
    }
  });

  const enable = useMutation<Schedule, Error, string>({
    mutationFn: async (id) => {
      const response = await fetch(`${API_BASE}/${id}/enable`, {
        method: 'POST'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to enable schedule');
      }
      return response.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      queryClient.invalidateQueries({ queryKey: ['schedule', id] });
    }
  });

  const disable = useMutation<Schedule, Error, string>({
    mutationFn: async (id) => {
      const response = await fetch(`${API_BASE}/${id}/disable`, {
        method: 'POST'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to disable schedule');
      }
      return response.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      queryClient.invalidateQueries({ queryKey: ['schedule', id] });
    }
  });

  return { trigger, enable, disable };
}

// Preview next run time
export function usePreviewNextRun() {
  return useMutation<NextRunPreviewResponse, Error, { cronExpression: string; timezone?: string }>({
    mutationFn: async ({ cronExpression, timezone = 'UTC' }) => {
      const response = await fetch(`${API_BASE}/preview-next-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cronExpression, timezone })
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Invalid cron expression');
      }
      return response.json();
    }
  });
}
