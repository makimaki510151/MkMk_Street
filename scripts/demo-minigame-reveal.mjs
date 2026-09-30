#!/usr/bin/env node
/** Visual demo: slot / coin minigame reveal overlays */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const OUT = '/tmp/cursor/artifacts/screenshots';
fs.mkdirSync(OUT, { recursive: true });

const chrome =
  process.env.CHROME_PATH ||
  ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/local/bin/google-chrome']
    .find((p) => fs.existsSync(p));

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function startLocalGame(page) {
  await page.waitForSelector('#btn-local', { visible: true });
  await page.click('#btn-local');
  await page.waitForSelector('#btn-start-game', { visible: true });
  await sleep(400);
  await page.click('#btn-start-game');
  await page.waitForSelector('#screen-game.active', { timeout: 10000 });
  await sleep(600);
}

async function capture(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log('shot', file);
  return file;
}

async function runDemo(page, demo, clickSelector, midName, resultName) {
  await page.goto(`http://127.0.0.1:8080/?demo=${demo}`, { waitUntil: 'networkidle0' });
  await startLocalGame(page);
  await page.waitForSelector(clickSelector, { visible: true, timeout: 8000 });
  await sleep(500);
  await capture(page, `minigame-${demo}-modal.png`);
  await page.click(clickSelector);

  // wait until overlay appears
  await page.waitForFunction(() => {
    const el = document.querySelector('#minigame-overlay');
    return el && !el.hidden;
  }, { timeout: 5000 });
  await sleep(700);
  await capture(page, midName);

  // wait until result title shows
  await page.waitForFunction(() => {
    const ov = document.querySelector('#minigame-overlay');
    return ov && ov.classList.contains('show-result');
  }, { timeout: 8000 });
  await sleep(350);
  await capture(page, resultName);

  const info = await page.evaluate(() => {
    const title = document.querySelector('#mg-title')?.textContent || '';
    const detail = document.querySelector('#mg-detail')?.textContent || '';
    const tier = [...document.querySelector('#minigame-overlay')?.classList || []]
      .find((c) => c.startsWith('tier-')) || '';
    return { title, detail, tier };
  });
  console.log(demo, info);

  // let overlay finish
  await sleep(1400);
  return info;
}

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: false,
  defaultViewport: { width: 1280, height: 800 },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800'],
});

try {
  const page = await browser.newPage();
  const slot = await runDemo(page, 'slot', '#m-spin', 'minigame-slot-spinning.png', 'minigame-slot-result.png');
  await sleep(800);
  const coin = await runDemo(page, 'coin', '#m-heads', 'minigame-coin-flip.png', 'minigame-coin-result.png');
  console.log(JSON.stringify({ ok: true, slot, coin }, null, 2));
} finally {
  await browser.close();
}
