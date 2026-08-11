PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS companies (
 company_id TEXT PRIMARY KEY NOT NULL, sminfo_kcd TEXT NOT NULL UNIQUE,
 business_number TEXT, company_name TEXT NOT NULL, representative_name TEXT,
 company_type TEXT, company_status TEXT, established_date TEXT, address TEXT,
 road_address TEXT, homepage_url TEXT, main_products TEXT, ksic_code TEXT,
 industry_name TEXT, source_updated_at TEXT, first_collected_at TEXT NOT NULL,
 last_collected_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 synced_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_companies_business_number ON companies(business_number) WHERE business_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_companies_name ON companies(company_name);
CREATE INDEX IF NOT EXISTS ix_companies_ksic ON companies(ksic_code);
CREATE INDEX IF NOT EXISTS ix_companies_industry ON companies(industry_name);
CREATE INDEX IF NOT EXISTS ix_companies_status ON companies(company_status);
CREATE INDEX IF NOT EXISTS ix_companies_established ON companies(established_date);
CREATE INDEX IF NOT EXISTS ix_companies_collected ON companies(last_collected_at);
CREATE TABLE IF NOT EXISTS company_financial_statements (
 financial_statement_id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
 fiscal_year INTEGER NOT NULL, total_assets_krw_million INTEGER, paid_in_capital_krw_million INTEGER,
 total_equity_krw_million INTEGER, revenue_krw_million INTEGER, operating_income_krw_million INTEGER,
 net_income_krw_million INTEGER, collected_at TEXT NOT NULL, created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL, synced_at TEXT, UNIQUE(company_id, fiscal_year)
);
CREATE INDEX IF NOT EXISTS ix_financial_year ON company_financial_statements(fiscal_year);
CREATE INDEX IF NOT EXISTS ix_financial_revenue ON company_financial_statements(revenue_krw_million);
CREATE INDEX IF NOT EXISTS ix_financial_operating_income ON company_financial_statements(operating_income_krw_million);
CREATE INDEX IF NOT EXISTS ix_financial_company_year ON company_financial_statements(company_id, fiscal_year DESC);
CREATE TABLE IF NOT EXISTS company_factories (factory_id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE, factory_name TEXT, location_address TEXT, source_ordinal INTEGER NOT NULL DEFAULT 0, collected_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, synced_at TEXT, UNIQUE(company_id,source_ordinal));
CREATE INDEX IF NOT EXISTS ix_factories_company ON company_factories(company_id);
CREATE TABLE IF NOT EXISTS company_patents (patent_id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE, patent_date TEXT, description TEXT, source_ordinal INTEGER NOT NULL DEFAULT 0, collected_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, synced_at TEXT, UNIQUE(company_id,source_ordinal));
CREATE TABLE IF NOT EXISTS company_executives (executive_id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE, position_title TEXT, masked_name TEXT, source_ordinal INTEGER NOT NULL DEFAULT 0, collected_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, synced_at TEXT, UNIQUE(company_id,source_ordinal));
CREATE TABLE IF NOT EXISTS collection_jobs (
 collection_job_id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL CHECK(status IN ('IDLE','READY','RUNNING','PAUSED','STOPPED','COMPLETED','ERROR')),
 search_summary TEXT, source_result_total INTEGER, source_total_pages INTEGER, completed_count INTEGER NOT NULL DEFAULT 0,
 failed_count INTEGER NOT NULL DEFAULT 0, skipped_count INTEGER NOT NULL DEFAULT 0, dev_max_companies INTEGER,
 started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_jobs_status_updated ON collection_jobs(status,updated_at);
CREATE TABLE IF NOT EXISTS collection_items (
 collection_item_id TEXT PRIMARY KEY NOT NULL, collection_job_id TEXT NOT NULL REFERENCES collection_jobs(collection_job_id) ON DELETE CASCADE,
 sminfo_kcd TEXT NOT NULL, company_name_snapshot TEXT NOT NULL, source_page_number INTEGER NOT NULL, source_row_number INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','DONE','FAILED','SKIPPED')),
 attempt_count INTEGER NOT NULL DEFAULT 0, error_code TEXT, error_message TEXT,
 company_id TEXT REFERENCES companies(company_id) ON DELETE SET NULL, started_at TEXT, finished_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(collection_job_id,sminfo_kcd)
);
CREATE INDEX IF NOT EXISTS ix_items_queue ON collection_items(collection_job_id,status,source_page_number,source_row_number);
CREATE INDEX IF NOT EXISTS ix_items_status_updated ON collection_items(status,updated_at);
CREATE TABLE IF NOT EXISTS collection_events (collection_event_id TEXT PRIMARY KEY, collection_job_id TEXT REFERENCES collection_jobs(collection_job_id) ON DELETE CASCADE, collection_item_id TEXT REFERENCES collection_items(collection_item_id) ON DELETE SET NULL, event_type TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'INFO', message TEXT NOT NULL, occurred_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_events_job_time ON collection_events(collection_job_id,occurred_at DESC);
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
