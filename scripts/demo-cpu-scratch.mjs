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

  await page.goto('http://127.0.0.1:8080/', { waitUntil: 'networkidle0' });
  await page.click('#btn-local');
  await page.waitForSelector('#btn-start-game', { visible: true });
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) {
      document.querySelector(`input[data-on="${i}"]`).checked = true;
      document.querySelector(`input[data-cpu="${i}"]`).checked = i > 0;
    }
  });
  await sleep(200);
  await page.click('#btn-start-game');
  await page.waitForSelector('#screen-game.active', { timeout: 10000 });
  await sleep(700);
  await page.screenshot({ path: path.join(OUT, 'cpu-personality-badges.png') });
  console.log('cpu labels', await page.$$eval('.pc-flag.cpu-style', (els) => els.map((e) => e.textContent)));

  await page.goto('http://127.0.0.1:8080/?demo=scratch', { waitUntil: 'networkidle0' });
  await page.click('#btn-local');
  await page.waitForSelector('#btn-start-game', { visible: true });
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) {
      document.querySelector(`input[data-on="${i}"]`).checked = true;
      document.querySelector(`input[data-cpu="${i}"]`).checked = i > 0;
    }
  });
  await page.click('#btn-start-game');
  await page.waitForSelector('.scratch-grid', { timeout: 8000 });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'scratch-opener-colors.png') });
  const done = await page.$$eval('.scratch-cell.done.by-player', (els) => els.map((e) => e.style.getPropertyValue('--pc')));
  console.log('painted colors', [...new Set(done)]);
  console.log('ok');
} finally {
  await browser.close();
}
