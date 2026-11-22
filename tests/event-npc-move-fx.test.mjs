/**
 * イベントNPCの移動演出: path/roll を含む FX と UI 配線の回帰防止
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createGame,
  spawnEventNpc,
  takeEventNpcFx,
  serializeState,
  restoreState,
  applyChoice,
} from '../js/engine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const main = readFileSync(join(root, 'js/main.js'), 'utf8');
const render = readFileSync(join(root, 'js/render.js'), 'utf8');

describe('event NPC move FX payload', () => {
  it('move FX includes path, roll, and diceMax', () => {
    const g = createGame({
      players: [
        { name: 'A' },
        { name: 'B' },
        { name: 'C' },
        { name: 'D' },
      ],
      seed: 42,
      cash: 3000,
    });
    const spawned = spawnEventNpc(g, 'poverty', g.startId);
    assert.equal(spawned.ok, true);
    takeEventNpcFx(g); // drain spawn

    // 4人目のターン終了で NPC ラウンドが走る
    g.currentPlayerIdx = 3;
    g.phase = 'await_choice';
    g.pending = { type: 'buy_shop', playerId: 3, shopId: g.map.find((n) => n.type === 'shop').id };
    // skip buy → endTurn → NPC round
    const shop = g.map.find((n) => n.type === 'shop' && n.owner < 0);
    g.pending = { type: 'buy_shop', playerId: 3, shopId: shop.id, price: shop.price };
    const r = applyChoice(g, { action: 'skip' });
    assert.equal(r.ok, true);

    const fx = takeEventNpcFx(g);
    const move = fx.find((f) => f.type === 'move');
    assert.ok(move, `expected move FX, got ${JSON.stringify(fx)}`);
    assert.ok(Array.isArray(move.path) && move.path.length >= 1);
    assert.equal(move.path[0], move.from);
    assert.ok(Number(move.roll) >= 1);
    assert.ok(Number(move.diceMax) >= 6);
    assert.ok(move.npcId);
  });

  it('takeEventNpcFx drains queue and serializeState omits live FX', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 3,
      cash: 3000,
    });
    spawnEventNpc(g, 'mark_fairy', g.startId);
    assert.ok(g.eventNpcFx.length >= 1);
    const fx = takeEventNpcFx(g);
    assert.ok(fx.length >= 1);
    assert.equal(g.eventNpcFx.length, 0);
    const state = serializeState(g);
    assert.equal(state.eventNpcFx, undefined);
    const g2 = restoreState(state);
    assert.ok(Array.isArray(g2.eventNpcs));
    assert.equal((g2.eventNpcFx || []).length, 0);
  });
});

describe('event NPC move FX UI wiring', () => {
  it('main presents dice + steps from drained FX', () => {
    assert.match(main, /takeEventNpcFx/);
    assert.match(main, /function commitGameState/);
    assert.match(main, /function presentEventNpcFx/);
    assert.match(main, /function presentEventNpcMove/);
    assert.match(main, /flushPendingEventNpcFx/);
    assert.match(main, /playDiceOverlay\(roll/);
    assert.match(main, /animateToken\(fx\.npcId/);
    assert.match(main, /kind: 'eventNpcMove'/);
    assert.match(main, /kind: 'eventNpcHold'/);
  });

  it('renderer draws event NPCs with tokenDrawPos / moves holds', () => {
    assert.match(render, /イベントNPC/);
    assert.match(render, /tokenDrawPos\(g, \{ id: npc\.id/);
    assert.match(render, /anim\.moves\[npc\.id\]/);
  });
});
