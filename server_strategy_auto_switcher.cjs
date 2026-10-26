// server_strategy_auto_switcher.cjs
// Dynamic Regime-Optimized Strategy Auto-Preset Switcher
// Automatically switches trading presets, leverage tiers, risk caps, and profit targets
// based on real-time account equity tiers and enforces the 2-Loss Chop Circuit Breaker.

/**
 * Tier Specifications:
 * Tier 1: $0.00 - $99.99     -> Peak Win Rate Mode (20x LSD, 1% Risk Cap max -$1.00 [-$0.30 on $30 bal], Margin = $25.00 Collateral -> Position Size $500.00 [4.27 SOL], TP2 +0.55 / +0.85 ATR)
 * Tier 2: $100.00 - $249.99 -> Hybrid Scaling Tier (35x, 5% Risk Cap max -$12.50 [-$5.00 on $100 bal], Margin = $50.00 Collateral -> Position Size $1,750.00, TP2 +0.70 / +1.00 ATR)
 * Tier 3: $250.00+          -> Max Alpha Mode (50x/60x, 10% Risk Cap max -$50.00 [-$25.00 on $250 bal], Margin = $100.00 Collateral -> Position Size $5,000.00, TP2 +0.85 / +1.20 ATR)
 */

const TIERS = {
  TIER_1_MICRO: {
    id: 'TIER_1_MICRO',
    name: 'Peak Win Rate Mode (20x LSD)',
    minBalance: 0,
    maxBalance: 99.9999,
    maxOpenPositions: 1, // $0 - $99.99 allows strictly 1 position
    leverage: 20,
    riskCapPct: 0.03, // 3% equity risk (-$0.90 max loss on a $30 starting balance)
    maxRiskDollarCap: 3.00, // Maximum -$3.00 loss
    tp1Dist: 0.18, // Calibrated +18¢ quick scalp TP (locks profit on 20x leverage)
    tp2Dist: 0.32, // Calibrated +32¢ runner target (+0.55 ATR)
    tp2AtrMult: 0.55,
    slAtrMult: 1.2,
    defaultMargin: 25.00, // Margin is committed collateral from wallet ($25.00 collateral on $30 balance)
    defaultPositionSize: 500.00, // Position Size (Notional) = $25 * 20x = $500.00
    compoundRate: 0.833, // 83.3% wallet collateral utilization ($25 on $30)
    description: 'Capital preservation for micro-balances ($0-$100). Capped at 3% equity risk (-$0.90 max loss on $30 balance) with $25.00 margin collateral at 20x leverage ($500.00 position size / ~4.27 SOL).',
  },
  TIER_2_HYBRID: {
    id: 'TIER_2_HYBRID',
    name: 'Hybrid Scaling Tier (35x)',
    minBalance: 100.00,
    maxBalance: 249.9999,
    maxOpenPositions: 2, // $100 - $249.99 allows up to 2 positions
    leverage: 35,
    riskCapPct: 0.05, // 5% equity risk (-$5.00 max loss on $100 balance)
    maxRiskDollarCap: 12.50, // Maximum -$12.50 loss
    tp1Dist: 0.35,
    tp2Dist: 0.65, // Calibrated +0.85 ATR runner target
    tp2AtrMult: 0.85,
    slAtrMult: 1.5,
    defaultMargin: 50.00, // Margin is committed collateral from wallet ($50.00 on $100 balance)
    defaultPositionSize: 1750.00, // Position Size (Notional) = $50 * 35x = $1,750.00
    compoundRate: 0.50,
    description: 'Balanced acceleration for intermediate balances ($100-$250). Capped at 5% equity risk (-$5.00 max loss on $100) with $50.00 margin collateral at 35x leverage ($1,750 total position).',
  },
  TIER_3_ALPHA: {
    id: 'TIER_3_ALPHA',
    name: 'Max Alpha Mode (50x)',
    minBalance: 250.00,
    maxBalance: Infinity,
    maxOpenPositions: 3, // $250+ allows up to 3 positions
    leverage: 50,
    riskCapPct: 0.10, // 10% equity risk (-$25.00 max loss on $250 balance)
    maxRiskDollarCap: 50.00, // Maximum -$50.00 loss
    tp1Dist: 0.35,
    tp2Dist: 0.85, // Calibrated +1.20 ATR runner target
    tp2AtrMult: 1.20,
    slAtrMult: 1.5,
    defaultMargin: 100.00, // Margin is committed collateral from wallet ($100.00 on $250 balance)
    defaultPositionSize: 5000.00, // Position Size (Notional) = $100 * 50x = $5,000.00
    compoundRate: 0.40,
    description: 'Maximum velocity compounding for accounts $250+. Capped at 10% equity risk (-$25.00 max loss on $250) with $100.00 collateral at 50x leverage ($5,000 total position).',
  },
};

// Internal Switcher State
const state = {
  enabled: true,
  currentBar: 0,
  tradeHistory: [],
  recentLossBars: [],
  consecutiveLosses: 0,
  standbyBarsRemaining: 0,
  circuitBreakerActive: false,
  lastTriggerReason: null,
};

/**
 * Resolves the active preset based on current account equity.
 * @param {number} balance Current wallet/account equity in USD
 * @returns {object} Tier definition
 */
function getPresetForBalance(balance) {
  const bal = Math.max(0, parseFloat(balance) || 0);
  if (bal < 100.00) {
    return TIERS.TIER_1_MICRO;
  }
  if (bal < 250.00) {
    return TIERS.TIER_2_HYBRID;
  }
  return TIERS.TIER_3_ALPHA;
}

/**
 * Advance current market bar index (e.g. on new 15m candle)
 * Decrements circuit breaker standby if active.
 */
function tickBar(barIndex) {
  if (typeof barIndex === 'number') {
    state.currentBar = barIndex;
  } else {
    state.currentBar += 1;
  }

  if (state.standbyBarsRemaining > 0) {
    state.standbyBarsRemaining -= 1;
    if (state.standbyBarsRemaining <= 0) {
      state.circuitBreakerActive = false;
      state.lastTriggerReason = 'Standby completed. Engine resumed.';
      console.log(`[CIRCUIT BREAKER] 5-bar Yellow Standby concluded. Engine resumed to Normal Active Mode.`);
    }
  }
}

/**
 * Evaluates an incoming trade signal against the auto-switcher tier and circuit breaker rules.
 * @param {object} currentSignal Incoming signal parameters (price, direction, asset, atr, etc.)
 * @param {number} accountBalance Current account equity in USD
 * @param {number} [barIndex] Current candle index
 * @returns {object} Trade decision object
 */
function evaluateTradeSignal(currentSignal = {}, accountBalance = 240, barIndex) {
  if (typeof barIndex === 'number') {
    tickBar(barIndex);
  }

  const balance = Math.max(0, parseFloat(accountBalance) || 0);
  const preset = getPresetForBalance(balance);

  // 1. Check Circuit Breaker (2-Loss Chop Circuit Breaker -> 5-bar Sit-Out)
  if (state.circuitBreakerActive && state.standbyBarsRemaining > 0) {
    return {
      execute: false,
      reason: `CIRCUIT_BREAKER_ACTIVE: 2 consecutive losses within 10 bars. In Yellow Standby Mode (${state.standbyBarsRemaining} bars remaining).`,
      preset,
      tier: preset.id,
      balance,
      circuitBreaker: {
        active: true,
        standbyBarsRemaining: state.standbyBarsRemaining,
        consecutiveLosses: state.consecutiveLosses,
      },
    };
  }

  // 2. Minimum Account Lockout Check ($10 Jupiter safety lockout)
  if (balance < 10.00) {
    return {
      execute: false,
      reason: `LOCKOUT_FLOOR_HIT: Account balance $${balance.toFixed(2)} is below the minimum $10.00 Jupiter safety lockout.`,
      preset,
      tier: preset.id,
      balance,
      circuitBreaker: { active: false, standbyBarsRemaining: 0, consecutiveLosses: state.consecutiveLosses },
    };
  }

  // 2.1 Ultra-Low ADX Filter (ADX < 12 with Volume > 35K -> Forced Yellow Standby / 0x Leverage Sit-Out)
  const adxVal = parseFloat(currentSignal.adx) || 25;
  const volVal = parseFloat(currentSignal.volume) || 0;
  if (adxVal < 12 && (volVal > 35000 || currentSignal.volOK)) {
    return {
      execute: false,
      reason: `ULTRA_LOW_ADX_CHOP: ADX (14) = ${adxVal.toFixed(1)} < 12 with Volume > 35K. Forcing Yellow Standby / 0x Leverage Sit-Out.`,
      preset,
      tier: preset.id,
      balance,
      circuitBreaker: { active: false, standbyBarsRemaining: 0, consecutiveLosses: state.consecutiveLosses },
    };
  }

  // 2.2 Regime-Optimized Base Leverage Adjusters & 0x Sit-Out
  const regime = currentSignal.regime || 'RANGE_BOUND_SUPPORT';
  const setupGrade = currentSignal.setupGrade || 'GRADE_B';
  const signalType = (currentSignal.direction || currentSignal.signal || 'green').toLowerCase();

  // 0x Sit-Out during Market Chop or Yellow Standby
  if (regime === 'MARKET_CHOP' || signalType === 'yellow' || signalType === 'standby') {
    return {
      execute: false,
      reason: `MARKET_CHOP_SITOUT: Regime is ${regime} / Signal is ${signalType}. 0x Leverage Sit-Out enforced.`,
      preset,
      tier: preset.id,
      balance,
      circuitBreaker: { active: false, standbyBarsRemaining: 0, consecutiveLosses: state.consecutiveLosses },
    };
  }

  let effectiveLeverage = preset.leverage;
  // +10x Boost on Bull Trend Drift / Grade A setups (e.g. 20x -> 30x)
  if (regime === 'BULL_TREND_DRIFT' || setupGrade === 'GRADE_A') {
    effectiveLeverage += 10;
  }
  // -10x Reduction on Counter-Trend / Flash Crash setups (e.g. 20x -> 10x)
  else if (regime === 'FLASH_CRASH_VOLATILITY' || regime === 'BEAR_TREND' || setupGrade === 'GRADE_C') {
    effectiveLeverage = Math.max(5, effectiveLeverage - 10);
  }

  // Manual UI Override: support manual UI leverage adjustment offsets (manualLeverageOffset)
  if (typeof currentSignal.manualLeverageOffset === 'number' && !isNaN(currentSignal.manualLeverageOffset)) {
    effectiveLeverage = Math.max(5, Math.min(60, effectiveLeverage + currentSignal.manualLeverageOffset));
  }

  // 2.3 Bar Confirmation on 5-Minute Chart (Volume > 25K Gate)
  // When signal volume > 25K (or volume gate is met), require 2-Bar Confirmation on the 5 min chart
  const barConfirm = typeof currentSignal.barConfirmation === 'number'
    ? currentSignal.barConfirmation
    : typeof currentSignal.consecutiveGreen === 'number'
    ? currentSignal.consecutiveGreen
    : 2;
  const volNumber = parseFloat(currentSignal.volNumber || currentSignal.volume) || 0;
  if ((volNumber >= 25000 || currentSignal.volumeGateMet) && barConfirm < 2) {
    return {
      execute: false,
      reason: `WAITING_5M_BAR_CONFIRMATION: Signal volume >= 25k (${volNumber >= 1e3 ? (volNumber / 1e3).toFixed(1) + 'k' : volNumber}) requires 2-Bar Confirmation on 5m chart (currently ${barConfirm}/2 bars).`,
      preset,
      tier: preset.id,
      balance,
      circuitBreaker: { active: false, standbyBarsRemaining: 0, consecutiveLosses: state.consecutiveLosses },
    };
  }

  // 3. Compute Scalable Stop Loss Risk Cap for this Trade
  // Tier 1: 3% equity risk (-$0.90 max loss on a $30 starting balance)
  // Tier 2: 5% equity risk (-$5.00 max loss on $100 balance)
  // Tier 3: 10% equity risk (-$25.00 max loss on $250 balance)
  const equityRiskDollar = balance * preset.riskCapPct;
  const maxDollarLoss = Math.max(0.25, Math.min(equityRiskDollar, preset.maxRiskDollarCap));

  // 4. Correct Sizing for Wallet: Margin (Collateral) vs Position Size (Notional)
  // Margin is committed collateral from the wallet (e.g. $25.00 on a $30.00 balance)
  // Position Size (Notional) is Margin * Leverage ($25 * 20x = $500.00 total position)
  // Tokens is Position Size / entryPrice (~4.27 SOL at ~$117.00)
  let marginUsd = 0;
  if (preset.id === 'TIER_1_MICRO') {
    // Micro balance ($0-$100): Margin collateral capped at $25.00 ($25 collateral on $30 balance)
    marginUsd = Math.min(balance, 25.00);
  } else if (preset.id === 'TIER_2_HYBRID') {
    // Hybrid balance ($100-$250): 50% compounding collateral capped at $100.00
    marginUsd = Math.min(balance * 0.50, 100.00);
  } else {
    // Alpha balance ($250+): 40% compounding collateral capped at $250.00
    marginUsd = Math.min(balance * 0.40, 250.00);
  }

  // Ensure minimum viable collateral floor ($5 minimum floor, not exceeding balance)
  marginUsd = Math.max(5.00, Math.min(balance, marginUsd));

  const margin = parseFloat(marginUsd.toFixed(2));
  // Position Size (Notional) is Margin * Leverage ($25 * 20x = $500.00 total position)
  const positionSizeUsd = parseFloat((margin * effectiveLeverage).toFixed(2));
  const notional = positionSizeUsd;

  // 5. Dynamic Targets (Fee-Neutral TP1 and Dynamic TP2)
  const price = parseFloat(currentSignal.price) || 140.0;
  const curATR = parseFloat(currentSignal.atr) || 0.35;
  const tp1Dist = parseFloat(currentSignal.tp1) || preset.tp1Dist;
  
  // Extended TP2 (1.50x ATR / +$1.20) on Bull Trend Drift / strong trend setups
  const isTrendDrift = regime === 'BULL_TREND_DRIFT' || currentSignal.htfSignal === 'green';
  const dynamicTp2FromAtr = isTrendDrift 
    ? Math.max(1.20, curATR * 1.50)
    : curATR * preset.tp2AtrMult;
  const tp2Dist = parseFloat(currentSignal.tp2) || Math.max(preset.tp2Dist, dynamicTp2FromAtr);

  // Asymmetric TP Scaling (30/70): 30% banked at TP1, 70% runner to Extended TP2
  const tp1Percent = currentSignal.tp1Percent !== undefined 
    ? parseFloat(currentSignal.tp1Percent) 
    : 30;
  const tp2Percent = currentSignal.tp2Percent !== undefined 
    ? parseFloat(currentSignal.tp2Percent) 
    : 70;

  // 6. Stop Loss distance calculation with strict equity risk cap clamp
  const slAtrDist = curATR * preset.slAtrMult;
  const fullFeeEst = notional * 0.0008; // 0.08% roundtrip fee
  const approxPrice = price > 0 ? price : 116.65;
  const initialTokens = notional / approxPrice;
  
  // Max price distance allowed before loss exceeds maxDollarLoss:
  // (slPriceDist * tokens) + fullFeeEst <= maxDollarLoss
  const maxLossPriceDist = initialTokens > 0 && maxDollarLoss > fullFeeEst
    ? (maxDollarLoss - fullFeeEst) / initialTokens
    : slAtrDist;
  const effectiveSlDist = Math.min(slAtrDist, maxLossPriceDist);

  const direction = (currentSignal.direction || currentSignal.side || 'Long').toLowerCase();
  const isLong = direction === 'long' || direction === 'buy' || direction === 'green';

  // 2. Candle Momentum Detection: Close >= High - (0.0010 * Close)
  const barClose = parseFloat(currentSignal.candleClose || currentSignal.close || price);
  const barHigh = parseFloat(currentSignal.candleHigh || currentSignal.high || price);
  const candleMomentum = currentSignal.candleMomentum !== undefined
    ? Boolean(currentSignal.candleMomentum)
    : (barHigh > 0 && barClose >= (barHigh - (0.0010 * barClose)));

  // 3 & 4. Dynamic Offset Calculation:
  // When Candle Momentum is detected, abandon deep limit pullback offsets (0.25 * ATR).
  // Places a Post-Only Limit Order directly at the Best Bid at bar close (0.00 offset / maker rebates / zero-fee pricing).
  // When Candle Momentum is not active, but volatility is compressed (ATR < $0.35),
  // limit offset drops from 0.25 * ATR down to 0.10 * ATR (3¢ - 5¢ below close).
  let entryOffset = 0.00;
  let executionType = 'POST_ONLY_BEST_BID';

  if (candleMomentum) {
    executionType = 'POST_ONLY_BEST_BID';
    entryOffset = 0.00; // Directly at best bid at bar close
  } else if (curATR < 0.35) {
    executionType = 'DYNAMIC_ATR_LIMIT';
    // Offset drops from 0.25 * ATR down to 0.10 * ATR (3¢ - 5¢ below close)
    entryOffset = Math.max(0.03, Math.min(parseFloat((curATR * 0.10).toFixed(2)), 0.05));
  } else {
    executionType = 'DYNAMIC_ATR_LIMIT';
    entryOffset = Math.max(0.08, Math.min(parseFloat((curATR * 0.25).toFixed(2)), 0.20));
  }

  if (currentSignal.entryOffset !== undefined && !isNaN(parseFloat(currentSignal.entryOffset))) {
    entryOffset = parseFloat(currentSignal.entryOffset);
  }

  const entryPrice = isLong ? price - entryOffset : price + entryOffset;
  const tokens = parseFloat((notional / entryPrice).toFixed(4));
  const stopLoss = isLong ? entryPrice - effectiveSlDist : entryPrice + effectiveSlDist;
  const takeProfit1 = isLong ? entryPrice + tp1Dist : entryPrice - tp1Dist;
  const takeProfit2 = isLong ? entryPrice + tp2Dist : entryPrice - tp2Dist;

  return {
    execute: true,
    preset: {
      name: preset.name,
      tier: preset.id,
      description: preset.description,
      leverage: preset.leverage,
      riskCapPct: preset.riskCapPct,
      maxRiskDollarCap: preset.maxRiskDollarCap,
    },
    tier: preset.id,
    baseLeverage: preset.leverage,
    leverage: effectiveLeverage,
    maxMarginUsd: 500,
    maxSlippageBps: 5,
    margin: parseFloat(margin.toFixed(2)),
    notional: parseFloat(notional.toFixed(2)),
    positionSizeUsd: parseFloat(notional.toFixed(2)),
    tokens,
    candleMomentum,
    executionType,
    entryOffset: parseFloat(entryOffset.toFixed(4)),
    entryPrice: parseFloat(entryPrice.toFixed(4)),
    stopLoss: parseFloat(stopLoss.toFixed(4)),
    tp1: parseFloat(takeProfit1.toFixed(4)),
    tp2: parseFloat(takeProfit2.toFixed(4)),
    tp1Dist: parseFloat(tp1Dist.toFixed(4)),
    tp2Dist: parseFloat(tp2Dist.toFixed(4)),
    tp1Percent,
    tp2Percent,
    maxDollarLoss: parseFloat(maxDollarLoss.toFixed(2)),
    effectiveSlDist: parseFloat(effectiveSlDist.toFixed(4)),
    circuitBreaker: {
      active: state.circuitBreakerActive,
      standbyBarsRemaining: state.standbyBarsRemaining,
      consecutiveLosses: state.consecutiveLosses,
    },
  };
}

/**
 * Called whenever a trade settles.
 * Evaluates consecutive losses to trigger the 2-Loss Chop Circuit Breaker.
 * @param {number} netPnlUsd Realized net profit/loss in USD
 * @param {object} [details] Optional trade info (exitBar, reason, etc.)
 */
function onTradeSettled(netPnlUsd, details = {}) {
  const pnl = parseFloat(netPnlUsd) || 0;
  const exitBar = typeof details.exitBar === 'number' ? details.exitBar : state.currentBar;

  state.tradeHistory.push({
    pnl,
    exitBar,
    timestamp: Date.now(),
    reason: details.reason || (pnl >= 0 ? 'WIN' : 'LOSS'),
  });

  if (pnl < 0) {
    state.recentLossBars.push(exitBar);
    state.consecutiveLosses += 1;

    // Check if 2 consecutive stop losses occurred within 10 bars
    if (state.recentLossBars.length >= 2) {
      const len = state.recentLossBars.length;
      const lastLossBar = state.recentLossBars[len - 1];
      const prevLossBar = state.recentLossBars[len - 2];

      if (lastLossBar - prevLossBar <= 10 && state.consecutiveLosses >= 2) {
        state.circuitBreakerActive = true;
        state.standbyBarsRemaining = 5;
        state.lastTriggerReason = `2 consecutive stop losses within 10 bars (bars ${prevLossBar} & ${lastLossBar}). Engaged 5-bar Yellow Standby Mode.`;
        console.warn(`⚠️ [CIRCUIT BREAKER TRIGGERED] ${state.lastTriggerReason}`);
      }
    }
  } else {
    // Win or breakeven reset consecutive loss count
    state.consecutiveLosses = 0;
  }

  return {
    circuitBreakerActive: state.circuitBreakerActive,
    standbyBarsRemaining: state.standbyBarsRemaining,
    consecutiveLosses: state.consecutiveLosses,
    lastTriggerReason: state.lastTriggerReason,
  };
}

/**
 * Returns full diagnostics of the auto-preset switcher.
 */
function getAutoSwitcherState(balance = 240) {
  const activePreset = getPresetForBalance(balance);
  return {
    enabled: state.enabled,
    balance: parseFloat(balance),
    activeTier: activePreset.id,
    activePreset,
    tiers: TIERS,
    circuitBreaker: {
      active: state.circuitBreakerActive,
      standbyBarsRemaining: state.standbyBarsRemaining,
      consecutiveLosses: state.consecutiveLosses,
      lastTriggerReason: state.lastTriggerReason,
      recentLossCount: state.recentLossBars.length,
    },
    currentBar: state.currentBar,
    totalTradesLogged: state.tradeHistory.length,
  };
}

/**
 * Manually reset the circuit breaker back to active state.
 */
function resetCircuitBreaker() {
  state.circuitBreakerActive = false;
  state.standbyBarsRemaining = 0;
  state.consecutiveLosses = 0;
  state.recentLossBars = [];
  state.lastTriggerReason = 'Manually reset by user.';
  console.log('[CIRCUIT BREAKER] Reset by operator. Returning to Active Ready state.');
}

module.exports = {
  TIERS,
  getPresetForBalance,
  evaluateTradeSignal,
  onTradeSettled,
  tickBar,
  getAutoSwitcherState,
  resetCircuitBreaker,
};
