// src/engine/trigger.ts
// CANONICAL TRIGGER — Phase 2 single signal implementation.
//
// Before Phase 2 there were THREE divergent signal implementations
// (audit §2/§6) that could print different answers on the same candles:
//   1. React live:  src/engine/indicators.ts calcSignalEngine (+ 5m gate, + tenkan hook, + ADX<12 overlay)
//   2. dashboard.html: calcSignal (standard hook only, no 5m gate, 2-bar cooldown, hardcoded $120 margin)
//   3. backtest:     src/engine/backtest.ts inline trigger (no 5m gate, extra 0.3% VWMA-proximity filter)
// calcSignalEngine has been REMOVED. dashboard.html has been retired to a
// redirect (see PHASE2_NOTES.md). The backtest calls this same function.
// If this function says LONG/SHORT, the live dashboard, the server, and
// the backtest all agree — because there is only one function.
//
// =====================================================================
// TRIGGER SPECIFICATION (exact conditions, in evaluation order)
// =====================================================================
// INPUTS (all precomputed by the caller from candle arrays; this function
// never fetches data, so tests can call it directly):
//   price, vwma, atr, adx, prevAdx, htfSignal ('green'|'yellow'|'red')
//   long hooks:  cciUp, fishUp, bullishCandle, tenkRising2Candles, volumeGateMet
//   short hooks: cciDown, fishDown, bearishCandle, tenkFalling2Candles, volumeGateMet (shared)
//   confirmation: consecutiveGreen5m, consecutiveRed5m, fiveMinFeedOk
//   balance, candleHigh, candleLow, candleClose (for momentum/offset),
//   bullDiv, bearDiv, cciAccel, volConfirmed (grading only, never gating)
//
// STEP 0 — FEED. If fiveMinFeedOk is false, the result is UNKNOWN
//   (uiSignal 'unknown', no direction, margin 0). This replaces the old
//   behavior where a failed 5m feed silently left confirmation at 0 and
//   blocked every signal with no explanation. UNKNOWN is also what the
//   UI shows when the 15m feed itself is down (the live view unsyncs).
//   A stale green can never survive a feed failure.
// STEP 1 — VWMA. If vwma is null, the result is NONE/yellow
//   (reason 'vwma_null', margin 0). Preserved from the old engine.
// STEP 2 — REGIME (computed from ADX + HTF + price vs VWMA, same
//   thresholds the old engine used):
//     FLASH_CRASH       if htf red AND price < vwma AND adx > 35
//     MARKET_CHOP       else if adx < 20
//     BULL_TREND_DRIFT  else if htf green AND price > vwma AND adx > 45
//     RANGE_BOUND_SUPPORT otherwise
// STEP 3 — FLASH CRASH: NO new positions in EITHER direction.
//   Long sit-out is preserved from the old engine. Shorts are ALSO
//   blocked in a cascade (see PHASE2_NOTES.md "flash-crash short rule"
//   for the rationale and the flagged alternative). uiSignal is 'red'
//   for display, but state is NONE so the dispatcher never fires.
// STEP 4 — HOOKS (both directions; the short side mirrors the long side):
//     standardLong  = cciUp && fishUp && bullishCandle
//     slowBullLong  = tenkRising2Candles && volumeGateMet   (>= 25k 15m vol)
//     standardShort = cciDown && fishDown && bearishCandle
//     slowBearShort = tenkFalling2Candles && volumeGateMet
//   The slow-bull hook is the user's deliberate design for a slowly
//   moving bull market: Tenkan rising 2 bars + institutional volume.
//   The slow-bear hook is its mirror for a slowly moving bear market
//   (penny-wide moves in a temporary bear market).
// STEP 5 — CONFIRMATION. Long requires consecutiveGreen5m >= 2; short
//   requires consecutiveRed5m >= 2. Confirmation counts are inputs: the
//   live view computes them from real closed 5m bars; the synthetic
//   backtest proxies them from 15m bars (documented, fiveMinProxy=true);
//   the real-klines verification backtest uses real 5m bars.
//   CHANGED FROM THE OLD ENGINE: an omitted count used to default to 2
//   (auto-confirmed). Now an omitted count is 0 (unconfirmed). A caller
//   that forgets confirmation can no longer silently auto-confirm.
// STEP 6 — CONFLICT. If both a long and a short trigger fire on the same
//   bar (pathological; the hooks are near-mutually exclusive), the
//   result is NONE with reason 'conflicting_hooks'. Never guess.
// STEP 7 — SIZING (tier table = src/engine/tiers.ts, the single source
//   of truth; the server CJS table mirrors it and tests enforce parity):
//     margin: T1 min(balance, $25), T2 min(balance*0.50, $100),
//             T3 min(balance*0.40, $250), $5 floor (balances below the
//             $10 server lockout are rejected server-side anyway).
//     tp1Dist: 0.35 standard.
//     tp2Dist: BULL max(1.20, 1.50x ATR); RANGE tier tp2; CHOP tier tp2 x 0.75.
//     slCoeff: tier slAtrMult (1.2/1.5/1.5).
//     tp1Percent/tp2Percent: 30/70. Leverage: tier BASE leverage
//     (20/35/50); the server still applies its +10x boost on
//     BULL_TREND_DRIFT / GRADE_A, so reachable max stays 60x.
//   CHOP SIZING (the Phase 2 change the user asked for — chop is TRADED,
//   not sat out): margin x 0.50, tp1Dist tightened to 0.20, tp2Dist
//   x 0.75, stops UNCHANGED (ATR-based; tightening stops in chop would
//   increase noise stop-outs), and the keeper exits chop trades faster
//   (2-bar / 0.10-adverse stagnation instead of 3-bar / 0.15).
//   Rationale: chop mean-reverts, so smaller targets capture range
//   extremes; halved size halves dollar risk; the tighter TP1 is what
//   makes chop trades fee-viable (see the fee guard in bot-service.cjs).
// STEP 8 — ENTRY OFFSET (preserved from the old engine, mirrored for
//   shorts; the server adds the offset for shorts, subtracts for longs):
//     candle momentum (close within 0.10% of the favorable extreme)
//       -> 0.00 post-only best bid.
//     ATR < 0.35 -> 0.10x ATR, clamped to 0.03-0.05 (penny scale).
//     otherwise  -> 0.25x ATR, clamped to 0.08-0.20.
//   The ATR-tightened offsets are what make penny-wide moves tradable:
//   a 3-5c offset on a compressed tape instead of a fixed 8c+ pullback.
//
// WHAT DOES *NOT* GATE A SIGNAL (display/grading only, same as before):
//   atrOK (ATR expanding), adxOK (ADX > 45), sessionOK, fisherCrossUp,
//   adxTrending, volConfirmed (grading fallback), isExhaustionReversal.
//   There is NO session gate, NO HTF-green requirement for longs in
//   RANGE, and NO volume requirement on the standard hooks. The old
//   ADX < 12 ultra-low overlay (which forced yellow + margin 0 on top
//   of the ADX < 20 chop classification) is REMOVED as redundant:
//   ADX < 12 already implies ADX < 20, i.e. chop sizing, not a sit-out.
//
// SERVER CONTRACT: the live view posts this result to /signal. The
// server accepts a SHORT only when the payload carries designedShort
// (this result's designedShort === true) plus the short hook fields —
// never for an arbitrary red payload. See bot-service.cjs allowlist.

import { getCanonicalTierForBalance } from './tiers.ts';

export type TriggerRegime =
  | 'FLASH_CRASH'
  | 'MARKET_CHOP'
  | 'RANGE_BOUND_SUPPORT'
  | 'BULL_TREND_DRIFT';

export type TriggerState = 'LONG' | 'SHORT' | 'NONE' | 'UNKNOWN';
export type TriggerUiSignal = 'green' | 'red' | 'yellow' | 'unknown';

export interface TriggerInputs {
  price: number;
  vwma: number | null;
  atr: number;
  adx: number;
  prevAdx?: number | null;
  htfSignal: 'green' | 'yellow' | 'red';
  // Long hooks
  cciUp: boolean;
  fishUp: boolean;
  bullishCandle: boolean;
  tenkRising2Candles: boolean;
  // Shared volume gate (15m volume >= 25k)
  volumeGateMet: boolean;
  // Short hooks (mirror of the long hooks)
  cciDown: boolean;
  fishDown: boolean;
  bearishCandle: boolean;
  tenkFalling2Candles: boolean;
  // 5m confirmation (counts of consecutive closed 5m bars in direction)
  consecutiveGreen5m?: number;
  consecutiveRed5m?: number;
  /** False when the 5m feed is missing/failed. Never silently block: UNKNOWN. */
  fiveMinFeedOk: boolean;
  /** True only when confirmation counts are proxied (synthetic backtest), never live. */
  fiveMinProxy?: boolean;
  balance: number;
  candleHigh?: number;
  candleLow?: number;
  candleClose?: number;
  // Grading only (never gating)
  bullDiv?: boolean;
  bearDiv?: boolean;
  cciAccel?: boolean;
  volConfirmed?: boolean;
}

export interface TriggerResult {
  state: TriggerState;
  uiSignal: TriggerUiSignal;
  direction: 'long' | 'short' | null;
  /** True only for a canonical designed short — the server's allowlist marker. */
  designedShort: boolean;
  regime: TriggerRegime;
  reason: string;
  hooks: {
    standardLong: boolean;
    slowBullLong: boolean;
    standardShort: boolean;
    slowBearShort: boolean;
  };
  confirmation: {
    required: number;
    long: number;
    short: number;
    longOk: boolean;
    shortOk: boolean;
    proxy: boolean;
  };
  feedOk: boolean;
  tier: 'TIER_1' | 'TIER_2' | 'TIER_3';
  leverage: number; // BASE tier leverage; server +10x boost rules still apply on top
  margin: number;
  marginMultiplier: number; // 1.0 standard, 0.5 in chop
  isChop: boolean;
  tp1Dist: number;
  tp2Dist: number;
  tp1Percent: number;
  tp2Percent: number;
  slCoeff: number;
  entryOffset: number;
  orderExecutionType: 'POST_ONLY_BEST_BID' | 'DYNAMIC_ATR_LIMIT';
  setupGrade: 'GRADE_A' | 'GRADE_B';
  adxSlope: 'rising' | 'falling' | 'flat';
  isExhaustionReversal: boolean;
  trailingStopOffset: number; // 1.2x ATR chandelier
  earlyProfitLock: number; // +$0.10 ratchet
  limitOrderTTLMinutes: number;
}

export const CHOP_MARGIN_MULTIPLIER = 0.5;
export const CHOP_TP1_DIST = 0.2;
export const CHOP_TP2_MULTIPLIER = 0.75;
export const CONFIRM_BARS_REQUIRED = 2;

export function classifyRegime(
  htfSignal: 'green' | 'yellow' | 'red',
  price: number,
  vwma: number,
  adx: number,
): TriggerRegime {
  if (htfSignal === 'red' && price < vwma && adx > 35) return 'FLASH_CRASH';
  if (adx < 20) return 'MARKET_CHOP';
  if (htfSignal === 'green' && price > vwma && adx > 45) return 'BULL_TREND_DRIFT';
  return 'RANGE_BOUND_SUPPORT';
}

export function evaluateTrigger(input: TriggerInputs): TriggerResult {
  const atr = input.atr || 0.35;
  const adx = input.adx !== undefined && input.adx !== null ? input.adx : 30;
  const tier = getCanonicalTierForBalance(input.balance);
  const tierId = tier.id;

  // ADX slope + exhaustion (display/grading only)
  let adxSlope: 'rising' | 'falling' | 'flat' = 'flat';
  if (input.prevAdx !== undefined && input.prevAdx !== null && input.prevAdx > 0) {
    const d = adx - input.prevAdx;
    if (d > 0.35) adxSlope = 'rising';
    else if (d < -0.35) adxSlope = 'falling';
    else adxSlope = 'flat';
  }
  const isExhaustionReversal = adx > 22 && adxSlope === 'falling';

  // Entry offset (preserved rules, mirrored for shorts via candleLow).
  // Momentum is direction-specific: longs need close near the high,
  // shorts need close near the low. The offset MAGNITUDE is the same.
  const cHigh = input.candleHigh;
  const cLow = input.candleLow;
  const cClose = input.candleClose;
  const longMomentum =
    cHigh !== undefined && cClose !== undefined && cHigh > 0 && cClose >= cHigh - 0.001 * cClose;
  const shortMomentum =
    cLow !== undefined && cClose !== undefined && cLow > 0 && cClose <= cLow + 0.001 * cClose;
  let entryOffset = 0.08;
  let orderExecutionType: 'POST_ONLY_BEST_BID' | 'DYNAMIC_ATR_LIMIT' = 'DYNAMIC_ATR_LIMIT';
  if (longMomentum || shortMomentum) {
    orderExecutionType = 'POST_ONLY_BEST_BID';
    entryOffset = 0.0;
  } else if (atr < 0.35) {
    entryOffset = Math.max(0.03, Math.min(Number((atr * 0.1).toFixed(2)), 0.05));
  } else {
    entryOffset = Math.max(0.08, Math.min(Number((atr * 0.25).toFixed(2)), 0.2));
  }

  // Base sizing from the canonical tier table.
  let margin =
    tierId === 'TIER_1'
      ? Math.min(input.balance, tier.defaultMargin)
      : tierId === 'TIER_2'
        ? Math.min(input.balance * 0.5, tier.defaultMargin)
        : Math.min(input.balance * 0.4, tier.defaultMargin);
  margin = Math.max(5.0, Number(margin.toFixed(2)));
  // The $10 server lockout rejects balances below $10 before any order,
  // so the $5 floor above can never over-commit a live account.

  const base: Omit<
    TriggerResult,
    'state' | 'uiSignal' | 'direction' | 'designedShort' | 'regime' | 'reason' | 'margin' | 'marginMultiplier' | 'isChop' | 'tp1Dist' | 'tp2Dist'
  > = {
    hooks: {
      standardLong: false,
      slowBullLong: false,
      standardShort: false,
      slowBearShort: false,
    },
    confirmation: {
      required: CONFIRM_BARS_REQUIRED,
      long: input.consecutiveGreen5m ?? 0,
      short: input.consecutiveRed5m ?? 0,
      longOk: false,
      shortOk: false,
      proxy: Boolean(input.fiveMinProxy),
    },
    feedOk: input.fiveMinFeedOk,
    tier: tierId,
    leverage: tier.leverage,
    tp1Percent: 30,
    tp2Percent: 70,
    slCoeff: tier.slAtrMult,
    entryOffset,
    orderExecutionType,
    setupGrade:
      ((input.volConfirmed || input.bullDiv || input.bearDiv) && input.cciAccel) || false
        ? 'GRADE_A'
        : 'GRADE_B',
    adxSlope,
    isExhaustionReversal,
    trailingStopOffset: Number((atr * 1.2).toFixed(2)),
    earlyProfitLock: 0.1,
    limitOrderTTLMinutes: 15,
  };

  // STEP 0 — feed. UNKNOWN, never a silent block, never a stale green.
  if (!input.fiveMinFeedOk) {
    return {
      ...base,
      state: 'UNKNOWN',
      uiSignal: 'unknown',
      direction: null,
      designedShort: false,
      regime: input.vwma == null ? 'MARKET_CHOP' : classifyRegime(input.htfSignal, input.price, input.vwma, adx),
      reason: 'feed_5m_unavailable',
      margin: 0,
      marginMultiplier: 0,
      isChop: false,
      tp1Dist: tier.tp1Dist,
      tp2Dist: tier.tp2Dist,
    };
  }

  // STEP 1 — VWMA null => NONE/yellow (preserved).
  if (input.vwma == null) {
    return {
      ...base,
      state: 'NONE',
      uiSignal: 'yellow',
      direction: null,
      designedShort: false,
      regime: 'MARKET_CHOP',
      reason: 'vwma_null',
      margin: 0,
      marginMultiplier: 0,
      isChop: false,
      tp1Dist: tier.tp1Dist,
      tp2Dist: tier.tp2Dist,
    };
  }

  const regime = classifyRegime(input.htfSignal, input.price, input.vwma, adx);
  const isChop = regime === 'MARKET_CHOP';

  // STEP 3 — flash crash: no new positions either direction.
  if (regime === 'FLASH_CRASH') {
    return {
      ...base,
      state: 'NONE',
      uiSignal: 'red',
      direction: null,
      designedShort: false,
      regime,
      reason: 'flash_crash_sitout',
      margin: 0,
      marginMultiplier: 0,
      isChop: false,
      tp1Dist: tier.tp1Dist,
      tp2Dist: tier.tp2Dist,
    };
  }

  // STEP 4 — hooks.
  const standardLong = input.cciUp && input.fishUp && input.bullishCandle;
  const slowBullLong = input.tenkRising2Candles && input.volumeGateMet;
  const standardShort = input.cciDown && input.fishDown && input.bearishCandle;
  const slowBearShort = input.tenkFalling2Candles && input.volumeGateMet;
  const hooks = { standardLong, slowBullLong, standardShort, slowBearShort };

  // STEP 5 — confirmation (omitted counts are 0 = unconfirmed; the old
  // default-to-2 auto-confirm is gone by design).
  const longCount = input.consecutiveGreen5m ?? 0;
  const shortCount = input.consecutiveRed5m ?? 0;
  const longOk = longCount >= CONFIRM_BARS_REQUIRED;
  const shortOk = shortCount >= CONFIRM_BARS_REQUIRED;

  const longTrigger = (standardLong || slowBullLong) && longOk;
  const shortTrigger = (standardShort || slowBearShort) && shortOk;

  // STEP 7 — sizing (chop multipliers applied here, not in the server).
  const marginMultiplier = isChop ? CHOP_MARGIN_MULTIPLIER : 1.0;
  const sizedMargin = Number((margin * marginMultiplier).toFixed(2));
  let tp1Dist = tier.tp1Dist;
  let tp2Dist = tier.tp2Dist;
  if (isChop) {
    tp1Dist = CHOP_TP1_DIST;
    tp2Dist = Number((tier.tp2Dist * CHOP_TP2_MULTIPLIER).toFixed(2));
  } else if (regime === 'BULL_TREND_DRIFT') {
    tp2Dist = Math.max(1.2, Number((atr * 1.5).toFixed(2)));
  }

  const confirmation = {
    required: CONFIRM_BARS_REQUIRED,
    long: longCount,
    short: shortCount,
    longOk,
    shortOk,
    proxy: Boolean(input.fiveMinProxy),
  };

  // STEP 6 — conflict: never guess.
  if (longTrigger && shortTrigger) {
    return {
      ...base,
      hooks,
      confirmation,
      state: 'NONE',
      uiSignal: 'yellow',
      direction: null,
      designedShort: false,
      regime,
      reason: 'conflicting_hooks',
      margin: 0,
      marginMultiplier: 0,
      isChop,
      tp1Dist,
      tp2Dist,
    };
  }

  if (longTrigger) {
    return {
      ...base,
      hooks,
      confirmation,
      state: 'LONG',
      uiSignal: 'green',
      direction: 'long',
      designedShort: false,
      regime,
      reason: slowBullLong && !standardLong ? 'tenkan_2candles_volume_gate_long' : 'reversal_hook_long',
      margin: sizedMargin,
      marginMultiplier,
      isChop,
      tp1Dist,
      tp2Dist,
    };
  }

  if (shortTrigger) {
    return {
      ...base,
      hooks,
      confirmation,
      state: 'SHORT',
      uiSignal: 'red',
      direction: 'short',
      designedShort: true,
      regime,
      reason: slowBearShort && !standardShort ? 'tenkan_2candles_volume_gate_short' : 'reversal_hook_short',
      margin: sizedMargin,
      marginMultiplier,
      isChop,
      tp1Dist,
      tp2Dist,
    };
  }

  return {
    ...base,
    hooks,
    confirmation,
    state: 'NONE',
    uiSignal: 'yellow',
    direction: null,
    designedShort: false,
    regime,
    reason: isChop ? 'chop_no_trigger' : 'insufficient_alignment',
    margin: 0,
    marginMultiplier: 0,
    isChop,
    tp1Dist,
    tp2Dist,
  };
}
