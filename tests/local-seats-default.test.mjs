/**
 * ローカル対戦セットアップの席デフォルト
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const main = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../js/main.js'),
  'utf8',
);

describe('local seat editor defaults', () => {
  it('opens local setup with all 4 seats participating', () => {
    assert.match(main, /renderSeatEditors\(4\)/);
  });

  it('checks CPU for every seat except the first, and 参加 by count', () => {
    assert.match(
      main,
      /data-cpu="\$\{i\}" \$\{i > 0 \? 'checked' : ''\}/,
    );
    assert.match(
      main,
      /data-on="\$\{i\}" \$\{i < count \? 'checked' : ''\}/,
    );
  });
});
