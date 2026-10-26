import {
  ChevronDown,
  ChevronUp,
  RotateCw,
  ShieldCheck,
  Sliders,
  Sparkles,
  Target,
} from 'lucide-react';
import { useState } from 'react';
import { SimulationConfig } from '../types.ts';
import { applyTierToConfig, getTierForBalance } from '../engine/autoSwitcher.ts';

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
  const activeTier = getTierForBalance(config.startBalance);

  const handleChange = <K extends keyof SimulationConfig>(
    key: K,
    value: SimulationConfig[K],
  ) => {
    let next = { ...config, [key]: value };
    // When Starting Balance changes and Auto-Preset Switcher is ON,
    // automatically sync the individual variables (leverage, compoundRate, tp1Dist, slAtrMult)
    if (key === 'startBalance' && config.autoSwitchPresets) {
      const newBal = typeof value === 'number' ? value : parseFloat(value as string) || 0;
      next = applyTierToConfig(next, newBal);
    }
    onChange(next);
  };

  const toggleAutoSwitcher = () => {
    if (!config.autoSwitchPresets) {
      // Activating Auto Switcher: immediately change individual variables to match tier
      onChange(applyTierToConfig(config));
    } else {
      onChange({
        ...config,
        autoSwitchPresets: false,
      });
    }
  };

  const applyPreset = (preset: 'alpha' | 'winrate' | 'safe') => {
    if (preset === 'alpha') {
      onChange({
        ...config,
        autoSwitchPresets: false,
        leverage: 50,
        compoundRate: 0.5,
        tp1Dist: 0.35,
        slAtrMult: 1.5,
        useDynamicOffset: true,
        flashCrashMode: 'SIT_OUT',
      });
    } else if (preset === 'winrate') {
      onChange({
        ...config,
        autoSwitchPresets: false,
        leverage: 40,
        compoundRate: 0.35,
        tp1Dist: 0.40,
        slAtrMult: 1.8,
        useDynamicOffset: true,
        flashCrashMode: 'SIT_OUT',
      });
    } else if (preset === 'safe') {
      onChange({
        ...config,
        autoSwitchPresets: false,
        leverage: 30,
        compoundRate: 0.25,
        tp1Dist: 0.35,
        slAtrMult: 1.5,
        useDynamicOffset: true,
        flashCrashMode: 'SIT_OUT',
      });
    }
  };

  const isAlphaActive =
    config.leverage === 50 &&
    config.compoundRate === 0.5 &&
    config.tp1Dist === 0.35 &&
    config.slAtrMult === 1.5 &&
    config.useDynamicOffset === true &&
    config.flashCrashMode === 'SIT_OUT';

  const isWinRateActive =
    config.leverage === 40 &&
    config.compoundRate === 0.35 &&
    config.tp1Dist === 0.40 &&
    config.slAtrMult === 1.8 &&
    config.useDynamicOffset === true;

  const isSafeActive =
    config.leverage === 30 &&
    config.compoundRate === 0.25 &&
    config.tp1Dist === 0.35 &&
    config.slAtrMult === 1.5 &&
    config.useDynamicOffset === true;

  return (
    <div className="bg-[#1c1c1a] border border-white/15 rounded-lg p-4 sm:p-5 mb-5 shadow-sm">
      {/* Optimum Presets Selector */}
      <div className="mb-4 pb-3.5 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold text-neutral-200">
            Regime-Optimized Presets
          </span>
          <span className="text-[10px] text-neutral-400">
            (Calculated across 8 random seeds &amp; all regimes)
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => applyPreset('alpha')}
            className={`text-xs px-2.5 py-1.5 rounded-md font-medium flex items-center gap-1.5 transition-all ${
              isAlphaActive
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-sm'
                : 'bg-[#252523] text-neutral-300 hover:text-white border border-white/10'
            }`}
          >
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>Max Alpha (95% WR · +392% Ret)</span>
          </button>

          <button
            type="button"
            onClick={() => applyPreset('winrate')}
            className={`text-xs px-2.5 py-1.5 rounded-md font-medium flex items-center gap-1.5 transition-all ${
              isWinRateActive
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 shadow-sm'
                : 'bg-[#252523] text-neutral-300 hover:text-white border border-white/10'
            }`}
          >
            <Target className="w-3 h-3 text-emerald-400" />
            <span>Peak Win Rate (95.8% WR · +125% Ret)</span>
          </button>

          <button
            type="button"
            onClick={() => applyPreset('safe')}
            className={`text-xs px-2.5 py-1.5 rounded-md font-medium flex items-center gap-1.5 transition-all ${
              isSafeActive && !config.autoSwitchPresets
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/50 shadow-sm'
                : 'bg-[#252523] text-neutral-300 hover:text-white border border-white/10'
            }`}
          >
            <ShieldCheck className="w-3 h-3 text-blue-400" />
            <span>Safe Preservation (&lt;15% DD)</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onChange({
                ...config,
                autoSwitchPresets: !config.autoSwitchPresets,
              })
            }
            className={`text-xs px-3 py-1.5 rounded-md font-semibold flex items-center gap-1.5 transition-all ${
              config.autoSwitchPresets
                ? 'bg-gradient-to-r from-amber-500/30 to-emerald-500/30 text-amber-200 border border-amber-400/60 shadow-sm'
                : 'bg-[#252523] text-neutral-300 hover:text-white border border-white/10'
            }`}
            title="Auto-Preset Switcher: Dynamically shifts strategy tiers ($0-$100: 20x LSD, $100-$250: 35x Hybrid, $250+: 50x Max Alpha)"
          >
            <span className="text-amber-400 font-mono text-xs">⚡</span>
            <span>Auto-Preset Switcher</span>
            <span
              className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold ${
                config.autoSwitchPresets
                  ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-400/40'
                  : 'bg-white/10 text-neutral-400'
              }`}
            >
              {config.autoSwitchPresets ? 'ACTIVE' : 'OFF'}
            </span>
          </button>
        </div>
      </div>

      {/* Auto-Preset Switcher Matrix Details */}
      {config.autoSwitchPresets && (
        <div className="mb-4 p-3 rounded-lg bg-[#252523]/80 border border-amber-500/30 text-xs">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="text-amber-400 font-bold">⚙️ Auto-Preset Switcher Active:</span>
              <span className="text-neutral-300">
                Current Tier for ${config.startBalance.toFixed(2)}:{' '}
                <b className="text-emerald-400">
                  {config.startBalance < 100
                    ? 'Tier 1: Peak Win Rate (20x LSD)'
                    : config.startBalance < 250
                      ? 'Tier 2: Hybrid Scaling (35x)'
                      : 'Tier 3: Max Alpha (50x)'}
                </b>
              </span>
            </div>
            <span className="text-[10px] font-mono text-neutral-400">
              Auto-scales as equity grows without manual intervention
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
                <span className="text-[9px] px-1 bg-white/10 rounded">20x LSD</span>
              </div>
              <div className="text-[10px] text-neutral-300 mt-1">Peak Win Rate Mode</div>
              <div className="text-[10px] text-neutral-400">Risk Cap: 1% (-$0.30 on $30 bal)</div>
              <div className="text-[10px] text-blue-300">Margin: 20x × Portfolio ($600 on $30 bal) · TP2 +0.55 ATR</div>
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
              <div className="text-[10px] text-emerald-300">Margin: 35x × Portfolio ($3,500 on $100 bal) · TP2 +0.70 ATR</div>
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
              <div className="text-[10px] text-amber-300">Margin: 50x × Portfolio ($12,500 on $250 bal) · TP2 +0.85 ATR</div>
            </div>
          </div>
        </div>
      )}

      {/* Primary Config Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3.5 items-end">
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

        {/* Compounding Mode */}
        <div className="flex flex-col gap-1.5 col-span-2 sm:col-span-1 lg:col-span-2">
          <label
            htmlFor="cfg-compound"
            className="text-[11px] font-medium uppercase tracking-wider text-[#898781]"
          >
            Compounding Mode
          </label>
          <select
            id="cfg-compound"
            value={config.compoundRate}
            onChange={(e) =>
              handleChange('compoundRate', parseFloat(e.target.value))
            }
            className="text-xs sm:text-sm px-3 py-2 rounded-md bg-[#252523] text-neutral-100 border border-white/15 focus:border-blue-500 focus:outline-none transition-colors w-full"
          >
            <option value={0.5}>50% Compounding (Aggressive)</option>
            <option value={0.25}>25% Compounding (Optimal)</option>
            <option value={0.1}>10% Compounding (Conservative)</option>
            <option value={0.0}>Fixed $11 Sizer (Safe Mode)</option>
          </select>
        </div>

        {/* Base Leverage */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="cfg-leverage"
            className="text-[11px] font-medium uppercase tracking-wider text-[#898781]"
          >
            Base Leverage
          </label>
          <div className="relative">
            <input
              id="cfg-leverage"
              type="number"
              min="1"
              max="100"
              step="5"
              value={config.leverage}
              onChange={(e) =>
                handleChange('leverage', parseInt(e.target.value, 10) || 60)
              }
              className="text-xs sm:text-sm font-mono px-3 py-2 pr-7 rounded-md bg-[#252523] text-neutral-100 border border-white/15 focus:border-blue-500 focus:outline-none transition-colors w-full"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-neutral-400 font-mono pointer-events-none">
              ×
            </span>
          </div>
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
          <span>Advanced Engine Tuning (Targets, Stops, Fees, LSD)</span>
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="cfg-tp1"
                className="text-[10px] uppercase tracking-wider text-neutral-400"
              >
                Fee-Neutral TP1 ($)
              </label>
              <input
                id="cfg-tp1"
                type="number"
                step="0.05"
                min="0.10"
                max="5.00"
                value={config.tp1Dist}
                onChange={(e) =>
                  handleChange('tp1Dist', parseFloat(e.target.value) || 0.35)
                }
                className="text-xs font-mono px-2.5 py-1.5 rounded bg-[#252523] text-neutral-200 border border-white/10"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="cfg-entry-offset"
                className="text-[10px] uppercase tracking-wider text-neutral-400"
              >
                Limit Offset ($)
              </label>
              <input
                id="cfg-entry-offset"
                type="number"
                step="0.05"
                min="0.00"
                max="2.00"
                disabled={config.useDynamicOffset}
                value={config.entryOffset}
                onChange={(e) =>
                  handleChange('entryOffset', parseFloat(e.target.value) || 0.15)
                }
                className="text-xs font-mono px-2.5 py-1.5 rounded bg-[#252523] text-neutral-200 border border-white/10 disabled:opacity-40"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="cfg-sl-mult"
                className="text-[10px] uppercase tracking-wider text-neutral-400"
              >
                SL Coeff (× ATR)
              </label>
              <input
                id="cfg-sl-mult"
                type="number"
                step="0.1"
                min="0.5"
                max="5.0"
                value={config.slAtrMult}
                onChange={(e) =>
                  handleChange('slAtrMult', parseFloat(e.target.value) || 1.8)
                }
                className="text-xs font-mono px-2.5 py-1.5 rounded bg-[#252523] text-neutral-200 border border-white/10"
              />
            </div>

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

          {/* Secondary Advanced Controls: Pullback Mode & Flash Crash Strategy */}
          <div className="pt-2 border-t border-white/5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center justify-between p-2.5 rounded bg-[#252523]/70 border border-white/5">
              <div>
                <div className="text-xs font-medium text-neutral-200">
                  ATR-Based Dynamic Pullback Offset
                </div>
                <div className="text-[11px] text-neutral-400">
                  Formula: 0.25×–0.30× ATR (5¢–22¢) calibrated to range & drift regimes
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  handleChange('useDynamicOffset', !config.useDynamicOffset)
                }
                className={`text-xs px-3 py-1 rounded font-mono font-medium transition-colors ${
                  config.useDynamicOffset
                    ? 'bg-blue-600 text-white'
                    : 'bg-neutral-800 text-neutral-400 border border-white/10'
                }`}
              >
                {config.useDynamicOffset ? 'Dynamic ON' : 'Fixed 8¢'}
              </button>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded bg-[#252523]/70 border border-white/5">
              <div>
                <div className="text-xs font-medium text-neutral-200">
                  Flash Crash Regime Mode
                </div>
                <div className="text-[11px] text-neutral-400">
                  100% Cash Symmetrical Sit-Out vs 10% Divergence Micro-Buys
                </div>
              </div>
              <select
                value={config.flashCrashMode ?? 'SIT_OUT'}
                onChange={(e) =>
                  handleChange(
                    'flashCrashMode',
                    e.target.value as 'SIT_OUT' | 'DIVERGENCE_MICRO',
                  )
                }
                className="text-xs font-mono px-2.5 py-1 rounded bg-neutral-800 text-neutral-200 border border-white/10"
              >
                <option value="SIT_OUT">100% Cash Sit-Out</option>
                <option value="DIVERGENCE_MICRO">10% Divergence Buys</option>
              </select>
            </div>
          </div>

          <div className="text-[11px] text-neutral-400 leading-relaxed bg-blue-500/5 border border-blue-500/15 rounded p-2.5">
            <strong className="text-blue-300">TP1 Calibration Rationale:</strong> On 15m SOL, ATR averages ~$0.35 and typical pullback wicks are 9¢–15¢. At 60x leverage, round-trip fees (0.08%) consume 4.80% of margin. Widening TP1 from 25¢ to <strong>35¢</strong> ensures that half-win trades guarantee a <strong>+4.20% net margin return</strong> even if the remaining runner rolls back to breakeven. In LSD mode (&lt;$22), TP1 scales down to 15¢ with 20x leverage.
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
