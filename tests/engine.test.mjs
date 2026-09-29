import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  calcToll,
  getPlayerAreaCount,
  getTollMulti,
  getPlayerAssets,
  rollDice,
  advanceMove,
  applyChoice,
  chooseFork,
  getForwardNexts,
  continueMove,
  updateAreaStockPrices,
} from '../js/engine.js';
import { buildBoard, AREA_SHOP_MAX, AREA_SHOP_BASE } from '../js/board.js';

describe('MkMk Street engine', () => {
  it('builds a branching board (not a single loop)', () => {
    const board = buildBoard();
    const multi = board.nodes.filter((n) => (n.nexts?.length || 0) >= 3);
    assert.ok(multi.length >= 5, 'expected multiple 3+ way junctions');
    const bank = board.nodes.find((n) => n.id === board.startId);
    assert.equal(bank.nexts.length, 4, 'bank should be 4-way');
    // 双方向リンクされていること
    for (const n of board.nodes) {
      for (const nid of n.nexts) {
        const other = board.nodes.find((x) => x.id === nid);
        assert.ok(other.nexts.includes(n.id), `missing back-link ${n.id}<->${nid}`);
      }
    }
  });

  it('keeps each stock area at 4 shops (max 5)', () => {
    const board = buildBoard();
    const counts = {};
    for (const n of board.nodes.filter((x) => x.type === 'shop')) {
      counts[n.area] = (counts[n.area] || 0) + 1;
    }
    const areas = Object.keys(counts);
    assert.ok(areas.length >= 6);
    for (const [area, count] of Object.entries(counts)) {
      assert.ok(count <= AREA_SHOP_MAX, `area ${area} has ${count} shops`);
      assert.ok(count >= 3, `area ${area} has too few shops (${count})`);
      // 基本は4件
      assert.equal(count, AREA_SHOP_BASE, `area ${area} should be base ${AREA_SHOP_BASE}, got ${count}`);
    }
  });

  it('creates a board with shops and areas', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 1,
      goal: 10000,
    });
    const shops = g.map.filter((n) => n.type === 'shop');
    assert.ok(shops.length >= 16);
    assert.ok(Object.keys(g.areas).length >= 4);
    assert.equal(g.players[0].cash, 2000);
  });

  it('computes toll multipliers by area ownership', () => {
    assert.equal(getTollMulti(1), 1);
    assert.equal(getTollMulti(2), 1.25);
    assert.equal(getTollMulti(4), 5);
  });

  it('raises toll when owning multiple shops in an area', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 42,
    });
    const area = Number(Object.keys(g.areas)[0]);
    const shops = g.map.filter((n) => n.type === 'shop' && n.area === area);
    shops[0].owner = 0;
    const toll1 = calcToll(g, shops[0]);
    for (const s of shops) s.owner = 0;
    const tollMax = calcToll(g, shops[0]);
    assert.ok(getPlayerAreaCount(g, 0, area) >= 2);
    assert.ok(tollMax > toll1);
  });

  it('updates stock prices from shop values', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 7,
    });
    const area = Number(Object.keys(g.areas)[0]);
    const before = g.areas[area].stockPrice;
    const shop = g.map.find((n) => n.type === 'shop' && n.area === area);
    shop.price += 500;
    shop.extraInvest += 500;
    updateAreaStockPrices(g);
    assert.ok(g.areas[area].stockPrice >= before);
  });

  it('asks for a fork when leaving the bank', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B', isCPU: true }],
      seed: 99,
    });
    const result = rollDice(g);
    assert.equal(result.ok, true);
    assert.equal(result.needsAdvance, true);
    const step = advanceMove(g);
    assert.equal(step.forked, true);
    assert.equal(g.phase, 'await_fork');
    assert.equal(g.pending?.type, 'fork');
    assert.ok(g.pending.options.length >= 2);
  });

  it('continues movement after choosing a fork', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 11,
    });
    rollDice(g);
    advanceMove(g);
    assert.equal(g.phase, 'await_fork');
    const nextId = g.pending.options[0].id;
    const stepsBefore = g.move.stepsLeft;
    const result = chooseFork(g, nextId);
    assert.equal(result.ok, true);
    assert.equal(g.players[0].pos, nextId);
    assert.ok(!g.move || g.move.stepsLeft < stepsBefore);
  });

  it('continueMove reaches fork or landing', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 3,
    });
    rollDice(g);
    const r = continueMove(g);
    assert.equal(r.ok, true);
    assert.ok(r.forked || r.done || g.phase === 'await_choice' || g.phase === 'await_roll' || g.phase === 'gameover' || g.phase === 'await_fork');
  });

  it('filters reverse direction from forward nexts', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 3,
    });
    const bank = g.startId;
    const arm = getForwardNexts(g, bank, null);
    assert.equal(arm.length, 4);
    const first = arm[0];
    const fwd = getForwardNexts(g, first, bank);
    assert.ok(!fwd.includes(bank));
  });

  it('can buy a vacant shop via choice', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 3,
    });
    const shop = g.map.find((n) => n.type === 'shop');
    g.players[0].pos = shop.id;
    g.phase = 'await_choice';
    g.pending = { type: 'buy_shop', playerId: 0, shopId: shop.id, price: shop.price };
    const before = g.players[0].cash;
    const result = applyChoice(g, { action: 'buy' });
    assert.equal(result.ok, true);
    assert.equal(shop.owner, 0);
    assert.equal(g.players[0].cash, before - shop.price);
  });

  it('sums net worth from cash, shops and stocks', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 5,
    });
    const shop = g.map.find((n) => n.type === 'shop');
    shop.owner = 0;
    const area = shop.area;
    g.players[0].stocks[area] = 10;
    const assets = getPlayerAssets(g, g.players[0]);
    assert.equal(assets.total, assets.cash + assets.shopAsset + assets.stockAsset);
    assert.ok(assets.shopAsset === shop.price);
    assert.ok(assets.stockAsset === g.areas[area].stockPrice * 10);
  });

  it('places suit marks at the four corners', () => {
    const board = buildBoard();
    const marks = board.nodes.filter((n) => n.type === 'mark');
    assert.equal(marks.length, 4);
    const corners = new Set(marks.map((m) => `${m.col},${m.row}`));
    assert.ok(corners.has('0,0'));
    assert.ok(corners.has('10,0'));
    assert.ok(corners.has('0,10'));
    assert.ok(corners.has('10,10'));
    const hubs = board.nodes.filter((n) =>
      (n.col === 5 && n.row === 0) ||
      (n.col === 10 && n.row === 5) ||
      (n.col === 5 && n.row === 10) ||
      (n.col === 0 && n.row === 5)
    );
    assert.equal(hubs.length, 4);
    assert.ok(hubs.every((h) => h.type !== 'mark'));
    assert.ok(hubs.some((h) => h.type === 'rest'));
    assert.ok(hubs.some((h) => h.type === 'holiday'));
    assert.ok(hubs.some((h) => h.type === 'event'));
  });

  it('opens event-table scratch when landing on a mark', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 21,
    });
    assert.ok(g.players[0].eventTable);
    assert.equal(g.players[0].eventTable.cells.length, 100);
    const mark = g.map.find((n) => n.type === 'mark');
    g.players[0].pos = mark.id;
    g.phase = 'moving';
    g.move = { stepsLeft: 0, path: [mark.id], passedBank: false, startPos: g.startId };
    const r = advanceMove(g);
    assert.equal(r.ok, true);
    assert.equal(g.phase, 'await_choice');
    assert.equal(g.pending?.type, 'scratch');
    assert.equal(g.players[0].marks[mark.mark], true);
    const cellId = g.pending.openIds[0];
    const scratched = applyChoice(g, { action: 'scratch', cellId });
    assert.equal(scratched.ok, true);
    assert.equal(g.players[0].eventTable.cells[cellId].scratched, true);
  });

  it('keeps rest squares minimal on the board', () => {
    const board = buildBoard();
    const rests = board.nodes.filter((n) => n.type === 'rest');
    assert.ok(rests.length <= 1, `expected at most 1 rest, got ${rests.length}`);
  });

  it('has one dedicated scratch hub and one event hub on mid-sides', () => {
    const board = buildBoard();
    const scratches = board.nodes.filter((n) => n.type === 'scratch');
    const events = board.nodes.filter((n) => n.type === 'event');
    assert.equal(scratches.length, 1);
    assert.ok(events.length >= 1);
    assert.equal(scratches[0].col, 0);
    assert.equal(scratches[0].row, 5);
  });

  it('auto-skips resting player without starting a move', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B', isCPU: true }],
      seed: 2,
    });
    g.players[0].resting = true;
    const r = rollDice(g);
    assert.equal(r.skipped, true);
    assert.equal(g.players[0].resting, false);
    assert.equal(g.currentPlayerIdx, 1);
    assert.equal(g.move, null);
  });

  it('shop holiday zeroes toll for one turn', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 8,
    });
    const shop = g.map.find((n) => n.type === 'shop');
    shop.owner = 0;
    g.players[0].shopsClosed = true;
    assert.equal(calcToll(g, shop), 0);
    g.players[0].shopsClosed = false;
    assert.ok(calcToll(g, shop) > 0);
  });
});
