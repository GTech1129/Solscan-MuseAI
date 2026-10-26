export type RegimeKey =
  | 'FLASH_CRASH'
  | 'MARKET_CHOP'
  | 'RANGE_BOUND_SUPPORT'
  | 'BULL_TREND_DRIFT'
  | 'COMBINED';

export interface RegimeDefinition {
  key: RegimeKey;
  label: string;
  badge: string;
  cardCls: 'flash' | 'chop' | 'range' | 'bull' | 'combined';
  drift: number;
  vol: number;
  meanRev: number;
  candleBody: number;
  atrBase: number;
  tp2: number;
  desc: string;
  entryOffset: number;
  tp1: number;
  slCoeff: number;
  sizePct: number;
}

export interface Candle {
  index: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  atr: number;
  cci?: number | null;
  fisher?: number | null;
  isJump?: boolean;
}

export type ExitType = 'Full TP' | 'Half TP/BE' | 'Half TP/Fisher' | 'Chandelier Trail' | 'Stagnation Exit' | 'SL';

export interface Trade {
  n: number;
  dateTime?: string;
  side?: 'Long' | 'Short';
  regime: string;
  regimeKey: RegimeKey;
  type: ExitType;
  signalBar: number;
  entryBar: number;
  exitBar: number;
  entry: number;
  exit: number;
  margin: number;
  lev: number;
  posSize: number;
  tokens: number;
  pnl: number;
  pnlPct: number;
  fee: number;
  balance: number;
  tp1Hit: boolean;
  barsHeld: number;
}

export interface EquityPoint {
  index: number;
  tradeNum: number;
  balance: number;
  netPnL: number;
  drawdownPct: number;
  regime: string;
  isLSD: boolean;
}

export interface BacktestResult {
  regime: RegimeKey;
  label: string;
  desc: string;
  badge: string;
  cardCls: 'flash' | 'chop' | 'range' | 'bull' | 'combined';
  nBars: number;
  signals: number;
  trades: Trade[];
  wins: number;
  losses: number;
  winRate: number;
  grossPnL: number;
  netPnL: number;
  startBal: number;
  finalBal: number;
  netRet: number;
  maxDD: number;
  profitFactor: number;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  totalFees: number;
  equityCurve: EquityPoint[];
  candles?: Candle[];
}

export interface SimulationConfig {
  startBalance: number;
  // Phase 2 LEGACY fields — accepted for compatibility but IGNORED by
  // the backtest. Sizing comes from the canonical trigger
  // (src/engine/trigger.ts) + tier table (src/engine/tiers.ts), the
  // same as live trading. The ConfigPanel no longer edits these.
  compoundRate: number; // LEGACY (was: 0 for fixed $11, 0.10, 0.25, 0.50)
  leverage: number; // LEGACY (was: default 60)
  candlesPerRegime: number; // default 500
  basePrice: number; // default 140
  seed: number; // default 42
  tp1Dist: number; // LEGACY (was: default 0.35)
  slAtrMult: number; // LEGACY (was: default 1.5)
  entryOffset: number; // LEGACY (was: default 0.08)
  feeRate: number; // default 0.0008 (0.08%)
  minLockout: number; // default 10.00
  lsdThreshold: number; // default 22.00 — display flag only in Phase 2 (equity-curve badges); no longer changes sizing
  useDynamicOffset?: boolean; // LEGACY (was: ATR-based dynamic pullback)
  flashCrashMode?: 'SIT_OUT' | 'DIVERGENCE_MICRO'; // LEGACY — flash crashes always sit out in Phase 2; DIVERGENCE_MICRO is ignored
  autoSwitchPresets?: boolean; // LEGACY — tier sizing is always on in Phase 2
}

export interface MonteCarloSummary {
  simulations: number;
  medianFinalBal: number;
  minFinalBal: number;
  maxFinalBal: number;
  profitableSimsPct: number;
  ruinCount: number;
  ruinPct: number;
  avgReturnPct: number;
  worstDrawdownPct: number;
  curves: { id: number; data: number[] }[];
}
