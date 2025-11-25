import Database from 'better-sqlite3';
import { BUILT_IN_ROLES } from '../auth/rbac.js';

let db: Database.Database;

export function initDatabase(dbPath: string): Database.Database {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Run migrations
  runMigrations(db);

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
  }
}

interface MigrationRow {
  name: string;
}

function runMigrations(db: Database.Database) {
  // Create migrations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const applied = db.prepare('SELECT name FROM migrations').all() as MigrationRow[];
  const appliedNames = applied.map(r => r.name);

  // Migration: roles table
  if (!appliedNames.includes('001_roles')) {
    db.exec(`
      CREATE TABLE roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        capabilities TEXT NOT NULL,
        built_in INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert built-in roles
    const insert = db.prepare(`
      INSERT INTO roles (id, name, description, capabilities, built_in)
      VALUES (?, ?, ?, ?, 1)
    `);

    for (const role of BUILT_IN_ROLES) {
      insert.run(role.id, role.name, role.description, JSON.stringify(role.capabilities));
    }

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('001_roles');
  }

  // Migration: user_roles table
  if (!appliedNames.includes('002_user_roles')) {
    db.exec(`
      CREATE TABLE user_roles (
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        assigned_by TEXT,
        assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, role_id),
        FOREIGN KEY (role_id) REFERENCES roles(id)
      );
      CREATE INDEX idx_user_roles_user ON user_roles(user_id);
    `);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('002_user_roles');
  }

  // Migration: users table (for tracking seen users)
  if (!appliedNames.includes('003_users')) {
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        email TEXT,
        first_seen TEXT DEFAULT CURRENT_TIMESTAMP,
        last_seen TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('003_users');
  }

  // Migration: audit_log table
  if (!appliedNames.includes('004_audit_log')) {
    db.exec(`
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        details TEXT,
        result TEXT,
        error TEXT
      );
      CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX idx_audit_user ON audit_log(user_id);
      CREATE INDEX idx_audit_action ON audit_log(action);
    `);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('004_audit_log');
  }
}
