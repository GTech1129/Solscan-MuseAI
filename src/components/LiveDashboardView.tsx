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
  calcHTFSignal, 
  detectBullDiv,
  calcSignalEngine
} from '../engine/indicators.ts';
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
  cooldownBars: number;
  // Master Signal & Regime
  signal: 'green' | 'yellow' | 'red';
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
  cooldownBars: 0,
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
      const sma50Arr = calcSMA(cC, 50);
      const atrArr = calcATR(cH, cL, cC, 14);
      const adxArr = calcADX(cH, cL, cC, 14);

      const cciValid = cciArr.filter((x): x is number => x != null);
      const curCCI = cciValid.length > 0 ? cciValid[cciValid.length - 1] : 0;
      const prevCCI = cciValid.length > 1 ? cciValid[cciValid.length - 2] : 0;
      const cciUp = curCCI > prevCCI;

      const fisherValid = fisherArr.filter((x): x is number => x != null);
      const curFisher = fisherValid.length > 0 ? fisherValid[fisherValid.length - 1] : 0;
      const prevFisher = fisherValid.length > 1 ? fisherValid[fisherValid.length - 2] : 0;
      const fishUp = curFisher > prevFisher;

      const tenkanValid = tenkanArr.filter((x): x is number => x != null);
      const curTenkan = tenkanValid.length > 0 ? tenkanValid[tenkanValid.length - 1] : curPrice;
      const prevTenkan = tenkanValid.length > 1 ? tenkanValid[tenkanValid.length - 2] : curPrice;
      const prev2Tenkan = tenkanValid.length > 2 ? tenkanValid[tenkanValid.length - 3] : prevTenkan;
      const tenkUp = curTenkan > prevTenkan;
      const tenk2BarsUp = tenkanValid.length >= 3 && curTenkan > prevTenkan && prevTenkan > prev2Tenkan;

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

      // 2. Candle Momentum Detection: Close >= High - (0.0010 * Close)
      // Confirms the current 15m bar closed within 0.10% of its high (virtually no upper wick)
      const lastBarClose = cC[cC.length - 1];
      const lastBarHigh = cH[cH.length - 1];
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

      // 5m Bar Confirmation & Fisher Exit Check
      let lastFisher5mVal: number | null = null;
      let fisher5mBearishCross = false;
      let fisher5mUp = false;
      let consecutiveGreen5m = 0;

      if (raw5m && Array.isArray(raw5m) && raw5m.length > 5) {
        // Evaluate the last 2 completed 5m bars (excluding forming in-progress candle)
        const closed5mBars = raw5m.slice(0, -1);
        if (closed5mBars.length >= 2) {
          const bar1 = closed5mBars[closed5mBars.length - 1]; // most recent closed 5m bar
          const bar2 = closed5mBars[closed5mBars.length - 2]; // 2nd most recent closed 5m bar
          const bar1Green = parseFloat(bar1[4]) >= parseFloat(bar1[1]); // Close >= Open
          const bar2Green = parseFloat(bar2[4]) >= parseFloat(bar2[1]);

          if (bar1Green && bar2Green) {
            consecutiveGreen5m = 2;
          } else if (bar1Green) {
            consecutiveGreen5m = 1;
          } else {
            consecutiveGreen5m = 0;
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

      // Regime & Overall Signal via synchronized calcSignalEngine
      const cciDivType: 'bullish' | 'bearish' | 'none' = hasBullDiv ? 'bullish' : 'none';
      const sigRes = calcSignalEngine(
        cciUp,
        fishUp,
        tenkUp,
        curPrice,
        curVWMA,
        sma50Arr.filter((x): x is number => x != null).slice(-1)[0] ?? null,
        volOK,
        atrOK,
        adxOK,
        fishUp,
        htfSignal,
        candleBullish,
        cciDivType,
        'none',
        cciAccel,
        curADX,
        curATR,
        prevADX,
        lastVol,
        tenk30m2BarsUp || tenk2BarsUp,
        lastBarHigh,
        lastBarClose,
        portfolioBalance,
        consecutiveGreen5m,
      );

      // 6) Ultra-Low ADX Filter (ADX < 12 & Vol > 35K -> Forced Yellow Standby / 0x Leverage Sit-Out)
      if (curADX < 12 && (lastVol > 35000 || volOK)) {
        sigRes.signal = 'yellow';
        sigRes.regime = 'MARKET_CHOP';
        sigRes.recommendedMargin = 0;
      }

      const entryPrice = sigRes.signal === 'green' ? curPrice - sigRes.entryOffset : curPrice + sigRes.entryOffset;

      let confidence: 'HIGH CONFIDENCE' | 'MEDIUM CONFIDENCE' | 'LOW CONFIDENCE' = 'MEDIUM CONFIDENCE';
      let confidenceSub = '1H HTF is Neutral (Consolidation)';
      if (curADX < 12 && (lastVol > 35000 || volOK)) {
        confidence = 'LOW CONFIDENCE';
        confidenceSub = `ADX (14) = ${curADX.toFixed(1)} < 12 with Volume > 35K: Ultra-Low ADX Chop Sit-Out`;
      } else if (volumeGateMet && consecutiveGreen5m < 2) {
        confidence = 'MEDIUM CONFIDENCE';
        confidenceSub = `Volume Gate ≥25K Met (${volStr}): Waiting for 2-Bar Confirmation on 5m chart (${consecutiveGreen5m}/2 bars)`;
      } else if (htfSignal === 'green') {
        confidence = 'HIGH CONFIDENCE';
        confidenceSub = consecutiveGreen5m >= 2 ? '1H HTF Bullish & 2-Bar 5m Confirmed' : '1H HTF Bullish Alignment';
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
        adxStatus: curADX < 12 ? 'Ultra-Low (<12)' : adxStatus,
        adxOK,
        sessionName,
        sessionOK,
        htfSignal,
        candleBullish,
        candleLabel,
        candleMomentum,
        orderExecutionType: sigRes.orderExecutionType,
        divergence,
        divType,
        cciAccel,
        fisher5mVal: lastFisher5mVal,
        fisher5mBearishCross,
        fisher5mUp,
        consecutiveGreen: consecutiveGreen5m,
        cooldownBars: sigRes.signal === 'red' ? 2 : 0,
        signal: sigRes.signal,
        regime: sigRes.regime,
        entryPrice,
        entryOffset: sigRes.entryOffset,
        tp1: sigRes.tp1,
        tp2: sigRes.tp2,
        tp1Percent: sigRes.tp1Percent,
        tp2Percent: sigRes.tp2Percent,
        slCoeff: sigRes.slCoeff,
        recommendedMargin: sigRes.recommendedMargin,
        activeTier: sigRes.activeTier,
        tierRiskCapPct: sigRes.tierRiskCapPct,
        tierRiskCapDollar: sigRes.tierRiskCapDollar,
        setupGrade: sigRes.setupGrade,
        adxSlope: sigRes.adxSlope,
        isExhaustionReversal: sigRes.isExhaustionReversal,
        earlyProfitLock: sigRes.earlyProfitLock,
        trailingStopOffset: sigRes.trailingStopOffset,
        limitOrderTTLMinutes: sigRes.limitOrderTTLMinutes,
        confidence,
        confidenceSub,
      });

      // Synchronize signal and Green Gate status with backend daemon and listeners
      fetch('/signal-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signal: sigRes.signal,
          regime: sigRes.regime,
          price: curPrice,
          isGreenGate: sigRes.signal === 'green',
        }),
      }).catch(() => {});
      window.dispatchEvent(
        new CustomEvent('SIGNAL_UPDATED', {
          detail: {
            signal: sigRes.signal,
            isGreenGate: sigRes.signal === 'green',
            regime: sigRes.regime,
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

  // Synchronize incoming telemetry from iframe when dashboard.html runs
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        if (!event.data) return;
        if (event.data.type === 'DASHBOARD_INDICATORS' && event.data.data) {
          const d = event.data.data;
          const sig = d.sigObj?.signal || (d.isLongTrigger ? 'green' : 'yellow');
          const reg = d.sigObj?.regime || 'RANGE_BOUND_SUPPORT';
          const off = d.sigObj?.entryOffset || 0.08;
          const ep = sig === 'green' ? d.price - off : d.price + off;

          let conf: 'HIGH CONFIDENCE' | 'MEDIUM CONFIDENCE' | 'LOW CONFIDENCE' = 'MEDIUM CONFIDENCE';
          let confSub = '1H HTF is Neutral (Consolidation)';
          if (d.htfSignal === 'green') {
            conf = 'HIGH CONFIDENCE';
            confSub = '1H HTF Bullish Alignment';
          } else if (d.htfSignal === 'red') {
            conf = 'LOW CONFIDENCE';
            confSub = '1H HTF Opposing Bearish Bias';
          }

          setIndicators((prev) => ({
            ...prev,
            price: d.price || prev.price,
            priceChange: d.priceChange ?? prev.priceChange,
            cci: d.cci ?? prev.cci,
            cciUp: d.cciUp ?? prev.cciUp,
            fisher: d.fisher ?? prev.fisher,
            fishUp: d.fishUp ?? prev.fishUp,
            tenkan: d.tenkan ?? prev.tenkan,
            tenkUp: d.tenkUp ?? prev.tenkUp,
            vwma: d.vwma ?? prev.vwma,
            volOK: d.volOK ?? prev.volOK,
            atr: d.atr ?? prev.atr,
            atrOK: d.atrOK ?? prev.atrOK,
            adx: d.adx ?? prev.adx,
            adxOK: d.adxOK ?? prev.adxOK,
            sessionName: d.sessionName ?? prev.sessionName,
            sessionOK: d.sessionOK ?? prev.sessionOK,
            htfSignal: d.htfSignal ?? prev.htfSignal,
            candleBullish: d.bullishCandle ?? prev.candleBullish,
            cciAccel: d.cciAccel ?? prev.cciAccel,
            fisher5mVal: d.fisher5mVal ?? prev.fisher5mVal,
            fisher5mBearishCross: d.fisher5mBearishCross ?? prev.fisher5mBearishCross,
            fisher5mUp: d.fisher5mUp ?? prev.fisher5mUp,
            consecutiveGreen: d.consecutiveGreen ?? prev.consecutiveGreen,
            cooldownBars: d.cooldownBars ?? prev.cooldownBars,
            signal: sig,
            regime: reg,
            entryPrice: ep,
            entryOffset: off,
            tp1: d.sigObj?.tp1 || 0.35,
            tp2: d.sigObj?.tp2 || 0.75,
            slCoeff: d.sigObj?.slCoeff || 1.5,
            recommendedMargin: d.sigObj?.recommendedMargin ?? (sig === 'red' ? 0 : 120),
            confidence: conf,
            confidenceSub: confSub,
          }));
          setLastUpdated(new Date().toLocaleTimeString());
        }
      } catch (_) {}
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Autonomous Signal Dispatcher: Automatically forwards Green Signals to Bot Daemon
  useEffect(() => {
    if (!isLiveSynced || indicators.signal !== 'green' || !autoTradeActive) return;

    const now = Date.now();
    // Debounce to at most 1 automatic order per 5 minutes per asset
    if (now - lastAutoTradeTimeRef.current < 5 * 60 * 1000) return;

    lastAutoTradeTimeRef.current = now;
    console.log(`[AUTOTRADE DISPATCHER] 🟩 Green Signal confirmed for ${currentAsset}! Forwarding order to execution daemon...`);

    fetch('/signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asset: currentAsset,
        direction: 'buy',
        price: indicators.price,
        entryOffset: indicators.entryOffset,
        recommendedMargin: indicators.recommendedMargin,
        candleMomentum: indicators.candleMomentum,
        orderExecutionType: indicators.orderExecutionType,
        executionType: indicators.orderExecutionType,
        tenk30m2BarsUp: indicators.tenk30m2BarsUp,
        volumeGateMet: indicators.volumeGateMet,
        volume: indicators.volume,
        barConfirmation: indicators.consecutiveGreen,
        consecutiveGreen: indicators.consecutiveGreen,
        chartTimeframe,
        tp1: indicators.tp1,
        tp2: indicators.tp2,
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
          setAutoTradeToast(`🤖 Auto-Trade Placed: Long ${currentAsset} @ $${data.entryPrice?.toFixed(2) || indicators.entryPrice} | PDA: ${data.requestPDA?.slice(0, 8)}...`);
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
              <span>{!isLiveSynced ? '⏳' : isGreen ? '🟩' : isRed ? '🟥' : '🟨'}</span>
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
                  : isRed
                  ? 'FLASH CRASH SIT-OUT (100% CASH)'
                  : 'YELLOW STANDBY MODE (100% CASH)'}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-neutral-300 leading-relaxed font-mono">
              {!isLiveSynced
                ? `Connecting to exchange matching engine and calculating real-time 15m/1h indicators for ${currentAsset}/USDT...`
                : isGreen
                ? `Active Regime: ${indicators.regime.replace(/_/g, ' ')} · Margin Collateral: $${indicators.recommendedMargin.toFixed(2)} · Position Size: $${(indicators.recommendedMargin * (indicators.activeTier === 'TIER_1' ? 20 : indicators.activeTier === 'TIER_2' ? 35 : 50)).toFixed(2)} (${indicators.activeTier === 'TIER_1' ? 'Tier 1: 20x' : indicators.activeTier === 'TIER_2' ? 'Tier 2: 35x' : 'Tier 3: 50x'} · ${(indicators.tierRiskCapPct * 100).toFixed(0)}% Cap -$${indicators.tierRiskCapDollar.toFixed(2)}). ${indicators.orderExecutionType === 'POST_ONLY_BEST_BID' ? `Place Post-Only Limit Order directly at Best Bid at bar close ($${indicators.entryPrice.toFixed(2)}) for Maker rebates/zero-fee pricing.` : `Place Limit Buy Order ${Math.round(indicators.entryOffset * 100)}¢ below Close at $${indicators.entryPrice.toFixed(2)}${indicators.atr && indicators.atr < 0.35 ? ' (Tightened 0.10× ATR offset)' : ''} (or Market with 15m TTL).`} Targets: TP1 +${Math.round(indicators.tp1 * 100)}¢ (${indicators.tp1Percent}%), Extended TP2 +${Math.round(indicators.tp2 * 100)}¢ (${indicators.tp2Percent}% 1.50× ATR Runner)${indicators.regime === 'RANGE_BOUND_SUPPORT' ? ' (+15¢ Runner Floor)' : ''}, Stop Loss: Trailing ${indicators.slCoeff}× ATR.`
                : isRed
                ? 'Liquidation cascade waterfall active (Flash Crash: ADX > 35 & 1H Red HTF). Symmetrical sit-out in 100% Cash to preserve principal.'
                : indicators.regime === 'MARKET_CHOP'
                ? 'ADX < 20 (Market Chop). Symmetrical sit-out in 100% Cash to eliminate low-volatility churn.'
                : 'No high-probability reversal setup confirmed. Standby in cash and wait for favorable support pullbacks.'}
            </p>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
            {/* Buy Setup Block */}
            <div className="flex-1 sm:w-28 bg-neutral-900/80 border border-white/10 rounded-lg p-2.5 text-center">
              <div className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">Buy Setup</div>
              <div className={`text-xs font-bold mt-0.5 ${!isLiveSynced ? 'text-amber-400' : isGreen ? 'text-emerald-400' : 'text-neutral-400'}`}>
                {!isLiveSynced ? 'SYNCING...' : isGreen ? 'LONG TRIGGER' : 'WAITING'}
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
              title="Click to toggle automated order execution on Green Signals"
            >
              <div className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider flex items-center justify-center gap-1">
                <span className={`w-2 h-2 rounded-full ${autoTradeActive ? 'bg-emerald-400 animate-pulse' : 'bg-neutral-500'}`} />
                <span>Auto-Trader</span>
              </div>
              <div className={`text-xs font-bold mt-0.5 ${autoTradeActive ? 'text-emerald-400' : 'text-neutral-400'}`}>
                {autoTradeActive ? 'ARMED (ON)' : 'PAUSED'}
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

          {/* Tile 14: 2-Bar Confirm (5m) */}
          <div className="bg-[#1c1c1a] border border-white/10 rounded-lg p-3 flex flex-col justify-between hover:border-white/20 transition-all">
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">2-Bar Confirm (5m)</span>
            <div className="text-sm font-bold font-mono text-white my-1">
              {indicators.consecutiveGreen}/2
            </div>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${indicators.consecutiveGreen >= 2 ? 'bg-emerald-500/15 text-emerald-400' : indicators.consecutiveGreen === 1 ? 'bg-amber-500/15 text-amber-400' : 'bg-neutral-800 text-neutral-400'}`}>
              {indicators.consecutiveGreen >= 2 ? 'Confirmed (2/2)' : indicators.consecutiveGreen === 1 ? '1 bar (1/2)' : 'Waiting (0/2)'}
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
