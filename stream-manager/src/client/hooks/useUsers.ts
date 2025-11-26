import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface UserInfo {
  id: string;
  username: string;
  email: string | null;
  firstSeen: string;
  lastSeen: string;
  roles: string[];
}

export interface RoleInfo {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  builtIn: boolean;
}

async function fetchUsers(): Promise<UserInfo[]> {
  const res = await fetch('/api/auth/users');
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to fetch users');
  }
  const data = await res.json();
  return data.users;
}

async function fetchRoles(): Promise<RoleInfo[]> {
  const res = await fetch('/api/auth/roles');
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to fetch roles');
  }
  const data = await res.json();
  return data.roles;
}

async function updateUserRoles(userId: string, roles: string[]): Promise<void> {
  const res = await fetch(`/api/auth/users/${userId}/roles`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roles })
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.message || error.error || 'Failed to update user roles');
  }
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers
  });
}

export function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: fetchRoles
  });
}

export function useUpdateUserRoles() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, roles }: { userId: string; roles: string[] }) =>
      updateUserRoles(userId, roles),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    }
  });
}
