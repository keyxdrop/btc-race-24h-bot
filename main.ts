// Dip-buyer: a mean-reversion bot for cbBTC on 1-minute bars.
//
// Strategy in one paragraph: stay flat, watch 60-bar and 240-bar EMAs
// of the close. In an uptrend, when the close dips at least 0.60%
// under the fast EMA and stops falling, the last sellers have overdone
// it, so buy with most of the cash. Leave on a +0.90% take-profit, a
// -1.00% hard stop, or after 420 bars. Long flat stretches keep the
// trade count low, which is the race's tie-break.
//
// Wire protocol (agent-fun/bars-replay/v1): newline-delimited JSON on
// stdin (hello, then one batch per minute, then done); exactly one
// reply line per batch on stdout. Orders decided on a batch fill at
// the next bar's open with a 4 bps fee, 2 bps slippage and pool price
// impact, so the bot only trades moves comfortably larger than that
// round-trip cost. Node standard library only, no clock, no network,
// no randomness: the same bars always produce the same orders.

import * as readline from "node:readline";

const SYMBOL = "CBBTC";

// Strategy constants (fractions of price; minutes are bar counts).
const EMA_SPAN = 60;          // one hour of 1-minute bars
const SLOW_SPAN = 240;        // four-hour trend EMA
const DIP = 0.0060;           // buy when close <= fast EMA * (1 - DIP)
const TAKE_PROFIT = 0.0090;   // sell when close >= entry * (1 + TP)
const STOP_LOSS = 0.0100;     // hard stop under the entry
const MAX_HOLD = 420;         // sell after this many bars regardless
const SPEND_FRACTION = 0.8;   // share of cash spent on an entry
const COOLDOWN = 30;          // flat bars to wait after an exit
const SLIPPAGE_BPS = 300;     // generous cap so orders are not refused

class DipBuyer {
  ema: number | null = null;
  emaSlow: number | null = null;
  prevClose: number | null = null;
  barsSeen = 0;
  entryPrice: number | null = null; // close at the buy decision bar
  entryBar = -1;
  cooldownUntil = -1;
  orderSeq = 0;

  clientId(): string {
    this.orderSeq += 1;
    return "dip-" + this.orderSeq;
  }

  decide(close: number, cashUnits: number, heldQty: number): any[] {
    this.barsSeen += 1;
    if (this.ema === null || this.emaSlow === null) {
      this.ema = close;
      this.emaSlow = close;
    } else {
      this.ema += (2 / (EMA_SPAN + 1)) * (close - this.ema);
      this.emaSlow += (2 / (SLOW_SPAN + 1)) * (close - this.emaSlow);
    }
    const orders = this.decideInner(close, cashUnits, heldQty);
    this.prevClose = close;
    return orders;
  }

  decideInner(close: number, cashUnits: number, heldQty: number): any[] {
    if (heldQty > 0) return this.exitOrders(close, heldQty);
    if (this.entryPrice !== null) return []; // buy sent; fill lands next open
    return this.entryOrders(close, cashUnits);
  }

  entryOrders(close: number, cashUnits: number): any[] {
    if (this.barsSeen < SLOW_SPAN) return [];
    if (this.barsSeen <= this.cooldownUntil) return [];
    if (this.ema === null || this.emaSlow === null) return [];
    if (this.ema <= this.emaSlow) return [];      // only buy dips in an uptrend
    if (close > this.ema * (1 - DIP)) return [];  // not dipped enough
    if (this.prevClose !== null && close < this.prevClose) return []; // still falling
    const spend = Math.floor(cashUnits * SPEND_FRACTION);
    if (spend <= 0) return [];
    this.entryPrice = close;
    this.entryBar = this.barsSeen;
    return [{
      side: "buy",
      client_id: this.clientId(),
      symbol: SYMBOL,
      notional_quote_units: String(spend),
      max_slippage_bps: SLIPPAGE_BPS,
    }];
  }

  exitOrders(close: number, heldQty: number): any[] {
    if (this.entryPrice === null || this.ema === null) {
      // Position without a recorded entry (should not happen): anchor
      // on the EMA so the exit rules still apply.
      this.entryPrice = this.ema === null ? close : this.ema;
      this.entryBar = this.barsSeen;
    }
    const heldFor = this.barsSeen - this.entryBar;
    const hit =
      close >= this.entryPrice * (1 + TAKE_PROFIT) ||
      close <= this.entryPrice * (1 - STOP_LOSS) ||
      heldFor >= MAX_HOLD;
    if (!hit) return [];
    this.entryPrice = null;
    this.cooldownUntil = this.barsSeen + COOLDOWN;
    return [{
      side: "sell",
      client_id: this.clientId(),
      symbol: SYMBOL,
      qty: String(heldQty),
      max_slippage_bps: SLIPPAGE_BPS,
    }];
  }
}

function main(): void {
  const bot = new DipBuyer();
  let priceScale = 5;
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    const msg = JSON.parse(line);
    if (msg.type === "hello") {
      for (const sym of msg.symbols) {
        if (sym.symbol === SYMBOL) priceScale = sym.price_scale;
      }
      return;
    }
    if (msg.type === "done") {
      rl.close();
      return;
    }
    if (msg.type !== "batch") return;

    const cashUnits = Number(msg.account.cash_quote_units);
    let heldQty = 0;
    for (const pos of msg.account.positions) {
      if (pos.symbol === SYMBOL) heldQty = Number(pos.qty);
    }
    if (heldQty === 0 && bot.entryPrice !== null && bot.barsSeen - bot.entryBar > 2) {
      bot.entryPrice = null; // stale anchor: the buy never filled
    }
    let close: number | null = null;
    for (const bar of msg.bars) {
      if (bar.symbol === SYMBOL) close = Number(bar.c) / 10 ** priceScale;
    }
    const orders = close === null ? [] : bot.decide(close, cashUnits, heldQty);
    process.stdout.write(JSON.stringify({ type: "reply", seq: msg.seq, orders }) + "\n");
  });
}

main();
