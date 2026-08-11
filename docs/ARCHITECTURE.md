# MONA RADAR / Company — Phase 1 architecture

The Vite TypeScript UI is packaged directly in Tauri WebView2; there is no local HTTP server in production. A bundled Node collector sidecar owns the visible Playwright persistent context and emits newline-delimited JSON events on stdout. Tauri will validate and forward only typed events to the UI. Credentials and cookies are never stored in the app database or logs.

Flow: user login/search in SMINFO → DOM detection → result-page queue → normal site click/JavaScript navigation → semantic detail parser → per-company transaction → SQLite WAL → immediate Search reads. The actual persistence bridge is intentionally deferred until DB approval.

Collector safety: 60 seconds plus 0–30 seconds jitter between detail requests; pause immediately on an explicit restriction, 403/429, login expiry or unexpected redirect; pause after three consecutive failures; `DEV_MAX_COMPANIES` defaults to 3 in development. Jitter is traffic pacing, never fingerprint evasion.

Persistent profile: `%APPDATA%/MonaRadar/browser-profile/`. Planned DB: `%APPDATA%/MonaRadar/data/mona-radar-company.sqlite3`.

## Phase 1 boundary

Implemented: navigation/UI, shared strict types, semantic fixture parsers/tests, persistent Playwright login/search prototype, structured stdout events, rate limiter constants, Tauri/NSIS scaffold. Not implemented before approval: SQLite dependency, database file, DDL/migrations, persistence, Search queries, production sidecar bundling.
