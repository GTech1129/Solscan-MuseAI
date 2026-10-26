import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  TrendingUp, 
  TrendingDown
} from 'lucide-react';
import {
  calcCCI,
  calcFisher,
  calcTenkan,
  calcVWMA,
  calcSMA,
  calcATR,
  calcADX,
  calcFisherSignal,
  isBullishCandle,
  isBearishCandle,
  calcHTFSignal,
  detectBullDiv,
} from '../engine/indicators.ts';
// Phase 2: the canonical trigger is the ONLY signal computation.
// calcSignalEngine is gone (removed from indicators.ts); the backtest
// calls this same evaluateTrigger, so live and backtest cannot diverge.
import { evaluateTrigger } from '../engine/trigger.ts';
import { getCanonicalTierForBalance } from '../engine/tiers.ts';
import { LiveIndicatorCharts, CandleChartBar } from './LiveIndicatorCharts.tsx';
import { DashboardCalculator } from './DashboardCalculator.tsx';

function generateInitialCandles(basePrice = 119.05): CandleChartBar[] {
  const bars: CandleChartBar[] = [];
  const now = Date.now();
  let price = basePrice - 1.2;
  for (let i = 65; i >= 0; i--) {
    const time = now - i * 15 * 60 * 1000;
    const delta = Math.sin(i * 0.22) * 0.35 + ((i % 3 === 0 ? 0.2 : -0.15) * Math.random());
    const open = price;
    const close = price + delta;
    const high = Math.max(open, close) + 0.15 + Math.random() * 0.15;
    const low = Math.min(open, close) - 0.15 - Math.random() * 0.15;
    price = close;
    bars.push({
      time,
      open,
      high,
      low,
      close,
      volume: 12000 + Math.floor(Math.random() * 18000),
      tenkan: (high + low) / 2,
      vwma: close * 0.9985,
      sma50: close * 0.996,
      cci: Math.sin(i * 0.18) * 140,
      fisher: Math.sin(i * 0.14) * 3.5 + 3.0,
      fisherSignal: Math.sin((i - 1) * 0.14) * 3.5 + 3.0,
      atr: 0.42 + Math.random() * 0.15,
    });
  }
  return bars;
}

interface LiveDashboardViewProps {
  currentAsset: string;
  onSelectAsset?: (asset: 'SOL' | 'BTC' | 'ETH') => void;
  onSwitchToAutoTrade: () => void;
  onSwitchToBacktest: () => void;
  solPrice?: number;
  updateIntervalSecs?: number;
  onSetUpdateIntervalSecs?: (secs: number) => void;
  portfolioBalance?: number;
  onUpdatePortfolioBalance?: (newBal: number) => void;
  openPositionsCount?: number;
  maxOpenPositions?: number;
}

interface IndicatorsState {
  price: number;
  priceChange: number;
  // Row 1: Primary
  cci: number | null;
  cciUp: boolean;
  fisher: number | null;
  fishUp: boolean;
  tenkan: number | null;
  tenkUp: boolean;
  tenk2BarsUp: boolean;
  tenk30m2BarsUp: boolean;
  vwma: number | null;
  vwmaDist: number | null;
  vwmaStatus: string;
  vwmaUp: boolean;
  volume: string;
  volOK: boolean;
  volumeGateMet: boolean;
  atr: number | null;
  atrOK: boolean;
  adx: number | null;
  adxStatus: string;
  adxOK: boolean;
  // Row 2: Secondary / Rules
  sessionName: string;
  sessionOK: boolean;
  htfSignal: 'green' | 'yellow' | 'red';
  candleBullish: boolean;
  candleLabel: string;
  candleMomentum: boolean;
  orderExecutionType: 'POST_ONLY_BEST_BID' | 'DYNAMIC_ATR_LIMIT';
  divergence: string;
  divType: 'bullish' | 'bearish' | 'none';
  cciAccel: boolean;
  fisher5mVal: number | null;
  fisher5mBearishCross: boolean;
  fisher5mUp: boolean;
  consecutiveGreen: number;
  consecutiveRed: number;
  cooldownBars: number;
  // Canonical trigger state (Phase 2). 'unknown' is the explicit
  // 5m-feed-failure state: visible warning, never a stale green.
  triggerState: 'LONG' | 'SHORT' | 'NONE' | 'UNKNOWN';
  triggerDirection: 'long' | 'short' | null;
  designedShort: boolean;
  isChop: boolean;
  marginMultiplier: number;
  feedStatus: 'ok' | 'error';
  feedWarning: string | null;
  // Master Signal & Regime
  signal: 'green' | 'yellow' | 'red' | 'unknown';
  regime: string;
  entryPrice: number;
  entryOffset: number;
  tp1: number;
  tp2: number;
  tp1Percent: number;
  tp2Percent: number;
  slCoeff: number;
  recommendedMargin: number;
  activeTier: 'TIER_1' | 'TIER_2' | 'TIER_3';
  tierRiskCapPct: number;
  tierRiskCapDollar: number;
  setupGrade: 'GRADE_A' | 'GRADE_B';
  adxSlope: 'rising' | 'falling' | 'flat';
  isExhaustionReversal: boolean;
  earlyProfitLock: number;
  trailingStopOffset: number;
  limitOrderTTLMinutes: number;
  confidence: 'HIGH CONFIDENCE' | 'MEDIUM CONFIDENCE' | 'LOW CONFIDENCE';
  confidenceSub: string;
}

const DEFAULT_INDICATORS: IndicatorsState = {
  price: 119.05,
  priceChange: 0.05,
  cci: -49.48,
  cciUp: true,
  fisher: 0.10,
  fishUp: true,
  tenkan: 119.00,
  tenkUp: false,
  tenk2BarsUp: false,
  tenk30m2BarsUp: false,
  vwma: 119.15,
  vwmaDist: -0.10,
  vwmaStatus: 'Below VWMA',
  vwmaUp: false,
  volume: '24.5K',
  volOK: true,
  volumeGateMet: false,
  atr: 0.485,
  atrOK: true,
  adx: 25.8,
  adxStatus: 'Weak (<45)',
  adxOK: false,
  sessionName: 'Session Active',
  sessionOK: true,
  htfSignal: 'red',
  candleBullish: true,
  candleLabel: 'Close > Open',
  candleMomentum: false,
  orderExecutionType: 'DYNAMIC_ATR_LIMIT',
  divergence: 'None',
  divType: 'none',
  cciAccel: true,
  fisher5mVal: 0.68,
  fisher5mBearishCross: false,
  fisher5mUp: true,
  consecutiveGreen: 0,
  consecutiveRed: 0,
  cooldownBars: 0,
  triggerState: 'NONE',
  triggerDirection: null,
  designedShort: false,
  isChop: false,
  marginMultiplier: 1,
  // Initial state has NO live feed: the 119.05 placeholder values below
  // are SYNTHETIC/UNSYNCED until the first real klines arrive. The
  // banner shows SYNCHRONIZING until isLiveSynced, and this warning is
  // the explicit label for the placeholder numbers themselves.
  feedStatus: 'error',
  feedWarning: 'No live feed yet — placeholder values are SYNTHETIC/UNSYNCED until the first real klines arrive.',
  signal: 'yellow',
  regime: 'RANGE_BOUND_SUPPORT',
  entryPrice: 119.05,
  entryOffset: 0.08,
  tp1: 0.35,
  tp2: 1.20,
  tp1Percent: 30,
  tp2Percent: 70,
  slCoeff: 1.5,
  recommendedMargin: 25.00, // Tier 1: $25.00 margin collateral on $30 balance ($500.00 position at 20x)
  activeTier: 'TIER_1',
  tierRiskCapPct: 0.03, // 3% Tier 1 Risk Cap
  tierRiskCapDollar: 0.90, // -$0.90 max loss on $30 balance
  setupGrade: 'GRADE_B',
  adxSlope: 'flat',
  isExhaustionReversal: false,
  earlyProfitLock: 0.10,
  trailingStopOffset: 0.58,
  limitOrderTTLMinutes: 15,
  confidence: 'LOW CONFIDENCE',
  confidenceSub: 'Connecting to live market feed...',
};

export const LiveDashboardView: React.FC<LiveDashboardViewProps> = ({
  currentAsset,
  onSelectAsset: _onSelectAsset,
  onSwitchToAutoTrade: _onSwitchToAutoTrade,
  onSwitchToBacktest: _onSwitchToBacktest,
  solPrice: _solPrice,
  updateIntervalSecs = 5,
  onSetUpdateIntervalSecs: _onSetUpdateIntervalSecs,
  portfolioBalance: propPortfolioBalance = 30.0,
  onUpdatePortfolioBalance: propOnUpdatePortfolioBalance,
  openPositionsCount = 0,
  maxOpenPositions = 1,
}) => {
  const [binanceStatus, setBinanceStatus] = useState<{ connected: boolean; latencyMs: number | null }>({
    connected: true,
    latencyMs: null,
  });
  const [indicators, setIndicators] = useState<IndicatorsState>(DEFAULT_INDICATORS);
  const [isLiveSynced, setIsLiveSynced] = useState<boolean>(false);
  const [autoTradeActive, setAutoTradeActive] = useState<boolean>(true);
  const [autoTradeToast, setAutoTradeToast] = useState<string | null>(null);
  const [chartCandles, setChartCandles] = useState<CandleChartBar[]>(() => generateInitialCandles(_solPrice || 119.05));
  const [chartTimeframe, setChartTimeframe] = useState<string>('5m');
  const [portfolioBalance, setPortfolioBalance] = useState<number>(propPortfolioBalance || 30.0);
  const lastAutoTradeTimeRef = useRef<number>(0);
  const [, setLastUpdated] = useState<string>('Syncing live telemetry...');

  useEffect(() => {
    if (typeof propPortfolioBalance === 'number') {
      setPortfolioBalance(propPortfolioBalance);
    }
  }, [propPortfolioBalance]);

  const handleUpdatePortfolioBalance = async (newBal: number) => {
    setPortfolioBalance(newBal);
    if (propOnUpdatePortfolioBalance) {
      propOnUpdatePortfolioBalance(newBal);
    } else {
      try {
        await fetch('/portfolio-balance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ balance: newBal }),
        });
        window.dispatchEvent(new CustomEvent('BOT_STATE_UPDATED'));
      } catch (_) {}
    }
  };

  // Compute live indicators from raw Binance candles
  const calculateTelemetry = useCallback((raw: any[], rawHtf: any[], raw5m: any[], asset: string, rawChartTf?: any[]) => {
    try {
      if (!raw || !Array.isArray(raw) || raw.length < 20) return;

      const opens = raw.map((k) => parseFloat(k[1]));
      const highs = raw.map((k) => parseFloat(k[2]));
      const lows = raw.map((k) => parseFloat(k[3]));
      const closes = raw.map((k) => parseFloat(k[4]));
      const volumes = raw.map((k) => parseFloat(k[5]));

      const curPrice = parseFloat(raw[raw.length - 1][4]);
      const prevPrice = closes[closes.length - 2];
      const priceChange = ((curPrice - prevPrice) / prevPrice) * 100;

      const cH = highs.slice(0, -1);
      const cL = lows.slice(0, -1);
      const cC = closes.slice(0, -1);
      const cV = volumes.slice(0, -1);

      const cciArr = calcCCI(cH, cL, cC, 20);
      const fisherArr = calcFisher(cH, cL, 9);
      const tenkanArr = calcTenkan(cH, cL, 9);
      const vwmaArr = calcVWMA(cC, cV, 20);
      const atrArr = calcATR(cH, cL, cC, 14);
      const adxArr = calcADX(cH, cL, cC, 14);

      const cciValid = cciArr.filter((x): x is number => x != null);
      const curCCI = cciValid.length > 0 ? cciValid[cciValid.length - 1] : 0;
      const prevCCI = cciValid.length > 1 ? cciValid[cciValid.length - 2] : 0;
      const cciUp = curCCI > prevCCI;
      const cciDown = curCCI < prevCCI;

      const fisherValid = fisherArr.filter((x): x is number => x != null);
      const curFisher = fisherValid.length > 0 ? fisherValid[fisherValid.length - 1] : 0;
      const prevFisher = fisherValid.length > 1 ? fisherValid[fisherValid.length - 2] : 0;
      const fishUp = curFisher > prevFisher;
      const fishDown = curFisher < prevFisher;

      const tenkanValid = tenkanArr.filter((x): x is number => x != null);
      const curTenkan = tenkanValid.length > 0 ? tenkanValid[tenkanValid.length - 1] : curPrice;
      const prevTenkan = tenkanValid.length > 1 ? tenkanValid[tenkanValid.length - 2] : curPrice;
      const prev2Tenkan = tenkanValid.length > 2 ? tenkanValid[tenkanValid.length - 3] : prevTenkan;
      const tenkUp = curTenkan > prevTenkan;
      const tenk2BarsUp = tenkanValid.length >= 3 && curTenkan > prevTenkan && prevTenkan > prev2Tenkan;
      const tenk2BarsDown = tenkanValid.length >= 3 && curTenkan < prevTenkan && prevTenkan < prev2Tenkan;

      // 1. Rising Tenkan-sen (>= 2 Candles, >= 60m): 30m Aggregation (2x 15m bars = 1x 30m bar)
      const h30m: number[] = [];
      const l30m: number[] = [];
      for (let k = 0; k < cH.length - 1; k += 2) {
        h30m.push(Math.max(cH[k], cH[k + 1]));
        l30m.push(Math.min(cL[k], cL[k + 1]));
      }
      const tenkan30mArr = calcTenkan(h30m, l30m, 9);
      const tenk30mValid = tenkan30mArr.filter((x): x is number => x != null);
      const cur30mTenk = tenk30mValid.length > 0 ? tenk30mValid[tenk30mValid.length - 1] : curPrice;
      const prev30mTenk = tenk30mValid.length > 1 ? tenk30mValid[tenk30mValid.length - 2] : cur30mTenk;
      const prev230mTenk = tenk30mValid.length > 2 ? tenk30mValid[tenk30mValid.length - 3] : prev30mTenk;
      const tenk30m2BarsUp = tenk30mValid.length >= 3 && cur30mTenk > prev30mTenk && prev30mTenk > prev230mTenk;
      const tenk30m2BarsDown = tenk30mValid.length >= 3 && cur30mTenk < prev30mTenk && prev30mTenk < prev230mTenk;

      // 2. Candle Momentum Detection: Close >= High - (0.0010 * Close)
      // Confirms the current 15m bar closed within 0.10% of its high (virtually no upper wick)
      const lastBarClose = cC[cC.length - 1];
      const lastBarHigh = cH[cH.length - 1];
      const lastBarLow = cL[cL.length - 1];
      const candleMomentum = lastBarHigh > 0 && lastBarClose >= (lastBarHigh - (0.0010 * lastBarClose));

      const vwmaValid = vwmaArr.filter((x): x is number => x != null);
      const curVWMA = vwmaValid.length > 0 ? vwmaValid[vwmaValid.length - 1] : curPrice;
      const vwmaDist = curVWMA ? ((curPrice - curVWMA) / curVWMA) * 100 : 0;
      let vwmaStatus = 'Below VWMA';
      if (vwmaDist >= 10) vwmaStatus = 'Breakout +10%';
      else if (vwmaDist >= 0 && vwmaDist < 0.3) vwmaStatus = 'Consolidating';
      else if (vwmaDist >= 0.3) vwmaStatus = 'Above VWMA';

      // Volume average check and 25k SOL Gate
      const recentVols = cV.slice(-21, -1);
      const avgVol = recentVols.length > 0 ? recentVols.reduce((a, b) => a + b, 0) / recentVols.length : 1;
      const lastVol = cV[cV.length - 1] || 0;
      const volOK = lastVol > avgVol;
      const volumeGateMet = lastVol >= 25000;
      const volStr = lastVol >= 1e6 ? `${(lastVol / 1e6).toFixed(2)}M` : lastVol >= 1e3 ? `${(lastVol / 1e3).toFixed(1)}K` : lastVol.toFixed(0);

      // ATR expansion
      const atrValid = atrArr.filter((x): x is number => x != null);
      const curATR = atrValid.length > 0 ? atrValid[atrValid.length - 1] : 0.35;
      const atrOK = atrValid.length >= 3 && atrValid[atrValid.length - 1] > atrValid[atrValid.length - 3];

      // ADX trending & slope
      const adxValid = adxArr.filter((x): x is number => x != null);
      const curADX = adxValid.length > 0 ? adxValid[adxValid.length - 1] : 25;
      const prevADX = adxValid.length > 1 ? adxValid[adxValid.length - 2] : null;
      const adxOK = curADX > 45;
      const adxStatus = adxOK ? 'Trending (>45)' : curADX > 20 ? 'Weak (<45)' : 'Choppy (<20)';

      // Session
      const utcH = new Date().getUTCHours();
      const sessionOK = (utcH >= 13 && utcH < 21) || (utcH >= 0 && utcH < 4);
      const sessionName = sessionOK ? 'Session Active' : 'Off-hours';

      // HTF 1H Signal
      let htfSignal: 'green' | 'yellow' | 'red' = 'yellow';
      if (rawHtf && rawHtf.length >= 50) {
        const hH = rawHtf.map((k) => parseFloat(k[2]));
        const hL = rawHtf.map((k) => parseFloat(k[3]));
        const hC = rawHtf.map((k) => parseFloat(k[4]));
        const hV = rawHtf.map((k) => parseFloat(k[5]));
        htfSignal = calcHTFSignal(hH, hL, hC, hV);
      }

      // Candle pattern
      const candleBullish = isBullishCandle(opens, closes, highs, lows);
      const candleLabel = candleBullish
        ? closes[closes.length - 2] > opens[opens.length - 2]
          ? 'Close > Open'
          : 'Pin-bar Hammer'
        : 'Close < Open';

      // Divergence
      const hasBullDiv = detectBullDiv(cC, cciArr, 5);
      const divergence = hasBullDiv ? 'CCI Bullish div' : 'None';
      const divType: 'bullish' | 'bearish' | 'none' = hasBullDiv ? 'bullish' : 'none';

      // CCI Momentum Acceleration
      const cciAccel = cciValid.length >= 3 && (cciValid[cciValid.length - 1] - cciValid[cciValid.length - 2] > cciValid[cciValid.length - 2] - cciValid[cciValid.length - 3]);

      // 5m Bar Confirmation & Fisher Exit Check (Phase 2: trailing
      // counts in BOTH directions + an explicit feed flag. The old code
      // counted only green bars and silently left confirmation at 0
      // when the 5m feed failed — indistinguishable from "no setup".
      // Now a missing/failed 5m feed sets fiveMinFeedOk=false, and the
      // canonical trigger returns UNKNOWN with a visible warning.)
      let lastFisher5mVal: number | null = null;
      let fisher5mBearishCross = false;
      let fisher5mUp = false;
      let consecutiveGreen5m = 0;
      let consecutiveRed5m = 0;
      let fiveMinFeedOk = false;

      if (raw5m && Array.isArray(raw5m) && raw5m.length > 5) {
        fiveMinFeedOk = true;
        // Trailing run of closed 5m bars (excluding the forming
        // in-progress candle). Only one direction can be nonzero: the
        // run ends at the most recent closed bar. Doji (close == open)
        // counts as green, matching the old convention.
        const closed5mBars = raw5m.slice(0, -1);
        for (let b = closed5mBars.length - 1; b >= 0; b--) {
          const isGreenBar = parseFloat(closed5mBars[b][4]) >= parseFloat(closed5mBars[b][1]);
          if (b === closed5mBars.length - 1) {
            if (isGreenBar) consecutiveGreen5m = 1;
            else consecutiveRed5m = 1;
          } else if (isGreenBar && consecutiveGreen5m > 0) {
            consecutiveGreen5m++;
          } else if (!isGreenBar && consecutiveRed5m > 0) {
            consecutiveRed5m++;
          } else {
            break;
          }
        }

        const hH5m = raw5m.map((k) => parseFloat(k[2]));
        const hL5m = raw5m.map((k) => parseFloat(k[3]));
        const cH5m = hH5m.slice(0, -1);
        const cL5m = hL5m.slice(0, -1);
        const f5mArr = calcFisher(cH5m, cL5m, 9);
        const f5mSig = calcFisherSignal(f5mArr);
        const f5mValid = f5mArr.filter((x): x is number => x != null);
        const f5mSigValid = f5mSig.filter((x): x is number => x != null);
        if (f5mValid.length >= 2 && f5mSigValid.length >= 2) {
          lastFisher5mVal = f5mValid[f5mValid.length - 1];
          fisher5mUp = lastFisher5mVal > f5mValid[f5mValid.length - 2];
          fisher5mBearishCross = f5mValid[f5mValid.length - 1] < f5mSigValid[f5mSigValid.length - 1] && f5mValid[f5mValid.length - 2] >= f5mSigValid[f5mSigValid.length - 2];
        }
      }

      // Canonical trigger (Phase 2) — the ONLY signal computation in
      // the live view. The old calcSignalEngine + ADX<12 overlay are
      // gone: chop is traded at reduced size (not sat out), shorts
      // are a designed path, and a failed 5m feed yields UNKNOWN with
      // a visible warning (never a silent block, never a stale green).
      // The backtest calls this same evaluateTrigger, so live and
      // backtest cannot print different answers on the same candles.
      const bearishCandle = isBearishCandle(opens, closes, highs, lows);
      const trig = evaluateTrigger({
        price: curPrice,
        vwma: curVWMA,
        atr: curATR,
        adx: curADX,
        prevAdx: prevADX,
        htfSignal,
        cciUp,
        fishUp,
        bullishCandle: candleBullish,
        tenkRising2Candles: tenk30m2BarsUp || tenk2BarsUp,
        volumeGateMet,
        cciDown,
        fishDown,
        bearishCandle,
        tenkFalling2Candles: tenk30m2BarsDown || tenk2BarsDown,
        consecutiveGreen5m,
        consecutiveRed5m,
        fiveMinFeedOk,
        balance: portfolioBalance,
        candleHigh: lastBarHigh,
        candleLow: lastBarLow,
        candleClose: lastBarClose,
        bullDiv: hasBullDiv,
        bearDiv: false,
        cciAccel,
        volConfirmed: volOK,
      });

      // Display entry: longs buy below close, shorts sell above close,
      // no-trade states show the current price (there is no entry).
      const entryPrice = trig.state === 'LONG'
        ? curPrice - trig.entryOffset
        : trig.state === 'SHORT'
        ? curPrice + trig.entryOffset
        : curPrice;

      const trigTier = getCanonicalTierForBalance(portfolioBalance);
      const tierRiskCapPct = trigTier.riskCapPct;
      const tierRiskCapDollar = Math.max(
        0.25,
        Math.min(portfolioBalance * tierRiskCapPct, trigTier.maxRiskDollarCap),
      );

      let confidence: 'HIGH CONFIDENCE' | 'MEDIUM CONFIDENCE' | 'LOW CONFIDENCE' = 'MEDIUM CONFIDENCE';
      let confidenceSub = '1H HTF is Neutral (Consolidation)';
      if (trig.state === 'UNKNOWN') {
        confidence = 'LOW CONFIDENCE';
        confidenceSub = '5m confirmation feed unavailable — signal UNKNOWN (not a stale green)';
      } else if (trig.state === 'NONE' && trig.regime === 'FLASH_CRASH') {
        confidence = 'LOW CONFIDENCE';
        confidenceSub = 'Flash crash: ADX > 35 + 1H red + price below VWMA — no new positions either direction';
      } else if ((trig.state === 'LONG' || trig.state === 'SHORT') && trig.isChop) {
        confidence = 'MEDIUM CONFIDENCE';
        confidenceSub = `Market chop (ADX < 20): trading at reduced size (${trig.marginMultiplier}x margin, TP1 ${trig.tp1Dist})`;
      } else if (
        trig.state === 'NONE' &&
        (trig.hooks.standardLong || trig.hooks.slowBullLong || trig.hooks.standardShort || trig.hooks.slowBearShort)
      ) {
        confidence = 'MEDIUM CONFIDENCE';
        confidenceSub = `Hook fired, waiting for 2-bar 5m confirmation (green ${trig.confirmation.long}/2, red ${trig.confirmation.short}/2)`;
      } else if (htfSignal === 'green') {
        confidence = 'HIGH CONFIDENCE';
        confidenceSub = trig.confirmation.longOk ? '1H HTF Bullish & 2-Bar 5m Confirmed' : '1H HTF Bullish Alignment';
      } else if (htfSignal === 'red') {
        confidence = 'LOW CONFIDENCE';
        confidenceSub = '1H HTF Opposing Bearish Bias';
      }

      setIndicators({
        price: curPrice,
        priceChange,
        cci: curCCI,
        cciUp,
        fisher: curFisher,
        fishUp,
        tenkan: curTenkan,
        tenkUp,
        tenk2BarsUp,
        tenk30m2BarsUp,
        vwma: curVWMA,
        vwmaDist,
        vwmaStatus,
        vwmaUp: vwmaDist >= 0,
        volume: volStr,
        volOK,
        volumeGateMet,
        atr: curATR,
        atrOK,
        adx: curADX,
        adxStatus,
        adxOK,
        sessionName,
        sessionOK,
        htfSignal,
        candleBullish,
        candleLabel,
        candleMomentum,
        orderExecutionType: trig.orderExecutionType,
        divergence,
        divType,
        cciAccel,
        fisher5mVal: lastFisher5mVal,
        fisher5mBearishCross,
        fisher5mUp,
        consecutiveGreen: consecutiveGreen5m,
        consecutiveRed: consecutiveRed5m,
        // The old code showed "2 bars" of cooldown on any red signal —
        // a display hack with no live meaning. Live cooldown is the
        // dispatcher's 5-minute debounce; this tile is Clear unless a
        // real cooldown is tracked (none is, in the live view).
        cooldownBars: 0,
        triggerState: trig.state,
        triggerDirection: trig.direction,
        designedShort: trig.designedShort,
        isChop: trig.isChop,
        marginMultiplier: trig.marginMultiplier,
        feedStatus: fiveMinFeedOk ? 'ok' : 'error',
        feedWarning: fiveMinFeedOk
          ? null
          : '5m confirmation feed unavailable — signal is UNKNOWN (not a stale green). 15m tiles below are still live.',
        signal: trig.uiSignal,
        regime: trig.regime,
        entryPrice,
        entryOffset: trig.entryOffset,
        tp1: trig.tp1Dist,
        tp2: trig.tp2Dist,
        tp1Percent: trig.tp1Percent,
        tp2Percent: trig.tp2Percent,
        slCoeff: trig.slCoeff,
        recommendedMargin: trig.margin,
        activeTier: trig.tier,
        tierRiskCapPct,
        tierRiskCapDollar,
        setupGrade: trig.setupGrade,
        adxSlope: trig.adxSlope,
        isExhaustionReversal: trig.isExhaustionReversal,
        earlyProfitLock: trig.earlyProfitLock,
        trailingStopOffset: trig.trailingStopOffset,
        limitOrderTTLMinutes: trig.limitOrderTTLMinutes,
        confidence,
        confidenceSub,
      });

      // Synchronize signal and gate status with backend daemon and listeners.
      // 'unknown' is forwarded as-is: the backend records it as the
      // current signal state (never as a green gate).
      fetch('/signal-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signal: trig.uiSignal,
          regime: trig.regime,
          price: curPrice,
          isGreenGate: trig.state === 'LONG',
          isShortGate: trig.state === 'SHORT',
        }),
      }).catch(() => {});
      window.dispatchEvent(
        new CustomEvent('SIGNAL_UPDATED', {
          detail: {
            signal: trig.uiSignal,
            isGreenGate: trig.state === 'LONG',
            isShortGate: trig.state === 'SHORT',
            regime: trig.regime,
          },
        })
      );

      // Map candles and indicator series to chart bars (aligned with chartTimeframe)
      const cSource = rawChartTf && Array.isArray(rawChartTf) && rawChartTf.length >= 20 ? rawChartTf : raw;
      const cOpens = cSource.map((k) => parseFloat(k[1]));
      const cHighs = cSource.map((k) => parseFloat(k[2]));
      const cLows = cSource.map((k) => parseFloat(k[3]));
      const cCloses = cSource.map((k) => parseFloat(k[4]));
      const cVols = cSource.map((k) => parseFloat(k[5]));

      const cTenkan = calcTenkan(cHighs.slice(0, -1), cLows.slice(0, -1), 9);
      const cVwma = calcVWMA(cCloses.slice(0, -1), cVols.slice(0, -1), 20);
      const cSma50 = calcSMA(cCloses.slice(0, -1), 50);
      const cCci = calcCCI(cHighs.slice(0, -1), cLows.slice(0, -1), cCloses.slice(0, -1), 20);
      const cFisher = calcFisher(cHighs.slice(0, -1), cLows.slice(0, -1), 9);
      const cFishSig = calcFisherSignal(cFisher);
      const cAtr = calcATR(cHighs.slice(0, -1), cLows.slice(0, -1), cCloses.slice(0, -1), 14);

      const fullCandles: CandleChartBar[] = cOpens.map((op, i) => {
        const barTime = cSource[i] && cSource[i][0] ? Number(cSource[i][0]) : Date.now() - (cOpens.length - 1 - i) * 15 * 60 * 1000;
        return {
          time: barTime,
          open: op,
          high: cHighs[i],
          low: cLows[i],
          close: cCloses[i],
          volume: cVols[i],
          tenkan: cTenkan[i] ?? null,
          vwma: cVwma[i] ?? null,
          sma50: cSma50[i] ?? null,
          cci: cCci[i] ?? null,
          fisher: cFisher[i] ?? null,
          fisherSignal: cFishSig[i] ?? null,
          atr: cAtr[i] ?? null,
        };
      });
      setChartCandles(fullCandles);

      setIsLiveSynced(true);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      console.warn('[LIVE DASHBOARD] Indicator calculation notice:', err);
    }
  }, []);

  // Poll live klines from server-side proxy with CORS-enabled Binance Vision fallback
  const fetchTelemetry = useCallback(async () => {
    const symbol = `${currentAsset}USDT`;
    const start = Date.now();
    let raw15m: any[] | null = null;
    let raw1h: any[] = [];
    let raw5m: any[] = [];
    let rawChartTf: any[] | null = null;

    // Attempt 1: Local server proxy (/api/binance/klines)
    try {
      const res15m = await fetch(`/api/binance/klines?symbol=${encodeURIComponent(symbol)}&interval=15m&limit=200`);
      if (res15m.ok) {
        const parsed = await res15m.json();
        if (Array.isArray(parsed) && parsed.length > 5) {
          raw15m = parsed;
          const [res1h, res5m, resChart] = await Promise.all([
            fetch(`/api/binance/klines?symbol=${encodeURIComponent(symbol)}&interval=1h&limit=100`).catch(() => null),
            fetch(`/api/binance/klines?symbol=${encodeURIComponent(symbol)}&interval=5m&limit=100`).catch(() => null),
            chartTimeframe !== '15m'
              ? fetch(`/api/binance/klines?symbol=${encodeURIComponent(symbol)}&interval=${chartTimeframe}&limit=200`).catch(() => null)
              : null,
          ]);
          if (res1h && res1h.ok) raw1h = await res1h.json();
          if (res5m && res5m.ok) raw5m = await res5m.json();
          if (resChart && resChart.ok) rawChartTf = await resChart.json();
        }
      }
    } catch (_) {
      // Fall through to public endpoint
    }

    // Attempt 2: Direct CORS-enabled Binance Vision mirror (works globally in browser without proxy)
    if (!raw15m) {
      try {
        const res15m = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=15m&limit=200`);
        if (res15m.ok) {
          const parsed = await res15m.json();
          if (Array.isArray(parsed) && parsed.length > 5) {
            raw15m = parsed;
            const [res1h, res5m, resChart] = await Promise.all([
              fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1h&limit=100`).catch(() => null),
              fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=5m&limit=100`).catch(() => null),
              chartTimeframe !== '15m'
                ? fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${chartTimeframe}&limit=200`).catch(() => null)
                : null,
            ]);
            if (res1h && res1h.ok) raw1h = await res1h.json();
            if (res5m && res5m.ok) raw5m = await res5m.json();
            if (resChart && resChart.ok) rawChartTf = await resChart.json();
          }
        }
      } catch (_) {
        // Fallback below
      }
    }

    if (raw15m && Array.isArray(raw15m) && raw15m.length > 5) {
      setBinanceStatus({ connected: true, latencyMs: Date.now() - start });
      calculateTelemetry(raw15m, raw1h, raw5m, currentAsset, rawChartTf || raw15m);
    } else {
      setBinanceStatus({ connected: false, latencyMs: null });
      // P0 safety: a feed failure must UNSYNC. Previously isLiveSynced
      // stayed true forever after the first calculation, so a stale green
      // signal could keep auto-dispatching during an outage. Clearing it
      // blocks the dispatcher (which requires isLiveSynced) and returns
      // the UI to its SYNCING state until real data resumes.
      setIsLiveSynced(false);
    }
  }, [currentAsset, calculateTelemetry, chartTimeframe]);

  useEffect(() => {
    fetchTelemetry();
    const interval = setInterval(() => {
      fetchTelemetry();
    }, updateIntervalSecs * 1000);

    return () => {
      clearInterval(interval);
    };
  }, [fetchTelemetry, updateIntervalSecs]);

  // Phase 2 REMOVED: the postMessage telemetry bridge from dashboard.html.
  // dashboard.html computed its OWN signal (calcSignal, no 5m gate,
  // hardcoded $120 margin) and overwrote this view's indicators on
  // every message — a second live signal path with different gates.
  // dashboard.html is retired to a redirect (see PHASE2_NOTES.md);
  // this view computes the canonical trigger locally from its own
  // klines feed (calculateTelemetry above) and nothing overwrites it.

  // Autonomous Signal Dispatcher (Phase 2): forwards canonical LONG
  // and designed-SHORT signals to the bot daemon. UNKNOWN and NONE
  // never dispatch (a feed failure cannot auto-trade, and a flash
  // crash has no direction). Shorts dispatch ONLY with the canonical
  // designedShort marker — the server allowlist rejects any red
  // payload without it, so this path cannot re-open arbitrary shorts.
  // Turning the Auto-Trader toggle off keeps shorts (and longs)
  // manual. The 5-minute debounce is unchanged.
  useEffect(() => {
    if (!isLiveSynced || !autoTradeActive) return;
    const trigState = indicators.triggerState;
    if (trigState !== 'LONG' && trigState !== 'SHORT') return;
    if (trigState === 'SHORT' && !indicators.designedShort) return;

    const now = Date.now();
    // Debounce to at most 1 automatic order per 5 minutes per asset
    if (now - lastAutoTradeTimeRef.current < 5 * 60 * 1000) return;

    lastAutoTradeTimeRef.current = now;
    const sideLabel = trigState === 'LONG' ? 'Long' : 'Short';
    console.log(`[AUTOTRADE DISPATCHER] ${trigState === 'LONG' ? '🟩' : '🟥'} ${sideLabel} Signal confirmed for ${currentAsset}! Forwarding order to execution daemon...`);

    fetch('/signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asset: currentAsset,
        direction: trigState === 'LONG' ? 'buy' : 'sell',
        designedShort: indicators.designedShort,
        price: indicators.price,
        entryOffset: indicators.entryOffset,
        recommendedMargin: indicators.recommendedMargin,
        marginMultiplier: indicators.marginMultiplier,
        isChop: indicators.isChop,
        regime: indicators.regime,
        adx: indicators.adx,
        atr: indicators.atr,
        candleMomentum: indicators.candleMomentum,
        orderExecutionType: indicators.orderExecutionType,
        executionType: indicators.orderExecutionType,
        tenk30m2BarsUp: indicators.tenk30m2BarsUp,
        volumeGateMet: indicators.volumeGateMet,
        consecutiveGreen5m: indicators.consecutiveGreen,
        consecutiveRed5m: indicators.consecutiveRed,
        barConfirmation: trigState === 'LONG' ? indicators.consecutiveGreen : indicators.consecutiveRed,
        consecutiveGreen: indicators.consecutiveGreen,
        consecutiveRed: indicators.consecutiveRed,
        chartTimeframe,
        tp1: indicators.tp1,
        tp2: indicators.tp2,
        tp1Dist: indicators.tp1,
        tp2Dist: indicators.tp2,
        tp1Percent: indicators.tp1Percent,
        tp2Percent: indicators.tp2Percent,
        slCoeff: indicators.slCoeff,
        setupGrade: indicators.setupGrade,
        limitOrderTTLMinutes: indicators.limitOrderTTLMinutes,
        earlyProfitLock: indicators.earlyProfitLock,
        trailingStopOffset: indicators.trailingStopOffset,
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok && data.status === 'placed') {
          setAutoTradeToast(`🤖 Auto-Trade Placed: ${sideLabel} ${currentAsset} @ $${data.entryPrice?.toFixed(2) || indicators.entryPrice} | PDA: ${data.requestPDA?.slice(0, 8)}...`);
        } else if (data.status === 'rejected') {
          setAutoTradeToast(`⚠️ Auto-Trade Skipped: ${data.reason || data.message}`);
        }
        window.dispatchEvent(new CustomEvent('BOT_STATE_UPDATED'));
      })
      .catch((err) => {
        console.warn('[AUTOTRADE DISPATCH ERROR]:', err.message);
      });
  }, [isLiveSynced, indicators.signal, autoTradeActive, currentAsset, indicators]);

  // Signal UI styling helpers
  const isGreen = isLiveSynced && indicators.signal === 'green';
  const isRed = isLiveSynced && indicators.signal === 'red';
  const isUnknown = isLiveSynced && indicators.signal === 'unknown';
  // A red tile is a SHORT only when the canonical trigger fired one;
  // a red tile with state NONE is the flash-crash sit-out, not a trade.
  const isShort = isRed && indicators.triggerState === 'SHORT';
  // 2-bar confirm tile shows the count for the active direction.
  const confirmCount = indicators.triggerDirection === 'short' ? indicators.consecutiveRed : indicators.consecutiveGreen;
  const boostNote = indicators.regime === 'BULL_TREND_DRIFT' || indicators.setupGrade === 'GRADE_A'
    ? ' Server may add the +10x boost (max 60x).'
    : '';

  const signalCardBorder = !isLiveSynced
    ? 'border-amber-500/30 bg-amber-500/5'
    : isGreen
    ? 'border-emerald-500/50 bg-emerald-500/10'
    : isRed
    ? 'border-rose-500/50 bg-rose-500/10'
    : 'border-amber-500/50 bg-amber-500/10';

  const signalTextColor = !isLiveSynced
    ? 'text-amber-400'
    : isGreen
    ? 'text-emerald-400'
    : isRed
    ? 'text-rose-400'
    : 'text-amber-400';

  return (
    <div className="space-y-4 font-sans">
      {/* 2. Big Signal Banner */}
      <div className={`p-4 sm:p-5 rounded-xl border-2 transition-all ${signalCardBorder}`}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5 flex-1 min-w-[280px]">
            <div className={`text-xl sm:text-2xl font-bold flex items-center gap-2 ${signalTextColor}`}>
              <span>{!isLiveSynced ? '⏳' : isGreen ? '🟩' : isRed ? '🟥' : isUnknown ? '⚠️' : '🟨'}</span>
              <span>
                {!isLiveSynced
                  ? 'SYNCHRONIZING LIVE MARKET FEED...'
                  : isGreen
                  ? indicators.divType === 'bullish'
                    ? 'BULLISH DIVERGENCE LONG'
                    : indicators.candleMomentum
                    ? 'CANDLE MOMENTUM (POST-ONLY BEST BID) LONG'
                    : (indicators.tenk30m2BarsUp || indicators.tenk2BarsUp) && indicators.volumeGateMet
                    ? 'RISING 30m TENKAN (≥2 CANDLES) & VOLUME GATE (≥25K) LONG (2-BAR 5m CONFIRMED)'
                    : 'REVERSAL HOOK LONG (2-BAR 5m CONFIRMED)'
                  : isShort
                  ? 'BEARISH REVERSAL SHORT (2-BAR 5m CONFIRMED)'
                  : isRed
                  ? 'FLASH CRASH SIT-OUT (100% CASH)'
                  : isUnknown
                  ? 'SIGNAL UNKNOWN — 5M FEED UNAVAILABLE'
                  : 'YELLOW STANDBY MODE (100% CASH)'}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-neutral-300 leading-relaxed font-mono">
              {!isLiveSynced
                ? `Connecting to exchange matching engine and calculating real-time 15m/1h indicators for ${currentAsset}/USDT...`
                : isGreen
                ? `Active Regime: ${indicators.regime.replace(/_/g, ' ')} · Margin Collateral: $${indicators.recommendedMargin.toFixed(2)} · Position Size: $${(indicators.recommendedMargin * (indicators.activeTier === 'TIER_1' ? 20 : indicators.activeTier === 'TIER_2' ? 35 : 50)).toFixed(2)} (${indicators.activeTier === 'TIER_1' ? 'Tier 1: 20x' : indicators.activeTier === 'TIER_2' ? 'Tier 2: 35x' : 'Tier 3: 50x'} base · ${(indicators.tierRiskCapPct * 100).toFixed(0)}% Cap -$${indicators.tierRiskCapDollar.toFixed(2)}).${boostNote} ${indicators.orderExecutionType === 'POST_ONLY_BEST_BID' ? `Place Post-Only Limit Order directly at Best Bid at bar close ($${indicators.entryPrice.toFixed(2)}) for Maker rebates/zero-fee pricing.` : `Place Limit Buy Order ${Math.round(indicators.entryOffset * 100)}¢ below Close at $${indicators.entryPrice.toFixed(2)}${indicators.atr && indicators.atr < 0.35 ? ' (Tightened 0.10× ATR offset)' : ''} (or Market with 15m TTL).`} Targets: TP1 +${Math.round(indicators.tp1 * 100)}¢ (${indicators.tp1Percent}%), Extended TP2 +${Math.round(indicators.tp2 * 100)}¢ (${indicators.tp2Percent}% runner${indicators.regime === 'BULL_TREND_DRIFT' ? ', 1.50× ATR' : ''}), Stop Loss: Trailing ${indicators.slCoeff}× ATR.${indicators.isChop ? ' Chop trade: half margin, tighter targets.' : ''}`
                : isShort
                ? `Active Regime: ${indicators.regime.replace(/_/g, ' ')} · Margin Collateral: $${indicators.recommendedMargin.toFixed(2)} · Position Size: $${(indicators.recommendedMargin * (indicators.activeTier === 'TIER_1' ? 20 : indicators.activeTier === 'TIER_2' ? 35 : 50)).toFixed(2)} (${indicators.activeTier === 'TIER_1' ? 'Tier 1: 20x' : indicators.activeTier === 'TIER_2' ? 'Tier 2: 35x' : 'Tier 3: 50x'} base · ${(indicators.tierRiskCapPct * 100).toFixed(0)}% Cap -$${indicators.tierRiskCapDollar.toFixed(2)}).${boostNote} ${indicators.orderExecutionType === 'POST_ONLY_BEST_BID' ? `Place Post-Only Limit Order directly at Best Bid at bar close ($${indicators.entryPrice.toFixed(2)}) for Maker rebates/zero-fee pricing.` : `Place Limit Sell Order ${Math.round(indicators.entryOffset * 100)}¢ above Close at $${indicators.entryPrice.toFixed(2)}${indicators.atr && indicators.atr < 0.35 ? ' (Tightened 0.10× ATR offset)' : ''} (or Market with 15m TTL).`} Targets: TP1 -${Math.round(indicators.tp1 * 100)}¢ (${indicators.tp1Percent}%), Extended TP2 -${Math.round(indicators.tp2 * 100)}¢ (${indicators.tp2Percent}% runner), Stop Loss: Trailing ${indicators.slCoeff}× ATR.${indicators.isChop ? ' Chop trade: half margin, tighter targets.' : ''}`
                : isRed
                ? 'Liquidation cascade waterfall active (Flash Crash: ADX > 35 & 1H Red HTF). No new positions in either direction — sit-out in 100% Cash to preserve principal.'
                : isUnknown
                ? 'The 5-minute confirmation feed is unavailable, so no signal can be confirmed right now. This is NOT a buy or sell signal — the last confirmed state is not carried forward. 15m tiles below are still live; trading resumes automatically when the 5m feed returns.'
                : indicators.regime === 'MARKET_CHOP'
                ? 'ADX < 20 (Market Chop). Chop is TRADED at reduced size (half margin, tighter TP1, faster exits) — not sat out. Waiting for a hook + 2-bar 5m confirmation.'
                : 'No high-probability reversal setup confirmed. Standby in cash and wait for favorable support pullbacks.'}
            </p>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
            {/* Trade Setup Block (Phase 2: side-aware — shorts are a designed path, not a red error) */}
            <div className="flex-1 sm:w-28 bg-neutral-900/80 border border-white/10 rounded-lg p-2.5 text-center">
              <div className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">Trade Setup</div>
              <div className={`text-xs font-bold mt-0.5 ${!isLiveSynced ? 'text-amber-400' : isGreen ? 'text-emerald-400' : isShort ? 'text-rose-400' : 'text-neutral-400'}`}>
                {!isLiveSynced ? 'SYNCING...' : isGreen ? 'LONG TRIGGER' : isShort ? 'SHORT TRIGGER' : 'WAITING'}
              </div>
            </div>

            {/* 5m Fisher Exit Block */}
            <div className="flex-1 sm:w-32 bg-neutral-900/80 border border-white/10 rounded-lg p-2.5 text-center">
              <div className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">5m Fisher Exit</div>
              <div className={`text-xs font-bold mt-0.5 ${!isLiveSynced ? 'text-neutral-400' : indicators.fisher5mBearishCross ? 'text-rose-400' : 'text-emerald-400'}`}>
                {!isLiveSynced ? 'SYNCING...' : indicators.fisher5mBearishCross ? 'EXIT NOW' : 'HOLD / CLEAR'}
              </div>
            </div>

            {/* Market Regime Block */}
            <div className="flex-1 sm:w-36 bg-neutral-900/80 border border-white/10 rounded-lg p-2.5 text-center">
              <div className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">Market Regime</div>
              <div className="text-xs font-bold mt-0.5 text-blue-400 truncate">
                {!isLiveSynced ? 'CONNECTING...' : indicators.regime.replace(/_/g, ' ')}
              </div>
            </div>

            {/* Auto-Trader Daemon Toggle Block */}
            <button
              onClick={() => {
                const next = !autoTradeActive;
                setAutoTradeActive(next);
                fetch('/autotrade/toggle', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ enabled: next }),
                }).catch(() => {});
              }}
              className={`flex-1 sm:w-32 border rounded-lg p-2 text-center transition-all ${
                autoTradeActive
                  ? 'bg-emerald-950/40 border-emerald-500/40 hover:bg-emerald-900/50'
                  : 'bg-neutral-900/80 border-neutral-700 hover:bg-neutral-800'
              }`}
              title="Click to toggle automated order execution on Green and designed-Short signals"
            >
              <div className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider flex items-center justify-center gap-1">
                <span className={`w-2 h-2 rounded-full ${autoTradeActive ? 'bg-emerald-400 animate-pulse' : 'bg-neutral-500'}`} />
                <span>Auto-Trader</span>
              </div>
              <div className={`text-xs font-bold mt-0.5 ${autoTradeActive ? 'text-emerald-400' : 'text-neutral-400'}`}>
                {autoTradeActive ? 'AUTO-ON' : 'PAUSED'}
              </div>
            </button>

            {/* Confidence Gauge */}
            <div className="hidden sm:block border-l border-white/10 pl-3.5 text-right min-w-[150px]">
              <div className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">1H Trend Confidence</div>
              <div className={`text-sm font-bold mt-0.5 ${!isLiveSynced ? 'text-amber-400' : indicators.htfSignal === 'green' ? 'text-emerald-400' : indicators.htfSignal === 'yellow' ? 'text-amber-400' : 'text-rose-400'}`}>
                {!isLiveSynced ? 'SYNCING...' : indicators.confidence}
              </div>
              <div className="text-[10px] text-neutral-500 font-mono mt-0.5 truncate max-w-[180px]">
                {!isLiveSynced ? 'Reading orderbook...' : indicators.confidenceSub}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 5m Feed Warning (Phase 2): visible whenever the 5m feed is down
          while the 15m feed is live — an UNKNOWN signal must never look
          like a silent block or a stale green. */}
      {isLiveSynced && indicators.feedWarning && (
        <div className="bg-amber-950/80 border border-amber-500/50 rounded-xl p-3 flex items-center gap-2 text-xs text-amber-200 font-mono shadow-lg">
          <span className="text-base">⚠️</span>
          <span>{indicators.feedWarning}</span>
        </div>
      )}

      {/* Auto-Trade Notification Banner */}
      {autoTradeToast && (
        <div className="bg-emerald-950/80 border border-emerald-500/50 rounded-xl p-3 flex items-center justify-between text-xs text-emerald-200 font-mono shadow-lg animate-fadeIn">
          <div className="flex items-center gap-2">
            <span className="text-base">🤖</span>
            <span>{autoTradeToast}</span>
          </div>
          <button
            onClick={() => setAutoTradeToast(null)}
            className="text-neutral-400 hover:text-white text-xs px-2 py-0.5 bg-black/40 rounded transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* THE 15 INDIVIDUAL STATUS TILES */}
      <div className="space-y-2">
        {/* ROW 1: PRIMARY OSCILLATORS & VOLATILITY */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
          {/* Tile 1: CCI (20) */}
          <div className="bg-[#1c1c1a] border border-white/10 rounded-lg p-3 flex flex-col justify-between hover:border-white/20 transition-all">
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">CCI (20)</span>
            <div className="text-lg font-bold font-mono text-white my-1">
              {indicators.cci !== null ? indicators.cci.toFixed(2) : '-'}
            </div>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${indicators.cciUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
              {indicators.cciUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {indicators.cciUp ? 'Rising' : 'Falling / Flat'}
            </span>
          </div>

          {/* Tile 2: Fisher (9) */}
          <div className="bg-[#1c1c1a] border border-white/10 rounded-lg p-3 flex flex-col justify-between hover:border-white/20 transition-all">
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">Fisher (9)</span>
            <div className="text-lg font-bold font-mono text-white my-1">
              {indicators.fisher !== null ? indicators.fisher.toFixed(2) : '-'}
            </div>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${indicators.fishUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
              {indicators.fishUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {indicators.fishUp ? 'Rising' : 'Falling / Flat'}
            </span>
          </div>

          {/* Tile 3: Tenkan-sen */}
          <div className="bg-[#1c1c1a] border border-white/10 rounded-lg p-3 flex flex-col justify-between hover:border-white/20 transition-all">
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">Tenkan-sen</span>
            <div className="text-lg font-bold font-mono text-amber-300 my-1">
              {indicators.tenkan !== null ? `$${indicators.tenkan.toFixed(2)}` : '-'}
            </div>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${indicators.tenk30m2BarsUp ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold' : indicators.tenk2BarsUp ? 'bg-emerald-500/15 text-emerald-400' : indicators.tenkUp ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/15 text-rose-400'}`}>
              {indicators.tenkUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {indicators.tenk30m2BarsUp ? 'Rising 30m (≥2 Candles ✓)' : indicators.tenk2BarsUp ? 'Rising (2 Candles)' : indicators.tenkUp ? 'Rising (1 Candle)' : 'Falling / Flat'}
            </span>
          </div>

          {/* Tile 4: VWMA (20) */}
          <div className="bg-[#1c1c1a] border border-white/10 rounded-lg p-3 flex flex-col justify-between hover:border-white/20 transition-all">
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">VWMA (20)</span>
            <div className="text-lg font-bold font-mono text-purple-300 my-1">
              {indicators.vwma !== null ? `$${indicators.vwma.toFixed(2)}` : '-'}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-neutral-400 font-mono">
                {indicators.vwmaDist !== null ? `${indicators.vwmaDist >= 0 ? '+' : ''}${indicators.vwmaDist.toFixed(2)}% vs price` : '-'}
              </span>
              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${indicators.vwmaUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
                {indicators.vwmaStatus}
              </span>
            </div>
          </div>

          {/* Tile 5: Volume */}
          <div className="bg-[#1c1c1a] border border-white/10 rounded-lg p-3 flex flex-col justify-between hover:border-white/20 transition-all">
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">Volume (15m)</span>
            <div className="text-lg font-bold font-mono text-white my-1">
              {indicators.volume}
            </div>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${indicators.volumeGateMet ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold' : indicators.volOK ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
              {indicators.volumeGateMet ? '≥25K Gate Met ✓' : indicators.volOK ? 'Above avg' : 'Below avg'}
            </span>
          </div>

          {/* Tile 6: ATR (14) */}
          <div className="bg-[#1c1c1a] border border-white/10 rounded-lg p-3 flex flex-col justify-between hover:border-white/20 transition-all">
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">ATR (14)</span>
            <div className="text-lg font-bold font-mono text-white my-1">
              {indicators.atr !== null ? indicators.atr.toFixed(3) : '-'}
            </div>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${indicators.atrOK ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
              {indicators.atrOK ? 'Expanding' : 'Contracting'}
            </span>
          </div>

          {/* Tile 7: ADX (14) */}
          <div className="bg-[#1c1c1a] border border-white/10 rounded-lg p-3 flex flex-col justify-between hover:border-white/20 transition-all">
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">ADX (14)</span>
            <div className="text-lg font-bold font-mono text-white my-1">
              {indicators.adx !== null ? indicators.adx.toFixed(1) : '-'}
            </div>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${indicators.adxOK ? 'bg-emerald-500/15 text-emerald-400' : indicators.adx && indicators.adx > 20 ? 'bg-neutral-800 text-neutral-300' : 'bg-amber-500/15 text-amber-400'}`}>
              {indicators.adxStatus}
            </span>
          </div>
        </div>

        {/* ROW 2: CONFIRMATION TILES & MULTI-TIMEFRAME FILTERS */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
          {/* Tile 8: Session */}
          <div className="bg-[#1c1c1a] border border-white/10 rounded-lg p-3 flex flex-col justify-between hover:border-white/20 transition-all">
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">Session</span>
            <div className="text-sm font-bold font-mono text-white my-1 truncate">
              {indicators.sessionName}
            </div>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${indicators.sessionOK ? 'bg-emerald-500/15 text-emerald-400' : 'bg-neutral-800 text-neutral-400'}`}>
              {indicators.sessionOK ? 'Active' : 'Quiet'}
            </span>
          </div>

          {/* Tile 9: HTF Trend (1H) */}
          <div className="bg-[#1c1c1a] border border-white/10 rounded-lg p-3 flex flex-col justify-between hover:border-white/20 transition-all">
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">HTF Trend</span>
            <div className="text-sm font-bold font-mono text-white my-1 flex items-center gap-1">
              <span>{indicators.htfSignal === 'green' ? '🟩' : indicators.htfSignal === 'yellow' ? '🟨' : '🟥'}</span>
              <span>{indicators.htfSignal.toUpperCase()}</span>
            </div>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${indicators.htfSignal === 'green' ? 'bg-emerald-500/15 text-emerald-400' : indicators.htfSignal === 'yellow' ? 'bg-amber-500/15 text-amber-400' : 'bg-rose-500/15 text-rose-400'}`}>
              {indicators.htfSignal === 'green' ? 'Aligned' : indicators.htfSignal === 'yellow' ? 'Caution' : 'Opposing'}
            </span>
          </div>

          {/* Tile 10: Candle */}
          <div className="bg-[#1c1c1a] border border-white/10 rounded-lg p-3 flex flex-col justify-between hover:border-white/20 transition-all">
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">Candle</span>
            <div className="text-sm font-bold font-mono text-white my-1">
              {indicators.candleMomentum ? 'Momentum Bar' : indicators.candleBullish ? 'Bullish' : 'Bearish'}
            </div>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${indicators.candleMomentum ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold' : indicators.candleBullish ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
              {indicators.candleMomentum ? 'Post-Only Best Bid' : indicators.candleLabel}
            </span>
          </div>

          {/* Tile 11: Divergence */}
          <div className="bg-[#1c1c1a] border border-white/10 rounded-lg p-3 flex flex-col justify-between hover:border-white/20 transition-all">
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">Divergence</span>
            <div className="text-sm font-bold font-mono text-white my-1 truncate">
              {indicators.divergence}
            </div>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${indicators.divType === 'bullish' ? 'bg-emerald-500/15 text-emerald-400' : indicators.divType === 'bearish' ? 'bg-rose-500/15 text-rose-400' : 'bg-neutral-800 text-neutral-400'}`}>
              {indicators.divType === 'bullish' ? 'Bullish div' : indicators.divType === 'bearish' ? 'Bearish div' : 'No divergence'}
            </span>
          </div>

          {/* Tile 12: CCI Momentum */}
          <div className="bg-[#1c1c1a] border border-white/10 rounded-lg p-3 flex flex-col justify-between hover:border-white/20 transition-all">
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">CCI Momentum</span>
            <div className="text-sm font-bold font-mono text-white my-1">
              {indicators.cciAccel ? 'Accel' : 'Deccel'}
            </div>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${indicators.cciAccel ? 'bg-emerald-500/15 text-emerald-400' : 'bg-neutral-800 text-neutral-400'}`}>
              {indicators.cciAccel ? 'Accelerating' : 'Slowing'}
            </span>
          </div>

          {/* Tile 13: 5m Fisher Exit */}
          <div className="bg-[#1c1c1a] border border-white/10 rounded-lg p-3 flex flex-col justify-between hover:border-white/20 transition-all">
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">5m Fisher Exit</span>
            <div className="text-sm font-bold font-mono text-white my-1">
              {indicators.fisher5mVal !== null ? indicators.fisher5mVal.toFixed(2) : '-'}
            </div>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${indicators.fisher5mBearishCross ? 'bg-rose-500 text-white font-bold animate-pulse' : indicators.fisher5mUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-neutral-800 text-neutral-400'}`}>
              {indicators.fisher5mBearishCross ? 'SELL TRIGGER' : indicators.fisher5mUp ? 'Bullish (↑)' : 'Neutral (↓)'}
            </span>
          </div>

          {/* Tile 14: 2-Bar Confirm (5m) — Phase 2: shows the count for
              the active direction (green run for longs, red run for
              shorts), not always the green count. */}
          <div className="bg-[#1c1c1a] border border-white/10 rounded-lg p-3 flex flex-col justify-between hover:border-white/20 transition-all">
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">2-Bar Confirm (5m){indicators.triggerDirection === 'short' ? ' — RED' : ''}</span>
            <div className="text-sm font-bold font-mono text-white my-1">
              {confirmCount}/2
            </div>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${confirmCount >= 2 ? 'bg-emerald-500/15 text-emerald-400' : confirmCount === 1 ? 'bg-amber-500/15 text-amber-400' : 'bg-neutral-800 text-neutral-400'}`}>
              {confirmCount >= 2 ? 'Confirmed (2/2)' : confirmCount === 1 ? '1 bar (1/2)' : 'Waiting (0/2)'}
            </span>
          </div>

          {/* Tile 15: Cooldown */}
          <div className="bg-[#1c1c1a] border border-white/10 rounded-lg p-3 flex flex-col justify-between hover:border-white/20 transition-all">
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">Cooldown</span>
            <div className="text-sm font-bold font-mono text-white my-1">
              {indicators.cooldownBars > 0 ? `${indicators.cooldownBars} bars` : 'Clear'}
            </div>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${indicators.cooldownBars > 0 ? 'bg-rose-500/15 text-rose-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
              {indicators.cooldownBars > 0 ? 'Cooling down' : 'Ready'}
            </span>
          </div>
        </div>
      </div>

      {/* 4 SYNCHRONIZED CHARTS: PRICE CANDLESTICKS, CCI, FISHER, ATR */}
      <LiveIndicatorCharts
        candles={chartCandles}
        currentAsset={currentAsset}
        timeframe={chartTimeframe}
        onTimeframeChange={(tf) => setChartTimeframe(tf)}
      />

      {/* 5. CALCULATOR & TODAY'S TRADES FROM INDEX.HTML */}
      <DashboardCalculator
        currentAsset={currentAsset}
        currentPrice={indicators.price}
        portfolioBalance={portfolioBalance}
        onUpdatePortfolioBalance={handleUpdatePortfolioBalance}
      />
    </div>
  );
};
