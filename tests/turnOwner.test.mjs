import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalPlayer, isMyTurnSeat } from '../js/turnOwner.js';

describe('turnOwner', () => {
  it('does not treat host as seat 0 after order roll reorder', () => {
    const host = { id: 2, peerId: 'host-peer', isCPU: false };
    const guestSeat0 = { id: 0, peerId: 'guest-peer', isCPU: false };

    assert.equal(isLocalPlayer({
      mode: 'host',
      player: host,
      localSeat: 2,
      localPeerId: 'host-peer',
    }), true);

    assert.equal(isLocalPlayer({
      mode: 'host',
      player: guestSeat0,
      localSeat: 2,
      localPeerId: 'host-peer',
    }), false);

    assert.equal(isMyTurnSeat({
      mode: 'host',
      phase: 'await_roll',
      currentPlayer: guestSeat0,
      localSeat: 2,
      localPeerId: 'host-peer',
    }), false);

    assert.equal(isMyTurnSeat({
      mode: 'host',
      phase: 'await_roll',
      currentPlayer: host,
      localSeat: 2,
      localPeerId: 'host-peer',
    }), true);
  });

  it('matches guest by peerId even when localSeat is stale', () => {
    const me = { id: 1, peerId: 'guest-a', isCPU: false };
    assert.equal(isLocalPlayer({
      mode: 'guest',
      player: me,
      localSeat: 0, // stale
      localPeerId: 'guest-a',
    }), true);
    assert.equal(isLocalPlayer({
      mode: 'guest',
      player: { id: 0, peerId: 'other', isCPU: false },
      localSeat: 0,
      localPeerId: 'guest-a',
    }), false);
  });

  it('falls back to localSeat when peerId is missing', () => {
    assert.equal(isLocalPlayer({
      mode: 'host',
      player: { id: 1, peerId: null, isCPU: false },
      localSeat: 1,
      localPeerId: 'host-peer',
    }), true);
    assert.equal(isLocalPlayer({
      mode: 'host',
      player: { id: 0, peerId: null, isCPU: false },
      localSeat: 1,
      localPeerId: 'host-peer',
    }), false);
  });
});
