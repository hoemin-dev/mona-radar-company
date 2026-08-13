CREATE TABLE IF NOT EXISTS company_source_business_sites (
 business_site_id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
 site_name TEXT, site_address TEXT, source_ordinal INTEGER NOT NULL DEFAULT 0,
 collected_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(company_id,source_ordinal)
);
CREATE TABLE IF NOT EXISTS company_source_histories (
 history_id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
 source_number TEXT, event_date TEXT, description TEXT, source_ordinal INTEGER NOT NULL DEFAULT 0,
 collected_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(company_id,source_ordinal)
);
CREATE TABLE IF NOT EXISTS company_source_executives (
 executive_id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
 source_number TEXT, position_title TEXT, masked_name TEXT, source_ordinal INTEGER NOT NULL DEFAULT 0,
 collected_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(company_id,source_ordinal)
);
CREATE TABLE IF NOT EXISTS company_source_certifications (
 certification_id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
 certification_number TEXT, certification_name TEXT, certification_scope TEXT, validity_period TEXT, certification_authority TEXT,
 source_ordinal INTEGER NOT NULL DEFAULT 0, collected_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(company_id,source_ordinal)
);
CREATE TABLE IF NOT EXISTS company_source_designations (
 designation_id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
 designation_number TEXT, designation_name TEXT, validity_period TEXT, operating_authority TEXT,
 source_ordinal INTEGER NOT NULL DEFAULT 0, collected_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(company_id,source_ordinal)
);

INSERT OR IGNORE INTO company_source_business_sites
SELECT business_site_id,company_id,COALESCE(site_name,site_type),address,source_ordinal,collected_at,created_at,updated_at FROM company_business_sites;
INSERT OR IGNORE INTO company_source_business_sites
SELECT 'legacy-factory-'||factory_id,f.company_id,f.factory_name,f.location_address,
       COALESCE((SELECT MAX(s2.source_ordinal) FROM company_source_business_sites s2 WHERE s2.company_id=f.company_id),-1)
       + ROW_NUMBER() OVER(PARTITION BY f.company_id ORDER BY f.source_ordinal,f.factory_id),
       f.collected_at,f.created_at,f.updated_at FROM company_factories f
WHERE NOT EXISTS(SELECT 1 FROM company_source_business_sites s WHERE s.company_id=f.company_id AND IFNULL(s.site_name,'')=IFNULL(f.factory_name,'') AND IFNULL(s.site_address,'')=IFNULL(f.location_address,''));
INSERT OR IGNORE INTO company_source_histories SELECT history_id,company_id,NULL,event_date,description,source_ordinal,collected_at,created_at,updated_at FROM company_histories;
INSERT OR IGNORE INTO company_source_executives SELECT executive_id,company_id,NULL,position_title,masked_name,source_ordinal,collected_at,created_at,updated_at FROM company_executives;
INSERT OR IGNORE INTO company_source_certifications SELECT certification_id,company_id,certification_number,certification_name,NULL,COALESCE(valid_until,acquired_date),issuer,source_ordinal,collected_at,created_at,updated_at FROM company_certifications;
INSERT OR IGNORE INTO company_source_designations SELECT designation_id,company_id,designation_number,designation_name,COALESCE(valid_until,designated_date),authority,source_ordinal,collected_at,created_at,updated_at FROM company_designations;
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(6,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
