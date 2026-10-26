import { AlertTriangle, CheckCircle2, Play, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { runMonteCarlo } from '../engine/backtest.ts';
import { MonteCarloSummary, SimulationConfig } from '../types.ts';

interface MonteCarloModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: SimulationConfig;
}

export function MonteCarloModal({
  isOpen,
  onClose,
  config,
}: MonteCarloModalProps) {
  const [iterations, setIterations] = useState(50);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<MonteCarloSummary | null>(null);

  if (!isOpen) return null;

  const handleStart = async () => {
    setIsRunning(true);
    setProgress(0);
    try {
      const res = await runMonteCarlo(config, iterations, (pct) =>
        setProgress(pct),
      );
      setSummary(res);
    } finally {
      setIsRunning(false);
    }
  };

  // Prepare chart format for multi-trajectory lines
  const chartData = summary?.curves
    ? [0, 1, 2, 3, 4].map((step) => {
        const row: Record<string, number | string> = {
          step:
            step === 0
              ? 'Start'
              : step === 1
                ? 'Flash'
                : step === 2
                  ? 'Chop'
                  : step === 3
                    ? 'Range'
                    : 'Bull',
        };
        summary.curves.forEach((c) => {
          row[`sim_${c.id}`] = c.data[step] ?? c.data[c.data.length - 1];
        });
        return row;
      })
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
      <div className="bg-[#1c1c1a] border border-white/20 rounded-xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm sm:text-base font-bold text-neutral-100 uppercase tracking-wide">
              Monte Carlo Regime Stress Test
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-neutral-400 mb-4 leading-relaxed">
          Executes randomized seed permutations across all four market regimes to stress
          test the dynamic compounding algorithm, verifying capital preservation and
          Jupiter Perps lockout risk under volatility shocks.
        </p>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 mb-5 p-3 rounded-lg bg-[#252523] border border-white/10">
          <div className="flex items-center gap-2 text-xs text-neutral-300">
            <span>Simulations:</span>
            <select
              value={iterations}
              onChange={(e) => setIterations(parseInt(e.target.value, 10))}
              disabled={isRunning}
              className="px-2 py-1 rounded bg-[#1c1c1a] text-neutral-100 border border-white/15 text-xs font-mono"
            >
              <option value={25}>25 Iterations (Fast)</option>
              <option value={50}>50 Iterations (Recommended)</option>
              <option value={100}>100 Iterations (Deep)</option>
            </select>
          </div>

          <button
            onClick={handleStart}
            disabled={isRunning}
            className="px-4 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 ml-auto"
          >
            {isRunning ? (
              <>
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Running ({progress}%)...</span>
              </>
            ) : (
              <>
                <Play className="w-3 h-3 fill-current" />
                <span>Execute Stress Test</span>
              </>
            )}
          </button>
        </div>

        {/* Results */}
        {summary && (
          <div className="space-y-4">
            {/* Stat Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
              <div className="bg-[#252523] p-2.5 rounded border border-white/5">
                <span className="text-[10px] text-neutral-400 block uppercase">
                  Median Final
                </span>
                <span className="text-sm font-bold text-neutral-100">
                  ${summary.medianFinalBal.toFixed(2)}
                </span>
              </div>

              <div className="bg-[#252523] p-2.5 rounded border border-white/5">
                <span className="text-[10px] text-neutral-400 block uppercase">
                  Profitable Sims
                </span>
                <span className="text-sm font-bold text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {summary.profitableSimsPct}%
                </span>
              </div>

              <div className="bg-[#252523] p-2.5 rounded border border-white/5">
                <span className="text-[10px] text-neutral-400 block uppercase">
                  Ruin / Lockout Rate
                </span>
                <span
                  className={`text-sm font-bold flex items-center gap-1 ${
                    summary.ruinPct === 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {summary.ruinPct}% ({summary.ruinCount}/{summary.simulations})
                </span>
              </div>

              <div className="bg-[#252523] p-2.5 rounded border border-white/5">
                <span className="text-[10px] text-neutral-400 block uppercase">
                  Worst Drawdown
                </span>
                <span className="text-sm font-bold text-red-400">
                  {summary.worstDrawdownPct}%
                </span>
              </div>
            </div>

            {/* Trajectory lines preview */}
            <div className="bg-[#171715] p-3 rounded-lg border border-white/5">
              <span className="text-[11px] font-mono text-neutral-400 block mb-2">
                Sample Equity Trajectories Across Seeds ($)
              </span>
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                    <XAxis dataKey="step" stroke="#898781" fontSize={10} />
                    <YAxis stroke="#898781" fontSize={10} tickFormatter={(v) => `$${v}`} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1c1c1a',
                        border: '1px solid #333',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                      }}
                    />
                    {summary.curves.map((c, idx) => (
                      <Line
                        key={c.id}
                        type="monotone"
                        dataKey={`sim_${c.id}`}
                        stroke={
                          idx % 3 === 0
                            ? '#3b82f6'
                            : idx % 3 === 1
                              ? '#22c55e'
                              : '#a855f7'
                        }
                        strokeWidth={1.5}
                        dot={false}
                        opacity={0.7}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
