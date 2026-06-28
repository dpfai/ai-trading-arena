# AI Trading Arena

Static GitHub Pages dashboard for comparing AI/quant trading strategies.

## Data Pipeline

Website data lives in `data/*.json`. The full refresh entrypoint is:

```bash
python3 scripts/refresh_trading_arena.py --end YYYY-MM-DD
```

That wrapper updates QuantAI first, then calls `scripts/build_trading_arena_data.py`. It runs `quant-learning/daily_runner.py` so QuantAI does not stall, then rebuilds daily values for all strategies. AI Analyst uses existing OpenClaw `stock_analysis_*.json` files as weekly decision points; daily refresh only marks current holdings to market unless `--run-stock-analysis` is explicitly passed.

The generator is intentionally kept in this repository. OpenClaw produces upstream research and portfolio files, while this repo owns the final Trading Arena JSON contract.

Current data sources:

- `quant_learning`: QuantAI rows read from `~/AI-workplace/quant-learning/data/trading_arena.db` when available.
- `ai_analyst`: OpenClaw Haiyan stock analysis files under `~/.openclaw/workspace-explorer/investments/stock_analysis_*.json`; weekly decisions, daily valuation.
- `spy`: SPY buy-and-hold benchmark with Tuesday DCA.
- `etf_aggressive`, `etf_balanced`, `etf_conservative`: OpenClaw ETF portfolio tracker data from `~/.openclaw/workspace-explorer/investments/portfolio_data/portfolio_tracking.json`.

The OpenClaw cron task `AI Trading Arena 数据发布 (乐天)` should trigger `scripts/refresh_trading_arena.py` from the main agent. Trading Arena publish logic should not be moved into `quant-learning`; that project may be updated/read as a QuantAI source only.
