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
