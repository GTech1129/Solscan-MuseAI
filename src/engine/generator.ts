import { Candle, RegimeKey } from '../types.ts';
import { REGIMES } from './regimes.ts';

/**
 * Upgraded Solana Price Generator
 * Merton Jump-Diffusion with Poisson flash wicks (-1.5% to -5%),
 * GARCH-lite volatility clustering, and autocorrelated momentum / VWMA mean-reversion.
 */
export function generateSolanaCandles(
  regime: Exclude<RegimeKey, 'COMBINED'>,
  nBars: number,
  basePrice: number,
  rng: () => number,
): Candle[] {
  const R = REGIMES[regime];
  const candles: Candle[] = [];
  let price = basePrice;
  let vwmaPrice = basePrice;
  let vol = R.vol;
  let prevReturn = 0;

  for (let i = 0; i < nBars; i++) {
    // 1. Volatility Clustering (GARCH-lite)
    const volShock = rng() < 0.08 ? 1 + rng() * 2.5 : 1;
    vol = vol * 0.92 + R.vol * 0.08 * volShock;

    // 2. Poisson Jump Process (Liquidation Flushes / Spike Wicks)
    let jump = 0;
    let isJump = false;
    if (rng() < 0.04) {
      // 4% chance of liquidation jump per bar
      isJump = true;
      const jumpDir = R.drift < 0 ? -1 : rng() < 0.35 ? -1 : 1;
      jump = jumpDir * (0.015 + rng() * 0.035); // 1.5% to 5% flash wick
    }

    // 3. Autocorrelated Momentum + Mean Reversion to VWMA
    const noise = (rng() - 0.5) * 2 * vol;
    const meanRev = (R.meanRev * (vwmaPrice - price)) / basePrice;
    const momentum = prevReturn * 0.15;

    const returnStep = R.drift + noise + meanRev + momentum + jump;
    prevReturn = returnStep;

    price *= 1 + returnStep;
    price = Math.max(price, basePrice * 0.2); // Cap minimum floor

    vwmaPrice = vwmaPrice * 0.94 + price * 0.06;

    // Construct Realistic Candlestick Ratios
    const range = price * (vol + Math.abs(jump)) * (1 + rng() * 0.6);
    const body = range * (jump !== 0 ? 0.25 : R.candleBody);
    const shadow = Math.max(range - body, 0.01);
    const isUp = returnStep >= 0;

    const open = isUp ? price - body : price + body;
    const close = price;
    const high = Math.max(open, close) + shadow * (jump < 0 ? 0.2 : 0.8) * rng();
    const low = Math.min(open, close) - shadow * (jump < 0 ? 0.8 : 0.2) * rng();
    const volume = (1000 + rng() * 2000) * (1 + Math.abs(jump) * 20);

    candles.push({
      index: i,
      open: parseFloat(open.toFixed(4)),
      high: parseFloat(Math.max(high, open, close).toFixed(4)),
      low: parseFloat(Math.max(0.01, Math.min(low, open, close)).toFixed(4)),
      close: parseFloat(close.toFixed(4)),
      volume: Math.round(volume),
      atr: parseFloat((R.atrBase * (1 + Math.abs(jump) * 2)).toFixed(4)),
      isJump,
    });
  }

  return candles;
}
