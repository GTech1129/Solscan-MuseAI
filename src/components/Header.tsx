import React from 'react';
import {
  Activity,
  Download,
  Play,
  ShieldAlert,
  Sparkles,
  Zap,
  Radio,
  Cpu,
  FlaskConical,
  Clock,
  Layers,
  Wallet,
  History,
} from 'lucide-react';

export type DashboardWindow = 'LIVE_VIEW' | 'AUTOTRADE' | 'BACKTEST';

interface HeaderProps {
  activeWindow: DashboardWindow;
  onSelectWindow: (w: DashboardWindow) => void;
  currentAsset: string;
  solPrice?: number;
  priceChange?: number;
  onSelectAsset?: (asset: string) => void;
  updateIntervalSecs?: number;
  setUpdateIntervalSecs?: (secs: number) => void;
  isRunning: boolean;
  onRun: () => void;
  onOpenMonteCarlo: () => void;
  onResetDefaults: () => void;
  onExportCSV?: () => void;
  hasTrades?: boolean;
  portfolioBalance?: number;
  onUpdatePortfolioBalance?: (newBal: number) => void;
  openPositionsCount?: number;
  maxOpenPositions?: number;
  activeTierName?: string;
  currentRegime?: string;
  onOpenExecutedTradesLedger?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeWindow,
  onSelectWindow,
  currentAsset,
  solPrice,
  priceChange,
  onSelectAsset,
  updateIntervalSecs = 5,
  setUpdateIntervalSecs,
  isRunning,
  onRun,
  onOpenMonteCarlo,
  onResetDefaults,
  onExportCSV,
  hasTrades = false,
  portfolioBalance = 30.0,
  onUpdatePortfolioBalance,
  openPositionsCount = 0,
  maxOpenPositions = 1,
  activeTierName = 'Peak Win Rate (20x)',
  currentRegime,
  onOpenExecutedTradesLedger,
}) => {
  const [isEditingBalance, setIsEditingBalance] = React.useState<boolean>(false);
  const [balanceInput, setBalanceInput] = React.useState<string>(portfolioBalance.toString());
  const assetGlyph = currentAsset === 'SOL' ? '◎' : currentAsset === 'BTC' ? '₿' : 'Ξ';

  // Resolved trading mode (Phase 1 scope correction): the header used to
  // hardcode "Jupiter Devnet Auto-Trader" regardless of the real mode.
  // It now reads /state.tradingMode (env-resolved, bot-service + jupiter
  // agree) and refreshes every 30s. Falls back to "unknown" when the bot
  // is unreachable — never a hardcoded network claim.
  const [tradingMode, setTradingMode] = React.useState<{
    network: string;
    effectiveMode: string;
    armed: boolean;
    devnetForcedSimulate: boolean;
  } | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    const fetchMode = async () => {
      try {
        const res = await fetch('/state', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const tm = data.tradingMode;
        if (!cancelled && tm) {
          setTradingMode({
            network: tm.network,
            effectiveMode: tm.effectiveMode,
            armed: tm.armed,
            devnetForcedSimulate: tm.devnetForcedSimulate,
          });
        }
      } catch {
        // Bot unreachable: keep the "unknown" fallback below.
      }
    };
    fetchMode();
    const timer = setInterval(fetchMode, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  const modeLabel = tradingMode
    ? `Jupiter ${tradingMode.network} · ${tradingMode.effectiveMode.toUpperCase()}${tradingMode.effectiveMode === 'live' ? (tradingMode.armed ? ' · ARMED' : ' · LOCKED') : ''}${tradingMode.devnetForcedSimulate ? ' (devnet forced from LIVE)' : ''}`
    : 'Jupiter · mode unknown (bot unreachable)';
  const modeColor = !tradingMode
    ? 'text-neutral-400 border-white/10 bg-white/5'
    : tradingMode.effectiveMode === 'live'
    ? tradingMode.armed
      ? 'text-rose-300 border-rose-500/40 bg-rose-500/10'
      : 'text-amber-300 border-amber-500/40 bg-amber-500/10'
    : tradingMode.effectiveMode === 'simulate'
    ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
    : 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10';

  return (
    <header className="border-b border-white/10 pb-4 mb-5 space-y-4">
      {/* Top Meta Status Row (Matching Screenshot 1) */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 text-xs font-mono font-semibold border border-blue-500/30">
            <Zap className="w-3.5 h-3.5" />
            <span>SOL SNIPER v10.5</span>
          </div>

          {/* Live Open Positions Monitor Pill */}
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-950/40 text-blue-300 text-xs font-mono font-bold border border-blue-500/40 shadow-sm">
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            <span>POSITIONS:</span>
            <span
              className={`px-1.5 py-0.2 rounded font-black ${
                openPositionsCount > 0
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'bg-emerald-500/20 text-emerald-300'
              }`}
            >
              {openPositionsCount} / {maxOpenPositions}
            </span>
            {openPositionsCount > 0 ? (
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping inline-block" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" />
            )}
          </div>

          {/* Dynamic Regime Pill */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold border shadow-sm ${
              currentRegime === 'YELLOW STANDBY (ADX < 12)'
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                : currentRegime === 'BULL_TREND_DRIFT'
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : currentRegime === 'FLASH_CRASH_VOLATILITY'
                ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                : 'bg-blue-500/15 text-blue-300 border-blue-500/30'
            }`}
          >
            <span className="text-[10px] text-neutral-400 font-normal">REGIME:</span>
            <span>{currentRegime || 'RANGE_BOUND_SUPPORT'}</span>
          </div>

          {/* Link to Executed Trades Ledger */}
          {onOpenExecutedTradesLedger && (
            <button
              onClick={onOpenExecutedTradesLedger}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-bold shadow-sm transition-all cursor-pointer"
              title="Open Executed Trades Ledger in Full Modal"
            >
              <History className="w-3.5 h-3.5 text-emerald-400" />
              <span>TRADES LEDGER</span>
            </button>
          )}

          {/* Portfolio Equity & Active Tier Pill with 1-Click Changer */}
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/40 text-emerald-300 text-xs font-mono font-bold border border-emerald-500/40">
            <Wallet className="w-3.5 h-3.5 text-emerald-400" />
            <span>PORTFOLIO:</span>
            <span className="text-white font-black">${portfolioBalance.toFixed(2)}</span>
            <button
              onClick={() => {
                setBalanceInput(portfolioBalance.toString());
                setIsEditingBalance(true);
              }}
              className="text-[10px] bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-200 px-1.5 py-0.5 rounded border border-emerald-500/30 transition-colors cursor-pointer font-bold"
              title="Change Initial Portfolio Value (e.g. $30.00)"
            >
              Change
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 text-neutral-400 text-[11px] font-mono flex-wrap">
          {/* High-Frequency Update Switcher Badge */}
          {setUpdateIntervalSecs && (
            <div className="flex items-center gap-1 bg-neutral-900 border border-white/10 rounded-lg px-2 py-0.5">
              <Clock className="w-3 h-3 text-emerald-400" />
              <span className="text-neutral-400">Stream:</span>
              {[3, 5, 10, 15].map((sec) => (
                <button
                  key={sec}
                  onClick={() => setUpdateIntervalSecs(sec)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    updateIntervalSecs === sec
                      ? 'bg-emerald-500 text-black'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                  title={`Update telemetry every ${sec} seconds`}
                >
                  {sec}s
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-neutral-500" />
            <span>SESSION:</span>
            <span className="text-emerald-400 font-bold flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
              24/7 LIVE
            </span>
          </div>

          <span className="text-white/20">|</span>
          <div className="flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
            <span>FEED:</span>
            <span className="text-emerald-400 font-bold">LIVE ({updateIntervalSecs}s)</span>
          </div>
        </div>
      </div>

      {/* Main Title Banner & High-Visibility Active Asset Hero Strip */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pt-1">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center gap-2">
              SOLSniper Dashboard
            </h1>

            {/* Prominent Active Asset Banner with Quick Selector */}
            <div className="flex items-center gap-2 bg-gradient-to-r from-purple-950/50 to-neutral-900 border border-purple-500/40 rounded-xl px-3 py-1.5 shadow-lg">
              <div className="w-7 h-7 rounded-lg bg-purple-600/30 border border-purple-400/50 flex items-center justify-center font-black text-sm text-purple-200">
                {assetGlyph}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300">Active Asset:</span>
                  <span className="text-sm font-black font-mono text-white">{currentAsset}</span>
                  {solPrice !== undefined && (
                    <span className="text-sm font-mono font-bold text-emerald-400 tabular-nums">
                      ${solPrice.toFixed(2)}
                    </span>
                  )}
                  {priceChange !== undefined && (
                    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded ${priceChange >= 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                      {priceChange >= 0 ? `+${priceChange.toFixed(2)}%` : `${priceChange.toFixed(2)}%`}
                    </span>
                  )}
                </div>
              </div>

              {/* 1-Click Switchers directly in Header */}
              {onSelectAsset && (
                <div className="flex items-center gap-1 ml-2 pl-2 border-l border-white/15">
                  {(['SOL', 'BTC', 'ETH'] as const).map((a) => (
                    <button
                      key={a}
                      onClick={() => onSelectAsset(a)}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold transition-all ${
                        currentAsset === a
                          ? 'bg-purple-600 text-white shadow-sm ring-1 ring-purple-300'
                          : 'bg-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-700'
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <p className="text-xs text-neutral-400 mt-1 max-w-4xl leading-relaxed">
            Real-Time Multi-Regime Solana Reversal Monitor, Jupiter Auto-Trader, and Backtest Lab
          </p>
          <p className="text-[11px] mt-1">
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-mono font-bold border ${modeColor}`}>
              <span>TRADING MODE:</span>
              <span>{modeLabel}</span>
            </span>
          </p>
        </div>

        {/* Global Action Toolbar (Context-sensitive) */}
        {activeWindow === 'BACKTEST' && (
          <div className="flex items-center gap-2 flex-wrap pt-2 lg:pt-0">
            {onExportCSV && (
              <button
                onClick={onExportCSV}
                disabled={!hasTrades || isRunning}
                className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-300 border border-emerald-500/30 transition-all flex items-center gap-1.5 disabled:opacity-40"
                title="Download trade ledgers as CSV"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">CSV</span>
              </button>
            )}

            <button
              onClick={onOpenMonteCarlo}
              disabled={isRunning}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-white/10 transition-all flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>Monte Carlo</span>
            </button>

            <button
              onClick={onResetDefaults}
              disabled={isRunning}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-neutral-800/80 hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200 border border-white/10 transition-all"
            >
              Reset
            </button>

            <button
              onClick={onRun}
              disabled={isRunning}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-all flex items-center gap-1.5 shadow-md disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{isRunning ? 'Running...' : 'Run Simulation'}</span>
            </button>
          </div>
        )}
      </div>

      {/* WINDOWS NAVIGATION TABS (Exact Match with Screenshot 1 & 2) */}
      <div className="pt-2">
        <div className="flex items-center gap-2 p-1.5 bg-[#141516] border border-white/10 rounded-xl overflow-x-auto">
          {/* Tab 1: SOLSniper Dashboard */}
          <button
            onClick={() => onSelectWindow('LIVE_VIEW')}
            className={`px-4 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
              activeWindow === 'LIVE_VIEW'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                : 'text-neutral-300 hover:text-white hover:bg-neutral-800/60'
            }`}
          >
            <Radio className={`w-3.5 h-3.5 ${activeWindow === 'LIVE_VIEW' ? 'animate-pulse text-emerald-300' : ''}`} />
            <span>SOLSNIPER DASHBOARD</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
                activeWindow === 'LIVE_VIEW'
                  ? 'bg-blue-900/60 text-blue-200 border border-blue-400/30'
                  : 'bg-neutral-800 text-emerald-400'
              }`}
            >
              LIVE
            </span>
          </button>

          {/* Tab 2: AutoTrade Jupiter */}
          <button
            onClick={() => onSelectWindow('AUTOTRADE')}
            className={`px-4 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
              activeWindow === 'AUTOTRADE'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                : 'text-neutral-300 hover:text-white hover:bg-neutral-800/60'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>AUTOTRADE JUPITER</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
                activeWindow === 'AUTOTRADE'
                  ? 'bg-blue-900/60 text-blue-200 border border-blue-400/30'
                  : 'bg-neutral-800 text-emerald-400'
              }`}
            >
              READY
            </span>
          </button>

          {/* Tab 3: Simulation / Backtest */}
          <button
            onClick={() => onSelectWindow('BACKTEST')}
            className={`px-4 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
              activeWindow === 'BACKTEST'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                : 'text-neutral-300 hover:text-white hover:bg-neutral-800/60'
            }`}
          >
            <FlaskConical className="w-3.5 h-3.5" />
            <span>SIMULATION / BACKTEST</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
                activeWindow === 'BACKTEST'
                  ? 'bg-blue-900/60 text-blue-200 border border-blue-400/30'
                  : 'bg-neutral-800 text-purple-400'
              }`}
            >
              LAB
            </span>
          </button>
        </div>

        {/* Selected View Info Sub-Row */}
        {(() => {
          const bal = portfolioBalance ?? 30.0;
          const isTier1 = bal < 100;
          const isTier2 = bal >= 100 && bal < 250;
          const tierName = isTier1
            ? 'Peak Win Rate Mode (20x LSD)'
            : isTier2
            ? 'Hybrid Scaling Tier (35x)'
            : 'Max Alpha Mode (50x)';
          const tierNum = isTier1 ? 'Tier 1' : isTier2 ? 'Tier 2' : 'Tier 3';
          const riskCapPercentStr = isTier1 ? '3%' : isTier2 ? '5%' : '10%';
          const riskCapDollar = isTier1
            ? Math.max(0.25, Math.min(3.00, bal * 0.03))
            : isTier2
            ? Math.max(1.00, Math.min(12.50, bal * 0.05))
            : Math.max(5.00, Math.min(50.00, bal * 0.10));
          const levMult = isTier1 ? 20 : isTier2 ? 35 : 50;
          const marginCollateral = isTier1 ? Math.min(bal, 25.00) : isTier2 ? Math.min(bal * 0.50, 100.00) : Math.min(bal * 0.40, 250.00);
          const positionSize = marginCollateral * levMult;
          const marginSizingStr = `$${marginCollateral.toFixed(2)} ($${positionSize.toFixed(2)} @ ${levMult}x)`;

          return (
            <div className="flex items-center gap-4 text-[11px] text-neutral-400 mt-2 px-1 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
                <span>Live Streaming:</span>
                <strong className="text-neutral-200">ON</strong>
              </div>
              <span className="text-white/20">|</span>
              <div className="flex items-center gap-1.5">
                <span>Active Tier:</span>
                <strong className="text-emerald-400">{tierName}</strong>
              </div>
              <span className="text-white/20">|</span>
              <div
                className="flex items-center gap-1.5 cursor-help"
                title="Tiered Risk Cap: Tier 1: 3% (-$0.90 on $30 bal) · Tier 2: 5% (-$5.00 on $100 bal) · Tier 3: 10% (-$25.00 on $250 bal)"
              >
                <span>Hard Risk Cap:</span>
                <strong className="text-purple-300 font-mono">
                  {tierNum} · {riskCapPercentStr} (-${riskCapDollar.toFixed(2)})
                </strong>
              </div>
              <span className="text-white/20">|</span>
              <div
                className="flex items-center gap-1.5 cursor-help"
                title={`Margin Collateral: $${marginCollateral.toFixed(2)} from wallet · Position Size: Margin × Leverage = $${positionSize.toFixed(2)} (${levMult}x)`}
              >
                <span>Margin &amp; Exposure:</span>
                <strong className="text-blue-300 font-mono">{tierNum} · {marginSizingStr}</strong>
              </div>

            </div>
          );
        })()}
      </div>

      {/* Set Portfolio Value Modal */}
      {isEditingBalance && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#191a1c] border border-white/15 rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Set Portfolio Value</h3>
              </div>
              <button
                onClick={() => setIsEditingBalance(false)}
                className="text-neutral-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-neutral-300 leading-relaxed">
              Enter target trading equity. The <strong>Dynamic Auto-Preset Switcher</strong> will immediately scale leverage, max risk dollar cap, and allowable open positions.
            </p>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-neutral-400">Equity Amount (USD)</label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-neutral-400 font-mono text-sm">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="5"
                  value={balanceInput}
                  onChange={(e) => setBalanceInput(e.target.value)}
                  className="w-full bg-[#111213] border border-white/15 rounded-lg pl-7 pr-3 py-1.5 text-sm font-mono text-white focus:outline-none focus:border-emerald-500"
                  placeholder="30.00"
                />
              </div>
            </div>

            {/* Quick Presets */}
            <div className="space-y-1">
              <span className="text-[10px] text-neutral-400 block font-medium">Quick Presets:</span>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { label: '$30 (T1)', val: 30 },
                  { label: '$50', val: 50 },
                  { label: '$100 (T2)', val: 100 },
                  { label: '$250 (T3)', val: 250 },
                ].map((item) => (
                  <button
                    key={item.val}
                    type="button"
                    onClick={() => setBalanceInput(item.val.toString())}
                    className="py-1 rounded bg-[#25272a] hover:bg-white/10 text-neutral-200 text-[11px] font-mono font-bold transition-colors"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsEditingBalance(false)}
                className="flex-1 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const val = parseFloat(balanceInput);
                  if (!isNaN(val) && val > 0) {
                    if (onUpdatePortfolioBalance) onUpdatePortfolioBalance(val);
                    setIsEditingBalance(false);
                  }
                }}
                className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors shadow-md"
              >
                Save &amp; Sync Tier
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
