import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StreamFormData } from '../components/StreamForm';

export type TemplateCategory = 'standard' | 'compositor' | 'custom';

export interface StreamTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  config: Partial<StreamFormData>;
  builtIn: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

interface TemplatesResponse {
  templates: StreamTemplate[];
  total: number;
}

interface TemplateResponse {
  template: StreamTemplate;
}

interface ApplyTemplateResponse {
  config: StreamFormData;
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

export interface UseTemplatesOptions {
  category?: TemplateCategory;
  builtIn?: boolean;
  limit?: number;
  offset?: number;
}

export function useTemplates(options: UseTemplatesOptions = {}) {
  const params = new URLSearchParams();
  if (options.category) params.append('category', options.category);
  if (options.builtIn !== undefined) params.append('builtIn', String(options.builtIn));
  if (options.limit) params.append('limit', String(options.limit));
  if (options.offset) params.append('offset', String(options.offset));

  const queryString = params.toString();
  const url = `/api/templates${queryString ? `?${queryString}` : ''}`;

  return useQuery<TemplatesResponse, Error>({
    queryKey: ['templates', options],
    queryFn: () => fetchJson(url),
    staleTime: 30000 // Templates don't change often
  });
}

export function useTemplate(id: string | null) {
  return useQuery<TemplateResponse, Error>({
    queryKey: ['template', id],
    queryFn: () => fetchJson(`/api/templates/${id}`),
    enabled: !!id,
    staleTime: 30000
  });
}

export interface CreateTemplateInput {
  name: string;
  description: string;
  category: TemplateCategory;
  config: Partial<StreamFormData>;
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();

  return useMutation<TemplateResponse, Error, CreateTemplateInput>({
    mutationFn: (data) => fetchJson('/api/templates', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    }
  });
}

export interface CreateTemplateFromStreamInput {
  streamId: string;
  name: string;
  description?: string;
  category?: TemplateCategory;
}

export function useCreateTemplateFromStream() {
  const queryClient = useQueryClient();

  return useMutation<TemplateResponse, Error, CreateTemplateFromStreamInput>({
    mutationFn: ({ streamId, ...data }) => fetchJson(`/api/templates/from-stream/${streamId}`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    }
  });
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (id) => fetchJson(`/api/templates/${id}`, {
      method: 'DELETE'
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    }
  });
}

export interface ApplyTemplateInput {
  templateId: string;
  name: string;
  url: string;
  ingest: string;
}

export function useApplyTemplate() {
  return useMutation<ApplyTemplateResponse, Error, ApplyTemplateInput>({
    mutationFn: ({ templateId, ...data }) => fetchJson(`/api/templates/${templateId}/apply`, {
      method: 'POST',
      body: JSON.stringify(data)
    })
  });
}
