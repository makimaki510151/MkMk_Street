/**
 * 門／階層の途中通過で warps が返り、UI が入口歩行→ワープ演出できるようにする
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, advanceMove, chooseFork, getNode } from '../js/engine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const engineSrc = readFileSync(join(root, 'js/engine.js'), 'utf8');
const mainSrc = readFileSync(join(root, 'js/main.js'), 'utf8');

describe('gate/shaft mid-move warp fx', () => {
  it('exposes warps with entrance as step target on mid-move gate', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 11,
      mapId: 'sky_isles',
    });
    const gateA = g.map.find((n) => n.type === 'gate');
    const gateB = getNode(g, gateA.gateTo);
    const neighbor = gateA.nexts.find((id) => id !== gateA.gateTo) ?? gateA.nexts[0];
    g.players[0].pos = neighbor;
    g.players[0].prevPos = null;
    g.move = { stepsLeft: 3, path: [], passedBank: false, startPos: g.startId };
    g.phase = 'moving';

    // 隣が分岐なら fork → chooseFork、そうでなければ advanceMove で門へ
    let step = advanceMove(g);
    if (step.forked) {
      step = chooseFork(g, gateA.id);
    } else if (step.to !== gateA.id && g.players[0].pos !== gateB.id) {
      // 直進で門以外へ行った場合は、門隣から再設定して chooseFork 経路を使う
      g.players[0].pos = neighbor;
      g.players[0].prevPos = null;
      g.move = { stepsLeft: 3, path: [], passedBank: false, startPos: g.startId };
      g.phase = 'moving';
      const forked = advanceMove(g);
      assert.equal(forked.forked, true);
      step = chooseFork(g, gateA.id);
    }

    assert.equal(step.gate, true);
    assert.equal(g.players[0].pos, gateB.id);
    assert.ok(step.warps?.length >= 1);
    assert.equal(step.warps[0].from, gateA.id);
    assert.equal(step.warps[0].to, gateB.id);
    assert.equal(step.to, gateA.id);
    assert.equal(step.done, false);
  });

  it('wires mid-move warp presentation in engine and main', () => {
    assert.match(engineSrc, /残移動あり：UIは入口まで歩かせてから warps で飛ばす/);
    assert.match(mainSrc, /門／階層など残移動ありの途中ワープは、ここで即演出してから歩き続ける/);
    assert.match(mainSrc, /門／階層へ分岐したときは入口まで歩かせ、warps で飛ばす/);
  });
});
