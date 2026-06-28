#!/usr/bin/env python3
"""Build AI Trading Arena static JSON data from OpenClaw outputs.

This script intentionally lives in the ai-trading-arena repository. OpenClaw
agents produce upstream research and portfolio files; this script owns the
website-ready JSON contract under data/.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sqlite3
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import pandas as pd
import yfinance as yf


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OPENCLAW_INVESTMENTS = Path("~/.openclaw/workspace-explorer/investments").expanduser()
ETF_TRACKING = OPENCLAW_INVESTMENTS / "portfolio_data" / "portfolio_tracking.json"
QUANT_DB = Path("~/AI-workplace/quant-learning/data/trading_arena.db").expanduser()

START_DATE = date(2026, 6, 15)
INITIAL_CASH = 10_000.0
WEEKLY_CONTRIBUTION = 500.0
DCA_WEEKDAY = 1  # Tuesday

ETF_SOURCE_MAP = {
    "组合A-激进型": ("etf_aggressive", "DCA Aggressive"),
    "组合B-平衡型": ("etf_balanced", "DCA Balanced"),
    "组合C-稳健型": ("etf_conservative", "DCA Conservative"),
}
ETF_ALLOCATIONS = {
    "etf_aggressive": {"VOO": 0.425, "VGT": 0.425, "SMH": 0.15},
    "etf_balanced": {"VOO": 0.50, "VGT": 0.40, "SMH": 0.10},
    "etf_conservative": {"VOO": 0.60, "VGT": 0.35, "SMH": 0.05},
}


def iso_day(value: Any) -> str:
    if isinstance(value, pd.Timestamp):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def parse_day(value: str | date | datetime) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.strptime(value[:10], "%Y-%m-%d").date()


def clean_number(value: Any) -> Any:
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if isinstance(value, dict):
        return {k: clean_number(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean_number(v) for v in value]
    return value


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(clean_number(payload), ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_download(raw: pd.DataFrame, tickers: list[str]) -> pd.DataFrame:
    if raw.empty:
        return pd.DataFrame()
    data = raw
    if isinstance(data.columns, pd.MultiIndex):
        if "Close" in data.columns.get_level_values(0):
            data = data["Close"]
        elif "Close" in data.columns.get_level_values(-1):
            data = data.xs("Close", level=-1, axis=1)
    elif "Close" in data.columns:
        data = data[["Close"]].rename(columns={"Close": tickers[0]})
    data = data.copy()
    data.index = pd.to_datetime(data.index).tz_localize(None).normalize()
    if isinstance(data, pd.Series):
        data = data.to_frame(tickers[0])
    return data.sort_index()


def download_closes(tickers: set[str], start: date, end: date) -> pd.DataFrame:
    tickers = sorted(t for t in tickers if t)
    if not tickers:
        return pd.DataFrame()
    raw = yf.download(
        tickers,
        start=start.isoformat(),
        end=(end + timedelta(days=1)).isoformat(),
        auto_adjust=False,
        progress=False,
        group_by="column",
    )
    return normalize_download(raw, tickers)


def price_on(prices: pd.DataFrame, ticker: str, day: str | date, fallback: float | None = None) -> float | None:
    if ticker not in prices.columns:
        return fallback
    ts = pd.Timestamp(parse_day(day))
    if ts in prices.index and pd.notna(prices.loc[ts, ticker]):
        return float(prices.loc[ts, ticker])
    earlier = prices.index[prices.index <= ts]
    if len(earlier):
        val = prices.loc[earlier[-1], ticker]
        if pd.notna(val):
            return float(val)
    later = prices.index[prices.index >= ts]
    if len(later):
        val = prices.loc[later[0], ticker]
        if pd.notna(val):
            return float(val)
    return fallback


def trading_days(prices: pd.DataFrame, start: date) -> list[pd.Timestamp]:
    return [idx for idx in prices.index if idx.date() >= start]


def load_quant_learning() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Read existing QuantAI rows from the SQLite DB, falling back to current JSON."""
    if QUANT_DB.exists():
        with sqlite3.connect(QUANT_DB) as conn:
            signals = pd.read_sql_query(
                "SELECT * FROM signals WHERE source='quant_learning' ORDER BY date, id",
                conn,
            ).to_dict("records")
            equity = pd.read_sql_query(
                "SELECT * FROM equity_curve WHERE source='quant_learning' ORDER BY date",
                conn,
            ).to_dict("records")
            holdings = pd.read_sql_query(
                "SELECT * FROM holdings WHERE source='quant_learning' ORDER BY date, ticker",
                conn,
            ).to_dict("records")
        if equity:
            return signals, normalize_contributed_cost(equity), holdings

    return (
        [r for r in load_json(DATA_DIR / "signals.json", []) if r.get("source") == "quant_learning"],
        normalize_contributed_cost([r for r in load_json(DATA_DIR / "equity_curve.json", []) if r.get("source") == "quant_learning"]),
        [r for r in load_json(DATA_DIR / "holdings.json", []) if r.get("source") == "quant_learning"],
    )


def normalize_contributed_cost(equity: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Use cumulative contributed capital as total_cost for strategy comparisons."""
    normalized: list[dict[str, Any]] = []
    for row in sorted(equity, key=lambda r: r["date"]):
        item = dict(row)
        current = parse_day(item["date"])
        contributed = INITIAL_CASH
        cursor = START_DATE + timedelta(days=1)
        while cursor <= current:
            if cursor.weekday() == DCA_WEEKDAY:
                contributed += WEEKLY_CONTRIBUTION
            cursor += timedelta(days=1)
        item["total_cost"] = contributed
        item["return_pct"] = (float(item["total_value"]) - contributed) / contributed
        normalized.append(item)
    return normalized


def rebuild_quant_learning(
    signals: list[dict[str, Any]],
    prices: pd.DataFrame,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Rebuild QuantAI holdings/equity from signals so stale DB snapshots do not leak in."""
    equity: list[dict[str, Any]] = []
    holdings_rows: list[dict[str, Any]] = []
    positions: dict[str, dict[str, float]] = defaultdict(lambda: {"shares": 0.0, "cost": 0.0})
    by_day: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for signal in signals:
        by_day[signal["date"]].append(signal)

    cash = INITIAL_CASH
    total_contributed = INITIAL_CASH
    for i, day in enumerate(trading_days(prices, START_DATE)):
        day_str = iso_day(day)
        if i > 0 and day.weekday() == DCA_WEEKDAY:
            cash += WEEKLY_CONTRIBUTION
            total_contributed += WEEKLY_CONTRIBUTION

        for signal in sorted(by_day.get(day_str, []), key=lambda r: r["id"]):
            ticker = signal["ticker"]
            price = float(signal.get("price") or price_on(prices, ticker, day_str) or 0)
            shares = float(signal.get("shares") or 0)
            amount = float(signal.get("amount") or shares * price)
            if signal["action"] == "buy" and shares > 0:
                positions[ticker]["shares"] += shares
                positions[ticker]["cost"] += amount
                cash -= amount
            elif signal["action"] == "sell" and shares > 0 and positions[ticker]["shares"] > 0:
                old_shares = positions[ticker]["shares"]
                sold_shares = min(shares, old_shares)
                cost_reduction = positions[ticker]["cost"] * (sold_shares / old_shares)
                positions[ticker]["shares"] -= sold_shares
                positions[ticker]["cost"] -= cost_reduction
                cash += amount
                if positions[ticker]["shares"] <= 1e-10:
                    positions[ticker] = {"shares": 0.0, "cost": 0.0}

        positions_value = 0.0
        for ticker, pos in sorted(positions.items()):
            if pos["shares"] <= 0:
                continue
            px = price_on(prices, ticker, day_str)
            if not px:
                continue
            positions_value += pos["shares"] * px
            holdings_rows.append(holding_row(day_str, "quant_learning", ticker, pos["shares"], pos["cost"], px))
        equity.append(equity_row(day_str, "quant_learning", cash + positions_value, cash, positions_value, total_contributed))

    return equity, holdings_rows


def build_spy(prices: pd.DataFrame) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    signals: list[dict[str, Any]] = []
    equity: list[dict[str, Any]] = []
    holdings_rows: list[dict[str, Any]] = []
    days = trading_days(prices, START_DATE)
    if not days or "SPY" not in prices.columns:
        return signals, equity, holdings_rows

    shares = 0.0
    total_cost = 0.0
    cash = INITIAL_CASH

    for i, day in enumerate(days):
        day_str = iso_day(day)
        price = price_on(prices, "SPY", day_str)
        if not price:
            continue
        if i == 0:
            amount = cash
            shares += amount / price
            total_cost += amount
            cash -= amount
            signals.append(signal_row("spy", day_str, "buy_hold", "buy", "SPY", price, amount / price, amount, cash, "Initial SPY buy-and-hold"))
        elif day.weekday() == DCA_WEEKDAY:
            amount = WEEKLY_CONTRIBUTION
            shares += amount / price
            total_cost += amount
            signals.append(signal_row("spy", day_str, "buy_hold", "buy", "SPY", price, amount / price, amount, cash, "Weekly SPY DCA"))

        value = shares * price
        holdings_rows.append(holding_row(day_str, "spy", "SPY", shares, total_cost, price))
        equity.append(equity_row(day_str, "spy", value, cash, value, total_cost))
    return signals, equity, holdings_rows


def build_etf(prices: pd.DataFrame) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    raw = load_json(ETF_TRACKING, {})
    portfolios = raw.get("portfolios", raw)
    signals: list[dict[str, Any]] = []
    equity: list[dict[str, Any]] = []
    holdings_rows: list[dict[str, Any]] = []
    days = trading_days(prices, START_DATE)

    for cn_name, (source, _name) in ETF_SOURCE_MAP.items():
        portfolio = portfolios.get(cn_name)
        if not portfolio:
            continue
        txs = sorted(portfolio.get("transactions", []), key=lambda t: (t.get("date", ""), t.get("etf", "")))
        positions: dict[str, dict[str, float]] = defaultdict(lambda: {"shares": 0.0, "cost": 0.0})
        cash = INITIAL_CASH
        total_contributed = INITIAL_CASH
        contributed_dates: set[str] = set()
        tx_index = 0
        for day in days:
            day_str = iso_day(day)
            while tx_index < len(txs) and txs[tx_index].get("date", "") <= day_str:
                tx = txs[tx_index]
                ticker = tx.get("etf")
                amount = float(tx.get("amount") or 0)
                tx_price = float(tx.get("price") or 0)
                shares = float(tx.get("shares") or (amount / tx_price if tx_price else 0))
                if ticker and amount > 0 and shares > 0:
                    if tx.get("type") == "weekly_investment" and tx["date"] not in contributed_dates:
                        cash += WEEKLY_CONTRIBUTION
                        total_contributed += WEEKLY_CONTRIBUTION
                        contributed_dates.add(tx["date"])
                    positions[ticker]["shares"] += shares
                    positions[ticker]["cost"] += amount
                    cash -= amount
                    signals.append(signal_row(source, tx["date"], "dca", "buy", ticker, tx_price, shares, amount, cash, tx.get("type", "ETF DCA")))
                tx_index += 1

            positions_value = 0.0
            for ticker, pos in sorted(positions.items()):
                if pos["shares"] <= 0:
                    continue
                px = price_on(prices, ticker, day_str)
                if not px:
                    continue
                positions_value += pos["shares"] * px
                holdings_rows.append(holding_row(day_str, source, ticker, pos["shares"], pos["cost"], px))
            if positions_value > 0:
                equity.append(equity_row(day_str, source, cash + positions_value, cash, positions_value, total_contributed))

    return signals, equity, holdings_rows


def analysis_date_from_path(path: Path) -> str | None:
    match = re.search(r"(\d{4}-\d{2}-\d{2})", path.name)
    return match.group(1) if match else None


def load_analysis_items() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    paths = sorted(OPENCLAW_INVESTMENTS.glob("stock_analysis_*.json"))
    result_path = OPENCLAW_INVESTMENTS.parent / "stock_analysis_results.json"
    if result_path.exists():
        paths.append(result_path)

    for path in paths:
        fallback_date = analysis_date_from_path(path)
        data = load_json(path, [])
        records: list[dict[str, Any]]
        if isinstance(data, list):
            records = [r for r in data if isinstance(r, dict)]
        elif isinstance(data, dict):
            records = [r for r in data.get("stocks", data.get("results", [])) if isinstance(r, dict)]
        else:
            continue
        for record in records:
            item = dict(record)
            item["date"] = item.get("date") or fallback_date
            if item.get("date"):
                items.append(item)
    return sorted(items, key=lambda r: (r.get("date", ""), r.get("code", "")))


def action_from_analysis(stock: dict[str, Any]) -> str | None:
    ai = stock.get("ai_analysis") or {}
    tech = stock.get("technical_indicators") or {}
    analysis = stock.get("analysis") or {}
    text = " ".join(
        str(v)
        for v in [
            ai.get("operation_advice"),
            tech.get("buy_signal"),
            analysis.get("suggestion"),
        ]
        if v is not None
    )
    if any(word in text for word in ["强烈买入", "买入", "加仓"]):
        return "buy"
    if any(word in text for word in ["卖出", "减仓", "清仓"]):
        return "sell"
    return None


def stock_price_hint(stock: dict[str, Any]) -> float | None:
    for path in [
        ("current_price",),
        ("technical_indicators", "current_price"),
        ("price_data", "current_price"),
    ]:
        value: Any = stock
        for key in path:
            value = value.get(key) if isinstance(value, dict) else None
        if isinstance(value, (int, float)) and value > 0:
            return float(value)
    return None


def build_ai_analyst(prices: pd.DataFrame, items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    signals: list[dict[str, Any]] = []
    equity: list[dict[str, Any]] = []
    holdings_rows: list[dict[str, Any]] = []
    days = trading_days(prices, START_DATE)
    by_day: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in items:
        item_date = item.get("date")
        if item_date and item_date >= START_DATE.isoformat():
            by_day[item_date].append(item)

    cash = INITIAL_CASH
    total_contributed = INITIAL_CASH
    positions: dict[str, dict[str, float]] = defaultdict(lambda: {"shares": 0.0, "cost": 0.0})

    for i, day in enumerate(days):
        day_str = iso_day(day)
        if i > 0 and day.weekday() == DCA_WEEKDAY:
            cash += WEEKLY_CONTRIBUTION
            total_contributed += WEEKLY_CONTRIBUTION

        for stock in by_day.get(day_str, []):
            ticker = stock.get("code")
            if not ticker:
                continue
            action = action_from_analysis(stock)
            if not action:
                continue
            px = price_on(prices, ticker, day_str, stock_price_hint(stock))
            if not px:
                continue
            reason = analysis_reason(stock)
            if action == "buy" and cash > 1:
                amount = min(cash * 0.30, cash)
                shares = amount / px
                positions[ticker]["shares"] += shares
                positions[ticker]["cost"] += amount
                cash -= amount
                signals.append(signal_row("ai_analyst", day_str, "llm_analysis", "buy", ticker, px, shares, amount, cash, reason))
            elif action == "sell" and positions[ticker]["shares"] > 0:
                shares = positions[ticker]["shares"]
                amount = shares * px
                cash += amount
                signals.append(signal_row("ai_analyst", day_str, "llm_analysis", "sell", ticker, px, shares, amount, cash, reason))
                positions[ticker] = {"shares": 0.0, "cost": 0.0}

        positions_value = 0.0
        active_cost = 0.0
        for ticker, pos in sorted(positions.items()):
            if pos["shares"] <= 0:
                continue
            px = price_on(prices, ticker, day_str)
            if not px:
                continue
            positions_value += pos["shares"] * px
            active_cost += pos["cost"]
            holdings_rows.append(holding_row(day_str, "ai_analyst", ticker, pos["shares"], pos["cost"], px))
        equity.append(equity_row(day_str, "ai_analyst", cash + positions_value, cash, positions_value, total_contributed))

    return signals, equity, holdings_rows


def analysis_reason(stock: dict[str, Any]) -> str:
    ai = stock.get("ai_analysis") or {}
    tech = stock.get("technical_indicators") or {}
    analysis = stock.get("analysis") or {}
    parts = [
        ai.get("analysis_summary"),
        analysis.get("reason"),
        "; ".join(tech.get("signal_reasons") or []),
    ]
    reason = " | ".join(str(p) for p in parts if p)
    return reason[:240] or "OpenClaw AI analyst signal"


def signal_row(source: str, day: str, strategy: str, action: str, ticker: str, price: float, shares: float, amount: float, cash: float, reason: str) -> dict[str, Any]:
    return {
        "id": f"{source}_{day}_{ticker}_{action}",
        "date": day,
        "source": source,
        "strategy": strategy,
        "action": action,
        "ticker": ticker,
        "price": price,
        "shares": shares,
        "amount": amount,
        "cash_after": cash,
        "reason": reason,
    }


def holding_row(day: str, source: str, ticker: str, shares: float, total_cost: float, price: float) -> dict[str, Any]:
    value = shares * price
    profit_loss = value - total_cost
    return {
        "date": day,
        "source": source,
        "ticker": ticker,
        "shares": shares,
        "cost_price": total_cost / shares if shares else 0.0,
        "current_price": price,
        "value": value,
        "profit_loss": profit_loss,
        "return_pct": profit_loss / total_cost if total_cost else 0.0,
    }


def equity_row(day: str, source: str, total_value: float, cash: float, positions_value: float, total_cost: float) -> dict[str, Any]:
    return {
        "date": day,
        "source": source,
        "total_value": total_value,
        "cash": cash,
        "positions_value": positions_value,
        "total_cost": total_cost,
        "return_pct": (total_value - total_cost) / total_cost if total_cost else 0.0,
    }


def strategies_payload() -> list[dict[str, Any]]:
    return [
        {
            "source": "quant_learning",
            "name": "QuantAI Four-Vote Composite",
            "tickers": ["SPY", "QQQ", "VOO", "VGT", "SMH"],
            "initial_cash": INITIAL_CASH,
            "weekly_contribution": WEEKLY_CONTRIBUTION,
            "sub_strategies": ["MA20/MA50 crossover", "RSI mean reversion", "Bollinger Bands", "ML direction classifier"],
        },
        {
            "source": "ai_analyst",
            "name": "AI Analyst (OpenClaw 海岩)",
            "tickers": "OpenClaw stock_analysis universe",
            "initial_cash": INITIAL_CASH,
            "weekly_contribution": WEEKLY_CONTRIBUTION,
            "sub_strategies": ["OpenClaw technical scan", "LLM operation advice"],
        },
        {
            "source": "spy",
            "name": "SPY Buy & Hold",
            "tickers": ["SPY"],
            "initial_cash": INITIAL_CASH,
            "weekly_contribution": WEEKLY_CONTRIBUTION,
            "sub_strategies": ["Initial all-in buy", "Tuesday DCA"],
        },
        *[
            {
                "source": source,
                "name": name,
                "tickers": list(ETF_ALLOCATIONS[source].keys()),
                "initial_cash": None,
                "weekly_contribution": WEEKLY_CONTRIBUTION,
                "allocations": ETF_ALLOCATIONS[source],
                "sub_strategies": ["OpenClaw ETF portfolio tracker", "Tuesday DCA"],
            }
            for _cn, (source, name) in ETF_SOURCE_MAP.items()
        ],
    ]


def validate(equity: list[dict[str, Any]]) -> None:
    expected = {"quant_learning", "ai_analyst", "spy", "etf_aggressive", "etf_balanced", "etf_conservative"}
    actual = {row["source"] for row in equity}
    missing = expected - actual
    if missing:
        raise RuntimeError(f"Missing equity sources: {sorted(missing)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build AI Trading Arena JSON files.")
    parser.add_argument("--end", default=date.today().isoformat())
    args = parser.parse_args()
    end = parse_day(args.end)

    analysis_items = load_analysis_items()
    tickers = {"SPY", "QQQ", "VOO", "VGT", "SMH"}
    tickers.update(item.get("code") for item in analysis_items if item.get("code"))
    prices = download_closes(tickers, START_DATE, end)

    q_signals, _q_equity, _q_holdings = load_quant_learning()
    q_equity, q_holdings = rebuild_quant_learning(q_signals, prices)
    spy_signals, spy_equity, spy_holdings = build_spy(prices)
    etf_signals, etf_equity, etf_holdings = build_etf(prices)
    ai_signals, ai_equity, ai_holdings = build_ai_analyst(prices, analysis_items)

    signals = sorted(q_signals + spy_signals + etf_signals + ai_signals, key=lambda r: (r["date"], r["source"], r["ticker"], r["id"]))
    equity = sorted(q_equity + spy_equity + etf_equity + ai_equity, key=lambda r: (r["date"], r["source"]))
    holdings = sorted(q_holdings + spy_holdings + etf_holdings + ai_holdings, key=lambda r: (r["date"], r["source"], r["ticker"]))
    validate(equity)

    write_json(DATA_DIR / "strategies.json", strategies_payload())
    write_json(DATA_DIR / "signals.json", signals)
    write_json(DATA_DIR / "equity_curve.json", equity)
    write_json(DATA_DIR / "holdings.json", holdings)

    print("Generated Trading Arena data:")
    for source in sorted({row["source"] for row in equity}):
        rows = [row for row in equity if row["source"] == source]
        print(f"  {source}: {len(rows)} equity rows, {rows[0]['date']} -> {rows[-1]['date']}")


if __name__ == "__main__":
    main()
