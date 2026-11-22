/**
 * ハイ＆ロー：予想表示は「高／低」1文字で枠内に収める
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

describe('high_low pick display', () => {
  it('uses 高／低 labels for compact pick faces', () => {
    assert.match(mainJs, /pick === 'high' \? '高' : '低'/);
    assert.match(mainJs, /bandRaw === 'high' \? '高' : '低'/);
    assert.match(mainJs, /id="m-hi">高（6〜10）</);
    assert.match(mainJs, /id="m-lo">低（1〜5）</);
    assert.match(engineJs, /pick === 'high' \? '高' : '低'/);
    assert.match(mainJs, /mg-die mg-die-sm mg-hl-face/);
  });

  it('keeps high-low face text horizontal and single-glyph sized', () => {
    assert.match(css, /\.mg-die\.mg-hl-face\s*\{[^}]*writing-mode:\s*horizontal-tb/s);
    assert.match(css, /\.mg-die\.mg-hl-face\s*\{[^}]*white-space:\s*nowrap/s);
  });
});
