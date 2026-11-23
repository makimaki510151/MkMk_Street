/**
 * CPU は Lv3〜4 まではマーク集め／銀行レベルアップを優先する。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  cpuPromotionDrive,
  cpuScoreForkPath,
  cpuDistToMissingMark,
  cpuForwardDist,
  getForwardNexts,
  CPU_PERSONALITIES,
} from '../js/engine.js';

describe('cpuPromotionDrive (early level climb)', () => {
  it('is urgent at low levels and tapers by Lv5', () => {
    const lv1 = cpuPromotionDrive({ level: 1, marks: [false, false, false, false], wildcards: 0 });
    const lv3 = cpuPromotionDrive({ level: 3, marks: [false, false, false, false], wildcards: 0 });
    const lv4 = cpuPromotionDrive({ level: 4, marks: [false, false, false, false], wildcards: 0 });
    const lv5 = cpuPromotionDrive({ level: 5, marks: [false, false, false, false], wildcards: 0 });
    assert.equal(lv1.needMarks, true);
    assert.equal(lv1.earlyClimb, true);
    assert.ok(lv1.climbUrgency >= lv3.climbUrgency);
    assert.ok(lv3.climbUrgency > lv4.climbUrgency);
    assert.ok(lv4.climbUrgency > lv5.climbUrgency);
    assert.ok(lv5.climbUrgency < 0.25);
  });

  it('detects level-ready via full marks or wildcards', () => {
    assert.equal(cpuPromotionDrive({ level: 2, marks: [true, true, true, true], wildcards: 0 }).canLevel, true);
    assert.equal(cpuPromotionDrive({ level: 2, marks: [true, false, false, false], wildcards: 3 }).canLevel, true);
    assert.equal(cpuPromotionDrive({ level: 2, marks: [true, false, false, false], wildcards: 1 }).needMarks, true);
  });
});

describe('CPU early mark/bank path preference', () => {
  it('personalities weight mark and bank for promotion', () => {
    for (const key of Object.keys(CPU_PERSONALITIES)) {
      const t = CPU_PERSONALITIES[key];
      assert.ok(t.mark >= 1.9, `${key} mark`);
      assert.ok(t.bank >= 1.0, `${key} bank`);
    }
  });

  it('finds missing marks with node.mark (not suit)', () => {
    const g = createGame({
      players: [{ name: 'H' }, { name: 'CPU', isCPU: true, personality: 'tycoon' }],
      seed: 21,
      cash: 4000,
    });
    const p = { ...g.players[1], marks: [false, false, false, false], wildcards: 0 };
    const mark = g.map.find((n) => n.type === 'mark');
    assert.ok(mark);
    const d = cpuDistToMissingMark(g, mark.id, null, p, 30);
    assert.equal(d, 0);
    const fromBank = cpuDistToMissingMark(g, g.startId, null, p, 30);
    assert.ok(fromBank < 30, `should find a mark from bank, got ${fromBank}`);
  });

  it('Lv2 needing marks prefers nearer mark paths more often than far ones', () => {
    const g = createGame({
      players: [{ name: 'H' }, { name: 'CPU', isCPU: true, personality: 'tycoon' }],
      seed: 77,
      cash: 5000,
    });
    const p = {
      ...g.players[1],
      cash: 5000,
      level: 2,
      personality: 'tycoon',
      marks: [false, false, false, false],
      wildcards: 0,
    };
    for (const sq of g.map.filter((n) => n.type === 'shop')) {
      sq.owner = 0;
      sq.extraInvest = Math.floor((sq.basePrice || 100) * 0.4);
      sq.price = (sq.basePrice || 100) + sq.extraInvest;
    }

    let preferNear = 0;
    let preferFar = 0;
    for (const n of g.map) {
      const nexts = getForwardNexts(g, n.id, null);
      if (nexts.length < 2) continue;
      const scored = nexts.map((id) => ({
        id,
        score: cpuScoreForkPath(g, p, n.id, id),
        markDist: cpuDistToMissingMark(g, id, n.id, p, 30),
      }));
      const nearest = Math.min(...scored.map((s) => s.markDist));
      const farthest = Math.max(...scored.map((s) => s.markDist));
      if (farthest - nearest < 4) continue;
      const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
      if (best.markDist <= nearest + 1) preferNear += 1;
      else if (best.markDist >= farthest - 1) preferFar += 1;
    }
    assert.ok(preferNear + preferFar > 0, 'found forks with mark gaps');
    assert.ok(preferNear > preferFar, `near=${preferNear} far=${preferFar}`);
  });

  it('Lv2 level-ready prefers nearer bank path', () => {
    const g = createGame({
      players: [{ name: 'H' }, { name: 'CPU', isCPU: true, personality: 'magnate' }],
      seed: 88,
      cash: 4000,
    });
    const p = {
      ...g.players[1],
      cash: 5000,
      level: 2,
      personality: 'magnate',
      marks: [true, true, true, true],
      wildcards: 0,
    };
    assert.equal(cpuPromotionDrive(p).canLevel, true);
    const bankId = g.startId;

    let found = false;
    for (const n of g.map) {
      if (n.id === bankId) continue;
      const nexts = getForwardNexts(g, n.id, null);
      if (nexts.length < 2) continue;
      const scored = nexts.map((id) => ({
        id,
        score: cpuScoreForkPath(g, p, n.id, id),
        bankDist: cpuForwardDist(g, id, n.id, bankId, 30),
      }));
      const nearest = Math.min(...scored.map((s) => s.bankDist));
      const farthest = Math.max(...scored.map((s) => s.bankDist));
      if (farthest - nearest < 4) continue;
      const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
      assert.ok(
        best.bankDist <= nearest + 2,
        `expected near-bank, got ${best.bankDist} (nearest ${nearest}) from ${n.id}`,
      );
      found = true;
      break;
    }
    assert.ok(found, 'found a fork with bank-distance gap');
  });

  it('Lv2 mark urgency scores higher than Lv5 on the same mark-near path', () => {
    const g = createGame({
      players: [{ name: 'H' }, { name: 'CPU', isCPU: true, personality: 'tycoon' }],
      seed: 33,
      cash: 5000,
    });
    const base = {
      ...g.players[1],
      cash: 5000,
      personality: 'tycoon',
      marks: [false, false, false, false],
      wildcards: 0,
    };
    let compared = false;
    for (const n of g.map) {
      const nexts = getForwardNexts(g, n.id, null);
      if (nexts.length < 2) continue;
      for (const id of nexts) {
        const d = cpuDistToMissingMark(g, id, n.id, base, 30);
        if (d > 10) continue;
        const low = cpuScoreForkPath(g, { ...base, level: 2 }, n.id, id);
        const high = cpuScoreForkPath(g, { ...base, level: 5 }, n.id, id);
        assert.ok(low > high, `Lv2 score ${low} should beat Lv5 ${high} on mark-near path`);
        compared = true;
        break;
      }
      if (compared) break;
    }
    assert.ok(compared);
  });
});
