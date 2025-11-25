import { getDatabase } from './index.js';
import { Role, AuthConfig, Capability } from '../auth/types.js';
import { RoleStore } from '../auth/middleware.js';

interface RoleRow {
  id: string;
  name: string;
  description: string;
  capabilities: string;
  built_in: number;
}

interface UserRoleRow {
  role_id: string;
}

interface UserRow {
  id: string;
  username: string;
  email: string | null;
  first_seen: string;
  last_seen: string;
  roles: string | null;
}

export function createRoleStore(): RoleStore {
  return {
    async getRoles(): Promise<Role[]> {
      const db = getDatabase();
      const rows = db.prepare('SELECT * FROM roles').all() as RoleRow[];

      return rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        capabilities: JSON.parse(row.capabilities) as Capability[] | ['*'],
        builtIn: row.built_in === 1
      }));
    },

    async getUserRoles(userId: string): Promise<string[]> {
      const db = getDatabase();
      const rows = db.prepare(
        'SELECT role_id FROM user_roles WHERE user_id = ?'
      ).all(userId) as UserRoleRow[];

      return rows.map(row => row.role_id);
    },

    mapGroupsToRoles(groups: string[], config: AuthConfig): string[] {
      const roles: string[] = [];

      for (const group of groups) {
        const mappedRoles = config.roleMapping.groupRoles[group];
        if (mappedRoles) {
          roles.push(...mappedRoles);
        }
      }

      return [...new Set(roles)];
    }
  };
}

// Record that a user was seen (for tracking/admin)
export function recordUserSeen(userId: string, username: string, email?: string) {
  const db = getDatabase();

  db.prepare(`
    INSERT INTO users (id, username, email, last_seen)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      email = COALESCE(excluded.email, users.email),
      last_seen = CURRENT_TIMESTAMP
  `).run(userId, username, email || null);
}

// Assign role to user
export function assignUserRole(userId: string, roleId: string, assignedBy: string) {
  const db = getDatabase();

  db.prepare(`
    INSERT OR REPLACE INTO user_roles (user_id, role_id, assigned_by, assigned_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).run(userId, roleId, assignedBy);
}

// Remove role from user
export function removeUserRole(userId: string, roleId: string) {
  const db = getDatabase();
  db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?').run(userId, roleId);
}

// List all known users with their roles
export function listUsers() {
  const db = getDatabase();

  const users = db.prepare(`
    SELECT
      u.id,
      u.username,
      u.email,
      u.first_seen,
      u.last_seen,
      GROUP_CONCAT(ur.role_id) as roles
    FROM users u
    LEFT JOIN user_roles ur ON u.id = ur.user_id
    GROUP BY u.id
    ORDER BY u.last_seen DESC
  `).all() as UserRow[];

  return users.map(u => ({
    id: u.id,
    username: u.username,
    email: u.email,
    firstSeen: u.first_seen,
    lastSeen: u.last_seen,
    roles: u.roles ? u.roles.split(',') : []
  }));
}
