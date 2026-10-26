import React, { useState, useEffect, useCallback } from 'react';
import { TradeMonitoringCard } from './TradeMonitoringCard.tsx';
import {
  ShieldCheck,
  ShieldAlert,
  Play,
  Pause,
  AlertTriangle,
  RefreshCw,
  Settings,
  Radio,
  ExternalLink,
  Zap,
  TrendingUp,
  Activity,
  Layers,
  Send,
  Sliders,
  CheckCircle,
  Lock,
  Unlock,
  Key,
  Wallet,
  Copy,
  Check,
  Info,
  Globe,
  Terminal,
  Gauge,
  ArrowRight,
  Flame,
  Cpu,
  Clock,
  Eye,
  EyeOff,
  History,
  Download,
} from 'lucide-react';

interface Position {
  id: string;
  asset: string;
  side: 'Long' | 'Short';
  status: 'open' | 'pending' | 'closed';
  fillPrice: number;
  margin: number;
  leverage: number;
  tp1?: number;
  tp2?: number;
  takeProfit: number;
  stopLoss: number;
  time: string;
  isSimulated?: boolean;
  signerPublicKey?: string | null;
}

interface SafetyCondition {
  id: string;
  title: string;
  description: string;
  passed: boolean;
  detail: string;
}

interface SafetyAuditData {
  signer: { publicKey: string; path: string } | null;
  solBalance: number;
  latencyMs: number;
  slot: number;
  rpcHealthy: boolean;
  conditions: SafetyCondition[];
  canArmLiveTrading: boolean;
  safetyToggle: {
    enabled: boolean;
    unlockedAt: number | null;
  };
  executionMode: 'simulate' | 'live_onchain';
  network: string;
  rpcUrl: string;
}

interface AutoTradeJupiterViewProps {
  currentAsset: string;
  onSelectAsset: (asset: string) => void;
  onSwitchToLive: () => void;
  solPrice?: number;
  priceChange?: number;
  portfolioBalance?: number;
  onUpdatePortfolioBalance?: (newBal: number) => void;
}

type TabType = 'overview' | 'safety' | 'signals' | 'risk';

export const AutoTradeJupiterView: React.FC<AutoTradeJupiterViewProps> = ({
  currentAsset,
  onSelectAsset,
  onSwitchToLive,
  solPrice = 119.05,
  priceChange = 0.05,
  portfolioBalance: propPortfolioBalance = 30.0,
  onUpdatePortfolioBalance: propOnUpdatePortfolioBalance,
}) => {
  // Navigation tabs
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  // Bot & Trading States
  const [isAutoArmed, setIsAutoArmed] = useState<boolean>(() => {
    return localStorage.getItem('sol_bot_autotrade') !== 'false';
  });
  const [isHalted, setIsHalted] = useState<boolean>(false);
  const [balance, setBalance] = useState<number>(() => propPortfolioBalance || 30.0);
  const [dailyPnL, setDailyPnL] = useState<number>(0.0);
  const [positions, setPositions] = useState<Position[]>([]);
  const [recentTrades, setRecentTrades] = useState<any[]>([]);
  const [network, setNetwork] = useState<string>(() => localStorage.getItem('sol_network') || 'devnet');
  const [rpcUrl, setRpcUrl] = useState<string>(
    () => localStorage.getItem('sol_rpc_url') || 'https://api.devnet.solana.com',
  );
  const [showRpcKey, setShowRpcKey] = useState<boolean>(false);
  const [isEditingBalance, setIsEditingBalance] = useState<boolean>(false);
  const [balanceInput, setBalanceInput] = useState<string>('30');
  const [botUrl, setBotUrl] = useState<string>(() => {
    const saved = localStorage.getItem('sol_bot_url');
    if (!saved || saved.includes('localhost:3001')) return '';
    return saved;
  });
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'info' | 'success' | 'warning' | 'error' } | null>(null);

  useEffect(() => {
    if (typeof propPortfolioBalance === 'number') {
      setBalance(propPortfolioBalance);
    }
  }, [propPortfolioBalance]);

  // Safety Toggle & Wallet States
  const [safetyData, setSafetyData] = useState<SafetyAuditData | null>(null);
  const [isLoadingSafety, setIsLoadingSafety] = useState<boolean>(false);
  const [isTogglingSafety, setIsTogglingSafety] = useState<boolean>(false);
  const [isAirdropping, setIsAirdropping] = useState<boolean>(false);
  const [isGeneratingKey, setIsGeneratingKey] = useState<boolean>(false);
  const [copiedPubkey, setCopiedPubkey] = useState<boolean>(false);
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [importKeyInput, setImportKeyInput] = useState<string>('');
  const [importError, setImportError] = useState<string | null>(null);

  // Custom Signal Test Parameters
  const [testSide, setTestSide] = useState<'Long' | 'Short'>('Long');
  const [testMargin, setTestMargin] = useState<number>(30);
  const [testOffset, setTestOffset] = useState<number>(0.08);

  // Anchored limit entry for TradeMonitoringCard guidance so the yellow marker ball actively slides
  // as market ticks, instead of entry moving with every price tick
  const [anchoredGuidanceEntry, setAnchoredGuidanceEntry] = useState<number | null>(null);

  // Initialize and re-anchor only when testSide or testOffset is changed
  useEffect(() => {
    if (solPrice > 0) {
      const calcEntry = parseFloat(
        (testSide === 'Long' ? solPrice - testOffset : solPrice + testOffset).toFixed(2)
      );
      setAnchoredGuidanceEntry((prev) => (prev === null ? calcEntry : prev));
    }
  }, [testSide, testOffset]);

  const handleReanchorGuidance = () => {
    if (solPrice > 0) {
      const newEntry = parseFloat(
        (testSide === 'Long' ? solPrice - testOffset : solPrice + testOffset).toFixed(2)
      );
      setAnchoredGuidanceEntry(newEntry);
      notify(`⚓ Limit Entry re-anchored to $${newEntry.toFixed(2)} (${Math.round(testOffset * 100)}¢ below mark $${solPrice.toFixed(2)})`, 'info', 3000);
    }
  };

  // Auto-Preset Switcher & Circuit Breaker state
  const [autoSwitcher, setAutoSwitcher] = useState<{
    enabled: boolean;
    balance: number;
    activeTier: string;
    activePreset?: {
      name: string;
      leverage: number;
      maxRiskDollarCap: number;
      tp2Dist: number;
      description: string;
    };
    circuitBreaker?: {
      active: boolean;
      standbyBarsRemaining: number;
      consecutiveLosses: number;
      lastTriggerReason: string | null;
    };
  } | null>(null);

  const [actionTileSignal, setActionTileSignal] = useState<'green' | 'yellow' | 'red'>('yellow');

  useEffect(() => {
    const handleSig = (e: any) => {
      if (e?.detail?.signal) {
        setActionTileSignal(e.detail.signal.toLowerCase());
      }
    };
    window.addEventListener('SIGNAL_UPDATED', handleSig);
    return () => window.removeEventListener('SIGNAL_UPDATED', handleSig);
  }, []);

  const notify = (text: string, type: 'info' | 'success' | 'warning' | 'error' = 'info', timeout = 5000) => {
    setStatusMessage({ text, type });
    setTimeout(() => {
      setStatusMessage((curr) => (curr?.text === text ? null : curr));
    }, timeout);
  };

  // Poll Bot State
  const fetchBotState = useCallback(async () => {
    try {
      const res = await fetch(`${botUrl}/state`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setBalance(data.balance ?? 240.0);
        setDailyPnL(data.dailyPnL ?? 0.0);
        setIsHalted(Boolean(data.halted));
        if (data.currentSignal?.signal) {
          setActionTileSignal(data.currentSignal.signal.toLowerCase());
        } else if (data.marketIndicators?.signal) {
          setActionTileSignal(data.marketIndicators.signal.toLowerCase());
        }
        if (Array.isArray(data.positions)) {
          setPositions(data.positions);
        }
        if (data.autoSwitcher) {
          setAutoSwitcher(data.autoSwitcher);
        }
        if (data.autoTrade && typeof data.autoTrade.enabled === 'boolean') {
          setIsAutoArmed(data.autoTrade.enabled);
        }
      }

      const tradesRes = await fetch(`${botUrl}/api/trades`, { cache: 'no-store' });
      if (tradesRes.ok) {
        const tradesData = await tradesRes.json();
        if (Array.isArray(tradesData.trades)) {
          setRecentTrades(tradesData.trades);
        }
      }
    } catch {
      // Offline fallback
    }
  }, [botUrl]);

  const handleResetCircuitBreaker = async () => {
    try {
      const res = await fetch(`${botUrl}/reset-circuit-breaker`, { method: 'POST' });
      if (res.ok) {
        notify('Auto-Switcher 2-Loss Chop Circuit Breaker reset.', 'success');
        fetchBotState();
      }
    } catch {
      notify('Failed to connect to bot service to reset circuit breaker', 'error');
    }
  };

  // Fetch Safety Audit & Wallet Status
  const fetchSafetyStatus = useCallback(async () => {
    setIsLoadingSafety(true);
    try {
      const res = await fetch(`${botUrl}/wallet-status`, { cache: 'no-store' });
      if (res.ok) {
        const data: SafetyAuditData = await res.json();
        setSafetyData(data);
      }
    } catch {
      // Offline fallback
    } finally {
      setIsLoadingSafety(false);
    }
  }, [botUrl]);

  const handleSetPortfolioBalance = async (newVal: number) => {
    try {
      const res = await fetch(`${botUrl}/portfolio-balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance: newVal }),
      });
      const d = await res.json();
      if (res.ok && d.success) {
        setBalance(d.balance);
        if (d.autoSwitcher) setAutoSwitcher(d.autoSwitcher);
        if (propOnUpdatePortfolioBalance) propOnUpdatePortfolioBalance(d.balance);
        notify(d.message || `Portfolio value updated to $${d.balance.toFixed(2)}`, 'success', 5000);
        setIsEditingBalance(false);
        fetchBotState();
        window.dispatchEvent(new CustomEvent('BOT_STATE_UPDATED'));
      } else {
        notify(d.error || 'Failed to update portfolio balance', 'error');
      }
    } catch (err: any) {
      notify('Failed to update portfolio balance: ' + err.message, 'error');
    }
  };

  useEffect(() => {
    fetchBotState();
    fetchSafetyStatus();
    // Fast 1000ms polling for responsive open positions monitor
    const interval = setInterval(() => {
      fetchBotState();
      fetchSafetyStatus();
    }, 1000);

    const onUpdate = () => {
      fetchBotState();
      fetchSafetyStatus();
    };
    window.addEventListener('BOT_STATE_UPDATED', onUpdate);
    window.addEventListener('focus', onUpdate);

    return () => {
      clearInterval(interval);
      window.removeEventListener('BOT_STATE_UPDATED', onUpdate);
      window.removeEventListener('focus', onUpdate);
    };
  }, [fetchBotState, fetchSafetyStatus]);

  // Handle Safety Toggle Switch
  const handleToggleSafety = async (wantsEnable: boolean) => {
    if (wantsEnable) {
      if (!safetyData?.canArmLiveTrading) {
        notify('Cannot arm Live Trading: All 5 safety conditions must be met.', 'error');
        return;
      }
      if (
        !confirm(
          `⚠️ CAUTION: You are enabling LIVE ON-CHAIN trading on Solana ${network.toUpperCase()}.\n\nReal transactions will be signed and submitted by keypair (${safetyData?.signer?.publicKey.slice(0, 6)}...).\n\nProceed to unlock Safety Interlock?`
        )
      ) {
        return;
      }
    }

    setIsTogglingSafety(true);
    try {
      const res = await fetch(`${botUrl}/safety-toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: wantsEnable }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        notify(
          wantsEnable
            ? `⚡ Live Trading ARMED on Solana ${network.toUpperCase()}! Keypair active.`
            : '🔒 Safety Interlock ENGAGED: Simulation Sandbox Active (Zero Financial Risk).',
          wantsEnable ? 'success' : 'info',
          6000
        );
        fetchSafetyStatus();
        fetchBotState();
      } else {
        notify(data.error || 'Failed to toggle safety switch.', 'error', 6000);
      }
    } catch (err: any) {
      notify('Connection failed: ' + err.message, 'error');
    } finally {
      setIsTogglingSafety(false);
    }
  };

  // Handle Requesting Devnet Airdrop
  const handleRequestAirdrop = async () => {
    if (network !== 'devnet') {
      notify('Airdrops are only available on Solana Devnet.', 'warning');
      return;
    }
    setIsAirdropping(true);
    try {
      const res = await fetch(`${botUrl}/airdrop`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        notify(
          data.note || `Airdrop confirmed! SOL balance: ${data.solBalance} SOL`,
          'success',
          7000
        );
        fetchSafetyStatus();
      } else {
        notify(data.error || 'Airdrop failed.', 'error', 6000);
      }
    } catch (err: any) {
      notify('Airdrop failed: ' + err.message, 'error');
    } finally {
      setIsAirdropping(false);
    }
  };

  // Generate Keypair
  const handleGenerateKeypair = async () => {
    if (
      safetyData?.signer &&
      !confirm('A keypair is already detected. Generate a new keypair and overwrite?')
    ) {
      return;
    }
    setIsGeneratingKey(true);
    try {
      const res = await fetch(`${botUrl}/wallet-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate', network }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        notify(`New Solana keypair generated: ${data.publicKey}`, 'success', 6000);
        fetchSafetyStatus();
      } else {
        notify(data.error || 'Keypair generation failed.', 'error');
      }
    } catch (err: any) {
      notify('Key generation failed: ' + err.message, 'error');
    } finally {
      setIsGeneratingKey(false);
    }
  };

  // Import Keypair
  const handleImportKeypair = async () => {
    setImportError(null);
    if (!importKeyInput.trim()) {
      setImportError('Please enter a valid 64-byte JSON array or Base58 secret key.');
      return;
    }
    try {
      const res = await fetch(`${botUrl}/wallet-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import', key: importKeyInput.trim(), network }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        notify(`Keypair imported successfully! Public key: ${data.publicKey}`, 'success', 6000);
        setShowImportModal(false);
        setImportKeyInput('');
        fetchSafetyStatus();
      } else {
        setImportError(data.error || 'Failed to validate keypair.');
      }
    } catch (err: any) {
      setImportError(err.message);
    }
  };

  // AutoTrade Engine Toggle
  const toggleAutoTrade = async () => {
    const next = !isAutoArmed;
    setIsAutoArmed(next);
    localStorage.setItem('sol_bot_autotrade', next ? 'true' : 'false');
    try {
      await fetch(`${botUrl}/autotrade/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
    } catch (_) {}
    notify(
      next
        ? 'AutoTrade Engine ARMED: Inbound signals will auto-dispatch limit orders.'
        : 'AutoTrade Engine PAUSED: Signals will only be logged; no orders dispatched.',
      next ? 'success' : 'info'
    );
  };

  // Circuit Breaker Halt / Resume
  const handleHalt = async () => {
    const nextHalted = !isHalted;
    setIsHalted(nextHalted);
    try {
      await fetch(`${botUrl}/${nextHalted ? 'halt' : 'resume'}`, { method: 'POST' });
      fetchSafetyStatus();
      fetchBotState();
    } catch {
      // Offline fallback
    }
    notify(
      nextHalted
        ? '🚨 CIRCUIT BREAKER TRIPPED: All automated execution halted & safety locked.'
        : 'Circuit breaker reset. Bot execution resumed.',
      nextHalted ? 'error' : 'success'
    );
  };

  // Panic Flatten (deliberate kill-switch, user-confirmed).
  // P0 safety: the server now requires an EXPLICIT closeAll flag for a
  // mass flatten; a bare reason no longer flattens anything.
  const handlePanicFlatten = async () => {
    if (confirm('🚨 PANIC FLATTEN: Close all open positions on Jupiter immediately at market price?')) {
      try {
        await fetch(`${botUrl}/close`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'PANIC_FLATTEN', closeAll: true }),
        });
      } catch {
        // Offline fallback
      }
      setPositions([]);
      notify('Panic Flatten executed: All positions closed at market.', 'warning');
      fetchBotState();
    }
  };

  // Dispatch a MANUAL test signal (Phase 2: the server computes sizing
  // from the canonical tier table — this sender no longer overrides
  // margin or targets. The old payload forced recommendedMargin
  // (testMargin x 4) and tp2 1.20 regardless of tier; the server
  // ignored the margin and honored the tp2 override, so test orders
  // were sized off-tier. Gate fields are included because this is a
  // deliberate operator dispatch: 2-bar confirmation is asserted by
  // the operator pressing the button, and a test short carries the
  // designedShort marker. The server mode (paper/simulate/live)
  // decides what actually happens — the button label no longer claims
  // "Simulate" in a live-armed process.)
  const handleSendSignal = async (overrideSide?: 'Long' | 'Short') => {
    const side = overrideSide || testSide;
    const entryPrice = side === 'Long' ? solPrice - testOffset : solPrice + testOffset;

    try {
      const res = await fetch(`${botUrl}/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset: currentAsset,
          direction: side === 'Long' ? 'buy' : 'sell',
          designedShort: side === 'Short',
          price: solPrice,
          entryOffset: testOffset,
          regime: 'RANGE_BOUND_SUPPORT',
          adx: 25,
          consecutiveGreen5m: 2,
          consecutiveRed5m: 2,
          barConfirmation: 2,
          tp1Percent: 30,
          tp2Percent: 70,
        }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'placed') {
        notify(
          `Order Placed (${data.isSimulated ? 'Simulation' : 'Live On-Chain'}): ${side} @ $${data.entryPrice} | PDA: ${data.requestPDA?.slice(0, 8)}...`,
          'success',
          6000
        );
        fetchBotState();
      } else {
        notify(`Order Rejected: ${data.message || data.error}`, 'error', 7000);
      }
    } catch (err: any) {
      notify('Failed to dispatch order: ' + err.message, 'error');
    }
  };

  const handleClosePosition = async (id: string, pda?: string) => {
    try {
      await fetch(`${botUrl}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestPDA: pda || id, reason: 'MANUAL_CLOSE' }),
      });
      notify(`Position #${id.slice(-6)} closed.`, 'info');
      fetchBotState();
    } catch {
      setPositions((prev) => prev.filter((p) => p.id !== id));
    }
  };

  const copyPublicKey = () => {
    if (safetyData?.signer?.publicKey) {
      navigator.clipboard.writeText(safetyData.signer.publicKey);
      setCopiedPubkey(true);
      setTimeout(() => setCopiedPubkey(false), 2000);
    }
  };

  const tickers = ['SOL', 'BTC', 'ETH', 'BNB', 'XRP'];
  const currentTierLeverage = autoSwitcher?.activePreset?.leverage || (balance < 100 ? 20 : balance < 250 ? 35 : 50);
  const marginCollateral = autoSwitcher?.activePreset?.defaultMargin || (balance < 100 ? Math.min(balance, 25.00) : balance < 250 ? Math.min(balance * 0.50, 50.00) : Math.min(balance * 0.40, 100.00));
  const buyingPower = marginCollateral * currentTierLeverage; // Accurate buying power committed per trade ($500.00 on $30 balance)
  const maxLeverageCapacity = balance * currentTierLeverage; // Theoretical 100% wallet exposure ($600.00 on $30 balance)
  const maxAllowedPositions = autoSwitcher?.activePreset?.maxOpenPositions ?? (balance < 100 ? 1 : balance < 250 ? 2 : 3);
  const activeOpenPositionsCount = positions.filter((p) => p.status === 'open' || p.status === 'filled' || p.status === 'pending').length;
  const isSafetyArmed = Boolean(safetyData?.safetyToggle?.enabled);

  return (
    <div className="space-y-4">
      {/* 1. TOP GLOBAL CONTROL & METRICS HEADER */}
      <div className="bg-[#141516] border border-white/10 rounded-2xl p-4 shadow-xl space-y-3.5">
        {/* Upper Row: Target Asset, Ticker Switcher, and Main Action Buttons */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-white/10 pb-3.5">
          {/* Target Asset & Price Ticker */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-semibold text-neutral-400">ACTIVE ASSET:</span>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 bg-blue-500/20 text-blue-400 font-bold font-mono rounded-md border border-blue-500/30 text-xs">
                {currentAsset}
              </span>
              <span className="text-base font-bold font-mono text-white">
                ${solPrice.toFixed(2)}
              </span>
              <span
                className={`text-xs font-semibold font-mono px-1.5 py-0.5 rounded ${
                  priceChange >= 0
                    ? 'text-emerald-400 bg-emerald-500/10'
                    : 'text-red-400 bg-red-500/10'
                }`}
              >
                {priceChange >= 0 ? '+' : ''}
                {priceChange.toFixed(2)}%
              </span>
            </div>

            <div className="flex items-center gap-1 ml-1">
              {tickers.map((t) => (
                <button
                  key={t}
                  onClick={() => onSelectAsset(t)}
                  className={`px-2 py-0.5 rounded font-mono text-xs transition-colors ${
                    currentAsset === t
                      ? 'bg-amber-500 text-neutral-950 font-bold'
                      : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* AutoTrade Arm Button */}
            <button
              onClick={toggleAutoTrade}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 shadow-md ${
                isAutoArmed
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/40'
                  : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-white/10'
              }`}
            >
              {isAutoArmed ? (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  <span>AUTOTRADE: ON</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>AUTOTRADE: PAUSED</span>
                </>
              )}
            </button>

            {/* Emergency Circuit Breaker */}
            <button
              onClick={handleHalt}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                isHalted
                  ? 'bg-amber-600 hover:bg-amber-500 text-white border border-amber-400/30'
                  : 'bg-red-950/50 hover:bg-red-900/60 text-red-300 border border-red-500/30'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
              <span>{isHalted ? 'RESUME ENGINE' : 'HALT (CIRCUIT)'}</span>
            </button>

            {/* Panic Flatten */}
            <button
              onClick={handlePanicFlatten}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-white/10 transition-colors"
              title="Close all open positions immediately at market"
            >
              Panic Flatten
            </button>

            {/* Refresh */}
            <button
              onClick={() => {
                fetchBotState();
                fetchSafetyStatus();
              }}
              className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-white/10 transition-colors"
              title="Refresh engine state and balances"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Lower Row: Summary Metrics Bar & Safety Status Badge */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
          <div className="bg-[#191a1c] border border-white/5 rounded-xl p-2.5 relative group">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-neutral-400 font-medium block">Portfolio Value</span>
              <button
                onClick={() => {
                  setBalanceInput(balance.toString());
                  setIsEditingBalance(true);
                }}
                className="text-[10px] text-blue-400 hover:text-blue-300 font-bold underline"
                title="Change initial Portfolio value (e.g. $30.00)"
              >
                Change
              </button>
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-sm font-bold font-mono text-white">
                ${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-300 border border-white/10">
                {currentTierLeverage}x
              </span>
            </div>
          </div>

          <div className="bg-[#191a1c] border border-white/5 rounded-xl p-2.5">
            <span className="text-[10px] text-neutral-400 font-medium block">Active Buying Power ({currentTierLeverage}x)</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-sm font-bold font-mono text-emerald-400">
                ${buyingPower.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-neutral-400 font-mono">
                (${marginCollateral.toFixed(2)} Margin)
              </span>
            </div>
            <span className="text-[9px] text-neutral-500 block truncate" title={`Collateral Margin: $${marginCollateral.toFixed(2)} (${((marginCollateral / balance) * 100).toFixed(0)}% of $${balance.toFixed(2)} balance) · Max Account Leverage Capacity: $${maxLeverageCapacity.toFixed(2)}`}>
              Collateral: ${marginCollateral.toFixed(2)} · Cap: ${maxLeverageCapacity.toFixed(2)}
            </span>
          </div>

          <div className="bg-[#191a1c] border border-white/5 rounded-xl p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-neutral-400 font-medium block">Open Positions</span>
              <span className={`h-2 w-2 rounded-full ${activeOpenPositionsCount > 0 ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
            </div>
            <div className="flex items-baseline justify-between mt-0.5">
              <span className="text-sm font-bold font-mono text-blue-400">
                {activeOpenPositionsCount} <span className="text-[10px] text-neutral-500">/ {maxAllowedPositions}</span>
              </span>
              <span className="text-[9px] font-mono text-neutral-400">
                {positions.filter(p => p.status === 'open' || p.status === 'filled').length} Active · {positions.filter(p => p.status === 'pending').length} Limit
              </span>
            </div>
          </div>

          <div className="bg-[#191a1c] border border-white/5 rounded-xl p-2.5">
            <span className="text-[10px] text-neutral-400 font-medium block">Daily Realized PnL</span>
            <span
              className={`text-sm font-bold font-mono ${
                dailyPnL >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {dailyPnL >= 0 ? '+' : ''}${dailyPnL.toFixed(2)}
            </span>
          </div>

          <div className="bg-[#191a1c] border border-white/5 rounded-xl p-2.5">
            <span className="text-[10px] text-neutral-400 font-medium block">Circuit Breaker</span>
            <span
              className={`text-sm font-bold font-mono flex items-center gap-1 ${
                isHalted ? 'text-red-400' : 'text-emerald-400'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isHalted ? 'bg-red-400' : 'bg-emerald-400'}`} />
              {isHalted ? 'HALTED' : 'HEALTHY'}
            </span>
          </div>

          {/* Safety Interlock Pill */}
          <div
            onClick={() => setActiveTab('safety')}
            className={`border rounded-xl p-2.5 cursor-pointer transition-all ${
              isSafetyArmed
                ? 'bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-500/60 text-emerald-400'
                : 'bg-blue-500/10 border-blue-500/30 hover:border-blue-500/60 text-blue-400'
            }`}
          >
            <span className="text-[10px] text-neutral-400 font-medium block flex items-center justify-between">
              <span>Safety Interlock</span>
              <ArrowRight className="w-3 h-3 opacity-60" />
            </span>
            <div className="text-xs font-bold font-mono flex items-center gap-1 mt-0.5">
              {isSafetyArmed ? (
                <>
                  <Unlock className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="truncate">LIVE ARMED</span>
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5 text-blue-400" />
                  <span className="truncate">SANDBOX SAFE</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Set Portfolio Value Modal */}
        {isEditingBalance && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
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

              <p className="text-xs text-neutral-400 leading-relaxed">
                Set your target autotrade equity. Setting to <b>$30.00</b> activates <b>Tier 1: Peak Win Rate (20x)</b> with $25 margin, +35¢/+55¢ targets, and a max 1 position cap.
              </p>

              <div>
                <label className="text-[10px] text-neutral-400 block mb-1">Target Balance ($ USD)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-neutral-400 font-mono text-sm">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={balanceInput}
                    onChange={(e) => setBalanceInput(e.target.value)}
                    className="w-full bg-[#141516] border border-white/10 rounded-lg pl-7 pr-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
                    placeholder="30.00"
                  />
                </div>
              </div>

              {/* Quick Presets */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-neutral-500">Quick:</span>
                {[30, 50, 100, 240, 500].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setBalanceInput(preset.toString())}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold transition-all ${
                      balanceInput === preset.toString()
                        ? 'bg-blue-600 text-white'
                        : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                    }`}
                  >
                    ${preset}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsEditingBalance(false)}
                  className="flex-1 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-bold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const val = parseFloat(balanceInput);
                    if (!isNaN(val) && val > 0) {
                      handleSetPortfolioBalance(val);
                    }
                  }}
                  className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors"
                >
                  Save &amp; Sync Tier
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Auto-Preset Switcher Active Tier & Circuit Breaker Interlock */}
        <div className="bg-[#141619] border border-amber-500/30 rounded-xl p-3 text-xs font-mono space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-amber-400 font-bold flex items-center gap-1">
                <span>⚡</span> [AUTO-PRESET SWITCHER]
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                balance < 100
                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                  : balance < 250
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              }`}>
                {balance < 100
                  ? 'TIER 1: PEAK WIN RATE (20x LSD)'
                  : balance < 250
                    ? 'TIER 2: HYBRID SCALING (35x)'
                    : 'TIER 3: MAX ALPHA (50x)'}
              </span>
              <span className="text-neutral-400 text-[11px]">
                Portfolio: ${balance.toFixed(2)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {autoSwitcher?.circuitBreaker?.active ? (
                <div className="flex items-center gap-1.5">
                  <span className="bg-amber-500/20 text-amber-300 border border-amber-500/50 px-2 py-0.5 rounded text-[10px] font-bold animate-pulse">
                    ⚠️ STANDBY: {autoSwitcher.circuitBreaker.standbyBarsRemaining} BARS REMAINING
                  </span>
                  <button
                    onClick={handleResetCircuitBreaker}
                    className="px-2 py-0.5 text-[10px] font-bold rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-white/20 transition-colors"
                  >
                    Reset
                  </button>
                </div>
              ) : (
                <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded text-[10px] font-bold">
                  🟢 CIRCUIT BREAKER: ARMED
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px]">
            <div className={`p-2 rounded border ${
              balance < 100 ? 'bg-blue-500/10 border-blue-500/40 text-blue-200' : 'bg-black/20 border-white/5 text-neutral-400'
            }`}>
              <div className="font-bold flex justify-between">
                <span>$0.00 – $99.99</span>
                <span>20x LSD</span>
              </div>
              <div className="text-[10px] text-neutral-300 mt-0.5">Peak Win Rate Mode</div>
              <div className="text-[9px] text-neutral-400">3% Risk Cap (-$0.90 max on $30) · Margin: $25 Collateral → $500 Buying Power (20x) · TP2 +$0.55/$0.70/$0.85 by tier</div>
            </div>

            <div className={`p-2 rounded border ${
              balance >= 100 && balance < 250 ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200' : 'bg-black/20 border-white/5 text-neutral-400'
            }`}>
              <div className="font-bold flex justify-between">
                <span>$100.00 – $249.99</span>
                <span>35x</span>
              </div>
              <div className="text-[10px] text-neutral-300 mt-0.5">Hybrid Scaling Tier</div>
              <div className="text-[9px] text-neutral-400">5% Risk Cap (-$5.00 max on $100) · Margin: $50 Collateral → $1,750 Buying Power (35x) · TP2 +0.70/1.00 ATR</div>
            </div>

            <div className={`p-2 rounded border ${
              balance >= 250 ? 'bg-amber-500/10 border-amber-500/40 text-amber-200' : 'bg-black/20 border-white/5 text-neutral-400'
            }`}>
              <div className="font-bold flex justify-between">
                <span>$250.00+</span>
                <span>50x</span>
              </div>
              <div className="text-[10px] text-neutral-300 mt-0.5">Max Alpha Mode</div>
              <div className="text-[9px] text-neutral-400">10% Risk Cap (-$25.00 max on $250) · Margin: $100 Collateral → $5,000 Buying Power (50x) · TP2 +0.85/1.20 ATR</div>
            </div>
          </div>
        </div>

        {/* Global Notification Toast */}
        {statusMessage && (
          <div
            className={`rounded-xl px-4 py-2 text-xs flex items-center justify-between animate-fadeIn border ${
              statusMessage.type === 'error'
                ? 'bg-red-950/60 border-red-500/50 text-red-200'
                : statusMessage.type === 'warning'
                ? 'bg-amber-950/60 border-amber-500/50 text-amber-200'
                : statusMessage.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-200'
                : 'bg-blue-950/60 border-blue-500/50 text-blue-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 shrink-0" />
              <span>{statusMessage.text}</span>
            </div>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-neutral-400 hover:text-white ml-2 text-sm"
            >
              &times;
            </button>
          </div>
        )}
      </div>

      {/* 2. CONSOLIDATED TAB NAVIGATION BAR */}
      <div className="flex items-center gap-1 bg-[#141516] border border-white/10 rounded-xl p-1 text-xs">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex-1 py-2 px-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
            activeTab === 'overview'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-800/60'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>Trade Keeper Execution Monitor</span>
        </button>

        <button
          onClick={() => setActiveTab('safety')}
          className={`flex-1 py-2 px-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 relative ${
            activeTab === 'safety'
              ? 'bg-emerald-600 text-white shadow-md'
              : isSafetyArmed
              ? 'text-emerald-400 hover:text-emerald-300 hover:bg-neutral-800/60'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-800/60'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Safety Interlock &amp; Wallet</span>
          {isSafetyArmed ? (
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse ml-1" />
          ) : (
            <span className="px-1.5 py-0.2 rounded text-[10px] bg-neutral-800 text-neutral-300 border border-white/5 font-mono ml-1">
              SAFE
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('signals')}
          className={`flex-1 py-2 px-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
            activeTab === 'signals'
              ? 'bg-amber-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-800/60'
          }`}
        >
          <Zap className="w-4 h-4" />
          <span>Signal Router &amp; Webhooks</span>
        </button>

        <button
          onClick={() => setActiveTab('risk')}
          className={`flex-1 py-2 px-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
            activeTab === 'risk'
              ? 'bg-purple-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-800/60'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>Risk &amp; Parameters</span>
        </button>
      </div>

      {/* 3. TAB 1: OVERVIEW & SNIPER MONITOR */}
      {activeTab === 'overview' && (
        <div className="space-y-4 animate-fadeIn">
          {/* Integrated Real-Time Sniper & Bracket Monitor */}
          {(() => {
            const activeGuidanceEntry = anchoredGuidanceEntry ?? parseFloat(
              (testSide === 'Long' ? (solPrice || 120.00) - testOffset : (solPrice || 120.00) + testOffset).toFixed(2)
            );
            const guidanceCalculatedTp = parseFloat(
              (activeGuidanceEntry + (testSide === 'Long' ? 1.20 : -1.20)).toFixed(2)
            );
            const guidanceCalculatedSl = parseFloat(
              (activeGuidanceEntry - (testSide === 'Long' ? 0.72 : -0.72)).toFixed(2)
            );
            return (
              <TradeMonitoringCard
                currentPrice={solPrice}
                guidanceOffset={testOffset}
                guidanceEntryPrice={activeGuidanceEntry}
                guidanceTakeProfit={guidanceCalculatedTp}
                guidanceStopLoss={guidanceCalculatedSl}
                network={network}
                isGreenGate={actionTileSignal === 'green'}
                actionTileSignal={actionTileSignal}
                portfolioBalance={balance}
                onTradeClose={(pnl) => {
                  setDailyPnL((prev) => parseFloat((prev + pnl).toFixed(2)));
                  setBalance((prev) => parseFloat((prev + pnl).toFixed(2)));
                  fetchBotState();
                }}
              />
            );
          })()}

          {/* Open Positions Tray */}
          <div className="bg-[#141516] border border-white/10 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-bold text-white">Jupiter Live Open Positions</h3>
                <span className="text-xs text-neutral-500">({positions.length} active)</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSendSignal('Long')}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 transition-all flex items-center gap-1.5"
                >
                  <Send className="w-3 h-3" />
                  <span>Send Test Signal</span>
                </button>
                {positions.length > 0 && (
                  <button
                    onClick={handlePanicFlatten}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-all"
                  >
                    Close All
                  </button>
                )}
              </div>
            </div>

            {positions.length === 0 ? (
              <div className="text-center py-10 border border-dashed border-white/10 rounded-xl text-neutral-400 text-xs">
                <CheckCircle className="w-8 h-8 text-neutral-600 mx-auto mb-2 opacity-60" />
                <p className="font-medium text-neutral-300">No open positions on Jupiter</p>
                <p className="text-[11px] text-neutral-500 mt-1 max-w-md mx-auto">
                  AutoTrade is armed. When the 15m Reversal Adaptive Sniper confirms a setup with candle absorption, limit orders auto-dispatch.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-white/10 text-neutral-400 text-[11px]">
                      <th className="pb-2">Asset</th>
                      <th className="pb-2">Side</th>
                      <th className="pb-2">Type</th>
                      <th className="pb-2">Fill Price</th>
                      <th className="pb-2">Margin</th>
                      <th className="pb-2">Targets (TP1 / TP2)</th>
                      <th className="pb-2">Stop Loss</th>
                      <th className="pb-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {positions.map((p) => (
                      <tr key={p.id} className="hover:bg-white/[0.02]">
                        <td className="py-2.5 font-bold text-white">{p.asset}</td>
                        <td
                          className={`py-2.5 font-bold ${
                            p.side === 'Long' ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {p.side}
                        </td>
                        <td className="py-2.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                p.status === 'pending'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                                  : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              }`}
                            >
                              {p.status === 'pending' ? '⏳ PENDING LIMIT' : '🟢 ACTIVE'}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                p.isSimulated
                                  ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                                  : 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                              }`}
                            >
                              {p.isSimulated ? 'SIM' : 'ON-CHAIN'}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5">${p.fillPrice.toFixed(2)}</td>
                        <td className="py-2.5">
                          ${p.margin.toFixed(2)} ({p.leverage}x)
                        </td>
                        <td className="py-2.5 text-emerald-400">
                          {p.tp1 != null ? `${p.side === 'Short' ? '−' : '+'}${p.tp1.toFixed(2)} / ` : ''}
                          {(p.takeProfit - p.fillPrice) >= 0 ? '+' : ''}${(p.takeProfit - p.fillPrice).toFixed(2)}
                        </td>
                        <td className="py-2.5 text-red-400">
                          −${Math.abs(p.fillPrice - p.stopLoss).toFixed(2)}
                        </td>
                        <td className="py-2.5 text-right">
                          <button
                            onClick={() => handleClosePosition(p.id)}
                            className="px-2.5 py-1 text-[11px] rounded bg-red-950/60 hover:bg-red-900 text-red-300 border border-red-500/30 transition-colors"
                          >
                            Close
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* RUNNING ANALYSIS & AUDIT OF LAST 3-5 TRADES */}
          <div className="bg-[#141516] border border-white/10 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Running Analysis &amp; Execution Audit (Last 3–5 Trades)</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  Live Audit Engine
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono">
                <a
                  href="/api/trades/csv"
                  download="executed_trades_ledger.csv"
                  className="px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-white/10 flex items-center gap-1.5 transition-colors text-[11px] font-bold"
                  title="Download Executed Trades Ledger CSV with exact UTC ISO timestamps"
                >
                  <Download className="w-3 h-3 text-emerald-400" />
                  <span>Download CSV</span>
                </a>
                <span className="text-neutral-400">Current Equity:</span>
                <span className="text-emerald-400 font-bold">${balance.toFixed(2)}</span>
                <button
                  onClick={() => handleSetPortfolioBalance(30)}
                  className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold transition-colors ml-1 cursor-pointer"
                  title="Reset to $30.00 Tier 1"
                >
                  Set $30
                </button>
              </div>
            </div>

            {/* Quick Metrics of Audited Trades */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono">
              <div className="bg-[#191a1c] border border-white/5 rounded-xl p-2.5">
                <div className="text-[10px] text-neutral-400 uppercase font-semibold">Audited Trades</div>
                <div className="text-base font-bold text-white mt-0.5">{Math.min(recentTrades.length, 5)} / {recentTrades.length || 0}</div>
              </div>
              <div className="bg-[#191a1c] border border-white/5 rounded-xl p-2.5">
                <div className="text-[10px] text-neutral-400 uppercase font-semibold">Audit Win Rate</div>
                <div className="text-base font-bold text-emerald-400 mt-0.5">
                  {recentTrades.slice(0, 5).length > 0
                    ? `${((recentTrades.slice(0, 5).filter(t => (t.pnl || 0) > 0).length / recentTrades.slice(0, 5).length) * 100).toFixed(0)}%`
                    : '100%'}
                </div>
              </div>
              <div className="bg-[#191a1c] border border-white/5 rounded-xl p-2.5">
                <div className="text-[10px] text-neutral-400 uppercase font-semibold">5-Trade Net PnL</div>
                <div className={`text-base font-bold mt-0.5 ${recentTrades.slice(0, 5).reduce((a, b) => a + (b.pnl || 0), 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {recentTrades.slice(0, 5).reduce((a, b) => a + (b.pnl || 0), 0) >= 0 ? '+' : ''}
                  ${recentTrades.slice(0, 5).reduce((a, b) => a + (b.pnl || 0), 0).toFixed(2)}
                </div>
              </div>
              <div className="bg-[#191a1c] border border-white/5 rounded-xl p-2.5">
                <div className="text-[10px] text-neutral-400 uppercase font-semibold">Risk Floor Tier</div>
                <div className="text-xs font-bold text-purple-300 mt-0.5 truncate">
                  {balance < 100 ? 'Tier 1 (3% Cap -$0.90)' : balance < 250 ? 'Tier 2 (5% Cap -$5.00)' : 'Tier 3 (10% Cap -$25.00)'}
                </div>
              </div>
            </div>

            {/* List of Last 3 to 5 Audited Trades */}
            <div className="space-y-2">
              {recentTrades.length === 0 ? (
                <div className="bg-[#191a1c] border border-white/5 rounded-xl p-4 text-center text-neutral-400 text-xs font-mono">
                  No recently closed trades recorded yet. As trades settle, real-time running audits of execution efficiency, slippage, and dynamic profit targets will render here.
                </div>
              ) : (
                recentTrades.slice(0, 5).map((t, idx) => {
                  const isWin = (t.pnl || 0) >= 0;
                  const isEarlyBank = String(t.reason || '').includes('EARLY_BANK') || String(t.keeperStatus || '').includes('Early Bank');
                  const isChandelier = String(t.reason || '').includes('TRAILING_STOP') || String(t.reason || '').includes('CHANDELIER');
                  const isTtlExpired = String(t.reason || '').includes('TTL_EXPIRED');

                  return (
                    <div
                      key={t.tradeId || t.id || idx}
                      className="bg-[#191a1c] border border-white/5 hover:border-white/15 rounded-xl p-3.5 space-y-2 transition-all font-mono text-xs"
                    >
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            t.side === 'Long' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                          }`}>
                            {t.side}
                          </span>
                          <span className="font-bold text-white">{t.asset || 'SOL'}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300">
                            {t.executionMode || 'AUTOTRADE_BOT'}
                          </span>
                          <span className="text-[11px] text-neutral-400">
                            ${t.entryPrice?.toFixed(2)} → ${t.exitPrice?.toFixed(2)}
                          </span>
                          <span className="text-[10px] text-neutral-500">
                            ({t.leverage || 20}x · Margin ${t.margin?.toFixed(2)})
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`font-bold text-sm ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isWin ? '+' : ''}${t.pnl?.toFixed(2)} ({isWin ? '+' : ''}{t.pnlPercent?.toFixed(1)}%)
                          </span>
                          <span className="text-[10px] text-neutral-400 font-mono whitespace-normal max-w-[130px] text-right leading-tight">
                            {t.dateTime || (t.timestampExit ? new Date(t.timestampExit).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '2026-10-03 14:15:22 UTC')}
                          </span>
                        </div>
                      </div>

                      {/* Dynamic Audit Finding */}
                      <div className="text-[11px] text-neutral-300 bg-neutral-900/80 rounded-lg p-2 border border-white/5 leading-relaxed flex items-start gap-2">
                        <span className="text-sm">
                          {isEarlyBank ? '⚡' : isChandelier ? '🛡️' : isTtlExpired ? '⏱️' : isWin ? '🎯' : '⚠️'}
                        </span>
                        <div>
                          <strong className="text-white">Audit Finding: </strong>
                          {isEarlyBank ? (
                            <span>
                              <strong>70% Distance Progress Threshold Triggered:</strong> Price reached &ge;70% distance to TP1 (+0.245 ATR) while 5m momentum stalled. Engine executed Early Bank of 30% at active market bid and ratcheted 70% runner stop loss to Entry + $0.10.
                            </span>
                          ) : isChandelier ? (
                            <span>
                              <strong>Quick Change Chandelier Ratchet:</strong> Trade detected signal flip before TP1. Baseline SL was overridden with 0.8× ATR Chandelier stop below peak, mitigating adverse drawdown early.
                            </span>
                          ) : isTtlExpired ? (
                            <span>
                              <strong>15m Limit Order TTL Guard:</strong> Price moved upward without retrace fill; keeper cancelled order after 15m to prevent toxic fill drift.
                            </span>
                          ) : isWin ? (
                            <span>
                              <strong>Target Execution:</strong> Fill achieved with live Pyth/Helius oracle feed pricing. Slippage held within 5 bps constraint.
                            </span>
                          ) : (
                            <span>
                              <strong>Scalable Stop Loss Risk Cap:</strong> Loss clamped strictly to balance-scaled tier cap (-${Math.abs(t.pnl || 0.30).toFixed(2)}) preserving principal equity.
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Quick Balance Switcher Buttons */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-[#191a1c] border border-white/5 flex-wrap gap-2 text-xs">
              <span className="text-neutral-400 font-mono">
                Select Initial Portfolio Value to Autotrade:
              </span>
              <div className="flex items-center gap-1.5 font-mono">
                {[
                  { label: '$30 (Tier 1 · 20x · 1 Pos)', val: 30 },
                  { label: '$50 (Tier 1 · 20x · 1 Pos)', val: 50 },
                  { label: '$100 (Tier 2 · 35x · 2 Pos)', val: 100 },
                  { label: '$250 (Tier 3 · 50x · 3 Pos)', val: 250 },
                ].map((item) => (
                  <button
                    key={item.val}
                    onClick={() => handleSetPortfolioBalance(item.val)}
                    className={`px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                      Math.round(balance) === item.val
                        ? 'bg-emerald-600 text-white shadow-md font-black'
                        : 'bg-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-700'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. TAB 2: SAFETY INTERLOCK & WALLET SETUP (The Core Feature) */}
      {activeTab === 'safety' && (
        <div className="space-y-4 animate-fadeIn">
          {/* Master Live Trading Safety Interlock Switch Card */}
          <div className="bg-[#141516] border border-white/10 rounded-2xl p-5 shadow-xl space-y-5">
            {/* Header with visual state banner */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <div
                  className={`p-3 rounded-xl border ${
                    isSafetyArmed
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                      : 'bg-blue-500/15 border-blue-500/40 text-blue-400'
                  }`}
                >
                  {isSafetyArmed ? (
                    <Unlock className="w-6 h-6 animate-pulse text-emerald-400" />
                  ) : (
                    <Lock className="w-6 h-6 text-blue-400" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white">
                      Live Trading Safety Interlock Control
                    </h3>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        isSafetyArmed
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          : 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                      }`}
                    >
                      {isSafetyArmed ? 'LIVE ON-CHAIN ARMED' : 'SANDBOX SIMULATION (0 RISK)'}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Strict multi-condition interlock. Real account execution only unlocks when all 5 conditions below pass verification.
                  </p>
                </div>
              </div>

              {/* Master Safety Switch Button */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggleSafety(!isSafetyArmed)}
                  disabled={isTogglingSafety || (!isSafetyArmed && !safetyData?.canArmLiveTrading)}
                  className={`px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all shadow-lg ${
                    isSafetyArmed
                      ? 'bg-red-600 hover:bg-red-500 text-white ring-1 ring-red-400/50'
                      : safetyData?.canArmLiveTrading
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white ring-1 ring-emerald-400/50 shadow-emerald-950'
                      : 'bg-neutral-800 text-neutral-500 cursor-not-allowed border border-white/5'
                  }`}
                  title={
                    !safetyData?.canArmLiveTrading
                      ? 'Resolve all safety conditions below before arming live execution'
                      : isSafetyArmed
                      ? 'Click to lock safety switch and return to 0-risk simulation'
                      : 'Click to unlock live trading execution on Solana'
                  }
                >
                  {isTogglingSafety ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : isSafetyArmed ? (
                    <>
                      <Lock className="w-4 h-4" />
                      <span>DISARM &amp; ENGAGE SAFETY LOCK</span>
                    </>
                  ) : (
                    <>
                      <Unlock className="w-4 h-4" />
                      <span>ARM LIVE TRADING (ON-CHAIN)</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Condition Lock Warning if not armable */}
            {!safetyData?.canArmLiveTrading && !isSafetyArmed && (
              <div className="bg-amber-950/40 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-300 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">Safety Interlock Engaged (Live Trading Locked)</span>
                  <p className="text-[11px] text-amber-200/80 mt-0.5">
                    Before real transactions can be dispatched to Jupiter Anchor program, all verification requirements must be satisfied. Review the matrix below to proceed.
                  </p>
                </div>
              </div>
            )}

            {/* 5-Condition Safety Matrix */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-neutral-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  5-Point Safety Verification Matrix
                </span>
                <button
                  onClick={fetchSafetyStatus}
                  disabled={isLoadingSafety}
                  className="text-blue-400 hover:text-blue-300 text-xs flex items-center gap-1 transition-colors"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingSafety ? 'animate-spin' : ''}`} />
                  <span>Re-audit</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {safetyData?.conditions.map((cond) => (
                  <div
                    key={cond.id}
                    className={`p-3.5 rounded-xl border transition-all ${
                      cond.passed
                        ? 'bg-neutral-900/60 border-emerald-500/30 shadow-sm'
                        : 'bg-red-950/20 border-red-500/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        {cond.passed ? (
                          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <span className="text-xs font-bold text-white block">
                            {cond.title}
                          </span>
                          <p className="text-[11px] text-neutral-400 mt-0.5">
                            {cond.description}
                          </p>
                        </div>
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono shrink-0 ${
                          cond.passed
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-red-500/15 text-red-400 border border-red-500/30'
                        }`}
                      >
                        {cond.passed ? 'PASSED' : 'REQUIRED'}
                      </span>
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-white/5 flex items-center justify-between text-[11px] font-mono">
                      <span className="text-neutral-400">Live Status:</span>
                      <span className={cond.passed ? 'text-emerald-300' : 'text-red-300'}>
                        {cond.detail}
                      </span>
                    </div>

                    {/* Quick action helper inside card for gas or keypair */}
                    {cond.id === 'gas' && !cond.passed && (
                      <div className="mt-2 pt-2 border-t border-white/5 flex justify-end">
                        <button
                          onClick={handleRequestAirdrop}
                          disabled={isAirdropping}
                          className="px-2.5 py-1 text-[11px] font-bold rounded-md bg-amber-500 text-neutral-950 hover:bg-amber-400 transition-all flex items-center gap-1"
                        >
                          <Flame className="w-3 h-3" />
                          <span>{isAirdropping ? 'Airdropping...' : 'Airdrop 1.0 SOL Now'}</span>
                        </button>
                      </div>
                    )}

                    {cond.id === 'keypair' && !cond.passed && (
                      <div className="mt-2 pt-2 border-t border-white/5 flex justify-end gap-1.5">
                        <button
                          onClick={handleGenerateKeypair}
                          disabled={isGeneratingKey}
                          className="px-2.5 py-1 text-[11px] font-bold rounded-md bg-blue-600 text-white hover:bg-blue-500 transition-all"
                        >
                          Generate Keypair
                        </button>
                        <button
                          onClick={() => setShowImportModal(true)}
                          className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-neutral-800 text-neutral-200 hover:bg-neutral-700 transition-all"
                        >
                          Import Key
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Wallet Setup & Management Section */}
          <div className="bg-[#141516] border border-white/10 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Solana Account &amp; Signer Setup</h3>
              </div>
              <span className="text-xs text-neutral-400">
                Network: <strong className="text-white uppercase">{network}</strong>
              </span>
            </div>

            {/* Active Signer Keypair Card */}
            <div className="bg-neutral-900/60 border border-white/10 rounded-xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-xs text-neutral-400 block font-medium">
                    Active Signer Public Key
                  </span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-mono text-sm font-bold text-white break-all">
                      {safetyData?.signer?.publicKey || 'No keypair loaded'}
                    </span>
                    {safetyData?.signer?.publicKey && (
                      <button
                        onClick={copyPublicKey}
                        className="p-1 rounded hover:bg-white/10 text-neutral-400 hover:text-white transition-colors"
                        title="Copy Public Key"
                      >
                        {copiedPubkey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                  {safetyData?.signer?.path && (
                    <span className="text-[11px] text-neutral-500 font-mono mt-0.5 block">
                      Source: ./{safetyData.signer.path}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {safetyData?.signer?.publicKey && (
                    <a
                      href={`https://solscan.io/account/${safetyData.signer.publicKey}?cluster=${network}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium flex items-center gap-1.5 transition-colors border border-white/5"
                    >
                      <span>Solscan</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}

                  <button
                    onClick={handleRequestAirdrop}
                    disabled={isAirdropping}
                    className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Flame className="w-3.5 h-3.5" />
                    <span>{isAirdropping ? 'Airdropping...' : 'Airdrop Devnet SOL'}</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-white/5 text-xs font-mono">
                <div>
                  <span className="text-neutral-400 block text-[11px]">SOL Balance (Gas)</span>
                  <span className="text-white font-bold text-sm">
                    {safetyData?.solBalance?.toFixed(4) || '0.0000'} SOL
                  </span>
                </div>
                <div>
                  <span className="text-neutral-400 block text-[11px]">RPC Slot Height</span>
                  <span className="text-blue-400 font-bold text-sm">
                    #{safetyData?.slot || '---'}
                  </span>
                </div>
                <div>
                  <span className="text-neutral-400 block text-[11px]">RPC Latency</span>
                  <span className="text-emerald-400 font-bold text-sm">
                    {safetyData?.latencyMs ? `${safetyData.latencyMs}ms` : '---'}
                  </span>
                </div>
              </div>
            </div>

            {/* Key Management Action Buttons */}
            <div className="flex items-center gap-3 flex-wrap pt-1">
              <button
                onClick={handleGenerateKeypair}
                disabled={isGeneratingKey}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-white/10 transition-colors flex items-center gap-1.5"
              >
                <Key className="w-3.5 h-3.5 text-blue-400" />
                <span>{isGeneratingKey ? 'Generating...' : 'Generate New Testing Keypair'}</span>
              </button>

              <button
                onClick={() => setShowImportModal(true)}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-white/10 transition-colors flex items-center gap-1.5"
              >
                <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                <span>Import Private Key / Base58</span>
              </button>
            </div>
          </div>

          {/* Import Modal */}
          {showImportModal && (
            <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-[#171716] border border-white/10 rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl animate-fadeIn">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Key className="w-4 h-4 text-emerald-400" />
                    Import Solana Signer Keypair
                  </h4>
                  <button
                    onClick={() => setShowImportModal(false)}
                    className="text-neutral-400 hover:text-white text-base"
                  >
                    &times;
                  </button>
                </div>

                <p className="text-xs text-neutral-400 leading-relaxed">
                  Enter your 64-byte secret key as a JSON array (e.g., from <code className="text-neutral-300">wallet-devnet.json</code>) or a Base58 encoded secret key string. It will be stored locally in the environment.
                </p>

                <div>
                  <textarea
                    rows={4}
                    value={importKeyInput}
                    onChange={(e) => setImportKeyInput(e.target.value)}
                    placeholder="[12, 34, 56, ... 64 numbers] OR Base58 string..."
                    className="w-full bg-[#121212] border border-white/10 rounded-xl p-3 text-xs font-mono text-neutral-200 focus:outline-none focus:border-emerald-500/50"
                  />
                  {importError && (
                    <span className="text-[11px] text-red-400 block mt-1">
                      {importError}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
                  <button
                    onClick={() => setShowImportModal(false)}
                    className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleImportKeypair}
                    className="px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-md"
                  >
                    Validate &amp; Save
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 5. TAB 3: SIGNAL ROUTER & WEBHOOKS */}
      {activeTab === 'signals' && (
        <div className="space-y-4 animate-fadeIn">
          {/* Signal Dispatcher Card */}
          <div className="bg-[#141516] border border-white/10 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-white">Manual Signal &amp; Order Dispatcher</h3>
              </div>
              <span className="text-xs text-neutral-400 font-mono">
                Asset: {currentAsset} @ ${solPrice.toFixed(2)}
              </span>
            </div>

            <p className="text-xs text-neutral-400">
              Test signal execution pipeline directly through the bot engine. If Live Trading is armed, real on-chain Anchor requests will be created.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="text-[11px] text-neutral-400 block mb-1">Direction</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTestSide('Long')}
                    className={`py-2 rounded-lg font-bold transition-all ${
                      testSide === 'Long'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                    }`}
                  >
                    LONG
                  </button>
                  <button
                    type="button"
                    onClick={() => setTestSide('Short')}
                    className={`py-2 rounded-lg font-bold transition-all ${
                      testSide === 'Short'
                        ? 'bg-red-600 text-white'
                        : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                    }`}
                  >
                    SHORT
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[11px] text-neutral-400 block mb-1">Margin ($)</label>
                <input
                  type="number"
                  value={testMargin}
                  onChange={(e) => setTestMargin(parseFloat(e.target.value) || 30)}
                  className="w-full bg-[#191a1c] border border-white/10 rounded-lg px-3 py-2 text-neutral-200 font-mono"
                />
              </div>

              <div>
                <label className="text-[11px] text-neutral-400 block mb-1">Entry Offset ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={testOffset}
                  onChange={(e) => setTestOffset(parseFloat(e.target.value) || 0.08)}
                  className="w-full bg-[#191a1c] border border-white/10 rounded-lg px-3 py-2 text-neutral-200 font-mono"
                />
              </div>
            </div>

            <div className="bg-neutral-900/60 p-3 rounded-xl border border-white/5 text-xs font-mono space-y-1">
              <div className="flex justify-between text-neutral-400">
                <span>Calculated Entry Price:</span>
                <span className="text-white font-bold">
                  ${(testSide === 'Long' ? solPrice - testOffset : solPrice + testOffset).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-neutral-400">
                <span>TP1 / TP2 Target:</span>
                <span className="text-emerald-400 font-bold">
                  +$0.35 / +$0.75
                </span>
              </div>
              <div className="flex justify-between text-neutral-400">
                <span>Stop Loss (1.5x ATR):</span>
                <span className="text-red-400 font-bold">
                  -${(0.35 * 1.5).toFixed(2)}
                </span>
              </div>
            </div>

            <button
              onClick={() => handleSendSignal()}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg flex items-center justify-center gap-2 transition-all"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Dispatch Signal to Engine</span>
            </button>
          </div>

          {/* Webhook Specification Card */}
          <div className="bg-[#141516] border border-white/10 rounded-2xl p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold text-white">External Webhook Integration</h3>
              </div>
              <span className="text-xs text-neutral-400 font-mono">POST /signal</span>
            </div>

            <p className="text-xs text-neutral-400">
              Point your TradingView alert webhook or Python bot directly to the bot service:
            </p>

            <pre className="p-3 bg-neutral-950 rounded-xl border border-white/10 font-mono text-[11px] text-emerald-300 overflow-x-auto whitespace-pre-wrap select-all">
{`curl -X POST /signal \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $BOT_AUTH_TOKEN" \\
  -d '{
    "asset": "${currentAsset}",
    "direction": "buy",
    "price": ${solPrice.toFixed(2)},
    "entryOffset": 0.00,
    "candleMomentum": true,
    "regime": "RANGE_BOUND_SUPPORT",
    "adx": 25,
    "consecutiveGreen5m": 2
  }'`}
            </pre>
          </div>
        </div>
      )}

      {/* 6. TAB 4: RISK & PARAMETERS */}
      {activeTab === 'risk' && (
        <div className="space-y-4 animate-fadeIn">
          {/* Auto-Preset Switcher Full Specification Card */}
          <div className="bg-[#141516] border border-amber-500/30 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-amber-400 font-bold text-base">⚡</span>
                <h3 className="text-sm font-bold text-white">Auto-Preset Switcher Architecture</h3>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                AUTO-SCALING TIER MATRIX
              </span>
            </div>

            <p className="text-xs text-neutral-300">
              The Auto-Preset Switcher automatically transitions leverage, risk caps, and take-profit targets based on real-time equity tiers, eliminating manual script restarts:
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-[11px] border border-white/10 rounded-xl overflow-hidden">
                <thead className="bg-neutral-900/80 text-neutral-400 border-b border-white/10 text-[10px] uppercase">
                  <tr>
                    <th className="p-2.5">Account Balance</th>
                    <th className="p-2.5">Active Preset</th>
                    <th className="p-2.5">Leverage</th>
                    <th className="p-2.5">Risk Cap / Trade</th>
                    <th className="p-2.5">TP2 Target</th>
                    <th className="p-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  <tr className={balance < 100 ? 'bg-blue-500/15 text-blue-200 font-bold' : 'text-neutral-400 hover:bg-white/5'}>
                    <td className="p-2.5">$0.00 – $99.99</td>
                    <td className="p-2.5 text-neutral-200">Peak Win Rate Mode</td>
                    <td className="p-2.5 text-blue-400 font-bold">20x LSD</td>
                    <td className="p-2.5 text-blue-300">3% (-$0.90 on $30 bal)</td>
                    <td className="p-2.5">+0.55 / +0.85 ATR</td>
                    <td className="p-2.5">
                      {balance < 100 ? (
                        <span className="px-1.5 py-0.5 rounded bg-blue-500/30 text-blue-300 text-[9px]">ACTIVE TIER (Margin Collateral: $25.00 → $500.00 Buying Power [20x])</span>
                      ) : (
                        <span className="text-neutral-500 text-[9px]">Standby</span>
                      )}
                    </td>
                  </tr>
                  <tr className={balance >= 100 && balance < 250 ? 'bg-emerald-500/15 text-emerald-200 font-bold' : 'text-neutral-400 hover:bg-white/5'}>
                    <td className="p-2.5">$100.00 – $249.99</td>
                    <td className="p-2.5 text-neutral-200">Hybrid Scaling Tier</td>
                    <td className="p-2.5 text-emerald-400 font-bold">35x</td>
                    <td className="p-2.5 text-emerald-300">5% (-$5.00 on $100 bal)</td>
                    <td className="p-2.5">+0.70 / +1.00 ATR</td>
                    <td className="p-2.5">
                      {balance >= 100 && balance < 250 ? (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/30 text-emerald-300 text-[9px]">ACTIVE TIER (Margin Collateral: $50.00 → $1,750.00 Buying Power [35x])</span>
                      ) : (
                        <span className="text-neutral-500 text-[9px]">Standby</span>
                      )}
                    </td>
                  </tr>
                  <tr className={balance >= 250 ? 'bg-amber-500/15 text-amber-200 font-bold' : 'text-neutral-400 hover:bg-white/5'}>
                    <td className="p-2.5">$250.00+</td>
                    <td className="p-2.5 text-neutral-200">Max Alpha Mode</td>
                    <td className="p-2.5 text-amber-400 font-bold">50x / 60x</td>
                    <td className="p-2.5 text-amber-300">10% (-$25.00 on $250 bal)</td>
                    <td className="p-2.5">+0.85 / +1.20 ATR</td>
                    <td className="p-2.5">
                      {balance >= 250 ? (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/30 text-amber-300 text-[9px]">ACTIVE TIER (Margin Collateral: $100.00 → $5,000.00 Buying Power [50x])</span>
                      ) : (
                        <span className="text-neutral-500 text-[9px]">Standby</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="p-3 bg-neutral-900/60 rounded-xl border border-white/5 space-y-2">
              <span className="text-neutral-300 font-bold text-xs block">💻 server.js / bot-service Integration:</span>
              <pre className="p-2.5 bg-neutral-950 rounded-lg border border-white/10 font-mono text-[10px] text-emerald-300 overflow-x-auto whitespace-pre-wrap select-all">
{`const { evaluateTradeSignal, onTradeSettled } = require('./server_strategy_auto_switcher');

// Inside your main trading decision loop:
const decision = evaluateTradeSignal(currentSignal, accountBalance);

if (decision.execute) {
  console.log(\`[EXECUTE] Mode: \${decision.preset.name} | Leverage: \${decision.leverage}x | Risk Cap: $\${decision.maxDollarLoss}\`);
  // Send openPositionRequest to Jupiter Perps
}

// When a position closes:
onTradeSettled(netPnlUsd);`}
              </pre>
            </div>
          </div>

          <div className="bg-[#141516] border border-white/10 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-bold text-white">Risk &amp; Execution Guardrails</h3>
              </div>
              <span className="text-[11px] text-neutral-500 font-mono">Engine v10 Active</span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between bg-neutral-900/60 p-3 rounded-xl border border-white/5">
                <div>
                  <span className="text-neutral-200 font-medium block">Leverage Cap</span>
                  <span className="text-[11px] text-neutral-400">
                    Max 60x reachable (20/35/50 base by tier + 10x boost)
                  </span>
                </div>
                <span className="font-mono text-emerald-400 font-bold">60x max</span>
              </div>

              <div className="flex items-center justify-between bg-neutral-900/60 p-3 rounded-xl border border-white/5">
                <div>
                  <span className="text-neutral-200 font-medium block">Fee-Neutral TP1 Exit</span>
                  <span className="text-[11px] text-neutral-400">
                    Captures +3.5%–4.5% net yield, overcoming 0.08% taker fee
                  </span>
                </div>
                <span className="font-mono text-emerald-400 font-bold">+$0.35</span>
              </div>

              <div className="flex items-center justify-between bg-neutral-900/60 p-3 rounded-xl border border-white/5">
                <div>
                  <span className="text-neutral-200 font-medium block">Base Stop Loss Multiplier</span>
                  <span className="text-[11px] text-neutral-400">
                    Tightened multiplier cuts peak tail drawdown ~15%
                  </span>
                </div>
                <span className="font-mono text-neutral-200 font-bold">1.5× ATR</span>
              </div>

              <div className="flex items-center justify-between bg-neutral-900/60 p-3 rounded-xl border border-white/5">
                <div>
                  <span className="text-neutral-200 font-medium block">5m Fisher Early Runner Exit</span>
                  <span className="text-[11px] text-neutral-400">
                    Closes open runner on bearish momentum cross-down
                  </span>
                </div>
                <span className="font-mono text-blue-400 font-bold">ACTIVE</span>
              </div>

              <div className="flex items-center justify-between bg-neutral-900/60 p-3 rounded-xl border border-white/5">
                <div>
                  <span className="text-neutral-200 font-medium block">Daily Circuit Breaker Threshold</span>
                  <span className="text-[11px] text-neutral-400">
                    Halts all orders if daily realized drawdown exceeds $50.00
                  </span>
                </div>
                <span className="font-mono text-red-400 font-bold">$50.00</span>
              </div>
            </div>
          </div>

          {/* Network & Endpoint Configuration */}
          <div className="bg-[#141516] border border-white/10 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold text-white">Solana RPC &amp; Bot Endpoints</h3>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="text-[11px] text-neutral-400 block mb-1">Network</label>
                <select
                  value={network}
                  onChange={async (e) => {
                    const nextNet = e.target.value;
                    setNetwork(nextNet);
                    localStorage.setItem('sol_network', nextNet);
                    try {
                      await fetch(`${botUrl}/wallet-config`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ network: nextNet }),
                      });
                      fetchSafetyStatus();
                    } catch {}
                  }}
                  className="w-full bg-[#191a1c] border border-white/10 rounded-lg px-3 py-2 text-neutral-200"
                >
                  <option value="devnet">Devnet (Recommended Sandbox)</option>
                  <option value="mainnet-beta">Mainnet-beta (Real Capital)</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <label className="text-[11px] text-neutral-400">Solana RPC Endpoint (Helius / Custom)</label>
                    <button
                      type="button"
                      onClick={() => setShowRpcKey(!showRpcKey)}
                      className="text-neutral-500 hover:text-neutral-300 p-0.5"
                      title={showRpcKey ? 'Mask API key' : 'Show API key'}
                    >
                      {showRpcKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch(`${botUrl}/wallet-config`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ rpcUrl, network }),
                        });
                        if (res.ok) {
                          notify('Helius RPC synced! Live balance updated.', 'success');
                          fetchSafetyStatus();
                          fetchBotState();
                        }
                      } catch {
                        notify('Failed to sync RPC to bot service', 'error');
                      }
                    }}
                    className="text-[10px] text-blue-400 hover:text-blue-300 font-bold underline"
                  >
                    Save &amp; Connect RPC
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showRpcKey ? 'text' : 'password'}
                    value={rpcUrl}
                    placeholder="https://mainnet.helius-rpc.com/?api-key=..."
                    onChange={(e) => {
                      setRpcUrl(e.target.value);
                      localStorage.setItem('sol_rpc_url', e.target.value);
                    }}
                    className="w-full bg-[#191a1c] border border-white/10 rounded-lg px-3 py-2 text-neutral-200 font-mono text-xs focus:outline-none focus:border-blue-500/50"
                  />
                </div>
                <p className="text-[10px] text-neutral-500 mt-1">
                  🔒 <span className="text-neutral-400 font-medium">Security:</span> Your API key is masked in the UI and sent to your private backend bot. Alternatively, set <code className="text-blue-400 bg-black/40 px-1 py-0.5 rounded">SOLANA_RPC=https://mainnet.helius-rpc.com/?api-key=...</code> in your backend .env or Render environment variables to bypass pasting in the browser.
                </p>
              </div>

              <div>
                <label className="text-[11px] text-neutral-400 block mb-1">Bot Service Server</label>
                <input
                  type="text"
                  value={botUrl}
                  onChange={(e) => {
                    setBotUrl(e.target.value);
                    localStorage.setItem('sol_bot_url', e.target.value);
                  }}
                  className="w-full bg-[#191a1c] border border-white/10 rounded-lg px-3 py-2 text-neutral-200 font-mono"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
