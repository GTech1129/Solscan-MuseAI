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
import { calcATR, calcCCI, calcFisher, calcTenkan, calcVWMA, detectBullDiv } from './indicators.ts';
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
  const R = REGIMES[regimeName];
  const feeRate = config?.feeRate ?? 0.0008;
  const lsdThreshold = config?.lsdThreshold ?? 22.0;
  const minLockout = config?.minLockout ?? 10.0;
  const slAtrMult = config?.slAtrMult ?? 1.5;
  const tp1Override = config?.tp1Dist ?? 0.35;
  const entryOffsetVal = config?.entryOffset ?? 0.08;

  const rawCandles = generateSolanaCandles(regimeName, nBars + 35, basePrice, rng);

  const opens = rawCandles.map((c) => c.open);
  const highs = rawCandles.map((c) => c.high);
  const lows = rawCandles.map((c) => c.low);
  const closes = rawCandles.map((c) => c.close);
  const volumes = rawCandles.map((c) => c.volume);

  const cci = calcCCI(highs, lows, closes, 20);
  const fisher = calcFisher(highs, lows, 9);
  const atr = calcATR(highs, lows, closes, 14);
  const vwma = calcVWMA(closes, volumes, 20);
  const tenkan = calcTenkan(highs, lows, 9);

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

    const isBullCandle =
      closes[i] > opens[i] ||
      Math.min(opens[i], closes[i]) - lows[i] >=
        1.2 * Math.max(0.01, Math.abs(closes[i] - opens[i]));
    let isLong = false;
    const flashCrashSitOut = (config?.flashCrashMode ?? 'SIT_OUT') === 'SIT_OUT';

    // Strategy Selection & Symmetrical Sit-Outs
    if (regimeName === 'MARKET_CHOP') {
      // 100% Cash standby mode during MARKET_CHOP (ADX < 20)
      isLong = false;
    } else if (regimeName === 'FLASH_CRASH') {
      if (flashCrashSitOut) {
        // Symmetrical sit-out in 100% Cash during liquidation waterfalls
        isLong = false;
      } else {
        // Adaptive Bullish Divergence Bottom-Buy (v8)
        const bullDiv = detectBullDiv(closes.slice(0, i + 1), cci.slice(0, i + 1));
        if (bullDiv && cciNow > cciPrev && fishNow > fishPrev && isBullCandle) {
          isLong = true;
        }
      }
    } else {
      // Sub-VWMA Floor and Deep Oversold removed:
      // Hook triggers on dual momentum hook (CCI + Fisher) with candle / absorption pin-bar
      // OR Tenkan is rising and Volume (15 min) is greater than 25K
      // Enforce 0.3% VWMA proximity chop filter: 100% Cash sit-out when price is within 0.3% of VWMA
      const curVWMA = vwma[i];
      const isVWMAChop = curVWMA != null && Math.abs(closes[i] - curVWMA) / curVWMA < 0.003;
      const standardHook = cciNow > cciPrev && fishNow > fishPrev && isBullCandle;
      const tenkNow = tenkan[i];
      const tenkPrev = tenkan[i - 1];
      const tenkPrev2 = tenkan[i - 2];
      const tenkRising2Candles =
        tenkNow != null &&
        tenkPrev != null &&
        tenkPrev2 != null &&
        tenkNow > tenkPrev &&
        tenkPrev > tenkPrev2;
      const vol15m = volumes[i];
      const tenkanVolHook = tenkRising2Candles && vol15m >= 25000;

      if (!isVWMAChop && (standardHook || tenkanVolHook)) {
        isLong = true;
      }
    }

    if (!isLong) continue;
    signals++;

    if (cooldown > 0) continue;

    // Dynamic Sizing & Safety Floor (LSD/DEB Protection)
    const isAutoSwitch = config?.autoSwitchPresets ?? false;
    let tierLev = leverage;
    let tierRiskCap = balance * 0.03;
    let tierTp2Dist = R.tp2 || 0.55;
    let tierSlCoeff = slAtrMult;

    if (isAutoSwitch) {
      if (balance < 100.00) {
        tierLev = 20; // Peak Win Rate Mode (20x LSD)
        tierRiskCap = Math.max(0.25, Math.min(balance * 0.03, 3.00)); // Tier 1: 3% risk cap (-$0.90 on $30 bal, max -$3.00)
        tierTp2Dist = Math.max(0.55, curATR * 0.85); // +0.55 / +0.85 ATR
        tierSlCoeff = 1.2;
      } else if (balance < 250.00) {
        tierLev = 35; // Hybrid Scaling Tier (35x)
        tierRiskCap = Math.max(1.00, Math.min(balance * 0.05, 12.50)); // Tier 2: 5% risk cap (-$5.00 on $100 bal, max -$12.50)
        tierTp2Dist = Math.max(0.70, curATR * 1.00); // +0.70 / +1.00 ATR
        tierSlCoeff = 1.5;
      } else {
        tierLev = 50; // Max Alpha Mode (50x)
        tierRiskCap = Math.max(5.00, Math.min(balance * 0.10, 50.00)); // Tier 3: 10% risk cap (-$25.00 on $250 bal, max -$50.00)
        tierTp2Dist = Math.max(0.85, curATR * 1.20); // +0.85 / +1.20 ATR
        tierSlCoeff = 1.5;
      }
    }

    const isLSD = balance < lsdThreshold;
    const activeLev = isAutoSwitch ? tierLev : (isLSD ? 20 : leverage);

    let margin = 0;
    if (isAutoSwitch) {
      if (balance < 100.00) {
        margin = Math.min(balance, 25.00); // Auto Preset Tier 1 ($25.00 collateral on $30 balance -> $500.00 notional at 20x)
      } else if (balance < 250.00) {
        margin = Math.min(balance * 0.50, 100.00); // Auto Preset Tier 2 ($50.00 collateral on $100 balance -> $1,750.00 notional at 35x)
      } else {
        margin = Math.min(balance * 0.40, 250.00); // Auto Preset Tier 3 ($100.00 collateral on $250 balance -> $5,000.00 notional at 50x)
      }
    } else if (compoundRate === 0) {
      margin = 11.0; // Fixed sizer
    } else {
      margin = isLSD ? 11.0 : balance * compoundRate;
    }

    // Flash crash micro sizing if divergence mode active (~10% size / $25 margin)
    if (regimeName === 'FLASH_CRASH' && !flashCrashSitOut) {
      margin = Math.max(minLockout, Math.min(margin * 0.25, 25.0));
    }

    // Safety lockout check
    if (balance < minLockout) {
      break; // Jupiter Perps physical lockout limit reached
    }

    // Cap margin if it exceeds current balance
    if (margin > balance) {
      margin = Math.max(minLockout, balance * 0.95);
    }

    // 2. Candle Momentum Detection: Close >= High - (0.0010 * Close)
    const candleMom = closes[i] >= (highs[i] - (0.0010 * closes[i]));

    // 3 & 4. Dynamic Offset Calculation:
    // When Candle Momentum is detected, abandon deep limit pullback offsets (0.25 * ATR).
    // Places a Post-Only Limit Order directly at the Best Bid at bar close (0.00 offset / maker rebates / zero-fee pricing).
    // When Candle Momentum is not active, but volatility is compressed (ATR < $0.35),
    // limit offset drops from 0.25 * ATR down to 0.10 * ATR (3¢ - 5¢ below close).
    let curOffset = config?.entryOffset ?? 0.08;
    if (config?.useDynamicOffset ?? true) {
      if (candleMom) {
        curOffset = 0.00; // Post-Only Best Bid directly at bar close
      } else if (curATR < 0.35) {
        curOffset = Math.max(0.03, Math.min(curATR * 0.10, 0.05));
      } else if (regimeName === 'RANGE_BOUND_SUPPORT') {
        // Range-Bound regimes: 0.30 × ATR clamped between 8¢ and 22¢
        curOffset = Math.max(0.08, Math.min(curATR * 0.30, 0.22));
      } else {
        // Other regimes: 0.25 × ATR with an 8¢ floor, clamped to 20¢
        curOffset = Math.max(0.08, Math.min(curATR * 0.25, 0.20));
      }
    }

    const signalClose = closes[i];
    const entryTarget = signalClose - curOffset;

    // Limit Order Fill check (Improvement A: 15-minute 1-bar TTL window):
    // Did next bar dip to fill limit order?
    if (lows[i + 1] > entryTarget) {
      continue; // Unfilled limit order expired without toxic drift
    }

    const posSize = margin * activeLev;
    const tokens = posSize / entryTarget;

    // Asymmetric Sizing & Targets based on Regime & HTF (Improvement B)
    let tp1Ratio = 0.30;
    let tp2Ratio = 0.70;
    if (regimeName === 'BULL_TREND_DRIFT') {
      tp1Ratio = 0.30; // Asymmetric TP Scaling (30/70)
      tp2Ratio = 0.70; // 70% runner to extended TP2 (1.50x ATR / +$1.20)
    } else if (regimeName === 'RANGE_BOUND_SUPPORT') {
      tp1Ratio = 0.30; // Asymmetric TP Scaling (30/70)
      tp2Ratio = 0.70;
    } else if (regimeName === 'FLASH_CRASH') {
      tp1Ratio = 0.70; // 70% banked quickly against trend
      tp2Ratio = 0.30;
    }

    // TP1: Scaled to 0.15 in LSD mode (dashboard: backtest_tp1 = isLSD ? 0.15 : tp1),
    // and fee-neutralized 0.35 in standard mode based on SOL's 15m ATR & pullback
    const tp1Dist = isLSD ? 0.15 : tp1Override;
    const tp2Dist = isAutoSwitch
      ? tierTp2Dist
      : regimeName === 'BULL_TREND_DRIFT'
        ? Math.max(1.20, curATR * 1.50) // Extended TP2 (1.50x ATR / +$1.20)
        : regimeName === 'FLASH_CRASH'
          ? 0.50
          : regimeName === 'RANGE_BOUND_SUPPORT'
            ? 0.55
            : (R.tp2 || 0.55);

    // Tightened Base Stop Loss: 1.5x ATR across all active regimes
    const curSlCoeff = isAutoSwitch ? tierSlCoeff : slAtrMult;
    const slDist = isLSD ? 0.3 : curSlCoeff * curATR;

    const fullFee = posSize * feeRate; // round-trip exchange fee
    totalFees += fullFee;

    // Hard Account Equity Risk Cap (Max 10% Equity Risk):
    // Cap maximum dollar loss on any single trade to 10% of current account equity
    const maxEquityRisk = isAutoSwitch ? tierRiskCap : Math.max(1.0, balance * 0.10);
    // Loss if SL hits: (entryTarget - slPrice) * tokens + fullFee <= maxEquityRisk
    // slDistMax = (maxEquityRisk - fullFee) / tokens
    const maxLossDistFromEquityCap = tokens > 0 && maxEquityRisk > fullFee 
      ? (maxEquityRisk - fullFee) / tokens 
      : slDist;
    const effectiveSlDist = Math.min(slDist, maxLossDistFromEquityCap);

    let slPrice = entryTarget - effectiveSlDist;
    const tp1Price = entryTarget + tp1Dist;
    const tp2Price = entryTarget + tp2Dist;

    let pnl = 0;
    let exitPrice = 0;
    let exitType: ExitType = 'SL';
    let exited = false;
    let tp1Hit = false;
    let exitBar = i + 1;
    let highestHigh = entryTarget;

    // Bar by bar execution loop starting on fill bar (i + 1)
    for (let j = i + 1; j < candles.length - 1 && !exited; j++) {
      exitBar = j;
      const jH = highs[j];
      const jL = lows[j];
      const jC = closes[j];
      highestHigh = Math.max(highestHigh, jH);
      const barsHeld = j - (i + 1);

      const fishJ = fisher[j];
      const fishJPrev = fisher[j - 1];
      const isFisherCrossDown =
        fishJ != null && fishJPrev != null && fishJ < fishJPrev;

      if (!tp1Hit) {
        // Fee-Neutral Trailing Ratchet (+10¢ Lock):
        // Immediately ratchet the stop loss to Entry + $0.10 as soon as a 5-minute Fisher
        // bearish cross occurs, securing micro-gains before a full reversal hits primary SL
        if (isFisherCrossDown && j > i + 1 && (highestHigh >= entryTarget + 0.10 || jC >= entryTarget + 0.10)) {
          const ratchetPrice = entryTarget + 0.10;
          if (ratchetPrice > slPrice) {
            slPrice = ratchetPrice;
          }
        }

        // 3-Bar Stagnation Exit Rule:
        // Automatically exit positions at market if they fail to reach TP1 within 3 bars
        // while moving adverse by more than -0.30 ATR.
        const adverseMove = entryTarget - jC;
        if (barsHeld >= 3 && adverseMove > 0.30 * curATR) {
          exitPrice = jC;
          pnl = (exitPrice - entryTarget) * tokens - fullFee;
          // Apply Hard Equity Risk Cap (-10% max loss)
          if (pnl < -maxEquityRisk) {
            pnl = -maxEquityRisk;
          }
          exitType = 'Stagnation Exit';
          exited = true;
          cooldown = 1;
        } else if (jL <= slPrice) {
          pnl = (slPrice - entryTarget) * tokens - fullFee;
          // Apply Hard Equity Risk Cap (-10% max loss)
          if (pnl < -maxEquityRisk) {
            pnl = -maxEquityRisk;
          }
          exitPrice = slPrice;
          exitType = slPrice >= entryTarget ? 'Half TP/BE' : 'SL';
          exited = true;
          cooldown = 2; // Cooldown after loss
        } else if (jH >= tp1Price) {
          // Asymmetric TP1 hit (Improvement B): bank tp1Ratio
          pnl += (tp1Price - entryTarget) * (tokens * tp1Ratio) - fullFee * tp1Ratio;
          tp1Hit = true;
        }
      } else {
        // Trailing profit floor on runner:
        // In Range Bound: lock in +15¢ profit floor instead of 0¢ breakeven
        // This eliminates fee-drag and turns rolled-over trades into net-positive wins
        const runnerFloorDist =
          regimeName === 'RANGE_BOUND_SUPPORT' ? 0.15 : 0.05;
        const runnerFloorPrice = entryTarget + runnerFloorDist;

        // Improvement F: Dynamic Chandelier Trailing Stop (1.2× ATR behind peak)
        const chandelierSL = highestHigh - (1.2 * curATR);
        const effectiveSL = Math.max(runnerFloorPrice, chandelierSL);

        // Fee-Neutral Trailing Ratchet on runner:
        // Ratchet stop loss to Entry + $0.10 if Fisher crosses down
        const ratchetFloor = isFisherCrossDown ? entryTarget + 0.10 : runnerFloorPrice;
        const runnerStop = Math.max(effectiveSL, ratchetFloor);

        if (jH >= tp2Price) {
          // Full TP2 hit on runner (Improvement B)
          pnl += (tp2Price - entryTarget) * (tokens * tp2Ratio) - fullFee * tp2Ratio;
          exitPrice = tp2Price;
          exitType = 'Full TP';
          exited = true;
        } else if (isFisherCrossDown && jC > runnerStop) {
          // 5m Fisher Transform cross-down: exit runner at profit before price rolls back to floor
          pnl += (jC - entryTarget) * (tokens * tp2Ratio) - fullFee * tp2Ratio;
          exitPrice = jC;
          exitType = 'Half TP/Fisher';
          exited = true;
        } else if (jL <= runnerStop) {
          // Chandelier trailing stop / runner floor exit
          pnl += (runnerStop - entryTarget) * (tokens * tp2Ratio) - fullFee * tp2Ratio;
          exitPrice = runnerStop;
          exitType = runnerStop > runnerFloorPrice ? 'Chandelier Trail' as ExitType : 'Half TP/BE';
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
      regime: R.label,
      regimeKey: regimeName,
      type: exitType,
      signalBar: i,
      entryBar: i + 1,
      exitBar,
      entry: parseFloat(entryTarget.toFixed(4)),
      exit: parseFloat(exitPrice.toFixed(4)),
      margin: parseFloat(margin.toFixed(2)),
      lev: activeLev,
      posSize: parseFloat(posSize.toFixed(2)),
      tokens: parseFloat(tokens.toFixed(4)),
      pnl: parseFloat(pnl.toFixed(2)),
      pnlPct: margin > 0 ? parseFloat(((pnl / margin) * 100).toFixed(2)) : 0,
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
    nBars,
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
    nBars: config.candlesPerRegime * 4,
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
