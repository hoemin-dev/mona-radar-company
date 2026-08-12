CREATE TABLE IF NOT EXISTS industry_codes (
 industry_code TEXT PRIMARY KEY NOT NULL,
 industry_name TEXT NOT NULL,
 parent_code TEXT,
 classification_level TEXT,
 is_active INTEGER NOT NULL DEFAULT 1,
 first_seen_at TEXT NOT NULL,
 last_seen_at TEXT NOT NULL,
 changed_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_industry_codes_name ON industry_codes(industry_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS ix_industry_codes_active_name ON industry_codes(is_active,industry_name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS industry_master_refreshes (
 refresh_id TEXT PRIMARY KEY NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED')),
 code_count INTEGER NOT NULL DEFAULT 0,
 started_at TEXT NOT NULL,
 completed_at TEXT,
 error_message TEXT
);

INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(5,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
