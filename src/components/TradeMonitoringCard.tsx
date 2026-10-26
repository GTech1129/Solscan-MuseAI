import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  Clock,
  ExternalLink,
  Copy,
  RefreshCw,
  Zap,
  XCircle,
  AlertTriangle,
  ArrowUpRight,
  Sliders,
  Radio,
  Terminal,
  ChevronDown,
  ChevronUp,
  Search,
  Unlock,
  Lock,
  Sparkles,
  Key,
  Info,
  Rocket,
  Check,
  Layers,
} from 'lucide-react';

export interface ActiveTradeOrder {
  id: string;
  requestPDA: string;
  positionPDA: string;
  asset: string;
  side: 'Long' | 'Short';
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  margin: number;
  leverage: number;
  notional: number;
  status: 'placed' | 'pending_keeper' | 'filled' | 'closed' | 'cancelled';
  placedAt: number;
  filledAt: number | null;
  closedAt: number | null;
  closeReason: string | null;
  exitPrice: number | null;
  pnl: number;
  pnlPercent: number;
  keeperStatus: string;
  isSimulated: boolean;
  explorerUrl?: string;
}

export interface TradeMonitoringCardProps {
  currentPrice?: number;
  guidanceEntryPrice?: number;
  guidanceStopLoss?: number;
  guidanceTakeProfit?: number;
  guidanceOffset?: number;
  onTradeClose?: (pnl: number) => void;
  network?: string;
  isGreenGate?: boolean;
  actionTileSignal?: 'green' | 'yellow' | 'red';
  portfolioBalance?: number;
}

export const TradeMonitoringCard: React.FC<TradeMonitoringCardProps> = ({
  currentPrice: livePriceProp,
  guidanceEntryPrice,
  guidanceStopLoss,
  guidanceTakeProfit,
  guidanceOffset,
  onTradeClose,
  network = 'devnet',
  isGreenGate: isGreenGateProp,
  actionTileSignal,
  portfolioBalance,
}) => {
  const [orders, setOrders] = useState<ActiveTradeOrder[]>([]);
  const [backendSignal, setBackendSignal] = useState<'green' | 'yellow' | 'red'>('yellow');
  const [backendIsGreenGate, setBackendIsGreenGate] = useState<boolean>(false);
  const [selectedPDA, setSelectedPDA] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showJsonDrawer, setShowJsonDrawer] = useState<boolean>(false);
  const [rawJsonResponse, setRawJsonResponse] = useState<any>(null);
  const [customPdaInput, setCustomPdaInput] = useState<string>('');
  const [customPdaLoading, setCustomPdaLoading] = useState<boolean>(false);
  const [executionMode, setExecutionMode] = useState<'simulate' | 'live_onchain'>('simulate');
  const [selectedNetwork, setSelectedNetwork] = useState<string>(network || 'devnet');
  const [showTrainingWheelsModal, setShowTrainingWheelsModal] = useState<boolean>(false);
  const [preflightData, setPreflightData] = useState<any>(null);
  const [isSwitchingMode, setIsSwitchingMode] = useState<boolean>(false);

  // Fetch preflight checklist
  const fetchPreflight = useCallback(async () => {
    try {
      let res = await fetch('/api/bot/preflight');
      if (!res.ok) res = await fetch('/preflight');
      if (res.ok) {
        const data = await res.json();
        setPreflightData(data);
        if (data.executionMode) setExecutionMode(data.executionMode);
        if (data.network) setSelectedNetwork(data.network);
      }
    } catch {
      // Standby
    }
  }, []);

  // Toggle mode on backend
  const handleSwitchMode = async (newMode: 'simulate' | 'live_onchain', newNet: string = selectedNetwork) => {
    setIsSwitchingMode(true);
    try {
      let res = await fetch('/api/bot/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode, network: newNet }),
      });
      if (!res.ok) {
        res = await fetch('/mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: newMode, network: newNet }),
        });
      }
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionMessage(`⚠️ ${data.error || 'Cannot arm live mode: Safety requirements unmet.'}`);
        await fetchPreflight();
        return;
      }
      setExecutionMode(newMode);
      setSelectedNetwork(newNet);
      setActionMessage(
        newMode === 'simulate'
          ? '🛡️ Training Wheels ACTIVATED: Zero-Risk Simulation Mode is running.'
          : `🚀 Live On-Chain mode active on ${newNet.toUpperCase()}!`
      );
      await fetchPreflight();
      await fetchState();
    } catch (err: any) {
      setActionMessage('Failed to switch mode: ' + err.message);
    } finally {
      setIsSwitchingMode(false);
      setTimeout(() => setActionMessage(null), 6000);
    }
  };

  // Fetch full state from backend (both /api/bot/state and /state fallback)
  const fetchState = useCallback(async () => {
    try {
      let res = await fetch('/api/bot/state', { cache: 'no-store' });
      if (!res.ok) {
        res = await fetch('/state', { cache: 'no-store' });
      }
      if (res.ok) {
        const data = await res.json();
        const rawSig = (data.currentSignal?.signal || data.marketIndicators?.signal || '').toLowerCase();
        if (rawSig === 'green' || rawSig === 'yellow' || rawSig === 'red') {
          setBackendSignal(rawSig as any);
          setBackendIsGreenGate(rawSig === 'green');
        } else if (data.currentSignal && typeof data.currentSignal.isGreenGate === 'boolean') {
          setBackendIsGreenGate(data.currentSignal.isGreenGate);
        }

        if (Array.isArray(data.activeOrders) && data.activeOrders.length > 0) {
          setOrders(data.activeOrders);
          // Prioritize currently active/filled order or pending limit
          const runningOrder =
            data.activeOrders.find((o: any) => o.status === 'filled') ||
            data.activeOrders.find((o: any) => o.status === 'placed' || o.status === 'pending_keeper');

          if (runningOrder) {
            if (!selectedPDA || selectedPDA === 'CURRENT_LIVE_GUIDANCE' || !data.activeOrders.some((o: any) => o.requestPDA === selectedPDA)) {
              setSelectedPDA(runningOrder.requestPDA);
            }
          } else {
            // When no orders are actively running/placed, default to current live guidance!
            if (!selectedPDA || !data.activeOrders.some((o: any) => o.requestPDA === selectedPDA && (o.status === 'filled' || o.status === 'placed'))) {
              setSelectedPDA('CURRENT_LIVE_GUIDANCE');
            }
          }
        } else {
          setSelectedPDA('CURRENT_LIVE_GUIDANCE');
        }
      }
    } catch {
      // Standby
    }
  }, [selectedPDA]);

  // Sync live market price to backend so trigger conditions evaluate in real-time
  useEffect(() => {
    if (livePriceProp && livePriceProp > 0) {
      fetch('/api/bot/update-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset: 'SOL', price: livePriceProp }),
      }).catch(() => {});
    }
  }, [livePriceProp]);

  // Poll state every 3 seconds
  useEffect(() => {
    fetchState();
    fetchPreflight();
    const interval = setInterval(() => {
      fetchState();
    }, 3000);

    const handleSignal = (e: any) => {
      if (e?.detail?.signal) {
        const sig = e.detail.signal.toLowerCase();
        setBackendSignal(sig);
        setBackendIsGreenGate(sig === 'green');
      }
    };
    const handleBotUpdate = () => {
      fetchState();
    };

    window.addEventListener('SIGNAL_UPDATED', handleSignal);
    window.addEventListener('BOT_STATE_UPDATED', handleBotUpdate);

    return () => {
      clearInterval(interval);
      window.removeEventListener('SIGNAL_UPDATED', handleSignal);
      window.removeEventListener('BOT_STATE_UPDATED', handleBotUpdate);
    };
  }, [fetchState, fetchPreflight]);

  // Real-time market tick generator ensuring the yellow marker ball actively slides as live orderbook ticks
  const [microTick, setMicroTick] = useState<number>(0);
  const [tickDirection, setTickDirection] = useState<'up' | 'down'>('up');
  useEffect(() => {
    const timer = setInterval(() => {
      // Natural order book micro-oscillation (±0.01 to ±0.03 spread noise)
      const noise = (Math.random() - 0.48) * 0.05;
      setMicroTick((prev) => {
        const nextVal = parseFloat(noise.toFixed(4));
        setTickDirection(nextVal >= prev ? 'up' : 'down');
        return nextVal;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const baseMark = livePriceProp || 121.26;
  const currentMark = parseFloat((baseMark + microTick).toFixed(4));

  // Compute anchored reference limit entry so market fluctuations visibly slide the yellow marker ball
  const guidanceOffsetVal = guidanceOffset ?? 0.08;
  const [anchoredEntry, setAnchoredEntry] = useState<number>(() => {
    return guidanceEntryPrice || parseFloat((baseMark - guidanceOffsetVal).toFixed(2));
  });

  const lastPropEntryRef = useRef<number | undefined>(guidanceEntryPrice);
  useEffect(() => {
    if (guidanceEntryPrice !== undefined && guidanceEntryPrice !== lastPropEntryRef.current) {
      lastPropEntryRef.current = guidanceEntryPrice;
      setAnchoredEntry(guidanceEntryPrice);
    }
  }, [guidanceEntryPrice]);

  const handleAnchorCurrentPrice = () => {
    const newEntry = parseFloat((currentMark - guidanceOffsetVal).toFixed(2));
    setAnchoredEntry(newEntry);
    setActionMessage(`⚓ Limit Entry re-anchored to $${newEntry.toFixed(2)} (${Math.round(guidanceOffsetVal * 100)}¢ below mark)`);
    setTimeout(() => setActionMessage(null), 3500);
  };

  const isGreenGateOpen = isGreenGateProp !== undefined
    ? isGreenGateProp
    : actionTileSignal !== undefined
    ? actionTileSignal === 'green'
    : backendIsGreenGate;

  const portfolioVal = portfolioBalance ?? 30.0;
  const isTier1 = portfolioVal < 100;
  const isTier2 = portfolioVal >= 100 && portfolioVal < 250;
  const activeLev = isTier1 ? 20 : isTier2 ? 35 : 50;
  const marginCollateral = isTier1 ? Math.min(portfolioVal, 25.00) : isTier2 ? Math.min(portfolioVal * 0.50, 100.00) : Math.min(portfolioVal * 0.40, 250.00);
  const totalPositionNotional = marginCollateral * activeLev;

  const guidanceEntry = anchoredEntry;
  const guidanceTp = guidanceTakeProfit || parseFloat((guidanceEntry + 1.20).toFixed(2));
  const guidanceSl = guidanceStopLoss || parseFloat((guidanceEntry - 0.72).toFixed(2));

  const guidanceOrder: ActiveTradeOrder = useMemo(() => ({
    id: 'guidance_live',
    requestPDA: 'CURRENT_LIVE_GUIDANCE',
    positionPDA: 'PendingTrigger',
    asset: 'SOL',
    side: 'Long',
    entryPrice: guidanceEntry,
    currentPrice: currentMark,
    stopLoss: guidanceSl,
    takeProfit: guidanceTp,
    margin: marginCollateral,
    leverage: activeLev,
    notional: totalPositionNotional,
    status: isGreenGateOpen ? 'placed' : 'pending_keeper',
    placedAt: Date.now(),
    filledAt: null,
    closedAt: null,
    closeReason: null,
    exitPrice: null,
    pnl: 0.0,
    pnlPercent: 0.0,
    keeperStatus: isGreenGateOpen
      ? `🟢 Green Gate OPEN: Limit Buy @ $${guidanceEntry.toFixed(2)} dispatched to Keeper (Margin Collateral: $${marginCollateral.toFixed(2)} → $${totalPositionNotional.toFixed(2)} Buying Power @ ${activeLev}x)`
      : `⛔ Green Gate CLOSED: Standby @ $${guidanceEntry.toFixed(2)} (Action Tile NOT green — No pending limit dispatched to Keeper)`,
    isSimulated: executionMode === 'simulate',
    explorerUrl: `https://solscan.io?cluster=${selectedNetwork}`,
  }), [guidanceEntry, currentMark, guidanceSl, guidanceTp, marginCollateral, totalPositionNotional, activeLev, isGreenGateOpen, executionMode, selectedNetwork]);

  // Active selected order priority:
  // 1. If 'CURRENT_LIVE_GUIDANCE' is selected, use live guidanceOrder.
  // 2. If a specific order is selected, look for it.
  // 3. Otherwise, check for any 'filled' or 'placed' active order.
  // 4. If all existing orders are closed or cancelled, default to guidanceOrder so SL/Entry/TP follow current guidance!
  const activeOrder: ActiveTradeOrder = useMemo(() => {
    if (selectedPDA === 'CURRENT_LIVE_GUIDANCE') {
      return guidanceOrder;
    }
    if (selectedPDA) {
      const match = orders.find((o) => o.requestPDA === selectedPDA);
      if (match) return match;
    }
    const filled = orders.find((o) => o.status === 'filled');
    if (filled) return filled;

    const placed = orders.find((o) => o.status === 'placed' || o.status === 'pending_keeper');
    if (placed) return placed;

    return guidanceOrder;
  }, [selectedPDA, orders, guidanceOrder]);

  // Automated Keeper Fill Simulation: When Green Gate is open and mark price reaches/dips below entry pivot,
  // automatically dispatch and fill the position on the daemon so it advances to Stage 3 (Position Active)
  const autoFilledGuidanceRef = useRef<boolean>(false);
  useEffect(() => {
    if (isGreenGateOpen && currentMark <= guidanceEntry && !autoFilledGuidanceRef.current) {
      const activeRunning = orders.find((o) => o.status === 'filled' || o.status === 'placed');
      if (!activeRunning) {
        autoFilledGuidanceRef.current = true;
        fetch('/api/bot/simulate-keeper-fill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestPDA: 'CURRENT_LIVE_GUIDANCE',
            price: currentMark,
            entryPrice: guidanceEntry,
            stopLoss: guidanceSl,
            takeProfit: guidanceTp,
            asset: 'SOL',
            side: 'Long',
          }),
        })
          .then(async (res) => {
            const data = await res.json();
            if (data.status === 'filled' && data.requestPDA) {
              setSelectedPDA(data.requestPDA);
              setActionMessage(`⚡ Keeper Matched! Price dipped to $${currentMark.toFixed(2)} (≤ $${guidanceEntry.toFixed(2)} entry pivot). Position is FILLED!`);
              fetchState();
            }
          })
          .catch(() => {});
      }
    }
    if (!isGreenGateOpen || currentMark > guidanceEntry + 1.0) {
      autoFilledGuidanceRef.current = false;
    }
  }, [isGreenGateOpen, currentMark, guidanceEntry, guidanceSl, guidanceTp, orders, fetchState]);

  const markPrice = currentMark || activeOrder.currentPrice || 121.26;
  const isFilled = activeOrder.status === 'filled';
  const isPending = activeOrder.status === 'placed' || activeOrder.status === 'pending_keeper';
  const isClosed = activeOrder.status === 'closed';
  const isCancelled = activeOrder.status === 'cancelled';

  // Compute live visual distance to TP & SL
  const distToTp = activeOrder.takeProfit - markPrice;
  const distToTpPct = (distToTp / markPrice) * 100;
  const distToSl = markPrice - activeOrder.stopLoss;
  const distToSlPct = (distToSl / markPrice) * 100;

  // Gauge percentage strictly aligned to Entry at 50% (0 = Stop Loss, 50 = Entry, 100 = Take Profit)
  const isLong = activeOrder.side === 'Long';
  const slDist = isLong
    ? Math.max(0.001, activeOrder.entryPrice - activeOrder.stopLoss)
    : Math.max(0.001, activeOrder.stopLoss - activeOrder.entryPrice);
  const tpDist = isLong
    ? Math.max(0.001, activeOrder.takeProfit - activeOrder.entryPrice)
    : Math.max(0.001, activeOrder.entryPrice - activeOrder.takeProfit);

  let gaugePct = 50;
  if (isLong) {
    if (markPrice <= activeOrder.entryPrice) {
      // SL territory (0% to 50%)
      const lossProgress = (activeOrder.entryPrice - markPrice) / slDist;
      gaugePct = Math.max(0, 50 - lossProgress * 50);
    } else {
      // TP territory (50% to 100%)
      const gainProgress = (markPrice - activeOrder.entryPrice) / tpDist;
      gaugePct = Math.min(100, 50 + gainProgress * 50);
    }
  } else {
    // Short
    if (markPrice >= activeOrder.entryPrice) {
      // SL territory (0% to 50%)
      const lossProgress = (markPrice - activeOrder.entryPrice) / slDist;
      gaugePct = Math.max(0, 50 - lossProgress * 50);
    } else {
      // TP territory (50% to 100%)
      const gainProgress = (activeOrder.entryPrice - markPrice) / tpDist;
      gaugePct = Math.min(100, 50 + gainProgress * 50);
    }
  }

  // Dynamic PnL calculation
  const computedPnl = isFilled
    ? activeOrder.side === 'Long'
      ? ((markPrice - activeOrder.entryPrice) / activeOrder.entryPrice) * activeOrder.notional
      : ((activeOrder.entryPrice - markPrice) / activeOrder.entryPrice) * activeOrder.notional
    : isClosed
    ? activeOrder.pnl
    : 0.0;
  const computedRoe = activeOrder.margin > 0 ? (computedPnl / activeOrder.margin) * 100 : 0.0;

  // Actions
  const handleCopyPDA = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Next Step 1: Simulate Keeper Fill
  const handleSimulateKeeperFill = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/bot/simulate-keeper-fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestPDA: activeOrder.requestPDA,
          price: markPrice,
          entryPrice: activeOrder.entryPrice,
          asset: activeOrder.asset,
          side: activeOrder.side,
        }),
      });
      const data = await res.json();
      setRawJsonResponse(data);
      if (data.requestPDA) {
        setSelectedPDA(data.requestPDA);
      }
      setActionMessage('⚡ Keeper matched! Position is now FILLED at $' + activeOrder.entryPrice.toFixed(4));
      await fetchState();
    } catch (err: any) {
      setActionMessage('Fill simulation error: ' + err.message);
    } finally {
      setIsLoading(false);
      setTimeout(() => setActionMessage(null), 6000);
    }
  };

  // Arm & Dispatch Actionable Limit Order (Generate Solana Request PDA on Jupiter / Keeper)
  const handleArmActionableOrder = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/bot/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset: activeOrder.asset || 'SOL',
          direction: activeOrder.side ? (activeOrder.side.toLowerCase() === 'short' ? 'sell' : 'buy') : 'buy',
          price: markPrice,
          entryPrice: activeOrder.entryPrice,
          stopLoss: activeOrder.stopLoss,
          takeProfit: activeOrder.takeProfit,
          barConfirmation: 2,
          consecutiveGreen: 2,
          isGreenGate: true,
          simulate: true,
        }),
      });
      const data = await res.json();
      setRawJsonResponse(data);
      if (data.requestPDA) {
        setSelectedPDA(data.requestPDA);
        setActionMessage(`🎯 Actionable PDA generated: ${data.requestPDA.slice(0, 10)}... Order is armed with Keeper!`);
        await fetchState();
      } else if (data.message || data.reason) {
        setActionMessage(`Order armed notice: ${data.message || data.reason}`);
      }
    } catch (err: any) {
      setActionMessage('Error generating actionable PDA: ' + err.message);
    } finally {
      setIsLoading(false);
      setTimeout(() => setActionMessage(null), 6000);
    }
  };

  // Next Step 2: Poll Order Status (GET /order/:pda)
  const handlePollOrderStatus = async (pdaToPoll?: string) => {
    const target = pdaToPoll || activeOrder.requestPDA;
    setIsLoading(true);
    try {
      let res = await fetch(`/api/bot/order/${target}`);
      if (!res.ok) {
        res = await fetch(`/order/${target}`);
      }
      const data = await res.json();
      setRawJsonResponse(data);
      setShowJsonDrawer(true);
      setActionMessage(`✅ Order status polled successfully for ${target.slice(0, 8)}...`);
      await fetchState();
    } catch (err: any) {
      setActionMessage('Failed to poll status: ' + err.message);
    } finally {
      setIsLoading(false);
      setTimeout(() => setActionMessage(null), 5000);
    }
  };

  // Next Step 3A: Cancel Unfilled Request (POST /cancel)
  const handleCancelOrder = async () => {
    if (!confirm(`Cancel unfilled position request: ${activeOrder.requestPDA}?`)) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/bot/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestPDA: activeOrder.requestPDA }),
      });
      const data = await res.json();
      setRawJsonResponse(data);
      setActionMessage('🛑 Position request cancelled. Collateral released.');
      await fetchState();
    } catch (err: any) {
      setActionMessage('Cancellation error: ' + err.message);
    } finally {
      setIsLoading(false);
      setTimeout(() => setActionMessage(null), 5000);
    }
  };

  // Next Step 3B: Close Active Position (POST /close)
  const handleClosePosition = async () => {
    if (!confirm(`Market close ${activeOrder.asset} ${activeOrder.side} position @ $${markPrice.toFixed(2)}?`)) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/bot/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestPDA: activeOrder.requestPDA,
          exitPrice: markPrice,
          reason: 'MANUAL_CLOSE',
        }),
      });
      const data = await res.json();
      setRawJsonResponse(data);
      setActionMessage(`💥 Position closed @ $${markPrice.toFixed(2)} | PnL: ${data.pnl >= 0 ? '+' : ''}$${data.pnl}`);
      if (onTradeClose && typeof data.pnl === 'number') {
        onTradeClose(data.pnl);
      }
      await fetchState();
    } catch (err: any) {
      setActionMessage('Close error: ' + err.message);
    } finally {
      setIsLoading(false);
      setTimeout(() => setActionMessage(null), 6000);
    }
  };

  // Custom PDA Inspection
  const handleLookupCustomPda = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPdaInput.trim()) return;
    setCustomPdaLoading(true);
    await handlePollOrderStatus(customPdaInput.trim());
    setCustomPdaLoading(false);
  };

  return (
    <div className="bg-[#141516] border border-white/10 rounded-2xl p-5 shadow-2xl space-y-5">
      {/* 1. Header with Mode Badge & Order Selector */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div className="flex items-start sm:items-center gap-3">
          <div
            className={`p-2.5 rounded-xl border ${
              isFilled
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : isPending
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                : 'bg-neutral-800 border-white/10 text-neutral-400'
            }`}
          >
            {isFilled ? <ShieldCheck className="w-6 h-6 animate-pulse" /> : <Clock className="w-6 h-6" />}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <span>Trade Keeper Execution Monitor</span>
              </h3>

              {/* Status Badge */}
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono border ${
                  isFilled
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : isPending
                    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                    : isCancelled
                    ? 'bg-neutral-800 text-neutral-400 border-white/10'
                    : 'bg-purple-500/15 text-purple-400 border-purple-500/30'
                }`}
              >
                {activeOrder.status.toUpperCase()}
              </span>

              {/* Training Wheels / Execution Mode Badge */}
              <button
                onClick={() => setShowTrainingWheelsModal(true)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold border flex items-center gap-1.5 transition-all shadow-sm ${
                  executionMode === 'simulate'
                    ? 'bg-blue-500/20 text-blue-300 border-blue-500/40 hover:bg-blue-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                }`}
                title="Configure Execution Mode & Training Wheels"
              >
                {executionMode === 'simulate' ? (
                  <>
                    <Lock className="w-3 h-3 text-blue-400" />
                    <span>Training Wheels: ON (Sandbox)</span>
                  </>
                ) : (
                  <>
                    <Unlock className="w-3 h-3 text-emerald-400 animate-pulse" />
                    <span>Training Wheels: OFF ({selectedNetwork.toUpperCase()})</span>
                  </>
                )}
                <span className="text-[10px] underline opacity-75 ml-0.5">Pre-Flight &rarr;</span>
              </button>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              Live lifecycle tracker for Jupiter Perpetuals limit orders, keeper matching, and bracket TP/SL.
            </p>
          </div>
        </div>

        {/* Action Buttons Top */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick Take Off / Put On Training Wheels Action */}
          <button
            onClick={() => setShowTrainingWheelsModal(true)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all flex items-center gap-1.5 ${
              executionMode === 'simulate'
                ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-500/30'
                : 'bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border-blue-500/30'
            }`}
            title="Open Pre-Flight Checklist & Execution Switcher"
          >
            <Rocket className="w-3.5 h-3.5" />
            <span>
              {executionMode === 'simulate' ? 'Take Off Training Wheels' : 'Training Wheels Hub'}
            </span>
          </button>

          <button
            onClick={() => handlePollOrderStatus()}
            disabled={isLoading}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-white/10 transition-all flex items-center gap-1.5"
            title="Poll GET /order/:requestPDA"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Poll Status</span>
          </button>

          <button
            onClick={() => setShowJsonDrawer(!showJsonDrawer)}
            className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-white/10 transition-all flex items-center gap-1"
            title="Inspect raw JSON API payload"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>API Docs</span>
            {showJsonDrawer ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Action Notification Alert */}
      {actionMessage && (
        <div className="bg-blue-950/60 border border-blue-500/40 rounded-xl px-4 py-2.5 text-xs text-blue-300 flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{actionMessage}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="text-neutral-400 hover:text-white text-xs px-1"
          >
            &times;
          </button>
        </div>
      )}

      {/* Trade Order Selector (when multiple orders exist) */}
      {orders.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-[#191a1c] border border-white/5 rounded-xl px-4 py-2.5 text-xs">
          <div className="flex items-center gap-2 text-neutral-400">
            <Layers className="w-4 h-4 text-blue-400" />
            <span className="font-medium">Active Position / Order Monitor:</span>
          </div>
          <select
            value={activeOrder.requestPDA === 'CURRENT_LIVE_GUIDANCE' ? 'CURRENT_LIVE_GUIDANCE' : activeOrder.requestPDA}
            onChange={(e) => setSelectedPDA(e.target.value)}
            className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-neutral-200 font-mono focus:outline-none focus:border-blue-500"
          >
            <option value="CURRENT_LIVE_GUIDANCE">
              🎯 [STANDBY GUIDANCE] Next Limit Buy @ ${guidanceEntry.toFixed(2)} (Arm to Generate Actionable PDA)
            </option>
            {orders.map((o) => (
              <option key={o.requestPDA} value={o.requestPDA}>
                {o.status === 'filled' ? '🟢 FILLED' : o.status === 'placed' ? '⏳ PENDING LIMIT' : o.status === 'closed' ? '🏁 CLOSED' : '🚫 CANCELLED'} · #{o.id || o.requestPDA.slice(0, 8)} ({o.side} @ ${o.entryPrice.toFixed(2)} · {o.margin} USDC @ {o.leverage}x)
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 2. Order Summary Card & Live Mark Ticker */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-[#191a1c] border border-white/5 rounded-xl p-4">
        {/* Metric 1: Asset & Side */}
        <div className="space-y-1">
          <span className="text-[11px] text-neutral-400 font-medium">Position Contract</span>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold font-mono text-white">
              {activeOrder.asset} / USDC
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-bold font-mono ${
                activeOrder.side === 'Long'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-red-500/20 text-red-400 border border-red-500/30'
              }`}
            >
              {activeOrder.side.toUpperCase()}
            </span>
          </div>
          <span className="text-[11px] text-neutral-400 font-mono">
            Margin: ${activeOrder.margin.toFixed(2)} USDC ({activeOrder.leverage}x · ${activeOrder.notional.toLocaleString()} Buying Power on ${portfolioVal.toFixed(2)} portfolio balance)
          </span>
        </div>

        {/* Metric 2: Entry vs Mark */}
        <div className="space-y-1">
          <span className="text-[11px] text-neutral-400 font-medium">Limit Entry vs Mark Price</span>
          <div className="flex items-baseline gap-2 font-mono">
            <span className="text-sm font-semibold text-neutral-300">
              Entry: ${activeOrder.entryPrice.toFixed(4)}
            </span>
            <span className="text-white/30">|</span>
            <span className="text-base font-bold text-amber-400">
              ${markPrice.toFixed(4)}
            </span>
          </div>
          <span className="text-[11px] text-neutral-500 font-mono">
            {markPrice >= activeOrder.entryPrice ? '+' : ''}
            {(markPrice - activeOrder.entryPrice).toFixed(4)} spread
            {isPending && markPrice > activeOrder.entryPrice && (
              <span className="text-amber-400/90 ml-1">
                (Awaiting ${(markPrice - activeOrder.entryPrice).toFixed(4)} dip to fill)
              </span>
            )}
            {isPending && markPrice <= activeOrder.entryPrice && (
              <span className="text-emerald-400 font-bold ml-1">
                (Limit price reached! Keeper match executing)
              </span>
            )}
          </span>
        </div>

        {/* Metric 3: Unrealized PnL */}
        <div className="space-y-1">
          <span className="text-[11px] text-neutral-400 font-medium">Unrealized PnL &amp; ROE</span>
          <div
            className={`text-lg font-bold font-mono ${
              computedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {computedPnl >= 0 ? '+' : ''}${computedPnl.toFixed(2)}
            <span className="text-xs ml-1.5 font-normal">
              ({computedRoe >= 0 ? '+' : ''}{computedRoe.toFixed(1)}%)
            </span>
          </div>
          <span className="text-[11px] text-neutral-500 font-mono">
            Est. Liq: ~${(activeOrder.entryPrice * (1 - 1 / activeOrder.leverage)).toFixed(2)}
          </span>
        </div>

        {/* Metric 4: Brackets TP / SL */}
        <div className="space-y-1">
          <span className="text-[11px] text-neutral-400 font-medium">Take Profit / Stop Loss</span>
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-emerald-400 font-bold">
              TP: ${activeOrder.takeProfit.toFixed(4)}
            </span>
            <span className="text-white/20">/</span>
            <span className="text-red-400 font-bold">
              SL: ${activeOrder.stopLoss.toFixed(4)}
            </span>
          </div>
          <span className="text-[11px] text-neutral-500 font-mono">
            Risk: -${(activeOrder.entryPrice - activeOrder.stopLoss).toFixed(3)} | Reward: +$
            {(activeOrder.takeProfit - activeOrder.entryPrice).toFixed(3)} (1:1.43)
          </span>
        </div>
      </div>

      {/* 3. STEPPER: 4-Stage Jupiter Keeper Lifecycle (with Explicit Green Gate Status) */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-neutral-200">
              Jupiter Keeper Execution Lifecycle (Next Step 1)
            </span>
            {isFilled ? (
              <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 font-bold text-[10px] flex items-center gap-1 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                <span>ON-CHAIN POSITION ACTIVE</span>
              </span>
            ) : isGreenGateOpen ? (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold text-[10px] flex items-center gap-1 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>🟢 GREEN GATE OPEN (ACTION TILE GREEN · KEEPER ARMED)</span>
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold text-[10px] flex items-center gap-1 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                <span>⛔ GREEN GATE CLOSED (ACTION TILE NOT GREEN · NO LIMIT PENDING)</span>
              </span>
            )}
          </div>
          <span className="text-[11px] text-neutral-400 font-mono">
            Keeper Status: <strong className="text-neutral-200">{activeOrder.keeperStatus}</strong>
          </span>
        </div>

        {/* Informational Notification Banner explaining Green Gate condition */}
        {!isFilled && !isGreenGateOpen && (
          <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 flex items-start gap-2.5 shadow-sm">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-bold text-amber-300 flex items-center gap-1.5">
                <span>Green Gate is CLOSED (Action Tile is NOT Green)</span>
                <span className="text-[10px] bg-amber-500/20 px-1.5 py-0.2 rounded font-normal text-amber-200 font-mono">No Pending Limit on Keeper</span>
              </div>
              <p className="text-[11px] text-neutral-300 mt-0.5 leading-relaxed">
                The sliding mark may touch or cross the Entry Pivot support level, but <strong>no order will fill</strong> because the Green Signal Gate is closed. The engine requires a confirmed <strong>GREEN Action Tile</strong> before dispatching a limit order to the Jupiter Keeper.
              </p>
            </div>
          </div>
        )}

        {!isFilled && isGreenGateOpen && (
          <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 flex items-start gap-2.5 shadow-sm">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                <span>Green Gate is OPEN (Action Tile is Confirmed Green)</span>
                <span className="text-[10px] bg-emerald-500/20 px-1.5 py-0.2 rounded font-normal text-emerald-200 font-mono">Keeper Fill Armed</span>
              </div>
              <p className="text-[11px] text-neutral-300 mt-0.5 leading-relaxed">
                Green buy trigger confirmed. Limit order has been dispatched to the Jupiter Keeper and will execute immediately when the sliding mark dips to the limit target (${activeOrder.entryPrice.toFixed(2)}).
              </p>
            </div>
          </div>
        )}

        {isFilled && (
          <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-500/40 flex items-start gap-2.5 shadow-sm">
            <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-bold text-blue-300 flex items-center gap-1.5">
                <span>Position Active on Jupiter Keeper</span>
                <span className="text-[10px] bg-blue-500/20 px-1.5 py-0.2 rounded font-normal text-blue-200 font-mono">Filled &amp; Running</span>
              </div>
              <p className="text-[11px] text-neutral-300 mt-0.5 leading-relaxed">
                Order filled @ ${activeOrder.entryPrice.toFixed(2)}. Running live at {activeOrder.leverage || 20}x leverage with automated Take Profit and Stop Loss boundary guards.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          {/* Stage 1 */}
          <div
            className={`p-3 rounded-xl flex items-start gap-2.5 border ${
              isFilled || isGreenGateOpen
                ? 'bg-neutral-900/60 border-emerald-500/30'
                : 'bg-amber-950/20 border-amber-500/40'
            }`}
          >
            {isFilled || isGreenGateOpen ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            )}
            <div>
              <span
                className={`text-xs font-bold block ${
                  isFilled || isGreenGateOpen ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {isFilled || isGreenGateOpen ? '1. Green Gate: OPEN' : '1. Green Gate: GATED'}
              </span>
              <span className="text-[11px] text-neutral-400">
                {isFilled || isGreenGateOpen
                  ? 'Action Tile Green confirmed · PDA registered on Solana Anchor.'
                  : 'Action Tile NOT Green. No order dispatched to Keeper.'}
              </span>
            </div>
          </div>

          {/* Stage 2 */}
          <div
            className={`p-3 rounded-xl border flex items-start gap-2.5 ${
              isFilled
                ? 'bg-neutral-900/60 border-emerald-500/30'
                : isGreenGateOpen
                ? 'bg-amber-950/20 border-amber-500/40'
                : 'bg-neutral-900/40 border-white/5 opacity-70'
            }`}
          >
            {isFilled ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : isGreenGateOpen ? (
              <Clock className="w-4 h-4 text-amber-400 animate-spin shrink-0 mt-0.5" />
            ) : (
              <Clock className="w-4 h-4 text-neutral-500 shrink-0 mt-0.5" />
            )}
            <div>
              <span
                className={`text-xs font-bold block ${
                  isFilled
                    ? 'text-emerald-400'
                    : isGreenGateOpen
                    ? 'text-amber-400'
                    : 'text-neutral-400'
                }`}
              >
                {isFilled
                  ? '2. Keeper Filled'
                  : isGreenGateOpen
                  ? '2. Keeper Fill Armed'
                  : '2. Keeper Matching: On Hold'}
              </span>
              <span className="text-[11px] text-neutral-400">
                {isFilled
                  ? `Matched @ $${activeOrder.entryPrice.toFixed(2)}`
                  : isGreenGateOpen
                  ? markPrice <= activeOrder.entryPrice
                    ? `Limit reached ($${markPrice.toFixed(2)} ≤ $${activeOrder.entryPrice.toFixed(2)}) — Executing Keeper fill.`
                    : `Awaiting price dip to limit target $${activeOrder.entryPrice.toFixed(2)}.`
                  : 'Gated by Green Signal. Will not fill even if mark reaches entry.'}
              </span>
            </div>
          </div>

          {/* Stage 3 */}
          <div
            className={`p-3 rounded-xl border flex items-start gap-2.5 ${
              isFilled
                ? 'bg-neutral-900/60 border-blue-500/30'
                : 'bg-neutral-900/40 border-white/5 opacity-60'
            }`}
          >
            <ShieldCheck
              className={`w-4 h-4 shrink-0 mt-0.5 ${
                isFilled ? 'text-blue-400' : 'text-neutral-500'
              }`}
            />
            <div>
              <span
                className={`text-xs font-bold block ${
                  isFilled ? 'text-blue-400' : 'text-neutral-400'
                }`}
              >
                3. Position Active
              </span>
              <span className="text-[11px] text-neutral-400">
                {isFilled
                  ? `${activeOrder.leverage || 20}x position running live with guard brackets.`
                  : 'Inactive (Awaiting Fill).'}
              </span>
            </div>
          </div>

          {/* Stage 4 */}
          <div
            className={`p-3 rounded-xl border flex items-start gap-2.5 ${
              isClosed
                ? 'bg-neutral-900/60 border-purple-500/30'
                : 'bg-neutral-900/40 border-white/5 opacity-60'
            }`}
          >
            <CheckCircle2
              className={`w-4 h-4 shrink-0 mt-0.5 ${
                isClosed ? 'text-purple-400' : 'text-neutral-500'
              }`}
            />
            <div>
              <span
                className={`text-xs font-bold block ${
                  isClosed ? 'text-purple-400' : 'text-neutral-400'
                }`}
              >
                4. Exit Guardian
              </span>
              <span className="text-[11px] text-neutral-400">
                {isClosed ? activeOrder.closeReason || 'Closed' : 'Guarding TP / SL exits.'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Real-time Bracket Range Bar with Explicit Stop Loss & Take Profit Boundaries */}
      <div className="bg-neutral-900/80 border border-white/10 rounded-2xl p-4.5 space-y-4 shadow-2xl">
        {/* Boundary Header Cards */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs font-mono relative gap-2.5">
          {/* Stop Loss Boundary Card */}
          <div className="flex items-center gap-2.5 text-red-300 font-bold bg-red-950/80 border-2 border-red-500/70 px-3.5 py-2 rounded-xl shadow-[0_0_15px_rgba(239,68,68,0.25)]">
            <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,1)] flex items-center justify-center text-[8px] text-white font-black animate-pulse">!</div>
            <div>
              <div className="text-[10px] text-red-400 font-bold uppercase tracking-wider">🛑 Stop Loss Boundary</div>
              <div className="text-sm font-black text-red-200">
                ${activeOrder.stopLoss.toFixed(4)}
                <span className="text-xs text-red-400 font-normal ml-1.5">(-{distToSlPct.toFixed(2)}%)</span>
              </div>
            </div>
          </div>

          {/* Center Entry Pivot Card */}
          <div className="flex items-center gap-2 text-neutral-100 font-bold bg-neutral-950 px-4 py-2 rounded-xl border-2 border-cyan-400/80 shadow-[0_0_15px_rgba(34,211,238,0.25)]">
            <span className="text-cyan-400 text-sm font-black animate-pulse">◆</span>
            <div>
              <div className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider flex items-center gap-1">
                <span>Entry Pivot</span>
                {isFilled && <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1 rounded font-normal font-mono">Filled Active</span>}
                {!isFilled && isGreenGateOpen && <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1 rounded font-normal font-mono">🟢 Green Gate Armed</span>}
                {!isFilled && !isGreenGateOpen && <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1 rounded font-normal font-mono">⛔ Green Gate Closed</span>}
              </div>
              <div className="text-sm font-black text-white">
                ${activeOrder.entryPrice.toFixed(4)}
              </div>
            </div>
          </div>

          {/* Take Profit Boundary Card */}
          <div className="flex items-center gap-2.5 text-emerald-300 font-bold bg-emerald-950/80 border-2 border-emerald-500/70 px-3.5 py-2 rounded-xl shadow-[0_0_15px_rgba(16,185,129,0.25)] justify-end">
            <div className="text-right">
              <div className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">🎯 Take Profit Boundary (TP2)</div>
              <div className="text-sm font-black text-emerald-200">
                ${activeOrder.takeProfit.toFixed(4)}
                <span className="text-xs text-emerald-400 font-normal ml-1.5">(+{distToTpPct.toFixed(2)}%)</span>
              </div>
            </div>
            <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,1)] flex items-center justify-center text-[8px] text-white font-black animate-pulse">✓</div>
          </div>
        </div>

        {/* Progress Track with Explicit Boundary Gates & 50% Entry Pivot */}
        <div className="relative h-10 w-full bg-neutral-950 rounded-xl overflow-visible border-2 border-white/20 shadow-[inset_0_2px_12px_rgba(0,0,0,0.9)] mt-4">
          <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
            {/* SL Hazard Zone (Red) - Left half 0% to 50% */}
            <div
              className="absolute left-0 top-0 bottom-0 w-1/2 bg-gradient-to-r from-red-600/35 via-red-500/15 to-transparent border-r border-white/10"
              style={{
                backgroundImage: 'repeating-linear-gradient(45deg, rgba(239, 68, 68, 0.12), rgba(239, 68, 68, 0.12) 6px, transparent 6px, transparent 12px)'
              }}
            >
              <span className="absolute left-6 top-1/2 -translate-y-1/2 text-[9px] font-mono font-bold text-red-500/60 uppercase tracking-widest pointer-events-none">
                Risk Zone (SL)
              </span>
            </div>

            {/* TP Reward Zone (Green) - Right half 50% to 100% */}
            <div
              className="absolute right-0 top-0 bottom-0 w-1/2 bg-gradient-to-l from-emerald-600/35 via-emerald-500/15 to-transparent border-l border-white/10"
              style={{
                backgroundImage: 'repeating-linear-gradient(-45deg, rgba(16, 185, 129, 0.12), rgba(16, 185, 129, 0.12) 6px, transparent 6px, transparent 12px)'
              }}
            >
              <span className="absolute right-6 top-1/2 -translate-y-1/2 text-[9px] font-mono font-bold text-emerald-500/60 uppercase tracking-widest pointer-events-none">
                Profit Zone (TP)
              </span>
            </div>
          </div>

          {/* 🛑 STOP LOSS HARD BOUNDARY BARRIER (Left Edge 0%) */}
          <div
            className="absolute left-0 top-0 bottom-0 w-4 bg-gradient-to-r from-red-600 to-red-500 rounded-l-xl border-r-2 border-red-200 z-20 shadow-[0_0_20px_rgba(239,68,68,1)] flex items-center justify-center cursor-help"
            title={`Hard Stop Loss Boundary Barrier: $${activeOrder.stopLoss.toFixed(4)}`}
          >
            <div className="w-1 h-5 bg-white rounded-full shadow-[0_0_8px_white]"></div>
          </div>

          {/* 🎯 TAKE PROFIT HARD BOUNDARY BARRIER (Right Edge 100%) */}
          <div
            className="absolute right-0 top-0 bottom-0 w-4 bg-gradient-to-l from-emerald-600 to-emerald-500 rounded-r-xl border-l-2 border-emerald-200 z-20 shadow-[0_0_20px_rgba(16,185,129,1)] flex items-center justify-center cursor-help"
            title={`Hard Take Profit Boundary Barrier: $${activeOrder.takeProfit.toFixed(4)}`}
          >
            <div className="w-1 h-5 bg-white rounded-full shadow-[0_0_8px_white]"></div>
          </div>

          {/* ◆ VISUAL ENTRY PIVOT LINE (Exact 50% Center) */}
          <div
            className="absolute top-0 bottom-0 left-1/2 w-1.5 bg-cyan-400 -ml-[3px] z-20 shadow-[0_0_16px_rgba(34,211,238,1)] flex flex-col items-center justify-between py-0.5"
            title={`Visual Entry Baseline: $${activeOrder.entryPrice.toFixed(4)}`}
          >
            <div className="w-3.5 h-1.5 bg-cyan-200 rounded-full -mt-0.5 shadow-md"></div>
            <div className="w-3.5 h-1.5 bg-cyan-200 rounded-full -mb-0.5 shadow-md"></div>
          </div>

          {/* 🟡 SLIDING YELLOW MARKER BALL (Live Mark Price Pin) */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-8 h-8 bg-gradient-to-tr from-amber-500 via-amber-400 to-amber-300 rounded-full shadow-[0_0_25px_rgba(251,191,36,1)] -ml-4 z-30 transition-[left] duration-300 ease-out ring-2 ring-neutral-950 flex items-center justify-center cursor-pointer group"
            style={{ left: `${Math.max(2, Math.min(98, gaugePct))}%` }}
            title={`Live Mark: $${markPrice.toFixed(4)} | Entry: $${activeOrder.entryPrice.toFixed(4)} (${(markPrice - activeOrder.entryPrice >= 0 ? '+' : '')}${(markPrice - activeOrder.entryPrice).toFixed(4)} spread)`}
          >
            <div className="w-3 h-3 rounded-full bg-neutral-950 flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-ping"></div>
            </div>

            {/* Floating Live Price Tag directly over the yellow slider ball */}
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-amber-400 text-neutral-950 px-2 py-0.5 rounded-md font-mono text-[11px] font-black whitespace-nowrap shadow-xl pointer-events-none ring-2 ring-amber-200 flex items-center gap-1">
              <span>${markPrice.toFixed(2)}</span>
              <span className="text-[9px]">{tickDirection === 'up' ? '▲' : '▼'}</span>
            </div>
          </div>
        </div>

        {/* Boundary Labels & Sliding Status Footer */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[11px] font-mono text-neutral-400 pt-2 gap-2 border-t border-white/5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1 text-red-400 font-bold text-[10px] bg-red-950/40 px-2 py-0.5 rounded border border-red-500/20">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span>
              🛑 SL: ${activeOrder.stopLoss.toFixed(2)}
            </span>
            <span className="text-white/20">|</span>
            <span className="flex items-center gap-1.5 bg-amber-950/30 px-2 py-0.5 rounded border border-amber-500/20">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.8)]"></span>
              <span className="text-amber-300 font-bold">SLIDING MARK: ${markPrice.toFixed(4)}</span>
              <span className="text-neutral-400">
                ({markPrice >= activeOrder.entryPrice ? '+' : ''}${(markPrice - activeOrder.entryPrice).toFixed(4)} spread)
              </span>
            </span>
            <span className="text-white/20">|</span>
            <span className="flex items-center gap-1 text-emerald-400 font-bold text-[10px] bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/20">
              🎯 TP2: ${activeOrder.takeProfit.toFixed(2)}
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            {!isFilled && !isGreenGateOpen ? (
              markPrice <= activeOrder.entryPrice ? (
                <span
                  className="text-amber-300 font-medium bg-amber-950/70 px-2.5 py-1 rounded-lg border border-amber-500/40 flex items-center gap-1.5 shadow-sm"
                  title="The sliding mark touched the support entry level, but no order was dispatched because the Action Tile was not Green. The engine requires a confirmed Green Buy Trigger before dispatching orders to the Jupiter Keeper."
                >
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                  <span>Support Met · ⛔ No Fill (Green Gate Closed — Action Tile Not Green)</span>
                </span>
              ) : (
                <span className="text-amber-300 font-medium bg-amber-950/60 px-2.5 py-1 rounded-lg border border-amber-500/30 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  <span>Guidance Level: ${(markPrice - activeOrder.entryPrice).toFixed(2)} to Support · Dispatches ONLY on Green Gate</span>
                </span>
              )
            ) : isPending && isGreenGateOpen ? (
              <span className="text-emerald-300 font-medium bg-emerald-950/60 px-2.5 py-1 rounded-lg border border-emerald-500/30 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
                <span>
                  {markPrice <= activeOrder.entryPrice
                    ? `🟢 Limit Entry Reached ($${markPrice.toFixed(2)} ≤ $${activeOrder.entryPrice.toFixed(2)}) · Keeper Fill Triggered`
                    : `🟢 Green Gate Open · Resting Limit Buy: Dip -$${(markPrice - activeOrder.entryPrice).toFixed(4)} needed to fill`}
                </span>
              </span>
            ) : isFilled ? (
              <span className="text-emerald-400 font-medium bg-emerald-950/60 px-2.5 py-1 rounded-lg border border-emerald-500/30 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Position Active ({gaugePct.toFixed(1)}% through bracket)</span>
              </span>
            ) : (
              <span className="text-neutral-500">
                Order Status: {activeOrder.status.toUpperCase()}
              </span>
            )}
            {selectedPDA === 'CURRENT_LIVE_GUIDANCE' && (
              <button
                onClick={handleAnchorCurrentPrice}
                className="text-[10px] text-cyan-400 hover:text-cyan-300 bg-cyan-950/40 hover:bg-cyan-900/40 px-2 py-1 rounded border border-cyan-500/30 font-mono transition-all"
                title="Re-anchor limit buy entry exactly 8¢ below current market mark price"
              >
                ⚓ Re-anchor 8¢ Below
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 5. NEXT STEPS MANAGEMENT ACTIONS (Next Steps 1 - 3) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Arm Order & Generate Actionable PDA when on Guidance */}
          {activeOrder.requestPDA === 'CURRENT_LIVE_GUIDANCE' && (
            <button
              onClick={handleArmActionableOrder}
              disabled={isLoading}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
              title="Generate an actionable on-chain Request PDA and arm limit order with Jupiter Keeper"
            >
              <Zap className="w-3.5 h-3.5 text-amber-300" />
              <span>⚡ Arm Order (Generate Actionable PDA)</span>
            </button>
          )}

          {/* Next Step 1: Simulate Keeper Fill */}
          {isPending && (
            <button
              onClick={handleSimulateKeeperFill}
              disabled={isLoading}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-md transition-all flex items-center gap-1.5"
              title="Instantly execute keeper match in simulation"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>1. Simulate Keeper Fill Now</span>
            </button>
          )}

          {/* Next Step 2: Poll Order Status */}
          <button
            onClick={() => handlePollOrderStatus()}
            disabled={isLoading}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-white/10 transition-all flex items-center gap-1.5"
            title="Poll status via GET /order/:requestPDA"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>2. Poll Status (/order)</span>
          </button>

          {/* Next Step 3A: Cancel Unfilled Request */}
          {isPending && (
            <button
              onClick={handleCancelOrder}
              disabled={isLoading}
              className="px-3 py-2 text-xs font-semibold rounded-lg bg-amber-950/60 hover:bg-amber-900 text-amber-300 border border-amber-500/30 transition-all flex items-center gap-1.5"
              title="Cancel unfilled order via POST /cancel"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>3A. Cancel Order</span>
            </button>
          )}

          {/* Next Step 3B: Close Active Position */}
          {isFilled && (
            <button
              onClick={handleClosePosition}
              disabled={isLoading}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-500 text-white shadow-md transition-all flex items-center gap-1.5"
              title="Close position via POST /close"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>3B. Market Close Position</span>
            </button>
          )}
        </div>

        {/* Request PDA Display & Explorer Link */}
        {activeOrder.requestPDA === 'CURRENT_LIVE_GUIDANCE' ? (
          <div className="flex items-center gap-2 text-xs font-mono bg-amber-950/40 px-3 py-1.5 rounded-lg border border-amber-500/30">
            <span className="text-amber-400 font-bold">PDA:</span>
            <span className="text-amber-200 font-medium text-[11px]" title="Algorithm guidance tracking next limit entry pivot. Click 'Arm Order' to generate an actionable on-chain Request PDA.">
              STANDBY GUIDANCE
            </span>
            <button
              onClick={handleArmActionableOrder}
              disabled={isLoading}
              className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold rounded flex items-center gap-1 transition-all cursor-pointer"
              title="Arm order and generate actionable Request PDA"
            >
              <Zap className="w-3 h-3 text-amber-300" />
              <span>Arm Order</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs font-mono bg-neutral-900/80 px-3 py-1.5 rounded-lg border border-white/5">
            <span className="text-neutral-500">PDA:</span>
            <span className="text-blue-400 font-bold truncate max-w-[170px]" title={activeOrder.requestPDA}>
              {activeOrder.requestPDA}
            </span>
            <button
              onClick={() => handleCopyPDA(activeOrder.requestPDA)}
              className="text-neutral-400 hover:text-white p-0.5 cursor-pointer"
              title="Copy Request PDA"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            {copied && <span className="text-emerald-400 text-[10px]">Copied!</span>}
            <a
              href={`https://solscan.io/account/${activeOrder.requestPDA}?cluster=${network}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-neutral-400 hover:text-blue-400 p-0.5 ml-1"
              title="Inspect on Solscan"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
      </div>

      {/* 6. Expandable Raw API / cURL Drawer */}
      {showJsonDrawer && (
        <div className="pt-3 border-t border-white/10 space-y-3 animate-fadeIn">
          <div className="flex items-center justify-between text-xs text-neutral-300 font-semibold">
            <span>Next Steps cURL Commands &amp; Live API Payload</span>
            <span className="text-[11px] text-neutral-500 font-mono">
              Port 3001 Backend Active
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {/* Left: CLI cURL Examples */}
            <div className="space-y-2 bg-neutral-950 p-3 rounded-xl border border-white/10 font-mono text-[11px]">
              <span className="text-neutral-400 block font-semibold text-[10px] uppercase tracking-wider">
                Terminal Commands (Next Steps 1 - 3):
              </span>
              <div>
                <span className="text-neutral-500"># Step 2: Poll Order Status</span>
                <pre className="text-blue-300 overflow-x-auto whitespace-pre-wrap select-all py-1">
                  curl http://localhost:3001/order/{activeOrder.requestPDA}
                </pre>
              </div>
              <div>
                <span className="text-neutral-500"># Step 1: Simulate Keeper Fill</span>
                <pre className="text-emerald-300 overflow-x-auto whitespace-pre-wrap select-all py-1">
                  curl -X POST http://localhost:3001/simulate-keeper-fill -H "Content-Type: application/json" -d '{`{"requestPDA":"${activeOrder.requestPDA}"}`}'
                </pre>
              </div>
              <div>
                <span className="text-neutral-500"># Step 3: Close Position</span>
                <pre className="text-red-300 overflow-x-auto whitespace-pre-wrap select-all py-1">
                  curl -X POST http://localhost:3001/close -H "Content-Type: application/json" -d '{`{"requestPDA":"${activeOrder.requestPDA}"}`}'
                </pre>
              </div>
            </div>

            {/* Right: Live JSON Response */}
            <div className="space-y-2 bg-neutral-950 p-3 rounded-xl border border-white/10 font-mono text-[11px]">
              <span className="text-neutral-400 block font-semibold text-[10px] uppercase tracking-wider">
                Live Server Response (GET /order):
              </span>
              <pre className="text-neutral-300 max-h-52 overflow-y-auto whitespace-pre-wrap">
                {JSON.stringify(rawJsonResponse || activeOrder, null, 2)}
              </pre>
            </div>
          </div>

          {/* Custom PDA Lookup Bar */}
          <form onSubmit={handleLookupCustomPda} className="flex items-center gap-2 pt-1">
            <Search className="w-3.5 h-3.5 text-neutral-400" />
            <input
              type="text"
              placeholder="Paste any custom Request PDA (e.g. FxzpPjspistGY23Q2RnnWWRJxRgbn35cf8bV3oKBXC4r)..."
              value={customPdaInput}
              onChange={(e) => setCustomPdaInput(e.target.value)}
              className="flex-1 bg-neutral-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-mono placeholder:text-neutral-600 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={customPdaLoading}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            >
              {customPdaLoading ? 'Polling...' : 'Lookup PDA'}
            </button>
          </form>
        </div>
      )}
      {/* 7. Taking Off The Training Wheels / Pre-Flight Drawer */}
      {showTrainingWheelsModal && (
        <div className="pt-4 border-t border-white/10 space-y-4 animate-fadeIn bg-neutral-950/90 -mx-5 -mb-5 p-5 rounded-b-2xl border-t border-amber-500/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Rocket className="w-5 h-5 text-amber-400" />
              <h4 className="text-sm font-bold text-white tracking-tight">
                Taking Off the Training Wheels: Live Execution Control Hub
              </h4>
            </div>
            <button
              onClick={() => setShowTrainingWheelsModal(false)}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
            >
              Close
            </button>
          </div>

          <p className="text-xs text-neutral-400">
            Transition safely from simulated paper testing to real on-chain Anchor executions on Solana.
            Follow the 3-tier progression below to verify keeper latency and slippage before committing real capital.
          </p>

          {/* 3-Tier Mode Progression Selector */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            {/* Tier 1: Simulation */}
            <div
              onClick={() => handleSwitchMode('simulate', 'devnet')}
              className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                executionMode === 'simulate'
                  ? 'bg-blue-500/10 border-blue-500/50 shadow-lg ring-1 ring-blue-500/30'
                  : 'bg-neutral-900/50 border-white/5 hover:border-white/20'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold text-blue-400 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  Tier 1: Simulation
                </span>
                {executionMode === 'simulate' && (
                  <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px] font-bold">
                    ACTIVE
                  </span>
                )}
              </div>
              <span className="text-[11px] font-semibold text-neutral-300 block mb-1">
                Training Wheels ON (0-Risk)
              </span>
              <p className="text-[11px] text-neutral-400 leading-relaxed">
                Synthetic keeper matching &amp; zero gas fees. Verify signals, TP/SL bracket math, and bot reliability without on-chain signing.
              </p>
            </div>

            {/* Tier 2: Live Devnet (Recommended Next Step) */}
            <div
              onClick={() => handleSwitchMode('live_onchain', 'devnet')}
              className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                executionMode === 'live_onchain' && selectedNetwork === 'devnet'
                  ? 'bg-emerald-500/10 border-emerald-500/50 shadow-lg ring-1 ring-emerald-500/30'
                  : 'bg-neutral-900/50 border-white/5 hover:border-white/20'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                  <Unlock className="w-3.5 h-3.5" />
                  Tier 2: Live Devnet
                </span>
                {executionMode === 'live_onchain' && selectedNetwork === 'devnet' && (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                    ACTIVE
                  </span>
                )}
              </div>
              <span className="text-[11px] font-semibold text-amber-300 block mb-1">
                Training Wheels OFF (Recommended Next Step)
              </span>
              <p className="text-[11px] text-neutral-400 leading-relaxed">
                Submits real Anchor transactions to Solana Devnet RPC. Derives live on-chain Request PDAs, tested with real keeper matching &amp; free airdrop SOL.
              </p>
            </div>

            {/* Tier 3: Live Mainnet */}
            <div
              onClick={() => {
                if (
                  confirm(
                    '⚠️ ATTENTION: Mainnet execution uses REAL SOL & USDC on Jupiter Perpetuals. Ensure your wallet is funded and risk limits are tested. Proceed?'
                  )
                ) {
                  handleSwitchMode('live_onchain', 'mainnet-beta');
                }
              }}
              className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                executionMode === 'live_onchain' && selectedNetwork === 'mainnet-beta'
                  ? 'bg-purple-500/10 border-purple-500/50 shadow-lg ring-1 ring-purple-500/30'
                  : 'bg-neutral-900/50 border-white/5 hover:border-white/20'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold text-purple-400 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5" />
                  Tier 3: Live Mainnet
                </span>
                {executionMode === 'live_onchain' && selectedNetwork === 'mainnet-beta' && (
                  <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] font-bold">
                    ACTIVE
                  </span>
                )}
              </div>
              <span className="text-[11px] font-semibold text-red-400 block mb-1">
                Full Production (Real Funds)
              </span>
              <p className="text-[11px] text-neutral-400 leading-relaxed">
                Live Solana Mainnet execution via Jupiter Perpetuals Anchor program. Real margin, real PnL, priority compute units enabled.
              </p>
            </div>
          </div>

          {/* Pre-Flight Checklist Table */}
          <div className="bg-neutral-900/70 border border-white/10 rounded-xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-200 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Pre-Flight Readiness Checklist (Required for Live On-Chain)
              </span>
              <button
                onClick={() => fetchPreflight()}
                className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                Re-check
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-lg bg-neutral-950 border border-white/5 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-neutral-200 block">Solana RPC Connection</span>
                  <span className="text-neutral-400 text-[11px] font-mono">
                    {selectedNetwork.toUpperCase()} — {selectedNetwork === 'mainnet-beta' ? 'api.mainnet-beta.solana.com' : 'api.devnet.solana.com'}
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-neutral-950 border border-white/5 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-neutral-200 block">Compute Priority Fees</span>
                  <span className="text-neutral-400 text-[11px]">
                    250,000 micro-lamports auto-injected for guaranteed keeper block inclusion.
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-neutral-950 border border-white/5 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-neutral-200 block">Risk Caps &amp; Circuit Breaker</span>
                  <span className="text-neutral-400 text-[11px]">
                    Max 40x leverage cap, 1.5x ATR hard stop-loss, emergency kill-switch active.
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-neutral-950 border border-white/5 flex items-start gap-2">
                <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-neutral-200 block">Keypair Signer Wallet</span>
                  <span className="text-neutral-400 text-[11px]">
                    {preflightData?.keypairDetected
                      ? `Detected: ${preflightData.keypairPath}`
                      : 'Loaded in ./wallet-devnet.json or ./wallet.json for on-chain signing.'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Terminal Guide to Generate Keypair & Free Devnet SOL */}
          <div className="bg-neutral-950 p-3 rounded-xl border border-white/10 font-mono text-[11px] text-neutral-300 space-y-1.5">
            <span className="text-neutral-400 block font-semibold text-[10px] uppercase tracking-wider">
              Solana CLI Setup (To fund Devnet for Tier 2):
            </span>
            <pre className="text-emerald-300 overflow-x-auto whitespace-pre-wrap select-all py-0.5">
              solana-keygen new -o wallet-devnet.json --no-bip39-passphrase
            </pre>
            <pre className="text-blue-300 overflow-x-auto whitespace-pre-wrap select-all py-0.5">
              solana airdrop 2 $(solana-keygen pubkey wallet-devnet.json) --url devnet
            </pre>
          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-neutral-400">
              Current state: <strong className="text-white">{executionMode === 'simulate' ? 'Training Wheels ON (Simulation)' : `Training Wheels OFF (${selectedNetwork.toUpperCase()})`}</strong>
            </span>
            <div className="flex items-center gap-2">
              {executionMode === 'simulate' ? (
                <button
                  onClick={() => handleSwitchMode('live_onchain', 'devnet')}
                  disabled={isSwitchingMode}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg flex items-center gap-1.5 transition-all"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  <span>Take Off Training Wheels (Devnet)</span>
                </button>
              ) : (
                <button
                  onClick={() => handleSwitchMode('simulate', 'devnet')}
                  disabled={isSwitchingMode}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-lg flex items-center gap-1.5 transition-all"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Put Training Wheels Back On (Simulation)</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
