import {
  ChevronDown,
  ChevronUp,
  RotateCw,
  Sliders,
} from 'lucide-react';
import { useState } from 'react';
import { SimulationConfig } from '../types.ts';

interface ConfigPanelProps {
  config: SimulationConfig;
  onChange: (newConfig: SimulationConfig) => void;
  onRun: () => void;
  isRunning: boolean;
  progressPct: number;
  statusText: string;
}

export function ConfigPanel({
  config,
  onChange,
  onRun,
  isRunning,
  progressPct,
  statusText,
}: ConfigPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Phase 2: sizing is canonical (src/engine/tiers.ts) — the same
  // tier table live trading uses. There is no manual sizing mode
  // anymore, so the preset buttons, the auto-switcher toggle, and the
  // tier-sync helper are gone. This panel only edits the fields that
  // still affect a backtest: balance, bars, price, seed, fees, lockout.
  const handleChange = <K extends keyof SimulationConfig>(
    key: K,
    value: SimulationConfig[K],
  ) => {
    onChange({ ...config, [key]: value });
  };

  return (
    <div className="bg-[#1c1c1a] border border-white/15 rounded-lg p-4 sm:p-5 mb-5 shadow-sm">
      {/* Canonical sizing note (Phase 2) — replaces the old
          "Regime-Optimized Presets" (Max Alpha / Peak Win Rate / Safe),
          whose 95% WR / +392% Ret claims were never computed from the
          canonical trigger and whose leverage/TP/SL overrides no longer
          exist. Backtests now use the exact trigger + tier table live
          trading uses; starting balance selects the tier. */}
      <div className="mb-4 pb-3.5 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-neutral-200">
            Canonical Trigger + Tier Table
          </span>
          <span className="text-[10px] text-neutral-400">
            (Same signal and sizing as live trading — no manual overrides)
          </span>
        </div>
        <span className="text-[10px] font-mono px-2 py-1 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold">
          CANONICAL SIZING ACTIVE
        </span>
      </div>

      {/* Canonical Tier Table (Phase 2): audited true values from
          src/engine/tiers.ts. The old matrix showed leverage x FULL
          balance as "margin" ($600 on $30, $3,500 on $100, $12,500 on
          $250) and a false 1% Tier 1 cap. True values: tier margin x
          leverage = notional; caps 3%/5%/10%. */}
      <div className="mb-4 p-3 rounded-lg bg-[#252523]/80 border border-amber-500/30 text-xs">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="text-amber-400 font-bold">⚙️ Canonical Tier Table:</span>
            <span className="text-neutral-300">
              Current Tier for ${config.startBalance.toFixed(2)}:{' '}
              <b className="text-emerald-400">
                {config.startBalance < 100
                  ? 'Tier 1: Peak Win Rate (20x)'
                  : config.startBalance < 250
                    ? 'Tier 2: Hybrid Scaling (35x)'
                    : 'Tier 3: Max Alpha (50x)'}
              </b>
            </span>
          </div>
          <span className="text-[10px] font-mono text-neutral-400">
            Tier follows balance; server may add +10x boost (max 60x)
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-[11px]">
          <div
            className={`p-2 rounded border ${
              config.startBalance < 100
                ? 'bg-blue-500/15 border-blue-400/50 text-blue-200'
                : 'bg-black/20 border-white/5 text-neutral-400'
            }`}
          >
            <div className="font-bold flex items-center justify-between">
              <span>$0.00 – $99.99</span>
              <span className="text-[9px] px-1 bg-white/10 rounded">20x</span>
            </div>
            <div className="text-[10px] text-neutral-300 mt-1">Peak Win Rate Mode</div>
            <div className="text-[10px] text-neutral-400">Risk Cap: 3% (-$0.90 on $30 bal)</div>
            <div className="text-[10px] text-blue-300">Margin: $25 → $500 notional at 20x · TP1 0.35 / TP2 0.55</div>
          </div>

          <div
            className={`p-2 rounded border ${
              config.startBalance >= 100 && config.startBalance < 250
                ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-200'
                : 'bg-black/20 border-white/5 text-neutral-400'
            }`}
          >
            <div className="font-bold flex items-center justify-between">
              <span>$100.00 – $249.99</span>
              <span className="text-[9px] px-1 bg-white/10 rounded">35x</span>
            </div>
            <div className="text-[10px] text-neutral-300 mt-1">Hybrid Scaling Tier</div>
            <div className="text-[10px] text-neutral-400">Risk Cap: 5% (-$5.00 on $100 bal)</div>
            <div className="text-[10px] text-emerald-300">Margin: $50 → $1,750 notional at 35x · TP1 0.35 / TP2 0.70</div>
          </div>

          <div
            className={`p-2 rounded border ${
              config.startBalance >= 250
                ? 'bg-amber-500/15 border-amber-400/50 text-amber-200'
                : 'bg-black/20 border-white/5 text-neutral-400'
            }`}
          >
            <div className="font-bold flex items-center justify-between">
              <span>$250.00+</span>
              <span className="text-[9px] px-1 bg-white/10 rounded">50x</span>
            </div>
            <div className="text-[10px] text-neutral-300 mt-1">Max Alpha Mode</div>
            <div className="text-[10px] text-neutral-400">Risk Cap: 10% (-$25.00 on $250 bal)</div>
            <div className="text-[10px] text-amber-300">Margin: $100 → $5,000 notional at 50x · TP1 0.35 / TP2 0.85</div>
          </div>
        </div>
      </div>

      {/* Primary Config Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5 items-end">
        {/* Starting Balance */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="cfg-balance"
            className="text-[11px] font-medium uppercase tracking-wider text-[#898781]"
          >
            Starting Bal ($)
          </label>
          <input
            id="cfg-balance"
            type="number"
            min="10"
            max="10000"
            step="5"
            value={config.startBalance}
            onChange={(e) =>
              handleChange('startBalance', parseFloat(e.target.value) || 25)
            }
            className="text-xs sm:text-sm font-mono px-3 py-2 rounded-md bg-[#252523] text-neutral-100 border border-white/15 focus:border-blue-500 focus:outline-none transition-colors w-full"
          />
        </div>

        {/* Candles / Regime */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="cfg-candles"
              className="text-[11px] font-medium uppercase tracking-wider text-[#898781]"
            >
              Bars / Regime
            </label>
            <span className="text-[10px] text-blue-400 font-mono">
              ≈ {((config.candlesPerRegime || 500) / 96).toFixed(1)}d (15m)
            </span>
          </div>
          <input
            id="cfg-candles"
            type="number"
            min="100"
            max="3000"
            step="50"
            value={config.candlesPerRegime}
            onChange={(e) =>
              handleChange(
                'candlesPerRegime',
                parseInt(e.target.value, 10) || 500,
              )
            }
            className="text-xs sm:text-sm font-mono px-3 py-2 rounded-md bg-[#252523] text-neutral-100 border border-white/15 focus:border-blue-500 focus:outline-none transition-colors w-full"
          />
          <div className="flex items-center gap-1 text-[10px] text-neutral-400 font-mono mt-0.5 flex-wrap">
            <button
              type="button"
              onClick={() => handleChange('candlesPerRegime', 288)}
              className={`px-1.5 py-0.5 rounded border transition-colors ${
                config.candlesPerRegime === 288
                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/40 font-semibold'
                  : 'bg-white/5 hover:bg-white/10 text-neutral-400 border-transparent'
              }`}
              title="3 days on 15m (12 days total across 4 regimes)"
            >
              3d (288)
            </button>
            <button
              type="button"
              onClick={() => handleChange('candlesPerRegime', 500)}
              className={`px-1.5 py-0.5 rounded border transition-colors ${
                config.candlesPerRegime === 500
                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/40 font-semibold'
                  : 'bg-white/5 hover:bg-white/10 text-neutral-400 border-transparent'
              }`}
              title="5.2 days on 15m (~21 days total across 4 regimes)"
            >
              5.2d (500)
            </button>
            <button
              type="button"
              onClick={() => handleChange('candlesPerRegime', 672)}
              className={`px-1.5 py-0.5 rounded border transition-colors ${
                config.candlesPerRegime === 672
                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/40 font-semibold'
                  : 'bg-white/5 hover:bg-white/10 text-neutral-400 border-transparent'
              }`}
              title="7 days (1 week) on 15m (28 days / 1 month total across 4 regimes)"
            >
              1wk (672)
            </button>
            <button
              type="button"
              onClick={() => handleChange('candlesPerRegime', 1344)}
              className={`px-1.5 py-0.5 rounded border transition-colors ${
                config.candlesPerRegime === 1344
                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/40 font-semibold'
                  : 'bg-white/5 hover:bg-white/10 text-neutral-400 border-transparent'
              }`}
              title="14 days (2 weeks) on 15m (56 days / 2 months total across 4 regimes)"
            >
              2wk (1344)
            </button>
          </div>
        </div>

        {/* SOL Base Price */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="cfg-price"
            className="text-[11px] font-medium uppercase tracking-wider text-[#898781]"
          >
            SOL Price ($)
          </label>
          <input
            id="cfg-price"
            type="number"
            min="10"
            max="1000"
            step="5"
            value={config.basePrice}
            onChange={(e) =>
              handleChange('basePrice', parseFloat(e.target.value) || 140)
            }
            className="text-xs sm:text-sm font-mono px-3 py-2 rounded-md bg-[#252523] text-neutral-100 border border-white/15 focus:border-blue-500 focus:outline-none transition-colors w-full"
          />
        </div>

        {/* Random Seed */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="cfg-seed"
            className="text-[11px] font-medium uppercase tracking-wider text-[#898781] flex items-center justify-between"
          >
            <span>Seed</span>
            <button
              type="button"
              onClick={() =>
                handleChange('seed', Math.floor(Math.random() * 99999) + 1)
              }
              title="Randomize seed"
              className="text-[10px] text-blue-400 hover:text-blue-300 font-mono flex items-center gap-0.5"
            >
              <RotateCw className="w-2.5 h-2.5" />
              rand
            </button>
          </label>
          <input
            id="cfg-seed"
            type="number"
            min="1"
            max="999999"
            value={config.seed}
            onChange={(e) =>
              handleChange('seed', parseInt(e.target.value, 10) || 42)
            }
            className="text-xs sm:text-sm font-mono px-3 py-2 rounded-md bg-[#252523] text-neutral-100 border border-white/15 focus:border-blue-500 focus:outline-none transition-colors w-full"
          />
        </div>
      </div>

      {/* Advanced Parameters Toggle */}
      <div className="mt-4 pt-3 border-t border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs text-neutral-400 hover:text-neutral-200 flex items-center gap-1.5 transition-colors"
        >
          <Sliders className="w-3.5 h-3.5 text-blue-400" />
          <span>Advanced Engine Tuning (Fees, Lockout, LSD Display)</span>
          {showAdvanced ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>

        <div className="flex items-center gap-3">
          <button
            id="run-btn"
            onClick={onRun}
            disabled={isRunning}
            className="w-full sm:w-auto px-6 py-2.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRunning ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Running Engine...</span>
              </>
            ) : (
              <span>Run Backtest Engine</span>
            )}
          </button>
        </div>
      </div>

      {/* Advanced Drawer */}
      {showAdvanced && (
        <div className="mt-4 pt-4 border-t border-white/10 space-y-3.5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3.5">






            <div className="flex flex-col gap-1">
              <label
                htmlFor="cfg-fee-rate"
                className="text-[10px] uppercase tracking-wider text-neutral-400"
              >
                Fee Drag Rate
              </label>
              <input
                id="cfg-fee-rate"
                type="number"
                step="0.0001"
                min="0.0001"
                max="0.005"
                value={config.feeRate}
                onChange={(e) =>
                  handleChange('feeRate', parseFloat(e.target.value) || 0.0008)
                }
                className="text-xs font-mono px-2.5 py-1.5 rounded bg-[#252523] text-neutral-200 border border-white/10"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="cfg-lsd"
                className="text-[10px] uppercase tracking-wider text-neutral-400"
              >
                LSD Trigger Bal ($)
              </label>
              <input
                id="cfg-lsd"
                type="number"
                step="1"
                min="10"
                max="100"
                value={config.lsdThreshold}
                onChange={(e) =>
                  handleChange('lsdThreshold', parseFloat(e.target.value) || 22.0)
                }
                className="text-xs font-mono px-2.5 py-1.5 rounded bg-[#252523] text-neutral-200 border border-white/10"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="cfg-lockout"
                className="text-[10px] uppercase tracking-wider text-neutral-400"
              >
                Lockout Floor ($)
              </label>
              <input
                id="cfg-lockout"
                type="number"
                step="1"
                min="1"
                max="50"
                value={config.minLockout}
                onChange={(e) =>
                  handleChange('minLockout', parseFloat(e.target.value) || 10.0)
                }
                className="text-xs font-mono px-2.5 py-1.5 rounded bg-[#252523] text-neutral-200 border border-white/10"
              />
            </div>
          </div>

          {/* Canonical behavior note (Phase 2): entry offsets,
              targets, and stops come from the canonical trigger; flash
              crashes always sit out. The old Dynamic/Fixed offset
              toggle and the Divergence Micro-Buys option are gone. */}
          <div className="pt-2 border-t border-white/5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center justify-between p-2.5 rounded bg-[#252523]/70 border border-white/5">
              <div>
                <div className="text-xs font-medium text-neutral-200">
                  Entry Offset (canonical)
                </div>
                <div className="text-[11px] text-neutral-400">
                  Post-only best bid on momentum; else 0.10× ATR (3¢–5¢) when ATR &lt; 0.35, else 0.25× ATR (8¢–20¢)
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded bg-[#252523]/70 border border-white/5">
              <div>
                <div className="text-xs font-medium text-neutral-200">
                  Flash Crash Regime Mode
                </div>
                <div className="text-[11px] text-neutral-400">
                  Always 100% cash sit-out (canonical trigger) — no divergence micro-buys, either direction
                </div>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-neutral-400 leading-relaxed bg-blue-500/5 border border-blue-500/15 rounded p-2.5">
            <strong className="text-blue-300">Canonical Sizing (Phase 2):</strong> Margins $25/$50/$100 by tier, leverage 20/35/50 (+10x server boost on BULL/GRADE_A, max 60x), TP1 0.35 (0.20 in chop), TP2 0.55/0.70/0.85 (0.75× in chop; BULL max(1.20, 1.50× ATR)), SL 1.2/1.5/1.5× ATR clamped by the tier risk cap (3%/5%/10%). The live server applies the same table plus a fee guard (skip when round-trip fees exceed 75% of TP1 value). LSD mode (&lt;$22) no longer changes sizing — Tier 1 covers small balances.
          </div>
        </div>
      )}

      {/* Progress Bar & Status */}
      {isRunning && (
        <div className="mt-4 pt-3 border-t border-white/10">
          <div className="w-full bg-neutral-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-blue-500 h-full transition-all duration-200 rounded-full"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="text-xs font-mono text-neutral-400 mt-2 flex items-center justify-between">
            <span>{statusText || 'Simulating...'}</span>
            <span>{progressPct}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
