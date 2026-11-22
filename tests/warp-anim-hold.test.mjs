/**
 * ワープ演出: 論理座標が先に目的地へ進んでも、見た目が出発マスに留まる契約。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const render = readFileSync(join(root, 'js/render.js'), 'utf8');
const main = readFileSync(join(root, 'js/main.js'), 'utf8');

describe('warp anim hold (no teleport-before-fly)', () => {
  it('renderer keeps token on hold after step, cleared by warp', () => {
    assert.match(render, /holds:\s*\{\}/);
    assert.match(render, /function holdToken/);
    assert.match(render, /function clearTokenHold/);
    assert.match(render, /anim\.holds\[playerId\]\s*=\s*toId/);
    assert.match(render, /delete anim\.holds\[playerId\]/);
    assert.match(render, /holdId != null/);
  });

  it('main arms holds before scratch/warp presentation', () => {
    assert.match(main, /function armWarpHolds/);
    assert.match(main, /armWarpHolds\(result\.warps\)/);
    assert.match(main, /armWarpHolds\(warps\)/);
    // 最終歩はワープ出発マスへ歩かせる
    assert.match(main, /stepTo = \(result\.done && warpFrom != null\) \? warpFrom : result\.to/);
  });
});
