/**
 * ドラッグ移動したモーダルが、サイズ変更後も画面内に収まるよう座標をクランプする。
 * （小さい分岐ヒントを端に寄せたあと、増資など大きいカードが開くとはみ出す問題の対策）
 */
export const MODAL_DRAG_MARGINS = Object.freeze({
  x: 8,
  top: 52,
  bottom: 8,
});

/** スマホのアクションドックぶん、下端を空ける（px） */
export const MOBILE_MODAL_DOCK_RESERVE = 112;

/**
 * @param {boolean} mobile
 * @returns {{ x: number, top: number, bottom: number }}
 */
export function modalDragMarginsForUi(mobile) {
  if (!mobile) return { ...MODAL_DRAG_MARGINS };
  return {
    ...MODAL_DRAG_MARGINS,
    bottom: Math.max(MODAL_DRAG_MARGINS.bottom, MOBILE_MODAL_DOCK_RESERVE),
  };
}

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
 * スマホでは画面の半分前後に抑え、ドックと重ならないようにする。
 *
 * @param {number} viewportH
 * @param {{ x?: number, top?: number, bottom?: number }} [margins]
 * @param {{ mobile?: boolean, variant?: 'default' | 'shop-pick' | 'raise' | 'stock' }} [opts]
 */
export function floatingModalMaxHeightPx(viewportH, margins = MODAL_DRAG_MARGINS, opts = {}) {
  const mt = margins.top ?? MODAL_DRAG_MARGINS.top;
  const mb = margins.bottom ?? MODAL_DRAG_MARGINS.bottom;
  const vh = Number(viewportH) || 0;
  let max = Math.max(140, vh - mt - mb);
  if (opts.mobile) {
    const variant = opts.variant || 'default';
    if (variant === 'shop-pick' || variant === 'raise') {
      max = Math.min(max, Math.round(vh * 0.58), 520);
    } else if (variant === 'stock') {
      max = Math.min(max, Math.round(vh * 0.52), 460);
    } else {
      max = Math.min(max, Math.round(vh * 0.48), 420);
    }
  }
  return max;
}
