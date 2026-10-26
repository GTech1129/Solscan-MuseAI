import {
  BacktestResult,
  Candle,
  EquityPoint,
  ExitType,
  MonteCarloSummary,
  RegimeKey,
  SimulationConfig,
  Trade,
} from '../types.ts';
import { generateSolanaCandles } from './generator.ts';
import {
  calcADX,
  calcATR,
  calcCCI,
  calcFisher,
  calcHTFSignal,
  calcTenkan,
  calcVWMA,
  detectBullDiv,
  isBearishCandle,
  isBullishCandle,
} from './indicators.ts';
import { evaluateTrigger } from './trigger.ts';
import { getCanonicalTierForBalance } from './tiers.ts';
import { makePRNG } from './prng.ts';
import { ORDERED_REGIMES, REGIMES } from './regimes.ts';

export function runRegimeAligned(
  regimeName: Exclude<RegimeKey, 'COMBINED'>,
  nBars: number,
  startBalance: number,
  leverage: number,
  basePrice: number,
  compoundRate: number,
  rng: () => number,
  config?: Partial<SimulationConfig>,
): BacktestResult {
  // Phase 2 — CANONICAL TRIGGER BACKTEST. The old version had its own
  // inline trigger (no 5m gate, an extra 0.3% VWMA-proximity filter,
  // CHOP and FLASH sit-outs, a divergence bottom-buy mode, and three
  // sizing paths: LSD / manual / auto-switch). All of that is gone.
  // Direction, regime, margin, targets, stops, and offsets now come
  // from evaluateTrigger (src/engine/trigger.ts) — the SAME function
  // the live dashboard calls — so live and backtest cannot print
  // different answers on the same candles. What remains backtest-only
  // is the execution simulation (limit fill on the next bar, TP1
  // 30% bank + 70% runner, keeper-style exits) and the synthetic
  // candle generator that shapes each regime stretch.
  //
  // Legacy config fields, accepted for compatibility but IGNORED in
  // Phase 2 (sizing is canonical): leverage, compoundRate, tp1Dist,
  // slAtrMult, entryOffset, useDynamicOffset, flashCrashMode,
  // autoSwitchPresets. The ConfigPanel no longer edits them.
  void leverage;
  void compoundRate;

  const R = REGIMES[regimeName];
  const feeRate = config?.feeRate ?? 0.0008;
  const lsdThreshold = config?.lsdThreshold ?? 22.0;
  const minLockout = config?.minLockout ?? 10.0;

  const rawCandles = generateSolanaCandles(regimeName, nBars + 35, basePrice, rng);

  const opens = rawCandles.map((c) => c.open);
  const highs = rawCandles.map((c) => c.high);
  const lows = rawCandles.map((c) => c.low);
  const closes = rawCandles.map((c) => c.close);
  const volumes = rawCandles.map((c) => c.volume);

  const cci = calcCCI(highs, lows, closes, 20);
  const fisher = calcFisher(highs, lows, 9);
  const atr = calcATR(highs, lows, closes, 14);
  const adx = calcADX(highs, lows, closes, 14);
  const vwma = calcVWMA(closes, volumes, 20);
  const tenkan = calcTenkan(highs, lows, 9);

  // 1h aggregation for the HTF input (4 x 15m bars = 1 x 1h bar).
  // The trigger classifies FLASH/BULL from HTF + VWMA + ADX, so the
  // backtest must supply a real HTF series, not the generator's
  // regime name. Early bars (< 50 completed 1h bars) get 'yellow'
  // from calcHTFSignal's own fallback — same as the live view.
  const h1hH: number[] = [];
  const h1hL: number[] = [];
  const h1hC: number[] = [];
  const h1hV: number[] = [];
  for (let k = 0; k + 3 < rawCandles.length; k += 4) {
    h1hH.push(Math.max(highs[k], highs[k + 1], highs[k + 2], highs[k + 3]));
    h1hL.push(Math.min(lows[k], lows[k + 1], lows[k + 2], lows[k + 3]));
    h1hC.push(closes[k + 3]);
    h1hV.push(volumes[k] + volumes[k + 1] + volumes[k + 2] + volumes[k + 3]);
  }
  const htfAt = (i: number): 'green' | 'yellow' | 'red' => {
    const k = Math.floor(i / 4);
    if (k + 1 > h1hC.length) return 'yellow';
    // calcHTFSignal drops the last (forming) bar internally, so
    // passing bars 0..k evaluates completed 1h bars 0..k-1.
    return calcHTFSignal(
      h1hH.slice(0, k + 1),
      h1hL.slice(0, k + 1),
      h1hC.slice(0, k + 1),
      h1hV.slice(0, k + 1),
    );
  };

  // Attach indicators back onto candle items for visualization
  const candles: Candle[] = rawCandles.map((c, i) => ({
    ...c,
    cci: cci[i],
    fisher: fisher[i],
    atr: atr[i] ?? c.atr,
  }));

  let balance = startBalance;
  let peak = startBalance;
  let maxDD = 0;
  let cooldown = 0;
  let signals = 0;
  let evaluatedBars = 0;
  let totalFees = 0;
  const trades: Trade[] = [];

  // 2-Loss Chop Circuit Breaker Tracking: timestamps/bar indices of recent losses
  const recentLossBars: number[] = [];

  const equityCurve: EquityPoint[] = [
    {
      index: 0,
      tradeNum: 0,
      balance: startBalance,
      netPnL: 0,
      drawdownPct: 0,
      regime: R.label,
      isLSD: startBalance < lsdThreshold,
    },
  ];

  for (let i = 25; i < candles.length - 5; i++) {
    evaluatedBars++;
    if (cooldown > 0) {
      cooldown--;
    }

    const curATR = atr[i] || R.atrBase;
    const cciNow = cci[i];
    const cciPrev = cci[i - 1];
    const fishNow = fisher[i];
    const fishPrev = fisher[i - 1];

    if (
      cciNow == null ||
      cciPrev == null ||
      fishNow == null ||
      fishPrev == null
    ) {
      continue;
    }

    // 5m confirmation PROXY (fiveMinProxy=true): the synthetic series
    // has no 5m bars, so the trailing run of 15m bars in each
    // direction stands in. A 2-bar 15m run is a conservative proxy for
    // 2 confirmed 5m bars (a 15m green run contains green 5m bars).
    // The real-klines verification script uses real 5m bars instead.
    let greenRun = 0;
    let redRun = 0;
    for (let k = i; k >= 0; k--) {
      if (closes[k] >= opens[k]) {
        if (redRun === 0) greenRun++;
        else break;
      } else {
        if (greenRun === 0) redRun++;
        else break;
      }
    }

    // Volume confirmation proxy (grading only, never gating): last
    // 15m volume above its own 20-bar average, mirroring live volOK.
    const recentVols = volumes.slice(Math.max(0, i - 21), i);
    const avgVol = recentVols.length > 0
      ? recentVols.reduce((a, b) => a + b, 0) / recentVols.length
      : 1;
    const volOK = volumes[i] > avgVol;

    const tenkNow = tenkan[i];
    const tenkPrev = tenkan[i - 1];
    const tenkPrev2 = tenkan[i - 2];
    const tenkRising2Candles =
      tenkNow != null && tenkPrev != null && tenkPrev2 != null &&
      tenkNow > tenkPrev && tenkPrev > tenkPrev2;
    const tenkFalling2Candles =
      tenkNow != null && tenkPrev != null && tenkPrev2 != null &&
      tenkNow < tenkPrev && tenkPrev < tenkPrev2;

    const cciAccel =
      cci[i] != null && cci[i - 1] != null && cci[i - 2] != null &&
      (cci[i]! - cci[i - 1]!) > (cci[i - 1]! - cci[i - 2]!);

    // Candle checks use the live convention: the helpers read index
    // len-2, so the arrays are sliced to i+2 (bar i = last completed,
    // bar i+1 = the forming bar).
    const sl = (arr: number[]) => arr.slice(0, i + 2);
    const trig = evaluateTrigger({
      price: closes[i],
      vwma: vwma[i] ?? null,
      atr: curATR,
      adx: adx[i] ?? 30,
      prevAdx: adx[i - 1] ?? null,
      htfSignal: htfAt(i),
      cciUp: cciNow > cciPrev,
      fishUp: fishNow > fishPrev,
      bullishCandle: isBullishCandle(sl(opens), sl(closes), sl(highs), sl(lows)),
      tenkRising2Candles,
      volumeGateMet: volumes[i] >= 25000,
      cciDown: cciNow < cciPrev,
      fishDown: fishNow < fishPrev,
      bearishCandle: isBearishCandle(sl(opens), sl(closes), sl(highs), sl(lows)),
      tenkFalling2Candles,
      consecutiveGreen5m: greenRun,
      consecutiveRed5m: redRun,
      fiveMinFeedOk: true, // synthetic series is complete by construction
      fiveMinProxy: true,
      balance,
      candleHigh: highs[i],
      candleLow: lows[i],
      candleClose: closes[i],
      bullDiv: detectBullDiv(closes.slice(0, i + 1), cci.slice(0, i + 1)),
      bearDiv: false, // no bear-divergence detector exists; grading only
      cciAccel,
      volConfirmed: volOK,
    });

    // Canonical outcomes: LONG / SHORT trade; NONE (no hook, no
    // confirmation, conflict, flash sit-out) and UNKNOWN (feed
    // failure — impossible here, fiveMinFeedOk is always true) skip.
    // NOTE: the generator's regimeName no longer gates anything. A
    // MARKET_CHOP stretch is traded at reduced size when the trigger
    // classifies it as chop; a FLASH_CRASH stretch sits out only when
    // the trigger classifies it as a flash crash (ADX > 35 + HTF red
    // + price below VWMA). Trades are labeled by the trigger's regime.
    if (trig.state === 'NONE' || trig.state === 'UNKNOWN') continue;
    signals++;

    if (cooldown > 0) continue;

    const isShort = trig.state === 'SHORT';
    const side: 'Long' | 'Short' = isShort ? 'Short' : 'Long';

    // Canonical sizing. The live server adds +10x on BULL_TREND_DRIFT /
    // GRADE_A (max 60x); the backtest applies the same rule so its
    // leverage matches what live would actually use.
    const trigTier = getCanonicalTierForBalance(balance);
    const activeLev = Math.min(
      60,
      trig.leverage + ((trig.regime === 'BULL_TREND_DRIFT' || trig.setupGrade === 'GRADE_A') ? 10 : 0),
    );
    const margin = trig.margin;
    const tp1Dist = trig.tp1Dist;
    const tp2Dist = trig.tp2Dist;
    const curSlCoeff = trig.slCoeff;
    const tp1Ratio = 0.30;
    const tp2Ratio = 0.70;

    // isLSD is a DISPLAY flag only in Phase 2 (equity-curve badges);
    // it no longer changes leverage, TP1, SL, or margin.
    const isLSD = balance < lsdThreshold;

    // Safety lockout check
    if (balance < minLockout) {
      break; // Jupiter Perps physical lockout limit reached
    }

    // Defensive cap (trigger margin is already balance-aware).
    const cappedMargin = margin > balance ? balance : margin;

    const signalClose = closes[i];
    const entryTarget = isShort
      ? signalClose + trig.entryOffset
      : signalClose - trig.entryOffset;

    // Limit Order Fill check (15-minute 1-bar TTL window):
    // Long fills if the next bar dips to the entry; short fills if the
    // next bar rallies to it. Otherwise the order expires unfilled.
    if (isShort ? highs[i + 1] < entryTarget : lows[i + 1] > entryTarget) {
      continue; // Unfilled limit order expired without toxic drift
    }

    const posSize = cappedMargin * activeLev;
    const tokens = posSize / entryTarget;

    // Stop loss: ATR x tier coeff, clamped by the tier risk cap —
    // the SAME clamp the live server applies (see
    // server_strategy_auto_switcher.cjs), so backtest and live SL
    // conversion agree. On small balances the dollar cap binds first:
    // a T1 $30 account's stop is ~10c at $100 prices, not 1.2x ATR.
    const slDist = curSlCoeff * curATR;
    const fullFee = posSize * feeRate; // round-trip exchange fee
    totalFees += fullFee;
    const maxEquityRisk = Math.max(
      0.25,
      Math.min(balance * trigTier.riskCapPct, trigTier.maxRiskDollarCap),
    );
    const maxLossDistFromEquityCap = tokens > 0 && maxEquityRisk > fullFee
      ? (maxEquityRisk - fullFee) / tokens
      : slDist;
    const effectiveSlDist = Math.min(slDist, maxLossDistFromEquityCap);

    let slPrice = isShort
      ? entryTarget + effectiveSlDist
      : entryTarget - effectiveSlDist;
    const tp1Price = isShort ? entryTarget - tp1Dist : entryTarget + tp1Dist;
    const tp2Price = isShort ? entryTarget - tp2Dist : entryTarget + tp2Dist;

    let pnl = 0;
    let exitPrice = 0;
    let exitType: ExitType = 'SL';
    let exited = false;
    let tp1Hit = false;
    let exitBar = i + 1;
    let highestHigh = entryTarget;
    let lowestLow = entryTarget;

    // Bar by bar execution loop starting on fill bar (i + 1).
    // Direction-aware throughout: favorable extreme, Fisher exit
    // direction, stagnation, TP/SL hits, and chandelier all mirror.
    for (let j = i + 1; j < candles.length - 1 && !exited; j++) {
      exitBar = j;
      const jH = highs[j];
      const jL = lows[j];
      const jC = closes[j];
      highestHigh = Math.max(highestHigh, jH);
      lowestLow = Math.min(lowestLow, jL);
      const barsHeld = j - (i + 1);

      const fishJ = fisher[j];
      const fishJPrev = fisher[j - 1];
      const isFisherCrossDown =
        fishJ != null && fishJPrev != null && fishJ < fishJPrev;
      const isFisherCrossUp =
        fishJ != null && fishJPrev != null && fishJ > fishJPrev;

      if (!tp1Hit) {
        // Fee-Neutral Trailing Ratchet (+10c Lock): ratchet the stop
        // to entry +/- 10c as soon as Fisher turns against the trade
        // after a 10c favorable move, securing micro-gains before a
        // full reversal hits the primary SL.
        if (isShort) {
          if (isFisherCrossUp && j > i + 1 && (lowestLow <= entryTarget - 0.10 || jC <= entryTarget - 0.10)) {
            const ratchetPrice = entryTarget - 0.10;
            if (ratchetPrice < slPrice) {
              slPrice = ratchetPrice;
            }
          }
        } else {
          if (isFisherCrossDown && j > i + 1 && (highestHigh >= entryTarget + 0.10 || jC >= entryTarget + 0.10)) {
            const ratchetPrice = entryTarget + 0.10;
            if (ratchetPrice > slPrice) {
              slPrice = ratchetPrice;
            }
          }
        }

        // Stagnation Exit Rule (Phase 2: chop trades exit faster, mirroring
        // the live keeper: 2 bars / $0.10 adverse in chop, else 3 bars /
        // 0.30x ATR adverse).
        const adverseMove = isShort ? jC - entryTarget : entryTarget - jC;
        const stagBars = trig.isChop ? 2 : 3;
        const stagAdverse = trig.isChop ? 0.10 : 0.30 * curATR;
        if (barsHeld >= stagBars && adverseMove > stagAdverse) {
          exitPrice = jC;
          pnl = (isShort ? entryTarget - exitPrice : exitPrice - entryTarget) * tokens - fullFee;
          if (pnl < -maxEquityRisk) {
            pnl = -maxEquityRisk;
          }
          exitType = 'Stagnation Exit';
          exited = true;
          cooldown = 1;
        } else if (isShort ? jH >= slPrice : jL <= slPrice) {
          pnl = (isShort ? entryTarget - slPrice : slPrice - entryTarget) * tokens - fullFee;
          if (pnl < -maxEquityRisk) {
            pnl = -maxEquityRisk;
          }
          exitPrice = slPrice;
          exitType = isShort
            ? (slPrice <= entryTarget ? 'Half TP/BE' : 'SL')
            : (slPrice >= entryTarget ? 'Half TP/BE' : 'SL');
          exited = true;
          cooldown = 2; // Cooldown after loss
        } else if (isShort ? jL <= tp1Price : jH >= tp1Price) {
          // Asymmetric TP1 hit: bank tp1Ratio
          pnl += tp1Dist * (tokens * tp1Ratio) - fullFee * tp1Ratio;
          tp1Hit = true;
        }
      } else {
        // Trailing profit floor on runner (keeper parity: entry +/-
        // 10c fee-neutral floor — the old RANGE 15c / other 5c split
        // is gone; the keeper uses 10c for every regime).
        const runnerFloorDist = 0.10;
        const runnerFloorPrice = isShort
          ? entryTarget - runnerFloorDist
          : entryTarget + runnerFloorDist;

        // Improvement F: Dynamic Chandelier Trailing Stop (1.2x ATR
        // behind the FAVORABLE extreme).
        const chandelierSL = isShort
          ? lowestLow + (1.2 * curATR)
          : highestHigh - (1.2 * curATR);
        const effectiveSL = isShort
          ? Math.min(runnerFloorPrice, chandelierSL)
          : Math.max(runnerFloorPrice, chandelierSL);

        // Fee-Neutral Trailing Ratchet on runner: Fisher turning
        // against the trade ratchets the floor to entry +/- 10c.
        const ratchetFloor = isShort
          ? (isFisherCrossUp ? entryTarget - 0.10 : runnerFloorPrice)
          : (isFisherCrossDown ? entryTarget + 0.10 : runnerFloorPrice);
        const runnerStop = isShort
          ? Math.min(effectiveSL, ratchetFloor)
          : Math.max(effectiveSL, ratchetFloor);

        if (isShort ? jL <= tp2Price : jH >= tp2Price) {
          // Full TP2 hit on runner
          pnl += tp2Dist * (tokens * tp2Ratio) - fullFee * tp2Ratio;
          exitPrice = tp2Price;
          exitType = 'Full TP';
          exited = true;
        } else if (isShort ? (isFisherCrossUp && jC < runnerStop) : (isFisherCrossDown && jC > runnerStop)) {
          // Fisher turn against the runner: exit at profit before
          // price rolls back to the floor.
          pnl += (isShort ? entryTarget - jC : jC - entryTarget) * (tokens * tp2Ratio) - fullFee * tp2Ratio;
          exitPrice = jC;
          exitType = 'Half TP/Fisher';
          exited = true;
        } else if (isShort ? jH >= runnerStop : jL <= runnerStop) {
          // Chandelier trailing stop / runner floor exit
          pnl += (isShort ? entryTarget - runnerStop : runnerStop - entryTarget) * (tokens * tp2Ratio) - fullFee * tp2Ratio;
          exitPrice = runnerStop;
          exitType = isShort
            ? (runnerStop < runnerFloorPrice ? 'Chandelier Trail' as ExitType : 'Half TP/BE')
            : (runnerStop > runnerFloorPrice ? 'Chandelier Trail' as ExitType : 'Half TP/BE');
          exited = true;
        }
      }
    }

    if (!exited) continue;

    // 2-Loss Chop Circuit Breaker (5-Bar Sit-Out):
    // If 2 consecutive stop losses occur within 10 bars, force 5-bar Yellow Standby Mode
    if (pnl < 0) {
      recentLossBars.push(exitBar);
      if (recentLossBars.length >= 2) {
        const lastLoss = recentLossBars[recentLossBars.length - 1];
        const prevLoss = recentLossBars[recentLossBars.length - 2];
        if (lastLoss - prevLoss <= 10) {
          // Engage 5-bar circuit breaker sit-out
          cooldown = Math.max(cooldown, 5);
        }
      }
    }

    balance += pnl;
    balance = Math.max(balance, 0);
    peak = Math.max(peak, balance);
    const dd = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
    maxDD = Math.max(maxDD, dd);

    const tradeNum = trades.length + 1;
    const tradeItem: Trade = {
      n: tradeNum,
      side,
      // Trade regime is the trigger's classification, NOT the
      // generator stretch: a chop-shaped stretch can produce RANGE
      // trades and vice versa. The run-level label stays the stretch.
      regime: REGIMES[trig.regime].label,
      regimeKey: trig.regime,
      type: exitType,
      signalBar: i,
      entryBar: i + 1,
      exitBar,
      entry: parseFloat(entryTarget.toFixed(4)),
      exit: parseFloat(exitPrice.toFixed(4)),
      margin: parseFloat(cappedMargin.toFixed(2)),
      lev: activeLev,
      posSize: parseFloat(posSize.toFixed(2)),
      tokens: parseFloat(tokens.toFixed(4)),
      pnl: parseFloat(pnl.toFixed(2)),
      pnlPct: cappedMargin > 0 ? parseFloat(((pnl / cappedMargin) * 100).toFixed(2)) : 0,
      fee: parseFloat(fullFee.toFixed(3)),
      balance: parseFloat(balance.toFixed(2)),
      tp1Hit,
      barsHeld: Math.max(1, exitBar - (i + 1)),
    };

    trades.push(tradeItem);

    equityCurve.push({
      index: equityCurve.length,
      tradeNum,
      balance: parseFloat(balance.toFixed(2)),
      netPnL: parseFloat((balance - startBalance).toFixed(2)),
      drawdownPct: parseFloat(dd.toFixed(2)),
      regime: R.label,
      isLSD,
    });

    i += 3; // Advance to avoid overlapping duplicate fills
  }

  const wins = trades.filter((t) => t.pnl > 0).length;
  const losses = trades.filter((t) => t.pnl <= 0).length;
  const grossPnL = trades.reduce((a, t) => a + t.pnl, 0);
  const netRet = ((balance - startBalance) / startBalance) * 100;

  const winAmounts = trades.filter((t) => t.pnl > 0).map((t) => t.pnl);
  const lossAmounts = trades.filter((t) => t.pnl < 0).map((t) => Math.abs(t.pnl));

  const totalWinCash = winAmounts.reduce((a, b) => a + b, 0);
  const totalLossCash = lossAmounts.reduce((a, b) => a + b, 0);

  const profitFactor =
    totalLossCash > 0
      ? parseFloat((totalWinCash / totalLossCash).toFixed(2))
      : totalWinCash > 0
        ? 99.99
        : 0;

  const avgWin =
    winAmounts.length > 0 ? totalWinCash / winAmounts.length : 0;
  const avgLoss =
    lossAmounts.length > 0 ? totalLossCash / lossAmounts.length : 0;

  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const lossRate = trades.length > 0 ? (losses / trades.length) * 100 : 0;

  const expectancy =
    trades.length > 0
      ? parseFloat(((winRate / 100) * avgWin - (lossRate / 100) * avgLoss).toFixed(2))
      : 0;

  return {
    regime: regimeName,
    label: R.label,
    desc: R.desc,
    badge: R.badge,
    cardCls: R.cardCls,
    // Phase 2: report BARS ACTUALLY EVALUATED (loop visits), not the
    // configured count — the old value understated the evaluated
    // window by the warmup/fill margins.
    nBars: evaluatedBars,
    signals,
    trades,
    wins,
    losses,
    winRate: parseFloat(winRate.toFixed(1)),
    grossPnL: parseFloat(grossPnL.toFixed(2)),
    netPnL: parseFloat((balance - startBalance).toFixed(2)),
    startBal: startBalance,
    finalBal: parseFloat(balance.toFixed(2)),
    netRet: parseFloat(netRet.toFixed(2)),
    maxDD: parseFloat(maxDD.toFixed(2)),
    profitFactor,
    expectancy,
    avgWin: parseFloat(avgWin.toFixed(2)),
    avgLoss: parseFloat(avgLoss.toFixed(2)),
    totalFees: parseFloat(totalFees.toFixed(2)),
    equityCurve,
    candles: candles.slice(0, 300), // Keep sample for charting
  };
}

/**
 * Runs all 4 regimes in isolated mode + 1 sequential combined simulation
 */
export async function runFullSimulation(
  config: SimulationConfig,
  onProgress?: (msg: string, pct: number) => void,
): Promise<{ isolated: BacktestResult[]; combined: BacktestResult }> {
  const isolated: BacktestResult[] = [];

  let combinedBal = config.startBalance;
  let combinedPeak = config.startBalance;
  let combinedMaxDD = 0;
  let combinedSignals = 0;
  let combinedEvaluatedBars = 0;
  let combinedFees = 0;
  const combinedTrades: Trade[] = [];
  const combinedEquity: EquityPoint[] = [
    {
      index: 0,
      tradeNum: 0,
      balance: config.startBalance,
      netPnL: 0,
      drawdownPct: 0,
      regime: 'Start',
      isLSD: config.startBalance < config.lsdThreshold,
    },
  ];

  for (let ri = 0; ri < ORDERED_REGIMES.length; ri++) {
    const reg = ORDERED_REGIMES[ri];
    const label = REGIMES[reg].label;

    if (onProgress) {
      onProgress(`Simulating ${label} regime...`, Math.round((ri / 4) * 75));
    }
    // Yield brief tick for UI responsiveness
    await new Promise((resolve) => setTimeout(resolve, 15));

    // 1. Isolated Run (fresh startBalance)
    const isoResult = runRegimeAligned(
      reg,
      config.candlesPerRegime,
      config.startBalance,
      config.leverage,
      config.basePrice,
      config.compoundRate,
      makePRNG(config.seed + ri * 17),
      config,
    );
    isolated.push(isoResult);

    // 2. Sequential Combined Run (Uses the exact same regime candles, carries balance forward)
    const combResult = runRegimeAligned(
      reg,
      config.candlesPerRegime,
      combinedBal,
      config.leverage,
      config.basePrice,
      config.compoundRate,
      makePRNG(config.seed + ri * 17),
      config,
    );

    combinedBal = combResult.finalBal;
    combinedEvaluatedBars += combResult.nBars;
    combinedSignals += combResult.signals;
    combinedFees += combResult.totalFees;

    combResult.trades.forEach((t) => {
      combinedPeak = Math.max(combinedPeak, t.balance);
      const dd =
        combinedPeak > 0 ? ((combinedPeak - t.balance) / combinedPeak) * 100 : 0;
      combinedMaxDD = Math.max(combinedMaxDD, dd);

      const tradeNum = combinedTrades.length + 1;
      combinedTrades.push({
        ...t,
        n: tradeNum,
        regime: REGIMES[reg].label,
      });

      combinedEquity.push({
        index: combinedEquity.length,
        tradeNum,
        balance: t.balance,
        netPnL: parseFloat((t.balance - config.startBalance).toFixed(2)),
        drawdownPct: parseFloat(dd.toFixed(2)),
        regime: REGIMES[reg].label,
        isLSD: t.balance < config.lsdThreshold,
      });
    });
  }

  if (onProgress) {
    onProgress('Compiling performance analytics...', 95);
  }

  const combWins = combinedTrades.filter((t) => t.pnl > 0).length;
  const combLosses = combinedTrades.filter((t) => t.pnl <= 0).length;
  const combGross = combinedTrades.reduce((a, t) => a + t.pnl, 0);
  const combWinAmounts = combinedTrades
    .filter((t) => t.pnl > 0)
    .map((t) => t.pnl);
  const combLossAmounts = combinedTrades
    .filter((t) => t.pnl < 0)
    .map((t) => Math.abs(t.pnl));
  const combTotalWinCash = combWinAmounts.reduce((a, b) => a + b, 0);
  const combTotalLossCash = combLossAmounts.reduce((a, b) => a + b, 0);

  const combPF =
    combTotalLossCash > 0
      ? parseFloat((combTotalWinCash / combTotalLossCash).toFixed(2))
      : combTotalWinCash > 0
        ? 99.99
        : 0;

  const combAvgWin =
    combWinAmounts.length > 0 ? combTotalWinCash / combWinAmounts.length : 0;
  const combAvgLoss =
    combLossAmounts.length > 0 ? combTotalLossCash / combLossAmounts.length : 0;

  const combWinRate =
    combinedTrades.length > 0
      ? (combWins / combinedTrades.length) * 100
      : 0;
  const combLossRate =
    combinedTrades.length > 0
      ? (combLosses / combinedTrades.length) * 100
      : 0;

  const combExpectancy =
    combinedTrades.length > 0
      ? parseFloat(
          (
            (combWinRate / 100) * combAvgWin -
            (combLossRate / 100) * combAvgLoss
          ).toFixed(2),
        )
      : 0;

  const combined: BacktestResult = {
    regime: 'COMBINED',
    label: 'All Regimes (Combined)',
    desc: 'Sequential execution across all four regimes in series: Flash Crash → Market Chop → Range Bound Support → Bull Trend Drift. Dynamic compounding and LSD safety floor active.',
    badge: 'badge-combined',
    cardCls: 'combined',
    nBars: combinedEvaluatedBars,
    signals: combinedSignals,
    trades: combinedTrades,
    wins: combWins,
    losses: combLosses,
    winRate: parseFloat(combWinRate.toFixed(1)),
    grossPnL: parseFloat(combGross.toFixed(2)),
    netPnL: parseFloat((combinedBal - config.startBalance).toFixed(2)),
    startBal: config.startBalance,
    finalBal: parseFloat(combinedBal.toFixed(2)),
    netRet: parseFloat(
      (
        ((combinedBal - config.startBalance) / config.startBalance) *
        100
      ).toFixed(2),
    ),
    maxDD: parseFloat(combinedMaxDD.toFixed(2)),
    profitFactor: combPF,
    expectancy: combExpectancy,
    avgWin: parseFloat(combAvgWin.toFixed(2)),
    avgLoss: parseFloat(combAvgLoss.toFixed(2)),
    totalFees: parseFloat(combinedFees.toFixed(2)),
    equityCurve: combinedEquity,
  };

  return { isolated, combined };
}

/**
 * Monte Carlo Multi-Seed Simulation
 */
export async function runMonteCarlo(
  config: SimulationConfig,
  iterations = 50,
  onProgress?: (pct: number) => void,
): Promise<MonteCarloSummary> {
  const finalBalances: number[] = [];
  const maxDrawdowns: number[] = [];
  const returnPcts: number[] = [];
  const sampleCurves: { id: number; data: number[] }[] = [];
  let ruins = 0;

  for (let i = 0; i < iterations; i++) {
    const seed = config.seed + i * 37 + 101;
    const rng = makePRNG(seed);
    let balance = config.startBalance;
    let peak = balance;
    let maxDD = 0;
    const curvePoints = [balance];

    for (const reg of ORDERED_REGIMES) {
      const res = runRegimeAligned(
        reg,
        config.candlesPerRegime,
        balance,
        config.leverage,
        config.basePrice,
        config.compoundRate,
        rng,
        config,
      );
      balance = res.finalBal;
      peak = Math.max(peak, balance);
      const dd = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
      maxDD = Math.max(maxDD, dd);
      curvePoints.push(balance);
    }

    finalBalances.push(balance);
    maxDrawdowns.push(maxDD);
    returnPcts.push(((balance - config.startBalance) / config.startBalance) * 100);

    if (balance <= config.minLockout) {
      ruins++;
    }

    if (i < 15) {
      sampleCurves.push({ id: i + 1, data: curvePoints });
    }

    if (onProgress && i % 5 === 0) {
      onProgress(Math.round((i / iterations) * 100));
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  finalBalances.sort((a, b) => a - b);
  const medianFinalBal =
    finalBalances[Math.floor(finalBalances.length / 2)];
  const minFinalBal = finalBalances[0];
  const maxFinalBal = finalBalances[finalBalances.length - 1];
  const profitableSimsPct = parseFloat(
    (
      (finalBalances.filter((b) => b > config.startBalance).length /
        iterations) *
      100
    ).toFixed(1),
  );
  const ruinPct = parseFloat(((ruins / iterations) * 100).toFixed(1));
  const avgReturnPct = parseFloat(
    (returnPcts.reduce((a, b) => a + b, 0) / iterations).toFixed(2),
  );
  const worstDrawdownPct = parseFloat(Math.max(...maxDrawdowns).toFixed(2));

  return {
    simulations: iterations,
    medianFinalBal: parseFloat(medianFinalBal.toFixed(2)),
    minFinalBal: parseFloat(minFinalBal.toFixed(2)),
    maxFinalBal: parseFloat(maxFinalBal.toFixed(2)),
    profitableSimsPct,
    ruinCount: ruins,
    ruinPct,
    avgReturnPct,
    worstDrawdownPct,
    curves: sampleCurves,
  };
}
