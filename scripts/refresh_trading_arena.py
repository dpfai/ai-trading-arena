#!/usr/bin/env python3
"""Refresh upstream inputs, then build AI Trading Arena JSON data."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
QUANT_DIR = Path("~/AI-workplace/quant-learning").expanduser()
QUANT_PYTHON = QUANT_DIR / "venv" / "bin" / "python"
QUANT_DB = QUANT_DIR / "data" / "trading_arena.db"
OPENCLAW_EXPLORER = Path("~/.openclaw/workspace-explorer").expanduser()
STOCK_ANALYSIS_SCRIPT = OPENCLAW_EXPLORER / "weekly_stock_analysis.py"
STOCK_ANALYSIS_DIR = OPENCLAW_EXPLORER / "investments"
EXPECTED_SOURCES = {
    "quant_learning",
    "ai_analyst",
    "spy",
    "etf_aggressive",
    "etf_balanced",
    "etf_conservative",
}


def run(cmd: list[str], cwd: Path) -> None:
    print(f"$ {' '.join(cmd)}")
    subprocess.run(cmd, cwd=cwd, check=True)


def refresh_quant_learning(end: str) -> None:
    python = QUANT_PYTHON if QUANT_PYTHON.exists() else Path(sys.executable)
    run(
        [str(python), "daily_runner.py", "--end", end, "--db", str(QUANT_DB)],
        cwd=QUANT_DIR,
    )


def ensure_stock_analysis(end: str) -> None:
    target = STOCK_ANALYSIS_DIR / f"stock_analysis_{end}.json"
    if target.exists():
        print(f"Stock analysis exists: {target}")
        return
    run([sys.executable, str(STOCK_ANALYSIS_SCRIPT)], cwd=OPENCLAW_EXPLORER)
    if not target.exists():
        raise RuntimeError(f"Expected stock analysis was not created: {target}")


def build_data(end: str) -> None:
    run([sys.executable, "scripts/build_trading_arena_data.py", "--end", end], cwd=ROOT)


def validate_outputs() -> None:
    for filename in ["strategies.json", "signals.json", "equity_curve.json", "holdings.json"]:
        path = ROOT / "data" / filename
        rows = json.loads(path.read_text(encoding="utf-8"))
        sources = {row.get("source") for row in rows if isinstance(row, dict)}
        missing = EXPECTED_SOURCES - sources
        if missing:
            raise RuntimeError(f"{filename} missing sources: {sorted(missing)}")
    print("Trading Arena output validation passed.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh Trading Arena upstream data and JSON outputs.")
    parser.add_argument("--end", default=date.today().isoformat())
    parser.add_argument("--skip-quant", action="store_true")
    parser.add_argument("--skip-stock-analysis", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    datetime.strptime(args.end, "%Y-%m-%d")
    if not args.skip_quant:
        refresh_quant_learning(args.end)
    if not args.skip_stock_analysis:
        ensure_stock_analysis(args.end)
    build_data(args.end)
    validate_outputs()


if __name__ == "__main__":
    main()
