import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Capability, User } from '../types';

interface AuthState {
  user: User | null;
  capabilities: Set<Capability>;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  hasCapability: (cap: Capability) => boolean;
  hasAnyCapability: (...caps: Capability[]) => boolean;
  canControl: boolean;
  canManage: boolean;
  canAdmin: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    capabilities: new Set(),
    loading: true,
    error: null
  });

  const fetchAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) throw new Error('Failed to fetch auth info');

      const data = await res.json();
      setState({
        user: data.user,
        capabilities: new Set(data.capabilities as Capability[]),
        loading: false,
        error: null
      });
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: (e as Error).message }));
    }
  }, []);

  useEffect(() => {
    fetchAuth();
  }, [fetchAuth]);

  const value: AuthContextValue = {
    ...state,
    hasCapability: (cap) => state.capabilities.has(cap),
    hasAnyCapability: (...caps) => caps.some(cap => state.capabilities.has(cap)),
    canControl: state.capabilities.has('streams:start') || state.capabilities.has('streams:stop'),
    canManage: state.capabilities.has('streams:create') || state.capabilities.has('streams:update'),
    canAdmin: state.capabilities.has('users:manage'),
    refresh: fetchAuth
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
