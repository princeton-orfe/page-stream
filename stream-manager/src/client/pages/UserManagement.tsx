import React, { useState, useCallback } from 'react';
import { useUsers, useRoles, useUpdateUserRoles, UserInfo, RoleInfo } from '../hooks/useUsers';

interface Props {
  onBack: () => void;
}

interface EditingState {
  userId: string;
  roles: string[];
}

export function UserManagement({ onBack }: Props) {
  const { data: users, isLoading: usersLoading, error: usersError, refetch } = useUsers();
  const { data: roles, isLoading: rolesLoading } = useRoles();
  const updateRolesMutation = useUpdateUserRoles();

  const [editing, setEditing] = useState<EditingState | null>(null);

  const handleEditRoles = useCallback((user: UserInfo) => {
    setEditing({ userId: user.id, roles: [...user.roles] });
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditing(null);
  }, []);

  const handleToggleRole = useCallback((roleId: string) => {
    if (!editing) return;
    setEditing(prev => {
      if (!prev) return prev;
      const hasRole = prev.roles.includes(roleId);
      return {
        ...prev,
        roles: hasRole
          ? prev.roles.filter(r => r !== roleId)
          : [...prev.roles, roleId]
      };
    });
  }, [editing]);

  const handleSaveRoles = useCallback(async () => {
    if (!editing) return;
    try {
      await updateRolesMutation.mutateAsync({
        userId: editing.userId,
        roles: editing.roles
      });
      setEditing(null);
    } catch {
      // Error handled by mutation
    }
  }, [editing, updateRolesMutation]);

  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleString();
  };

  const isLoading = usersLoading || rolesLoading;

  if (isLoading && !users) {
    return (
      <div className="user-management">
        <div className="user-management-header">
          <button className="back-button" onClick={onBack}>Back</button>
          <h2>User Management</h2>
        </div>
        <div className="loading-spinner">Loading users...</div>
      </div>
    );
  }

  if (usersError) {
    return (
      <div className="user-management">
        <div className="user-management-header">
          <button className="back-button" onClick={onBack}>Back</button>
          <h2>User Management</h2>
        </div>
        <div className="error-message">
          Error loading users: {usersError.message}
          <button onClick={() => refetch()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="user-management">
      <div className="user-management-header">
        <button className="back-button" onClick={onBack}>Back</button>
        <h2>User Management</h2>
      </div>

      <div className="user-management-summary">
        {users?.length || 0} users registered
      </div>

      {!users || users.length === 0 ? (
        <div className="empty-state">
          <h3>No Users</h3>
          <p>No users have accessed the system yet.</p>
        </div>
      ) : (
        <div className="users-table-container">
          <table className="users-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Roles</th>
                <th>First Seen</th>
                <th>Last Seen</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user: UserInfo) => (
                <tr key={user.id}>
                  <td className="username" title={user.id}>{user.username}</td>
                  <td className="email">{user.email || '-'}</td>
                  <td className="roles">
                    {editing?.userId === user.id ? (
                      <div className="role-editor">
                        {roles?.map((role: RoleInfo) => (
                          <label key={role.id} className="role-checkbox" title={role.description}>
                            <input
                              type="checkbox"
                              checked={editing.roles.includes(role.id)}
                              onChange={() => handleToggleRole(role.id)}
                            />
                            {role.name}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div className="role-badges">
                        {user.roles.length > 0 ? (
                          user.roles.map(roleId => {
                            const role = roles?.find(r => r.id === roleId);
                            return (
                              <span
                                key={roleId}
                                className={`role-badge role-${roleId}`}
                                title={role?.description}
                              >
                                {role?.name || roleId}
                              </span>
                            );
                          })
                        ) : (
                          <span className="no-roles">No roles</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="timestamp">{formatTimestamp(user.firstSeen)}</td>
                  <td className="timestamp">{formatTimestamp(user.lastSeen)}</td>
                  <td className="actions">
                    {editing?.userId === user.id ? (
                      <>
                        <button
                          className="save-button"
                          onClick={handleSaveRoles}
                          disabled={updateRolesMutation.isPending}
                        >
                          {updateRolesMutation.isPending ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          className="cancel-button"
                          onClick={handleCancelEdit}
                          disabled={updateRolesMutation.isPending}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="edit-button"
                        onClick={() => handleEditRoles(user)}
                      >
                        Edit Roles
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {updateRolesMutation.isError && (
        <div className="error-toast">
          Failed to update roles: {updateRolesMutation.error?.message}
        </div>
      )}

      {roles && (
        <div className="roles-legend">
          <h3>Available Roles</h3>
          <div className="roles-list">
            {roles.map((role: RoleInfo) => (
              <div key={role.id} className="role-info">
                <span className={`role-badge role-${role.id}`}>{role.name}</span>
                <span className="role-description">{role.description}</span>
                {role.builtIn && <span className="built-in-tag">Built-in</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
