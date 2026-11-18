/**
 * ゲーム開始前の順番決めダイス（1〜100）。
 * 出目が大きいほど先手。同点者がいればその人たちだけ振り直し。
 */

export const ORDER_DIE_MIN = 1;
export const ORDER_DIE_MAX = 100;

/**
 * @param {{ key: string, value: number }[]} rolls
 * @returns {string[]} 同点で再ロールが必要な key
 */
export function tiedRollKeys(rolls) {
  const byVal = new Map();
  for (const r of rolls) {
    if (!Number.isFinite(r.value)) continue;
    const v = Math.floor(r.value);
    if (!byVal.has(v)) byVal.set(v, []);
    byVal.get(v).push(r.key);
  }
  /** @type {string[]} */
  const tied = [];
  for (const keys of byVal.values()) {
    if (keys.length > 1) tied.push(...keys);
  }
  return tied;
}

function isValidOrderRoll(value) {
  return Number.isFinite(value)
    && value >= ORDER_DIE_MIN
    && value <= ORDER_DIE_MAX;
}

/**
 * @param {{ key: string }[]} players
 * @param {Record<string, number>} rollMap
 * @returns {{ done: true, order: string[] } | { done: false, rerollKeys: string[] }}
 */
export function evaluateOrderRolls(players, rollMap) {
  const keys = players.map((p) => p.key);
  const rolls = keys.map((key) => ({
    key,
    value: Number(rollMap[key]),
  }));
  if (rolls.some((r) => !isValidOrderRoll(r.value))) {
    return {
      done: false,
      rerollKeys: rolls
        .filter((r) => !isValidOrderRoll(r.value))
        .map((r) => r.key),
    };
  }
  const tied = tiedRollKeys(rolls);
  if (tied.length) {
    return { done: false, rerollKeys: tied };
  }
  const order = [...rolls]
    .sort((a, b) => b.value - a.value || String(a.key).localeCompare(String(b.key)))
    .map((r) => r.key);
  return { done: true, order };
}

/** 1〜100 の出目 */
export function rollOrderDie(rng = Math.random) {
  const n = typeof rng === 'function' ? rng() : Math.random();
  const u = Math.max(0, Math.min(0.999999, n));
  return ORDER_DIE_MIN + Math.floor(u * (ORDER_DIE_MAX - ORDER_DIE_MIN + 1));
}

/**
 * 順番決め中の切断プレイヤーを名前／peerId で復帰させる。
 * key は変えない（出目・pending の対応を壊さない）。
 * @returns {object|null} 復帰したプレイヤー
 */
export function reclaimOrderRollPlayer(orderRoll, { name, peerId } = {}) {
  if (!orderRoll?.players?.length || !peerId) return null;
  const nm = String(name || '').trim();
  const byPeer = orderRoll.players.find((p) => p.peerId === peerId);
  const byName = nm
    ? orderRoll.players.find((p) => !p.isCPU && p.name === nm)
    : null;
  const pl = byPeer || byName;
  if (!pl || pl.isCPU) return null;
  pl.peerId = peerId;
  pl.disconnected = false;
  return pl;
}

/**
 * 順番決め中の切断を記録（セッションは継続）。
 * @returns {object|null}
 */
export function markOrderRollPlayerLeft(orderRoll, peerId) {
  if (!orderRoll?.players?.length || !peerId) return null;
  const pl = orderRoll.players.find((p) => p.peerId === peerId);
  if (!pl || pl.isCPU) return null;
  pl.disconnected = true;
  pl.peerId = null;
  return pl;
}
