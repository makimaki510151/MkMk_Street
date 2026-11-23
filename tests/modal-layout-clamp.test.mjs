/**
 * モーダル端寄せ後のはみ出し防止（座標クランプ）
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clampModalDrag,
  floatingModalMaxHeightPx,
  modalDragMarginsForUi,
  MOBILE_MODAL_DOCK_RESERVE,
  MODAL_DRAG_MARGINS,
} from '../js/modalLayout.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainJs = readFileSync(join(root, 'js/main.js'), 'utf8');
const css = readFileSync(join(root, 'css/styles.css'), 'utf8');

describe('clampModalDrag', () => {
  it('keeps a small card tucked to the bottom-right inside the viewport', () => {
    // y=672 → 672+120+8=800 ちょうど画面内
    const next = clampModalDrag(
      { x: 912, y: 672 },
      { w: 280, h: 120 },
      { w: 1200, h: 800 },
    );
    assert.equal(next.x, 912);
    assert.equal(next.y, 672);
  });

  it('pulls a large invest card back when reusing a corner position', () => {
    // 小さいカードを右下に寄せた座標のまま、増資モーダル相当の大きさへ
    const next = clampModalDrag(
      { x: 900, y: 700 },
      { w: 400, h: 560 },
      { w: 1200, h: 800 },
    );
    assert.equal(next.x, 1200 - 400 - MODAL_DRAG_MARGINS.x);
    assert.equal(next.y, 800 - 560 - MODAL_DRAG_MARGINS.bottom);
    assert.ok(next.x + 400 + MODAL_DRAG_MARGINS.x <= 1200);
    assert.ok(next.y + 560 + MODAL_DRAG_MARGINS.bottom <= 800);
  });

  it('clamps to top/left margins when dragged past the origin', () => {
    const next = clampModalDrag(
      { x: -40, y: 10 },
      { w: 360, h: 400 },
      { w: 1000, h: 700 },
    );
    assert.equal(next.x, MODAL_DRAG_MARGINS.x);
    assert.equal(next.y, MODAL_DRAG_MARGINS.top);
  });

  it('computes floating max height from viewport', () => {
    assert.equal(
      floatingModalMaxHeightPx(800),
      800 - MODAL_DRAG_MARGINS.top - MODAL_DRAG_MARGINS.bottom,
    );
    assert.equal(floatingModalMaxHeightPx(100), 140);
  });

  it('caps floating max height on mobile so cards stay compact', () => {
    const margins = modalDragMarginsForUi(true);
    assert.equal(margins.bottom, MOBILE_MODAL_DOCK_RESERVE);
    const tallPhone = floatingModalMaxHeightPx(844, margins, { mobile: true });
    assert.ok(tallPhone <= 420);
    assert.ok(tallPhone <= Math.round(844 * 0.48));
    const shop = floatingModalMaxHeightPx(844, margins, {
      mobile: true,
      variant: 'shop-pick',
    });
    assert.ok(shop <= 520);
    assert.ok(shop <= Math.round(844 * 0.58));
    assert.ok(shop >= tallPhone);
  });
});

describe('modal overflow wiring', () => {
  it('wires clamp helpers into main modal positioning', () => {
    assert.match(mainJs, /from '\.\/modalLayout\.js'/);
    assert.match(mainJs, /function scheduleModalLayoutClamp/);
    assert.match(mainJs, /clampModalDrag\(/);
    assert.match(mainJs, /floatingModalMaxHeightPx\(/);
    assert.match(mainJs, /modalDragMarginsForUi\(/);
    assert.match(mainJs, /scheduleModalLayoutClamp\(\)/);
  });

  it('caps floating modal size in CSS', () => {
    assert.match(css, /#modal\.floating \.modal-card\s*\{[^}]*max-height:\s*calc\(100dvh - 60px\)/s);
    assert.match(css, /#modal\.floating \.modal-card\.shop-pick-modal/);
  });

  it('overrides floating modal height under the mobile breakpoint', () => {
    assert.match(
      css,
      /@media \(max-width: 900px\) and \(hover: none\), \(max-width: 640px\)[\s\S]*#modal\.floating \.modal-card[\s\S]*max-height:\s*min\(48vh, 420px\)/,
    );
    assert.match(
      css,
      /#modal\.centered \.modal-card\.scratch-modal\s*\{[^}]*max-height:\s*min\(78dvh/s,
    );
  });
});
