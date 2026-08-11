CREATE TABLE IF NOT EXISTS collector_targets (
 target_id TEXT PRIMARY KEY NOT NULL,
 search_keyword TEXT NOT NULL,
 industry_code TEXT,
 industry_name TEXT,
 status TEXT NOT NULL DEFAULT 'READY',
 total_results INTEGER,
 total_pages INTEGER,
 collected_count INTEGER NOT NULL DEFAULT 0,
 failed_count INTEGER NOT NULL DEFAULT 0,
 current_page INTEGER NOT NULL DEFAULT 1,
 current_row_index INTEGER NOT NULL DEFAULT 0,
 last_sminfo_kcd TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 last_collected_at TEXT,
 UNIQUE(search_keyword)
);
CREATE INDEX IF NOT EXISTS ix_targets_status_updated ON collector_targets(status,updated_at);
CREATE TABLE IF NOT EXISTS company_industries (
 company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
 target_id TEXT NOT NULL REFERENCES collector_targets(target_id) ON DELETE CASCADE,
 industry_code TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(company_id,target_id)
);
CREATE INDEX IF NOT EXISTS ix_company_industries_target ON company_industries(target_id,company_id);
CREATE TABLE IF NOT EXISTS target_collection_jobs (
 target_id TEXT NOT NULL REFERENCES collector_targets(target_id) ON DELETE CASCADE,
 collection_job_id TEXT NOT NULL REFERENCES collection_jobs(collection_job_id) ON DELETE CASCADE,
 created_at TEXT NOT NULL,
 PRIMARY KEY(target_id,collection_job_id)
);
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(2,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
