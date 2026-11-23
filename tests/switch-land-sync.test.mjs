/**
 * スイッチ着地／移動同期のホスト→ゲスト契約。
 * main.js の syncLandStep / continueAdvancing / resolveForkChoice / syncState と揃える。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  advanceMove,
  chooseFork,
  cpuChooseForkId,
  getNode,
  serializeState,
  restoreState,
  toggleBoardSwitch,
} from '../js/engine.js';
import { applySwitchState } from '../js/board.js';

/** main.js と同じ：盤面最終 state を遅延すべきか */
function shouldDeferBoardStateSync(result) {
  return !!(result?.warps?.length || (result?.done && result?.switchMoves?.length));
}

/**
 * syncLandStep: 盤面遅延 or NPC待ちなら step FX を先送りする
 */
function shouldBroadcastLandStep(result, npcPending = false) {
  return shouldDeferBoardStateSync(result) || !!npcPending;
}

/** syncState 成功時に deferred extra を破棄する契約 */
function applySyncState(host, extra = {}) {
  if (host.pendingEventNpcFx?.length && !extra.forceNpcSync) {
    const { forceNpcSync: _f, ...rest } = extra;
    host.deferredStateExtra = { ...(host.deferredStateExtra || {}), ...rest };
    return { deferred: true, broadcast: null };
  }
  const { forceNpcSync: _force, ...rest } = extra;
  host.deferredStateExtra = null;
  return { deferred: false, broadcast: { state: true, ...rest } };
}

function flushPending(host) {
  const fx = host.pendingEventNpcFx || [];
  host.pendingEventNpcFx = [];
  const hadDeferred = host.deferredStateExtra != null;
  const extra = host.deferredStateExtra || {};
  host.deferredStateExtra = null;
  if (fx.length || hadDeferred) {
    return applySyncState(host, { ...extra, forceNpcSync: true });
  }
  return { deferred: false, broadcast: null };
}

describe('switch land sync contract', () => {
  it('defers board state but still requires land step FX when switchMoves or warps present', () => {
    const withMoves = {
      done: true,
      switchMoves: [{ id: 1, from: { col: 0, row: 0 }, to: { col: 1, row: 0 } }],
      warps: [],
    };
    assert.equal(shouldDeferBoardStateSync(withMoves), true);
    assert.equal(shouldBroadcastLandStep(withMoves), true);

    const gatesOnly = { done: true, switchMoves: [], warps: [] };
    assert.equal(shouldDeferBoardStateSync(gatesOnly), false);
    assert.equal(shouldBroadcastLandStep(gatesOnly), false);
    assert.equal(shouldBroadcastLandStep(gatesOnly, true), true);

    const midWarp = { done: false, switchMoves: [], warps: [{ from: 1, to: 2 }] };
    assert.equal(shouldDeferBoardStateSync(midWarp), true);
    assert.equal(shouldBroadcastLandStep(midWarp), true);
  });

  it('force sync clears deferred extras; empty flush still drains deferred', () => {
    const host = { pendingEventNpcFx: [{ type: 'move' }], deferredStateExtra: null };
    const deferred = applySyncState(host, { anim: { pid: 0, from: 1, to: 2 } });
    assert.equal(deferred.deferred, true);
    assert.ok(host.deferredStateExtra?.anim);

    const forced = applySyncState(host, { forceNpcSync: true });
    assert.equal(forced.deferred, false);
    assert.equal(host.deferredStateExtra, null);
    assert.ok(forced.broadcast);

    host.pendingEventNpcFx = [{ type: 'move' }];
    applySyncState(host, { hideDice: false });
    assert.ok(host.deferredStateExtra);
    host.pendingEventNpcFx = [];
    const flushed = flushPending(host);
    assert.ok(flushed.broadcast);
    assert.equal(host.deferredStateExtra, null);
  });

  it('landing on switch serializes player on switch and toggled switchState', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 42,
      mapId: 'shell_harbor',
    });
    const sw = g.map.find((n) => n.type === 'switch');
    assert.ok(sw, 'shell_harbor map should have a switch');
    const before = g.switchState ? 1 : 0;

    g.players[0].pos = sw.id;
    g.phase = 'moving';
    g.move = { stepsLeft: 0, path: [sw.id], passedBank: false, startPos: g.startId };
    const result = advanceMove(g);

    assert.equal(result.ok, true);
    assert.equal(result.done, true);
    assert.equal(g.players[0].pos, sw.id);
    assert.equal(g.switchState ? 1 : 0, before ^ 1);
    assert.ok(Array.isArray(result.switchMoves));
    assert.ok(result.switchMoves.length > 0);
    assert.equal(shouldDeferBoardStateSync(result), true);
    assert.equal(shouldBroadcastLandStep(result), true);

    const snap = restoreState(serializeState(g));
    assert.equal(snap.players[0].pos, sw.id);
    assert.equal(snap.switchState ? 1 : 0, g.switchState ? 1 : 0);
    assert.equal(getNode(snap, sw.id)?.type, 'switch');
  });

  it('guest applySwitchState from switchSlide matches host after toggle', () => {
    const host = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 7,
      mapId: 'shell_harbor',
    });
    assert.ok((host.switchMoves || []).length > 0);
    const beforePos = host.switchMoves.map((m) => {
      const n = getNode(host, m.id);
      return { id: m.id, col: n.col, row: n.row };
    });

    toggleBoardSwitch(host);
    const guest = restoreState(serializeState(host));
    const guestFx = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 7,
      mapId: 'shell_harbor',
    });
    guestFx.switchState = host.switchState ? 1 : 0;
    applySwitchState(guestFx);

    for (const mv of host.switchMoves) {
      const h = getNode(host, mv.id);
      const gf = getNode(guestFx, mv.id);
      const gs = getNode(guest, mv.id);
      assert.equal(gf.col, h.col);
      assert.equal(gf.row, h.row);
      assert.equal(gs.col, h.col);
      assert.equal(gs.row, h.row);
    }
    const moved = host.switchMoves.some((m) => {
      const prev = beforePos.find((p) => p.id === m.id);
      const n = getNode(host, m.id);
      return prev && (prev.col !== n.col || prev.row !== n.row);
    });
    assert.equal(moved, true);
  });

  it('cpuChooseForkId peeks without applying chooseFork', () => {
    const g = createGame({
      players: [{ name: 'CPU', isCPU: true }, { name: 'B' }],
      seed: 11,
      mapId: 'shell_harbor',
    });
    const forkNode = g.map.find((n) => (n.nexts || []).length >= 2);
    assert.ok(forkNode);
    g.players[0].pos = forkNode.id;
    g.currentPlayerIdx = 0;
    g.phase = 'await_fork';
    g.move = { stepsLeft: 3, path: [forkNode.id], passedBank: false, startPos: g.startId };
    g.pending = {
      type: 'fork',
      playerId: 0,
      options: (forkNode.nexts || []).map((id) => ({ id, label: String(id) })),
      stepsLeft: 3,
    };
    const phaseBefore = g.phase;
    const posBefore = g.players[0].pos;
    const pick = cpuChooseForkId(g);
    assert.ok(pick != null);
    assert.ok((forkNode.nexts || []).includes(pick));
    assert.equal(g.phase, phaseBefore);
    assert.equal(g.players[0].pos, posBefore);
    assert.equal(g.pending?.type, 'fork');
  });

  it('fork onto switch as final step yields done + switchMoves for sync path', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 11,
      mapId: 'shell_harbor',
    });
    const sw = g.map.find((n) => n.type === 'switch');
    assert.ok(sw, 'shell_harbor should have switch');
    const pred = g.map.find((n) => (n.nexts || []).includes(sw.id) && (n.nexts || []).length >= 2);
    if (!pred) {
      assert.ok(true);
      return;
    }
    const before = g.switchState ? 1 : 0;
    g.players[0].pos = pred.id;
    g.phase = 'await_fork';
    g.move = { stepsLeft: 1, path: [pred.id], passedBank: false, startPos: g.startId };
    g.pending = {
      type: 'fork',
      playerId: 0,
      options: (pred.nexts || []).map((id) => ({ id, label: String(id) })),
      stepsLeft: 1,
    };
    const result = chooseFork(g, sw.id);
    assert.equal(result.ok, true);
    assert.equal(result.done, true);
    assert.equal(g.players[0].pos, sw.id);
    assert.equal(g.switchState ? 1 : 0, before ^ 1);
    assert.equal(shouldDeferBoardStateSync(result), !!(result.switchMoves?.length));
    if (result.switchMoves?.length) {
      assert.equal(shouldBroadcastLandStep(result), true);
    }
  });
});
