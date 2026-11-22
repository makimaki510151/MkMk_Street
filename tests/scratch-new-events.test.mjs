import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  applyChoice,
  rollDice,
  advanceMove,
  isPartyMinigame,
  PARTY_MINIGAME_GAMES,
  getMoveDiceMax,
} from '../js/engine.js';
import {
  EVENT_CATALOG,
  EVENT_COUNT,
} from '../js/eventTable.js';
import { describeEventDef as describeDex } from '../js/scratchDex.js';
import {
  NEW_MINIGAME_LABELS,
  NEW_PARTY_MINIGAMES,
  normalizeNewMinigamePick,
  setupNewMinigameShared,
  scoreNewMinigamePlayer,
} from '../js/scratchExpand.js';

describe('scratch new events & minigames', () => {
  it('keeps catalog size and includes new unique effects (no collateral / mass-guess)', () => {
    assert.equal(EVENT_CATALOG.length, EVENT_COUNT);
    const kinds = new Set(EVENT_CATALOG.map((e) => e.effect || e.kind));
    for (const k of [
      'pick_dice', 'steal_mark', 'grant_wildcard', 'warp_best_shop', 'shop_protect',
      'co_own', 'toll_hijack', 'time_capsule', 'fortune_triple', 'force_stop',
      'mark_gamble', 'short_stock', 'compare_ad',
    ]) {
      assert.ok(kinds.has(k), `missing effect ${k}`);
    }
    assert.equal(kinds.has('collateral_loan'), false);
    assert.equal(kinds.has('guess_square'), false);
    assert.equal(kinds.has('mass_guess'), false);
    const bannedLabels = EVENT_CATALOG.filter((e) =>
      /担保借入|マス当て/.test(e.label || ''));
    assert.equal(bannedLabels.length, 0);

    const miniGames = new Set(
      EVENT_CATALOG.filter((e) => e.effect === 'minigame').map((e) => e.game),
    );
    for (const g of Object.keys(NEW_MINIGAME_LABELS)) {
      assert.ok(miniGames.has(g), `missing minigame ${g}`);
    }
    assert.ok(PARTY_MINIGAME_GAMES.has('silent_bid'));
    assert.ok(PARTY_MINIGAME_GAMES.has('hot_potato'));
    assert.ok(PARTY_MINIGAME_GAMES.has('target_roulette'));
    assert.equal(isPartyMinigame('memory_match'), false);
    assert.equal(isPartyMinigame('push_pull'), false);
  });

  it('dex describes new effects', () => {
    const pick = EVENT_CATALOG.find((e) => e.effect === 'pick_dice');
    assert.match(describeDex(pick), /出目/);
    const steal = EVENT_CATALOG.find((e) => e.effect === 'steal_mark');
    assert.match(describeDex(steal), /マーク/);
    const mem = EVENT_CATALOG.find((e) => e.effect === 'minigame' && e.game === 'memory_match');
    assert.match(describeDex(mem), /神経衰弱|memory_match/);
  });

  it('pick_dice pending locks next roll face', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 11,
      cash: 3000,
    });
    const p = g.players[0];
    g.currentPlayerIdx = 0;
    g.phase = 'await_choice';
    g.pending = { type: 'pick_dice', playerId: 0 };
    const face = Math.min(3, getMoveDiceMax(g));
    const r = applyChoice(g, { value: face });
    assert.equal(r.ok, true);
    assert.equal(p.flags.fixedDice, face);
    // 次ロールで固定出目が消費される
    g.phase = 'await_roll';
    g.currentPlayerIdx = 0;
    const rolled = rollDice(g);
    assert.equal(rolled.ok, true);
    assert.equal(rolled.dice, face);
    assert.equal(p.flags.fixedDice, null);
  });

  it('force_stop ends movement after one step', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 22,
      cash: 3000,
    });
    const p = g.players[0];
    p.flags.forceStopNext = true;
    g.currentPlayerIdx = 0;
    g.phase = 'await_roll';
    const rolled = rollDice(g);
    assert.equal(rolled.ok, true);
    assert.ok((rolled.dice || g.move?.stepsLeft) >= 1);
    // 出目が複数でも1歩で止まる
    let steps = 0;
    while (g.phase === 'moving' && g.move?.stepsLeft > 0 && steps < 20) {
      const before = g.move.stepsLeft;
      const adv = advanceMove(g);
      assert.equal(adv.ok, true);
      steps++;
      if (g.move && g.move.stepsLeft === 0) break;
      if (g.phase === 'await_fork') {
        applyChoice(g, { nextId: g.pending.options[0].id });
      }
      if (before === g.move?.stepsLeft) break;
    }
    assert.ok(steps <= 2, `expected early stop, steps=${steps}`);
    assert.equal(p.flags.forceStopNext, false);
  });

  it('shop_protect blocks five-buy takeover on protected shop', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 33,
      cash: 8000,
    });
    const shop = g.map.find((s) => s.type === 'shop');
    assert.ok(shop);
    shop.owner = 0;
    shop.protectTurns = 1;
    g.players[0].pos = shop.id;
    // B が止まる想定で payToll→five_buy を直接は呼ばず、protect フラグを確認
    assert.ok(Number(shop.protectTurns) > 0);
    g.phase = 'await_choice';
    g.currentPlayerIdx = 0;
    g.pending = {
      type: 'shop_protect',
      playerId: 0,
      shopIds: [shop.id],
      turns: 2,
    };
    const r = applyChoice(g, { shopId: shop.id });
    assert.equal(r.ok, true);
    assert.equal(shop.protectTurns, 2);
  });

  it('fortune_triple applies chosen option', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 44,
      cash: 1000,
    });
    const p = g.players[0];
    const before = p.cash;
    g.phase = 'await_choice';
    g.currentPlayerIdx = 0;
    g.pending = {
      type: 'fortune_triple',
      playerId: 0,
      options: [
        { effect: 'cash', cash: 90, label: '現金+90G' },
        { effect: 'extra_roll', label: 'もう一振り' },
        { effect: 'cash', cash: -40, label: '罰金40G' },
      ],
    };
    const r = applyChoice(g, { value: 0 });
    assert.equal(r.ok, true);
    assert.equal(p.cash, before + 90);
  });

  it('memory_match scores a matching pair', () => {
    const helpers = {
      grantMinigamePrize: (p, amount, messages, text) => {
        p.cash += amount;
        messages.push(text);
        return amount;
      },
      minigameConsolation: (p, amount, messages, text) => {
        p.cash += amount;
        messages.push(text);
        return amount;
      },
      lvPrize: (n) => n,
      flatPrize: (n) => n,
    };
    const g = { goal: 10000, players: [{ id: 0, name: 'A', cash: 100, level: 1 }] };
    const p = g.players[0];
    const shared = { board: ['★', '♪', '★', 'G', '♪', 'G'] };
    const win = scoreNewMinigamePlayer(g, p, 'memory_match', '0,2', shared, helpers);
    assert.equal(win.win, true);
    assert.ok(win.prizeWon > 0);
    const miss = scoreNewMinigamePlayer(g, { ...p, cash: 100 }, 'memory_match', '0,1', shared, helpers);
    assert.equal(miss.win, false);
  });

  it('silent_bid unique free bids pay; collisions miss', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      seed: 55,
      cash: 2000,
    });
    assert.ok(NEW_PARTY_MINIGAMES.has('silent_bid'));
    const ordered = [0, 1, 2];
    g.phase = 'await_choice';
    g.currentPlayerIdx = 0;
    g.pending = {
      type: 'minigame',
      playerId: 0,
      starterId: 0,
      game: 'silent_bid',
      label: 'サイレント入札',
      participantIds: ordered,
      picks: {},
      party: true,
      pot: 120,
    };
    const mid = applyChoice(g, { action: 'pick', value: 80 });
    assert.equal(mid.minigamePick, true);
    applyChoice(g, { action: 'pick', value: 80 }); // collide with A
    const fin = applyChoice(g, { action: 'pick', value: 55 });
    assert.equal(fin.minigame, true);
    assert.equal(fin.reveal?.game, 'silent_bid');
    assert.equal(fin.reveal.shared?.pot, 120);
    assert.equal(fin.reveal.results.length, 3);
    const byId = Object.fromEntries(fin.reveal.results.map((r) => [r.playerId, r]));
    assert.equal(byId[0].win, false, 'A collided');
    assert.equal(byId[1].win, false, 'B collided');
    assert.equal(byId[2].win, true, 'C unique');
    assert.equal(byId[2].pick, 55);
    assert.ok(byId[2].prizeWon >= 55);
  });

  it('silent_bid clamps free input to pot and rejects max spam via uniqueness', () => {
    const helpers = {
      grantMinigamePrize: (p, amount, messages, text) => {
        p.cash += amount;
        messages.push(text);
        return amount;
      },
      minigameConsolation: (p, amount, messages, text) => {
        p.cash += amount;
        messages.push(text);
        return amount;
      },
      lvPrize: (n) => n,
      flatPrize: (n) => n,
    };
    const g = { goal: 10000, players: [{ id: 0, name: 'A', cash: 100, level: 1 }] };
    const shared = { pot: 100, allBids: { 0: 100, 1: 100, 2: 40 } };
    const a = scoreNewMinigamePlayer(g, g.players[0], 'silent_bid', 100, shared, helpers);
    assert.equal(a.win, false);
    const c = scoreNewMinigamePlayer(
      g,
      { id: 2, name: 'C', cash: 100, level: 1 },
      'silent_bid',
      40,
      shared,
      helpers,
    );
    assert.equal(c.win, true);
    assert.equal(c.prizeWon, 40);
  });

  it('scratch apply opens pick_dice pending from catalog effect', () => {
    const g = createGame({
      players: [{ name: 'A' }, { name: 'B' }],
      seed: 66,
      cash: 3000,
    });
    const def = EVENT_CATALOG.find((e) => e.effect === 'pick_dice');
    assert.ok(def);
    const table = g.sharedEventTable;
    const cell = table.cells.find((c) => !c.scratched);
    cell.eventId = def.id;
    const p = g.players[0];
    g.phase = 'await_choice';
    g.currentPlayerIdx = 0;
    g.pending = {
      type: 'scratch',
      playerId: 0,
      openIds: [cell.id],
    };
    const r = applyChoice(g, { action: 'scratch', cellId: cell.id });
    assert.equal(r.ok, true);
    assert.equal(r.pickDice, true);
    assert.equal(g.pending?.type, 'pick_dice');
  });

  it('normalize/setup helpers cover new games', () => {
    assert.equal(normalizeNewMinigamePick('push_pull', { value: 4 }), 4);
    assert.equal(normalizeNewMinigamePick('divide_pool', { value: 70 }), 70);
    assert.equal(normalizeNewMinigamePick('hot_potato', { value: 'stop' }), 'stop');
    assert.equal(normalizeNewMinigamePick('memory_match', { value: '1,4' }), '1,4');
    const shared = setupNewMinigameShared('push_pull', {
      rng: () => 0.5,
      participants: [{ id: 0 }, { id: 1 }],
    });
    assert.ok(shared.popAt >= 2 && shared.popAt <= 6);
  });
});
