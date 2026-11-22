/**
 * スクラッチ図鑑：番号とタイトルが視覚的に分離されている契約。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'css/styles.css'), 'utf8');
const main = readFileSync(join(root, 'js/main.js'), 'utf8');

describe('scratch dex title gap', () => {
  it('keeps number column wide enough and separated from the label', () => {
    assert.match(css, /\.scratch-dex-row\s*\{[^}]*grid-template-columns:\s*5\.6rem/);
    assert.match(css, /\.scratch-dex-num\s*\{[^}]*padding-right:\s*0\.55rem/s);
    assert.match(css, /\.scratch-dex-num\s*\{[^}]*border-right:/s);
    assert.match(css, /\.scratch-dex-num\s*\{[^}]*white-space:\s*nowrap/s);
  });

  it('renders num and label as separate spans', () => {
    assert.match(main, /class="scratch-dex-num"/);
    assert.match(main, /class="scratch-dex-label"/);
    assert.match(main, /No\.\$\{String\(e\.id\)\.padStart\(3, '0'\)\}/);
  });
});
