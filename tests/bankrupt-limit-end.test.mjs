/**
 * 破産人数ルール: N人破産で総資産決着
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  declareBankrupt,
  applyChoice,
  normalizeBankruptLimit,
  pickWinnerByAssets,
  getPlayerAssets,
  serializeState,
  restoreState,
} from '../js/engine.js';

describe('bankrupt limit end rule', () => {
  it('normalizes bankruptLimit to 1..3 (default 1)', () => {
    assert.equal(normalizeBankruptLimit(undefined), 1);
    assert.equal(normalizeBankruptLimit(0), 1);
    assert.equal(normalizeBankruptLimit(-1), 1);
    assert.equal(normalizeBankruptLimit(1), 1);
    assert.equal(normalizeBankruptLimit(9), 3);
  });

  it('ends on first bankrupt when limit is 1, winner by total assets', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      seed: 11,
      goal: 20000,
      cash: 3000,
      bankruptLimit: 1,
    });
    assert.equal(g.bankruptLimit, 1);

    // B を裕福に、A を破産させる
    const shops = g.map.filter((n) => n.type === 'shop');
    shops[0].owner = 1;
    shops[0].price = 800;
    shops[0].extraInvest = 200;
    g.players[1].cash = 5000;
    g.players[0].cash = 0;
    g.players[2].cash = 1000;

    const richBefore = getPlayerAssets(g, g.players[1]).total;
    assert.ok(richBefore > getPlayerAssets(g, g.players[2]).total);

    g.currentPlayerIdx = 0;
    g.phase = 'await_choice';
    g.pending = {
      type: 'raise_funds',
      playerId: 0,
      targetCash: 500,
      resume: { type: 'after_toll' },
    };
    const r = applyChoice(g, { action: 'bankrupt' });
    assert.equal(r.ok, true);
    assert.equal(g.phase, 'gameover');
    assert.equal(g.winnerId, 1);
    assert.equal(pickWinnerByAssets(g), 1);
    assert.match(g.logs[0].text, /破産1人で総資産決着/);
  });

  it('defaults to limit 1 and ends on first bankrupt', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      seed: 3,
      cash: 2500,
    });
    assert.equal(g.bankruptLimit, 1);
    g.players[1].cash = 8000;
    declareBankrupt(g, g.players[0]);
    assert.equal(g.phase, 'gameover');
    assert.equal(g.winnerId, 1);
  });

  it('does not end on first bankrupt when limit is 3', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      seed: 3,
      bankruptLimit: 3,
    });
    declareBankrupt(g, g.players[0]);
    assert.equal(g.phase, 'await_roll');
    assert.equal(g.winnerId, null);
    assert.equal(g.players.filter((p) => p.bankrupt).length, 1);
  });

  it('ends when second bankrupt hits limit 2', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
      seed: 7,
      cash: 4000,
      bankruptLimit: 2,
    });
    g.players[2].cash = 9000;
    declareBankrupt(g, g.players[0]);
    assert.equal(g.phase, 'await_roll');
    declareBankrupt(g, g.players[1]);
    assert.equal(g.phase, 'gameover');
    assert.equal(g.winnerId, 2);
  });

  it('serializes and restores bankruptLimit', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 2,
      bankruptLimit: 1,
    });
    const raw = serializeState(g);
    assert.equal(raw.bankruptLimit, 1);
    const restored = restoreState(raw);
    assert.equal(restored.bankruptLimit, 1);
  });
});
