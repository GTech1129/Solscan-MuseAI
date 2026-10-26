import { BacktestResult, Trade } from '../types.ts';

/**
 * Helper to escape CSV cell content safely for Excel
 */
function escapeCSV(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

/**
 * Formats trades into an Excel-ready CSV string with UTF-8 BOM
 */
export function generateTradesCSV(
  trades: Trade[],
  options?: {
    regimeName?: string;
    includeSummary?: boolean;
    startBalance?: number;
    finalBalance?: number;
  },
): string {
  const headers = [
    'Trade #',
    'Market Regime',
    'Exit Type',
    'Signal Bar',
    'Entry Bar',
    'Exit Bar',
    'Bars Held',
    'Entry Price ($)',
    'Exit Price ($)',
    'Price Change ($)',
    'Margin ($)',
    'Leverage',
    'Position Size ($)',
    'Tokens (SOL)',
    'Fee ($)',
    'Net PnL ($)',
    'Return on Margin (%)',
    'Ending Balance ($)',
    'TP1 Hit',
    'LSD Mode Active',
  ];

  const rows = trades.map((t) => {
    const priceChange = t.exit - t.entry;
    const isLSD = t.lev === 20;

    return [
      t.n,
      escapeCSV(t.regime),
      escapeCSV(t.type),
      t.signalBar,
      t.entryBar,
      t.exitBar,
      t.barsHeld,
      t.entry.toFixed(4),
      t.exit.toFixed(4),
      priceChange.toFixed(4),
      t.margin.toFixed(2),
      `${t.lev}x`,
      t.posSize.toFixed(2),
      t.tokens.toFixed(4),
      t.fee.toFixed(4),
      t.pnl.toFixed(2),
      `${t.pnlPct.toFixed(2)}%`,
      t.balance.toFixed(2),
      t.tp1Hit ? 'YES' : 'NO',
      isLSD ? 'ACTIVE (20x)' : 'STANDARD (60x)',
    ].join(',');
  });

  // UTF-8 BOM so Excel opens it with correct encoding and delimiters
  let csvContent = '\uFEFF';

  if (options?.includeSummary) {
    csvContent += `Title,SOL Reversal Adaptive Sniper v10 — DB-Aligned Backtest Trade Ledger\n`;
    if (options.regimeName) {
      csvContent += `Regime,${escapeCSV(options.regimeName)}\n`;
    }
    if (options.startBalance !== undefined && options.finalBalance !== undefined) {
      csvContent += `Starting Balance,$${options.startBalance.toFixed(2)}\n`;
      csvContent += `Final Balance,$${options.finalBalance.toFixed(2)}\n`;
      csvContent += `Net Profit,$${(options.finalBalance - options.startBalance).toFixed(2)}\n`;
    }
    csvContent += `Total Trades,${trades.length}\n`;
    csvContent += `Exported At,${new Date().toISOString()}\n\n`;
  }

  csvContent += [headers.join(','), ...rows].join('\n');
  return csvContent;
}

/**
 * Triggers browser download of a CSV file
 */
export function downloadCSV(csvContent: string, filename: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export specific regime or combined result
 */
export function exportResultToCSV(result: BacktestResult) {
  const csv = generateTradesCSV(result.trades, {
    regimeName: result.label,
    includeSummary: true,
    startBalance: result.startBal,
    finalBalance: result.finalBal,
  });
  const sanitizedName = result.regime.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const timestamp = new Date().toISOString().slice(0, 10);
  downloadCSV(csv, `sol_sniper_${sanitizedName}_trades_${timestamp}.csv`);
}

/**
 * Export all trades from all regimes into a single Excel-ready CSV
 */
export function exportAllResultsToCSV(
  isolatedResults: BacktestResult[],
  combinedResult: BacktestResult,
) {
  // Collect all trades across isolated regimes
  const allTrades: Trade[] = [];
  let counter = 1;

  // Add combined trades with sequential regime tags
  combinedResult.trades.forEach((t) => {
    allTrades.push({
      ...t,
      n: counter++,
    });
  });

  const csv = generateTradesCSV(allTrades, {
    regimeName: 'All Regimes (Combined Run)',
    includeSummary: true,
    startBalance: combinedResult.startBal,
    finalBalance: combinedResult.finalBal,
  });

  const timestamp = new Date().toISOString().slice(0, 10);
  downloadCSV(csv, `sol_sniper_all_trades_combined_${timestamp}.csv`);
}
