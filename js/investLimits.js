/**
 * エリア独占率に応じた増資限度。
 * 独占率 = 自分の店数 / エリア内店数。
 */

/** @param {number} owned @param {number} total */
export function monopolyRate(owned, total) {
  if (!total || total <= 0) return 0;
  return Math.min(1, Math.max(0, owned / total));
}

/**
 * 独占率 → 増資限度倍率（店の元本 basePrice に対する倍率）
 * 4軒エリアでは従来の所有軒数テーブルと一致:
 * 1/4→0.5, 2/4→1, 3/4→3, 4/4→9
 */
export function investMultiByMonopolyRate(rate) {
  if (rate >= 1) return 9; // 完全独占
  if (rate >= 0.75) return 3; // 75%以上
  if (rate >= 0.5) return 1; // 半分以上
  if (rate > 0) return 0.5; // 1軒以上
  return 0;
}

/** 増資できる追加投資の上限（G） */
export function maxExtraInvest(basePrice, owned, total) {
  const multi = investMultiByMonopolyRate(monopolyRate(owned, total));
  return Math.floor((basePrice || 0) * multi);
}

/** まだ積み増せる額 */
export function remainingInvest(basePrice, extraInvest, owned, total) {
  return Math.max(0, maxExtraInvest(basePrice, owned, total) - (extraInvest || 0));
}
