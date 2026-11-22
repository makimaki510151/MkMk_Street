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
  getAreaCode,
} from './board.js';
import {
  createEventTable,
  scratchCell,
  unscratchedIds,
  applyAllCash,
  recordWarp,
  takeWarpFx,
  takeScratchSideEffects,
} from './eventTable.js';
import { EVENT_NPC_KINDS } from './eventNpc.js';
import {
  monopolyRate as monopolyRateOf,
  investMultiByMonopolyRate,
  maxExtraInvest as maxExtraInvestOf,
  remainingInvest as remainingInvestOf,
} from './investLimits.js';

/** 移動ダイス面数の既定値（マップ未指定時） */
export const MOVE_DICE_MAX_DEFAULT = 6;

/** ロビー／席で選べるプレイヤー色（暗い盤面でも見分けやすい高彩度・色相分散） */
export const PLAYER_COLORS = [
  '#FF4455', // あか
  '#3B82F6', // あお
  '#F5C542', // きいろ
  '#22C55E', // みどり
  '#FF7A1A', // オレンジ
  '#FF6BCB', // ピンク
  '#9B5CFF', // すみれ
  '#22D3EE', // みずいろ
  '#E2E8F0', // ぎん
  '#A3E635', // きみどり
];
export const PLAYER_COLOR_LABELS = [
  'あか', 'あお', 'きいろ', 'みどり', 'オレンジ',
  'ピンク', 'すみれ', 'みずいろ', 'ぎん', 'きみどり',
];
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
    shopBuy: 1.55,
    fiveBuy: 0.48,
    investRate: 0.4,
    stockBudget: 0.22,
    vacant: 4.2,
    ownArea: 2.55,
    enemyToll: -2.9,
    bank: 0.7,
    mark: 1.55,
    stockbroker: 0.3,
    scratch: 0.4,
    minigame: 0.45,
  },
  broker: {
    label: '株マニア',
    shopBuy: 0.85,
    fiveBuy: 0.16,
    investRate: 0.16,
    stockBudget: 0.64,
    vacant: 2.1,
    ownArea: 1.55,
    enemyToll: -3.35,
    bank: 1.75,
    mark: 1.35,
    stockbroker: 2.85,
    scratch: 0.45,
    minigame: 0.4,
  },
  magnate: {
    label: '独占屋',
    shopBuy: 1.38,
    fiveBuy: 0.68,
    investRate: 0.5,
    stockBudget: 0.3,
    vacant: 3.0,
    ownArea: 3.9,
    enemyToll: -2.55,
    bank: 1.0,
    mark: 1.85,
    stockbroker: 0.95,
    scratch: 0.8,
    minigame: 0.55,
  },
  gambler: {
    label: '勝負師',
    shopBuy: 1.05,
    fiveBuy: 0.4,
    investRate: 0.24,
    stockBudget: 0.28,
    vacant: 2.4,
    ownArea: 1.35,
    enemyToll: -1.85,
    bank: 0.55,
    mark: 3.1,
    stockbroker: 0.4,
    scratch: 2.4,
    minigame: 2.2,
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
    const areaName = g.areas[a]?.name || getAreaCode(g, a);
    const detail = given.map((p) => `${p.name}+${p.amount}G`).join(' / ');
    addLog(g, `${getAreaCode(g, a)}「${areaName}」株わけ前 ${detail}（収益 ${base}G の一部）`, 'stock');
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
    /** 催促を送った回数 */
    nudgeSent: 0,
    /** 催促を受けた回数 */
    nudgeReceived: 0,
  };
}

/** 催促が成立したときに送受信双方の統計を加算 */
export function recordNudgeStats(g, fromSeat, targetSeat) {
  if (!g?.players) return false;
  const from = g.players[fromSeat];
  const to = g.players[targetSeat];
  if (!from || !to || fromSeat === targetSeat) return false;
  bumpStat(from, 'nudgeSent', 1);
  bumpStat(to, 'nudgeReceived', 1);
  return true;
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
    const n = Math.max(0, Math.floor(Number(cnt) || 0));
    if (n <= 0) continue;
    stockAsset += (g.areas[Number(a)]?.stockPrice || 0) * n;
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
    return `${getAreaCode(g, a)}株 +${n}`
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
    return `${getAreaCode(g, a)}株 +${n}`;
  }},
  { id: 'rollon', label: 'ラッキー再挑戦', apply: (g, p) => { p.flags.extraRoll = true; return 'もう一度サイコロ' } },
  { id: 'invest', label: '増資クーポン', apply: (g, p) => { p.flags.investCoupon = true; return '次の増資が半額' } },
  { id: 'lucky', label: '幸運のお守り', apply: (g, p) => {
    grantLucky(p);
    return '他者の買い物料の20%を銀行から受取（次の自分の番まで）';
  }},
  /** スクラッチと差別化：盤面イベントは「街の出来事」寄り（即時効果・全体影響・状態変化） */
  { id: 'street_buzz', label: '街の話題', apply: (g, p) => {
    const n = 90 + p.level * 35;
    p.cash += n;
    const areas = Object.keys(g.areas).map(Number);
    const a = areas[Math.floor(Math.random() * areas.length)];
    if (g.areas[a]) {
      g.areas[a].B = Math.min(250, Math.floor((g.areas[a].B || 100) * 1.06));
      updateAreaStockPrices(g);
    }
    return `話題沸騰！ +${n}G／${getAreaCode(g, a)}株↑`;
  }},
  { id: 'charity_drive', label: 'チャリティ募金', apply: (g, p) => {
    let pool = 0;
    for (const pl of g.players) {
      if (pl.bankrupt) continue;
      const take = Math.min(pl.cash, 40 + p.level * 10);
      pl.cash -= take;
      pool += take;
    }
    const alive = g.players.filter((x) => !x.bankrupt).length;
    const share = Math.floor(pool / Math.max(1, alive));
    for (const pl of g.players) {
      if (pl.bankrupt) continue;
      pl.cash += share;
    }
    return `募金を分け合い 各自+${share}G`;
  }},
  { id: 'suit_drop', label: 'スーツ補給', apply: (g, p) => {
    const empty = [];
    for (let i = 0; i < 4; i++) if (!p.marks[i]) empty.push(i);
    if (!empty.length) {
      p.wildcards = Math.min((p.wildcards || 0) + 1, 3);
      return 'マーク揃い済み → ワイルド+1';
    }
    const idx = empty[Math.floor(Math.random() * empty.length)];
    p.marks[idx] = true;
    return `マーク獲得（${['♠', '♥', '♦', '♣'][idx]}）`;
  }},
  { id: 'toll_shield', label: '通行守り', apply: (g, p) => {
    p.flags.tollShield = true;
    return '次の買い物料が免除';
  }},
  { id: 'rival_tax', label: 'ライバル課税', apply: (g, p) => {
    let total = 0;
    for (const pl of g.players) {
      if (pl.bankrupt || pl.id === p.id) continue;
      const n = Math.min(pl.cash, 60 + p.level * 20);
      pl.cash -= n;
      total += n;
    }
    p.cash += total;
    return `他者から徴収 +${total}G`;
  }},
  { id: 'shop_boost', label: '看板リニューアル', apply: (g, p) => {
    const mine = g.map.filter((n) => n.type === 'shop' && n.owner === p.id);
    if (!mine.length) {
      const gift = 120 + p.level * 30;
      p.cash += gift;
      return `店なし → 支度金 +${gift}G`;
    }
    const sq = mine[Math.floor(Math.random() * mine.length)];
    const add = 80 + p.level * 25;
    const gained = applyCappedShopBoost(g, sq, add);
    return gained > 0
      ? `「${sq.label || sq.name || '店'}」+${gained}G`
      : '増資枠なし → スキップ';
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
      /** ワイルドカード枚数（銀行でレベルアップできるときだけ必要枚数を消費。上限 MAX_WILDCARDS） */
      wildcards: 0,
      level: 1,
      stocks: {},
      /** 自分のターン中のエリア別売却累計（ターン開始でリセット。10枚ごとに株価下落） */
      turnSellPressure: {},
      lucky: false,
      resting: false,
      shopsClosed: false,
      bankrupt: false,
      offline: false,
      flags: {},
      stats: createEmptyStats(),
    };
  });

  const mapDef = getMapDef(mapId);
  const resolvedDiceMax = (() => {
    const fromBoard = Number(board.diceMax);
    if (Number.isFinite(fromBoard) && fromBoard >= 2) return Math.floor(fromBoard);
    const fromCat = Number(mapDef?.diceMax);
    if (Number.isFinite(fromCat) && fromCat >= 2) return Math.floor(fromCat);
    return MOVE_DICE_MAX_DEFAULT;
  })();

  const g = {
    map: board.nodes,
    areas: board.areas,
    mapId: board.mapId || mapDef.id,
    mapName: board.mapName || mapDef.name,
    diceMax: resolvedDiceMax,
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
    eventNpcs: [],
    povertyHolidayClearTurn: null,
    eventNpcFx: [],
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
  if (sq.eventHoliday) return 0;
  const owner = g.players[sq.owner];
  if (owner?.shopsClosed) return 0;
  const areaSize = getAreaShops(g, sq.area).length;
  const cnt = getPlayerAreaCount(g, sq.owner, sq.area);
  const extra = Math.max(0, Number(sq.extraInvest) || 0);
  const base = Math.max(1, Number(sq.basePrice) || 1);
  return Math.floor(
    sq.baseToll * (1 + (extra / base) * 2) * getTollMulti(cnt, areaSize),
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
  // 店価・株価は動かさない。買い物料は所有軒数倍率（calcToll）側で上がる。

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

/** 自分のターン内でこの枚数売るごとに相場係数 B が下がる（エリア別・手番プレイヤー個人） */
export const STOCK_SELL_PRESSURE_MIN = 10;
/** 売却圧による B 乗率 */
export const STOCK_SELL_B_RATE = 0.93;
/** 一度にこの枚数以上買うと相場係数 B が上がる */
export const STOCK_BUY_BOOST_MIN = 10;
/** 大口購入時の B 乗率 */
export const STOCK_BUY_B_RATE = 1.07;

function areaShopAvgPrice(g, area) {
  const shops = getAreaShops(g, area);
  if (!shops.length) return 0;
  return shops.reduce((s, sq) => s + sq.price, 0) / shops.length;
}

function stockPriceFromB(avg, B) {
  return Math.max(1, Math.floor((avg / 65536) * (B || 100)));
}

function playerTurnSellPressure(p, area) {
  const a = Number(area);
  const map = p?.turnSellPressure;
  if (!map || typeof map !== 'object') return 0;
  return Math.max(0, Math.floor(Number(map[a]) || 0));
}

/** 手番開始時にそのプレイヤーの売却累計をクリア */
export function resetTurnSellPressure(p) {
  if (!p) return;
  p.turnSellPressure = {};
}

/**
 * 手番プレイヤーのターン内売却累計に加算し、閾値ごとに B を下げる。
 * @returns {{ drops: number, pressureBefore: number, pressureAfter: number, B: number }}
 */
export function applyStockSellPressure(g, player, area, count) {
  const a = Number(area);
  const meta = g.areas?.[a];
  const p = player || currentPlayer(g);
  if (!meta || !p) return { drops: 0, pressureBefore: 0, pressureAfter: 0, B: 0 };
  if (!p.turnSellPressure || typeof p.turnSellPressure !== 'object') p.turnSellPressure = {};
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const pressureBefore = playerTurnSellPressure(p, a);
  let pressure = pressureBefore + n;
  let drops = 0;
  let B = meta.B || 100;
  while (pressure >= STOCK_SELL_PRESSURE_MIN) {
    B = Math.max(100, Math.floor(B * STOCK_SELL_B_RATE));
    pressure -= STOCK_SELL_PRESSURE_MIN;
    drops += 1;
  }
  p.turnSellPressure[a] = pressure;
  meta.B = B;
  return { drops, pressureBefore, pressureAfter: pressure, B };
}

/**
 * 売却後の B / 累計を予測（状態は変更しない）。
 * @returns {{ drops: number, pressureBefore: number, pressureAfter: number, nextB: number }}
 */
export function simulateStockSellPressure(meta, pressureBefore, count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const before = Math.max(0, Math.floor(Number(pressureBefore) || 0));
  let pressure = before + n;
  let drops = 0;
  let nextB = meta?.B || 100;
  while (pressure >= STOCK_SELL_PRESSURE_MIN) {
    nextB = Math.max(100, Math.floor(nextB * STOCK_SELL_B_RATE));
    pressure -= STOCK_SELL_PRESSURE_MIN;
    drops += 1;
  }
  return { drops, pressureBefore: before, pressureAfter: pressure, nextB };
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
 * 売却圧は手番プレイヤーのターン内・エリア別累計（次の自分の番でリセット）。
 * @param {number} [playerId] 省略時は currentPlayerIdx
 * @returns {{ area:number, count:number, proceeds:number, oldPrice:number, newPrice:number, diff:number, drops:boolean, dropCount:number, pressureBefore:number, pressureAfter:number, untilDrop:number, threshold:number }|null}
 */
export function previewStockSell(g, area, count, playerId = null) {
  const a = Number(area);
  const meta = g.areas?.[a];
  if (!meta) return null;
  const avg = areaShopAvgPrice(g, a);
  if (!avg) return null;
  const pid = playerId != null ? playerId : g.currentPlayerIdx;
  const p = g.players?.[pid];
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const oldPrice = meta.stockPrice || stockPriceFromB(avg, meta.B);
  const pressureBefore = playerTurnSellPressure(p, a);
  const sim = simulateStockSellPressure(meta, pressureBefore, n);
  const newPrice = stockPriceFromB(avg, sim.nextB);
  const untilDrop = Math.max(0, STOCK_SELL_PRESSURE_MIN - sim.pressureBefore);
  return {
    area: a,
    count: n,
    proceeds: oldPrice * n,
    oldPrice,
    newPrice,
    diff: newPrice - oldPrice,
    drops: sim.drops > 0,
    dropCount: sim.drops,
    pressureBefore: sim.pressureBefore,
    pressureAfter: sim.pressureAfter,
    untilDrop,
    threshold: STOCK_SELL_PRESSURE_MIN,
  };
}

/**
 * 株購入後の株価を予測（支払は現行価格→その後大口なら B 上昇）。
 * @returns {{ area:number, count:number, cost:number, oldPrice:number, newPrice:number, diff:number, rises:boolean, threshold:number }|null}
 */
export function previewStockBuy(g, area, count) {
  const a = Number(area);
  const meta = g.areas?.[a];
  if (!meta) return null;
  const avg = areaShopAvgPrice(g, a);
  if (!avg) return null;
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const oldPrice = meta.stockPrice || stockPriceFromB(avg, meta.B);
  const rises = n >= STOCK_BUY_BOOST_MIN;
  const nextB = rises
    ? Math.floor((meta.B || 100) * STOCK_BUY_B_RATE)
    : (meta.B || 100);
  const newPrice = stockPriceFromB(avg, nextB);
  return {
    area: a,
    count: n,
    cost: oldPrice * n,
    oldPrice,
    newPrice,
    diff: newPrice - oldPrice,
    rises,
    threshold: STOCK_BUY_BOOST_MIN,
  };
}

export function getPlayerAssets(g, p) {
  const stockAsset = getStockAssetOnly(g, p);
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
  {
    id: 'nudge_sender',
    title: '催促上手',
    desc: '催促を送った回数',
    metric: (row) => row.stats.nudgeSent,
    format: (v) => `${v}回`,
  },
  {
    id: 'nudge_target',
    title: 'のんびり屋',
    desc: '催促を受けた回数',
    metric: (row) => row.stats.nudgeReceived,
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

/**
 * 終了結果をエクスポート用のプレーンオブジェクトへ整形。
 * @param {ReturnType<typeof buildGameResults>} results
 * @param {{ exportedAt?: string, mapId?: string|null, mapName?: string|null, mode?: string|null }} [meta]
 */
export function formatGameResultsExport(results, meta = {}) {
  const ranking = (results?.ranking || []).map((r) => ({
    rank: r.rank,
    id: r.id,
    name: r.name,
    color: r.color,
    bankrupt: !!r.bankrupt,
    level: r.level,
    shopCount: r.shopCount,
    monopolyAreas: r.monopolyAreas,
    isWinner: !!r.isWinner,
    assets: {
      cash: r.assets?.cash ?? 0,
      shopAsset: r.assets?.shopAsset ?? 0,
      stockAsset: r.assets?.stockAsset ?? 0,
      total: r.assets?.total ?? 0,
    },
    sales: { ...r.sales },
    payments: { ...r.payments },
    stockReturn: r.stockReturn ?? 0,
    nextSalary: r.nextSalary ?? 0,
    stats: { ...createEmptyStats(), ...(r.stats || {}) },
  }));
  const winner = ranking.find((r) => r.isWinner) || ranking[0] || null;
  return {
    schema: 'mkmk-street-results/v1',
    exportedAt: meta.exportedAt || new Date().toISOString(),
    game: 'MkMk Street',
    mapId: meta.mapId ?? null,
    mapName: meta.mapName ?? null,
    mode: meta.mode ?? null,
    goal: results?.goal ?? 0,
    turn: results?.turn ?? 1,
    startCash: results?.startCash ?? 0,
    winnerId: results?.winnerId ?? winner?.id ?? null,
    winnerName: winner?.name ?? null,
    ranking,
    awards: (results?.awards || []).map((a) => ({
      id: a.id,
      title: a.title,
      desc: a.desc,
      playerId: a.playerId,
      playerName: a.playerName,
      playerColor: a.playerColor,
      value: a.value,
      valueLabel: a.valueLabel,
    })),
    worthHistory: (results?.worthHistory || []).map((h) => ({
      turn: h.turn,
      values: { ...(h.values || {}) },
    })),
  };
}

function fmtExportG(n) {
  return `${Number(n || 0).toLocaleString('ja-JP')}G`;
}

function fmtExportSignedG(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v).toLocaleString('ja-JP');
  if (v > 0) return `+${abs}G`;
  if (v < 0) return `−${abs}G`;
  return '0G';
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** 人が読めるテキスト（コピー／.txt 用） */
export function gameResultsExportToText(payload) {
  const lines = [];
  lines.push('MkMk Street 試合結果');
  lines.push(`出力: ${payload.exportedAt || ''}`);
  if (payload.mapName || payload.mapId) {
    lines.push(`マップ: ${payload.mapName || payload.mapId}`);
  }
  if (payload.mode) lines.push(`モード: ${payload.mode}`);
  lines.push(`目標: ${fmtExportG(payload.goal)} ／ ターン: ${payload.turn} ／ 開始現金: ${fmtExportG(payload.startCash)}`);
  lines.push(`勝者: ${payload.winnerName || '（なし）'}`);
  lines.push('');
  lines.push('[順位]');
  for (const r of payload.ranking || []) {
    const a = r.assets || {};
    lines.push(
      `${r.rank}. ${r.name}${r.isWinner ? ' ★' : ''}${r.bankrupt ? '（破産）' : ''}`
      + ` — 総資産 ${fmtExportG(a.total)}`
      + `（現金 ${fmtExportG(a.cash)} / 店 ${fmtExportG(a.shopAsset)} / 株 ${fmtExportG(a.stockAsset)}）`
      + ` Lv.${r.level} 店${r.shopCount} 独占${r.monopolyAreas}`,
    );
  }
  lines.push('');
  lines.push('[売上と支払い]');
  for (const r of payload.ranking || []) {
    const s = r.sales || {};
    const p = r.payments || {};
    const st = r.stats || {};
    lines.push(
      `${r.name}: 売上 ${s.count}回 ${fmtExportG(s.total)}（平均 ${fmtExportG(s.average)} / 最大 ${fmtExportG(s.greatest)}）`
      + ` ／ 支払 ${p.count}回 ${fmtExportG(p.total)}（平均 ${fmtExportG(p.average)} / 最大 ${fmtExportG(p.greatest)}）`
      + ` ／ 株リターン ${fmtExportSignedG(r.stockReturn)}`
      + ` ／ 催促 ${st.nudgeSent || 0}回→ / ←${st.nudgeReceived || 0}回`,
    );
  }
  lines.push('');
  lines.push('[特賞]');
  if (!(payload.awards || []).length) {
    lines.push('（なし）');
  } else {
    for (const a of payload.awards) {
      lines.push(`${a.title}: ${a.playerName} — ${a.desc} · ${a.valueLabel}`);
    }
  }
  lines.push('');
  lines.push('[総資産推移]');
  const hist = payload.worthHistory || [];
  if (!hist.length) {
    lines.push('（なし）');
  } else {
    const names = Object.fromEntries((payload.ranking || []).map((r) => [r.id, r.name]));
    for (const h of hist) {
      const parts = Object.entries(h.values || {})
        .map(([id, v]) => `${names[id] || `P${id}`} ${fmtExportG(v)}`)
        .join(' / ');
      lines.push(`T${h.turn}: ${parts}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** 順位サマリの CSV（表計算向け） */
export function gameResultsExportToCsv(payload) {
  const header = [
    'rank', 'name', 'winner', 'bankrupt', 'level', 'shops', 'monopolyAreas',
    'total', 'cash', 'shopAsset', 'stockAsset',
    'salesCount', 'salesTotal', 'salesAverage', 'salesMax',
    'payCount', 'payTotal', 'payAverage', 'payMax',
    'stockReturn', 'nextSalary',
    'nudgeSent', 'nudgeReceived',
  ];
  const rows = (payload.ranking || []).map((r) => {
    const a = r.assets || {};
    const s = r.sales || {};
    const p = r.payments || {};
    const st = r.stats || {};
    return [
      r.rank,
      r.name,
      r.isWinner ? 1 : 0,
      r.bankrupt ? 1 : 0,
      r.level,
      r.shopCount,
      r.monopolyAreas,
      a.total ?? 0,
      a.cash ?? 0,
      a.shopAsset ?? 0,
      a.stockAsset ?? 0,
      s.count ?? 0,
      s.total ?? 0,
      s.average ?? 0,
      s.greatest ?? 0,
      p.count ?? 0,
      p.total ?? 0,
      p.average ?? 0,
      p.greatest ?? 0,
      r.stockReturn ?? 0,
      r.nextSalary ?? 0,
      st.nudgeSent ?? 0,
      st.nudgeReceived ?? 0,
    ].map(csvEscape).join(',');
  });
  return `${header.join(',')}\n${rows.join('\n')}\n`;
}

export function gameResultsExportFilename(payload, ext = 'json') {
  const stamp = String(payload?.exportedAt || new Date().toISOString())
    .replace(/[:.]/g, '-')
    .replace(/Z$/, '');
  const map = String(payload?.mapId || 'map').replace(/[^\w-]+/g, '_');
  return `mkmk-street-${map}-T${payload?.turn || 0}-${stamp}.${ext}`;
}

export const GAME_RESULTS_SCHEMA = 'mkmk-street-results/v1';

/**
 * エクスポート JSON（文字列 or オブジェクト）を検証して返す。
 * @returns {{ ok: true, payload: object } | { ok: false, error: string }}
 */
export function parseGameResultsExport(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return { ok: false, error: 'JSONが空です' };
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: 'JSONの形式が正しくありません' };
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: '試合結果オブジェクトではありません' };
  }
  if (data.schema && data.schema !== GAME_RESULTS_SCHEMA) {
    return { ok: false, error: `未対応のスキーマです（${data.schema}）` };
  }
  if (!Array.isArray(data.ranking) || !data.ranking.length) {
    return { ok: false, error: '順位データがありません' };
  }
  return { ok: true, payload: data };
}

/**
 * エクスポート JSON を結果画面用の results 形へ戻す。
 * @param {object} payload formatGameResultsExport の戻り
 */
export function resultsFromExportPayload(payload) {
  const ranking = (payload?.ranking || []).map((r, i) => ({
    rank: Number(r.rank) || i + 1,
    id: r.id,
    name: r.name || `P${r.id}`,
    color: r.color || '#c4a574',
    bankrupt: !!r.bankrupt,
    level: Number(r.level) || 1,
    shopCount: Number(r.shopCount) || 0,
    monopolyAreas: Number(r.monopolyAreas) || 0,
    isWinner: !!r.isWinner,
    assets: {
      cash: Number(r.assets?.cash) || 0,
      shopAsset: Number(r.assets?.shopAsset) || 0,
      stockAsset: Number(r.assets?.stockAsset) || 0,
      total: Number(r.assets?.total) || 0,
    },
    sales: {
      count: Number(r.sales?.count) || 0,
      total: Number(r.sales?.total) || 0,
      average: Number(r.sales?.average) || 0,
      greatest: Number(r.sales?.greatest) || 0,
    },
    payments: {
      count: Number(r.payments?.count) || 0,
      total: Number(r.payments?.total) || 0,
      average: Number(r.payments?.average) || 0,
      greatest: Number(r.payments?.greatest) || 0,
    },
    stockReturn: Number(r.stockReturn) || 0,
    nextSalary: Number(r.nextSalary) || 0,
    stats: { ...createEmptyStats(), ...(r.stats || {}) },
  }));
  const worthHistory = (payload?.worthHistory || []).map((h) => ({
    turn: Number(h.turn) || 0,
    values: { ...(h.values || {}) },
  }));
  const maxTotal = Math.max(
    1,
    Number(payload?.goal) || 1,
    ...ranking.map((r) => Math.max(0, r.assets.total)),
    ...worthHistory.flatMap((h) => Object.values(h.values || {}).map((n) => Math.max(0, Number(n) || 0))),
  );
  return {
    winnerId: payload?.winnerId ?? ranking.find((r) => r.isWinner)?.id ?? null,
    ranking,
    awards: (payload?.awards || []).map((a) => ({
      id: a.id,
      title: a.title || '',
      desc: a.desc || '',
      playerId: a.playerId,
      playerName: a.playerName || '',
      playerColor: a.playerColor || '#c4a574',
      value: Number(a.value) || 0,
      valueLabel: a.valueLabel || String(a.value ?? ''),
    })),
    maxTotal,
    goal: Number(payload?.goal) || 0,
    turn: Number(payload?.turn) || 1,
    startCash: Number(payload?.startCash) || 0,
    worthHistory,
    meta: {
      exportedAt: payload?.exportedAt || null,
      mapId: payload?.mapId ?? null,
      mapName: payload?.mapName ?? null,
      mode: payload?.mode ?? null,
      schema: payload?.schema || GAME_RESULTS_SCHEMA,
    },
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

/** ワイルドカードの最大所持数 */
export const MAX_WILDCARDS = 4;

export function getWildcardCount(p) {
  return Math.max(0, Math.min(MAX_WILDCARDS, Math.floor(Number(p?.wildcards) || 0)));
}

/**
 * ワイルドカードを1枚付与。上限なら false。
 * @returns {boolean}
 */
export function grantWildcard(g, p) {
  if (!p) return false;
  const have = getWildcardCount(p);
  if (have >= MAX_WILDCARDS) {
    addLog(g, `${p.name} はワイルドカードが上限（${MAX_WILDCARDS}枚）`, 'mark');
    return false;
  }
  p.wildcards = have + 1;
  addLog(g, `${p.name} がワイルドカードを入手！（${p.wildcards}/${MAX_WILDCARDS}）`, 'mark');
  return true;
}

/**
 * 銀行到達時：ワイルドカードで空きマークを埋める。
 * レベルアップできる枚数そろっているときだけ、必要枚数だけ消費する。
 * 足りない場合は一切消費しない。
 * @returns {number} 埋めた枚数
 */
export function applyWildcardsToMarks(p) {
  if (!p?.marks) return 0;
  const w = getWildcardCount(p);
  if (!w) return 0;
  const missingIdx = [];
  for (let i = 0; i < p.marks.length; i++) {
    if (!p.marks[i]) missingIdx.push(i);
  }
  const need = missingIdx.length;
  // すでに揃っている／足りない → 消費しない
  if (need === 0 || w < need) return 0;
  for (const i of missingIdx) p.marks[i] = true;
  p.wildcards = w - need;
  return need;
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
    diceMax: getMoveDiceMax(g),
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
    potionSellQueue: Array.isArray(g.potionSellQueue) ? g.potionSellQueue : null,
    eventNpcs: Array.isArray(g.eventNpcs) ? g.eventNpcs : [],
    povertyHolidayClearTurn: g.povertyHolidayClearTurn ?? null,
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
  for (const p of g.players || []) {
    ensureStats(p);
    if (!p.turnSellPressure || typeof p.turnSellPressure !== 'object') p.turnSellPressure = {};
  }
  // 再接続・旧状態で未知色が残っていてもパレットへ寄せる
  if (Array.isArray(g.players) && g.players.length) {
    const normalized = normalizeLobbyColors(g.players);
    g.players = g.players.map((p, i) => ({ ...p, color: normalized[i].color }));
  }
  // 店の増資・価格を数値として正規化（欠損で NaN 増資にならないように）
  for (const sq of g.map || []) {
    if (!sq || sq.type !== 'shop') continue;
    const base = Math.max(0, Math.floor(Number(sq.basePrice) || 0));
    const extra = Math.max(0, Math.floor(Number(sq.extraInvest) || 0));
    sq.basePrice = base || sq.basePrice || 0;
    sq.extraInvest = extra;
    if (!Number.isFinite(Number(sq.price)) || Number(sq.price) < base) {
      sq.price = base + extra;
    }
  }
  if (!Array.isArray(g.switchGates)) g.switchGates = [];
  if (!Array.isArray(g.switchMoves)) g.switchMoves = [];
  g.switchState = g.switchState ? 1 : 0;
  if (!Array.isArray(g.eventNpcs)) g.eventNpcs = [];
  if (!Array.isArray(g.eventNpcFx)) g.eventNpcFx = [];
  if (g.povertyHolidayClearTurn === undefined) g.povertyHolidayClearTurn = null;
  for (const sq of g.map || []) {
    if (sq && sq.eventHoliday != null) sq.eventHoliday = !!sq.eventHoliday;
  }
  {
    const raw = Number(g.diceMax);
    g.diceMax = Number.isFinite(raw) && raw >= 2 ? Math.floor(raw) : MOVE_DICE_MAX_DEFAULT;
  }
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

/**
 * 乗った時点で即時ジャンプするマス（門・階層）の行き先。
 * ワープは着地時のみなのでここでは扱わない。
 */
function immediateTransitDest(g, pos) {
  const n = getNode(g, pos);
  if (!n) return null;
  if (n.type === 'gate') {
    let destId = n.gateTo;
    if (destId == null) {
      destId = g.map.find((x) => x.type === 'gate' && x.id !== n.id)?.id;
    }
    if (destId != null && destId !== n.id && getNode(g, destId)) return destId;
  }
  if (n.type === 'shaft') {
    let dest = null;
    if (n.shaft === 'down' && n.floor === 1) {
      dest = g.map.find((x) => x.type === 'shaft' && x.shaft === 'down' && x.floor === 2);
    } else if (n.shaft === 'up' && n.floor === 2) {
      dest = g.map.find((x) => x.type === 'shaft' && x.shaft === 'up' && x.floor === 1);
    }
    if (dest && dest.id !== n.id) return dest.id;
  }
  return null;
}

/** ワープ着地なら転送先（1段）。門は「乗った時点」で処理するためここでは扱わない。 */
export function resolveLandingDestId(g, pos) {
  const n = getNode(g, pos);
  if (n?.type === 'warp' && n.warpTo != null && getNode(g, n.warpTo)) {
    return n.warpTo;
  }
  return pos;
}

/** 最終着地候補に追加。転移マスなら元・先の両方を入れる。 */
function addLandingCandidateEnd(g, ends, pos) {
  const n = getNode(g, pos);
  if (n?.type === 'warp' && n.warpTo != null && getNode(g, n.warpTo)) {
    ends.add(pos);
    ends.add(n.warpTo);
    return;
  }
  ends.add(pos);
}

/**
 * 出目（残り歩数）で最終的に止まりうるマス ID 一覧。
 * 分岐はすべて辿り、行き止まりは残り歩数があってもそこで着地扱い。
 * 門・階層は通過／着地時に即ジャンプして残歩数を継続。
 * ワープマス着地は転移元と転移先の両方を候補にする。
 */
export function getLandingCandidates(g, fromPos, prevPos, steps) {
  const left0 = Math.max(0, Math.floor(Number(steps) || 0));
  const ends = new Set();
  const seen = new Set();

  const walk = (pos, prev, left) => {
    const key = `${pos}|${prev ?? 'x'}|${left}`;
    if (seen.has(key)) return;
    seen.add(key);

    if (left <= 0) {
      // ここに来る時点で門ジャンプ済み。ワープは元・先の両方
      addLandingCandidateEnd(g, ends, pos);
      return;
    }
    const nexts = getForwardNexts(g, pos, prev);
    if (!nexts.length) {
      addLandingCandidateEnd(g, ends, pos);
      return;
    }
    for (const nid of nexts) {
      // 1歩で nid に入り、門／階層なら即ジャンプして残歩数継続（prev はクリア）
      const transit = immediateTransitDest(g, nid);
      if (transit != null) walk(transit, null, left - 1);
      else walk(nid, pos, left - 1);
    }
  };

  walk(fromPos, prevPos, left0);
  return [...ends];
}

/**
 * 分岐中に最終停止マスをクリックしたとき、そのマスへ向かう次の一歩を返す。
 * @param {number[]} [optionIds] 省略時は from の前進候補
 * @returns {number|null}
 */
export function findForkNextForLanding(g, fromPos, prevPos, stepsLeft, landingId, optionIds = null) {
  const target = Number(landingId);
  const left = Math.max(0, Math.floor(Number(stepsLeft) || 0));
  if (!Number.isFinite(target) || left <= 0) return null;
  const options = Array.isArray(optionIds) && optionIds.length
    ? optionIds.map(Number)
    : getForwardNexts(g, fromPos, prevPos);
  for (const nextId of options) {
    if (left === 1) {
      // 門／階層は乗った時点でジャンプした先が着地。
      // 転移マスは元・先どちらをクリックしてもその一歩を選ぶ。
      const landed = immediateTransitDest(g, nextId) ?? nextId;
      if (
        nextId === target
        || landed === target
        || resolveLandingDestId(g, landed) === target
      ) return nextId;
      continue;
    }
    // 1歩進んだあとの候補（門ジャンプ込み）に target が含まれるか
    const transit = immediateTransitDest(g, nextId);
    const ends = transit != null
      ? getLandingCandidates(g, transit, null, left - 1)
      : getLandingCandidates(g, nextId, fromPos, left - 1);
    if (ends.includes(target)) return nextId;
  }
  return null;
}

const ORE_TABLE = {
  iron: { faces: 6, prizes: [0, 0, 100, 200, 350, 550], label: '鉄鉱石' },
  gold: { faces: 6, prizes: [50, 170, 290, 410, 530, 650], label: '金鉱石' },
  diamond: { faces: 8, prizes: [0, 0, 200, 300, 400, 500, 600, 2000], label: 'ダイヤ鉱石' },
};

function rollOrePrize(g, p, oreKind) {
  const table = ORE_TABLE[oreKind];
  if (!table) return;
  const face = 1 + Math.floor(rngNext(g) * table.faces);
  const prize = table.prizes[face - 1] || 0;
  if (prize > 0) {
    p.cash += prize;
    bumpStat(p, 'eventIncome', prize);
    addLog(g, `${p.name} が${table.label}で ${face} → +${prize.toLocaleString()}G！`, 'event');
  } else {
    addLog(g, `${p.name} が${table.label}で ${face} → 空振り…`, 'event');
  }
}

/** 薬品マスの伏せカード枚数（効果ID 1〜6） */
export const POTION_CARD_COUNT = 6;

/** 図鑑／UI用の表向き説明（伏せ中は見せない） */
export const POTION_EFFECT_LABELS = {
  1: 'ランダムな株を20枚取得',
  2: '総資産の5%の現金を取得',
  3: 'ランダムなマークを取得（所持済なら +200G）',
  4: '最下位に300G渡す（自分が最下位なら全員から200G）',
  5: 'ランダムな持株を半分売却',
  6: 'お店を1店舗売却しなければならない',
};

function shufflePotionSlots(g) {
  const slots = [1, 2, 3, 4, 5, 6];
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rngNext(g) * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots;
}

function applyPotionEffect(g, p, effectId) {
  switch (effectId) {
    case 1: {
      const areas = Object.keys(g.areas).map(Number);
      if (!areas.length) return '薬品：株エリアなし';
      const a = areas[Math.floor(rngNext(g) * areas.length)];
      p.stocks[a] = (p.stocks[a] || 0) + 20;
      return `薬品：${getAreaCode(g, a)}株 +20`;
    }
    case 2: {
      const total = getPlayerAssets(g, p).total;
      const n = Math.max(1, Math.floor(total * 0.05));
      p.cash += n;
      return `薬品：総資産の5% +${n.toLocaleString()}G`;
    }
    case 3: {
      const empty = [];
      for (let i = 0; i < 4; i++) if (!p.marks[i]) empty.push(i);
      if (!empty.length) {
        p.cash += 200;
        return '薬品：マーク揃い済み → +200G';
      }
      const idx = empty[Math.floor(rngNext(g) * empty.length)];
      p.marks[idx] = true;
      return `薬品：マーク獲得（${SUIT_LABELS[idx]}）`;
    }
    case 4: {
      const alive = g.players.filter((x) => !x.bankrupt);
      let worst = p;
      let worstVal = getPlayerAssets(g, p).total;
      for (const pl of alive) {
        const t = getPlayerAssets(g, pl).total;
        if (t < worstVal) {
          worst = pl;
          worstVal = t;
        }
      }
      if (worst.id === p.id) {
        let gained = 0;
        for (const pl of alive) {
          if (pl.id === p.id) continue;
          const take = Math.min(pl.cash, 200);
          pl.cash -= take;
          gained += take;
        }
        p.cash += gained;
        return `薬品：最下位ボーナス 全員から計+${gained.toLocaleString()}G`;
      }
      const gift = Math.min(p.cash, 300);
      p.cash -= gift;
      worst.cash += gift;
      return `薬品：最下位の${worst.name}へ ${gift.toLocaleString()}G`;
    }
    case 5: {
      const held = Object.keys(p.stocks || {}).map(Number).filter((a) => (p.stocks[a] || 0) > 0);
      if (!held.length) return '薬品：売却できる株なし';
      const a = held[Math.floor(rngNext(g) * held.length)];
      const have = p.stocks[a] || 0;
      const sell = Math.max(1, Math.floor(have / 2));
      const price = g.areas[a]?.stockPrice || 0;
      const got = price * sell;
      p.stocks[a] = have - sell;
      if (p.stocks[a] <= 0) delete p.stocks[a];
      p.cash += got;
      return `薬品：${getAreaCode(g, a)}株 ${sell}枚売却 +${got.toLocaleString()}G`;
    }
    case 6: {
      const shops = g.map.filter((s) => s.type === 'shop' && s.owner === p.id);
      if (!shops.length) {
        const fine = Math.min(p.cash, 60);
        p.cash -= fine;
        return fine > 0
          ? `薬品：所持店なし → 罰金 −${fine.toLocaleString()}G`
          : '薬品：所持店なし（罰金なし）';
      }
      return '薬品：お店を1店舗売却しなければならない';
    }
    default:
      return '薬品：効果なし';
  }
}

/** 薬品マス：全員が伏せカードから1枚選ぶ */
function openPotionPick(g, starter) {
  const alive = g.players.filter((pl) => pl && !pl.bankrupt);
  if (!alive.length) return false;
  const slots = shufflePotionSlots(g);
  // 止めた人から順に選択
  const ordered = [
    starter,
    ...alive.filter((pl) => pl.id !== starter.id),
  ];
  g.phase = 'await_choice';
  g.pending = {
    type: 'potion_pick',
    playerId: ordered[0].id,
    starterId: starter.id,
    participantIds: ordered.map((pl) => pl.id),
    picks: {},
    slots,
  };
  g.potionSellQueue = null;
  addLog(g, `${starter.name} が薬品マス！ 全員で伏せカードを選ぶ`, 'event');
  return true;
}

function openNextPotionForceSell(g) {
  const q = g.potionSellQueue;
  if (!Array.isArray(q) || !q.length) {
    g.potionSellQueue = null;
    return false;
  }
  while (q.length) {
    const pid = q.shift();
    const pl = g.players[pid];
    if (!pl || pl.bankrupt) continue;
    const shops = g.map.filter((s) => s.type === 'shop' && s.owner === pid);
    if (!shops.length) continue;
    g.phase = 'await_choice';
    g.pending = {
      type: 'force_sell_shop',
      playerId: pid,
      shopIds: shops.map((s) => s.id),
      fromPotion: true,
    };
    addLog(g, `${pl.name} は薬品の効果でお店を1店舗売却しなければならない`, 'event');
    return true;
  }
  g.potionSellQueue = null;
  return false;
}

function finalizePotionPick(g, pending) {
  const slots = pending.slots || [1, 2, 3, 4, 5, 6];
  const results = [];
  const sellQueue = [];
  for (const pid of pending.participantIds || []) {
    const pl = g.players[pid];
    if (!pl || pl.bankrupt) continue;
    const slot = Number(pending.picks?.[pid]);
    const effectId = Number.isFinite(slot) ? slots[slot] : null;
    if (!effectId) continue;
    const detail = applyPotionEffect(g, pl, effectId);
    results.push({
      playerId: pid,
      name: pl.name,
      slot,
      effectId,
      detail,
    });
    addLog(g, `${pl.name} → ${detail}`, 'event');
    if (effectId === 6) {
      const shops = g.map.filter((s) => s.type === 'shop' && s.owner === pid);
      if (shops.length) sellQueue.push(pid);
    }
  }
  g.pending = null;
  g.potionSellQueue = sellQueue.length ? sellQueue : null;
  g.potionReveal = results;
  if (openNextPotionForceSell(g)) {
    return {
      ok: true,
      potionReveal: true,
      results,
      forceSell: true,
      state: serializeState(g),
    };
  }
  endTurn(g);
  return {
    ok: true,
    potionReveal: true,
    results,
    state: serializeState(g),
  };
}

function resolvePotionPick(g, p, pending, choice) {
  if (pending.picks?.[p.id] != null) {
    return { ok: false, error: 'already_picked' };
  }
  const slot = Number(choice.slot ?? choice.value);
  if (!Number.isFinite(slot) || slot < 0 || slot >= POTION_CARD_COUNT) {
    return { ok: false, error: 'bad_choice' };
  }
  pending.picks = pending.picks || {};
  pending.picks[p.id] = slot;

  const waiting = (pending.participantIds || []).filter((id) => {
    const pl = g.players[id];
    return pl && !pl.bankrupt && pending.picks[id] == null;
  });
  if (waiting.length) {
    pending.playerId = waiting[0];
    addLog(g, `${p.name} が薬品カードを選択（残り${waiting.length}人）`, 'event');
    return {
      ok: true,
      potionPick: true,
      waitingCount: waiting.length,
      state: serializeState(g),
    };
  }
  return finalizePotionPick(g, pending);
}

/** 本島＝銀行からワープなしで到達できる連結成分 */
function isMainlandNode(g, nodeId) {
  if (!g._mainlandCache || g._mainlandCache.seed !== g.mapId) {
    const start = g.startId;
    const set = new Set([start]);
    const q = [start];
    while (q.length) {
      const id = q.shift();
      const n = getNode(g, id);
      for (const nid of n?.nexts || []) {
        if (set.has(nid)) continue;
        set.add(nid);
        q.push(nid);
      }
    }
    g._mainlandCache = { seed: g.mapId, set };
  }
  return g._mainlandCache.set.has(nodeId);
}

function teleportPlayer(g, p, destId, label) {
  const fromId = p.pos;
  const dest = getNode(g, destId);
  if (!dest) return false;
  recordWarp(g, p.id, fromId, dest.id);
  p.prevPos = null;
  p.pos = dest.id;
  addLog(g, `${p.name} が${label}！ → ${dest.label}`, 'event');
  return true;
}

/** 下降／上昇シャフト：入口側に乗ったら出口へ（残出目継続） */
function tryShaftTransit(g, p) {
  const sq = getNode(g, p.pos);
  if (!sq || sq.type !== 'shaft') return false;
  let dest = null;
  if (sq.shaft === 'down' && sq.floor === 1) {
    dest = g.map.find((n) => n.type === 'shaft' && n.shaft === 'down' && n.floor === 2);
  } else if (sq.shaft === 'up' && sq.floor === 2) {
    dest = g.map.find((n) => n.type === 'shaft' && n.shaft === 'up' && n.floor === 1);
  }
  if (!dest || dest.id === sq.id) return false;
  return teleportPlayer(g, p, dest.id, sq.label || '階層移動');
}

/** 門：乗った時点で反対側の門へ（残出目継続） */
function tryGateTransit(g, p) {
  const sq = getNode(g, p.pos);
  if (!sq || sq.type !== 'gate') return false;
  const destId = sq.gateTo;
  if (destId == null) {
    const other = g.map.find((n) => n.type === 'gate' && n.id !== sq.id);
    if (!other) return false;
    return teleportPlayer(g, p, other.id, '門');
  }
  if (destId === sq.id) return false;
  return teleportPlayer(g, p, destId, '門');
}

/** 転移坑：ぴったり停止時のみ */
function tryPitTransit(g, p) {
  const sq = getNode(g, p.pos);
  if (!sq || sq.type !== 'pit') return false;
  if (sq.pit === 'down') {
    const dest = g.map.find((n) => n.type === 'pit' && n.pit === 'up');
    if (!dest) return false;
    return teleportPlayer(g, p, dest.id, '転移下降');
  }
  if (sq.pit === 'up') {
    const downs = g.map.filter((n) => n.type === 'pit' && n.pit === 'down');
    if (!downs.length) return false;
    const dest = downs[Math.floor(rngNext(g) * downs.length)];
    return teleportPlayer(g, p, dest.id, '転移上昇');
  }
  return false;
}

function onPassThrough(g, p, nodeId) {
  const nd = getNode(g, nodeId);
  if (!nd) return;
  if (nd.type === 'mark' && !p.marks[nd.mark]) {
    p.marks[nd.mark] = true;
    addLog(g, `${p.name} が通過で ${SUIT_LABELS[nd.mark]} を入手！`, 'mark');
  }
  // 通過のみここで付与。最終着地は resolveLanding 側（二重付与防止）
  if (nd.type === 'suit_fill' && g.move && g.move.stepsLeft > 0) {
    grantWildcard(g, p);
  }
  if (nd.type === 'ore' && nd.ore) {
    rollOrePrize(g, p, nd.ore);
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

  // 下降／上昇：乗った時点で階層移動（残出目は維持）
  if (tryShaftTransit(g, p)) {
    if (g.move.stepsLeft <= 0) return { ...finishMove(g, p), stepped: true, from, to: p.pos, shaft: true };
    return {
      ok: true,
      stepped: true,
      from,
      to: p.pos,
      shaft: true,
      done: false,
      stepsLeft: g.move.stepsLeft,
      state: serializeState(g),
    };
  }

  // 門：乗った時点で反対側へ（残出目は維持）
  if (tryGateTransit(g, p)) {
    if (g.move.stepsLeft <= 0) return { ...finishMove(g, p), stepped: true, from, to: p.pos, gate: true };
    return {
      ok: true,
      stepped: true,
      from,
      to: p.pos,
      gate: true,
      done: false,
      stepsLeft: g.move.stepsLeft,
      state: serializeState(g),
    };
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

  if (tryShaftTransit(g, p)) {
    if (g.move.stepsLeft <= 0) return { ...finishMove(g, p), stepped: true, from, to: p.pos, shaft: true };
    return {
      ok: true,
      stepped: true,
      from,
      to: p.pos,
      shaft: true,
      done: false,
      stepsLeft: g.move.stepsLeft,
      state: serializeState(g),
    };
  }

  if (tryGateTransit(g, p)) {
    if (g.move.stepsLeft <= 0) return { ...finishMove(g, p), stepped: true, from, to: p.pos, gate: true };
    return {
      ok: true,
      stepped: true,
      from,
      to: p.pos,
      gate: true,
      done: false,
      stepsLeft: g.move.stepsLeft,
      state: serializeState(g),
    };
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

/** エリア数が多いマップは移動ダイスの面数を広げる（11以上 → 1〜10） */
/** マップごとの移動ダイス最大出目（game.diceMax／board.diceMax。未設定時は6） */
export function getMoveDiceMax(gOrBoard) {
  const raw = Number(gOrBoard?.diceMax);
  if (Number.isFinite(raw) && raw >= 2) return Math.floor(raw);
  return MOVE_DICE_MAX_DEFAULT;
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
    addLog(g, `${p.name} のお店が営業再開した`, 'system');
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

  const diceMax = getMoveDiceMax(g);
  const d = Math.floor(rngNext(g) * diceMax) + 1;
  g.dice = d;
  g.phase = 'moving';
  g.move = { stepsLeft: d, path: [], passedBank: false, startPos: p.pos };
  bumpStat(p, 'rolls', 1);
  bumpStat(p, 'diceTotal', d);
  // 出目数値は演出後に UI が表示。ログも演出中のネタバレを避けるため「？」で残し、UI が確定後に見せる
  addLog(g, `${p.name} がサイコロを振った`, 'dice');

  return { ok: true, dice: d, diceMax, needsAdvance: true, state: serializeState(g) };
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
    addLog(g, `${p.name} は${sq.label || '分岐点'}に停止`, 'system');
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

  if (sq.type === 'warp_random') {
    if (fromWarp) {
      addLog(g, `${p.name} はランダム転移マスに停止`, 'system');
      finishLanding(g, p);
      return;
    }
    // 小島（本島以外）の転移マスへランダム転移
    const pool = g.map.filter((n) => n.type === 'warp' && !isMainlandNode(g, n.id));
    if (!pool.length) {
      addLog(g, `${p.name} のランダム転移先がない…`, 'system');
      finishLanding(g, p);
      return;
    }
    const dest = pool[Math.floor(rngNext(g) * pool.length)];
    recordWarp(g, p.id, p.pos, dest.id);
    p.prevPos = null;
    p.pos = dest.id;
    addLog(g, `${p.name} がランダム転移！ → ${dest.label}`, 'event');
    resolveLanding(g, p, { passedBank: false, fromWarp: true });
    return;
  }

  if (sq.type === 'pit') {
    if (fromWarp) {
      finishLanding(g, p);
      return;
    }
    if (tryPitTransit(g, p)) {
      resolveLanding(g, p, { passedBank: false, fromWarp: true });
      return;
    }
    finishLanding(g, p);
    return;
  }

  if (sq.type === 'shaft') {
    // 入口なら階層移動して着地解決。出口マスならその場で停止
    if (!fromWarp && tryShaftTransit(g, p)) {
      resolveLanding(g, p, { passedBank: false, fromWarp: true });
      return;
    }
    addLog(g, `${p.name} は${sq.label || '階層マス'}に停止`, 'system');
    finishLanding(g, p);
    return;
  }

  if (sq.type === 'ore') {
    // 通過時に付与済みなら二重を避ける（最終マスは applyStep で既に処理）
    addLog(g, `${p.name} は${sq.label || '鉱石'}マスに停止`, 'system');
    finishLanding(g, p);
    return;
  }

  if (sq.type === 'potion') {
    openPotionPick(g, p);
    return;
  }

  if (sq.type === 'gate') {
    // 移動中の tryGateTransit で既に反対側へ飛んでいる想定。着地のみならその場で停止
    addLog(g, `${p.name} は門に停止`, 'system');
    finishLanding(g, p);
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
    grantWildcard(g, p);
    // マークマスと同様、ぴったり停止でスクラッチ1回
    openScratch(g, p);
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
  const filled = applyWildcardsToMarks(p);
  if (filled > 0) {
    addLog(g, `${p.name} のワイルドカード×${filled}が空きマークに変化！`, 'mark');
  }
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
    // 余ったワイルドカードは持ち越し
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
  const m = Number(p?.flags?.takeoverMulti);
  if (Number.isFinite(m) && m >= 2 && m <= 4) return Math.floor(m);
  if (p?.flags?.fiveBuyCoupon) return 3;
  return 5;
}

function clearTakeoverCoupon(p) {
  if (!p?.flags) return;
  p.flags.fiveBuyCoupon = false;
  p.flags.takeoverMulti = null;
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

/** 店価合計（取引の差額計算用） */
export function sumShopPrices(g, shopIds = []) {
  let total = 0;
  for (const id of shopIds) {
    const sq = getNode(g, id);
    if (sq?.type === 'shop') total += Number(sq.price) || 0;
  }
  return total;
}

/** 差額のデフォルト（正: 提案者が相手へ支払う） */
export function defaultShopTradeCashDelta(giveValue, takeValue) {
  return Math.floor(Number(takeValue) || 0) - Math.floor(Number(giveValue) || 0);
}

/** 自分のターン開始時に物件取引を開けるか */
export function canOpenShopTrade(g, playerId) {
  if (!g || g.phase !== 'await_roll') return false;
  if (g.currentPlayerIdx !== playerId) return false;
  const p = g.players[playerId];
  if (!p || p.bankrupt || p.resting) return false;
  const others = g.players.filter((o) => o.id !== playerId && !o.bankrupt);
  if (!others.length) return false;
  const mine = g.map.some((s) => s.type === 'shop' && s.owner === playerId);
  const theirs = others.some((o) => g.map.some((s) => s.type === 'shop' && s.owner === o.id));
  return mine && theirs;
}

/** 物件取引の作成UIを開く（サイコロ前） */
export function openShopTradeCompose(g, playerId) {
  if (!canOpenShopTrade(g, playerId)) return { ok: false, error: 'cannot_trade' };
  g.phase = 'await_choice';
  g.pending = {
    type: 'shop_trade_compose',
    playerId,
    targetId: null,
    giveShopIds: [],
    takeShopIds: [],
    cashDelta: 0,
  };
  addLog(g, `${g.players[playerId].name} が物件取引を提案中`, 'system');
  return { ok: true, state: serializeState(g) };
}

function syncShopTradeCashDefault(g, pending) {
  const giveValue = sumShopPrices(g, pending.giveShopIds);
  const takeValue = sumShopPrices(g, pending.takeShopIds);
  pending.cashDelta = defaultShopTradeCashDelta(giveValue, takeValue);
}

function validateShopTradeSides(g, fromId, toId, giveShopIds, takeShopIds) {
  if (!Array.isArray(giveShopIds) || !Array.isArray(takeShopIds)) {
    return { ok: false, error: 'need_shops' };
  }
  if (giveShopIds.length < 1 || takeShopIds.length < 1) {
    return { ok: false, error: 'need_shops' };
  }
  const giveSet = new Set();
  for (const id of giveShopIds) {
    const sid = Number(id);
    if (giveSet.has(sid)) return { ok: false, error: 'bad_give' };
    giveSet.add(sid);
    const sq = getNode(g, sid);
    if (!sq || sq.type !== 'shop' || sq.owner !== fromId) return { ok: false, error: 'bad_give' };
  }
  const takeSet = new Set();
  for (const id of takeShopIds) {
    const sid = Number(id);
    if (takeSet.has(sid)) return { ok: false, error: 'bad_take' };
    takeSet.add(sid);
    const sq = getNode(g, sid);
    if (!sq || sq.type !== 'shop' || sq.owner !== toId) return { ok: false, error: 'bad_take' };
  }
  return { ok: true };
}

/**
 * 物件交換を実行。cashDelta>0 なら from→to、cashDelta<0 なら to→from。
 * 店価・増資はそのまま引き継ぐ。
 */
export function executeShopTrade(g, {
  fromId,
  toId,
  giveShopIds = [],
  takeShopIds = [],
  cashDelta = 0,
} = {}) {
  const from = g.players[fromId];
  const to = g.players[toId];
  if (!from || !to || from.bankrupt || to.bankrupt) return { ok: false, error: 'bad_player' };
  const check = validateShopTradeSides(g, fromId, toId, giveShopIds, takeShopIds);
  if (!check.ok) return check;

  const delta = Math.floor(Number(cashDelta) || 0);
  const fromPay = Math.max(0, delta);
  const toPay = Math.max(0, -delta);
  if (from.cash < fromPay) return { ok: false, error: 'proposer_cash' };
  if (to.cash < toPay) return { ok: false, error: 'target_cash' };

  const areas = new Set();
  /** @type {object[]} */
  const breaks = [];
  for (const id of giveShopIds) {
    const sq = getNode(g, Number(id));
    const old = sq.owner;
    sq.owner = toId;
    areas.add(sq.area);
    const brk = applyMonopolyBreak(g, old, sq.area);
    if (brk) breaks.push(brk);
  }
  for (const id of takeShopIds) {
    const sq = getNode(g, Number(id));
    const old = sq.owner;
    sq.owner = fromId;
    areas.add(sq.area);
    const brk = applyMonopolyBreak(g, old, sq.area);
    if (brk) breaks.push(brk);
  }

  from.cash -= fromPay;
  to.cash += fromPay;
  to.cash -= toPay;
  from.cash += toPay;

  /** @type {object[]} */
  const monos = [];
  for (const area of areas) {
    const m1 = tryGrantMonopolyBonus(g, from, area);
    const m2 = tryGrantMonopolyBonus(g, to, area);
    if (m1) monos.push(m1);
    if (m2) monos.push(m2);
  }
  if (!breaks.length) updateAreaStockPrices(g);

  const giveNames = giveShopIds.map((id) => getNode(g, Number(id))?.label).filter(Boolean);
  const takeNames = takeShopIds.map((id) => getNode(g, Number(id))?.label).filter(Boolean);
  let cashNote = '';
  if (fromPay > 0) cashNote = `／ ${from.name} が ${fromPay.toLocaleString()}G 支払い`;
  else if (toPay > 0) cashNote = `／ ${to.name} が ${toPay.toLocaleString()}G 支払い`;
  addLog(
    g,
    `${from.name} ⇔ ${to.name} 物件取引（出: ${giveNames.join('・') || '—'} → 受: ${takeNames.join('・') || '—'}${cashNote}）`,
    'shop',
  );
  bumpStat(from, 'shopsBought', takeShopIds.length);
  bumpStat(to, 'shopsBought', giveShopIds.length);

  return {
    ok: true,
    monopolyBreak: breaks[0] || undefined,
    monopoly: monos[0] || undefined,
  };
}

/** 取引評価用：店価＋エリア株の概算価値 */
function cpuShopBundleWorth(g, pid, shopIds) {
  let shop = 0;
  const areas = new Set();
  for (const id of shopIds || []) {
    const sq = getNode(g, Number(id));
    if (!sq || sq.type !== 'shop') continue;
    shop += sq.price || 0;
    areas.add(sq.area);
  }
  let stock = 0;
  for (const a of areas) {
    const held = Math.max(0, Math.floor(Number(g.players[pid]?.stocks?.[a]) || 0));
    stock += held * (g.areas[a]?.stockPrice || 0);
  }
  return shop + stock * 0.35;
}

/** CPUが取引を受けるか（有利／ウィンウィンのみ。独占核は大幅上積み必須） */
export function cpuShouldAcceptShopTrade(g, responder, pending) {
  if (!responder || !pending) return false;
  const giveValue = sumShopPrices(g, pending.giveShopIds);
  const takeValue = sumShopPrices(g, pending.takeShopIds);
  const delta = Math.floor(Number(pending.cashDelta) || 0);
  // responder は take を渡し、give を受け取る
  const receive = giveValue + Math.max(0, delta);
  const pay = takeValue + Math.max(0, -delta);
  if (responder.cash < Math.max(0, -delta)) return false;
  const traits = getCpuPersonality(responder);
  let threshold = 1.05;
  if (traits.key === 'tycoon') threshold = 1.12;
  if (traits.key === 'magnate') threshold = 1.1;
  if (traits.key === 'gambler') threshold = 0.98;
  if (traits.key === 'broker') threshold = 1.08;

  let completesMono = false;
  let breaksOwnMono = false;
  let blocksEnemyMono = false;
  let givesEnemyMono = false;

  for (const id of pending.takeShopIds || []) {
    const sq = getNode(g, Number(id));
    if (!sq) continue;
    if (hasAreaMonopoly(g, responder.id, sq.area)) {
      breaksOwnMono = true;
      threshold += 0.35;
    }
    const areaSize = getAreaShops(g, sq.area).length;
    const enemyCnt = getPlayerAreaCount(g, pending.fromId, sq.area);
    if (enemyCnt + 1 >= areaSize) givesEnemyMono = true;
  }
  for (const id of pending.giveShopIds || []) {
    const sq = getNode(g, Number(id));
    if (!sq) continue;
    const areaSize = getAreaShops(g, sq.area).length;
    const mine = getPlayerAreaCount(g, responder.id, sq.area);
    if (mine + 1 >= areaSize) {
      completesMono = true;
      threshold -= 0.22;
    }
    const enemyCnt = getPlayerAreaCount(g, pending.fromId, sq.area);
    if (enemyCnt >= areaSize) blocksEnemyMono = true;
  }
  if (givesEnemyMono && !completesMono) threshold += 0.28;
  if (blocksEnemyMono) threshold -= 0.08;

  const receiveWorth = cpuShopBundleWorth(g, responder.id, pending.giveShopIds) + Math.max(0, delta);
  const payWorth = cpuShopBundleWorth(g, responder.id, pending.takeShopIds) + Math.max(0, -delta);
  // 独占核を渡すなら相場を大きく上回る必要あり
  if (breaksOwnMono && receiveWorth < payWorth * 1.45) return false;
  if (!completesMono && !blocksEnemyMono && receive + 1e-6 < pay * threshold) return false;
  return receiveWorth + 1e-6 >= payWorth * Math.max(0.85, threshold - 0.05)
    || receive + 1e-6 >= pay * threshold;
}

/** 所持枚数を超えない売却枚数。0枚所持なら必ず 0。 */
function clampStockSellCount(have, count) {
  const h = Math.max(0, Math.floor(Number(have) || 0));
  if (h <= 0) return 0;
  const want = Math.max(1, Math.floor(Number(count) || 1));
  return Math.min(h, want);
}

function setStockHolding(p, area, next) {
  const a = Number(area);
  const n = Math.max(0, Math.floor(Number(next) || 0));
  if (!p.stocks || typeof p.stocks !== 'object') p.stocks = {};
  if (n <= 0) delete p.stocks[a];
  else p.stocks[a] = n;
}

function sellStockForCash(g, p, area, count) {
  const a = Number(area);
  const have = Math.max(0, Math.floor(Number(p.stocks?.[a]) || 0));
  const n = clampStockSellCount(have, count);
  if (n <= 0 || !g.areas[a]) return { ok: false, error: 'no_stock' };
  const got = g.areas[a].stockPrice * n;
  setStockHolding(p, a, have - n);
  p.cash += got;
  bumpStat(p, 'stockSold', n);
  bumpStat(p, 'stockIncome', got);
  syncStockValueSnap(g, p);
  applyStockSellPressure(g, p, a, n);
  updateAreaStockPrices(g);
  addLog(g, `${p.name} が ${getAreaCode(g, a)}株×${n} 売却（+${got}G）`, 'stock');
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
  p.wildcards = 0;
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

  // 全員参加ミニゲーム中に参加者をキック → 残メンバーで継続／精算（開催者に再ロールを渡さない）
  if (g.pending?.type === 'minigame') {
    const pending = g.pending;
    pending.participantIds = (pending.participantIds || []).filter((id) => id !== pid);
    if (pending.picks && Object.prototype.hasOwnProperty.call(pending.picks, pid)) {
      delete pending.picks[pid];
    }
    const waiting = pending.participantIds.filter((id) => {
      const pl = g.players[id];
      return pl && !pl.bankrupt && pending.picks?.[id] == null;
    });
    if (waiting.length) {
      pending.playerId = waiting[0];
    } else if (pending.participantIds.some((id) => pending.picks?.[id] != null)) {
      return { ...finalizeMinigame(g, pending), kicked: true };
    } else {
      g.pending = null;
      endTurn(g);
      return { ok: true, kicked: true, state: serializeState(g) };
    }
  } else if (g.pending?.playerId === pid) {
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
  if (resume.type === 'any_shop_buy') {
    g.phase = 'await_choice';
    g.pending = {
      type: 'any_shop_buy',
      playerId: p.id,
      multi: resume.multi || 6,
      shopIds: [resume.shopId],
    };
    return;
  }
  if (resume.type === 'vacant_shop_buy') {
    g.phase = 'await_choice';
    g.pending = {
      type: 'vacant_shop_buy',
      playerId: p.id,
      multi: resume.multi || 2,
      shopIds: [resume.shopId],
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
      if (!sq || sq.type !== 'shop' || sq.owner >= 0) {
        return { ok: false, error: 'bad_shop' };
      }
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
    }
    // 分岐の二重クリック等で nextId だけが来ても見送りにしない
    if (choice.action !== 'skip' && choice.action !== 'done') {
      return { ok: false, error: 'bad_choice' };
    }
    addLog(g, `${p.name} は「${sq?.label || 'お店'}」の購入を見送り`, 'system');
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
        sq.extraInvest = (Number(sq.extraInvest) || 0) + amount;
        sq.price = (Number(sq.basePrice) || 0) + sq.extraInvest;
        bumpStat(p, 'investTotal', amount);
        updateAreaStockPrices(g);
        addLog(
          g,
          `${p.name} が「${sq.label}」に ${amount}G 増資${usedCoupon ? '（半額クーポン）' : ''}`,
          'shop'
        );
      }
      g.pending = null;
      endTurn(g);
      return { ok: true, state: serializeState(g) };
    }
    if (choice.action !== 'skip' && choice.action !== 'done') {
      return { ok: false, error: 'bad_choice' };
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
        const usedCoupon = multi < 5 && (!!p.flags.fiveBuyCoupon || !!p.flags.takeoverMulti);
        if (usedCoupon) clearTakeoverCoupon(p);
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
    if (choice.action !== 'skip' && choice.action !== 'done') {
      return { ok: false, error: 'bad_choice' };
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
      if (resume?.type === 'any_shop_buy' && choice.execute) {
        g.pending = {
          type: 'any_shop_buy',
          playerId: p.id,
          multi: resume.multi || 6,
          shopIds: [resume.shopId],
        };
        return applyChoice(g, { action: 'buy', shopId: resume.shopId });
      }
      if (resume?.type === 'vacant_shop_buy' && choice.execute) {
        g.pending = {
          type: 'vacant_shop_buy',
          playerId: p.id,
          multi: resume.multi || 2,
          shopIds: [resume.shopId],
        };
        return applyChoice(g, { action: 'buy', shopId: resume.shopId });
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
      const maxAfford = Math.max(0, Math.floor(p.cash / Math.max(1, price)));
      // 1種類購入時は持ち金の限り（証券・銀行とも）
      const want = Math.max(1, Math.floor(Number(choice.count) || 1));
      const count = Math.min(maxAfford, want);
      const cost = price * count;
      if (count <= 0 || p.cash < cost) return { ok: false, error: 'insufficient' };
      p.cash -= cost;
      setStockHolding(p, area, (Math.max(0, Math.floor(Number(p.stocks?.[area]) || 0)) + count));
      bumpStat(p, 'stockBought', count);
      bumpStat(p, 'stockSpent', cost);
      syncStockValueSnap(g, p);
      if (count >= STOCK_BUY_BOOST_MIN) {
        g.areas[area].B = Math.floor(g.areas[area].B * STOCK_BUY_B_RATE);
      }
      updateAreaStockPrices(g);
      addLog(g, `${p.name} が ${getAreaCode(g, area)}株×${count} 購入（${cost}G）`, 'stock');
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
      if (!g.areas[area]) return { ok: false, error: 'bad_area' };
      const have = Math.max(0, Math.floor(Number(p.stocks?.[area]) || 0));
      const count = clampStockSellCount(have, choice.count);
      if (count <= 0) return { ok: false, error: 'no_stock' };
      const got = g.areas[area].stockPrice * count;
      setStockHolding(p, area, have - count);
      p.cash += got;
      bumpStat(p, 'stockSold', count);
      bumpStat(p, 'stockIncome', got);
      syncStockValueSnap(g, p);
      applyStockSellPressure(g, p, area, count);
      updateAreaStockPrices(g);
      addLog(g, `${p.name} が ${getAreaCode(g, area)}株×${count} 売却（+${got}G）`, 'stock');
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
    let monopolyBreak = null;
    for (const fx of takeScratchSideEffects(g)) {
      if (fx?.type === 'monopolyBreak') {
        monopolyBreak = applyMonopolyBreak(g, fx.pid, fx.area) || monopolyBreak;
      }
    }
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
      monopolyBreak,
    };
    if (maybeOpenForceSell(g, p)) {
      return { ok: true, ...matchPayload, forceSell: true, state: serializeState(g) };
    }
    if (maybeOpenAnyShopBuy(g, p)) {
      return { ok: true, ...matchPayload, anyShopBuy: true, state: serializeState(g) };
    }
    if (maybeOpenVacantShopBuy(g, p)) {
      return { ok: true, ...matchPayload, vacantShopBuy: true, state: serializeState(g) };
    }
    if (maybeOpenForceRivalSell(g, p)) {
      return { ok: true, ...matchPayload, forceRivalSell: true, state: serializeState(g) };
    }
    if (maybeOpenPickInvest(g, p)) {
      return { ok: true, ...matchPayload, pickInvest: true, state: serializeState(g) };
    }
    if (maybeOpenMinigame(g, p)) {
      return { ok: true, ...matchPayload, minigame: true, state: serializeState(g) };
    }
    const spawnedNpc = maybeSpawnEventNpc(g, p);
    if (p.flags.extraRoll) {
      p.flags.extraRoll = false;
      g.phase = 'await_roll';
      return { ok: true, ...matchPayload, eventNpc: spawnedNpc, state: serializeState(g) };
    }
    endTurn(g);
    return { ok: true, ...matchPayload, eventNpc: spawnedNpc, state: serializeState(g) };
  }

  if (pending.type === 'force_sell_shop') {
    const allowed = new Set(pending.shopIds || []);
    let shopId = Number(choice.shopId);
    if (choice.action === 'skip' || !Number.isFinite(shopId)) {
      // おまかせ：安い店から処分
      const shops = g.map.filter((s) => s.type === 'shop' && s.owner === p.id
        && (!allowed.size || allowed.has(s.id)));
      shops.sort((a, b) => a.price - b.price);
      shopId = shops[0]?.id;
    }
    if (!Number.isFinite(shopId) || (allowed.size && !allowed.has(shopId))) {
      return { ok: false, error: 'bad_shop' };
    }
    const sold = sellShopForCash(g, p, shopId);
    if (!sold.ok) return { ok: false, error: sold.error };
    g.pending = null;
    if (pending.fromPotion && openNextPotionForceSell(g)) {
      return {
        ok: true,
        forceSell: true,
        shopId,
        ...(sold.monopolyBreak ? { monopolyBreak: sold.monopolyBreak } : {}),
        state: serializeState(g),
      };
    }
    if (p.flags.extraRoll && !pending.fromPotion) {
      p.flags.extraRoll = false;
      g.phase = 'await_roll';
      return { ok: true, forceSell: true, shopId, state: serializeState(g) };
    }
    endTurn(g);
    return {
      ok: true,
      forceSell: true,
      shopId,
      ...(sold.monopolyBreak ? { monopolyBreak: sold.monopolyBreak } : {}),
      state: serializeState(g),
    };
  }

  if (pending.type === 'potion_pick') {
    return resolvePotionPick(g, p, pending, choice);
  }

  if (pending.type === 'any_shop_buy') {
    const multi = pending.multi || 6;
    if (choice.action === 'skip') {
      g.pending = null;
      endTurn(g);
      return { ok: true, state: serializeState(g) };
    }
    if (choice.action !== 'buy' && choice.action !== 'pick') {
      return { ok: false, error: 'bad_choice' };
    }
    const sq = getNode(g, Number(choice.shopId));
    const allowed = pending.shopIds || [];
    if (!sq || sq.type !== 'shop' || sq.owner < 0 || sq.owner === p.id) {
      return { ok: false, error: 'bad_shop' };
    }
    if (allowed.length && !allowed.includes(sq.id)) {
      return { ok: false, error: 'bad_shop' };
    }
    const price = sq.price * multi;
    if (getLiquidatableValue(g, p) < price) {
      return { ok: false, error: 'insufficient' };
    }
    if (p.cash < price) {
      openRaiseFunds(g, p, {
        targetCash: price,
        reason: 'any_shop_buy',
        resume: {
          type: 'any_shop_buy',
          shopId: sq.id,
          price,
          multi,
        },
      });
      return { ok: true, needFunds: true, state: serializeState(g) };
    }
    const owner = g.players[sq.owner];
    const prevOwnerId = sq.owner;
    const area = sq.area;
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
    addLog(g, `${p.name} が${multi}倍買いで「${sq.label}」を指名買収！`, 'shop');
    const mono = tryGrantMonopolyBonus(g, p, area);
    g.pending = null;
    endTurn(g);
    return {
      ok: true,
      fiveBuy: true,
      fiveBuyShop: sq.label,
      fiveBuyMulti: multi,
      fiveBuyPlayerId: p.id,
      fiveBuyCoupon: false,
      anyShopBuy: true,
      ...(monopolyBreak ? { monopolyBreak } : {}),
      ...(mono || {}),
      state: serializeState(g),
    };
  }

  if (pending.type === 'vacant_shop_buy') {
    const multi = pending.multi || 2;
    if (choice.action === 'skip') {
      g.pending = null;
      endTurn(g);
      return { ok: true, state: serializeState(g) };
    }
    if (choice.action !== 'buy' && choice.action !== 'pick') {
      return { ok: false, error: 'bad_choice' };
    }
    const sq = getNode(g, Number(choice.shopId));
    const allowed = pending.shopIds || [];
    if (!sq || sq.type !== 'shop' || sq.owner >= 0) {
      return { ok: false, error: 'bad_shop' };
    }
    if (allowed.length && !allowed.includes(sq.id)) {
      return { ok: false, error: 'bad_shop' };
    }
    const base = Number(sq.basePrice || sq.price) || 0;
    const price = base * multi;
    if (getLiquidatableValue(g, p) < price) {
      return { ok: false, error: 'insufficient' };
    }
    if (p.cash < price) {
      openRaiseFunds(g, p, {
        targetCash: price,
        reason: 'vacant_shop_buy',
        resume: {
          type: 'vacant_shop_buy',
          shopId: sq.id,
          price,
          multi,
        },
      });
      return { ok: true, needFunds: true, state: serializeState(g) };
    }
    p.cash -= price;
    sq.owner = p.id;
    sq.extraInvest = 0;
    sq.price = sq.basePrice;
    bumpStat(p, 'shopsBought', 1);
    updateAreaStockPrices(g);
    addLog(g, `${p.name} が空き店「${sq.label}」を${multi}倍価格（${price}G）で購入！`, 'shop');
    const mono = tryGrantMonopolyBonus(g, p, sq.area);
    g.pending = null;
    endTurn(g);
    return {
      ok: true,
      vacantShopBuy: true,
      shopId: sq.id,
      ...(mono || {}),
      state: serializeState(g),
    };
  }

  if (pending.type === 'force_rival_sell') {
    const multi = pending.multi || 3;
    if (choice.action === 'skip') {
      g.pending = null;
      endTurn(g);
      return { ok: true, state: serializeState(g) };
    }
    if (choice.action !== 'sell' && choice.action !== 'pick' && choice.action !== 'buy') {
      return { ok: false, error: 'bad_choice' };
    }
    const sq = getNode(g, Number(choice.shopId));
    const allowed = pending.shopIds || [];
    if (!sq || sq.type !== 'shop' || sq.owner < 0 || sq.owner === p.id) {
      return { ok: false, error: 'bad_shop' };
    }
    if (allowed.length && !allowed.includes(sq.id)) {
      return { ok: false, error: 'bad_shop' };
    }
    const owner = g.players[sq.owner];
    const prevOwnerId = sq.owner;
    const area = sq.area;
    const payout = Math.floor((Number(sq.price) || 0) * multi);
    if (owner) owner.cash += payout;
    sq.owner = -1;
    sq.extraInvest = 0;
    sq.price = sq.basePrice;
    let monopolyBreak = null;
    if (prevOwnerId >= 0) {
      monopolyBreak = applyMonopolyBreak(g, prevOwnerId, area);
    }
    if (!monopolyBreak) updateAreaStockPrices(g);
    addLog(
      g,
      `${p.name} が「${sq.label}」を強制売却（銀行が ${owner?.name || '相手'} に${payout.toLocaleString()}G）`,
      'shop',
    );
    g.pending = null;
    endTurn(g);
    return {
      ok: true,
      forceRivalSell: true,
      shopId: sq.id,
      payout,
      ...(monopolyBreak ? { monopolyBreak } : {}),
      state: serializeState(g),
    };
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

  if (pending.type === 'shop_trade_compose') {
    const action = choice?.action;
    if (action === 'cancel' || action === 'skip') {
      addLog(g, `${p.name} は物件取引をやめた`, 'system');
      g.pending = null;
      g.phase = 'await_roll';
      return { ok: true, state: serializeState(g) };
    }
    if (action === 'set_target') {
      const targetId = Number(choice.targetId);
      const target = g.players[targetId];
      if (!target || target.bankrupt || targetId === p.id) {
        return { ok: false, error: 'bad_target' };
      }
      pending.targetId = targetId;
      pending.giveShopIds = [];
      pending.takeShopIds = [];
      syncShopTradeCashDefault(g, pending);
      return { ok: true, state: serializeState(g) };
    }
    if (action === 'toggle_give') {
      if (pending.targetId == null) return { ok: false, error: 'bad_target' };
      const shopId = Number(choice.shopId);
      const sq = getNode(g, shopId);
      if (!sq || sq.type !== 'shop' || sq.owner !== p.id) return { ok: false, error: 'bad_give' };
      const list = pending.giveShopIds || (pending.giveShopIds = []);
      const idx = list.indexOf(shopId);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(shopId);
      syncShopTradeCashDefault(g, pending);
      return { ok: true, state: serializeState(g) };
    }
    if (action === 'toggle_take') {
      if (pending.targetId == null) return { ok: false, error: 'bad_target' };
      const shopId = Number(choice.shopId);
      const sq = getNode(g, shopId);
      if (!sq || sq.type !== 'shop' || sq.owner !== pending.targetId) {
        return { ok: false, error: 'bad_take' };
      }
      const list = pending.takeShopIds || (pending.takeShopIds = []);
      const idx = list.indexOf(shopId);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(shopId);
      syncShopTradeCashDefault(g, pending);
      return { ok: true, state: serializeState(g) };
    }
    if (action === 'set_cash') {
      pending.cashDelta = Math.floor(Number(choice.cashDelta) || 0);
      return { ok: true, state: serializeState(g) };
    }
    if (action === 'propose') {
      const targetId = Number(pending.targetId);
      const target = g.players[targetId];
      if (!target || target.bankrupt) return { ok: false, error: 'bad_target' };
      const giveShopIds = [...(pending.giveShopIds || [])];
      const takeShopIds = [...(pending.takeShopIds || [])];
      // 入力欄から直接渡された差額を優先（change 未発火でも反映）
      if (choice.cashDelta != null && Number.isFinite(Number(choice.cashDelta))) {
        pending.cashDelta = Math.floor(Number(choice.cashDelta) || 0);
      }
      const cashDelta = Math.floor(Number(pending.cashDelta) || 0);
      const check = validateShopTradeSides(g, p.id, targetId, giveShopIds, takeShopIds);
      if (!check.ok) return check;
      const fromPay = Math.max(0, cashDelta);
      const toPay = Math.max(0, -cashDelta);
      if (p.cash < fromPay) return { ok: false, error: 'proposer_cash' };
      if (target.cash < toPay) return { ok: false, error: 'target_cash' };
      g.pending = {
        type: 'shop_trade_offer',
        playerId: targetId,
        fromId: p.id,
        giveShopIds,
        takeShopIds,
        cashDelta,
        counterCashDelta: cashDelta,
      };
      addLog(g, `${p.name} が ${target.name} に物件取引を持ちかけた`, 'shop');
      return { ok: true, tradeOffered: true, state: serializeState(g) };
    }
    return { ok: false, error: 'bad_choice' };
  }

  if (pending.type === 'shop_trade_offer') {
    const from = g.players[pending.fromId];
    if (choice?.action === 'reject' || choice?.action === 'skip') {
      addLog(g, `${p.name} は物件取引を断った`, 'system');
      g.pending = null;
      g.phase = 'await_roll';
      return { ok: true, tradeRejected: true, state: serializeState(g) };
    }
    if (choice?.action === 'set_cash') {
      // 逆交渉用の下書き差額（提案本体の cashDelta は承認時に使う）
      pending.counterCashDelta = Math.floor(Number(choice.cashDelta) || 0);
      return { ok: true, state: serializeState(g) };
    }
    if (choice?.action === 'counter') {
      if (!from || from.bankrupt) {
        g.pending = null;
        g.phase = 'await_roll';
        return { ok: false, error: 'bad_player' };
      }
      const giveShopIds = [...(pending.takeShopIds || [])];
      const takeShopIds = [...(pending.giveShopIds || [])];
      // 表示上の正＝相手が支払う → 自分が提案者になると符号を反転
      const draft = choice.cashDelta != null
        ? choice.cashDelta
        : (pending.counterCashDelta != null ? pending.counterCashDelta : pending.cashDelta);
      const cashDelta = -Math.floor(Number(draft) || 0);
      const check = validateShopTradeSides(g, p.id, pending.fromId, giveShopIds, takeShopIds);
      if (!check.ok) return check;
      const fromPay = Math.max(0, cashDelta);
      const toPay = Math.max(0, -cashDelta);
      if (p.cash < fromPay) return { ok: false, error: 'proposer_cash' };
      if (from.cash < toPay) return { ok: false, error: 'target_cash' };
      g.pending = {
        type: 'shop_trade_offer',
        playerId: pending.fromId,
        fromId: p.id,
        giveShopIds,
        takeShopIds,
        cashDelta,
        counterCashDelta: cashDelta,
      };
      addLog(g, `${p.name} が ${from.name} に物件の逆交渉を申し込んだ`, 'shop');
      return { ok: true, tradeCountered: true, state: serializeState(g) };
    }
    if (choice?.action === 'accept') {
      if (!from || from.bankrupt) {
        g.pending = null;
        g.phase = 'await_roll';
        return { ok: false, error: 'bad_player' };
      }
      const result = executeShopTrade(g, {
        fromId: pending.fromId,
        toId: p.id,
        giveShopIds: pending.giveShopIds,
        takeShopIds: pending.takeShopIds,
        cashDelta: pending.cashDelta,
      });
      if (!result.ok) return result;
      g.pending = null;
      g.phase = 'await_roll';
      return {
        ok: true,
        tradeAccepted: true,
        monopolyBreak: result.monopolyBreak,
        monopoly: result.monopoly,
        state: serializeState(g),
      };
    }
    return { ok: false, error: 'bad_choice' };
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

/** 強制売却：自分の店を1軒売らなければならない */
function maybeOpenForceSell(g, p) {
  if (!p.flags?.pendingForceSell) return false;
  p.flags.pendingForceSell = false;
  const shops = g.map.filter((s) => s.type === 'shop' && s.owner === p.id);
  if (!shops.length) return false;
  g.phase = 'await_choice';
  g.pending = {
    type: 'force_sell_shop',
    playerId: p.id,
    shopIds: shops.map((s) => s.id),
  };
  addLog(g, `${p.name} はお店を1店舗売却しなければならない`, 'event');
  return true;
}

/** 好きな相手店を N 倍で買う権利 */
function maybeOpenAnyShopBuy(g, p) {
  const info = p.flags?.pendingAnyShopBuy;
  if (!info) return false;
  p.flags.pendingAnyShopBuy = null;
  const shops = g.map.filter((s) => s.type === 'shop' && s.owner >= 0 && s.owner !== p.id);
  if (!shops.length) return false;
  const multi = Math.max(5, Math.min(8, Number(info.multi) || 6));
  g.phase = 'await_choice';
  g.pending = {
    type: 'any_shop_buy',
    playerId: p.id,
    multi,
    shopIds: shops.map((s) => s.id),
  };
  addLog(g, `${p.name} は好きな相手の店を${multi}倍で買える`, 'event');
  return true;
}

/** 好きな空き店を N 倍価格で買う権利 */
function maybeOpenVacantShopBuy(g, p) {
  const info = p.flags?.pendingVacantShopBuy;
  if (!info) return false;
  p.flags.pendingVacantShopBuy = null;
  const shops = g.map.filter((s) => s.type === 'shop' && s.owner < 0);
  if (!shops.length) return false;
  const multi = Math.max(2, Math.min(4, Number(info.multi) || 2));
  g.phase = 'await_choice';
  g.pending = {
    type: 'vacant_shop_buy',
    playerId: p.id,
    multi,
    shopIds: shops.map((s) => s.id),
  };
  addLog(g, `${p.name} は好きな空き店を${multi}倍価格で買える`, 'event');
  return true;
}

/** 好きな相手店を N 倍額で銀行買取させる権利 */
function maybeOpenForceRivalSell(g, p) {
  const info = p.flags?.pendingForceRivalSell;
  if (!info) return false;
  p.flags.pendingForceRivalSell = null;
  const shops = g.map.filter((s) => s.type === 'shop' && s.owner >= 0 && s.owner !== p.id);
  if (!shops.length) return false;
  const multi = Math.max(2, Math.min(5, Number(info.multi) || 3));
  g.phase = 'await_choice';
  g.pending = {
    type: 'force_rival_sell',
    playerId: p.id,
    multi,
    shopIds: shops.map((s) => s.id),
  };
  addLog(g, `${p.name} は好きな相手の店を${multi}倍額で銀行買取できる`, 'event');
  return true;
}

/** 共通の結果にみんなで賭けるタイプ（スロット等の個人挑戦は含めない） */
export const PARTY_MINIGAME_GAMES = new Set([
  'guess_dice',
  'coin',
  'high_low',
  'horse_race',
  'roulette',
]);

export function isPartyMinigame(game) {
  return PARTY_MINIGAME_GAMES.has(game || '');
}

function minigameParticipants(g, starterId, game) {
  if (!isPartyMinigame(game)) return [starterId];
  const alive = g.players.filter((pl) => !pl.bankrupt).map((pl) => pl.id);
  if (!alive.includes(starterId)) return alive;
  return [starterId, ...alive.filter((id) => id !== starterId)];
}

function maybeOpenMinigame(g, p) {
  const mg = p.flags?.pendingMinigame;
  if (!mg) return false;
  p.flags.pendingMinigame = null;
  const game = mg.game || 'guess_dice';
  const participantIds = minigameParticipants(g, p.id, game);
  if (!participantIds.length) return false;
  const party = participantIds.length > 1;
  g.phase = 'await_choice';
  g.pending = {
    type: 'minigame',
    playerId: participantIds[0],
    starterId: p.id,
    game,
    label: mg.label || 'ミニゲーム',
    participantIds,
    picks: {},
    party,
  };
  if (party) {
    addLog(g, `みんなのミニゲーム「${g.pending.label}」！（${p.name}が開催・${participantIds.length}人参加）`, 'event');
  } else {
    addLog(g, `${p.name} のミニゲーム「${g.pending.label}」！`, 'event');
  }
  return true;
}

function payoutAll(g, amount, messages) {
  applyAllCash(g, amount, messages);
}

/**
 * サイコロ／スロット系ミニゲーム報酬：基本額にレベル上乗せ。
 * 以前の「基本額×Lv」は一発運で目標額の半分近くまで伸びていたため、
 * Lvごとに +25% ずつ（Lv1=1.0 / Lv3=1.5 / Lv5=2.0）に抑える。
 */
export function scaleDiceSlotPrize(base, level) {
  const lv = Math.max(1, Math.floor(Number(level) || 1));
  const b = Math.max(0, Number(base) || 0);
  return Math.max(0, Math.floor(b * (1 + (lv - 1) * 0.25)));
}

/** 1回のミニゲーム当たりは目標額の一定割合までに抑える */
export function capMinigamePrize(amount, goal) {
  const prize = Math.max(0, Math.floor(Number(amount) || 0));
  const g = Math.max(1000, Math.floor(Number(goal) || 10000));
  return Math.min(prize, Math.floor(g * 0.08));
}

function normalizeMinigamePick(game, choice) {
  if (game === 'guess_dice') return Math.max(1, Math.min(6, Number(choice?.value) || 1));
  if (game === 'dice_battle') return choice?.value === 'guard' ? 'guard' : 'rush';
  if (game === 'horse_race') return Math.max(0, Math.min(3, Number(choice?.value) || 0));
  if (game === 'high_low') return choice?.value === 'high' ? 'high' : 'low';
  if (game === 'rps_duel') {
    return ['rock', 'paper', 'scissors'].includes(choice?.value) ? choice.value : 'rock';
  }
  if (game === 'coin') return choice?.value === 'tails' ? 'tails' : 'heads';
  if (game === 'roulette') {
    return ['red', 'black', 'green'].includes(choice?.value) ? choice.value : 'red';
  }
  if (game === 'heist') {
    return ['safe', 'normal', 'bold'].includes(choice?.value) ? choice.value : 'normal';
  }
  if (game === 'balloon_dash') {
    return [3, 5, 7].includes(Number(choice?.value)) ? Number(choice.value) : 5;
  }
  if (game === 'slot') return 'spin';
  return choice?.value ?? null;
}

function grantMinigamePrize(player, amount, messages, text) {
  const prize = Math.max(0, Math.floor(Number(amount) || 0));
  if (prize > 0) {
    player.cash += prize;
    messages.push(text);
  }
  return prize;
}

function minigameConsolation(player, amount, messages, text) {
  return grantMinigamePrize(player, amount, messages, text);
}

/**
 * 全員の選択を受け取ってから共通結果を出す。
 * 最後のプレイヤーまで選択肢が意味を持つよう、乱数は全員選択後にだけ進める。
 */
function resolveMinigame(g, p, pending, choice) {
  if (!pending.participantIds) {
    pending.starterId = pending.playerId;
    pending.participantIds = [p.id];
    pending.picks = pending.picks || {};
  }
  if (pending.picks[p.id] != null) {
    return { ok: false, error: 'already_picked' };
  }
  const pick = normalizeMinigamePick(pending.game || 'guess_dice', choice);
  pending.picks[p.id] = pick;

  const waiting = pending.participantIds.filter((id) => {
    const pl = g.players[id];
    return pl && !pl.bankrupt && pending.picks[id] == null;
  });
  if (waiting.length) {
    pending.playerId = waiting[0];
    addLog(g, `${p.name} が選択済み（残り${waiting.length}人）`, 'event');
    return {
      ok: true,
      minigamePick: true,
      waitingCount: waiting.length,
      state: serializeState(g),
    };
  }

  return finalizeMinigame(g, pending);
}

function finalizeMinigame(g, pending) {
  const game = pending.game || 'guess_dice';
  const participants = pending.participantIds
    .map((id) => g.players[id])
    .filter((pl) => pl && !pl.bankrupt);
  /** @type {Record<string, unknown>} */
  const shared = {};
  const results = [];

  if (game === 'guess_dice') {
    shared.roll = Math.floor(rngNext(g) * 6) + 1;
  } else if (game === 'dice_battle') {
    shared.foeDice = [Math.floor(rngNext(g) * 6) + 1, Math.floor(rngNext(g) * 6) + 1];
    shared.foeTotal = shared.foeDice[0] + shared.foeDice[1];
  } else if (game === 'horse_race') {
    const horses = ['ハヤテ', 'ライジン', 'カゼ', 'ツキ'];
    const scores = horses.map((_, i) => ({
      i,
      score: rngNext(g) * 0.85 + rngNext(g) * 0.4,
    }));
    scores.sort((a, b) => b.score - a.score);
    shared.horses = horses;
    shared.order = scores.map((s) => s.i);
    shared.scores = scores.map((s) => Math.round(s.score * 1000) / 1000);
  } else if (game === 'high_low') {
    shared.secret = Math.floor(rngNext(g) * 10) + 1;
    shared.band = shared.secret >= 6 ? 'high' : 'low';
  } else if (game === 'rps_duel') {
    const opts = ['rock', 'paper', 'scissors'];
    shared.foe = opts[Math.floor(rngNext(g) * 3)];
  } else if (game === 'coin') {
    shared.face = rngNext(g) < 0.5 ? 'heads' : 'tails';
  } else if (game === 'roulette') {
    shared.spin = Math.floor(rngNext(g) * 37);
    shared.color = shared.spin === 0 ? 'green' : (shared.spin % 2 === 0 ? 'black' : 'red');
  } else if (game === 'slot') {
    const syms = ['★', '♪', 'G', '♦', '♣'];
    const reels = [];
    for (let i = 0; i < 5; i++) reels.push(syms[Math.floor(rngNext(g) * syms.length)]);
    shared.symbols = reels;
  }

  for (const player of participants) {
    const playerPick = pending.picks[player.id];
    const scored = scoreMinigamePlayer(g, player, game, playerPick, shared);
    bumpStat(player, 'minigamePlays', 1);
    if (scored.win) bumpStat(player, 'minigameWins', 1);
    if (scored.prizeWon > 0) bumpStat(player, 'minigamePrize', scored.prizeWon);
    results.push({
      playerId: player.id,
      playerName: player.name,
      playerColor: player.color,
      pick: playerPick,
      ...scored,
      outcome: { ...shared, ...(scored.outcome || {}), pick: playerPick },
    });
    addLog(g, `${player.name} の「${pending.label}」→ ${scored.messages.join(' / ')}`, 'event');
  }

  const highlight = results.find((r) => r.win) || results[0] || null;
  const reveal = {
    game,
    label: pending.label || 'ミニゲーム',
    starterId: pending.starterId ?? pending.playerId,
    shared,
    results,
    playerId: highlight?.playerId ?? null,
    playerName: highlight?.playerName ?? '',
    playerColor: highlight?.playerColor ?? '#c4a574',
    pick: highlight?.pick,
    outcome: highlight?.outcome || shared,
    tier: highlight?.tier || 'miss',
    win: !!highlight?.win,
    title: highlight?.title || '結果発表',
    detail: results.map((r) => `${r.playerName}: ${r.detail}`).join(' ／ '),
    messages: results.flatMap((r) => r.messages),
  };

  const starterId = pending.starterId ?? pending.playerId;
  g.pending = null;
  if (g.currentPlayerIdx !== starterId) {
    g.currentPlayerIdx = starterId;
  }
  endTurn(g);
  return {
    ok: true,
    minigame: true,
    win: !!highlight?.win,
    detail: reveal.detail,
    messages: reveal.messages,
    reveal,
    state: serializeState(g),
  };
}

function scoreMinigamePlayer(g, p, game, pick, shared) {
  const messages = [];
  let win = false;
  let detail = '';
  let tier = 'miss';
  let title = '結果発表';
  let prizeWon = 0;
  /** @type {Record<string, unknown>} */
  const outcome = {};
  const lvTag = `Lv${p.level}`;
  const lvPrize = (base) => capMinigamePrize(scaleDiceSlotPrize(base, p.level), g.goal);
  const flatPrize = (amount) => capMinigamePrize(amount, g.goal);

  if (game === 'guess_dice') {
    const roll = Number(shared.roll);
    const diff = Math.abs(Number(pick) - roll);
    outcome.roll = roll;
    if (diff === 0) {
      win = true; tier = 'exact'; title = 'ぴったり！';
      const prize = lvPrize(180);
      prizeWon = grantMinigamePrize(p, prize, messages, `ぴったり！出目${roll} → +${prize}G（${lvTag}）`);
    } else if (diff === 1) {
      win = true; tier = 'near'; title = 'おしい！';
      const prize = lvPrize(70);
      prizeWon = grantMinigamePrize(p, prize, messages, `おしい！出目${roll}（予想${pick}）→ +${prize}G（${lvTag}）`);
    } else {
      title = 'ハズレ…';
      prizeWon = minigameConsolation(p, 20, messages, `ハズレ…出目${roll}（予想${pick}）→ 参加賞 +20G`);
    }
    detail = `予想 ${pick} → 出目 ${roll}`;
  } else if (game === 'dice_battle') {
    const stylePick = pick === 'guard' ? 'guard' : 'rush';
    const youA = Math.floor(rngNext(g) * 6) + 1;
    const youB = stylePick === 'rush' ? Math.floor(rngNext(g) * 6) + 1 : 0;
    const youTotal = stylePick === 'rush' ? youA + youB : youA + 3;
    const foeTotal = Number(shared.foeTotal);
    outcome.youDice = stylePick === 'rush' ? [youA, youB] : [youA];
    outcome.youBonus = stylePick === 'guard' ? 3 : 0;
    outcome.youTotal = youTotal;
    outcome.foeDice = shared.foeDice;
    outcome.foeTotal = foeTotal;
    const style = stylePick === 'rush' ? '攻め' : '守り';
    if (youTotal > foeTotal) {
      win = true; tier = 'win'; title = 'バトル勝利！';
      const prize = lvPrize(stylePick === 'rush' ? 150 : 110);
      prizeWon = grantMinigamePrize(p, prize, messages, `${style} ${youTotal} vs ${foeTotal} → +${prize}G（${lvTag}）`);
    } else if (youTotal === foeTotal) {
      win = true; tier = 'near'; title = '引き分け！';
      const prize = lvPrize(55);
      prizeWon = grantMinigamePrize(p, prize, messages, `同点 ${youTotal} → +${prize}G（${lvTag}）`);
    } else {
      title = 'バトル敗北…';
      prizeWon = minigameConsolation(p, 22, messages, `${style} ${youTotal} vs ${foeTotal} → 参加賞 +22G`);
    }
    detail = `${style} ${youTotal} vs ハウス ${foeTotal}`;
  } else if (game === 'horse_race') {
    const horses = shared.horses || ['ハヤテ', 'ライジン', 'カゼ', 'ツキ'];
    const idx = Math.max(0, Math.min(3, Number(pick)));
    const place = (shared.order || []).findIndex((i) => i === idx) + 1;
    outcome.horses = horses;
    outcome.order = shared.order;
    outcome.place = place;
    outcome.scores = shared.scores;
    if (place === 1) {
      win = true; tier = 'jackpot'; title = '優勝！';
      const prize = lvPrize(200);
      prizeWon = grantMinigamePrize(p, prize, messages, `${horses[idx]} が1着！ → +${prize}G（${lvTag}）`);
    } else if (place === 2) {
      win = true; tier = 'win'; title = '2着入賞！';
      const prize = lvPrize(90);
      prizeWon = grantMinigamePrize(p, prize, messages, `${horses[idx]} が2着 → +${prize}G（${lvTag}）`);
    } else {
      title = `${place || '?'}着…`;
      prizeWon = minigameConsolation(p, 24, messages, `${horses[idx]} は${place}着 → 参加賞 +24G`);
    }
    detail = `${horses[idx]} → ${place}着`;
  } else if (game === 'high_low') {
    const secret = Number(shared.secret);
    const isHigh = shared.band === 'high';
    const ok = (pick === 'high' && isHigh) || (pick === 'low' && !isHigh);
    outcome.secret = secret;
    outcome.band = shared.band;
    if (ok) {
      win = true; tier = 'win'; title = '正解！';
      const prize = flatPrize(110 + p.level * 18);
      prizeWon = grantMinigamePrize(p, prize, messages, `正解！数字は ${secret} → +${prize}G`);
    } else {
      title = '残念…';
      prizeWon = minigameConsolation(p, 28, messages, `残念…数字は ${secret} → 参加賞 +28G`);
    }
    detail = `予想 ${pick === 'high' ? 'ハイ' : 'ロー'} → ${secret}`;
  } else if (game === 'rps_duel') {
    const foe = shared.foe;
    const beats = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
    const labels = { rock: 'グー', paper: 'パー', scissors: 'チョキ' };
    outcome.foe = foe;
    if (pick === foe) {
      win = true; tier = 'near'; title = 'あいこ！';
      const prize = flatPrize(50 + p.level * 8);
      prizeWon = grantMinigamePrize(p, prize, messages, `あいこ（${labels[pick]}）→ +${prize}G`);
    } else if (beats[pick] === foe) {
      win = true; tier = 'win'; title = 'じゃんけん勝ち！';
      const prize = flatPrize(110 + p.level * 18);
      prizeWon = grantMinigamePrize(p, prize, messages, `${labels[pick]} vs ${labels[foe]} → +${prize}G`);
    } else {
      title = 'じゃんけん負け…';
      prizeWon = minigameConsolation(p, 24, messages, `${labels[pick]} vs ${labels[foe]} → 参加賞 +24G`);
    }
    detail = `${labels[pick]} vs ${labels[foe]}`;
  } else if (game === 'coin') {
    const face = shared.face;
    const faceLabel = face === 'heads' ? 'おもて' : 'うら';
    const pickLabel = pick === 'heads' ? 'おもて' : 'うら';
    outcome.face = face;
    if (pick === face) {
      win = true; tier = 'win'; title = '当たり！';
      const prize = flatPrize(100 + p.level * 16);
      prizeWon = grantMinigamePrize(p, prize, messages, `当たり！${faceLabel} → +${prize}G`);
    } else {
      title = 'ハズレ…';
      prizeWon = minigameConsolation(p, 24, messages, `ハズレ…${faceLabel} → 参加賞 +24G`);
    }
    detail = `予想 ${pickLabel} → ${faceLabel}`;
  } else if (game === 'roulette') {
    const spin = Number(shared.spin);
    const color = shared.color;
    const colorLabel = { red: '赤', black: '黒', green: '緑(0)' };
    outcome.spin = spin;
    outcome.color = color;
    if (pick === 'green' && color === 'green') {
      win = true; tier = 'jackpot'; title = 'ゼロ的中！';
      const prize = lvPrize(360);
      prizeWon = grantMinigamePrize(p, prize, messages, `0的中！ → +${prize}G（${lvTag}）`);
    } else if (pick === color) {
      win = true; tier = 'win'; title = 'ルーレット当たり！';
      const prize = lvPrize(120);
      prizeWon = grantMinigamePrize(p, prize, messages, `${colorLabel[color]}${spin} → +${prize}G（${lvTag}）`);
    } else {
      title = 'ルーレット外れ…';
      prizeWon = minigameConsolation(p, 22, messages, `予想${colorLabel[pick]} → ${colorLabel[color]}${spin} → 参加賞 +22G`);
    }
    detail = `予想 ${colorLabel[pick]} → ${colorLabel[color]} ${spin}`;
  } else if (game === 'heist') {
    const table = {
      safe: { chance: 0.82, prize: 80, party: 28 },
      normal: { chance: 0.55, prize: 140, party: 40 },
      bold: { chance: 0.28, prize: 240, party: 60 },
    };
    const cfg = table[pick] || table.normal;
    const success = rngNext(g) < cfg.chance;
    outcome.success = success;
    outcome.chance = cfg.chance;
    const riskLabel = { safe: '用心', normal: '普通', bold: '大胆' }[pick] || '普通';
    if (success) {
      win = true; tier = pick === 'bold' ? 'jackpot' : 'win'; title = '金庫オープン！';
      const prize = lvPrize(cfg.prize);
      prizeWon = grantMinigamePrize(p, prize, messages, `${riskLabel}成功 → +${prize}G（${lvTag}）`);
    } else {
      title = '警備に捕まった…';
      const consol = Math.floor(cfg.party * 0.7);
      prizeWon = minigameConsolation(p, consol, messages, `${riskLabel}失敗 → 慰労 +${consol}G`);
    }
    detail = `${riskLabel}（成功率${Math.round(cfg.chance * 100)}%）→ ${success ? '成功' : '失敗'}`;
  } else if (game === 'slot') {
    const reels = shared.symbols || [];
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
    if (top === 5) {
      win = true; tier = 'jackpot'; title = 'ジャックポット！';
      const prize = lvPrize(400);
      prizeWon = grantMinigamePrize(p, prize, messages, `5揃い ${line}！ → +${prize}G（${lvTag}）`);
    } else if (top === 4) {
      win = true; tier = 'quad'; title = 'フォーカード！';
      const prize = lvPrize(240);
      prizeWon = grantMinigamePrize(p, prize, messages, `4揃い ${line} → +${prize}G（${lvTag}）`);
    } else if (top === 3 && second === 2) {
      win = true; tier = 'fullhouse'; title = 'フルハウス！';
      const prize = lvPrize(160);
      prizeWon = grantMinigamePrize(p, prize, messages, `フルハウス ${line} → +${prize}G（${lvTag}）`);
    } else if (top === 3) {
      win = true; tier = 'triple'; title = 'スリーカード！';
      const prize = lvPrize(100);
      prizeWon = grantMinigamePrize(p, prize, messages, `3揃い ${line} → +${prize}G（${lvTag}）`);
    } else if (top === 2 && second === 2) {
      win = true; tier = 'two_pair'; title = 'ツーペア！';
      const prize = lvPrize(65);
      prizeWon = grantMinigamePrize(p, prize, messages, `ツーペア ${line} → +${prize}G（${lvTag}）`);
    } else if (top === 2) {
      win = true; tier = 'pair'; title = 'ワンペア！';
      const prize = lvPrize(35);
      prizeWon = grantMinigamePrize(p, prize, messages, `ワンペア ${line} → +${prize}G（${lvTag}）`);
    } else {
      title = 'バラケ目…';
      prizeWon = minigameConsolation(p, 18, messages, `バラケ目 ${line} → 参加賞 +18G`);
    }
    detail = line;
  } else if (game === 'balloon_dash') {
    const pumps = [3, 5, 7].includes(Number(pick)) ? Number(pick) : 5;
    const popAt = 2 + Math.floor(rngNext(g) * 7);
    const popped = pumps >= popAt;
    outcome.pumps = pumps;
    outcome.popAt = popAt;
    outcome.popped = popped;
    if (!popped) {
      win = true;
      tier = pumps >= 7 ? 'jackpot' : pumps >= 5 ? 'win' : 'near';
      title = 'バルーン成功！';
      const prize = lvPrize(28 * pumps);
      prizeWon = grantMinigamePrize(p, prize, messages, `${pumps}回ポンプ成功（限界${popAt}）→ +${prize}G（${lvTag}）`);
    } else {
      title = 'パンッ！';
      prizeWon = minigameConsolation(p, 20, messages, `${pumps}回目で破裂（限界${popAt}）→ 参加賞 +20G`);
    }
    detail = `${pumps}ポンプ / 限界 ${popAt} → ${popped ? '破裂' : '成功'}`;
  } else {
    title = '参加賞';
    prizeWon = minigameConsolation(p, 30, messages, '参加賞 +30G');
    detail = '参加賞';
  }

  return { win, detail, tier, title, prizeWon, messages, outcome };
}


const STOCK_SELL_PHASES = new Set(['await_roll', 'await_choice', 'await_fork']);

/** 自分のターン中（移動演出以外）に株を売れるか */
export function canSellStockOnTurn(g, playerId) {
  if (!g || g.phase === 'gameover') return false;
  if (!STOCK_SELL_PHASES.has(g.phase)) return false;
  if (g.currentPlayerIdx !== playerId) return false;
  const p = g.players[playerId];
  if (!p || p.bankrupt || p.resting) return false;
  return Object.values(p.stocks || {}).some((n) => Math.max(0, Math.floor(Number(n) || 0)) > 0);
}

/** 自分のターン中いつでも株売却できる（サイコロ前・選択中・分岐中） */
export function preTurnSell(g, playerId, area, count) {
  if (!STOCK_SELL_PHASES.has(g.phase)) return { ok: false, error: 'bad_phase' };
  if (g.currentPlayerIdx !== playerId) return { ok: false, error: 'not_your_turn' };
  const p = g.players[playerId];
  if (!p || p.bankrupt) return { ok: false, error: 'bankrupt' };
  const a = Number(area);
  const have = Math.max(0, Math.floor(Number(p.stocks?.[a]) || 0));
  const n = clampStockSellCount(have, count);
  if (n <= 0 || !g.areas[a]) return { ok: false, error: 'no_stock' };
  const got = g.areas[a].stockPrice * n;
  setStockHolding(p, a, have - n);
  p.cash += got;
  bumpStat(p, 'stockSold', n);
  bumpStat(p, 'stockIncome', got);
  syncStockValueSnap(g, p);
  applyStockSellPressure(g, p, a, n);
  updateAreaStockPrices(g);
  addLog(g, `${p.name} が ${getAreaCode(g, a)}株×${n} 売却（+${got}G）`, 'stock');
  return { ok: true, state: serializeState(g) };
}

/** ラッキーステータス付与（次の自分の番開始まで有効） */
export function grantLucky(p) {
  if (!p) return;
  p.lucky = true;
  p.flags.luckyExpireOnTurn = false;
}

/* ───────── イベントNPC（スクラッチ召喚） ───────── */

let _eventNpcSeq = 0;

function ensureEventNpcState(g) {
  if (!Array.isArray(g.eventNpcs)) g.eventNpcs = [];
  if (!Array.isArray(g.eventNpcFx)) g.eventNpcFx = [];
  if (g.povertyHolidayClearTurn === undefined) g.povertyHolidayClearTurn = null;
}

export function takeEventNpcFx(g) {
  ensureEventNpcState(g);
  const fx = [...g.eventNpcFx];
  g.eventNpcFx = [];
  return fx;
}

function clearMapEventHolidays(g) {
  for (const n of g.map || []) {
    if (n?.eventHoliday) n.eventHoliday = false;
  }
}

function maybeClearPovertyHolidays(g) {
  ensureEventNpcState(g);
  if (g.povertyHolidayClearTurn == null) return;
  if ((g.turn || 1) > g.povertyHolidayClearTurn) {
    clearMapEventHolidays(g);
    g.povertyHolidayClearTurn = null;
    addLog(g, '貧乏神の店休が解けた', 'system');
  }
}

export function canSpawnEventNpc(g, kind) {
  ensureEventNpcState(g);
  return !g.eventNpcs.some((n) => n.kind === kind);
}

export function spawnEventNpc(g, kind, atPos) {
  ensureEventNpcState(g);
  const def = EVENT_NPC_KINDS[kind];
  if (!def) return { ok: false, message: '不明なイベントNPC' };
  if (!canSpawnEventNpc(g, kind)) {
    return { ok: false, message: `${def.label}はすでに徘徊中` };
  }
  const pos = atPos != null && getNode(g, atPos) ? atPos : g.startId;
  const actsLeft = 3 + Math.floor(rngNext(g) * 5); // 3..7
  _eventNpcSeq += 1;
  const npc = {
    id: `enpc_${_eventNpcSeq}`,
    kind: def.kind,
    label: def.label,
    color: def.color,
    glyph: def.glyph,
    diceMax: def.diceMax,
    pos,
    prevPos: null,
    actsLeft,
    spawnOrder: g.eventNpcs.length,
  };
  g.eventNpcs.push(npc);
  g.eventNpcFx.push({ type: 'spawn', npcId: npc.id, kind: npc.kind, pos });
  addLog(g, `${npc.label} が異界から現れた！（あと${actsLeft}回行動）`, 'event');
  return { ok: true, npc, message: `${npc.label}がマップに登場（${actsLeft}ターン徘徊）` };
}

function maybeSpawnEventNpc(g, p) {
  const kind = p?.flags?.pendingSpawnNpc;
  if (!kind) return false;
  p.flags.pendingSpawnNpc = null;
  const result = spawnEventNpc(g, kind, p.pos);
  if (!result.ok) addLog(g, result.message, 'event');
  return result.ok;
}

function weightedDiceRoll(g, weights) {
  let sum = 0;
  for (const w of weights) sum += Math.max(0, w);
  if (sum <= 0) return 1 + Math.floor(rngNext(g) * weights.length);
  let r = rngNext(g) * sum;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r <= 0) return i + 1;
  }
  return weights.length;
}

function shopPathValue(sq) {
  return (Number(sq?.basePrice) || 0) + (Number(sq?.extraInvest) || 0);
}

/** maxSteps 以内で到達しうる最高値の有主店 */
function findBestOwnedShopSteps(g, fromPos, prevPos, maxSteps) {
  const bestAt = new Map();
  const q = [{ id: fromPos, prev: prevPos, steps: 0 }];
  bestAt.set(fromPos, 0);
  let best = null;
  while (q.length) {
    const cur = q.shift();
    if (cur.steps >= maxSteps) continue;
    for (const nid of getForwardNexts(g, cur.id, cur.prev)) {
      const steps = cur.steps + 1;
      if (bestAt.has(nid) && bestAt.get(nid) <= steps) continue;
      bestAt.set(nid, steps);
      q.push({ id: nid, prev: cur.id, steps });
      const node = getNode(g, nid);
      if (node?.type === 'shop' && node.owner >= 0) {
        const val = shopPathValue(node);
        if (!best || val > best.val || (val === best.val && steps < best.steps)) {
          best = { id: nid, steps, val };
        }
      }
    }
  }
  return best;
}

function approxNodeDist(g, from, target, limit = 24) {
  if (from === target) return 0;
  const seen = new Set([from]);
  const q = [{ id: from, d: 0, prev: null }];
  while (q.length) {
    const cur = q.shift();
    if (cur.d >= limit) continue;
    for (const nid of getForwardNexts(g, cur.id, cur.prev)) {
      if (seen.has(nid)) continue;
      if (nid === target) return cur.d + 1;
      seen.add(nid);
      q.push({ id: nid, d: cur.d + 1, prev: cur.id });
    }
  }
  return limit + 1;
}

function pickNpcStep(g, npc, options, targetId) {
  if (!options.length) return null;
  if (options.length === 1) return options[0];
  if (npc.kind === 'merchant' && targetId != null) {
    let best = options[0];
    let bestD = Infinity;
    for (const opt of options) {
      const d = approxNodeDist(g, opt, targetId);
      if (d < bestD) {
        bestD = d;
        best = opt;
      }
    }
    return best;
  }
  return options[Math.floor(rngNext(g) * options.length)];
}

function rollEventNpcDice(g, npc) {
  const max = npc.diceMax || 6;
  if (npc.kind === 'merchant') {
    const best = findBestOwnedShopSteps(g, npc.pos, npc.prevPos, max);
    const weights = Array.from({ length: max }, () => 1);
    if (best?.steps >= 1 && best.steps <= max) weights[best.steps - 1] += 3;
    return { roll: weightedDiceRoll(g, weights), targetId: best?.id ?? null };
  }
  if (npc.kind === 'poverty') {
    const weights = Array.from({ length: max }, (_, i) => 1 + i * i);
    return { roll: weightedDiceRoll(g, weights), targetId: null };
  }
  return { roll: 1 + Math.floor(rngNext(g) * max), targetId: null };
}

function fairyGiftToPlayer(g, player) {
  const missing = [];
  for (let i = 0; i < 4; i++) if (!player.marks?.[i]) missing.push(i);
  if (missing.length) {
    const idx = missing[Math.floor(rngNext(g) * missing.length)];
    player.marks[idx] = true;
    addLog(g, `マークの妖精が ${player.name} に ${SUIT_LABELS[idx]} を贈った！`, 'mark');
    return;
  }
  if (hasFullMarks(player)) {
    if (getWildcardCount(player) >= MAX_WILDCARDS) {
      addLog(g, `マークの妖精は ${player.name} に贈るものがなかった`, 'event');
      return;
    }
    grantWildcard(g, player);
  }
}

export function departEventNpc(g, npc) {
  ensureEventNpcState(g);
  const idx = g.eventNpcs.findIndex((n) => n.id === npc.id);
  if (idx >= 0) g.eventNpcs.splice(idx, 1);
  addLog(g, `${npc.label} は異界へと帰っていった…`, 'event');
  g.eventNpcFx.push({ type: 'depart', npcId: npc.id, kind: npc.kind, pos: npc.pos });
  if (npc.kind === 'poverty') {
    g.povertyHolidayClearTurn = (g.turn || 1) + 1;
  }
}

function takeEventNpcTurn(g, npc) {
  ensureEventNpcState(g);
  if (npc.kind === 'poverty') {
    clearMapEventHolidays(g);
    g.povertyHolidayClearTurn = null;
  }

  const { roll, targetId } = rollEventNpcDice(g, npc);
  const path = [npc.pos];
  let pos = npc.pos;
  let prev = npc.prevPos;
  const gifted = new Set();

  // 行動開始地点にいるプレイヤーともすれ違い扱い
  if (npc.kind === 'mark_fairy') {
    for (const pl of g.players) {
      if (pl.bankrupt || pl.pos !== pos || gifted.has(pl.id)) continue;
      gifted.add(pl.id);
      fairyGiftToPlayer(g, pl);
    }
  }

  for (let i = 0; i < roll; i++) {
    const opts = getForwardNexts(g, pos, prev);
    if (!opts.length) break;
    const nextId = pickNpcStep(g, npc, opts, targetId);
    prev = pos;
    pos = nextId;
    path.push(pos);

    if (npc.kind === 'mark_fairy') {
      for (const pl of g.players) {
        if (pl.bankrupt || pl.pos !== pos || gifted.has(pl.id)) continue;
        gifted.add(pl.id);
        fairyGiftToPlayer(g, pl);
      }
    }
    if (npc.kind === 'poverty') {
      const node = getNode(g, pos);
      if (node?.type === 'shop') {
        node.eventHoliday = true;
        const owner = node.owner >= 0 ? g.players[node.owner] : null;
        addLog(
          g,
          `貧乏神が「${node.label || '店'}」を休ませた${owner ? `（${owner.name}）` : ''}`,
          'event',
        );
      }
    }
  }

  npc.prevPos = prev;
  npc.pos = pos;

  if (npc.kind === 'merchant') {
    const sq = getNode(g, pos);
    if (sq?.type === 'shop' && sq.owner >= 0) {
      const owner = g.players[sq.owner];
      const toll = calcToll(g, sq);
      if (owner && !owner.bankrupt && toll > 0) {
        owner.cash += toll;
        bumpStat(owner, 'tollIncome', toll);
        addLog(g, `大商人が ${owner.name} の店で買い物料 ${toll.toLocaleString()}G を支払った`, 'toll');
      }
    }
  }

  if (npc.kind === 'mark_fairy') {
    for (const pl of g.players) {
      if (pl.bankrupt || pl.pos !== pos || gifted.has(pl.id)) continue;
      gifted.add(pl.id);
      fairyGiftToPlayer(g, pl);
    }
  }

  const left = Math.max(0, (npc.actsLeft || 1) - 1);
  npc.actsLeft = left;
  addLog(g, `${npc.label} が ${roll} 進んだ（残り行動 ${left}）`, 'event');
  g.eventNpcFx.push({
    type: 'move',
    npcId: npc.id,
    kind: npc.kind,
    from: path[0],
    to: pos,
    path: path.slice(),
    roll,
  });

  if (left <= 0) departEventNpc(g, npc);
}

/** 4番目プレイヤー後（または少人数なら最後の席）でイベントNPC行動 */
export function runEventNpcRound(g) {
  ensureEventNpcState(g);
  if (!g.eventNpcs.length) {
    maybeClearPovertyHolidays(g);
    return;
  }
  const ordered = [...g.eventNpcs].sort((a, b) => a.spawnOrder - b.spawnOrder);
  for (const npc of ordered) {
    if (!g.eventNpcs.some((n) => n.id === npc.id)) continue;
    takeEventNpcTurn(g, npc);
  }
  maybeClearPovertyHolidays(g);
}

function shouldRunEventNpcsAfter(g, endingIdx) {
  ensureEventNpcState(g);
  if (!g.eventNpcs.length && g.povertyHolidayClearTurn == null) return false;
  const n = g.players?.length || 0;
  if (n <= 0) return false;
  // 4人なら4番目のあと＝周回直前。少人数／破産で席が飛ぶ場合も「ターンが進む直前」に合わせる
  let next = endingIdx;
  for (let i = 0; i < n; i++) {
    next = (next + 1) % n;
    if (!g.players[next].bankrupt) break;
  }
  return next <= endingIdx;
}

function endTurn(g) {
  if (g.phase === 'gameover') return;

  const endingIdx = g.currentPlayerIdx;
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

  // 4番目（または最後）のプレイヤー行動後、ターン切替前にイベントNPC
  if (shouldRunEventNpcsAfter(g, endingIdx)) {
    runEventNpcRound(g);
  }

  let next = g.currentPlayerIdx;
  for (let i = 0; i < g.players.length; i++) {
    next = (next + 1) % g.players.length;
    if (!g.players[next].bankrupt) break;
  }
  if (next <= g.currentPlayerIdx) g.turn++;
  g.currentPlayerIdx = next;
  // 自分の番が巡ってきたら、そのプレイヤーのターン内売却累計をリセット
  resetTurnSellPressure(g.players[next]);
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

/** 目標現金比率（総資産に対する）。利息を生まない現金は抑えめに。 */
export function cpuTargetCashRatio(traits = {}) {
  if (traits.key === 'broker') return 0.14;
  if (traits.key === 'tycoon') return 0.18;
  if (traits.key === 'magnate') return 0.16;
  return 0.2;
}

/** 破産回避用の現金クッション（これ未満まで使い切らない） */
export function cpuCashReserve(g, p) {
  const maxToll = cpuEstimateMaxToll(g, p);
  const assets = getPlayerAssets(g, p);
  const fromToll = Math.floor(maxToll * 1.05);
  const fromAssets = Math.floor(Math.max(0, assets.total) * 0.1);
  return Math.max(400, fromToll, Math.min(1400, fromAssets));
}

/** 支出後もクッションを残せるか（現金＋株のみ。店売却前提の買いを避ける） */
export function cpuCanAffordSpend(g, p, cost) {
  const need = Math.max(0, Number(cost) || 0);
  const reserve = cpuCashReserve(g, p);
  const stockAsset = getPlayerAssets(g, p).stockAsset;
  return p.cash + stockAsset - need >= reserve;
}

/** 決定論ノイズ（同シード・同局面で再現）。勝負師以外はタイブレーク程度。 */
export function cpuNoise(g, p, salt = 0) {
  const seed = (g?._seed >>> 0) || 1;
  const turn = (g?.turn || 1) >>> 0;
  const pid = ((p?.id ?? 0) + 1) >>> 0;
  let x = Math.imul(seed ^ Math.imul(turn, 9973) ^ Math.imul(pid, 7919) ^ Math.imul(salt + 1, 104729), 0x9e3779b1) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

/** 資産進捗・順位から終盤圧力を見る */
export function cpuGamePhase(g, p) {
  const assets = getPlayerAssets(g, p).total;
  const goal = Math.max(1, g.goal || DEFAULT_GOAL);
  const progress = assets / goal;
  let best = 0;
  for (const o of g.players || []) {
    if (o.bankrupt) continue;
    best = Math.max(best, getPlayerAssets(g, o).total);
  }
  const canWin = assets >= goal;
  return {
    progress,
    nearGoal: progress >= 0.82,
    closing: progress >= 0.92,
    lethal: canWin,
    trailing: assets < best * 0.72,
    leading: assets >= best * 0.95,
    best,
  };
}

/**
 * ボトルネック／銀行近傍の拠点価値。
 * 分岐合流（次数≥3）とぎんこう城からの近さを高く評価する。
 */
export function cpuShopTrafficScore(g, sq) {
  if (!sq || sq.type !== 'shop') return 0;
  if (!g._cpuTrafficCache) g._cpuTrafficCache = Object.create(null);
  const key = String(sq.id);
  if (g._cpuTrafficCache[key] != null) return g._cpuTrafficCache[key];
  const degree = (sq.nexts || []).length;
  const bankId = g.startId;
  const dist = bankId != null ? approxNodeDist(g, bankId, sq.id, 36) : 20;
  let s = 0;
  if (degree >= 4) s += 3.2;
  else if (degree >= 3) s += 2.4;
  else if (degree === 2) s += 0.6;
  if (dist <= 4) s += 3.0;
  else if (dist <= 8) s += 2.0;
  else if (dist <= 14) s += 1.0;
  else if (dist <= 22) s += 0.35;
  // エリア平均交通も弱く加味
  const peers = getAreaShops(g, sq.area);
  let peer = 0;
  for (const o of peers) {
    if (o.id === sq.id) continue;
    const d = (o.nexts || []).length;
    if (d >= 3) peer += 0.35;
  }
  s += Math.min(1.5, peer);
  g._cpuTrafficCache[key] = s;
  return s;
}

/** エリア合計資産価値（店価合計＋株単価×所持概算） */
function cpuAreaAssetValue(g, area, pid = null) {
  const shops = getAreaShops(g, area);
  const shopVal = shops.reduce((s, sq) => s + (sq.price || 0), 0);
  const price = g.areas[area]?.stockPrice || 0;
  const held = pid != null ? Math.max(0, Math.floor(Number(g.players[pid]?.stocks?.[area]) || 0)) : 0;
  return shopVal + held * price;
}

/**
 * 注力エリア（ sticky ）。2軒以上所有／独占王手を最優先し、
 * 所有状況が変わるまで方針を固定する。
 */
export function cpuFocusAreas(g, p, traits = getCpuPersonality(p)) {
  if (!p.flags) p.flags = {};
  const areaIds = Object.keys(g.areas || {}).map(Number);
  if (!areaIds.length) return [];

  const fingerprint = areaIds.map((a) => {
    const shops = getAreaShops(g, a);
    const mine = shops.filter((s) => s.owner === p.id).length;
    const vacant = shops.filter((s) => s.owner < 0).length;
    return `${a}:${mine}/${vacant}/${shops.length}`;
  }).join('|');

  const prev = Array.isArray(p.flags.cpuFocusAreas)
    ? p.flags.cpuFocusAreas.filter((a) => areaIds.includes(a))
    : [];
  if (prev.length && p.flags.cpuFocusFp === fingerprint) {
    return prev;
  }

  const scored = areaIds.map((a) => {
    const shops = getAreaShops(g, a);
    const mine = shops.filter((s) => s.owner === p.id).length;
    const vacant = shops.filter((s) => s.owner < 0).length;
    const enemy = shops.length - mine - vacant;
    let s = mine * 4.4 * traits.ownArea;
    s += vacant * traits.vacant * 0.9;
    // 2軒以上所持は独占候補として最優先
    if (mine >= 2) s += 14 * traits.ownArea;
    if (mine > 0 && vacant === 1) s += 10 * traits.ownArea;
    if (mine > 0 && vacant === 2) s += 3.2 * traits.ownArea;
    if (hasAreaMonopoly(g, p.id, a)) s += 2.5 * traits.ownArea;
    s -= enemy * (traits.key === 'magnate' ? 0.4 : 1.15);
    s += (p.stocks?.[a] || 0) * 0.14 * traits.stockBudget;
    // ボトルネック物件が多いエリアを優遇
    let traffic = 0;
    for (const sq of shops) traffic += cpuShopTrafficScore(g, sq);
    s += traffic * 0.55;
    const seed = (g?._seed >>> 0) || 1;
    s += ((Math.imul(seed ^ Math.imul(a + 1, 104729), 0x9e3779b1) >>> 0) % 1000) / 1000 * 0.35;
    return { a, s, mine, vacant };
  }).sort((x, y) => y.s - x.s || x.a - y.a);

  const want = Math.min(2, scored.length);
  let focus;
  if (prev.length) {
    const topIds = new Set(scored.slice(0, Math.min(4, scored.length)).map((x) => x.a));
    const stillGood = prev.filter((a) => topIds.has(a));
    const nearMono = scored.find((x) => x.mine >= 2 && x.vacant === 1)
      || scored.find((x) => x.mine > 0 && x.vacant === 1);
    if (nearMono && !stillGood.includes(nearMono.a)) {
      focus = [nearMono.a, ...stillGood.filter((a) => a !== nearMono.a)].slice(0, want);
    } else if (stillGood.length) {
      focus = stillGood.slice(0, want);
    }
  }
  if (!focus) focus = scored.slice(0, want).map((x) => x.a);

  p.flags.cpuFocusAreas = focus;
  p.flags.cpuFocusFp = fingerprint;
  return focus;
}

/** from→target の前方最短距離（分岐込み BFS） */
function cpuForwardDist(g, from, prev, target, limit = 28) {
  if (from === target) return 0;
  const seen = new Set([`${from}:${prev ?? -1}`]);
  const q = [{ id: from, prev, d: 0 }];
  while (q.length) {
    const cur = q.shift();
    if (cur.d >= limit) continue;
    for (const nid of getForwardNexts(g, cur.id, cur.prev)) {
      const key = `${nid}:${cur.id}`;
      if (seen.has(key)) continue;
      if (nid === target) return cur.d + 1;
      seen.add(key);
      q.push({ id: nid, prev: cur.id, d: cur.d + 1 });
    }
  }
  return limit + 1;
}

/** 欠けマーク／suit_fill までの最短距離 */
function cpuDistToMissingMark(g, from, prev, p, limit = 28) {
  const missing = [];
  for (let i = 0; i < 4; i++) if (!p.marks?.[i]) missing.push(i);
  if (!missing.length && (Number(p.wildcards) || 0) > 0) return limit + 1;
  const want = new Set(missing);
  const seen = new Set([`${from}:${prev ?? -1}`]);
  const q = [{ id: from, prev, d: 0 }];
  while (q.length) {
    const cur = q.shift();
    if (cur.d >= limit) continue;
    for (const nid of getForwardNexts(g, cur.id, cur.prev)) {
      const key = `${nid}:${cur.id}`;
      if (seen.has(key)) continue;
      const node = getNode(g, nid);
      if (node?.type === 'suit_fill') return cur.d + 1;
      if (node?.type === 'mark' && (want.size === 0 || want.has(node.suit))) return cur.d + 1;
      seen.add(key);
      q.push({ id: nid, prev: cur.id, d: cur.d + 1 });
    }
  }
  return limit + 1;
}

function scoreNodeForCpu(g, p, node, traits, focus, phase) {
  if (!node) return 0;
  const inFocus = focus.includes(node.area);
  let s = 0;
  if (node.type === 'shop') {
    if (node.owner < 0) {
      s += traits.vacant * (inFocus ? 1.65 : 1);
      const cnt = getPlayerAreaCount(g, p.id, node.area);
      s += cnt * 1.45 * traits.ownArea * (inFocus ? 1.35 : 1);
      if (cnt >= 2) s += 3.2 * traits.ownArea;
      const shops = getAreaShops(g, node.area);
      const vacantLeft = shops.filter((x) => x.owner < 0).length;
      if (cnt >= 1 && vacantLeft <= 2) s += 1.6 * traits.ownArea;
      if (cnt + 1 >= shops.length && vacantLeft <= 1) s += 4.5 * traits.ownArea;
      if (inFocus) s += 2.0 * traits.ownArea;
      s += cpuShopTrafficScore(g, node) * (phase.lethal ? 0.15 : 0.85);
      if (phase.lethal || phase.closing) s *= 0.15;
    } else if (node.owner === p.id) {
      s += 1.15 * traits.ownArea * (inFocus ? 1.4 : 1);
      if (hasAreaMonopoly(g, p.id, node.area)) s += 1.8 * traits.ownArea;
      if (phase.lethal) s *= 0.2;
    } else {
      const toll = calcToll(g, node);
      const reserve = cpuCashReserve(g, p);
      let pressure = p.cash < reserve ? 2.8 : (p.cash < reserve * 1.5 ? 1.6 : 1);
      if (phase.leading) pressure *= 1.25;
      if (phase.nearGoal || phase.lethal) pressure *= 1.55;
      s += traits.enemyToll * pressure * Math.min(6, toll / 70);
      if (toll >= p.cash) s -= 8 * pressure;
      if (hasAreaMonopoly(g, node.owner, node.area)) s -= 2.8 * pressure;
      if (phase.lethal) s -= 4 * pressure;
    }
  } else if (node.type === 'bank') {
    let bank = traits.bank;
    if (phase.nearGoal) bank *= 2.6;
    if (phase.closing) bank *= 1.8;
    if (phase.lethal) bank *= 5.5;
    if (phase.trailing && traits.key === 'broker') bank *= 1.3;
    s += bank;
  } else if (node.type === 'mark' || node.type === 'suit_fill') {
    const missing = (p.marks || []).filter((m) => !m).length;
    const needLvl = missing > 0 || (Number(p.wildcards) || 0) === 0;
    let markBoost = traits.mark * (needLvl ? 1.85 : 1);
    if (missing >= 3) markBoost *= 1.55;
    else if (missing >= 2) markBoost *= 1.3;
    else if (missing >= 1) markBoost *= 1.15;
    if (phase.trailing) markBoost *= 1.25;
    if (traits.key === 'gambler' && phase.trailing) markBoost *= 1.2;
    if (phase.lethal) markBoost *= 0.25;
    s += markBoost;
  } else if (node.type === 'stockbroker') {
    // ゴール直前は資産調整のため証券も評価
    let sb = traits.stockbroker * (phase.nearGoal && !phase.lethal ? 1.15 : 1);
    if (phase.lethal) sb *= 0.35;
    s += sb;
  } else if (node.type === 'scratch' || node.type === 'event') {
    s += traits.scratch * (phase.trailing ? 1.25 : 1) * (phase.lethal ? 0.2 : 1);
  } else if (node.type === 'minigame') {
    s += traits.minigame * (phase.trailing ? 1.2 : 1) * (phase.lethal ? 0.2 : 1);
  } else if (node.type === 'lucky') {
    s += (0.85 + (phase.trailing ? 0.4 : 0)) * (phase.lethal ? 0.25 : 1);
  } else if (node.type === 'rollon') {
    s += phase.lethal ? 0.15 : 0.7;
  }
  return s;
}

function scoreForkPath(g, p, fromId, nextId, traits, focus, phase) {
  let score = 0;
  let cur = nextId;
  let prev = fromId;
  for (let depth = 0; depth < 8; depth++) {
    const node = getNode(g, cur);
    score += scoreNodeForCpu(g, p, node, traits, focus, phase) * (1 - depth * 0.09);
    const nexts = getForwardNexts(g, cur, prev);
    if (!nexts.length) break;
    let best = nexts[0];
    let bestS = -Infinity;
    for (const nid of nexts) {
      const sc = scoreNodeForCpu(g, p, getNode(g, nid), traits, focus, phase);
      if (sc > bestS) {
        bestS = sc;
        best = nid;
      }
    }
    prev = cur;
    cur = best;
  }
  // マーク最短／銀行最短を動的に加点
  const bankDist = cpuForwardDist(g, nextId, fromId, g.startId, 30);
  if (phase.lethal || phase.closing) {
    score += Math.max(0, 22 - bankDist) * (phase.lethal ? 2.8 : 1.4);
  } else if (phase.nearGoal) {
    score += Math.max(0, 18 - bankDist) * 0.7;
  }
  const markDist = cpuDistToMissingMark(g, nextId, fromId, p, 30);
  if (!phase.lethal && markDist <= 30) {
    score += Math.max(0, 16 - markDist) * traits.mark * 0.55;
  }
  const jitter = traits.key === 'gambler' ? 0.55 : 0.12;
  score += cpuNoise(g, p, nextId + 11) * jitter;
  return score;
}

function cpuPickFork(g, p, options) {
  const traits = getCpuPersonality(p);
  const focus = cpuFocusAreas(g, p, traits);
  const phase = cpuGamePhase(g, p);
  let best = options[0];
  let bestScore = -Infinity;
  for (const opt of options) {
    const score = scoreForkPath(g, p, p.pos, opt.id, traits, focus, phase);
    if (score > bestScore) {
      bestScore = score;
      best = opt;
    }
  }
  return best.id;
}

export function cpuShouldBuyShop(g, p, sq, traits = getCpuPersonality(p)) {
  if (!sq) return false;
  const price = sq.price;
  if (getLiquidatableValue(g, p) < price) return false;
  if (!cpuCanAffordSpend(g, p, price)) return false;
  const assets = getPlayerAssets(g, p);
  const phase = cpuGamePhase(g, p);
  // 勝利確定後は新規購入しない
  if (phase.lethal || phase.closing || assets.total >= g.goal * 0.97) return false;
  const shops = getAreaShops(g, sq.area);
  const areaCnt = getPlayerAreaCount(g, p.id, sq.area);
  const vacantLeft = shops.filter((x) => x.owner < 0).length;
  const completesMono = areaCnt + 1 >= shops.length && vacantLeft <= 1;
  if (p.cash + assets.stockAsset < price) {
    if (!completesMono) return false;
  }
  const focus = cpuFocusAreas(g, p, traits);
  const inFocus = focus.includes(sq.area);
  if (completesMono) return true;

  // 序盤〜中盤: 空き物件は資金が許せば原則購入
  if (phase.progress < 0.78 && vacantLeft >= 1 && p.cash >= price + cpuCashReserve(g, p) * 0.85) {
    if (areaCnt >= 1 || inFocus || cpuShopTrafficScore(g, sq) >= 2.0 || traits.shopBuy >= 0.9) {
      return true;
    }
  }
  // 同一エリア2軒以上 → 残り買収を最優先
  if (areaCnt >= 2 && vacantLeft >= 1) return true;
  if (vacantLeft >= 1 && traits.vacant >= 2.0 && traits.shopBuy >= 0.8) {
    if (inFocus || areaCnt >= 1) return true;
  }
  if (inFocus && vacantLeft <= 3 && traits.shopBuy >= 0.8) return true;
  if (inFocus && areaCnt >= 1 && vacantLeft <= 2 && traits.shopBuy >= 0.75) return true;

  let desire = traits.shopBuy + areaCnt * 0.55 * Math.min(1.6, traits.ownArea / 2);
  desire += Math.min(1.4, traits.vacant * 0.22);
  desire += cpuShopTrafficScore(g, sq) * 0.22;
  if (areaCnt >= 1 && vacantLeft <= 2) desire += 0.85;
  if (areaCnt >= 2) desire += 1.1;
  if (vacantLeft >= 1) desire += 0.45;
  if (inFocus) desire += 0.65 * Math.min(1.4, traits.ownArea / 2.2);
  if (phase.trailing && traits.shopBuy >= 0.85) desire += 0.28;
  if (phase.nearGoal) desire -= 0.55;
  if (price > p.cash) desire -= 0.28;
  if (p.cash - price < cpuCashReserve(g, p)) desire -= 0.32;

  if (desire >= 0.9) return true;
  if (desire < 0.5) return false;
  if (traits.key === 'gambler') {
    return cpuNoise(g, p, sq.id + 31) < Math.min(0.92, desire * 0.62);
  }
  return desire >= 0.72;
}

/** 5倍買いの期待値ざっくり（独占後の増資枠＋株上昇 vs コスト） */
export function cpuFiveBuyExpectedValue(g, p, sq, price) {
  if (!sq) return 0;
  const areaSize = getAreaShops(g, sq.area).length;
  const myCnt = getPlayerAreaCount(g, p.id, sq.area);
  const completesOwn = myCnt >= Math.max(1, areaSize - 1);
  const shops = getAreaShops(g, sq.area);
  const areaVal = shops.reduce((s, x) => s + (x.price || 0), 0) + (sq.price || 0) * 0.25;
  const held = Math.max(0, Math.floor(Number(p.stocks?.[sq.area]) || 0));
  const stockPx = g.areas[sq.area]?.stockPrice || 0;
  // 独占で増資枠が跳ねる／株価も店価上昇で伸びる想定
  const investUpside = completesOwn ? Math.floor((sq.basePrice || sq.price || 0) * 6) : Math.floor((sq.basePrice || 0) * 1.5);
  const stockUpside = held * stockPx * (completesOwn ? 0.55 : 0.18);
  const tollUpside = completesOwn ? areaVal * 0.35 : areaVal * 0.08;
  return investUpside + stockUpside + tollUpside - price;
}

export function cpuShouldFiveBuy(g, p, pend, traits = getCpuPersonality(p)) {
  const price = Number(pend.price) || 0;
  if (price <= 0 || getLiquidatableValue(g, p) < price) return false;
  if (!cpuCanAffordSpend(g, p, price)) return false;
  const sq = getNode(g, pend.shopId);
  if (!sq) return false;
  const phase = cpuGamePhase(g, p);
  const areaSize = getAreaShops(g, sq.area).length;
  const myCnt = getPlayerAreaCount(g, p.id, sq.area);
  const ownerCnt = getPlayerAreaCount(g, sq.owner, sq.area);
  const focus = cpuFocusAreas(g, p, traits);
  const breaksEnemyMono = areaSize > 0 && ownerCnt >= areaSize;
  const completesOwn = myCnt >= Math.max(1, areaSize - 1);

  // 相手独占崩し／自陣独占完成は資金が足りるなら実行（勝利確定後でも防衛・確定を優先）
  if (breaksEnemyMono) return true;
  if (completesOwn) return true;
  // リーサル時の投機的5倍買いはしない
  if (phase.lethal) return false;
  if (phase.closing) return false;

  const ev = cpuFiveBuyExpectedValue(g, p, sq, price);
  let score = traits.fiveBuy;
  if (focus.includes(sq.area)) score += 0.35;
  if (myCnt >= 2) score += 0.45 * traits.ownArea / 2;
  if (myCnt >= Math.floor(areaSize / 2)) score += 0.22 * traits.ownArea / 2;
  if ((pend.toll || 0) >= price * 0.22) score += 0.18;
  if (ev > 0) score += Math.min(0.55, ev / Math.max(1, price));
  if (phase.trailing && traits.key === 'magnate') score += 0.2;
  if (phase.nearGoal) score -= 0.35;
  if (p.cash < price + cpuCashReserve(g, p)) score -= 0.5;
  // 交渉不成時でも EV がコストを上回れば実行
  if (ev > price * 0.08 && myCnt >= 1) return true;

  if (score >= 0.72) return true;
  if (score < 0.28) return false;
  if (traits.key === 'gambler') return cpuNoise(g, p, (pend.shopId || 0) + 47) < Math.min(0.75, score);
  return score >= 0.55;
}

/**
 * 株の購入先。自陣増資候補・他人独占への相乗り・注力を総合評価。
 */
export function cpuPickStockArea(g, p, traits = getCpuPersonality(p)) {
  const focus = cpuFocusAreas(g, p, traits);
  const phase = cpuGamePhase(g, p);
  const areas = Object.keys(g.areas || {}).map(Number);
  if (!areas.length) return 0;
  let best = areas[0];
  let bestScore = -Infinity;
  for (const a of areas) {
    const price = g.areas[a]?.stockPrice || 1;
    const mine = getPlayerAreaCount(g, p.id, a);
    const shops = getAreaShops(g, a);
    const vacant = shops.filter((s) => s.owner < 0).length;
    let s = (p.stocks[a] || 0) * 0.08;
    s += mine * traits.ownArea * 0.75;
    if (mine >= 2) s += 2.4 * traits.ownArea;
    s += (price / 40) * traits.stockBudget;
    if (focus.includes(a)) s += 2.2 * traits.stockBudget + 0.8;
    if (hasAreaMonopoly(g, p.id, a)) s += 2.0 * traits.stockBudget;
    // 増資直前インサイダー: 自分の店があり残増資があるエリア
    let rem = 0;
    for (const sq of shops) {
      if (sq.owner === p.id) rem += getRemainingInvest(g, sq);
    }
    if (rem >= 40) s += 2.6 * traits.stockBudget + Math.min(2.5, rem / 200);
    // 他人独占／独占間近への相乗り（タダ乗り）
    for (const o of g.players || []) {
      if (o.id === p.id || o.bankrupt) continue;
      if (hasAreaMonopoly(g, o.id, a)) {
        s += 4.2 * traits.stockBudget + 1.5;
        s += (o.stocks?.[a] || 0) > 8 ? 0.35 : 1.1; // 相手が薄持ちなら相乗り妙味大
      } else {
        const oc = getPlayerAreaCount(g, o.id, a);
        if (oc >= shops.length - 1 && vacant <= 1) s += 2.0 * traits.stockBudget;
      }
    }
    if (phase.nearGoal && !phase.lethal) s += rem > 0 ? 0.8 : -0.2;
    if (phase.lethal) s -= 3;
    s += cpuNoise(g, p, 300 + a) * 0.15;
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  return best;
}

/** 10株単位を意識した購入枚数（大口ブースト狙い／端数買い回避） */
export function cpuStockBuyCount(g, p, area, budget) {
  const price = Math.max(1, g.areas[area]?.stockPrice || 1);
  const maxByCash = Math.max(0, Math.floor(Math.max(0, budget) / price));
  if (maxByCash <= 0) return 0;
  if (maxByCash >= STOCK_BUY_BOOST_MIN) {
    const lots = Math.floor(maxByCash / STOCK_BUY_BOOST_MIN) * STOCK_BUY_BOOST_MIN;
    // 端数が9以下なら切り捨てて10単位に揃える（中途半端買い回避）
    if (lots >= STOCK_BUY_BOOST_MIN) return lots;
  }
  // 10未満しか買えないなら、予算の大半が残るときだけ少額購入
  if (maxByCash >= 6 && budget >= price * 6) return maxByCash;
  if (maxByCash >= 1 && budget >= price * maxByCash && maxByCash >= 3) return maxByCash;
  return maxByCash >= 1 && traitsStockHungry(p) ? maxByCash : (maxByCash >= 4 ? maxByCash : 0);
}

function traitsStockHungry(p) {
  const t = getCpuPersonality(p);
  return t.key === 'broker' || t.stockBudget >= 0.45;
}

/**
 * ライバル妨害／利確の戦略売却。
 * @returns {{ area:number, count:number }|null}
 */
export function cpuPickStrategicSell(g, p, traits = getCpuPersonality(p)) {
  if (!p || !canSellStockOnTurn(g, p.id)) return null;
  const phase = cpuGamePhase(g, p);
  const goal = Math.max(1, g.goal || DEFAULT_GOAL);
  const rivals = (g.players || []).filter((o) => o.id !== p.id && !o.bankrupt);
  const pressureRivals = rivals.filter((o) => getPlayerAssets(g, o).total >= goal * 0.92);
  const heldAreas = Object.keys(p.stocks || {}).map(Number).filter((a) => (p.stocks[a] || 0) > 0);
  if (!heldAreas.length) return null;

  let best = null;
  let bestScore = 0;
  for (const a of heldAreas) {
    const have = Math.floor(Number(p.stocks[a]) || 0);
    if (have < 1) continue;
    const mine = getPlayerAreaCount(g, p.id, a);
    const focus = cpuFocusAreas(g, p, traits);
    // 自陣核は売らない（利確・妨害以外）
    const isCore = hasAreaMonopoly(g, p.id, a) || (mine >= 2 && focus.includes(a));
    let hurt = 0;
    for (const o of rivals) {
      const oh = Math.floor(Number(o.stocks?.[a]) || 0);
      if (oh <= 0) continue;
      const oAssets = getPlayerAssets(g, o).total;
      const near = oAssets >= goal * 0.9;
      hurt += oh * (near ? 2.4 : 1) * (g.areas[a]?.stockPrice || 1) * 0.02;
      if (hasAreaMonopoly(g, o.id, a)) hurt += 1.5;
    }
    const dumpCount = have >= STOCK_SELL_PRESSURE_MIN
      ? Math.min(have, Math.max(STOCK_SELL_PRESSURE_MIN, Math.floor(have / STOCK_SELL_PRESSURE_MIN) * STOCK_SELL_PRESSURE_MIN))
      : 0;
    // ゴール圧：ライバルを目標未満へ引きずり下ろす
    if (pressureRivals.length && dumpCount >= STOCK_SELL_PRESSURE_MIN) {
      const score = hurt * 3 + (phase.leading ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = { area: a, count: dumpCount };
      }
      continue;
    }
    // 自分も目標直前なら利確（非コア）
    if (phase.nearGoal && !isCore && have >= 5) {
      const count = have >= STOCK_SELL_PRESSURE_MIN ? dumpCount || have : have;
      // 自株価を不用意に落とさない：自分が最多保有なら10単位売却を避ける
      let myLead = true;
      for (const o of rivals) {
        if ((o.stocks?.[a] || 0) > have) myLead = false;
      }
      const sellN = (!myLead && dumpCount >= STOCK_SELL_PRESSURE_MIN) ? dumpCount : Math.min(have, Math.max(1, have - (myLead ? have % STOCK_SELL_PRESSURE_MIN : 0)));
      const score = 1.2 + (phase.closing ? 1.5 : 0);
      if (score > bestScore && sellN > 0) {
        bestScore = score;
        best = { area: a, count: sellN };
      }
    }
    // ライバル大量保有エリアを暴落させ資産削り
    if (!isCore && dumpCount >= STOCK_SELL_PRESSURE_MIN && hurt >= 1.2) {
      const score = hurt + (traits.key === 'broker' ? 0.8 : 0.3);
      if (score > bestScore) {
        bestScore = score;
        best = { area: a, count: dumpCount };
      }
    }
  }
  return bestScore >= 1.15 ? best : null;
}

/**
 * 互いにリーチの独占交換案。自分側エリア価値が高いときだけ提案。
 * @returns {{ targetId:number, giveShopId:number, takeShopId:number }|null}
 */
export function cpuFindMonopolySwap(g, p) {
  if (!p) return null;
  const myReach = [];
  for (const a of Object.keys(g.areas || {}).map(Number)) {
    const shops = getAreaShops(g, a);
    if (shops.length < 2) continue;
    const mine = shops.filter((s) => s.owner === p.id);
    const need = shops.filter((s) => s.owner >= 0 && s.owner !== p.id);
    if (mine.length === shops.length - 1 && need.length === 1) {
      myReach.push({ area: a, need: need[0], value: cpuAreaAssetValue(g, a, p.id) });
    }
  }
  if (!myReach.length) return null;
  let best = null;
  let bestScore = 0;
  for (const o of g.players || []) {
    if (o.id === p.id || o.bankrupt) continue;
    for (const a of Object.keys(g.areas || {}).map(Number)) {
      const shops = getAreaShops(g, a);
      if (shops.length < 2) continue;
      const theirs = shops.filter((s) => s.owner === o.id);
      const needFromMe = shops.filter((s) => s.owner === p.id);
      if (theirs.length !== shops.length - 1 || needFromMe.length !== 1) continue;
      for (const mine of myReach) {
        if (mine.need.owner !== o.id) continue;
        const theirVal = cpuAreaAssetValue(g, a, o.id);
        // 自分の完成エリアの方が価値が高い／株が上がりやすいときだけ
        if (mine.value < theirVal * 0.92) continue;
        const score = mine.value - theirVal * 0.5 + cpuShopTrafficScore(g, mine.need);
        if (score > bestScore) {
          bestScore = score;
          best = { targetId: o.id, giveShopId: needFromMe[0].id, takeShopId: mine.need.id };
        }
      }
    }
  }
  return best;
}

/**
 * 目標現金まで調達。urgent=true なら独占核も惜しまず売る（通行料負債用）。
 * 非緊急時は注力エリア外の株・店から先に処分し、10株単位の暴落を意識する。
 */
function cpuRaiseFunds(g, p, target, traits, { urgent = false } = {}) {
  const focus = cpuFocusAreas(g, p, traits);
  let guard = 0;
  while (p.cash < target && guard++ < 80) {
    const held = Object.keys(p.stocks || {}).map(Number).filter((a) => (p.stocks[a] || 0) > 0);
    if (held.length) {
      held.sort((a, b) => {
        const focusA = focus.includes(a) ? 1 : 0;
        const focusB = focus.includes(b) ? 1 : 0;
        const ownA = getPlayerAreaCount(g, p.id, a);
        const ownB = getPlayerAreaCount(g, p.id, b);
        const monoA = hasAreaMonopoly(g, p.id, a) ? 1 : 0;
        const monoB = hasAreaMonopoly(g, p.id, b) ? 1 : 0;
        const priceA = g.areas[a]?.stockPrice || 1;
        const priceB = g.areas[b]?.stockPrice || 1;
        if (!urgent) {
          if (monoA !== monoB) return monoA - monoB;
          if (focusA !== focusB) return focusA - focusB;
          if (traits.stockBudget > 0.45) return ownA - ownB || priceA - priceB;
        }
        return priceA - priceB || ownA - ownB;
      });
      const a = held[0];
      const need = target - p.cash;
      const price = g.areas[a].stockPrice || 1;
      let count = Math.min(p.stocks[a], Math.max(1, Math.ceil(need / price)));
      // 非緊急かつ自陣核: 10株未満に抑えて株価を落とさない
      const isCore = hasAreaMonopoly(g, p.id, a) || (focus.includes(a) && getPlayerAreaCount(g, p.id, a) >= 2);
      if (!urgent && isCore && count >= STOCK_SELL_PRESSURE_MIN) {
        const safe = Math.min(count, Math.max(1, STOCK_SELL_PRESSURE_MIN - 1 - playerTurnSellPressure(p, a)));
        if (safe > 0 && safe * price >= need * 0.6) count = safe;
      }
      const before = p.stocks[a];
      sellStockForCash(g, p, a, count);
      if ((p.stocks[a] || 0) === before) break;
      continue;
    }
    const shops = g.map.filter((s) => s.type === 'shop' && s.owner === p.id);
    if (!shops.length) break;
    shops.sort((a, b) => {
      const focusA = focus.includes(a.area) ? 1 : 0;
      const focusB = focus.includes(b.area) ? 1 : 0;
      const ca = getPlayerAreaCount(g, p.id, a.area);
      const cb = getPlayerAreaCount(g, p.id, b.area);
      if (!urgent) {
        if (focusA !== focusB) return focusA - focusB;
        if (traits.ownArea > 2) return ca - cb || a.price - b.price;
      }
      return a.price - b.price || ca - cb;
    });
    const sold = sellShopForCash(g, p, shops[0].id);
    if (!sold.ok) break;
  }
}

function scratchLinesThrough(size, cellId) {
  const row = Math.floor(cellId / size);
  const col = cellId % size;
  const lines = [];
  lines.push(Array.from({ length: size }, (_, c) => row * size + c));
  lines.push(Array.from({ length: size }, (_, r) => r * size + col));
  {
    const diff = row - col;
    const cells = [];
    for (let r = 0; r < size; r++) {
      const c = r - diff;
      if (c >= 0 && c < size) cells.push(r * size + c);
    }
    if (cells.length >= 3) lines.push(cells);
  }
  {
    const sum = row + col;
    const cells = [];
    for (let r = 0; r < size; r++) {
      const c = sum - r;
      if (c >= 0 && c < size) cells.push(r * size + c);
    }
    if (cells.length >= 3) lines.push(cells);
  }
  return lines;
}

function scoreScratchLine(table, cells, color) {
  let mine = 0;
  let open = 0;
  let blocked = 0;
  for (const id of cells) {
    const cell = table.cells[id];
    if (!cell?.scratched) open++;
    else if (cell.color === color) mine++;
    else blocked++;
  }
  if (mine + open < 3) return 0;
  let s = mine * 1.4;
  if (mine >= 2 && open >= 1) s += mine * 2.8;
  if (mine >= 3) s += 4;
  if (blocked && mine < 2) s *= 0.35;
  return s;
}

export function cpuPickScratchCell(g, p, openIds) {
  const table = getSharedEventTable(g);
  const traits = getCpuPersonality(p);
  // スクラッチ色は開けた人の座席IDで塗られる
  const color = p.id;
  const size = table.size;
  const openSet = new Set(openIds);
  let best = openIds[0];
  let bestScore = -Infinity;
  for (const id of openIds) {
    const row = Math.floor(id / size);
    const col = id % size;
    let s = 0;
    for (const line of scratchLinesThrough(size, id)) {
      s += scoreScratchLine(table, line, color) * traits.scratch * 0.45;
    }
    // 隣接（縦横）に自分色があれば伸ばす価値
    const neigh = [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]];
    for (const [r, c] of neigh) {
      if (r < 0 || c < 0 || r >= size || c >= size) continue;
      const cell = table.cells[r * size + c];
      if (cell?.scratched && cell.color === color) s += 1.1 * traits.scratch;
    }
    // 中央寄りは僅かに優遇（ライン交差が多い）
    const mid = (size - 1) / 2;
    s += (1.2 - (Math.abs(row - mid) + Math.abs(col - mid)) * 0.15) * 0.35;
    const jitter = traits.key === 'gambler' ? 0.9 : 0.18;
    s += cpuNoise(g, p, id + 71) * jitter;
    // 未公開が極端に少ないラインは優先
    if (openSet.has(id) && s > bestScore) {
      bestScore = s;
      best = id;
    }
  }
  return best;
}

function cpuPickInvestShop(g, p, ids, traits, { preferId = null, requireRem = false } = {}) {
  const focus = cpuFocusAreas(g, p, traits);
  let best = preferId ?? ids[0];
  let bestScore = -Infinity;
  for (const id of ids) {
    const sq = getNode(g, id);
    if (!sq || sq.owner !== p.id) continue;
    const rem = getRemainingInvest(g, sq);
    if (requireRem && rem < 20) continue;
    const areaCnt = getPlayerAreaCount(g, p.id, sq.area);
    let score = rem * 1.35 + areaCnt * 50 + sq.price * 0.05;
    if (focus.includes(sq.area)) score += 60 * traits.ownArea / 2;
    if (hasAreaMonopoly(g, p.id, sq.area)) score += 55;
    if (areaCnt >= 2) score += 35;
    if (traits.key === 'magnate' || traits.key === 'tycoon') score += areaCnt * 28;
    score += cpuShopTrafficScore(g, sq) * 8;
    // 自株を多く持つエリアを優先（増資で株価上昇の恩恵）
    score += Math.min(80, (p.stocks?.[sq.area] || 0) * (g.areas[sq.area]?.stockPrice || 1) * 0.08);
    if (preferId != null && id === preferId) score += 18;
    score += cpuNoise(g, p, id + 91) * 3;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

/** 増資額：可能なら上限近くまで（1アクション効率最大化） */
function cpuInvestAmount(g, p, target, traits, phase) {
  if (!target) return 0;
  const rem = getRemainingInvest(g, target);
  if (rem < 20) return 0;
  const reserve = cpuCashReserve(g, p);
  const half = !!p.flags?.investCoupon;
  const spendablePay = Math.max(0, p.cash - reserve);
  const spendableValue = half ? spendablePay * 2 : spendablePay;
  if (spendableValue < 20) return 0;
  const mono = hasAreaMonopoly(g, p.id, target.area);
  const focus = focusBoostInvest(g, p, target, traits);
  // 勝利確定後は増資しない（リスク回避）
  if (phase.lethal) return 0;
  // ゴール直前でも、目標を確実に超えるための資産調整として増資は許容
  let rate = Math.max(0.72, traits.investRate + 0.35);
  if (mono || focus) rate = 1;
  else if (getPlayerAreaCount(g, p.id, target.area) >= 2) rate = Math.max(rate, 0.92);
  if (phase.closing && !mono) rate *= 0.55;
  else if (phase.nearGoal && !mono && !focus) rate *= 0.75;
  let amount = Math.min(rem, Math.floor(spendableValue * rate));
  // 上限近くまで寄せる（端数は使い切る）
  if (rate >= 0.95) amount = Math.min(rem, spendableValue);
  const pay = half ? Math.ceil(amount / 2) : amount;
  if (amount < 20 || !cpuCanAffordSpend(g, p, pay)) return 0;
  return amount;
}

/** CPUの個性付き行動（1アクション分。移動の連続はUI側） */
export function cpuAct(g) {
  if (g.phase === 'gameover') return null;

  // 選択待ちは pending.playerId のCPUが応答（手番プレイヤーと違うこともある：
  // 全員参加ミニゲーム・物件取引の承諾など）
  if (g.phase === 'await_choice' && g.pending) {
    const pend = g.pending;
    const p = g.players[pend.playerId];
    if (!p?.isCPU || p.bankrupt) return null;
    const traits = getCpuPersonality(p);
    const phase = cpuGamePhase(g, p);

    if (pend.type === 'shop_trade_offer') {
      const ok = cpuShouldAcceptShopTrade(g, p, pend);
      return applyChoice(g, { action: ok ? 'accept' : 'reject' });
    }
    if (pend.type === 'shop_trade_compose') {
      if (!p.flags) p.flags = {};
      const deal = cpuFindMonopolySwap(g, p);
      if (!deal) return applyChoice(g, { action: 'cancel' });
      if (pend.targetId == null) {
        return applyChoice(g, { action: 'set_target', targetId: deal.targetId });
      }
      if (pend.targetId !== deal.targetId) {
        return applyChoice(g, { action: 'cancel' });
      }
      const give = pend.giveShopIds || [];
      const take = pend.takeShopIds || [];
      if (!give.includes(deal.giveShopId)) {
        return applyChoice(g, { action: 'toggle_give', shopId: deal.giveShopId });
      }
      if (!take.includes(deal.takeShopId)) {
        return applyChoice(g, { action: 'toggle_take', shopId: deal.takeShopId });
      }
      // 余計な店が選ばれていたら一旦キャンセル
      if (give.length !== 1 || take.length !== 1) {
        return applyChoice(g, { action: 'cancel' });
      }
      return applyChoice(g, { action: 'propose' });
    }
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
      const prefer = pend.landedShopId ?? pend.shopId;
      const best = cpuPickInvestShop(g, p, ids, traits, { preferId: prefer, requireRem: true });
      const target = getNode(g, best);
      const amount = cpuInvestAmount(g, p, target, traits, phase);
      if (amount >= 20) {
        return applyChoice(g, { action: 'invest', shopId: best, amount });
      }
      return applyChoice(g, { action: 'skip' });
    }
    if (pend.type === 'pick_invest') {
      const ids = pend.shopIds?.length
        ? pend.shopIds
        : g.map.filter((s) => s.type === 'shop' && s.owner === p.id).map((s) => s.id);
      if (!ids.length) return applyChoice(g, { action: 'skip' });
      const best = cpuPickInvestShop(g, p, ids, traits, { preferId: null, requireRem: false });
      return applyChoice(g, { action: 'invest', shopId: best });
    }
    if (pend.type === 'force_sell_shop') {
      const focus = cpuFocusAreas(g, p, traits);
      const ids = pend.shopIds?.length
        ? pend.shopIds
        : g.map.filter((s) => s.type === 'shop' && s.owner === p.id).map((s) => s.id);
      const shops = ids.map((id) => getNode(g, id)).filter((s) => s && s.owner === p.id);
      shops.sort((a, b) => {
        const fa = focus.includes(a.area) ? 1 : 0;
        const fb = focus.includes(b.area) ? 1 : 0;
        if (fa !== fb) return fa - fb;
        const ca = getPlayerAreaCount(g, p.id, a.area);
        const cb = getPlayerAreaCount(g, p.id, b.area);
        return ca - cb || a.price - b.price;
      });
      const target = shops[0];
      if (!target) return applyChoice(g, { action: 'skip' });
      return applyChoice(g, { action: 'sell', shopId: target.id });
    }
    if (pend.type === 'any_shop_buy') {
      const multi = pend.multi || 6;
      const ids = pend.shopIds?.length
        ? pend.shopIds
        : g.map.filter((s) => s.type === 'shop' && s.owner >= 0 && s.owner !== p.id).map((s) => s.id);
      let best = null;
      let bestScore = -Infinity;
      for (const id of ids) {
        const sq = getNode(g, id);
        if (!sq || sq.owner < 0 || sq.owner === p.id) continue;
        const price = sq.price * multi;
        if (!cpuCanAffordSpend(g, p, price) || getLiquidatableValue(g, p) < price) continue;
        const areaSize = getAreaShops(g, sq.area).length;
        const ownerCnt = getPlayerAreaCount(g, sq.owner, sq.area);
        const myCnt = getPlayerAreaCount(g, p.id, sq.area);
        let score = myCnt * traits.ownArea;
        if (ownerCnt >= areaSize) score += 8;
        if (myCnt >= areaSize - 1) score += 6;
        score += (pend.toll || 0) / 100;
        score += cpuNoise(g, p, id + 61) * 0.3;
        if (score > bestScore) {
          bestScore = score;
          best = sq;
        }
      }
      if (!best) return applyChoice(g, { action: 'skip' });
      return applyChoice(g, { action: 'buy', shopId: best.id });
    }
    if (pend.type === 'vacant_shop_buy') {
      if (phase.lethal) return applyChoice(g, { action: 'skip' });
      const multi = pend.multi || 2;
      const ids = pend.shopIds?.length
        ? pend.shopIds
        : g.map.filter((s) => s.type === 'shop' && s.owner < 0).map((s) => s.id);
      let best = null;
      let bestScore = -Infinity;
      for (const id of ids) {
        const sq = getNode(g, id);
        if (!sq || sq.owner >= 0) continue;
        const price = (Number(sq.basePrice || sq.price) || 0) * multi;
        if (!cpuCanAffordSpend(g, p, price) || getLiquidatableValue(g, p) < price) continue;
        const myCnt = getPlayerAreaCount(g, p.id, sq.area);
        const areaSize = getAreaShops(g, sq.area).length;
        let score = myCnt * traits.ownArea + traits.vacant;
        if (myCnt >= 2) score += 10;
        if (myCnt + 1 >= areaSize) score += 8;
        score += cpuShopTrafficScore(g, sq) * 1.2;
        score += cpuNoise(g, p, id + 71) * 0.3;
        if (score > bestScore) {
          bestScore = score;
          best = sq;
        }
      }
      if (!best) return applyChoice(g, { action: 'skip' });
      return applyChoice(g, { action: 'buy', shopId: best.id });
    }
    if (pend.type === 'force_rival_sell') {
      const ids = pend.shopIds?.length
        ? pend.shopIds
        : g.map.filter((s) => s.type === 'shop' && s.owner >= 0 && s.owner !== p.id).map((s) => s.id);
      let best = null;
      let bestScore = -Infinity;
      for (const id of ids) {
        const sq = getNode(g, id);
        if (!sq || sq.owner < 0 || sq.owner === p.id) continue;
        const areaSize = getAreaShops(g, sq.area).length;
        const ownerCnt = getPlayerAreaCount(g, sq.owner, sq.area);
        const myCnt = getPlayerAreaCount(g, p.id, sq.area);
        let score = sq.price / 80;
        if (ownerCnt >= areaSize) score += 12;
        if (myCnt > 0) score += 3;
        score += cpuNoise(g, p, id + 81) * 0.3;
        if (score > bestScore) {
          bestScore = score;
          best = sq;
        }
      }
      if (!best) return applyChoice(g, { action: 'skip' });
      return applyChoice(g, { action: 'sell', shopId: best.id });
    }
    if (pend.type === 'five_buy') {
      const buy = cpuShouldFiveBuy(g, p, pend, traits);
      return applyChoice(g, { action: buy ? 'buy' : 'skip' });
    }
    if (pend.type === 'raise_funds') {
      const target = Number(pend.targetCash) || 0;
      const resume = pend.resume;
      const optional = !!(resume && ['five_buy', 'any_shop_buy', 'vacant_shop_buy', 'buy_shop', 'invest'].includes(resume.type));
      const urgent = !optional; // 通行料など必須負債は資産を惜しまず換金
      cpuRaiseFunds(g, p, target, traits, { urgent });
      if (p.cash >= target) {
        // 任意購入の再開はクッションを割るなら実行しない
        let exec = optional;
        if (optional && resume?.type === 'invest') {
          const pay = Number(resume.amount) || target;
          exec = cpuCanAffordSpend(g, p, pay);
        } else if (optional && (resume?.type === 'buy_shop' || resume?.type === 'five_buy' || resume?.type === 'any_shop_buy' || resume?.type === 'vacant_shop_buy')) {
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
      // 証券では売り抜け（利確・妨害）を先に検討
      if (!bankVisit) {
        const dump = cpuPickStrategicSell(g, p, traits);
        if (dump && (p.stocks?.[dump.area] || 0) >= dump.count) {
          // stock pending の sell は bank 以外で可
          return applyChoice(g, { action: 'sell', area: dump.area, count: dump.count });
        }
      }
      const reserve = cpuCashReserve(g, p);
      const assets = getPlayerAssets(g, p);
      const targetCash = Math.max(reserve, Math.floor(assets.total * cpuTargetCashRatio(traits)));
      const spendable = Math.max(0, p.cash - Math.max(reserve, Math.min(p.cash, targetCash * 0.85)));
      // 勝利確定後は株購入しない（銀行へ直行）
      if (spendable >= 80 && !phase.lethal) {
        const a = cpuPickStockArea(g, p, traits);
        const price = g.areas[a]?.stockPrice || 1;
        // 増資候補エリアは資金の大部分を投入（インサイダー）
        const shops = getAreaShops(g, a);
        let rem = 0;
        for (const sq of shops) {
          if (sq.owner === p.id) rem += getRemainingInvest(g, sq);
        }
        const insider = rem >= 40 || hasAreaMonopoly(g, p.id, a) || getPlayerAreaCount(g, p.id, a) >= 2;
        let ratio = bankVisit
          ? Math.min(0.88, traits.stockBudget + 0.18)
          : Math.max(0.14, traits.stockBudget * 0.4);
        if (insider) ratio = Math.min(0.92, Math.max(ratio, 0.72));
        if (phase.nearGoal && !insider) ratio *= 0.65;
        if (phase.nearGoal && insider) ratio = Math.min(0.9, ratio + 0.1);
        if (phase.trailing && traits.key === 'broker') ratio = Math.min(0.9, ratio + 0.12);
        // 現金過多ならもっと株へ
        if (p.cash > assets.total * (cpuTargetCashRatio(traits) + 0.12)) {
          ratio = Math.min(0.92, ratio + 0.15);
        }
        const budget = Math.floor(spendable * ratio);
        const count = cpuStockBuyCount(g, p, a, budget);
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
    if (pend.type === 'potion_pick') {
      const slot = Math.floor(cpuNoise(g, p, 611) * POTION_CARD_COUNT);
      return applyChoice(g, { action: 'pick', slot });
    }
    if (pend.type === 'minigame') {
      const n = (salt) => cpuNoise(g, p, salt);
      if (pend.game === 'guess_dice') {
        // 勝負師は端を避け中央寄り、他は広めに（シード固定）
        const pick = traits.key === 'gambler'
          ? 2 + Math.floor(n(501) * 4)
          : 1 + Math.floor(n(502) * 6);
        return applyChoice(g, { action: 'pick', value: pick });
      }
      if (pend.game === 'dice_battle') {
        return applyChoice(g, { action: 'pick', value: n(503) < 0.55 ? 'rush' : 'guard' });
      }
      if (pend.game === 'horse_race') {
        return applyChoice(g, { action: 'pick', value: Math.floor(n(504) * 4) });
      }
      if (pend.game === 'high_low') {
        return applyChoice(g, { action: 'pick', value: n(505) < 0.5 ? 'low' : 'high' });
      }
      if (pend.game === 'rps_duel') {
        const hands = ['rock', 'paper', 'scissors'];
        return applyChoice(g, { action: 'pick', value: hands[Math.floor(n(506) * 3)] });
      }
      if (pend.game === 'coin') {
        return applyChoice(g, { action: 'pick', value: n(507) < 0.5 ? 'heads' : 'tails' });
      }
      if (pend.game === 'roulette') {
        const colors = ['red', 'black', 'green'];
        // 緑は低確率で選ぶ（期待値偏りを抑える）
        const roll = n(508);
        const pick = roll < 0.08 ? 'green' : (roll < 0.54 ? 'red' : 'black');
        return applyChoice(g, { action: 'pick', value: pick });
      }
      if (pend.game === 'heist') {
        const risks = ['safe', 'normal', 'bold'];
        const bias = traits.key === 'gambler' ? 2 : traits.key === 'tycoon' ? 0 : 1;
        const idx = Math.max(0, Math.min(2, bias + Math.floor(n(509) * 2) - (n(510) < 0.5 ? 0 : 1)));
        return applyChoice(g, { action: 'pick', value: risks[idx] });
      }
      if (pend.game === 'balloon_dash') {
        const pumps = traits.key === 'gambler' ? [5, 7, 7] : traits.key === 'tycoon' ? [3, 3, 5] : [3, 5, 7];
        return applyChoice(g, { action: 'pick', value: pumps[Math.floor(n(511) * 3)] });
      }
      return applyChoice(g, { action: 'spin' });
    }
    return null;
  }

  const p = currentPlayer(g);
  if (!p?.isCPU || p.bankrupt) return null;
  const traits = getCpuPersonality(p);

  if (g.phase === 'await_roll') {
    if (!p.flags) p.flags = {};
    // 戦略的株売却（妨害・利確）をサイコロ前に実行
    const dump = cpuPickStrategicSell(g, p, traits);
    if (dump) {
      const sold = preTurnSell(g, p.id, dump.area, dump.count);
      if (sold?.ok) return sold;
    }
    // 独占交換交渉（ターンに1回まで試行）
    if (p.flags.cpuTradeTriedTurn !== g.turn && canOpenShopTrade(g, p.id)) {
      p.flags.cpuTradeTriedTurn = g.turn;
      const deal = cpuFindMonopolySwap(g, p);
      if (deal) {
        const opened = openShopTradeCompose(g, p.id);
        if (opened?.ok) return opened;
      }
    }
    return rollDice(g);
  }

  if (g.phase === 'moving' && g.move) {
    return advanceMove(g);
  }

  if (g.phase === 'await_fork' && g.pending?.type === 'fork') {
    const nextId = cpuPickFork(g, p, g.pending.options);
    return chooseFork(g, nextId);
  }

  return null;
}

function focusBoostInvest(g, p, sq, traits) {
  const focus = cpuFocusAreas(g, p, traits);
  return focus.includes(sq.area)
    || hasAreaMonopoly(g, p.id, sq.area)
    || getPlayerAreaCount(g, p.id, sq.area) >= 2;
}
