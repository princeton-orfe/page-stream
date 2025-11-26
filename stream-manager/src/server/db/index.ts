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

  // Migration: stream_configs table
  if (!appliedNames.includes('005_stream_configs')) {
    db.exec(`
      CREATE TABLE stream_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'standard',
        enabled INTEGER NOT NULL DEFAULT 1,
        url TEXT NOT NULL,
        inject_css TEXT,
        inject_js TEXT,
        width INTEGER NOT NULL DEFAULT 1920,
        height INTEGER NOT NULL DEFAULT 1080,
        fps INTEGER NOT NULL DEFAULT 30,
        crop_infobar INTEGER NOT NULL DEFAULT 0,
        preset TEXT NOT NULL DEFAULT 'veryfast',
        video_bitrate TEXT NOT NULL DEFAULT '2500k',
        audio_bitrate TEXT NOT NULL DEFAULT '128k',
        format TEXT NOT NULL DEFAULT 'mpegts',
        ingest TEXT NOT NULL,
        auto_refresh_seconds INTEGER NOT NULL DEFAULT 0,
        reconnect_attempts INTEGER NOT NULL DEFAULT 0,
        reconnect_initial_delay_ms INTEGER NOT NULL DEFAULT 1000,
        reconnect_max_delay_ms INTEGER NOT NULL DEFAULT 30000,
        health_interval_seconds INTEGER NOT NULL DEFAULT 30,
        extra_ffmpeg_args TEXT,
        input_ffmpeg_flags TEXT,
        display TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT NOT NULL,
        updated_by TEXT
      );
      CREATE INDEX idx_stream_configs_name ON stream_configs(name);
      CREATE INDEX idx_stream_configs_type ON stream_configs(type);
      CREATE INDEX idx_stream_configs_enabled ON stream_configs(enabled);
    `);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('005_stream_configs');
  }

  // Migration: display_assignments table for tracking X11 displays
  if (!appliedNames.includes('006_display_assignments')) {
    db.exec(`
      CREATE TABLE display_assignments (
        display TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL,
        assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (stream_id) REFERENCES stream_configs(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_display_stream ON display_assignments(stream_id);
    `);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('006_display_assignments');
  }

  // Migration: templates table for stream templates
  if (!appliedNames.includes('007_templates')) {
    db.exec(`
      CREATE TABLE templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        category TEXT NOT NULL DEFAULT 'custom',
        config TEXT NOT NULL,
        built_in INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_templates_category ON templates(category);
      CREATE INDEX idx_templates_built_in ON templates(built_in);
    `);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('007_templates');
  }

  // Migration: compositors table
  if (!appliedNames.includes('008_compositors')) {
    db.exec(`
      CREATE TABLE compositors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        layout TEXT NOT NULL DEFAULT 'side-by-side',
        inputs TEXT NOT NULL,
        custom_filter_complex TEXT,
        pip_config TEXT,
        output_width INTEGER NOT NULL DEFAULT 1920,
        output_height INTEGER NOT NULL DEFAULT 1080,
        output_fps INTEGER NOT NULL DEFAULT 30,
        preset TEXT NOT NULL DEFAULT 'ultrafast',
        video_bitrate TEXT NOT NULL DEFAULT '3000k',
        audio_bitrate TEXT NOT NULL DEFAULT '128k',
        format TEXT NOT NULL DEFAULT 'mpegts',
        output_ingest TEXT NOT NULL,
        extra_ffmpeg_args TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT NOT NULL,
        updated_by TEXT
      );
      CREATE INDEX idx_compositors_name ON compositors(name);
      CREATE INDEX idx_compositors_enabled ON compositors(enabled);
    `);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('008_compositors');
  }

  // Migration: stream_groups table
  if (!appliedNames.includes('009_stream_groups')) {
    db.exec(`
      CREATE TABLE stream_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        members TEXT NOT NULL,
        start_order TEXT NOT NULL DEFAULT 'parallel',
        stop_order TEXT NOT NULL DEFAULT 'parallel',
        start_delay_ms INTEGER NOT NULL DEFAULT 1000,
        stop_delay_ms INTEGER NOT NULL DEFAULT 1000,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT NOT NULL,
        updated_by TEXT
      );
      CREATE INDEX idx_stream_groups_name ON stream_groups(name);
      CREATE INDEX idx_stream_groups_enabled ON stream_groups(enabled);
    `);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('009_stream_groups');
  }

  // Migration: schedules table
  if (!appliedNames.includes('010_schedules')) {
    db.exec(`
      CREATE TABLE schedules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        action TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        last_run TEXT,
        next_run TEXT,
        last_run_result TEXT,
        last_run_error TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT NOT NULL,
        updated_by TEXT
      );
      CREATE INDEX idx_schedules_enabled ON schedules(enabled);
      CREATE INDEX idx_schedules_target ON schedules(target_type, target_id);
      CREATE INDEX idx_schedules_next_run ON schedules(next_run);
    `);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('010_schedules');
  }

  // Migration: alert_rules table
  if (!appliedNames.includes('011_alert_rules')) {
    db.exec(`
      CREATE TABLE alert_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        target_type TEXT NOT NULL,
        target_id TEXT,
        condition TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'warning',
        notifications TEXT NOT NULL DEFAULT '[]',
        cooldown_minutes INTEGER NOT NULL DEFAULT 15,
        last_triggered TEXT,
        last_notified TEXT,
        trigger_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT NOT NULL,
        updated_by TEXT
      );
      CREATE INDEX idx_alert_rules_enabled ON alert_rules(enabled);
      CREATE INDEX idx_alert_rules_target ON alert_rules(target_type, target_id);
      CREATE INDEX idx_alert_rules_severity ON alert_rules(severity);
    `);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('011_alert_rules');
  }

  // Migration: alert_events table
  if (!appliedNames.includes('012_alert_events')) {
    db.exec(`
      CREATE TABLE alert_events (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        rule_name TEXT NOT NULL,
        severity TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        target_name TEXT NOT NULL,
        condition TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT,
        acknowledged_at TEXT,
        acknowledged_by TEXT,
        resolved_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (rule_id) REFERENCES alert_rules(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_alert_events_rule ON alert_events(rule_id);
      CREATE INDEX idx_alert_events_target ON alert_events(target_type, target_id);
      CREATE INDEX idx_alert_events_created ON alert_events(created_at);
      CREATE INDEX idx_alert_events_acknowledged ON alert_events(acknowledged_at);
      CREATE INDEX idx_alert_events_resolved ON alert_events(resolved_at);
    `);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('012_alert_events');
  }

  // Migration: security_events table
  if (!appliedNames.includes('013_security_events')) {
    db.exec(`
      CREATE TABLE security_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        event_type TEXT NOT NULL,
        user_id TEXT,
        username TEXT,
        ip_address TEXT NOT NULL,
        user_agent TEXT,
        request_path TEXT NOT NULL,
        request_method TEXT NOT NULL,
        details TEXT,
        severity TEXT NOT NULL DEFAULT 'info'
      );
      CREATE INDEX idx_security_timestamp ON security_events(timestamp);
      CREATE INDEX idx_security_event_type ON security_events(event_type);
      CREATE INDEX idx_security_user ON security_events(user_id);
      CREATE INDEX idx_security_ip ON security_events(ip_address);
      CREATE INDEX idx_security_severity ON security_events(severity);
    `);

    db.prepare('INSERT INTO migrations (name) VALUES (?)').run('013_security_events');
  }
}
