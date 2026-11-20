/**
 * スマホUI: 常時表示 / 必要時表示の契約テスト
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

describe('mobile UI shell', () => {
  it('keeps action dock and side sheet hooks in markup', () => {
    assert.match(html, /id="action-dock"/);
    assert.match(html, /id="mobile-player-strip"/);
    assert.match(html, /class="mobile-info-nav"/);
    assert.match(html, /id="side-backdrop"/);
    assert.match(html, /id="side-panel"/);
    assert.match(html, /id="btn-side-close"/);
    assert.match(html, /id="btn-inspect-close"/);
    assert.match(html, /id="inspect-body"/);
    // 操作は常時ドック側（side 内に残さない）
    assert.match(html, /id="action-dock"[\s\S]*id="side-controls"/);
    assert.doesNotMatch(html, /id="side-panel"[\s\S]*id="side-controls"/);
  });

  it('marks topbar chips as essential vs detail', () => {
    assert.match(html, /id="turn-chip"[^>]*topbar-essential|topbar-essential"[^>]*id="turn-chip"/);
    assert.match(html, /id="goal-chip"[^>]*topbar-essential|topbar-essential"[^>]*id="goal-chip"/);
    assert.match(html, /id="map-chip"[^>]*topbar-detail|topbar-detail"[^>]*id="map-chip"/);
    assert.match(html, /id="phase-chip"[^>]*topbar-detail|topbar-detail"[^>]*id="phase-chip"/);
  });

  it('CSS opens side as sheet only under mobile breakpoint', () => {
    assert.match(css, /@media \(max-width: 900px\)/);
    assert.match(css, /body\.side-sheet-open \.side/);
    assert.match(css, /\.topbar \.topbar-detail \{ display: none; \}/);
    assert.match(css, /\.mobile-player-strip \{/);
    assert.match(css, /\.mobile-info-nav \{/);
  });

  it('JS exposes open/close side sheet helpers', () => {
    assert.match(main, /function openSideSheet/);
    assert.match(main, /function closeSideSheet/);
    assert.match(main, /function renderMobilePlayerStrip/);
    assert.match(main, /function isMobileUi/);
    assert.match(main, /sideSheetOpen/);
  });
});
