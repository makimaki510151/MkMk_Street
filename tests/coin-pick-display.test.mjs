/**
 * コイントス：予想表示は「表／裏」1文字で枠内に収める
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainJs = readFileSync(join(root, 'js/main.js'), 'utf8');
const engineJs = readFileSync(join(root, 'js/engine.js'), 'utf8');
const css = readFileSync(join(root, 'css/styles.css'), 'utf8');

describe('coin pick display', () => {
  it('uses 表／裏 labels instead of おもて／うら', () => {
    assert.match(mainJs, /pick === 'tails' \? '裏' : '表'/);
    assert.match(mainJs, /const labels = \['表', '裏'\]/);
    assert.match(mainJs, /id="m-heads">表</);
    assert.match(mainJs, /id="m-tails">裏</);
    assert.doesNotMatch(mainJs, /おもて/);
    assert.doesNotMatch(mainJs, /'うら'/);
    assert.match(engineJs, /face === 'heads' \? '表' : '裏'/);
    assert.doesNotMatch(engineJs, /おもて/);
  });

  it('keeps coin face text horizontal and single-glyph sized', () => {
    assert.match(css, /\.mg-coin\s*\{[^}]*writing-mode:\s*horizontal-tb/s);
    assert.match(css, /\.mg-die\.mg-coin-face\s*\{[^}]*white-space:\s*nowrap/s);
    assert.match(mainJs, /mg-die mg-die-sm mg-coin-face/);
  });
});
