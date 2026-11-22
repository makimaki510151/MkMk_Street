/**
 * ミニゲーム上役・祝福の紙吹雪演出契約。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'css/styles.css'), 'utf8');
const main = readFileSync(join(root, 'js/main.js'), 'utf8');

describe('minigame confetti celebration', () => {
  it('celebrate-fx markup includes confetti host and extra sparkles', () => {
    assert.match(html, /id="celebrate-fx"/);
    assert.match(html, /class="cfx-confetti"/);
    assert.match(html, /class="cfx-sparkles"/);
    const sparkles = html.match(/class="cfx-sparkles"[\s\S]*?<\/div>/)?.[0] || '';
    const spans = sparkles.match(/<span>/g) || [];
    assert.ok(spans.length >= 12, `sparkles should have 12+ spans, got ${spans.length}`);
  });

  it('CSS defines confetti fall and jackpot/big bloom variants', () => {
    assert.match(css, /\.cfx-bit\b/);
    assert.match(css, /@keyframes cfxConfettiFall/);
    assert.match(css, /#celebrate-fx\[data-variant="jackpot"\]/);
    assert.match(css, /#celebrate-fx\[data-variant="big"\]/);
    assert.match(css, /\.mg-confetti\b/);
    assert.match(css, /\.cfx-bit-ribbon\b/);
  });

  it('JS spawns confetti for jackpot/上役 and overlay mid-result', () => {
    assert.match(main, /function spawnConfettiBurst/);
    assert.match(main, /function presentCelebrateFx/);
    assert.match(main, /CELEBRATE_CONFETTI_COLORS/);
    assert.match(main, /variant === 'jackpot'/);
    assert.match(main, /variant === 'big'/);
    assert.match(main, /className = 'mg-confetti'/);
    assert.match(main, /tier === 'fullhouse'/);
    assert.match(main, /tier === 'triple'/);
    assert.match(main, /tier === 'pair'/);
  });
});
