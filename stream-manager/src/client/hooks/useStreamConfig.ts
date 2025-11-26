import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StreamFormData } from '../components/StreamForm';

export interface StreamConfig extends StreamFormData {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
}

interface StreamConfigsResponse {
  configs: StreamConfig[];
  total: number;
  hasMore: boolean;
}

interface StreamConfigResponse {
  config: StreamConfig;
}

interface CreateStreamResponse {
  config: StreamConfig;
  container?: {
    id: string;
    name: string;
    status: string;
  };
}

interface DeployResponse {
  container: {
    id: string;
    name: string;
    status: string;
  };
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers
    }
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || error.message || 'Request failed');
  }
  return res.json();
}

export interface UseStreamConfigsOptions {
  type?: string;
  enabled?: boolean;
  limit?: number;
  offset?: number;
}

export function useStreamConfigs(options: UseStreamConfigsOptions = {}) {
  const params = new URLSearchParams();
  if (options.type) params.append('type', options.type);
  if (options.enabled !== undefined) params.append('enabled', String(options.enabled));
  if (options.limit) params.append('limit', String(options.limit));
  if (options.offset) params.append('offset', String(options.offset));

  const queryString = params.toString();
  const url = `/api/streams/configs${queryString ? `?${queryString}` : ''}`;

  return useQuery<StreamConfigsResponse, Error>({
    queryKey: ['stream-configs', options],
    queryFn: () => fetchJson(url),
    staleTime: 10000
  });
}

export function useStreamConfig(id: string | null) {
  return useQuery<StreamConfigResponse, Error>({
    queryKey: ['stream-config', id],
    queryFn: () => fetchJson(`/api/streams/configs/${id}`),
    enabled: !!id,
    staleTime: 5000
  });
}

export function useCreateStream() {
  const queryClient = useQueryClient();

  return useMutation<CreateStreamResponse, Error, StreamFormData>({
    mutationFn: (data) => fetchJson('/api/streams', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stream-configs'] });
      queryClient.invalidateQueries({ queryKey: ['streams'] });
    }
  });
}

export function useUpdateStream(id: string) {
  const queryClient = useQueryClient();

  return useMutation<StreamConfigResponse, Error, Partial<StreamFormData>>({
    mutationFn: (data) => fetchJson(`/api/streams/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stream-configs'] });
      queryClient.invalidateQueries({ queryKey: ['stream-config', id] });
    }
  });
}

export function useDeleteStream(id: string) {
  const queryClient = useQueryClient();

  return useMutation<void, Error>({
    mutationFn: () => fetchJson(`/api/streams/${id}`, {
      method: 'DELETE'
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stream-configs'] });
      queryClient.invalidateQueries({ queryKey: ['streams'] });
    }
  });
}

export function useDeployStream(id: string) {
  const queryClient = useQueryClient();

  return useMutation<DeployResponse, Error>({
    mutationFn: () => fetchJson(`/api/streams/${id}/deploy`, {
      method: 'POST'
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['streams'] });
    }
  });
}
