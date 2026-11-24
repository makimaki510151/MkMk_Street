/**
 * セットアップのマップ配置プレビュー契約
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_CATALOG, buildBoard } from '../js/board.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'css/styles.css'), 'utf8');

describe('setup map preview', () => {
  it('setup screen has no-scroll layout hooks and preview canvas', () => {
    assert.match(html, /class="panel setup-panel"/);
    assert.match(html, /class="setup-layout"/);
    assert.match(html, /id="setup-map-preview"/);
    assert.match(html, /id="lobby-map-preview"/);
    assert.match(html, /map-picker-chips/);
    assert.match(css, /\.setup-panel/);
    assert.match(css, /#screen-setup,\s*#screen-lobby\s*\{[^}]*overflow:\s*hidden/s);
    assert.match(css, /\.map-preview-canvas/);
  });

  it('every catalog map exposes col/row cells for a numberless silhouette', () => {
    for (const def of MAP_CATALOG) {
      const board = buildBoard(def.id);
      const nodes = board.nodes.filter((n) => n.col != null && n.row != null);
      assert.ok(nodes.length >= 8, `${def.id}: too few positioned nodes`);
      const shops = nodes.filter((n) => n.type === 'shop');
      assert.ok(shops.length >= 4, `${def.id}: need shops for area colors`);
      // プレビューはラベル／価格を使わない（座標と種別だけで描ける）
      for (const n of nodes) {
        assert.equal(typeof n.col, 'number');
        assert.equal(typeof n.row, 'number');
        assert.ok(n.type);
      }
    }
  });
});
