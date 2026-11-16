/** MkMk Street — ゲームエンジン（純ロジック / ホスト権威） */

import {
  buildBoard,
  applySwitchState,
  recordSwitchSlide,
  takeSwitchFx,
  SUIT_LABELS,
  DEFAULT_GOAL,
  DEFAULT_CASH,
  DEFAULT_MAP_ID,
  dirLabel,
  getMapDef,
} from './board.js';
import { createEventTable, scratchCell, unscratchedIds, applyAllCash, recordWarp, takeWarpFx } from './eventTable.js';
import {
  monopolyRate as monopolyRateOf,
  investMultiByMonopolyRate,
  maxExtraInvest as maxExtraInvestOf,
  remainingInvest as remainingInvestOf,
} from './investLimits.js';

export const PLAYER_COLORS = ['#e85d75', '#3d8bfd', '#f0a202', '#20c997'];
export const PLAYER_NAMES_DEFAULT = ['あか', 'あお', 'きいろ', 'みどり'];

/**
 * プレイヤー色をパレットへ正規化する。
 * 未知の色や重複は未使用色へ振り直し、再接続・旧セーブにも耐える。
 * @param {string|null|undefined} color
 * @param {number} [index=0]
 * @param {Iterable<string>} [usedColors]
 */
export function normalizePlayerColor(color, index = 0, usedColors = []) {
  const palette = PLAYER_COLORS;
  const used = new Set(
    [...usedColors]
      .filter(Boolean)
      .map((c) => String(c).toLowerCase()),
  );
  const raw = String(color || '').toLowerCase();
  const matched = palette.find((p) => p.toLowerCase() === raw);
  if (matched && !used.has(matched.toLowerCase())) return matched;
  const free = palette.find((p) => !used.has(p.toLowerCase()));
  if (free) return free;
  return palette[((Number(index) || 0) % palette.length + palette.length) % palette.length];
}

/** ロビー／席配列の色を一括でパレット内・重複なしにする */
export function normalizeLobbyColors(players = []) {
  const used = [];
  return players.map((p, i) => {
    const color = normalizePlayerColor(p?.color, i, used);
    used.push(color);
    return { ...p, color };
  });
}

/** CPU個性（席順でローテ。明示指定も可） */
export const CPU_PERSONALITY_KEYS = ['tycoon', 'broker', 'magnate', 'gambler'];
export const CPU_PERSONALITIES = {
  tycoon: {
    label: '店舗王',
    shopBuy: 1.15,
    fiveBuy: 0.42,
    investRate: 0.38,
    stockBudget: 0.28,
    vacant: 2.6,
    ownArea: 2.0,
    enemyToll: -2.8,
    bank: 0.55,
    mark: 0.7,
    stockbroker: 0.35,
    scratch: 0.45,
    minigame: 0.5,
  },
  broker: {
    label: '株マニア',
    shopBuy: 0.55,
    fiveBuy: 0.18,
    investRate: 0.18,
    stockBudget: 0.55,
    vacant: 1.0,
    ownArea: 1.3,
    enemyToll: -3.2,
    bank: 1.6,
    mark: 0.55,
    stockbroker: 2.6,
    scratch: 0.5,
    minigame: 0.45,
  },
  magnate: {
    label: '独占屋',
    shopBuy: 1.05,
    fiveBuy: 0.5,
    investRate: 0.42,
    stockBudget: 0.32,
    vacant: 1.7,
    ownArea: 3.2,
    enemyToll: -2.4,
    bank: 0.9,
    mark: 1.0,
    stockbroker: 0.9,
    scratch: 0.85,
    minigame: 0.6,
  },
  gambler: {
    label: '勝負師',
    shopBuy: 0.7,
    fiveBuy: 0.32,
    investRate: 0.22,
    stockBudget: 0.3,
    vacant: 1.2,
    ownArea: 1.0,
    enemyToll: -2.0,
    bank: 0.6,
    mark: 2.1,
    stockbroker: 0.45,
    scratch: 2.3,
    minigame: 2.1,
  },
};

export function getCpuPersonality(p) {
  const key = p?.personality && CPU_PERSONALITIES[p.personality]
    ? p.personality
    : CPU_PERSONALITY_KEYS[(p?.id || 0) % CPU_PERSONALITY_KEYS.length];
  return { key, ...CPU_PERSONALITIES[key] };
}

/**
 * 買い物料の変化倍率（いたストSP準拠）。
 * 行: エリア内店舗数、列インデックス: 所有軒数（0は未使用）。
 * 全軒所有＝独占で最大倍率。
 */
const TOLL_MULTI_BY_AREA = {
  3: [1, 1, 2, 3.75],
  4: [1, 1, 1.25, 2.5, 5],
  5: [1, 1, 1.25, 2, 3.25, 6],
  6: [1, 1, 1.25, 2, 2.75, 4.25, 6.75],
};
/** 独占達成時：エリア店価合計に対する現金ボーナス率 */
export const MONOPOLY_BONUS_RATE = 0.15;
/** 独占崩壊時：エリア係数 B に掛ける倍率（強い株価下落） */
export const MONOPOLY_BREAK_B_RATE = 0.68;
/** 独占崩壊時：元独占主の残店増資を削る割合 */
export const MONOPOLY_BREAK_INVEST_CUT = 0.3;
export { investMultiByMonopolyRate };

/**
 * エリア収益（買い物料など）に対する株わけ前。
 * 1株あたり収益の STOCK_DIVIDEND_PER_SHARE、合計は収益の最大 STOCK_DIVIDEND_MAX_RATE。
 * 支払いは銀行から（本家の株配当イメージ）。
 */
export const STOCK_DIVIDEND_PER_SHARE = 0.03;
export const STOCK_DIVIDEND_MAX_RATE = 0.15;

/**
 * エリアの収益に応じて、そのエリア株の保有者へわけ前を分配する。
 * @returns {{ area: number, pool: number, payouts: { pid: number, name: string, shares: number, amount: number }[] }}
 */
export function payAreaStockDividend(g, area, revenue) {
  const a = Number(area);
  const base = Math.max(0, Math.floor(Number(revenue) || 0));
  const empty = { area: a, pool: 0, payouts: [] };
  if (!g?.areas?.[a] || base <= 0) return empty;

  const holders = (g.players || []).filter((pl) => !pl.bankrupt && (pl.stocks?.[a] || 0) > 0);
  if (!holders.length) return empty;

  const totalShares = holders.reduce((s, pl) => s + (pl.stocks[a] || 0), 0);
  if (totalShares <= 0) return empty;

  const rate = Math.min(STOCK_DIVIDEND_MAX_RATE, STOCK_DIVIDEND_PER_SHARE * totalShares);
  const pool = Math.floor(base * rate);
  if (pool <= 0) return empty;

  const ordered = [...holders].sort((x, y) => (y.stocks[a] || 0) - (x.stocks[a] || 0) || x.id - y.id);
  const payouts = ordered.map((pl) => ({
    pid: pl.id,
    name: pl.name,
    shares: pl.stocks[a] || 0,
    amount: Math.floor((pool * (pl.stocks[a] || 0)) / totalShares),
  }));
  let paid = payouts.reduce((s, p) => s + p.amount, 0);
  let rest = pool - paid;
  for (const p of payouts) {
    if (rest <= 0) break;
    p.amount += 1;
    rest -= 1;
  }
  for (const p of payouts) {
    if (p.amount <= 0) continue;
    const pl = g.players[p.pid];
    if (!pl) continue;
    pl.cash += p.amount;
    bumpStat(pl, 'dividendEarned', p.amount);
  }
  const given = payouts.filter((p) => p.amount > 0);
  if (given.length) {
    const areaName = g.areas[a]?.name || `A${a}`;
    const detail = given.map((p) => `${p.name}+${p.amount}G`).join(' / ');
    addLog(g, `A${a}「${areaName}」株わけ前 ${detail}（収益 ${base}G の一部）`, 'stock');
  }

  return { area: a, pool: given.reduce((s, p) => s + p.amount, 0), payouts: given };
}

/** プレイヤーごとの累積統計（終了画面・本家風） */
export function createEmptyStats() {
  return {
    rolls: 0,
    diceTotal: 0,
    tollEarned: 0,
    tollPaid: 0,
    tollSaleCount: 0,
    tollPayCount: 0,
    tollSaleMax: 0,
    tollPayMax: 0,
    dividendEarned: 0,
    luckyIncome: 0,
    shopsBought: 0,
    shopsStolen: 0,
    investTotal: 0,
    salaryEarned: 0,
    levelUps: 0,
    monopolyCount: 0,
    monopolyBonus: 0,
    stockBought: 0,
    stockSpent: 0,
    stockSold: 0,
    stockIncome: 0,
    /** 株価変動による含み益・損の累計 */
    stockReturn: 0,
    scratchCount: 0,
    matchBonus: 0,
    minigamePlays: 0,
    minigameWins: 0,
    minigamePrize: 0,
  };
}

export function ensureStats(p) {
  if (!p) return createEmptyStats();
  if (!p.stats) p.stats = createEmptyStats();
  else {
    const base = createEmptyStats();
    for (const k of Object.keys(base)) {
      if (typeof p.stats[k] !== 'number') p.stats[k] = base[k];
    }
  }
  return p.stats;
}

function bumpStat(p, key, n = 1) {
  if (!p || !n) return;
  const s = ensureStats(p);
  s[key] = (s[key] || 0) + n;
}

function getStockAssetOnly(g, p) {
  let stockAsset = 0;
  for (const [a, cnt] of Object.entries(p.stocks || {})) {
    stockAsset += (g.areas[Number(a)]?.stockPrice || 0) * cnt;
  }
  return stockAsset;
}

/** 売買直後：含み益計算の基準を現在値に合わせる（変動分は計上しない） */
export function syncStockValueSnap(g, p) {
  if (!p) return;
  if (!p.flags) p.flags = {};
  p.flags.stockValueSnap = getStockAssetOnly(g, p);
}

/** 株価更新後：持ち株の含み益・損を stockReturn に加算 */
function applyStockReturnDeltas(g) {
  for (const p of g.players || []) {
    if (p.bankrupt) continue;
    if (!p.flags) p.flags = {};
    const now = getStockAssetOnly(g, p);
    const prev = p.flags.stockValueSnap;
    if (typeof prev === 'number') {
      const delta = now - prev;
      if (delta) bumpStat(p, 'stockReturn', delta);
    }
    p.flags.stockValueSnap = now;
  }
}

/** 総資産ヒストリ（終了画面の順位グラフ用） */
export function recordWorthSnapshot(g) {
  if (!g) return;
  if (!g.worthHistory) g.worthHistory = [];
  const values = {};
  for (const p of g.players || []) {
    values[p.id] = getPlayerAssets(g, p).total;
  }
  const turn = g.turn || 1;
  const last = g.worthHistory[g.worthHistory.length - 1];
  if (last && last.turn === turn) {
    last.values = values;
    return;
  }
  g.worthHistory.push({ turn, values });
}

function giveAllCash(g, amount) {
  const msgs = [];
  applyAllCash(g, amount, msgs);
  return msgs[0] || `全員 +${amount}G`;
}

const CHANCE_EVENTS = [
  { id: 'bonus', label: '臨時ボーナス', apply: (g, p) => { const n = 200 + p.level * 50; p.cash += n; return `Lv.${p.level}ボーナス +${n}G` } },
  { id: 'salary', label: '給料日っぽい日', apply: (g, p) => { const n = Math.floor(getLevelBonus(g, p) * 0.5); p.cash += n; return `昇進賞金の半分 +${n}G` } },
  { id: 'rank_stipend', label: '階級手当', apply: (g, p) => { const n = 120 + p.level * 80; p.cash += n; return `Lv.${p.level}手当 +${n}G` } },
  { id: 'promotion_fund', label: '昇進準備金', apply: (g, p) => { const n = 80 + p.level * 60; p.cash += n; return `準備金 +${n}G` } },
  { id: 'payday_all', label: '給料日！', apply: (g, p) => giveAllCash(g, 80 + p.level * 20) },
  { id: 'bonus_wave', label: 'ボーナス支給', apply: (g, p) => giveAllCash(g, 100 + p.level * 25) },
  { id: 'tax', label: '税金', apply: (g, p) => { const n = Math.min(p.cash, 150 + p.level * 30); p.cash -= n; return `Lv税 -${n}G` } },
  { id: 'rank_dues', label: '階級維持費', apply: (g, p) => { const n = Math.min(p.cash, 60 + p.level * 40); p.cash -= n; return `維持費 -${n}G` } },
  { id: 'warp_bank', label: '銀行へワープ', apply: (g, p) => {
    recordWarp(g, p.id, p.pos, g.startId);
    p.pos = g.startId;
    p.prevPos = null;
    return '銀行へ移動';
  }},
  { id: 'stock_gift', label: '株のおすそ分け', apply: (g, p) => {
    const areas = Object.keys(g.areas).map(Number);
    const a = areas[Math.floor(Math.random() * areas.length)];
    const n = 6 + p.level * 2;
    p.stocks[a] = (p.stocks[a] || 0) + n;
    return `A${a}株 +${n}`
  }},
  { id: 'invest_boost', label: '増資クーポン', apply: (g, p) => { p.flags.investCoupon = true; return '次の自分店増資が半額' } },
  { id: 'level_shop_aid', label: '階級改装助成', apply: (g, p) => {
    const shops = g.map.filter((s) => s.type === 'shop' && s.owner === p.id);
    if (!shops.length) { p.flags.investCoupon = true; return '所持店なし → 増資半額券'; }
    const add = 30 + p.level * 25;
    const sq = shops[Math.floor(Math.random() * shops.length)];
    const gained = applyCappedShopBoost(g, sq, add);
    return gained > 0 ? `「${sq.label}」+${gained}G` : '増資枠なし';
  }},
  { id: 'mini_dice', label: 'サイコロ当て', apply: (g, p) => {
    p.flags.pendingMinigame = { game: 'guess_dice', label: 'サイコロ当て' };
    return 'ミニゲーム！';
  }},
  { id: 'mini_coin', label: 'コイントス', apply: (g, p) => {
    p.flags.pendingMinigame = { game: 'coin', label: 'コイントス' };
    return 'ミニゲーム！';
  }},
];

const BOARD_EVENTS = [
  { id: 'cash', label: '臨時収入', apply: (g, p) => { const n = 180 + p.level * 40; p.cash += n; return `Lv.${p.level}収入 +${n}G` } },
  { id: 'rank_pocket', label: 'ポケットマネー', apply: (g, p) => { const n = 100 + p.level * 55; p.cash += n; return `+${n}G` } },
  { id: 'senior_gift', label: '先輩からの祝儀', apply: (g, p) => { const n = 150 + p.level * 70; p.cash += n; return `祝儀 +${n}G` } },
  { id: 'festival', label: 'お祭り景気', apply: (g, p) => giveAllCash(g, 70 + p.level * 15) },
  { id: 'stimulus', label: '景気刺激策', apply: (g, p) => giveAllCash(g, 60 + p.level * 12) },
  { id: 'tax', label: '出費', apply: (g, p) => { const n = Math.min(p.cash, 120 + p.level * 25); p.cash -= n; return `出費 -${n}G` } },
  { id: 'rank_fee', label: '肩書きコスト', apply: (g, p) => { const n = Math.min(p.cash, 50 + p.level * 35); p.cash -= n; return `コスト -${n}G` } },
  { id: 'stock', label: '株プレゼント', apply: (g, p) => {
    const areas = Object.keys(g.areas).map(Number);
    const a = areas[Math.floor(Math.random() * areas.length)];
    const n = 3 + p.level;
    p.stocks[a] = (p.stocks[a] || 0) + n;
    return `A${a}株 +${n}`;
  }},
  { id: 'rollon', label: 'ラッキー再挑戦', apply: (g, p) => { p.flags.extraRoll = true; return 'もう一度サイコロ' } },
  { id: 'invest', label: '増資クーポン', apply: (g, p) => { p.flags.investCoupon = true; return '次の増資が半額' } },
  { id: 'lucky', label: '幸運のお守り', apply: (g, p) => {
    grantLucky(p);
    return '他者の買い物料の20%を銀行から受取（次の自分の番まで）';
  }},
  { id: 'mini_highlow', label: 'ハイ＆ロー', apply: (g, p) => {
    p.flags.pendingMinigame = { game: 'high_low', label: 'ハイ＆ロー' };
    return 'ミニゲーム！';
  }},
  { id: 'mini_slot', label: 'ファイブスロット', apply: (g, p) => {
    p.flags.pendingMinigame = { game: 'slot', label: 'ファイブスロット' };
    return 'ミニゲーム！';
  }},
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

export function createGame({
  players,
  goal,
  seed = Date.now(),
  cash,
  mapId = DEFAULT_MAP_ID,
} = {}) {
  const board = buildBoard(mapId);
  const initialCash = cash ?? board.initialCash ?? DEFAULT_CASH;
  const resolvedGoal = goal ?? board.goal ?? DEFAULT_GOAL;
  const rng = mulberry32(seed);

  let cpuOrd = 0;
  const colored = normalizeLobbyColors(players);
  const plist = colored.map((pl, i) => {
    const isCPU = !!pl.isCPU;
    const personality = isCPU
      ? (pl.personality && CPU_PERSONALITIES[pl.personality]
        ? pl.personality
        : CPU_PERSONALITY_KEYS[cpuOrd++ % CPU_PERSONALITY_KEYS.length])
      : null;
    return {
      id: i,
      peerId: pl.peerId || null,
      name: pl.name || PLAYER_NAMES_DEFAULT[i] || `P${i + 1}`,
      color: pl.color,
      isCPU,
      personality,
      cash: initialCash,
      pos: board.startId,
      prevPos: null,
      marks: [false, false, false, false],
      level: 1,
      stocks: {},
      lucky: false,
      resting: false,
      shopsClosed: false,
      bankrupt: false,
      offline: false,
      flags: {},
      stats: createEmptyStats(),
    };
  });

  const g = {
    map: board.nodes,
    areas: board.areas,
    mapId: board.mapId || getMapDef(mapId).id,
    mapName: board.mapName || getMapDef(mapId).name,
    /** 全員共通のイベント表（1マスずつ誰かがめくる） */
    sharedEventTable: createEventTable((seed >>> 0) + 7771),
    cols: board.cols,
    rows: board.rows,
    startId: board.startId,
    goal: resolvedGoal,
    players: plist,
    currentPlayerIdx: 0,
    phase: 'await_roll', // await_roll | await_fork | await_choice | gameover
    pending: null,
    dice: null,
    move: null, // { stepsLeft, path, passedBank }
    logs: [{ text: 'ゲーム開始！分岐路を選んで目標資産を目指そう', kind: 'system' }],
    winnerId: null,
    turn: 1,
    goalPressure: false,
    switchState: board.switchState || 0,
    switchGates: board.switchGates || [],
    switchMoves: board.switchMoves || [],
    worthHistory: [],
    _seed: seed,
    _rngCount: 0,
    _rngState: seed,
  };
  applySwitchState(g);
  for (const p of plist) syncStockValueSnap(g, p);
  recordWorthSnapshot(g);
  return g;
}

/** スイッチマス：経路と動くマスを切り替える（動くマスは switchFx にスライド情報を積む） */
export function toggleBoardSwitch(g) {
  const prev = g.switchState ? 1 : 0;
  const next = prev ? 0 : 1;
  for (const mv of g.switchMoves || []) {
    const from = mv.pos?.[prev];
    const to = mv.pos?.[next];
    if (!from || !to) continue;
    if (from.col === to.col && from.row === to.row) continue;
    recordSwitchSlide(g, {
      id: mv.id,
      from: { col: from.col, row: from.row },
      to: { col: to.col, row: to.row },
    });
  }
  g.switchState = next;
  applySwitchState(g);
  return g.switchState;
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

/** エリア内の全店舗を所有しているか */
export function hasAreaMonopoly(g, pid, area) {
  const shops = getAreaShops(g, area);
  if (!shops.length) return false;
  return shops.every((s) => s.owner === pid);
}

/** エリア独占率（0〜1） */
export function getAreaMonopolyRate(g, pid, area) {
  return monopolyRateOf(getPlayerAreaCount(g, pid, area), getAreaShops(g, area).length);
}

/**
 * 買い物料倍率。areaSize 省略時は4軒エリアとして扱う（後方互換）。
 * @param {number} owned 所有軒数
 * @param {number} [areaSize=4] エリア内店舗数
 */
export function getTollMulti(owned, areaSize = 4) {
  const size = TOLL_MULTI_BY_AREA[areaSize] ? areaSize : 4;
  const table = TOLL_MULTI_BY_AREA[size];
  const i = Math.min(Math.max(0, owned | 0), table.length - 1);
  return table[i] ?? 1;
}

/**
 * 増資上限（追加投資の最大G）。エリア独占率で決まる。
 * 空き店は増資不可（0）。
 */
export function getMaxExtraInvest(g, sq) {
  if (!sq || sq.type !== 'shop' || sq.owner < 0) return 0;
  const total = getAreaShops(g, sq.area).length;
  const owned = getPlayerAreaCount(g, sq.owner, sq.area);
  return maxExtraInvestOf(sq.basePrice, owned, total);
}

export function getRemainingInvest(g, sq) {
  if (!sq || sq.type !== 'shop' || sq.owner < 0) return 0;
  const total = getAreaShops(g, sq.area).length;
  const owned = getPlayerAreaCount(g, sq.owner, sq.area);
  return remainingInvestOf(sq.basePrice, sq.extraInvest || 0, owned, total);
}

/** イベント等の店価値アップを増資枠内に収める。実際に載った額を返す */
export function applyCappedShopBoost(g, sq, amount) {
  const add = Math.max(0, Math.min(Math.floor(Number(amount) || 0), getRemainingInvest(g, sq)));
  if (add <= 0) return 0;
  sq.extraInvest = (sq.extraInvest || 0) + add;
  sq.price += add;
  return add;
}

export function calcToll(g, sq) {
  if (!sq || sq.owner < 0) return 0;
  const owner = g.players[sq.owner];
  if (owner?.shopsClosed) return 0;
  const areaSize = getAreaShops(g, sq.area).length;
  const cnt = getPlayerAreaCount(g, sq.owner, sq.area);
  return Math.floor(
    sq.baseToll * (1 + (sq.extraInvest / sq.basePrice) * 2) * getTollMulti(cnt, areaSize),
  );
}

/**
 * 直前まで非独占 → 今回独占になったらボーナス付与。
 * @returns {{ monopoly: true, area: number, bonus: number, areaName: string } | null}
 */
export function tryGrantMonopolyBonus(g, p, area) {
  if (!hasAreaMonopoly(g, p.id, area)) return null;
  const shops = getAreaShops(g, area);
  // 直前は未独占だったか（今回の取得で完成したか）は呼び出し側で確認済み想定だが、
  // 二重付与防止フラグをエリア×プレイヤーで持つ
  if (!p.flags) p.flags = {};
  if (!p.flags.monopolyBonusClaimed) p.flags.monopolyBonusClaimed = {};
  if (p.flags.monopolyBonusClaimed[area]) return null;

  const value = shops.reduce((s, sq) => s + (sq.price || sq.basePrice || 0), 0);
  const bonus = Math.max(100, Math.floor(value * MONOPOLY_BONUS_RATE));
  p.cash += bonus;
  bumpStat(p, 'monopolyCount', 1);
  bumpStat(p, 'monopolyBonus', bonus);
  p.flags.monopolyBonusClaimed[area] = true;

  if (g.areas[area]) {
    g.areas[area].B = Math.max(1, Math.floor((g.areas[area].B || 100) * 1.1));
  }
  updateAreaStockPrices(g);

  const areaName = g.areas[area]?.name || `エリア${area}`;
  addLog(g, `${p.name} が「${areaName}」を独占！ ボーナス +${bonus}G`, 'level');
  return { monopoly: true, area, bonus, areaName };
}

/** 独占が崩れたらボーナス再取得可能に（5倍買い等） */
export function clearMonopolyClaim(g, pid, area) {
  const p = g.players[pid];
  if (p?.flags?.monopolyBonusClaimed) {
    delete p.flags.monopolyBonusClaimed[area];
  }
}

/**
 * 独占崩壊ペナルティ：株価を大きく下げ、元独占主の残店増資も削る。
 * 所有変更のあとに呼ぶ（hadClaim かつ もう独占でないときだけ発動）。
 * @returns {{ broken: true, area: number, areaName: string, oldPrice: number, newPrice: number, investCut: number } | null}
 */
export function applyMonopolyBreak(g, pid, area) {
  const p = g.players[pid];
  const hadClaim = !!p?.flags?.monopolyBonusClaimed?.[area];
  const stillMono = hasAreaMonopoly(g, pid, area);
  if (!hadClaim || stillMono) {
    clearMonopolyClaim(g, pid, area);
    return null;
  }

  const meta = g.areas[area];
  const oldPrice = meta?.stockPrice || 0;
  if (meta) {
    meta.B = Math.max(70, Math.floor((meta.B || 100) * MONOPOLY_BREAK_B_RATE));
  }

  let investCut = 0;
  for (const sq of getAreaShops(g, area)) {
    if (sq.owner !== pid) continue;
    const cut = Math.floor((sq.extraInvest || 0) * MONOPOLY_BREAK_INVEST_CUT);
    if (cut <= 0) continue;
    sq.extraInvest -= cut;
    sq.price -= cut;
    investCut += cut;
  }

  clearMonopolyClaim(g, pid, area);
  updateAreaStockPrices(g);
  const newPrice = meta?.stockPrice || 0;
  const areaName = meta?.name || `エリア${area}`;
  addLog(
    g,
    `「${areaName}」独占崩壊！ 株価 ${oldPrice.toLocaleString()}→${newPrice.toLocaleString()}G`
      + (investCut > 0 ? `／残店増資 −${investCut.toLocaleString()}G` : ''),
    'stock',
  );
  return { broken: true, area, areaName, oldPrice, newPrice, investCut };
}

/** 総資産が目標以上の生存プレイヤー */
export function getGoalPressurePlayers(g) {
  if (!g || g.phase === 'gameover') return [];
  return g.players.filter((p) => !p.bankrupt && getPlayerAssets(g, p).total >= g.goal);
}

/** 目標到達者がいるときの焦りフラグ＆ログ（一度だけ） */
export function refreshGoalPressure(g) {
  if (!g || g.phase === 'gameover') {
    if (g) g.goalPressure = false;
    return false;
  }
  const reached = getGoalPressurePlayers(g);
  const on = reached.length > 0;
  if (on && !g.goalPressure) {
    g.goalPressure = true;
    const names = reached.map((p) => p.name).join('・');
    addLog(g, `⚠ ${names} が目標資産に到達！銀行を目指せ／止めろ！`, 'level');
  } else if (!on) {
    g.goalPressure = false;
  }
  return on;
}

/** 一度にこの枚数以上売ると相場係数 B が下がる */
export const STOCK_SELL_PRESSURE_MIN = 10;
/** 大口売却時の B 乗率 */
export const STOCK_SELL_B_RATE = 0.93;

function areaShopAvgPrice(g, area) {
  const shops = getAreaShops(g, area);
  if (!shops.length) return 0;
  return shops.reduce((s, sq) => s + sq.price, 0) / shops.length;
}

function stockPriceFromB(avg, B) {
  return Math.max(1, Math.floor((avg / 65536) * (B || 100)));
}

export function updateAreaStockPrices(g) {
  const changes = [];
  for (const a of Object.keys(g.areas).map(Number)) {
    const avg = areaShopAvgPrice(g, a);
    if (!avg) continue;
    const oldPrice = g.areas[a].stockPrice || 0;
    const newPrice = stockPriceFromB(avg, g.areas[a].B);
    if (oldPrice !== newPrice) {
      changes.push({ area: a, oldPrice, newPrice, diff: newPrice - oldPrice });
    }
    g.areas[a].stockPrice = newPrice;
  }
  if (changes.length) applyStockReturnDeltas(g);
  else {
    for (const p of g.players || []) syncStockValueSnap(g, p);
  }
  return changes;
}

/**
 * 株売却後の株価を予測（実際の売却は現行価格で受取→その後 B 低下）。
 * @returns {{ area:number, count:number, proceeds:number, oldPrice:number, newPrice:number, diff:number, drops:boolean, threshold:number }|null}
 */
export function previewStockSell(g, area, count) {
  const a = Number(area);
  const meta = g.areas?.[a];
  if (!meta) return null;
  const avg = areaShopAvgPrice(g, a);
  if (!avg) return null;
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const oldPrice = meta.stockPrice || stockPriceFromB(avg, meta.B);
  const drops = n >= STOCK_SELL_PRESSURE_MIN;
  const nextB = drops
    ? Math.max(100, Math.floor((meta.B || 100) * STOCK_SELL_B_RATE))
    : (meta.B || 100);
  const newPrice = stockPriceFromB(avg, nextB);
  return {
    area: a,
    count: n,
    proceeds: oldPrice * n,
    oldPrice,
    newPrice,
    diff: newPrice - oldPrice,
    drops,
    threshold: STOCK_SELL_PRESSURE_MIN,
  };
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

/** 終了画面用アワード定義（本家のトロフィー／特賞に相当） */
const RESULT_AWARD_DEFS = [
  {
    id: 'landlord',
    title: '物件王',
    desc: 'もっとも多くのお店を所有',
    metric: (row) => row.shopCount,
    format: (v) => `${v}軒`,
  },
  {
    id: 'toll_king',
    title: '売上王',
    desc: '買い物料収入の合計',
    metric: (row) => row.stats.tollEarned,
    format: (v) => `${Number(v).toLocaleString()}G`,
  },
  {
    id: 'big_sale',
    title: '高額請求王',
    desc: '1回の最大買い物料収入',
    metric: (row) => row.stats.tollSaleMax,
    format: (v) => `${Number(v).toLocaleString()}G`,
  },
  {
    id: 'stock_master',
    title: '株の達人',
    desc: '株式資産 No.1',
    metric: (row) => row.assets.stockAsset,
    format: (v) => `${Number(v).toLocaleString()}G`,
  },
  {
    id: 'stock_return',
    title: '相場上手',
    desc: '株価変動の含み益',
    metric: (row) => row.stats.stockReturn,
    format: (v) => `${Number(v).toLocaleString()}G`,
  },
  {
    id: 'monopoly_king',
    title: '独占王',
    desc: 'エリア独占の達成回数',
    metric: (row) => row.stats.monopolyCount,
    format: (v) => `${v}回`,
  },
  {
    id: 'investor',
    title: '増資キャプテン',
    desc: '増資総額 No.1',
    metric: (row) => row.stats.investTotal,
    format: (v) => `${Number(v).toLocaleString()}G`,
  },
  {
    id: 'bank_fav',
    title: '銀行の寵児',
    desc: '昇進賞金の合計',
    metric: (row) => row.stats.salaryEarned,
    format: (v) => `${Number(v).toLocaleString()}G`,
  },
  {
    id: 'scratch_king',
    title: 'スクラッチ王',
    desc: 'スクラッチ回数とそろい',
    metric: (row) => row.stats.scratchCount * 10 + row.stats.matchBonus,
    format: (_v, row) => `${row.stats.scratchCount}回 / そろい${Number(row.stats.matchBonus).toLocaleString()}G`,
  },
  {
    id: 'minigame_king',
    title: 'ミニゲーム王',
    desc: 'ミニゲーム勝利数',
    metric: (row) => row.stats.minigameWins,
    format: (v) => `${v}勝`,
  },
  {
    id: 'cash_rich',
    title: '現金持ち',
    desc: '手元の現金 No.1',
    metric: (row) => Math.max(0, row.assets.cash),
    format: (v) => `${Number(v).toLocaleString()}G`,
  },
  {
    id: 'five_buyer',
    title: '5倍買い名人',
    desc: '5倍買いで奪取した店',
    metric: (row) => row.stats.shopsStolen,
    format: (v) => `${v}軒`,
  },
  {
    id: 'traveler',
    title: '旅人',
    desc: 'サイコロの出目合計',
    metric: (row) => row.stats.diceTotal,
    format: (v) => `${v}`,
  },
  {
    id: 'dividend',
    title: '配当長者',
    desc: '株の配当収入 No.1',
    metric: (row) => row.stats.dividendEarned,
    format: (v) => `${Number(v).toLocaleString()}G`,
  },
  {
    id: 'shopaholic',
    title: 'お買い物上手',
    desc: '買い物料を払った回数',
    metric: (row) => row.stats.tollPayCount,
    format: (v) => `${v}回`,
  },
];

/**
 * 本家風の終了統計を組み立てる。
 * 順位／売上と支払い／資産と給料／特賞
 */
export function buildGameResults(g) {
  recordWorthSnapshot(g);
  const startCash = g.worthHistory?.[0]
    ? Object.values(g.worthHistory[0].values || {})[0]
    : null;

  const rows = (g.players || []).map((p) => {
    const assets = getPlayerAssets(g, p);
    const shopCount = g.map.filter((s) => s.type === 'shop' && s.owner === p.id).length;
    const monopolyAreas = Object.keys(g.areas || {})
      .map(Number)
      .filter((a) => hasAreaMonopoly(g, p.id, a)).length;
    const stats = { ...createEmptyStats(), ...(p.stats || {}) };
    const saleAvg = stats.tollSaleCount > 0
      ? Math.floor(stats.tollEarned / stats.tollSaleCount)
      : 0;
    const payAvg = stats.tollPayCount > 0
      ? Math.floor(stats.tollPaid / stats.tollPayCount)
      : 0;
    const nextSalary = p.bankrupt ? 0 : getLevelBonus(g, p, (p.level || 1) + 1);
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      bankrupt: !!p.bankrupt,
      level: p.level || 1,
      assets,
      shopCount,
      monopolyAreas,
      stats,
      sales: {
        count: stats.tollSaleCount,
        total: stats.tollEarned,
        average: saleAvg,
        greatest: stats.tollSaleMax,
      },
      payments: {
        count: stats.tollPayCount,
        total: stats.tollPaid,
        average: payAvg,
        greatest: stats.tollPayMax,
      },
      stockReturn: stats.stockReturn,
      nextSalary,
      isWinner: g.winnerId === p.id,
    };
  });

  rows.sort((a, b) => {
    if (a.bankrupt !== b.bankrupt) return a.bankrupt ? 1 : -1;
    if (b.assets.total !== a.assets.total) return b.assets.total - a.assets.total;
    if (b.assets.cash !== a.assets.cash) return b.assets.cash - a.assets.cash;
    return a.id - b.id;
  });

  const ranking = rows.map((row, i) => ({ ...row, rank: i + 1 }));
  const maxTotal = Math.max(
    1,
    g.goal || 1,
    ...ranking.map((r) => Math.max(0, r.assets.total)),
    ...(g.worthHistory || []).flatMap((h) => Object.values(h.values || {}).map((n) => Math.max(0, n))),
  );

  const awards = [];
  for (const def of RESULT_AWARD_DEFS) {
    let best = null;
    let bestVal = -Infinity;
    for (const row of ranking) {
      if (row.bankrupt) continue;
      const v = Number(def.metric(row)) || 0;
      if (v > bestVal) {
        bestVal = v;
        best = row;
      }
    }
    if (!best || bestVal <= 0) continue;
    awards.push({
      id: def.id,
      title: def.title,
      desc: def.desc,
      playerId: best.id,
      playerName: best.name,
      playerColor: best.color,
      value: bestVal,
      valueLabel: def.format(bestVal, best),
    });
  }

  return {
    winnerId: g.winnerId,
    ranking,
    awards,
    maxTotal,
    goal: g.goal,
    turn: g.turn || 1,
    startCash: startCash ?? ranking[0]?.assets?.cash ?? 0,
    worthHistory: (g.worthHistory || []).map((h) => ({
      turn: h.turn,
      values: { ...h.values },
    })),
  };
}

/** 店を半分価格で売却したときの合計 */
export function getShopFireSaleValue(g, p) {
  return g.map
    .filter((s) => s.type === 'shop' && s.owner === p.id)
    .reduce((s, sq) => s + Math.floor(sq.price * 0.5), 0);
}

/** 現金＋株＋店売却見込み */
export function getLiquidatableValue(g, p) {
  return p.cash + getPlayerAssets(g, p).stockAsset + getShopFireSaleValue(g, p);
}

/**
 * マーク揃え昇進の賞金（レベルのみ。誰が取っても同額）。
 * @param {number|null} [toLevel] 昇進後レベル（省略時は現在レベル基準＝イベント用）
 */
export function getLevelBonus(_g, p, toLevel = null) {
  const lv = Math.max(1, Number(toLevel != null ? toLevel : p?.level) || 1);
  // 昇進先が高いほど厚い（Lv2:700 / Lv3:950 / Lv4:1200 …）
  return 200 + 250 * lv;
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
  refreshGoalPressure(g);
  return JSON.parse(JSON.stringify({
    map: g.map,
    areas: g.areas,
    mapId: g.mapId || DEFAULT_MAP_ID,
    mapName: g.mapName || '',
    switchState: g.switchState ? 1 : 0,
    switchGates: g.switchGates || [],
    switchMoves: g.switchMoves || [],
    cols: g.cols,
    rows: g.rows,
    startId: g.startId,
    goal: g.goal,
    players: g.players,
    currentPlayerIdx: g.currentPlayerIdx,
    phase: g.phase,
    pending: g.pending,
    dice: g.dice,
    move: g.move,
    logs: g.logs.slice(0, 30),
    winnerId: g.winnerId,
    turn: g.turn,
    goalPressure: !!g.goalPressure,
    worthHistory: (g.worthHistory || []).slice(-80),
    _seed: g._seed,
    _rngCount: g._rngCount,
    sharedEventTable: g.sharedEventTable,
  }));
}

export function getSharedEventTable(g) {
  if (g.sharedEventTable) return g.sharedEventTable;
  const legacy = g.players.find((p) => p.eventTable)?.eventTable;
  if (legacy) {
    g.sharedEventTable = legacy;
    return legacy;
  }
  g.sharedEventTable = createEventTable((g._seed >>> 0) + 7771);
  return g.sharedEventTable;
}

export function restoreState(data) {
  const g = { ...data };
  for (const p of g.players || []) ensureStats(p);
  // 再接続・旧状態で未知色が残っていてもパレットへ寄せる
  if (Array.isArray(g.players) && g.players.length) {
    const normalized = normalizeLobbyColors(g.players);
    g.players = g.players.map((p, i) => ({ ...p, color: normalized[i].color }));
  }
  if (!Array.isArray(g.switchGates)) g.switchGates = [];
  if (!Array.isArray(g.switchMoves)) g.switchMoves = [];
  g.switchState = g.switchState ? 1 : 0;
  applySwitchState(g);
  return g;
}

/** 後退を除いた前進候補。行き止まりなら全方向を許可。 */
export function getForwardNexts(g, pos, prevPos) {
  const node = getNode(g, pos);
  if (!node) return [];
  const raw = node.nexts || [];
  if (prevPos == null) return [...raw];
  const fwd = raw.filter((id) => id !== prevPos);
  return fwd.length > 0 ? fwd : [...raw];
}

function onPassThrough(g, p, nodeId) {
  const nd = getNode(g, nodeId);
  if (!nd) return;
  if (nd.type === 'mark' && !p.marks[nd.mark]) {
    p.marks[nd.mark] = true;
    addLog(g, `${p.name} が通過で ${SUIT_LABELS[nd.mark]} を入手！`, 'mark');
  }
  // 銀行処理は advanceMove / resolveLanding 側で一度だけ行う
}

function setForkPending(g, p, options) {
  const from = getNode(g, p.pos);
  g.phase = 'await_fork';
  g.pending = {
    type: 'fork',
    playerId: p.id,
    options: options.map((id) => {
      const to = getNode(g, id);
      const dc = (to?.col ?? 0) - (from?.col ?? 0);
      const dr = (to?.row ?? 0) - (from?.row ?? 0);
      let side = 'center';
      if (Math.abs(dc) >= Math.abs(dr)) side = dc > 0 ? 'right' : 'left';
      else side = dr > 0 ? 'down' : 'up';
      return {
        id,
        label: to?.forkAs || dirLabel(from, to),
        dest: to?.label || `#${id}`,
        side,
      };
    }),
    stepsLeft: g.move.stepsLeft,
  };
}

function finishMove(g, p) {
  g.pending = null;
  const passedBank = !!g.move?.passedBank;
  const path = g.move?.path || [];
  g.move = null;
  resolveLanding(g, p, { passedBank });
  const warps = takeWarpFx(g);
  const switchMoves = takeSwitchFx(g);
  return { ok: true, done: true, forked: false, path, warps, switchMoves, state: serializeState(g) };
}

function applyStep(g, p, nextId) {
  const from = p.pos;
  p.prevPos = p.pos;
  p.pos = nextId;
  g.move.stepsLeft--;
  g.move.path.push(nextId);
  if (nextId === g.startId) g.move.passedBank = true;
  onPassThrough(g, p, nextId);
  return from;
}

/**
 * 1歩だけ進める。分岐なら await_fork、歩数終了なら着地解決。
 * UI側でダイス演出のあと、この関数を間を空けて呼ぶ。
 */
export function advanceMove(g) {
  const p = currentPlayer(g);
  if (!p || !g.move) return { ok: false, error: 'no_move' };
  if (g.phase === 'await_fork') return { ok: false, error: 'need_fork' };
  if (g.phase === 'gameover') return { ok: true, done: true, state: serializeState(g) };

  if (g.move.stepsLeft <= 0) return finishMove(g, p);

  const options = getForwardNexts(g, p.pos, p.prevPos);
  if (options.length === 0) return finishMove(g, p);

  if (options.length > 1) {
    setForkPending(g, p, options);
    return { ok: true, forked: true, done: false, state: serializeState(g) };
  }

  const nextId = options[0];
  const from = applyStep(g, p, nextId);
  g.pending = null;
  if (g.phase !== 'gameover') g.phase = 'moving';

  if (g.phase === 'gameover') {
    g.move = null;
    return { ok: true, stepped: true, from, to: nextId, done: true, state: serializeState(g) };
  }
  if (g.move.stepsLeft <= 0) return { ...finishMove(g, p), stepped: true, from, to: nextId };

  // 銀行を通過（まだ歩数が残る）→ 昇進 → 株1種 → 進行方向
  if (nextId === g.startId && from !== g.startId) {
    const interrupted = beginBankVisit(g, p, { landed: false, resumeMove: true });
    if (interrupted) {
      return {
        ok: true,
        stepped: true,
        from,
        to: nextId,
        done: false,
        bankInterrupt: true,
        state: serializeState(g),
      };
    }
  }

  return {
    ok: true,
    stepped: true,
    from,
    to: nextId,
    done: false,
    stepsLeft: g.move.stepsLeft,
    state: serializeState(g),
  };
}

/** 互換: 分岐か終了まで一気に進める（テスト用） */
export function continueMove(g) {
  let last = { ok: true };
  while (
    g.move
    && g.phase !== 'await_fork'
    && g.phase !== 'await_choice'
    && g.phase !== 'gameover'
  ) {
    last = advanceMove(g);
    if (!last.ok || last.done || last.forked || last.bankInterrupt) break;
  }
  return { ...last, state: serializeState(g) };
}

/** 分岐選択後に1歩進める（続きは advanceMove で） */
export function chooseFork(g, nextId) {
  if (g.phase !== 'await_fork' || !g.pending || g.pending.type !== 'fork') {
    return { ok: false, error: 'no_fork' };
  }
  const p = currentPlayer(g);
  const allowed = (g.pending.options || []).map((o) => o.id);
  if (!allowed.includes(nextId)) return { ok: false, error: 'bad_fork' };

  const from = applyStep(g, p, nextId);
  const dest = getNode(g, nextId);
  // forkAs（例: 北埠頭へ）を優先。label「もう一回」だと通過時に再挑戦と誤解される
  const way = dest?.forkAs || dest?.label || nextId;
  addLog(g, `${p.name} は「${way}」方面へ`, 'dice');
  g.pending = null;
  if (g.phase !== 'gameover') g.phase = 'moving';

  if (g.phase === 'gameover') {
    g.move = null;
    return { ok: true, stepped: true, from, to: nextId, done: true, state: serializeState(g) };
  }
  if (g.move.stepsLeft <= 0) return { ...finishMove(g, p), stepped: true, from, to: nextId };

  if (nextId === g.startId && from !== g.startId) {
    const interrupted = beginBankVisit(g, p, { landed: false, resumeMove: true });
    if (interrupted) {
      return {
        ok: true,
        stepped: true,
        from,
        to: nextId,
        done: false,
        bankInterrupt: true,
        state: serializeState(g),
      };
    }
  }

  return {
    ok: true,
    stepped: true,
    from,
    to: nextId,
    done: false,
    stepsLeft: g.move.stepsLeft,
    state: serializeState(g),
  };
}

/** サイコロを振る（移動は開始せず、演出後に advanceMove） */
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

  // 店休は自分のターン開始で解除（1ターン休み）
  if (p.shopsClosed) {
    p.shopsClosed = false;
    addLog(g, `${p.name} のお店が営業再開`, 'system');
  }

  // ラッキーは「次の自分の番まで」。自分のターン開始で期限切れ
  if (p.flags?.luckyExpireOnTurn) {
    p.flags.luckyExpireOnTurn = false;
    if (p.lucky) {
      p.lucky = false;
      addLog(g, `${p.name} のラッキーステータスが切れた`, 'system');
    }
  }

  // 銀行にいるときは出発方向を自由に選べる
  if (p.pos === g.startId) p.prevPos = null;

  const d = Math.floor(rngNext(g) * 6) + 1;
  g.dice = d;
  g.phase = 'moving';
  g.move = { stepsLeft: d, path: [], passedBank: false, startPos: p.pos };
  bumpStat(p, 'rolls', 1);
  bumpStat(p, 'diceTotal', d);
  // 出目数値は演出後に UI が表示。ログも演出中のネタバレを避けるため「？」で残し、UI が確定後に見せる
  addLog(g, `${p.name} がサイコロを振った`, 'dice');

  return { ok: true, dice: d, needsAdvance: true, state: serializeState(g) };
}

function resolveLanding(g, p, { passedBank, fromWarp = false } = {}) {
  const landedOnBank = p.pos === g.startId;

  // 銀行にぴったり停止（通過割込み済みなら二重処理しない）
  if (landedOnBank && !p.flags.bankVisitDone) {
    beginBankVisit(g, p, { landed: true, resumeMove: false });
    if (g.phase === 'gameover' || g.phase === 'await_choice') return;
  } else if (passedBank && !landedOnBank && !p.flags.bankVisitDone) {
    // 通過割込みなしで着地した場合のフォールバック
    beginBankVisit(g, p, { landed: false, resumeMove: false });
    if (g.phase === 'gameover' || g.phase === 'await_choice') return;
  }

  const sq = getNode(g, p.pos);
  if (!sq) {
    finishLanding(g, p);
    return;
  }

  if (sq.type === 'junction') {
    addLog(g, `${p.name} は分岐点に停止`, 'system');
    finishLanding(g, p);
    return;
  }

  if (sq.type === 'warp') {
    if (fromWarp) {
      addLog(g, `${p.name} はワープマスに停止`, 'system');
      finishLanding(g, p);
      return;
    }
    const dest = getNode(g, sq.warpTo);
    if (!dest) {
      addLog(g, `${p.name} のワープ先が見つからない…`, 'system');
      finishLanding(g, p);
      return;
    }
    const fromId = p.pos;
    recordWarp(g, p.id, fromId, dest.id);
    p.prevPos = null;
    p.pos = dest.id;
    addLog(g, `${p.name} がワープ！ ${sq.label} → ${dest.label}`, 'event');
    resolveLanding(g, p, { passedBank: false, fromWarp: true });
    return;
  }

  if (sq.type === 'switch') {
    const next = toggleBoardSwitch(g);
    addLog(
      g,
      `${p.name} がスイッチを倒した！ 経路が切り替わった（状態${next + 1}）`,
      'event',
    );
    finishLanding(g, p);
    return;
  }

  if (sq.type === 'mark') {
    if (!p.marks[sq.mark]) {
      p.marks[sq.mark] = true;
      addLog(g, `${p.name} が ${SUIT_LABELS[sq.mark]} を入手！`, 'mark');
    } else {
      addLog(g, `${p.name} は ${SUIT_LABELS[sq.mark]} マスにぴったり停止`, 'mark');
    }
    openScratch(g, p);
    return;
  }

  if (sq.type === 'minigame') {
    const game = sq.game || 'guess_dice';
    const label = sq.label || 'ミニゲーム';
    p.flags.pendingMinigame = { game, label };
    addLog(g, `${p.name} がミニゲームマス「${label}」に停止`, 'event');
    maybeOpenMinigame(g, p);
    return;
  }

  // 旧セーブ互換（盤面からは廃止）
  if (sq.type === 'rest') {
    p.resting = true;
    addLog(g, `${p.name} は休憩マス。次ターン休み`, 'system');
    finishLanding(g, p);
    return;
  }

  if (sq.type === 'holiday') {
    p.shopsClosed = true;
    addLog(g, `${p.name} は店休マス。お店が1ターン休み（買い物料0）`, 'event');
    finishLanding(g, p);
    return;
  }

  if (sq.type === 'scratch') {
    addLog(g, `${p.name} がスクラッチマスに停止`, 'event');
    openScratch(g, p);
    return;
  }

  if (sq.type === 'event') {
    const ev = BOARD_EVENTS[Math.floor(rngNext(g) * BOARD_EVENTS.length)];
    const detail = ev.apply(g, p);
    addLog(g, `イベント！ ${ev.label}（${detail}）`, 'event');
    if (maybeOpenMinigame(g, p)) return;
    if (p.flags.extraRoll) {
      p.flags.extraRoll = false;
      g.phase = 'await_roll';
      return;
    }
    finishLanding(g, p);
    return;
  }

  if (sq.type === 'lucky') {
    grantLucky(p);
    addLog(g, `${p.name} がラッキーステータス獲得！（他者の買い物料の20%を銀行から／次の自分の番まで）`, 'event');
    finishLanding(g, p);
    return;
  }

  if (sq.type === 'rollon') {
    addLog(g, `${p.name} もう一回サイコロ！`, 'dice');
    g.phase = 'await_roll';
    return;
  }

  if (sq.type === 'suit_fill') {
    const missing = p.marks.findIndex((m) => !m);
    if (missing >= 0) {
      p.marks[missing] = true;
      addLog(g, `${p.name} が足りないマーク ${SUIT_LABELS[missing]} を入手！`, 'mark');
    } else {
      addLog(g, `${p.name} はすでに全マーク所持`, 'mark');
    }
    finishLanding(g, p);
    return;
  }

  if (sq.type === 'chance') {
    const ev = CHANCE_EVENTS[Math.floor(rngNext(g) * CHANCE_EVENTS.length)];
    const detail = ev.apply(g, p);
    addLog(g, `チャンス！ ${ev.label}（${detail}）`, 'event');
    if (maybeOpenMinigame(g, p)) return;
    if (ev.id === 'warp_bank' && !p.flags.bankVisitDone) {
      beginBankVisit(g, p, { landed: true, resumeMove: false });
      if (g.phase === 'gameover' || g.phase === 'await_choice') return;
    }
    finishLanding(g, p);
    return;
  }

  if (sq.type === 'stockbroker') {
    g.phase = 'await_choice';
    // 証券でも1回の訪問で買えるのは1種類のみ
    g.pending = { type: 'stock', playerId: p.id, broker: true, maxBuys: 1 };
    return;
  }

  // 銀行マス着地は beginBankVisit 済み
  if (sq.type === 'bank') return;

  if (sq.type === 'shop') {
    resolveShop(g, p, sq);
    return;
  }

  finishLanding(g, p);
}

/** 着地後の共通締め */
function finishLanding(g, p) {
  if (g.phase === 'gameover') return;
  if (g.phase === 'await_choice') return;
  endTurn(g);
}

/**
 * 銀行訪問フロー。
 * resumeMove: 通過中（歩数残りあり）→ 昇進 → 株1種 → 進行方向選択 → 移動再開
 * landed: 銀行に停止 → 昇進 → 株1種（持ち金の限り）→ ターン終了
 */
function beginBankVisit(g, p, { landed, resumeMove }) {
  if (p.flags.bankVisitDone) return false;
  p.flags.bankVisitDone = true;

  handleBank(g, p, landed);
  if (g.phase === 'gameover') return true;

  const next = {
    thenBankStock: true,
    atBank: !!landed,
    resumeMove: !!resumeMove,
  };

  if (p.flags.pendingLevelUp) {
    openLevelUp(g, p, next);
    return true;
  }
  openBankStock(g, p, next);
  return true;
}

function openLevelUp(g, p, next = {}) {
  const info = p.flags.pendingLevelUp;
  if (!info) {
    if (next.thenBankStock) {
      openBankStock(g, p, next);
      return;
    }
    if (next.resumeMove) {
      resumeMoveAfterBank(g, p);
      return;
    }
    endTurn(g);
    return;
  }
  p.flags.pendingLevelUp = null;
  g.phase = 'await_choice';
  g.pending = {
    type: 'level_up',
    playerId: p.id,
    from: info.from,
    to: info.to,
    bonus: info.bonus,
    thenBankStock: next.thenBankStock !== false,
    atBank: !!next.atBank,
    resumeMove: !!next.resumeMove,
  };
}

/** 銀行：株を1種類・持ち金の限り購入 */
function openBankStock(g, p, next = {}) {
  p.flags.bankPassStock = false;
  g.phase = 'await_choice';
  g.pending = {
    type: 'stock',
    playerId: p.id,
    atBank: !!next.atBank,
    bankVisit: true,
    maxBuys: 1,
    buysUsed: 0,
    resumeMove: !!next.resumeMove,
  };
  addLog(
    g,
    next.resumeMove
      ? `${p.name} は銀行通過 — 株を1種類（持ち金の限り）買えます`
      : `${p.name} は銀行 — 株を1種類（持ち金の限り）買えます`,
    'stock',
  );
}

/** 銀行通過後：進行方向を選んで移動再開 */
function resumeMoveAfterBank(g, p) {
  if (!g.move || g.move.stepsLeft <= 0) {
    g.move = null;
    endTurn(g);
    return;
  }
  const options = getForwardNexts(g, p.pos, p.prevPos);
  if (options.length === 0) {
    finishMove(g, p);
    return;
  }
  if (options.length > 1) {
    setForkPending(g, p, options);
    addLog(g, `${p.name} は銀行を出てどちらへ進む？`, 'dice');
    return;
  }
  g.phase = 'moving';
  g.pending = null;
}

function handleBank(g, p, landed) {
  // 昇進前の総資産（昇進賞金で初めて目標到達した場合は再通過が必要）
  const hadGoalBefore = getPlayerAssets(g, p).total >= g.goal;
  let leveledUp = false;
  if (hasFullMarks(p)) {
    const old = p.level;
    const to = old + 1;
    const bonus = getLevelBonus(g, p, to);
    p.cash += bonus;
    bumpStat(p, 'salaryEarned', bonus);
    bumpStat(p, 'levelUps', 1);
    p.level = to;
    p.marks = [false, false, false, false];
    p.flags.pendingLevelUp = { from: old, to, bonus };
    leveledUp = true;
    addLog(g, `${p.name} 昇進！ Lv.${old}→${to} 賞金 +${bonus}G（Lv.${to}基準）`, 'level');
  }

  // 目標到達済みなら停止でも通過でもゴール。
  // ただしこの訪問の昇進賞金で初めて到達した場合は、いったん離れて再通過が必要。
  const assets = getPlayerAssets(g, p);
  if (assets.total >= g.goal) {
    if (leveledUp && !hadGoalBefore) {
      addLog(
        g,
        `${p.name} が昇進で目標資産に到達！ いったん銀行を出て、もう一度銀行を通過（または停止）で勝利`,
        'level',
      );
      refreshGoalPressure(g);
      return false;
    }
    g.winnerId = p.id;
    g.phase = 'gameover';
    addLog(
      g,
      landed
        ? `🏆 ${p.name} の勝利！ 総資産 ${assets.total.toLocaleString()}G`
        : `🏆 ${p.name} の勝利！ 銀行通過でゴール（総資産 ${assets.total.toLocaleString()}G）`,
      'win',
    );
    recordWorthSnapshot(g);
    return true;
  }
  return false;
}

function openScratch(g, p) {
  const table = getSharedEventTable(g);
  const open = unscratchedIds(table);
  if (!open.length) {
    addLog(g, `${p.name} のイベント表はすべてスクラッチ済み`, 'event');
    endTurn(g);
    return;
  }
  g.phase = 'await_choice';
  g.pending = { type: 'scratch', playerId: p.id, openIds: open };
  addLog(g, `${p.name} がイベント表をスクラッチ！`, 'event');
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
    const ownShops = g.map.filter((s) => s.type === 'shop' && s.owner === p.id);
    const rem = getRemainingInvest(g, sq);
    g.phase = 'await_choice';
    g.pending = {
      type: 'invest',
      playerId: p.id,
      shopId: sq.id, // 止まった店（初期選択）
      landedShopId: sq.id,
      shopIds: ownShops.map((s) => s.id),
      remaining: rem,
      toll: calcToll(g, sq),
    };
    return;
  }

  // 他プレイヤーの店 → 買い物料（店休なら0）
  const toll = calcToll(g, sq);
  if (toll <= 0) {
    addLog(g, `${g.players[sq.owner]?.name || '店主'}のお店は休み中（買い物料0）`, 'system');
    endTurn(g);
    return;
  }
  payToll(g, p, sq);
}

function payToll(g, payer, sq) {
  const owner = g.players[sq.owner];
  let toll = calcToll(g, sq);

  // スクラッチ等の通行守り
  if (payer.flags?.tollShield) {
    payer.flags.tollShield = false;
    addLog(g, `${payer.name} の通行守りで買い物料0！`, 'event');
    endTurn(g);
    return;
  }
  // 家主側の買い物料アップ
  if (owner?.flags?.tollBoost) {
    owner.flags.tollBoost = false;
    toll = Math.floor(toll * 1.5);
    addLog(g, `${owner.name} の家主印章で買い物料アップ！`, 'event');
  }

  // ラッキー：支払い当事者以外が、買い物料の20%を銀行から受取
  for (const lp of g.players) {
    if (lp.lucky && lp.id !== payer.id && lp.id !== owner.id && !lp.bankrupt) {
      const tip = Math.floor(toll * 0.2);
      if (tip <= 0) continue;
      lp.cash += tip;
      bumpStat(lp, 'luckyIncome', tip);
      addLog(g, `${lp.name} のラッキー！ 買い物料の20% +${tip.toLocaleString()}G（銀行から）`, 'event');
    }
  }

  // 料金は全額支払い（所持金はマイナスになり得る）。自動売却はしない
  payer.cash -= toll;
  owner.cash += toll;
  bumpStat(payer, 'tollPaid', toll);
  bumpStat(payer, 'tollPayCount', 1);
  const payerStats = ensureStats(payer);
  if (toll > (payerStats.tollPayMax || 0)) payerStats.tollPayMax = toll;
  bumpStat(owner, 'tollEarned', toll);
  bumpStat(owner, 'tollSaleCount', 1);
  const ownerStats = ensureStats(owner);
  if (toll > (ownerStats.tollSaleMax || 0)) ownerStats.tollSaleMax = toll;
  addLog(g, `${payer.name} → ${owner.name}「${sq.label}」買い物料 ${toll.toLocaleString()}G`, 'toll');

  // 同エリアの株保有者へ、収益の一部をわけ前（銀行から）
  payAreaStockDividend(g, sq.area, toll);

  if (payer.cash < 0) {
    openRaiseFunds(g, payer, {
      targetCash: 0,
      reason: 'toll',
      resume: { type: 'after_toll', shopId: sq.id, toll },
    });
    return;
  }

  offerFiveBuyOrEnd(g, payer, sq, toll);
}

function fiveBuyMultiplier(p) {
  return p?.flags?.fiveBuyCoupon ? 3 : 5;
}

function offerFiveBuyOrEnd(g, payer, sq, toll) {
  if (payer.bankrupt || g.phase === 'gameover') {
    endTurn(g);
    return;
  }
  const multi = fiveBuyMultiplier(payer);
  const five = sq.price * multi;
  const liq = getLiquidatableValue(g, payer);
  if (liq >= five) {
    g.phase = 'await_choice';
    g.pending = {
      type: 'five_buy',
      playerId: payer.id,
      shopId: sq.id,
      price: five,
      multi,
      toll,
    };
    return;
  }
  endTurn(g);
}

function openRaiseFunds(g, p, { targetCash, reason, resume }) {
  g.phase = 'await_choice';
  g.pending = {
    type: 'raise_funds',
    playerId: p.id,
    targetCash: Number(targetCash) || 0,
    reason: reason || 'debt',
    resume: resume || null,
  };
  addLog(g, `${p.name} は資金調達が必要（目標 ${Number(targetCash).toLocaleString()}G）`, 'system');
}

function sellShopForCash(g, p, shopId) {
  const sq = getNode(g, shopId);
  if (!sq || sq.type !== 'shop' || sq.owner !== p.id) return { ok: false, error: 'bad_shop' };
  const got = Math.floor(sq.price * 0.5);
  const area = sq.area;
  p.cash += got;
  sq.owner = -1;
  sq.extraInvest = 0;
  sq.price = sq.basePrice;
  const brk = applyMonopolyBreak(g, p.id, area);
  if (!brk) updateAreaStockPrices(g);
  addLog(g, `${p.name} が「${sq.label}」を売却（+${got}G）`, 'system');
  return { ok: true, got, monopolyBreak: brk || undefined };
}

function sellStockForCash(g, p, area, count) {
  const a = Number(area);
  const have = p.stocks[a] || 0;
  const n = Math.max(1, Math.min(have, Number(count) || 1));
  if (n <= 0 || !g.areas[a]) return { ok: false, error: 'no_stock' };
  const got = g.areas[a].stockPrice * n;
  p.stocks[a] -= n;
  p.cash += got;
  bumpStat(p, 'stockSold', n);
  bumpStat(p, 'stockIncome', got);
  syncStockValueSnap(g, p);
  if (n >= STOCK_SELL_PRESSURE_MIN) {
    g.areas[a].B = Math.max(100, Math.floor(g.areas[a].B * STOCK_SELL_B_RATE));
  }
  updateAreaStockPrices(g);
  addLog(g, `${p.name} が A${a}株×${n} 売却（+${got}G）`, 'stock');
  return { ok: true, got };
}

export function declareBankrupt(g, p) {
  p.cash = 0;
  p.bankrupt = true;
  p.offline = false;
  p.peerId = null;
  p.isCPU = false;
  const claimedAreas = Object.keys(p.flags?.monopolyBonusClaimed || {}).map(Number);
  for (const sq of g.map.filter((s) => s.type === 'shop' && s.owner === p.id)) {
    sq.owner = -1;
    sq.extraInvest = 0;
    sq.price = sq.basePrice;
  }
  p.stocks = {};
  for (const area of claimedAreas) applyMonopolyBreak(g, p.id, area);
  addLog(g, `${p.name} が破産…`, 'system');
  updateAreaStockPrices(g);
}

/** 切断プレイヤーをCPUに切り替えて進行を続ける */
export function convertPlayerToCpu(g, pid) {
  const p = g.players[pid];
  if (!p || p.bankrupt) return { ok: false, error: 'invalid' };
  p.isCPU = true;
  p.offline = false;
  p.peerId = null;
  if (!p.personality) {
    p.personality = CPU_PERSONALITY_KEYS[pid % CPU_PERSONALITY_KEYS.length];
  }
  if (!p.flags) p.flags = {};
  p.flags.reclaimableHuman = true;
  addLog(g, `${p.name} をCPUに切り替え（同じ名前で再接続可）`, 'system');
  return { ok: true, state: serializeState(g) };
}

/** 切断プレイヤーをキック（破産）して進行を続ける */
export function kickDisconnectedPlayer(g, pid) {
  const p = g.players[pid];
  if (!p || p.bankrupt) return { ok: false, error: 'invalid' };
  addLog(g, `${p.name} をキック`, 'system');
  declareBankrupt(g, p);
  if (g.pending?.playerId === pid) {
    g.pending = null;
    g.phase = 'await_roll';
  }
  if (g.currentPlayerIdx === pid || g.players.filter((x) => !x.bankrupt).length <= 1) {
    endTurn(g);
  }
  return { ok: true, state: serializeState(g) };
}

function resumeAfterRaiseFunds(g, p, resume) {
  if (!resume) {
    endTurn(g);
    return;
  }
  if (resume.type === 'after_toll') {
    const sq = getNode(g, resume.shopId);
    if (sq) offerFiveBuyOrEnd(g, p, sq, resume.toll || 0);
    else endTurn(g);
    return;
  }
  if (resume.type === 'five_buy') {
    g.phase = 'await_choice';
    g.pending = {
      type: 'five_buy',
      playerId: p.id,
      shopId: resume.shopId,
      price: resume.price,
      multi: resume.multi || 5,
      toll: resume.toll,
    };
    return;
  }
  if (resume.type === 'buy_shop') {
    g.phase = 'await_choice';
    g.pending = {
      type: 'buy_shop',
      playerId: p.id,
      shopId: resume.shopId,
      price: resume.price,
    };
    return;
  }
  if (resume.type === 'invest') {
    const ownShops = g.map.filter((s) => s.type === 'shop' && s.owner === p.id);
    const landedId = resume.landedShopId ?? resume.shopId;
    g.phase = 'await_choice';
    g.pending = {
      type: 'invest',
      playerId: p.id,
      shopId: landedId,
      landedShopId: landedId,
      shopIds: resume.shopIds?.length ? resume.shopIds : ownShops.map((s) => s.id),
      remaining: resume.remaining,
      toll: resume.toll,
    };
    return;
  }
  endTurn(g);
}

/** プレイヤー選択の解決 */
export function applyChoice(g, choice) {
  if (g.phase === 'await_fork' && g.pending?.type === 'fork') {
    return chooseFork(g, Number(choice.nextId));
  }

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
      if (getLiquidatableValue(g, p) < sq.price) {
        return { ok: false, error: 'insufficient' };
      }
      if (p.cash < sq.price) {
        openRaiseFunds(g, p, {
          targetCash: sq.price,
          reason: 'buy_shop',
          resume: { type: 'buy_shop', shopId: sq.id, price: sq.price },
        });
        return { ok: true, needFunds: true, state: serializeState(g) };
      }
      p.cash -= sq.price;
      sq.owner = p.id;
      bumpStat(p, 'shopsBought', 1);
      updateAreaStockPrices(g);
      addLog(g, `${p.name} が「${sq.label}」を購入（${sq.price}G）`, 'shop');
      const mono = tryGrantMonopolyBonus(g, p, sq.area);
      g.pending = null;
      endTurn(g);
      return { ok: true, ...(mono || {}), state: serializeState(g) };
    } else {
      addLog(g, `${p.name} は「${sq.label}」の購入を見送り`, 'system');
    }
    g.pending = null;
    endTurn(g);
    return { ok: true, state: serializeState(g) };
  }

  if (pending.type === 'invest') {
    if (choice.action === 'invest') {
      const shopId = Number(choice.shopId ?? pending.shopId);
      const sq = getNode(g, shopId);
      if (!sq || sq.type !== 'shop' || sq.owner !== p.id) {
        return { ok: false, error: 'bad_shop' };
      }
      const rem = getRemainingInvest(g, sq);
      let amount = Math.max(0, Math.min(Number(choice.amount) || 0, rem));
      const pay = p.flags.investCoupon ? Math.ceil(amount / 2) : amount;
      if (amount > 0 && getLiquidatableValue(g, p) < pay) {
        return { ok: false, error: 'insufficient' };
      }
      if (amount > 0 && p.cash < pay) {
        openRaiseFunds(g, p, {
          targetCash: pay,
          reason: 'invest',
          resume: {
            type: 'invest',
            shopId: sq.id,
            landedShopId: pending.landedShopId ?? pending.shopId,
            shopIds: pending.shopIds,
            remaining: rem,
            toll: pending.toll,
            amount,
          },
        });
        return { ok: true, needFunds: true, state: serializeState(g) };
      }
      if (amount > 0) {
        const usedCoupon = !!p.flags.investCoupon;
        if (usedCoupon) p.flags.investCoupon = false;
        p.cash -= pay;
        sq.extraInvest += amount;
        sq.price += amount;
        bumpStat(p, 'investTotal', amount);
        updateAreaStockPrices(g);
        addLog(
          g,
          `${p.name} が「${sq.label}」に ${amount}G 増資${usedCoupon ? '（半額クーポン）' : ''}`,
          'shop'
        );
      }
    }
    g.pending = null;
    endTurn(g);
    return { ok: true, state: serializeState(g) };
  }

  if (pending.type === 'five_buy') {
    const sq = getNode(g, pending.shopId);
    if (choice.action === 'buy') {
      const multi = pending.multi || fiveBuyMultiplier(p);
      const price = Number(pending.price) || sq.price * multi;
      if (getLiquidatableValue(g, p) < price) {
        return { ok: false, error: 'insufficient' };
      }
      if (p.cash < price) {
        openRaiseFunds(g, p, {
          targetCash: price,
          reason: 'five_buy',
          resume: {
            type: 'five_buy',
            shopId: sq.id,
            price,
            multi,
            toll: pending.toll,
          },
        });
        return { ok: true, needFunds: true, state: serializeState(g) };
      }
      if (p.cash >= price) {
        const owner = g.players[sq.owner];
        const prevOwnerId = sq.owner;
        const area = sq.area;
        const usedCoupon = !!p.flags.fiveBuyCoupon && multi < 5;
        if (usedCoupon) p.flags.fiveBuyCoupon = false;
        p.cash -= price;
        if (owner) owner.cash += Math.floor(price * 0.6);
        sq.owner = p.id;
        sq.extraInvest = 0;
        sq.price = sq.basePrice;
        bumpStat(p, 'shopsStolen', 1);
        let monopolyBreak = null;
        if (prevOwnerId >= 0 && prevOwnerId !== p.id) {
          monopolyBreak = applyMonopolyBreak(g, prevOwnerId, area);
        }
        if (!monopolyBreak) updateAreaStockPrices(g);
        addLog(
          g,
          `${p.name} が${multi}倍買いで「${sq.label}」を奪取！${usedCoupon ? '（クーポン）' : ''}`,
          'shop',
        );
        const mono = tryGrantMonopolyBonus(g, p, area);
        g.pending = null;
        endTurn(g);
        return {
          ok: true,
          fiveBuy: true,
          fiveBuyShop: sq.label,
          fiveBuyMulti: multi,
          fiveBuyPlayerId: p.id,
          fiveBuyCoupon: usedCoupon,
          ...(monopolyBreak ? { monopolyBreak } : {}),
          ...(mono || {}),
          state: serializeState(g),
        };
      }
    }
    g.pending = null;
    endTurn(g);
    return { ok: true, state: serializeState(g) };
  }

  if (pending.type === 'raise_funds') {
    const target = Number(pending.targetCash) || 0;
    if (choice.action === 'sell_stock') {
      const r = sellStockForCash(g, p, choice.area, choice.count);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, state: serializeState(g) };
    }
    if (choice.action === 'sell_shop') {
      const r = sellShopForCash(g, p, Number(choice.shopId));
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, state: serializeState(g) };
    }
    if (choice.action === 'bankrupt') {
      declareBankrupt(g, p);
      g.pending = null;
      endTurn(g);
      return { ok: true, bankrupt: true, state: serializeState(g) };
    }
    if (choice.action === 'cancel') {
      // 売却済みの現金は残し、元の購入/5倍買いは取りやめてターン終了
      // 料金不足（after_toll）は負債解消まで閉じられない（pending を消さない）
      const resume = pending.resume;
      if (resume?.type === 'after_toll' && p.cash < target) {
        return { ok: false, error: 'still_short', state: serializeState(g) };
      }
      g.pending = null;
      if (resume?.type === 'after_toll' && p.cash >= target) {
        resumeAfterRaiseFunds(g, p, resume);
        return { ok: true, state: serializeState(g) };
      }
      endTurn(g);
      return { ok: true, cancelled: true, state: serializeState(g) };
    }
    if (choice.action === 'continue') {
      if (p.cash < target) return { ok: false, error: 'still_short' };
      const resume = pending.resume;
      g.pending = null;
      // 調達後に元の行動へ戻す（5倍買いなど）
      if (resume?.type === 'five_buy' && choice.execute) {
        g.pending = {
          type: 'five_buy',
          playerId: p.id,
          shopId: resume.shopId,
          price: resume.price,
          multi: resume.multi || 5,
          toll: resume.toll,
        };
        return applyChoice(g, { action: 'buy' });
      }
      if (resume?.type === 'buy_shop' && choice.execute) {
        g.pending = {
          type: 'buy_shop',
          playerId: p.id,
          shopId: resume.shopId,
          price: resume.price,
        };
        return applyChoice(g, { action: 'buy' });
      }
      if (resume?.type === 'invest' && choice.execute) {
        g.pending = {
          type: 'invest',
          playerId: p.id,
          shopId: resume.landedShopId ?? resume.shopId,
          landedShopId: resume.landedShopId ?? resume.shopId,
          shopIds: resume.shopIds,
          remaining: resume.remaining,
          toll: resume.toll,
        };
        return applyChoice(g, {
          action: 'invest',
          shopId: resume.shopId,
          amount: resume.amount,
        });
      }
      resumeAfterRaiseFunds(g, p, resume);
      return { ok: true, state: serializeState(g) };
    }
    return { ok: false, error: 'bad_action' };
  }

  if (pending.type === 'level_up') {
    const resumeMove = !!pending.resumeMove;
    const thenBankStock = pending.thenBankStock !== false;
    const atBank = !!pending.atBank;
    g.pending = null;
    p.flags.pendingLevelUp = null;
    if (thenBankStock) {
      openBankStock(g, p, { atBank, resumeMove });
      return { ok: true, celebrated: true, state: serializeState(g) };
    }
    if (resumeMove) {
      resumeMoveAfterBank(g, p);
      return { ok: true, celebrated: true, resumeMove: true, state: serializeState(g) };
    }
    endTurn(g);
    return { ok: true, celebrated: true, state: serializeState(g) };
  }

  if (pending.type === 'stock') {
    const maxBuys = pending.maxBuys;
    const bankVisit = !!pending.bankVisit || !!pending.bankPass;
    const resumeMove = !!pending.resumeMove;

    if (choice.action === 'buy') {
      if (maxBuys != null && (pending.buysUsed || 0) >= maxBuys) {
        return { ok: false, error: 'buy_limit' };
      }
      const area = Number(choice.area);
      if (!g.areas[area]) return { ok: false, error: 'bad_area' };
      const price = g.areas[area].stockPrice;
      const maxAfford = Math.floor(p.cash / price);
      // 1種類購入時は持ち金の限り（証券・銀行とも）
      const hardCap = Math.max(1, maxAfford);
      const count = Math.max(1, Math.min(hardCap, Number(choice.count) || 1));
      const cost = price * count;
      if (p.cash < cost) return { ok: false, error: 'insufficient' };
      p.cash -= cost;
      p.stocks[area] = (p.stocks[area] || 0) + count;
      bumpStat(p, 'stockBought', count);
      bumpStat(p, 'stockSpent', cost);
      syncStockValueSnap(g, p);
      if (count >= 10) {
        g.areas[area].B = Math.floor(g.areas[area].B * 1.07);
      }
      updateAreaStockPrices(g);
      addLog(g, `${p.name} が A${area}株×${count} 購入（${cost}G）`, 'stock');
      if (maxBuys != null) {
        pending.buysUsed = (pending.buysUsed || 0) + 1;
        if (pending.buysUsed >= maxBuys) {
          g.pending = null;
          if (resumeMove) {
            resumeMoveAfterBank(g, p);
            return { ok: true, resumeMove: true, state: serializeState(g) };
          }
          endTurn(g);
          return { ok: true, state: serializeState(g) };
        }
      }
    } else if (choice.action === 'sell') {
      if (bankVisit) return { ok: false, error: 'bank_buy_only' };
      const area = Number(choice.area);
      const have = p.stocks[area] || 0;
      const count = Math.max(1, Math.min(have, Number(choice.count) || 1));
      if (count <= 0) return { ok: false, error: 'no_stock' };
      const got = g.areas[area].stockPrice * count;
      p.stocks[area] -= count;
      p.cash += got;
      bumpStat(p, 'stockSold', count);
      bumpStat(p, 'stockIncome', got);
      syncStockValueSnap(g, p);
      if (count >= STOCK_SELL_PRESSURE_MIN) {
        g.areas[area].B = Math.max(100, Math.floor(g.areas[area].B * STOCK_SELL_B_RATE));
      }
      updateAreaStockPrices(g);
      addLog(g, `${p.name} が A${area}株×${count} 売却（+${got}G）`, 'stock');
    }
    if (choice.action === 'done' || choice.action === 'skip') {
      g.pending = null;
      if (resumeMove) {
        resumeMoveAfterBank(g, p);
        return { ok: true, resumeMove: true, state: serializeState(g) };
      }
      endTurn(g);
    }
    return { ok: true, state: serializeState(g) };
  }

  if (pending.type === 'scratch') {
    const cellId = Number(choice.cellId);
    const table = getSharedEventTable(g);
    const open = pending.openIds || unscratchedIds(table);
    if (!open.includes(cellId)) return { ok: false, error: 'bad_cell' };
    const result = scratchCell(g, p, cellId);
    if (!result.ok) return { ok: false, error: result.error };
    bumpStat(p, 'scratchCount', 1);
    if (result.matchBonus > 0) bumpStat(p, 'matchBonus', result.matchBonus);
    const msg = result.messages?.join(' / ') || result.cell.label;
    addLog(g, `${p.name} スクラッチ → ${result.cell.label}（${msg}）`, 'event');
    g.pending = null;
    const matchPayload = {
      scratched: true,
      cell: result.cell,
      matchBonus: result.matchBonus || 0,
      matches: result.matches || [],
      messages: result.messages || [],
      warps: result.warps || [],
    };
    if (maybeOpenPickInvest(g, p)) {
      return { ok: true, ...matchPayload, pickInvest: true, state: serializeState(g) };
    }
    if (maybeOpenMinigame(g, p)) {
      return { ok: true, ...matchPayload, minigame: true, state: serializeState(g) };
    }
    if (p.flags.extraRoll) {
      p.flags.extraRoll = false;
      g.phase = 'await_roll';
      return { ok: true, ...matchPayload, state: serializeState(g) };
    }
    endTurn(g);
    return { ok: true, ...matchPayload, state: serializeState(g) };
  }

  if (pending.type === 'pick_invest') {
    const want = Math.max(20, Math.floor(Number(pending.amount) || 80));
    let sq = null;
    if (choice.action === 'invest' || choice.action === 'pick') {
      sq = getNode(g, Number(choice.shopId));
      if (!sq || sq.type !== 'shop' || sq.owner !== p.id) {
        return { ok: false, error: 'bad_shop' };
      }
    } else if (choice.action === 'skip') {
      // スキップ時は増資枠がある店を優先してランダム適用
      const shops = g.map.filter((s) => s.type === 'shop' && s.owner === p.id);
      const withRoom = shops.filter((s) => getRemainingInvest(g, s) > 0);
      const pool = withRoom.length ? withRoom : shops;
      sq = pool[Math.floor(Math.random() * pool.length)] || null;
    } else {
      return { ok: false, error: 'bad_choice' };
    }
    if (!sq) {
      g.pending = null;
      endTurn(g);
      return { ok: true, state: serializeState(g) };
    }
    const amount = applyCappedShopBoost(g, sq, want);
    if (amount > 0) bumpStat(p, 'investTotal', amount);
    updateAreaStockPrices(g);
    addLog(
      g,
      amount > 0
        ? `${p.name} がイベント増資で「${sq.label}」+${amount}G`
        : `${p.name} は「${sq.label}」が増資上限のためイベント増資できず`,
      'shop',
    );
    g.pending = null;
    if (p.flags.extraRoll) {
      p.flags.extraRoll = false;
      g.phase = 'await_roll';
      return { ok: true, pickInvest: true, shopId: sq.id, amount, state: serializeState(g) };
    }
    endTurn(g);
    return { ok: true, pickInvest: true, shopId: sq.id, amount, state: serializeState(g) };
  }

  if (pending.type === 'minigame') {
    return resolveMinigame(g, p, pending, choice);
  }

  return { ok: false, error: 'unknown_pending' };
}

/** スクラッチ等のあとに「好きな店へ増資」選択を開く */
function maybeOpenPickInvest(g, p) {
  const info = p.flags?.pendingPickInvest;
  if (!info) return false;
  const shops = g.map.filter((s) => s.type === 'shop' && s.owner === p.id);
  p.flags.pendingPickInvest = null;
  if (!shops.length) return false;
  g.phase = 'await_choice';
  g.pending = {
    type: 'pick_invest',
    playerId: p.id,
    amount: Math.max(20, Math.floor(Number(info.amount) || 80)),
    shopIds: shops.map((s) => s.id),
  };
  addLog(g, `${p.name} は増資するお店を選ぶ（+${g.pending.amount}G）`, 'shop');
  return true;
}

function maybeOpenMinigame(g, p) {
  const mg = p.flags?.pendingMinigame;
  if (!mg) return false;
  p.flags.pendingMinigame = null;
  g.phase = 'await_choice';
  g.pending = {
    type: 'minigame',
    playerId: p.id,
    game: mg.game || 'guess_dice',
    label: mg.label || 'ミニゲーム',
  };
  addLog(g, `${p.name} のミニゲーム「${g.pending.label}」！`, 'event');
  return true;
}

function payoutAll(g, amount, messages) {
  applyAllCash(g, amount, messages);
}

function resolveMinigame(g, p, pending, choice) {
  const game = pending.game || 'guess_dice';
  const messages = [];
  let win = false;
  let detail = '';
  let tier = 'miss';
  let title = '結果発表';
  let prizeWon = 0;
  /** @type {Record<string, unknown>} */
  const outcome = {};
  let pick = choice?.value;

  if (game === 'guess_dice') {
    pick = Math.max(1, Math.min(6, Number(choice.value) || 1));
    const roll = Math.floor(rngNext(g) * 6) + 1;
    const diff = Math.abs(pick - roll);
    outcome.roll = roll;
    outcome.pick = pick;
    if (diff === 0) {
      win = true;
      tier = 'exact';
      title = 'ぴったり！';
      const prize = 280 + p.level * 40;
      prizeWon = prize;
      p.cash += prize;
      messages.push(`ぴったり！出目${roll} → +${prize}G`);
      payoutAll(g, 60, messages);
    } else if (diff === 1) {
      win = true;
      tier = 'near';
      title = 'おしい！';
      const prize = 100 + p.level * 15;
      prizeWon = prize;
      p.cash += prize;
      messages.push(`おしい！出目${roll}（予想${pick}）→ +${prize}G`);
      payoutAll(g, 40, messages);
    } else {
      tier = 'miss';
      title = 'ハズレ…';
      messages.push(`ハズレ…出目${roll}（予想${pick}）`);
      payoutAll(g, 25, messages);
    }
    detail = `予想 ${pick} → 出目 ${roll}`;
  } else if (game === 'dice_parity') {
    // 賽のカーニバル：奇数／偶数
    pick = choice.value === 'even' ? 'even' : 'odd';
    const roll = Math.floor(rngNext(g) * 6) + 1;
    const parity = roll % 2 === 0 ? 'even' : 'odd';
    outcome.roll = roll;
    outcome.pick = pick;
    outcome.parity = parity;
    const pickLabel = pick === 'even' ? '偶数' : '奇数';
    if (pick === parity) {
      win = true;
      tier = 'win';
      title = 'カーニバル当たり！';
      const prize = 160 + p.level * 22;
      prizeWon = prize;
      p.cash += prize;
      messages.push(`${pickLabel}正解！出目${roll} → +${prize}G`);
      payoutAll(g, 50, messages);
    } else {
      tier = 'miss';
      title = 'カーニバル外れ…';
      messages.push(`${pickLabel}外れ…出目${roll}`);
      payoutAll(g, 28, messages);
    }
    detail = `予想 ${pickLabel} → 出目 ${roll}`;
  } else if (game === 'dice_band') {
    // フォーチュンダイス：小(1-2)／中(3-4)／大(5-6)
    pick = ['low', 'mid', 'high'].includes(choice.value) ? choice.value : 'mid';
    const roll = Math.floor(rngNext(g) * 6) + 1;
    const band = roll <= 2 ? 'low' : roll <= 4 ? 'mid' : 'high';
    outcome.roll = roll;
    outcome.pick = pick;
    outcome.band = band;
    const bandLabel = { low: '小(1-2)', mid: '中(3-4)', high: '大(5-6)' };
    if (pick === band) {
      win = true;
      tier = 'win';
      title = 'フォーチュン！';
      const prize = 240 + p.level * 36;
      prizeWon = prize;
      p.cash += prize;
      messages.push(`${bandLabel[pick]}正解！出目${roll} → +${prize}G`);
      payoutAll(g, 65, messages);
    } else {
      tier = 'miss';
      title = 'フォーチュン外れ…';
      messages.push(`予想${bandLabel[pick]} → 出目${roll}（${bandLabel[band]}）`);
      payoutAll(g, 30, messages);
    }
    detail = `予想 ${bandLabel[pick]} → 出目 ${roll}`;
  } else if (game === 'high_low') {
    pick = choice.value === 'high' ? 'high' : 'low';
    const secret = Math.floor(rngNext(g) * 10) + 1; // 1-10
    const isHigh = secret >= 6;
    const ok = (pick === 'high' && isHigh) || (pick === 'low' && !isHigh);
    outcome.secret = secret;
    outcome.band = isHigh ? 'high' : 'low';
    outcome.pick = pick;
    if (ok) {
      win = true;
      tier = 'win';
      title = '正解！';
      const prize = 200 + p.level * 30;
      prizeWon = prize;
      p.cash += prize;
      messages.push(`正解！数字は ${secret} → +${prize}G`);
      payoutAll(g, 70, messages);
    } else {
      tier = 'miss';
      title = '残念…';
      messages.push(`残念…数字は ${secret}`);
      payoutAll(g, 35, messages);
    }
    detail = `予想 ${pick === 'high' ? 'ハイ' : 'ロー'} → ${secret}`;
  } else if (game === 'card_duel') {
    // カードハイロー：1枚目のあと、2枚目が高いか低いか
    pick = choice.value === 'high' ? 'high' : 'low';
    const first = Math.floor(rngNext(g) * 13) + 1;
    const second = Math.floor(rngNext(g) * 13) + 1;
    outcome.first = first;
    outcome.second = second;
    outcome.pick = pick;
    if (second === first) {
      tier = 'near';
      title = '引き分け！';
      const prize = 70 + p.level * 10;
      prizeWon = prize;
      p.cash += prize;
      win = true;
      messages.push(`同値 ${first}=${second} → +${prize}G`);
      payoutAll(g, 40, messages);
    } else {
      const isHigh = second > first;
      const ok = (pick === 'high' && isHigh) || (pick === 'low' && !isHigh);
      if (ok) {
        win = true;
        tier = 'win';
        title = 'カード勝ち！';
        const prize = 210 + p.level * 32;
        prizeWon = prize;
        p.cash += prize;
        messages.push(`${first}→${second} 正解 → +${prize}G`);
        payoutAll(g, 70, messages);
      } else {
        tier = 'miss';
        title = 'カード負け…';
        messages.push(`${first}→${second} 外れ`);
        payoutAll(g, 32, messages);
      }
    }
    detail = `予想 ${pick === 'high' ? 'ハイ' : 'ロー'}：${first} → ${second}`;
  } else if (game === 'coin') {
    pick = choice.value === 'tails' ? 'tails' : 'heads';
    const face = rngNext(g) < 0.5 ? 'heads' : 'tails';
    const faceLabel = face === 'heads' ? 'おもて' : 'うら';
    const pickLabel = pick === 'heads' ? 'おもて' : 'うら';
    outcome.face = face;
    outcome.pick = pick;
    if (pick === face) {
      win = true;
      tier = 'win';
      title = '当たり！';
      const prize = 180 + p.level * 25;
      prizeWon = prize;
      p.cash += prize;
      messages.push(`当たり！${faceLabel} → +${prize}G`);
      payoutAll(g, 55, messages);
    } else {
      tier = 'miss';
      title = 'ハズレ…';
      messages.push(`ハズレ…${faceLabel}`);
      payoutAll(g, 30, messages);
    }
    detail = `予想 ${pickLabel} → ${faceLabel}`;
  } else if (game === 'coin_double') {
    // ラッキーフリップ：同じ面を2回連続で当てる（1回一致は小さめ）
    pick = choice.value === 'tails' ? 'tails' : 'heads';
    const faces = [
      rngNext(g) < 0.5 ? 'heads' : 'tails',
      rngNext(g) < 0.5 ? 'heads' : 'tails',
    ];
    const matches = faces.filter((f) => f === pick).length;
    outcome.faces = faces;
    outcome.pick = pick;
    const faceLabels = faces.map((f) => (f === 'heads' ? 'おもて' : 'うら'));
    const pickLabel = pick === 'heads' ? 'おもて' : 'うら';
    if (matches === 2) {
      win = true;
      tier = 'jackpot';
      title = 'ダブルラッキー！';
      const prize = 320 + p.level * 45;
      prizeWon = prize;
      p.cash += prize;
      messages.push(`2回とも${pickLabel}！ → +${prize}G`);
      payoutAll(g, 90, messages);
    } else if (matches === 1) {
      win = true;
      tier = 'near';
      title = 'ワンヒット！';
      const prize = 80 + p.level * 12;
      prizeWon = prize;
      p.cash += prize;
      messages.push(`1回一致（${faceLabels.join('・')}）→ +${prize}G`);
      payoutAll(g, 40, messages);
    } else {
      tier = 'miss';
      title = 'フリップ外れ…';
      messages.push(`両方外れ（${faceLabels.join('・')}）`);
      payoutAll(g, 25, messages);
    }
    detail = `予想 ${pickLabel} → ${faceLabels.join(' / ')}`;
  } else if (game === 'coin_party') {
    // パーティーコイン：本人賞は控えめ、参加賞を厚めに
    pick = choice.value === 'tails' ? 'tails' : 'heads';
    const face = rngNext(g) < 0.5 ? 'heads' : 'tails';
    const faceLabel = face === 'heads' ? 'おもて' : 'うら';
    const pickLabel = pick === 'heads' ? 'おもて' : 'うら';
    outcome.face = face;
    outcome.pick = pick;
    if (pick === face) {
      win = true;
      tier = 'win';
      title = 'パーティー成功！';
      const prize = 110 + p.level * 16;
      prizeWon = prize;
      p.cash += prize;
      messages.push(`当たり！${faceLabel} → 本人+${prize}G`);
      payoutAll(g, 110, messages);
    } else {
      tier = 'miss';
      title = 'パーティー外れ…';
      messages.push(`ハズレ…${faceLabel}`);
      payoutAll(g, 45, messages);
    }
    detail = `予想 ${pickLabel} → ${faceLabel}`;
  } else if (game === 'slot') {
    const syms = ['★', '♪', 'G', '♦', '♣'];
    const reels = [];
    for (let i = 0; i < 5; i++) {
      reels.push(syms[Math.floor(rngNext(g) * syms.length)]);
    }
    const line = reels.join('');
    const counts = new Map();
    for (const s of reels) counts.set(s, (counts.get(s) || 0) + 1);
    const freq = [...counts.values()].sort((a, b) => b - a);
    const top = freq[0] || 0;
    const second = freq[1] || 0;
    const hitIndices = reels
      .map((s, i) => ((counts.get(s) || 0) >= 2 ? i : -1))
      .filter((i) => i >= 0);
    outcome.symbols = reels;
    outcome.hitIndices = hitIndices;

    // 5リール役：5揃い > 4揃い > フルハウス > 3揃い > ツーペア > ワンペア > ハズレ
    // 揃いが難しくなった分、上位役の報酬を厚く／下位は控えめに調整
    if (top === 5) {
      win = true;
      tier = 'jackpot';
      title = 'ジャックポット！';
      const prize = 900 + p.level * 120;
      prizeWon = prize;
      p.cash += prize;
      messages.push(`5揃い ${line}！ → +${prize}G`);
      payoutAll(g, 180, messages);
    } else if (top === 4) {
      win = true;
      tier = 'quad';
      title = 'フォーカード！';
      const prize = 420 + p.level * 60;
      prizeWon = prize;
      p.cash += prize;
      messages.push(`4揃い ${line} → +${prize}G`);
      payoutAll(g, 100, messages);
    } else if (top === 3 && second === 2) {
      win = true;
      tier = 'fullhouse';
      title = 'フルハウス！';
      const prize = 280 + p.level * 42;
      prizeWon = prize;
      p.cash += prize;
      messages.push(`フルハウス ${line} → +${prize}G`);
      payoutAll(g, 75, messages);
    } else if (top === 3) {
      win = true;
      tier = 'triple';
      title = 'スリーカード！';
      const prize = 150 + p.level * 28;
      prizeWon = prize;
      p.cash += prize;
      messages.push(`3揃い ${line} → +${prize}G`);
      payoutAll(g, 55, messages);
    } else if (top === 2 && second === 2) {
      win = true;
      tier = 'two_pair';
      title = 'ツーペア！';
      const prize = 90 + p.level * 16;
      prizeWon = prize;
      p.cash += prize;
      messages.push(`ツーペア ${line} → +${prize}G`);
      payoutAll(g, 40, messages);
    } else if (top === 2) {
      win = true;
      tier = 'pair';
      title = 'ワンペア！';
      const prize = 45 + p.level * 8;
      prizeWon = prize;
      p.cash += prize;
      messages.push(`ワンペア ${line} → +${prize}G`);
      payoutAll(g, 28, messages);
    } else {
      tier = 'miss';
      title = 'バラケ目…';
      messages.push(`バラケ目 ${line}`);
      payoutAll(g, 22, messages);
    }
    detail = line;
  } else if (game === 'neon_slot') {
    // ネオンスロット：左からの連続揃い（ペイライン）で判定
    const syms = ['⚡', '◆', '●', '▲', '★'];
    const reels = [];
    for (let i = 0; i < 5; i++) {
      reels.push(syms[Math.floor(rngNext(g) * syms.length)]);
    }
    const line = reels.join('');
    let run = 1;
    for (let i = 1; i < reels.length; i++) {
      if (reels[i] === reels[0]) run += 1;
      else break;
    }
    outcome.symbols = reels;
    outcome.hitIndices = Array.from({ length: run }, (_, i) => i);
    outcome.payline = run;
    if (run >= 5) {
      win = true;
      tier = 'jackpot';
      title = 'ネオンジャックポット！';
      const prize = 1000 + p.level * 130;
      prizeWon = prize;
      p.cash += prize;
      messages.push(`左から5連続 ${line}！ → +${prize}G`);
      payoutAll(g, 200, messages);
    } else if (run >= 4) {
      win = true;
      tier = 'quad';
      title = 'ネオン4連続！';
      const prize = 480 + p.level * 70;
      prizeWon = prize;
      p.cash += prize;
      messages.push(`左から4連続 ${line} → +${prize}G`);
      payoutAll(g, 110, messages);
    } else if (run >= 3) {
      win = true;
      tier = 'triple';
      title = 'ネオン3連続！';
      const prize = 200 + p.level * 35;
      prizeWon = prize;
      p.cash += prize;
      messages.push(`左から3連続 ${line} → +${prize}G`);
      payoutAll(g, 60, messages);
    } else if (run >= 2) {
      win = true;
      tier = 'pair';
      title = 'ネオン2連続！';
      const prize = 70 + p.level * 12;
      prizeWon = prize;
      p.cash += prize;
      messages.push(`左から2連続 ${line} → +${prize}G`);
      payoutAll(g, 32, messages);
    } else {
      tier = 'miss';
      title = 'ネオン消灯…';
      messages.push(`連続なし ${line}`);
      payoutAll(g, 24, messages);
    }
    detail = line;
  } else {
    tier = 'miss';
    title = '参加賞';
    payoutAll(g, 40, messages);
    messages.push('参加賞');
    detail = '参加賞';
  }

  bumpStat(p, 'minigamePlays', 1);
  if (win) bumpStat(p, 'minigameWins', 1);
  if (prizeWon > 0) bumpStat(p, 'minigamePrize', prizeWon);

  const reveal = {
    game,
    label: pending.label || 'ミニゲーム',
    playerId: p.id,
    playerName: p.name,
    playerColor: p.color,
    pick,
    outcome,
    tier,
    win,
    title,
    detail,
    messages: [...messages],
  };

  addLog(g, `${p.name} の「${pending.label}」→ ${messages.join(' / ')}`, 'event');
  g.pending = null;
  endTurn(g);
  return {
    ok: true,
    minigame: true,
    win,
    detail,
    messages,
    reveal,
    state: serializeState(g),
  };
}

const STOCK_SELL_PHASES = new Set(['await_roll', 'await_choice', 'await_fork']);

/** 自分のターン中（移動演出以外）に株を売れるか */
export function canSellStockOnTurn(g, playerId) {
  if (!g || g.phase === 'gameover') return false;
  if (!STOCK_SELL_PHASES.has(g.phase)) return false;
  if (g.currentPlayerIdx !== playerId) return false;
  const p = g.players[playerId];
  if (!p || p.bankrupt || p.resting) return false;
  return Object.values(p.stocks || {}).some((n) => (n || 0) > 0);
}

/** 自分のターン中いつでも株売却できる（サイコロ前・選択中・分岐中） */
export function preTurnSell(g, playerId, area, count) {
  if (!STOCK_SELL_PHASES.has(g.phase)) return { ok: false, error: 'bad_phase' };
  if (g.currentPlayerIdx !== playerId) return { ok: false, error: 'not_your_turn' };
  const p = g.players[playerId];
  if (!p || p.bankrupt) return { ok: false, error: 'bankrupt' };
  const a = Number(area);
  const have = p.stocks[a] || 0;
  const n = Math.max(1, Math.min(have, Number(count) || 1));
  if (n <= 0 || !g.areas[a]) return { ok: false, error: 'no_stock' };
  const got = g.areas[a].stockPrice * n;
  p.stocks[a] -= n;
  p.cash += got;
  bumpStat(p, 'stockSold', n);
  bumpStat(p, 'stockIncome', got);
  syncStockValueSnap(g, p);
  if (n >= STOCK_SELL_PRESSURE_MIN) {
    g.areas[a].B = Math.max(100, Math.floor(g.areas[a].B * STOCK_SELL_B_RATE));
  }
  updateAreaStockPrices(g);
  addLog(g, `${p.name} が A${a}株×${n} 売却（+${got}G）`, 'stock');
  return { ok: true, state: serializeState(g) };
}

/** ラッキーステータス付与（次の自分の番開始まで有効） */
export function grantLucky(p) {
  if (!p) return;
  p.lucky = true;
  p.flags.luckyExpireOnTurn = false;
}

function endTurn(g) {
  if (g.phase === 'gameover') return;

  const p = currentPlayer(g);
  if (p) {
    // このターン中に得たラッキーは、他プレイヤーの番を経て次の自分の番開始で切れる
    if (p.lucky) p.flags.luckyExpireOnTurn = true;
    p.flags.bankVisitDone = false;
    p.flags.bankPassStock = false;
  }

  recordWorthSnapshot(g);

  // 生存プレイヤーへ
  const alive = g.players.filter((pl) => !pl.bankrupt);
  if (alive.length <= 1) {
    g.winnerId = alive[0]?.id ?? null;
    g.phase = 'gameover';
    if (alive[0]) addLog(g, `🏆 ${alive[0].name} の勝利（他プレイヤー破産）`, 'win');
    recordWorthSnapshot(g);
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

/** 盤上の他プレイヤー店で想定される最大買い物料 */
export function cpuEstimateMaxToll(g, p) {
  let max = 180;
  for (const sq of g.map || []) {
    if (sq.type !== 'shop' || sq.owner < 0 || sq.owner === p.id) continue;
    max = Math.max(max, calcToll(g, sq) || 0);
  }
  return max;
}

/** 破産回避用の現金クッション（これ未満まで使い切らない） */
export function cpuCashReserve(g, p) {
  const maxToll = cpuEstimateMaxToll(g, p);
  const assets = getPlayerAssets(g, p);
  const fromToll = Math.floor(maxToll * 1.05);
  const fromAssets = Math.floor(Math.max(0, assets.total) * 0.1);
  return Math.max(400, fromToll, Math.min(1200, fromAssets));
}

/** 支出後もクッションを残せるか（現金＋株のみ。店売却前提の買いを避ける） */
export function cpuCanAffordSpend(g, p, cost) {
  const need = Math.max(0, Number(cost) || 0);
  const reserve = cpuCashReserve(g, p);
  const stockAsset = getPlayerAssets(g, p).stockAsset;
  return p.cash + stockAsset - need >= reserve;
}

function scoreNodeForCpu(g, p, node, traits) {
  if (!node) return 0;
  let s = 0;
  if (node.type === 'shop') {
    if (node.owner < 0) {
      s += traits.vacant;
      const cnt = getPlayerAreaCount(g, p.id, node.area);
      s += cnt * 1.35 * traits.ownArea;
      const vacantLeft = getAreaShops(g, node.area).filter((x) => x.owner < 0).length;
      if (cnt >= 1 && vacantLeft <= 2) s += 1.2 * traits.ownArea;
    } else if (node.owner === p.id) {
      s += 1.1 * traits.ownArea;
    } else {
      const toll = calcToll(g, node);
      const reserve = cpuCashReserve(g, p);
      const pressure = p.cash < reserve ? 2.8 : (p.cash < reserve * 1.5 ? 1.6 : 1);
      // 高額通行料は強く避ける（破産の主因）
      s += traits.enemyToll * pressure * Math.min(6, toll / 70);
      if (toll >= p.cash) s -= 8 * pressure;
    }
  } else if (node.type === 'bank') s += traits.bank;
  else if (node.type === 'mark' || node.type === 'suit_fill') s += traits.mark;
  else if (node.type === 'stockbroker') s += traits.stockbroker;
  else if (node.type === 'scratch' || node.type === 'event') s += traits.scratch;
  else if (node.type === 'minigame') s += traits.minigame;
  return s;
}

function scoreForkPath(g, p, fromId, nextId, traits) {
  let score = 0;
  let cur = nextId;
  let prev = fromId;
  for (let depth = 0; depth < 6; depth++) {
    const node = getNode(g, cur);
    score += scoreNodeForCpu(g, p, node, traits) * (1 - depth * 0.11);
    const nexts = getForwardNexts(g, cur, prev);
    if (!nexts.length) break;
    let best = nexts[0];
    let bestS = -Infinity;
    for (const nid of nexts) {
      const sc = scoreNodeForCpu(g, p, getNode(g, nid), traits);
      if (sc > bestS) {
        bestS = sc;
        best = nid;
      }
    }
    prev = cur;
    cur = best;
  }
  score += Math.random() * 0.25;
  return score;
}

function cpuPickFork(g, p, options) {
  const traits = getCpuPersonality(p);
  let best = options[0];
  let bestScore = -Infinity;
  for (const opt of options) {
    const score = scoreForkPath(g, p, p.pos, opt.id, traits);
    if (score > bestScore) {
      bestScore = score;
      best = opt;
    }
  }
  return best.id;
}

function cpuShouldBuyShop(g, p, sq, traits) {
  if (!sq) return false;
  const price = sq.price;
  if (getLiquidatableValue(g, p) < price) return false;
  if (!cpuCanAffordSpend(g, p, price)) return false;
  const assets = getPlayerAssets(g, p);
  if (assets.total >= g.goal * 0.97) return false;
  const areaCnt = getPlayerAreaCount(g, p.id, sq.area);
  const vacantLeft = getAreaShops(g, sq.area).filter((x) => x.owner < 0).length;
  // 店売却が必要な買いは、独占完成時だけ例外的に許可
  if (p.cash + assets.stockAsset < price) {
    if (!(areaCnt >= 1 && vacantLeft <= 1)) return false;
  }
  let desire = traits.shopBuy + areaCnt * 0.38 * Math.min(1.4, traits.ownArea / 2);
  if (areaCnt >= 1 && vacantLeft <= 2) desire += 0.45;
  if (price > p.cash) desire -= 0.35;
  if (p.cash - price < cpuCashReserve(g, p)) desire -= 0.4;
  if (desire >= 1.2) return true;
  if (desire < 0.7) return false;
  return Math.random() < Math.min(0.85, desire * 0.55);
}

function cpuShouldFiveBuy(g, p, pend, traits) {
  const price = Number(pend.price) || 0;
  if (price <= 0 || getLiquidatableValue(g, p) < price) return false;
  if (!cpuCanAffordSpend(g, p, price)) return false;
  const sq = getNode(g, pend.shopId);
  if (!sq) return false;
  const areaSize = getAreaShops(g, sq.area).length;
  const myCnt = getPlayerAreaCount(g, p.id, sq.area);
  const ownerCnt = getPlayerAreaCount(g, sq.owner, sq.area);
  let chance = traits.fiveBuy * 0.55;
  // 相手の独占崩し／自陣の独占完成だけ積極化
  if (ownerCnt >= areaSize && areaSize > 0) chance += 0.35;
  if (myCnt >= Math.max(1, areaSize - 1)) chance += 0.4;
  if ((pend.toll || 0) >= price * 0.22) chance += 0.15;
  if (p.cash < price + cpuCashReserve(g, p)) chance -= 0.45;
  return Math.random() < Math.min(0.8, Math.max(0.05, chance));
}

function cpuPickStockArea(g, p, traits) {
  const ownedAreas = [...new Set(
    g.map.filter((s) => s.type === 'shop' && s.owner === p.id).map((s) => s.area),
  )];
  const areas = ownedAreas.length ? ownedAreas : Object.keys(g.areas).map(Number);
  let best = areas[0];
  let bestScore = -Infinity;
  for (const a of areas) {
    const price = g.areas[a]?.stockPrice || 1;
    let s = (p.stocks[a] || 0) * 0.08;
    s += getPlayerAreaCount(g, p.id, a) * traits.ownArea * 0.55;
    s += (price / 40) * traits.stockBudget;
    s += Math.random() * 0.25;
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  return best;
}

/**
 * 目標現金まで調達。urgent=true なら独占核も惜しまず売る（通行料負債用）。
 */
function cpuRaiseFunds(g, p, target, traits, { urgent = false } = {}) {
  let guard = 0;
  while (p.cash < target && guard++ < 80) {
    const held = Object.keys(p.stocks || {}).map(Number).filter((a) => (p.stocks[a] || 0) > 0);
    if (held.length) {
      held.sort((a, b) => {
        const ownA = getPlayerAreaCount(g, p.id, a);
        const ownB = getPlayerAreaCount(g, p.id, b);
        const priceA = g.areas[a]?.stockPrice || 1;
        const priceB = g.areas[b]?.stockPrice || 1;
        if (!urgent && traits.stockBudget > 0.45) return ownA - ownB || priceA - priceB;
        return priceA - priceB || ownA - ownB;
      });
      const a = held[0];
      const need = target - p.cash;
      const price = g.areas[a].stockPrice || 1;
      const count = Math.min(p.stocks[a], Math.max(1, Math.ceil(need / price)));
      const before = p.stocks[a];
      sellStockForCash(g, p, a, count);
      if ((p.stocks[a] || 0) === before) break;
      continue;
    }
    const shops = g.map.filter((s) => s.type === 'shop' && s.owner === p.id);
    if (!shops.length) break;
    shops.sort((a, b) => {
      const ca = getPlayerAreaCount(g, p.id, a.area);
      const cb = getPlayerAreaCount(g, p.id, b.area);
      if (!urgent && traits.ownArea > 2) return ca - cb || a.price - b.price;
      return a.price - b.price || ca - cb;
    });
    const sold = sellShopForCash(g, p, shops[0].id);
    if (!sold.ok) break;
  }
}

function cpuPickScratchCell(g, p, openIds) {
  const table = getSharedEventTable(g);
  const traits = getCpuPersonality(p);
  const myColor = PLAYER_COLORS.findIndex((c) => c.toLowerCase() === (p.color || '').toLowerCase());
  const color = myColor >= 0 ? myColor : p.id % 4;
  const size = table.size;
  let best = openIds[0];
  let bestScore = -Infinity;
  for (const id of openIds) {
    const row = Math.floor(id / size);
    const col = id % size;
    let mineRow = 0;
    let mineCol = 0;
    for (let c = 0; c < size; c++) {
      const cell = table.cells[row * size + c];
      if (cell?.scratched && cell.color === color) mineRow++;
    }
    for (let r = 0; r < size; r++) {
      const cell = table.cells[r * size + col];
      if (cell?.scratched && cell.color === color) mineCol++;
    }
    let s = Math.max(mineRow, mineCol) * traits.scratch * 0.55;
    if (row === col) {
      let d = 0;
      for (let i = 0; i < size; i++) {
        const cell = table.cells[i * size + i];
        if (cell?.scratched && cell.color === color) d++;
      }
      s += d * 0.4 * traits.scratch;
    }
    s += Math.random() * (traits.key === 'gambler' ? 1.4 : 0.45);
    if (s > bestScore) {
      bestScore = s;
      best = id;
    }
  }
  return best;
}

/** CPUの個性付き行動（1アクション分。移動の連続はUI側） */
export function cpuAct(g) {
  const p = currentPlayer(g);
  if (!p?.isCPU || p.bankrupt || g.phase === 'gameover') return null;
  const traits = getCpuPersonality(p);

  if (g.phase === 'await_roll') {
    return rollDice(g);
  }

  if (g.phase === 'moving' && g.move) {
    return advanceMove(g);
  }

  if (g.phase === 'await_fork' && g.pending?.type === 'fork') {
    const nextId = cpuPickFork(g, p, g.pending.options);
    return chooseFork(g, nextId);
  }

  if (g.phase === 'await_choice' && g.pending) {
    const pend = g.pending;
    if (pend.type === 'level_up') {
      return applyChoice(g, { action: 'celebrate' });
    }
    if (pend.type === 'buy_shop') {
      const sq = getNode(g, pend.shopId);
      const buy = cpuShouldBuyShop(g, p, sq, traits);
      return applyChoice(g, { action: buy ? 'buy' : 'skip' });
    }
    if (pend.type === 'invest') {
      const ids = pend.shopIds?.length
        ? pend.shopIds
        : [pend.shopId].filter((id) => id != null);
      let best = pend.shopId;
      let bestScore = -1;
      for (const id of ids) {
        const sq = getNode(g, id);
        if (!sq || sq.owner !== p.id) continue;
        const rem = getRemainingInvest(g, sq);
        if (rem < 20) continue;
        const areaCnt = getPlayerAreaCount(g, p.id, sq.area);
        const score = rem * 1.2 + areaCnt * 40 + sq.price * 0.05
          + (traits.key === 'magnate' || traits.key === 'tycoon' ? areaCnt * 25 : 0)
          + (id === pend.landedShopId || id === pend.shopId ? 15 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = id;
        }
      }
      const target = getNode(g, best);
      const rem = target ? getRemainingInvest(g, target) : 0;
      // 増資は現金クッション内だけで行い、資金調達（店売り）には入らない
      const reserve = cpuCashReserve(g, p);
      const spendable = Math.max(0, p.cash - reserve);
      const amount = Math.min(rem, Math.floor(spendable * traits.investRate));
      if (amount >= 20 && cpuCanAffordSpend(g, p, amount)) {
        return applyChoice(g, { action: 'invest', shopId: best, amount });
      }
      return applyChoice(g, { action: 'skip' });
    }
    if (pend.type === 'pick_invest') {
      const ids = pend.shopIds?.length
        ? pend.shopIds
        : g.map.filter((s) => s.type === 'shop' && s.owner === p.id).map((s) => s.id);
      if (!ids.length) return applyChoice(g, { action: 'skip' });
      // 増資余地が大きい店／エリア集中を優先
      let best = ids[0];
      let bestScore = -1;
      for (const id of ids) {
        const sq = getNode(g, id);
        if (!sq) continue;
        const rem = getRemainingInvest(g, sq);
        const areaCnt = getPlayerAreaCount(g, p.id, sq.area);
        const score = rem * 1.2 + areaCnt * 40 + sq.price * 0.05
          + (traits.key === 'magnate' || traits.key === 'tycoon' ? areaCnt * 25 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = id;
        }
      }
      return applyChoice(g, { action: 'invest', shopId: best });
    }
    if (pend.type === 'five_buy') {
      const buy = cpuShouldFiveBuy(g, p, pend, traits);
      return applyChoice(g, { action: buy ? 'buy' : 'skip' });
    }
    if (pend.type === 'raise_funds') {
      const target = Number(pend.targetCash) || 0;
      const resume = pend.resume;
      const optional = !!(resume && ['five_buy', 'buy_shop', 'invest'].includes(resume.type));
      const urgent = !optional; // 通行料など必須負債は資産を惜しまず換金
      cpuRaiseFunds(g, p, target, traits, { urgent });
      if (p.cash >= target) {
        // 任意購入の再開はクッションを割るなら実行しない
        let exec = optional;
        if (optional && resume?.type === 'invest') {
          const pay = Number(resume.amount) || target;
          exec = cpuCanAffordSpend(g, p, pay);
        } else if (optional && (resume?.type === 'buy_shop' || resume?.type === 'five_buy')) {
          const pay = Number(resume.price) || target;
          exec = cpuCanAffordSpend(g, p, pay);
        }
        if (optional && !exec) {
          return applyChoice(g, { action: 'cancel' });
        }
        return applyChoice(g, { action: 'continue', execute: exec });
      }
      // 任意の購入・増資・5倍買いで足りなければ見送り（破産しない）
      if (optional) {
        return applyChoice(g, { action: 'cancel' });
      }
      // 必須負債のみ最終手段で破産
      return applyChoice(g, { action: 'bankrupt' });
    }
    if (pend.type === 'stock') {
      const bankVisit = !!pend.bankVisit || !!pend.bankPass;
      const reserve = cpuCashReserve(g, p);
      const spendable = Math.max(0, p.cash - reserve);
      if (spendable >= 80) {
        const a = cpuPickStockArea(g, p, traits);
        const price = g.areas[a]?.stockPrice || 1;
        const ratio = bankVisit
          ? Math.min(0.75, traits.stockBudget + 0.08)
          : Math.max(0.1, traits.stockBudget * 0.3);
        const budget = Math.floor(spendable * ratio);
        const count = Math.floor(budget / price);
        if (count > 0) {
          return applyChoice(g, { action: 'buy', area: a, count });
        }
      }
      return applyChoice(g, { action: 'done' });
    }
    if (pend.type === 'scratch') {
      const open = pend.openIds || unscratchedIds(getSharedEventTable(g));
      if (!open.length) {
        g.pending = null;
        endTurn(g);
        return { ok: true, state: serializeState(g) };
      }
      const cellId = cpuPickScratchCell(g, p, open);
      return applyChoice(g, { action: 'scratch', cellId });
    }
    if (pend.type === 'minigame') {
      if (pend.game === 'guess_dice') {
        // 勝負師は端を避け中央寄り、他は広めに
        const pick = traits.key === 'gambler'
          ? 2 + Math.floor(Math.random() * 4)
          : 1 + Math.floor(Math.random() * 6);
        return applyChoice(g, { action: 'pick', value: pick });
      }
      if (pend.game === 'dice_parity') {
        return applyChoice(g, { action: 'pick', value: Math.random() < 0.5 ? 'odd' : 'even' });
      }
      if (pend.game === 'dice_band') {
        const bands = ['low', 'mid', 'high'];
        return applyChoice(g, { action: 'pick', value: bands[Math.floor(Math.random() * 3)] });
      }
      if (pend.game === 'high_low' || pend.game === 'card_duel') {
        return applyChoice(g, { action: 'pick', value: Math.random() < 0.5 ? 'low' : 'high' });
      }
      if (pend.game === 'coin' || pend.game === 'coin_double' || pend.game === 'coin_party') {
        return applyChoice(g, { action: 'pick', value: Math.random() < 0.5 ? 'heads' : 'tails' });
      }
      return applyChoice(g, { action: 'spin' });
    }
  }
  return null;
}
