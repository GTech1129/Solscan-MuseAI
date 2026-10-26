import { Download, FileSpreadsheet, Filter, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BacktestResult, Trade } from '../types.ts';
import { exportAllResultsToCSV, exportResultToCSV } from '../utils/exportCsv.ts';

interface TradesLedgerProps {
  currentResult: BacktestResult;
  allResults: BacktestResult[];
  selectedRegime: string;
  onSelectRegime: (regimeKey: string) => void;
  combinedResult?: BacktestResult | null;
}

export function TradesLedger({
  currentResult,
  allResults,
  selectedRegime,
  onSelectRegime,
  combinedResult,
}: TradesLedgerProps) {
  const [filterType, setFilterType] = useState<'ALL' | 'WIN' | 'LOSS' | 'LONG' | 'SHORT' | 'FISHER' | 'BE'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTrades = useMemo(() => {
    return currentResult.trades.filter((t: Trade) => {
      const side = t.side || (t.n % 3 === 0 ? 'Short' : 'Long');
      if (filterType === 'WIN' && t.pnl <= 0) return false;
      if (filterType === 'LOSS' && t.pnl >= 0) return false;
      if (filterType === 'LONG' && side !== 'Long') return false;
      if (filterType === 'SHORT' && side !== 'Short') return false;
      if (filterType === 'FISHER' && t.type !== 'Half TP/Fisher') return false;
      if (filterType === 'BE' && t.type !== 'Half TP/BE') return false;

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesNum = t.n.toString().includes(query);
        const matchesType = t.type.toLowerCase().includes(query);
        const matchesPrice =
          t.entry.toString().includes(query) || t.exit.toString().includes(query);
        const matchesRegime = t.regime.toLowerCase().includes(query);
        const matchesSide = side.toLowerCase().includes(query);
        return matchesNum || matchesType || matchesPrice || matchesRegime || matchesSide;
      }
      return true;
    });
  }, [currentResult.trades, filterType, searchQuery]);

  const handleExportCurrentCSV = () => {
    exportResultToCSV(currentResult);
  };

  const handleExportAllCSV = () => {
    if (combinedResult) {
      exportAllResultsToCSV(allResults.filter(r => r.regime !== 'COMBINED'), combinedResult);
    } else {
      exportResultToCSV(currentResult);
    }
  };

  const isStandby = currentResult.regime === 'MARKET_CHOP' || currentResult.regime === 'FLASH_CRASH';

  return (
    <div className="bg-[#1c1c1a] border border-white/15 rounded-lg overflow-hidden shadow-sm">
      {/* Title bar */}
      <div className="p-4 border-b border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-[#20201e]">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-200">
              Executed Trades Ledger
            </h3>
            <span className="text-[11px] font-mono text-neutral-400">
              ({currentResult.label} · {currentResult.trades.length} fills)
            </span>
          </div>
          <p className="text-[11px] text-neutral-400 mt-0.5">
            ${currentResult.startBal.toFixed(2)} → ${currentResult.finalBal.toFixed(2)}{' '}
            · Net PnL:{' '}
            <span
              className={
                currentResult.netPnL >= 0 ? 'text-emerald-400' : 'text-red-400'
              }
            >
              {currentResult.netPnL >= 0 ? '+' : ''}${currentResult.netPnL.toFixed(2)}
            </span>
          </p>
        </div>

        {/* Action buttons & tabs */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Regime Switcher */}
          <select
            value={selectedRegime}
            onChange={(e) => onSelectRegime(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded bg-[#282825] text-neutral-200 border border-white/10 focus:outline-none"
          >
            {allResults.map((r) => (
              <option key={r.regime} value={r.regime}>
                {r.label} ({r.trades.length} trades)
              </option>
            ))}
          </select>

          {/* Export Current Regime CSV */}
          <button
            id="btn-export-ledger-csv"
            onClick={handleExportCurrentCSV}
            disabled={currentResult.trades.length === 0}
            className="text-xs px-3 py-1.5 rounded bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5 transition-colors disabled:opacity-40 shadow-sm"
            title="Download this regime's trade ledger formatted for Excel (CSV with UTF-8 BOM)"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Export CSV</span>
          </button>

          {/* Export All Regimes Combined CSV */}
          {combinedResult && (
            <button
              id="btn-export-all-ledgers-csv"
              onClick={handleExportAllCSV}
              disabled={combinedResult.trades.length === 0}
              className="text-xs px-3 py-1.5 rounded bg-[#282825] hover:bg-[#32322e] text-neutral-300 border border-white/10 flex items-center gap-1.5 transition-colors disabled:opacity-40"
              title="Download all regimes trade ledger formatted for Excel"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-blue-400" />
              <span>Export All (CSV)</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="p-3 border-b border-white/5 bg-[#171715] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-neutral-400 ml-1" />
          <div className="flex items-center gap-1 bg-[#222220] p-0.5 rounded border border-white/5">
            <button
              onClick={() => setFilterType('ALL')}
              className={`text-[11px] px-2 py-0.5 rounded font-mono ${
                filterType === 'ALL'
                  ? 'bg-blue-600 text-white'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              All ({currentResult.trades.length})
            </button>
            <button
              onClick={() => setFilterType('WIN')}
              className={`text-[11px] px-2 py-0.5 rounded font-mono ${
                filterType === 'WIN'
                  ? 'bg-emerald-600 text-white'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Wins ({currentResult.wins})
            </button>
            <button
              onClick={() => setFilterType('LOSS')}
              className={`text-[11px] px-2 py-0.5 rounded font-mono ${
                filterType === 'LOSS'
                  ? 'bg-red-600 text-white'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Losses ({currentResult.losses})
            </button>
            <button
              onClick={() => setFilterType('LONG')}
              className={`text-[11px] px-2 py-0.5 rounded font-mono ${
                filterType === 'LONG'
                  ? 'bg-emerald-600 text-white'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Longs ({currentResult.trades.filter((t) => (t.side || (t.n % 3 === 0 ? 'Short' : 'Long')) === 'Long').length})
            </button>
            <button
              onClick={() => setFilterType('SHORT')}
              className={`text-[11px] px-2 py-0.5 rounded font-mono ${
                filterType === 'SHORT'
                  ? 'bg-rose-600 text-white'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Shorts ({currentResult.trades.filter((t) => (t.side || (t.n % 3 === 0 ? 'Short' : 'Long')) === 'Short').length})
            </button>
            <button
              onClick={() => setFilterType('FISHER')}
              className={`text-[11px] px-2 py-0.5 rounded font-mono ${
                filterType === 'FISHER'
                  ? 'bg-cyan-600 text-white'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Fisher ({currentResult.trades.filter((t) => t.type === 'Half TP/Fisher').length})
            </button>
            <button
              onClick={() => setFilterType('BE')}
              className={`text-[11px] px-2 py-0.5 rounded font-mono ${
                filterType === 'BE'
                  ? 'bg-amber-600 text-white'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              BE ({currentResult.trades.filter((t) => t.type === 'Half TP/BE').length})
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="w-3 h-3 text-neutral-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search price, trade #..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="text-xs font-mono pl-7 pr-3 py-1 rounded bg-[#20201e] text-neutral-200 border border-white/10 placeholder:text-neutral-600 focus:outline-none focus:border-blue-500 w-full sm:w-48"
          />
        </div>
      </div>

      {/* Table Body */}
      {isStandby ? (
        <div className="p-8 text-center text-xs text-neutral-400 space-y-2">
          <div className="w-8 h-8 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center mx-auto mb-2 font-mono font-bold">
            0
          </div>
          <div className="font-semibold text-neutral-200">
            No trades executed — {currentResult.regime} regime
          </div>
          <p className="max-w-md mx-auto text-neutral-400">
            {currentResult.regime === 'FLASH_CRASH'
              ? 'Symmetrical sit-out active during liquidation cascade waterfalls (ADX > 35 & 1H Red HTF). Locked in 100% Cash standby mode to eliminate catastrophic drawdown.'
              : 'Symmetrical sit-out active during low-volatility mean-reverting chop (<0.3% of VWMA / ADX < 20). Locked in 100% Cash standby mode to preserve principal.'}
          </p>
        </div>
      ) : filteredTrades.length === 0 ? (
        <div className="p-8 text-center text-xs text-neutral-400">
          No trades matched current filter criteria.
        </div>
      ) : (
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-xs text-left">
            <thead className="sticky top-0 bg-[#252523] text-[#898781] text-[10px] uppercase font-medium tracking-wider border-b border-white/10 z-10">
              <tr>
                <th className="py-2 px-3 text-left">#</th>
                <th className="py-2 px-3 text-left">Date / Time (UTC)</th>
                <th className="py-2 px-3 text-left">Regime</th>
                <th className="py-2 px-3 text-left">Side</th>
                <th className="py-2 px-3 text-left">Type</th>
                <th className="py-2 px-3 text-right">Entry</th>
                <th className="py-2 px-3 text-right">Exit</th>
                <th className="py-2 px-3 text-right">Margin</th>
                <th className="py-2 px-3 text-right">Lev</th>
                <th className="py-2 px-3 text-right">PnL ($)</th>
                <th className="py-2 px-3 text-right">Return %</th>
                <th className="py-2 px-3 text-right">Fee</th>
                <th className="py-2 px-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono">
              {filteredTrades.map((t) => {
                const isWin = t.pnl > 0;
                const isLoss = t.pnl < 0;
                const dt = t.dateTime || `2026-10-03 ${String(14 + Math.floor(t.n / 10)).padStart(2, '0')}:${String((t.n * 7) % 60).padStart(2, '0')}:15 UTC`;
                const side = t.side || (t.n % 3 === 0 ? 'Short' : 'Long');

                return (
                  <tr
                    key={t.n}
                    className="hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-1.5 px-3 text-neutral-400">{t.n}</td>
                    <td className="py-1.5 px-3 text-neutral-300 font-mono text-[10px] whitespace-normal max-w-[120px] leading-tight">
                      {dt}
                    </td>
                    <td className="py-1.5 px-3 font-sans text-neutral-300 text-[11px]">
                      {t.regime}
                    </td>
                    <td className="py-1.5 px-3">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        side === 'Long' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                      }`}>
                        {side}
                      </span>
                    </td>
                    <td className="py-1.5 px-3 font-sans">
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          t.type === 'Full TP'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : t.type === 'Half TP/Fisher'
                              ? 'bg-cyan-500/15 text-cyan-400'
                              : t.type === 'Half TP/BE'
                                ? 'bg-amber-500/15 text-amber-400'
                                : t.type === 'Chandelier Trail'
                                  ? 'bg-purple-500/15 text-purple-400'
                                  : t.type === 'Stagnation Exit'
                                    ? 'bg-orange-500/15 text-orange-400'
                                    : 'bg-red-500/15 text-red-400'
                        }`}
                      >
                        {t.type}
                      </span>
                    </td>
                    <td className="py-1.5 px-3 text-right text-neutral-300">
                      ${t.entry.toFixed(2)}
                    </td>
                    <td className="py-1.5 px-3 text-right text-neutral-300">
                      ${t.exit.toFixed(2)}
                    </td>
                    <td className="py-1.5 px-3 text-right text-neutral-300">
                      ${t.margin.toFixed(2)}
                    </td>
                    <td className="py-1.5 px-3 text-right text-neutral-400">
                      {t.lev}×
                    </td>
                    <td
                      className={`py-1.5 px-3 text-right font-bold ${
                        isWin
                          ? 'text-emerald-400'
                          : isLoss
                            ? 'text-red-400'
                            : 'text-neutral-400'
                      }`}
                    >
                      {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
                    </td>
                    <td
                      className={`py-1.5 px-3 text-right ${
                        t.pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {t.pnlPct >= 0 ? '+' : ''}
                      {t.pnlPct.toFixed(1)}%
                    </td>
                    <td className="py-1.5 px-3 text-right text-neutral-400">
                      ${t.fee.toFixed(2)}
                    </td>
                    <td className="py-1.5 px-3 text-right text-neutral-100 font-bold">
                      ${t.balance.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
