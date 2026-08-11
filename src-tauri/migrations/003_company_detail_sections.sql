CREATE TABLE IF NOT EXISTS company_business_sites (
 business_site_id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
 site_name TEXT, site_type TEXT, business_number TEXT, address TEXT, source_ordinal INTEGER NOT NULL DEFAULT 0,
 collected_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(company_id,source_ordinal)
);
CREATE INDEX IF NOT EXISTS ix_business_sites_company ON company_business_sites(company_id);
CREATE TABLE IF NOT EXISTS company_histories (
 history_id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
 event_date TEXT, description TEXT, source_ordinal INTEGER NOT NULL DEFAULT 0,
 collected_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(company_id,source_ordinal)
);
CREATE INDEX IF NOT EXISTS ix_histories_company ON company_histories(company_id,event_date DESC);
CREATE TABLE IF NOT EXISTS company_certifications (
 certification_id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
 certification_name TEXT, certification_number TEXT, issuer TEXT, acquired_date TEXT, valid_until TEXT,
 source_ordinal INTEGER NOT NULL DEFAULT 0, collected_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(company_id,source_ordinal)
);
CREATE INDEX IF NOT EXISTS ix_certifications_company ON company_certifications(company_id);
CREATE TABLE IF NOT EXISTS company_designations (
 designation_id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
 designation_name TEXT, designation_number TEXT, authority TEXT, designated_date TEXT, valid_until TEXT,
 source_ordinal INTEGER NOT NULL DEFAULT 0, collected_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(company_id,source_ordinal)
);
CREATE INDEX IF NOT EXISTS ix_designations_company ON company_designations(company_id);
CREATE TABLE IF NOT EXISTS company_detail_collection_state (
 company_id TEXT PRIMARY KEY REFERENCES companies(company_id) ON DELETE CASCADE,
 schema_version INTEGER NOT NULL, collected_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(3,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
