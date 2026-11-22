/**
 * コマ矢印は進める全方向を示す（1方向だけではない）契約。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createGame, getForwardNexts } from '../js/engine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const render = readFileSync(join(root, 'js/render.js'), 'utf8');

describe('token facing shows all forward dirs', () => {
  it('renderer collects multiple facing angles from getForwardNexts', () => {
    assert.match(render, /function tokenFacingAngles/);
    assert.match(render, /getForwardNexts\(g, p\.pos, p\.prevPos\)/);
    assert.match(render, /for \(const facing of facings\)/);
    assert.match(render, /drawFacingChevron\(/);
    assert.doesNotMatch(render, /function tokenFacingAngle\b/);
  });

  it('start tile has multiple forward exits for arrows to fan out', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 1,
      cash: 3000,
    });
    const p = g.players[0];
    const nexts = getForwardNexts(g, p.pos, p.prevPos);
    assert.ok(nexts.length >= 2, `expected multi-exit start, got ${nexts.length}`);
  });
});
