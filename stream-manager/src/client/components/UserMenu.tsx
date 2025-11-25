import React from 'react';
import { useAuth } from '../hooks/useAuth';

export function UserMenu() {
  const { user, loading } = useAuth();

  if (loading) return <div className="user-menu loading">...</div>;
  if (!user) return null;

  return (
    <div className="user-menu">
      <span className="username">{user.username}</span>
      <span className="role-badge">{user.roles[0]}</span>
      {user.authSource === 'anonymous' && (
        <span className="anon-badge" title="No authentication configured">
          (Open Mode)
        </span>
      )}
    </div>
  );
}
