import { Eye, Info } from 'lucide-react';
import { useState } from 'react';
import { BacktestResult, Candle } from '../types.ts';

interface CandleVisualizerProps {
  currentResult: BacktestResult;
}

export function CandleVisualizer({ currentResult }: CandleVisualizerProps) {
  const candles = currentResult.candles || [];
  const trades = currentResult.trades;
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);

  if (candles.length === 0) {
    return null;
  }

  // Slice display window (e.g. 70 bars for clear visual clarity)
  const displayBars = candles.slice(20, 95);
  const minPrice = Math.min(...displayBars.map((c) => c.low));
  const maxPrice = Math.max(...displayBars.map((c) => c.high));
  const priceRange = maxPrice - minPrice || 1;

  const chartHeight = 180;
  const chartWidth = 720;
  const barWidth = Math.max(3, chartWidth / displayBars.length - 2);

  const getY = (val: number) => {
    return chartHeight - ((val - minPrice) / priceRange) * (chartHeight - 20) - 10;
  };

  return (
    <div className="bg-[#1c1c1a] border border-white/15 rounded-lg p-4 sm:p-5 mb-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 pb-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-blue-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-200">
            Solana Merton Jump-Diffusion Price Series Visualizer
          </h3>
          <span className="text-[11px] font-mono text-neutral-400">
            ({currentResult.label} · Bars #20–#95)
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-neutral-400 font-mono">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
            Bull Bar
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" />
            Bear Bar
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
            Poisson Jump
          </span>
        </div>
      </div>

      {/* Hover info bar */}
      <div className="h-6 mb-2 flex items-center gap-4 text-[11px] font-mono text-neutral-300">
        {hoveredCandle ? (
          <>
            <span className="text-neutral-400">Bar #{hoveredCandle.index}</span>
            <span>O: ${hoveredCandle.open.toFixed(2)}</span>
            <span>H: ${hoveredCandle.high.toFixed(2)}</span>
            <span>L: ${hoveredCandle.low.toFixed(2)}</span>
            <span>C: ${hoveredCandle.close.toFixed(2)}</span>
            <span>Vol: {hoveredCandle.volume.toLocaleString()}</span>
            {hoveredCandle.isJump && (
              <span className="text-amber-400 font-bold bg-amber-400/10 px-1.5 py-0.5 rounded">
                ⚡ Flash Wick Spike
              </span>
            )}
            {hoveredCandle.cci != null && (
              <span className="text-blue-400">CCI: {hoveredCandle.cci.toFixed(1)}</span>
            )}
          </>
        ) : (
          <span className="text-neutral-500 flex items-center gap-1 text-[11px]">
            <Info className="w-3 h-3" />
            Hover over candles to inspect Jump-Diffusion OHLCV and indicator values
          </span>
        )}
      </div>

      {/* SVG Canvas */}
      <div className="w-full overflow-x-auto bg-[#141413] rounded border border-white/5 p-2">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full h-48 block select-none"
        >
          {/* Price grid lines */}
          {[0.25, 0.5, 0.75].map((pct) => {
            const y = chartHeight * pct;
            const price = maxPrice - pct * priceRange;
            return (
              <g key={pct}>
                <line
                  x1="0"
                  y1={y}
                  x2={chartWidth}
                  y2={y}
                  stroke="#ffffff10"
                  strokeDasharray="2 2"
                />
                <text
                  x={chartWidth - 5}
                  y={y - 3}
                  textAnchor="end"
                  fill="#898781"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  ${price.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* Render Candlesticks */}
          {displayBars.map((candle, idx) => {
            const x = (idx / displayBars.length) * (chartWidth - 40) + 15;
            const isBull = candle.close >= candle.open;
            const color = isBull ? '#22c55e' : '#ef4444';

            const yHigh = getY(candle.high);
            const yLow = getY(candle.low);
            const yOpen = getY(candle.open);
            const yClose = getY(candle.close);

            const bodyTop = Math.min(yOpen, yClose);
            const bodyHeight = Math.max(Math.abs(yClose - yOpen), 1.5);

            // Check if any trade was entered or exited on this candle
            const tradeEntry = trades.find((t) => t.entryBar === candle.index);
            const tradeExit = trades.find((t) => t.exitBar === candle.index);

            return (
              <g
                key={candle.index}
                onMouseEnter={() => setHoveredCandle(candle)}
                onMouseLeave={() => setHoveredCandle(null)}
                className="cursor-pointer"
              >
                {/* Wick */}
                <line
                  x1={x}
                  y1={yHigh}
                  x2={x}
                  y2={yLow}
                  stroke={color}
                  strokeWidth={1}
                  opacity={0.85}
                />

                {/* Candle Body */}
                <rect
                  x={x - barWidth / 2}
                  y={bodyTop}
                  width={barWidth}
                  height={bodyHeight}
                  fill={color}
                  opacity={0.9}
                  rx={0.5}
                />

                {/* Jump Process Marker */}
                {candle.isJump && (
                  <circle
                    cx={x}
                    cy={isBull ? yHigh - 5 : yLow + 5}
                    r={2.5}
                    fill="#f59e0b"
                  />
                )}

                {/* Trade Entry marker (Green Triangle) */}
                {tradeEntry && (
                  <polygon
                    points={`${x},${yLow + 12} ${x - 4},${yLow + 18} ${x + 4},${yLow + 18}`}
                    fill="#3b82f6"
                  />
                )}

                {/* Trade Exit marker */}
                {tradeExit && (
                  <circle
                    cx={x}
                    cy={tradeExit.pnl >= 0 ? yHigh - 10 : yLow + 12}
                    r={3.5}
                    fill={tradeExit.pnl >= 0 ? '#22c55e' : '#ef4444'}
                    stroke="#ffffff"
                    strokeWidth={1}
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
