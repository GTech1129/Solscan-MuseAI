// src/engine/autoSwitcher.ts
// Client & Engine TypeScript implementation of the Strategy Auto-Preset Switcher
//
// Phase 2: the tier numbers live in ./tiers.ts (the single source of
// truth). This module re-exports them under the legacy TIER_*_MICRO /
// HYBRID / ALPHA ids so existing imports keep working, and
// applyTierToConfig now applies ALL tier fields — the old version only
// applied leverage/compoundRate/tp1Dist/slAtrMult, so the flag could be
// on while tp2Dist/tp2AtrMult/defaultMargin still held stale values.

import {
  CANONICAL_TIERS,
  getCanonicalTierForBalance,
  type CanonicalTier,
} from './tiers.ts';

export interface AutoSwitcherTier {
  id: 'TIER_1_MICRO' | 'TIER_2_HYBRID' | 'TIER_3_ALPHA';
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

function toLegacy(t: CanonicalTier): AutoSwitcherTier {
  return {
    id: t.legacyId,
    name: t.name,
    minBalance: t.minBalance,
    maxBalance: t.maxBalance,
    leverage: t.leverage,
    riskCapPct: t.riskCapPct,
    maxRiskDollarCap: t.maxRiskDollarCap,
    tp1Dist: t.tp1Dist,
    tp2Dist: t.tp2Dist,
    tp2AtrMult: t.tp2AtrMult,
    slAtrMult: t.slAtrMult,
    defaultMargin: t.defaultMargin,
    compoundRate: t.compoundRate,
    description: t.description,
  };
}

export const AUTO_SWITCHER_TIERS: Record<string, AutoSwitcherTier> = {
  TIER_1_MICRO: toLegacy(CANONICAL_TIERS.TIER_1),
  TIER_2_HYBRID: toLegacy(CANONICAL_TIERS.TIER_2),
  TIER_3_ALPHA: toLegacy(CANONICAL_TIERS.TIER_3),
};

export function getTierForBalance(balance: number): AutoSwitcherTier {
  return toLegacy(getCanonicalTierForBalance(balance));
}

export interface TierConfig {
  startBalance: number;
  leverage: number;
  compoundRate: number;
  tp1Dist: number;
  tp2Dist?: number;
  tp2AtrMult?: number;
  slAtrMult: number;
  defaultMargin?: number;
  autoSwitchPresets?: boolean;
}

export function applyTierToConfig<T extends TierConfig>(cfg: T, overrideBalance?: number): T {
  const bal = overrideBalance !== undefined ? overrideBalance : cfg.startBalance;
  const tier = getTierForBalance(bal);
  return {
    ...cfg,
    autoSwitchPresets: true,
    leverage: tier.leverage,
    compoundRate: tier.compoundRate,
    tp1Dist: tier.tp1Dist,
    tp2Dist: tier.tp2Dist,
    tp2AtrMult: tier.tp2AtrMult,
    slAtrMult: tier.slAtrMult,
    defaultMargin: tier.defaultMargin,
  };
}
