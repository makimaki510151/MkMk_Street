/**
 * スクロールバーがUIトーン（暗いパネル＋金アクセント）に合わせてある契約。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'css/styles.css'), 'utf8');

describe('scrollbar UI styling', () => {
  it('defines themed scrollbar CSS variables', () => {
    assert.match(css, /--scroll-size:/);
    assert.match(css, /--scroll-track:/);
    assert.match(css, /--scroll-thumb:/);
    assert.match(css, /--scroll-thumb-hover:/);
  });

  it('styles Firefox and WebKit scrollbars with accent colors', () => {
    assert.match(css, /scrollbar-width:\s*thin/);
    assert.match(css, /scrollbar-color:\s*var\(--scroll-thumb\)\s+var\(--scroll-track\)/);
    assert.match(css, /\*::-webkit-scrollbar\b/);
    assert.match(css, /\*::-webkit-scrollbar-thumb\b/);
    assert.match(css, /var\(--accent/);
  });
});
