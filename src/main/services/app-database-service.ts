import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'

type Migration = {
  id: string
  sql: string
}

const DATABASE_DIR = 'database'
const DATABASE_FILE = 'atlas.sqlite'

const MIGRATIONS: Migration[] = [
  {
    id: '001_agent_usage',
    sql: `
      CREATE TABLE IF NOT EXISTS agent_usage_source_files (
        source_path TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex')),
        source_kind TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms REAL NOT NULL,
        indexed_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS agent_usage_sessions (
        session_key TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex')),
        session_id TEXT NOT NULL,
        project_path TEXT,
        cwd TEXT,
        title TEXT NOT NULL,
        model TEXT,
        is_sidechain INTEGER NOT NULL DEFAULT 0 CHECK (is_sidechain IN (0, 1)),
        started_at TEXT,
        updated_at TEXT,
        message_count INTEGER NOT NULL DEFAULT 0,
        tool_call_count INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0
      ) STRICT;

      CREATE TABLE IF NOT EXISTS agent_usage_events (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex')),
        session_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        day TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        model TEXT,
        project_path TEXT,
        cwd TEXT,
        message_count INTEGER NOT NULL DEFAULT 0,
        tool_call_count INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (session_key) REFERENCES agent_usage_sessions(session_key) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE IF NOT EXISTS agent_usage_daily_summaries (
        day TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        profile_id TEXT,
        profile_name TEXT,
        model TEXT,
        locale TEXT NOT NULL,
        source_digest TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS agent_usage_index_status (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        indexed_at TEXT,
        source_file_count INTEGER NOT NULL DEFAULT 0,
        session_count INTEGER NOT NULL DEFAULT 0,
        usage_event_count INTEGER NOT NULL DEFAULT 0,
        day_count INTEGER NOT NULL DEFAULT 0,
        error TEXT
      ) STRICT;

      INSERT OR IGNORE INTO agent_usage_index_status (id) VALUES (1);

      CREATE INDEX IF NOT EXISTS idx_agent_usage_events_day ON agent_usage_events(day);
      CREATE INDEX IF NOT EXISTS idx_agent_usage_events_session ON agent_usage_events(session_key);
      CREATE INDEX IF NOT EXISTS idx_agent_usage_events_source ON agent_usage_events(source_path);
      CREATE INDEX IF NOT EXISTS idx_agent_usage_sessions_provider ON agent_usage_sessions(provider);
    `
  },
  {
    id: '002_agent_usage_codex_model_reindex',
    sql: `
      DELETE FROM agent_usage_events;
      DELETE FROM agent_usage_sessions;
      DELETE FROM agent_usage_source_files;

      UPDATE agent_usage_index_status
      SET indexed_at = NULL,
          source_file_count = 0,
          session_count = 0,
          usage_event_count = 0,
          day_count = 0,
          error = NULL
      WHERE id = 1;
    `
  }
]

export class AppDatabaseService {
  private readonly db: DatabaseSync

  constructor(private readonly databasePath = join(app.getPath('userData'), DATABASE_DIR, DATABASE_FILE)) {
    mkdirSync(dirname(databasePath), { recursive: true })
    this.db = new DatabaseSync(databasePath, { timeout: 5000 })
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
    `)
    this.runMigrations()
  }

  database(): DatabaseSync {
    return this.db
  }

  transaction<T>(run: (db: DatabaseSync) => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = run(this.db)
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    if (this.db.isOpen) this.db.close()
  }

  private runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
    `)

    const appliedRows = this.db.prepare('SELECT id FROM schema_migrations').all()
    const applied = new Set(appliedRows.map((row) => String(row.id)))

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) continue

      this.transaction((db) => {
        db.exec(migration.sql)
        db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(migration.id, new Date().toISOString())
      })
    }
  }
}
