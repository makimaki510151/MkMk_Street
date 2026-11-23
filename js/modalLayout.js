/**
 * ドラッグ移動したモーダルが、サイズ変更後も画面内に収まるよう座標をクランプする。
 * （小さい分岐ヒントを端に寄せたあと、増資など大きいカードが開くとはみ出す問題の対策）
 */
export const MODAL_DRAG_MARGINS = Object.freeze({
  x: 8,
  top: 52,
  bottom: 8,
});

/**
 * @param {{ x: number, y: number }} drag
 * @param {{ w: number, h: number }} cardSize
 * @param {{ w: number, h: number }} viewport
 * @param {{ x?: number, top?: number, bottom?: number }} [margins]
 * @returns {{ x: number, y: number }}
 */
export function clampModalDrag(drag, cardSize, viewport, margins = MODAL_DRAG_MARGINS) {
  const mx = margins.x ?? MODAL_DRAG_MARGINS.x;
  const mt = margins.top ?? MODAL_DRAG_MARGINS.top;
  const mb = margins.bottom ?? MODAL_DRAG_MARGINS.bottom;
  const w = Math.max(1, Number(cardSize.w) || 1);
  const h = Math.max(1, Number(cardSize.h) || 1);
  const vw = Math.max(1, Number(viewport.w) || 1);
  const vh = Math.max(1, Number(viewport.h) || 1);
  const maxX = Math.max(mx, vw - w - mx);
  const maxY = Math.max(mt, vh - h - mb);
  return {
    x: Math.max(mx, Math.min(maxX, Number(drag.x) || 0)),
    y: Math.max(mt, Math.min(maxY, Number(drag.y) || 0)),
  };
}

/**
 * フローティング時にカードが収まる最大高さ（px）。
 * top マージン＋bottom マージンを引いたビューポート高さ。
 */
export function floatingModalMaxHeightPx(viewportH, margins = MODAL_DRAG_MARGINS) {
  const mt = margins.top ?? MODAL_DRAG_MARGINS.top;
  const mb = margins.bottom ?? MODAL_DRAG_MARGINS.bottom;
  return Math.max(140, (Number(viewportH) || 0) - mt - mb);
}
