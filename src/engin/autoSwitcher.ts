// src/engine/autoSwitcher.ts
// Client & Engine TypeScript implementation of the Strategy Auto-Preset Switcher

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

export const AUTO_SWITCHER_TIERS: Record<string, AutoSwitcherTier> = {
  TIER_1_MICRO: {
    id: 'TIER_1_MICRO',
    name: 'Peak Win Rate Mode (20x LSD)',
    minBalance: 0,
    maxBalance: 99.9999,
    leverage: 20,
    riskCapPct: 0.03, // 3% Tiered Risk Cap
    maxRiskDollarCap: 3.00, // -$3.00 max loss (-$0.90 on $30 balance)
    tp1Dist: 0.30,
    tp2Dist: 0.55,
    tp2AtrMult: 0.85,
    slAtrMult: 1.8,
    defaultMargin: 25.00, // Margin is committed collateral from wallet ($25.00 collateral on $30 balance)
    compoundRate: 0.833, // 83.3% wallet collateral utilization ($25 on $30)
    description: 'Capital preservation for micro-balances ($0-$100). Capped at 3% equity risk (-$0.90 max loss on $30 balance) with $25.00 margin collateral at 20x leverage ($500.00 position size / ~4.27 SOL).',
  },
  TIER_2_HYBRID: {
    id: 'TIER_2_HYBRID',
    name: 'Hybrid Scaling Tier (35x)',
    minBalance: 100.00,
    maxBalance: 249.9999,
    leverage: 35,
    riskCapPct: 0.05, // 5% Tiered Risk Cap
    maxRiskDollarCap: 12.50, // -$12.50 max loss (-$5.00 on $100 balance)
    tp1Dist: 0.35,
    tp2Dist: 0.70,
    tp2AtrMult: 1.00,
    slAtrMult: 1.6,
    defaultMargin: 50.00, // Margin is committed collateral from wallet ($50.00 on $100 balance)
    compoundRate: 0.50,
    description: 'Balanced acceleration for intermediate balances ($100-$250). Capped at 5% equity risk (-$5.00 max loss on $100) with $50.00 margin collateral at 35x leverage ($1,750 total position).',
  },
  TIER_3_ALPHA: {
    id: 'TIER_3_ALPHA',
    name: 'Max Alpha Mode (50x)',
    minBalance: 250.00,
    maxBalance: Infinity,
    leverage: 50,
    riskCapPct: 0.10, // 10% Tiered Risk Cap
    maxRiskDollarCap: 50.00, // -$50.00 max loss (-$25.00 on $250 balance)
    tp1Dist: 0.35,
    tp2Dist: 0.85,
    tp2AtrMult: 1.20,
    slAtrMult: 1.5,
    defaultMargin: 100.00, // Margin is committed collateral from wallet ($100.00 on $250 balance)
    compoundRate: 0.40,
    description: 'Maximum velocity compounding for accounts $250+. Capped at 10% equity risk (-$25.00 max loss on $250) with $100.00 collateral at 50x leverage ($5,000 total position).',
  },
};

export function getTierForBalance(balance: number): AutoSwitcherTier {
  const bal = Math.max(0, balance || 0);
  if (bal < 100.00) return AUTO_SWITCHER_TIERS.TIER_1_MICRO;
  if (bal < 250.00) return AUTO_SWITCHER_TIERS.TIER_2_HYBRID;
  return AUTO_SWITCHER_TIERS.TIER_3_ALPHA;
}

export function applyTierToConfig<T extends { startBalance: number; leverage: number; compoundRate: number; tp1Dist: number; slAtrMult: number; autoSwitchPresets?: boolean }>(
  cfg: T,
  overrideBalance?: number,
): T {
  const bal = overrideBalance !== undefined ? overrideBalance : cfg.startBalance;
  const tier = getTierForBalance(bal);
  return {
    ...cfg,
    autoSwitchPresets: true,
    leverage: tier.leverage,
    compoundRate: tier.compoundRate,
    tp1Dist: tier.tp1Dist,
    slAtrMult: tier.slAtrMult,
  };
}
