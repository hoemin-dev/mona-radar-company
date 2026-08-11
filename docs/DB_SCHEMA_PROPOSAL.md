# DB schema proposal — APPROVAL REQUIRED

**Approved 2026-08-10.** Implemented by `src-tauri/migrations/001_initial.sql`; future changes require a new numbered migration.

Conventions: English `snake_case`; UTC ISO-8601 text timestamps (`YYYY-MM-DDTHH:mm:ss.sssZ`); boolean as integer 0/1; money as integer in **KRW million** because that is the SMINFO display unit; absent/blank source values become NULL. Application-generated UUIDv7 text is proposed for internal IDs and portable D1 sync. Source identifiers remain explicit and immutable.

## `companies`

One current canonical company per SMINFO entity. Columns: `company_id TEXT NOT NULL PK` (internal UUIDv7); `sminfo_kcd TEXT NOT NULL UNIQUE` (source `kcd`); `business_number TEXT NULL UNIQUE` (source `busiNo`, stored as normalized digits); `company_name TEXT NOT NULL` (`comNm`/기업명); `representative_name TEXT NULL`; `company_type TEXT NULL`; `company_status TEXT NULL`; `established_date TEXT NULL`; `address TEXT NULL`; `road_address TEXT NULL`; `homepage_url TEXT NULL`; `main_products TEXT NULL`; `ksic_code TEXT NULL` (`ksic11BzcCd`); `industry_name TEXT NULL` (`ksic11BzcCdNm`/표준산업); `source_updated_at TEXT NULL` (정보수정일); `first_collected_at TEXT NOT NULL`; `last_collected_at TEXT NOT NULL`; `created_at TEXT NOT NULL`; `updated_at TEXT NOT NULL`; `synced_at TEXT NULL`. No FK. Primary identity is internal `company_id`; `sminfo_kcd` is the mandatory source identity, while business number is a secondary unique identity when disclosed. Never dedupe by name.

Indexes: unique `sminfo_kcd`; partial unique `business_number WHERE business_number IS NOT NULL`; `company_name`; `ksic_code`; `industry_name`; `company_status`; `established_date`; `last_collected_at`. Search text strategy for MVP uses indexed prefix/filter queries and bounded `LIKE`; an optional FTS table is deferred because D1 does not mirror SQLite FTS uniformly.

## `company_financial_statements`

All displayed fiscal years, not a hard-coded recent subset. Columns: `financial_statement_id TEXT NOT NULL PK` (internal UUIDv7); `company_id TEXT NOT NULL FK companies(company_id) ON DELETE CASCADE`; `fiscal_year INTEGER NOT NULL` (SMINFO 결산연도); `total_assets_krw_million INTEGER NULL`; `paid_in_capital_krw_million INTEGER NULL` (자본금); `total_equity_krw_million INTEGER NULL` (자본총계); `revenue_krw_million INTEGER NULL`; `operating_income_krw_million INTEGER NULL`; `net_income_krw_million INTEGER NULL`; `collected_at TEXT NOT NULL`; `created_at TEXT NOT NULL`; `updated_at TEXT NOT NULL`; `synced_at TEXT NULL`. UNIQUE (`company_id`, `fiscal_year`). Indexes: (`fiscal_year`), (`revenue_krw_million`), (`operating_income_krw_million`), (`company_id`, `fiscal_year DESC`). Source fields are the matching financial table headers; IDs/timestamps are internal.

## `company_factories`

Zero-to-many 사업장정보 rows. `factory_id TEXT NOT NULL PK`; `company_id TEXT NOT NULL FK ... CASCADE`; `factory_name TEXT NULL`; `location_address TEXT NULL`; `source_ordinal INTEGER NOT NULL DEFAULT 0`; `collected_at TEXT NOT NULL`; `created_at TEXT NOT NULL`; `updated_at TEXT NOT NULL`; `synced_at TEXT NULL`. UNIQUE (`company_id`, `source_ordinal`). Index `company_id`. Names/addresses/ordinal come from the SMINFO section; timestamps and ID are internal.

## `company_patents` and `company_executives`

Patent: `patent_id TEXT PK`, `company_id TEXT FK`, `patent_date TEXT NULL`, `description TEXT NULL`, `source_ordinal INTEGER NOT NULL DEFAULT 0`, standard collected/created/updated/synced timestamps; UNIQUE (`company_id`,`source_ordinal`). Executive: `executive_id TEXT PK`, `company_id TEXT FK`, `position_title TEXT NULL`, `masked_name TEXT NULL`, `source_ordinal INTEGER NOT NULL DEFAULT 0`, same timestamps; UNIQUE (`company_id`,`source_ordinal`). These preserve every displayed row without attempting to identify masked people.

Certification/support sections are deferred until real reference HTML confirms stable fields. Raw HTML is not proposed for storage because it may contain session data.

## `collection_jobs`

Resumable search snapshot. `collection_job_id TEXT NOT NULL PK`; `status TEXT NOT NULL` CHECK in IDLE/READY/RUNNING/PAUSED/STOPPED/COMPLETED/ERROR; `search_summary TEXT NULL`; `source_result_total INTEGER NULL`; `source_total_pages INTEGER NULL`; `completed_count INTEGER NOT NULL DEFAULT 0`; `failed_count INTEGER NOT NULL DEFAULT 0`; `skipped_count INTEGER NOT NULL DEFAULT 0`; `dev_max_companies INTEGER NULL`; `started_at TEXT NULL`; `completed_at TEXT NULL`; `created_at TEXT NOT NULL`; `updated_at TEXT NOT NULL`. All internal except totals/search summary inferred from current result DOM. Index (`status`,`updated_at`). No cookies or query credentials.

## `collection_items`

Durable queue and retry state. `collection_item_id TEXT NOT NULL PK`; `collection_job_id TEXT NOT NULL FK collection_jobs(...) CASCADE`; `sminfo_kcd TEXT NOT NULL`; `company_name_snapshot TEXT NOT NULL`; `source_page_number INTEGER NOT NULL`; `source_row_number INTEGER NOT NULL`; `status TEXT NOT NULL DEFAULT 'PENDING'` CHECK PENDING/RUNNING/DONE/FAILED/SKIPPED; `attempt_count INTEGER NOT NULL DEFAULT 0`; `error_code TEXT NULL`; `error_message TEXT NULL` (sanitized); `company_id TEXT NULL FK companies(company_id) SET NULL`; `started_at TEXT NULL`; `finished_at TEXT NULL`; `created_at TEXT NOT NULL`; `updated_at TEXT NOT NULL`. UNIQUE (`collection_job_id`,`sminfo_kcd`). Indexes (`collection_job_id`,`status`,`source_page_number`,`source_row_number`) and (`status`,`updated_at`). A startup recovery changes stale RUNNING items to PENDING in a transaction.

## `collection_events`

Sanitized audit log displayed in UI: `collection_event_id TEXT PK`; `collection_job_id TEXT NULL FK ... CASCADE`; `collection_item_id TEXT NULL FK ... SET NULL`; `event_type TEXT NOT NULL`; `severity TEXT NOT NULL DEFAULT 'INFO'`; `message TEXT NOT NULL`; `occurred_at TEXT NOT NULL`; `created_at TEXT NOT NULL`. Index (`collection_job_id`,`occurred_at DESC`). Never stores cookies, session IDs, passwords or page HTML.

## D1 compatibility and transaction policy

All proposed primitive types, PK/FK/UNIQUE/CHECK and ordinary indexes are accepted by SQLite and D1. UUID text avoids local autoincrement collisions during future sync. Each company detail is upserted with its child rows and item transition to DONE in one short transaction under WAL; readers see the previous committed snapshot until commit. Busy timeout and bounded retry will be added in Phase 2. `synced_at` is nullable on syncable business tables, while local operational queue/event tables are not required to sync.

## Decisions requested

1. Approve UUIDv7 `company_id` as primary key, mandatory unique `sminfo_kcd` as source ID, and nullable unique business number as secondary ID.
2. Approve the six tables above plus factory/patent/executive child tables; certification/support data remains deferred pending real samples.
3. Approve integer KRW-million financial storage and UTC text timestamp policy.
4. Approve the listed indexes and no FTS table for MVP.
