#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const OUT = '/opt/cursor/artifacts/screenshots';
fs.mkdirSync(OUT, { recursive: true });
const chrome = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/local/bin/google-chrome']
  .find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: false,
  defaultViewport: { width: 1280, height: 800 },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800'],
});

try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8080/?demo=scratch-match', { waitUntil: 'networkidle0' });
  await page.click('#btn-local');
  await page.waitForSelector('#btn-start-game', { visible: true });
  await page.click('#btn-start-game');
  await page.waitForSelector('.scratch-grid', { timeout: 10000 });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'scratch-match-before.png') });

  // Click cell index 2 (third on first row) — first sealed cell should be #2
  const target = await page.evaluateHandle(() => {
    const cells = [...document.querySelectorAll('.scratch-cell')];
    // prefer data-cell="2"
    return cells.find((c) => c.dataset.cell === '2') || cells.find((c) => c.classList.contains('sealed'));
  });
  const el = target.asElement();
  if (!el) throw new Error('no sealed cell');
  await el.click();

  // Wait for match-spin class or result text
  await page.waitForFunction(() => {
    return document.querySelector('.scratch-cell.match-spin')
      || document.querySelector('.sm-chip')
      || (document.querySelector('#scratch-result')?.textContent || '').includes('そろい');
  }, { timeout: 5000 });
  await sleep(350);
  await page.screenshot({ path: path.join(OUT, 'scratch-match-spinning.png') });
  await sleep(1200);
  await page.screenshot({ path: path.join(OUT, 'scratch-match-after.png') });

  const info = await page.evaluate(() => ({
    result: document.querySelector('#scratch-result')?.textContent || '',
    banner: document.querySelector('.eb-title')?.textContent || '',
    spun: document.querySelectorAll('.match-spin, .sm-chip').length,
  }));
  console.log(JSON.stringify(info, null, 2));
} finally {
  await browser.close();
}
