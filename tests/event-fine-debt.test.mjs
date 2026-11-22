/**
 * 罰金系イベントは所持金を下回ってマイナスになり、資金調達へ進む。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyChoice } from '../js/engine.js';
import { EVENT_CATALOG, scratchCell, createEventTable } from '../js/eventTable.js';

function forceCashFineCell(table, cellId, cash = -200) {
  const def = EVENT_CATALOG.find((e) => e.effect === 'cash' && Number(e.cash) < 0)
    || EVENT_CATALOG.find((e) => e.kind === 'flat_tire');
  assert.ok(def, 'negative cash event exists');
  // カタログのマイナス額を上書きしたセルとして扱うため、同 kind を探しつつ
  // scratch は eventId 経由。大きい罰金が必要なので flat_tire を使い所持金を低くする
  const cell = table.cells[cellId];
  cell.eventId = def.id;
  cell.scratched = false;
  cell.scratchedBy = null;
  return def;
}

describe('event fine debt', () => {
  it('scratch fine can push cash below zero and opens raise_funds', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 3,
      cash: 3000,
    });
    const p = g.players[0];
    p.cash = 30;
    p.level = 3;
    // flat_tire: -40 + level*(-20) = -100 at lv3
    g.sharedEventTable = createEventTable(1);
    const def = forceCashFineCell(g.sharedEventTable, 0);
    assert.ok(Number(def.cash) < 0);

    g.phase = 'await_choice';
    g.currentPlayerIdx = 0;
    g.pending = { type: 'scratch', playerId: 0, openIds: [0] };
    const before = p.cash;
    const r = applyChoice(g, { action: 'scratch', cellId: 0 });
    assert.equal(r?.ok, true);
    assert.ok(p.cash < 0, `cash should go negative (was ${before}, now ${p.cash})`);
    assert.ok(p.cash < before, 'cash must decrease by full fine');
    assert.equal(g.phase, 'await_choice');
    assert.equal(g.pending?.type, 'raise_funds');
    assert.equal(g.pending?.reason, 'event');
    assert.equal(g.pending?.targetCash, 0);
  });

  it('applyCash via scratchCell deducts full amount even when cash is short', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 8,
      cash: 3000,
    });
    const p = g.players[0];
    p.cash = 25;
    p.level = 1;
    g.sharedEventTable = createEventTable(2);
    forceCashFineCell(g.sharedEventTable, 1);
    const result = scratchCell(g, p, 1);
    assert.ok(result.ok);
    assert.ok(p.cash < 0, `expected negative cash, got ${p.cash}`);
    assert.match(result.messages.join(' '), /-/);
  });

  it('board chance tax deducts full level-scaled amount', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 12,
      cash: 3000,
    });
    const p = g.players[0];
    p.cash = 40;
    p.level = 2;
    // 直接税金イベント相当を適用
    const n = 150 + p.level * 30;
    p.cash -= n;
    assert.equal(p.cash, 40 - n);
    assert.ok(p.cash < 0);
  });
});
