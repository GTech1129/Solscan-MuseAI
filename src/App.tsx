import { useCallback, useEffect, useState } from 'react';
import { AutoTradeJupiterView } from './components/AutoTradeJupiterView.tsx';
import { CandleVisualizer } from './components/CandleVisualizer.tsx';
import { ConfigPanel } from './components/ConfigPanel.tsx';
import { EquityChart } from './components/EquityChart.tsx';
import { DashboardWindow, Header } from './components/Header.tsx';
import { LiveDashboardView } from './components/LiveDashboardView.tsx';
import { MonteCarloModal } from './components/MonteCarloModal.tsx';
import { NoteBanner } from './components/NoteBanner.tsx';
import { OverviewTable } from './components/OverviewTable.tsx';
import { RegimeCards } from './components/RegimeCards.tsx';
import { TradesLedger } from './components/TradesLedger.tsx';
import { runFullSimulation } from './engine/backtest.ts';
import { BacktestResult, SimulationConfig } from './types.ts';
import { exportAllResultsToCSV } from './utils/exportCsv.ts';

const DEFAULT_CONFIG: SimulationConfig = {
  startBalance: 240,
  compoundRate: 0.5,
  leverage: 50,
  candlesPerRegime: 500,
  basePrice: 140,
  seed: 42,
  tp1Dist: 0.35,
  slAtrMult: 1.5,
  entryOffset: 0.08,
  feeRate: 0.0008,
  minLockout: 10.0,
  lsdThreshold: 22.0,
  useDynamicOffset: true,
  flashCrashMode: 'SIT_OUT',
};

export default function App() {
  const [activeWindow, setActiveWindow] = useState<DashboardWindow>('LIVE_VIEW');
  const [selectedAsset, setSelectedAsset] = useState<string>('SOL');
  const [solPrice, setSolPrice] = useState<number>(119.05);
  const [priceChange, setPriceChange] = useState<number>(0.05);
  const [updateIntervalSecs, setUpdateIntervalSecs] = useState<number>(5);

  const [config, setConfig] = useState<SimulationConfig>(DEFAULT_CONFIG);
  const [isRunning, setIsRunning] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [isolatedResults, setIsolatedResults] = useState<BacktestResult[]>([]);
  const [combinedResult, setCombinedResult] = useState<BacktestResult | null>(null);
  const [selectedRegime, setSelectedRegime] = useState<string>('COMBINED');
  const [isMonteCarloOpen, setIsMonteCarloOpen] = useState(false);

  // Global Real-Time Bot State (Portfolio Balance & Open Positions Responsiveness)
  const [portfolioBalance, setPortfolioBalance] = useState<number>(30.0);
  const [openPositionsCount, setOpenPositionsCount] = useState<number>(0);
  const [maxOpenPositions, setMaxOpenPositions] = useState<number>(1);
  const [activeTierName, setActiveTierName] = useState<string>('Peak Win Rate (20x LSD)');
  const [currentRegime, setCurrentRegime] = useState<string>('BULL_TREND_DRIFT');
  const [isLedgerModalOpen, setIsLedgerModalOpen] = useState<boolean>(false);

  const syncBotState = useCallback(async () => {
    try {
      const res = await fetch('/state', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.balance === 'number') {
          setPortfolioBalance(data.balance);
        }
        if (Array.isArray(data.positions)) {
          // Count active filled or pending limit orders
          const activeCount = data.positions.filter(
            (p: any) => p.status === 'open' || p.status === 'filled' || p.status === 'pending'
          ).length;
          setOpenPositionsCount(activeCount);
        }
        if (data.autoSwitcher?.activePreset) {
          setMaxOpenPositions(data.autoSwitcher.activePreset.maxOpenPositions ?? 1);
          setActiveTierName(data.autoSwitcher.activePreset.name || 'Tier 1');
        }
        if (data.regime || data.currentRegime) {
          setCurrentRegime(data.regime || data.currentRegime);
        }
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    syncBotState();
    // Fast 1.5s responsive polling
    const interval = setInterval(syncBotState, 1500);

    const onBotUpdate = () => syncBotState();
    window.addEventListener('BOT_STATE_UPDATED', onBotUpdate);
    window.addEventListener('focus', onBotUpdate);

    return () => {
      clearInterval(interval);
      window.removeEventListener('BOT_STATE_UPDATED', onBotUpdate);
      window.removeEventListener('focus', onBotUpdate);
    };
  }, [syncBotState]);

  const handleUpdatePortfolioBalance = async (newBal: number) => {
    setPortfolioBalance(newBal);
    try {
      const res = await fetch('/portfolio-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance: newBal }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.autoSwitcher?.activePreset) {
          setMaxOpenPositions(data.autoSwitcher.activePreset.maxOpenPositions ?? 1);
          setActiveTierName(data.autoSwitcher.activePreset.name);
        }
      }
      window.dispatchEvent(new CustomEvent('BOT_STATE_UPDATED'));
    } catch (_) {}
  };

  // Live ticker polling with multi-exchange fallback (Binance Proxy -> Binance Vision -> Coinbase -> Kraken)
  useEffect(() => {
    let isMounted = true;
    const fetchTicker = async () => {
      try {
        const symbol = selectedAsset + 'USDT';
        let price: number | null = null;
        let change: number = 0;

        // 1. Try local server-side proxy
        try {
          const res = await fetch(`/api/binance/ticker?symbol=${symbol}`);
          if (res.ok) {
            const d = await res.json();
            if (d && d.lastPrice) {
              price = parseFloat(d.lastPrice);
              change = parseFloat(d.priceChangePercent) || 0;
            }
          }
        } catch (_) {}

        // 2. Try direct CORS-enabled Binance Vision mirror
        if (!price) {
          try {
            const res = await fetch(`https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${symbol}`);
            if (res.ok) {
              const d = await res.json();
              if (d && d.lastPrice) {
                price = parseFloat(d.lastPrice);
                change = parseFloat(d.priceChangePercent) || 0;
              }
            }
          } catch (_) {}
        }

        // 3. Try Coinbase Spot Price (CORS enabled, highly reliable in US/global)
        if (!price) {
          try {
            const pair = selectedAsset === 'BTC' ? 'BTC-USD' : selectedAsset === 'ETH' ? 'ETH-USD' : 'SOL-USD';
            const res = await fetch(`https://api.coinbase.com/v2/prices/${pair}/spot`);
            if (res.ok) {
              const d = await res.json();
              if (d?.data?.amount) {
                price = parseFloat(d.data.amount);
              }
            }
          } catch (_) {}
        }

        // 4. Try Kraken Spot Price
        if (!price && selectedAsset === 'SOL') {
          try {
            const res = await fetch('https://api.kraken.com/0/public/Ticker?pair=SOLUSD');
            if (res.ok) {
              const d = await res.json();
              if (d?.result?.SOLUSD?.c?.[0]) {
                price = parseFloat(d.result.SOLUSD.c[0]);
              }
            }
          } catch (_) {}
        }

        if (price && isMounted) {
          setSolPrice(price);
          setPriceChange(change);
        }
      } catch {
        // Fallback gracefully
      }
    };

    fetchTicker();
    const interval = setInterval(fetchTicker, updateIntervalSecs * 1000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [selectedAsset, updateIntervalSecs]);

  const executeBacktest = useCallback(
    async (cfgToUse: SimulationConfig = config) => {
      setIsRunning(true);
      setProgressPct(0);
      setStatusText('Initializing Jump-Diffusion engine...');

      try {
        const { isolated, combined } = await runFullSimulation(
          cfgToUse,
          (msg, pct) => {
            setStatusText(msg);
            setProgressPct(pct);
          },
        );

        setIsolatedResults(isolated);
        setCombinedResult(combined);
        setProgressPct(100);
        setStatusText(
          `Backtest Complete — ${combined.trades.length} trades executed across all 4 regimes.`,
        );
      } catch (err) {
        console.error('Backtest error:', err);
        setStatusText('Error executing backtest simulation');
      } finally {
        setIsRunning(false);
      }
    },
    [config],
  );

  // Auto-run simulation once on initial load for instant lab experience
  useEffect(() => {
    executeBacktest(DEFAULT_CONFIG);
  }, [executeBacktest]);

  const handleResetDefaults = () => {
    setConfig(DEFAULT_CONFIG);
    executeBacktest(DEFAULT_CONFIG);
  };

  const allResults = combinedResult
    ? [...isolatedResults, combinedResult]
    : isolatedResults;

  const currentResult =
    allResults.find((r) => r.regime === selectedRegime) ||
    combinedResult ||
    isolatedResults[0];

  return (
    <div className="min-h-screen bg-[#111110] text-[#f5f5f3] font-sans antialiased selection:bg-blue-600 selection:text-white pb-16">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 pt-5">
        {/* Unified Terminal Header with 3 Window Tabs */}
        <Header
          activeWindow={activeWindow}
          onSelectWindow={setActiveWindow}
          currentAsset={selectedAsset}
          solPrice={solPrice}
          priceChange={priceChange}
          onSelectAsset={setSelectedAsset}
          updateIntervalSecs={updateIntervalSecs}
          setUpdateIntervalSecs={setUpdateIntervalSecs}
          isRunning={isRunning}
          onRun={() => executeBacktest()}
          onOpenMonteCarlo={() => setIsMonteCarloOpen(true)}
          onResetDefaults={handleResetDefaults}
          hasTrades={Boolean(combinedResult && combinedResult.trades.length > 0)}
          portfolioBalance={portfolioBalance}
          onUpdatePortfolioBalance={handleUpdatePortfolioBalance}
          openPositionsCount={openPositionsCount}
          maxOpenPositions={maxOpenPositions}
          activeTierName={activeTierName}
          currentRegime={currentRegime}
          onOpenExecutedTradesLedger={() => setIsLedgerModalOpen(true)}
          onExportCSV={() => {
            if (combinedResult) {
              exportAllResultsToCSV(isolatedResults, combinedResult);
            }
          }}
        />

        {/* WINDOW 1: LIVE VIEW */}
        {activeWindow === 'LIVE_VIEW' && (
          <div className="animate-fadeIn">
            <LiveDashboardView
              currentAsset={selectedAsset}
              onSelectAsset={setSelectedAsset}
              solPrice={solPrice}
              updateIntervalSecs={updateIntervalSecs}
              onSetUpdateIntervalSecs={setUpdateIntervalSecs}
              onSwitchToAutoTrade={() => setActiveWindow('AUTOTRADE')}
              onSwitchToBacktest={() => setActiveWindow('BACKTEST')}
              portfolioBalance={portfolioBalance}
              onUpdatePortfolioBalance={handleUpdatePortfolioBalance}
              openPositionsCount={openPositionsCount}
              maxOpenPositions={maxOpenPositions}
              isLedgerModalOpen={isLedgerModalOpen}
              onOpenLedgerModal={() => setIsLedgerModalOpen(true)}
              onCloseLedgerModal={() => setIsLedgerModalOpen(false)}
              onRegimeChange={setCurrentRegime}
            />
          </div>
        )}

        {/* WINDOW 2: AUTOTRADE JUPITER */}
        {activeWindow === 'AUTOTRADE' && (
          <div className="animate-fadeIn">
            <AutoTradeJupiterView
              currentAsset={selectedAsset}
              onSelectAsset={setSelectedAsset}
              onSwitchToLive={() => setActiveWindow('LIVE_VIEW')}
              solPrice={solPrice}
              priceChange={priceChange}
              portfolioBalance={portfolioBalance}
              onUpdatePortfolioBalance={handleUpdatePortfolioBalance}
            />
          </div>
        )}

        {/* WINDOW 3: SIMULATION / BACKTEST */}
        {activeWindow === 'BACKTEST' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Informational Optimization Banner */}
            <NoteBanner />

            {/* Backtest Configuration Panel */}
            <ConfigPanel
              config={config}
              onChange={setConfig}
              onRun={() => executeBacktest()}
              isRunning={isRunning}
              progressPct={progressPct}
              statusText={statusText}
            />

            {/* Active Simulation Results Display */}
            {combinedResult && (
              <div id="results-container" className="space-y-6">
                {/* Overview Comparison Table */}
                <OverviewTable
                  results={isolatedResults}
                  combinedResult={combinedResult}
                  selectedRegime={selectedRegime}
                  onSelectRegime={setSelectedRegime}
                />

                {/* Regime Summary Cards Grid */}
                <RegimeCards
                  results={isolatedResults}
                  combinedResult={combinedResult}
                  selectedRegime={selectedRegime}
                  onSelectRegime={setSelectedRegime}
                />

                {/* Equity Trajectory & Capital Growth Chart */}
                {currentResult && (
                  <EquityChart
                    currentResult={currentResult}
                    allResults={allResults}
                    selectedRegime={selectedRegime}
                    onSelectRegime={setSelectedRegime}
                    lsdThreshold={config.lsdThreshold}
                  />
                )}

                {/* Jump-Diffusion Price Series Visualizer with Poisson Wicks */}
                {currentResult && currentResult.candles && (
                  <CandleVisualizer currentResult={currentResult} />
                )}

                {/* Executed Trades Ledger with Filters and CSV Export */}
                {currentResult && (
                  <TradesLedger
                    currentResult={currentResult}
                    allResults={allResults}
                    selectedRegime={selectedRegime}
                    onSelectRegime={setSelectedRegime}
                    combinedResult={combinedResult}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Monte Carlo Stress Testing Modal */}
        <MonteCarloModal
          isOpen={isMonteCarloOpen}
          onClose={() => setIsMonteCarloOpen(false)}
          config={config}
        />
      </div>
    </div>
  );
}
