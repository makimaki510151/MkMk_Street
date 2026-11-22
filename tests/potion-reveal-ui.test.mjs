/**
 * 薬品マス結果：各自の効果が分かる一覧表示の契約。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const main = readFileSync(join(root, 'js/main.js'), 'utf8');
const css = readFileSync(join(root, 'css/styles.css'), 'utf8');

describe('potion reveal clarity', () => {
  it('renders a per-player result board with effect and outcome', () => {
    assert.match(main, /function renderPotionRevealBoard/);
    assert.match(main, /function potionResultLine/);
    assert.match(main, /potion-result-board/);
    assert.match(main, /potion-result-outcome/);
    assert.match(main, /potion-result-effect/);
    assert.match(main, /classList\.add\('party', 'potion-reveal'\)/);
  });

  it('CSS styles the potion result rows for readability', () => {
    assert.match(css, /\.potion-result-board\b/);
    assert.match(css, /\.potion-result-row\b/);
    assert.match(css, /\.potion-result-outcome\b/);
    assert.match(css, /#minigame-overlay\.potion-reveal/);
  });

  it('banner summary uses concrete outcome text per player', () => {
    assert.match(main, /potionResultLine\(r\)/);
    assert.match(main, /みんなの結果/);
  });
});
