/**
 * 催促の送信先解決（ゲーム進行の待ち手番を優先）。
 * 出来事フラッシュ担当は、手番／選択待ちが無いときのフォールバック。
 */

/**
 * @param {{
 *   phase?: string|null,
 *   pendingPlayerId?: number|null,
 *   currentPlayerIdx?: number|null,
 *   hideDiceResult?: boolean,
 *   eventFlashReaderId?: number|null,
 *   eventUiBlocking?: boolean,
 * }} opts
 * @returns {number|null}
 */
export function resolveWaitingSeatId({
  phase = null,
  pendingPlayerId = null,
  currentPlayerIdx = null,
  hideDiceResult = false,
  eventFlashReaderId = null,
  eventUiBlocking = false,
} = {}) {
  if (!phase || phase === 'gameover') return null;

  if (
    (phase === 'await_choice' || phase === 'await_fork')
    && pendingPlayerId != null
    && pendingPlayerId >= 0
  ) {
    return pendingPlayerId;
  }

  if (phase === 'await_roll' && !hideDiceResult && currentPlayerIdx != null && currentPlayerIdx >= 0) {
    return currentPlayerIdx;
  }

  // 移動中などで手番操作が無いときだけ、確認待ちフラッシュ担当
  if (eventUiBlocking && eventFlashReaderId != null && eventFlashReaderId >= 0) {
    return eventFlashReaderId;
  }

  return null;
}
