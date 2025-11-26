import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StreamGroup, StreamGroupWithStatus, GroupMember, GroupStartOrder, GroupStopOrder } from '../types';

const API_BASE = '/api/groups';

interface StreamGroupListResponse {
  groups: StreamGroupWithStatus[];
  total: number;
}

interface StreamGroupResponse extends StreamGroupWithStatus {}

export interface StreamGroupCreateInput {
  name: string;
  description?: string;
  enabled?: boolean;
  members: GroupMember[];
  startOrder?: GroupStartOrder;
  stopOrder?: GroupStopOrder;
  startDelayMs?: number;
  stopDelayMs?: number;
}

export interface StreamGroupUpdateInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  members?: GroupMember[];
  startOrder?: GroupStartOrder;
  stopOrder?: GroupStopOrder;
  startDelayMs?: number;
  stopDelayMs?: number;
}

interface GroupControlResult {
  success: boolean;
  message: string;
  started?: string[];
  stopped?: string[];
  skipped?: string[];
  errors?: Array<{ streamId: string; error: string }>;
}

interface GroupRestartResult {
  success: boolean;
  message: string;
  stopped: {
    stopped: string[];
    skipped: string[];
    errors: Array<{ streamId: string; error: string }>;
  };
  started: {
    started: string[];
    skipped: string[];
    errors: Array<{ streamId: string; error: string }>;
  };
}

// List stream groups
export function useStreamGroups(options?: { enabled?: boolean; limit?: number; offset?: number }) {
  return useQuery<StreamGroupListResponse>({
    queryKey: ['stream-groups', options],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.enabled !== undefined) params.set('enabled', String(options.enabled));
      if (options?.limit !== undefined) params.set('limit', String(options.limit));
      if (options?.offset !== undefined) params.set('offset', String(options.offset));

      const response = await fetch(`${API_BASE}?${params}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch stream groups');
      }
      return response.json();
    }
  });
}

// Get single stream group
export function useStreamGroup(id: string | null) {
  return useQuery<StreamGroupResponse>({
    queryKey: ['stream-group', id],
    queryFn: async () => {
      if (!id) throw new Error('No group ID');
      const response = await fetch(`${API_BASE}/${id}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch stream group');
      }
      return response.json();
    },
    enabled: !!id
  });
}

// Create stream group
export function useCreateStreamGroup() {
  const queryClient = useQueryClient();

  return useMutation<StreamGroup, Error, StreamGroupCreateInput>({
    mutationFn: async (input) => {
      const response = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create stream group');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stream-groups'] });
    }
  });
}

// Update stream group
export function useUpdateStreamGroup() {
  const queryClient = useQueryClient();

  return useMutation<StreamGroup, Error, { id: string; updates: StreamGroupUpdateInput }>({
    mutationFn: async ({ id, updates }) => {
      const response = await fetch(`${API_BASE}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update stream group');
      }
      return response.json();
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['stream-groups'] });
      queryClient.invalidateQueries({ queryKey: ['stream-group', id] });
    }
  });
}

// Delete stream group
export function useDeleteStreamGroup() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, Error, string>({
    mutationFn: async (id) => {
      const response = await fetch(`${API_BASE}/${id}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to delete stream group');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stream-groups'] });
    }
  });
}

// Stream group control actions
export function useStreamGroupControl() {
  const queryClient = useQueryClient();

  const start = useMutation<GroupControlResult, Error, string>({
    mutationFn: async (id) => {
      const response = await fetch(`${API_BASE}/${id}/start`, {
        method: 'POST'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to start stream group');
      }
      return response.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['stream-groups'] });
      queryClient.invalidateQueries({ queryKey: ['stream-group', id] });
      queryClient.invalidateQueries({ queryKey: ['streams'] });
    }
  });

  const stop = useMutation<GroupControlResult, Error, string>({
    mutationFn: async (id) => {
      const response = await fetch(`${API_BASE}/${id}/stop`, {
        method: 'POST'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to stop stream group');
      }
      return response.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['stream-groups'] });
      queryClient.invalidateQueries({ queryKey: ['stream-group', id] });
      queryClient.invalidateQueries({ queryKey: ['streams'] });
    }
  });

  const restart = useMutation<GroupRestartResult, Error, string>({
    mutationFn: async (id) => {
      const response = await fetch(`${API_BASE}/${id}/restart`, {
        method: 'POST'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to restart stream group');
      }
      return response.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['stream-groups'] });
      queryClient.invalidateQueries({ queryKey: ['stream-group', id] });
      queryClient.invalidateQueries({ queryKey: ['streams'] });
    }
  });

  return { start, stop, restart };
}
