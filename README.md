# MONA RADAR / Company

Phase 1 desktop prototype for a local-first SMINFO company collector and search product.

```powershell
npm.cmd install
npm.cmd test
npm.cmd run dev
npm.cmd run tauri dev
```

Create the complete Windows installer (frontend, collector bundle, bundled Node runtime, Tauri and NSIS) with `npm.cmd exec tauri build -- --bundles nsis`.

The approved schema is initialized automatically in WAL mode at `%APPDATA%/com.monaradar.company/data/mona-radar-company.sqlite3`. The persistent browser profile is `%APPDATA%/MonaRadar/browser-profile`.

Development collection is capped at three companies by default. Set `DEV_MAX_COMPANIES=1` to reduce it further. Production collection has no implicit cap and must only begin from an explicit user action.
