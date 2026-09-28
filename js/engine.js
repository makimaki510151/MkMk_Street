/** MkMk Street — ゲームエンジン（純ロジック / ホスト権威） */

import { buildBoard, SUIT_LABELS, DEFAULT_GOAL, DEFAULT_CASH } from './board.js';

export const PLAYER_COLORS = ['#e85d75', '#3d8bfd', '#f0a202', '#20c997'];
export const PLAYER_NAMES_DEFAULT = ['あか', 'あお', 'きいろ', 'みどり'];

const TOLL_MULTI = [1, 1, 1.25, 2.5, 5, 6, 6.75];
const MAX_INVEST_RATE = [0, 0.5, 1, 3, 9, 11, 13];

const CHANCE_EVENTS = [
  { id: 'bonus', label: '臨時ボーナス', apply: (g, p) => { const n = 200 + p.level * 50; p.cash += n; return `+${n}G` } },
  { id: 'salary', label: '給料日っぽい日', apply: (g, p) => { const n = Math.floor(getLevelBonus(g, p) * 0.5); p.cash += n; return `賞金の半分 +${n}G` } },
  { id: 'tax', label: '税金', apply: (g, p) => { const n = Math.min(p.cash, 150 + p.level * 30); p.cash -= n; return `-${n}G` } },
  { id: 'warp_bank', label: '銀行へワープ', apply: (g, p) => { p.pos = g.startId; return '銀行へ移動' } },
  { id: 'stock_gift', label: '株のおすそ分け', apply: (g, p) => {
    const areas = Object.keys(g.areas).map(Number);
    const a = areas[Math.floor(Math.random() * areas.length)];
    p.stocks[a] = (p.stocks[a] || 0) + 10;
    return `A${a}株 +10`
  }},
  { id: 'invest_boost', label: '増資クーポン', apply: (g, p) => { p.flags.investCoupon = true; return '次の自分店増資が半額' } },
];

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGame({ players, goal = DEFAULT_GOAL, seed = Date.now(), cash } = {}) {
  const board = buildBoard();
  const initialCash = cash ?? board.initialCash ?? DEFAULT_CASH;
  const rng = mulberry32(seed);

  const plist = players.map((pl, i) => ({
    id: i,
    peerId: pl.peerId || null,
    name: pl.name || PLAYER_NAMES_DEFAULT[i] || `P${i + 1}`,
    color: pl.color || PLAYER_COLORS[i % PLAYER_COLORS.length],
    isCPU: !!pl.isCPU,
    cash: initialCash,
    pos: board.startId,
    marks: [false, false, false, false],
    level: 1,
    stocks: {},
    lucky: false,
    resting: false,
    bankrupt: false,
    flags: {},
  }));

  return {
    map: board.nodes,
    areas: board.areas,
    cols: board.cols,
    rows: board.rows,
    startId: board.startId,
    goal,
    players: plist,
    currentPlayerIdx: 0,
    phase: 'await_roll', // await_roll | moving | resolve | await_choice | gameover
    pending: null,
    dice: null,
    logs: [{ text: 'ゲーム開始！目標資産に到達して銀行へ戻ろう', kind: 'system' }],
    winnerId: null,
    turn: 1,
    _seed: seed,
    _rngCount: 0,
    _rngState: seed,
  };
}

function rngNext(g) {
  const rng = mulberry32(g._seed);
  for (let i = 0; i < g._rngCount; i++) rng();
  g._rngCount++;
  return rng();
}

export function getNode(g, id) {
  return g.map.find((n) => n.id === id);
}

export function getAreaShops(g, area) {
  return g.map.filter((s) => s.type === 'shop' && s.area === area);
}

export function getPlayerAreaCount(g, pid, area) {
  return g.map.filter((s) => s.type === 'shop' && s.area === area && s.owner === pid).length;
}

export function getTollMulti(cnt) {
  return TOLL_MULTI[Math.min(cnt, 6)] || 1;
}

export function getMaxExtraInvest(g, sq) {
  if (sq.owner < 0) return Math.floor(sq.basePrice * 0.5);
  const cnt = getPlayerAreaCount(g, sq.owner, sq.area);
  return Math.floor(sq.basePrice * (MAX_INVEST_RATE[Math.min(cnt, 6)] || 0.5));
}

export function getRemainingInvest(g, sq) {
  return Math.max(0, getMaxExtraInvest(g, sq) - (sq.extraInvest || 0));
}

export function calcToll(g, sq) {
  if (!sq || sq.owner < 0) return 0;
  const cnt = getPlayerAreaCount(g, sq.owner, sq.area);
  return Math.floor(sq.baseToll * (1 + (sq.extraInvest / sq.basePrice) * 2) * getTollMulti(cnt));
}

export function updateAreaStockPrices(g) {
  const changes = [];
  for (const a of Object.keys(g.areas).map(Number)) {
    const shops = getAreaShops(g, a);
    if (!shops.length) continue;
    const avg = shops.reduce((s, sq) => s + sq.price, 0) / shops.length;
    const oldPrice = g.areas[a].stockPrice || 0;
    const newPrice = Math.max(1, Math.floor((avg / 65536) * g.areas[a].B));
    if (oldPrice !== newPrice) {
      changes.push({ area: a, oldPrice, newPrice, diff: newPrice - oldPrice });
    }
    g.areas[a].stockPrice = newPrice;
  }
  return changes;
}

export function getPlayerAssets(g, p) {
  let stockAsset = 0;
  for (const [a, cnt] of Object.entries(p.stocks || {})) {
    stockAsset += (g.areas[Number(a)]?.stockPrice || 0) * cnt;
  }
  const shopAsset = g.map
    .filter((s) => s.type === 'shop' && s.owner === p.id)
    .reduce((s, sq) => s + sq.price, 0);
  return { cash: p.cash, stockAsset, shopAsset, total: p.cash + stockAsset + shopAsset };
}

export function getLevelBonus(g, p) {
  const base = 400 + 150 * p.level;
  const shopTotal = g.map
    .filter((s) => s.type === 'shop' && s.owner === p.id)
    .reduce((s, sq) => s + sq.price, 0);
  return Math.floor(base + shopTotal * 0.1);
}

export function hasFullMarks(p) {
  return p.marks.every(Boolean);
}

function addLog(g, text, kind = 'info') {
  g.logs.unshift({ text, kind, t: Date.now() });
  if (g.logs.length > 80) g.logs.length = 80;
}

export function currentPlayer(g) {
  return g.players[g.currentPlayerIdx];
}

export function serializeState(g) {
  return JSON.parse(JSON.stringify({
    map: g.map,
    areas: g.areas,
    cols: g.cols,
    rows: g.rows,
    startId: g.startId,
    goal: g.goal,
    players: g.players,
    currentPlayerIdx: g.currentPlayerIdx,
    phase: g.phase,
    pending: g.pending,
    dice: g.dice,
    logs: g.logs.slice(0, 30),
    winnerId: g.winnerId,
    turn: g.turn,
    _seed: g._seed,
    _rngCount: g._rngCount,
  }));
}

export function restoreState(data) {
  return { ...data };
}

/** サイコロを振る（ホスト権威） */
export function rollDice(g) {
  if (g.phase !== 'await_roll') return { ok: false, error: 'not_roll_phase' };
  const p = currentPlayer(g);
  if (p.bankrupt) return { ok: false, error: 'bankrupt' };

  if (p.resting) {
    p.resting = false;
    addLog(g, `${p.name} は休憩から復帰`, 'system');
    endTurn(g);
    return { ok: true, skipped: true, state: serializeState(g) };
  }

  const d = Math.floor(rngNext(g) * 6) + 1;
  g.dice = d;
  g.phase = 'moving';
  addLog(g, `${p.name} のサイコロ → ${d}`, 'dice');

  const path = [];
  let pos = p.pos;
  let passedBank = false;
  for (let i = 0; i < d; i++) {
    const node = getNode(g, pos);
    const nextId = node.nexts[0];
    pos = nextId;
    path.push(pos);
    if (pos === g.startId) passedBank = true;
  }
  p.pos = pos;

  const result = { ok: true, dice: d, path, passedBank, state: null };
  resolveLanding(g, p, { passedBank });
  result.state = serializeState(g);
  return result;
}

function resolveLanding(g, p, { passedBank }) {
  // 銀行通過・到着での昇進 / 勝利判定
  if (passedBank || p.pos === g.startId) {
    handleBank(g, p, p.pos === g.startId);
    if (g.phase === 'gameover') return;
  }

  const sq = getNode(g, p.pos);

  if (sq.type === 'mark') {
    if (!p.marks[sq.mark]) {
      p.marks[sq.mark] = true;
      addLog(g, `${p.name} が ${SUIT_LABELS[sq.mark]} を入手！`, 'mark');
    }
    g.phase = 'await_roll';
    endTurn(g);
    return;
  }

  if (sq.type === 'rest') {
    p.resting = true;
    addLog(g, `${p.name} は休憩マス。次ターン休み`, 'system');
    endTurn(g);
    return;
  }

  if (sq.type === 'lucky') {
    p.lucky = true;
    addLog(g, `${p.name} がラッキーステータス獲得！（次ターンまで買い物料の20%を銀行から）`, 'event');
    endTurn(g);
    return;
  }

  if (sq.type === 'rollon') {
    addLog(g, `${p.name} もう一回サイコロ！`, 'dice');
    g.phase = 'await_roll';
    return;
  }

  if (sq.type === 'chance') {
    const ev = CHANCE_EVENTS[Math.floor(rngNext(g) * CHANCE_EVENTS.length)];
    const detail = ev.apply(g, p);
    addLog(g, `チャンス！ ${ev.label}（${detail}）`, 'event');
    if (ev.id === 'warp_bank') handleBank(g, p, true);
    endTurn(g);
    return;
  }

  if (sq.type === 'stockbroker' || (sq.type === 'bank' && !passedBank)) {
    g.phase = 'await_choice';
    g.pending = { type: 'stock', playerId: p.id };
    return;
  }

  if (sq.type === 'bank') {
    // 到着時は株も買える
    g.phase = 'await_choice';
    g.pending = { type: 'stock', playerId: p.id, atBank: true };
    return;
  }

  if (sq.type === 'shop') {
    resolveShop(g, p, sq);
    return;
  }

  endTurn(g);
}

function handleBank(g, p, landed) {
  if (hasFullMarks(p)) {
    const bonus = getLevelBonus(g, p);
    p.cash += bonus;
    const old = p.level;
    p.level++;
    p.marks = [false, false, false, false];
    addLog(g, `${p.name} 昇進！ Lv.${old}→${p.level} 賞金 +${bonus}G`, 'level');
  }

  // 勝利は「目標資産に到達したうえで銀行に止まる」こと
  if (landed) {
    const assets = getPlayerAssets(g, p);
    if (assets.total >= g.goal) {
      g.winnerId = p.id;
      g.phase = 'gameover';
      addLog(g, `🏆 ${p.name} の勝利！ 総資産 ${assets.total}G`, 'win');
      return true;
    }
  }
  return false;
}

function resolveShop(g, p, sq) {
  if (sq.owner < 0) {
    g.phase = 'await_choice';
    g.pending = {
      type: 'buy_shop',
      playerId: p.id,
      shopId: sq.id,
      price: sq.price,
    };
    return;
  }

  if (sq.owner === p.id) {
    const rem = getRemainingInvest(g, sq);
    g.phase = 'await_choice';
    g.pending = {
      type: 'invest',
      playerId: p.id,
      shopId: sq.id,
      remaining: rem,
      toll: calcToll(g, sq),
    };
    return;
  }

  // 他プレイヤーの店 → 買い物料
  payToll(g, p, sq);
}

function payToll(g, payer, sq) {
  const owner = g.players[sq.owner];
  let toll = calcToll(g, sq);

  // 配当（銀行から株保有者へ）
  const holders = g.players.filter((pl) => !pl.bankrupt && (pl.stocks[sq.area] || 0) > 0);
  let divTotal = 0;
  let totalShares = 0;
  if (holders.length) {
    totalShares = holders.reduce((s, pl) => s + (pl.stocks[sq.area] || 0), 0);
    const capShares = Math.min(totalShares, 5);
    divTotal = Math.floor(toll * capShares * 0.04);
    for (const pl of holders) {
      const share = Math.floor((divTotal * (pl.stocks[sq.area] || 0)) / totalShares);
      if (share > 0) pl.cash += share;
    }
  }

  // ラッキー分け前
  for (const lp of g.players) {
    if (lp.lucky && lp.id !== payer.id && lp.id !== owner.id && !lp.bankrupt) {
      lp.cash += Math.floor(toll * 0.2);
    }
  }

  addLog(g, `${payer.name} → ${owner.name}「${sq.label}」買い物料 ${toll}G`, 'toll');

  const paid = Math.min(payer.cash, toll);
  payer.cash -= paid;
  owner.cash += toll;

  const remaining = toll - paid;
  if (remaining > 0) {
    autoLiquidate(g, payer, remaining);
  }

  // 5倍買い選択肢
  const five = sq.price * 5;
  const liq = payer.cash + getPlayerAssets(g, payer).stockAsset;
  if (liq >= five && !payer.bankrupt) {
    g.phase = 'await_choice';
    g.pending = {
      type: 'five_buy',
      playerId: payer.id,
      shopId: sq.id,
      price: five,
      toll,
    };
    return;
  }

  endTurn(g);
}

function autoLiquidate(g, p, need) {
  // 株を高いエリアから売却
  const areas = Object.keys(p.stocks)
    .map(Number)
    .filter((a) => (p.stocks[a] || 0) > 0)
    .sort((a, b) => (g.areas[b].stockPrice || 0) - (g.areas[a].stockPrice || 0));

  let needLeft = need;
  for (const a of areas) {
    while (needLeft > 0 && (p.stocks[a] || 0) > 0) {
      const sell = Math.min(p.stocks[a], Math.ceil(needLeft / g.areas[a].stockPrice));
      const got = sell * g.areas[a].stockPrice;
      p.stocks[a] -= sell;
      p.cash += got;
      needLeft -= got;
      // 大量売却で株価微減
      if (sell >= 10) {
        g.areas[a].B = Math.max(100, Math.floor(g.areas[a].B * 0.93));
      }
    }
  }
  updateAreaStockPrices(g);

  if (p.cash < needLeft) {
    // 店を売却
    const shops = g.map.filter((s) => s.type === 'shop' && s.owner === p.id);
    for (const sq of shops) {
      if (p.cash >= needLeft) break;
      p.cash += Math.floor(sq.price * 0.5);
      sq.owner = -1;
      sq.extraInvest = 0;
      sq.price = sq.basePrice;
      addLog(g, `${p.name} が「${sq.label}」を売却`, 'system');
    }
    updateAreaStockPrices(g);
  }

  if (p.cash < needLeft) {
    p.cash = 0;
    p.bankrupt = true;
    for (const sq of g.map.filter((s) => s.type === 'shop' && s.owner === p.id)) {
      sq.owner = -1;
      sq.extraInvest = 0;
      sq.price = sq.basePrice;
    }
    p.stocks = {};
    addLog(g, `${p.name} が破産…`, 'system');
    updateAreaStockPrices(g);
  } else {
    p.cash -= needLeft;
  }
}

/** プレイヤー選択の解決 */
export function applyChoice(g, choice) {
  if (g.phase !== 'await_choice' || !g.pending) {
    return { ok: false, error: 'no_pending' };
  }
  const pending = g.pending;
  const p = g.players[pending.playerId];
  if (!p || p.bankrupt) {
    endTurn(g);
    return { ok: true, state: serializeState(g) };
  }

  if (pending.type === 'buy_shop') {
    const sq = getNode(g, pending.shopId);
    if (choice.action === 'buy') {
      if (p.cash + getPlayerAssets(g, p).stockAsset < sq.price) {
        return { ok: false, error: 'insufficient' };
      }
      if (p.cash < sq.price) autoLiquidate(g, p, sq.price - p.cash);
      if (p.bankrupt) {
        endTurn(g);
        return { ok: true, state: serializeState(g) };
      }
      p.cash -= sq.price;
      sq.owner = p.id;
      updateAreaStockPrices(g);
      addLog(g, `${p.name} が「${sq.label}」を購入（${sq.price}G）`, 'shop');
    } else {
      addLog(g, `${p.name} は「${sq.label}」の購入を見送り`, 'system');
    }
    g.pending = null;
    endTurn(g);
    return { ok: true, state: serializeState(g) };
  }

  if (pending.type === 'invest') {
    const sq = getNode(g, pending.shopId);
    if (choice.action === 'invest') {
      const rem = getRemainingInvest(g, sq);
      let amount = Math.max(0, Math.min(Number(choice.amount) || 0, rem, p.cash + getPlayerAssets(g, p).stockAsset));
      if (p.flags.investCoupon) {
        const pay = Math.ceil(amount / 2);
        p.flags.investCoupon = false;
        if (p.cash < pay) autoLiquidate(g, p, pay - p.cash);
        if (!p.bankrupt) {
          p.cash -= pay;
          sq.extraInvest += amount;
          sq.price += amount;
          updateAreaStockPrices(g);
          addLog(g, `${p.name} が「${sq.label}」に ${amount}G 増資（半額クーポン）`, 'shop');
        }
      } else {
        if (p.cash < amount) autoLiquidate(g, p, amount - p.cash);
        if (!p.bankrupt && amount > 0) {
          p.cash -= amount;
          sq.extraInvest += amount;
          sq.price += amount;
          updateAreaStockPrices(g);
          addLog(g, `${p.name} が「${sq.label}」に ${amount}G 増資`, 'shop');
        }
      }
    }
    g.pending = null;
    endTurn(g);
    return { ok: true, state: serializeState(g) };
  }

  if (pending.type === 'five_buy') {
    const sq = getNode(g, pending.shopId);
    if (choice.action === 'buy') {
      const price = sq.price * 5;
      if (p.cash < price) autoLiquidate(g, p, price - p.cash);
      if (!p.bankrupt && p.cash >= price) {
        const owner = g.players[sq.owner];
        p.cash -= price;
        owner.cash += Math.floor(price * 0.6);
        sq.owner = p.id;
        sq.extraInvest = 0;
        sq.price = sq.basePrice;
        updateAreaStockPrices(g);
        addLog(g, `${p.name} が5倍買いで「${sq.label}」を奪取！`, 'shop');
      }
    }
    g.pending = null;
    endTurn(g);
    return { ok: true, state: serializeState(g) };
  }

  if (pending.type === 'stock') {
    if (choice.action === 'buy') {
      const area = Number(choice.area);
      const count = Math.max(1, Math.min(99, Number(choice.count) || 1));
      if (!g.areas[area]) return { ok: false, error: 'bad_area' };
      const cost = g.areas[area].stockPrice * count;
      if (p.cash < cost) return { ok: false, error: 'insufficient' };
      p.cash -= cost;
      p.stocks[area] = (p.stocks[area] || 0) + count;
      if (count >= 10) {
        g.areas[area].B = Math.floor(g.areas[area].B * 1.07);
      }
      updateAreaStockPrices(g);
      addLog(g, `${p.name} が A${area}株×${count} 購入（${cost}G）`, 'stock');
    } else if (choice.action === 'sell') {
      const area = Number(choice.area);
      const have = p.stocks[area] || 0;
      const count = Math.max(1, Math.min(have, Number(choice.count) || 1));
      if (count <= 0) return { ok: false, error: 'no_stock' };
      const got = g.areas[area].stockPrice * count;
      p.stocks[area] -= count;
      p.cash += got;
      if (count >= 10) {
        g.areas[area].B = Math.max(100, Math.floor(g.areas[area].B * 0.93));
      }
      updateAreaStockPrices(g);
      addLog(g, `${p.name} が A${area}株×${count} 売却（+${got}G）`, 'stock');
    }
    // skip / done
    if (choice.action === 'done' || choice.action === 'skip') {
      g.pending = null;
      endTurn(g);
    }
    return { ok: true, state: serializeState(g) };
  }

  return { ok: false, error: 'unknown_pending' };
}

/** ターン開始前に株売却できる */
export function preTurnSell(g, playerId, area, count) {
  if (g.phase !== 'await_roll') return { ok: false, error: 'bad_phase' };
  if (g.currentPlayerIdx !== playerId) return { ok: false, error: 'not_your_turn' };
  const p = g.players[playerId];
  const have = p.stocks[area] || 0;
  const n = Math.max(1, Math.min(have, count));
  if (n <= 0) return { ok: false, error: 'no_stock' };
  const got = g.areas[area].stockPrice * n;
  p.stocks[area] -= n;
  p.cash += got;
  if (n >= 10) g.areas[area].B = Math.max(100, Math.floor(g.areas[area].B * 0.93));
  updateAreaStockPrices(g);
  addLog(g, `${p.name} が A${area}株×${n} 売却（+${got}G）`, 'stock');
  return { ok: true, state: serializeState(g) };
}

function endTurn(g) {
  if (g.phase === 'gameover') return;

  const p = currentPlayer(g);
  if (p) p.lucky = false;

  // 生存プレイヤーへ
  const alive = g.players.filter((pl) => !pl.bankrupt);
  if (alive.length <= 1) {
    g.winnerId = alive[0]?.id ?? null;
    g.phase = 'gameover';
    if (alive[0]) addLog(g, `🏆 ${alive[0].name} の勝利（他プレイヤー破産）`, 'win');
    return;
  }

  let next = g.currentPlayerIdx;
  for (let i = 0; i < g.players.length; i++) {
    next = (next + 1) % g.players.length;
    if (!g.players[next].bankrupt) break;
  }
  if (next <= g.currentPlayerIdx) g.turn++;
  g.currentPlayerIdx = next;
  g.phase = 'await_roll';
  g.pending = null;
  g.dice = null;
}

/** CPUの簡易行動 */
export function cpuAct(g) {
  const p = currentPlayer(g);
  if (!p?.isCPU || p.bankrupt || g.phase === 'gameover') return null;

  if (g.phase === 'await_roll') {
    return rollDice(g);
  }

  if (g.phase === 'await_choice' && g.pending) {
    const pend = g.pending;
    if (pend.type === 'buy_shop') {
      const sq = getNode(g, pend.shopId);
      const assets = getPlayerAssets(g, p);
      const buy = p.cash >= sq.price && assets.total < g.goal * 0.95;
      return applyChoice(g, { action: buy ? 'buy' : 'skip' });
    }
    if (pend.type === 'invest') {
      const rem = pend.remaining || 0;
      const amount = Math.min(rem, Math.floor(p.cash * 0.4));
      if (amount >= 20) return applyChoice(g, { action: 'invest', amount });
      return applyChoice(g, { action: 'skip' });
    }
    if (pend.type === 'five_buy') {
      const assets = getPlayerAssets(g, p);
      const buy = assets.cash + assets.stockAsset >= pend.price && Math.random() > 0.4;
      return applyChoice(g, { action: buy ? 'buy' : 'skip' });
    }
    if (pend.type === 'stock') {
      // 自分が店を持つエリアの株を少し買う
      const ownedAreas = [...new Set(g.map.filter((s) => s.type === 'shop' && s.owner === p.id).map((s) => s.area))];
      if (ownedAreas.length && p.cash > 300) {
        const a = ownedAreas[0];
        const price = g.areas[a].stockPrice;
        const count = Math.min(20, Math.floor((p.cash * 0.25) / price));
        if (count > 0) {
          applyChoice(g, { action: 'buy', area: a, count });
        }
      }
      return applyChoice(g, { action: 'done' });
    }
  }
  return null;
}
