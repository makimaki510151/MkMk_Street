import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tiedRollKeys, evaluateOrderRolls, rollOrderDie } from '../js/orderRoll.js';
import { APP_VERSION } from '../js/version.js';
import { PLAYER_COLORS, normalizeLobbyColors } from '../js/engine.js';

describe('order roll & lobby helpers', () => {
  it('exposes a semver-like APP_VERSION', () => {
    assert.match(APP_VERSION, /^\d+\.\d+\.\d+/);
  });

  it('offers about 10 player colors', () => {
    assert.ok(PLAYER_COLORS.length >= 8 && PLAYER_COLORS.length <= 12);
    assert.equal(new Set(PLAYER_COLORS.map((c) => c.toLowerCase())).size, PLAYER_COLORS.length);
  });

  it('rollOrderDie returns 1..6', () => {
    for (let i = 0; i < 40; i++) {
      const n = rollOrderDie(() => i / 40);
      assert.ok(n >= 1 && n <= 6);
    }
    assert.equal(rollOrderDie(() => 0), 1);
    assert.equal(rollOrderDie(() => 0.999), 6);
  });

  it('detects tied keys and asks for rerolls', () => {
    const players = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
    const tied = evaluateOrderRolls(players, { a: 4, b: 4, c: 2 });
    assert.equal(tied.done, false);
    assert.deepEqual(tied.rerollKeys.sort(), ['a', 'b']);
  });

  it('orders players by dice high-to-low when unique', () => {
    const players = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
    const ok = evaluateOrderRolls(players, { a: 2, b: 6, c: 5 });
    assert.equal(ok.done, true);
    assert.deepEqual(ok.order, ['b', 'c', 'a']);
  });

  it('tiedRollKeys lists every member of a tied group', () => {
    assert.deepEqual(
      tiedRollKeys([
        { key: 'x', value: 3 },
        { key: 'y', value: 5 },
        { key: 'z', value: 3 },
      ]).sort(),
      ['x', 'z'],
    );
  });

  it('normalizes lobby colors across the expanded palette', () => {
    const lobby = normalizeLobbyColors([
      { name: 'A', color: PLAYER_COLORS[5] },
      { name: 'B', color: PLAYER_COLORS[5] },
      { name: 'C', color: PLAYER_COLORS[7] },
    ]);
    assert.equal(lobby[0].color, PLAYER_COLORS[5]);
    assert.notEqual(lobby[1].color, lobby[0].color);
    assert.equal(lobby[2].color, PLAYER_COLORS[7]);
  });
});
