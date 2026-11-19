import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  pendingFingerprint,
  modalContentKey,
  snapshotEditableFields,
  restoreEditableFields,
} from '../js/formDrafts.js';

describe('formDrafts', () => {
  it('pendingFingerprint is stable for same pending and changes on edit', () => {
    const a = { type: 'invest', playerId: 0, amount: 100 };
    const b = { type: 'invest', playerId: 0, amount: 100 };
    const c = { type: 'invest', playerId: 0, amount: 200 };
    assert.equal(pendingFingerprint(a), pendingFingerprint(b));
    assert.notEqual(pendingFingerprint(a), pendingFingerprint(c));
    assert.equal(pendingFingerprint(null), '');
  });

  it('modalContentKey for raise_funds changes when cash or holdings change', () => {
    const pend = { type: 'raise_funds', playerId: 0, targetCash: 500, reason: 'toll' };
    const g = {
      players: [{ id: 0, cash: 100, stocks: { 1: 5 } }],
      map: [{ id: 10, type: 'shop', owner: 0 }],
    };
    const a = modalContentKey(g, pend);
    g.players[0].cash = 400;
    const b = modalContentKey(g, pend);
    assert.notEqual(a, b);
    g.players[0].stocks[1] = 2;
    const c = modalContentKey(g, pend);
    assert.notEqual(b, c);
  });

  it('snapshot/restore keeps number drafts across rebuild', () => {
    const root = {
      nodes: [],
      querySelectorAll(sel) {
        if (sel === 'input, textarea') return this.nodes;
        return [];
      },
      querySelector(sel) {
        if (sel.startsWith('#')) return this.nodes.find((n) => n.id === sel.slice(1)) || null;
        const m = /data-sell-count="(\d+)"/.exec(sel);
        if (m) return this.nodes.find((n) => n.getAttribute('data-sell-count') === m[1]) || null;
        return null;
      },
    };
    const input = {
      id: 'm-amt',
      type: 'number',
      value: '1234',
      selectionStart: 2,
      selectionEnd: 4,
      getAttribute: () => null,
      focus() { this.focused = true; },
      setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
    };
    const sell = {
      id: '',
      type: 'number',
      value: '7',
      selectionStart: 0,
      selectionEnd: 1,
      attrs: { 'data-sell-count': '3' },
      getAttribute(k) { return this.attrs[k] ?? null; },
      focus() { this.focused = true; },
      setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
    };
    root.nodes = [input, sell];

    const drafts = snapshotEditableFields(root, { activeElement: input });
    assert.equal(drafts.length, 2);
    assert.equal(drafts[0].value, '1234');
    assert.equal(drafts[0].focused, true);
    assert.equal(drafts[1].sellCount, '3');

    // 再構築で初期値に戻った想定
    input.value = '0';
    sell.value = '1';
    input.focused = false;
    restoreEditableFields(root, drafts);
    assert.equal(input.value, '1234');
    assert.equal(sell.value, '7');
    assert.equal(input.focused, true);
    assert.equal(input.selectionStart, 2);
    assert.equal(input.selectionEnd, 4);
  });
});
