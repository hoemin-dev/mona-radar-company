CREATE TABLE IF NOT EXISTS company_disclosure_state (
 company_id TEXT PRIMARY KEY REFERENCES companies(company_id) ON DELETE CASCADE,
 disclosure_status TEXT NOT NULL CHECK(disclosure_status IN ('DISCLOSURE_DENIED')),
 confirmed_at TEXT NOT NULL,
 collection_item_id TEXT REFERENCES collection_items(collection_item_id) ON DELETE SET NULL,
 collection_job_id TEXT REFERENCES collection_jobs(collection_job_id) ON DELETE SET NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_company_disclosure_status ON company_disclosure_state(disclosure_status,confirmed_at);

INSERT INTO company_disclosure_state(company_id,disclosure_status,confirmed_at,collection_item_id,collection_job_id,created_at,updated_at)
SELECT i.company_id,'DISCLOSURE_DENIED',MAX(COALESCE(i.finished_at,i.updated_at)),
       (SELECT i2.collection_item_id FROM collection_items i2 WHERE i2.company_id=i.company_id AND i2.error_code='DISCLOSURE_DENIED' ORDER BY COALESCE(i2.finished_at,i2.updated_at) DESC LIMIT 1),
       (SELECT i2.collection_job_id FROM collection_items i2 WHERE i2.company_id=i.company_id AND i2.error_code='DISCLOSURE_DENIED' ORDER BY COALESCE(i2.finished_at,i2.updated_at) DESC LIMIT 1),
       MAX(COALESCE(i.finished_at,i.updated_at)),MAX(COALESCE(i.finished_at,i.updated_at))
FROM collection_items i
WHERE i.company_id IS NOT NULL AND i.error_code='DISCLOSURE_DENIED'
GROUP BY i.company_id
ON CONFLICT(company_id) DO UPDATE SET
 disclosure_status='DISCLOSURE_DENIED',
 confirmed_at=MAX(company_disclosure_state.confirmed_at,excluded.confirmed_at),
 collection_item_id=excluded.collection_item_id,
 collection_job_id=excluded.collection_job_id,
 updated_at=excluded.updated_at;

INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(7,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
