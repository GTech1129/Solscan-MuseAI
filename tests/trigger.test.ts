// tests/trigger.test.ts — unit tests for the canonical trigger
// (src/engine/trigger.ts). Run with: npm test  (tsx --test tests/*.test.ts)
// These tests pin the Phase 2 contract: one trigger, long + designed
// short paths, chop traded at reduced size, flash-crash sit-out both
// directions, no auto-confirm, feed failure -> UNKNOWN, no guessing on
// conflicting hooks, and penny-scale ATR-tightened offsets.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateTrigger,
  type TriggerInputs,
} from '../src/engine/trigger.ts';

function base(over: Partial<TriggerInputs> = {}): TriggerInputs {
  return {
    price: 101,
    vwma: 100,
    atr: 0.4,
    adx: 25,
    prevAdx: 24,
    htfSignal: 'yellow',
    cciUp: false,
    fishUp: false,
    bullishCandle: false,
    tenkRising2Candles: false,
    volumeGateMet: false,
    cciDown: false,
    fishDown: false,
    bearishCandle: false,
    tenkFalling2Candles: false,
    consecutiveGreen5m: 0,
    consecutiveRed5m: 0,
    fiveMinFeedOk: true,
    balance: 30,
    candleHigh: 101.5,
    candleLow: 100.5,
    candleClose: 101,
    ...over,
  };
}

const longHook = {
  cciUp: true,
  fishUp: true,
  bullishCandle: true,
  consecutiveGreen5m: 2,
};

const shortHook = {
  cciDown: true,
  fishDown: true,
  bearishCandle: true,
  consecutiveRed5m: 2,
};

describe('canonical trigger', () => {
  it('standard long fires in RANGE with full tier margin', () => {
    const r = evaluateTrigger(base(longHook));
    assert.equal(r.state, 'LONG');
    assert.equal(r.uiSignal, 'green');
    assert.equal(r.direction, 'long');
    assert.equal(r.designedShort, false);
    assert.equal(r.regime, 'RANGE_BOUND_SUPPORT');
    assert.equal(r.margin, 25); // T1: min($30, $25)
    assert.equal(r.marginMultiplier, 1);
    assert.equal(r.isChop, false);
    assert.equal(r.tp1Dist, 0.35);
    assert.equal(r.tp2Dist, 0.55);
    assert.equal(r.slCoeff, 1.2);
    assert.equal(r.leverage, 20); // base; server adds +10x boost on top
  });

  it('slow-bull long fires in RANGE (Tenkan 2 bars + volume >= 25k)', () => {
    const r = evaluateTrigger(base({
      tenkRising2Candles: true,
      volumeGateMet: true,
      consecutiveGreen5m: 2,
    }));
    assert.equal(r.state, 'LONG');
    assert.equal(r.reason, 'tenkan_2candles_volume_gate_long');
    assert.equal(r.margin, 25);
  });

  it('slow-bull long fires in CHOP at reduced size', () => {
    const r = evaluateTrigger(base({
      adx: 12,
      tenkRising2Candles: true,
      volumeGateMet: true,
      consecutiveGreen5m: 2,
    }));
    assert.equal(r.state, 'LONG');
    assert.equal(r.regime, 'MARKET_CHOP');
    assert.equal(r.isChop, true);
    assert.equal(r.margin, 12.5); // half tier margin
    assert.equal(r.marginMultiplier, 0.5);
    assert.equal(r.tp1Dist, 0.2);
    assert.equal(r.tp2Dist, 0.41); // 0.55 x 0.75, rounded to cents
  });

  it('chop long (standard hook, ADX < 20) trades at reduced size', () => {
    const r = evaluateTrigger(base({ adx: 12, ...longHook }));
    assert.equal(r.state, 'LONG');
    assert.equal(r.isChop, true);
    assert.equal(r.margin, 12.5);
    assert.equal(r.tp1Dist, 0.2);
    // Stops are NOT tightened in chop (ATR-based, unchanged).
    assert.equal(r.slCoeff, 1.2);
  });

  it('chop short trades at reduced size with the designed-short marker', () => {
    const r = evaluateTrigger(base({ adx: 12, ...shortHook }));
    assert.equal(r.state, 'SHORT');
    assert.equal(r.uiSignal, 'red');
    assert.equal(r.direction, 'short');
    assert.equal(r.designedShort, true);
    assert.equal(r.isChop, true);
    assert.equal(r.margin, 12.5);
    assert.equal(r.tp1Dist, 0.2);
  });

  it('bear short fires with full margin (price below VWMA, HTF red, ADX <= 35)', () => {
    const r = evaluateTrigger(base({
      price: 99,
      htfSignal: 'red',
      ...shortHook,
    }));
    assert.equal(r.state, 'SHORT');
    assert.equal(r.regime, 'RANGE_BOUND_SUPPORT'); // not flash: ADX 25 <= 35
    assert.equal(r.margin, 25);
    assert.equal(r.tp1Dist, 0.35);
  });

  it('flash crash sits out longs (ADX > 35 + HTF red + price below VWMA)', () => {
    const r = evaluateTrigger(base({
      price: 99,
      htfSignal: 'red',
      adx: 40,
      ...longHook,
    }));
    assert.equal(r.state, 'NONE');
    assert.equal(r.uiSignal, 'red'); // red tile, but NO direction
    assert.equal(r.direction, null);
    assert.equal(r.regime, 'FLASH_CRASH');
    assert.equal(r.reason, 'flash_crash_sitout');
    assert.equal(r.margin, 0);
  });

  it('flash crash sits out shorts too (no new shorts into a cascade)', () => {
    const r = evaluateTrigger(base({
      price: 99,
      htfSignal: 'red',
      adx: 40,
      ...shortHook,
    }));
    assert.equal(r.state, 'NONE');
    assert.equal(r.direction, null);
    assert.equal(r.margin, 0);
  });

  it('doji / no-hook bars produce NONE (yellow)', () => {
    const r = evaluateTrigger(base({}));
    assert.equal(r.state, 'NONE');
    assert.equal(r.uiSignal, 'yellow');
    assert.equal(r.direction, null);
    assert.equal(r.margin, 0);
  });

  it('omitted confirmation counts are 0 — never auto-confirmed', () => {
    const input = base({ cciUp: true, fishUp: true, bullishCandle: true });
    delete (input as Partial<TriggerInputs>).consecutiveGreen5m;
    delete (input as Partial<TriggerInputs>).consecutiveRed5m;
    const r = evaluateTrigger(input);
    assert.equal(r.state, 'NONE');
    assert.equal(r.confirmation.long, 0);
    assert.equal(r.confirmation.longOk, false);
  });

  it('1-bar confirmation is not enough (needs 2)', () => {
    const r = evaluateTrigger(base({ ...longHook, consecutiveGreen5m: 1 }));
    assert.equal(r.state, 'NONE');
    assert.equal(r.confirmation.longOk, false);
  });

  it('5m feed failure yields UNKNOWN, never a stale green', () => {
    const r = evaluateTrigger(base({ ...longHook, fiveMinFeedOk: false }));
    assert.equal(r.state, 'UNKNOWN');
    assert.equal(r.uiSignal, 'unknown');
    assert.equal(r.direction, null);
    assert.equal(r.margin, 0);
    assert.equal(r.feedOk, false);
  });

  it('conflicting hooks never guess (NONE, yellow)', () => {
    // CCI/Fisher rising (long hook) + Tenkan falling 2 bars with
    // volume (slow-bear hook) + both confirmations: the trigger must
    // refuse, not pick a side.
    const r = evaluateTrigger(base({
      cciUp: true,
      fishUp: true,
      bullishCandle: true,
      tenkFalling2Candles: true,
      volumeGateMet: true,
      consecutiveGreen5m: 2,
      consecutiveRed5m: 2,
    }));
    assert.equal(r.state, 'NONE');
    assert.equal(r.uiSignal, 'yellow');
    assert.equal(r.reason, 'conflicting_hooks');
    assert.equal(r.margin, 0);
  });

  it('VWMA null yields NONE (yellow), not a trade', () => {
    const r = evaluateTrigger(base({ vwma: null, ...longHook }));
    assert.equal(r.state, 'NONE');
    assert.equal(r.reason, 'vwma_null');
    assert.equal(r.margin, 0);
  });

  it('BULL trend drift uses max(1.20, 1.50x ATR) for TP2', () => {
    const r = evaluateTrigger(base({
      htfSignal: 'green',
      price: 101,
      vwma: 100,
      adx: 50,
      ...longHook,
    }));
    assert.equal(r.state, 'LONG');
    assert.equal(r.regime, 'BULL_TREND_DRIFT');
    assert.equal(r.tp2Dist, 1.2); // max(1.20, 1.50 x 0.40 = 0.60)
  });

  it('entry offsets work at penny scale (ATR-tightened)', () => {
    // Momentum bar (close within 0.10% of high) -> post-only best bid.
    const mom = evaluateTrigger(base({
      ...longHook,
      candleHigh: 101.05,
      candleClose: 101,
    }));
    assert.equal(mom.entryOffset, 0);
    assert.equal(mom.orderExecutionType, 'POST_ONLY_BEST_BID');

    // Compressed tape (ATR < 0.35) -> 0.10x ATR clamped to 3-5c.
    const tight = evaluateTrigger(base({
      ...longHook,
      atr: 0.3,
      candleHigh: 101.5,
      candleClose: 101,
    }));
    assert.equal(tight.entryOffset, 0.03);

    // Normal tape -> 0.25x ATR clamped to 8-20c.
    const normal = evaluateTrigger(base({
      ...longHook,
      atr: 0.4,
      candleHigh: 101.5,
      candleClose: 101,
    }));
    assert.equal(normal.entryOffset, 0.1);

    // Short momentum (close within 0.10% of low) -> post-only best bid.
    const shortMom = evaluateTrigger(base({
      ...shortHook,
      candleLow: 100.95,
      candleClose: 101,
    }));
    assert.equal(shortMom.entryOffset, 0);
    assert.equal(shortMom.orderExecutionType, 'POST_ONLY_BEST_BID');
  });

  it('tier margins follow balance (T1/T2/T3 canonical formulas)', () => {
    const t1 = evaluateTrigger(base({ balance: 30, ...longHook }));
    assert.equal(t1.tier, 'TIER_1');
    assert.equal(t1.margin, 25);
    const t2 = evaluateTrigger(base({ balance: 150, ...longHook }));
    assert.equal(t2.tier, 'TIER_2');
    assert.equal(t2.margin, 50); // min(150 x 0.50, 50)
    assert.equal(t2.leverage, 35);
    const t3 = evaluateTrigger(base({ balance: 500, ...longHook }));
    assert.equal(t3.tier, 'TIER_3');
    assert.equal(t3.margin, 100); // min(500 x 0.40, 100)
    assert.equal(t3.leverage, 50);
  });
});
