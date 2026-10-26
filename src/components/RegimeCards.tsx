import { BacktestResult } from '../types.ts';

interface RegimeCardsProps {
  results: BacktestResult[];
  combinedResult: BacktestResult;
  selectedRegime: string | null;
  onSelectRegime: (regimeKey: string) => void;
}

export function RegimeCards({
  results,
  combinedResult,
  selectedRegime,
  onSelectRegime,
}: RegimeCardsProps) {
  const getBorderColor = (cls: string) => {
    switch (cls) {
      case 'flash':
        return 'border-l-red-500';
      case 'chop':
        return 'border-l-amber-500';
      case 'range':
        return 'border-l-blue-500';
      case 'bull':
        return 'border-l-emerald-500';
      case 'combined':
        return 'border-l-purple-500';
      default:
        return 'border-l-neutral-500';
    }
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mb-6">
      {results.map((r) => {
        const isPos = r.netPnL >= 0;
        const isSelected = selectedRegime === r.regime;

        return (
          <div
            key={r.regime}
            onClick={() => onSelectRegime(r.regime)}
            className={`bg-[#1c1c1a] border border-white/10 rounded-lg p-4 border-l-4 ${getBorderColor(
              r.cardCls,
            )} cursor-pointer transition-all hover:border-white/20 hover:bg-[#20201e] shadow-sm flex flex-col justify-between ${
              isSelected ? 'ring-1 ring-blue-500/60 bg-blue-500/5' : ''
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#898781]">
                  {r.label}
                </span>
                <span className="text-[10px] font-mono text-neutral-400">
                  {r.trades.length} trades ({r.nBars > 0 ? (r.trades.length / (r.nBars / 96)).toFixed(1) : 0}/d)
                </span>
              </div>

              <div
                className={`text-2xl font-bold font-mono tracking-tight mb-2 ${
                  isPos ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {isPos ? '+' : ''}${r.netPnL.toFixed(2)}
              </div>

              <p className="text-xs text-neutral-400 mb-3 line-clamp-2 leading-relaxed">
                {r.desc}
              </p>
            </div>

            <div className="pt-2.5 border-t border-white/5 grid grid-cols-2 gap-y-1.5 gap-x-2 text-[11px] text-neutral-400 font-mono">
              <div>
                Signals:{' '}
                <b className="text-neutral-200">
                  {r.signals} ({r.nBars > 0 ? (r.signals / (r.nBars / 96)).toFixed(1) : 0}/d)
                </b>
              </div>
              <div>
                Win Rate:{' '}
                <b className="text-neutral-200">
                  {r.trades.length > 0 ? `${r.winRate.toFixed(1)}%` : '—'}
                </b>
              </div>
              <div>
                Final Bal:{' '}
                <b className="text-neutral-200">${r.finalBal.toFixed(2)}</b>
              </div>
              <div>
                Return:{' '}
                <b className={r.netRet >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {r.netRet >= 0 ? '+' : ''}
                  {r.netRet.toFixed(2)}%
                </b>
              </div>
              <div>
                Max DD:{' '}
                <b className="text-red-400">
                  {r.maxDD > 0 ? `${r.maxDD.toFixed(1)}%` : '—'}
                </b>
              </div>
              <div>
                Duration:{' '}
                <b className="text-neutral-300">
                  ≈ {(r.nBars / 96).toFixed(1)} days
                </b>
              </div>
            </div>
          </div>
        );
      })}

      {/* Combined Card spanning all columns */}
      <div
        onClick={() => onSelectRegime('COMBINED')}
        className={`col-span-1 sm:col-span-2 lg:col-span-4 bg-[#1c1c1a] border border-white/10 rounded-lg p-4 border-l-4 border-l-purple-500 cursor-pointer transition-all hover:border-white/20 hover:bg-[#20201e] shadow-sm ${
          selectedRegime === 'COMBINED' ? 'ring-1 ring-purple-500/60 bg-purple-500/5' : ''
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-purple-400">
                Combined — All Regimes Sequentially
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 font-mono">
                Continuous Compounding + LSD Emergency Floor
              </span>
            </div>
            <div
              className={`text-2xl sm:text-3xl font-bold font-mono tracking-tight ${
                combinedResult.netPnL >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {combinedResult.netPnL >= 0 ? '+' : ''}${combinedResult.netPnL.toFixed(2)}
              <span className="text-xs font-normal text-neutral-400 ml-2 font-mono">
                (${combinedResult.startBal.toFixed(2)} → ${combinedResult.finalBal.toFixed(2)})
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 text-xs font-mono bg-neutral-900/60 px-3.5 py-2.5 rounded-lg border border-white/5">
            <div>
              <span className="text-neutral-400 text-[10px] block">TOTAL SIGNALS</span>
              <b className="text-neutral-100 text-sm">
                {combinedResult.signals}
                <span className="text-[10px] text-blue-400 ml-1 font-normal">
                  ({combinedResult.nBars > 0 ? (combinedResult.signals / (combinedResult.nBars / 96)).toFixed(1) : 0}/d)
                </span>
              </b>
            </div>
            <div>
              <span className="text-neutral-400 text-[10px] block">TOTAL TRADES</span>
              <b className="text-neutral-100 text-sm">
                {combinedResult.trades.length}
                <span className="text-[10px] text-emerald-400 ml-1 font-normal">
                  ({combinedResult.nBars > 0 ? (combinedResult.trades.length / (combinedResult.nBars / 96)).toFixed(1) : 0}/d)
                </span>
              </b>
            </div>
            <div>
              <span className="text-neutral-400 text-[10px] block">WIN RATE</span>
              <b className="text-neutral-100 text-sm">
                {combinedResult.trades.length > 0
                  ? `${combinedResult.winRate.toFixed(1)}%`
                  : '—'}
              </b>
            </div>
            <div>
              <span className="text-neutral-400 text-[10px] block">TOTAL RETURN</span>
              <b
                className={`text-sm ${
                  combinedResult.netRet >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {combinedResult.netRet >= 0 ? '+' : ''}
                {combinedResult.netRet.toFixed(2)}%
              </b>
            </div>
            <div>
              <span className="text-neutral-400 text-[10px] block">DURATION</span>
              <b className="text-neutral-100 text-sm">
                ≈ {(combinedResult.nBars / 96).toFixed(1)}d
              </b>
            </div>
          </div>
        </div>

        <p className="text-xs text-neutral-400 leading-relaxed">
          Sequential simulation running through all four market regimes in sequence:{' '}
          <span className="text-red-400">Flash Crash</span> →{' '}
          <span className="text-amber-400">Market Chop</span> →{' '}
          <span className="text-blue-400">Range Bound Support</span> →{' '}
          <span className="text-emerald-400">Bull Trend Drift</span>. Wallet balance
          compounds continuously across regimes with instant 1-bar execution and $11
          margin LSD protection floor.
        </p>
      </div>
    </div>
  );
}
