/**
 * Commodity Channel Index (CCI)
 */
export function calcCCI(
  h: number[],
  l: number[],
  c: number[],
  p = 20,
): (number | null)[] {
  return c.map((_, i) => {
    if (i < p - 1) return null;
    const H = h.slice(i - p + 1, i + 1);
    const L = l.slice(i - p + 1, i + 1);
    const C = c.slice(i - p + 1, i + 1);
    const tp = C.map((_, j) => (H[j] + L[j] + C[j]) / 3);
    const sma = tp.reduce((a, b) => a + b, 0) / p;
    const mad = tp.map((v) => Math.abs(v - sma)).reduce((a, b) => a + b, 0) / p;
    return mad === 0 ? 0 : (tp[tp.length - 1] - sma) / (0.015 * mad);
  });
}

/**
 * Ehlers Fisher Transform
 */
export function calcFisher(h: number[], l: number[], p = 9): (number | null)[] {
  let prev = 0;
  return h.map((_, i) => {
    if (i < p - 1) return null;
    const hi = Math.max(...h.slice(i - p + 1, i + 1));
    const lo = Math.min(...l.slice(i - p + 1, i + 1));
    const mid = (h[i] + l[i]) / 2;
    let r = hi === lo ? 0.5 : (mid - lo) / (hi - lo);
    r = Math.min(Math.max(r, 0.001), 0.999);
    const f = 0.5 * Math.log((1 + r) / (1 - r)) * 2 + 0.5 * prev;
    prev = f;
    return parseFloat(f.toFixed(4));
  });
}

/**
 * Average True Range (ATR)
 */
export function calcATR(
  h: number[],
  l: number[],
  c: number[],
  p = 14,
): (number | null)[] {
  const tr = c.map((_, i) => {
    if (i === 0) return h[i] - l[i];
    return Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  });
  return tr.map((_, i) => {
    if (i < p - 1) return null;
    return tr.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p;
  });
}

/**
 * Detect Bullish Divergence on CCI vs Price:
 * Price makes a lower low while CCI makes a higher low within lookback window.
 */
export function detectBullDiv(
  closes: number[],
  cci: (number | null)[],
  lookback = 5,
): boolean {
  const i = closes.length - 1;
  if (i < lookback) return false;
  const pSlice = closes.slice(i - lookback, i + 1);
  const cSlice = cci.slice(i - lookback, i + 1).filter((x): x is number => x != null);
  if (cSlice.length < lookback) return false;

  const pLL = pSlice[pSlice.length - 1] < Math.min(...pSlice.slice(0, -1));
  const cHL = cSlice[cSlice.length - 1] > Math.min(...cSlice.slice(0, -1));
  return pLL && cHL;
}

/**
 * Volume-Weighted Moving Average (VWMA)
 */
export function calcVWMA(
  c: number[],
  v: number[],
  p = 20,
): (number | null)[] {
  return c.map((_, i) => {
    if (i < p - 1) return null;
    let sumPV = 0;
    let sumV = 0;
    for (let j = i - p + 1; j <= i; j++) {
      sumPV += c[j] * v[j];
      sumV += v[j];
    }
    return sumV === 0 ? c[i] : sumPV / sumV;
  });
}

/**
 * Tenkan-sen (9-period Midpoint)
 */
export function calcTenkan(
  h: number[],
  l: number[],
  p = 9,
): (number | null)[] {
  return h.map((_, i) => {
    if (i < p - 1) return null;
    const hi = Math.max(...h.slice(i - p + 1, i + 1));
    const lo = Math.min(...l.slice(i - p + 1, i + 1));
    return (hi + lo) / 2;
  });
}

/**
 * Simple Moving Average (SMA)
 */
export function calcSMA(
  c: number[],
  p = 50,
): (number | null)[] {
  return c.map((_, i) => {
    if (i < p - 1) return null;
    return c.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p;
  });
}

/**
 * Fisher Transform 1-Bar Lag Signal Line
 */
export function calcFisherSignal(
  arr: (number | null)[],
): (number | null)[] {
  return arr.map((_, i) => (i === 0 ? null : arr[i - 1]));
}

/**
 * Average Directional Index (ADX)
 */
export function calcADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): (number | null)[] {
  if (highs.length < period + 1) return [];
  const dmPlus: number[] = [];
  const dmMinus: number[] = [];
  const trArr: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const dnMove = lows[i - 1] - lows[i];
    dmPlus.push(upMove > dnMove && upMove > 0 ? upMove : 0);
    dmMinus.push(dnMove > upMove && dnMove > 0 ? dnMove : 0);
    trArr.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      ),
    );
  }

  const smooth = (arr: number[], p: number) => {
    let s = arr.slice(0, p).reduce((a, b) => a + b, 0);
    const out = [s];
    for (let i = p; i < arr.length; i++) {
      s = s - s / p + arr[i];
      out.push(s);
    }
    return out;
  };

  const sTR = smooth(trArr, period);
  const sDMp = smooth(dmPlus, period);
  const sDMm = smooth(dmMinus, period);
  const diPlus = sDMp.map((v, i) => (sTR[i] ? (100 * v) / sTR[i] : 0));
  const diMinus = sDMm.map((v, i) => (sTR[i] ? (100 * v) / sTR[i] : 0));
  const dx = diPlus.map((v, i) => {
    const s = v + diMinus[i];
    return s ? (100 * Math.abs(v - diMinus[i])) / s : 0;
  });

  const adxRaw = smooth(dx, period);
  const adxScaled = adxRaw.map((v) => Math.min(100, Math.max(0, v / period)));
  const pad = highs.length - adxScaled.length;
  return Array(pad).fill(null).concat(adxScaled);
}

/**
 * Bullish Candle pattern check (Green close or Pin-bar hammer support)
 */
export function isBullishCandle(
  opens: number[],
  closes: number[],
  highs?: number[],
  lows?: number[],
): boolean {
  if (opens.length < 2) return false;
  const i = opens.length - 2;
  const op = opens[i];
  const cl = closes[i];
  if (cl > op) return true;

  if (highs && lows && highs.length > i && lows.length > i) {
    const lo = lows[i];
    const body = Math.max(0.01, Math.abs(cl - op));
    const lowerWick = Math.min(op, cl) - lo;
    if (lowerWick >= 1.2 * body && lowerWick >= 0.15) {
      return true;
    }
  }
  return false;
}

/**
 * Higher Timeframe (HTF 1H) Trend Signal - Bit-for-bit synchronized with dashboard.html
 */
export function calcHTFSignal(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
): 'green' | 'yellow' | 'red' {
  if (closes.length < 50) return 'yellow';
  const H = highs.slice(0, -1);
  const L = lows.slice(0, -1);
  const C = closes.slice(0, -1);
  const V = volumes.slice(0, -1);

  const cci = calcCCI(H, L, C, 20);
  const fisher = calcFisher(H, L, 9);
  const tenkan = calcTenkan(H, L, 9);
  const vwma = calcVWMA(C, V, 20);
  const sma50 = calcSMA(C, 50);

  const price = C[C.length - 1];
  const vwmaValid = vwma.filter((x): x is number => x != null);
  const curV = vwmaValid.length > 0 ? vwmaValid[vwmaValid.length - 1] : null;

  // If price is below 1H VWMA, HTF bias is BEARISH (RED)
  if (curV == null || price < curV) return 'red';

  const dist = Math.abs((price - curV) / curV);
  if (dist <= 0.003) return 'yellow';

  const cciValid = cci.filter((x): x is number => x != null);
  const fishValid = fisher.filter((x): x is number => x != null);
  const tenkValid = tenkan.filter((x): x is number => x != null);
  const smaValid = sma50.filter((x): x is number => x != null);

  const cciUp = cciValid.length > 1 && cciValid[cciValid.length - 1] > cciValid[cciValid.length - 2];
  const fishUp = fishValid.length > 1 && fishValid[fishValid.length - 1] > fishValid[fishValid.length - 2];
  const tenkUp = tenkValid.length > 1 && tenkValid[tenkValid.length - 1] > tenkValid[tenkValid.length - 2];

  const lastSMA = smaValid.length > 0 ? smaValid[smaValid.length - 1] : 0;
  const aboveSMA = smaValid.length > 0 ? price > lastSMA : true;
  const cciBull = cciUp && cciValid[cciValid.length - 1] > 0;
  const fishBull = fishUp && fishValid[fishValid.length - 1] > 0;
  const aligned = [cciBull, fishBull, tenkUp].filter(Boolean).length;

  if (aligned === 3 && aboveSMA) return 'green';
  if (aligned >= 2 && aboveSMA) return 'yellow';
  return 'red';
}

export interface SignalCalculationResult {
  signal: 'green' | 'yellow' | 'red';
  reason: string;
  regime: string;
  tp1: number;
  tp2: number;
  tp1Percent: number; // Asymmetric exit percentage at TP1 (30%)
  tp2Percent: number; // Asymmetric exit percentage at TP2 (70%)
  slCoeff: number;
  entryOffset: number; // 0.00 for Post-Only Best Bid, 0.10x ATR for compressed ATR < 0.35, or 0.25x ATR standard
  recommendedMargin: number; // Committed margin collateral from wallet (Tier 1: $25.00 on $30 balance -> $500.00 position at 20x)
  activeTier: 'TIER_1' | 'TIER_2' | 'TIER_3';
  tierRiskCapPct: number; // Tier 1: 3%, Tier 2: 5%, Tier 3: 10%
  tierRiskCapDollar: number; // Tier 1: -$0.90, Tier 2: -$5.00, Tier 3: -$25.00
  setupGrade: 'GRADE_A' | 'GRADE_B'; // Grade A (volume/divergence + momentum) vs Grade B
  adxSlope: 'rising' | 'falling' | 'flat';
  isExhaustionReversal: boolean; // ADX > 22 and falling (optimal exhaustion bounce)
  earlyProfitLock: number; // Micro-structure profit lock (+10¢) on 5m Fisher cross
  trailingStopOffset: number; // Chandelier trailing stop (1.2x ATR)
  limitOrderTTLMinutes: number; // 15-minute Time-To-Live to prevent toxic fill drift
  bullDiv: boolean;
  bullishCandle: boolean;
  cciAccel: boolean;
  candleMomentum: boolean; // Close >= High - (0.0010 * Close)
  orderExecutionType: 'POST_ONLY_BEST_BID' | 'DYNAMIC_ATR_LIMIT';
  tenk30mRising2Candles: boolean; // 30m Tenkan-sen upward slope for >= 2 candles (>= 60 min)
  volumeGateMet: boolean; // Filtering for >= 25k SOL institutional volume
  barConfirmation5m?: number; // 2-Bar Confirmation count on 5 min chart
}

/**
 * Calibrated Signal Calculation (incorporating Trade Improvements A through F and Mechanics 1-4)
 */
export function calcSignalEngine(
  cciUp: boolean,
  fishUp: boolean,
  tenkUp: boolean,
  price: number,
  vwma: number | null,
  sma50: number | null,
  volConfirmed: boolean,
  atrExpanding: boolean,
  adxTrending: boolean,
  fisherCrossUp: boolean,
  htfSignal: 'green' | 'yellow' | 'red',
  bullishCandle: boolean,
  cciDiv: 'bullish' | 'bearish' | 'none',
  fishDiv: 'bullish' | 'bearish' | 'none',
  cciAccel: boolean,
  curADX: number,
  curATR: number,
  prevADX?: number | null,
  lastVol?: number,
  tenkRising2Candles?: boolean,
  candleHigh?: number,
  candleClose?: number,
  accountBalance?: number,
  consecutiveGreen5m?: number,
): SignalCalculationResult {
  const currentATR = curATR || 0.35;
  const actualADX = curADX !== undefined && curADX !== null ? curADX : 30;

  // ADX Slope & Trend Exhaustion Detection (Improvement E)
  let adxSlope: 'rising' | 'falling' | 'flat' = 'flat';
  if (prevADX !== undefined && prevADX !== null && prevADX > 0) {
    const dADX = actualADX - prevADX;
    if (dADX > 0.35) adxSlope = 'rising';
    else if (dADX < -0.35) adxSlope = 'falling';
    else adxSlope = 'flat';
  }
  const isExhaustionReversal = actualADX > 22 && adxSlope === 'falling';

  // 2. Candle Momentum Detection: Close >= High - (0.0010 * Close)
  // Confirms the current 15m bar closed within 0.10% of its high, indicating buyers controlled bar with virtually no upper wick.
  const cHigh = candleHigh !== undefined ? candleHigh : price;
  const cClose = candleClose !== undefined ? candleClose : price;
  const candleMomentum = candleHigh !== undefined && candleClose !== undefined
    ? cClose >= (cHigh - (0.0010 * cClose))
    : false;

  // 3 & 4. Dynamic Offset Calculation:
  // 3. When Candle Momentum is detected, abandon deep limit pullback offsets (0.25 * ATR).
  //    Places a Post-Only Limit Order directly at the Best Bid at bar close (0.00 offset / maker rebates / zero-fee pricing).
  // 4. Dynamic ATR Offset Tightening: When Candle Momentum is not active, but volatility is compressed (ATR < $0.35),
  //    limit offset drops from 0.25 * ATR down to 0.10 * ATR (3¢ - 5¢ below close).
  let entryOffset = 0.08;
  let orderExecutionType: 'POST_ONLY_BEST_BID' | 'DYNAMIC_ATR_LIMIT' = 'DYNAMIC_ATR_LIMIT';

  if (candleMomentum) {
    orderExecutionType = 'POST_ONLY_BEST_BID';
    entryOffset = 0.00; // Directly at Best Bid at bar close
  } else if (currentATR < 0.35) {
    orderExecutionType = 'DYNAMIC_ATR_LIMIT';
    // Offset drops from 0.25 * ATR down to 0.10 * ATR (3¢ - 5¢ below close)
    entryOffset = Math.max(0.03, Math.min(Number((currentATR * 0.10).toFixed(2)), 0.05));
  } else {
    orderExecutionType = 'DYNAMIC_ATR_LIMIT';
    // Standard pullback offset: 0.25x ATR with an 8¢ baseline floor, clamped to 20¢
    entryOffset = Math.max(0.08, Math.min(Number((currentATR * 0.25).toFixed(2)), 0.20));
  }

  // Tiered Risk Cap & Margin Sizing (Wallet Collateral & Notional Sizing)
  // Tier 1: 3% -$0.90 max / Margin Collateral = $25.00 on $30 balance -> Position Size = $500.00 (4.27 SOL)
  // Tier 2: 5% -$5.00 max / Margin Collateral = $50.00 on $100 balance -> Position Size = $1,750.00
  // Tier 3: 10% -$25.00 max / Margin Collateral = $100.00 on $250 balance -> Position Size = $5,000.00
  const bal = accountBalance !== undefined && accountBalance > 0 ? accountBalance : 30.0;
  const activeTier: 'TIER_1' | 'TIER_2' | 'TIER_3' = bal < 100 ? 'TIER_1' : bal < 250 ? 'TIER_2' : 'TIER_3';
  const tierRiskCapPct = activeTier === 'TIER_1' ? 0.03 : activeTier === 'TIER_2' ? 0.05 : 0.10;
  const tierRiskCapDollar = activeTier === 'TIER_1'
    ? Math.max(0.25, Math.min(bal * 0.03, 3.00))
    : activeTier === 'TIER_2'
    ? Math.max(1.00, Math.min(bal * 0.05, 12.50))
    : Math.max(5.00, Math.min(bal * 0.10, 50.00));

  // Margin is wallet collateral ($25.00 on $30 balance)
  let recommendedMargin = activeTier === 'TIER_1'
    ? Math.min(bal, 25.00)
    : activeTier === 'TIER_2'
    ? Math.min(bal * 0.50, 100.00)
    : Math.min(bal * 0.40, 250.00);
  recommendedMargin = Math.max(5.00, Number(recommendedMargin.toFixed(2)));

  if (vwma == null) {
    return {
      signal: 'yellow',
      reason: 'vwma_null',
      regime: 'MARKET_CHOP',
      tp1: 0.35,
      tp2: 1.20,
      tp1Percent: 30,
      tp2Percent: 70,
      slCoeff: 1.5,
      entryOffset,
      recommendedMargin: 0,
      activeTier,
      tierRiskCapPct,
      tierRiskCapDollar,
      setupGrade: 'GRADE_B',
      adxSlope,
      isExhaustionReversal,
      earlyProfitLock: 0.10,
      trailingStopOffset: Number((currentATR * 1.2).toFixed(2)),
      limitOrderTTLMinutes: 15,
      bullDiv: false,
      bullishCandle,
      cciAccel,
      candleMomentum,
      orderExecutionType,
      tenk30mRising2Candles: Boolean(tenkRising2Candles),
      volumeGateMet: lastVol !== undefined ? lastVol >= 25000 : volConfirmed,
    };
  }

  // 1. Dynamic Regime Detection & Symmetrical Sit-Outs
  let regime = 'RANGE_BOUND_SUPPORT';
  if (htfSignal === 'red' && price < vwma && actualADX > 35) {
    regime = 'FLASH_CRASH';
  } else if (actualADX < 20) {
    regime = 'MARKET_CHOP';
  } else if (htfSignal === 'green' && price > vwma && actualADX > 45) {
    regime = 'BULL_TREND_DRIFT';
  } else {
    regime = 'RANGE_BOUND_SUPPORT';
  }

  // 2. Setup Grading via Volume & Divergence Confluence (Improvement C)
  const bullDiv = cciDiv === 'bullish' || fishDiv === 'bullish';
  const isGradeA = (volConfirmed || bullDiv) && cciAccel;
  const setupGrade: 'GRADE_A' | 'GRADE_B' = isGradeA ? 'GRADE_A' : 'GRADE_B';

  // 3. Asymmetric Sizing & Targets based on 1H HTF Alignment (Improvement B)
  // Baseline TP1: +$0.35. Extended TP2: 1.50x ATR / +$1.20 on Trend-Drift
  const tp1 = 0.35; // Fee-Neutral TP1 widened to $0.35 (+3.5% to +4.5% net margin yield)
  let tp2 = regime === 'BULL_TREND_DRIFT' ? Math.max(1.20, Number((currentATR * 1.50).toFixed(2))) : regime === 'RANGE_BOUND_SUPPORT' ? 0.55 : 0.75;
  let tp1Percent = 30; // Asymmetric TP Scaling (30/70)
  let tp2Percent = 70; // 70% runner to Extended TP2
  let slCoeff = 1.5;

  if (regime === 'FLASH_CRASH' || regime === 'MARKET_CHOP') {
    // Symmetrical Sit-Out
    recommendedMargin = 0.00;
    slCoeff = 1.5;
  } else if (activeTier === 'TIER_1') {
    // Tier 1 ($0-$100): Margin Collateral = $25.00 on $30 balance (Position Size = $500.00 at 20x / ~4.27 SOL)
    recommendedMargin = Math.min(bal, 25.00);
    tp2 = regime === 'BULL_TREND_DRIFT' ? Math.max(1.20, Number((currentATR * 1.50).toFixed(2))) : 0.55;
    tp1Percent = 30;
    tp2Percent = 70;
  } else if (activeTier === 'TIER_2') {
    // Tier 2 ($100-$250): Margin Collateral = $50.00 on $100 balance (Position Size = $1,750.00 at 35x)
    recommendedMargin = Math.min(bal * 0.50, 100.00);
    tp2 = regime === 'BULL_TREND_DRIFT' ? Math.max(1.20, Number((currentATR * 1.50).toFixed(2))) : 0.70;
    tp1Percent = 30;
    tp2Percent = 70;
  } else {
    // Tier 3 ($250+): Margin Collateral = $100.00 on $250 balance (Position Size = $5,000.00 at 50x)
    recommendedMargin = Math.min(bal * 0.40, 250.00);
    tp2 = regime === 'BULL_TREND_DRIFT' ? Math.max(1.20, Number((currentATR * 1.50).toFixed(2))) : 0.85;
    tp1Percent = 30;
    tp2Percent = 70;
  }

  const cciBullish = cciUp;
  const fishBullish = fishUp;
  const isBullishClose = bullishCandle;

  let isLongTrigger = false;
  let reason = 'insufficient_alignment';

  // 1. Rising Tenkan-sen (>= 2 Candles) + Volume Gate (>= 25k) + 2-Bar Confirmation on 5m chart
  // Requiring the 30m Tenkan-sen line to slope upward for 2 consecutive candles (>= 60 minutes)
  // verifies established directional expansion rather than flat price location.
  // Filtering for >= 25k SOL volume ensures entries only trigger when institutional volume actively supports move.
  // 2-Bar Confirmation on the 5 min chart verifies buyers sustain follow-through over at least 2 consecutive 5m candles.
  const isTenkRising2Bars = tenkRising2Candles !== undefined ? tenkRising2Candles : tenkUp;
  const volumeGateMet = lastVol !== undefined ? lastVol >= 25000 : volConfirmed;
  const tenkanVolHook = isTenkRising2Bars && volumeGateMet;

  const barConfirmCount = consecutiveGreen5m !== undefined ? consecutiveGreen5m : 2;
  const is5m2BarConfirmed = barConfirmCount >= 2;

  // Symmetrical Sit-Out enforcement: Take ZERO trades in Chop (ADX < 20) or Flash Crash (ADX > 35 + Red HTF)
  if (regime !== 'MARKET_CHOP' && regime !== 'FLASH_CRASH') {
    // Standard trigger: dual momentum hook (CCI & Fisher hook up together with candle / pin-bar confirmation)
    const standardHook = cciBullish && fishBullish && isBullishClose;

    if (standardHook || tenkanVolHook) {
      // For signal volume > 25k and momentum hooks, require 2-Bar Confirmation on the 5 min chart
      if (is5m2BarConfirmed) {
        isLongTrigger = true;
        reason = bullDiv
          ? 'bullish_divergence_reversal'
          : tenkanVolHook && !standardHook
          ? 'tenkan_2candles_volume_gate_long (2-Bar 5m Confirmed)'
          : 'reversal_hook_long (2-Bar 5m Confirmed)';
      } else {
        isLongTrigger = false;
        reason = `waiting_5m_bar_confirmation (${barConfirmCount}/2 bars confirmed on 5m chart)`;
      }
    }
  }

  let rawSignal: 'green' | 'yellow' | 'red' = 'yellow';
  if (isLongTrigger) {
    rawSignal = 'green';
  } else if (regime === 'FLASH_CRASH') {
    rawSignal = 'red';
    reason = 'flash_crash_sitout';
  } else {
    rawSignal = 'yellow';
    if (!reason || reason === 'insufficient_alignment') {
      reason = regime === 'MARKET_CHOP' ? 'consolidating' : 'insufficient_alignment';
    }
  }

  return {
    signal: rawSignal,
    reason,
    regime,
    tp1,
    tp2,
    tp1Percent,
    tp2Percent,
    slCoeff,
    entryOffset,
    recommendedMargin,
    activeTier,
    tierRiskCapPct,
    tierRiskCapDollar,
    setupGrade,
    adxSlope,
    isExhaustionReversal,
    earlyProfitLock: 0.10, // +$0.10 ratchet on 5m Fisher bearish cross (Improvement D)
    trailingStopOffset: Number((currentATR * 1.2).toFixed(2)), // Chandelier trail (Improvement F)
    limitOrderTTLMinutes: 15, // 15-minute Time-To-Live (Improvement A)
    bullDiv,
    bullishCandle,
    cciAccel,
    candleMomentum,
    orderExecutionType,
    tenk30mRising2Candles: Boolean(isTenkRising2Bars),
    volumeGateMet,
    barConfirmation5m: barConfirmCount,
  };
}


