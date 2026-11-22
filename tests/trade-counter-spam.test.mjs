/**
 * 物件逆交渉の連打で進行停止しない契約。
 * main.js の refreshGameUI / bannerFromLog / choiceResolving をミラー。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function isLocalPendingChoice(app, g) {
  if (!g || (g.phase !== 'await_choice' && g.phase !== 'await_fork') || !g.pending) return false;
  const pl = g.players[g.pending.playerId];
  if (!pl || pl.bankrupt) return false;
  if (app.mode === 'local') return !pl.isCPU;
  return g.pending.playerId === app.localSeat;
}

/**
 * refreshGameUI の選択モーダル分岐ミラー。
 * 相手／CPU待ちでは busy 中でも必ず古い選択UIを閉じる。
 */
function refreshChoiceModalVisibility(app, g) {
  const mine = isLocalPendingChoice(app, g);
  if ((g.phase === 'await_choice' || g.phase === 'await_fork') && g.pending) {
    if (mine) {
      app.modalActive = true;
      app.modalShown = true;
      return { mine: true, modalShown: true };
    }
    app.modalActive = false;
    app.modalShown = false;
    return { mine: false, modalShown: false };
  }
  if (!app.busy) {
    app.modalActive = false;
    app.modalShown = false;
  }
  return { mine: false, modalShown: !!app.modalShown };
}

/** bannerFromLog の物件交渉ログ抑制ミラー */
function tradeNegotiationStampOnly(kind, text) {
  return kind === 'shop' && /物件取引|逆交渉を申し込んだ/.test(text);
}

function enqueueBanner(state, payload) {
  if (!payload?.title) return;
  state.stamps.push(payload);
  if (payload.silentStamp || payload.stampOnly) return;
  state.queue.push(payload);
  state.holdingBusy = true;
  state.busy = true;
}

function tryApplyChoice(app, actorIsLocalHuman) {
  if (app.choiceResolving) return 'blocked';
  if (!actorIsLocalHuman) return 'rejected_cpu';
  app.choiceResolving = true;
  try {
    return 'applied';
  } finally {
    app.choiceResolving = false;
  }
}

describe('trade counter spam stall guards', () => {
  it('hides stale trade modal when counter flips pending to CPU even if busy', () => {
    const app = {
      mode: 'local',
      localSeat: 0,
      busy: true,
      modalActive: true,
      modalShown: true,
    };
    const g = {
      phase: 'await_choice',
      pending: { type: 'shop_trade_offer', playerId: 1, fromId: 0 },
      players: [
        { id: 0, isCPU: false },
        { id: 1, isCPU: true },
      ],
    };
    // 旧: !mine && busy → モーダルを閉じず、逆交渉ボタンが残る
    const oldWouldHide = !isLocalPendingChoice(app, g) && !app.busy;
    assert.equal(oldWouldHide, false);

    const r = refreshChoiceModalVisibility(app, g);
    assert.equal(r.mine, false);
    assert.equal(r.modalShown, false);
    assert.equal(app.modalActive, false);
  });

  it('trade propose/counter logs are stamp-only (do not latch confirm busy)', () => {
    assert.equal(
      tradeNegotiationStampOnly('shop', '太郎 が 花子 に物件の逆交渉を申し込んだ'),
      true,
    );
    assert.equal(
      tradeNegotiationStampOnly('shop', '太郎 が 花子 に物件取引を持ちかけた'),
      true,
    );
    assert.equal(
      tradeNegotiationStampOnly('shop', '太郎 ⇔ 花子 物件取引（出: パン屋 → 受: 花屋／ 太郎 が 30G 支払い）'),
      true,
      '成立ログも busy を掴んではいけない',
    );
    assert.equal(
      tradeNegotiationStampOnly('shop', '太郎 が「パン屋」を購入（200G）'),
      false,
    );

    const state = { stamps: [], queue: [], holdingBusy: false, busy: false };
    enqueueBanner(state, {
      title: '物件取引',
      detail: '太郎 が 花子 に物件の逆交渉を申し込んだ',
      kind: 'shop',
      stampOnly: tradeNegotiationStampOnly('shop', '太郎 が 花子 に物件の逆交渉を申し込んだ'),
    });
    assert.equal(state.stamps.length, 1);
    assert.equal(state.queue.length, 0);
    assert.equal(state.busy, false);
    assert.equal(state.holdingBusy, false);
  });

  it('choiceResolving blocks a second counter while the first is resolving', () => {
    const app = { choiceResolving: false };
    app.choiceResolving = true;
    assert.equal(tryApplyChoice(app, true), 'blocked');
    app.choiceResolving = false;
    assert.equal(tryApplyChoice(app, true), 'applied');
  });

  it('local path rejects applying choice on behalf of CPU pending', () => {
    const app = { choiceResolving: false };
    assert.equal(tryApplyChoice(app, false), 'rejected_cpu');
  });
});
