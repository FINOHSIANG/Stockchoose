# Electron + Bun migration status

## Target

The desktop app now runs as an Electron shell plus a Bun local API sidecar. The Bun sidecar owns the embedded crawler engine for data that cannot be reached through stable APIs.

## Implemented

- Electron and Vite proxy local data routes through `electron/bun-api.cjs`.
- `bun-api/server.ts` exposes the local HTTP contract for migrated data, strategy, news, valuation, and trade routes.
- `bun-api/crawler/engine.ts` provides embedded crawler primitives: rate limiting, timeouts, JSON/text fetch, RSS parsing, and in-memory cache.
- Bun market collectors cover Eastmoney A-share spot, Eastmoney historical rows, Tencent quote rows, Tencent quote text, Tencent all-A-share quotes, and Tencent K-line points.
- Bun public-source collectors cover Tencent-derived technical indicators, Eastmoney F10 profiles, Eastmoney northbound holdings, Eastmoney margin balances, Eastmoney analyst forecasts, Eastmoney finance metrics/statements, Eastmoney annual-report CSV generation, and Eastmoney filing announcements.
- AShareHub pass-through proxy is handled by Bun with API-key forwarding and row-container validation.
- Bun news collectors cover GDELT, Eastmoney news, NewsAPI, custom REST, and RSS.
- Strategy screen/rank/backtest/optimize are served by Bun through the existing TypeScript strategy engine.
- Trade plan/export/paper-submit/asset-sync are served by Bun.
- Valuation rows are served by Bun from real stock market/finance fields supplied by the UI. The endpoint rejects empty/missing real input by returning no rows rather than synthesizing sample rows.
- Packaging compiles `bun-api/server.ts` into `tmp/sidecars/stockchoose-bun-api.exe`; electron-builder embeds that sidecar inside the portable app resources, so the release folder exposes a single distributable `StockChoose Beta-*.exe`.
- Frontend service names, tests, and user-facing workflow labels have been migrated from the old sidecar naming to Bun.
- The old Rust workspace, sidecar bridge, smoke script, Cargo wrapper, and Rust architecture notes are archived under `archive/rust-legacy/`. They are not part of the default runtime/build path.

## Completion audit

No active endpoint is intentionally left as `501`. The old Rust workspace, sidecar bridge, smoke script, Cargo wrapper, and Rust architecture notes are archived under `archive/rust-legacy/` and are not part of the default runtime/build path.

The Bun valuation endpoint is the active valuation implementation. It uses real market and finance fields supplied by the UI, returns no rows when required real inputs are missing, and is covered by unit tests plus the Bun live smoke valuation probe. It is no longer treated as a browser fallback or local sample path.

A full packaged Electron portable build has been run after the Bun migration. The portable app embeds `resources/stockchoose-bun-api.exe`, and the packaged sidecar passes the expanded Bun live smoke suite.

## Verification commands

Current passing checks:

```powershell
npm.cmd run bun:check
npm.cmd run test:unit
npm.cmd run build
npm.cmd run test:smoke
npm.cmd run bun:live-smoke -- --json --timeout-ms 120000
npm.cmd run package:beta
$env:STOCKCHOOSE_BUN_API_EXE=(Resolve-Path 'tmp\sidecars\stockchoose-bun-api.exe').Path; npm.cmd run bun:live-smoke -- --json --timeout-ms 120000
```

The expanded `bun:live-smoke` starts an isolated Bun sidecar port by default and proves health, integration source test, AKTools rows, Eastmoney spot/universe, Tencent quote/all-A-share/K-line, technical indicators, F10 profile, north holdings, finance statements/metrics, annual reports, analyst forecasts, margin balances, filing announcements, GDELT, Eastmoney news crawler/source-test, sentiment events/analysis, news-analysis local/model tests, strategy screen/rank/backtest/optimize, trade plan/export/paper-submit/asset-sync, and valuation rows through Bun with `x-stockchoose-data-engine: bun`.
