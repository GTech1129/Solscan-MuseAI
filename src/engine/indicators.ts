/**
 * Commodity Channel Index (CCI)
 */
export function calcCCI(
  h: number[],
  l: number[],
  c: number[],
  p = 20,
): (number | null)[] {
  return c.map((_, i) => {
    if (i < p - 1) return null;
    const H = h.slice(i - p + 1, i + 1);
    const L = l.slice(i - p + 1, i + 1);
    const C = c.slice(i - p + 1, i + 1);
    const tp = C.map((_, j) => (H[j] + L[j] + C[j]) / 3);
    const sma = tp.reduce((a, b) => a + b, 0) / p;
    const mad = tp.map((v) => Math.abs(v - sma)).reduce((a, b) => a + b, 0) / p;
    return mad === 0 ? 0 : (tp[tp.length - 1] - sma) / (0.015 * mad);
  });
}

/**
 * Ehlers Fisher Transform
 */
export function calcFisher(h: number[], l: number[], p = 9): (number | null)[] {
  let prev = 0;
  return h.map((_, i) => {
    if (i < p - 1) return null;
    const hi = Math.max(...h.slice(i - p + 1, i + 1));
    const lo = Math.min(...l.slice(i - p + 1, i + 1));
    const mid = (h[i] + l[i]) / 2;
    let r = hi === lo ? 0.5 : (mid - lo) / (hi - lo);
    r = Math.min(Math.max(r, 0.001), 0.999);
    const f = 0.5 * Math.log((1 + r) / (1 - r)) * 2 + 0.5 * prev;
    prev = f;
    return parseFloat(f.toFixed(4));
  });
}

/**
 * Average True Range (ATR)
 */
export function calcATR(
  h: number[],
  l: number[],
  c: number[],
  p = 14,
): (number | null)[] {
  const tr = c.map((_, i) => {
    if (i === 0) return h[i] - l[i];
    return Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  });
  return tr.map((_, i) => {
    if (i < p - 1) return null;
    return tr.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p;
  });
}

/**
 * Detect Bullish Divergence on CCI vs Price:
 * Price makes a lower low while CCI makes a higher low within lookback window.
 */
export function detectBullDiv(
  closes: number[],
  cci: (number | null)[],
  lookback = 5,
): boolean {
  const i = closes.length - 1;
  if (i < lookback) return false;
  const pSlice = closes.slice(i - lookback, i + 1);
  const cSlice = cci.slice(i - lookback, i + 1).filter((x): x is number => x != null);
  if (cSlice.length < lookback) return false;

  const pLL = pSlice[pSlice.length - 1] < Math.min(...pSlice.slice(0, -1));
  const cHL = cSlice[cSlice.length - 1] > Math.min(...cSlice.slice(0, -1));
  return pLL && cHL;
}

/**
 * Volume-Weighted Moving Average (VWMA)
 */
export function calcVWMA(
  c: number[],
  v: number[],
  p = 20,
): (number | null)[] {
  return c.map((_, i) => {
    if (i < p - 1) return null;
    let sumPV = 0;
    let sumV = 0;
    for (let j = i - p + 1; j <= i; j++) {
      sumPV += c[j] * v[j];
      sumV += v[j];
    }
    return sumV === 0 ? c[i] : sumPV / sumV;
  });
}

/**
 * Tenkan-sen (9-period Midpoint)
 */
export function calcTenkan(
  h: number[],
  l: number[],
  p = 9,
): (number | null)[] {
  return h.map((_, i) => {
    if (i < p - 1) return null;
    const hi = Math.max(...h.slice(i - p + 1, i + 1));
    const lo = Math.min(...l.slice(i - p + 1, i + 1));
    return (hi + lo) / 2;
  });
}

/**
 * Simple Moving Average (SMA)
 */
export function calcSMA(
  c: number[],
  p = 50,
): (number | null)[] {
  return c.map((_, i) => {
    if (i < p - 1) return null;
    return c.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p;
  });
}

/**
 * Fisher Transform 1-Bar Lag Signal Line
 */
export function calcFisherSignal(
  arr: (number | null)[],
): (number | null)[] {
  return arr.map((_, i) => (i === 0 ? null : arr[i - 1]));
}

/**
 * Average Directional Index (ADX)
 */
export function calcADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): (number | null)[] {
  if (highs.length < period + 1) return [];
  const dmPlus: number[] = [];
  const dmMinus: number[] = [];
  const trArr: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const dnMove = lows[i - 1] - lows[i];
    dmPlus.push(upMove > dnMove && upMove > 0 ? upMove : 0);
    dmMinus.push(dnMove > upMove && dnMove > 0 ? dnMove : 0);
    trArr.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      ),
    );
  }

  const smooth = (arr: number[], p: number) => {
    let s = arr.slice(0, p).reduce((a, b) => a + b, 0);
    const out = [s];
    for (let i = p; i < arr.length; i++) {
      s = s - s / p + arr[i];
      out.push(s);
    }
    return out;
  };

  const sTR = smooth(trArr, period);
  const sDMp = smooth(dmPlus, period);
  const sDMm = smooth(dmMinus, period);
  const diPlus = sDMp.map((v, i) => (sTR[i] ? (100 * v) / sTR[i] : 0));
  const diMinus = sDMm.map((v, i) => (sTR[i] ? (100 * v) / sTR[i] : 0));
  const dx = diPlus.map((v, i) => {
    const s = v + diMinus[i];
    return s ? (100 * Math.abs(v - diMinus[i])) / s : 0;
  });

  const adxRaw = smooth(dx, period);
  const adxScaled = adxRaw.map((v) => Math.min(100, Math.max(0, v / period)));
  const pad = highs.length - adxScaled.length;
  return Array(pad).fill(null).concat(adxScaled);
}

/**
 * Bullish Candle pattern check (Green close or Pin-bar hammer support)
 */
export function isBullishCandle(
  opens: number[],
  closes: number[],
  highs?: number[],
  lows?: number[],
): boolean {
  if (opens.length < 2) return false;
  const i = opens.length - 2;
  const op = opens[i];
  const cl = closes[i];
  if (cl > op) return true;

  if (highs && lows && highs.length > i && lows.length > i) {
    const lo = lows[i];
    const body = Math.max(0.01, Math.abs(cl - op));
    const lowerWick = Math.min(op, cl) - lo;
    if (lowerWick >= 1.2 * body && lowerWick >= 0.15) {
      return true;
    }
  }
  return false;
}

/**
 * Bearish Candle pattern check (Phase 2 mirror of isBullishCandle):
 * red close, or a pin-bar shooting star (long upper wick) at resistance.
 * Used by the canonical trigger's standard-short hook.
 */
export function isBearishCandle(
  opens: number[],
  closes: number[],
  highs?: number[],
  lows?: number[],
): boolean {
  if (opens.length < 2) return false;
  const i = opens.length - 2;
  const op = opens[i];
  const cl = closes[i];
  if (cl < op) return true;

  if (highs && lows && highs.length > i && lows.length > i) {
    const hi = highs[i];
    const body = Math.max(0.01, Math.abs(cl - op));
    const upperWick = hi - Math.max(op, cl);
    if (upperWick >= 1.2 * body && upperWick >= 0.15) {
      return true;
    }
  }
  return false;
}

/**
 * Higher Timeframe (HTF 1H) Trend Signal (canonical trigger input;
 * dashboard.html, which used to duplicate this, is retired in Phase 2).
 */
export function calcHTFSignal(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
): 'green' | 'yellow' | 'red' {
  if (closes.length < 50) return 'yellow';
  const H = highs.slice(0, -1);
  const L = lows.slice(0, -1);
  const C = closes.slice(0, -1);
  const V = volumes.slice(0, -1);

  const cci = calcCCI(H, L, C, 20);
  const fisher = calcFisher(H, L, 9);
  const tenkan = calcTenkan(H, L, 9);
  const vwma = calcVWMA(C, V, 20);
  const sma50 = calcSMA(C, 50);

  const price = C[C.length - 1];
  const vwmaValid = vwma.filter((x): x is number => x != null);
  const curV = vwmaValid.length > 0 ? vwmaValid[vwmaValid.length - 1] : null;

  // If price is below 1H VWMA, HTF bias is BEARISH (RED)
  if (curV == null || price < curV) return 'red';

  const dist = Math.abs((price - curV) / curV);
  if (dist <= 0.003) return 'yellow';

  const cciValid = cci.filter((x): x is number => x != null);
  const fishValid = fisher.filter((x): x is number => x != null);
  const tenkValid = tenkan.filter((x): x is number => x != null);
  const smaValid = sma50.filter((x): x is number => x != null);

  const cciUp = cciValid.length > 1 && cciValid[cciValid.length - 1] > cciValid[cciValid.length - 2];
  const fishUp = fishValid.length > 1 && fishValid[fishValid.length - 1] > fishValid[fishValid.length - 2];
  const tenkUp = tenkValid.length > 1 && tenkValid[tenkValid.length - 1] > tenkValid[tenkValid.length - 2];

  const lastSMA = smaValid.length > 0 ? smaValid[smaValid.length - 1] : 0;
  const aboveSMA = smaValid.length > 0 ? price > lastSMA : true;
  const cciBull = cciUp && cciValid[cciValid.length - 1] > 0;
  const fishBull = fishUp && fishValid[fishValid.length - 1] > 0;
  const aligned = [cciBull, fishBull, tenkUp].filter(Boolean).length;

  if (aligned === 3 && aboveSMA) return 'green';
  if (aligned >= 2 && aboveSMA) return 'yellow';
  return 'red';
}

/**
 * NOTE (Phase 2): calcSignalEngine has been REMOVED. It was one of three
 * divergent signal implementations (audit §2/§6) and has been replaced by
 * the single canonical trigger in ./trigger.ts (evaluateTrigger), which
 * is used by the live dashboard AND the backtest. Do not reintroduce a
 * second trigger here — extend trigger.ts instead.
 */
