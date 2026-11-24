/**
 * CPU 難易度: 中級＝標準、初心は弱体化。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  getCpuPersonality,
  getCpuDifficultyProfile,
  normalizeCpuDifficulty,
  cpuShouldBuyShop,
  cpuCashReserve,
  cpuPickFork,
  serializeState,
  restoreState,
  CPU_DIFFICULTIES,
  CPU_DIFFICULTY_DEFAULT,
} from '../js/engine.js';

describe('cpu difficulty', () => {
  it('normalizes aliases to beginner / normal', () => {
    assert.equal(normalizeCpuDifficulty('beginner'), 'beginner');
    assert.equal(normalizeCpuDifficulty('easy'), 'beginner');
    assert.equal(normalizeCpuDifficulty('初心'), 'beginner');
    assert.equal(normalizeCpuDifficulty('normal'), 'normal');
    assert.equal(normalizeCpuDifficulty('中級'), 'normal');
    assert.equal(normalizeCpuDifficulty(''), CPU_DIFFICULTY_DEFAULT);
    assert.equal(normalizeCpuDifficulty(null), CPU_DIFFICULTY_DEFAULT);
  });

  it('scales beginner traits below normal (current) strength', () => {
    const normalP = { id: 0, personality: 'tycoon', cpuDifficulty: 'normal' };
    const beginnerP = { id: 0, personality: 'tycoon', cpuDifficulty: 'beginner' };
    const n = getCpuPersonality(normalP);
    const b = getCpuPersonality(beginnerP);
    assert.equal(n.difficulty, 'normal');
    assert.equal(b.difficulty, 'beginner');
    assert.ok(b.shopBuy < n.shopBuy);
    assert.ok(b.fiveBuy < n.fiveBuy);
    assert.ok(b.vacant < n.vacant);
    assert.ok(Math.abs(b.enemyToll) < Math.abs(n.enemyToll));
    assert.equal(getCpuDifficultyProfile('beginner').label, CPU_DIFFICULTIES.beginner.label);
  });

  it('createGame stamps cpuDifficulty on game and CPU seats', () => {
    const g = createGame({
      players: [{ name: 'H' }, { name: 'CPU', isCPU: true }],
      seed: 3,
      cpuDifficulty: 'beginner',
    });
    assert.equal(g.cpuDifficulty, 'beginner');
    assert.equal(g.players[0].cpuDifficulty, null);
    assert.equal(g.players[1].cpuDifficulty, 'beginner');
    assert.equal(g.players[1].personality, 'tycoon');

    const snap = restoreState(serializeState(g));
    assert.equal(snap.cpuDifficulty, 'beginner');
    assert.equal(snap.players[1].cpuDifficulty, 'beginner');
  });

  it('beginner keeps larger cash reserve than normal', () => {
    const mk = (diff) => {
      const g = createGame({
        players: [{ name: 'H' }, { name: 'CPU', isCPU: true, personality: 'tycoon' }],
        seed: 5,
        cash: 5000,
        cpuDifficulty: diff,
      });
      return cpuCashReserve(g, g.players[1]);
    };
    assert.ok(mk('beginner') > mk('normal'));
  });

  it('beginner skips more vacant buys than normal on same board', () => {
    const run = (diff) => {
      const g = createGame({
        players: [{ name: 'H', cash: 8000 }, { name: 'CPU', isCPU: true, personality: 'tycoon' }],
        seed: 11,
        cash: 8000,
        cpuDifficulty: diff,
      });
      const p = g.players[1];
      p.cash = 8000;
      const traits = getCpuPersonality(p);
      let buys = 0;
      for (const sq of g.map.filter((n) => n.type === 'shop' && n.owner < 0)) {
        if (cpuShouldBuyShop(g, p, sq, traits)) buys += 1;
      }
      return buys;
    };
    assert.ok(run('beginner') <= run('normal'));
  });

  it('beginner fork pick can diverge from best (random chance path exists)', () => {
    const g = createGame({
      players: [{ name: 'H' }, { name: 'CPU', isCPU: true, personality: 'tycoon' }],
      seed: 99,
      cpuDifficulty: 'beginner',
    });
    const p = g.players[1];
    const opts = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    // ノイズ経路が動いても例外なく id を返す
    const pick = cpuPickFork(g, p, opts);
    assert.ok(opts.some((o) => o.id === pick));
  });
});
