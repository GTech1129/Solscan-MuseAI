// tests/tier-parity.test.ts — the TS tier table (src/engine/tiers.ts)
// and the CJS server tier table (server_strategy_auto_switcher.cjs)
// must agree field-for-field. If you edit one, edit the other and run
// npm test. Run with: npm test  (tsx --test tests/*.test.ts)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  CANONICAL_TIERS,
  getCanonicalTierForBalance,
} from '../src/engine/tiers.ts';
import {
  CHOP_MARGIN_MULTIPLIER,
  CHOP_TP1_DIST,
  CHOP_TP2_MULTIPLIER,
} from '../src/engine/trigger.ts';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const switcher = require('../server_strategy_auto_switcher.cjs') as {
  TIERS: Record<string, Record<string, unknown>>;
  BOOST_LEVERAGE: number;
  MAX_LEVERAGE: number;
  CHOP_MARGIN_MULTIPLIER: number;
  CHOP_TP1_DIST: number;
  CHOP_TP2_FACTOR: number;
  getTierForBalance: (balance: number) => Record<string, unknown>;
};

const FIELDS = [
  'id',
  'legacyId',
  'name',
  'minBalance',
  'maxBalance',
  'leverage',
  'riskCapPct',
  'maxRiskDollarCap',
  'tp1Dist',
  'tp2Dist',
  'tp2AtrMult',
  'slAtrMult',
  'defaultMargin',
  'compoundRate',
] as const;

describe('tier parity (TS <-> CJS server)', () => {
  for (const tierId of ['TIER_1', 'TIER_2', 'TIER_3'] as const) {
    it(`${tierId} matches field-for-field`, () => {
      const ts = CANONICAL_TIERS[tierId] as unknown as Record<string, unknown>;
      const cjs = switcher.TIERS[tierId];
      assert.ok(cjs, `server table missing ${tierId}`);
      for (const f of FIELDS) {
        assert.equal(cjs[f], ts[f], `${tierId}.${f}: CJS=${cjs[f]} TS=${ts[f]}`);
      }
    });
  }

  it('leverage rules are unchanged (20/35/50 base, +10x boost, 60x max)', () => {
    assert.equal(CANONICAL_TIERS.TIER_1.leverage, 20);
    assert.equal(CANONICAL_TIERS.TIER_2.leverage, 35);
    assert.equal(CANONICAL_TIERS.TIER_3.leverage, 50);
    assert.equal(switcher.BOOST_LEVERAGE, 10);
    assert.equal(switcher.MAX_LEVERAGE, 60);
  });

  it('risk caps are 3%/5%/10% (never the old false 1% Tier 1 copy)', () => {
    assert.equal(CANONICAL_TIERS.TIER_1.riskCapPct, 0.03);
    assert.equal(CANONICAL_TIERS.TIER_2.riskCapPct, 0.05);
    assert.equal(CANONICAL_TIERS.TIER_3.riskCapPct, 0.1);
  });

  it('tier margins are $25/$50/$100', () => {
    assert.equal(CANONICAL_TIERS.TIER_1.defaultMargin, 25);
    assert.equal(CANONICAL_TIERS.TIER_2.defaultMargin, 50);
    assert.equal(CANONICAL_TIERS.TIER_3.defaultMargin, 100);
  });

  it('chop constants agree between trigger.ts and the server switcher', () => {
    assert.equal(switcher.CHOP_MARGIN_MULTIPLIER, CHOP_MARGIN_MULTIPLIER);
    assert.equal(switcher.CHOP_TP1_DIST, CHOP_TP1_DIST);
    assert.equal(switcher.CHOP_TP2_FACTOR, CHOP_TP2_MULTIPLIER);
  });

  it('tier selection boundaries agree (TS vs CJS)', () => {
    for (const bal of [0, 30, 99.99, 100, 150, 249.99, 250, 1000]) {
      const ts = getCanonicalTierForBalance(bal).id;
      const cjs = switcher.getTierForBalance(bal).id;
      assert.equal(cjs, ts, `balance ${bal}: CJS=${cjs} TS=${ts}`);
    }
  });
});
