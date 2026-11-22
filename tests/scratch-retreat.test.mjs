/**
 * スクラッチ「後退」は来た道を辿り、往復で実質0マスにならないこと。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyChoice } from '../js/engine.js';
import { EVENT_CATALOG, scratchCell, createEventTable } from '../js/eventTable.js';

function retreatDef() {
  return EVENT_CATALOG.find((e) => e.effect === 'retreat' && (e.amount || 4) >= 4);
}

function forceRetreatCell(table, cellId = 0) {
  const def = retreatDef();
  assert.ok(def, 'retreat event exists');
  const cell = table.cells[cellId];
  cell.eventId = def.id;
  cell.scratched = false;
  cell.scratchedBy = null;
  return cell;
}

describe('scratch retreat', () => {
  it('walks backward along arrival path instead of zig-zagging in place', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 42,
      cash: 3000,
    });
    const p = g.players[0];
    // 銀行から直線で数マス進んだ位置へ
    let prev = null;
    let pos = g.startId;
    const trail = [pos];
    for (let i = 0; i < 5; i++) {
      const node = g.map.find((n) => n.id === pos);
      const next = (node.nexts || []).find((id) => id !== prev) ?? node.nexts[0];
      prev = pos;
      pos = next;
      trail.push(pos);
    }
    p.pos = pos;
    p.prevPos = prev;
    const start = p.pos;
    assert.equal(trail[trail.length - 1], start);

    g.sharedEventTable = createEventTable(7);
    forceRetreatCell(g.sharedEventTable, 0);
    const result = scratchCell(g, p, 0);
    assert.ok(result.ok);
    assert.match(result.messages.join(' '), /マス後退/);
    assert.notEqual(p.pos, start, 'must leave the starting tile');
    // 4マス後退なら、進んできた trail を遡った位置付近へ
    const expected = trail[trail.length - 1 - 4];
    assert.equal(p.pos, expected, `retreat along path to ${expected}, got ${p.pos} (trail ${trail})`);
    assert.ok(result.warps?.length, 'warp fx recorded');
    assert.equal(result.warps[0].from, start);
    assert.equal(result.warps[0].to, p.pos);
  });

  it('does not report retreat while ending on the same tile', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 11,
      cash: 3000,
    });
    const p = g.players[0];
    let prev = null;
    let pos = g.startId;
    for (let i = 0; i < 6; i++) {
      const node = g.map.find((n) => n.id === pos);
      const next = (node.nexts || []).find((id) => id !== prev) ?? node.nexts[0];
      prev = pos;
      pos = next;
    }
    p.pos = pos;
    p.prevPos = prev;

    g.sharedEventTable = createEventTable(3);
    // 連続で後退しても同じマスに留まったまま「Nマス後退」と出ない
    for (let i = 0; i < 3; i++) {
      const cell = forceRetreatCell(g.sharedEventTable, i);
      const before = p.pos;
      const result = scratchCell(g, p, cell.id);
      assert.ok(result.ok);
      const msg = result.messages.find((m) => /マス後退/.test(m));
      if (msg) {
        assert.notEqual(p.pos, before, `claimed "${msg}" but stayed on ${before}`);
      }
    }
  });

  it('applies through scratch choice pending', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 5,
      cash: 3000,
    });
    const p = g.players[0];
    let prev = null;
    let pos = g.startId;
    for (let i = 0; i < 4; i++) {
      const node = g.map.find((n) => n.id === pos);
      const next = (node.nexts || []).find((id) => id !== prev) ?? node.nexts[0];
      prev = pos;
      pos = next;
    }
    p.pos = pos;
    p.prevPos = prev;
    const before = p.pos;

    g.sharedEventTable = createEventTable(9);
    forceRetreatCell(g.sharedEventTable, 2);
    g.phase = 'await_choice';
    g.pending = {
      type: 'scratch',
      playerId: 0,
      openIds: [2],
    };
    g.currentPlayerIdx = 0;
    const r = applyChoice(g, { action: 'scratch', cellId: 2 });
    assert.equal(r?.ok, true);
    assert.notEqual(p.pos, before);
  });
});
