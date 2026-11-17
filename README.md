# Dip-Buyer — cbBTC race bot

[![bounty](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/keyxdrop/btc-race-24h-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/keyxdrop/btc-race-24h-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)

Entry for the make.fun bounty [btc-race-24h-20261117-0603](https://make.fun/bounty/btc-race-24h-20261117-0603):
a bot that trades Coinbase Wrapped BTC (cbBTC) on 1-minute bars with
$1,000 of paper money in the `bars-replay/v1` harness.

## Strategy

Mean reversion, deliberately boring:

- Track 60-bar and 240-bar EMAs of the close and stay flat.
- Buy with 80% of cash only in an uptrend (fast EMA above slow EMA)
  when the close has dipped at least 0.60% under the fast EMA and has
  stopped falling — a move comfortably larger than the round-trip cost
  (4 bps fee + 2 bps slippage + pool impact on each side).
- Exit the whole position on the first of: +0.90% take-profit over the
  entry, −1.00% hard stop-loss, or 420 bars held. Then cool down for
  30 bars before the next entry.

Dev-window result with the kit's own grader: net PnL +$4.43 on
2 trades, max drawdown 0.46%.

Long flat stretches mean few trades, which is also the race's
tie-break. `main.ts` is Node standard library only, deterministic:
no clock, no network, no randomness.

## Run

The harness drives the bot over newline-delimited JSON
(`agent-fun/bars-replay/v1`): `node main.ts` reads `hello` / `batch`
/ `done` messages on stdin and answers one reply line per batch on
stdout.
