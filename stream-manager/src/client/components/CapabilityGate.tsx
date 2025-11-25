import React from 'react';
import { useAuth } from '../hooks/useAuth';
import { Capability } from '../types';

interface Props {
  require: Capability | Capability[];
  mode?: 'all' | 'any';
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function CapabilityGate({ require, mode = 'all', fallback = null, children }: Props) {
  const { hasCapability, hasAnyCapability } = useAuth();

  const caps = Array.isArray(require) ? require : [require];
  const hasAccess = mode === 'any'
    ? hasAnyCapability(...caps)
    : caps.every(hasCapability);

  return hasAccess ? <>{children}</> : <>{fallback}</>;
}
