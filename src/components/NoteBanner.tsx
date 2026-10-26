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
            Merton Jump-Diffusion with Poisson flash wicks (-1.5% to -5%), GARCH-lite
            volatility clustering, and momentum autocorrelation.
          </div>
          <div>
            <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-semibold text-[10px] tracking-wide mr-1.5 border border-emerald-500/20">
              DB ALIGNMENT
            </span>
            <strong className="text-neutral-200">Signal &amp; Execution:</strong>{' '}
            Canonical trigger (hooks + 2-bar 5m confirmation), fee-neutralized TP1
            (35¢; 20¢ in chop) + regime-adaptive TP2 ($0.55/$0.70/$0.85), 5m Fisher
            runner exit, chop traded at reduced size, and flash-crash sit-out in
            100% Cash (no new positions either direction).
          </div>
          <div>
            <span className="inline-block px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 font-semibold text-[10px] tracking-wide mr-1.5 border border-purple-500/20">
              SAFETY &amp; SIZING
            </span>
            <strong className="text-neutral-200">
              Compounding &amp; Emergency Brake:
            </strong>{' '}
            Tier sizing by balance (T1 $25 @ 20x, T2 $50 @ 35x, T3 $100 @ 50x;
            +10x server boost, max 60x), risk caps 3%/5%/10%, $10 lockout floor,
            and a 2-loss circuit breaker (5-bar standby).
          </div>
        </div>
      </div>
    </div>
  );
}
