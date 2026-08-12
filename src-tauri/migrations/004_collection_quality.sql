CREATE TABLE IF NOT EXISTS company_collection_state (
 company_id TEXT PRIMARY KEY REFERENCES companies(company_id) ON DELETE CASCADE,
 collection_quality TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(collection_quality IN ('UNKNOWN','PARTIAL','VERIFIED','FAILED')),
 collector_schema_version INTEGER NOT NULL DEFAULT 4,
 first_seen_at TEXT,
 last_seen_at TEXT,
 last_collected_at TEXT,
 last_detail_verified_at TEXT,
 last_error_code TEXT,
 last_error_message TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_company_collection_quality ON company_collection_state(collection_quality,last_detail_verified_at);
CREATE INDEX IF NOT EXISTS ix_company_collection_seen ON company_collection_state(last_seen_at);

CREATE TABLE IF NOT EXISTS company_section_collection_state (
 company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
 section_name TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('NOT_CHECKED','VERIFIED','CONFIRMED_EMPTY','PARTIAL','FAILED')),
 verified_at TEXT,
 last_attempted_at TEXT NOT NULL,
 error_message TEXT,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(company_id,section_name)
);
CREATE INDEX IF NOT EXISTS ix_section_collection_status ON company_section_collection_state(section_name,status,verified_at);

INSERT OR IGNORE INTO company_collection_state(
 company_id,collection_quality,collector_schema_version,first_seen_at,last_seen_at,last_collected_at,created_at,updated_at
)
SELECT company_id,'UNKNOWN',4,first_collected_at,last_collected_at,last_collected_at,created_at,updated_at
FROM companies;

INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(4,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
