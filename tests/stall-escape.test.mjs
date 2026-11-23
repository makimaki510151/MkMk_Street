/**
 * 進行不能（pending 残留 / CPU null ループ）脱出の回帰テスト
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  applyChoice,
  cpuAct,
  declareBankrupt,
} from '../js/engine.js';

function ownedShops(g, pid) {
  return g.map.filter((s) => s.type === 'shop' && s.owner === pid);
}

describe('stall escape: force_sell_shop with no shops', () => {
  it('skip clears pending when player owns nothing', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B', isCPU: true }],
      seed: 11,
      cash: 3000,
    });
    for (const s of ownedShops(g, 0)) {
      s.owner = -1;
      s.extraInvest = 0;
      s.price = s.basePrice;
    }
    g.phase = 'await_choice';
    g.pending = {
      type: 'force_sell_shop',
      playerId: 0,
      shopIds: [9999],
    };
    const r = applyChoice(g, { action: 'skip' });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, true);
    assert.equal(g.pending, null);
    assert.notEqual(g.phase, 'await_choice');
  });

  it('CPU force_sell with empty shops escapes instead of looping', () => {
    const g = createGame({
      players: [{ name: 'A', isCPU: true }, { name: 'B' }],
      seed: 12,
      cash: 3000,
    });
    g.players[0].isCPU = true;
    for (const s of ownedShops(g, 0)) {
      s.owner = -1;
    }
    g.phase = 'await_choice';
    g.currentPlayerIdx = 0;
    g.pending = {
      type: 'force_sell_shop',
      playerId: 0,
      shopIds: [],
    };
    const r = cpuAct(g);
    assert.equal(r?.ok, true);
    assert.equal(g.pending, null);
  });
});

describe('stall escape: shop_protect / co_own empty targets', () => {
  it('shop_protect skip grants allowance and ends turn', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 21,
      cash: 3000,
    });
    for (const s of ownedShops(g, 0)) s.owner = -1;
    g.phase = 'await_choice';
    g.pending = {
      type: 'shop_protect',
      playerId: 0,
      shopIds: [1, 2, 3],
      turns: 1,
    };
    const before = g.players[0].cash;
    const r = applyChoice(g, { action: 'skip' });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, true);
    assert.equal(g.players[0].cash, before + 40);
    assert.equal(g.pending, null);
  });

  it('CPU shop_protect with no owned shops skips (not null)', () => {
    const g = createGame({
      players: [{ name: 'A', isCPU: true }, { name: 'B' }],
      seed: 22,
      cash: 3000,
    });
    g.players[0].isCPU = true;
    for (const s of ownedShops(g, 0)) s.owner = -1;
    g.phase = 'await_choice';
    g.currentPlayerIdx = 0;
    g.pending = {
      type: 'shop_protect',
      playerId: 0,
      shopIds: [42],
      turns: 1,
    };
    const r = cpuAct(g);
    assert.ok(r);
    assert.equal(r.ok, true);
    assert.equal(g.pending, null);
  });

  it('co_own skip when rivals vacated grants allowance', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 23,
      cash: 3000,
    });
    for (const s of g.map.filter((n) => n.type === 'shop')) {
      s.owner = -1;
    }
    g.phase = 'await_choice';
    g.pending = {
      type: 'co_own',
      playerId: 0,
      shopIds: [10, 11],
    };
    const before = g.players[0].cash;
    const r = applyChoice(g, { action: 'skip' });
    assert.equal(r.ok, true);
    assert.equal(g.players[0].cash, before + 40);
    assert.equal(g.pending, null);
  });

  it('CPU co_own with no rival shops skips (not null)', () => {
    const g = createGame({
      players: [{ name: 'A', isCPU: true }, { name: 'B' }],
      seed: 24,
      cash: 3000,
    });
    g.players[0].isCPU = true;
    for (const s of g.map.filter((n) => n.type === 'shop')) s.owner = -1;
    g.phase = 'await_choice';
    g.currentPlayerIdx = 0;
    g.pending = {
      type: 'co_own',
      playerId: 0,
      shopIds: [10],
    };
    const r = cpuAct(g);
    assert.ok(r);
    assert.equal(r.ok, true);
    assert.equal(g.pending, null);
  });
});

describe('stall escape: bankrupt clears own pending', () => {
  it('declareBankrupt drops await_choice owned by the bankrupt player', () => {
    // 3人以上でないと残り1人で即 gameover になる
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      seed: 31,
      cash: 100,
      bankruptLimit: 0,
    });
    const shop = g.map.find((n) => n.type === 'shop');
    shop.owner = 0;
    g.phase = 'await_choice';
    g.pending = {
      type: 'shop_protect',
      playerId: 0,
      shopIds: [shop.id],
      turns: 1,
    };
    declareBankrupt(g, g.players[0]);
    assert.equal(g.players[0].bankrupt, true);
    assert.equal(g.pending, null);
    assert.equal(g.phase, 'await_roll');
  });
});

describe('stall escape: fork pick hardening', () => {
  it('chooseFork rejects empty options without mutating pending oddly', () => {
    const g = createGame({
      players: [{ name: 'A', isCPU: true }, { name: 'B' }],
      seed: 41,
      cash: 3000,
    });
    g.players[0].isCPU = true;
    g.currentPlayerIdx = 0;
    g.phase = 'await_fork';
    g.pending = { type: 'fork', playerId: 0, options: [] };
    const r = cpuAct(g);
    assert.equal(r?.ok, false);
    assert.equal(g.phase, 'await_fork');
  });

  it('CPU fork picks a valid option and leaves await_fork', () => {
    const g = createGame({
      players: [{ name: 'A', isCPU: true }, { name: 'B' }],
      seed: 42,
      cash: 3000,
    });
    g.players[0].isCPU = true;
    g.currentPlayerIdx = 0;
    const node = g.map.find((n) => (n.nexts?.length || 0) >= 2);
    assert.ok(node, 'map should have a multi-exit node');
    const exits = node.nexts.slice(0, 2);
    g.players[0].pos = node.id;
    g.phase = 'await_fork';
    g.move = { stepsLeft: 1, path: [] };
    g.pending = {
      type: 'fork',
      playerId: 0,
      options: exits.map((id) => ({ id, label: String(id) })),
    };
    const r = cpuAct(g);
    assert.equal(r?.ok, true);
    assert.notEqual(g.phase, 'await_fork');
  });
});

describe('stall escape: buy failure falls back to skip', () => {
  it('CPU buy_shop that cannot afford skips cleanly', () => {
    const g = createGame({
      players: [{ name: 'A', isCPU: true }, { name: 'B' }],
      seed: 51,
      cash: 0,
    });
    g.players[0].isCPU = true;
    g.players[0].cash = 0;
    g.players[0].stocks = {};
    const shop = g.map.find((n) => n.type === 'shop' && n.owner < 0);
    assert.ok(shop);
    g.phase = 'await_choice';
    g.currentPlayerIdx = 0;
    g.pending = {
      type: 'buy_shop',
      playerId: 0,
      shopId: shop.id,
      price: shop.price,
    };
    const r = cpuAct(g);
    assert.equal(r?.ok, true);
    assert.equal(g.pending, null);
    assert.equal(shop.owner, -1);
  });
});
