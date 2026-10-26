import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BacktestResult } from '../types.ts';

interface EquityChartProps {
  currentResult: BacktestResult;
  allResults: BacktestResult[];
  selectedRegime: string;
  onSelectRegime: (regimeKey: string) => void;
  lsdThreshold: number;
}

export function EquityChart({
  currentResult,
  allResults,
  selectedRegime,
  onSelectRegime,
  lsdThreshold,
}: EquityChartProps) {
  const data = currentResult.equityCurve;
  const startBal = currentResult.startBal;
  const minBal = Math.min(...data.map((d) => d.balance), startBal, 10);
  const maxBal = Math.max(...data.map((d) => d.balance), startBal * 1.1);

  return (
    <div className="bg-[#1c1c1a] border border-white/15 rounded-lg p-4 sm:p-5 mb-6 shadow-sm">
      {/* Top Header & Regime Selector Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 pb-3 border-b border-white/10">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-200">
              Account Equity &amp; Capital Trajectory
            </h3>
            <span className="text-[11px] font-mono text-neutral-400">
              ({currentResult.label})
            </span>
          </div>
          <p className="text-[11px] text-neutral-400 mt-0.5">
            Real-time tracking of wallet balance across trade fills with LSD
            Emergency Floor ($22.00)
          </p>
        </div>

        {/* Regime Tabs */}
        <div className="flex items-center gap-1 bg-[#252523] p-1 rounded-lg border border-white/10 overflow-x-auto">
          {allResults.map((r) => (
            <button
              key={r.regime}
              onClick={() => onSelectRegime(r.regime)}
              className={`text-[11px] px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition-all ${
                selectedRegime === r.regime
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
              }`}
            >
              {r.regime === 'COMBINED' ? 'Combined' : r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-4 font-mono text-xs">
        <div className="bg-[#222220] p-2.5 rounded border border-white/5">
          <span className="text-[10px] text-neutral-400 block uppercase">Start Balance</span>
          <span className="text-neutral-200 font-bold">${currentResult.startBal.toFixed(2)}</span>
        </div>
        <div className="bg-[#222220] p-2.5 rounded border border-white/5">
          <span className="text-[10px] text-neutral-400 block uppercase">Current Balance</span>
          <span className="text-neutral-100 font-bold text-sm">${currentResult.finalBal.toFixed(2)}</span>
        </div>
        <div className="bg-[#222220] p-2.5 rounded border border-white/5">
          <span className="text-[10px] text-neutral-400 block uppercase">Net Profit</span>
          <span
            className={`font-bold ${
              currentResult.netPnL >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {currentResult.netPnL >= 0 ? '+' : ''}${currentResult.netPnL.toFixed(2)} ({currentResult.netRet.toFixed(1)}%)
          </span>
        </div>
        <div className="bg-[#222220] p-2.5 rounded border border-white/5">
          <span className="text-[10px] text-neutral-400 block uppercase">Max Drawdown</span>
          <span className="text-red-400 font-bold">{currentResult.maxDD.toFixed(1)}%</span>
        </div>
        <div className="bg-[#222220] p-2.5 rounded border border-white/5">
          <span className="text-[10px] text-neutral-400 block uppercase">Profit Factor</span>
          <span className="text-neutral-200 font-bold">
            {currentResult.profitFactor > 0 ? currentResult.profitFactor.toFixed(2) : '—'}
          </span>
        </div>
        <div className="bg-[#222220] p-2.5 rounded border border-white/5">
          <span className="text-[10px] text-neutral-400 block uppercase">Est. Fees Drag</span>
          <span className="text-amber-400 font-bold">${currentResult.totalFees.toFixed(2)}</span>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="h-64 sm:h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
            <XAxis
              dataKey="tradeNum"
              tickLine={false}
              axisLine={{ stroke: '#ffffff15' }}
              stroke="#898781"
              fontSize={10}
              tickFormatter={(val) => (val === 0 ? 'Init' : `#${val}`)}
            />
            <YAxis
              domain={[Math.floor(minBal * 0.95), Math.ceil(maxBal * 1.05)]}
              tickLine={false}
              axisLine={{ stroke: '#ffffff15' }}
              stroke="#898781"
              fontSize={10}
              tickFormatter={(val) => `$${val}`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const pt = payload[0].payload;
                  return (
                    <div className="bg-[#1c1c1a] border border-white/20 rounded p-2.5 text-xs font-mono shadow-xl">
                      <div className="text-[10px] text-neutral-400 mb-1">
                        Trade #{pt.tradeNum} · {pt.regime}
                      </div>
                      <div className="text-sm font-bold text-neutral-100">
                        Balance: ${pt.balance?.toFixed(2)}
                      </div>
                      <div
                        className={`text-xs ${
                          pt.netPnL >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        Net PnL: {pt.netPnL >= 0 ? '+' : ''}${pt.netPnL?.toFixed(2)}
                      </div>
                      <div className="text-xs text-red-400">
                        Drawdown: {pt.drawdownPct?.toFixed(1)}%
                      </div>
                      {pt.balance < lsdThreshold && (
                        <div className="mt-1 text-[10px] text-purple-400 font-semibold">
                          ⚠ LSD Sizing Active ($11 @ 20x)
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              }}
            />
            <ReferenceLine
              y={startBal}
              stroke="#898781"
              strokeDasharray="4 4"
              label={{
                value: `Init ($${startBal})`,
                fill: '#898781',
                fontSize: 9,
                position: 'insideRight',
              }}
            />
            <ReferenceLine
              y={lsdThreshold}
              stroke="#a855f7"
              strokeDasharray="3 3"
              label={{
                value: `LSD Floor ($${lsdThreshold})`,
                fill: '#a855f7',
                fontSize: 9,
                position: 'insideLeft',
              }}
            />
            <Area
              type="monotone"
              dataKey="balance"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#balanceGradient)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
