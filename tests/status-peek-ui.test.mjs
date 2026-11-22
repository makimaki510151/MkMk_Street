/**
 * プレイヤーカードのステータスを所持株同様の押下可能チップにし、説明を出す契約。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const main = readFileSync(join(root, 'js/main.js'), 'utf8');
const css = readFileSync(join(root, 'css/styles.css'), 'utf8');

describe('status peek buttons (like stock peek)', () => {
  it('renders status as buttons with detail payload', () => {
    assert.match(main, /function bindStatusPeek/);
    assert.match(main, /data-status-key/);
    assert.match(main, /data-status-detail/);
    assert.match(main, /pc-status-detail/);
    assert.match(main, /statusPeek/);
    assert.match(main, /★ラッキー/);
    assert.match(main, /出目\$\{.*\}固定|出目.*固定/);
    assert.match(main, /店守り/);
    assert.match(main, /共同オーナー/);
  });

  it('styles status buttons and detail panel', () => {
    assert.match(css, /button\.pc-flag/);
    assert.match(css, /\.pc-status-detail/);
    assert.match(css, /button\.pc-flag\.peek-on|\.pc-flag\.peek-on/);
  });
});
