/**
 * サイコロ当て：結果演出の左側は各自の予想出目
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainJs = readFileSync(join(root, 'js/main.js'), 'utf8');
const css = readFileSync(join(root, 'css/styles.css'), 'utf8');

describe('guess_dice party pick faces', () => {
  it('renders each player pick on the left of the reveal', () => {
    assert.match(mainJs, /mg-dice-pick-grid/);
    assert.match(mainJs, /みんなの予想/);
    assert.match(mainJs, /partyRows\.length > 1/);
    assert.match(css, /\.mg-dice-pick-grid/);
    assert.match(css, /\.mg-die-sm/);
  });
});
