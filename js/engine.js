/** MkMk Street — ゲームエンジン（純ロジック / ホスト権威） */

import { buildBoard, SUIT_LABELS, DEFAULT_GOAL, DEFAULT_CASH, dirLabel } from './board.js';
import { createEventTable, scratchCell, unscratchedIds, applyAllCash } from './eventTable.js';

export const PLAYER_COLORS = ['#e85d75', '#3d8bfd', '#f0a202', '#20c997'];
export const PLAYER_NAMES_DEFAULT = ['あか', 'あお', 'きいろ', 'みどり'];

/** CPU個性（席順でローテ。明示指定も可） */
export const CPU_PERSONALITY_KEYS = ['tycoon', 'broker', 'magnate', 'gambler'];
export const CPU_PERSONALITIES = {
  tycoon: {
    label: '店舗王',
    shopBuy: 1.25,
    fiveBuy: 0.72,
    investRate: 0.55,
    stockBudget: 0.35,
    vacant: 2.6,
    ownArea: 2.0,
    enemyToll: -1.6,
    bank: 0.55,
    mark: 0.7,
    stockbroker: 0.35,
    scratch: 0.45,
    minigame: 0.5,
  },
  broker: {
    label: '株マニア',
    shopBuy: 0.65,
    fiveBuy: 0.28,
    investRate: 0.22,
    stockBudget: 0.92,
    vacant: 1.0,
    ownArea: 1.3,
    enemyToll: -2.2,
    bank: 1.6,
    mark: 0.55,
    stockbroker: 2.6,
    scratch: 0.5,
    minigame: 0.45,
  },
  magnate: {
    label: '独占屋',
    shopBuy: 1.1,
    fiveBuy: 0.88,
    investRate: 0.68,
    stockBudget: 0.5,
    vacant: 1.7,
    ownArea: 3.2,
    enemyToll: -1.1,
    bank: 0.9,
    mark: 1.0,
    stockbroker: 0.9,
    scratch: 0.85,
    minigame: 0.6,
  },
  gambler: {
    label: '勝負師',
    shopBuy: 0.8,
    fiveBuy: 0.55,
    investRate: 0.32,
    stockBudget: 0.42,
    vacant: 1.2,
    ownArea: 1.0,
    enemyToll: -1.0,
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

const TOLL_MULTI = [1, 1, 1.25, 2.5, 5, 6, 6.75];
const MAX_INVEST_RATE = [0, 0.5, 1, 3, 9, 11, 13];

function giveAllCash(g, amount) {
  const msgs = [];
  applyAllCash(g, amount, msgs);
  return msgs[0] || `全員 +${amount}G`;
}

const CHANCE_EVENTS = [
  { id: 'bonus', label: '臨時ボーナス', apply: (g, p) => { const n = 200 + p.level * 50; p.cash += n; return `+${n}G` } },
  { id: 'salary', label: '給料日っぽい日', apply: (g, p) => { const n = Math.floor(getLevelBonus(g, p) * 0.5); p.cash += n; return `賞金の半分 +${n}G` } },
  { id: 'payday_all', label: '給料日！', apply: (g) => giveAllCash(g, 120) },
  { id: 'bonus_wave', label: 'ボーナス支給', apply: (g) => giveAllCash(g, 150) },
  { id: 'tax', label: '税金', apply: (g, p) => { const n = Math.min(p.cash, 150 + p.level * 30); p.cash -= n; return `-${n}G` } },
  { id: 'warp_bank', label: '銀行へワープ', apply: (g, p) => { p.pos = g.startId; p.prevPos = null; return '銀行へ移動' } },
  { id: 'stock_gift', label: '株のおすそ分け', apply: (g, p) => {
    const areas = Object.keys(g.areas).map(Number);
    const a = areas[Math.floor(Math.random() * areas.length)];
    p.stocks[a] = (p.stocks[a] || 0) + 10;
    return `A${a}株 +10`
  }},
  { id: 'invest_boost', label: '増資クーポン', apply: (g, p) => { p.flags.investCoupon = true; return '次の自分店増資が半額' } },
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
  { id: 'cash', label: '臨時収入', apply: (g, p) => { const n = 180 + p.level * 40; p.cash += n; return `+${n}G` } },
  { id: 'festival', label: 'お祭り景気', apply: (g) => giveAllCash(g, 100) },
  { id: 'stimulus', label: '景気刺激策', apply: (g) => giveAllCash(g, 80) },
  { id: 'tax', label: '出費', apply: (g, p) => { const n = Math.min(p.cash, 120 + p.level * 25); p.cash -= n; return `-${n}G` } },
  { id: 'stock', label: '株プレゼント', apply: (g, p) => {
    const areas = Object.keys(g.areas).map(Number);
    const a = areas[Math.floor(Math.random() * areas.length)];
    p.stocks[a] = (p.stocks[a] || 0) + 5;
    return `A${a}株 +5`;
  }},
  { id: 'rollon', label: 'ラッキー再挑戦', apply: (g, p) => { p.flags.extraRoll = true; return 'もう一度サイコロ' } },
  { id: 'invest', label: '増資クーポン', apply: (g, p) => { p.flags.investCoupon = true; return '次の増資が半額' } },
  { id: 'lucky', label: '幸運のお守り', apply: (g, p) => { p.lucky = true; return 'ラッキーステータス' } },
  { id: 'mini_highlow', label: 'ハイ＆ロー', apply: (g, p) => {
    p.flags.pendingMinigame = { game: 'high_low', label: 'ハイ＆ロー' };
    return 'ミニゲーム！';
  }},
  { id: 'mini_slot', label: 'スリースロット', apply: (g, p) => {
    p.flags.pendingMinigame = { game: 'slot', label: 'スリースロット' };
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

export function createGame({ players, goal = DEFAULT_GOAL, seed = Date.now(), cash } = {}) {
  const board = buildBoard();
  const initialCash = cash ?? board.initialCash ?? DEFAULT_CASH;
  const rng = mulberry32(seed);

  let cpuOrd = 0;
  const plist = players.map((pl, i) => {
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
      color: pl.color || PLAYER_COLORS[i % PLAYER_COLORS.length],
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
    };
  });

  return {
    map: board.nodes,
    areas: board.areas,
    /** 全員共通のイベント表（1マスずつ誰かがめくる） */
    sharedEventTable: createEventTable((seed >>> 0) + 7771),
    cols: board.cols,
    rows: board.rows,
    startId: board.startId,
    goal,
    players: plist,
    currentPlayerIdx: 0,
    phase: 'await_roll', // await_roll | await_fork | await_choice | gameover
    pending: null,
    dice: null,
    move: null, // { stepsLeft, path, passedBank }
    logs: [{ text: 'ゲーム開始！分岐路を選んで目標資産を目指そう', kind: 'system' }],
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
  const owner = g.players[sq.owner];
  if (owner?.shopsClosed) return 0;
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
    move: g.move,
    logs: g.logs.slice(0, 30),
    winnerId: g.winnerId,
    turn: g.turn,
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
  return { ...data };
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
        label: dirLabel(from, to),
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
  return { ok: true, done: true, forked: false, path, state: serializeState(g) };
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
  addLog(g, `${p.name} は「${getNode(g, nextId)?.label || nextId}」方面へ`, 'dice');
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

  // 銀行にいるときは出発方向を自由に選べる
  if (p.pos === g.startId) p.prevPos = null;

  const d = Math.floor(rngNext(g) * 6) + 1;
  g.dice = d;
  g.phase = 'moving';
  g.move = { stepsLeft: d, path: [], passedBank: false, startPos: p.pos };
  // 出目数値は演出後に UI が表示。ログも演出中のネタバレを避けるため「？」で残し、UI が確定後に見せる
  addLog(g, `${p.name} がサイコロを振った`, 'dice');

  return { ok: true, dice: d, needsAdvance: true, state: serializeState(g) };
}

function resolveLanding(g, p, { passedBank }) {
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
    p.lucky = true;
    addLog(g, `${p.name} がラッキーステータス獲得！（次ターンまで買い物料の20%を銀行から）`, 'event');
    finishLanding(g, p);
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
  if (hasFullMarks(p)) {
    const bonus = getLevelBonus(g, p);
    p.cash += bonus;
    const old = p.level;
    p.level++;
    p.marks = [false, false, false, false];
    p.flags.pendingLevelUp = { from: old, to: p.level, bonus };
    addLog(g, `${p.name} 昇進！ Lv.${old}→${p.level} 賞金 +${bonus}G`, 'level');
  }

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

  // 料金は全額支払い（所持金はマイナスになり得る）。自動売却はしない
  payer.cash -= toll;
  owner.cash += toll;
  addLog(g, `${payer.name} → ${owner.name}「${sq.label}」買い物料 ${toll}G`, 'toll');

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

function offerFiveBuyOrEnd(g, payer, sq, toll) {
  if (payer.bankrupt || g.phase === 'gameover') {
    endTurn(g);
    return;
  }
  const five = sq.price * 5;
  const liq = getLiquidatableValue(g, payer);
  if (liq >= five) {
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
  p.cash += got;
  sq.owner = -1;
  sq.extraInvest = 0;
  sq.price = sq.basePrice;
  updateAreaStockPrices(g);
  addLog(g, `${p.name} が「${sq.label}」を売却（+${got}G）`, 'system');
  return { ok: true, got };
}

function sellStockForCash(g, p, area, count) {
  const a = Number(area);
  const have = p.stocks[a] || 0;
  const n = Math.max(1, Math.min(have, Number(count) || 1));
  if (n <= 0 || !g.areas[a]) return { ok: false, error: 'no_stock' };
  const got = g.areas[a].stockPrice * n;
  p.stocks[a] -= n;
  p.cash += got;
  if (n >= 10) g.areas[a].B = Math.max(100, Math.floor(g.areas[a].B * 0.93));
  updateAreaStockPrices(g);
  addLog(g, `${p.name} が A${a}株×${n} 売却（+${got}G）`, 'stock');
  return { ok: true, got };
}

function declareBankrupt(g, p) {
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
    g.phase = 'await_choice';
    g.pending = {
      type: 'invest',
      playerId: p.id,
      shopId: resume.shopId,
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
      const price = sq.price * 5;
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
            toll: pending.toll,
          },
        });
        return { ok: true, needFunds: true, state: serializeState(g) };
      }
      if (p.cash >= price) {
        const owner = g.players[sq.owner];
        p.cash -= price;
        if (owner) owner.cash += Math.floor(price * 0.6);
        sq.owner = p.id;
        sq.extraInvest = 0;
        sq.price = sq.basePrice;
        updateAreaStockPrices(g);
        addLog(g, `${p.name} が5倍買いで「${sq.label}」を奪取！`, 'shop');
        g.pending = null;
        endTurn(g);
        return { ok: true, fiveBuy: true, state: serializeState(g) };
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
      // 料金不足（after_toll）だけは負債解消を優先して続きへ
      const resume = pending.resume;
      g.pending = null;
      if (resume?.type === 'after_toll' && p.cash >= target) {
        resumeAfterRaiseFunds(g, p, resume);
        return { ok: true, state: serializeState(g) };
      }
      if (resume?.type === 'after_toll' && p.cash < target) {
        return { ok: false, error: 'still_short' };
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
          shopId: resume.shopId,
          remaining: resume.remaining,
          toll: resume.toll,
        };
        return applyChoice(g, { action: 'invest', amount: resume.amount });
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
      if (count >= 10) {
        g.areas[area].B = Math.max(100, Math.floor(g.areas[area].B * 0.93));
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
    const msg = result.messages?.join(' / ') || result.cell.label;
    addLog(g, `${p.name} スクラッチ → ${result.cell.label}（${msg}）`, 'event');
    g.pending = null;
    if (maybeOpenMinigame(g, p)) {
      return { ok: true, scratched: true, cell: result.cell, minigame: true, state: serializeState(g) };
    }
    if (p.flags.extraRoll) {
      p.flags.extraRoll = false;
      g.phase = 'await_roll';
      return { ok: true, scratched: true, cell: result.cell, state: serializeState(g) };
    }
    endTurn(g);
    return { ok: true, scratched: true, cell: result.cell, state: serializeState(g) };
  }

  if (pending.type === 'minigame') {
    return resolveMinigame(g, p, pending, choice);
  }

  return { ok: false, error: 'unknown_pending' };
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

  if (game === 'guess_dice') {
    const pick = Math.max(1, Math.min(6, Number(choice.value) || 1));
    const roll = Math.floor(rngNext(g) * 6) + 1;
    const diff = Math.abs(pick - roll);
    if (diff === 0) {
      win = true;
      const prize = 280 + p.level * 40;
      p.cash += prize;
      messages.push(`ぴったり！出目${roll} → +${prize}G`);
      payoutAll(g, 60, messages);
    } else if (diff === 1) {
      const prize = 100 + p.level * 15;
      p.cash += prize;
      messages.push(`おしい！出目${roll}（予想${pick}）→ +${prize}G`);
      payoutAll(g, 40, messages);
    } else {
      messages.push(`ハズレ…出目${roll}（予想${pick}）`);
      payoutAll(g, 25, messages);
    }
    detail = `出目 ${roll}`;
  } else if (game === 'high_low') {
    const pick = choice.value === 'high' ? 'high' : 'low';
    const secret = Math.floor(rngNext(g) * 10) + 1; // 1-10
    const isHigh = secret >= 6;
    const ok = (pick === 'high' && isHigh) || (pick === 'low' && !isHigh);
    if (ok) {
      win = true;
      const prize = 200 + p.level * 30;
      p.cash += prize;
      messages.push(`正解！数字は ${secret} → +${prize}G`);
      payoutAll(g, 70, messages);
    } else {
      messages.push(`残念…数字は ${secret}`);
      payoutAll(g, 35, messages);
    }
    detail = `数字 ${secret}`;
  } else if (game === 'coin') {
    const pick = choice.value === 'tails' ? 'tails' : 'heads';
    const face = rngNext(g) < 0.5 ? 'heads' : 'tails';
    const label = face === 'heads' ? 'おもて' : 'うら';
    if (pick === face) {
      win = true;
      const prize = 180 + p.level * 25;
      p.cash += prize;
      messages.push(`当たり！${label} → +${prize}G`);
      payoutAll(g, 55, messages);
    } else {
      messages.push(`ハズレ…${label}`);
      payoutAll(g, 30, messages);
    }
    detail = label;
  } else if (game === 'slot') {
    const syms = ['★', '♪', 'G', '♦', '♣'];
    const a = syms[Math.floor(rngNext(g) * syms.length)];
    const b = syms[Math.floor(rngNext(g) * syms.length)];
    const c = syms[Math.floor(rngNext(g) * syms.length)];
    const line = `${a}${b}${c}`;
    if (a === b && b === c) {
      win = true;
      const prize = 320 + p.level * 50;
      p.cash += prize;
      messages.push(`ジャックポット ${line}！ → +${prize}G`);
      payoutAll(g, 100, messages);
    } else if (a === b || b === c || a === c) {
      const prize = 120 + p.level * 20;
      p.cash += prize;
      messages.push(`二つ揃い ${line} → +${prize}G`);
      payoutAll(g, 50, messages);
    } else {
      messages.push(`バラバラ ${line}`);
      payoutAll(g, 30, messages);
    }
    detail = line;
  } else {
    payoutAll(g, 40, messages);
    messages.push('参加賞');
  }

  addLog(g, `${p.name} の「${pending.label}」→ ${messages.join(' / ')}`, 'event');
  g.pending = null;
  endTurn(g);
  return {
    ok: true,
    minigame: true,
    win,
    detail,
    messages,
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
  if (n >= 10) g.areas[a].B = Math.max(100, Math.floor(g.areas[a].B * 0.93));
  updateAreaStockPrices(g);
  addLog(g, `${p.name} が A${a}株×${n} 売却（+${got}G）`, 'stock');
  return { ok: true, state: serializeState(g) };
}

function endTurn(g) {
  if (g.phase === 'gameover') return;

  const p = currentPlayer(g);
  if (p) {
    p.lucky = false;
    p.flags.bankVisitDone = false;
    p.flags.bankPassStock = false;
  }

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
      s += traits.enemyToll * Math.min(3, toll / 120);
    }
  } else if (node.type === 'bank') s += traits.bank;
  else if (node.type === 'mark') s += traits.mark;
  else if (node.type === 'stockbroker') s += traits.stockbroker;
  else if (node.type === 'scratch' || node.type === 'event') s += traits.scratch;
  else if (node.type === 'minigame') s += traits.minigame;
  return s;
}

function scoreForkPath(g, p, fromId, nextId, traits) {
  let score = 0;
  let cur = nextId;
  let prev = fromId;
  for (let depth = 0; depth < 4; depth++) {
    const node = getNode(g, cur);
    score += scoreNodeForCpu(g, p, node, traits) * (1 - depth * 0.14);
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
  score += Math.random() * 0.4;
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
  if (!sq || getLiquidatableValue(g, p) < sq.price) return false;
  const assets = getPlayerAssets(g, p);
  if (assets.total >= g.goal * 0.97) return false;
  const areaCnt = getPlayerAreaCount(g, p.id, sq.area);
  const vacantLeft = getAreaShops(g, sq.area).filter((x) => x.owner < 0).length;
  let desire = traits.shopBuy + areaCnt * 0.38 * Math.min(1.4, traits.ownArea / 2);
  if (areaCnt >= 1 && vacantLeft <= 2) desire += 0.45;
  if (sq.price > p.cash && traits.shopBuy < 1) desire -= 0.25;
  if (desire >= 1.15) return true;
  if (desire < 0.55) return false;
  return Math.random() < Math.min(0.92, desire * 0.62);
}

function cpuShouldFiveBuy(g, p, pend, traits) {
  if (getLiquidatableValue(g, p) < pend.price) return false;
  const sq = getNode(g, pend.shopId);
  const areaCnt = sq ? getPlayerAreaCount(g, p.id, sq.area) : 0;
  let chance = traits.fiveBuy + areaCnt * 0.12;
  if (areaCnt >= 2) chance += 0.15;
  return Math.random() < Math.min(0.95, chance);
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

function cpuRaiseFunds(g, p, target, traits) {
  while (p.cash < target) {
    const held = Object.keys(p.stocks || {}).map(Number).filter((a) => (p.stocks[a] || 0) > 0);
    if (held.length) {
      // 戦略的に薄いエリア／安値株から売る（株マニアはできるだけ温存）
      held.sort((a, b) => {
        const ownA = getPlayerAreaCount(g, p.id, a);
        const ownB = getPlayerAreaCount(g, p.id, b);
        const priceA = g.areas[a]?.stockPrice || 1;
        const priceB = g.areas[b]?.stockPrice || 1;
        if (traits.stockBudget > 0.7) return ownA - ownB || priceA - priceB;
        return priceA - priceB || ownA - ownB;
      });
      const a = held[0];
      const need = target - p.cash;
      const price = g.areas[a].stockPrice || 1;
      const count = Math.min(p.stocks[a], Math.max(1, Math.ceil(need / price)));
      sellStockForCash(g, p, a, count);
      continue;
    }
    const shops = g.map.filter((s) => s.type === 'shop' && s.owner === p.id);
    if (!shops.length) break;
    shops.sort((a, b) => {
      const ca = getPlayerAreaCount(g, p.id, a.area);
      const cb = getPlayerAreaCount(g, p.id, b.area);
      // 独占屋はエリア核を残す
      if (traits.ownArea > 2) return ca - cb || a.price - b.price;
      return a.price - b.price || ca - cb;
    });
    sellShopForCash(g, p, shops[0].id);
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
      const rem = pend.remaining || 0;
      const liq = getLiquidatableValue(g, p);
      const amount = Math.min(rem, Math.floor(Math.max(0, liq) * traits.investRate));
      if (amount >= 20) return applyChoice(g, { action: 'invest', amount });
      return applyChoice(g, { action: 'skip' });
    }
    if (pend.type === 'five_buy') {
      const buy = cpuShouldFiveBuy(g, p, pend, traits);
      return applyChoice(g, { action: buy ? 'buy' : 'skip' });
    }
    if (pend.type === 'raise_funds') {
      const target = Number(pend.targetCash) || 0;
      cpuRaiseFunds(g, p, target, traits);
      if (p.cash >= target) {
        const exec = pend.resume && ['five_buy', 'buy_shop', 'invest'].includes(pend.resume.type);
        return applyChoice(g, { action: 'continue', execute: !!exec });
      }
      return applyChoice(g, { action: 'bankrupt' });
    }
    if (pend.type === 'stock') {
      const bankVisit = !!pend.bankVisit || !!pend.bankPass;
      const minCash = traits.stockBudget > 0.7 ? 120 : 200;
      if (p.cash > minCash) {
        const a = cpuPickStockArea(g, p, traits);
        const price = g.areas[a]?.stockPrice || 1;
        const ratio = bankVisit
          ? Math.min(1, traits.stockBudget + 0.15)
          : Math.max(0.12, traits.stockBudget * 0.35);
        const budget = Math.floor(p.cash * ratio);
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
      if (pend.game === 'high_low') {
        return applyChoice(g, { action: 'pick', value: Math.random() < 0.5 ? 'low' : 'high' });
      }
      if (pend.game === 'coin') {
        return applyChoice(g, { action: 'pick', value: Math.random() < 0.5 ? 'heads' : 'tails' });
      }
      return applyChoice(g, { action: 'spin' });
    }
  }
  return null;
}
