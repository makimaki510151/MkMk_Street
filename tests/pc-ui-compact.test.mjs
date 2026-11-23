/**
 * 小さいPCウィンドウでも2カラムUIが収まる契約
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'css/styles.css'), 'utf8');
const main = readFileSync(join(root, 'js/main.js'), 'utf8');
const render = readFileSync(join(root, 'js/render.js'), 'utf8');

describe('PC UI compact layout', () => {
  it('uses a fluid side column width', () => {
    assert.match(css, /--side-w:\s*clamp\(\s*252px,\s*26vw,\s*340px\s*\)/);
  });

  it('clamps root font size for small viewports', () => {
    assert.match(css, /html\s*\{\s*font-size:\s*clamp\(/);
  });

  it('locks the game shell to the viewport height', () => {
    assert.match(
      css,
      /#screen-game\.active\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden/s,
    );
  });

  it('does not force mobile sheet UI on fine-pointer desktop windows', () => {
    assert.match(
      main,
      /MOBILE_UI_MQ = '\(max-width: 900px\) and \(hover: none\), \(max-width: 640px\)'/,
    );
    assert.match(
      render,
      /MOBILE_ZOOM_MQ = '\(max-width: 900px\) and \(hover: none\), \(max-width: 640px\)'/,
    );
  });
});
