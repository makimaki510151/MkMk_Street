/**
 * スクラッチ「空き店へワープ」後は通常着地と同じく購入選択が出ること。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyChoice, getNode } from '../js/engine.js';
import { EVENT_CATALOG, createEventTable } from '../js/eventTable.js';

function forceScratchEffect(table, effect, cellId = 0) {
  const def = EVENT_CATALOG.find((e) => e.effect === effect);
  assert.ok(def, `effect ${effect} exists`);
  const cell = table.cells[cellId];
  cell.eventId = def.id;
  cell.label = def.label;
  cell.scratched = false;
  cell.scratchedBy = null;
  return { cell, def };
}

describe('scratch vacant shop warp buy', () => {
  it('opens buy_shop after warp_vacant_shop when cash allows', () => {
    const g = createGame({
      players: [{ name: 'A', cash: 5000 }, { name: 'B', cash: 5000 }],
      seed: 21,
      cash: 5000,
    });
    const vacant = g.map.find((n) => n.type === 'shop' && n.owner < 0);
    assert.ok(vacant);
    // 他の空きを埋めて行き先を固定（ランダムでもこの1軒だけ）
    for (const sq of g.map) {
      if (sq.type === 'shop' && sq.id !== vacant.id) sq.owner = 1;
    }

    const p = g.players[0];
    const mark = g.map.find((n) => n.type === 'mark');
    p.pos = mark?.id ?? g.startId;
    g.sharedEventTable = createEventTable(9);
    forceScratchEffect(g.sharedEventTable, 'warp_vacant_shop', 0);
    g.phase = 'await_choice';
    g.pending = { type: 'scratch', playerId: 0, openIds: [0] };

    const result = applyChoice(g, { cellId: 0 });
    assert.equal(result.ok, true);
    assert.equal(result.scratched, true);
    assert.equal(result.shopLand, true);
    assert.equal(p.pos, vacant.id);
    assert.ok(result.warps?.length);
    assert.equal(g.phase, 'await_choice');
    assert.equal(g.pending?.type, 'buy_shop');
    assert.equal(g.pending?.shopId, vacant.id);
    assert.equal(g.pending?.price, vacant.price);

    const bought = applyChoice(g, { action: 'buy' });
    assert.equal(bought.ok, true);
    assert.equal(getNode(g, vacant.id).owner, 0);
  });

  it('opens invest when warp_best_shop lands on own shop', () => {
    const g = createGame({
      players: [{ name: 'A', cash: 5000 }, { name: 'B', cash: 5000 }],
      seed: 22,
      cash: 5000,
    });
    const shop = g.map.find((n) => n.type === 'shop');
    assert.ok(shop);
    shop.owner = 0;
    shop.price = shop.basePrice || 200;
    const p = g.players[0];
    p.pos = g.startId;
    g.sharedEventTable = createEventTable(8);
    forceScratchEffect(g.sharedEventTable, 'warp_best_shop', 0);
    g.phase = 'await_choice';
    g.pending = { type: 'scratch', playerId: 0, openIds: [0] };

    const result = applyChoice(g, { cellId: 0 });
    assert.equal(result.ok, true);
    assert.equal(result.shopLand, true);
    assert.equal(p.pos, shop.id);
    assert.equal(g.pending?.type, 'invest');
    assert.equal(g.pending?.landedShopId, shop.id);
  });

  it('does not invent buy_shop when scratch does not move to a shop', () => {
    const g = createGame({
      players: [{ name: 'A', cash: 5000 }, { name: 'B', cash: 5000 }],
      seed: 23,
      cash: 5000,
    });
    const p = g.players[0];
    const mark = g.map.find((n) => n.type === 'mark');
    assert.ok(mark);
    p.pos = mark.id;
    g.sharedEventTable = createEventTable(4);
    forceScratchEffect(g.sharedEventTable, 'cash', 0);
    g.phase = 'await_choice';
    g.pending = { type: 'scratch', playerId: 0, openIds: [0] };

    const result = applyChoice(g, { cellId: 0 });
    assert.equal(result.ok, true);
    assert.equal(result.shopLand, undefined);
    assert.notEqual(g.pending?.type, 'buy_shop');
    assert.equal(p.pos, mark.id);
  });
});
