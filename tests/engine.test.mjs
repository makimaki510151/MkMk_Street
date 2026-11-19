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
  previewStockSell,
  previewStockBuy,
  resetTurnSellPressure,
  STOCK_SELL_PRESSURE_MIN,
  STOCK_SELL_B_RATE,
  STOCK_BUY_BOOST_MIN,
  STOCK_BUY_B_RATE,
  rollDice,
  getMoveDiceMax,
  MOVE_DICE_MAX_DEFAULT,
  MOVE_DICE_MAX_LARGE,
  LARGE_MAP_AREA_THRESHOLD,
  advanceMove,
  applyChoice,
  chooseFork,
  getForwardNexts,
  getLandingCandidates,
  findForkNextForLanding,
  continueMove,
  updateAreaStockPrices,
  buildGameResults,
  formatGameResultsExport,
  gameResultsExportToText,
  gameResultsExportToCsv,
  gameResultsExportFilename,
  parseGameResultsExport,
  resultsFromExportPayload,
  GAME_RESULTS_SCHEMA,
  isPartyMinigame,
  PARTY_MINIGAME_GAMES,
  createEmptyStats,
  ensureStats,
  recordNudgeStats,
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
  scaleDiceSlotPrize,
  capMinigamePrize,
  MAX_WILDCARDS,
  grantWildcard,
  applyWildcardsToMarks,
  getWildcardCount,
  hasFullMarks,
  PLAYER_COLORS,
  normalizePlayerColor,
  normalizeLobbyColors,
  getLevelBonus,
  toggleBoardSwitch,
  getNode,
  canOpenShopTrade,
  openShopTradeCompose,
  sumShopPrices,
  defaultShopTradeCashDelta,
  executeShopTrade,
  cpuShouldAcceptShopTrade,
  cpuCashReserve,
  cpuCanAffordSpend,
  cpuEstimateMaxToll,
  cpuFocusAreas,
  cpuGamePhase,
  cpuNoise,
  cpuShouldBuyShop,
  cpuShouldFiveBuy,
  cpuPickScratchCell,
  cpuPickStockArea,
  getSharedEventTable,
} from '../js/engine.js';
import { buildBoard, AREA_SHOP_MAX, AREA_SHOP_BASE, MAP_CATALOG } from '../js/board.js';
import {
  unscratchedIds,
  EVENT_CATALOG,
  EVENT_COUNT,
  applyAllCash,
  scratchCell,
  findRivalMonopolies,
  collectWarpSquareRewards,
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
    assert.ok(MAP_CATALOG.length >= 6);
    const ids = new Set(MAP_CATALOG.map((m) => m.id));
    assert.ok(ids.has('central_cross'));
    assert.ok(ids.has('shell_harbor'));
    assert.ok(ids.has('cliff_isle'));
    assert.ok(ids.has('bin'));
    assert.ok(ids.has('thumbs_up'));
    assert.ok(ids.has('torima'));
    assert.ok(ids.has('bullet'));

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
    assert.ok(g.cols >= 12);

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

    // ワイルドマス：通過／着地でワイルドカードを1枚付与（マークはそのまま）。着地時はスクラッチも開く
    const fill = g.map.find((n) => n.type === 'suit_fill');
    assert.ok(fill);
    assert.match(fill.label, /ワイルド/);
    g.currentPlayerIdx = 0;
    g.players[0].marks = [true, false, true, false];
    g.players[0].wildcards = 0;
    g.players[0].pos = fill.id;
    g.players[0].flags.bankVisitDone = false;
    g.move = { stepsLeft: 0, path: [fill.id], passedBank: false, startPos: g.startId };
    g.phase = 'moving';
    g.pending = null;
    advanceMove(g);
    assert.deepEqual(g.players[0].marks, [true, false, true, false]);
    assert.equal(g.players[0].wildcards, 1);
    assert.equal(g.phase, 'await_choice');
    assert.equal(g.pending?.type, 'scratch');
    assert.equal(g.pending?.playerId, 0);

    // 上限4枚
    assert.equal(MAX_WILDCARDS, 4);
    g.players[0].wildcards = 4;
    assert.equal(grantWildcard(g, g.players[0]), false);
    assert.equal(getWildcardCount(g.players[0]), 4);

    // 銀行で空きマークへ変化し、4つ揃えば昇進
    const p = g.players[0];
    p.marks = [true, false, true, false];
    p.wildcards = 2;
    p.level = 1;
    p.cash = 1000;
    const filled = applyWildcardsToMarks(p);
    assert.equal(filled, 2);
    assert.deepEqual(p.marks, [true, true, true, true]);
    assert.equal(p.wildcards, 0);
    assert.equal(hasFullMarks(p), true);

    // 銀行訪問でワイルド→マーク→昇進
    g.currentPlayerIdx = 0;
    p.marks = [false, false, true, true];
    p.wildcards = 3;
    p.level = 2;
    p.flags.bankVisitDone = false;
    p.flags.pendingLevelUp = null;
    p.pos = g.startId;
    g.phase = 'moving';
    g.move = { stepsLeft: 0, path: [g.startId], passedBank: false, startPos: g.startId };
    g.pending = null;
    const cashBefore = p.cash;
    advanceMove(g);
    assert.equal(p.level, 3);
    assert.deepEqual(p.marks, [false, false, false, false]);
    assert.equal(p.wildcards, 1, '余剰ワイルドは持ち越し');
    assert.ok(p.cash > cashBefore);
  });

  it('grants mark or wildcard when warping onto those squares', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 55,
      mapId: 'cliff_isle',
    });
    const mark = g.map.find((n) => n.type === 'mark' && n.mark === 1);
    const fill = g.map.find((n) => n.type === 'suit_fill');
    assert.ok(mark && fill);
    const p = g.players[0];
    p.marks = [false, false, false, false];
    p.wildcards = 0;
    p.pos = g.startId;

    const msgs = [];
    const gotMark = collectWarpSquareRewards(g, p, mark.id, msgs);
    assert.equal(gotMark.kind, 'mark');
    assert.equal(gotMark.gained, true);
    assert.equal(p.marks[1], true);
    assert.match(msgs.join(' '), /入手/);

    // すでに所持なら増えない
    const again = collectWarpSquareRewards(g, p, mark.id, []);
    assert.equal(again.gained, false);

    const gotWild = collectWarpSquareRewards(g, p, fill.id, []);
    assert.equal(gotWild.kind, 'wildcard');
    assert.equal(gotWild.gained, true);
    assert.equal(p.wildcards, 1);

    // スクラッチのマークワープでも入手する
    const warpId = EVENT_CATALOG.findIndex((e) => e.effect === 'warp_mark');
    assert.ok(warpId >= 0);
    const table = getSharedEventTable(g);
    const cell = table.cells.find((c) => !c.scratched) || table.cells[0];
    cell.scratched = false;
    cell.eventId = warpId + 1;
    cell.label = EVENT_CATALOG[warpId].label;
    p.marks = [false, false, false, false];
    const beforePos = p.pos;
    const r = scratchCell(g, p, cell.id);
    assert.equal(r.ok, true);
    assert.notEqual(p.pos, beforePos);
    const dest = g.map.find((n) => n.id === p.pos);
    assert.equal(dest?.type, 'mark');
    assert.equal(p.marks[dest.mark], true);
    assert.ok(r.messages.some((m) => /入手/.test(m)));
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

  it('rollon pier: pass-through fork logs label but does not grant retry until land', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 4,
      mapId: 'shell_harbor',
    });
    const swN = g.map.find((n) => n.type === 'switch' && n.row === 1);
    const pierScratch = g.map.find((n) => n.type === 'scratch' && n.col === 3 && n.row === 1);
    const pierN2 = g.map.find((n) => n.type === 'rollon' && n.col === 5 && n.row === 1);
    assert.ok(swN && pierScratch && pierN2);
    assert.equal(pierN2.label, 'もう一回');

    // 歩数残りありで rollon へ分岐 → 通過のみ（再挑戦ログなし）
    g.players[0].pos = swN.id;
    g.players[0].prevPos = pierScratch.id;
    g.move = { stepsLeft: 3, path: [swN.id], passedBank: false, startPos: g.startId };
    g.phase = 'moving';
    assert.equal(advanceMove(g).forked, true);
    const pass = chooseFork(g, pierN2.id);
    assert.equal(pass.ok, true);
    assert.equal(pass.done, false);
    assert.equal(g.players[0].pos, pierN2.id);
    assert.ok(g.move?.stepsLeft > 0);
    assert.equal(g.phase, 'moving');
    assert.ok(
      g.logs.some((l) => /「北埠頭へ」方面へ/.test(l.text)),
      'fork log prefers forkAs over rollon label',
    );
    assert.equal(g.logs.some((l) => /「もう一回」方面へ/.test(l.text)), false);
    assert.equal(g.logs.some((l) => /もう一回サイコロ/.test(l.text)), false);

    // ぴったり着地なら再挑戦
    g.players[0].pos = pierN2.id;
    g.players[0].prevPos = swN.id;
    g.move = { stepsLeft: 0, path: [pierN2.id], passedBank: false, startPos: g.startId };
    g.phase = 'moving';
    g.pending = null;
    const land = advanceMove(g);
    assert.equal(land.ok, true);
    assert.equal(land.done, true);
    assert.equal(g.phase, 'await_roll');
    assert.ok(g.logs.some((l) => /もう一回サイコロ/.test(l.text)));
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

  it('builds the bottle-shaped bin map with warps and 13 areas', () => {
    const board = buildBoard('bin');
    assert.equal(board.mapId, 'bin');
    assert.equal(board.mapName, '瓶');
    assert.equal(board.cols, 9);
    assert.equal(board.rows, 14);
    assert.equal(Object.keys(board.areas).length, 13);
    for (const a of Object.keys(board.areas).map(Number)) {
      const shops = board.nodes.filter((n) => n.type === 'shop' && n.area === a);
      assert.equal(shops.length, 4, `area ${a}`);
    }
    const warps = board.nodes.filter((n) => n.type === 'warp');
    assert.equal(warps.length, 2);
    assert.equal(warps[0].warpTo, warps[1].id);
    assert.equal(warps[1].warpTo, warps[0].id);
    assert.ok(board.nodes.some((n) => n.type === 'suit_fill'));
    assert.ok(board.nodes.some((n) => n.type === 'lucky'));
    assert.ok(board.nodes.filter((n) => n.type === 'minigame').length >= 2);
    const bank = board.nodes.find((n) => n.type === 'bank');
    assert.equal(bank?.col, 4);
    assert.equal(bank?.row, 0);
  });

  it('builds the thumbs-up map with 19 areas and no dead ends', () => {
    const board = buildBoard('thumbs_up');
    assert.equal(board.mapId, 'thumbs_up');
    assert.equal(board.mapName, 'サムズアップ');
    assert.equal(board.cols, 21);
    assert.equal(board.rows, 18);
    assert.equal(Object.keys(board.areas).length, 19);
    for (const a of Object.keys(board.areas).map(Number)) {
      const shops = board.nodes.filter((n) => n.type === 'shop' && n.area === a);
      assert.ok(shops.length >= 4 && shops.length <= 5, `area ${a}: ${shops.length}`);
    }
    assert.equal(
      board.nodes.filter((n) => n.type === 'shop' && n.area === 18).length,
      5,
      'thumb tip area has 5 shops',
    );
    assert.ok(board.nodes.some((n) => n.type === 'lucky'));
    assert.ok(board.nodes.some((n) => n.type === 'rollon'));
    assert.ok(board.nodes.some((n) => n.type === 'scratch'));
    assert.ok(board.nodes.filter((n) => n.type === 'minigame').length >= 2);
    assert.ok(board.nodes.filter((n) => n.type === 'event').length >= 3);
    assert.equal(board.nodes.filter((n) => n.type === 'mark').length, 4);
    const bank = board.nodes.find((n) => n.type === 'bank');
    assert.equal(bank?.col, 5);
    assert.equal(bank?.row, 8);
    for (const n of board.nodes) {
      assert.ok((n.nexts?.length || 0) >= 2, `${n.type}:${n.label} deg=${n.nexts?.length || 0}`);
    }
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
        const allowGapDiag = def.id === 'torima' || def.id === 'bullet';
        for (const n of g.map) {
          assert.ok(
            (n.nexts?.length || 0) >= 2,
            `${def.id} state ${g.switchState}: ${n.type}:${n.label} deg=${n.nexts?.length || 0}`,
          );
          for (const nid of n.nexts) {
            const other = getNode(g, nid);
            assert.ok(other?.nexts.includes(n.id), `${def.id}: missing back-link`);
            const dc = other.col - n.col;
            const dr = other.row - n.row;
            const diag = dc !== 0 && dr !== 0;
            if (!allowGapDiag) {
              assert.equal(diag, false, `${def.id}: diagonal ${n.label}-${other.label}`);
            } else {
              assert.ok(Math.abs(dc) <= 1 && Math.abs(dr) <= 1, `${def.id}: link too far`);
              if (diag) {
                // 角にマスがある斜め＝小さな三角形は禁止
                const cornerH = g.map.find((x) => x.col === n.col + dc && x.row === n.row);
                const cornerV = g.map.find((x) => x.col === n.col && x.row === n.row + dr);
                assert.equal(
                  !!(cornerH || cornerV),
                  false,
                  `${def.id}: triangle diagonal ${n.label}-${other.label}`,
                );
              }
            }
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

    // 着地ログは UI の bannerFromLog が抑止する文言（確認ダイアログにしない）
    const switchLog = g.logs.find((l) => /スイッチを倒した/.test(l.text));
    assert.ok(switchLog, 'switch land should log toggle');
    assert.equal(switchLog.kind, 'event');
    assert.match(switchLog.text, /経路が切り替わった/);
    assert.match(
      switchLog.text,
      /スイッチを倒した|経路が切り替わった|航路が切り替わった/,
      'log must stay in bannerFromLog suppress list',
    );
  });

  it('shell harbor switch land without switchMoves still toggles and logs', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 11,
      mapId: 'shell_harbor',
    });
    g.switchMoves = [];
    const hub = g.map.find((n) => n.type === 'switch');
    assert.ok(hub);
    const before = g.switchState;
    g.players[0].pos = hub.id;
    g.players[0].prevPos = hub.nexts[0];
    g.currentPlayerIdx = 0;
    g.move = { stepsLeft: 0, path: [hub.id], passedBank: false, startPos: hub.nexts[0] };
    g.phase = 'moving';
    const landed = advanceMove(g);
    assert.equal(g.switchState, before ? 0 : 1);
    assert.ok(Array.isArray(landed.switchMoves));
    assert.equal(landed.switchMoves.length, 0, 'no sliding tiles when switchMoves stripped');
    assert.equal(g.phase, 'await_roll', 'switch land ends turn');
    const switchLog = g.logs.find((l) => /スイッチを倒した/.test(l.text));
    assert.ok(switchLog);
    assert.equal(switchLog.kind, 'event');
    // presentSwitchFx は動かないが、ログ抑止で確認ダイアログは出さない契約
    assert.match(switchLog.text, /スイッチを倒した|経路が切り替わった/);
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
    assert.equal(g.players[0].cash, 2200);
  });

  it('honors createGame cash override for lobby start funds', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 1,
      goal: 10000,
      cash: 3500,
    });
    assert.equal(g.players[0].cash, 3500);
    assert.equal(g.players[1].cash, 3500);
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

  it('invest stays numeric even if extraInvest was missing', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 19,
      cash: 3000,
    });
    const shop = g.map.find((n) => n.type === 'shop');
    shop.owner = 0;
    delete shop.extraInvest;
    shop.price = shop.basePrice;
    g.players[0].pos = shop.id;
    g.phase = 'moving';
    g.move = { stepsLeft: 0, path: [shop.id], passedBank: false, startPos: g.startId };
    assert.equal(advanceMove(g).ok, true);
    const r = applyChoice(g, { action: 'invest', shopId: shop.id, amount: 80 });
    assert.equal(r.ok, true);
    assert.equal(shop.extraInvest, 80);
    assert.equal(shop.price, shop.basePrice + 80);
    assert.equal(Number.isFinite(calcToll(g, shop)), true);
  });

  it('CPU invest respects half coupon when budgeting spend', () => {
    const g = createGame({
      players: [{ name: 'CPU', isCPU: true }, { name: 'B' }],
      seed: 23,
      cash: 900,
    });
    const shop = g.map.find((n) => n.type === 'shop');
    shop.owner = 0;
    shop.extraInvest = 0;
    shop.price = shop.basePrice;
    g.players[0].flags.investCoupon = true;
    g.players[0].pos = shop.id;
    g.phase = 'moving';
    g.move = { stepsLeft: 0, path: [shop.id], passedBank: false, startPos: g.startId };
    assert.equal(advanceMove(g).ok, true);
    assert.equal(g.pending?.type, 'invest');
    const before = g.players[0].cash;
    const r = cpuAct(g);
    assert.equal(r?.ok, true);
    // 半額クーポンを活かして何らかの増資をする（スキップしない）
    assert.ok(shop.extraInvest > 0, `expected invest, got extra=${shop.extraInvest}`);
    assert.ok(g.players[0].cash < before);
    assert.equal(g.players[0].flags.investCoupon, false);
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
    const BBefore = g.areas[area].B;
    const stockBefore = g.areas[area].stockPrice;
    const shopPricesBefore = shops.map((sq) => sq.price);
    const tollBefore = calcToll(g, shops[0]);
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
    // 独占ボーナスでは店価・株価係数は動かない
    assert.equal(g.areas[area].B, BBefore);
    assert.equal(g.areas[area].stockPrice, stockBefore);
    assert.deepEqual(shops.map((sq) => sq.price), shopPricesBefore);
    // 買い物料は独占倍率で上がってよい
    assert.ok(calcToll(g, shops[0]) > tollBefore);
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

  it('uses d10 move dice on maps with 11+ areas, otherwise d6', () => {
    const small = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 1,
      mapId: 'central_cross',
    });
    assert.ok(Object.keys(small.areas).length < LARGE_MAP_AREA_THRESHOLD);
    assert.equal(getMoveDiceMax(small), MOVE_DICE_MAX_DEFAULT);

    const large = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 1,
      mapId: 'bin',
    });
    assert.ok(Object.keys(large.areas).length >= LARGE_MAP_AREA_THRESHOLD);
    assert.equal(getMoveDiceMax(large), MOVE_DICE_MAX_LARGE);

    let sawHigh = false;
    for (let seed = 1; seed <= 80 && !sawHigh; seed++) {
      const g = createGame({
        players: [{ name: 'A' }, { name: 'B' }],
        seed,
        mapId: 'thumbs_up',
      });
      const r = rollDice(g);
      assert.equal(r.ok, true);
      assert.equal(r.diceMax, MOVE_DICE_MAX_LARGE);
      assert.ok(r.dice >= 1 && r.dice <= MOVE_DICE_MAX_LARGE);
      if (r.dice > MOVE_DICE_MAX_DEFAULT) sawHigh = true;
    }
    assert.ok(sawHigh, 'expected at least one roll above 6 on a large map');
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

  it('getLandingCandidates lists unique final stops for a roll', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 3,
    });
    const bank = g.startId;
    const arms = getForwardNexts(g, bank, null);
    const one = getLandingCandidates(g, bank, null, 1);
    assert.equal(one.length, arms.length);
    assert.deepEqual([...one].sort((a, b) => a - b), [...arms].sort((a, b) => a - b));

    const six = getLandingCandidates(g, bank, null, 6);
    assert.ok(six.length >= 4);
    assert.equal(new Set(six).size, six.length);

    // 残り歩数があっても行き止まりならそこで着地
    g.map = [
      { id: 0, type: 'bank', label: '銀', col: 0, row: 0, nexts: [1] },
      { id: 1, type: 'shop', label: '店', col: 1, row: 0, nexts: [], area: 0, price: 100, basePrice: 100, owner: -1, extraInvest: 0 },
    ];
    g.startId = 0;
    assert.deepEqual(getLandingCandidates(g, 0, null, 3), [1]);
  });

  it('getLandingCandidates resolves warp landings to the destination', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 1,
    });
    g.map = [
      { id: 0, type: 'bank', label: '銀', col: 0, row: 0, nexts: [1, 2] },
      {
        id: 1, type: 'shop', label: 'A', col: 1, row: 0, nexts: [3],
        area: 0, price: 100, basePrice: 100, owner: -1, extraInvest: 0,
      },
      {
        id: 2, type: 'shop', label: 'B', col: 0, row: 1, nexts: [4],
        area: 0, price: 100, basePrice: 100, owner: -1, extraInvest: 0,
      },
      { id: 3, type: 'warp', label: 'W', col: 2, row: 0, nexts: [], warpTo: 4 },
      { id: 4, type: 'lucky', label: 'L', col: 0, row: 2, nexts: [] },
    ];
    g.startId = 0;
    assert.deepEqual(getLandingCandidates(g, 0, null, 1).sort((a, b) => a - b), [1, 2]);
    // 0→1→3(warp→4) と 0→2→4 の両経路とも最終は 4
    assert.deepEqual(getLandingCandidates(g, 0, null, 2), [4]);
  });

  it('findForkNextForLanding maps a final stop click to the next fork step', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 3,
    });
    const bank = g.startId;
    const arms = getForwardNexts(g, bank, null);
    assert.ok(arms.length >= 2);
    // 残り1: 停止マス＝隣マス → その隣を選ぶ
    assert.equal(findForkNextForLanding(g, bank, null, 1, arms[0], arms), arms[0]);
    // 残り2以上: 遠い停止マスから最初の一歩を逆引き
    const far = getLandingCandidates(g, bank, null, 3);
    assert.ok(far.length >= 1);
    const step = findForkNextForLanding(g, bank, null, 3, far[0], arms);
    assert.ok(arms.includes(step));
    const via = getLandingCandidates(g, step, bank, 2);
    assert.ok(via.includes(far[0]));
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
    assert.ok(
      kinds.has('takeover_coupon') || kinds.has('five_buy_coupon'),
      'expected cheap takeover coupon events',
    );
    assert.ok(kinds.has('slash_rival_shops'), 'expected rival shop markdown events');
    assert.ok(kinds.has('slash_own_shops'), 'expected own shop markdown events');
    assert.ok(kinds.has('any_shop_buy'), 'expected any-shop N× buy events');
    assert.ok(kinds.has('force_sell_shop'), 'expected forced shop-sale events');
    assert.ok(kinds.has('swap_all_pos'), 'expected all-position shuffle events');
    assert.ok(kinds.has('scatter_all'), 'expected scatter-all warp events');
    assert.ok(kinds.has('gather_all'), 'expected gather-all warp events');
    const allCash = EVENT_CATALOG.filter((e) => e.effect === 'all_cash').length;
    const minis = EVENT_CATALOG.filter((e) => e.effect === 'minigame').length;
    const takeover = EVENT_CATALOG.filter((e) => e.effect === 'takeover_coupon');
    assert.ok(takeover.some((e) => e.multi === 3), 'expected 3× takeover coupons');
    assert.ok(takeover.some((e) => e.multi === 4), 'expected 4× takeover coupons');
    assert.ok(allCash >= 6, `expected several all_cash events, got ${allCash}`);
    assert.ok(minis >= 8, `expected many minigame events, got ${minis}`);
    assert.ok(kinds.size >= 30, `expected richer unique effects, got ${kinds.size}`);
    const miniGames = new Set(
      EVENT_CATALOG.filter((e) => e.effect === 'minigame').map((e) => e.game)
    );
    assert.ok(miniGames.size >= 8, `expected distinct minigame rules, got ${[...miniGames]}`);
    assert.ok(miniGames.has('dice_battle'));
    assert.ok(miniGames.has('horse_race'));
    assert.ok(miniGames.has('rps_duel'));
    assert.ok(miniGames.has('roulette'));
    assert.ok(miniGames.has('heist'));
    assert.ok(miniGames.has('balloon_dash'));
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

  it('findRivalMonopolies matches hasAreaMonopoly and ignores partial ownership', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 19,
      cash: 2000,
    });
    const area = Number(Object.keys(g.areas)[0]);
    const shops = getAreaShops(g, area);
    assert.ok(shops.length >= 3);

    assert.deepEqual(findRivalMonopolies(g, 0), []);

    for (const sq of shops) sq.owner = 1;
    assert.equal(hasAreaMonopoly(g, 1, area), true);
    const found = findRivalMonopolies(g, 0);
    assert.equal(found.length, 1);
    assert.equal(found[0].area, area);
    assert.equal(found[0].ownerId, 1);
    // 自分の独占はライバル扱いにしない
    assert.deepEqual(findRivalMonopolies(g, 1), []);

    shops[0].owner = -1;
    assert.equal(hasAreaMonopoly(g, 1, area), false);
    assert.equal(findRivalMonopolies(g, 0).some((m) => m.area === area), false);
  });

  it('seize_mono_shop breaks a rival monopoly', () => {
    const seizeId = EVENT_CATALOG.findIndex((e) => e.effect === 'seize_mono_shop');
    assert.ok(seizeId >= 0);
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 21,
      cash: 20000,
    });
    const area = Number(Object.keys(g.areas)[0]);
    const shops = getAreaShops(g, area);
    assert.ok(shops.length >= 2);
    for (const sq of shops) {
      sq.owner = 1;
      sq.basePrice = 8000;
      sq.extraInvest = 4000;
      sq.price = 12000;
    }
    g.players[1].flags.monopolyBonusClaimed = { [area]: true };
    g.areas[area].B = 200;
    updateAreaStockPrices(g);
    const priceBefore = g.areas[area].stockPrice;
    assert.equal(hasAreaMonopoly(g, 1, area), true);

    // スクラッチ選択経路経由で独占崩壊ペナルティまで適用されること
    g.phase = 'await_choice';
    g.currentPlayerIdx = 0;
    g.pending = {
      type: 'scratch',
      playerId: 0,
      openIds: [0],
    };
    const cell = g.sharedEventTable.cells[0];
    cell.eventId = seizeId + 1;
    cell.label = EVENT_CATALOG[seizeId].label;
    cell.scratched = false;
    const r = applyChoice(g, { action: 'scratch', cellId: 0 });
    assert.equal(r.ok, true);
    assert.equal(hasAreaMonopoly(g, 1, area), false);
    const taken = shops.filter((s) => s.owner === 0);
    assert.equal(taken.length, 1);
    assert.ok(r.messages.some((m) => /奪取/.test(m)));
    assert.ok(r.monopolyBreak?.broken, 'scratch seize should apply monopoly break');
    assert.ok(
      g.areas[area].stockPrice < priceBefore,
      `stock should crash on scratch seize: ${g.areas[area].stockPrice} >= ${priceBefore}`,
    );
    assert.equal(g.players[1].flags.monopolyBonusClaimed?.[area], undefined);
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
    assert.equal(isPartyMinigame('slot'), false);
    assert.deepEqual(g.pending?.participantIds, [0]);
    assert.equal(g.pending?.party, false);
    assert.equal(g.pending?.starterId, 0);

    const diceHub = g.map.find((n) => n.type === 'minigame' && n.game === 'guess_dice');
    g.players[0].pos = diceHub.id;
    g.phase = 'moving';
    g.move = { stepsLeft: 0, path: [diceHub.id], passedBank: false, startPos: g.startId };
    g.pending = null;
    advanceMove(g);
    assert.equal(g.pending?.type, 'minigame');
    assert.equal(g.pending?.game, 'guess_dice');
    assert.equal(isPartyMinigame('guess_dice'), true);
    assert.deepEqual(g.pending.participantIds, [0, 1]);
    assert.equal(g.pending.party, true);
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

  it('bullet map builds with three warp pairs linked by kind', () => {
    const board = buildBoard('bullet');
    assert.equal(board.mapId, 'bullet');
    assert.equal(board.mapName, '弾丸');
    assert.equal(board.cols, 19);
    assert.equal(board.rows, 11);
    assert.equal(Object.keys(board.areas).length, 8);
    for (const a of Object.keys(board.areas).map(Number)) {
      assert.equal(
        board.nodes.filter((n) => n.type === 'shop' && n.area === a).length,
        4,
        `area ${a}`,
      );
    }
    const warps = board.nodes.filter((n) => n.type === 'warp');
    assert.equal(warps.length, 6);
    const byLabel = Object.fromEntries(warps.map((w) => [w.label, w]));
    assert.equal(byLabel['弾倉上ワープ'].warpTo, byLabel['弾頭上ワープ'].id);
    assert.equal(byLabel['弾頭上ワープ'].warpTo, byLabel['弾倉上ワープ'].id);
    assert.equal(byLabel['弾倉下ワープ'].warpTo, byLabel['弾頭下ワープ'].id);
    assert.equal(byLabel['弾頭下ワープ'].warpTo, byLabel['弾倉下ワープ'].id);
    assert.equal(byLabel['薬室ワープ'].warpTo, byLabel['撃鉄ワープ'].id);
    assert.equal(byLabel['撃鉄ワープ'].warpTo, byLabel['薬室ワープ'].id);
    // JSON座標どおり
    assert.equal(byLabel['弾倉上ワープ'].col, 6);
    assert.equal(byLabel['弾倉上ワープ'].row, 2);
    assert.equal(byLabel['弾頭上ワープ'].col, 17);
    assert.equal(byLabel['弾頭上ワープ'].row, 2);
    assert.equal(byLabel['弾倉下ワープ'].col, 4);
    assert.equal(byLabel['弾倉下ワープ'].row, 8);
    assert.equal(byLabel['弾頭下ワープ'].col, 17);
    assert.equal(byLabel['弾頭下ワープ'].row, 8);
    assert.equal(byLabel['薬室ワープ'].col, 10);
    assert.equal(byLabel['薬室ワープ'].row, 3);
    assert.equal(byLabel['撃鉄ワープ'].col, 18);
    assert.equal(byLabel['撃鉄ワープ'].row, 5);

    const bank = board.nodes.find((n) => n.type === 'bank');
    assert.equal(bank?.col, 9);
    assert.equal(bank?.row, 5);
    // 銀行は直交が空なので斜めブリッジでイベント／店とつながる
    assert.ok(bank.nexts.length >= 4, `bank deg=${bank.nexts.length}`);

    // 転送を辺として全マス到達可能
    const byId = new Map(board.nodes.map((n) => [n.id, n]));
    const seen = new Set([bank.id]);
    const q = [bank.id];
    while (q.length) {
      const id = q.shift();
      const n = byId.get(id);
      for (const nid of n.nexts) {
        if (!seen.has(nid)) {
          seen.add(nid);
          q.push(nid);
        }
      }
      if (n.type === 'warp' && n.warpTo != null && !seen.has(n.warpTo)) {
        seen.add(n.warpTo);
        q.push(n.warpTo);
      }
    }
    assert.equal(seen.size, board.nodes.length, 'all squares reachable via links+warps');

    // 異種転送どうしは結ばない
    for (const w of warps) {
      const dest = byId.get(w.warpTo);
      assert.ok(dest && dest.type === 'warp');
      const pairOk = (
        (w.label.includes('上') && dest.label.includes('上'))
        || (w.label.includes('下') && dest.label.includes('下'))
        || (w.label.includes('薬室') && dest.label.includes('撃鉄'))
        || (w.label.includes('撃鉄') && dest.label.includes('薬室'))
      );
      assert.ok(pairOk, `${w.label} -> ${dest.label}`);
    }
  });

  it('torima map builds with holiday squares that close own shops for one turn', () => {
    const board = buildBoard('torima');
    assert.equal(board.mapId, 'torima');
    assert.equal(board.cols, 19);
    assert.equal(board.rows, 11);
    assert.equal(Object.keys(board.areas).length, 10);
    assert.equal(board.nodes.filter((n) => n.type === 'junction').length, 0);
    const holidays = board.nodes.filter((n) => n.type === 'holiday');
    assert.equal(holidays.length, 2);
    assert.ok(holidays.every((h) => h.label === '店休'));
    // JSON配置どおり：銀行は角空きの斜めブリッジでＡ／Ｂとつながる
    const bank = board.nodes.find((n) => n.type === 'bank');
    const nearShops = board.nodes.filter((n) => n.type === 'shop' && bank.nexts.includes(n.id));
    assert.ok(nearShops.length >= 4, 'bank should link diagonally to nearby shops');

    // マーク角・スロット／ラッキー脇に単位三角形がないこと
    const byPos = new Map(board.nodes.map((n) => [`${n.col},${n.row}`, n]));
    for (const n of board.nodes) {
      for (const nid of n.nexts) {
        const other = board.nodes.find((x) => x.id === nid);
        const dc = other.col - n.col;
        const dr = other.row - n.row;
        if (!dc || !dr) continue;
        assert.equal(!!byPos.get(`${n.col + dc},${n.row}`), false);
        assert.equal(!!byPos.get(`${n.col},${n.row + dr}`), false);
      }
    }
    const slot = board.nodes.find((n) => n.type === 'minigame' && n.game === 'slot' && n.row === 2);
    const lucky = board.nodes.find((n) => n.type === 'lucky' && n.row === 2);
    assert.ok(slot && lucky);
    // ス／ラから「角に店がある」斜め隣へは繋がらない
    for (const hub of [slot, lucky]) {
      for (const nid of hub.nexts) {
        const o = board.nodes.find((x) => x.id === nid);
        const dc = o.col - hub.col;
        const dr = o.row - hub.row;
        if (!dc || !dr) continue;
        assert.equal(!!byPos.get(`${hub.col + dc},${hub.row}`), false);
        assert.equal(!!byPos.get(`${hub.col},${hub.row + dr}`), false);
      }
    }

    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 12,
      mapId: 'torima',
    });
    const holiday = g.map.find((n) => n.type === 'holiday');
    const shop = g.map.find((n) => n.type === 'shop');
    shop.owner = 0;
    g.players[0].pos = holiday.id;
    g.phase = 'moving';
    g.move = { stepsLeft: 0, path: [holiday.id], passedBank: false, startPos: g.startId };
    advanceMove(g);
    assert.equal(g.players[0].shopsClosed, true);
    assert.equal(calcToll(g, shop), 0);
    assert.ok(g.logs.some((l) => /店休|休み/.test(l.text)));

    // 次ターン開始（サイコロ）で店休解除
    g.phase = 'await_roll';
    g.currentPlayerIdx = 0;
    g.pending = null;
    g.move = null;
    const rolled = rollDice(g);
    assert.equal(rolled.ok, true);
    assert.equal(g.players[0].shopsClosed, false);
    const reopen = g.logs.find((l) => /営業再開/.test(l.text));
    assert.ok(reopen, 'reopen log expected');
    assert.equal(reopen.kind, 'system');
    assert.match(reopen.text, /営業再開した/);
    assert.doesNotMatch(reopen.text, /店休マス/);
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
    assert.equal(done.fiveBuyShop, shop.label);
    assert.equal(done.fiveBuyMulti, 5);
    assert.equal(done.fiveBuyPlayerId, 0);
    assert.equal(shop.owner, 0);
  });

  it('five_buy success returns FX metadata for client sync', () => {
    const g = createGame({
      players: [{ name: 'A', cash: 5000 }, { name: 'B', cash: 5000 }],
      seed: 93,
      cash: 5000,
    });
    const shop = g.map.find((n) => n.type === 'shop');
    assert.ok(shop);
    shop.owner = 1;
    shop.price = 150;
    shop.basePrice = 150;
    shop.extraInvest = 0;
    g.players[0].cash = 5000;
    g.phase = 'await_choice';
    g.pending = {
      type: 'five_buy',
      playerId: 0,
      shopId: shop.id,
      price: shop.price * 5,
      multi: 5,
      toll: 30,
    };
    const done = applyChoice(g, { action: 'buy' });
    assert.equal(done.ok, true);
    assert.equal(done.fiveBuy, true);
    assert.equal(done.fiveBuyShop, shop.label);
    assert.equal(done.fiveBuyMulti, 5);
    assert.equal(done.fiveBuyPlayerId, 0);
    assert.equal(shop.owner, 0);
    assert.ok(g.logs.some((l) => /5倍買いで/.test(l.text) && /奪取/.test(l.text)));
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

  function openMinigamePending(g, game, label, starterId = 0) {
    const ids = g.players.filter((p) => !p.bankrupt).map((p) => p.id);
    const party = isPartyMinigame(game);
    const ordered = party
      ? [starterId, ...ids.filter((id) => id !== starterId)]
      : [starterId];
    g.phase = 'await_choice';
    g.currentPlayerIdx = starterId;
    g.pending = {
      type: 'minigame',
      playerId: ordered[0],
      starterId,
      game,
      label,
      participantIds: ordered,
      picks: {},
      party,
    };
  }

  function allPlayersPick(g, valuesByOrder) {
    let last = null;
    for (const value of valuesByOrder) {
      const choice = value && typeof value === 'object' && value.action
        ? value
        : { action: 'pick', value };
      last = applyChoice(g, choice);
      assert.equal(last.ok, true, last.error || 'pick failed');
    }
    return last;
  }

  it('minigame waits for every player before resolving shared outcome', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 88,
      cash: 1000,
    });
    assert.ok(PARTY_MINIGAME_GAMES.has('coin'));
    assert.equal(isPartyMinigame('slot'), false);
    openMinigamePending(g, 'coin', 'コイントス');
    const beforeA = g.players[0].cash;
    const beforeB = g.players[1].cash;
    const mid = applyChoice(g, { action: 'pick', value: 'heads' });
    assert.equal(mid.ok, true);
    assert.equal(mid.minigamePick, true);
    assert.equal(g.pending?.playerId, 1);
    assert.equal(g.pending?.picks?.[0], 'heads');
    assert.equal(g.players[0].cash, beforeA, 'no payout until everyone picked');
    assert.equal(g.players[1].cash, beforeB);

    const r = applyChoice(g, { action: 'pick', value: 'tails' });
    assert.equal(r.ok, true);
    assert.equal(r.minigame, true);
    assert.equal(g.pending, null);
    assert.ok(r.reveal?.results?.length === 2);
    assert.ok(r.reveal.shared?.face || r.reveal.outcome?.face);
    assert.ok(g.players[0].cash >= beforeA);
    assert.ok(g.players[1].cash >= beforeB);
  });

  it('slot minigame is solo and reveals symbols/tier after one spin', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 42,
      cash: 1000,
    });
    openMinigamePending(g, 'slot', 'スロット');
    assert.deepEqual(g.pending.participantIds, [0]);
    const beforeB = g.players[1].cash;
    const r = allPlayersPick(g, [{ action: 'spin' }]);
    assert.equal(r.reveal.game, 'slot');
    assert.equal(r.reveal.results.length, 1);
    assert.equal(r.reveal.shared.symbols.length, 5);
    assert.equal(g.players[1].cash, beforeB, 'slot does not pay other players');
    assert.ok(Array.isArray(r.reveal.results[0].outcome.hitIndices));
    assert.ok(
      ['jackpot', 'quad', 'fullhouse', 'triple', 'two_pair', 'pair', 'miss'].includes(r.reveal.results[0].tier)
    );
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
      openMinigamePending(g, 'slot', 'スロット');
      const before = g.players[0].cash;
      const r = allPlayersPick(g, [{ action: 'spin' }]);
      assert.equal(r.ok, true);
      assert.equal(r.reveal.shared.symbols.length, 5);
      const my = r.reveal.results.find((x) => x.playerId === 0);
      assert.ok(SLOT_TIERS.includes(my.tier));
      seen.add(my.tier);
      const prize = g.players[0].cash - before;
      if (my.tier === 'jackpot') {
        assert.ok(prize >= 400);
        assert.ok(prize <= capMinigamePrize(99999, g.goal));
        assert.equal(my.win, true);
      } else if (my.tier === 'quad') {
        assert.ok(prize >= 240);
        assert.equal(my.win, true);
      } else if (my.tier === 'pair') {
        assert.ok(prize >= 35);
        assert.equal(my.win, true);
      } else if (my.tier === 'miss') {
        assert.equal(my.win, false);
        assert.ok(prize >= 18);
      }
    }
    assert.ok(seen.has('pair') || seen.has('two_pair') || seen.has('triple'));
  });

  it('scales dice/slot minigame prizes gently by level and caps jackpots', () => {
    assert.equal(scaleDiceSlotPrize(100, 1), 100);
    assert.equal(scaleDiceSlotPrize(100, 3), 150);
    assert.equal(scaleDiceSlotPrize(115, 2), 143);
    assert.equal(capMinigamePrize(5000, 10000), 800);
    assert.equal(capMinigamePrize(100, 10000), 100);

    let foundExact = false;
    for (let seed = 1; seed <= 80 && !foundExact; seed++) {
      for (let pick = 1; pick <= 6; pick++) {
        const g2 = createGame({
          players: [{ name: 'A' }, { name: 'B' }],
          seed,
          cash: 5000,
        });
        g2.players[0].level = 3;
        openMinigamePending(g2, 'guess_dice', 'サイコロ当て');
        const before = g2.players[0].cash;
        const r = allPlayersPick(g2, [pick, ((pick % 6) + 1)]);
        const mine = r.reveal?.results?.find((x) => x.playerId === 0);
        if (mine?.tier !== 'exact') continue;
        const gained = g2.players[0].cash - before;
        assert.equal(gained, scaleDiceSlotPrize(180, 3));
        foundExact = true;
        break;
      }
    }
    assert.ok(foundExact, 'expected an exact dice guess within seeds');

    let foundPair = false;
    for (let seed = 1; seed <= 200 && !foundPair; seed++) {
      const g = createGame({
        players: [{ name: 'A' }, { name: 'B' }],
        seed,
        cash: 5000,
      });
      g.players[0].level = 3;
      openMinigamePending(g, 'slot', 'スロット');
      const before = g.players[0].cash;
      const r = allPlayersPick(g, [{ action: 'spin' }]);
      const mine = r.reveal?.results?.find((x) => x.playerId === 0);
      if (mine?.tier !== 'pair') continue;
      const gained = g.players[0].cash - before;
      assert.equal(gained, scaleDiceSlotPrize(35, 3));
      foundPair = true;
    }
    assert.ok(foundPair, 'expected a slot pair within seeds');
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
    const run = (game, label, choiceA, choiceB = choiceA) => {
      const g = createGame({
        players: [{ name: 'A' }, { name: 'B' }],
        seed: 3,
        cash: 1000,
      });
      openMinigamePending(g, game, label);
      const picks = isPartyMinigame(game) ? [choiceA, choiceB] : [choiceA];
      const r = allPlayersPick(g, picks);
      assert.equal(r.reveal.game, game);
      assert.equal(r.reveal.results.length, picks.length);
      return r;
    };

    assert.equal(isPartyMinigame('dice_battle'), false);
    const battle = run('dice_battle', 'ダイスバトル', { action: 'pick', value: 'rush' });
    assert.ok(battle.reveal.results[0].outcome.youTotal >= 2);
    assert.ok(battle.reveal.shared.foeTotal >= 2);

    const race = run('horse_race', 'ミニ競馬', { action: 'pick', value: 1 }, { action: 'pick', value: 2 });
    assert.ok(race.reveal.results[0].outcome.place >= 1 && race.reveal.results[0].outcome.place <= 4);
    assert.equal(race.reveal.shared.order.length, 4);

    const rps = run('rps_duel', 'じゃんけん勝負', { action: 'pick', value: 'rock' });
    assert.ok(['rock', 'paper', 'scissors'].includes(rps.reveal.shared.foe));

    const roulette = run('roulette', 'ルーレット', { action: 'pick', value: 'red' }, { action: 'pick', value: 'black' });
    assert.ok(roulette.reveal.shared.spin >= 0 && roulette.reveal.shared.spin <= 36);
    assert.ok(['red', 'black', 'green'].includes(roulette.reveal.shared.color));

    const heist = run('heist', '金庫破り', { action: 'pick', value: 'normal' });
    assert.equal(typeof heist.reveal.outcome.success, 'boolean');

    const balloon = run('balloon_dash', 'バルーンチャレンジ', { action: 'pick', value: 5 });
    assert.equal(balloon.reveal.outcome.pumps, 5);
    assert.ok(balloon.reveal.outcome.popAt >= 2);
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

  it('slash_rival_shops lowers rival shop values; slash_own_shops hurts own shops', () => {
    const rivalId = EVENT_CATALOG.findIndex((e) => e.effect === 'slash_rival_shops');
    const ownId = EVENT_CATALOG.findIndex((e) => e.effect === 'slash_own_shops');
    assert.ok(rivalId >= 0 && ownId >= 0);
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 201,
      cash: 3000,
    });
    const shops = g.map.filter((n) => n.type === 'shop');
    const rivalShop = shops[0];
    const ownShop = shops[1];
    rivalShop.owner = 1;
    rivalShop.extraInvest = 120;
    rivalShop.price = rivalShop.basePrice + 120;
    ownShop.owner = 0;
    ownShop.extraInvest = 100;
    ownShop.price = ownShop.basePrice + 100;

    const cell = g.sharedEventTable.cells[0];
    cell.eventId = rivalId + 1;
    cell.scratched = false;
    const beforeRival = rivalShop.price;
    const r1 = scratchCell(g, g.players[0], 0);
    assert.equal(r1.ok, true);
    assert.ok(rivalShop.price < beforeRival, 'rival shop should drop');

    const cell2 = g.sharedEventTable.cells[1];
    cell2.eventId = ownId + 1;
    cell2.scratched = false;
    const beforeOwn = ownShop.price;
    const r2 = scratchCell(g, g.players[0], 1);
    assert.equal(r2.ok, true);
    assert.ok(ownShop.price < beforeOwn, 'own shop should drop');
  });

  it('takeover_coupon grants 3× or 4× five-buy rights', () => {
    const three = EVENT_CATALOG.find((e) => e.effect === 'takeover_coupon' && e.multi === 3);
    const four = EVENT_CATALOG.find((e) => e.effect === 'takeover_coupon' && e.multi === 4);
    assert.ok(three && four);
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 202,
      cash: 3000,
    });
    const p = g.players[0];
    const c3 = g.sharedEventTable.cells[0];
    c3.eventId = three.id;
    c3.scratched = false;
    scratchCell(g, p, 0);
    assert.equal(p.flags.takeoverMulti, 3);
    assert.equal(p.flags.fiveBuyCoupon, true);

    p.flags.takeoverMulti = null;
    p.flags.fiveBuyCoupon = false;
    const c4 = g.sharedEventTable.cells[1];
    c4.eventId = four.id;
    c4.scratched = false;
    scratchCell(g, p, 1);
    assert.equal(p.flags.takeoverMulti, 4);
  });

  it('any_shop_buy opens a pick-to-seize pending at 6×', () => {
    const idx = EVENT_CATALOG.findIndex((e) => e.effect === 'any_shop_buy');
    assert.ok(idx >= 0);
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 203,
      cash: 20000,
    });
    const target = g.map.find((n) => n.type === 'shop');
    target.owner = 1;
    target.extraInvest = 0;
    target.price = target.basePrice;
    g.phase = 'await_choice';
    g.pending = { type: 'scratch', playerId: 0, openIds: [0] };
    const cell = g.sharedEventTable.cells[0];
    cell.eventId = idx + 1;
    cell.scratched = false;
    const scratched = applyChoice(g, { action: 'scratch', cellId: 0 });
    assert.equal(scratched.ok, true);
    assert.equal(scratched.anyShopBuy, true);
    assert.equal(g.pending?.type, 'any_shop_buy');
    assert.equal(g.pending.multi, 6);
    const price = target.price * 6;
    const bought = applyChoice(g, { action: 'buy', shopId: target.id });
    assert.equal(bought.ok, true);
    assert.equal(target.owner, 0);
    assert.ok(g.players[0].cash <= 20000 - price + 1);
  });

  it('force_sell_shop requires selling one owned shop', () => {
    const idx = EVENT_CATALOG.findIndex((e) => e.effect === 'force_sell_shop');
    assert.ok(idx >= 0);
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 204,
      cash: 3000,
    });
    const shop = g.map.find((n) => n.type === 'shop');
    shop.owner = 0;
    shop.extraInvest = 0;
    shop.price = shop.basePrice;
    const cashBefore = g.players[0].cash;
    g.phase = 'await_choice';
    g.pending = { type: 'scratch', playerId: 0, openIds: [0] };
    const cell = g.sharedEventTable.cells[0];
    cell.eventId = idx + 1;
    cell.scratched = false;
    const scratched = applyChoice(g, { action: 'scratch', cellId: 0 });
    assert.equal(scratched.ok, true);
    assert.equal(scratched.forceSell, true);
    assert.equal(g.pending?.type, 'force_sell_shop');
    const sold = applyChoice(g, { action: 'sell', shopId: shop.id });
    assert.equal(sold.ok, true);
    assert.equal(shop.owner, -1);
    assert.ok(g.players[0].cash >= cashBefore + Math.floor(shop.basePrice * 0.5) - 1);
  });

  it('scratch paints cell with opener player id (not group-color index)', () => {
    const g = createGame({
      players: [
        { name: 'A', color: PLAYER_COLORS[0] },
        { name: 'B', color: PLAYER_COLORS[5] },
      ],
      seed: 55,
      cash: 1500,
    });
    const cell = g.sharedEventTable.cells[3];
    cell.color = 3;
    cell.group = 3;
    cell.scratched = false;
    const r = scratchCell(g, g.players[1], 3);
    assert.equal(r.ok, true);
    assert.equal(cell.scratchedBy, 1);
    assert.equal(cell.color, g.players[1].id);
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
    // 先頭行 0,1 を opener 色で先に開ける（イベント効果は無視して状態だけ）
    for (const i of [0, 1]) {
      table.cells[i].scratched = true;
      table.cells[i].scratchedBy = who.id;
      table.cells[i].color = who.id;
      table.cells[i].group = who.id;
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
    assert.equal(m.beneficiaryId, who.id);
    assert.match(r.messages.join(' '), /そろい×3/);
  });

  it('scratch match pays the opener, not the group-color seat index', () => {
    // 旧バグ: cell.color を 0〜3 のグループ色にし、p.id === color で受取先を決めていた
    const g = createGame({
      players: [
        { name: 'Host', color: PLAYER_COLORS[4] },
        { name: 'Guest', color: PLAYER_COLORS[5] },
      ],
      seed: 17,
      cash: 1000,
    });
    const table = g.sharedEventTable;
    const guest = g.players[1];
    for (const i of [0, 1]) {
      table.cells[i].scratched = true;
      table.cells[i].scratchedBy = guest.id;
      table.cells[i].color = guest.id;
      table.cells[i].group = guest.id;
    }
    const rollAgainId = EVENT_CATALOG.findIndex((e) => e.effect === 'extra_roll') + 1;
    table.cells[2].eventId = rollAgainId > 0 ? rollAgainId : 1;
    const beforeHost = g.players[0].cash;
    const beforeGuest = guest.cash;
    const r = scratchCell(g, guest, 2);
    assert.equal(r.ok, true);
    assert.ok(r.matchBonus >= 150);
    assert.equal(r.matches[0].beneficiaryId, guest.id);
    assert.equal(guest.cash, beforeGuest + r.matchBonus);
    assert.equal(g.players[0].cash, beforeHost);
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
      table.cells[i].color = who.id;
      table.cells[i].group = who.id;
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
      table.cells[i].color = who.id;
      table.cells[i].group = who.id;
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

  it('scratch main diagonal match still works', () => {
    const g = createGame({
      players: [{ name: 'A', color: PLAYER_COLORS[0] }, { name: 'B', color: PLAYER_COLORS[1] }],
      seed: 23,
      cash: 2000,
    });
    const table = g.sharedEventTable;
    const size = table.size;
    const who = g.players[0];
    const rollAgainId = EVENT_CATALOG.findIndex((e) => e.effect === 'extra_roll') + 1;
    const ids = [0, size + 1, 2 * size + 2]; // (0,0)(1,1)(2,2)
    for (const i of ids.slice(0, 2)) {
      table.cells[i].scratched = true;
      table.cells[i].scratchedBy = who.id;
      table.cells[i].color = who.id;
      table.cells[i].group = who.id;
    }
    table.cells[ids[2]].eventId = rollAgainId;
    const r = scratchCell(g, who, ids[2]);
    assert.equal(r.ok, true);
    const m = r.matches.find((x) => x.lineKey === 'd0_0');
    assert.ok(m, 'main diagonal match');
    assert.equal(m.count, 3);
  });

  it('scratch diagonal match works off the main board diagonal', () => {
    const g = createGame({
      players: [{ name: 'A', color: PLAYER_COLORS[0] }, { name: 'B', color: PLAYER_COLORS[1] }],
      seed: 17,
      cash: 2000,
    });
    const table = g.sharedEventTable;
    const size = table.size;
    const who = g.players[0];
    const rollAgainId = EVENT_CATALOG.findIndex((e) => e.effect === 'extra_roll') + 1;
    // 本対角から外れた ↘ (0,1)(1,2)(2,3)
    const a = 0 * size + 1;
    const b = 1 * size + 2;
    const c = 2 * size + 3;
    for (const i of [a, b]) {
      table.cells[i].scratched = true;
      table.cells[i].scratchedBy = who.id;
      table.cells[i].color = who.id;
      table.cells[i].group = who.id;
    }
    table.cells[c].eventId = rollAgainId;
    const before = who.cash;
    const r = scratchCell(g, who, c);
    assert.equal(r.ok, true);
    const m = r.matches.find((x) => String(x.lineKey).startsWith('d0_'));
    assert.ok(m, 'off-main diagonal ↘ match');
    assert.equal(m.count, 3);
    assert.deepEqual(m.cellIds.slice().sort((x, y) => x - y), [a, b, c]);
    assert.ok(who.cash >= before + 3 * MATCH_BONUS_PER);
  });

  it('scratch anti-diagonal match works off the main anti-diagonal', () => {
    const g = createGame({
      players: [{ name: 'A', color: PLAYER_COLORS[0] }, { name: 'B', color: PLAYER_COLORS[1] }],
      seed: 19,
      cash: 2000,
    });
    const table = g.sharedEventTable;
    const size = table.size;
    const who = g.players[0];
    const rollAgainId = EVENT_CATALOG.findIndex((e) => e.effect === 'extra_roll') + 1;
    // 本逆対角から外れた ↙ (0,2)(1,1)(2,0)
    const a = 0 * size + 2;
    const b = 1 * size + 1;
    const c = 2 * size + 0;
    for (const i of [a, b]) {
      table.cells[i].scratched = true;
      table.cells[i].scratchedBy = who.id;
      table.cells[i].color = who.id;
      table.cells[i].group = who.id;
    }
    table.cells[c].eventId = rollAgainId;
    const r = scratchCell(g, who, c);
    assert.equal(r.ok, true);
    const m = r.matches.find((x) => String(x.lineKey).startsWith('d1_'));
    assert.ok(m, 'off-main anti-diagonal ↙ match');
    assert.equal(m.count, 3);
    assert.deepEqual(m.cellIds.slice().sort((x, y) => x - y), [a, b, c].sort((x, y) => x - y));
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

  it('cpuNoise is deterministic for the same seed/turn/player', () => {
    const g = createGame({
      players: [{ name: 'H' }, { name: 'CPU', isCPU: true, personality: 'tycoon' }],
      seed: 777,
    });
    const p = g.players[1];
    const a = cpuNoise(g, p, 9);
    const b = cpuNoise(g, p, 9);
    assert.equal(a, b);
    assert.notEqual(cpuNoise(g, p, 9), cpuNoise(g, p, 10));
  });

  it('CPU sticks to focus areas once chosen', () => {
    const g = createGame({
      players: [{ name: 'H' }, { name: 'CPU', isCPU: true, personality: 'tycoon' }],
      seed: 88,
      cash: 5000,
    });
    const p = g.players[1];
    const areas = Object.keys(g.areas).map(Number);
    const a0 = areas[0];
    const a1 = areas[1] ?? areas[0];
    for (const sq of g.map.filter((s) => s.type === 'shop' && s.area === a0).slice(0, 2)) {
      sq.owner = 1;
    }
    const first = cpuFocusAreas(g, p);
    assert.ok(first.includes(a0), 'owned area becomes focus');
    g.turn = (g.turn || 1) + 5;
    const second = cpuFocusAreas(g, p);
    assert.deepEqual(second, first, 'focus stays sticky across turns');
    // 別エリアにほぼ独占を作ると注力を寄せる
    if (a1 !== a0) {
      const shops1 = g.map.filter((s) => s.type === 'shop' && s.area === a1);
      for (const sq of shops1.slice(0, Math.max(1, shops1.length - 1))) sq.owner = 1;
      const third = cpuFocusAreas(g, p);
      assert.ok(third.includes(a1) || third.includes(a0));
    }
  });

  it('CPU always buys the shop that completes a monopoly when affordable', () => {
    const g = createGame({
      players: [{ name: 'H' }, { name: 'CPU', isCPU: true, personality: 'tycoon' }],
      seed: 91,
      cash: 8000,
    });
    const p = g.players[1];
    const area = Number(Object.keys(g.areas)[0]);
    const shops = g.map.filter((s) => s.type === 'shop' && s.area === area);
    assert.ok(shops.length >= 2);
    for (const sq of shops.slice(0, -1)) sq.owner = 1;
    const last = shops[shops.length - 1];
    last.owner = -1;
    p.cash = Math.max(p.cash, last.price + cpuCashReserve(g, p) + 200);
    assert.equal(cpuShouldBuyShop(g, p, last), true);
    assert.equal(hasAreaMonopoly(g, 1, area), false);
  });

  it('CPU always five-buys to break an enemy monopoly when affordable', () => {
    const g = createGame({
      players: [{ name: 'H' }, { name: 'CPU', isCPU: true, personality: 'magnate' }],
      seed: 92,
      cash: 12000,
    });
    const p = g.players[1];
    const area = Number(Object.keys(g.areas)[0]);
    const shops = g.map.filter((s) => s.type === 'shop' && s.area === area);
    for (const sq of shops) sq.owner = 0;
    const target = shops[0];
    p.cash = Math.max(p.cash, target.price * 5 + cpuCashReserve(g, p) + 500);
    const pend = { shopId: target.id, price: target.price * 5, toll: calcToll(g, target) };
    assert.equal(hasAreaMonopoly(g, 0, area), true);
    assert.equal(cpuShouldFiveBuy(g, p, pend), true);
  });

  it('CPU skips shop buys when closing on the goal', () => {
    const g = createGame({
      players: [{ name: 'H' }, { name: 'CPU', isCPU: true, personality: 'tycoon' }],
      seed: 93,
      cash: 5000,
      goal: 10000,
    });
    const p = g.players[1];
    p.cash = 9600;
    const phase = cpuGamePhase(g, p);
    assert.equal(phase.closing, true);
    const vacant = g.map.find((s) => s.type === 'shop' && s.owner < 0);
    assert.ok(vacant);
    assert.equal(cpuShouldBuyShop(g, p, vacant), false);
  });

  it('CPU stock picks prefer focus / owned areas', () => {
    const g = createGame({
      players: [{ name: 'H' }, { name: 'CPU', isCPU: true, personality: 'broker' }],
      seed: 94,
      cash: 5000,
    });
    const p = g.players[1];
    const areas = Object.keys(g.areas).map(Number);
    const a0 = areas[0];
    for (const sq of g.map.filter((s) => s.type === 'shop' && s.area === a0).slice(0, 2)) {
      sq.owner = 1;
    }
    cpuFocusAreas(g, p);
    const picked = cpuPickStockArea(g, p);
    assert.equal(picked, a0);
  });

  it('CPU scratch prefers extending own color lines including diagonals', () => {
    const g = createGame({
      players: [{ name: 'H' }, { name: 'CPU', isCPU: true, personality: 'gambler' }],
      seed: 95,
    });
    const p = g.players[1];
    p.color = PLAYER_COLORS[1];
    const table = getSharedEventTable(g);
    const size = table.size;
    // 主対角に2マス自分色、次マスを狙わせる
    const a = 0;
    const b = size + 1;
    const c = 2 * (size + 1);
    for (const id of [a, b]) {
      table.cells[id].scratched = true;
      table.cells[id].color = 1;
    }
    for (let i = 0; i < table.cells.length; i++) {
      if (i !== a && i !== b && i !== c) {
        table.cells[i].scratched = true;
        table.cells[i].color = 0;
      } else if (i === c) {
        table.cells[i].scratched = false;
      }
    }
    const open = [c];
    // 他にも空マスを少し残す（ノイズ候補）
    const decoy = size * 2; // (2,0) — ラインが弱い
    if (decoy !== c) {
      table.cells[decoy].scratched = false;
      open.push(decoy);
    }
    const pick = cpuPickScratchCell(g, p, open);
    assert.equal(pick, c, 'should extend main diagonal');
  });

  it('previews stock price rise when buying 10+ shares (not sell drop)', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 112,
      cash: 50000,
    });
    const area = Number(Object.keys(g.areas)[0]);
    updateAreaStockPrices(g);
    const oldPrice = g.areas[area].stockPrice;
    const oldB = g.areas[area].B;

    const small = previewStockBuy(g, area, STOCK_BUY_BOOST_MIN - 1);
    assert.ok(small);
    assert.equal(small.rises, false);
    assert.equal(small.oldPrice, oldPrice);
    assert.equal(small.newPrice, oldPrice);
    assert.equal(small.cost, oldPrice * (STOCK_BUY_BOOST_MIN - 1));

    const big = previewStockBuy(g, area, STOCK_BUY_BOOST_MIN);
    assert.ok(big);
    assert.equal(big.rises, true);
    assert.equal(big.oldPrice, oldPrice);
    assert.equal(big.cost, oldPrice * STOCK_BUY_BOOST_MIN);
    const expectedB = Math.floor(oldB * STOCK_BUY_B_RATE);
    assert.ok(big.newPrice >= oldPrice);

    // 売却予想とは別物（大口買いでも drops ではない）
    const sellLike = previewStockSell(g, area, STOCK_BUY_BOOST_MIN);
    assert.equal(sellLike.drops, true);
    assert.notEqual(big.newPrice, sellLike.newPrice);

    g.phase = 'await_choice';
    g.pending = { type: 'stock', playerId: 0, bankVisit: true, maxBuys: 1 };
    g.players[0].cash = big.cost + 100;
    const before = g.areas[area].B;
    const bought = applyChoice(g, { action: 'buy', area, count: STOCK_BUY_BOOST_MIN });
    assert.equal(bought.ok, true);
    assert.equal(g.areas[area].B, expectedB);
    assert.equal(g.areas[area].B, Math.floor(before * STOCK_BUY_B_RATE));
    assert.equal(g.areas[area].stockPrice, big.newPrice);
  });

  it('previews stock price drop when selling 10+ shares in own turn', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 111,
      cash: 3000,
    });
    const area = Number(Object.keys(g.areas)[0]);
    g.players[0].stocks[area] = 40;
    updateAreaStockPrices(g);
    const oldPrice = g.areas[area].stockPrice;
    const oldB = g.areas[area].B;

    const small = previewStockSell(g, area, STOCK_SELL_PRESSURE_MIN - 1);
    assert.ok(small);
    assert.equal(small.drops, false);
    assert.equal(small.oldPrice, oldPrice);
    assert.equal(small.newPrice, oldPrice);
    assert.equal(small.proceeds, oldPrice * (STOCK_SELL_PRESSURE_MIN - 1));
    assert.equal(small.untilDrop, STOCK_SELL_PRESSURE_MIN);

    const big = previewStockSell(g, area, STOCK_SELL_PRESSURE_MIN);
    assert.ok(big);
    assert.equal(big.drops, true);
    assert.equal(big.dropCount, 1);
    assert.equal(big.oldPrice, oldPrice);
    assert.equal(big.proceeds, oldPrice * STOCK_SELL_PRESSURE_MIN);
    const expectedB = Math.max(100, Math.floor(oldB * STOCK_SELL_B_RATE));
    assert.ok(big.newPrice <= oldPrice);
    // 実売却後の株価と一致すること
    const sold = preTurnSell(g, 0, area, STOCK_SELL_PRESSURE_MIN);
    assert.equal(sold.ok, true);
    assert.equal(g.areas[area].B, expectedB);
    assert.equal(g.areas[area].stockPrice, big.newPrice);
    assert.equal(g.players[0].turnSellPressure[area], 0);
  });

  it('tracks per-player turn sell pressure and resets on next own turn', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 222,
      cash: 5000,
    });
    const area = Number(Object.keys(g.areas)[0]);
    g.players[0].stocks[area] = 40;
    g.players[1].stocks[area] = 40;
    updateAreaStockPrices(g);
    const B0 = g.areas[area].B;

    // 9枚売っても下落しない（今ターン累計9）
    assert.equal(preTurnSell(g, 0, area, 9).ok, true);
    assert.equal(g.players[0].turnSellPressure[area], 9);
    assert.equal(g.areas[area].B, B0);

    // 別プレイヤーの番では相手の累計は別枠（共有しない）→1枚売っても下落しない
    g.currentPlayerIdx = 1;
    resetTurnSellPressure(g.players[1]);
    g.phase = 'await_roll';
    const previewOther = previewStockSell(g, area, 1);
    assert.equal(previewOther.drops, false);
    assert.equal(previewOther.pressureBefore, 0);
    assert.equal(preTurnSell(g, 1, area, 1).ok, true);
    assert.equal(g.areas[area].B, B0);
    assert.equal(g.players[1].turnSellPressure[area], 1);
    // Aの累計は手番外でも残っているが、Bには効かない
    assert.equal(g.players[0].turnSellPressure[area], 9);

    // Aの番が巡ると累計リセット → 9枚売ってもまた下落なし
    g.currentPlayerIdx = 0;
    resetTurnSellPressure(g.players[0]);
    g.phase = 'await_roll';
    assert.equal(g.players[0].turnSellPressure[area], undefined);
    assert.equal(preTurnSell(g, 0, area, 9).ok, true);
    assert.equal(g.players[0].turnSellPressure[area], 9);
    assert.equal(g.areas[area].B, B0);

    // 同ターン内でさらに1枚 → 累計10で下落
    const preview = previewStockSell(g, area, 1);
    assert.equal(preview.drops, true);
    assert.equal(preview.pressureBefore, 9);
    assert.equal(preview.untilDrop, 1);
    assert.equal(preTurnSell(g, 0, area, 1).ok, true);
    const B1 = Math.max(100, Math.floor(B0 * STOCK_SELL_B_RATE));
    assert.equal(g.areas[area].B, B1);
    assert.equal(g.players[0].turnSellPressure[area], 0);

    // 20枚売却で2回分の圧
    const BBeforeBulk = g.areas[area].B;
    assert.equal(preTurnSell(g, 0, area, 20).ok, true);
    let expected = BBeforeBulk;
    expected = Math.max(100, Math.floor(expected * STOCK_SELL_B_RATE));
    expected = Math.max(100, Math.floor(expected * STOCK_SELL_B_RATE));
    assert.equal(g.areas[area].B, expected);
    assert.equal(g.players[0].turnSellPressure[area], 0);
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

  it('party minigame lets CPU participants pick while human is current player', () => {
    const g = createGame({
      players: [
        { name: 'H', isCPU: false },
        { name: 'C1', isCPU: true },
        { name: 'C2', isCPU: true },
      ],
      seed: 11,
    });
    g.phase = 'await_choice';
    g.currentPlayerIdx = 0;
    g.pending = {
      type: 'minigame',
      playerId: 0,
      starterId: 0,
      game: 'coin',
      label: 'コイン',
      participantIds: [0, 1, 2],
      picks: {},
      party: true,
    };
    assert.equal(applyChoice(g, { action: 'pick', value: 'heads' }).ok, true);
    assert.equal(g.pending?.playerId, 1);
    const first = cpuAct(g);
    assert.equal(first?.ok, true);
    assert.equal(first?.minigamePick, true);
    assert.equal(g.pending?.playerId, 2);
    const last = cpuAct(g);
    assert.equal(last?.ok, true);
    assert.equal(last?.minigame, true);
    assert.equal(g.pending, null);
  });

  it('kicking a party-minigame waiter continues with remaining players', () => {
    const g = createGame({
      players: [
        { name: 'H', isCPU: false },
        { name: 'G', isCPU: false },
        { name: 'C', isCPU: true },
      ],
      seed: 12,
    });
    g.phase = 'await_choice';
    g.currentPlayerIdx = 0;
    g.pending = {
      type: 'minigame',
      playerId: 1,
      starterId: 0,
      game: 'coin',
      label: 'コイン',
      participantIds: [0, 1, 2],
      picks: { 0: 'heads' },
      party: true,
    };
    const kicked = kickDisconnectedPlayer(g, 1);
    assert.equal(kicked.ok, true);
    assert.equal(g.players[1].bankrupt, true);
    assert.equal(g.pending?.type, 'minigame');
    assert.deepEqual(g.pending.participantIds, [0, 2]);
    assert.equal(g.pending.playerId, 2);
    assert.equal(g.phase, 'await_choice');
    assert.equal(g.currentPlayerIdx, 0);
  });

  it('shop trade propose accepts cashDelta from the choice payload', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 13,
    });
    const shopA = g.map.find((n) => n.type === 'shop');
    const shopB = g.map.filter((n) => n.type === 'shop')[1];
    shopA.owner = 0;
    shopB.owner = 1;
    g.players[0].cash = 5000;
    g.players[1].cash = 5000;
    g.phase = 'await_choice';
    g.currentPlayerIdx = 0;
    g.pending = {
      type: 'shop_trade_compose',
      playerId: 0,
      targetId: 1,
      giveShopIds: [shopA.id],
      takeShopIds: [shopB.id],
      cashDelta: 0,
    };
    const offered = applyChoice(g, { action: 'propose', cashDelta: 250 });
    assert.equal(offered.ok, true);
    assert.equal(g.pending?.type, 'shop_trade_offer');
    assert.equal(g.pending.cashDelta, 250);
  });

  it('rejects stock sell when holding zero shares (no phantom cash)', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 3,
    });
    const area = Number(Object.keys(g.areas)[0]);
    g.phase = 'await_roll';
    g.currentPlayerIdx = 0;
    g.players[0].stocks = {};
    g.players[0].cash = 2000;
    const before = g.players[0].cash;
    const sold = preTurnSell(g, 0, area, 5);
    assert.equal(sold.ok, false);
    assert.equal(sold.error, 'no_stock');
    assert.equal(g.players[0].cash, before);
    assert.equal(g.players[0].stocks[area], undefined);

    // 証券売却も同様
    g.phase = 'await_choice';
    g.pending = { type: 'stock', playerId: 0, bankVisit: false };
    const broker = applyChoice(g, { action: 'sell', area, count: 3 });
    assert.equal(broker.ok, false);
    assert.equal(broker.error, 'no_stock');
    assert.equal(g.players[0].cash, before);
  });

  it('rejects buying an already-owned shop via buy_shop', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 5,
    });
    const shop = g.map.find((n) => n.type === 'shop');
    shop.owner = 1;
    g.players[0].cash = shop.price + 5000;
    g.phase = 'await_choice';
    g.pending = { type: 'buy_shop', playerId: 0, shopId: shop.id, price: shop.price };
    const buy = applyChoice(g, { action: 'buy' });
    assert.equal(buy.ok, false);
    assert.equal(buy.error, 'bad_shop');
    assert.equal(shop.owner, 1);
  });

  it('fork double-click nextId does not skip buy_shop after landing', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B', isCPU: true }],
      seed: 42,
      mapId: 'central_cross',
      cash: 5000,
    });
    g.phase = 'moving';
    g.move = { stepsLeft: 1, path: [], passedBank: false, startPos: g.players[0].pos };
    const forked = advanceMove(g);
    assert.equal(forked.forked, true);
    const shopOpt = g.pending.options.find((o) => {
      const n = g.map.find((x) => x.id === o.id);
      return n?.type === 'shop' && n.owner < 0;
    });
    assert.ok(shopOpt, 'expected vacant shop fork option');
    const land = chooseFork(g, shopOpt.id);
    assert.equal(land.ok, true);
    assert.equal(g.phase, 'await_choice');
    assert.equal(g.pending?.type, 'buy_shop');

    // 分岐ボタンの二重送信（nextId のみ）が来ても見送りにしない
    const stale = applyChoice(g, { nextId: shopOpt.id });
    assert.equal(stale.ok, false);
    assert.equal(stale.error, 'bad_choice');
    assert.equal(g.phase, 'await_choice');
    assert.equal(g.pending?.type, 'buy_shop');

    const buy = applyChoice(g, { action: 'buy' });
    assert.equal(buy.ok, true);
    const shop = g.map.find((n) => n.id === shopOpt.id);
    assert.equal(shop.owner, 0);
  });

  it('explicit skip still dismisses buy_shop', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 7,
    });
    const shop = g.map.find((n) => n.type === 'shop' && n.owner < 0);
    g.phase = 'await_choice';
    g.pending = { type: 'buy_shop', playerId: 0, shopId: shop.id, price: shop.price };
    const skip = applyChoice(g, { action: 'skip' });
    assert.equal(skip.ok, true);
    assert.equal(shop.owner, -1);
    assert.equal(g.pending, null);
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
    assert.equal(recordNudgeStats(g, 0, 1), true);
    assert.equal(recordNudgeStats(g, 0, 2), true);
    assert.equal(recordNudgeStats(g, 1, 0), true);
    assert.equal(g.players[0].stats.nudgeSent, 2);
    assert.equal(g.players[0].stats.nudgeReceived, 1);
    assert.equal(g.players[1].stats.nudgeSent, 1);
    assert.equal(g.players[1].stats.nudgeReceived, 1);
    assert.equal(g.players[2].stats.nudgeReceived, 1);
    assert.equal(recordNudgeStats(g, 0, 0), false);
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
    assert.ok(titles.has('nudge_sender'));
    assert.equal(results.ranking.find((r) => r.id === 0)?.stats.nudgeSent, 2);
    assert.equal(results.ranking.find((r) => r.id === 0)?.stats.nudgeReceived, 1);

    // 欠けた stats でも ensure / build できる
    delete g.players[1].stats;
    ensureStats(g.players[1]);
    assert.equal(g.players[1].stats.rolls, 0);
    const again = buildGameResults(g);
    assert.equal(again.ranking.length, 3);

    const exported = formatGameResultsExport(results, {
      exportedAt: '2026-11-16T12:00:00.000Z',
      mapId: 'central_cross',
      mapName: '中央クロス',
      mode: 'local',
    });
    assert.equal(exported.schema, 'mkmk-street-results/v1');
    assert.equal(exported.winnerName, g.players[0].name);
    assert.equal(exported.mapId, 'central_cross');
    assert.equal(exported.ranking.length, 3);
    assert.ok(exported.awards.length >= 1);
    assert.ok(exported.worthHistory.length >= 1);

    const text = gameResultsExportToText(exported);
    assert.match(text, /MkMk Street 試合結果/);
    assert.match(text, /\[順位\]/);
    assert.match(text, /\[特賞\]/);
    assert.match(text, new RegExp(g.players[0].name));
    assert.match(text, /催促 2回→ \/ ←1回/);

    const csv = gameResultsExportToCsv(exported);
    assert.match(csv, /^rank,name,winner,/);
    assert.match(csv, /nudgeSent,nudgeReceived/);
    assert.ok(csv.split('\n').length >= 4);

    const fname = gameResultsExportFilename(exported, 'json');
    assert.match(fname, /^mkmk-street-central_cross-T12-/);
    assert.match(fname, /\.json$/);

    const roundTrip = parseGameResultsExport(JSON.stringify(exported));
    assert.equal(roundTrip.ok, true);
    assert.equal(roundTrip.payload.schema, GAME_RESULTS_SCHEMA);
    const viewed = resultsFromExportPayload(roundTrip.payload);
    assert.equal(viewed.winnerId, results.winnerId);
    assert.equal(viewed.ranking.length, results.ranking.length);
    assert.equal(viewed.ranking[0].assets.total, results.ranking[0].assets.total);
    assert.ok(viewed.maxTotal >= viewed.ranking[0].assets.total);
    assert.equal(viewed.meta.mapId, 'central_cross');

    const bad = parseGameResultsExport('{nope');
    assert.equal(bad.ok, false);
    const empty = parseGameResultsExport({ schema: GAME_RESULTS_SCHEMA, ranking: [] });
    assert.equal(empty.ok, false);
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

  it('supports multi-shop trades with default cash delta and accept/reject', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B', isCPU: true }],
      seed: 42,
    });
    const shops = g.map.filter((s) => s.type === 'shop');
    assert.ok(shops.length >= 4);
    const aShop1 = shops[0];
    const aShop2 = shops[1];
    const bShop1 = shops[2];
    const bShop2 = shops[3];
    aShop1.owner = 0;
    aShop2.owner = 0;
    bShop1.owner = 1;
    bShop2.owner = 1;
    aShop1.price = 200;
    aShop2.price = 100;
    bShop1.price = 250;
    bShop2.price = 150;
    g.players[0].cash = 5000;
    g.players[1].cash = 5000;
    g.phase = 'await_roll';
    g.currentPlayerIdx = 0;

    assert.equal(canOpenShopTrade(g, 0), true);
    const opened = openShopTradeCompose(g, 0);
    assert.equal(opened.ok, true);
    assert.equal(g.pending.type, 'shop_trade_compose');

    assert.equal(applyChoice(g, { action: 'set_target', targetId: 1 }).ok, true);
    assert.equal(applyChoice(g, { action: 'toggle_give', shopId: aShop1.id }).ok, true);
    assert.equal(applyChoice(g, { action: 'toggle_give', shopId: aShop2.id }).ok, true);
    assert.equal(applyChoice(g, { action: 'toggle_take', shopId: bShop1.id }).ok, true);
    assert.equal(applyChoice(g, { action: 'toggle_take', shopId: bShop2.id }).ok, true);

    const giveV = sumShopPrices(g, g.pending.giveShopIds);
    const takeV = sumShopPrices(g, g.pending.takeShopIds);
    assert.equal(g.pending.cashDelta, defaultShopTradeCashDelta(giveV, takeV));
    assert.equal(g.pending.cashDelta, 100); // 400 take - 300 give

    const proposed = applyChoice(g, { action: 'propose' });
    assert.equal(proposed.ok, true);
    assert.equal(g.pending.type, 'shop_trade_offer');
    assert.equal(g.pending.playerId, 1);

    // reject returns to await_roll without changing owners
    assert.equal(applyChoice(g, { action: 'reject' }).ok, true);
    assert.equal(g.phase, 'await_roll');
    assert.equal(aShop1.owner, 0);
    assert.equal(bShop1.owner, 1);

    // re-open and accept
    openShopTradeCompose(g, 0);
    applyChoice(g, { action: 'set_target', targetId: 1 });
    applyChoice(g, { action: 'toggle_give', shopId: aShop1.id });
    applyChoice(g, { action: 'toggle_take', shopId: bShop1.id });
    // give 200, take 250 → default +50
    assert.equal(g.pending.cashDelta, 50);
    applyChoice(g, { action: 'set_cash', cashDelta: 30 });
    assert.equal(applyChoice(g, { action: 'propose' }).ok, true);

    const cashA = g.players[0].cash;
    const cashB = g.players[1].cash;
    const accepted = applyChoice(g, { action: 'accept' });
    assert.equal(accepted.ok, true);
    assert.equal(aShop1.owner, 1);
    assert.equal(bShop1.owner, 0);
    assert.equal(g.players[0].cash, cashA - 30);
    assert.equal(g.players[1].cash, cashB + 30);
    assert.equal(g.phase, 'await_roll');
  });

  it('lets CPU accept or reject shop trades when it is the responder', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B', isCPU: true }],
      seed: 7,
    });
    const shops = g.map.filter((s) => s.type === 'shop');
    const aShop = shops[0];
    const bShop = shops[1];
    aShop.owner = 0;
    bShop.owner = 1;
    aShop.price = 500;
    bShop.price = 100;
    g.players[0].cash = 3000;
    g.players[1].cash = 3000;
    g.phase = 'await_choice';
    g.currentPlayerIdx = 0;
    g.pending = {
      type: 'shop_trade_offer',
      playerId: 1,
      fromId: 0,
      giveShopIds: [aShop.id],
      takeShopIds: [bShop.id],
      cashDelta: 0,
    };
    // A gives 500, takes 100 → great for B
    assert.equal(cpuShouldAcceptShopTrade(g, g.players[1], g.pending), true);
    const result = cpuAct(g);
    assert.equal(result?.ok, true);
    assert.equal(aShop.owner, 1);
    assert.equal(bShop.owner, 0);
  });

  it('allows counter-offer with edited cash on shop trade', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 11,
    });
    const shops = g.map.filter((s) => s.type === 'shop');
    const aShop = shops[0];
    const bShop = shops[1];
    aShop.owner = 0;
    bShop.owner = 1;
    aShop.price = 200;
    bShop.price = 300;
    g.players[0].cash = 4000;
    g.players[1].cash = 4000;
    g.phase = 'await_roll';
    g.currentPlayerIdx = 0;

    openShopTradeCompose(g, 0);
    applyChoice(g, { action: 'set_target', targetId: 1 });
    applyChoice(g, { action: 'toggle_give', shopId: aShop.id });
    applyChoice(g, { action: 'toggle_take', shopId: bShop.id });
    applyChoice(g, { action: 'set_cash', cashDelta: 40 });
    assert.equal(applyChoice(g, { action: 'propose' }).ok, true);
    assert.equal(g.pending.type, 'shop_trade_offer');
    assert.equal(g.pending.playerId, 1);
    assert.equal(g.pending.cashDelta, 40);
    assert.equal(g.pending.counterCashDelta, 40);

    // B edits draft cash then counters: wants A to pay 80 instead
    assert.equal(applyChoice(g, { action: 'set_cash', cashDelta: 80 }).ok, true);
    assert.equal(g.pending.cashDelta, 40, 'original offer cash stays for accept');
    assert.equal(g.pending.counterCashDelta, 80);
    const countered = applyChoice(g, { action: 'counter', cashDelta: 80 });
    assert.equal(countered.ok, true);
    assert.equal(g.pending.type, 'shop_trade_offer');
    assert.equal(g.pending.playerId, 0);
    assert.equal(g.pending.fromId, 1);
    assert.deepEqual(g.pending.giveShopIds, [bShop.id]);
    assert.deepEqual(g.pending.takeShopIds, [aShop.id]);
    assert.equal(g.pending.cashDelta, -80);

    const cashA = g.players[0].cash;
    const cashB = g.players[1].cash;
    assert.equal(applyChoice(g, { action: 'accept' }).ok, true);
    assert.equal(aShop.owner, 1);
    assert.equal(bShop.owner, 0);
    // cashDelta -80 with from=B to=A → A pays B 80
    assert.equal(g.players[0].cash, cashA - 80);
    assert.equal(g.players[1].cash, cashB + 80);
  });

  it('executeShopTrade requires at least one shop each side', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 3,
    });
    const shops = g.map.filter((s) => s.type === 'shop');
    shops[0].owner = 0;
    shops[1].owner = 1;
    const bad = executeShopTrade(g, {
      fromId: 0,
      toId: 1,
      giveShopIds: [shops[0].id],
      takeShopIds: [],
      cashDelta: 0,
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'need_shops');
  });
});
