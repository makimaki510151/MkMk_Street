/**
 * ローカルセットアップ／オンラインロビーは画面内に収まり、ページスクロール不要
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'css/styles.css'), 'utf8');

describe('setup/lobby fit without page scroll', () => {
  it('uses compact two-column shells with overflow hidden', () => {
    assert.match(html, /class="panel setup-panel"/);
    assert.match(html, /class="panel lobby-panel"/);
    assert.match(html, /class="setup-rules-row"/);
    assert.match(html, /class="lobby-layout"/);
    assert.match(html, /class="lobby-main"/);
    assert.match(css, /#screen-setup,\s*#screen-lobby\s*\{[^}]*overflow:\s*hidden/s);
    assert.match(css, /\.setup-panel,\s*\.lobby-panel\s*\{[^}]*overflow:\s*hidden/s);
    assert.match(css, /\.setup-rules-row\s*\{[^}]*grid-template-columns/s);
    assert.match(css, /\.lobby-layout\s*\{[^}]*grid-template-columns/s);
    assert.match(css, /\.lobby-map-layout\s*\{[^}]*grid-template-columns/s);
  });

  it('keeps chip option descriptions out of the chip body to save height', () => {
    assert.match(
      css,
      /\.cpu-diff-picker \.map-option-body small\s*\{\s*display:\s*none/,
    );
  });
});
