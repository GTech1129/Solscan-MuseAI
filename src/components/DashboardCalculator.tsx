import React, { useState, useEffect, useCallback } from 'react';
import { Calculator, TrendingUp, History, Play, Trash2, RotateCcw, Download } from 'lucide-react';

export interface TradeLogItem {
  id: string | number;
  tradeId?: string;
  n?: number;
  type: string;
  side: 'Long' | 'Short';
  asset: string;
  entry: number;
  exit: number;
  size: number;
  margin?: number;
  lev?: number;
  pnl: number;
  returnPct?: number;
  fee?: number;
  balance?: number;
  dateTime?: string;
  timestampEntry?: string;
  timestampExit?: string;
  executionMode?: 'AUTOTRADE_BOT' | 'MANUAL_UI';
  reason?: string;
  regime?: string;
}

export function getDeduplicatedTodaysTrades<T extends { tradeId?: string; id?: string | number; requestPDA?: string }>(tradesList: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of tradesList) {
    const key = String(item.tradeId || item.id || item.requestPDA || '');
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

interface DashboardCalculatorProps {
  currentAsset?: string;
  currentPrice?: number;
  portfolioBalance?: number;
  onUpdatePortfolioBalance?: (newBalance: number) => void;
}

export const DashboardCalculator: React.FC<DashboardCalculatorProps> = ({
  currentAsset = 'SOL',
  currentPrice = 119.05,
  portfolioBalance = 30.0,
  onUpdatePortfolioBalance,
}) => {
  const [activeTab, setActiveTab] = useState<'basic' | 'compound' | 'backtest'>('basic');

  // --- 1. BASIC CALCULATOR STATE ---
  const [calcCur, setCalcCur] = useState<string>('0');
  const [calcPrev, setCalcPrev] = useState<number | null>(null);
  const [calcOpPending, setCalcOpPending] = useState<string | null>(null);
  const [calcReset, setCalcReset] = useState<boolean>(false);

  const calcDigit = (d: string) => {
    if (calcReset) {
      setCalcCur(d);
      setCalcReset(false);
    } else {
      setCalcCur((prev) => (prev === '0' ? d : prev + d));
    }
  };

  const calcDot = () => {
    if (calcReset) {
      setCalcCur('0.');
      setCalcReset(false);
      return;
    }
    if (!calcCur.includes('.')) {
      setCalcCur((prev) => prev + '.');
    }
  };

  const calcSign = () => {
    setCalcCur((prev) => (parseFloat(prev) * -1).toString());
  };

  const calcPercent = () => {
    setCalcCur((prev) => (parseFloat(prev) / 100).toString());
  };

  const calcClear = () => {
    setCalcCur('0');
    setCalcPrev(null);
    setCalcOpPending(null);
    setCalcReset(false);
  };

  const calcOp = (op: string) => {
    setCalcOpPending(op);
    setCalcPrev(parseFloat(calcCur));
    setCalcReset(true);
  };

  const calcEquals = () => {
    if (calcOpPending == null || calcPrev == null) return;
    const a = calcPrev;
    const b = parseFloat(calcCur);
    let r = 0;
    switch (calcOpPending) {
      case '+': r = a + b; break;
      case '-': r = a - b; break;
      case '*': r = a * b; break;
      case '/': r = b === 0 ? NaN : a / b; break;
      default: r = b;
    }
    setCalcCur((Number.isFinite(r) ? +r.toFixed(8) : 'Error').toString());
    setCalcPrev(null);
    setCalcOpPending(null);
    setCalcReset(true);
  };

  // --- 2. COMPOUNDING CALCULATOR STATE ---
  const [cPrincipal, setCPrincipal] = useState<number>(() => portfolioBalance || 30.0);
  const [cMode, setCMode] = useState<'0.5' | '1.0' | 'custom'>('0.5');
  const [cCustomAlloc, setCCustomAlloc] = useState<number>(50);
  const [cRate, setCRate] = useState<number>(15.6);
  const [cFee, setCFee] = useState<number>(2.4);
  const [cIters, setCIters] = useState<number>(20);
  const [cMaxIters, setCMaxIters] = useState<number>(100);

  const [compoundSummary, setCompoundSummary] = useState<{
    finalBal: number;
    totalGain: number;
    pctReturn: number;
    nextHalf: number;
    rows: { n: number; startBal: number; tradeAmount: number; profit: number; newBal: number }[];
  } | null>(null);

  useEffect(() => {
    if (portfolioBalance && portfolioBalance > 0) {
      setCPrincipal(portfolioBalance);
      setTInitial(portfolioBalance);
    }
  }, [portfolioBalance]);

  const runCompound = () => {
    const principal = parseFloat(String(cPrincipal)) || 0;
    const rate = parseFloat(String(cRate)) || 0;
    const fee = parseFloat(String(cFee)) || 0;
    const iters = Math.max(1, Math.min(cMaxIters, cIters));

    let allocRatio = 0.5;
    if (cMode === '1.0') allocRatio = 1.0;
    else if (cMode === 'custom') allocRatio = Math.max(0.01, Math.min(1.0, cCustomAlloc / 100));

    const netRate = (rate - fee) / 100;
    let balance = principal;
    const rows = [];

    for (let i = 1; i <= iters; i++) {
      const startBal = balance;
      const tradeAmount = startBal * allocRatio;
      const reserve = startBal - tradeAmount;
      const profit = tradeAmount * netRate;
      const compoundedTrade = tradeAmount + profit;
      const newBal = reserve + compoundedTrade;

      rows.push({
        n: i,
        startBal,
        tradeAmount,
        profit,
        newBal,
      });

      balance = newBal;
    }

    const totalGain = balance - principal;
    const pctReturn = principal !== 0 ? (totalGain / principal) * 100 : 0;
    const nextHalf = balance * allocRatio;

    setCompoundSummary({
      finalBal: balance,
      totalGain,
      pctReturn,
      nextHalf,
      rows,
    });
  };

  // --- 3. BACKTEST TAB STATE ---
  const [isBacktesting, setIsBacktesting] = useState<boolean>(false);
  const [backtestResults, setBacktestResults] = useState<{
    finalBal: number;
    winrate: number;
    totalTrades: number;
    pnl: number;
    gain: number;
    trades: { n: number; type: string; entry: number; exit: number; margin: number; pnl: number; balance: number }[];
  } | null>(null);

  // P0 integrity: the old "Backtest" tab fabricated 15 trades with a
  // hardcoded 12/15 win count and fixed +/- PnL percentages. It has been
  // removed. This tab now honestly reports "no backtest data" until it is
  // wired to a real engine run (src/engine/backtest.ts on real klines) in
  // Phase 2. Never quote the old tab's numbers as performance evidence.
  const runBacktest = () => {
    setIsBacktesting(true);
    setBacktestResults({
      finalBal: portfolioBalance || 30.0,
      winrate: 0,
      totalTrades: 0,
      pnl: 0,
      gain: 0,
      trades: [],
    });
    setIsBacktesting(false);
  };

  // --- 4. TODAY'S TRADES TRACKER STATE ---
  const todayKey = 'sol_trades_' + new Date().toISOString().slice(0, 10);
  // P0 integrity: no seeded trades. The old defaults were two fabricated
  // Oct-3 trades (margin 600.00, pnl -0.30). An empty tracker is honest;
  // real trades appear here once the unified /api/trades ledger has data.
  const DEFAULT_CALC_TRADES: TradeLogItem[] = [];

  const [trades, setTrades] = useState<TradeLogItem[]>(() => {
    try {
      const stored = localStorage.getItem(todayKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return DEFAULT_CALC_TRADES;
    } catch {
      return DEFAULT_CALC_TRADES;
    }
  });

  // Sync with Unified Shared /api/trades Endpoint
  const fetchUnifiedTrades = useCallback(async () => {
    try {
      const res = await fetch('/api/trades', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.trades) && data.trades.length > 0) {
          const mapped: TradeLogItem[] = data.trades.map((t: any, idx: number) => ({
            id: t.tradeId || t.id || `T-${idx + 1}`,
            tradeId: t.tradeId,
            n: t.n || (idx + 1),
            dateTime: t.dateTime || (t.timestampEntry ? t.timestampEntry.replace('T', ' ').slice(0, 19) + ' UTC' : ''),
            type: t.type || 'SL',
            side: t.side || '',
            asset: t.asset || 'SOL',
            // P0 integrity: missing fields stay empty/zero — never the old
            // fabricated fallbacks (158.46 / 157.95 / 600.00 / -0.30 / -2.86).
            entry: typeof t.entry === 'number' ? t.entry : (typeof t.entryPrice === 'number' ? t.entryPrice : 0),
            exit: typeof t.exit === 'number' ? t.exit : (typeof t.exitPrice === 'number' ? t.exitPrice : 0),
            size: typeof t.margin === 'number' ? t.margin : (typeof t.size === 'number' ? t.size : 0),
            margin: typeof t.margin === 'number' ? t.margin : (typeof t.size === 'number' ? t.size : 0),
            lev: t.lev || t.leverage || 20,
            pnl: typeof t.pnl === 'number' ? t.pnl : 0,
            returnPct: typeof t.returnPct === 'number' ? t.returnPct : (typeof t.pnlPercent === 'number' ? t.pnlPercent : 0),
            fee: typeof t.fee === 'number' ? t.fee : 0,
            balance: typeof t.balance === 'number' ? t.balance : (portfolioBalance || 0),
            timestampEntry: t.timestampEntry,
            timestampExit: t.timestampExit,
            executionMode: t.executionMode || 'AUTOTRADE_BOT',
            reason: t.reason,
            regime: t.regime || 'Range Bound / Support',
          }));
          const deduped = getDeduplicatedTodaysTrades(mapped);
          setTrades(deduped);
          localStorage.setItem(todayKey, JSON.stringify(deduped));
        }
      }
    } catch (_) {
      // Fallback to local storage
    }
  }, [todayKey]);

  useEffect(() => {
    fetchUnifiedTrades();
    const interval = setInterval(fetchUnifiedTrades, 4000);
    return () => clearInterval(interval);
  }, [fetchUnifiedTrades]);

  const [tType, setTType] = useState<'Spot' | 'Perp'>('Perp');
  const [tSide, setTSide] = useState<'Long' | 'Short'>('Long');
  const [tAsset, setTAsset] = useState<string>(currentAsset);
  const [tEntry, setTEntry] = useState<string>('');
  const [tExit, setTExit] = useState<string>('');
  const [tSize, setTSize] = useState<string>('');
  // Phase 2: the manual form previously had NO margin/leverage inputs,
  // so every manual trade silently computed as $10.50 margin at 20x.
  // Margin and leverage are now explicit inputs (defaults match the
  // old silent values, but the user can see and change them).
  const [tLev, setTLev] = useState<string>('20');
  const [tInitial, setTInitial] = useState<number>(() => portfolioBalance || 30.0);
  const [formError, setFormError] = useState<string | null>(null);

  const saveTrades = (newTrades: TradeLogItem[]) => {
    const deduped = getDeduplicatedTodaysTrades(newTrades);
    setTrades(deduped);
    localStorage.setItem(todayKey, JSON.stringify(deduped));
  };

  const addTrade = async () => {
    const entry = parseFloat(tEntry);
    const exit = parseFloat(tExit);
    const size = parseFloat(tSize) || 10.5;
    const lev = parseFloat(tLev) || 20;
    if (!entry || !exit || isNaN(entry) || isNaN(exit)) {
      setFormError('Please enter valid Entry & Exit prices.');
      setTimeout(() => setFormError(null), 3500);
      return;
    }
    setFormError(null);
    const pricePct = (exit - entry) / entry;
    const dirMult = tSide === 'Long' ? 1 : -1;
    const pnl = parseFloat((dirMult * pricePct * size * lev).toFixed(2));
    const nowIso = new Date().toISOString();

    const tradeId = `TRD-MANUAL-${Date.now()}`;
    const item: TradeLogItem = {
      id: tradeId,
      tradeId,
      type: tType,
      side: tSide,
      asset: tAsset || currentAsset,
      entry,
      exit,
      size,
      margin: size,
      lev,
      pnl,
      timestampEntry: nowIso,
      timestampExit: nowIso,
      executionMode: 'MANUAL_UI',
      reason: 'MANUAL_UI_SWAP',
      regime: 'MANUAL_EXECUTION',
    };

    saveTrades([item, ...trades]);
    setTEntry('');
    setTExit('');
    setTSize('');

    // POST to shared /api/trades store
    try {
      await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeId,
          asset: item.asset,
          side: item.side,
          type: item.type,
          entryPrice: item.entry,
          exitPrice: item.exit,
          margin: item.size,
          leverage: lev,
          pnl: item.pnl,
          timestampEntry: nowIso,
          timestampExit: nowIso,
          executionMode: 'MANUAL_UI',
          reason: 'MANUAL_UI_SWAP',
        }),
      });
    } catch (_) {}
  };

  const deleteTrade = async (id: string | number) => {
    saveTrades(trades.filter((t) => t.id !== id && t.tradeId !== id));
    try {
      await fetch('/api/trades', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId: id }),
      });
    } catch (_) {}
  };

  const totalPnL = trades.reduce((acc, t) => acc + t.pnl, 0);
  const winCount = trades.filter((t) => t.pnl > 0).length;
  const lossCount = trades.filter((t) => t.pnl <= 0).length;
  const returnPct = tInitial > 0 ? (totalPnL / tInitial) * 100 : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-4 border-t border-white/10 font-sans text-xs">
      {/* LEFT CARD: CALCULATOR TABS */}
      <div className="bg-[#1c1c1a] border border-white/10 rounded-xl p-4 shadow-md space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Calculator className="w-4 h-4 text-blue-400" />
            <span className="font-bold text-sm text-white">Calculator &amp; Backtest</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('basic')}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${
                activeTab === 'basic' ? 'bg-white text-black' : 'text-neutral-400 hover:text-white'
              }`}
            >
              Basic
            </button>
            <button
              onClick={() => {
                setActiveTab('compound');
                if (!compoundSummary) runCompound();
              }}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${
                activeTab === 'compound' ? 'bg-white text-black' : 'text-neutral-400 hover:text-white'
              }`}
            >
              Compounding
            </button>
            <button
              onClick={() => setActiveTab('backtest')}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${
                activeTab === 'backtest' ? 'bg-white text-black' : 'text-neutral-400 hover:text-white'
              }`}
            >
              Backtest
            </button>
          </div>
        </div>

        {/* TAB 1: BASIC CALCULATOR */}
        {activeTab === 'basic' && (
          <div className="space-y-2">
            <div className="bg-[#252523] border border-white/5 rounded-lg p-2.5 text-right font-mono text-xl font-bold text-white overflow-x-auto">
              {calcCur}
            </div>
            <div className="grid grid-cols-4 gap-1.5 font-mono text-sm">
              <button onClick={calcClear} className="p-2.5 rounded bg-rose-600/30 text-rose-300 font-bold hover:bg-rose-600/50">C</button>
              <button onClick={calcSign} className="p-2.5 rounded bg-[#252523] text-neutral-300 hover:bg-white/10">+/-</button>
              <button onClick={calcPercent} className="p-2.5 rounded bg-[#252523] text-neutral-300 hover:bg-white/10">%</button>
              <button onClick={() => calcOp('/')} className="p-2.5 rounded bg-blue-600/30 text-blue-300 font-bold hover:bg-blue-600/50">÷</button>

              <button onClick={() => calcDigit('7')} className="p-2.5 rounded bg-[#252523] text-white hover:bg-white/10">7</button>
              <button onClick={() => calcDigit('8')} className="p-2.5 rounded bg-[#252523] text-white hover:bg-white/10">8</button>
              <button onClick={() => calcDigit('9')} className="p-2.5 rounded bg-[#252523] text-white hover:bg-white/10">9</button>
              <button onClick={() => calcOp('*')} className="p-2.5 rounded bg-blue-600/30 text-blue-300 font-bold hover:bg-blue-600/50">×</button>

              <button onClick={() => calcDigit('4')} className="p-2.5 rounded bg-[#252523] text-white hover:bg-white/10">4</button>
              <button onClick={() => calcDigit('5')} className="p-2.5 rounded bg-[#252523] text-white hover:bg-white/10">5</button>
              <button onClick={() => calcDigit('6')} className="p-2.5 rounded bg-[#252523] text-white hover:bg-white/10">6</button>
              <button onClick={() => calcOp('-')} className="p-2.5 rounded bg-blue-600/30 text-blue-300 font-bold hover:bg-blue-600/50">-</button>

              <button onClick={() => calcDigit('1')} className="p-2.5 rounded bg-[#252523] text-white hover:bg-white/10">1</button>
              <button onClick={() => calcDigit('2')} className="p-2.5 rounded bg-[#252523] text-white hover:bg-white/10">2</button>
              <button onClick={() => calcDigit('3')} className="p-2.5 rounded bg-[#252523] text-white hover:bg-white/10">3</button>
              <button onClick={() => calcOp('+')} className="p-2.5 rounded bg-blue-600/30 text-blue-300 font-bold hover:bg-blue-600/50">+</button>

              <button onClick={() => calcDigit('0')} className="p-2.5 rounded bg-[#252523] text-white hover:bg-white/10 col-span-2">0</button>
              <button onClick={calcDot} className="p-2.5 rounded bg-[#252523] text-white hover:bg-white/10">.</button>
              <button onClick={calcEquals} className="p-2.5 rounded bg-emerald-600/30 text-emerald-300 font-bold hover:bg-emerald-600/50">=</button>
            </div>
          </div>
        )}

        {/* TAB 2: COMPOUNDING CALCULATOR */}
        {activeTab === 'compound' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-neutral-400 block mb-1">Start Equity ($)</label>
                <input
                  type="number"
                  value={cPrincipal}
                  onChange={(e) => setCPrincipal(parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#252523] border border-white/10 rounded px-2 py-1 text-white font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] text-neutral-400 block mb-1">Sizing Mode</label>
                <select
                  value={cMode}
                  onChange={(e) => setCMode(e.target.value as any)}
                  className="w-full bg-[#252523] border border-white/10 rounded px-2 py-1 text-white font-mono"
                >
                  <option value="0.5">Dynamic 50%</option>
                  <option value="1.0">100% Full</option>
                  <option value="custom">Custom %</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-neutral-400 block mb-1">Gain / Trade (%)</label>
                <input
                  type="number"
                  value={cRate}
                  onChange={(e) => setCRate(parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#252523] border border-white/10 rounded px-2 py-1 text-white font-mono"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-neutral-400">Quick Iters:</span>
                {[10, 20, 50, 100].map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      setCIters(n);
                      setTimeout(runCompound, 50);
                    }}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                      cIters === n ? 'bg-blue-500 text-white' : 'bg-[#252523] text-neutral-300'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <button
                onClick={runCompound}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold transition-colors"
              >
                Calculate
              </button>
            </div>

            {compoundSummary && (
              <div className="space-y-2">
                <div className="bg-[#252523] border border-white/5 rounded-lg p-2.5 flex items-center justify-between font-mono text-[11px] flex-wrap gap-2">
                  <span>Final: <b className="text-white">${compoundSummary.finalBal.toFixed(2)}</b></span>
                  <span>Gain: <b className="text-emerald-400">+${compoundSummary.totalGain.toFixed(2)}</b></span>
                  <span>Return: <b className="text-emerald-400">+{compoundSummary.pctReturn.toFixed(1)}%</b></span>
                  <span>Next Sizing: <b className="text-blue-300">${compoundSummary.nextHalf.toFixed(2)}</b></span>
                </div>
                <div className="max-h-36 overflow-y-auto border border-white/5 rounded">
                  <table className="w-full text-right font-mono text-[10px]">
                    <thead className="bg-[#252523] text-neutral-400 sticky top-0">
                      <tr>
                        <th className="text-left p-1.5">#</th>
                        <th className="p-1.5">Start</th>
                        <th className="p-1.5">Traded</th>
                        <th className="p-1.5">Profit</th>
                        <th className="p-1.5">New Bal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {compoundSummary.rows.slice(0, 15).map((r) => (
                        <tr key={r.n} className="hover:bg-white/5">
                          <td className="text-left p-1 text-neutral-400">{r.n}</td>
                          <td className="p-1">${r.startBal.toFixed(2)}</td>
                          <td className="p-1 text-neutral-400">${r.tradeAmount.toFixed(2)}</td>
                          <td className="p-1 text-emerald-400">+${r.profit.toFixed(2)}</td>
                          <td className="p-1 font-bold text-white">${r.newBal.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: BACKTEST */}
        {activeTab === 'backtest' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-neutral-300 font-medium">Dual-Timeframe 50x / 20x Backtest Engine</span>
              <button
                onClick={runBacktest}
                disabled={isBacktesting}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold flex items-center gap-1 transition-colors"
              >
                <Play className="w-3 h-3" />
                {isBacktesting ? 'Simulating...' : 'Run Backtest'}
              </button>
            </div>

            {backtestResults && (
              <div className="space-y-2">
                <div className="bg-[#252523] border border-white/5 rounded-lg p-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
                  <div>
                    <span className="text-neutral-400 block text-[9px]">FINAL BAL</span>
                    <b className="text-white">${backtestResults.finalBal.toFixed(2)}</b>
                  </div>
                  <div>
                    <span className="text-neutral-400 block text-[9px]">WIN RATE</span>
                    <b className="text-emerald-400">{backtestResults.winrate.toFixed(1)}%</b>
                  </div>
                  <div>
                    <span className="text-neutral-400 block text-[9px]">NET PNL</span>
                    <b className={backtestResults.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {backtestResults.pnl >= 0 ? '+' : ''}${backtestResults.pnl.toFixed(2)}
                    </b>
                  </div>
                  <div>
                    <span className="text-neutral-400 block text-[9px]">RETURN</span>
                    <b className="text-emerald-400">+{backtestResults.gain.toFixed(1)}%</b>
                  </div>
                </div>

                <div className="max-h-36 overflow-y-auto border border-white/5 rounded">
                  <table className="w-full text-right font-mono text-[10px]">
                    <thead className="bg-[#252523] text-neutral-400 sticky top-0">
                      <tr>
                        <th className="text-left p-1.5">#</th>
                        <th className="p-1.5">Type</th>
                        <th className="p-1.5">Entry</th>
                        <th className="p-1.5">Exit</th>
                        <th className="p-1.5">PnL</th>
                        <th className="p-1.5">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {backtestResults.trades.slice(0, 10).map((t) => (
                        <tr key={t.n} className="hover:bg-white/5">
                          <td className="text-left p-1 text-neutral-400">{t.n}</td>
                          <td className="p-1 text-neutral-300">{t.type}</td>
                          <td className="p-1">${t.entry.toFixed(2)}</td>
                          <td className="p-1">${t.exit.toFixed(2)}</td>
                          <td className={`p-1 font-bold ${t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
                          </td>
                          <td className="p-1 font-bold text-white">${t.balance.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* RIGHT CARD: TODAY'S TRADES TRACKER */}
      <div className="bg-[#1c1c1a] border border-white/10 rounded-xl p-4 shadow-md space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-sm text-white">☐ Today's Trades</span>
          </div>
          <div className="flex items-center gap-3 text-neutral-400 font-mono text-[11px]">
            <a
              href="/api/trades/csv"
              download="executed_trades_ledger.csv"
              className="px-2 py-0.5 rounded bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 transition-colors"
              title="Download Executed Trades Ledger CSV with exact UTC ISO timestamps"
            >
              <Download className="w-3 h-3 text-emerald-400" />
              <span>CSV</span>
            </a>
            <span>Trades: <b className="text-white">{trades.length}</b></span>
            <span>W/L: <b className="text-emerald-400">{winCount}W</b> / <b className="text-red-400">{lossCount}L</b></span>
            <span>PnL: <b className={totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}>{totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}</b></span>
          </div>
        </div>

        {formError && (
          <div className="text-[11px] text-rose-400 bg-rose-950/40 border border-rose-500/30 rounded px-2 py-1 font-mono">
            {formError}
          </div>
        )}

        {/* Quick Add Form */}
        <div className="grid grid-cols-3 sm:grid-cols-8 gap-2">
          <select
            value={tType}
            onChange={(e) => setTType(e.target.value as any)}
            className="bg-[#252523] border border-white/10 rounded px-1.5 py-1 text-white font-mono"
          >
            <option value="Perp">Perp</option>
            <option value="Spot">Spot</option>
          </select>
          <select
            value={tSide}
            onChange={(e) => setTSide(e.target.value as any)}
            className="bg-[#252523] border border-white/10 rounded px-1.5 py-1 text-white font-mono"
          >
            <option value="Long">Long</option>
            <option value="Short">Short</option>
          </select>
          <input
            placeholder="Asset"
            value={tAsset}
            onChange={(e) => setTAsset(e.target.value)}
            className="bg-[#252523] border border-white/10 rounded px-1.5 py-1 text-white font-mono"
          />
          <input
            placeholder="Entry $"
            type="number"
            step="0.01"
            value={tEntry}
            onChange={(e) => setTEntry(e.target.value)}
            className="bg-[#252523] border border-white/10 rounded px-1.5 py-1 text-white font-mono"
          />
          <input
            placeholder="Exit $"
            type="number"
            step="0.01"
            value={tExit}
            onChange={(e) => setTExit(e.target.value)}
            className="bg-[#252523] border border-white/10 rounded px-1.5 py-1 text-white font-mono"
          />
          <input
            placeholder="Margin $"
            type="number"
            step="0.5"
            min="0"
            value={tSize}
            onChange={(e) => setTSize(e.target.value)}
            className="bg-[#252523] border border-white/10 rounded px-1.5 py-1 text-white font-mono"
          />
          <input
            placeholder="Lev ×"
            type="number"
            step="1"
            min="1"
            max="60"
            value={tLev}
            onChange={(e) => setTLev(e.target.value)}
            className="bg-[#252523] border border-white/10 rounded px-1.5 py-1 text-white font-mono"
          />
          <button
            onClick={addTrade}
            className="bg-blue-600 hover:bg-blue-500 text-white font-bold rounded px-2 py-1 transition-colors"
          >
            + Add
          </button>
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px] text-neutral-400">
          <span>Portfolio Base ($):</span>
          <input
            type="number"
            value={tInitial}
            onChange={(e) => {
              const val = parseFloat(e.target.value) || 30.0;
              setTInitial(val);
              if (onUpdatePortfolioBalance) onUpdatePortfolioBalance(val);
            }}
            className="w-16 bg-[#252523] border border-white/10 rounded px-1.5 py-0.5 text-white font-mono"
          />
          <span>Return % vs ${tInitial.toFixed(2)}:</span>
          <b className={`ml-auto font-bold ${returnPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(1)}%
          </b>
        </div>

        {/* Logged Trades List Table */}
        <div className="overflow-x-auto max-h-56">
          <table className="w-full text-xs text-left">
            <thead className="sticky top-0 bg-[#252523] text-[#898781] text-[10px] uppercase font-mono tracking-wider border-b border-white/10 z-10">
              <tr>
                <th className="py-1.5 px-2 text-left">#</th>
                <th className="py-1.5 px-2 text-left w-20 sm:w-24 max-w-[90px] whitespace-normal leading-tight">Date / Time (UTC)</th>
                <th className="py-1.5 px-2 text-left">Regime</th>
                <th className="py-1.5 px-2 text-left">Side</th>
                <th className="py-1.5 px-2 text-left">Type</th>
                <th className="py-1.5 px-2 text-right">Entry</th>
                <th className="py-1.5 px-2 text-right">Exit</th>
                <th className="py-1.5 px-2 text-right">Margin</th>
                <th className="py-1.5 px-2 text-right">Lev</th>
                <th className="py-1.5 px-2 text-right">PnL ($)</th>
                <th className="py-1.5 px-2 text-right">Return %</th>
                <th className="py-1.5 px-2 text-right">Fee</th>
                <th className="py-1.5 px-2 text-right">Balance</th>
                <th className="py-1.5 px-2 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono text-[11px]">
              {trades.length === 0 ? (
                <tr>
                  <td colSpan={14} className="text-center text-neutral-500 py-4 font-mono">
                    No trades logged today yet.
                  </td>
                </tr>
              ) : (
                trades.map((t, idx) => {
                  const isWin = (t.pnl || 0) > 0;
                  const isLoss = (t.pnl || 0) < 0;
                  const tradeNum = t.n || (idx + 1);
                  // P0 integrity: missing fields render empty/zero, never
                  // the old fabricated fallbacks (119.46 / 118.95 / 600.00).
                  const dt = t.dateTime || (t.timestampEntry ? t.timestampEntry.replace('T', ' ').slice(0, 19) + ' UTC' : '');
                  const entryVal = typeof t.entry === 'number' ? t.entry : 0;
                  const exitVal = typeof t.exit === 'number' ? t.exit : 0;
                  const marginVal = typeof t.margin === 'number' ? t.margin : (typeof t.size === 'number' ? t.size : 0);
                  const levVal = t.lev || 20;
                  const pnlVal = typeof t.pnl === 'number' ? t.pnl : 0;
                  const retPctVal = typeof t.returnPct === 'number' ? t.returnPct : 0;
                  const feeVal = typeof t.fee === 'number' ? t.fee : 0;
                  const balVal = typeof t.balance === 'number' ? t.balance : (portfolioBalance || 0);

                  return (
                    <tr key={t.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-1.5 px-2 text-neutral-400">{tradeNum}</td>
                      <td className="py-1.5 px-2 text-neutral-300 w-20 sm:w-24 max-w-[90px] whitespace-normal break-words text-[10px] leading-tight">{dt}</td>
                      <td className="py-1.5 px-2 text-neutral-200 font-sans text-[11px] whitespace-nowrap">{t.regime || 'Range Bound / Support'}</td>
                      <td className="py-1.5 px-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          t.side === 'Long' ? 'bg-emerald-500/20 text-emerald-300' : t.side === 'Short' ? 'bg-rose-500/20 text-rose-300' : 'bg-neutral-800 text-neutral-400'
                        }`}>
                          {t.side || '—'}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 font-sans">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          isLoss ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30' : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        }`}>
                          {t.type || (isLoss ? 'SL' : 'TP1')}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-right text-neutral-300">${entryVal.toFixed(2)}</td>
                      <td className="py-1.5 px-2 text-right text-neutral-300">${exitVal.toFixed(2)}</td>
                      <td className="py-1.5 px-2 text-right text-neutral-300">${marginVal.toFixed(2)}</td>
                      <td className="py-1.5 px-2 text-right text-neutral-400">{levVal}×</td>
                      <td className={`py-1.5 px-2 text-right font-bold ${isWin ? 'text-emerald-400' : isLoss ? 'text-rose-400' : 'text-neutral-300'}`}>
                        {isWin ? '+' : ''}${pnlVal.toFixed(2)}
                      </td>
                      <td className={`py-1.5 px-2 text-right ${isWin ? 'text-emerald-400' : isLoss ? 'text-rose-400' : 'text-neutral-300'}`}>
                        {retPctVal >= 0 ? '+' : ''}{retPctVal.toFixed(1)}%
                      </td>
                      <td className="py-1.5 px-2 text-right text-neutral-400">${feeVal.toFixed(2)}</td>
                      <td className="py-1.5 px-2 text-right text-white font-bold">${balVal.toFixed(2)}</td>
                      <td className="py-1.5 px-2 text-center">
                        <button
                          onClick={() => deleteTrade(t.id)}
                          className="p-1 text-neutral-500 hover:text-rose-400 transition-colors cursor-pointer"
                          title="Delete trade"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
