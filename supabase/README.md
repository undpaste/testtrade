# Supabase database setup

For a fresh project, run `schema.sql` first, then run each SQL file in `migrations/` in filename order in the Supabase SQL Editor.

For an existing project that already has the original schema, run only the new migration:

1. Open Supabase Dashboard → SQL Editor → New query.
2. Paste the contents of `migrations/20261022_paper_trading_platform.sql`.
3. Run it once before using the updated order screen.

The migration adds executions, ledger entries, closed-trade analytics, OCO orders, order triggers, leverage/margin fields, row-level-security policies, and atomic `settle_paper_fill` and `create_paper_oco_order` functions. Trade execution will fail until the migration is applied.

The current app uses a single USD-denominated paper account (crypto spot prices and fees may be denominated in USDT). It does not yet implement separate USD/USDT/BTC/ETH wallet balances or automatic forced liquidation; displayed liquidation prices are risk estimates. DEX discovery currently uses Ethereum trending pools.

The fee schedule and market data remain simulation inputs. Quotes may be delayed, unavailable, or rate-limited by public providers; modeled fills, regulatory costs, DEX gas, and funding are estimates, not a promise of real venue execution.
