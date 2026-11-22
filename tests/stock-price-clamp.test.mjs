/**
 * 株価は常に2桁（10〜99G）。街の話題で1Gへ潰れるバグの回帰防止。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  updateAreaStockPrices,
  applyStockSellPressure,
  STOCK_PRICE_MIN,
  STOCK_PRICE_MAX,
  STOCK_SELL_PRESSURE_MIN,
  clampStockPrice,
} from '../js/engine.js';
import { MAP_CATALOG } from '../js/board.js';

describe('stock price clamp 10–99', () => {
  it('exports 2-digit bounds', () => {
    assert.equal(STOCK_PRICE_MIN, 10);
    assert.equal(STOCK_PRICE_MAX, 99);
    assert.equal(clampStockPrice(1), 10);
    assert.equal(clampStockPrice(150), 99);
    assert.equal(clampStockPrice(42), 42);
  });

  it('all maps start with 2-digit stock prices', () => {
    for (const map of MAP_CATALOG) {
      const g = createGame({
        players: [{ name: 'A' }, { name: 'B' }],
        seed: 1,
        cash: 3000,
        mapId: map.id,
      });
      for (const a of Object.keys(g.areas).map(Number)) {
        const price = g.areas[a].stockPrice;
        assert.ok(
          price >= STOCK_PRICE_MIN && price <= STOCK_PRICE_MAX,
          `${map.id} area ${a}: ${price}`,
        );
      }
    }
  });

  it('street_buzz raises B without collapsing price to 1G', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 7,
      cash: 3000,
    });
    const area = Number(Object.keys(g.areas)[0]);
    const beforeB = g.areas[area].B;
    const beforePrice = g.areas[area].stockPrice;
    assert.ok(beforeB > 1000, `expected large default B, got ${beforeB}`);
    assert.ok(beforePrice >= STOCK_PRICE_MIN);

    // 旧バグ: Math.min(250, B*1.06) → B=250 → 株価1G
    g.areas[area].B = Math.floor((g.areas[area].B || 100) * 1.06);
    updateAreaStockPrices(g);
    assert.ok(g.areas[area].B > beforeB);
    assert.ok(g.areas[area].B > 250, `B must not be crushed to 250, got ${g.areas[area].B}`);
    assert.ok(
      g.areas[area].stockPrice >= beforePrice,
      `street buzz should not crash price: ${g.areas[area].stockPrice} < ${beforePrice}`,
    );
    assert.ok(g.areas[area].stockPrice <= STOCK_PRICE_MAX);
  });

  it('heavy sell pressure cannot drop price below STOCK_PRICE_MIN', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 9,
      cash: 3000,
    });
    const area = Number(Object.keys(g.areas)[0]);
    g.players[0].stocks[area] = 500;
    for (let i = 0; i < 40; i += 1) {
      applyStockSellPressure(g, g.players[0], area, STOCK_SELL_PRESSURE_MIN);
    }
    updateAreaStockPrices(g);
    assert.ok(g.areas[area].stockPrice >= STOCK_PRICE_MIN);
    assert.ok(g.areas[area].stockPrice <= STOCK_PRICE_MAX);
  });

  it('extreme shop avg + high B still caps at STOCK_PRICE_MAX', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 11,
      cash: 3000,
    });
    const area = Number(Object.keys(g.areas)[0]);
    for (const sq of g.map.filter((s) => s.type === 'shop' && s.area === area)) {
      sq.price = 50000;
      sq.basePrice = 50000;
      sq.extraInvest = 0;
    }
    g.areas[area].B = 20000;
    updateAreaStockPrices(g);
    assert.equal(g.areas[area].stockPrice, STOCK_PRICE_MAX);
  });
});
