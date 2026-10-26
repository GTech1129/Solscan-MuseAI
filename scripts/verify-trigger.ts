/**
 * scripts/verify-trigger.ts — backtest the CANONICAL trigger
 * (src/engine/trigger.ts, the same function the live dashboard uses)
 * on REAL Binance SOLUSDT klines across three market regimes:
 *   slow-bull  — slow upward drift (the user's "low vol" bull case)
 *   chop       — range-bound, low ADX (traded at reduced size)
 *   bear       — temporary downtrend (penny-wide moves + designed shorts)
 *
 * Data: Binance Vision public klines endpoint (no API key):
 *   https://data-api.binance.vision/api/v3/klines
 * 15m bars drive the trigger; 5m bars drive REAL 2-bar confirmation
 * (not the backtest's 15m proxy); 1h bars (aggregated from 15m) drive
 * calcHTFSignal. If the network fetch fails, the script falls back to
 * a deterministic SYNTHETIC series and labels every line SYNTHETIC —
 * never silently presenting synthetic data as real.
 *
 * Trade simulation (documented simplifications vs the full keeper):
 *   entry = signal-bar close -/+ trigger entryOffset; fill requires
 *   the NEXT bar to reach the entry (else the order expires).
 *   TP1 banks 30% at tp1Dist; the 70% runner trails a 1.2x ATR
 *   chandelier behind the favorable extreme, floored at entry +/- 0.10
 *   once TP1 is banked. EARLY-BANK (from the live keeper): at >=70%
 *   progress to TP1, bank 30% at the 70% level and floor the runner
 *   at entry +/- 0.10 — slow-drift trades that reach 70% of TP1 then
 *   pull back are small wins/breakevens in the real keeper, not
 *   stagnation losses. SL = ATR x slCoeff clamped by the tier dollar
 *   risk cap (same formula as the live server). Stagnation: chop
 *   2 bars / $0.10 adverse, standard 3 bars / 0.30x ATR adverse.
 *   Fee: 0.0008 x notional per fill event. Cooldown: 3 bars after a
 *   trade closes (mirrors backtest.ts). Fisher-flip exits are NOT
 *   simulated here (they are in backtest.ts); this script verifies
 *   the trigger, not full keeper parity.
 * Set TRACE=1 to print per-trade entry/TP1/SL/ATR/exit lines.
 *
 * Run:  npx tsx scripts/verify-trigger.ts
 * Output: per-regime signals, trades, win rate, avg win/loss,
 * max drawdown, UNKNOWN-bar counts, long/short split. All numbers
 * are computed from the fetched bars — nothing is hardcoded.
 */

import {
  calcCCI,
  calcFisher,
  calcATR,
  calcVWMA,
  calcTenkan,
  calcADX,
  calcHTFSignal,
  isBullishCandle,
  isBearishCandle,
} from '../src/engine/indicators.ts';
import { evaluateTrigger } from '../src/engine/trigger.ts';
import { getCanonicalTierForBalance } from '../src/engine/tiers.ts';

type Bar = { open: number; high: number; low: number; close: number; vol: number; openTime: number; closeTime: number };

const SYMBOL = 'SOLUSDT';
const VISION = 'https://data-api.binance.vision/api/v3/klines';
const WINDOW = 192; // 48h of 15m bars per regime stretch
const START_BALANCE = 250; // T3: exercises the $100 margin tier

async function fetchKlines(interval: string, limit: number, endTime?: number): Promise<Bar[]> {
  const out: Bar[] = [];
  let cursor = endTime;
  while (out.length < limit) {
    const batch = Math.min(1000, limit - out.length);
    const url = new URL(VISION);
    url.searchParams.set('symbol', SYMBOL);
    url.searchParams.set('interval', interval);
    url.searchParams.set('limit', String(batch));
    if (cursor !== undefined) url.searchParams.set('endTime', String(cursor));
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Binance Vision ${res.status} for ${interval}`);
    const rows = (await res.json()) as unknown[][];
    if (rows.length === 0) break;
    const bars = rows.map((r) => ({
      openTime: Number(r[0]),
      open: parseFloat(r[1] as string),
      high: parseFloat(r[2] as string),
      low: parseFloat(r[3] as string),
      close: parseFloat(r[4] as string),
      vol: parseFloat(r[5] as string),
      closeTime: Number(r[6]),
    }));
    out.unshift(...bars);
    cursor = bars[0].openTime - 1;
    if (rows.length < batch) break;
  }
  return out;
}

// Deterministic synthetic fallback (seeded PRNG). Used ONLY when the
// network fetch fails; every report line is then labeled SYNTHETIC.
function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function synthSeries(): { bars15: Bar[]; bars5: Bar[] } {
  const rnd = mulberry(20261025);
  const bars15: Bar[] = [];
  const bars5: Bar[] = [];
  let price = 100;
  let t = Date.now() - 30 * 24 * 3600 * 1000;
  const driftFor = (i: number) => {
    // Three regimes across 30 days: slow-bull, chop, bear, repeated.
    const day = Math.floor(i / 96);
    if (day % 3 === 0) return 0.0004; // slow-bull: +~3.8%/day drift
    if (day % 3 === 1) return 0; // chop
    return -0.0004; // bear
  };
  for (let i = 0; i < 2880; i++) {
    const drift = driftFor(i);
    const open = price;
    const ret = drift + (rnd() - 0.5) * 0.004;
    const close = open * (1 + ret);
    const high = Math.max(open, close) * (1 + rnd() * 0.001);
    const low = Math.min(open, close) * (1 - rnd() * 0.001);
    bars15.push({ open, high, low, close, vol: 15000 + rnd() * 30000, openTime: t, closeTime: t + 15 * 60 * 1000 - 1 });
    for (let j = 0; j < 3; j++) {
      const f = (j + 1) / 3;
      const c5 = open + (close - open) * f;
      bars5.push({ open: c5, high: c5 * 1.0005, low: c5 * 0.9995, close: c5, vol: 8000, openTime: t + j * 5 * 60 * 1000, closeTime: t + (j + 1) * 5 * 60 * 1000 - 1 });
    }
    price = close;
    t += 15 * 60 * 1000;
  }
  return { bars15, bars5 };
}

function aggregate1h(bars15: Bar[]): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i + 3 < bars15.length; i += 4) {
    const g = bars15.slice(i, i + 4);
    out.push({
      open: g[0].open,
      high: Math.max(...g.map((b) => b.high)),
      low: Math.min(...g.map((b) => b.low)),
      close: g[3].close,
      vol: g.reduce((s, b) => s + b.vol, 0),
      openTime: g[0].openTime,
      closeTime: g[3].closeTime,
    });
  }
  return out;
}

function pickWindows(bars15: Bar[]): { slowBull: number; chop: number; bear: number } {
  // Score every 48h window; pick the best non-overlapping example of each class.
  type Cand = { start: number; ret: number; adxAvg: number; volAvg: number; maxDd: number; score: number };
  const closes = bars15.map((b) => b.close);
  const highs = bars15.map((b) => b.high);
  const lows = bars15.map((b) => b.low);
  const adxAll = calcADX(highs, lows, closes, 14);
  const cands: Cand[] = [];
  for (let s = 60; s + WINDOW <= bars15.length; s += 24) {
    const seg = bars15.slice(s, s + WINDOW);
    const ret = seg[seg.length - 1].close / seg[0].close - 1;
    const adxSeg = adxAll.slice(s, s + WINDOW).filter((v): v is number => v != null);
    const adxAvg = adxSeg.length ? adxSeg.reduce((a, b) => a + b, 0) / adxSeg.length : 30;
    let peak = seg[0].close; let maxDd = 0;
    for (const b of seg) { peak = Math.max(peak, b.close); maxDd = Math.max(maxDd, (peak - b.close) / peak); }
    cands.push({ start: s, ret, adxAvg, volAvg: seg.reduce((a, b) => a + b.vol, 0) / seg.length, maxDd, score: 0 });
  }
  const overlap = (a: Cand, b: Cand) => Math.abs(a.start - b.start) < WINDOW;
  const slowBull = cands
    .filter((c) => c.ret > 0.012 && c.ret < 0.045 && c.maxDd < 0.04)
    .sort((a, b) => Math.abs(a.ret - 0.025) - Math.abs(b.ret - 0.025))[0];
  const chop = cands
    .filter((c) => Math.abs(c.ret) < 0.008 && c.adxAvg < 22 && (!slowBull || !overlap(c, slowBull)))
    .sort((a, b) => a.adxAvg - b.adxAvg)[0];
  const bear = cands
    .filter((c) => c.ret < -0.012 && c.ret > -0.045 && c.maxDd < 0.06 && (!slowBull || !overlap(c, slowBull)) && (!chop || !overlap(c, chop)))
    .sort((a, b) => Math.abs(a.ret - 0.025) - Math.abs(b.ret - 0.025))[0];
  if (!slowBull || !chop || !bear) throw new Error('Could not find one window per regime class in the fetched data.');
  return { slowBull: slowBull.start, chop: chop.start, bear: bear.start };
}

type TradeRec = { side: 'long' | 'short'; pnl: number; win: boolean; regime: string; exitReason: string };

function runWindow(
  bars15: Bar[], bars5: Bar[], bars1h: Bar[], start: number,
): { signals: number; trades: TradeRec[]; unknownBars: number; longSignals: number; shortSignals: number; regimeMix: Record<string, number>; net: number; winRate: number; avgWin: number; avgLoss: number; maxDd: number; startTime: string; endTime: string } {
  const seg = bars15.slice(start, start + WINDOW);
  const closes = bars15.map((b) => b.close);
  const highs = bars15.map((b) => b.high);
  const lows = bars15.map((b) => b.low);
  const opens = bars15.map((b) => b.open);
  const vols = bars15.map((b) => b.vol);
  const cci = calcCCI(highs, lows, closes, 20);
  const fish = calcFisher(highs, lows, 9);
  const atrArr = calcATR(highs, lows, closes, 14);
  const vwmaArr = calcVWMA(closes, vols, 20);
  const tenk = calcTenkan(highs, lows, 9);
  const adxArr = calcADX(highs, lows, closes, 14);

  // 1h HTF per 15m bar: use completed 1h bars only (calcHTFSignal
  // drops the last element itself, so pass through the current hour).
  const htfAt = (i15: number): 'green' | 'yellow' | 'red' => {
    const hIdx = Math.floor(i15 / 4);
    const h = bars1h.slice(0, hIdx + 1);
    return calcHTFSignal(h.map((b) => b.high), h.map((b) => b.low), h.map((b) => b.close), h.map((b) => b.vol));
  };

  // 5m confirmation: trailing closed 5m bars before this 15m close.
  const confirm5m = (closeTime: number): { green: number; red: number; ok: boolean } => {
    const closed = bars5.filter((b) => b.closeTime <= closeTime).slice(-4);
    const recent = closed.slice(-2);
    const ok = recent.length >= 2;
    let green = 0; let red = 0;
    for (const b of recent) {
      // Doji counts as green (live-view convention).
      if (b.close >= b.open) green++; else red++;
    }
    // Trailing-run counts (not just last-2 window): walk back while same sign.
    const run = (dir: 'g' | 'r') => {
      let n = 0;
      for (let k = closed.length - 1; k >= 0; k--) {
        const isG = closed[k].close >= closed[k].open;
        if ((dir === 'g') !== isG) break;
        n++;
      }
      return n;
    };
    return { green: run('g'), red: run('r'), ok };
  };

  let balance = START_BALANCE;
  let peak = balance;
  let maxDd = 0;
  let signals = 0; let longSignals = 0; let shortSignals = 0; let unknownBars = 0;
  const regimeMix: Record<string, number> = {};
  const trades: TradeRec[] = [];
  let cooldown = 0;

  for (let k = 60; k < seg.length - 2; k++) {
    const i = start + k;
    const cciCur = cci[i]; const cciPrev = cci[i - 1];
    const fishCur = fish[i]; const fishPrev = fish[i - 1];
    const atr = atrArr[i]; const vwma = vwmaArr[i]; const adx = adxArr[i];
    if (atr == null || adx == null) continue;
    const tenkCur = tenk[i]; const tenk1 = tenk[i - 1]; const tenk2 = tenk[i - 2];
    const conf = confirm5m(bars15[i].closeTime);
    const trig = evaluateTrigger({
      price: bars15[i].close,
      vwma,
      atr,
      adx,
      prevAdx: adxArr[i - 1] ?? null,
      htfSignal: htfAt(i),
      cciUp: cciCur != null && cciPrev != null && cciCur > cciPrev,
      fishUp: fishCur != null && fishPrev != null && fishCur > fishPrev,
      bullishCandle: isBullishCandle(opens.slice(0, i + 1), closes.slice(0, i + 1), highs.slice(0, i + 1), lows.slice(0, i + 1)),
      tenkRising2Candles: tenkCur != null && tenk1 != null && tenk2 != null && tenkCur > tenk1 && tenk1 > tenk2,
      volumeGateMet: bars15[i].vol >= 25000,
      cciDown: cciCur != null && cciPrev != null && cciCur < cciPrev,
      fishDown: fishCur != null && fishPrev != null && fishCur < fishPrev,
      bearishCandle: isBearishCandle(opens.slice(0, i + 1), closes.slice(0, i + 1), highs.slice(0, i + 1), lows.slice(0, i + 1)),
      tenkFalling2Candles: tenkCur != null && tenk1 != null && tenk2 != null && tenkCur < tenk1 && tenk1 < tenk2,
      consecutiveGreen5m: conf.green,
      consecutiveRed5m: conf.red,
      fiveMinFeedOk: conf.ok,
      balance,
      candleHigh: bars15[i].high,
      candleLow: bars15[i].low,
      candleClose: bars15[i].close,
    });
    if (trig.state === 'UNKNOWN') { unknownBars++; continue; }
    if (trig.state === 'NONE') continue;
    if (cooldown > 0) { cooldown--; continue; }
    signals++;
    if (trig.state === 'LONG') longSignals++; else shortSignals++;
    regimeMix[trig.regime] = (regimeMix[trig.regime] ?? 0) + 1;

    // --- simulate one trade ---
    const dir = trig.state === 'LONG' ? 1 : -1;
    const entry = bars15[i].close - dir * trig.entryOffset;
    const tier = getCanonicalTierForBalance(balance);
    // Server boost rule, exactly as live: +10x only on BULL or GRADE_A.
    const lev = Math.min(60, tier.leverage + (trig.regime === 'BULL_TREND_DRIFT' || trig.setupGrade === 'GRADE_A' ? 10 : 0));
    const notional = trig.margin * lev;
    const tokens = notional / entry;
    const feePerFill = notional * 0.0008;
    // SL clamped by the tier dollar risk cap (same formula as the server).
    const cap = Math.max(0.25, Math.min(balance * tier.riskCapPct, tier.maxRiskDollarCap));
    const slDist = Math.min(atr * trig.slCoeff, Math.max(0.01, (cap - feePerFill) / tokens));
    const sl = entry - dir * slDist;
    const tp1 = entry + dir * trig.tp1Dist;
    const isChop = trig.isChop;

    // Fill on the next bar, else expire.
    const fillBar = bars15[i + 1];
    const filled = dir === 1 ? fillBar.low <= entry : fillBar.high >= entry;
    if (!filled) { cooldown = 3; continue; }

    let banked = false;
    let bankPrice = entry;
    let fav = entry;
    let barsHeld = 0;
    let exitPrice: number | null = null;
    let exitReason = 'open';
    for (let j = i + 1; j < Math.min(i + 40, start + WINDOW); j++) {
      const b = bars15[j];
      barsHeld++;
      fav = dir === 1 ? Math.max(fav, b.high) : Math.min(fav, b.low);
      // Stagnation = price SETTLED adverse (close-based), not a wick:
      // measuring off the bar extreme exits nearly every trade at bar
      // 3, since a normal 15m bar routinely wicks 0.30x ATR against
      // entry. (First version of this script used the extreme and
      // produced 0% win rates via stagnation alone — a harness bug,
      // not a trigger verdict. See PHASE2_NOTES.md.)
      const adverse = dir === 1 ? entry - b.close : b.close - entry;
      if (!banked && (dir === 1 ? b.high >= tp1 : b.low <= tp1)) {
        banked = true;
        bankPrice = tp1;
      }
      // Early-bank: >=70% progress to TP1 banks 30% at the 70% level
      // and floors the runner at entry +/- 0.10 (live keeper rule).
      if (!banked && (dir === 1 ? b.high >= entry + dir * 0.7 * trig.tp1Dist : b.low <= entry + dir * 0.7 * trig.tp1Dist)) {
        banked = true;
        bankPrice = entry + dir * 0.7 * trig.tp1Dist;
      }
      if (dir === 1 ? b.low <= sl : b.high >= sl) { exitPrice = sl; exitReason = 'SL'; break; }
      if (banked) {
        const trail = fav - dir * 1.2 * atr;
        const floor = entry + dir * 0.1;
        const stop = dir === 1 ? Math.max(trail, floor) : Math.min(trail, floor);
        if (dir === 1 ? b.low <= stop : b.high >= stop) { exitPrice = stop; exitReason = 'Chandelier Trail'; break; }
      }
      const stagBars = isChop ? 2 : 3;
      const stagDist = isChop ? 0.1 : 0.3 * atr;
      if (barsHeld >= stagBars && adverse > stagDist && !banked) { exitPrice = b.close; exitReason = isChop ? 'Chop Fast Exit' : 'Stagnation'; break; }
    }
    if (exitPrice == null) { exitPrice = bars15[Math.min(i + 40, start + WINDOW - 1)].close; exitReason = 'TTL Close'; }
    // Fees: 0.0008 x notional per fill event. Banked: entry (1.0) +
    // bank fill (0.3) + runner fill (0.7) = 2.0 x feePerFill. Unbanked:
    // entry + full exit = 2.0 x feePerFill. Unbanked exits 100% of
    // tokens (not 70% — the runner split only applies after a bank).
    const pnl = banked
      ? 0.3 * tokens * dir * (bankPrice - entry) + 0.7 * tokens * dir * (exitPrice - entry) - 2 * feePerFill
      : tokens * dir * (exitPrice - entry) - 2 * feePerFill;
    balance += pnl;
    peak = Math.max(peak, balance);
    maxDd = Math.max(maxDd, (peak - balance) / peak);
    trades.push({ side: trig.state === 'LONG' ? 'long' : 'short', pnl, win: pnl > 0, regime: trig.regime, exitReason });
    if (process.env.TRACE === '1') {
      console.log(`    TRACE ${trig.state} entry ${entry.toFixed(2)} tp1 ${tp1.toFixed(2)} sl ${sl.toFixed(2)} atr ${atr.toFixed(2)} exit ${exitPrice.toFixed(2)} (${exitReason}) banked=${banked} pnl $${pnl.toFixed(2)}`);
    }
    cooldown = 3;
  }

  const wins = trades.filter((t) => t.win);
  const losses = trades.filter((t) => !t.win);
  const net = trades.reduce((s, t) => s + t.pnl, 0);
  return {
    signals, trades, unknownBars, longSignals, shortSignals, regimeMix,
    net,
    winRate: trades.length ? wins.length / trades.length : 0,
    avgWin: wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0,
    avgLoss: losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0,
    maxDd,
    startTime: new Date(seg[0].openTime).toISOString(),
    endTime: new Date(seg[seg.length - 1].closeTime).toISOString(),
  };
}

async function main() {
  let bars15: Bar[]; let bars5: Bar[]; let synthetic = false;
  try {
    bars15 = await fetchKlines('15m', 2880);
    const end = bars15[bars15.length - 1].closeTime;
    bars5 = await fetchKlines('5m', 8640, end);
    // Align 5m to the 15m window (drop 5m bars after the last 15m close).
    bars5 = bars5.filter((b) => b.closeTime <= end);
    if (bars15.length < 500 || bars5.length < 1000) throw new Error('Too few klines returned.');
  } catch (e) {
    console.log(`REAL FETCH FAILED (${(e as Error).message}). Falling back to SYNTHETIC data — results below are NOT real-market evidence.`);
    synthetic = true;
    const s = synthSeries();
    bars15 = s.bars15; bars5 = s.bars5;
  }
  const bars1h = aggregate1h(bars15);
  const tag = synthetic ? ' [SYNTHETIC]' : ' [REAL Binance klines]';
  console.log(`\n=== Canonical-trigger verification${tag} ===`);
  console.log(`15m bars: ${bars15.length} (${new Date(bars15[0].openTime).toISOString()} .. ${new Date(bars15[bars15.length - 1].closeTime).toISOString()})`);
  console.log(`5m bars: ${bars5.length} | 1h bars: ${bars1h.length} | start balance: $${START_BALANCE} | fee: 0.0008 x notional per fill`);
  console.log('Leverage uses the live server boost rule (+10x only on BULL regime or GRADE_A). TP1 30% / runner 70%.\n');

  const wins = pickWindows(bars15);
  for (const [label, start] of [['slow-bull', wins.slowBull], ['chop', wins.chop], ['bear', wins.bear]] as const) {
    const r = runWindow(bars15, bars5, bars1h, start);
    console.log(`--- ${label.toUpperCase()} window (${r.startTime} .. ${r.endTime}) ---`);
    console.log(`  bars evaluated: ${WINDOW} | signals: ${r.signals} (long ${r.longSignals} / short ${r.shortSignals}) | UNKNOWN bars: ${r.unknownBars}`);
    console.log(`  trigger-regime mix: ${JSON.stringify(r.regimeMix)}`);
    console.log(`  trades: ${r.trades.length} | win rate: ${(r.winRate * 100).toFixed(1)}% | avg win: $${r.avgWin.toFixed(2)} | avg loss: $${r.avgLoss.toFixed(2)} | net: $${r.net.toFixed(2)} | max drawdown: ${(r.maxDd * 100).toFixed(2)}%`);
    const exits: Record<string, number> = {};
    for (const t of r.trades) exits[t.exitReason] = (exits[t.exitReason] ?? 0) + 1;
    console.log(`  exits: ${JSON.stringify(exits)}`);
  }
}

main().catch((e) => { console.error('verify-trigger failed:', e); process.exit(1); });
