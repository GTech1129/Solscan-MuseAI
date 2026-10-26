import { Download, FileSpreadsheet } from 'lucide-react';
import type { MouseEvent } from 'react';
import { BacktestResult } from '../types.ts';
import { exportAllResultsToCSV, exportResultToCSV } from '../utils/exportCsv.ts';

interface OverviewTableProps {
  results: BacktestResult[];
  combinedResult: BacktestResult;
  selectedRegime: string | null;
  onSelectRegime: (regimeKey: string) => void;
}

export function OverviewTable({
  results,
  combinedResult,
  selectedRegime,
  onSelectRegime,
}: OverviewTableProps) {
  const allRows = [...results, combinedResult];

  const handleExportAll = (e: MouseEvent) => {
    e.stopPropagation();
    exportAllResultsToCSV(results, combinedResult);
  };

  const handleExportRow = (e: MouseEvent, r: BacktestResult) => {
    e.stopPropagation();
    exportResultToCSV(r);
  };

  return (
    <div className="bg-[#1c1c1a] border border-white/15 rounded-lg overflow-hidden mb-6 shadow-sm">
      <div className="px-4 py-3 border-b border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
            Regime Performance Comparison Overview
          </h2>
          <span className="text-[11px] text-neutral-400 font-mono">
            4 Regimes Isolated + 1 Sequential Combined
          </span>
        </div>

        <button
          id="btn-overview-export-all-csv"
          onClick={handleExportAll}
          className="text-xs px-2.5 py-1.5 rounded bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5 transition-colors self-start sm:self-auto shadow-sm"
          title="Download all regimes trade ledgers formatted for Excel"
        >
          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
          <span>Export All Ledgers (CSV)</span>
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="bg-[#252523] text-[#898781] text-[10px] uppercase font-medium tracking-wider border-b border-white/10">
              <th className="py-2.5 px-3 text-left">Regime</th>
              <th className="py-2.5 px-3 text-right">Candles (Time)</th>
              <th className="py-2.5 px-3 text-right">Signals (/Day)</th>
              <th className="py-2.5 px-3 text-right">Trades (/Day)</th>
              <th className="py-2.5 px-3 text-right">Win Rate</th>
              <th className="py-2.5 px-3 text-right">Gross PnL</th>
              <th className="py-2.5 px-3 text-right">Net PnL</th>
              <th className="py-2.5 px-3 text-right">Final Bal</th>
              <th className="py-2.5 px-3 text-right">Return %</th>
              <th className="py-2.5 px-3 text-right">Max DD</th>
              <th className="py-2.5 px-3 text-right">Profit Factor</th>
              <th className="py-2.5 px-3 text-center">CSV</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 font-mono">
            {allRows.map((r) => {
              const isCombined = r.regime === 'COMBINED';
              const isSelected = selectedRegime === r.regime;
              const pnlPos = r.netPnL >= 0;

              return (
                <tr
                  key={r.regime}
                  onClick={() => onSelectRegime(r.regime)}
                  className={`cursor-pointer transition-colors ${
                    isCombined
                      ? 'bg-[#222220] font-semibold hover:bg-[#282825]'
                      : 'hover:bg-white/[0.03]'
                  } ${isSelected ? 'ring-1 ring-inset ring-blue-500/50 bg-blue-500/5' : ''}`}
                >
                  <td className="py-2.5 px-3 font-sans">
                    <span
                      className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        r.badge === 'badge-flash'
                          ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                          : r.badge === 'badge-chop'
                            ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                            : r.badge === 'badge-range'
                              ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20'
                              : r.badge === 'badge-bull'
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                                : 'bg-purple-500/15 text-purple-400 border border-purple-500/20'
                      }`}
                    >
                      {r.label}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right text-neutral-300">
                    <div>{r.nBars.toLocaleString()}</div>
                    <div className="text-[10px] text-neutral-500 font-sans">
                      ≈ {(r.nBars / 96).toFixed(1)}d
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right text-neutral-300">
                    <div>{r.signals}</div>
                    <div className="text-[10px] text-blue-400 font-sans font-medium">
                      {r.nBars > 0 ? `${(r.signals / (r.nBars / 96)).toFixed(1)}/d` : '—'}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right text-neutral-200 font-bold">
                    <div>{r.trades.length}</div>
                    <div className="text-[10px] text-emerald-400 font-sans font-normal">
                      {r.nBars > 0 ? `${(r.trades.length / (r.nBars / 96)).toFixed(1)}/d` : '—'}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right text-neutral-200">
                    {r.trades.length > 0 ? `${r.winRate.toFixed(1)}%` : '—'}
                  </td>
                  <td
                    className={`py-2.5 px-3 text-right ${
                      r.grossPnL >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {r.grossPnL >= 0 ? '+' : ''}${r.grossPnL.toFixed(2)}
                  </td>
                  <td
                    className={`py-2.5 px-3 text-right font-bold ${
                      pnlPos ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {pnlPos ? '+' : ''}${r.netPnL.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-neutral-100 font-bold">
                    ${r.finalBal.toFixed(2)}
                  </td>
                  <td
                    className={`py-2.5 px-3 text-right font-semibold ${
                      r.netRet >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {r.netRet >= 0 ? '+' : ''}
                    {r.netRet.toFixed(2)}%
                  </td>
                  <td className="py-2.5 px-3 text-right text-red-400">
                    {r.maxDD > 0 ? `${r.maxDD.toFixed(1)}%` : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right text-neutral-300">
                    {r.profitFactor > 0 ? r.profitFactor.toFixed(2) : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <button
                      onClick={(e) => handleExportRow(e, r)}
                      disabled={r.trades.length === 0}
                      title={`Export ${r.label} trades to CSV`}
                      className="p-1 rounded hover:bg-white/10 text-neutral-400 hover:text-emerald-400 transition-colors disabled:opacity-20"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
