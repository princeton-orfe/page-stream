import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CompositorConfig, CompositorLayout, CompositorInput, PipConfig } from '../types';

const API_BASE = '/api/compositors';

interface CompositorListResponse {
  configs: CompositorConfig[];
  total: number;
}

interface CompositorResponse {
  config: CompositorConfig;
  containerStatus?: string;
  containerId?: string;
}

interface CompositorCreateResponse {
  config: CompositorConfig;
  containerId?: string;
  warning?: string;
}

interface CompositorLogsResponse {
  logs: string[];
  hasMore: boolean;
}

interface CompositorPreviewResponse {
  ffmpegCommand: string;
  filterComplex: string;
  image: string;
}

export interface CompositorCreateInput {
  name: string;
  enabled?: boolean;
  layout?: CompositorLayout;
  inputs: CompositorInput[];
  customFilterComplex?: string;
  pipConfig?: PipConfig;
  outputWidth?: number;
  outputHeight?: number;
  outputFps?: number;
  preset?: string;
  videoBitrate?: string;
  audioBitrate?: string;
  format?: string;
  outputIngest: string;
  extraFfmpegArgs?: string[];
}

export interface CompositorUpdateInput {
  name?: string;
  enabled?: boolean;
  layout?: CompositorLayout;
  inputs?: CompositorInput[];
  customFilterComplex?: string;
  pipConfig?: PipConfig;
  outputWidth?: number;
  outputHeight?: number;
  outputFps?: number;
  preset?: string;
  videoBitrate?: string;
  audioBitrate?: string;
  format?: string;
  outputIngest?: string;
  extraFfmpegArgs?: string[];
}

// List compositors
export function useCompositors(options?: { enabled?: boolean; limit?: number; offset?: number }) {
  return useQuery<CompositorListResponse>({
    queryKey: ['compositors', options],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.enabled !== undefined) params.set('enabled', String(options.enabled));
      if (options?.limit !== undefined) params.set('limit', String(options.limit));
      if (options?.offset !== undefined) params.set('offset', String(options.offset));

      const response = await fetch(`${API_BASE}?${params}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch compositors');
      }
      return response.json();
    }
  });
}

// Get single compositor
export function useCompositor(id: string | null) {
  return useQuery<CompositorResponse>({
    queryKey: ['compositor', id],
    queryFn: async () => {
      if (!id) throw new Error('No compositor ID');
      const response = await fetch(`${API_BASE}/${id}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch compositor');
      }
      return response.json();
    },
    enabled: !!id
  });
}

// Get compositor logs
export function useCompositorLogs(id: string | null, lines: number = 100) {
  return useQuery<CompositorLogsResponse>({
    queryKey: ['compositor-logs', id, lines],
    queryFn: async () => {
      if (!id) throw new Error('No compositor ID');
      const response = await fetch(`${API_BASE}/${id}/logs?lines=${lines}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch logs');
      }
      return response.json();
    },
    enabled: !!id,
    refetchInterval: 5000 // Poll every 5 seconds
  });
}

// Get compositor preview (FFmpeg command)
export function useCompositorPreview(id: string | null) {
  return useQuery<CompositorPreviewResponse>({
    queryKey: ['compositor-preview', id],
    queryFn: async () => {
      if (!id) throw new Error('No compositor ID');
      const response = await fetch(`${API_BASE}/${id}/preview`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch preview');
      }
      return response.json();
    },
    enabled: !!id
  });
}

// Create compositor
export function useCreateCompositor() {
  const queryClient = useQueryClient();

  return useMutation<CompositorCreateResponse, Error, CompositorCreateInput>({
    mutationFn: async (input) => {
      const response = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create compositor');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compositors'] });
    }
  });
}

// Update compositor
export function useUpdateCompositor() {
  const queryClient = useQueryClient();

  return useMutation<CompositorResponse, Error, { id: string; updates: CompositorUpdateInput }>({
    mutationFn: async ({ id, updates }) => {
      const response = await fetch(`${API_BASE}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update compositor');
      }
      return response.json();
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['compositors'] });
      queryClient.invalidateQueries({ queryKey: ['compositor', id] });
    }
  });
}

// Delete compositor
export function useDeleteCompositor() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, Error, string>({
    mutationFn: async (id) => {
      const response = await fetch(`${API_BASE}/${id}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to delete compositor');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compositors'] });
    }
  });
}

// Compositor control actions
export function useCompositorControl() {
  const queryClient = useQueryClient();

  const start = useMutation<{ success: boolean; containerId: string }, Error, string>({
    mutationFn: async (id) => {
      const response = await fetch(`${API_BASE}/${id}/start`, {
        method: 'POST'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to start compositor');
      }
      return response.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['compositors'] });
      queryClient.invalidateQueries({ queryKey: ['compositor', id] });
    }
  });

  const stop = useMutation<{ success: boolean }, Error, string>({
    mutationFn: async (id) => {
      const response = await fetch(`${API_BASE}/${id}/stop`, {
        method: 'POST'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to stop compositor');
      }
      return response.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['compositors'] });
      queryClient.invalidateQueries({ queryKey: ['compositor', id] });
    }
  });

  const restart = useMutation<{ success: boolean }, Error, string>({
    mutationFn: async (id) => {
      const response = await fetch(`${API_BASE}/${id}/restart`, {
        method: 'POST'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to restart compositor');
      }
      return response.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['compositors'] });
      queryClient.invalidateQueries({ queryKey: ['compositor', id] });
    }
  });

  const deploy = useMutation<{ success: boolean; containerId: string; redeployed: boolean }, Error, string>({
    mutationFn: async (id) => {
      const response = await fetch(`${API_BASE}/${id}/deploy`, {
        method: 'POST'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to deploy compositor');
      }
      return response.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['compositors'] });
      queryClient.invalidateQueries({ queryKey: ['compositor', id] });
    }
  });

  return { start, stop, restart, deploy };
}
