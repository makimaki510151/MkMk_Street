import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  tiedRollKeys,
  evaluateOrderRolls,
  rollOrderDie,
  reclaimOrderRollPlayer,
  markOrderRollPlayerLeft,
  ORDER_DIE_MIN,
  ORDER_DIE_MAX,
} from '../js/orderRoll.js';
import { APP_VERSION } from '../js/version.js';
import { PLAYER_COLORS, normalizeLobbyColors } from '../js/engine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainJs = readFileSync(join(root, 'js/main.js'), 'utf8');
const css = readFileSync(join(root, 'css/styles.css'), 'utf8');

describe('order roll & lobby helpers', () => {
  it('exposes a semver-like APP_VERSION', () => {
    assert.match(APP_VERSION, /^\d+\.\d+\.\d+/);
  });

  it('holds final dice then FLIP-sorts before ranking confirm', () => {
    assert.match(mainJs, /ORDER_ROLL_REVEAL_HOLD_MS/);
    assert.match(mainJs, /playOrderRollSortAnimation/);
    assert.match(mainJs, /ensureOrderRollRevealPipeline/);
    assert.match(mainJs, /revealPhase/);
    assert.match(mainJs, /just-rolled/);
    assert.match(css, /\.order-roll-row\.just-rolled/);
    assert.match(css, /order-roll-pop/);
  });

  it('offers about 10 player colors', () => {
    assert.ok(PLAYER_COLORS.length >= 8 && PLAYER_COLORS.length <= 12);
    assert.equal(new Set(PLAYER_COLORS.map((c) => c.toLowerCase())).size, PLAYER_COLORS.length);
  });

  it('rollOrderDie returns 1..100', () => {
    assert.equal(ORDER_DIE_MIN, 1);
    assert.equal(ORDER_DIE_MAX, 100);
    for (let i = 0; i < 120; i++) {
      const n = rollOrderDie(() => i / 120);
      assert.ok(n >= 1 && n <= 100, String(n));
    }
    assert.equal(rollOrderDie(() => 0), 1);
    assert.equal(rollOrderDie(() => 0.999), 100);
  });

  it('detects tied keys and asks only those to reroll', () => {
    const players = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
    const tied = evaluateOrderRolls(players, { a: 44, b: 44, c: 12 });
    assert.equal(tied.done, false);
    assert.deepEqual(tied.rerollKeys.sort(), ['a', 'b']);
  });

  it('keeps unique high roller while lower tie rerolls', () => {
    const players = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
    const mid = evaluateOrderRolls(players, { a: 90, b: 40, c: 40 });
    assert.equal(mid.done, false);
    assert.deepEqual(mid.rerollKeys.sort(), ['b', 'c']);
  });

  it('orders players by dice high-to-low when unique', () => {
    const players = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
    const ok = evaluateOrderRolls(players, { a: 12, b: 88, c: 55 });
    assert.equal(ok.done, true);
    assert.deepEqual(ok.order, ['b', 'c', 'a']);
  });

  it('tiedRollKeys lists every member of a tied group', () => {
    assert.deepEqual(
      tiedRollKeys([
        { key: 'x', value: 33 },
        { key: 'y', value: 75 },
        { key: 'z', value: 33 },
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

  it('keeps order-roll keys when a guest reconnects under a new peerId', () => {
    const orderRoll = {
      players: [
        { key: 'old-peer', peerId: 'old-peer', name: 'あか', isCPU: false },
        { key: 'host', peerId: 'host', name: 'ホスト', isCPU: false },
      ],
      pending: ['old-peer'],
      rolls: {},
    };
    const left = markOrderRollPlayerLeft(orderRoll, 'old-peer');
    assert.equal(left?.name, 'あか');
    assert.equal(left.disconnected, true);
    assert.equal(left.peerId, null);
    assert.equal(left.key, 'old-peer');

    const back = reclaimOrderRollPlayer(orderRoll, { name: 'あか', peerId: 'new-peer' });
    assert.equal(back?.key, 'old-peer');
    assert.equal(back.peerId, 'new-peer');
    assert.equal(back.disconnected, false);
    assert.deepEqual(orderRoll.pending, ['old-peer']);
  });
});
