import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  eventDefSignature,
  describeEventDef,
  syncScratchDexWithCatalog,
  markScratchEventSeen,
  isScratchEventSeen,
  getScratchDexEntries,
} from '../js/scratchDex.js';
import { EVENT_CATALOG, EVENT_COUNT } from '../js/eventTable.js';

/** Node に localStorage が無いので最小ポリフィル */
function installMemoryStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
  };
}

beforeEach(() => {
  installMemoryStorage();
});

describe('scratch dex', () => {
  it('describes N× buy and new event effects', () => {
    const six = EVENT_CATALOG.find((e) => e.effect === 'any_shop_buy' && e.multi === 6);
    assert.ok(six);
    assert.match(describeEventDef(six), /6倍/);
    const vacant = EVENT_CATALOG.find((e) => e.effect === 'vacant_shop_buy');
    assert.match(describeEventDef(vacant), /空き店/);
    const rival = EVENT_CATALOG.find((e) => e.effect === 'force_rival_sell');
    assert.match(describeEventDef(rival), /銀行/);
    const shuffle = EVENT_CATALOG.find((e) => e.effect === 'shuffle_marks');
    assert.match(describeEventDef(shuffle), /シャッフル/);
  });

  it('records seen events and hides unseen labels', () => {
    syncScratchDexWithCatalog();
    const id = 40;
    assert.equal(isScratchEventSeen(id), false);
    markScratchEventSeen(id);
    assert.equal(isScratchEventSeen(id), true);
    const entries = getScratchDexEntries();
    assert.equal(entries.length, EVENT_COUNT);
    const seen = entries.find((e) => e.id === id);
    const unseen = entries.find((e) => e.id !== id);
    assert.equal(seen.seen, true);
    assert.notEqual(seen.label, '？？？');
    assert.equal(unseen.seen, false);
    assert.equal(unseen.label, '？？？');
  });

  it('clears witness when catalog signature for that id changes', () => {
    syncScratchDexWithCatalog();
    const id = 12;
    markScratchEventSeen(id);
    assert.equal(isScratchEventSeen(id), true);

    const mutated = EVENT_CATALOG.map((e) => (
      e.id === id ? { ...e, label: `${e.label}・改` } : e
    ));
    // 指紋だけ先に現行カタログで保存されているので、mutated 照合で消える
    const result = syncScratchDexWithCatalog(mutated);
    assert.ok(result.cleared.includes(id));
    assert.equal(isScratchEventSeen(id), false);
  });

  it('keeps witness when signature is unchanged', () => {
    syncScratchDexWithCatalog();
    markScratchEventSeen(7);
    const again = syncScratchDexWithCatalog();
    assert.equal(again.cleared.length, 0);
    assert.equal(isScratchEventSeen(7), true);
  });

  it('signatures differ when multi changes', () => {
    const a = eventDefSignature({ kind: 'x', label: 'L', effect: 'any_shop_buy', multi: 5 });
    const b = eventDefSignature({ kind: 'x', label: 'L', effect: 'any_shop_buy', multi: 6 });
    assert.notEqual(a, b);
  });
});
