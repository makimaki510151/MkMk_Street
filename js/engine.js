/** MkMk Street — ゲームエンジン（純ロジック / ホスト権威） */

import { buildBoard, SUIT_LABELS, DEFAULT_GOAL, DEFAULT_CASH, dirLabel } from './board.js';
import { createEventTable, scratchCell, unscratchedIds } from './eventTable.js';

export const PLAYER_COLORS = ['#e85d75', '#3d8bfd', '#f0a202', '#20c997'];
export const PLAYER_NAMES_DEFAULT = ['あか', 'あお', 'きいろ', 'みどり'];

const TOLL_MULTI = [1, 1, 1.25, 2.5, 5, 6, 6.75];
const MAX_INVEST_RATE = [0, 0.5, 1, 3, 9, 11, 13];

const CHANCE_EVENTS = [
  { id: 'bonus', label: '臨時ボーナス', apply: (g, p) => { const n = 200 + p.level * 50; p.cash += n; return `+${n}G` } },
  { id: 'salary', label: '給料日っぽい日', apply: (g, p) => { const n = Math.floor(getLevelBonus(g, p) * 0.5); p.cash += n; return `賞金の半分 +${n}G` } },
  { id: 'tax', label: '税金', apply: (g, p) => { const n = Math.min(p.cash, 150 + p.level * 30); p.cash -= n; return `-${n}G` } },
  { id: 'warp_bank', label: '銀行へワープ', apply: (g, p) => { p.pos = g.startId; p.prevPos = null; return '銀行へ移動' } },
  { id: 'stock_gift', label: '株のおすそ分け', apply: (g, p) => {
    const areas = Object.keys(g.areas).map(Number);
    const a = areas[Math.floor(Math.random() * areas.length)];
    p.stocks[a] = (p.stocks[a] || 0) + 10;
    return `A${a}株 +10`
  }},
  { id: 'invest_boost', label: '増資クーポン', apply: (g, p) => { p.flags.investCoupon = true; return '次の自分店増資が半額' } },
];

const BOARD_EVENTS = [
  { id: 'cash', label: '臨時収入', apply: (g, p) => { const n = 180 + p.level * 40; p.cash += n; return `+${n}G` } },
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
    prevPos: null,
    marks: [false, false, false, false],
    level: 1,
    stocks: {},
    lucky: false,
    resting: false,
    shopsClosed: false,
    eventTable: createEventTable((seed >>> 0) + i * 9973 + 17),
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
  }));
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
  if (nd.type === 'bank' && nodeId !== g.move?.startPos) {
    handleBank(g, p, false);
  }
}

function setForkPending(g, p, options) {
  g.phase = 'await_fork';
  g.pending = {
    type: 'fork',
    playerId: p.id,
    options: options.map((id) => {
      const to = getNode(g, id);
      return {
        id,
        label: dirLabel(getNode(g, p.pos), to),
        dest: to?.label || `#${id}`,
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
  while (g.move && g.phase !== 'await_fork' && g.phase !== 'gameover') {
    last = advanceMove(g);
    if (!last.ok || last.done || last.forked) break;
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

  // 銀行通過・到着での昇進 / 勝利判定
  if (passedBank || landedOnBank) {
    handleBank(g, p, landedOnBank);
    if (g.phase === 'gameover') return;
    // 通過時はあとで株を1種類買える
    if (passedBank && !landedOnBank) p.flags.bankPassStock = true;
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

  if (sq.type === 'event') {
    const ev = BOARD_EVENTS[Math.floor(rngNext(g) * BOARD_EVENTS.length)];
    const detail = ev.apply(g, p);
    addLog(g, `イベント！ ${ev.label}（${detail}）`, 'event');
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
    if (ev.id === 'warp_bank') handleBank(g, p, true);
    if (g.phase === 'gameover') return;
    finishLanding(g, p);
    return;
  }

  if (sq.type === 'stockbroker' || (sq.type === 'bank' && !passedBank)) {
    g.phase = 'await_choice';
    g.pending = { type: 'stock', playerId: p.id };
    return;
  }

  if (sq.type === 'bank') {
    // 到着：昇進祝いがあれば先に、その後株取引
    if (p.flags.pendingLevelUp) {
      openLevelUp(g, p, { thenStock: true, atBank: true });
      return;
    }
    g.phase = 'await_choice';
    g.pending = { type: 'stock', playerId: p.id, atBank: true };
    return;
  }

  if (sq.type === 'shop') {
    resolveShop(g, p, sq);
    return;
  }

  finishLanding(g, p);
}

/** 着地後の共通締め：昇進祝い → 銀行通過の株1種 → ターン終了 */
function finishLanding(g, p) {
  if (g.phase === 'gameover') return;
  if (p.flags.pendingLevelUp) {
    openLevelUp(g, p, { thenBankPassStock: !!p.flags.bankPassStock });
    return;
  }
  if (p.flags.bankPassStock) {
    openBankPassStock(g, p);
    return;
  }
  endTurn(g);
}

function openLevelUp(g, p, next = {}) {
  const info = p.flags.pendingLevelUp;
  if (!info) {
    if (next.thenStock) {
      g.phase = 'await_choice';
      g.pending = { type: 'stock', playerId: p.id, atBank: !!next.atBank };
      return;
    }
    if (next.thenBankPassStock || p.flags.bankPassStock) {
      openBankPassStock(g, p);
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
    thenStock: !!next.thenStock,
    atBank: !!next.atBank,
    thenBankPassStock: !!next.thenBankPassStock || !!p.flags.bankPassStock,
  };
}

function openBankPassStock(g, p) {
  p.flags.bankPassStock = false;
  g.phase = 'await_choice';
  g.pending = {
    type: 'stock',
    playerId: p.id,
    bankPass: true,
    maxBuys: 1,
    buysUsed: 0,
  };
  addLog(g, `${p.name} は銀行通過で株を1種類だけ買えます`, 'stock');
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
  if (!p.eventTable) {
    p.eventTable = createEventTable((g._seed >>> 0) + p.id * 9973 + g.turn);
  }
  const open = unscratchedIds(p.eventTable);
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

  if (pending.type === 'level_up') {
    // 祝い確認後の続き
    const thenStock = pending.thenStock;
    const atBank = pending.atBank;
    const thenBankPass = pending.thenBankPassStock;
    g.pending = null;
    p.flags.pendingLevelUp = null;
    if (thenStock) {
      g.phase = 'await_choice';
      g.pending = { type: 'stock', playerId: p.id, atBank: !!atBank };
      return { ok: true, celebrated: true, state: serializeState(g) };
    }
    if (thenBankPass) {
      openBankPassStock(g, p);
      return { ok: true, celebrated: true, state: serializeState(g) };
    }
    endTurn(g);
    return { ok: true, celebrated: true, state: serializeState(g) };
  }

  if (pending.type === 'stock') {
    const maxBuys = pending.maxBuys;
    if (choice.action === 'buy') {
      if (maxBuys != null && (pending.buysUsed || 0) >= maxBuys) {
        return { ok: false, error: 'buy_limit' };
      }
      const area = Number(choice.area);
      // 銀行通過は「1種類」＝1エリアをまとめて買う
      const count = pending.bankPass
        ? Math.max(1, Math.min(99, Number(choice.count) || 1))
        : Math.max(1, Math.min(99, Number(choice.count) || 1));
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
      if (maxBuys != null) {
        pending.buysUsed = (pending.buysUsed || 0) + 1;
        if (pending.buysUsed >= maxBuys) {
          g.pending = null;
          endTurn(g);
          return { ok: true, state: serializeState(g) };
        }
      }
    } else if (choice.action === 'sell') {
      if (pending.bankPass) return { ok: false, error: 'pass_buy_only' };
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
      endTurn(g);
    }
    return { ok: true, state: serializeState(g) };
  }

  if (pending.type === 'scratch') {
    const cellId = Number(choice.cellId);
    const open = pending.openIds || unscratchedIds(p.eventTable);
    if (!open.includes(cellId)) return { ok: false, error: 'bad_cell' };
    const result = scratchCell(g, p, cellId);
    if (!result.ok) return { ok: false, error: result.error };
    const msg = result.messages?.join(' / ') || result.cell.label;
    addLog(g, `${p.name} スクラッチ → ${result.cell.label}（${msg}）`, 'event');
    g.pending = null;
    if (p.flags.extraRoll) {
      p.flags.extraRoll = false;
      g.phase = 'await_roll';
      return { ok: true, scratched: true, cell: result.cell, state: serializeState(g) };
    }
    endTurn(g);
    return { ok: true, scratched: true, cell: result.cell, state: serializeState(g) };
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
  if (p?.flags?.pendingLevelUp) {
    openLevelUp(g, p, { thenBankPassStock: !!p.flags.bankPassStock });
    return;
  }
  if (p?.flags?.bankPassStock) {
    openBankPassStock(g, p);
    return;
  }

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

function cpuPickFork(g, options) {
  // 自分の店が多い方面を優先、なければランダム
  let best = options[0];
  let bestScore = -1;
  for (const opt of options) {
    const to = getNode(g, opt.id);
    let score = Math.random();
    if (to?.type === 'shop' && to.owner < 0) score += 2;
    if (to?.type === 'shop' && to.owner === g.currentPlayerIdx) score += 1.5;
    if (to?.type === 'mark') score += 1.2;
    if (to?.type === 'bank') score += 0.8;
    if (score > bestScore) {
      bestScore = score;
      best = opt;
    }
  }
  return best.id;
}

/** CPUの簡易行動（1アクション分。移動の連続はUI側） */
export function cpuAct(g) {
  const p = currentPlayer(g);
  if (!p?.isCPU || p.bankrupt || g.phase === 'gameover') return null;

  if (g.phase === 'await_roll') {
    return rollDice(g);
  }

  if (g.phase === 'moving' && g.move) {
    return advanceMove(g);
  }

  if (g.phase === 'await_fork' && g.pending?.type === 'fork') {
    const nextId = cpuPickFork(g, g.pending.options);
    return chooseFork(g, nextId);
  }

  if (g.phase === 'await_choice' && g.pending) {
    const pend = g.pending;
    if (pend.type === 'level_up') {
      return applyChoice(g, { action: 'celebrate' });
    }
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
      const ownedAreas = [...new Set(g.map.filter((s) => s.type === 'shop' && s.owner === p.id).map((s) => s.area))];
      const areas = ownedAreas.length ? ownedAreas : Object.keys(g.areas).map(Number);
      if (areas.length && p.cash > 200) {
        const a = areas[0];
        const price = g.areas[a].stockPrice;
        const budget = pend.bankPass ? p.cash * 0.35 : p.cash * 0.25;
        const count = Math.min(pend.bankPass ? 30 : 20, Math.floor(budget / price));
        if (count > 0) {
          const bought = applyChoice(g, { action: 'buy', area: a, count });
          if (pend.bankPass || bought?.state?.pending == null) return bought;
        }
      }
      return applyChoice(g, { action: 'done' });
    }
    if (pend.type === 'scratch') {
      const open = pend.openIds || unscratchedIds(p.eventTable);
      if (!open.length) {
        g.pending = null;
        endTurn(g);
        return { ok: true, state: serializeState(g) };
      }
      const cellId = open[Math.floor(Math.random() * open.length)];
      return applyChoice(g, { action: 'scratch', cellId });
    }
  }
  return null;
}
