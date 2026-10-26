// src/engine/tiers.ts
// CANONICAL TIER TABLE — Phase 2 single source of truth.
//
// Before Phase 2, three tables disagreed (audit §5/§6):
//   frontend autoSwitcher.ts: tp2Dist 0.55/0.70/0.85, slAtrMult 1.8/1.6/1.5, tp1Dist T1 0.30
//   server switcher:         tp2Dist 0.32/0.65/0.85, slAtrMult 1.2/1.5/1.5, tp1Dist T1 0.18, tp2AtrMult 0.55/0.85/1.20
//   backtest autoSwitch:     tp2 max(0.55, ATR*0.85)/max(0.70, ATR*1.00)/max(0.85, ATR*1.20), sl 1.2/1.5/1.5
// The values below are the unified table. They are the values the live
// engine displayed (tp1 0.35, TP2 0.55/0.70/0.85) and the backtest used,
// with the server's divergent numbers corrected to match. Behavior
// changes vs the old server table (documented, intended):
//   T1 tp1Dist 0.18 -> 0.35 (the canonical engine always supplied 0.35
//     through the dispatcher payload, so live T1 orders were already
//     sized at 0.35; only the no-payload fallback path changes).
//   T1/T2 tp2Dist 0.32/0.65 -> 0.55/0.70 (matches UI + backtest).
//   T1/T2 tp2AtrMult 0.55/0.85 -> 0.85/1.00 (matches frontend + backtest).
//   Frontend slAtrMult 1.8/1.6 -> 1.2/1.5 (matches server + backtest).
// Leverage is UNCHANGED by Phase 2 (task constraint): base 20/35/50, and
// the server still adds its +10x boost on BULL_TREND_DRIFT / GRADE_A, so
// the maximum reachable leverage stays 60x. Every UI claim of a "40x
// cap" was false and has been corrected to 60x. Risk caps are 3%/5%/10%
// (the old "1% cap / -$0.30" copy was false; the true Tier 1 cap is 3%,
// -$0.90 on a $30 balance).
//
// The CJS server table (server_strategy_auto_switcher.cjs TIERS) is a
// field-for-field mirror of this table. tests/tier-parity.test.cjs
// asserts they agree; if you edit one, edit the other and run the test.

export interface CanonicalTier {
  id: 'TIER_1' | 'TIER_2' | 'TIER_3';
  legacyId: 'TIER_1_MICRO' | 'TIER_2_HYBRID' | 'TIER_3_ALPHA';
  name: string;
  minBalance: number;
  maxBalance: number;
  leverage: number;
  riskCapPct: number;
  maxRiskDollarCap: number;
  tp1Dist: number;
  tp2Dist: number;
  tp2AtrMult: number;
  slAtrMult: number;
  defaultMargin: number;
  compoundRate: number;
  description: string;
}

export const CANONICAL_TIERS: Record<'TIER_1' | 'TIER_2' | 'TIER_3', CanonicalTier> = {
  TIER_1: {
    id: 'TIER_1',
    legacyId: 'TIER_1_MICRO',
    name: 'Peak Win Rate Mode (20x)',
    minBalance: 0,
    maxBalance: 99.9999,
    leverage: 20,
    riskCapPct: 0.03, // 3% Tiered Risk Cap (-$0.90 max loss on $30 balance)
    maxRiskDollarCap: 3.0, // -$3.00 max loss
    tp1Dist: 0.35,
    tp2Dist: 0.55,
    tp2AtrMult: 0.85,
    slAtrMult: 1.2,
    defaultMargin: 25.0, // $25.00 collateral on $30 balance -> $500.00 notional at 20x
    compoundRate: 0.833, // 83.3% wallet collateral utilization ($25 on $30)
    description:
      'Capital preservation for micro-balances ($0-$100). Capped at 3% equity risk (-$0.90 max loss on $30 balance) with $25.00 margin collateral at 20x leverage ($500.00 position size). Maximum reachable leverage with the +10x boost is 30x.',
  },
  TIER_2: {
    id: 'TIER_2',
    legacyId: 'TIER_2_HYBRID',
    name: 'Hybrid Scaling Tier (35x)',
    minBalance: 100.0,
    maxBalance: 249.9999,
    leverage: 35,
    riskCapPct: 0.05, // 5% Tiered Risk Cap (-$5.00 max loss on $100 balance)
    maxRiskDollarCap: 12.5, // -$12.50 max loss
    tp1Dist: 0.35,
    tp2Dist: 0.7,
    tp2AtrMult: 1.0,
    slAtrMult: 1.5,
    defaultMargin: 50.0, // $50.00 collateral on $100 balance -> $1,750.00 notional at 35x
    compoundRate: 0.5,
    description:
      'Balanced acceleration for intermediate balances ($100-$250). Capped at 5% equity risk (-$5.00 max loss on $100) with $50.00 margin collateral at 35x leverage ($1,750 total position). Maximum reachable leverage with the +10x boost is 45x.',
  },
  TIER_3: {
    id: 'TIER_3',
    legacyId: 'TIER_3_ALPHA',
    name: 'Max Alpha Mode (50x)',
    minBalance: 250.0,
    maxBalance: Infinity,
    leverage: 50,
    riskCapPct: 0.1, // 10% Tiered Risk Cap (-$25.00 max loss on $250 balance)
    maxRiskDollarCap: 50.0, // -$50.00 max loss
    tp1Dist: 0.35,
    tp2Dist: 0.85,
    tp2AtrMult: 1.2,
    slAtrMult: 1.5,
    defaultMargin: 100.0, // $100.00 collateral on $250 balance -> $5,000.00 notional at 50x
    compoundRate: 0.4,
    description:
      'Maximum velocity compounding for accounts $250+. Capped at 10% equity risk (-$25.00 max loss on $250) with $100.00 collateral at 50x leverage ($5,000 total position). Maximum reachable leverage with the +10x boost is 60x.',
  },
};

export function getCanonicalTierForBalance(balance: number): CanonicalTier {
  const bal = Math.max(0, balance || 0);
  if (bal < 100.0) return CANONICAL_TIERS.TIER_1;
  if (bal < 250.0) return CANONICAL_TIERS.TIER_2;
  return CANONICAL_TIERS.TIER_3;
}

/** Maximum base leverage across tiers (50x); with the server +10x boost the reachable max is 60x. */
export const MAX_BASE_LEVERAGE = 50;
/** Maximum reachable leverage after the server +10x boost (unchanged by Phase 2). */
export const MAX_REACHABLE_LEVERAGE = 60;
