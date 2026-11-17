/**
 * 催促送信先は手番／選択待ちを優先し、フラッシュ担当はフォールバック。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWaitingSeatId } from '../js/nudgeTarget.js';

describe('nudge waiting seat resolution', () => {
  it('prefers pending player over stale event-flash reader', () => {
    assert.equal(
      resolveWaitingSeatId({
        phase: 'await_choice',
        pendingPlayerId: 2,
        currentPlayerIdx: 2,
        eventFlashReaderId: 0,
        eventUiBlocking: true,
      }),
      2,
    );
  });

  it('prefers current roller over stale event-flash reader', () => {
    assert.equal(
      resolveWaitingSeatId({
        phase: 'await_roll',
        pendingPlayerId: null,
        currentPlayerIdx: 1,
        eventFlashReaderId: 0,
        eventUiBlocking: true,
      }),
      1,
    );
  });

  it('falls back to flash reader when no actionable phase', () => {
    assert.equal(
      resolveWaitingSeatId({
        phase: 'moving',
        pendingPlayerId: null,
        currentPlayerIdx: 1,
        eventFlashReaderId: 3,
        eventUiBlocking: true,
      }),
      3,
    );
  });

  it('returns null while dice result is still hidden on await_roll', () => {
    assert.equal(
      resolveWaitingSeatId({
        phase: 'await_roll',
        currentPlayerIdx: 1,
        hideDiceResult: true,
        eventFlashReaderId: null,
        eventUiBlocking: false,
      }),
      null,
    );
  });

  it('allows host seat 0 as waiting target (guest→host nudge)', () => {
    assert.equal(
      resolveWaitingSeatId({
        phase: 'await_roll',
        currentPlayerIdx: 0,
        eventUiBlocking: false,
      }),
      0,
    );
  });
});
