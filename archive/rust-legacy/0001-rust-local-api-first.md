# ADR 0001: Rust local API first

## Status

Accepted for migration work.

## Decision

Rewrite STOCKCHOOSE by introducing a Rust local HTTP API before replacing the React UI or Electron shell.

## Rationale

The highest-risk parts of the product are data collection, financial statement normalization, strategy screening, and trade instruction generation. A local Rust API lets those responsibilities move out of ad hoc Electron/Vite proxy code while the current UI continues to provide fast feedback.

This avoids a big-bang rewrite where data parity, UI behavior, and desktop packaging all change at once.

## Consequences

- The Rust API must preserve compatibility endpoints such as `/aktools/stock_zh_a_spot_em` during migration.
- TypeScript services can be switched endpoint by endpoint.
- Electron can later either launch the Rust binary or be replaced by a Tauri shell.
- Completion is not proven until Rust tests and browser smoke tests cover the full data, collection, selection, valuation, and trading workflows.
