import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  calcToll,
  hasAreaMonopoly,
  tryGrantMonopolyBonus,
  applyMonopolyBreak,
  MONOPOLY_BONUS_RATE,
  MONOPOLY_BREAK_B_RATE,
  getGoalPressurePlayers,
  refreshGoalPressure,
  serializeState,
  restoreState,
  getAreaShops,
  getPlayerAreaCount,
  getTollMulti,
  getPlayerAssets,
  getMaxExtraInvest,
  getRemainingInvest,
  getAreaMonopolyRate,
  investMultiByMonopolyRate,
  applyCappedShopBoost,
  getLiquidatableValue,
  preTurnSell,
  canSellStockOnTurn,
  rollDice,
  advanceMove,
  applyChoice,
  chooseFork,
  getForwardNexts,
  continueMove,
  updateAreaStockPrices,
  buildGameResults,
  createEmptyStats,
  ensureStats,
  recordWorthSnapshot,
  syncStockValueSnap,
  payAreaStockDividend,
  STOCK_DIVIDEND_PER_SHARE,
  STOCK_DIVIDEND_MAX_RATE,
  convertPlayerToCpu,
  kickDisconnectedPlayer,
  cpuAct,
  getCpuPersonality,
  CPU_PERSONALITY_KEYS,
  PLAYER_COLORS,
  normalizePlayerColor,
  normalizeLobbyColors,
  getLevelBonus,
  toggleBoardSwitch,
  getNode,
  cpuCashReserve,
  cpuCanAffordSpend,
  cpuEstimateMaxToll,
} from '../js/engine.js';
import { buildBoard, AREA_SHOP_MAX, AREA_SHOP_BASE, MAP_CATALOG } from '../js/board.js';
import {
  unscratchedIds,
  EVENT_CATALOG,
  EVENT_COUNT,
  applyAllCash,
  scratchCell,
  playerColorIndex,
  MATCH_BONUS_PER,
} from '../js/eventTable.js';

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

  it('offers multiple maps including a detached island board', () => {
    assert.ok(MAP_CATALOG.length >= 3);
    const ids = new Set(MAP_CATALOG.map((m) => m.id));
    assert.ok(ids.has('central_cross'));
    assert.ok(ids.has('shell_harbor'));
    assert.ok(ids.has('cliff_isle'));

    for (const def of MAP_CATALOG) {
      const board = buildBoard(def.id);
      assert.equal(board.mapId, def.id);
      assert.ok(board.nodes.length > 10);
      assert.ok(board.cols >= 9 && board.rows >= 7);
      for (const n of board.nodes) {
        for (const nid of n.nexts) {
          const other = board.nodes.find((x) => x.id === nid);
          assert.ok(other?.nexts.includes(n.id), `${def.id}: missing back-link`);
        }
      }
      const counts = {};
      for (const s of board.nodes.filter((x) => x.type === 'shop')) {
        counts[s.area] = (counts[s.area] || 0) + 1;
      }
      for (const [area, count] of Object.entries(counts)) {
        assert.ok(count <= AREA_SHOP_MAX, `${def.id} area ${area}: ${count}`);
        assert.ok(count >= 3, `${def.id} area ${area}: too few (${count})`);
      }
    }

    const isle = buildBoard('cliff_isle');
    assert.ok(isle.areas[7], 'cliff isle should have detached area 7');
    assert.ok(isle.areas[8], 'cliff isle should have second island area 8');
    assert.equal(isle.areas[7].name, 'がけしたどおり');
    assert.equal(isle.areas[8].name, '潮風どおり');
    assert.ok(isle.nodes.some((n) => n.type === 'warp'));
    assert.ok(isle.nodes.some((n) => n.type === 'suit_fill'), 'island has suit_fill square');
    // 小島に株マスはない（証券は本島側）
    const isleNodeIds = new Set();
    {
      const warps = isle.nodes.filter((n) => n.type === 'warp');
      const isleWarp = warps.find((n) => n.label.includes('本島')) || warps.find((n) => n.col >= 8);
      assert.ok(isleWarp);
      const q = [isleWarp.id];
      isleNodeIds.add(isleWarp.id);
      while (q.length) {
        const id = q.shift();
        const node = isle.nodes.find((n) => n.id === id);
        for (const nid of node.nexts || []) {
          if (!isleNodeIds.has(nid)) {
            isleNodeIds.add(nid);
            q.push(nid);
          }
        }
      }
      for (const id of isleNodeIds) {
        const n = isle.nodes.find((x) => x.id === id);
        assert.notEqual(n.type, 'stockbroker', 'island must not have center stockbroker');
      }
    }
    assert.ok(isle.nodes.some((n) => n.type === 'stockbroker' && n.col < 8), 'main island keeps a stockbroker');
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 2,
      mapId: 'cliff_isle',
    });
    assert.equal(g.mapId, 'cliff_isle');
    assert.ok(g.cols >= 13);

    // 島は徒歩では到達できない
    const bank = getNode(g, g.startId);
    const seen = new Set([bank.id]);
    const q = [bank.id];
    while (q.length) {
      const id = q.shift();
      for (const nid of getNode(g, id).nexts) {
        if (!seen.has(nid)) {
          seen.add(nid);
          q.push(nid);
        }
      }
    }
    const isleShop = g.map.find((n) => n.type === 'shop' && n.area === 7);
    assert.ok(isleShop);
    assert.equal(seen.has(isleShop.id), false);
    assert.equal(seen.has(g.map.find((n) => n.type === 'shop' && n.area === 8).id), false);

    // ワープ着地で島へ
    const mainWarp = g.map.find((n) => n.type === 'warp' && n.label.includes('島'));
    assert.ok(mainWarp?.warpTo != null);
    g.players[0].pos = mainWarp.id;
    g.move = { stepsLeft: 0, path: [mainWarp.id], passedBank: false, startPos: g.startId };
    g.phase = 'moving';
    const landed = advanceMove(g);
    assert.equal(landed.ok, true);
    assert.ok(landed.warps?.length >= 1);
    assert.equal(g.players[0].pos, mainWarp.warpTo);

    // マーク補充マス：足りないマークを1つ付与
    const fill = g.map.find((n) => n.type === 'suit_fill');
    assert.ok(fill);
    g.currentPlayerIdx = 0;
    g.players[0].marks = [true, false, true, false];
    g.players[0].pos = fill.id;
    g.players[0].flags.bankVisitDone = false;
    g.move = { stepsLeft: 0, path: [fill.id], passedBank: false, startPos: g.startId };
    g.phase = 'moving';
    g.pending = null;
    advanceMove(g);
    assert.deepEqual(g.players[0].marks, [true, true, true, false]);
  });

  it('shell harbor forks at inward switch between pier and sea route', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 4,
      mapId: 'shell_harbor',
    });
    const swN = g.map.find((n) => n.type === 'switch' && n.row === 1);
    const pierScratch = g.map.find((n) => n.type === 'scratch' && n.col === 3 && n.row === 1);
    assert.ok(swN && pierScratch);
    // 北スイッチは内側。スクラッチ（旧浜茶屋）から来ると埠頭継続／航路の分岐
    g.players[0].pos = swN.id;
    g.players[0].prevPos = pierScratch.id;
    g.move = { stepsLeft: 3, path: [swN.id], passedBank: false, startPos: g.startId };
    g.phase = 'moving';
    const step = advanceMove(g);
    assert.equal(step.forked, true);
    const labels = (g.pending.options || []).map((o) => o.label);
    assert.ok(labels.includes('北埠頭へ') || labels.includes('もう一回'), labels.join(','));
    assert.ok(labels.includes('航路へ'), labels.join(','));
  });

  it('shell harbor packs rim; pier hubs switches; areas regrouped', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 5,
      mapId: 'shell_harbor',
    });
    const bank = g.map.find((n) => n.type === 'bank');
    const switches = g.map.filter((n) => n.type === 'switch');
    assert.ok(bank);
    assert.equal(switches.length, 4);
    assert.equal(g.map.some((n) => n.type === 'minigame' && n.game === 'guess_dice'), false);
    // 東埠頭のチャンスは証券へ。スクラッチは北埠頭（旧浜茶屋）
    const broker = g.map.find((n) => n.type === 'stockbroker');
    const scratch = g.map.find((n) => n.type === 'scratch');
    assert.ok(broker);
    assert.equal(broker.col, 7);
    assert.equal(broker.row, 4);
    assert.ok(scratch);
    assert.equal(scratch.col, 3);
    assert.equal(scratch.row, 1);
    // かき小屋↔スロット入替、屋台横丁はラッキー
    const kaki = g.map.find((n) => n.label === 'かき小屋');
    const slot = g.map.find((n) => n.type === 'minigame' && n.game === 'slot');
    const luckyS = g.map.find((n) => n.type === 'lucky' && n.col === 3 && n.row === 6);
    assert.ok(kaki && slot && luckyS);
    assert.equal(kaki.col, 5);
    assert.equal(kaki.row, 7);
    assert.equal(slot.col, 5);
    assert.equal(slot.row, 6);
    // エリア再編
    const areaOf = (label) => g.map.find((n) => n.label === label)?.area;
    assert.equal(areaOf('真珠店'), 1);
    assert.equal(areaOf('貝細工'), 1);
    assert.equal(areaOf('船着場'), 1);
    assert.equal(areaOf('貝がら屋'), 1);
    assert.equal(areaOf('珊瑚屋'), 2);
    assert.equal(areaOf('砂浜カフェ'), 2);
    assert.equal(areaOf('サーフ屋'), 2);
    assert.equal(areaOf('かき氷'), 2);
    assert.equal(areaOf('屋台船'), 2);
    assert.equal(areaOf('ホテル'), 3);
    assert.equal(areaOf('水族館'), 3);
    assert.equal(areaOf('港食堂'), 3);
    assert.equal(areaOf('埠頭食堂'), 3);
    assert.equal(areaOf('ヨット屋'), 4);
    assert.equal(areaOf('灯台茶屋'), 4);
    assert.equal(areaOf('みやげ屋'), 4);
    assert.equal(areaOf('温泉宿'), 4);
    assert.equal(areaOf('かき小屋'), 5);
    assert.equal(areaOf('銭湯'), 5);
    assert.equal(areaOf('うどん'), 5);
    assert.equal(areaOf('たこ焼き'), 5);
    assert.equal(areaOf('渡し舟'), 5);
    assert.equal(areaOf('鮮魚'), 6);
    assert.equal(areaOf('海女小屋'), 6);
    assert.equal(areaOf('網元'), 6);
    assert.equal(areaOf('潮干狩'), 6);
    // 銀行は中央航路、東西南北の埠頭にスイッチ
    assert.equal(bank.col, 4);
    assert.equal(bank.row, 3);
    const swPos = switches.map((n) => `${n.col},${n.row}`).sort();
    assert.deepEqual(swPos, ['1,3', '4,1', '4,6', '7,3']);
    const onRim = (n) => n.col === 0 || n.col === 8 || n.row === 0 || n.row === 7;
    assert.equal(onRim(bank), false);
    assert.ok(switches.every((n) => !onRim(n)));
    const occupied = new Set(g.map.map((n) => `${n.col},${n.row}`));
    for (const gap of ['4,0', '8,3', '4,7', '0,3']) {
      assert.equal(occupied.has(gap), false, `rim gap ${gap} should stay empty`);
    }
    const rimOnly = g.map.filter(onRim);
    const rimIds = new Set(rimOnly.map((n) => n.id));
    const rimAdj = (n) => (n.nexts || []).filter((id) => rimIds.has(id));
    const rimEnds = rimOnly.filter((n) => rimAdj(n).length <= 1);
    assert.ok(rimEnds.length >= 4, `expected rim gaps to break the outer loop, ends=${rimEnds.length}`);
  });

  it('all maps keep every square at least 2-connected (no dead ends)', () => {
    for (const def of MAP_CATALOG) {
      for (const state of def.id === 'shell_harbor' ? [0, 1] : [0]) {
        const g = createGame({
          players: [{ name: 'A' }, { name: 'B' }],
          seed: 9,
          mapId: def.id,
        });
        if (state === 1) toggleBoardSwitch(g);
        for (const n of g.map) {
          assert.ok(
            (n.nexts?.length || 0) >= 2,
            `${def.id} state ${g.switchState}: ${n.type}:${n.label} deg=${n.nexts?.length || 0}`,
          );
          for (const nid of n.nexts) {
            const other = getNode(g, nid);
            assert.ok(other?.nexts.includes(n.id), `${def.id}: missing back-link`);
            const diag = Math.abs(other.col - n.col) > 0 && Math.abs(other.row - n.row) > 0;
            assert.equal(diag, false, `${def.id}: diagonal ${n.label}-${other.label}`);
          }
        }
      }
    }
  });

  it('shell harbor switch toggles routes and movable squares', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 3,
      mapId: 'shell_harbor',
    });
    assert.ok((g.switchGates || []).length >= 2);
    assert.ok(g.map.some((n) => n.type === 'switch'));
    const float = g.map.find((n) => n.label === '屋台船');
    assert.ok(float);
    const col0 = float.col;
    const row0 = float.row;
    const hub = g.map.find((n) => n.type === 'switch');
    const nexts0 = [...hub.nexts].sort((a, b) => a - b);
    const st1 = toggleBoardSwitch(g);
    assert.equal(st1, 1);
    const nexts1 = [...getNode(g, hub.id).nexts].sort((a, b) => a - b);
    assert.notDeepEqual(nexts0, nexts1);
    const moved = getNode(g, float.id);
    assert.ok(moved.col !== col0 || moved.row !== row0, 'movable shop should slide');
    const ferry = g.map.find((n) => n.label === '渡し舟');
    assert.ok(ferry);
    assert.equal(ferry.col, 6);
    assert.equal(ferry.row, 3);

    // スイッチマス着地でも切り替わり、スライド情報が返る
    g.players[0].pos = hub.id;
    g.move = { stepsLeft: 0, path: [hub.id], passedBank: false, startPos: g.startId };
    g.phase = 'moving';
    const before = g.switchState;
    const landed = advanceMove(g);
    assert.equal(g.switchState, before ? 0 : 1);
    assert.ok(Array.isArray(landed.switchMoves));
    assert.ok(landed.switchMoves.length >= 1, 'switch landing should report sliding tiles');
    for (const m of landed.switchMoves) {
      assert.ok(m.from && m.to);
      assert.ok(m.from.col !== m.to.col || m.from.row !== m.to.row);
    }

    const again = restoreState(serializeState(g));
    assert.equal(again.switchState, g.switchState);
    assert.ok(Array.isArray(again.switchGates));
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

  it('computes toll multipliers by area size and ownership', () => {
    assert.equal(getTollMulti(1, 4), 1);
    assert.equal(getTollMulti(2, 4), 1.25);
    assert.equal(getTollMulti(3, 4), 2.5);
    assert.equal(getTollMulti(4, 4), 5);
    // 5軒エリアは4軒所有でも独占倍率にならない
    assert.equal(getTollMulti(4, 5), 3.25);
    assert.equal(getTollMulti(5, 5), 6);
  });

  it('scales invest cap by area monopoly rate', () => {
    assert.equal(investMultiByMonopolyRate(0.25), 0.5);
    assert.equal(investMultiByMonopolyRate(0.5), 1);
    assert.equal(investMultiByMonopolyRate(0.75), 3);
    assert.equal(investMultiByMonopolyRate(1), 9);

    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 3,
    });
    const area = Number(Object.keys(g.areas)[0]);
    const shops = getAreaShops(g, area);
    assert.equal(shops.length, 4);
    const sq = shops[0];
    sq.owner = 0;
    assert.equal(getAreaMonopolyRate(g, 0, area), 0.25);
    assert.equal(getMaxExtraInvest(g, sq), Math.floor(sq.basePrice * 0.5));

    shops[1].owner = 0;
    assert.equal(getAreaMonopolyRate(g, 0, area), 0.5);
    assert.equal(getMaxExtraInvest(g, sq), Math.floor(sq.basePrice * 1));

    shops[2].owner = 0;
    assert.equal(getMaxExtraInvest(g, sq), Math.floor(sq.basePrice * 3));

    shops[3].owner = 0;
    assert.equal(getAreaMonopolyRate(g, 0, area), 1);
    assert.equal(getMaxExtraInvest(g, sq), Math.floor(sq.basePrice * 9));

    // 枠を超えて載せられない
    const rem = getRemainingInvest(g, sq);
    const added = applyCappedShopBoost(g, sq, rem + 500);
    assert.equal(added, rem);
    assert.equal(getRemainingInvest(g, sq), 0);
    assert.equal(applyCappedShopBoost(g, sq, 50), 0);
  });

  it('lets owner invest any owned shop when landing on own shop', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 11,
      cash: 5000,
    });
    const shops = g.map.filter((n) => n.type === 'shop');
    const landed = shops[0];
    const other = shops[1];
    landed.owner = 0;
    other.owner = 0;
    g.players[0].pos = landed.id;
    g.phase = 'moving';
    g.move = { stepsLeft: 0, path: [landed.id], passedBank: false, startPos: g.startId };
    const landedResult = advanceMove(g);
    assert.equal(landedResult.ok, true);
    assert.equal(g.pending?.type, 'invest');
    assert.equal(g.pending.shopId, landed.id);
    assert.equal(g.pending.landedShopId, landed.id);
    assert.ok(g.pending.shopIds.includes(landed.id));
    assert.ok(g.pending.shopIds.includes(other.id));

    const beforeLanded = landed.price;
    const beforeOther = other.price;
    const remOther = getRemainingInvest(g, other);
    const amount = Math.min(100, remOther);
    assert.ok(amount > 0, 'other shop should have invest room');
    const cashBefore = g.players[0].cash;
    const r = applyChoice(g, { action: 'invest', shopId: other.id, amount });
    assert.equal(r.ok, true);
    assert.equal(other.price, beforeOther + amount);
    assert.equal(other.extraInvest, amount);
    assert.equal(landed.price, beforeLanded);
    assert.equal(landed.extraInvest || 0, 0);
    assert.equal(g.players[0].cash, cashBefore - amount);
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
    assert.equal(hasAreaMonopoly(g, 0, area), true);
    assert.equal(getTollMulti(shops.length, shops.length), 5);
  });

  it('pays a small stock cut when an area earns toll revenue', () => {
    const g = createGame({
      players: [{ name: 'Holder' }, { name: 'Other' }, { name: 'Owner' }],
      seed: 7,
    });
    const area = Number(Object.keys(g.areas)[0]);
    g.players[0].stocks[area] = 2;
    g.players[1].stocks[area] = 1;
    g.players[0].cash = 1000;
    g.players[1].cash = 1000;
    g.players[2].cash = 1000;

    const revenue = 1000;
    const before0 = g.players[0].cash;
    const before1 = g.players[1].cash;
    const before2 = g.players[2].cash;
    const result = payAreaStockDividend(g, area, revenue);

    const expectedPool = Math.floor(
      revenue * Math.min(STOCK_DIVIDEND_MAX_RATE, STOCK_DIVIDEND_PER_SHARE * 3),
    );
    assert.equal(expectedPool, Math.floor(revenue * 0.09));
    assert.equal(result.pool, expectedPool);
    assert.equal(result.payouts.length, 2);
    assert.equal(g.players[0].cash - before0 + (g.players[1].cash - before1), expectedPool);
    assert.equal(g.players[2].cash, before2);
    assert.ok(g.players[0].cash - before0 > g.players[1].cash - before1);
    assert.equal(g.players[0].stats.dividendEarned, g.players[0].cash - before0);
    assert.ok(g.logs.some((l) => l.kind === 'stock' && /株わけ前/.test(l.text)));
  });

  it('pays no stock cut without holders or revenue', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 3,
    });
    const area = Number(Object.keys(g.areas)[0]);
    assert.equal(payAreaStockDividend(g, area, 500).pool, 0);
    g.players[0].stocks[area] = 2;
    assert.equal(payAreaStockDividend(g, area, 0).pool, 0);
  });

  it('converts a disconnected human to reclaimable CPU', () => {
    const g = createGame({
      players: [{ name: 'Human', isCPU: false }, { name: 'Bot', isCPU: true }],
      seed: 5,
    });
    g.players[0].offline = true;
    g.players[0].peerId = null;
    const r = convertPlayerToCpu(g, 0);
    assert.equal(r.ok, true);
    assert.equal(g.players[0].isCPU, true);
    assert.equal(g.players[0].offline, false);
    assert.equal(g.players[0].flags.reclaimableHuman, true);
    assert.ok(g.players[0].personality);
  });

  it('kicks a disconnected player as bankrupt and advances turn', () => {
    const g = createGame({
      players: [{ name: 'A', isCPU: false }, { name: 'B', isCPU: false }, { name: 'C', isCPU: true }],
      seed: 6,
    });
    g.currentPlayerIdx = 1;
    g.phase = 'await_choice';
    g.pending = { type: 'buy_shop', playerId: 1, shopId: g.startId, price: 100 };
    const shop = g.map.find((n) => n.type === 'shop');
    shop.owner = 1;
    const r = kickDisconnectedPlayer(g, 1);
    assert.equal(r.ok, true);
    assert.equal(g.players[1].bankrupt, true);
    assert.equal(shop.owner, -1);
    assert.equal(g.pending, null);
    assert.notEqual(g.currentPlayerIdx, 1);
  });

  it('pays stock cut automatically when landing on an opponent shop (production path)', () => {
    const g = createGame({
      players: [{ name: 'Payer' }, { name: 'Owner' }, { name: 'Holder' }],
      seed: 17,
      cash: 5000,
    });
    const area = Number(Object.keys(g.areas)[0]);
    const shop = g.map.find((n) => n.type === 'shop' && n.area === area);
    shop.owner = 1;
    shop.price = 400;
    shop.basePrice = 400;
    shop.baseToll = 200;
    shop.extraInvest = 0;
    g.players[2].stocks[area] = 3;
    g.players[2].cash = 1000;
    const holderBefore = g.players[2].cash;
    const ownerBefore = g.players[1].cash;
    const toll = calcToll(g, shop);
    assert.ok(toll > 0);

    g.players[0].pos = shop.id;
    g.phase = 'moving';
    g.move = { stepsLeft: 0, path: [shop.id], passedBank: false, startPos: g.startId };
    advanceMove(g);

    const expectedPool = Math.floor(
      toll * Math.min(STOCK_DIVIDEND_MAX_RATE, STOCK_DIVIDEND_PER_SHARE * 3),
    );
    assert.ok(expectedPool > 0);
    assert.equal(g.players[1].cash - ownerBefore, toll);
    assert.equal(g.players[2].cash - holderBefore, expectedPool);
    assert.equal(g.players[2].stats.dividendEarned, expectedPool);
    assert.ok(g.logs.some((l) => l.kind === 'toll' && /買い物料/.test(l.text)));
    assert.ok(g.logs.some((l) => l.kind === 'stock' && /株わけ前/.test(l.text)));
  });

  it('grants monopoly cash bonus when completing an area', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 11,
    });
    const area = Number(Object.keys(g.areas)[0]);
    const shops = getAreaShops(g, area);
    assert.ok(shops.length >= 3);
    for (let i = 0; i < shops.length - 1; i++) shops[i].owner = 0;
    assert.equal(hasAreaMonopoly(g, 0, area), false);

    const last = shops[shops.length - 1];
    g.players[0].cash = 50000;
    g.phase = 'await_choice';
    g.pending = { type: 'buy_shop', playerId: 0, shopId: last.id, price: last.price };
    const cashBefore = g.players[0].cash;
    const value = shops.reduce((s, sq) => s + sq.price, 0);
    const expectedBonus = Math.max(100, Math.floor(value * MONOPOLY_BONUS_RATE));
    const result = applyChoice(g, { action: 'buy' });
    assert.equal(result.ok, true);
    assert.equal(result.monopoly, true);
    assert.equal(result.bonus, expectedBonus);
    assert.equal(hasAreaMonopoly(g, 0, area), true);
    // 購入費を引いたあとボーナスが載る
    assert.equal(g.players[0].cash, cashBefore - last.price + expectedBonus);
    // 二重付与されない
    assert.equal(tryGrantMonopolyBonus(g, g.players[0], area), null);
  });

  it('crashes stock hard when a monopoly breaks', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 13,
      cash: 20000,
    });
    const area = Number(Object.keys(g.areas)[0]);
    const shops = getAreaShops(g, area);
    for (const sq of shops) {
      sq.owner = 0;
      sq.basePrice = 8000;
      sq.extraInvest = 4000;
      sq.price = 12000;
    }
    g.players[0].flags.monopolyBonusClaimed = { [area]: true };
    g.areas[area].B = 200;
    updateAreaStockPrices(g);
    const priceBefore = g.areas[area].stockPrice;
    const BBefore = g.areas[area].B;
    assert.ok(priceBefore > 1, `need visible stock price, got ${priceBefore}`);

    // 1軒奪われて独占崩壊
    shops[0].owner = 1;
    shops[0].extraInvest = 0;
    shops[0].price = shops[0].basePrice;
    const brk = applyMonopolyBreak(g, 0, area);
    assert.ok(brk?.broken);
    assert.equal(g.areas[area].B, Math.max(70, Math.floor(BBefore * MONOPOLY_BREAK_B_RATE)));
    assert.ok(brk.newPrice < priceBefore, `stock should drop: ${brk.newPrice} >= ${priceBefore}`);
    assert.equal(g.players[0].flags.monopolyBonusClaimed?.[area], undefined);
    // 残店の増資が削られる
    const remain = shops.filter((s) => s.owner === 0);
    assert.ok(remain.every((s) => s.extraInvest < 4000));
    assert.ok(brk.investCut > 0);
  });

  it('sets goal pressure when a player reaches the goal assets', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 15,
      cash: 1000,
    });
    g.goal = 5000;
    assert.equal(getGoalPressurePlayers(g).length, 0);
    g.players[0].cash = 6000;
    const on = refreshGoalPressure(g);
    assert.equal(on, true);
    assert.equal(g.goalPressure, true);
    assert.ok(g.logs.some((l) => /目標資産に到達/.test(l.text)));
    const state = serializeState(g);
    assert.equal(state.goalPressure, true);
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
    assert.ok(hubs.every((h) => h.type !== 'rest' && h.type !== 'holiday'));
    assert.ok(hubs.some((h) => h.type === 'event'));
    const minis = hubs.filter((h) => h.type === 'minigame');
    assert.equal(minis.length, 2);
    const games = new Set(minis.map((h) => h.game));
    assert.equal(games.size, 2, 'two minigame hubs must use different games');
  });

  it('opens event-table scratch when landing on a mark', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 21,
    });
    assert.ok(g.sharedEventTable);
    assert.equal(g.sharedEventTable.cells.length, 100);
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
    assert.equal(g.sharedEventTable.cells[cellId].scratched, true);
    assert.equal(g.sharedEventTable.cells[cellId].scratchedBy, 0);
  });

  it('keeps scratch event catalog diverse (not mostly cash)', () => {
    assert.equal(EVENT_CATALOG.length, EVENT_COUNT);
    const cashOnly = EVENT_CATALOG.filter((e) => e.effect === 'cash').length;
    assert.ok(cashOnly <= 45, `too many cash-only events: ${cashOnly}`);
    const levelScaled = EVENT_CATALOG.filter((e) => e.levelScale).length;
    assert.ok(levelScaled >= 20, `expected level-scaled scratch events, got ${levelScaled}`);
    const kinds = new Set(EVENT_CATALOG.map((e) => e.effect || e.kind));
    assert.ok(kinds.size >= 15, `expected many effect kinds, got ${kinds.size}`);
    assert.ok(kinds.has('extra_roll') || kinds.has('grant_mark'));
    assert.ok(kinds.has('warp_bank') || kinds.has('warp_random'));
    assert.ok(kinds.has('stocks') || kinds.has('shop_boost'));
    assert.ok(kinds.has('all_cash'), 'expected all-player cash events');
    assert.ok(kinds.has('minigame'), 'expected minigame events');
    assert.ok(kinds.has('seize_mono_shop'), 'expected monopoly-break seize events');
    assert.ok(kinds.has('five_buy_coupon'), 'expected cheap takeover coupon events');
    assert.ok(kinds.has('swap_all_pos'), 'expected all-position shuffle events');
    assert.ok(kinds.has('scatter_all'), 'expected scatter-all warp events');
    assert.ok(kinds.has('gather_all'), 'expected gather-all warp events');
    const allCash = EVENT_CATALOG.filter((e) => e.effect === 'all_cash').length;
    const minis = EVENT_CATALOG.filter((e) => e.effect === 'minigame').length;
    assert.ok(allCash >= 10, `expected many all_cash events, got ${allCash}`);
    assert.ok(minis >= 8, `expected many minigame events, got ${minis}`);
    const miniGames = new Set(
      EVENT_CATALOG.filter((e) => e.effect === 'minigame').map((e) => e.game)
    );
    assert.ok(miniGames.size >= 8, `expected distinct minigame rules, got ${[...miniGames]}`);
    assert.ok(miniGames.has('dice_parity'));
    assert.ok(miniGames.has('dice_band'));
    assert.ok(miniGames.has('card_duel'));
    assert.ok(miniGames.has('coin_double'));
    assert.ok(miniGames.has('coin_party'));
    assert.ok(miniGames.has('neon_slot'));
  });

  it('keeps lucky status until the start of the next own turn', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 17,
      cash: 2000,
    });
    const a = g.players[0];
    a.lucky = true;
    a.flags.luckyExpireOnTurn = false;
    // Aのターン終了 → ラッキーは残る
    g.currentPlayerIdx = 0;
    g.phase = 'await_choice';
    g.pending = { type: 'buy_shop', playerId: 0, shopId: g.map.find((n) => n.type === 'shop').id, price: 99999 };
    applyChoice(g, { action: 'skip' });
    assert.equal(a.lucky, true);
    assert.equal(a.flags.luckyExpireOnTurn, true);
    assert.equal(g.currentPlayerIdx, 1);

    // With 2 players, lucky never pays tips. Still test duration.
    assert.equal(a.lucky, true);

    // when A's turn starts (roll), lucky expires
    g.currentPlayerIdx = 0;
    g.phase = 'await_roll';
    const rolled = rollDice(g);
    assert.equal(rolled.ok, true);
    assert.equal(a.lucky, false);
    assert.equal(a.flags.luckyExpireOnTurn, false);
  });

  it('lucky tip pays 20% from bank when a third party is lucky', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      seed: 19,
      cash: 5000,
    });
    const lucky = g.players[0];
    lucky.lucky = true;
    const shops = g.map.filter((n) => n.type === 'shop');
    const sq = shops[0];
    sq.owner = 1;
    sq.basePrice = 1000;
    sq.price = 1000;
    sq.extraInvest = 0;
    g.players[1].shopsClosed = false;
    const toll = calcToll(g, sq);
    assert.ok(toll > 0, 'toll should be positive');
    g.players[2].pos = sq.id;
    g.currentPlayerIdx = 2;
    g.phase = 'moving';
    g.move = { stepsLeft: 0, path: [sq.id], passedBank: false, startPos: g.startId };
    const before = lucky.cash;
    advanceMove(g);
    const expectedTip = Math.floor(toll * 0.2);
    assert.equal(lucky.cash, before + expectedTip);
    assert.ok(g.logs.some((l) => /ラッキー/.test(l.text) && /20%/.test(l.text)));
  });

  it('seize_mono_shop breaks a rival monopoly', () => {
    const seizeId = EVENT_CATALOG.findIndex((e) => e.effect === 'seize_mono_shop');
    assert.ok(seizeId >= 0);
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 21,
      cash: 2000,
    });
    const area = Number(Object.keys(g.areas)[0]);
    const shops = getAreaShops(g, area);
    assert.ok(shops.length >= 2);
    for (const sq of shops) sq.owner = 1;
    g.players[1].flags.monopolyBonusClaimed = { [area]: true };
    assert.equal(hasAreaMonopoly(g, 1, area), true);

    const cell = g.sharedEventTable.cells[0];
    cell.eventId = seizeId + 1;
    cell.label = EVENT_CATALOG[seizeId].label;
    cell.scratched = false;
    const r = scratchCell(g, g.players[0], 0);
    assert.equal(r.ok, true);
    assert.equal(hasAreaMonopoly(g, 1, area), false);
    const taken = shops.filter((s) => s.owner === 0);
    assert.equal(taken.length, 1);
    assert.ok(r.messages.some((m) => /奪取/.test(m)));
  });

  it('scales level-up bonus by promotion target level only (same for all players)', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 3,
      cash: 1000,
    });
    // A に店を持たせても B と同額になること
    const shops = getAreaShops(g, Number(Object.keys(g.areas)[0]));
    for (const sq of shops) {
      sq.owner = 0;
      sq.price = sq.basePrice + 500;
    }
    g.players[0].level = 1;
    g.players[1].level = 1;
    const b2a = getLevelBonus(g, g.players[0], 2);
    const b2b = getLevelBonus(g, g.players[1], 2);
    assert.equal(b2a, 700);
    assert.equal(b2b, 700);
    assert.equal(b2a, b2b);
    const b4 = getLevelBonus(g, g.players[0], 4);
    assert.equal(b4, 1200);
    assert.equal(b4 - b2a, 500, 'each +2 levels adds 500G');
  });

  it('scales scratch cash by player level when levelScale is set', () => {
    const idx = EVENT_CATALOG.findIndex((e) => e.effect === 'cash' && e.levelScale);
    assert.ok(idx >= 0);
    const def = EVENT_CATALOG[idx];
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 9,
      cash: 500,
    });
    g.players[0].level = 1;
    const cell = g.sharedEventTable.cells[2];
    cell.eventId = idx + 1;
    cell.label = def.label;
    cell.scratched = false;
    const before = g.players[0].cash;
    const r1 = scratchCell(g, g.players[0], 2);
    assert.equal(r1.ok, true);
    const gain1 = g.players[0].cash - before;
    const expected1 = Math.floor((def.cash || 0) + 1 * def.levelScale);
    assert.equal(gain1, expected1);

    g.players[0].level = 4;
    g.players[0].cash = before;
    const cell2 = g.sharedEventTable.cells[3];
    cell2.eventId = idx + 1;
    cell2.label = def.label;
    cell2.scratched = false;
    const r2 = scratchCell(g, g.players[0], 3);
    assert.equal(r2.ok, true);
    const gain2 = g.players[0].cash - before;
    const expected2 = Math.floor((def.cash || 0) + 4 * def.levelScale);
    assert.equal(gain2, expected2);
    assert.ok(gain2 > gain1);
  });

  it('rejects scratching an already opened cell on the shared table', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 44,
    });
    const cellId = 3;
    g.sharedEventTable.cells[cellId].scratched = true;
    g.sharedEventTable.cells[cellId].scratchedBy = 1;
    g.phase = 'await_choice';
    g.pending = { type: 'scratch', playerId: 0, openIds: unscratchedIds(g.sharedEventTable) };
    const bad = applyChoice(g, { action: 'scratch', cellId });
    assert.equal(bad.ok, false);
  });

  it('replaces rest/holiday hubs with distinct minigame squares', () => {
    const board = buildBoard();
    assert.equal(board.nodes.filter((n) => n.type === 'rest').length, 0);
    assert.equal(board.nodes.filter((n) => n.type === 'holiday').length, 0);
    const minis = board.nodes.filter((n) => n.type === 'minigame');
    assert.equal(minis.length, 2);
    const east = minis.find((n) => n.col === 10 && n.row === 5);
    const south = minis.find((n) => n.col === 5 && n.row === 10);
    assert.ok(east, 'east hub should be minigame');
    assert.ok(south, 'south hub should be minigame');
    assert.equal(east.game, 'guess_dice');
    assert.equal(south.game, 'slot');
    assert.notEqual(east.game, south.game);
  });

  it('landing on a minigame hub opens that square\'s fixed game', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 33,
    });
    const slotHub = g.map.find((n) => n.type === 'minigame' && n.game === 'slot');
    assert.ok(slotHub);
    g.players[0].pos = slotHub.id;
    g.phase = 'moving';
    g.move = { stepsLeft: 0, path: [slotHub.id], passedBank: false, startPos: g.startId };
    advanceMove(g);
    assert.equal(g.phase, 'await_choice');
    assert.equal(g.pending?.type, 'minigame');
    assert.equal(g.pending?.game, 'slot');

    const diceHub = g.map.find((n) => n.type === 'minigame' && n.game === 'guess_dice');
    g.players[0].pos = diceHub.id;
    g.phase = 'moving';
    g.move = { stepsLeft: 0, path: [diceHub.id], passedBank: false, startPos: g.startId };
    g.pending = null;
    advanceMove(g);
    assert.equal(g.pending?.type, 'minigame');
    assert.equal(g.pending?.game, 'guess_dice');
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

  it('stockbroker allows only one stock type per visit', () => {
    const g = createGame({
      players: [{ name: 'A', cash: 5000 }, { name: 'B' }],
      seed: 46,
      cash: 5000,
    });
    const broker = g.map.find((n) => n.type === 'stockbroker');
    assert.ok(broker);
    g.players[0].pos = broker.id;
    g.phase = 'moving';
    g.move = { stepsLeft: 0, path: [broker.id], passedBank: false, startPos: g.startId };
    advanceMove(g);
    assert.equal(g.pending?.type, 'stock');
    assert.equal(g.pending?.broker, true);
    assert.equal(g.pending?.maxBuys, 1);
    const areas = Object.keys(g.areas).map(Number);
    const a1 = areas[0];
    const a2 = areas[1];
    const price1 = g.areas[a1].stockPrice;
    const buy1 = applyChoice(g, { action: 'buy', area: a1, count: 1 });
    assert.equal(buy1.ok, true);
    assert.equal(g.players[0].stocks[a1], 1);
    // 1種類買ったらターン終了（pending クリア）
    assert.equal(g.pending, null);
    assert.equal(g.phase, 'await_roll');
    // 追加購入はできない
    g.phase = 'await_choice';
    g.pending = { type: 'stock', playerId: 0, broker: true, maxBuys: 1, buysUsed: 1 };
    const buy2 = applyChoice(g, { action: 'buy', area: a2, count: 1 });
    assert.equal(buy2.ok, false);
    assert.equal(buy2.error, 'buy_limit');
    assert.ok(price1 > 0);
  });

  it('landing on bank opens level-up then one-type stock buy', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 44,
    });
    const arm = getForwardNexts(g, g.startId, null)[0];
    g.players[0].marks = [true, true, true, true];
    g.players[0].pos = g.startId;
    g.players[0].prevPos = arm;
    g.phase = 'moving';
    g.move = { stepsLeft: 0, path: [g.startId], passedBank: true, startPos: arm };
    const beforeLv = g.players[0].level;
    advanceMove(g);
    assert.equal(g.phase, 'await_choice');
    assert.equal(g.pending?.type, 'level_up');
    assert.equal(g.players[0].level, beforeLv + 1);
    applyChoice(g, { action: 'celebrate' });
    assert.equal(g.pending?.type, 'stock');
    assert.equal(g.pending.maxBuys, 1);
    assert.equal(g.pending.bankVisit, true);
  });

  it('passing bank mid-move interrupts for stock then direction', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 45,
    });
    const arm = getForwardNexts(g, g.startId, null)[0];
    g.players[0].pos = arm;
    g.players[0].prevPos = null;
    g.phase = 'moving';
    g.move = { stepsLeft: 2, path: [], passedBank: false, startPos: arm };
    // 次が銀行になるよう prev をアーム外に
    const towardBank = getForwardNexts(g, arm, null).filter((id) => id === g.startId);
    if (!towardBank.length) {
      // アームから銀行は必ず繋がる
      assert.ok(g.map.find((n) => n.id === arm).nexts.includes(g.startId));
      g.players[0].prevPos = g.map.find((n) => n.id === arm).nexts.find((id) => id !== g.startId) ?? null;
    } else {
      g.players[0].prevPos = g.map.find((n) => n.id === arm).nexts.find((id) => id !== g.startId) ?? null;
    }
    const r = advanceMove(g);
    assert.equal(g.players[0].pos, g.startId);
    assert.equal(r.bankInterrupt, true);
    assert.equal(g.phase, 'await_choice');
    assert.ok(g.pending?.type === 'stock' || g.pending?.type === 'level_up');
    if (g.pending.type === 'level_up') applyChoice(g, { action: 'celebrate' });
    assert.equal(g.pending?.type, 'stock');
    assert.equal(g.pending.resumeMove, true);
    applyChoice(g, { action: 'skip' });
    assert.ok(g.phase === 'await_fork' || g.phase === 'moving');
    assert.ok(g.move?.stepsLeft >= 1);
  });

  it('wins immediately when passing the bank at or above the goal', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 46,
      cash: 1000,
    });
    g.goal = 5000;
    g.players[0].cash = 6000;
    const arm = getForwardNexts(g, g.startId, null)[0];
    g.players[0].pos = arm;
    g.players[0].prevPos = g.map.find((n) => n.id === arm).nexts.find((id) => id !== g.startId) ?? null;
    g.phase = 'moving';
    g.move = { stepsLeft: 2, path: [], passedBank: false, startPos: arm };
    const r = advanceMove(g);
    assert.equal(g.players[0].pos, g.startId);
    assert.equal(g.phase, 'gameover');
    assert.equal(g.winnerId, 0);
    assert.ok(g.logs.some((l) => /銀行通過でゴール/.test(l.text)));
    assert.equal(r.state?.phase, 'gameover');
  });

  it('still wins when landing on the bank at or above the goal', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 47,
      cash: 1000,
    });
    g.goal = 5000;
    g.players[0].cash = 5500;
    g.players[0].pos = g.startId;
    g.phase = 'moving';
    g.move = { stepsLeft: 0, path: [g.startId], passedBank: true, startPos: g.startId };
    advanceMove(g);
    assert.equal(g.phase, 'gameover');
    assert.equal(g.winnerId, 0);
    assert.ok(g.logs.some((l) => /勝利/.test(l.text)));
  });

  it('level-up that newly reaches the goal requires leaving and re-passing the bank', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 48,
      cash: 1000,
    });
    g.goal = 5000;
    // 昇進賞金でちょうど目標超えになるよう現金を調整
    const bonus = 200 + 250 * 2; // Lv1→2
    g.players[0].cash = g.goal - bonus + 10;
    g.players[0].level = 1;
    g.players[0].marks = [true, true, true, true];
    assert.ok(getPlayerAssets(g, g.players[0]).total < g.goal);
    g.players[0].pos = g.startId;
    g.phase = 'moving';
    g.move = { stepsLeft: 0, path: [g.startId], passedBank: true, startPos: g.startId };
    advanceMove(g);
    assert.notEqual(g.phase, 'gameover');
    assert.equal(g.winnerId, null);
    assert.ok(g.logs.some((l) => /昇進で目標資産に到達/.test(l.text)));
    assert.ok(getPlayerAssets(g, g.players[0]).total >= g.goal);
    // お祝い→株スキップでターン終了
    if (g.pending?.type === 'level_up') applyChoice(g, { action: 'celebrate' });
    if (g.pending?.type === 'stock') applyChoice(g, { action: 'skip' });
    assert.equal(g.phase, 'await_roll');
    assert.notEqual(g.winnerId, 0);
    // 次に銀行へ停止すれば勝利
    g.currentPlayerIdx = 0;
    g.players[0].flags.bankVisitDone = false;
    g.players[0].pos = g.startId;
    g.phase = 'moving';
    g.move = { stepsLeft: 0, path: [g.startId], passedBank: true, startPos: g.startId };
    g.pending = null;
    advanceMove(g);
    assert.equal(g.phase, 'gameover');
    assert.equal(g.winnerId, 0);
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

  it('toll debt opens manual raise_funds instead of auto-selling', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 91,
      cash: 2000,
    });
    const area = Number(Object.keys(g.areas)[0]);
    const shop = g.map.find((n) => n.type === 'shop' && n.area === area);
    shop.owner = 1;
    shop.price = 800;
    shop.basePrice = 800;
    shop.baseToll = 500;
    shop.extraInvest = 0;
    // 株は資産として持つが、自動では売られないことだけ検証
    g.players[0].stocks[area] = 30;
    g.players[0].cash = 80;
    g.players[0].pos = shop.id;
    g.phase = 'moving';
    g.move = { stepsLeft: 0, path: [shop.id], passedBank: false, startPos: g.startId };
    const stockBefore = g.players[0].stocks[area];
    const toll = calcToll(g, shop);
    assert.ok(toll > g.players[0].cash, `toll ${toll} should exceed cash`);
    advanceMove(g);
    assert.ok(g.players[0].cash < 0, `cash should go negative, got ${g.players[0].cash}`);
    assert.equal(g.players[0].stocks[area], stockBefore, 'stocks not auto-sold');
    assert.equal(g.phase, 'await_choice');
    assert.equal(g.pending?.type, 'raise_funds');
    assert.equal(g.pending?.reason, 'toll');
    assert.equal(g.pending?.targetCash, 0);
    // 手動で株を売って負債を解消
    const price = g.areas[area].stockPrice;
    const need = -g.players[0].cash;
    const count = Math.min(stockBefore, Math.max(1, Math.ceil(need / Math.max(1, price)) + 1));
    const sold = applyChoice(g, { action: 'sell_stock', area, count });
    assert.equal(sold.ok, true);
    assert.ok(g.players[0].cash >= 0);
    const cont = applyChoice(g, { action: 'continue' });
    assert.equal(cont.ok, true);
  });

  it('raise_funds cancel while still short after toll keeps pending open', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 94,
      cash: 2000,
    });
    const shop = g.map.find((n) => n.type === 'shop');
    assert.ok(shop);
    shop.owner = 1;
    g.players[0].cash = -120;
    g.phase = 'await_choice';
    g.pending = {
      type: 'raise_funds',
      playerId: 0,
      targetCash: 0,
      reason: 'toll',
      resume: { type: 'after_toll', shopId: shop.id, toll: 200 },
    };
    const bad = applyChoice(g, { action: 'cancel' });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'still_short');
    assert.equal(g.pending?.type, 'raise_funds');
    assert.equal(g.phase, 'await_choice');
    assert.ok(bad.state);
    const again = restoreState(bad.state);
    assert.equal(again.pending?.type, 'raise_funds');
  });

  it('five_buy shortfall opens raise_funds then executes after selling stock', () => {
    const g = createGame({
      players: [{ name: 'A', cash: 500 }, { name: 'B', cash: 5000 }],
      seed: 92,
      cash: 500,
    });
    const area = Number(Object.keys(g.areas)[0]);
    const shop = g.map.find((n) => n.type === 'shop' && n.area === area);
    shop.owner = 1;
    shop.price = 200;
    shop.basePrice = 200;
    shop.extraInvest = 0;
    updateAreaStockPrices(g);
    const five = shop.price * 5;
    g.players[0].cash = Math.floor(five * 0.3);
    g.players[0].stocks[area] = 80;
    assert.ok(getLiquidatableValue(g, g.players[0]) >= five);
    g.phase = 'await_choice';
    g.pending = {
      type: 'five_buy',
      playerId: 0,
      shopId: shop.id,
      price: five,
      toll: 40,
    };
    const need = applyChoice(g, { action: 'buy' });
    assert.equal(need.ok, true);
    assert.equal(need.needFunds, true);
    assert.equal(g.pending?.type, 'raise_funds');
    assert.equal(g.pending?.reason, 'five_buy');
    // 目標まで株を手動売却
    while (g.players[0].cash < five && (g.players[0].stocks[area] || 0) > 0) {
      const price = g.areas[area].stockPrice;
      const needCash = five - g.players[0].cash;
      const count = Math.min(g.players[0].stocks[area], Math.max(1, Math.ceil(needCash / price)));
      const sold = applyChoice(g, { action: 'sell_stock', area, count });
      assert.equal(sold.ok, true);
      assert.equal(g.pending?.type, 'raise_funds');
    }
    assert.ok(g.players[0].cash >= five);
    const done = applyChoice(g, { action: 'continue', execute: true });
    assert.equal(done.ok, true);
    assert.equal(done.fiveBuy, true);
    assert.equal(shop.owner, 0);
  });

  it('all_cash event gives money to every living player', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }, { name: 'C', isCPU: true }],
      seed: 77,
      cash: 1000,
    });
    g.players[2].bankrupt = true;
    const before = g.players.map((p) => p.cash);
    const msgs = [];
    applyAllCash(g, 80, msgs);
    assert.equal(g.players[0].cash, before[0] + 80);
    assert.equal(g.players[1].cash, before[1] + 80);
    assert.equal(g.players[2].cash, before[2], 'bankrupt unchanged');
    assert.match(msgs.join(''), /全員/);
  });

  it('minigame pending pays participation cash to everyone', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 88,
      cash: 1000,
    });
    g.phase = 'await_choice';
    g.pending = { type: 'minigame', playerId: 0, game: 'coin', label: 'コイントス' };
    const beforeA = g.players[0].cash;
    const beforeB = g.players[1].cash;
    const r = applyChoice(g, { action: 'pick', value: 'heads' });
    assert.equal(r.ok, true);
    assert.equal(r.minigame, true);
    // 当たりでも外れでも相手（と自分）に参加賞が入る
    assert.ok(g.players[1].cash > beforeB, 'other player got participation');
    assert.ok(g.players[0].cash >= beforeA, 'actor cash not reduced');
    assert.equal(g.pending, null);
    assert.ok(r.reveal, 'reveal payload for FX');
    assert.equal(r.reveal.game, 'coin');
    assert.ok(r.reveal.outcome?.face);
    assert.ok(r.reveal.title);
  });

  it('slot minigame reveal includes symbols and tier', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 42,
      cash: 1000,
    });
    g.phase = 'await_choice';
    g.pending = { type: 'minigame', playerId: 0, game: 'slot', label: 'スロット' };
    const r = applyChoice(g, { action: 'spin' });
    assert.equal(r.ok, true);
    assert.equal(r.reveal.game, 'slot');
    assert.equal(r.reveal.outcome.symbols.length, 5);
    assert.ok(Array.isArray(r.reveal.outcome.hitIndices));
    assert.ok(
      ['jackpot', 'quad', 'fullhouse', 'triple', 'two_pair', 'pair', 'miss'].includes(r.reveal.tier)
    );
    assert.ok(r.reveal.detail);
  });

  it('5-reel slot pays jackpot / quad / pair tiers with adjusted prizes', () => {
    const SLOT_TIERS = ['jackpot', 'quad', 'fullhouse', 'triple', 'two_pair', 'pair', 'miss'];
    const seen = new Set();
    for (let seed = 1; seed <= 400 && seen.size < SLOT_TIERS.length; seed++) {
      const g = createGame({
        players: [{ name: 'A' }, { name: 'B' }],
        seed,
        cash: 1000,
      });
      g.phase = 'await_choice';
      g.pending = { type: 'minigame', playerId: 0, game: 'slot', label: 'スロット' };
      const before = g.players[0].cash;
      const r = applyChoice(g, { action: 'spin' });
      assert.equal(r.ok, true);
      assert.equal(r.reveal.outcome.symbols.length, 5);
      assert.ok(SLOT_TIERS.includes(r.reveal.tier));
      seen.add(r.reveal.tier);
      const prize = g.players[0].cash - before;
      if (r.reveal.tier === 'jackpot') {
        assert.ok(prize >= 900);
        assert.equal(r.reveal.win, true);
      } else if (r.reveal.tier === 'quad') {
        assert.ok(prize >= 420);
        assert.equal(r.reveal.win, true);
      } else if (r.reveal.tier === 'pair') {
        assert.ok(prize >= 45);
        assert.equal(r.reveal.win, true);
      } else if (r.reveal.tier === 'miss') {
        assert.equal(r.reveal.win, false);
        // 参加賞のみ（自分も受け取る）
        assert.ok(prize >= 22);
      }
    }
    assert.ok(seen.has('pair') || seen.has('two_pair') || seen.has('triple'));
  });

  it('scratch all_cash / minigame catalog entries apply correctly', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 99,
      cash: 1500,
    });
    const allCashId = EVENT_CATALOG.findIndex((e) => e.effect === 'all_cash');
    assert.ok(allCashId >= 0);
    const cell = g.sharedEventTable.cells[0];
    cell.eventId = allCashId + 1;
    cell.label = EVENT_CATALOG[allCashId].label;
    cell.scratched = false;
    const beforeB = g.players[1].cash;
    const scratched = scratchCell(g, g.players[0], 0);
    assert.equal(scratched.ok, true);
    assert.ok(g.players[1].cash > beforeB);

    const miniId = EVENT_CATALOG.findIndex((e) => e.effect === 'minigame' && e.game === 'guess_dice');
    assert.ok(miniId >= 0);
    const cell2 = g.sharedEventTable.cells[1];
    cell2.eventId = miniId + 1;
    cell2.label = EVENT_CATALOG[miniId].label;
    cell2.scratched = false;
    g.players[0].flags = {};
    const scratched2 = scratchCell(g, g.players[0], 1);
    assert.equal(scratched2.ok, true);
    assert.equal(g.players[0].flags.pendingMinigame?.game, 'guess_dice');
  });

  it('scratch swap_all_pos / scatter_all / gather_all move every player', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      seed: 7,
      cash: 2000,
    });
    const walkable = g.map.filter((n) => n.type !== 'junction');
    assert.ok(walkable.length >= 3);
    g.players[0].pos = walkable[0].id;
    g.players[1].pos = walkable[1].id;
    g.players[2].pos = walkable[2].id;

    const shuffleId = EVENT_CATALOG.findIndex((e) => e.effect === 'swap_all_pos');
    assert.ok(shuffleId >= 0);
    const before = g.players.map((p) => p.pos);
    const cell = g.sharedEventTable.cells[0];
    cell.eventId = shuffleId + 1;
    cell.label = EVENT_CATALOG[shuffleId].label;
    cell.scratched = false;
    const r1 = scratchCell(g, g.players[0], 0);
    assert.equal(r1.ok, true);
    const afterShuffle = g.players.map((p) => p.pos);
    assert.notDeepEqual(afterShuffle, before);
    assert.deepEqual([...afterShuffle].sort(), [...before].sort());

    const scatterId = EVENT_CATALOG.findIndex((e) => e.effect === 'scatter_all');
    assert.ok(scatterId >= 0);
    const cell2 = g.sharedEventTable.cells[1];
    cell2.eventId = scatterId + 1;
    cell2.label = EVENT_CATALOG[scatterId].label;
    cell2.scratched = false;
    const beforeScatter = g.players.map((p) => p.pos);
    const r2 = scratchCell(g, g.players[0], 1);
    assert.equal(r2.ok, true);
    const afterScatter = g.players.map((p) => p.pos);
    assert.equal(new Set(afterScatter).size, afterScatter.length, 'scatter should prefer unique tiles');
    assert.ok(afterScatter.every((id) => g.map.some((n) => n.id === id && n.type !== 'junction')));
    assert.ok(
      afterScatter.some((id, i) => id !== beforeScatter[i]),
      'at least one player should move on scatter'
    );

    const gatherId = EVENT_CATALOG.findIndex((e) => e.effect === 'gather_all');
    assert.ok(gatherId >= 0);
    const cell3 = g.sharedEventTable.cells[2];
    cell3.eventId = gatherId + 1;
    cell3.label = EVENT_CATALOG[gatherId].label;
    cell3.scratched = false;
    const r3 = scratchCell(g, g.players[0], 2);
    assert.equal(r3.ok, true);
    const dest = g.players[0].pos;
    assert.ok(g.players.every((p) => p.pos === dest));
  });

  it('named minigame variants use distinct rules', () => {
    const run = (game, label, choice) => {
      const g = createGame({
        players: [{ name: 'A' }, { name: 'B' }],
        seed: 3,
        cash: 1000,
      });
      g.currentPlayerIdx = 0;
      g.phase = 'await_choice';
      g.pending = { type: 'minigame', playerId: 0, game, label };
      const r = applyChoice(g, choice);
      assert.equal(r.ok, true);
      assert.equal(r.reveal.game, game);
      return r;
    };

    const parity = run('dice_parity', '賽のカーニバル', { action: 'pick', value: 'odd' });
    assert.ok(parity.reveal.outcome.roll >= 1 && parity.reveal.outcome.roll <= 6);

    const band = run('dice_band', 'フォーチュンダイス', { action: 'pick', value: 'mid' });
    assert.ok(band.reveal.outcome.band);

    const card = run('card_duel', 'カードハイロー', { action: 'pick', value: 'high' });
    assert.ok(card.reveal.outcome.first >= 1 && card.reveal.outcome.second >= 1);

    const dub = run('coin_double', 'ラッキーフリップ', { action: 'pick', value: 'heads' });
    assert.equal(dub.reveal.outcome.faces.length, 2);

    const party = run('coin_party', 'パーティーコイン', { action: 'pick', value: 'tails' });
    assert.ok(party.reveal.outcome.face);

    const neon = run('neon_slot', 'ネオンスロット', { action: 'spin' });
    assert.equal(neon.reveal.outcome.symbols.length, 5);
    assert.ok(neon.reveal.outcome.payline >= 1);
    assert.ok(['jackpot', 'quad', 'triple', 'pair', 'miss'].includes(neon.reveal.tier));
  });

  it('pick_invest event lets player choose a shop to boost', () => {
    const pickId = EVENT_CATALOG.findIndex((e) => e.effect === 'pick_invest');
    assert.ok(pickId >= 0, 'catalog has pick_invest');
    const def = EVENT_CATALOG[pickId];
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 21,
      cash: 3000,
    });
    const lv = g.players[0].level || 1;
    const amount = Math.floor((def.amount || 80) + lv * (def.levelScale || 0));
    const shops = g.map.filter((n) => n.type === 'shop');
    const a = shops[0];
    const b = shops[1];
    a.owner = 0;
    b.owner = 0;
    const cell = g.sharedEventTable.cells[0];
    cell.eventId = pickId + 1;
    cell.label = def.label;
    cell.scratched = false;
    g.phase = 'await_choice';
    g.pending = { type: 'scratch', playerId: 0, openIds: [0] };
    const scratched = applyChoice(g, { action: 'scratch', cellId: 0 });
    assert.equal(scratched.ok, true);
    assert.equal(scratched.pickInvest, true);
    assert.equal(g.pending?.type, 'pick_invest');
    assert.equal(g.pending.amount, amount);
    assert.ok(g.pending.shopIds.includes(a.id));
    assert.ok(g.pending.shopIds.includes(b.id));

    const priceBefore = b.price;
    const invested = applyChoice(g, { action: 'invest', shopId: b.id });
    assert.equal(invested.ok, true);
    assert.equal(invested.pickInvest, true);
    assert.equal(b.price, priceBefore + amount);
    assert.equal(b.extraInvest, amount);
    assert.equal(a.extraInvest || 0, 0);
  });

  it('scratch paints cell with opener player color', () => {
    const g = createGame({
      players: [{ name: 'A', color: PLAYER_COLORS[0] }, { name: 'B', color: PLAYER_COLORS[1] }],
      seed: 55,
      cash: 1500,
    });
    const cell = g.sharedEventTable.cells[3];
    cell.color = 3; // 事前の表色とは違う色にしておく
    cell.group = 3;
    cell.scratched = false;
    const r = scratchCell(g, g.players[1], 3);
    assert.equal(r.ok, true);
    assert.equal(cell.scratchedBy, 1);
    assert.equal(cell.color, playerColorIndex(g.players[1]));
    assert.equal(cell.color, 1);
  });

  it('scratch line match pays count * 50G and returns cellIds', () => {
    assert.equal(MATCH_BONUS_PER, 50);
    const g = createGame({
      players: [{ name: 'A', color: PLAYER_COLORS[0] }, { name: 'B', color: PLAYER_COLORS[1] }],
      seed: 7,
      cash: 1000,
    });
    const table = g.sharedEventTable;
    const who = g.players[0];
    // 先頭行 0,1 をあか色で先に開ける（イベント効果は無視して状態だけ）
    for (const i of [0, 1]) {
      table.cells[i].scratched = true;
      table.cells[i].scratchedBy = who.id;
      table.cells[i].color = 0;
      table.cells[i].group = 0;
    }
    // イベント効果を無効化してボーナスだけ検証
    table.cells[2].eventId = EVENT_CATALOG.findIndex((e) => e.effect === 'noop') + 1;
    if (table.cells[2].eventId < 1) {
      // noop が無ければラベルだけの無害イベントを仮置き
      table.cells[2].eventId = 1;
    }
    const before = who.cash;
    const r = scratchCell(g, who, 2);
    assert.equal(r.ok, true);
    assert.ok(r.matches?.length >= 1, 'expected a line match');
    const m = r.matches.find((x) => x.lineKey === 'r0');
    assert.ok(m, 'row match');
    assert.equal(m.count, 3);
    assert.equal(m.bonus, 3 * MATCH_BONUS_PER);
    assert.deepEqual(m.cellIds.slice().sort((a, b) => a - b), [0, 1, 2]);
    assert.ok(r.matchBonus >= 150);
    assert.ok(who.cash >= before + 150);
    assert.match(r.messages.join(' '), /そろい×3/);
  });

  it('scratch match requires contiguous cells (no spaced matches)', () => {
    const g = createGame({
      players: [{ name: 'A', color: PLAYER_COLORS[0] }, { name: 'B', color: PLAYER_COLORS[1] }],
      seed: 9,
      cash: 1000,
    });
    const table = g.sharedEventTable;
    const who = g.players[0];
    const rollAgainId = EVENT_CATALOG.findIndex((e) => e.effect === 'extra_roll') + 1;
    // とびとび: 0, 2, 4（間の1,3は未開封）→ 3つあっても隣接していないので不発
    for (const i of [0, 2]) {
      table.cells[i].scratched = true;
      table.cells[i].scratchedBy = who.id;
      table.cells[i].color = 0;
      table.cells[i].group = 0;
    }
    table.cells[4].eventId = rollAgainId;
    const before = who.cash;
    const r = scratchCell(g, who, 4);
    assert.equal(r.ok, true);
    assert.equal((r.matches || []).filter((m) => m.lineKey === 'r0').length, 0);
    assert.equal(r.matchBonus || 0, 0);
    assert.equal(who.cash, before);
  });

  it('scratch match fires only for the contiguous block, ignoring spaced extras', () => {
    const g = createGame({
      players: [{ name: 'A', color: PLAYER_COLORS[0] }, { name: 'B', color: PLAYER_COLORS[1] }],
      seed: 13,
      cash: 2000,
    });
    const table = g.sharedEventTable;
    const who = g.players[0];
    const rollAgainId = EVENT_CATALOG.findIndex((e) => e.effect === 'extra_roll') + 1;
    // 隣接3つ (0,1,2) と、離れたもう1つ (5) → カウントは隣接の3のみ
    for (const i of [0, 1, 5]) {
      table.cells[i].scratched = true;
      table.cells[i].scratchedBy = who.id;
      table.cells[i].color = 0;
      table.cells[i].group = 0;
    }
    table.cells[2].eventId = rollAgainId;
    const r = scratchCell(g, who, 2);
    assert.equal(r.ok, true);
    const m = r.matches.find((x) => x.lineKey === 'r0');
    assert.ok(m, 'contiguous row match');
    assert.equal(m.count, 3);
    assert.deepEqual(m.cellIds.slice().sort((a, b) => a - b), [0, 1, 2]);
    assert.ok(!m.cellIds.includes(5), 'spaced cell excluded');
  });

  it('assigns distinct CPU personalities by seat', () => {
    const g = createGame({
      players: [
        { name: 'Human' },
        { name: 'C1', isCPU: true },
        { name: 'C2', isCPU: true },
        { name: 'C3', isCPU: true },
      ],
      seed: 12,
    });
    assert.equal(g.players[0].personality, null);
    // 人間を除いたCPU順で個性を振る（店舗王から）
    assert.equal(g.players[1].personality, CPU_PERSONALITY_KEYS[0]);
    assert.equal(g.players[2].personality, CPU_PERSONALITY_KEYS[1]);
    assert.equal(g.players[3].personality, CPU_PERSONALITY_KEYS[2]);
    assert.equal(getCpuPersonality(g.players[1]).label, '店舗王');
    assert.equal(getCpuPersonality(g.players[2]).label, '株マニア');
  });

  it('CPU personalities prefer different stock budgets', () => {
    const mk = (personality) => {
      const g = createGame({
        players: [{ name: 'H' }, { name: 'CPU', isCPU: true, personality }],
        seed: 33,
        cash: 3000,
      });
      g.currentPlayerIdx = 1;
      g.phase = 'await_choice';
      g.pending = { type: 'stock', playerId: 1, bankVisit: true, maxBuys: 1 };
      const before = g.players[1].cash;
      const r = cpuAct(g);
      assert.equal(r?.ok, true);
      return before - g.players[1].cash;
    };
    const brokerSpend = mk('broker');
    const tycoonSpend = mk('tycoon');
    assert.ok(brokerSpend > 0, 'broker buys stock');
    assert.ok(brokerSpend >= tycoonSpend, 'broker spends at least as much as tycoon on stocks');
  });

  it('CPU keeps a cash reserve and will not spend below it on stocks', () => {
    const g = createGame({
      players: [{ name: 'H' }, { name: 'CPU', isCPU: true, personality: 'broker' }],
      seed: 44,
      cash: 900,
    });
    // 高額通行料がある盤面を想定してクッションを上げる
    const enemyShop = g.map.find((n) => n.type === 'shop');
    enemyShop.owner = 0;
    enemyShop.extraInvest = enemyShop.basePrice * 3;
    enemyShop.price = enemyShop.basePrice + enemyShop.extraInvest;
    g.players[0].cash = 5000;
    const reserve = cpuCashReserve(g, g.players[1]);
    assert.ok(reserve >= 400);
    assert.ok(cpuEstimateMaxToll(g, g.players[1]) >= calcToll(g, enemyShop));

    g.currentPlayerIdx = 1;
    g.phase = 'await_choice';
    g.pending = { type: 'stock', playerId: 1, bankVisit: true, maxBuys: 1 };
    const before = g.players[1].cash;
    cpuAct(g);
    assert.ok(g.players[1].cash >= Math.min(before, reserve) - 1, 'cash stays near reserve');
    assert.ok(g.players[1].cash >= reserve * 0.95 || g.players[1].cash === before);
  });

  it('CPU cancels optional raise_funds instead of going bankrupt', () => {
    const g = createGame({
      players: [{ name: 'H' }, { name: 'CPU', isCPU: true, personality: 'tycoon' }],
      seed: 55,
      cash: 50,
    });
    const shop = g.map.find((n) => n.type === 'shop');
    g.currentPlayerIdx = 1;
    g.players[1].cash = 50;
    g.players[1].stocks = {};
    // 店も株も無いので購入資金を作れない
    g.phase = 'await_choice';
    g.pending = {
      type: 'raise_funds',
      playerId: 1,
      targetCash: 500,
      reason: 'buy_shop',
      resume: { type: 'buy_shop', shopId: shop.id, price: 500 },
    };
    const r = cpuAct(g);
    assert.equal(r?.ok, true);
    assert.equal(g.players[1].bankrupt, false, 'must not bankrupt on failed optional buy');
    assert.equal(g.phase === 'await_choice' && g.pending?.type === 'raise_funds', false);
  });

  it('CPU invests only within cash reserve', () => {
    const g = createGame({
      players: [{ name: 'H' }, { name: 'CPU', isCPU: true, personality: 'magnate' }],
      seed: 66,
      cash: 800,
    });
    const shop = g.map.find((n) => n.type === 'shop');
    shop.owner = 1;
    shop.extraInvest = 0;
    shop.price = shop.basePrice;
    g.currentPlayerIdx = 1;
    g.players[1].cash = 800;
    const reserve = cpuCashReserve(g, g.players[1]);
    g.phase = 'await_choice';
    g.pending = {
      type: 'invest',
      playerId: 1,
      shopId: shop.id,
      landedShopId: shop.id,
      shopIds: [shop.id],
      remaining: getRemainingInvest(g, shop),
    };
    cpuAct(g);
    assert.ok(g.players[1].cash >= reserve - 1, `cash ${g.players[1].cash} reserve ${reserve}`);
    assert.equal(cpuCanAffordSpend(g, g.players[1], 0), true);
  });

  it('allows stock sell during own turn in roll/choice/fork phases', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 101,
      cash: 2000,
    });
    const area = Number(Object.keys(g.areas)[0]);
    g.players[0].stocks[area] = 20;
    g.phase = 'await_roll';
    assert.equal(canSellStockOnTurn(g, 0), true);
    assert.equal(canSellStockOnTurn(g, 1), false);
    const before = g.players[0].cash;
    const price = g.areas[area].stockPrice;
    const sold = preTurnSell(g, 0, area, 5);
    assert.equal(sold.ok, true);
    assert.equal(g.players[0].stocks[area], 15);
    assert.equal(g.players[0].cash, before + price * 5);

    // 選択待ちでも売れる
    g.phase = 'await_choice';
    g.pending = { type: 'buy_shop', playerId: 0, shopId: 1, price: 100 };
    assert.equal(canSellStockOnTurn(g, 0), true);
    const sold2 = preTurnSell(g, 0, area, 2);
    assert.equal(sold2.ok, true);
    assert.equal(g.players[0].stocks[area], 13);

    // 移動中は売れない
    g.phase = 'moving';
    g.move = { stepsLeft: 2, path: [], passedBank: false, startPos: g.startId };
    assert.equal(canSellStockOnTurn(g, 0), false);
    const blocked = preTurnSell(g, 0, area, 1);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, 'bad_phase');
  });

  it('tracks player stats and builds endgame results with awards', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      seed: 42,
      goal: 50000,
      cash: 5000,
    });
    assert.ok(g.players[0].stats);
    assert.equal(g.players[0].stats.rolls, 0);
    assert.deepEqual(Object.keys(createEmptyStats()).sort(), Object.keys(g.players[0].stats).sort());

    // サイコロ統計
    g.phase = 'await_roll';
    const rolled = rollDice(g);
    assert.equal(rolled.ok, true);
    assert.equal(g.players[0].stats.rolls, 1);
    assert.equal(g.players[0].stats.diceTotal, g.dice);

    // 店購入・独占統計
    const area = Number(Object.keys(g.areas)[0]);
    const shops = getAreaShops(g, area);
    for (let i = 0; i < shops.length - 1; i++) shops[i].owner = 0;
    const last = shops[shops.length - 1];
    g.players[0].cash = last.price + 1000;
    g.phase = 'await_choice';
    g.pending = { type: 'buy_shop', playerId: 0, shopId: last.id, price: last.price };
    const buy = applyChoice(g, { action: 'buy' });
    assert.equal(buy.ok, true);
    assert.equal(g.players[0].stats.shopsBought, 1);
    assert.ok(g.players[0].stats.monopolyCount >= 1);
    assert.ok(g.players[0].stats.monopolyBonus > 0);

    // 資産をばらしてアワードが付くようにする
    g.players[0].stats.tollEarned = 5000;
    g.players[0].stats.tollSaleCount = 8;
    g.players[0].stats.tollSaleMax = 900;
    g.players[0].stats.tollPayCount = 2;
    g.players[0].stats.tollPaid = 400;
    g.players[0].stats.tollPayMax = 250;
    g.players[0].stats.stockReturn = 300;
    g.players[1].stats.stockBought = 40;
    g.players[1].stocks[area] = 30;
    g.players[1].stats.stockReturn = 120;
    g.players[2].stats.scratchCount = 5;
    g.players[2].stats.matchBonus = 200;
    g.players[2].stats.tollPayCount = 10;
    g.players[2].stats.tollPaid = 3000;
    g.players[1].cash = 800;
    g.players[2].cash = 600;
    updateAreaStockPrices(g);
    g.winnerId = 0;
    g.phase = 'gameover';
    g.turn = 12;
    g.worthHistory = [
      { turn: 1, values: { 0: 2000, 1: 2000, 2: 2000 } },
      { turn: 6, values: { 0: 4500, 1: 3200, 2: 2800 } },
      { turn: 12, values: { 0: 9000, 1: 5000, 2: 3500 } },
    ];

    const results = buildGameResults(g);
    assert.equal(results.winnerId, 0);
    assert.equal(results.ranking.length, 3);
    assert.equal(results.ranking[0].rank, 1);
    assert.equal(results.ranking[0].id, 0);
    assert.ok(results.ranking[0].assets.total > 0);
    assert.equal(results.ranking[0].sales.count, 8);
    assert.equal(results.ranking[0].sales.greatest, 900);
    assert.equal(results.ranking[0].sales.average, Math.floor(5000 / 8));
    assert.ok(results.ranking[0].nextSalary > 0);
    assert.ok(results.worthHistory.length >= 1);
    assert.ok(results.awards.length >= 3);
    const titles = new Set(results.awards.map((a) => a.id));
    assert.ok(titles.has('toll_king'));
    assert.ok(titles.has('landlord') || titles.has('monopoly_king'));
    assert.ok(titles.has('scratch_king'));
    assert.ok(titles.has('shopaholic'));
    assert.ok(titles.has('big_sale'));

    // 欠けた stats でも ensure / build できる
    delete g.players[1].stats;
    ensureStats(g.players[1]);
    assert.equal(g.players[1].stats.rolls, 0);
    const again = buildGameResults(g);
    assert.equal(again.ranking.length, 3);
  });

  it('tracks stock return from price changes and worth history snapshots', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 7,
      goal: 50000,
      cash: 3000,
    });
    assert.ok(Array.isArray(g.worthHistory));
    assert.equal(g.worthHistory.length, 1);

    const area = Number(Object.keys(g.areas)[0]);
    g.players[0].stocks[area] = 20;
    syncStockValueSnap(g, g.players[0]);
    assert.equal(g.players[0].stats.stockReturn, 0);

    g.areas[area].B = Math.floor(g.areas[area].B * 1.5);
    const changes = updateAreaStockPrices(g);
    assert.ok(changes.some((c) => c.area === area));
    assert.ok(g.players[0].stats.stockReturn > 0);

    g.turn = 2;
    recordWorthSnapshot(g);
    assert.ok(g.worthHistory.length >= 2);
    assert.equal(g.worthHistory[g.worthHistory.length - 1].turn, 2);
  });

  it('normalizes missing or duplicate player colors onto the palette', () => {
    assert.equal(normalizePlayerColor('#ff00ff', 0), PLAYER_COLORS[0]);
    assert.equal(normalizePlayerColor(PLAYER_COLORS[1], 0, [PLAYER_COLORS[1]]), PLAYER_COLORS[0]);
    const lobby = normalizeLobbyColors([
      { name: 'A', color: '#deadbe' },
      { name: 'B', color: '#deadbe' },
      { name: 'C', color: PLAYER_COLORS[2] },
    ]);
    assert.deepEqual(lobby.map((p) => p.color), [
      PLAYER_COLORS[0],
      PLAYER_COLORS[1],
      PLAYER_COLORS[2],
    ]);

    const g = createGame({
      players: [
        { name: 'A', color: '#not-a-color' },
        { name: 'B', color: '#also-bad' },
      ],
      seed: 9,
    });
    assert.equal(g.players[0].color, PLAYER_COLORS[0]);
    assert.equal(g.players[1].color, PLAYER_COLORS[1]);

    g.players[0].color = '#00ff00';
    g.players[1].color = '#00ff00';
    const again = restoreState(serializeState(g));
    assert.equal(again.players[0].color, PLAYER_COLORS[0]);
    assert.equal(again.players[1].color, PLAYER_COLORS[1]);
    assert.notEqual(again.players[0].color, again.players[1].color);
  });
});
