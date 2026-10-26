import { Info } from 'lucide-react';

export function NoteBanner() {
  return (
    <div className="bg-[#1c1c1a] border border-white/10 rounded-lg p-3.5 mb-5 text-xs text-[#c3c2b7] leading-relaxed shadow-sm">
      <div className="flex items-start gap-2.5">
        <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <div className="space-y-1.5 flex-1">
          <div>
            <span className="inline-block px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 font-semibold text-[10px] tracking-wide mr-1.5 border border-blue-500/20">
              SIMULATION MODEL
            </span>
            <strong className="text-neutral-200">Solana Price Generator:</strong>{' '}
            Merton Jump-Diffusion with Poisson flash wicks (-2% to -6%), GARCH-lite
            volatility clustering, and momentum autocorrelation.
          </div>
          <div>
            <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-semibold text-[10px] tracking-wide mr-1.5 border border-emerald-500/20">
              DB ALIGNMENT
            </span>
            <strong className="text-neutral-200">Signal &amp; Execution:</strong>{' '}
            Instant 1-bar execution edge (bypasses 2-bar lag), fee-neutralized TP1
            (35¢) + regime-adaptive TP2 ($0.75/$1.10), 5m Fisher runner exit, and
            symmetrical sit-outs in 100% Cash during FLASH_CRASH and MARKET_CHOP.
          </div>
          <div>
            <span className="inline-block px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 font-semibold text-[10px] tracking-wide mr-1.5 border border-purple-500/20">
              SAFETY &amp; SIZING
            </span>
            <strong className="text-neutral-200">
              Compounding &amp; Emergency Brake:
            </strong>{' '}
            Dynamic compounding (10%, 25%, 50%) when balance ≥ $22.00. Automatic
            Leverage Scale-Down (LSD/DEB) locks margin to $11.00 @ 20x when balance &lt;
            $22.00 to guarantee capital preservation above lockout.
          </div>
        </div>
      </div>
    </div>
  );
}
