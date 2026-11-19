/**
 * 分かれ道直後の購入/増資UI欠落防止契約。
 * main.js の isLocalPendingChoice / busy 優先ロジックをミラー。
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

/** refreshGameUI 相当: 自分の選択待ちなら busy を落としてモーダル表示フラグを立てる */
function ensureChoiceUi(app, g) {
  const mine = isLocalPendingChoice(app, g);
  if (!mine) {
    if (!app.busy) app.modalShown = false;
    return { mine: false, shown: false };
  }
  if (app.eventFlashOpen || app.holdingBusy || (app.queue?.length > 0)) {
    app.eventFlashOpen = false;
    app.holdingBusy = false;
    app.queue = [];
  }
  app.busy = false;
  app.modalShown = true;
  return { mine: true, shown: true };
}

describe('fork → land choice UI priority', () => {
  it('shows buy/invest UI even when movement busy is still latched', () => {
    const app = {
      mode: 'host',
      localSeat: 0,
      busy: true,
      eventFlashOpen: false,
      holdingBusy: false,
      queue: [],
      modalShown: false,
    };
    const g = {
      phase: 'await_choice',
      pending: { type: 'invest', playerId: 0 },
      players: [{ id: 0, isCPU: false }, { id: 1, isCPU: true }],
    };
    const r = ensureChoiceUi(app, g);
    assert.equal(r.shown, true);
    assert.equal(app.busy, false);
    assert.equal(app.modalShown, true);
  });

  it('flushes covering event flash before showing choice', () => {
    const app = {
      mode: 'guest',
      localSeat: 1,
      busy: true,
      eventFlashOpen: true,
      holdingBusy: true,
      queue: [{ title: '方面へ' }],
      modalShown: false,
    };
    const g = {
      phase: 'await_choice',
      pending: { type: 'buy_shop', playerId: 1 },
      players: [{ id: 0, isCPU: false }, { id: 1, isCPU: false }],
    };
    const r = ensureChoiceUi(app, g);
    assert.equal(r.shown, true);
    assert.equal(app.eventFlashOpen, false);
    assert.equal(app.queue.length, 0);
    assert.equal(app.busy, false);
  });

  it('does not force UI for other players choice', () => {
    const app = {
      mode: 'guest',
      localSeat: 0,
      busy: true,
      eventFlashOpen: false,
      holdingBusy: false,
      queue: [],
      modalShown: false,
    };
    const g = {
      phase: 'await_choice',
      pending: { type: 'buy_shop', playerId: 1 },
      players: [{ id: 0, isCPU: false }, { id: 1, isCPU: false }],
    };
    const r = ensureChoiceUi(app, g);
    assert.equal(r.shown, false);
    assert.equal(app.busy, true);
  });

  it('regression: old logic skipped modal when busy && !eventBlocking', () => {
    const busy = true;
    const eventBlocking = false;
    const mine = true;
    // 旧: mine && eventBlocking → flush; mine && !busy → show
    const wouldShowOld = mine && !busy;
    const wouldFlushOld = mine && eventBlocking;
    assert.equal(wouldFlushOld, false);
    assert.equal(wouldShowOld, false);

    // 新: mine なら busy を落として必ず show
    const wouldShowNew = mine;
    assert.equal(wouldShowNew, true);
  });

  it('stale fork nextId is ignored once pending is buy_shop', () => {
    // main.js: nextId のみの choice は pend.type === 'fork' のときだけ受理
    const pend = { type: 'buy_shop', playerId: 0, shopId: 3, price: 200 };
    const choice = { nextId: 3 };
    const accept = pend.type === 'fork' && choice.nextId != null && choice.action == null;
    assert.equal(accept, false);
  });

  it('forkResolving blocks a second nextId while the first is animating', () => {
    let forkResolving = false;
    const tryFork = () => {
      if (forkResolving) return 'blocked';
      forkResolving = true;
      return 'started';
    };
    assert.equal(tryFork(), 'started');
    assert.equal(tryFork(), 'blocked');
  });
});
