"""Backtest a momentum rule against SPY, using the S&P 500 as it was on each date.

Each month-end, take the stocks that were in the S&P 500 on that date, rank them by their
return from 12 months ago up to 1 month ago, buy the top N in equal amounts, and hold them
through the next month. A trading cost is charged on every dollar swapped.

    python scripts/momentum.py                       # S&P 500 members as of each date
    python scripts/momentum.py --universe fixed      # old way: 45 of today's big companies
    python scripts/momentum.py --end 2022-12-31      # tuning period only
    python scripts/momentum.py --top 20 --cost 0.002
    python scripts/momentum.py --refresh             # re-download membership and prices

Index membership comes from github.com/fja05680/sp500. Prices come from Yahoo Finance,
which drops stocks once they are delisted, so some former members have no prices. The
script reports how many are missing and estimates the bias that leaves, by comparing an
equal-weight portfolio of every member it has prices for with RSP, a real equal-weight
S&P 500 fund whose returns include every member.
"""

import argparse
import logging
import time
import urllib.request
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RESULTS = ROOT / "results"
MEMBERSHIP_URL = (
    "https://raw.githubusercontent.com/fja05680/sp500/master/"
    "S%26P%20500%20Historical%20Components%20%26%20Changes%20(Updated).csv"
)
BENCHMARKS = ["SPY", "RSP"]  # RSP: equal-weight S&P 500 fund, used to measure leftover bias

# The old, biased universe: 45 of today's biggest companies.
FIXED = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AMD", "NFLX", "JPM",
    "V", "MA", "COST", "KO", "PEP", "DIS", "BRK.B", "UNH", "JNJ", "PG", "XOM", "CVX",
    "HD", "WMT", "LLY", "ABBV", "MRK", "AVGO", "ORCL", "CRM", "ADBE", "INTC", "CSCO",
    "QCOM", "TXN", "BAC", "WFC", "GS", "CAT", "DE", "NKE", "MCD", "SBUX", "T", "VZ",
]


# ---------- data ----------

def load_membership(refresh):
    """Returns (dates, [set of tickers]) with one entry per membership change."""
    path = DATA / "sp500_history.csv"
    if refresh or not path.exists():
        DATA.mkdir(exist_ok=True)
        print("Downloading S&P 500 membership history ...")
        urllib.request.urlretrieve(MEMBERSHIP_URL, path)
    df = pd.read_csv(path, parse_dates=["date"]).sort_values("date")
    return df["date"].to_numpy(), [set(t.split(",")) for t in df["tickers"]]


def members_on(membership, date):
    dates, sets = membership
    i = dates.searchsorted(np.datetime64(date), side="right") - 1
    return sets[i] if i >= 0 else set()


def to_yahoo(ticker):
    return ticker.replace(".", "-")  # BRK.B -> BRK-B


def load_prices(tickers, start, end, refresh):
    """Daily closes adjusted for splits and dividends, cached in data/prices_cache.pkl."""
    cache = DATA / "prices_cache.pkl"
    key = f"{start}|{end}|" + ",".join(sorted(tickers))
    if cache.exists() and not refresh:
        cached = pd.read_pickle(cache)
        if cached.get("key") == key:
            return cached["prices"]

    logging.getLogger("yfinance").setLevel(logging.CRITICAL)  # delisted tickers fail loudly
    print(f"Downloading prices for {len(tickers)} tickers (takes a few minutes the first time) ...")
    names = {to_yahoo(t): t for t in tickers}
    symbols = sorted(names)
    frames = []
    for i in range(0, len(symbols), 100):
        batch = symbols[i : i + 100]
        frames.append(yf.download(batch, start=start, end=end, auto_adjust=True, progress=False, threads=True)["Close"])
        print(f"  {min(i + 100, len(symbols))} / {len(symbols)}")
        time.sleep(1)
    prices = pd.concat(frames, axis=1).rename(columns=names)
    prices = prices.loc[:, ~prices.columns.duplicated()]
    pd.to_pickle({"key": key, "prices": prices}, cache)
    return prices


# ---------- backtest ----------

def backtest(monthly, universe, top_n, cost):
    """universe(date) -> set of tickers that may be bought at that month-end."""
    returns = monthly.pct_change(fill_method=None)
    # Known at month-end i: return from month i-12 to month i-1 (skips the latest month).
    momentum = monthly.shift(1) / monthly.shift(12) - 1

    rows, held = [], set()
    values = {"Momentum": 1.0, "Equal weight": 1.0, "SPY": 1.0, "RSP": 1.0}
    for i in range(12, len(monthly) - 1):
        date = monthly.index[i]
        members = universe(date)
        scores = momentum.iloc[i].reindex(sorted(members)).dropna()
        picks = set(scores.nlargest(top_n).index)

        swapped = len(picks - held) / top_n if picks else 0   # share of the portfolio replaced
        next_month = returns.iloc[i + 1]
        # A stock with no price next month (delisted mid-hold) counts as flat, not dropped.
        r = {
            "Momentum": next_month[list(picks)].fillna(0).mean() - swapped * 2 * cost,
            "Equal weight": next_month[list(scores.index)].fillna(0).mean(),
            "SPY": next_month["SPY"],
            "RSP": next_month["RSP"],
        }
        for k in values:
            values[k] *= 1 + r[k]
        rows.append({"date": monthly.index[i + 1], **values, "members": len(members), "priced": len(scores)})
        held = picks

    table = pd.DataFrame(rows).set_index("date")
    latest_members = universe(monthly.index[-1])
    latest = momentum.iloc[-1].reindex(sorted(latest_members)).dropna().nlargest(top_n)
    return table[list(values)], table[["members", "priced"]], latest


# ---------- output ----------

def cagr(s, years):
    return s.iloc[-1] ** (1 / years) - 1


def report(curve, coverage, latest, args, missing):
    years = len(curve) / 12
    label = "S&P 500 members on each date" if args.universe == "sp500" else "45 of today's big companies"
    print(f"\n{curve.index[0]:%b %Y} to {curve.index[-1]:%b %Y}  ({years:.1f} years, top {args.top}, monthly, {label})\n")
    for name in curve:
        s = curve[name]
        drawdown = (s / s.cummax() - 1).min()
        print(f"  {name:13} $1 became ${s.iloc[-1]:6.2f}   {cagr(s, years):6.1%} a year   worst drop {drawdown:6.1%}")
    monthly = curve.pct_change().dropna()
    print(f"\n  Momentum beat SPY in {(monthly['Momentum'] > monthly['SPY']).mean():.0%} of months")

    start = pd.DataFrame({c: [1.0] for c in curve}, index=[curve.index[0] - pd.offsets.MonthEnd(1)])
    yearly = pd.concat([start, curve.resample("YE").last()]).pct_change().dropna()
    print("\n  Year    Momentum      SPY   Equal wt      RSP")
    for date, row in yearly.iterrows():
        print(f"  {date:%Y}  {row['Momentum']:9.1%} {row['SPY']:8.1%} {row['Equal weight']:10.1%} {row['RSP']:8.1%}")

    if args.universe == "sp500":
        share = coverage["priced"] / coverage["members"]
        gap = cagr(curve["Equal weight"], years) - cagr(curve["RSP"], years)
        print("\n  Survivorship check")
        print(f"    Members with usable prices: {share.mean():.0%} on average, {share.min():.0%} at worst ({share.idxmin():%b %Y})")
        print(f"    Former members Yahoo has no prices for at all: {len(missing)}")
        print(f"    Equal weight of priced members vs. RSP: {gap:+.1%} a year")
        print("    That gap estimates the bias still left: missing stocks that would have dragged returns down.")
        print("    (RSP also charges a 0.2% yearly fee, which accounts for a small part of the gap.)")
        print("    Members that joined less than 13 months after their first price can't be ranked yet; this is by design.")

    print("\n  Strongest momentum at the latest month-end (what the rule would hold, not a recommendation):")
    for ticker, score in latest.items():
        print(f"    {ticker:6} {score:+.0%}")


def chart(curve, path):
    path.parent.mkdir(exist_ok=True)
    fig, ax = plt.subplots(figsize=(9, 5))
    ax.plot(curve.index, curve["Momentum"], color="#2a78d6", linewidth=1.8, label="Momentum")
    ax.plot(curve.index, curve["SPY"], color="#eb6834", linewidth=1.8, label="SPY")
    ax.plot(curve.index, curve["Equal weight"], color="#76808b", linewidth=1.2, label="Equal weight, priced members")
    ax.plot(curve.index, curve["RSP"], color="#76808b", linewidth=1.2, linestyle="--", label="RSP (real equal-weight fund)")
    ax.set_yscale("log")
    ax.set_title(r"Value of \$1, log scale")
    ax.grid(alpha=0.3)
    ax.legend()
    plt.tight_layout()
    plt.savefig(path, dpi=120)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--universe", choices=["sp500", "fixed"], default="sp500", help="which stocks may be bought")
    parser.add_argument("--start", default="2012-01-01", help="first date of price history")
    parser.add_argument("--end", default=None, help="last date of price history (default: today)")
    parser.add_argument("--top", type=int, default=10, help="number of stocks held")
    parser.add_argument("--cost", type=float, default=0.001, help="cost per dollar traded, 0.001 = 0.1%%")
    parser.add_argument("--refresh", action="store_true", help="re-download membership and prices")
    args = parser.parse_args()

    membership = load_membership(args.refresh)
    if args.universe == "sp500":
        dates, sets = membership
        first = dates.searchsorted(np.datetime64(args.start), side="right") - 1
        tickers = set().union(*sets[max(first, 0):])
        universe = lambda d: members_on(membership, d)
    else:
        tickers = set(FIXED)
        universe = lambda d: set(FIXED)

    prices = load_prices(sorted(tickers | set(BENCHMARKS)), args.start, None, args.refresh)
    if args.end:
        prices = prices.loc[: args.end]
    if prices.empty or prices["SPY"].dropna().empty:
        raise SystemExit("No prices downloaded. Check your internet connection and try again with --refresh.")
    missing = sorted(t for t in tickers if t not in prices.columns or prices[t].dropna().empty)

    monthly = prices.resample("ME").last()
    curve, coverage, latest = backtest(monthly, universe, args.top, args.cost)
    report(curve, coverage, latest, args, missing)
    path = RESULTS / f"momentum_{args.universe}.png"
    chart(curve, path)
    print(f"\n  Chart saved to {path}\n")


if __name__ == "__main__":
    main()
