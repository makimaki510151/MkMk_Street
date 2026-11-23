/**
 * 増資／店選びUI：エリア分け＋二重スクロール防止
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainJs = readFileSync(join(root, 'js/main.js'), 'utf8');
const css = readFileSync(join(root, 'css/styles.css'), 'utf8');

describe('invest shop pick UI', () => {
  it('groups shop picks by area with jump tabs', () => {
    assert.match(mainJs, /function renderGroupedShopPickList/);
    assert.match(mainJs, /function groupShopIdsByArea/);
    assert.match(mainJs, /shop-pick-tab/);
    assert.match(mainJs, /shop-pick-area-head/);
    assert.match(mainJs, /enableShopPickModalCard/);
    assert.match(mainJs, /bindShopPickAreaChrome/);
  });

  it('uses a single scroll container inside shop-pick-modal', () => {
    assert.match(css, /#modal \.modal-card\.shop-pick-modal\s*\{[^}]*overflow:\s*hidden/s);
    assert.match(css, /#modal \.modal-card\.shop-pick-modal \.pick-invest-list[\s\S]*?max-height:\s*none/s);
    assert.match(css, /\.shop-pick-area-head\s*\{[^}]*position:\s*sticky/s);
  });

  it('scrolls the shop list when a shop is picked from the map', () => {
    assert.match(mainJs, /function scrollShopPickIntoView/);
    assert.match(
      mainJs,
      /pick-invest-shop\[data-shop=[\s\S]*?btn\.click\(\);\s*\/\/[^\n]*\s*scrollShopPickIntoView\(btn\)/,
    );
  });
});
