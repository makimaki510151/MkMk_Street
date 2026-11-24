/**
 * 削削パンダ／回転橋のギミック契約
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applySwitchState, buildBoard, getSwitchStateCount } from '../js/board.js';
import {
  createGame,
  toggleBoardSwitch,
  getNode,
  serializeState,
  restoreState,
  advanceMove,
} from '../js/engine.js';

describe('scratch_panda map', () => {
  it('builds with nudge squares, random warps, and many scratches', () => {
    const board = buildBoard('scratch_panda');
    assert.equal(board.mapName, '削削パンダ');
    assert.equal(board.cols, 12);
    assert.equal(board.rows, 15);
    const nudges = board.nodes.filter((n) => n.type === 'nudge');
    const warps = board.nodes.filter((n) => n.type === 'warp_random');
    const scratches = board.nodes.filter((n) => n.type === 'scratch');
    assert.ok(nudges.length >= 3, `nudges=${nudges.length}`);
    assert.ok(warps.length >= 1);
    assert.ok(scratches.length >= 8);
  });

  it('nudge landing triggers a nudge-square event log', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 42,
      mapId: 'scratch_panda',
    });
    const nudge = g.map.find((n) => n.type === 'nudge');
    assert.ok(nudge);
    g.players[0].stats.nudgeSent = 3;
    g.players[1].stats.nudgeSent = 10;
    g.players[0].pos = nudge.id;
    g.phase = 'moving';
    g.move = { stepsLeft: 0, path: [nudge.id], passedBank: false, startPos: g.startId };
    const result = advanceMove(g);
    assert.equal(result.ok, true);
    assert.equal(result.done, true);
    assert.ok(
      g.logs.some((l) => String(l.text).includes('催促マス')),
      `logs=${g.logs.slice(0, 5).map((l) => l.text).join(' | ')}`,
    );
  });
});

describe('rotate_bridge map', () => {
  it('has 4 switch states and moves bank with area A', () => {
    const board = buildBoard('rotate_bridge');
    assert.equal(board.mapName, '回転橋');
    assert.equal(getSwitchStateCount(board), 4);
    assert.ok(board.switchMoves.length >= 5);
    assert.ok(board.switchGates.length >= 20);

    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 7,
      mapId: 'rotate_bridge',
    });
    const bank = getNode(g, g.startId);
    assert.equal(bank.type, 'bank');
    const start = { col: bank.col, row: bank.row };
    const seen = new Set([`${start.col},${start.row}`]);
    for (let i = 0; i < 12; i++) {
      toggleBoardSwitch(g);
      const b = getNode(g, g.startId);
      seen.add(`${b.col},${b.row}`);
      assert.ok(g.switchState >= 0 && g.switchState <= 3);
    }
    assert.ok(seen.size >= 3, `bank should visit multiple anchors, got ${[...seen]}`);
  });

  it('serialize/restore keeps multi-state switchState', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 3,
      mapId: 'rotate_bridge',
    });
    g.switchState = 2;
    applySwitchState(g);
    const raw = serializeState(g);
    assert.equal(raw.switchState, 2);
    const g2 = restoreState(raw);
    assert.equal(g2.switchState, 2);
    const bank = getNode(g2, g2.startId);
    assert.equal(bank.col, 6);
    assert.equal(bank.row, 9);
  });

  it('switch slide fx includes rotate or slide motion metadata', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 11,
      mapId: 'rotate_bridge',
    });
    // 状態0→強制的に隣/反対を複数回試す
    const motions = new Set();
    for (let i = 0; i < 20; i++) {
      g.switchFx = null;
      toggleBoardSwitch(g);
      for (const fx of g.switchFx || []) {
        if (fx.motion) motions.add(fx.motion);
      }
      // takeSwitchFx 相当
      g.switchFx = null;
    }
    assert.ok(motions.has('slide') || motions.has('rotate'), `motions=${[...motions]}`);
  });
});
