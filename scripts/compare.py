"""Compare what your trades are worth against putting the same money in SPY.

Every dollar you spent on a stock is also spent on SPY that same day, in a
"shadow portfolio". Same money, same dates. Whichever is worth more today won.

    .venv/bin/python scripts/compare.py
    .venv/bin/python scripts/compare.py --trades data/trades.csv
    .venv/bin/python scripts/compare.py --selftest     # no network, checks the math

trades.csv looks like:

    date,ticker,dollars
    2025-01-15,AAPL,500
    2025-03-02,MSFT,250
"""
import argparse
import pathlib
import sys

import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
BENCHMARK = "SPY"


def read_trades(path):
    """Load trades.csv and fail loudly if it's malformed."""
    if not path.exists():
        sys.exit(f"No trades file at {path}\nMake one with: date,ticker,dollars")
    df = pd.read_csv(path)
    missing = {"date", "ticker", "dollars"} - set(df.columns)
    if missing:
        sys.exit(f"{path} is missing column(s): {', '.join(sorted(missing))}")
    df["date"] = pd.to_datetime(df["date"])
    df["ticker"] = df["ticker"].str.strip().str.upper()
    df["dollars"] = pd.to_numeric(df["dollars"])
    if (df["dollars"] <= 0).any():
        sys.exit("Every trade needs a positive dollar amount (buys only).")
    return df.sort_values("date").reset_index(drop=True)


def fetch_closes(tickers, start):
    """Daily closing prices as a plain DataFrame: one column per ticker.

    yfinance returns a different shape for one ticker vs many (a MultiIndex
    on the columns), so normalise it here rather than everywhere downstream.
    """
    import yfinance as yf

    raw = yf.download(
        sorted(set(tickers)), start=start, auto_adjust=True, progress=False
    )
    if raw.empty:
        sys.exit("Yahoo returned no data. Check the tickers and your connection.")
    close = raw["Close"]
    if isinstance(close, pd.Series):          # single ticker
        close = close.to_frame(name=sorted(set(tickers))[0])
    return close.dropna(how="all")


def price_on(closes, ticker, date):
    """Close for `ticker` on `date`, rolling forward if the market was shut.

    A trade dated on a weekend or holiday is treated as happening the next
    trading day, which is what would really have happened.
    """
    if ticker not in closes.columns:
        sys.exit(f"No price history for {ticker}.")
    series = closes[ticker].dropna()
    later = series.loc[series.index >= date]
    if later.empty:
        sys.exit(f"No {ticker} price on or after {date.date()}.")
    return float(later.iloc[0]), later.index[0]


def compute(trades, closes):
    """Walk every trading day, valuing the real portfolio and the SPY shadow."""
    shares = {}        # ticker -> shares held
    spy_shares = 0.0
    invested = 0.0
    rows = []
    buys = trades.to_dict("records")
    i = 0

    for day in closes.index:
        # Apply every trade that lands on or before today and isn't applied yet.
        while i < len(buys) and buys[i]["date"] <= day:
            t = buys[i]
            px, filled = price_on(closes, t["ticker"], t["date"])
            if filled > day:       # rolled forward past today; wait for that day
                break
            shares[t["ticker"]] = shares.get(t["ticker"], 0.0) + t["dollars"] / px
            spy_px, _ = price_on(closes, BENCHMARK, t["date"])
            spy_shares += t["dollars"] / spy_px
            invested += t["dollars"]
            i += 1

        if invested == 0:
            continue
        value = sum(n * closes.at[day, tk] for tk, n in shares.items()
                    if pd.notna(closes.at[day, tk]))
        rows.append({
            "date": day,
            "invested": invested,
            "portfolio": value,
            "shadow_spy": spy_shares * closes.at[day, BENCHMARK],
        })

    if not rows:
        sys.exit("No trading days after your first trade yet.")
    return pd.DataFrame(rows).set_index("date"), shares


def report(history, shares, trades, closes):
    last = history.iloc[-1]
    gap = last["portfolio"] - last["shadow_spy"]
    print(f"\nAs of {history.index[-1].date()}\n")
    print(f"  Invested        ${last['invested']:>12,.2f}")
    print(f"  Your picks      ${last['portfolio']:>12,.2f}"
          f"   ({last['portfolio'] / last['invested'] - 1:+.1%})")
    print(f"  Same money, SPY ${last['shadow_spy']:>12,.2f}"
          f"   ({last['shadow_spy'] / last['invested'] - 1:+.1%})")
    print(f"\n  {'You beat SPY by' if gap >= 0 else 'SPY beat you by'} "
          f"${abs(gap):,.2f} ({abs(gap) / last['shadow_spy']:.1%})\n")

    print("  Per stock:")
    for tk in sorted(shares):
        spent = float(trades.loc[trades["ticker"] == tk, "dollars"].sum())
        now = shares[tk] * closes[tk].dropna().iloc[-1]
        print(f"    {tk:<6} spent ${spent:>9,.2f}  ->  ${now:>9,.2f}"
              f"  ({now / spent - 1:+.1%})")
    print()


def chart(history, out):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(10, 5.5))
    ax.plot(history.index, history["portfolio"], label="Your picks", lw=2)
    ax.plot(history.index, history["shadow_spy"], label="Same money in SPY", lw=2)
    ax.plot(history.index, history["invested"], label="Total invested",
            lw=1, ls="--", color="#888")
    ax.set_title("Your portfolio vs the same money in SPY")
    ax.set_ylabel("Value ($)")
    ax.legend()
    ax.grid(alpha=0.3)
    fig.tight_layout()
    out.parent.mkdir(exist_ok=True)
    fig.savefig(out, dpi=150)
    print(f"  Chart: {out}\n")


def selftest():
    """Check the math on prices we control, so a failure means a real bug."""
    days = pd.bdate_range("2025-01-01", periods=10)
    closes = pd.DataFrame(
        {"AAPL": [100.0] * 5 + [200.0] * 5,     # doubles halfway
         "SPY":  [50.0] * 10},                  # flat
        index=days)
    trades = pd.DataFrame([{"date": days[0], "ticker": "AAPL", "dollars": 1000.0}])

    history, shares = compute(trades, closes)
    last = history.iloc[-1]
    assert abs(shares["AAPL"] - 10.0) < 1e-9, shares        # $1000 / $100
    assert abs(last["portfolio"] - 2000.0) < 1e-9, last     # 10 shares * $200
    assert abs(last["shadow_spy"] - 1000.0) < 1e-9, last    # SPY never moved
    assert abs(last["invested"] - 1000.0) < 1e-9, last

    # A weekend trade should fill on Monday, not be dropped.
    sat = pd.Timestamp("2025-01-04")
    assert sat.weekday() == 5
    px, filled = price_on(closes, "AAPL", sat)
    assert filled == pd.Timestamp("2025-01-06"), filled
    print("selftest passed: math, weekend roll-forward")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--trades", type=pathlib.Path, default=ROOT / "data" / "trades.csv")
    p.add_argument("--out", type=pathlib.Path, default=ROOT / "results" / "vs_spy.png")
    p.add_argument("--selftest", action="store_true")
    args = p.parse_args()

    if args.selftest:
        return selftest()

    trades = read_trades(args.trades)
    closes = fetch_closes(list(trades["ticker"]) + [BENCHMARK], trades["date"].min())
    history, shares = compute(trades, closes)
    report(history, shares, trades, closes)
    chart(history, args.out)


if __name__ == "__main__":
    main()
