import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PATCH_NOTES } from '../js/patchNotes.js';
import { APP_VERSION } from '../js/version.js';

describe('patch notes', () => {
  it('has newest-first entries with version and items', () => {
    assert.ok(Array.isArray(PATCH_NOTES) && PATCH_NOTES.length > 0);
    for (const entry of PATCH_NOTES) {
      assert.equal(typeof entry.version, 'string');
      assert.ok(entry.version.length > 0);
      assert.ok(Array.isArray(entry.items) && entry.items.length > 0);
    }
  });

  it('lists current APP_VERSION as the first exact entry when present', () => {
    const exact = PATCH_NOTES.find((e) => e.version === APP_VERSION);
    assert.ok(exact, `PATCH_NOTES に現行版 ${APP_VERSION} の項目が必要`);
    assert.equal(PATCH_NOTES[0].version, APP_VERSION);
  });
});
