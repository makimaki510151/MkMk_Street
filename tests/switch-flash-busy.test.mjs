/**
 * Switch land must not latch event-flash confirm busy.
 * Mirrors the busy / silentStamp contracts in js/main.js (not imported:
 * main.js is a browser entry). Keep in sync with bannerFromLog /
 * enqueueBanner / presentSwitchFx.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const SWITCH_BANNER_SUPPRESS = /スイッチを倒した|経路が切り替わった|航路が切り替わった/;

function enqueueBanner(state, payload) {
  if (!payload?.title) return;
  state.stamps.push(payload);
  if (payload.silentStamp || payload.stampOnly) return;
  state.queue.push(payload);
  state.holdingBusy = true;
  state.busy = true;
}

function presentSwitchFx(state, moves, { remote = false } = {}) {
  if (!moves?.length) return;
  const wasBusy = state.busy;
  state.busy = true;
  if (!remote) {
    enqueueBanner(state, {
      kicker: 'スイッチ',
      title: '航路が切り替わった',
      detail: `動くマス ×${moves.length}`,
      kind: 'system',
      silentStamp: true,
    });
  }
  // Fixed path: never arm HoldingBusy from switch FX itself
  if (!wasBusy || !(state.holdingBusy || state.queue.length || state.open)) {
    state.busy = false;
  }
}

/** Mirrors reconcileStaleEventFlash HoldingBusy-only path (any phase). */
function reconcileHoldingBusyOnly(state, _phase) {
  if (!state.open && state.queue.length === 0 && (state.holdingBusy || state.busy)) {
    state.holdingBusy = false;
    state.busy = false;
    return true;
  }
  return false;
}

/** Host/local always auto-force human flash; spectator must not skip the timer. */
function shouldArmHumanAutoDismiss({ mode, canDismiss, npcReading }) {
  if (npcReading) return 'npc';
  if (mode === 'guest') return canDismiss ? 'guest-dismiss' : 'none';
  // host/local: always arm (force), even when spectator (!canDismiss)
  return 'force';
}

describe('switch land event-flash busy contract', () => {
  it('suppresses engine switch logs from becoming confirm banners', () => {
    const samples = [
      'Host がスイッチを倒した！ 経路が切り替わった（状態2）',
      '巻巻 がスイッチを倒した！ 経路が切り替わった（状態1）',
      '航路が切り替わった',
    ];
    for (const text of samples) {
      assert.match(text, SWITCH_BANNER_SUPPRESS);
    }
  });

  it('silentStamp enqueue does not latch HoldingBusy or queue flash', () => {
    const state = { stamps: [], queue: [], holdingBusy: false, busy: false, open: false };
    presentSwitchFx(state, [{ id: 1, from: { col: 0, row: 0 }, to: { col: 1, row: 0 } }]);
    assert.equal(state.stamps.length, 1);
    assert.equal(state.queue.length, 0);
    assert.equal(state.holdingBusy, false);
    assert.equal(state.busy, false);
    assert.equal(state.open, false);
  });

  it('guest remote switchSlide path does not enqueue confirm flash', () => {
    const state = { stamps: [], queue: [], holdingBusy: false, busy: true, open: false };
    presentSwitchFx(state, [{ id: 1, from: { col: 0, row: 0 }, to: { col: 1, row: 0 } }], { remote: true });
    assert.equal(state.stamps.length, 0);
    assert.equal(state.queue.length, 0);
    assert.equal(state.holdingBusy, false);
  });

  it('clears HoldingBusy-only deadlock after switch (await_roll)', () => {
    const state = { stamps: [], queue: [], holdingBusy: true, busy: true, open: false };
    assert.equal(reconcileHoldingBusyOnly(state, 'await_roll'), true);
    assert.equal(state.holdingBusy, false);
    assert.equal(state.busy, false);
  });

  it('clears HoldingBusy-only deadlock in await_choice (CPU confirm-wait stall)', () => {
    const state = { stamps: [], queue: [], holdingBusy: true, busy: true, open: false };
    assert.equal(reconcileHoldingBusyOnly(state, 'await_choice'), true);
    assert.equal(state.holdingBusy, false);
    assert.equal(state.busy, false);
  });

  it('host arms force auto-dismiss even when spectator (remote human reader)', () => {
    assert.equal(
      shouldArmHumanAutoDismiss({ mode: 'host', canDismiss: false, npcReading: false }),
      'force',
    );
    assert.equal(
      shouldArmHumanAutoDismiss({ mode: 'local', canDismiss: true, npcReading: false }),
      'force',
    );
    assert.equal(
      shouldArmHumanAutoDismiss({ mode: 'guest', canDismiss: false, npcReading: false }),
      'none',
    );
  });

  it('regression: old enqueueBanner ignoring silentStamp would stick confirm busy', () => {
    const state = { stamps: [], queue: [], holdingBusy: false, busy: true, open: false };
    // Pre-fix behavior: push stamp AND queue flash even with silentStamp
    const payload = {
      title: '航路が切り替わった',
      silentStamp: true,
    };
    state.stamps.push(payload);
    state.queue.push(payload); // bug
    state.holdingBusy = true;
    assert.ok(state.holdingBusy && state.queue.length > 0);

    // Fixed enqueueBanner skips queue when silentStamp
    const fixed = { stamps: [], queue: [], holdingBusy: false, busy: true, open: false };
    enqueueBanner(fixed, payload);
    assert.equal(fixed.queue.length, 0);
    assert.equal(fixed.holdingBusy, false);
  });
});
