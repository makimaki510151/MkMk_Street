/**
 * 強欲鉱山: 上昇・着／下降・着へ隣マスから入れない（階層転送の出口のみ）
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard } from '../js/board.js';
import { createGame, getForwardNexts, getNode } from '../js/engine.js';

describe('greed mine shaft landing exits', () => {
  it('blocks neighbor entry into 上昇・着 / 下降・着 while keeping outbound links', () => {
    const board = buildBoard('greed_mine');
    const exits = board.nodes.filter((n) => n.type === 'shaft' && n.oneWayOut);
    assert.equal(exits.length, 2);

    const upLand = exits.find((n) => n.shaft === 'up' && n.floor === 1);
    const downLand = exits.find((n) => n.shaft === 'down' && n.floor === 2);
    assert.ok(upLand, '上昇・着');
    assert.ok(downLand, '下降・着');
    assert.match(upLand.label, /上昇・着/);
    assert.match(downLand.label, /下降・着/);

    for (const exit of exits) {
      assert.ok((exit.nexts || []).length >= 1, `${exit.label} should have outbound`);
      const inbound = board.nodes.filter((n) => n.id !== exit.id && (n.nexts || []).includes(exit.id));
      assert.deepEqual(
        inbound.map((n) => n.label || n.type),
        [],
        `${exit.label} must not be enterable from neighbors`,
      );
      for (const nid of exit.nexts) {
        const other = board.nodes.find((n) => n.id === nid);
        assert.ok(other);
        assert.equal(
          (other.nexts || []).includes(exit.id),
          false,
          `${other.label} must not link back into ${exit.label}`,
        );
      }
    }
  });

  it('still allows continuing from a shaft exit after transit', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 3,
      mapId: 'greed_mine',
    });
    const entry = g.map.find((n) => n.type === 'shaft' && n.shaft === 'down' && n.floor === 1);
    const exit = g.map.find((n) => n.type === 'shaft' && n.shaft === 'down' && n.floor === 2);
    assert.ok(entry && exit);
    const p = g.players[0];
    p.pos = exit.id;
    p.prevPos = null;
    const nexts = getForwardNexts(g, p.pos, p.prevPos);
    assert.ok(nexts.length >= 1);
    assert.ok(nexts.every((id) => getNode(g, id)));
  });
});
