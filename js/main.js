/** MkMk Street — UI / エントリ */

import {
  createGame,
  serializeState,
  restoreState,
  rollDice,
  getMoveDiceMax,
  advanceMove,
  applyChoice,
  chooseFork,
  findForkNextForLanding,
  preTurnSell,
  canSellStockOnTurn,
  canOpenShopTrade,
  openShopTradeCompose,
  sumShopPrices,
  defaultShopTradeCashDelta,
  cpuAct,
  currentPlayer,
  getPlayerAssets,
  buildGameResults,
  formatGameResultsExport,
  gameResultsExportToText,
  gameResultsExportToCsv,
  gameResultsExportFilename,
  parseGameResultsExport,
  resultsFromExportPayload,
  createEmptyStats,
  ensureStats,
  recordNudgeStats,
  updateAreaStockPrices,
  previewStockSell,
  previewStockBuy,
  STOCK_SELL_PRESSURE_MIN,
  getLiquidatableValue,
  calcToll,
  getRemainingInvest,
  getNode,
  getSharedEventTable,
  PLAYER_COLORS,
  PLAYER_COLOR_LABELS,
  normalizePlayerColor,
  normalizeLobbyColors,
  getCpuPersonality,
  hasAreaMonopoly,
  getTollMulti,
  getAreaShops,
  getPlayerAreaCount,
  getAreaMonopolyRate,
  getMaxExtraInvest,
  investMultiByMonopolyRate,
  payAreaStockDividend,
  convertPlayerToCpu,
  kickDisconnectedPlayer,
  getGoalPressurePlayers,
  POTION_CARD_COUNT,
  POTION_EFFECT_LABELS,
  takeEventNpcFx,
  removeEventNpc,
  immediateTransitDest,
} from './engine.js';
import {
  AREA_META,
  SUIT_LABELS,
  MAP_CATALOG,
  DEFAULT_MAP_ID,
  DEFAULT_CASH,
  applySwitchState,
  buildBoard,
  getAreaCode,
} from './board.js';
import { resolveWaitingSeatId } from './nudgeTarget.js';
import {
  pendingFingerprint,
  modalContentKey,
  snapshotEditableFields,
  restoreEditableFields,
} from './formDrafts.js';
import {
  GROUP_COLORS,
  TABLE_SIZE,
  COLOR_LABELS,
  MATCH_BONUS_PER,
  playerColorIndex,
} from './eventTable.js';
import { createNet } from './net.js';
import { createRenderer, shopTooltip } from './render.js';
import { createAudio } from './audio.js';
import { APP_VERSION } from './version.js';
import { PATCH_NOTES } from './patchNotes.js';
import {
  syncScratchDexWithCatalog,
  markScratchEventSeen,
  getScratchDexEntries,
  getScratchDexStats,
} from './scratchDex.js';
import {
  evaluateOrderRolls,
  rollOrderDie,
  reclaimOrderRollPlayer,
  markOrderRollPlayerLeft,
} from './orderRoll.js';
import { isLocalPlayer, isMyTurnSeat } from './turnOwner.js';
import {
  clampModalDrag,
  floatingModalMaxHeightPx,
  MODAL_DRAG_MARGINS,
} from './modalLayout.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const audio = createAudio();

const app = {
  mode: null,
  net: null,
  game: null,
  localSeat: 0,
  localName: '',
  lobbyPlayers: [],
  /** ロビーで選択中のマップ（ゲスト同期用） */
  lobbyMapId: DEFAULT_MAP_ID,
  /** 自分が選んだロビー色 */
  lobbyColor: PLAYER_COLORS[0],
  /** 開始前の順番決めダイス状態 */
  orderRoll: null,
  renderer: null,
  cpuTimer: null,
  busy: false,
  /** 出目演出中は UI / ログで結果を隠す */
  hideDiceResult: false,
  lastSeenLogKey: null,
  lastTurnKey: null,
  modalMode: 'shown', // shown | hidden
  modalActive: false,
  /** @type {{x:number,y:number}|null} */
  modalDrag: null,
  feedPinnedBottom: true,
  /** false になると出来事フィードを自動で開かない（ユーザーが一度隠したあと） */
  feedAutoExpand: true,
  inspectedId: null,
  restSkipTimer: null,
  eventFlashTimer: null,
  eventFlashSeq: 0,
  /** @type {object[]} 中央イベント表示の待ち行列 */
  eventFlashQueue: [],
  eventFlashOpen: false,
  /** このフラッシュ表示のために busy を立てたとき true */
  eventFlashHoldingBusy: false,
  /** いまの行動を起こした手番プレイヤー（endTurn後もイベント確認の主体） */
  actionActorId: null,
  /** 表示中イベントの確認担当プレイヤー */
  eventFlashReaderId: null,
  eventFlashNpcTimer: null,
  /** ゲストがホスト応答待ちのとき */
  eventFlashDismissWait: null,
  /** 移動アニメ中はイベントUIを出さず、着地後にまとめて表示 */
  deferEventFlash: false,
  /** @type {Record<number, number>|null} */
  prevCash: null,
  moneyFxTimer: null,
  /** 目標到達の焦りバナーを一度出したか */
  goalPressureBannerShown: false,
  moneyFxSeq: 0,
  /** @type {object[]|null} オーバーレイ競合時の待機キュー */
  pendingMoneyFx: null,
  /** @type {Record<number, ReturnType<typeof setTimeout>>} */
  disconnectTimers: {},
  /** 切断後に自動でCPU化するまでの猶予（ms） */
  disconnectGraceMs: 20000,
  /** 催促ボタンのクールダウン終了時刻 */
  nudgeCooldownUntil: 0,
  /** ホスト側: 座席ごとの最終催促時刻 */
  nudgeLastBySeat: {},
  nudgeUiTimer: null,
  /** @type {ReturnType<typeof formatGameResultsExport>|null} */
  lastResultsExport: null,
  /** @type {ReturnType<typeof formatGameResultsExport>|null} */
  archivePayload: null,
  /** 選択モーダル再描画抑制用（数値入力中の巻き戻り防止） */
  modalPendingKey: null,
  /** 分岐選択の演出中（二重クリックで購入見送りになるのを防ぐ） */
  forkResolving: false,
  /** 選択アクション処理中（物件逆交渉などの連打で役割が入れ替わるのを防ぐ） */
  choiceResolving: false,
  /** 株パネル／プレイヤーカードでピン留めしたエリア（クリックで盤面ハイライト） */
  stockPeekArea: null,
  /** プレイヤーカードのステータス説明ピン（{ pid, key }） */
  statusPeek: null,
  /** スマホ詳細シート（手番/所持/記録）が開いているか */
  sideSheetOpen: false,
};

const LAST_RESULTS_KEY = 'mkmk-street-last-results';

function loadLastResultsExport() {
  try {
    const raw = localStorage.getItem(LAST_RESULTS_KEY);
    if (!raw) return null;
    const parsed = parseGameResultsExport(raw);
    return parsed.ok ? parsed.payload : null;
  } catch {
    return null;
  }
}

function saveLastResultsExport(payload) {
  if (!payload) return;
  try {
    localStorage.setItem(LAST_RESULTS_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
  app.lastResultsExport = payload;
}

const NUDGE_COOLDOWN_MS = 12000;

const BANNER_KINDS = new Set(['event', 'mark', 'toll', 'level', 'shop', 'win', 'system', 'stock', 'dice']);

/** イベント種別ごとの視覚アイコン／チップ */
const EVENT_VISUALS = {
  toll: { glyph: 'G', chips: ['買い物料'] },
  shop: { glyph: '店', chips: ['お店'] },
  level: { glyph: '昇', chips: ['昇進'] },
  mark: { glyph: '◆', chips: ['マーク'] },
  event: { glyph: '!', chips: ['イベント'] },
  stock: { glyph: '株', chips: ['株式'] },
  win: { glyph: '★', chips: ['勝利'] },
  system: { glyph: '・', chips: ['状況'] },
  dice: { glyph: '出', chips: ['サイコロ'] },
  info: { glyph: 'i', chips: [] },
};

const PLAYER_NAME_KEY = 'mkmk_player_name';
const LOCAL_SEAT_NAMES_KEY = 'mkmk_local_seat_names';
const DEFAULT_SEAT_NAMES = ['あか', 'あお', 'きいろ', 'みどり'];

function loadSavedPlayerName() {
  try {
    const n = String(localStorage.getItem(PLAYER_NAME_KEY) || '').trim();
    if (n) return n.slice(0, 12);
  } catch (_) { /* ignore */ }
  return '';
}

function savePlayerName(name) {
  const n = String(name || '').trim().slice(0, 12);
  if (!n) return;
  app.localName = n;
  try {
    localStorage.setItem(PLAYER_NAME_KEY, n);
  } catch (_) { /* ignore */ }
}

function loadLocalSeatNames() {
  try {
    const raw = localStorage.getItem(LOCAL_SEAT_NAMES_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return arr.map((n, i) => String(n || '').trim().slice(0, 10) || DEFAULT_SEAT_NAMES[i] || `P${i + 1}`);
  } catch (_) { /* ignore */ }
  return null;
}

function saveLocalSeatNames(names) {
  if (!Array.isArray(names) || !names.length) return;
  try {
    localStorage.setItem(
      LOCAL_SEAT_NAMES_KEY,
      JSON.stringify(names.slice(0, 4).map((n, i) => String(n || '').trim().slice(0, 10) || DEFAULT_SEAT_NAMES[i])),
    );
  } catch (_) { /* ignore */ }
}

function saveRejoinSession() {
  if (app.mode === 'local' || !app.net?.roomCode) return;
  try {
    sessionStorage.setItem('mkmk_rejoin', JSON.stringify({
      room: app.net.roomCode,
      name: app.localName,
      seat: app.localSeat,
    }));
  } catch (_) { /* ignore */ }
}

function readRejoinSession(roomCode) {
  try {
    const raw = sessionStorage.getItem('mkmk_rejoin');
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!roomCode) return j;
    if (j?.room === roomCode) return j;
  } catch (_) { /* ignore */ }
  return null;
}

function findRejoinSeat(g, name, rejoinSeat) {
  const nm = String(name || '').trim();
  if (!nm) return -1;
  const canReclaim = (p) => p && !p.bankrupt && p.name === nm && (
    (!p.isCPU && (p.offline || !p.peerId))
    || (p.isCPU && p.flags?.reclaimableHuman)
  );
  if (typeof rejoinSeat === 'number' && rejoinSeat >= 0 && rejoinSeat < g.players.length) {
    if (canReclaim(g.players[rejoinSeat])) return rejoinSeat;
  }
  const offlineHuman = g.players.findIndex((p) => !p.isCPU && !p.bankrupt && p.name === nm && (p.offline || !p.peerId));
  if (offlineHuman >= 0) return offlineHuman;
  return g.players.findIndex((p) => p.isCPU && p.flags?.reclaimableHuman && !p.bankrupt && p.name === nm);
}

/** ロビー再接続：同名・旧 peer の席を回収し、色は未使用パレットへ適応 */
function reclaimOrPushLobbyPlayer(from, data) {
  const peerId = data.peerId || from;
  const name = String(data.name || '').trim() || `P${app.lobbyPlayers.length + 1}`;
  const byPeer = app.lobbyPlayers.findIndex((p) => p.peerId === peerId);
  const byName = app.lobbyPlayers.findIndex((p) => (
    !p.isCPU && !p.isHost && p.name === name && p.peerId !== peerId
  ));
  const idx = byPeer >= 0 ? byPeer : byName;
  if (idx >= 0) {
    const others = app.lobbyPlayers.filter((_, i) => i !== idx).map((p) => p.color);
    const prev = app.lobbyPlayers[idx];
    const color = normalizePlayerColor(data.color || prev.color, idx, others);
    app.lobbyPlayers[idx] = { ...prev, peerId, name, color, isCPU: false };
    return { reclaimed: true, index: idx };
  }
  if (app.lobbyPlayers.length >= 4) return { full: true };
  const used = app.lobbyPlayers.map((p) => p.color);
  const i = app.lobbyPlayers.length;
  app.lobbyPlayers.push({
    peerId,
    name,
    color: normalizePlayerColor(data.color, i, used),
  });
  return { reclaimed: false, index: i };
}

function resyncLobbyColors() {
  app.lobbyPlayers = normalizeLobbyColors(app.lobbyPlayers);
}

function usedLobbyColors(exceptKey = null) {
  return app.lobbyPlayers
    .filter((p) => (exceptKey == null ? true : lobbyPlayerKey(p) !== exceptKey))
    .map((p) => p.color)
    .filter(Boolean);
}

function lobbyPlayerKey(p) {
  return p?.peerId || p?.key || p?.name || '';
}

function myLobbyKey() {
  if (app.mode === 'host') {
    return app.lobbyPlayers.find((p) => p.isHost)?.peerId || app.net?.peerId || 'host';
  }
  return app.net?.peerId || 'guest';
}

/**
 * 色ピッカーを描画。taken は選択不可（自分の現在色は除く）。
 * @param {HTMLElement|null} box
 * @param {string} selected
 * @param {{ taken?: string[], onPick?: (color: string) => void, disabled?: boolean }} [opts]
 */
function renderColorPicker(box, selected, opts = {}) {
  if (!box) return;
  const taken = new Set((opts.taken || []).map((c) => String(c).toLowerCase()));
  const sel = String(selected || PLAYER_COLORS[0]).toLowerCase();
  box.innerHTML = PLAYER_COLORS.map((color, i) => {
    const isSel = color.toLowerCase() === sel;
    const blocked = !isSel && taken.has(color.toLowerCase());
    const label = PLAYER_COLOR_LABELS[i] || color;
    return `<button type="button" class="color-swatch-btn${isSel ? ' selected' : ''}"
      data-color="${color}" title="${escapeHtml(label)}"
      aria-label="${escapeHtml(label)}"
      style="--swatch:${color}"
      ${blocked || opts.disabled ? 'disabled' : ''}></button>`;
  }).join('');
  if (opts.disabled) return;
  box.querySelectorAll('.color-swatch-btn').forEach((btn) => {
    btn.onclick = () => {
      if (btn.disabled) return;
      const color = btn.dataset.color;
      opts.onPick?.(color);
    };
  });
}

function currentLobbyMapId() {
  return selectedMapId('#lobby-map-options') || app.lobbyMapId || DEFAULT_MAP_ID;
}

function broadcastLobbySync(extra = {}) {
  if (app.mode !== 'host' || !app.net) return;
  const mapId = extra.mapId || currentLobbyMapId();
  app.lobbyMapId = mapId;
  app.net.broadcast({
    type: 'lobby_sync',
    players: app.lobbyPlayers,
    mapId,
    ...extra,
  });
}

function applyLobbyMapPreview(mapId) {
  const id = mapId || DEFAULT_MAP_ID;
  app.lobbyMapId = id;
  updateMapPreview(id, {
    canvasId: 'lobby-map-preview',
    nameId: 'lobby-map-preview-name',
  });
  const guestName = $('#lobby-guest-map-name');
  if (guestName) guestName.textContent = getMapDefName(id);
  updateMapPreview(id, {
    canvasId: 'lobby-guest-map-preview',
    nameId: 'lobby-guest-map-name',
  });
}

function applyLocalLobbyColor(color) {
  const next = normalizePlayerColor(color, 0, []);
  app.lobbyColor = next;
  const myKey = myLobbyKey();
  const idx = app.lobbyPlayers.findIndex((p) => lobbyPlayerKey(p) === myKey || (app.mode === 'host' && p.isHost));
  if (idx >= 0) {
    const others = usedLobbyColors(lobbyPlayerKey(app.lobbyPlayers[idx]));
    app.lobbyPlayers[idx].color = normalizePlayerColor(next, idx, others);
    resyncLobbyColors();
    renderLobbyPlayers();
    refreshLobbyColorPicker();
    if (app.mode === 'host' && app.net) {
      broadcastLobbySync();
    } else if (app.mode === 'guest' && app.net) {
      app.net.sendToHost({ type: 'lobby_color', color: next, peerId: app.net.peerId });
    }
  } else {
    refreshLobbyColorPicker();
  }
}

function refreshLobbyColorPicker() {
  const box = $('#lobby-color-picker');
  if (!box) return;
  const myKey = app.lobbyPlayers.length ? myLobbyKey() : null;
  const taken = myKey ? usedLobbyColors(myKey) : [];
  // 未接続時は自分の希望色だけ
  const selected = (() => {
    if (!app.lobbyPlayers.length) return app.lobbyColor;
    const me = app.lobbyPlayers.find((p) => lobbyPlayerKey(p) === myKey || (app.mode === 'host' && p.isHost));
    return me?.color || app.lobbyColor;
  })();
  renderColorPicker(box, selected, {
    taken,
    onPick: (color) => applyLocalLobbyColor(color),
  });
}

function setHostPlayerColor(peerId, color) {
  if (app.mode !== 'host') return;
  const idx = app.lobbyPlayers.findIndex((p) => p.peerId === peerId);
  if (idx < 0) return;
  const others = usedLobbyColors(peerId);
  app.lobbyPlayers[idx].color = normalizePlayerColor(color, idx, others);
  resyncLobbyColors();
  renderLobbyPlayers();
  refreshLobbyColorPicker();
  broadcastLobbySync();
}

function clearDisconnectTimer(seat) {
  const t = app.disconnectTimers[seat];
  if (t) clearTimeout(t);
  delete app.disconnectTimers[seat];
}

function clearAllDisconnectTimers() {
  for (const seat of Object.keys(app.disconnectTimers)) clearDisconnectTimer(Number(seat));
}

function handlePlayerDisconnect(seat, { reason = '切断' } = {}) {
  if (!app.game || app.mode !== 'host') return;
  const p = app.game.players[seat];
  if (!p || p.bankrupt || p.isCPU) return;
  p.offline = true;
  p.peerId = null;
  if (!p.flags) p.flags = {};
  p.flags.disconnectedAt = Date.now();
  app.game.logs.unshift({
    text: `${p.name} が${reason}（再接続／CPU化／キックを選べます）`,
    kind: 'system',
    t: Date.now(),
  });
  if (app.game.logs.length > 80) app.game.logs.length = 80;
  clearDisconnectTimer(seat);
  app.disconnectTimers[seat] = setTimeout(() => {
    if (!app.game) return;
    const pl = app.game.players[seat];
    if (!pl || pl.bankrupt || !pl.offline || pl.isCPU) return;
    applyConvertToCpu(seat, { auto: true });
  }, app.disconnectGraceMs);
  syncState();
  refreshGameUI();
  toast(`${p.name} が切断 — ${Math.round(app.disconnectGraceMs / 1000)}秒後に自動でCPU化`);
}

function applyConvertToCpu(seat, { auto = false } = {}) {
  if (!app.game || app.mode !== 'host') return;
  clearDisconnectTimer(seat);
  const result = convertPlayerToCpu(app.game, seat);
  if (!result.ok) return;
  if (result.state) commitGameState(result.state);
  if (auto) {
    app.game.logs.unshift({
      text: `${app.game.players[seat].name} を自動でCPU化`,
      kind: 'system',
      t: Date.now(),
    });
  }
  // 確認担当がCPUになったらNPC進行に切り替える
  if (app.eventFlashOpen && app.eventFlashReaderId === seat) {
    scheduleNpcEventFlashIfNeeded();
  }
  syncState();
  refreshGameUI();
  flushPendingEventNpcFx().finally(() => {
    if (clearBusyUnlessEventUi()) scheduleCpu();
  });
  toast(`${app.game.players[seat].name} をCPUに切り替えました`);
}

function applyKickPlayer(seat) {
  if (!app.game || app.mode !== 'host') return;
  clearDisconnectTimer(seat);
  const name = app.game.players[seat]?.name || 'プレイヤー';
  if (app.eventFlashOpen && app.eventFlashReaderId === seat) {
    dismissEventFlash({ force: true });
  }
  const result = kickDisconnectedPlayer(app.game, seat);
  if (!result.ok) return;
  if (result.state) commitGameState(result.state);
  syncState();
  refreshGameUI();
  flushPendingEventNpcFx().finally(() => {
    if (clearBusyUnlessEventUi()) scheduleCpu();
  });
  toast(`${name} をキックしました`);
}

function showScreen(id) {
  $$('.screen').forEach((el) => el.classList.toggle('active', el.id === id));
}

function setStatus(msg, kind = 'info') {
  const el = $('#net-status');
  if (!el) return;
  el.textContent = msg;
  el.dataset.kind = kind;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

function hideReconnectOverlay() {
  const el = $('#reconnect-overlay');
  if (el) el.hidden = true;
}

/** ゲスト切断時：ゲーム画面を残したまま再接続を促す */
function showGuestReconnectOverlay({ room, name, detail } = {}) {
  const overlay = $('#reconnect-overlay');
  if (!overlay) {
    // フォールバック：タイトルへ誘導
    const joinBtn = $('#btn-join');
    if (joinBtn && room) {
      joinBtn.dataset.prefillRoom = room;
      joinBtn.dataset.prefillName = name || '';
    }
    toast(room ? `部屋 ${room} に同じ名前で再接続できます` : 'タイトルから再接続してください');
    showScreen('screen-title');
    return;
  }
  const title = $('#reconnect-title');
  const detailEl = $('#reconnect-detail');
  if (title) title.textContent = '接続が切れました';
  if (detailEl) {
    detailEl.textContent = detail
      || (room
        ? `部屋 ${room} に「${name || '同じ名前'}」で再接続できます。`
        : '同じ部屋コード・同じ名前で再接続できます。');
  }
  overlay.hidden = false;

  const btnNow = $('#btn-reconnect-now');
  const btnTitle = $('#btn-reconnect-title');
  if (btnNow) {
    btnNow.disabled = false;
    btnNow.textContent = '再接続';
    btnNow.onclick = async () => {
      audio.sfx.click();
      btnNow.disabled = true;
      btnNow.textContent = '再接続中…';
      const ok = await attemptGuestReconnect({ room, name });
      btnNow.disabled = false;
      btnNow.textContent = '再接続';
      if (ok) hideReconnectOverlay();
    };
  }
  if (btnTitle) {
    btnTitle.onclick = () => {
      audio.sfx.click();
      hideReconnectOverlay();
      abandonGuestSessionToTitle({ room, name });
    };
  }
}

function abandonGuestSessionToTitle({ room, name } = {}) {
  app.net?.destroy();
  app.net = null;
  app.game = null;
  clearAllDisconnectTimers();
  const joinBtn = $('#btn-join');
  if (joinBtn && room) {
    joinBtn.dataset.prefillRoom = room;
    joinBtn.dataset.prefillName = name || '';
  }
  showScreen('screen-title');
  toast(room ? `部屋 ${room} に同じ名前で再接続できます` : 'タイトルから再接続してください');
}

/**
 * ゲストの再接続を試みる。成功時 true。
 * 既存 net があれば reconnect()、なければ同じ部屋で新規接続。
 */
async function attemptGuestReconnect({ room, name } = {}) {
  const roomCode = (room || app.net?.roomCode || readRejoinSession('')?.room || '').toUpperCase();
  const nm = (name || app.localName || '').trim() || 'プレイヤー';
  if (!roomCode || roomCode.length < 4) {
    toast('部屋コードがありません');
    return false;
  }
  savePlayerName(nm);
  app.mode = 'guest';
  try {
    let info;
    if (app.net && app.net.role === 'guest' && app.net.roomCode === roomCode) {
      info = await app.net.reconnect();
    } else {
      app.net?.destroy();
      app.net = createNet({
        role: 'guest',
        roomCode,
        onStatus: ({ msg, kind }) => setStatus(msg, kind),
        onEvent: handleNetEvent,
      });
      info = await app.net.start();
    }
    const rejoin = readRejoinSession(roomCode);
    const sent = app.net.sendToHost({
      type: 'hello',
      name: nm,
      peerId: info.peerId,
      version: APP_VERSION,
      color: app.lobbyColor,
      rejoinSeat: rejoin?.seat ?? app.localSeat,
    });
    if (!sent) throw new Error('ホストへ送れませんでした');
    toast('再接続を要求しました…');
    return true;
  } catch (e) {
    setStatus(e.message || String(e), 'error');
    toast('再接続に失敗しました');
    return false;
  }
}

function showHostReconnectPrompt() {
  const rejoin = readRejoinSession(app.net?.roomCode || '');
  const room = app.net?.roomCode || rejoin?.room || '';
  const name = app.localName || rejoin?.name || '';
  // ゲーム中：画面を残して再接続 UI
  if (app.game && app.mode === 'guest') {
    showGuestReconnectOverlay({ room, name });
    return;
  }
  // ロビー：ネットを残し「再接続」を出す
  if (app.mode === 'guest' && !app.game) {
    syncLobbyRoomControls({ roomOpen: true });
    setStatus(
      room
        ? `接続が切れました。部屋 ${room} へ「再接続」できます`
        : '接続が切れました。「再接続」または「接続」でもう一度',
      'error',
    );
    toast('接続が切れました。再接続できます');
    return;
  }
  abandonGuestSessionToTitle({ room, name });
}

/** ホストのロビー：部屋作成／解体ボタンの表示を同期 */
function syncLobbyRoomControls({ roomOpen }) {
  const connect = $('#btn-lobby-connect');
  const dismantle = $('#btn-lobby-dismantle');
  const reconnect = $('#btn-lobby-reconnect');
  const role = app.mode;
  if (role === 'host') {
    if (connect) {
      connect.textContent = '部屋作成';
      connect.hidden = !!roomOpen;
    }
    if (dismantle) dismantle.hidden = !roomOpen;
    if (reconnect) reconnect.hidden = true;
  } else {
    if (connect) {
      connect.textContent = '接続';
      connect.hidden = false;
    }
    if (dismantle) dismantle.hidden = true;
    if (reconnect) reconnect.hidden = !roomOpen;
  }
}

function dismantleHostRoom() {
  app.net?.destroy();
  app.net = null;
  app.lobbyPlayers = [];
  $('#lobby-players').innerHTML = '';
  $('#lobby-code-display').textContent = '------';
  syncLobbyRoomControls({ roomOpen: false });
  setStatus('部屋を解体しました。「部屋作成」で新しい部屋を開けます', 'info');
  toast('部屋を解体しました');
}

function bindVolumeUI() {
  const v = audio.getVolume();
  $('#vol-master').value = v.master;
  $('#vol-bgm').value = v.bgm;
  $('#vol-se').value = v.se;
  $('#btn-mute').textContent = v.muted ? '消' : '音';

  const unlock = () => {
    audio.resume();
    audio.startBgm();
  };
  document.addEventListener('pointerdown', unlock, { once: true });

  $('#vol-master').oninput = (e) => { audio.setMaster(e.target.value); unlock(); };
  $('#vol-bgm').oninput = (e) => { audio.setBgm(e.target.value); unlock(); };
  $('#vol-se').oninput = (e) => { audio.setSe(e.target.value); unlock(); };
  $('#btn-mute').onclick = () => {
    const muted = audio.toggleMute();
    $('#btn-mute').textContent = muted ? '消' : '音';
    unlock();
  };
  $('#btn-vol-expand')?.addEventListener('click', () => {
    $('#vol-dock')?.classList.toggle('vol-collapsed');
    unlock();
  });
}

const SIDE_TAB_TITLES = { turn: '手番', holdings: '所持', log: '記録' };
/** タッチ端末／ごく狭い幅のみシートUI。PCの縮小ウィンドウはコンパクト2カラムを維持 */
const MOBILE_UI_MQ = '(max-width: 900px) and (hover: none), (max-width: 640px)';

function isMobileUi() {
  return typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_UI_MQ).matches;
}

function setSideTab(tab) {
  const key = SIDE_TAB_TITLES[tab] ? tab : 'turn';
  $$('.side-tab').forEach((b) => {
    const on = b.dataset.sideTab === key;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $$('.side-pane').forEach((pane) => {
    const on = pane.dataset.pane === key;
    pane.classList.toggle('active', on);
    pane.hidden = !on;
  });
  const title = $('#side-sheet-title');
  if (title) title.textContent = SIDE_TAB_TITLES[key] || '詳細';
  $$('.mobile-info-btn').forEach((b) => {
    const on = b.dataset.sideOpen === key;
    b.classList.toggle('active', on && app.sideSheetOpen);
    b.setAttribute('aria-expanded', on && app.sideSheetOpen ? 'true' : 'false');
  });
  return key;
}

function openSideSheet(tab = 'turn') {
  setSideTab(tab);
  app.sideSheetOpen = true;
  document.body.classList.add('side-sheet-open');
  const backdrop = $('#side-backdrop');
  if (backdrop) {
    backdrop.hidden = false;
    backdrop.setAttribute('aria-hidden', 'false');
  }
}

function closeSideSheet() {
  app.sideSheetOpen = false;
  document.body.classList.remove('side-sheet-open');
  const backdrop = $('#side-backdrop');
  if (backdrop) {
    backdrop.hidden = true;
    backdrop.setAttribute('aria-hidden', 'true');
  }
  $$('.mobile-info-btn').forEach((b) => {
    b.classList.remove('active');
    b.setAttribute('aria-expanded', 'false');
  });
}

function bindSideChrome() {
  $$('.side-tab').forEach((btn) => {
    btn.onclick = () => {
      setSideTab(btn.dataset.sideTab);
      if (isMobileUi()) openSideSheet(btn.dataset.sideTab);
      audio.sfx.click();
    };
  });
  $$('.mobile-info-btn').forEach((btn) => {
    btn.onclick = () => {
      const tab = btn.dataset.sideOpen || 'turn';
      if (app.sideSheetOpen && btn.classList.contains('active')) {
        closeSideSheet();
      } else {
        openSideSheet(tab);
      }
      audio.sfx.click();
    };
  });
  $('#btn-side-close')?.addEventListener('click', () => {
    closeSideSheet();
    audio.sfx.click();
  });
  $('#side-backdrop')?.addEventListener('click', () => {
    closeSideSheet();
  });
  $('#btn-inspect-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    app.inspectedId = null;
    updateInspectPanel();
    audio.sfx.click();
  });
  window.matchMedia?.(MOBILE_UI_MQ)?.addEventListener?.('change', (ev) => {
    if (!ev.matches) closeSideSheet();
  });
  $('#btn-feed-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const wrap = $('#event-feed-wrap');
    wrap?.classList.toggle('feed-collapsed');
    // 一度隠したらイベント／所持金演出で勝手に開かない
    if (wrap?.classList.contains('feed-collapsed')) app.feedAutoExpand = false;
    // フィード開閉でマップ余白が変わるので、全体表示なら位置を寄せ直す
    if ((app.renderer?.getZoom?.() || 1) <= 1.001) {
      app.renderer?.zoomFit?.();
    }
    audio.sfx.click();
  });
}

function maybeExpandEventFeed() {
  if (!app.feedAutoExpand) return;
  $('#event-feed-wrap')?.classList.remove('feed-collapsed');
}

function bindTitle() {
  $('#btn-local').onclick = () => {
    audio.resume();
    audio.startBgm();
    audio.sfx.click();
    app.mode = 'local';
    openSetupLocal();
  };
  $('#btn-host').onclick = () => { audio.sfx.click(); openLobby('host'); };
  $('#btn-join').onclick = () => {
    audio.sfx.click();
    const btn = $('#btn-join');
    openLobby('guest', {
      room: btn?.dataset.prefillRoom || '',
      name: btn?.dataset.prefillName || '',
    });
  };
  $('#btn-howto').onclick = () => { audio.sfx.click(); showScreen('screen-howto'); };
  $('#btn-howto-back').onclick = () => showScreen('screen-title');
  $('#btn-patch-notes').onclick = () => {
    audio.sfx.click();
    renderPatchNotes();
    showScreen('screen-patch-notes');
  };
  $('#btn-patch-notes-back').onclick = () => showScreen('screen-title');
  $('#btn-scratch-dex').onclick = () => {
    audio.sfx.click();
    renderScratchDex();
    showScreen('screen-scratch-dex');
  };
  $('#btn-scratch-dex-back').onclick = () => showScreen('screen-title');
  $('#btn-results-archive').onclick = () => {
    audio.sfx.click();
    openResultsArchive();
  };
  bindResultsArchiveUi();
  syncScratchDexWithCatalog();
}

function renderScratchDex() {
  const list = $('#scratch-dex-list');
  const statsEl = $('#scratch-dex-stats');
  if (!list) return;
  const entries = getScratchDexEntries();
  const stats = getScratchDexStats();
  if (statsEl) {
    statsEl.textContent = `目撃 ${stats.seen} / ${stats.total}`;
  }
  list.innerHTML = entries.map((e) => `
    <li class="scratch-dex-row${e.seen ? ' is-seen' : ' is-unseen'}">
      <span class="scratch-dex-num">No.${String(e.id).padStart(3, '0')}</span>
      <span class="scratch-dex-label">${escapeHtml(e.label)}</span>
      <span class="scratch-dex-desc">${escapeHtml(e.description)}</span>
    </li>
  `).join('');
}

function renderPatchNotes() {
  const list = $('#patch-notes-list');
  if (!list) return;
  list.innerHTML = PATCH_NOTES.map((entry) => {
    const current = entry.version === APP_VERSION;
    const items = (entry.items || []).map((t) => `<li>${escapeHtml(t)}</li>`).join('');
    return `
      <article class="patch-notes-entry${current ? ' is-current' : ''}">
        <div class="patch-notes-head">
          <h3 class="patch-notes-ver">v${escapeHtml(entry.version)}</h3>
          ${entry.date ? `<span class="patch-notes-date">${escapeHtml(entry.date)}</span>` : ''}
          ${current ? '<span class="patch-notes-badge">いまの版</span>' : ''}
        </div>
        <ul>${items}</ul>
      </article>
    `;
  }).join('');
}

function selectedMapId(rootSel) {
  const checked = document.querySelector(`${rootSel} input[name="map-id"]:checked`);
  return checked?.value || DEFAULT_MAP_ID;
}

function getMapDefName(mapId) {
  return MAP_CATALOG.find((m) => m.id === mapId)?.name || '中央クロス';
}

/** 選択マップの大まかな配置（数値・店名なし）を canvas に描く */
function renderMapSilhouette(canvas, mapId) {
  if (!canvas?.getContext) return;
  let board;
  try {
    board = buildBoard(mapId || DEFAULT_MAP_ID);
  } catch {
    return;
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth || canvas.width || 320;
  const cssH = canvas.clientHeight || Math.round(cssW * 0.7) || 220;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = '#12161b';
  ctx.fillRect(0, 0, cssW, cssH);

  const nodes = (board.nodes || []).filter((n) => n.col != null && n.row != null);
  if (!nodes.length) return;
  let minC = Infinity;
  let maxC = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  for (const n of nodes) {
    minC = Math.min(minC, n.col);
    maxC = Math.max(maxC, n.col);
    minR = Math.min(minR, n.row);
    maxR = Math.max(maxR, n.row);
  }
  const cols = Math.max(1, maxC - minC + 1);
  const rows = Math.max(1, maxR - minR + 1);
  const pad = 10;
  const cell = Math.min((cssW - pad * 2) / cols, (cssH - pad * 2) / rows);
  const ox = (cssW - cols * cell) / 2;
  const oy = (cssH - rows * cell) / 2;
  const gap = Math.max(0.8, cell * 0.12);
  const size = Math.max(2, cell - gap);

  const typeFill = (n) => {
    if (n.type === 'shop') return board.areas?.[n.area]?.color || AREA_META[n.area]?.color || '#6a8299';
    if (n.type === 'bank') return '#e9c85a';
    if (n.type === 'mark') return '#c4c8d0';
    if (n.type === 'warp') return '#63e6be';
    if (n.type === 'warp_random') return '#8bc34a';
    if (n.type === 'scratch') return '#8a929c';
    if (n.type === 'minigame') return '#b197fc';
    if (n.type === 'lucky') return '#ffd43b';
    if (n.type === 'event') return '#ffa94d';
    if (n.type === 'rollon') return '#74c0fc';
    if (n.type === 'holiday') return '#df909c';
    if (n.type === 'stockbroker') return '#4fc3c7';
    if (n.type === 'suit_fill') return '#ff8787';
    if (n.type === 'switch') return '#ffe08a';
    if (n.type === 'shaft') return n.shaft === 'up' ? '#aed581' : '#ba68c8';
    if (n.type === 'pit') return n.pit === 'up' ? '#ef9a9a' : '#7986cb';
    if (n.type === 'ore') {
      return n.ore === 'gold' ? '#ffd54f' : n.ore === 'diamond' ? '#80cbc4' : '#90a4ae';
    }
    if (n.type === 'potion') return '#9fa8da';
    if (n.type === 'gate') return '#b39ddb';
    return '#5a6570';
  };

  for (const n of nodes) {
    const x = ox + (n.col - minC) * cell + gap / 2;
    const y = oy + (n.row - minR) * cell + gap / 2;
    const r = Math.min(3, size * 0.22);
    ctx.fillStyle = typeFill(n);
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, size, size, r);
    else ctx.rect(x, y, size, size);
    ctx.fill();
    if (n.type === 'bank') {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = Math.max(1, size * 0.08);
      ctx.stroke();
    }
  }
}

function updateMapPreview(mapId, {
  canvasId = null,
  nameId = null,
  blurbId = null,
} = {}) {
  const def = MAP_CATALOG.find((m) => m.id === mapId) || MAP_CATALOG[0];
  if (nameId) {
    const el = document.getElementById(nameId);
    if (el) el.textContent = def?.name || 'マップ';
  }
  if (blurbId) {
    const el = document.getElementById(blurbId);
    if (el) el.textContent = def?.blurb || '';
  }
  if (canvasId) {
    const canvas = document.getElementById(canvasId);
    if (canvas) renderMapSilhouette(canvas, def?.id || mapId);
  }
}

function renderMapPicker(containerId, preferredId = DEFAULT_MAP_ID, goalInputId = null, cashInputId = null, preview = null) {
  const box = document.getElementById(containerId);
  if (!box) return;
  const current = preferredId || DEFAULT_MAP_ID;
  const compact = box.classList.contains('map-picker-chips');
  box.innerHTML = MAP_CATALOG.map((m) => `
    <label class="map-option">
      <input type="radio" name="map-id" value="${escapeHtml(m.id)}" ${m.id === current ? 'checked' : ''} />
      <span class="map-option-body">
        <strong>${escapeHtml(m.name)}</strong>
        ${compact ? '' : `<small>${escapeHtml(m.blurb)}</small>`}
      </span>
    </label>
  `).join('');
  const syncMapDefaults = () => {
    const id = selectedMapId(`#${containerId}`);
    const def = MAP_CATALOG.find((m) => m.id === id);
    if (!def) return;
    if (goalInputId) {
      const goalInput = document.getElementById(goalInputId);
      if (goalInput && def.defaultGoal != null) goalInput.value = String(def.defaultGoal);
    }
    if (cashInputId) {
      const cashInput = document.getElementById(cashInputId);
      if (cashInput && def.defaultCash != null) cashInput.value = String(def.defaultCash);
    }
    if (preview) updateMapPreview(def.id, preview);
    if (typeof preview?.onChange === 'function') preview.onChange(def.id);
  };
  box.querySelectorAll('input[name="map-id"]').forEach((el) => {
    el.addEventListener('change', syncMapDefaults);
  });
  syncMapDefaults();
}

/** ロビー／セットアップの初期資金入力（未入力・不正は既定へ） */
function readStartCash(inputId) {
  const raw = Number(document.getElementById(inputId)?.value);
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_CASH;
  return Math.floor(raw);
}

function openSetupLocal() {
  showScreen('screen-setup');
  $('#setup-online-only').hidden = true;
  $('#setup-title').textContent = 'ローカル対戦';
  renderMapPicker('setup-map-options', DEFAULT_MAP_ID, 'setup-goal', 'setup-cash', {
    canvasId: 'setup-map-preview',
    nameId: 'setup-map-preview-name',
    blurbId: 'setup-map-preview-blurb',
  });
  renderSeatEditors(2);
  // レイアウト確定後にプレビュー解像度を合わせる
  requestAnimationFrame(() => {
    updateMapPreview(selectedMapId('#setup-map-options'), {
      canvasId: 'setup-map-preview',
      nameId: 'setup-map-preview-name',
      blurbId: 'setup-map-preview-blurb',
    });
  });
  $('#btn-start-game').onclick = () => {
    const seats = readSeatEditors();
    if (seats.length < 2) return toast('2人以上必要です');
    // 全席の名前を保持（未参加席も含む）
    const allNames = [0, 1, 2, 3].map((i) => (
      $(`input.seat-name[data-i="${i}"]`)?.value || DEFAULT_SEAT_NAMES[i]
    ));
    saveLocalSeatNames(allNames);
    const human = seats.find((s) => !s.isCPU);
    if (human?.name) savePlayerName(human.name);
    audio.sfx.click();
    startLocal(seats);
  };
  $('#btn-setup-back').onclick = () => showScreen('screen-title');
}

function renderSeatEditors(count) {
  const box = $('#seat-editors');
  box.innerHTML = '';
  const saved = loadLocalSeatNames();
  const playerName = loadSavedPlayerName();
  for (let i = 0; i < 4; i++) {
    let name = saved?.[i] || DEFAULT_SEAT_NAMES[i];
    // 保存がなければ1人目に前回のニックネームを入れる
    if (!saved && i === 0 && playerName) name = playerName;
    const row = document.createElement('div');
    row.className = 'seat-row';
    const defaultColor = PLAYER_COLORS[i % PLAYER_COLORS.length];
    row.innerHTML = `
      <input class="seat-name" data-i="${i}" value="${escapeHtml(name)}" maxlength="10" />
      <label class="seat-cpu"><input type="checkbox" data-cpu="${i}" ${i >= count ? 'checked' : ''}/> CPU</label>
      <label class="seat-on"><input type="checkbox" data-on="${i}" ${i < count ? 'checked' : ''}/> 参加</label>
      <div class="seat-color-block color-picker" data-seat-colors="${i}"></div>
    `;
    box.appendChild(row);
    const colorBox = row.querySelector(`[data-seat-colors="${i}"]`);
    colorBox.dataset.color = defaultColor;
  }
  renderSeatEditorsColorsOnly();
  box.querySelectorAll('input.seat-name').forEach((input) => {
    input.addEventListener('change', () => {
      const allNames = [0, 1, 2, 3].map((i) => (
        $(`input.seat-name[data-i="${i}"]`)?.value || DEFAULT_SEAT_NAMES[i]
      ));
      saveLocalSeatNames(allNames);
    });
  });
}

/** ローカル席の色ピッカーを、他席の使用色を踏まえて描き直す */
function renderSeatEditorsColorsOnly() {
  for (let i = 0; i < 4; i++) {
    const colorBox = $(`[data-seat-colors="${i}"]`);
    if (!colorBox) continue;
    const selected = colorBox.dataset.color || PLAYER_COLORS[i % PLAYER_COLORS.length];
    const taken = [];
    for (let j = 0; j < 4; j++) {
      if (j === i) continue;
      const other = $(`[data-seat-colors="${j}"]`)?.dataset.color;
      if (other) taken.push(other);
    }
    renderColorPicker(colorBox, selected, {
      taken,
      onPick: (c) => {
        colorBox.dataset.color = c;
        renderSeatEditorsColorsOnly();
      },
    });
  }
}

function readSeatEditors() {
  const seats = [];
  for (let i = 0; i < 4; i++) {
    const on = $(`input[data-on="${i}"]`)?.checked;
    if (!on) continue;
    const colorBox = $(`[data-seat-colors="${i}"]`);
    seats.push({
      name: $(`input.seat-name[data-i="${i}"]`)?.value || `P${i + 1}`,
      color: colorBox?.dataset.color || PLAYER_COLORS[i % PLAYER_COLORS.length],
      isCPU: $(`input[data-cpu="${i}"]`)?.checked || false,
    });
  }
  return normalizeLobbyColors(seats);
}

async function openLobby(role, prefill = {}) {
  hideReconnectOverlay();
  // 既存ネットはロビー入室時にクリア（建て直しは解体ボタン経由）
  if (app.net) {
    app.net.destroy();
    app.net = null;
  }
  app.lobbyPlayers = [];
  app.mode = role;
  showScreen('screen-lobby');
  $('#lobby-role').textContent = role === 'host' ? 'ホスト（部屋を作る）' : 'ゲスト（部屋に入る）';
  $('#lobby-room-wrap').hidden = role === 'host';
  $('#lobby-host-tools').hidden = role !== 'host';
  $('#btn-lobby-start').hidden = role !== 'host';
  $('#btn-add-cpu').hidden = role !== 'host';
  $('#lobby-code-display').textContent = '------';
  $('#lobby-players').innerHTML = '';
  syncLobbyRoomControls({ roomOpen: false });
  const guestMap = $('#lobby-guest-map');
  if (guestMap) guestMap.hidden = role === 'host';
  app.lobbyMapId = DEFAULT_MAP_ID;
  if (role === 'host') {
    renderMapPicker('lobby-map-options', DEFAULT_MAP_ID, 'lobby-goal', 'lobby-cash', {
      canvasId: 'lobby-map-preview',
      nameId: 'lobby-map-preview-name',
      onChange: (mapId) => {
        applyLobbyMapPreview(mapId);
        broadcastLobbySync({ mapId });
      },
    });
    requestAnimationFrame(() => {
      applyLobbyMapPreview(selectedMapId('#lobby-map-options'));
    });
  } else {
    applyLobbyMapPreview(DEFAULT_MAP_ID);
  }
  const nameInput = $('#lobby-name');
  const savedName = loadSavedPlayerName();
  const rejoin = role === 'guest' ? readRejoinSession(($('#lobby-room')?.value || prefill.room || '').toUpperCase()) : null;
  // 優先順: 明示プリフィル → 再接続セッション → 保存済みニックネーム → 既存入力
  if (prefill.name) {
    nameInput.value = prefill.name;
  } else if (rejoin?.name) {
    nameInput.value = rejoin.name;
  } else if (savedName) {
    nameInput.value = savedName;
  } else if (!nameInput.value.trim()) {
    nameInput.value = 'プレイヤー';
  }
  if (prefill.room && role === 'guest') {
    const roomInput = $('#lobby-room');
    if (roomInput) roomInput.value = String(prefill.room).toUpperCase();
  }
  nameInput.oninput = () => {
    const n = nameInput.value.trim();
    if (n) savePlayerName(n);
  };
  nameInput.onchange = () => savePlayerName(nameInput.value);
  if (!PLAYER_COLORS.some((c) => c.toLowerCase() === String(app.lobbyColor || '').toLowerCase())) {
    app.lobbyColor = PLAYER_COLORS[0];
  }
  refreshLobbyColorPicker();
  setStatus(
    role === 'host'
      ? '「部屋作成」で部屋を開きます。建て直すときは先に「部屋を解体」してください'
      : '部屋コードを入れて「接続」。切断後は「再接続」か同じ名前でもう一度接続',
  );

  $('#btn-lobby-back').onclick = () => {
    app.net?.destroy();
    app.net = null;
    app.lobbyPlayers = [];
    syncLobbyRoomControls({ roomOpen: false });
    showScreen('screen-title');
  };

  $('#btn-lobby-dismantle').onclick = () => {
    audio.sfx.click();
    if (role !== 'host') return;
    if (!app.net) {
      toast('開いている部屋がありません');
      return;
    }
    if (app.game) {
      toast('ゲーム中はロビーから解体できません');
      return;
    }
    dismantleHostRoom();
  };

  $('#btn-lobby-reconnect').onclick = async () => {
    audio.sfx.click();
    if (role !== 'guest') return;
    const name = $('#lobby-name').value.trim() || 'プレイヤー';
    savePlayerName(name);
    const roomInput = $('#lobby-room').value.trim().toUpperCase();
    if (roomInput.length < 4) return toast('部屋コードを入力してください');
    const ok = await attemptGuestReconnect({ room: roomInput, name });
    if (ok) syncLobbyRoomControls({ roomOpen: true });
  };

  $('#btn-lobby-connect').onclick = async () => {
    try {
      if (role === 'host' && app.net) {
        toast('先に「部屋を解体」してから新しい部屋を作成してください');
        return;
      }
      const name = $('#lobby-name').value.trim() || 'プレイヤー';
      savePlayerName(name);
      const roomInput = $('#lobby-room').value.trim().toUpperCase();
      if (role === 'guest' && roomInput.length < 4) return toast('部屋コードを入力してください');

      // ゲストの再接続（既存接続がある／切断後）は張り直し
      if (role === 'guest' && app.net?.roomCode === roomInput) {
        const ok = await attemptGuestReconnect({ room: roomInput, name });
        if (ok) syncLobbyRoomControls({ roomOpen: true });
        return;
      }

      app.net?.destroy();
      app.net = createNet({
        role,
        roomCode: role === 'guest' ? roomInput : undefined,
        onStatus: ({ msg, kind }) => setStatus(msg, kind),
        onEvent: handleNetEvent,
      });
      const info = await app.net.start();
      $('#lobby-code-display').textContent = info.roomCode;
      syncLobbyRoomControls({ roomOpen: true });
      if (role === 'host') {
        app.lobbyPlayers = [{
          peerId: info.peerId,
          name,
          color: normalizePlayerColor(app.lobbyColor, 0, []),
          isHost: true,
        }];
        renderLobbyPlayers();
        refreshLobbyColorPicker();
        broadcastLobbySync();
        setStatus(`部屋 ${info.roomCode} を公開中。建て直すときは「部屋を解体」`, 'ok');
      } else {
        const rejoinSeat = readRejoinSession(roomInput);
        app.net.sendToHost({
          type: 'hello',
          name,
          peerId: info.peerId,
          version: APP_VERSION,
          color: app.lobbyColor,
          rejoinSeat: rejoinSeat?.seat,
        });
      }
    } catch (e) {
      app.net?.destroy();
      app.net = null;
      syncLobbyRoomControls({ roomOpen: false });
      setStatus(e.message || String(e), 'error');
      toast(role === 'host' ? '部屋作成に失敗しました' : '接続に失敗しました');
    }
  };

  $('#btn-lobby-start').onclick = () => {
    if (app.mode !== 'host') return;
    if (!app.net) return toast('先に「部屋作成」してください');
    if (app.lobbyPlayers.length < 2) return toast('あと1人以上待ってください（またはCPUを追加）');
    const goal = Number($('#lobby-goal').value) || 10000;
    const cash = readStartCash('lobby-cash');
    const mapId = selectedMapId('#lobby-map-options');
    resyncLobbyColors();
    const players = app.lobbyPlayers.map((p) => ({
      peerId: p.peerId,
      name: p.name,
      color: p.color,
      isCPU: !!p.isCPU,
      key: p.peerId,
    }));
    beginOrderRoll({ players, goal, cash, mapId, mode: 'host' });
  };

  $('#btn-add-cpu').onclick = () => {
    if (!app.net) return toast('先に「部屋作成」してください');
    if (app.lobbyPlayers.length >= 4) return toast('最大4人です');
    const i = app.lobbyPlayers.length;
    const used = app.lobbyPlayers.map((p) => p.color);
    app.lobbyPlayers.push({
      peerId: `cpu-${i}`,
      name: `CPU${i}`,
      color: normalizePlayerColor(null, i, used),
      isCPU: true,
    });
    resyncLobbyColors();
    renderLobbyPlayers();
    broadcastLobbySync();
  };

  $('#btn-copy-code').onclick = async () => {
    const code = $('#lobby-code-display').textContent;
    try {
      await navigator.clipboard.writeText(code);
      toast('部屋コードをコピーしました');
    } catch {
      toast(code);
    }
  };
}

function renderLobbyPlayers() {
  const box = $('#lobby-players');
  box.innerHTML = app.lobbyPlayers.map((p, i) => `
    <div class="lobby-player" style="--pc:${p.color || PLAYER_COLORS[i % PLAYER_COLORS.length]}">
      <span class="lp-dot"></span>
      <span>${escapeHtml(p.name)}${p.isHost ? '（ホスト）' : ''}${p.isCPU ? '（CPU）' : ''}</span>
      ${app.mode === 'host' && p.isCPU
        ? `<div class="color-picker tiny" data-lobby-cpu-colors="${escapeHtml(p.peerId)}"></div>`
        : ''}
    </div>
  `).join('');
  if (app.mode === 'host') {
    box.querySelectorAll('[data-lobby-cpu-colors]').forEach((colorBox) => {
      const peerId = colorBox.getAttribute('data-lobby-cpu-colors');
      const pl = app.lobbyPlayers.find((x) => x.peerId === peerId);
      if (!pl) return;
      renderColorPicker(colorBox, pl.color, {
        taken: usedLobbyColors(peerId),
        onPick: (color) => setHostPlayerColor(peerId, color),
      });
    });
  }
  refreshLobbyColorPicker();
}

function handleNetEvent({ from, data }) {
  if (!data) return;

  if (app.mode === 'host') {
    if (data.type === 'hello') {
      if (data.version !== APP_VERSION) {
        app.net.sendTo(from, {
          type: 'version_mismatch',
          hostVersion: APP_VERSION,
          clientVersion: data.version || '?',
        });
        return;
      }
      if (app.game) {
        const seat = findRejoinSeat(app.game, data.name, data.rejoinSeat);
        if (seat >= 0) {
          const pl = app.game.players[seat];
          clearDisconnectTimer(seat);
          pl.peerId = data.peerId || from;
          pl.offline = false;
          pl.isCPU = false;
          pl.personality = null;
          if (!pl.flags) pl.flags = {};
          pl.flags.reclaimableHuman = false;
          delete pl.flags.disconnectedAt;
          // 存在しない／重複色なら未使用パレット色へ
          const others = app.game.players.filter((_, i) => i !== seat).map((p) => p.color);
          pl.color = normalizePlayerColor(pl.color, seat, others);
          app.game.logs.unshift({ text: `${pl.name} が再接続`, kind: 'system', t: Date.now() });
          if (app.game.logs.length > 80) app.game.logs.length = 80;
          app.net.sendTo(from, {
            type: 'game_rejoin',
            state: serializeState(app.game),
            seat,
          });
          syncState();
          refreshGameUI();
          toast(`${pl.name} が再接続しました`);
          return;
        }
        app.net.sendTo(from, { type: 'game_already' });
        return;
      }
      if (app.orderRoll) {
        const peerId = data.peerId || from;
        const reclaimed = reclaimOrderRollPlayer(app.orderRoll, {
          name: data.name,
          peerId,
        });
        if (reclaimed) {
          reclaimOrPushLobbyPlayer(from, data);
          resyncLobbyColors();
          renderLobbyPlayers();
          broadcastLobbySync();
          app.net.sendTo(from, {
            type: 'order_roll_sync',
            ...serializeOrderRoll(),
          });
          broadcastOrderRollSync();
          renderOrderRollUi();
          toast(`${reclaimed.name} が順番決めに復帰`);
          return;
        }
        app.net.sendTo(from, { type: 'game_already' });
        return;
      }
      const joined = reclaimOrPushLobbyPlayer(from, data);
      if (joined.full) {
        app.net.sendTo(from, { type: 'lobby_full' });
        return;
      }
      resyncLobbyColors();
      renderLobbyPlayers();
      broadcastLobbySync();
      return;
    }
    if (data.type === 'lobby_color') {
      if (app.game || app.orderRoll) return;
      const peerId = data.peerId || from;
      const idx = app.lobbyPlayers.findIndex((p) => p.peerId === peerId);
      if (idx < 0) return;
      const others = usedLobbyColors(peerId);
      app.lobbyPlayers[idx].color = normalizePlayerColor(data.color, idx, others);
      resyncLobbyColors();
      renderLobbyPlayers();
      broadcastLobbySync();
      return;
    }
    if (data.type === 'order_roll_claim') {
      handleOrderRollClaim(from);
      return;
    }
    if (data.type === 'event_flash_dismiss') {
      const seat = app.game?.players?.findIndex((p) => p.peerId === from);
      if (seat < 0) return;
      const readerId = app.eventFlashReaderId;
      const claimed = Number(data.seat);
      // 確認担当からの閉じ要求。ホスト側が既に閉じていてもクライアント解放のため中継する
      const allowed = seat === readerId
        || seat === app.actionActorId
        || claimed === readerId
        || claimed === seat;
      if (!allowed) return;
      if (app.eventFlashOpen) {
        dismissEventFlash({ force: true });
      } else {
        broadcastFx({ kind: 'eventFlashDismiss' });
      }
      return;
    }
    if (data.type === 'event_flash_flush') {
      // クライアントが残留の料金確認などを捨てた → ホストも含め全員解放
      const seat = app.game?.players?.findIndex((p) => p.peerId === from);
      if (seat < 0) return;
      if (data.throughLogKey) advanceLastSeenLogKey(data.throughLogKey, app.game);
      flushEventFlashImmediate();
      app.busy = false;
      refreshGameUI();
      scheduleCpu();
      return;
    }
    if (data.type === 'nudge') {
      handleHostNudge(from, data);
      return;
    }
    if (data.type === 'action') {
      handleHostAction(from, data);
      return;
    }
    if (data.type === 'peer_left') {
      if (app.orderRoll) {
        const left = markOrderRollPlayerLeft(app.orderRoll, data.peerId);
        if (left) {
          toast(`${left.name} が切断（再接続待ち）`);
          broadcastOrderRollSync();
          renderOrderRollUi();
          scheduleOrderRollDisconnectRecovery(left.key);
        }
        return;
      }
      if (!app.game) {
        app.lobbyPlayers = app.lobbyPlayers.filter((p) => p.peerId !== data.peerId);
        renderLobbyPlayers();
        broadcastLobbySync();
        return;
      }
      const seat = app.game.players.findIndex((p) => p.peerId === data.peerId);
      if (seat >= 0) handlePlayerDisconnect(seat, { reason: '切断' });
      return;
    }
  }

  if (app.mode === 'guest') {
    if (data.type === 'version_mismatch') {
      toast(`バージョン不一致（部屋 v${data.hostVersion} / あなた v${data.clientVersion || APP_VERSION}）。同じ版を開き直してください`);
      setStatus('バージョンが合わないため入室できません', 'error');
      app.net?.destroy();
      app.net = null;
      syncLobbyRoomControls({ roomOpen: false });
      return;
    }
    if (data.type === 'lobby_sync') {
      app.lobbyPlayers = normalizeLobbyColors(data.players || []);
      renderLobbyPlayers();
      if (data.mapId) applyLobbyMapPreview(data.mapId);
      const guestWrap = $('#lobby-guest-map');
      if (guestWrap) guestWrap.hidden = false;
      return;
    }
    if (data.type === 'lobby_full') {
      toast('部屋が満員です');
      return;
    }
    if (data.type === 'order_roll_sync') {
      applyOrderRollSync(data);
      return;
    }
    if (data.type === 'order_roll_abort') {
      clearOrderRollRevealTimers();
      app.orderRoll = null;
      toast('順番決めが中断されました');
      showScreen('screen-lobby');
      return;
    }
    if (data.type === 'game_start' || data.type === 'game_rejoin') {
      clearOrderRollRevealTimers();
      app.orderRoll = null;
      hideReconnectOverlay();
      app.game = restoreState(data.state);
      const myPeer = app.net.peerId;
      if (data.type === 'game_rejoin' && typeof data.seat === 'number') {
        app.localSeat = data.seat;
        app.game.players[app.localSeat].peerId = myPeer;
        app.game.players[app.localSeat].offline = false;
      } else {
        // seatMap があれば peerId より先に確定（順番ダイス後の id ずれ防止）
        const mapIdx = Array.isArray(data.seatMap)
          ? data.seatMap.findIndex((id) => id === myPeer)
          : -1;
        app.localSeat = mapIdx >= 0
          ? mapIdx
          : app.game.players.findIndex((p) => p.peerId === myPeer);
        if (app.localSeat < 0) {
          console.warn('[seat] could not resolve local seat for', myPeer);
          app.localSeat = 0;
        } else if (app.game.players[app.localSeat]) {
          app.game.players[app.localSeat].peerId = myPeer;
        }
      }
      enterGame();
      if (data.type === 'game_rejoin') toast('再接続しました');
      saveRejoinSession();
      return;
    }
    if (data.type === 'game_already') {
      toast('進行中のゲームがあります。同じ部屋コード・同じ名前で再接続してください');
      return;
    }
    if (data.type === 'host_left') {
      toast('ホストとの接続が切れました。同じ部屋に再接続できます');
      showHostReconnectPrompt();
      return;
    }
    if (data.type === 'fx') {
      playRemoteFx(data);
      return;
    }
    if (data.type === 'state') {
      const prev = app.game;
      app.game = restoreState(data.state);
      if (data.hideDice) app.hideDiceResult = true;
      else if (data.hideDice === false) app.hideDiceResult = false;
      if (prev && data.anim?.from != null && data.anim?.to != null) {
        app.renderer?.animateToken(data.anim.pid, data.anim.from, data.anim.to, 380);
        audio.sfx.step();
      }
      // リモート演出中 busy でも、自分の購入/増資待ちなら UI を出す
      if (isLocalPendingChoice(app.game)) {
        app.busy = false;
        app.eventFlashHoldingBusy = false;
      }
      refreshGameUI();
      return;
    }
    if (data.type === 'reject') {
      toast(data.reason || '操作が拒否されました');
      // hideModal 後の拒否で選択UIが消えたままになるのを防ぐ
      refreshGameUI();
    }
  }
}

function playRemoteFx(data) {
  if (data.kind === 'dice') {
    app.hideDiceResult = true;
    playDiceOverlay(data.face, true, { diceMax: data.diceMax, label: data.label }).finally(() => {
      app.hideDiceResult = false;
      refreshGameUI();
    });
  }
  if (data.kind === 'eventNpcHold' && data.npcId != null && data.from != null) {
    app.renderer?.holdToken(data.npcId, data.from);
  }
  if (data.kind === 'eventNpcMove') {
    app.busy = true;
    presentEventNpcMove(data, true).finally(() => {
      clearBusyUnlessEventUi();
      refreshGameUI();
    });
  }
  if (data.kind === 'eventNpcSpawn') {
    const nk = data.npcKind;
    pushEventStamp({
      kicker: 'イベントNPC',
      title: '異界から現れた！',
      detail: nk === 'mark_fairy' ? 'マークの妖精'
        : nk === 'merchant' ? '大商人'
          : nk === 'poverty' ? '貧乏神' : 'NPC',
      kind: 'event',
      color: '#c5a3ff',
      silentStamp: true,
    });
  }
  if (data.kind === 'eventNpcDepart') {
    app.renderer?.clearTokenHold(data.npcId);
    if (app.game && data.npcId != null) removeEventNpc(app.game, data.npcId);
    pushEventStamp({
      kicker: 'イベントNPC',
      title: '異界へ帰っていった',
      detail: data.label || '',
      kind: 'event',
      color: '#9aa3b5',
      silentStamp: true,
    });
  }
  if (data.kind === 'scratchOutcome') {
    app.busy = true;
    presentScratchOutcome({
      scratched: true,
      cell: data.cell,
      messages: data.messages || [],
      matches: data.matches || [],
      matchBonus: data.matchBonus || 0,
      warps: [],
    }, { remote: true }).finally(() => {
      clearBusyUnlessEventUi();
      refreshGameUI();
    });
  } else if (data.kind === 'scratchMatch' && data.matches?.length) {
    app.busy = true;
    playScratchMatchReveal(data.matches, data.messages || [], { banner: false }).finally(() => {
      clearBusyUnlessEventUi();
      refreshGameUI();
    });
  }
  if (data.kind === 'minigameReveal' && data.reveal) {
    app.busy = true;
    playMinigameReveal(data.reveal).finally(() => {
      clearBusyUnlessEventUi();
      refreshGameUI();
    });
  }
  if (data.kind === 'potionReveal' && data.results?.length) {
    presentPotionReveal({ results: data.results, remote: true }).finally(() => {
      refreshGameUI();
    });
  }
  if (data.kind === 'warp' && data.warp) {
    app.busy = true;
    presentWarpFx([data.warp], { remote: true }).finally(() => {
      clearBusyUnlessEventUi();
      refreshGameUI();
    });
  }
  if (data.kind === 'switchSlide' && data.moves?.length) {
    // 先にスライド予約 → その後に論理座標を更新（一瞬の新位置フラッシュを防ぐ）
    armSwitchSlides(data.moves);
    if (app.game && (data.switchState === 0 || data.switchState === 1)) {
      app.game.switchState = data.switchState ? 1 : 0;
      applySwitchState(app.game);
    }
    app.busy = true;
    // ゲストはスライド＋SEのみ。告知UIを出すと endTurn 後の reconcile で
    // flush↔再告知ループになり音とログが鳴り続ける
    presentSwitchFx(data.moves, { remote: true, alreadyArmed: true }).finally(() => {
      clearBusyUnlessEventUi();
      refreshGameUI();
    });
  }
  if (data.kind === 'banner') {
    enqueueBanner(data.payload || data);
  }
  if (data.kind === 'eventFlashFlush') {
    flushEventFlashImmediate({ remote: true });
    // 既読キーは前進のみ（古い throughLogKey で巻き戻すとログ再告知がループする）
    if (data.throughLogKey) advanceLastSeenLogKey(data.throughLogKey, app.game);
    app.busy = false;
    refreshGameUI();
  }
  if (data.kind === 'eventFlashDismiss') {
    dismissEventFlash({ remote: true });
  }
  if (data.kind === 'fiveBuy') {
    // payload 無しでも最低限の奪取告知を出す（古いホスト互換）
    presentFiveBuyFx({
      remote: true,
      ...(data.payload ? { payload: data.payload } : {}),
      fiveBuyShop: data.shop,
      fiveBuyMulti: data.multi,
      fiveBuyPlayerId: data.playerId,
      fiveBuyCoupon: data.coupon,
    });
  }
  if (data.kind === 'monopoly') {
    audio.sfx.monopoly();
    if (data.payload) enqueueBanner(data.payload);
    presentCelebrateFx({
      title: data.payload?.kicker || 'エリア独占！',
      detail: [data.payload?.title, data.payload?.detail].filter(Boolean).join(' — '),
      color: data.payload?.color || '#ffe08a',
      variant: 'monopoly',
    });
  }
  if (data.kind === 'monopolyBreak') {
    audio.sfx.toll();
    if (data.payload) enqueueBanner(data.payload);
  }
  if (data.kind === 'yourTurn' && data.seat === app.localSeat) {
    const key = data.key || `${app.game?.turn}-${data.seat}-await_roll`;
    if (app.lastTurnKey === key) return;
    app.lastTurnKey = key;
    audio.sfx.yourTurn();
  }
  if (data.kind === 'nudge') {
    if (data.targetSeat === app.localSeat) {
      playNudgeReceived(data.fromName);
    }
  }
}

/** 5倍買い（／クーポン3倍）奪取のSE＋告知。全経路で payload 付き同期する */
function presentFiveBuyFx(result = {}) {
  if (!result || (!result.fiveBuy && !result.remote && !result.payload)) return;
  const who = app.game?.players?.[result.fiveBuyPlayerId]
    || app.game?.players?.[app.actionActorId]
    || currentPlayer(app.game);
  const multi = Number(result.fiveBuyMulti) || 5;
  const shop = result.fiveBuyShop || '';
  const coupon = !!result.fiveBuyCoupon;
  const mine = who && (app.mode === 'local' ? !who.isCPU : who.id === app.localSeat);
  const payload = result.payload || {
    kicker: `${multi}倍買い`,
    title: 'お店を奪取',
    detail: shop
      ? `${who?.name || ''} が「${shop}」を${multi}倍買い${coupon ? '（クーポン）' : ''}`
      : `店価×${multi}でお店を買収した`,
    kind: 'shop',
    color: who?.color || '#ffe08a',
    mine: !!mine,
    actorId: who?.id ?? app.actionActorId,
  };
  audio.sfx.fiveBuy();
  if (!result.remote) {
    broadcastFx({
      kind: 'fiveBuy',
      payload,
      shop,
      multi,
      playerId: who?.id,
      coupon,
    });
    enqueueBanner(payload);
  } else {
    enqueueBanner(payload);
  }
}

const CELEBRATE_CONFETTI_COLORS = [
  '#ffe08a', '#ffb347', '#ff6b6b', '#ff8fab', '#c77dff',
  '#4cc9f0', '#80ed99', '#fff1a8', '#f72585', '#f4a261',
];

/**
 * 紙吹雪をコンテナへ流し込む。
 * @param {HTMLElement|null} host
 * @param {{ count?: number, durationMs?: number }} [opts]
 */
function spawnConfettiBurst(host, { count = 48, durationMs = 2600 } = {}) {
  if (!host) return;
  host.innerHTML = '';
  const n = Math.max(12, Math.min(120, Math.floor(count)));
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const bit = document.createElement('span');
    const shape = i % 5 === 0 ? 'ribbon' : (i % 3 === 0 ? 'square' : 'rect');
    bit.className = `cfx-bit cfx-bit-${shape}`;
    const left = Math.random() * 100;
    const y0 = Math.random() * 28; // 画面上部〜中上から散らす
    const delay = Math.random() * 0.45;
    const dur = 2.2 + Math.random() * 1.6;
    const drift = (Math.random() * 2 - 1) * 160;
    const spin = 180 + Math.random() * 720;
    const size = 11 + Math.random() * 15;
    const color = CELEBRATE_CONFETTI_COLORS[i % CELEBRATE_CONFETTI_COLORS.length];
    bit.style.setProperty('--x', `${left}%`);
    bit.style.setProperty('--y0', `${y0}%`);
    bit.style.setProperty('--delay', `${delay}s`);
    bit.style.setProperty('--dur', `${dur}s`);
    bit.style.setProperty('--drift', `${drift}px`);
    bit.style.setProperty('--spin', `${spin}deg`);
    bit.style.setProperty('--size', `${size}px`);
    bit.style.setProperty('--c', color);
    bit.style.animationDuration = `${dur}s`;
    bit.style.animationDelay = `${delay}s`;
    frag.appendChild(bit);
  }
  host.appendChild(frag);
  clearTimeout(spawnConfettiBurst._clean);
  spawnConfettiBurst._clean = setTimeout(() => {
    if (host.isConnected) host.innerHTML = '';
  }, durationMs + 400);
}

/** 祝福演出（ジャックポット／上役／独占など）。紙吹雪で盛り上がりを出す。 */
function presentCelebrateFx({
  title = 'おめでとう！',
  detail = '',
  color = '#ffe08a',
  variant = 'soft',
} = {}) {
  const root = $('#celebrate-fx');
  if (!root) return;
  root.hidden = false;
  root.dataset.variant = variant;
  root.style.setProperty('--cfx', color);
  const titleEl = root.querySelector('.cfx-title');
  const detailEl = root.querySelector('.cfx-detail');
  if (titleEl) titleEl.textContent = title;
  if (detailEl) detailEl.textContent = detail || '';

  const confettiHost = root.querySelector('.cfx-confetti');
  const intensity = variant === 'jackpot' ? 88
    : variant === 'big' ? 64
      : variant === 'monopoly' ? 56
        : 36;
  const holdMs = variant === 'jackpot' ? 3200 : (variant === 'big' ? 2800 : 2400);
  spawnConfettiBurst(confettiHost, { count: intensity, durationMs: holdMs });

  root.classList.remove('show');
  void root.offsetWidth;
  root.classList.add('show');
  clearTimeout(presentCelebrateFx._t);
  presentCelebrateFx._t = setTimeout(() => {
    root.classList.remove('show');
    root.hidden = true;
    if (confettiHost) confettiHost.innerHTML = '';
  }, holdMs);
}

function presentMonopolyFx(result) {
  if (!result?.monopoly || !app.game) return;
  const who = app.game.players.find((p) => p.flags?.monopolyBonusClaimed?.[result.area])
    || currentPlayer(app.game);
  const areaName = result.areaName || app.game.areas[result.area]?.name || `エリア${result.area}`;
  const bonus = result.bonus || 0;
  audio.sfx.monopoly();
  const payload = {
    kicker: 'エリア独占！',
    title: areaName,
    detail: bonus ? `独占ボーナス +${bonus.toLocaleString()}G` : 'エリアを完全支配！',
    kind: 'level',
    color: who?.color || '#ffe08a',
    mine: who && (app.mode === 'local' ? !who.isCPU : who.id === app.localSeat),
  };
  broadcastFx({ kind: 'monopoly', payload, area: result.area, bonus });
  enqueueBanner(payload);
  presentCelebrateFx({
    title: 'エリア独占！',
    detail: bonus ? `${areaName} +${bonus.toLocaleString()}G` : areaName,
    color: who?.color || '#ffe08a',
    variant: 'monopoly',
  });
}

function presentMonopolyBreakFx(result) {
  const brk = result?.monopolyBreak;
  if (!brk?.broken || !app.game) return;
  const areaName = brk.areaName || app.game.areas[brk.area]?.name || `エリア${brk.area}`;
  audio.sfx.toll();
  const payload = {
    kicker: '独占崩壊！',
    title: areaName,
    detail: `株価 ${Number(brk.oldPrice || 0).toLocaleString()}→${Number(brk.newPrice || 0).toLocaleString()}G`
      + (brk.investCut ? `／残店増資 −${Number(brk.investCut).toLocaleString()}G` : ''),
    kind: 'toll',
    color: '#ff8a80',
    mine: false,
  };
  broadcastFx({ kind: 'monopolyBreak', payload, area: brk.area });
  enqueueBanner(payload);
}

function syncGoalPressureBgm(g) {
  if (!g || g.phase === 'gameover') {
    audio.setBgmMode('normal');
    document.body.classList.remove('goal-pressure');
    return;
  }
  const urgent = !!g.goalPressure || getGoalPressurePlayers(g).length > 0;
  const prev = audio.getBgmMode();
  audio.setBgmMode(urgent ? 'urgency' : 'normal');
  document.body.classList.toggle('goal-pressure', urgent);
  if (urgent && prev !== 'urgency' && !app.goalPressureBannerShown) {
    app.goalPressureBannerShown = true;
    const names = getGoalPressurePlayers(g).map((p) => p.name).join('・') || '誰か';
    enqueueBanner({
      kicker: '目標到達！',
      title: 'エンドゲーム突入',
      detail: `${names} が目標資産に到達 — 銀行へ急げ！`,
      kind: 'level',
      color: '#ffb020',
      mine: true,
    });
  }
  if (!urgent) app.goalPressureBannerShown = false;
}

/** 順番決めダイスを開始（ホスト／ローカル） */
function beginOrderRoll({ players, goal, cash, mapId, mode }) {
  const list = players.map((p, i) => ({
    key: p.key || p.peerId || `p-${i}`,
    peerId: p.peerId || null,
    name: p.name,
    color: p.color,
    isCPU: !!p.isCPU,
  }));
  clearOrderRollRevealTimers();
  app.orderRoll = {
    players: list,
    rolls: {},
    pending: list.map((p) => p.key),
    round: 1,
    awaitingConfirm: false,
    finalOrder: null,
    revealPhase: null,
    lastRolledKey: null,
    goal,
    cash: cash ?? DEFAULT_CASH,
    mapId,
    mode,
  };
  showOrderRollScreen();
  broadcastOrderRollSync();
  scheduleOrderRollCpus();
}

function broadcastOrderRollSync() {
  if (!app.orderRoll) return;
  if (app.mode === 'host' && app.net) {
    app.net.broadcast({
      type: 'order_roll_sync',
      ...serializeOrderRoll(),
    });
  }
}

function serializeOrderRoll() {
  const o = app.orderRoll;
  return {
    players: (o.players || []).map((p) => ({
      key: p.key,
      peerId: p.peerId,
      name: p.name,
      color: p.color,
      isCPU: !!p.isCPU,
      disconnected: !!p.disconnected,
    })),
    rolls: o.rolls,
    pending: o.pending,
    round: o.round,
    awaitingConfirm: !!o.awaitingConfirm,
    finalOrder: o.finalOrder || null,
    revealPhase: o.revealPhase || null,
    lastRolledKey: o.lastRolledKey || null,
    goal: o.goal,
    cash: o.cash ?? DEFAULT_CASH,
    mapId: o.mapId,
  };
}

function applyOrderRollSync(data) {
  const prev = app.orderRoll;
  const finalOrder = Array.isArray(data.finalOrder) ? data.finalOrder : null;
  const awaitingConfirm = !!data.awaitingConfirm;
  app.orderRoll = {
    players: data.players || [],
    rolls: data.rolls || {},
    pending: data.pending || [],
    round: data.round || 1,
    awaitingConfirm,
    finalOrder,
    revealPhase: awaitingConfirm
      ? 'done'
      : (data.revealPhase || (finalOrder?.length ? 'hold' : null)),
    lastRolledKey: data.lastRolledKey || null,
    goal: data.goal,
    cash: data.cash ?? DEFAULT_CASH,
    mapId: data.mapId,
    mode: 'guest',
    _revealSeq: prev?._revealSeq || null,
  };
  showOrderRollScreen();
  if (awaitingConfirm) {
    clearOrderRollRevealTimers();
  } else if (finalOrder?.length) {
    ensureOrderRollRevealPipeline();
  }
}

function showOrderRollScreen() {
  showScreen('screen-order-roll');
  renderOrderRollUi();
  const btn = $('#btn-order-roll');
  if (!btn) return;
  btn.onclick = () => {
    audio.sfx.click();
    const o = app.orderRoll;
    if (o?.awaitingConfirm) {
      confirmOrderRollStart();
      return;
    }
    claimOrderRoll();
  };
}

function orderRollCanConfirm() {
  const o = app.orderRoll;
  if (!o?.awaitingConfirm) return false;
  return o.mode === 'host' || o.mode === 'local';
}

/** 出目そろい後のホールド〜並べ替えタイマーを解除 */
function clearOrderRollRevealTimers() {
  if (app._orderRevealHoldTimer) {
    clearTimeout(app._orderRevealHoldTimer);
    app._orderRevealHoldTimer = null;
  }
}

const ORDER_ROLL_REVEAL_HOLD_MS = 1300;
const ORDER_ROLL_SORT_MS = 580;

function renderOrderRollUi() {
  const o = app.orderRoll;
  if (!o) return;
  const list = $('#order-roll-list');
  const status = $('#order-roll-status');
  const hint = $('#order-roll-hint');
  const resultEl = $('#order-roll-result');
  const btn = $('#btn-order-roll');
  const myKey = orderRollMyKey();
  const pendingSet = new Set(o.pending || []);
  const hasFinal = Array.isArray(o.finalOrder) && o.finalOrder.length > 0;
  const revealing = hasFinal && !o.awaitingConfirm;
  const awaiting = !!o.awaitingConfirm && hasFinal;
  if (hint) {
    if (awaiting) {
      hint.textContent = '出目がそろいました。下の順番を確認してください。';
    } else if (revealing) {
      hint.textContent = '全員の出目がそろいました。大きい順に並べ替えます…';
    } else {
      hint.textContent = o.round > 1
        ? `同じ出目の人だけ振り直し（${o.round}回目）。1〜100・大きいほど先手。スペースでも振れます。`
        : '1〜100の出目が大きいほど先手。同じ出目の人だけ振り直します。スペースでも振れます。';
    }
  }
  if (list && o.revealPhase !== 'sorting') {
    const byKey = new Map(o.players.map((p) => [p.key, p]));
    const rows = awaiting
      ? o.finalOrder.map((key, i) => ({ p: byKey.get(key), rank: i + 1 })).filter((r) => r.p)
      : o.players.map((p) => ({ p, rank: 0 }));
    list.innerHTML = rows.map(({ p, rank }) => {
      const rolled = Number.isFinite(o.rolls[p.key]);
      const waiting = !awaiting && !revealing && pendingSet.has(p.key);
      const justRolled = !awaiting && o.lastRolledKey === p.key;
      const cls = [
        'order-roll-row',
        awaiting ? 'ranked' : '',
        awaiting && rank === 1 ? 'first' : '',
        waiting ? 'pending' : '',
        waiting && o.round > 1 ? 'tied' : '',
        justRolled ? 'just-rolled' : '',
        revealing ? 'reveal-hold' : '',
      ].filter(Boolean).join(' ');
      const dice = rolled ? String(o.rolls[p.key]) : (waiting ? '待ち' : '—');
      const rankHtml = awaiting
        ? `<span class="or-rank">${rank}位</span>`
        : '';
      return `<div class="${cls}" data-key="${escapeHtml(p.key)}" style="--pc:${p.color || PLAYER_COLORS[0]}">
        ${rankHtml}
        <span class="or-dot"></span>
        <span>${escapeHtml(p.name)}${p.isCPU ? '（CPU）' : ''}${p.disconnected ? '（切断）' : ''}${p.key === myKey ? '（あなた）' : ''}</span>
        <span class="or-dice">${escapeHtml(dice)}</span>
      </div>`;
    }).join('');
  }
  if (resultEl) {
    if (awaiting) {
      const byKey = new Map(o.players.map((p) => [p.key, p]));
      const names = o.finalOrder
        .map((key) => byKey.get(key))
        .filter(Boolean)
        .map((p, i) => `${i + 1}位 ${p.name}${p.isCPU ? '（CPU）' : ''}`);
      resultEl.hidden = false;
      resultEl.innerHTML = `<strong>手番順</strong>：${names.map(escapeHtml).join(' → ')}`;
    } else {
      resultEl.hidden = true;
      resultEl.textContent = '';
    }
  }
  const canRoll = !awaiting
    && !revealing
    && !!myKey
    && pendingSet.has(myKey)
    && !o.players.find((p) => p.key === myKey)?.isCPU;
  const canConfirm = orderRollCanConfirm();
  if (btn) {
    if (awaiting) {
      btn.disabled = !canConfirm;
      btn.textContent = canConfirm ? 'この順番で開始' : 'ホストの開始待ち';
    } else if (revealing) {
      btn.disabled = true;
      btn.textContent = '並べ替え中…';
    } else {
      btn.disabled = !canRoll;
      btn.textContent = o.round > 1 ? 'もう一度振る' : 'サイコロを振る';
    }
  }
  if (status) {
    if (awaiting) {
      status.textContent = canConfirm
        ? '順番を確認して「この順番で開始」を押してください（スペースでも可）'
        : 'ホストが開始するまでお待ちください…';
    } else if (revealing) {
      status.textContent = o.revealPhase === 'sorting'
        ? '出目の大きい順に並べ替えています…'
        : '全員の出目を確認しています…';
    } else if (!pendingSet.size) {
      status.textContent = '結果を集計しています…';
    } else if (canRoll) {
      status.textContent = 'あなたの番です。サイコロを振ってください';
    } else {
      status.textContent = '他のプレイヤーの出目を待っています…';
    }
  }
}

function orderRollMyKey() {
  const o = app.orderRoll;
  if (!o) return null;
  if (o.mode === 'local') {
    // 未ロールの人間を順に振る（ボタン1つで回す）
    const pendingHuman = o.players.find((p) => !p.isCPU && (o.pending || []).includes(p.key));
    return pendingHuman?.key || null;
  }
  if (o.mode === 'host') {
    return o.players.find((p) => p.peerId === app.net?.peerId)?.key || null;
  }
  return o.players.find((p) => p.peerId === app.net?.peerId)?.key || null;
}

function claimOrderRoll() {
  const o = app.orderRoll;
  if (!o) return;
  const myKey = orderRollMyKey();
  if (!myKey || !(o.pending || []).includes(myKey)) return;
  if (o.mode === 'guest') {
    const sent = app.net?.sendToHost({ type: 'order_roll_claim', peerId: app.net.peerId });
    if (!sent) {
      toast('ホストに届きませんでした。再接続を試してください');
      renderOrderRollUi();
    }
    return;
  }
  // host / local: 自分で確定
  resolveOrderRollClaim(myKey);
}

function handleOrderRollClaim(from) {
  const o = app.orderRoll;
  if (!o || (app.mode !== 'host' && o.mode !== 'local')) return;
  const key = o.players.find((p) => p.peerId === from || p.key === from)?.key;
  if (!key) return;
  resolveOrderRollClaim(key);
}

function resolveOrderRollClaim(key) {
  const o = app.orderRoll;
  if (!o) return;
  if (!(o.pending || []).includes(key)) return;
  if (Number.isFinite(o.rolls[key])) return;
  o.rolls[key] = rollOrderDie();
  o.lastRolledKey = key;
  try { audio.sfx.dice(); } catch (_) { audio.sfx.click(); }
  o.pending = o.pending.filter((k) => k !== key);
  renderOrderRollUi();
  broadcastOrderRollSync();
  if (o.pending.length) {
    scheduleOrderRollCpus();
    return;
  }
  finishOrderRollRound();
}

function scheduleOrderRollCpus() {
  const o = app.orderRoll;
  if (!o) return;
  if (o.mode === 'guest') return;
  const cpus = o.players.filter((p) => p.isCPU && (o.pending || []).includes(p.key));
  cpus.forEach((p, i) => {
    setTimeout(() => {
      if (!app.orderRoll) return;
      resolveOrderRollClaim(p.key);
    }, 350 + i * 280);
  });
}

/** 順番決め中に切断したプレイヤーが戻らないとき、出目待ちなら代行で振る */
function scheduleOrderRollDisconnectRecovery(key) {
  if (!key) return;
  setTimeout(() => {
    const o = app.orderRoll;
    if (!o || o.mode === 'guest') return;
    const p = o.players.find((x) => x.key === key);
    if (!p?.disconnected) return;
    if (o.awaitingConfirm) return;
    if (!(o.pending || []).includes(key)) return;
    toast(`${p.name} が戻らないため代行で振ります`);
    resolveOrderRollClaim(key);
  }, 15000);
}

function finishOrderRollRound() {
  const o = app.orderRoll;
  if (!o) return;
  const result = evaluateOrderRolls(o.players, o.rolls);
  if (!result.done) {
    clearOrderRollRevealTimers();
    o.awaitingConfirm = false;
    o.finalOrder = null;
    o.revealPhase = null;
    o.pending = result.rerollKeys;
    o.round += 1;
    for (const k of result.rerollKeys) delete o.rolls[k];
    renderOrderRollUi();
    broadcastOrderRollSync();
    toast('同点の人だけもう一度振ります');
    scheduleOrderRollCpus();
    return;
  }
  o.pending = [];
  o.awaitingConfirm = false;
  o.finalOrder = result.order.slice();
  o.revealPhase = 'hold';
  renderOrderRollUi();
  broadcastOrderRollSync();
  ensureOrderRollRevealPipeline();
}

/**
 * 全員出目後: ホールドで最後の出目を見せ → FLIP並べ替え → 順位確定表示
 */
function ensureOrderRollRevealPipeline() {
  const o = app.orderRoll;
  if (!o?.finalOrder?.length) return;
  if (o.awaitingConfirm) {
    o.revealPhase = 'done';
    clearOrderRollRevealTimers();
    return;
  }
  const seq = `${o.round}:${o.finalOrder.join('|')}`;
  if (o._revealSeq === seq && (o.revealPhase === 'hold' || o.revealPhase === 'sorting')) {
    return;
  }
  o._revealSeq = seq;
  o.revealPhase = 'hold';
  clearOrderRollRevealTimers();
  renderOrderRollUi();
  app._orderRevealHoldTimer = setTimeout(() => {
    void runOrderRollSortThenConfirm(seq);
  }, ORDER_ROLL_REVEAL_HOLD_MS);
}

async function runOrderRollSortThenConfirm(seq) {
  const o = app.orderRoll;
  if (!o || o._revealSeq !== seq || o.awaitingConfirm) return;
  const reduceMotion = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
  o.revealPhase = 'sorting';
  renderOrderRollUi();
  if (!reduceMotion) {
    try {
      await playOrderRollSortAnimation(o.finalOrder);
    } catch (_) { /* ignore */ }
  }
  if (!app.orderRoll || app.orderRoll._revealSeq !== seq) return;
  o.revealPhase = 'done';
  o.awaitingConfirm = true;
  o.lastRolledKey = null;
  renderOrderRollUi();
  if (o.mode === 'host' || o.mode === 'local') {
    broadcastOrderRollSync();
    toast('順番が決まりました');
  }
}

/** FLIP で座席順 → 出目順へ並べ替え */
function playOrderRollSortAnimation(orderKeys) {
  const list = $('#order-roll-list');
  if (!list || !orderKeys?.length) return Promise.resolve();
  const rows = [...list.querySelectorAll('.order-roll-row')];
  if (rows.length < 2) return Promise.resolve();
  const byKey = new Map(rows.map((el) => [el.dataset.key, el]));
  const first = new Map();
  for (const el of rows) {
    first.set(el.dataset.key, el.getBoundingClientRect());
  }
  for (const key of orderKeys) {
    const el = byKey.get(key);
    if (el) list.appendChild(el);
  }
  for (const key of orderKeys) {
    const el = byKey.get(key);
    if (!el) continue;
    const last = el.getBoundingClientRect();
    const f = first.get(key);
    if (!f) continue;
    const dy = f.top - last.top;
    el.style.transition = 'none';
    el.style.transform = dy ? `translateY(${dy}px)` : '';
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const live = [...list.querySelectorAll('.order-roll-row')];
        for (const el of live) {
          el.style.transition = `transform ${ORDER_ROLL_SORT_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
          el.style.transform = '';
        }
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          for (const el of live) {
            el.style.transition = '';
            el.style.transform = '';
          }
          resolve();
        };
        const fallback = setTimeout(finish, ORDER_ROLL_SORT_MS + 80);
        const probe = live.find((el) => el.style.transition) || live[0];
        if (!probe) {
          clearTimeout(fallback);
          finish();
          return;
        }
        probe.addEventListener('transitionend', (ev) => {
          if (ev.propertyName && ev.propertyName !== 'transform') return;
          clearTimeout(fallback);
          finish();
        }, { once: true });
      });
    });
  });
}

function confirmOrderRollStart() {
  const o = app.orderRoll;
  if (!o?.awaitingConfirm || !Array.isArray(o.finalOrder) || !o.finalOrder.length) return;
  if (!orderRollCanConfirm()) return;
  const ordered = o.finalOrder.map((key) => o.players.find((p) => p.key === key)).filter(Boolean);
  const players = ordered.map((p) => ({
    peerId: p.peerId,
    name: p.name,
    color: p.color,
    isCPU: !!p.isCPU,
  }));
  const goal = o.goal;
  const cash = o.cash ?? DEFAULT_CASH;
  const mapId = o.mapId;
  const mode = o.mode;
  clearOrderRollRevealTimers();
  app.orderRoll = null;

  if (mode === 'local') {
    app.mode = 'local';
    app.game = createGame({ players, goal, cash, mapId });
    app.localSeat = players.findIndex((p) => !p.isCPU);
    if (app.localSeat < 0) app.localSeat = 0;
    enterGame();
    return;
  }

  // host online
  app.game = createGame({ players, goal, cash, mapId });
  app.localSeat = app.game.players.findIndex((p) => p.peerId === app.net?.peerId);
  if (app.localSeat < 0) app.localSeat = 0;
  app.net.broadcast({
    type: 'game_start',
    state: serializeState(app.game),
    seatMap: players.map((p) => p.peerId),
  });
  enterGame();
  saveRejoinSession();
}

function startLocal(seats) {
  const params = new URLSearchParams(location.search);
  const demo = params.get('demo');
  const mapFromDemo = demo === 'map-cliff' ? 'cliff_isle'
    : demo === 'map-shell' ? 'shell_harbor'
      : demo === 'map-torima' || demo === 'map-arch' ? 'torima'
        : demo === 'map-bullet' ? 'bullet'
          : demo === 'map-tagai' ? 'tagai'
            : demo === 'map-kurechigai' ? 'kurechigai'
              : demo === 'map-sky' || demo === 'map-sky-isles' ? 'sky_isles'
                : demo === 'map-mine' || demo === 'map-greed-mine' ? 'greed_mine'
                  : params.get('map');
  const mapId = mapFromDemo || selectedMapId('#setup-map-options');
  const mapDef = MAP_CATALOG.find((m) => m.id === mapId);
  const goalFromUi = Number($('#setup-goal')?.value);
  const goal = mapFromDemo
    ? (mapDef?.defaultGoal)
    : (goalFromUi || mapDef?.defaultGoal || 10000);
  const cash = mapFromDemo
    ? (mapDef?.defaultCash ?? DEFAULT_CASH)
    : readStartCash('setup-cash');
  // デモ直入れは順番ダイスを飛ばす
  if (demo) {
    app.game = createGame({ players: seats, goal, cash, mapId });
    app.localSeat = seats.findIndex((s) => !s.isCPU);
    if (app.localSeat < 0) app.localSeat = 0;
    enterGame();
    maybeDemoLanding();
    return;
  }
  const players = seats.map((s, i) => ({
    ...s,
    peerId: s.isCPU ? `cpu-local-${i}` : `local-${i}`,
    key: s.isCPU ? `cpu-local-${i}` : `local-${i}`,
  }));
  beginOrderRoll({ players, goal, cash, mapId, mode: 'local' });
}

function maybeDemoLanding() {
  const demo = new URLSearchParams(location.search).get('demo');
  if (!demo || !app.game) return;
  const p = currentPlayer(app.game);
  if (!p) return;
  if (demo === 'invest-half') {
    p.flags.investCoupon = true;
    const shop = app.game.map.find((n) => n.type === 'shop');
    if (shop) {
      shop.owner = p.id;
      shop.extraInvest = 0;
      shop.price = shop.basePrice;
    }
    app.game.phase = 'await_choice';
    app.game.pending = {
      type: 'invest',
      playerId: p.id,
      shopId: shop?.id,
      landedShopId: shop?.id,
      shopIds: shop ? [shop.id] : [],
      remaining: 200,
      toll: 0,
    };
    refreshGameUI();
    return;
  }
  if (demo === 'scratch' || demo === 'scratch-match') {
    const mark = app.game.map.find((n) => n.type === 'mark');
    if (!mark) return;
    const table = getSharedEventTable(app.game);
    if (demo === 'scratch-match') {
      // 先頭行に2つ塗っておき、3つ目でそろい演出を確認できる
      const who = app.game.players[0];
      for (const i of [0, 1]) {
        const cell = table.cells[i];
        cell.scratched = true;
        cell.scratchedBy = who.id;
        cell.color = who.id;
        cell.group = who.id;
      }
    } else {
      // 開けた人の色で塗られた状態を見せる（イベント効果は適用しない）
      for (let i = 0; i < Math.min(12, table.cells.length); i++) {
        const who = app.game.players[i % app.game.players.length];
        const cell = table.cells[i];
        cell.scratched = true;
        cell.scratchedBy = who.id;
        cell.color = who.id;
        cell.group = who.id;
      }
    }
    p.pos = mark.id;
    app.game.phase = 'moving';
    app.game.move = { stepsLeft: 0, path: [mark.id], passedBank: false, startPos: app.game.startId };
    advanceMove(app.game);
    refreshGameUI();
    return;
  }
  if (demo === 'warp') {
    const shops = app.game.map.filter((n) => n.type === 'shop');
    const from = shops[2] || shops[0] || app.game.map[0];
    const to = app.game.map.find((n) => n.type === 'bank') || shops[5] || app.game.map[1];
    p.pos = to.id;
    armWarpHolds([{ pid: p.id, from: from.id, to: to.id }]);
    refreshGameUI();
    setTimeout(() => {
      presentWarpFx([{ pid: p.id, from: from.id, to: to.id }]);
    }, 400);
    return;
  }
  if (demo === 'monopoly') {
    const area = Number(Object.keys(app.game.areas)[0]);
    const shops = getAreaShops(app.game, area);
    for (let i = 0; i < shops.length - 1; i++) shops[i].owner = p.id;
    const last = shops[shops.length - 1];
    p.cash = Math.max(p.cash, last.price + 1000);
    p.pos = last.id;
    app.game.phase = 'await_choice';
    app.game.pending = { type: 'buy_shop', playerId: p.id, shopId: last.id, price: last.price };
    refreshGameUI();
    setTimeout(() => sendAction({ type: 'choice', choice: { action: 'buy' } }), 700);
    return;
  }
  if (demo === 'stock') {
    // 株購入UI＋盤面エリアハイライトのデモ
    p.cash = Math.max(p.cash, 5000);
    p.pos = app.game.startId;
    app.game.phase = 'await_choice';
    app.game.pending = {
      type: 'stock',
      playerId: p.id,
      bankVisit: true,
      atBank: true,
      maxBuys: 1,
    };
    app.game.move = null;
    refreshGameUI();
    return;
  }
  if (demo === 'stock-div' || demo === 'dividend') {
    // エリア収益の株わけ前デモ（ログ＋現金演出）
    const area = Number(Object.keys(app.game.areas)[0]);
    const areaName = app.game.areas[area]?.name || getAreaCode(app.game, area);
    p.stocks[area] = Math.max(p.stocks[area] || 0, 3);
    const other = app.game.players[1];
    if (other) other.stocks[area] = Math.max(other.stocks[area] || 0, 1);
    app.prevCash = Object.fromEntries(app.game.players.map((pl) => [pl.id, pl.cash]));
    payAreaStockDividend(app.game, area, 1000);
    enqueueBanner({
      kicker: '株わけ前',
      title: 'エリア収益の分配',
      detail: app.game.logs.find((l) => /株わけ前/.test(l.text))?.text
        || `${getAreaCode(app.game, area)}「${areaName}」株わけ前（収益 1000G の一部）`,
      kind: 'stock',
      color: '#3d8bfd',
      mine: true,
    });
    refreshGameUI();
    return;
  }
  if (
    demo === 'minigame' || demo === 'slot' || demo === 'coin' || demo === 'high_low'
    || demo === 'memory_match' || demo === 'silent_bid' || demo === 'push_pull'
    || demo === 'divide_pool' || demo === 'target_roulette' || demo === 'hot_potato'
    || demo === 'pick_dice'
  ) {
    if (demo === 'pick_dice') {
      app.game.phase = 'await_choice';
      app.game.pending = { type: 'pick_dice', playerId: p.id };
      app.game.move = null;
      refreshGameUI();
      return;
    }
    const game = demo === 'minigame' ? 'guess_dice' : demo;
    const labels = {
      guess_dice: 'サイコロ当て',
      slot: 'スロット',
      coin: 'コイントス',
      high_low: 'ハイ＆ロー',
      memory_match: '神経衰弱',
      silent_bid: 'かぶりなし賞金',
      push_pull: '押し引き',
      divide_pool: '配分ゲーム',
      target_roulette: 'ターゲットルーレット',
      hot_potato: 'パス禁止',
    };
    const partyGames = new Set([
      'guess_dice', 'coin', 'high_low', 'horse_race', 'roulette',
      'silent_bid', 'hot_potato', 'target_roulette',
    ]);
    const alive = app.game.players.filter((pl) => !pl.bankrupt).map((pl) => pl.id);
    const ordered = partyGames.has(game)
      ? [p.id, ...alive.filter((id) => id !== p.id)]
      : [p.id];
    app.game.phase = 'await_choice';
    app.game.pending = {
      type: 'minigame',
      playerId: ordered[0],
      starterId: p.id,
      game,
      label: labels[game] || 'ミニゲーム',
      participantIds: ordered,
      picks: {},
      party: ordered.length > 1,
    };
    // silent_bid（かぶりなし賞金）は固定三択のため pot 不要
    app.game.move = null;
    refreshGameUI();
    return;
  }
  if (demo === 'party-result') {
    // 全員参加ミニゲーム結果ボードの見た目確認用
    const players = app.game.players.filter((pl) => !pl.bankrupt);
    const reveal = {
      game: 'guess_dice',
      label: 'サイコロ当て',
      shared: { roll: 4 },
      results: players.map((pl, i) => {
        const exact = i === 0;
        const near = i === 1;
        // 予想はそれぞれ異なる目（デモ用）。出目は共有の 4
        const pick = exact ? 4 : near ? 5 : (i === 2 ? 3 : 2);
        return {
          playerId: pl.id,
          playerName: pl.name,
          playerColor: pl.color,
          pick,
          win: exact || near,
          tier: exact ? 'exact' : near ? 'near' : 'miss',
          title: exact ? 'ぴったり！' : near ? 'おしい！' : 'ハズレ…',
          detail: exact ? 'ぴったり！出目4 → +180G' : near ? 'おしい！ → +70G' : '参加賞 +20G',
          prizeWon: exact ? 180 : near ? 70 : 20,
          messages: [],
          outcome: { roll: 4, pick },
        };
      }),
      playerId: players[0]?.id,
      playerName: players[0]?.name || '',
      playerColor: players[0]?.color || '#c4a574',
      outcome: { roll: 4 },
      tier: 'exact',
      win: true,
      title: 'ぴったり！',
      detail: '',
      messages: [],
    };
    refreshGameUI();
    presentMinigameResult({ reveal, messages: [] });
    return;
  }
  if (demo === 'trade' || demo === 'trade-offer') {
    const shops = app.game.map.filter((s) => s.type === 'shop');
    const mine = shops.filter((_, i) => i % 2 === 0).slice(0, 2);
    const theirs = shops.filter((_, i) => i % 2 === 1).slice(0, 2);
    for (const sq of mine) sq.owner = p.id;
    const other = app.game.players.find((pl) => pl.id !== p.id) || app.game.players[1];
    for (const sq of theirs) sq.owner = other.id;
    p.cash = Math.max(p.cash, 3000);
    other.cash = Math.max(other.cash, 3000);
    app.game.phase = 'await_choice';
    app.game.pending = {
      type: 'shop_trade_offer',
      playerId: p.id,
      fromId: other.id,
      giveShopIds: theirs.map((s) => s.id),
      takeShopIds: mine.map((s) => s.id),
      cashDelta: 120,
      counterCashDelta: 120,
    };
    app.game.move = null;
    refreshGameUI();
    return;
  }
  if (demo === 'results') {
    seedResultsDemo(app.game);
    refreshGameUI();
    return;
  }
  if (demo === 'event-fx' || demo === 'roll-tabs') {
    // 所持タブでもサイコロが使えること＋イベントフラッシュのデモ
    setSideTab('holdings');
    refreshGameUI();
    const demos = [
      { kicker: '買い物料', title: '−420G', detail: 'あか が あお の「さくら茶屋」へ支払い', kind: 'toll', color: '#e85d75' },
      { kicker: 'お店', title: '購入！', detail: 'あかが「青空マーケット」を購入', kind: 'shop', color: '#e85d75' },
      { kicker: '昇進！', title: 'レベルアップ', detail: 'あか 昇進！ Lv.2→3', kind: 'level', color: '#e85d75' },
      { kicker: 'マーク入手！', title: '♠', detail: 'あかがマーク♠を入手', kind: 'mark', color: '#e85d75' },
      { kicker: '株式取引', title: '株を購入', detail: 'あかが A1株×10 購入', kind: 'stock', color: '#3d8bfd' },
      { kicker: '株わけ前', title: 'エリア収益の分配', detail: 'A1「さくら通り」株わけ前 あか+60G（収益 1000G の一部）', kind: 'stock', color: '#3d8bfd' },
      { kicker: 'ミニゲーム', title: '結果発表', detail: 'あかのスロット → 当たり +200G', kind: 'event', color: '#c4a574' },
    ];
    // クリックで1件ずつ確認（自動では閉じない）
    for (const d of demos) enqueueBanner({ ...d, mine: true });
    return;
  }
  if (demo === 'money-fx' || demo === 'money-loss' || demo === 'money-invest') {
    refreshGameUI();
    const p0 = app.game.players[0];
    const p1 = app.game.players[1];
    app.prevCash = Object.fromEntries(app.game.players.map((p) => [p.id, p.cash]));
    if (demo === 'money-loss') {
      // 買い物料の支払い表示確認
      app.game.logs.unshift({
        text: `${p0.name} → ${p1?.name || 'あお'}「さくら茶屋」買い物料 420G`,
        kind: 'toll',
        t: Date.now(),
      });
      p0.cash -= 420;
      if (p1) p1.cash += 420;
      refreshGameUI();
      return;
    }
    if (demo === 'money-invest') {
      // 通常購入＝投資扱いの表示確認
      const price = 290;
      app.game.logs.unshift({
        text: `${p0.name} が「青空マーケット」を購入（${price}G）`,
        kind: 'shop',
        t: Date.now(),
      });
      p0.cash -= price;
      refreshGameUI();
      return;
    }
    // 収入 → 買い物料 → 臨時収入（本番と同じ現金表示経路）
    app.game.logs.unshift({ text: `${p0.name} 昇進！ 賞金 +850G`, kind: 'level', t: Date.now() });
    p0.cash += 850;
    refreshGameUI();
    setTimeout(() => {
      app.game.logs.unshift({
        text: `${p0.name} → ${p1?.name || 'あお'}「さくら茶屋」買い物料 420G`,
        kind: 'toll',
        t: Date.now(),
      });
      p0.cash -= 420;
      if (p1) p1.cash += 420;
      refreshGameUI();
    }, 1600);
    setTimeout(() => {
      app.game.logs.unshift({ text: `${p0.name} 臨時収入 +1600G`, kind: 'event', t: Date.now() });
      p0.cash += 1600;
      refreshGameUI();
    }, 3200);
  }
}

/** 終了画面デモ用に統計と資産をセット */
function seedResultsDemo(g) {
  const presets = [
    {
      cash: 4200,
      level: 4,
      stats: {
        rolls: 28, diceTotal: 98, tollEarned: 6200, tollPaid: 1800,
        tollSaleCount: 12, tollPayCount: 5, tollSaleMax: 980, tollPayMax: 520,
        dividendEarned: 420, shopsBought: 7, shopsStolen: 1, investTotal: 3400,
        salaryEarned: 2100, levelUps: 3, monopolyCount: 2, monopolyBonus: 1800,
        stockBought: 40, stockSpent: 2200, stockSold: 8, stockIncome: 500, stockReturn: 640,
        scratchCount: 6, matchBonus: 300, minigamePlays: 3, minigameWins: 2, minigamePrize: 520,
        nudgeSent: 5, nudgeReceived: 1,
      },
    },
    {
      cash: 2800,
      level: 3,
      stats: {
        rolls: 26, diceTotal: 90, tollEarned: 3100, tollPaid: 2400,
        tollSaleCount: 8, tollPayCount: 9, tollSaleMax: 610, tollPayMax: 740,
        dividendEarned: 980, shopsBought: 4, shopsStolen: 0, investTotal: 900,
        salaryEarned: 1200, levelUps: 2, monopolyCount: 0, monopolyBonus: 0,
        stockBought: 85, stockSpent: 4800, stockSold: 20, stockIncome: 1400, stockReturn: 1280,
        scratchCount: 4, matchBonus: 100, minigamePlays: 2, minigameWins: 0, minigamePrize: 0,
        nudgeSent: 2, nudgeReceived: 4,
      },
    },
    {
      cash: 1500,
      level: 3,
      stats: {
        rolls: 24, diceTotal: 85, tollEarned: 4500, tollPaid: 3200,
        tollSaleCount: 10, tollPayCount: 11, tollSaleMax: 880, tollPayMax: 690,
        dividendEarned: 200, shopsBought: 6, shopsStolen: 2, investTotal: 2100,
        salaryEarned: 900, levelUps: 2, monopolyCount: 1, monopolyBonus: 900,
        stockBought: 15, stockSpent: 800, stockSold: 5, stockIncome: 280, stockReturn: -180,
        scratchCount: 8, matchBonus: 450, minigamePlays: 5, minigameWins: 3, minigamePrize: 780,
        nudgeSent: 1, nudgeReceived: 2,
      },
    },
    {
      cash: 600,
      level: 2,
      stats: {
        rolls: 22, diceTotal: 70, tollEarned: 800, tollPaid: 4100,
        tollSaleCount: 3, tollPayCount: 14, tollSaleMax: 320, tollPayMax: 910,
        dividendEarned: 60, shopsBought: 2, shopsStolen: 0, investTotal: 200,
        salaryEarned: 400, levelUps: 1, monopolyCount: 0, monopolyBonus: 0,
        stockBought: 10, stockSpent: 400, stockSold: 2, stockIncome: 90, stockReturn: -90,
        scratchCount: 3, matchBonus: 50, minigamePlays: 1, minigameWins: 0, minigamePrize: 0,
        nudgeSent: 0, nudgeReceived: 3,
      },
    },
  ];

  const areaIds = Object.keys(g.areas).map(Number);
  for (const sq of g.map.filter((n) => n.type === 'shop')) {
    sq.owner = -1;
    sq.extraInvest = 0;
    sq.price = sq.basePrice;
  }

  g.players.forEach((p, i) => {
    const preset = presets[i] || presets[presets.length - 1];
    p.cash = preset.cash;
    p.level = preset.level;
    p.bankrupt = false;
    p.stats = { ...createEmptyStats(), ...preset.stats };
    p.stocks = {};
    if (areaIds[0] != null) p.stocks[areaIds[0]] = i === 1 ? 50 : 8;
    if (areaIds[1] != null) p.stocks[areaIds[1]] = i === 1 ? 30 : 5;
  });

  // 店舗配分（0が最多→土地王、2も多め）
  const shops = g.map.filter((n) => n.type === 'shop');
  const owners = [0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 1, 1, 1, 1, 3, 3];
  shops.forEach((sq, i) => {
    const oid = owners[i % owners.length];
    sq.owner = oid;
    if (oid === 0) {
      sq.extraInvest = 80;
      sq.price = sq.basePrice + 80;
    } else if (oid === 2) {
      sq.extraInvest = 40;
      sq.price = sq.basePrice + 40;
    }
  });

  // 0番エリアを0番プレイヤーで独占しやすいよう調整
  const a0 = areaIds[0];
  if (a0 != null) {
    for (const sq of getAreaShops(g, a0)) {
      sq.owner = 0;
      sq.extraInvest = 100;
      sq.price = sq.basePrice + 100;
    }
  }

  updateAreaStockPrices(g);
  // 株価更新後にデモ用リターンを上書き（価格変動分で上書きされないように）
  const demoReturns = [640, 1280, -180, -90];
  g.players.forEach((p, i) => {
    ensureStats(p).stockReturn = demoReturns[i] ?? 0;
  });

  // 本家風グラフ用の仮推移
  const startCash = 2500;
  const finals = g.players.map((p) => getPlayerAssets(g, p).total);
  g.worthHistory = [];
  for (let t = 1; t <= 18; t++) {
    const r = (t - 1) / 17;
    const values = {};
    g.players.forEach((p, i) => {
      const wobble = Math.sin(t * 0.7 + i) * 180 * (1 - r);
      values[p.id] = Math.max(0, Math.round(startCash + (finals[i] - startCash) * r + wobble));
    });
    g.worthHistory.push({ turn: t, values });
  }

  g.goal = Math.min(g.goal, 8000);
  g.turn = 18;
  g.winnerId = 0;
  g.phase = 'gameover';
  g.pending = null;
  g.move = null;
}

function enterGame() {
  showScreen('screen-game');
  audio.resume();
  audio.startBgm();
  app.hideDiceResult = false;
  app.lastSeenLogKey = null;
  app.prevCash = null;
  app.pendingMoneyFx = null;
  app.eventFlashQueue = [];
  app.eventFlashOpen = false;
  app.eventFlashHoldingBusy = false;
  app.actionActorId = null;
  app.eventFlashReaderId = null;
  app.deferEventFlash = false;
  clearAllDisconnectTimers();
  clearTimeout(app.eventFlashTimer);
  clearTimeout(app.eventFlashNpcTimer);
  clearTimeout(app.eventFlashDismissWait);
  app.eventFlashDismissWait = null;
  const flash = $('#event-flash');
  if (flash) {
    flash.hidden = true;
    flash.classList.remove('show');
    flash.dataset.spectator = '0';
    flash.dataset.npc = '0';
  }
  app.feedPinnedBottom = true;
  app.feedAutoExpand = true;
  $('#event-feed-wrap')?.classList.add('feed-collapsed');
  app.nudgeCooldownUntil = 0;
  app.nudgeLastBySeat = {};
  clearTimeout(app.nudgeUiTimer);
  app.nudgeUiTimer = null;
  const feed = $('#event-feed');
  if (feed) feed.innerHTML = '';
  const canvas = $('#board');
  app.renderer = createRenderer(canvas);
  app.renderer.resize();
  window.addEventListener('resize', () => {
    app.renderer?.resize();
    if (app.modalDrag) applyModalPosition();
  });
  app.renderer.startLoop(() => ({
    game: app.game,
    hideDiceResult: !!app.hideDiceResult,
  }));
  bindBoardZoomControls(canvas);
  bindGameControls();
  bindModalTools();
  bindModalDrag();
  app.lastTurnKey = null;
  saveRejoinSession();
  closeSideSheet();
  setSideTab('turn');
  // スマホはマス詳細を常時出さず、タップするまで非表示
  app.inspectedId = isMobileUi() ? null : app.game.startId;
  updateInspectPanel();
  refreshGameUI();
  maybeYourTurnChime();
  maybeAutoSkipRest();
  scheduleCpu();
}

function renderMobilePlayerStrip(g) {
  const strip = $('#mobile-player-strip');
  if (!strip) return;
  strip.innerHTML = g.players.map((p) => {
    const a = getPlayerAssets(g, p);
    const active = g.currentPlayerIdx === p.id ? 'active' : '';
    const me = p.id === app.localSeat ? 'me' : '';
    const bust = p.bankrupt ? 'bust' : '';
    return `<button type="button" class="mps-chip ${active} ${me} ${bust}" data-pid="${p.id}" style="--pc:${p.color}" title="${escapeHtml(p.name)}">
      <span class="mps-dot" aria-hidden="true"></span>
      <span class="mps-name">${escapeHtml(p.name)}</span>
      <span class="mps-cash${a.cash < 0 ? ' debt' : ''}">${p.bankrupt ? '破産' : `${a.cash.toLocaleString()}G`}</span>
    </button>`;
  }).join('');
  strip.querySelectorAll('.mps-chip').forEach((btn) => {
    btn.onclick = () => {
      openSideSheet('turn');
      const card = document.querySelector(`#players-panel .player-card[data-pid="${btn.dataset.pid}"]`);
      card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      audio.sfx.click();
    };
  });
}

function updateInspectPanel() {
  const el = $('#inspect');
  const body = $('#inspect-body') || el;
  if (!el || !app.game) return;
  const g = app.game;
  const sq = app.inspectedId != null ? getNode(g, app.inspectedId) : null;
  if (!sq) {
    el.classList.add('inspect-empty');
    if (body) {
      body.innerHTML = '<strong>マス情報</strong><span class="inspect-sub">マスをタップして詳細を表示</span>';
    }
    // スマホは常時プレースホルダを出さず、タップ時のみ表示
    el.hidden = isMobileUi();
    return;
  }
  el.hidden = false;
  el.classList.remove('inspect-empty');
  if (sq.type === 'shop') {
    const owner = sq.owner >= 0 ? g.players[sq.owner] : null;
    const toll = calcToll(g, sq);
    const closed = !!(owner?.shopsClosed);
    const areaName = g.areas?.[sq.area]?.name || AREA_META[sq.area]?.name || getAreaCode(g, sq.area);
    const remInvest = getRemainingInvest(g, sq);
    const maxInvest = getMaxExtraInvest(g, sq);
    let mono = '';
    if (owner) {
      const areaSize = getAreaShops(g, sq.area).length;
      const cnt = getPlayerAreaCount(g, owner.id, sq.area);
      const multi = getTollMulti(cnt, areaSize);
      if (hasAreaMonopoly(g, owner.id, sq.area)) mono = `独占 ×${multi}`;
      else if (cnt > 1) mono = `${cnt}/${areaSize}軒 ×${multi}`;
    }
    const ownMine = owner && (app.mode === 'local' ? !owner.isCPU : owner.id === app.localSeat);
    const tollClass = !owner ? 'vacant' : (closed ? 'closed' : (ownMine ? 'mine' : 'enemy'));
    const tollLead = !owner
      ? '空き店'
      : (closed ? '店休中' : (ownMine ? '相手が止まると収入' : '止まると支払い'));
    const tollAmount = !owner
      ? '買い物料なし'
      : (closed ? '0G' : `${toll.toLocaleString()}G`);
    const investLine = !owner
      ? '残り増資額 —（所有後に枠が開く）'
      : `残り増資額 ${remInvest.toLocaleString()}G` + (
        maxInvest > 0 ? ` / 上限 ${maxInvest.toLocaleString()}G` : ''
      );
    body.innerHTML = `
      <strong>${escapeHtml(sq.label || 'お店')}</strong>
      <span class="inspect-owner" style="--pc:${owner?.color || '#888'}">${
        owner ? `${escapeHtml(owner.name)} の店` : '空き店舗'
      }</span>
      <span class="inspect-toll ${tollClass}">
        <span class="it-label">${tollLead}</span>
        <span class="it-amount">${tollAmount}</span>
      </span>
      <span class="inspect-sub">価格 ${sq.price.toLocaleString()}G · ${escapeHtml(areaName)}${mono ? ` · ${mono}` : ''}</span>
      <span class="inspect-sub">${investLine}</span>
    `;
    return;
  }
  body.innerHTML = `<strong>${escapeHtml(sq.label || sq.type)}</strong><span class="inspect-sub">${escapeHtml(shopTooltip(g, sq))}</span>`;
}

/** 休み中は自動スキップ（人間がNPCのダイスを振らされるのを防ぐ） */
function maybeAutoSkipRest() {
  clearTimeout(app.restSkipTimer);
  if (!app.game || app.busy || isEventUiBlocking() || app.mode === 'guest') return;
  if (app.game.phase !== 'await_roll') return;
  const cur = currentPlayer(app.game);
  if (!cur?.resting || cur.bankrupt) return;

  // 人間プレイヤーが休みのときも自動で進める
  app.restSkipTimer = setTimeout(async () => {
    if (!app.game || app.busy || isEventUiBlocking() || app.game.phase !== 'await_roll') return;
    const p = currentPlayer(app.game);
    if (!p?.resting) return;
    noteActionActor(p.id);
    enqueueBanner({
      kicker: `${p.name} は休憩中`,
      title: 'ターンスキップ',
      detail: '休憩のためサイコロは振りません',
      kind: 'system',
      color: p.color,
      mine: app.mode === 'local' ? !p.isCPU : p.id === app.localSeat,
    });
    const result = rollDice(app.game);
    if (result.state) commitGameState(result.state);
    syncState();
    refreshGameUI();
    await flushPendingEventNpcFx();
    if (clearBusyUnlessEventUi()) scheduleCpu();
  }, 700);
}

function isMyTurn() {
  if (!app.game) return false;
  return isMyTurnSeat({
    mode: app.mode,
    phase: app.game.phase,
    currentPlayer: currentPlayer(app.game),
    localSeat: app.localSeat,
    localPeerId: app.net?.peerId,
  });
}

/** 操作待ち座席（自分含む）。ホスト側の催促検証でも使う */
function getWaitingSeatId() {
  if (!app.game || app.game.phase === 'gameover') return null;
  return resolveWaitingSeatId({
    phase: app.game.phase,
    pendingPlayerId: app.game.pending?.playerId ?? null,
    currentPlayerIdx: app.game.currentPlayerIdx,
    hideDiceResult: !!app.hideDiceResult,
    eventFlashReaderId: app.eventFlashReaderId,
    eventUiBlocking: isEventUiBlocking(),
  });
}

/** 操作待ちで止まっている人間プレイヤー（自分以外）。P2P専用 */
function getNudgeTarget() {
  if (!app.game || app.game.phase === 'gameover') return null;
  // 同一端末のローカル対戦では相手端末が無いので不要
  if (app.mode !== 'host' && app.mode !== 'guest') return null;

  const targetId = getWaitingSeatId();
  if (targetId == null) return null;

  const p = app.game.players[targetId];
  if (!p || p.isCPU || p.offline || p.bankrupt) return null;
  if (p.id === app.localSeat) return null;
  return p;
}

function nudgeCooldownLeftMs() {
  return Math.max(0, (app.nudgeCooldownUntil || 0) - Date.now());
}

function scheduleNudgeButtonTick() {
  clearTimeout(app.nudgeUiTimer);
  app.nudgeUiTimer = null;
  if (nudgeCooldownLeftMs() <= 0) return;
  app.nudgeUiTimer = setTimeout(() => {
    updateNudgeButton();
  }, 400);
}

function updateNudgeButton() {
  const btn = $('#btn-nudge');
  if (!btn) return;
  const target = getNudgeTarget();
  if (!target) {
    btn.hidden = true;
    btn.disabled = true;
    clearTimeout(app.nudgeUiTimer);
    app.nudgeUiTimer = null;
    return;
  }
  btn.hidden = false;
  const left = nudgeCooldownLeftMs();
  if (left > 0) {
    btn.disabled = true;
    btn.textContent = `催促冷却中（${Math.ceil(left / 1000)}）`;
    scheduleNudgeButtonTick();
  } else {
    btn.disabled = false;
    btn.textContent = `${target.name}に催促`;
    clearTimeout(app.nudgeUiTimer);
    app.nudgeUiTimer = null;
  }
}

function playNudgeReceived(fromName) {
  audio.resume();
  audio.sfx.nudge();
  toast(`${fromName || '相手'}から催促！`);
}

function deliverNudge({ fromSeat, targetSeat, fromName }) {
  const target = app.game?.players?.[targetSeat];
  if (!target || target.isCPU) return;
  if (app.game) {
    recordNudgeStats(app.game, fromSeat, targetSeat);
    // 催促だけで state 同期すると選択中の数値入力が再描画で巻き戻る。
    // 統計はホストに保持し、次の通常同期／終了時に乗る。
  }
  broadcastFx({
    kind: 'nudge',
    fromSeat,
    targetSeat,
    fromName: fromName || app.game.players[fromSeat]?.name || '相手',
    targetName: target.name,
  });
  // ホスト自身が対象ならローカル再生（broadcast はゲスト向け）
  if (app.mode === 'host' && targetSeat === app.localSeat) {
    playNudgeReceived(fromName || app.game.players[fromSeat]?.name);
  }
}

function sendNudge() {
  const target = getNudgeTarget();
  if (!target) return toast('いま催促できる相手がいません');
  if (nudgeCooldownLeftMs() > 0) return toast('もう少し待ってから催促してください');

  audio.resume();
  audio.sfx.click();
  app.nudgeCooldownUntil = Date.now() + NUDGE_COOLDOWN_MS;
  updateNudgeButton();

  const fromName = app.game.players[app.localSeat]?.name || '相手';
  if (app.mode === 'guest' && app.net) {
    app.net.sendToHost({
      type: 'nudge',
      seat: app.localSeat,
      targetSeat: target.id,
    });
    toast(`${target.name}に催促した`);
    return;
  }
  if (app.mode === 'host') {
    const last = app.nudgeLastBySeat[app.localSeat] || 0;
    if (Date.now() - last < NUDGE_COOLDOWN_MS - 500) {
      toast('もう少し待ってから催促してください');
      return;
    }
    app.nudgeLastBySeat[app.localSeat] = Date.now();
    deliverNudge({ fromSeat: app.localSeat, targetSeat: target.id, fromName });
    toast(`${target.name}に催促した`);
  }
}

function handleHostNudge(fromPeer, data) {
  if (!app.game || app.mode !== 'host') return;
  const fromSeat = app.game.players.findIndex((p) => p.peerId === fromPeer);
  if (fromSeat < 0) return;
  const last = app.nudgeLastBySeat[fromSeat] || 0;
  if (Date.now() - last < NUDGE_COOLDOWN_MS) return;

  // ホスト自身が待ちのときも届けられるよう、自己除外前の待ち座席で検証する
  const waitingId = getWaitingSeatId();
  if (waitingId == null) return;
  const targetSeat = data.targetSeat != null ? Number(data.targetSeat) : waitingId;
  if (targetSeat !== waitingId) return;
  if (targetSeat === fromSeat) return;

  const target = app.game.players[targetSeat];
  if (!target || target.isCPU || target.offline || target.bankrupt) return;

  app.nudgeLastBySeat[fromSeat] = Date.now();
  deliverNudge({
    fromSeat,
    targetSeat,
    fromName: app.game.players[fromSeat]?.name || '相手',
  });
}

function bindGameControls() {
  $('#btn-roll').onclick = () => {
    if (app.busy) return;
    audio.resume();
    sendAction({ type: 'roll' });
  };
  $('#btn-trade')?.addEventListener('click', () => {
    if (app.busy) return;
    audio.sfx.click();
    sendAction({ type: 'trade_open' });
  });
  $('#btn-end-choice').onclick = () => {
    hideModal();
    sendAction({ type: 'choice', choice: { action: 'done' } });
  };
  $('#btn-skip-choice').onclick = () => {
    audio.sfx.cancel();
    hideModal();
    sendAction({ type: 'choice', choice: { action: 'skip' } });
  };
  $('#btn-nudge')?.addEventListener('click', () => {
    sendNudge();
  });
}

function bindModalTools() {
  $('#btn-modal-hide').onclick = () => {
    app.modalMode = 'hidden';
    applyModalMode();
    audio.sfx.click();
  };
  $('#btn-modal-restore').onclick = () => {
    app.modalMode = 'shown';
    app.modalDrag = null;
    applyModalMode();
    if (app.modalActive && app.game) showChoiceModal(app.game);
    audio.sfx.click();
  };
  const feed = $('#event-feed');
  feed?.addEventListener('scroll', () => {
    const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 28;
    app.feedPinnedBottom = nearBottom;
  }, { passive: true });
}

function applyModalPosition() {
  const card = $('#modal-card');
  if (!card) return;
  if (app.modalDrag) {
    // 端寄せした小さいカードの座標を、大きい増資モーダル等でも画面内に収める
    const maxH = floatingModalMaxHeightPx(window.innerHeight, MODAL_DRAG_MARGINS);
    card.style.maxHeight = `${maxH}px`;
    const w = card.offsetWidth || 320;
    const h = card.offsetHeight || 200;
    const next = clampModalDrag(
      app.modalDrag,
      { w, h },
      { w: window.innerWidth, h: window.innerHeight },
      MODAL_DRAG_MARGINS,
    );
    app.modalDrag.x = next.x;
    app.modalDrag.y = next.y;
    card.style.position = 'fixed';
    card.style.left = `${app.modalDrag.x}px`;
    card.style.top = `${app.modalDrag.y}px`;
    card.style.margin = '0';
  } else {
    card.style.position = '';
    card.style.left = '';
    card.style.top = '';
    card.style.margin = '';
    card.style.maxHeight = '';
  }
}

/** コンテンツ差し替え後にサイズが変わっても端からのはみ出しを直す */
function scheduleModalLayoutClamp() {
  requestAnimationFrame(() => {
    if (!app.modalActive || app.modalMode === 'hidden' || !app.modalDrag) return;
    applyModalPosition();
  });
}

function applyModalMode() {
  const modal = $('#modal');
  const restore = $('#btn-modal-restore');
  const card = $('#modal-card');
  const centered = !!card?.classList.contains('scratch-modal') && !app.modalDrag;
  modal.classList.toggle('floating', !!app.modalDrag);
  modal.classList.toggle('centered', centered);
  applyModalPosition();
  if (app.modalMode === 'hidden') {
    modal.hidden = true;
    restore.hidden = !app.modalActive;
  } else if (app.modalActive) {
    modal.hidden = false;
    restore.hidden = true;
  } else {
    restore.hidden = true;
  }
}

function bindModalDrag() {
  const card = $('#modal-card');
  const handle = card?.querySelector('.modal-drag-handle');
  if (!handle || handle.dataset.dragBound) return;
  handle.dataset.dragBound = '1';
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origX = 0;
  let origY = 0;

  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    handle.style.cursor = 'grabbing';
    const rect = card.getBoundingClientRect();
    app.modalDrag = app.modalDrag || { x: rect.left, y: rect.top };
    origX = app.modalDrag.x;
    origY = app.modalDrag.y;
    startX = e.clientX;
    startY = e.clientY;
    $('#modal')?.classList.add('floating');
    applyModalMode();
    e.preventDefault();
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging || !app.modalDrag) return;
    const w = card.offsetWidth || 320;
    const h = card.offsetHeight || 200;
    const next = clampModalDrag(
      { x: origX + e.clientX - startX, y: origY + e.clientY - startY },
      { w, h },
      { w: window.innerWidth, h: window.innerHeight },
      MODAL_DRAG_MARGINS,
    );
    app.modalDrag.x = next.x;
    app.modalDrag.y = next.y;
    applyModalPosition();
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    handle.style.cursor = 'grab';
    try { handle.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  handle.style.cursor = 'grab';
}

function hideForkRails() {
  const rails = $('#fork-rails');
  if (rails) rails.hidden = true;
}

function renderForkRails(pend) {
  let rails = $('#fork-rails');
  const host = document.querySelector('.board-wrap') || document.body;
  if (!rails) {
    rails = document.createElement('div');
    rails.id = 'fork-rails';
    rails.setAttribute('aria-hidden', 'true');
    host.appendChild(rails);
  } else if (rails.parentElement !== host) {
    // 盤面ウィンドウ基準で上下左右を配置するため board-wrap 内へ
    host.appendChild(rails);
  }
  rails.hidden = false;
  const mkBtn = (o) => `<button type="button" class="btn primary fork-btn fork-pill" data-next="${o.id}">
    ${o.label}<br><small>${escapeHtml(o.dest)}</small>
  </button>`;
  const bySide = (s) => pend.options.filter((o) => o.side === s).map(mkBtn).join('');
  rails.innerHTML = `
    <div class="fork-rail fork-rail-left">${bySide('left')}</div>
    <div class="fork-rail fork-rail-right">${bySide('right')}</div>
    <div class="fork-rail fork-rail-up">${bySide('up')}</div>
    <div class="fork-rail fork-rail-down">${bySide('down')}</div>
  `;
  rails.querySelectorAll('[data-next]').forEach((btn) => {
    btn.onclick = () => {
      if (app.forkResolving || app.busy) return;
      hideForkRails();
      hideModal();
      sendAction({ type: 'choice', choice: { nextId: Number(btn.dataset.next) } });
    };
  });
}

/** マップ拡大縮小・ドラッグパン・ホイールズーム・ピンチズーム */
function bindBoardZoomControls(canvas) {
  const zoomMaxNow = () => app.renderer?.getZoomMax?.()
    ?? app.renderer?.ZOOM_MAX
    ?? 2.5;
  const syncZoomButtons = () => {
    const z = app.renderer?.getZoom?.() ?? 1;
    const out = $('#btn-zoom-out');
    const inn = $('#btn-zoom-in');
    if (out) out.disabled = z <= (app.renderer?.ZOOM_MIN ?? 0.65) + 0.001;
    if (inn) inn.disabled = z >= zoomMaxNow() - 0.001;
  };

  $('#btn-zoom-in')?.addEventListener('click', (e) => {
    e.preventDefault();
    app.renderer?.zoomIn();
    syncZoomButtons();
  });
  $('#btn-zoom-out')?.addEventListener('click', (e) => {
    e.preventDefault();
    app.renderer?.zoomOut();
    syncZoomButtons();
  });
  $('#btn-zoom-fit')?.addEventListener('click', (e) => {
    e.preventDefault();
    app.renderer?.zoomFit();
    syncZoomButtons();
  });

  canvas.addEventListener('wheel', (e) => {
    if (!app.renderer) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const ax = e.clientX - rect.left;
    const ay = e.clientY - rect.top;
    if (e.deltaY < 0) app.renderer.zoomIn(ax, ay);
    else app.renderer.zoomOut(ax, ay);
    syncZoomButtons();
  }, { passive: false });

  let pan = null;
  /** @type {{ startDist: number, startZoom: number } | null} */
  let pinch = null;
  let pinchMoved = false;

  const touchDistance = (a, b) => Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
  const touchMidpoint = (a, b, rect) => ({
    x: (a.clientX + b.clientX) / 2 - rect.left,
    y: (a.clientY + b.clientY) / 2 - rect.top,
  });

  // 2本指ピンチで拡大縮小（touch-action:none 前提）
  canvas.addEventListener('touchstart', (e) => {
    if (!app.renderer || e.touches.length !== 2) return;
    e.preventDefault();
    pan = null;
    canvas.classList.remove('is-panning');
    pinchMoved = false;
    pinch = {
      startDist: touchDistance(e.touches[0], e.touches[1]),
      startZoom: app.renderer.getZoom?.() || 1,
    };
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    if (!pinch || !app.renderer || e.touches.length < 2) return;
    e.preventDefault();
    const dist = touchDistance(e.touches[0], e.touches[1]);
    if (!(pinch.startDist > 8) || !(dist > 0)) return;
    pinchMoved = true;
    const rect = canvas.getBoundingClientRect();
    const mid = touchMidpoint(e.touches[0], e.touches[1], rect);
    const next = pinch.startZoom * (dist / pinch.startDist);
    app.renderer.setZoom(next, mid.x, mid.y);
    syncZoomButtons();
  }, { passive: false });

  const endPinch = () => {
    pinch = null;
  };
  canvas.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) endPinch();
  });
  canvas.addEventListener('touchcancel', endPinch);

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !app.renderer || pinch) return;
    // 2本目の指は単指パンを開始しない
    if (e.isPrimary === false) return;
    pan = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      canPan: (app.renderer.getZoom?.() || 1) > 1.001,
    };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pinch) return;
    if (!pan || e.pointerId !== pan.id || !app.renderer) return;
    const dx = e.clientX - pan.x;
    const dy = e.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) < 6) return;
    if (!pan.canPan) {
      pan.moved = true;
      return;
    }
    pan.moved = true;
    canvas.classList.add('is-panning');
    app.renderer.panBy(dx, dy);
    pan.x = e.clientX;
    pan.y = e.clientY;
  });
  const endPan = (e) => {
    if (!pan || (e && e.pointerId !== pan.id)) return;
    const wasClick = !pan.moved && !pinchMoved;
    const clientX = e?.clientX ?? pan.x;
    const clientY = e?.clientY ?? pan.y;
    canvas.classList.remove('is-panning');
    try { canvas.releasePointerCapture(pan.id); } catch { /* ignore */ }
    pan = null;
    pinchMoved = false;
    if (!wasClick || !app.game || !app.renderer) return;
    const hit = app.renderer.hitTest(app.game, clientX, clientY);
    if (!hit) return;
    app.inspectedId = hit.id;
    updateInspectPanel();
    if (app.busy || app.forkResolving) return;
    // 株購入モーダル中：店マス直クリックでエリア選択
    if (
      app.game.phase === 'await_choice'
      && app.game.pending?.type === 'stock'
      && hit.type === 'shop'
      && hit.area != null
    ) {
      const card = document.querySelector(`.stock-card[data-area="${hit.area}"]`);
      if (card && !card.disabled) {
        card.click();
        return;
      }
    }
    // 指名買収／空き店購入／強制売却など：盤面の店クリックで候補を選ぶ
    if (
      app.game.phase === 'await_choice'
      && hit.type === 'shop'
      && ['any_shop_buy', 'vacant_shop_buy', 'force_rival_sell', 'force_sell_shop', 'pick_invest', 'invest', 'shop_protect', 'co_own'].includes(app.game.pending?.type)
    ) {
      const btn = document.querySelector(`#modal .pick-invest-shop[data-shop="${hit.id}"]:not([disabled])`);
      if (btn) {
        btn.click();
        // 増資など：マップ選択に合わせてリスト側も該当店までスクロール
        scrollShopPickIntoView(btn);
        return;
      }
    }
    if (app.game.phase === 'await_fork' && app.game.pending?.type === 'fork') {
      const mine = app.mode === 'local'
        ? !app.game.players[app.game.pending.playerId]?.isCPU
        : app.game.pending.playerId === app.localSeat;
      if (!mine) return;
      // 隣マス（分岐オプション）または最終停止候補マスをクリックして進む
      let nextId = app.game.pending.options.some((o) => o.id === hit.id) ? hit.id : null;
      if (nextId == null) {
        const actor = app.game.players[app.game.pending.playerId]
          || app.game.players[app.game.currentPlayerIdx];
        const steps = Number(app.game.pending.stepsLeft ?? app.game.move?.stepsLeft) || 0;
        nextId = findForkNextForLanding(
          app.game,
          actor?.pos,
          actor?.prevPos,
          steps,
          hit.id,
          app.game.pending.options.map((o) => o.id),
        );
      }
      if (nextId != null) {
        sendAction({ type: 'choice', choice: { nextId } });
      }
    }
  };
  canvas.addEventListener('pointerup', endPan);
  canvas.addEventListener('pointercancel', endPan);
  syncZoomButtons();
}

/** ゲストが局所解放したとき、ホスト側の残留告知も捨てさせる */
function requestHostEventFlashFlush() {
  if (app.mode !== 'guest' || !app.net) return false;
  const throughLogKey = app.game?.logs?.[0] ? logKey(app.game.logs[0]) : null;
  return !!app.net.sendToHost({
    type: 'event_flash_flush',
    seat: app.localSeat,
    throughLogKey,
  });
}

/**
 * 手番が移ったあとに残った料金確認などで進行が止まるのを防ぐ。
 * クライアントだけ解放してホストが止まらないよう、ゲストはホストへも通知する。
 * 「確認待ち」なのに中央UIが出ていない HoldingBusy 残留もここで解放する。
 */
function reconcileStaleEventFlash(g) {
  if (!g || !isEventUiBlocking()) return false;

  // HoldingBusy だけ残ってキューも表示もない＝確認UI無しで CPU/手番が止まるデッドロック
  // （スイッチ演出後・オーバーレイ競合後など。フェーズを問わず解放）
  if (!app.eventFlashOpen && !(app.eventFlashQueue?.length > 0)) {
    if (app.eventFlashHoldingBusy || app.busy) {
      app.eventFlashHoldingBusy = false;
      app.busy = false;
      app.eventFlashReaderId = null;
      return true;
    }
    return false;
  }

  // キューがあるのに表示できていない → 再 pump。deferred 中は着地待ちなので触らない
  if (!app.eventFlashOpen && app.eventFlashQueue?.length > 0) {
    if (app.deferEventFlash) return false;
    pumpEventFlash();
    if (app.eventFlashOpen) return true;
    // 他演出にブロックされていないのに出せない＝壊れたペイロード。捨てて進行
    if (!eventFlashBlocked()) {
      app.eventFlashQueue.shift();
      pumpEventFlash();
      if (!isEventUiBlocking()) {
        app.busy = false;
        return true;
      }
      return app.eventFlashOpen;
    }
    return false;
  }

  // open なのに DOM が hidden＝不整合。フラグを下ろして再 pump
  const overlay = $('#event-flash');
  if (app.eventFlashOpen && overlay?.hidden) {
    app.eventFlashOpen = false;
    app.eventFlashHoldingBusy = false;
    pumpEventFlash();
    if (!isEventUiBlocking()) {
      app.busy = false;
      app.eventFlashReaderId = null;
      return true;
    }
    return !!app.eventFlashOpen;
  }

  if (g.phase !== 'await_roll' && g.phase !== 'moving') return false;
  // 未表示の deferred キューだけなら消さない（着地後に pump するため）
  if (!app.eventFlashOpen) return false;
  const readerId = app.eventFlashReaderId;
  const curId = g.currentPlayerIdx;
  // 確認担当の手番がもう終わっている残留告知
  if (readerId != null && readerId === curId) return false;
  if (app.mode === 'host') {
    flushEventFlashImmediate();
  } else if (app.mode === 'guest') {
    flushEventFlashImmediate({ remote: true });
    requestHostEventFlashFlush();
  } else {
    flushEventFlashImmediate({ remote: true });
  }
  app.busy = false;
  return true;
}

/** プレイヤーの能動選択時は告知UIを閉じて進行を優先する */
function flushEventFlashImmediate({ remote = false } = {}) {
  clearTimeout(app.eventFlashTimer);
  clearTimeout(app.eventFlashNpcTimer);
  clearTimeout(app.eventFlashDismissWait);
  app.eventFlashDismissWait = null;
  app.eventFlashQueue = [];
  app.eventFlashOpen = false;
  app.eventFlashHoldingBusy = false;
  app.eventFlashReaderId = null;
  const overlay = $('#event-flash');
  if (overlay) {
    overlay.hidden = true;
    overlay.classList.remove('show');
    overlay.dataset.spectator = '0';
    overlay.dataset.npc = '0';
  }
  const btn = $('#ef-continue');
  if (btn) {
    btn.hidden = false;
    btn.disabled = false;
    btn.textContent = 'つづける';
  }
  // 5倍買いキャンセル等: ホスト側は既に閉じていても、他端末の取り残し告知を必ず解放する
  if (!remote && app.mode === 'host') {
    const throughLogKey = app.game?.logs?.[0] ? logKey(app.game.logs[0]) : null;
    if (throughLogKey) advanceLastSeenLogKey(throughLogKey, app.game);
    broadcastFx({ kind: 'eventFlashFlush', throughLogKey });
  }
}

function sendAction(action) {
  // スクラッチ／お祝い等の能動選択は告知中でも受け付ける
  if (action.type === 'choice') {
    flushEventFlashImmediate();
    // ゲスト局所flushだけだとホストの料金確認が残って止まる
    if (app.mode === 'guest') requestHostEventFlashFlush();
  } else if (isEventUiBlocking()) {
    return;
  }
  if (app.mode === 'guest') {
    noteActionActor(app.localSeat);
    const sent = app.net.sendToHost({ type: 'action', action, seat: app.localSeat });
    if (!sent) {
      toast('ホストに届きませんでした。再接続を試してください');
      refreshGameUI();
    }
    return;
  }
  applyLocalAction(action);
}

async function applyLocalAction(action) {
  if (!app.game) return;
  if (action.type === 'choice') {
    flushEventFlashImmediate();
    app.busy = false;
  } else if (app.busy || isEventUiBlocking()) {
    return;
  }

  if (action.type === 'roll') {
    const cur = currentPlayer(app.game);
    if (app.mode === 'local') {
      if (cur.isCPU) return;
    } else if (!isMyTurn()) {
      return toast('あなたのターンではありません');
    }
    if (app.game.phase !== 'await_roll') return;
    if (isEventUiBlocking()) return;
    noteActionActor(app.game.currentPlayerIdx);
    const result = rollDice(app.game);
    if (!result.ok) return toast(result.error || '失敗');
    if (result.state) commitGameState(result.state);
    if (result.skipped) {
      syncState();
      refreshGameUI();
      await flushPendingEventNpcFx();
      if (clearBusyUnlessEventUi()) scheduleCpu();
      return;
    }
    // 出目は演出後に同期（ネタバレ防止）
    app.hideDiceResult = true;
    refreshGameUI();
    await runDiceAndMove(result.dice);
    return;
  }

  if (action.type === 'choice') {
    const pend = app.game.pending;
    if (!pend) return;
    if (app.mode === 'guest') return;
    // ホスト自身／ローカル人間以外の pending を操作させない（逆交渉連打で CPU 側に作用するのを防ぐ）
    if (app.mode === 'host' && pend.playerId !== app.localSeat) return;
    if (app.mode === 'local' && app.game.players[pend.playerId]?.isCPU) return;
    if (app.choiceResolving) return;
    noteActionActor(pend.playerId ?? app.game.currentPlayerIdx);

    // 分岐演出中の二重 nextId、または着地後に遅れて届いた nextId は無視
    if (action.choice?.nextId != null && action.choice.action == null) {
      if (pend.type !== 'fork' || app.forkResolving) return;
    }

    if (pend.type === 'fork') {
      if (app.forkResolving) return;
      app.forkResolving = true;
      try {
        await resolveForkChoice(Number(action.choice.nextId));
      } finally {
        app.forkResolving = false;
      }
      return;
    }

    app.choiceResolving = true;
    try {
      const result = applyChoice(app.game, action.choice);
      if (!result.ok) {
        if (result.state) commitGameState(result.state);
        toast(choiceErrorMessage(result.error));
        refreshGameUI();
        return;
      }
      if (result.state) commitGameState(result.state);
      if (result.warps?.length) armWarpHolds(result.warps);
      if (action.choice.action === 'buy' && pend.type === 'buy_shop') audio.sfx.buy();
      if (result.fiveBuy) presentFiveBuyFx(result);
      if (result.monopolyBreak) presentMonopolyBreakFx(result);
      if (result.monopoly) presentMonopolyFx(result);
      if (result.scratched) {
        await presentScratchOutcome(result);
        await presentWarpFx(result.warps);
      }
      if (result.reveal) {
        await presentMinigameResult(result);
      } else if (result.minigame && result.messages) {
        if (result.win) audio.sfx.levelUp();
        else audio.sfx.buy();
        enqueueBanner({
          kicker: 'ミニゲーム',
          title: result.win ? '当たり！' : '結果発表',
          detail: result.messages.join(' / '),
          kind: 'event',
          color: currentPlayer(app.game)?.color || '#ffe08a',
          mine: true,
        });
      }
      if (result.potionReveal) {
        await presentPotionReveal(result);
      }
      if ((pend.type === 'stock' || pend.type === 'level_up') && action.choice.action === 'buy') audio.sfx.buy();
      syncState();
      refreshGameUI();

      // 銀行通過後：進行方向選択 or 移動再開
      if (result.resumeMove || (app.game.phase === 'moving' && app.game.move)) {
        app.busy = true;
        app.deferEventFlash = true;
        await continueAdvancing();
        await resumeAfterMovement();
      } else {
        await flushPendingEventNpcFx();
        if (clearBusyUnlessEventUi()) {
          refreshGameUI();
          scheduleCpu();
        }
      }
    } finally {
      app.choiceResolving = false;
    }
    return;
  }

  if (action.type === 'sell') {
    const pid = action.playerId ?? app.game.currentPlayerIdx;
    const cur = currentPlayer(app.game);
    if (app.mode === 'local') {
      if (cur?.isCPU || pid !== cur?.id) return;
    } else if (pid !== app.localSeat || !isMyTurn()) {
      return toast('あなたのターンではありません');
    }
    const result = preTurnSell(app.game, pid, action.area, action.count);
    if (!result.ok) return toast(result.error || '売却できません');
    if (result.state) commitGameState(result.state);
    audio.sfx.buy();
    syncState();
    refreshGameUI();
    return;
  }

  if (action.type === 'trade_open') {
    const pid = app.game.currentPlayerIdx;
    const cur = currentPlayer(app.game);
    if (app.mode === 'local') {
      if (cur?.isCPU) return;
    } else if (!isMyTurn()) {
      return toast('あなたのターンではありません');
    }
    if (app.game.phase !== 'await_roll') return toast('サイコロを振る前だけ取引できます');
    noteActionActor(pid);
    const result = openShopTradeCompose(app.game, pid);
    if (!result.ok) return toast(choiceErrorMessage(result.error));
    if (result.state) commitGameState(result.state);
    syncState();
    refreshGameUI();
  }
}

async function resolveForkChoice(nextId) {
  const pid = app.game.currentPlayerIdx;
  noteActionActor(pid);
  const from = app.game.players[pid].pos;
  const result = chooseFork(app.game, nextId);
  if (!result.ok) return toast(result.error || '失敗');
  if (result.state) commitGameState(result.state);
  hideModal();
  app.modalPendingKey = null;
  app.busy = true;
  app.deferEventFlash = true;
  // 門／階層へ分岐したときは入口まで歩かせ、warps で飛ばす
  const warpFrom = result.warps?.find((w) => w.pid === pid)?.from
    ?? result.warps?.[0]?.from;
  const stepTo = warpFrom != null ? warpFrom : nextId;
  if (result.warps?.length) armWarpHolds(result.warps);
  app.renderer?.animateToken(pid, from, stepTo, 400);
  audio.sfx.step();
  if (!result.warps?.length) {
    syncState({ anim: { pid, from, to: stepTo } });
  }
  refreshGameUI();
  await wait(result.warps?.length ? 400 : 420);
  if (result.warps?.length) {
    await presentWarpFx(result.warps);
    syncState();
    refreshGameUI();
  }
  if (result.done) {
    onLandingSfx();
    if (result.switchMoves?.length) await presentSwitchFx(result.switchMoves);
    await resumeAfterMovement();
  } else {
    await continueAdvancing();
    await resumeAfterMovement();
  }
  // 着地が購入/増資待ちなら確実に選択UIを再掲（busy 残留や告知での欠落防止）
  if (isLocalPendingChoice(app.game)) {
    app.busy = false;
    app.eventFlashHoldingBusy = false;
    refreshGameUI();
  }
}

async function runDiceAndMove(face) {
  noteActionActor(app.game?.currentPlayerIdx);
  app.busy = true;
  app.hideDiceResult = true;
  $('#btn-roll').disabled = true;
  broadcastFx({ kind: 'dice', face });
  await playDiceOverlay(face);
  app.hideDiceResult = false;
  const roller = app.game?.players?.[app.actionActorId] || currentPlayer(app.game);
  if (roller && app.game) {
    app.game.logs.unshift({ text: `${roller.name} のサイコロ → ${face}`, kind: 'dice', t: Date.now() });
    if (app.game.logs.length > 80) app.game.logs.length = 80;
  }
  syncState({ hideDice: false });
  refreshGameUI();
  // サイコロ結果はオーバーレイ済み。ここでイベントUIを出すと着地モーダルが塞がるため出さない
  app.deferEventFlash = true;
  await continueAdvancing();
  await resumeAfterMovement();
}

/** スイッチ・スライドを描画ループより先に予約（瞬時切替フラッシュ防止） */
function armSwitchSlides(moves, dur = 780) {
  if (!moves?.length || !app.renderer) return;
  for (const m of moves) {
    if (!m || m.id == null || !m.from || !m.to) continue;
    app.renderer.animateTileSlide(m.id, m.from, m.to, dur);
  }
}

async function continueAdvancing() {
  app.deferEventFlash = true;
  while (app.game?.move && app.game.phase === 'moving') {
    const pid = app.game.currentPlayerIdx;
    const from = app.game.players[pid].pos;
    const result = advanceMove(app.game);
    if (!result.ok) break;
    if (result.state) commitGameState(result.state);
    // スイッチ切替後、await 中に新座標で描画されないよう見た目だけ from に据え置く。
    // presentSwitchFx が to へ戻してからスライドを開始する（瞬時切替→巻き戻り防止）。
    if (result.switchMoves?.length) {
      for (const m of result.switchMoves) {
        if (!m || m.id == null || !m.from) continue;
        const node = app.game.map.find((n) => n.id === m.id);
        if (node) {
          node.col = m.from.col;
          node.row = m.from.row;
        }
      }
    }

    if (result.forked) {
      audio.sfx.fork();
      syncState();
      refreshGameUI();
      return;
    }

    if (result.stepped) {
      // 門／階層／着地ワープ：論理座標が先に飛んでも、見た目は入口まで歩かせる
      const warpFrom = result.warps?.find((w) => w.pid === pid)?.from
        ?? result.warps?.[0]?.from;
      const stepTo = warpFrom != null ? warpFrom : result.to;
      if (result.warps?.length) armWarpHolds(result.warps);
      app.renderer?.animateToken(pid, result.from ?? from, stepTo, 400);
      audio.sfx.step();
      // スイッチ／ワープがある場合、新座標の state 同期を演出後に回す
      // （ゲストが一瞬新位置→スライド／ワープ開始の巻き戻りフラッシュを見ないように）
      if (!(result.warps?.length || (result.done && result.switchMoves?.length))) {
        syncState({ anim: { pid, from: result.from ?? from, to: stepTo } });
      }
      refreshGameUI();
      // ワープへ繋ぐときはステップ完了と同時に演出開始（ホールド隙間を作らない）
      await wait(result.warps?.length ? 400 : 420);
    }

    // 銀行通過割込み（昇進→株→方向）
    if (result.bankInterrupt || app.game.phase === 'await_choice') {
      syncState();
      refreshGameUI();
      return;
    }

    // 門／階層など残移動ありの途中ワープは、ここで即演出してから歩き続ける
    if (result.warps?.length && !result.done) {
      await presentWarpFx(result.warps);
      syncState();
      refreshGameUI();
    }

    if (result.done) {
      onLandingSfx();
      const landed = app.game.players[pid]?.pos;
      if (landed != null) app.inspectedId = landed;
      if (result.switchMoves?.length) {
        // 据え置き解除＋スライド予約は presentSwitchFx 内で行う
        await presentSwitchFx(result.switchMoves);
      } else if (landed != null && getNode(app.game, landed)?.type === 'switch') {
        // switchMoves が空でも確認ダイアログは出さずトースト／スタンプのみ
        pushEventStamp({
          kicker: 'スイッチ',
          title: '航路が切り替わった',
          detail: '経路が切り替わった',
          kind: 'system',
          color: '#ffe08a',
          silentStamp: true,
        });
        toast('航路が切り替わった');
      }
      if (result.warps?.length) await presentWarpFx(result.warps);
      // スイッチ時は演出後にまとめて同期（途中同期だとゲストが瞬時切替→巻き戻りする）
      syncState();
      refreshGameUI();
      return;
    }
  }
  syncState();
  refreshGameUI();
}

function onLandingSfx() {
  const g = app.game;
  if (!g) return;
  if (g.phase === 'gameover') audio.sfx.win();
  else if (g.pending?.type === 'buy_shop') { /* wait */ }
  else if (g.logs[0]?.kind === 'toll') audio.sfx.toll();
}

async function playDiceOverlay(face, remote = false, opts = {}) {
  const overlay = $('#dice-overlay');
  const faceEl = $('#dice-overlay-face');
  const label = $('#dice-overlay-label');
  const diceMax = Math.max(2, Number(opts.diceMax) || Number(getMoveDiceMax(app.game)) || 6);
  app.hideDiceResult = true;
  overlay.hidden = false;
  overlay.classList.remove('landed');
  const who = opts.label ? `${opts.label}の` : '';
  label.textContent = opts.shuffleText
    || (diceMax > 6 ? `${who}サイコロ（1〜${diceMax}）…` : `${who}サイコロ…`);
  faceEl.textContent = '?';
  $('#dice-face').textContent = '?';
  $('#dice-face').classList.remove('pop');
  if (!remote) audio.sfx.dice();

  const start = performance.now();
  while (performance.now() - start < 1100) {
    faceEl.textContent = String(1 + Math.floor(Math.random() * diceMax));
    await wait(70);
  }
  faceEl.textContent = String(face);
  overlay.classList.add('landed');
  label.textContent = opts.landText || `${face} が出た！`;
  app.hideDiceResult = false;
  $('#dice-face').textContent = String(face);
  $('#dice-face').classList.add('pop');
  if (!remote) audio.sfx.diceLand(face);
  await wait(650);
  overlay.hidden = true;
  pumpEventFlash();
}

/** restoreState の前にイベントNPC演出キューを退避し、見た目を出発マスに固定する */
function commitGameState(state) {
  if (app.game) {
    const fx = takeEventNpcFx(app.game);
    if (fx.length) {
      if (!Array.isArray(app.pendingEventNpcFx)) app.pendingEventNpcFx = [];
      app.pendingEventNpcFx.push(...fx);
      armEventNpcMoveHolds(fx);
      // ゲストが state 同期で瞬移しないよう、先にホールドを通知
      for (const f of fx) {
        if (f.type === 'move' && f.npcId != null && f.from != null) {
          broadcastFx({ kind: 'eventNpcHold', npcId: f.npcId, from: f.from });
        }
      }
    }
  }
  if (state) app.game = restoreState(state);
}

function armEventNpcMoveHolds(fxList) {
  for (const fx of fxList || []) {
    if (fx?.type === 'move' && fx.npcId != null && fx.from != null) {
      app.renderer?.holdToken(fx.npcId, fx.from);
    }
  }
}

async function flushPendingEventNpcFx() {
  const fx = app.pendingEventNpcFx || [];
  app.pendingEventNpcFx = [];
  if (!fx.length) return;
  await presentEventNpcFx(fx);
  // 演出完了後に遅延していた state と合わせて同期
  const extra = app.deferredStateExtra || {};
  app.deferredStateExtra = null;
  syncState({ ...extra, forceNpcSync: true });
}

async function presentEventNpcFx(fxList, remote = false) {
  if (!fxList?.length) return;
  const wasBusy = app.busy;
  app.busy = true;
  for (const fx of fxList) {
    if (!fx) continue;
    if (fx.type === 'spawn') {
      if (!remote) {
        broadcastFx({
          kind: 'eventNpcSpawn',
          npcId: fx.npcId,
          npcKind: fx.kind,
          pos: fx.pos,
        });
        pushEventStamp({
          kicker: 'イベントNPC',
          title: '異界から現れた！',
          detail: fx.kind === 'mark_fairy' ? 'マークの妖精'
            : fx.kind === 'merchant' ? '大商人'
              : fx.kind === 'poverty' ? '貧乏神' : 'NPC',
          kind: 'event',
          color: '#c5a3ff',
          silentStamp: true,
        });
      }
      await wait(420);
      continue;
    }
    if (fx.type === 'move') {
      await presentEventNpcMove(fx, remote);
      continue;
    }
    if (fx.type === 'depart') {
      if (!remote) {
        broadcastFx({
          kind: 'eventNpcDepart',
          npcId: fx.npcId,
          npcKind: fx.kind,
          label: fx.label,
          pos: fx.pos,
        });
        pushEventStamp({
          kicker: 'イベントNPC',
          title: '異界へ帰っていった',
          detail: fx.label || '',
          kind: 'event',
          color: '#9aa3b5',
          silentStamp: true,
        });
      }
      app.renderer?.clearTokenHold(fx.npcId);
      // 退場キュー済みコマをここで外す（最終移動の描画後）
      if (app.game && fx.npcId != null) removeEventNpc(app.game, fx.npcId);
      await wait(360);
    }
  }
  if (!wasBusy && clearBusyUnlessEventUi()) {
    /* keep busy cleared unless flash open */
  } else if (wasBusy) {
    app.busy = true;
  }
}

async function presentEventNpcMove(fx, remote = false) {
  const path = Array.isArray(fx.path) && fx.path.length
    ? fx.path
    : [fx.from, fx.to].filter((id) => id != null);
  if (!path.length || fx.npcId == null) return;
  const diceMax = Math.max(2, Number(fx.diceMax) || 6);
  const roll = Math.max(1, Math.min(diceMax, Number(fx.roll) || Math.max(1, path.length - 1)));
  const label = fx.label || 'イベントNPC';

  app.renderer?.holdToken(fx.npcId, path[0]);
  if (!remote) {
    broadcastFx({
      kind: 'eventNpcMove',
      npcId: fx.npcId,
      kind: fx.kind,
      label,
      diceMax,
      roll,
      path,
      from: path[0],
      to: path[path.length - 1],
    });
  }
  await playDiceOverlay(roll, remote, {
    diceMax,
    label,
    landText: `${label} → ${roll}`,
  });

  for (let i = 1; i < path.length; i += 1) {
    const from = path[i - 1];
    const to = path[i];
    const transit = app.game ? immediateTransitDest(app.game, from) : null;
    if (transit != null && transit === to) {
      // 門／階層：歩行ではなくワープ演出
      app.renderer?.animateWarp?.(fx.npcId, from, to, 900);
      if (audio.sfx.warp) audio.sfx.warp();
      else audio.sfx.step();
      refreshGameUI();
      await wait(960);
    } else {
      app.renderer?.animateToken(fx.npcId, from, to, 400);
      audio.sfx.step();
      refreshGameUI();
      await wait(420);
    }
  }
  app.renderer?.clearTokenHold(fx.npcId);
}

function scratchEffectLines(messages = []) {
  return (messages || []).filter((m) => !String(m).includes('そろい'));
}

function scratchMatchLines(messages = []) {
  return (messages || []).filter((m) => String(m).includes('そろい'));
}

/** モーダル内に「何が起きたか」を大きく表示 */
function paintScratchResultPanel(result) {
  const resultEl = $('#scratch-result');
  if (!resultEl) return;
  const label = result.cell?.label || 'スクラッチ';
  const effects = scratchEffectLines(result.messages);
  const matches = scratchMatchLines(result.messages);
  const bonus = Number(result.matchBonus || 0);
  resultEl.hidden = false;
  resultEl.classList.remove('match-pop', 'outcome-pop');
  void resultEl.offsetWidth;
  resultEl.classList.add('outcome-pop');
  const matchLine = matches.length
    ? matches.join(' / ')
    : (bonus > 0 ? `色そろいボーナス +${bonus}G` : '');
  resultEl.innerHTML = `
    <span class="sr-kicker">めくった結果</span>
    <span class="sr-label">${escapeHtml(label)}</span>
    <span class="sr-effect">${escapeHtml(effects.join(' ・ ') || '効果を適用しました')}</span>
    ${matchLine ? `<span class="sr-bonus">${escapeHtml(matchLine)}</span>` : ''}
  `;
}

/**
 * スクラッチは能動行動なので、イベント名・効果・そろいを必ず明示する。
 * remote: 他端末から受け取った演出（バナー二重送信を避ける）
 */
async function presentScratchOutcome(result, { remote = false } = {}) {
  if (!result) return;
  app.busy = true;

  const cell = result.cell;
  const label = cell?.label || 'スクラッチ';
  const effects = scratchEffectLines(result.messages);
  const effectDetail = effects.join(' / ') || '効果を適用';
  const actorId = cell?.scratchedBy;
  const actor = actorId != null ? app.game?.players?.[actorId] : currentPlayer(app.game);
  const color = actor?.color || '#ffe08a';
  const mine = actor
    ? (app.mode === 'local' ? !actor.isCPU : actor.id === app.localSeat)
    : true;
  const matches = result.matches || [];

  if (cell?.eventId) markScratchEventSeen(cell.eventId);

  paintScratchResultPanel(result);

  if (!remote) {
    broadcastFx({
      kind: 'scratchOutcome',
      cell,
      messages: result.messages || [],
      matches,
      matchBonus: result.matchBonus || 0,
    });
  }

  if (matches.length) {
    await playScratchMatchReveal(matches, result.messages || [], { banner: !remote });
    paintScratchResultPanel(result);
    await wait(420);
  } else {
    await wait(980);
  }

  const bannerPayload = {
    kicker: mine ? 'あなたのスクラッチ' : `${actor?.name || ''} のスクラッチ`,
    title: label,
    detail: effectDetail,
    kind: 'event',
    color,
    mine,
    actorId,
    visual: {
      glyph: '削',
      chips: [
        ...effects.slice(0, 2),
        ...(Number(result.matchBonus || 0) > 0 ? [`そろい+${result.matchBonus}G`] : []),
      ].filter(Boolean),
    },
  };
  // remote はホストから banner FX が届くので二重表示しない
  if (!remote) {
    enqueueBanner(bannerPayload);
    broadcastFx({ kind: 'banner', payload: bannerPayload });
  }

  hideModal();
  clearBusyUnlessEventUi();
}

/** @deprecated presentScratchOutcome に統合 */
async function presentScratchMatches(result) {
  return presentScratchOutcome(result);
}

function nodeLabel(g, id) {
  const n = getNode(g, id);
  if (!n) return '？';
  return n.label || TYPE_LABEL(n) || String(id);
}

function TYPE_LABEL(n) {
  if (n.type === 'bank') return '銀行';
  if (n.type === 'mark') return SUIT_LABELS[n.mark] || 'マーク';
  if (n.type === 'shop') return n.label || 'お店';
  if (n.type === 'chance') return 'チャンス';
  if (n.type === 'scratch') return 'スクラッチ';
  return n.type;
}

/** 論理座標が先にワープ先へ進んでも、見た目は出発マスに留める */
function armWarpHolds(warps) {
  if (!warps?.length || !app.renderer?.holdToken) return;
  for (const w of warps) {
    if (!w || w.pid == null || w.from == null || w.from === w.to) continue;
    app.renderer.holdToken(w.pid, w.from);
  }
}

async function presentWarpFx(warps, { remote = false } = {}) {
  if (!warps?.length || !app.game) return;
  const wasBusy = app.busy;
  app.busy = true;
  // 演出開始前に出発マスへ固定（スクラッチ結果表示中の瞬間移動を防ぐ）
  armWarpHolds(warps);
  for (const w of warps) {
    if (w.from === w.to) continue;
    const who = app.game.players[w.pid];
    const fromLabel = nodeLabel(app.game, w.from);
    const toLabel = nodeLabel(app.game, w.to);
    if (!remote) broadcastFx({ kind: 'warp', warp: w });
    showWarpOverlay(who, fromLabel, toLabel);
    app.renderer?.animateWarp(w.pid, w.from, w.to, 1200, who?.color);
    audio.sfx.warp();
    enqueueBanner({
      kicker: who ? `${who.name} のワープ` : 'ワープ',
      title: toLabel,
      detail: `${fromLabel} → ${toLabel}`,
      kind: 'event',
      color: who?.color || '#c4a574',
      mine: who && (app.mode === 'local' ? !who.isCPU : who.id === app.localSeat),
    });
    app.inspectedId = w.to;
    updateInspectPanel();
    await wait(1280);
    hideWarpOverlay();
  }
  if (!wasBusy) clearBusyUnlessEventUi();
  else if (isEventUiBlocking()) {
    app.eventFlashHoldingBusy = true;
    app.busy = true;
  }
  pumpEventFlash();
}

/** スイッチで動くマスのスライド演出 */
async function presentSwitchFx(moves, { remote = false, alreadyArmed = false } = {}) {
  if (!moves?.length || !app.game) return;
  const wasBusy = app.busy;
  app.busy = true;
  const dur = 780;
  if (!alreadyArmed) {
    // 予約→論理座標更新の順を同一同期ブロックで行う
    armSwitchSlides(moves, dur);
    for (const m of moves) {
      if (!m || m.id == null || !m.to) continue;
      const node = app.game.map.find((n) => n.id === m.id);
      if (node) {
        node.col = m.to.col;
        node.row = m.to.row;
      }
    }
  }
  if (!remote) {
    broadcastFx({
      kind: 'switchSlide',
      moves,
      switchState: app.game.switchState ? 1 : 0,
    });
  }
  if (typeof audio.sfx.fork === 'function') audio.sfx.fork();
  else audio.sfx.step();
  // ゲストはスライドSEのみ。ホストはフィードへ軽量スタンプのみ
  // （確認ダイアログにすると reader がゲストで閉じられず choice/roll 通信が止まる）
  if (!remote) {
    // silentStamp / stampOnly: フィードのみ。queueEventFlash に載せると
    // endTurn 後の reader=着地者のままホストが閉じられず 確認中で止まる。
    pushEventStamp({
      kicker: 'スイッチ',
      title: '航路が切り替わった',
      detail: `動くマス ×${moves.length}`,
      kind: 'system',
      color: '#ffe08a',
      silentStamp: true,
    });
    toast('航路が切り替わった');
  }
  await wait(dur + 80);
  // スイッチ演出自体は確認UIを持たない。ここで HoldingBusy を立てると
  // deferEventFlash 中に pump できず、キューが空のまま 確認中 で残留する。
  if (!wasBusy || !isEventUiBlocking()) {
    app.busy = false;
  }
  // 移動完了後の resumeAfterMovement が deferred 告知を pump する
}

function showWarpOverlay(who, fromLabel, toLabel) {
  const overlay = $('#warp-overlay');
  if (!overlay) return;
  $('#warp-kicker').textContent = who ? `${who.name} がワープ` : 'ワープ';
  $('#warp-from').textContent = fromLabel;
  $('#warp-to').textContent = toLabel;
  overlay.style.setProperty('--wc', who?.color || '#c4a574');
  overlay.hidden = false;
  overlay.classList.remove('landed');
  requestAnimationFrame(() => overlay.classList.add('landed'));
}

function hideWarpOverlay() {
  const overlay = $('#warp-overlay');
  if (!overlay) return;
  overlay.hidden = true;
  overlay.classList.remove('landed');
}

function mountScratchMatchOverlay(matches) {
  const overlay = $('#scratch-match-overlay');
  const row = $('#sm-row');
  if (!overlay || !row) return null;
  const ids = [...new Set(matches.flatMap((m) => m.cellIds))];
  const color = matches[0]?.beneficiaryColor || '#888';
  const table = app.game ? getSharedEventTable(app.game) : null;
  row.innerHTML = ids.map((id, i) => {
    const num = table?.cells[id]?.eventId ?? '';
    return `<div class="sm-chip" data-match-id="${id}" style="--pc:${color};--spin-i:${i}">${num}</div>`;
  }).join('');
  overlay.hidden = false;
  return row;
}

function hideScratchMatchOverlay() {
  const overlay = $('#scratch-match-overlay');
  if (overlay) overlay.hidden = true;
  const row = $('#sm-row');
  if (row) row.innerHTML = '';
}

async function playScratchMatchReveal(matches, messages = [], { banner = true } = {}) {
  if (!matches?.length) return;
  const matchMsgs = messages.filter((m) => String(m).includes('そろい'));
  const top = matches.reduce((a, b) => (b.count > a.count ? b : a), matches[0]);
  const totalBonus = matches.reduce((s, m) => s + (m.bonus || 0), 0);
  const title = `${top.beneficiaryName || ''}色 ${top.count}そろい！`;
  const detail = matchMsgs.join(' / ') || `+${totalBonus}G`;
  const color = top.beneficiaryColor || '#ffe08a';

  const modalGrid = document.querySelector('#modal:not([hidden]) .scratch-grid');
  let usedOverlay = false;
  if (modalGrid) {
    const ids = [...new Set(matches.flatMap((m) => m.cellIds))];
    ids.forEach((id, i) => {
      const el = modalGrid.children[id];
      if (!el) return;
      el.classList.add('match-spin');
      el.style.setProperty('--spin-i', String(i));
      if (!el.classList.contains('done')) {
        el.classList.add('done', 'by-player');
        el.style.setProperty('--pc', color);
      }
    });
  } else {
    usedOverlay = true;
    mountScratchMatchOverlay(matches);
    const kicker = $('#sm-kicker');
    const titleEl = $('#sm-title');
    const detailEl = $('#sm-detail');
    if (kicker) kicker.textContent = `${top.beneficiaryName || ''} の色そろい`;
    if (titleEl) titleEl.textContent = title;
    if (detailEl) detailEl.textContent = `+${totalBonus}G`;
  }

  const resultEl = $('#scratch-result');
  if (resultEl) {
    resultEl.hidden = false;
    resultEl.classList.add('match-pop');
    resultEl.textContent = `${title} → +${totalBonus}G`;
  }

  audio.sfx.scratchMatch();
  if (banner) {
    enqueueBanner({
      kicker: '色そろい！',
      title: `${top.count}そろい`,
      detail,
      kind: 'event',
      color,
      mine: true,
    });
    broadcastFx({
      kind: 'banner',
      payload: {
        kicker: '色そろい！',
        title: `${top.count}そろい`,
        detail,
        kind: 'event',
        color,
      },
    });
  }

  await wait(1550);
  document.querySelectorAll('.match-spin').forEach((el) => el.classList.remove('match-spin'));
  resultEl?.classList.remove('match-pop');
  if (usedOverlay) hideScratchMatchOverlay();
  pumpEventFlash();
}

const SLOT_SYMS = ['★', '♪', 'G', '♦', '♣'];

/** 薬品結果1行：実際に起きた内容を優先 */
function potionResultLine(row) {
  const concrete = String(row?.detail || '').replace(/^薬品[：:]/, '').trim();
  if (concrete) return concrete;
  return POTION_EFFECT_LABELS[row?.effectId] || '効果なし';
}

function potionEffectTitle(effectId) {
  return POTION_EFFECT_LABELS[effectId] || '不明な効果';
}

/** 薬品マス：全員分の結果を一覧で見せる */
function renderPotionRevealBoard(rows) {
  const list = (rows || []).map((r, i) => {
    const pl = app.game?.players?.[r.playerId];
    const color = pl?.color || '#9fa8da';
    const name = r.name || pl?.name || `P${(r.playerId ?? i) + 1}`;
    const cardNo = Number.isFinite(Number(r.slot)) ? Number(r.slot) + 1 : '?';
    const effect = potionEffectTitle(r.effectId);
    const outcome = potionResultLine(r);
    return `<li class="potion-result-row" style="--pc:${escapeHtml(color)}">
      <span class="potion-result-name">${escapeHtml(name)}</span>
      <span class="potion-result-card">カード${escapeHtml(String(cardNo))}</span>
      <span class="potion-result-effect">${escapeHtml(effect)}</span>
      <span class="potion-result-outcome">${escapeHtml(outcome)}</span>
    </li>`;
  }).join('');
  return `<ol class="potion-result-board">${list}</ol>`;
}

/** 薬品マス：伏せカード公開の告知（各自の結果が一目で分かる一覧） */
async function presentPotionReveal(result = {}) {
  const rows = result.results || app.game?.potionReveal || [];
  if (!rows.length) return;
  app.busy = true;
  audio.sfx.levelUp();

  const overlay = $('#minigame-overlay');
  const stage = overlay?.querySelector('.mg-stage');
  const body = $('#mg-body');
  const answer = $('#mg-answer');
  const title = $('#mg-title');
  const detail = $('#mg-detail');
  const kicker = $('#mg-kicker');
  if (overlay && body) {
    overlay.hidden = false;
    overlay.classList.remove('show-result', 'tier-jackpot', 'tier-exact', 'tier-pair', 'tier-near', 'tier-win', 'tier-miss');
    overlay.classList.add('party', 'potion-reveal');
    stage?.classList.add('party');
    if (kicker) kicker.textContent = '薬品マス・カード公開';
    if (title) title.textContent = 'みんなの結果';
    if (answer) {
      answer.hidden = true;
      answer.textContent = '';
    }
    body.innerHTML = renderPotionRevealBoard(rows);
    if (detail) {
      detail.innerHTML = '';
      detail.textContent = '各プレイヤーが引いた効果と実際の結果';
    }
    overlay.classList.add('show-result');
    await wait(Math.max(2200, 900 + rows.length * 450));
    overlay.hidden = true;
    overlay.classList.remove('show-result', 'party', 'potion-reveal');
    stage?.classList.remove('party');
    body.innerHTML = '';
    if (detail) detail.textContent = '';
  } else {
    await wait(900);
  }

  const summary = rows
    .map((r) => `${r.name || '？'}：${potionResultLine(r)}`)
    .join(' · ');
  const chips = rows.map((r) => {
    const name = r.name || '？';
    const short = potionResultLine(r);
    return `${name} ${short}`.slice(0, 28);
  }).slice(0, 6);
  const payload = {
    kicker: '薬品マス',
    title: rows.length > 1 ? 'みんなの結果' : 'カード公開',
    detail: summary,
    kind: 'event',
    color: '#9fa8da',
    visual: { glyph: '薬', chips: chips.length ? chips : ['カード公開'] },
  };
  if (!result.remote) {
    broadcastFx({ kind: 'banner', payload });
    broadcastFx({ kind: 'potionReveal', results: rows });
    enqueueBanner(payload);
  }
  // remote はホストから banner FX が届くので二重表示しない
  clearBusyUnlessEventUi();
}

async function presentMinigameResult(result) {
  const reveal = result.reveal;
  if (!reveal) return;
  app.busy = true;
  broadcastFx({ kind: 'minigameReveal', reveal });
  await playMinigameReveal(reveal);
  const color = reveal.playerColor || '#ffe08a';
  const summary = summarizeMinigameResults(reveal)
    || (reveal.messages || result.messages || []).join(' / ');
  enqueueBanner({
    kicker: reveal.label || 'ミニゲーム',
    title: reveal.results?.length > 1 ? 'みんなの結果' : (reveal.title || (reveal.win ? '当たり！' : '結果発表')),
    detail: summary,
    kind: 'event',
    color,
    mine: true,
  });
  broadcastFx({
    kind: 'banner',
    payload: {
      kicker: reveal.label || 'ミニゲーム',
      title: reveal.results?.length > 1 ? 'みんなの結果' : (reveal.title || (reveal.win ? '当たり！' : '結果発表')),
      detail: summary,
      kind: 'event',
      color,
    },
  });
  // busy はイベント確認完了まで維持
  clearBusyUnlessEventUi();
}

/** ミニゲーム演出で「自分の予想」行を返す（当たりハイライト行ではない） */
function minigameViewerRow(reveal) {
  const rows = reveal?.results || [];
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];
  const bySeat = rows.find((r) => r.playerId === app.localSeat);
  if (bySeat) return bySeat;
  if (app.mode === 'local') {
    const human = rows.find((r) => {
      const pl = app.game?.players?.[r.playerId];
      return pl && !pl.isCPU;
    });
    if (human) return human;
  }
  if (reveal?.starterId != null) {
    const starter = rows.find((r) => r.playerId === reveal.starterId);
    if (starter) return starter;
  }
  return rows[0];
}

function formatCoinPickLabel(pick) {
  return pick === 'tails' ? '裏' : '表';
}

function formatHighLowPickLabel(pick) {
  return pick === 'high' ? '高' : '低';
}

/** 全員参加ミニゲームの共通結果一行（出目・着順など） */
function formatMinigameSharedLine(reveal) {
  const s = reveal?.shared || reveal?.outcome || {};
  const game = reveal?.game || '';
  if (game === 'guess_dice' && s.roll != null) return `出目 ${s.roll}`;
  if (game === 'high_low' && s.secret != null) {
    return `数字 ${s.secret}（${s.band === 'high' ? '高' : '低'}）`;
  }
  if (game === 'coin' && s.face) return s.face === 'heads' ? '表' : '裏';
  if (game === 'roulette' && s.spin != null) {
    const colorLabel = { red: '赤', black: '黒', green: '緑' };
    return `${colorLabel[s.color] || ''}${s.spin}`;
  }
  if (game === 'horse_race' && Array.isArray(s.order)) {
    const horses = s.horses || [];
    return s.order.slice(0, 3).map((idx, i) => `${i + 1}着 ${horses[idx] || '?'}`).join(' · ');
  }
  if (game === 'memory_match' && Array.isArray(s.board)) {
    return `盤面 ${s.board.join(' ')}`;
  }
  if (game === 'silent_bid') {
    return '50 / 100 / 300G（かぶりなしのみ受取）';
  }
  if (game === 'push_pull' && s.popAt != null) {
    return `限界 ${s.popAt} 段階`;
  }
  if (game === 'divide_pool' && s.pool != null) {
    return `池 ${s.pool}G / 閾値 ${s.threshold}%`;
  }
  if (game === 'target_roulette' && s.land != null) {
    const land = s.land === 'prize' ? '賞金' : (app.game?.players?.[s.land]?.name || `P${s.land}`);
    return `着地 ${land}`;
  }
  if (game === 'hot_potato' && s.safeStops != null) {
    return `止め上限 ${s.safeStops}人`;
  }
  return '';
}

function formatMinigamePrize(amount) {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  return `+${n.toLocaleString('ja-JP')}G`;
}

/** 全員参加向けの結果ボードHTML（金額・勝敗が一目で分かる） */
function renderPartyMinigameResults(reveal, { includeShared = false } = {}) {
  const rows = [...(reveal.results || [])].sort((a, b) => {
    const pa = Number(a.prizeWon) || 0;
    const pb = Number(b.prizeWon) || 0;
    if (pb !== pa) return pb - pa;
    return Number(!!b.win) - Number(!!a.win);
  });
  const shared = includeShared ? formatMinigameSharedLine(reveal) : '';
  const game = reveal.game || '';
  const showPick = game === 'guess_dice' || game === 'coin' || game === 'high_low' || game === 'roulette'
    || game === 'silent_bid' || game === 'hot_potato' || game === 'target_roulette'
    || game === 'push_pull' || game === 'divide_pool' || game === 'memory_match';
  const board = rows.map((r, i) => {
    const win = !!r.win;
    const prize = formatMinigamePrize(r.prizeWon);
    const verdict = r.title || (win ? '当たり！' : '参加賞');
    let pickText = '';
    if (showPick && r.pick != null) {
      if (game === 'coin') pickText = formatCoinPickLabel(r.pick);
      else if (game === 'high_low') pickText = formatHighLowPickLabel(r.pick);
      else if (game === 'roulette') {
        pickText = ({ red: '赤', black: '黒', green: '緑' })[r.pick] || String(r.pick);
      } else if (game === 'hot_potato') {
        pickText = r.pick === 'stop' ? '止める' : '回す';
      } else if (game === 'target_roulette') {
        pickText = r.pick === 'prize' ? '賞金' : (app.game?.players?.[r.pick]?.name || String(r.pick));
      } else if (game === 'silent_bid') {
        pickText = `${r.pick}G`;
      } else if (game === 'push_pull') {
        pickText = `${r.pick}段階`;
      } else if (game === 'divide_pool') {
        pickText = `${r.pick}%`;
      } else if (game === 'memory_match') {
        pickText = String(r.pick).replace(',', '・');
      } else {
        pickText = String(r.pick);
      }
    }
    const pick = pickText
      ? `<span class="mg-result-pick" title="予想">予想${escapeHtml(pickText)}</span>`
      : '';
    return `<li class="mg-result-row ${win ? 'is-win' : 'is-miss'}" style="--pc:${escapeHtml(r.playerColor || '#c4a574')}">
      <span class="mg-result-rank" aria-hidden="true">${i + 1}</span>
      <span class="mg-result-name">${escapeHtml(r.playerName || '')}</span>
      ${pick}
      <span class="mg-result-verdict">${escapeHtml(verdict)}</span>
      <span class="mg-result-prize">${escapeHtml(prize)}</span>
    </li>`;
  }).join('');
  return `<div class="mg-results">
    ${shared ? `<div class="mg-shared-line">${escapeHtml(shared)}</div>` : ''}
    <ol class="mg-result-board">${board}</ol>
  </div>`;
}

function summarizeMinigameResults(reveal) {
  const rows = reveal?.results || [];
  if (rows.length > 1) {
    return rows
      .map((r) => `${r.playerName} ${r.title || ''} ${formatMinigamePrize(r.prizeWon)}`.trim())
      .join(' · ');
  }
  return (reveal?.messages || []).join(' / ');
}

async function playMinigameReveal(reveal) {
  const overlay = $('#minigame-overlay');
  const stage = overlay?.querySelector('.mg-stage');
  const body = $('#mg-body');
  const answer = $('#mg-answer');
  const title = $('#mg-title');
  const detail = $('#mg-detail');
  const kicker = $('#mg-kicker');
  if (!overlay || !body) return;

  const party = (reveal.results?.length || 0) > 1;
  overlay.hidden = false;
  overlay.classList.remove('show-result', 'tier-jackpot', 'tier-exact', 'tier-pair', 'tier-near', 'tier-win', 'tier-miss', 'party');
  stage?.classList.toggle('party', party);
  if (party) overlay.classList.add('party');
  if (reveal.tier) overlay.classList.add(`tier-${reveal.tier}`);
  kicker.textContent = party
    ? `全員参加・${reveal.label || 'ミニゲーム'}`
    : `${reveal.playerName || ''} の${reveal.label || 'ミニゲーム'}`;
  title.textContent = '';
  detail.textContent = '';
  body.innerHTML = '';
  if (answer) {
    answer.hidden = true;
    answer.textContent = '';
  }
  audio.sfx.minigameDrum();

  const game = reveal.game || 'slot';
  if (game === 'slot') {
    await animateSlotReveal(body, reveal);
  } else if (game === 'guess_dice') {
    await animateDiceGuessReveal(body, reveal);
  } else if (game === 'dice_battle') {
    await animateDiceBattleReveal(body, reveal);
  } else if (game === 'horse_race') {
    await animateHorseRaceReveal(body, reveal);
  } else if (game === 'high_low') {
    await animateHighLowReveal(body, reveal);
  } else if (game === 'rps_duel') {
    await animateRpsDuelReveal(body, reveal);
  } else if (game === 'coin') {
    await animateCoinReveal(body, reveal);
  } else if (game === 'roulette') {
    await animateRouletteReveal(body, reveal);
  } else if (game === 'heist') {
    await animateHeistReveal(body, reveal);
  } else if (game === 'balloon_dash') {
    await animateBalloonDashReveal(body, reveal);
  } else {
    body.innerHTML = `<div class="mg-hl-card landed">?</div>`;
    await wait(400);
  }

  // 正解／共通結果はタイトルより上の専用枠へ（他テキストと被らない）
  const sharedLine = formatMinigameSharedLine(reveal);
  if (answer) {
    if (sharedLine) {
      answer.hidden = false;
      answer.textContent = sharedLine;
    } else {
      answer.hidden = true;
      answer.textContent = '';
    }
  }

  title.textContent = party
    ? 'みんなの結果'
    : (reveal.title || (reveal.win ? '当たり！' : '結果発表'));
  if (party) {
    detail.innerHTML = renderPartyMinigameResults(reveal, { includeShared: !sharedLine });
  } else if (reveal.results?.length === 1) {
    const r = reveal.results[0];
    detail.innerHTML = `<div class="mg-solo-result" style="--pc:${escapeHtml(r.playerColor || '#c4a574')}">
      <span class="mg-result-verdict">${escapeHtml(r.title || reveal.title || '')}</span>
      <span class="mg-result-prize">${escapeHtml(formatMinigamePrize(r.prizeWon))}</span>
      <small>${escapeHtml(r.detail || reveal.detail || '')}</small>
    </div>`;
  } else {
    detail.textContent = reveal.detail || (reveal.messages || []).join(' / ');
  }
  overlay.classList.add('show-result');

  // 上役は結果表示中にも紙吹雪を重ね、閉じた後に本祝福を出す
  const celebrateAfter = (() => {
    if (reveal.tier === 'jackpot' || reveal.tier === 'quad' || reveal.tier === 'exact') {
      audio.sfx.slotWin(true);
      return {
        title: reveal.title || 'ジャックポット！',
        detail: summarizeMinigameResults(reveal) || '',
        color: reveal.playerColor || '#ffe08a',
        variant: 'jackpot',
      };
    }
    if (reveal.win) {
      audio.sfx.slotWin(false);
      if (reveal.tier === 'fullhouse' || reveal.tier === 'triple') {
        return {
          title: reveal.title || '大当たり！',
          detail: summarizeMinigameResults(reveal) || '',
          color: reveal.playerColor || '#9ef0c8',
          variant: 'big',
        };
      }
      if (reveal.tier === 'two_pair' || reveal.tier === 'win') {
        return {
          title: reveal.title || '当たり！',
          detail: summarizeMinigameResults(reveal) || '',
          color: reveal.playerColor || '#9ef0c8',
          variant: 'soft',
        };
      }
      // pair も軽く祝福
      if (reveal.tier === 'pair') {
        return {
          title: reveal.title || 'ワンペア！',
          detail: summarizeMinigameResults(reveal) || '',
          color: reveal.playerColor || '#ffe08a',
          variant: 'soft',
        };
      }
      return null;
    }
    audio.sfx.buy();
    return null;
  })();

  if (celebrateAfter) {
    const stageConfetti = overlay.querySelector('.mg-confetti') || (() => {
      const el = document.createElement('div');
      el.className = 'mg-confetti';
      el.setAttribute('aria-hidden', 'true');
      overlay.appendChild(el);
      return el;
    })();
    const burst = celebrateAfter.variant === 'jackpot' ? 70
      : celebrateAfter.variant === 'big' ? 48
        : 28;
    spawnConfettiBurst(stageConfetti, { count: burst, durationMs: 2200 });
  }

  const bigHold = reveal.tier === 'jackpot' || reveal.tier === 'quad'
    || reveal.tier === 'fullhouse' || reveal.tier === 'triple' || reveal.tier === 'exact';
  const holdMs = party ? 2800 : (bigHold ? 2000 : 1200);
  await wait(holdMs);
  overlay.hidden = true;
  overlay.classList.remove('show-result', 'party');
  stage?.classList.remove('party');
  body.innerHTML = '';
  detail.innerHTML = '';
  const leftoverConfetti = overlay.querySelector('.mg-confetti');
  if (leftoverConfetti) leftoverConfetti.innerHTML = '';
  if (answer) {
    answer.hidden = true;
    answer.textContent = '';
  }
  if (celebrateAfter) presentCelebrateFx(celebrateAfter);
  pumpEventFlash();
}

async function animateSlotReveal(body, reveal) {
  const finals = reveal.outcome?.symbols || ['★', '♪', 'G', '♦', '♣'];
  const spinPool = [...new Set([...finals, ...SLOT_SYMS])];
  const reelCount = finals.length || 5;
  body.innerHTML = `
    <div class="mg-slot mg-slot-5">
      ${Array.from({ length: reelCount }, (_, i) => (
        `<div class="mg-reel spinning" data-i="${i}"><span>${spinPool[i % spinPool.length]}</span></div>`
      )).join('')}
    </div>`;
  const reels = [...body.querySelectorAll('.mg-reel')];
  const spans = reels.map((r) => r.querySelector('span'));
  let spinning = true;
  const spinLoop = (async () => {
    while (spinning) {
      spans.forEach((sp, i) => {
        if (reels[i].classList.contains('spinning')) {
          sp.textContent = spinPool[Math.floor(Math.random() * spinPool.length)];
        }
      });
      audio.sfx.slotSpin();
      await wait(70);
    }
  })();

  await wait(420);
  for (let i = 0; i < reelCount; i++) {
    await wait(280 + i * 90);
    reels[i].classList.remove('spinning');
    reels[i].classList.add('stopped');
    spans[i].textContent = finals[i];
    audio.sfx.slotStop();
  }
  spinning = false;
  await spinLoop;

  const hitSet = new Set(
    Array.isArray(reveal.outcome?.hitIndices)
      ? reveal.outcome.hitIndices
      : (() => {
          const counts = new Map();
          for (const s of finals) counts.set(s, (counts.get(s) || 0) + 1);
          return finals
            .map((s, i) => ((counts.get(s) || 0) >= 2 ? i : -1))
            .filter((i) => i >= 0);
        })()
  );
  hitSet.forEach((i) => {
    if (reels[i]) reels[i].classList.add('hit');
  });
  await wait(350);
}

async function animateDiceGuessReveal(body, reveal) {
  const roll = reveal.shared?.roll ?? reveal.outcome?.roll ?? 1;
  const partyRows = (reveal.results || [])
    .map((r) => ({
      name: r.playerName || '',
      color: r.playerColor || '#c4a574',
      pick: Number(r.pick ?? r.outcome?.pick),
      win: !!r.win,
    }))
    .filter((r) => Number.isFinite(r.pick));
  const party = partyRows.length > 1;

  if (party) {
    body.innerHTML = `
      <div class="mg-dice-row mg-dice-party">
        <div class="mg-dice-col mg-dice-picks">
          <small>みんなの予想</small>
          <div class="mg-dice-pick-grid">
            ${partyRows.map((r) => `
              <div class="mg-dice-pick ${r.win ? 'is-win' : ''}" style="--pc:${escapeHtml(r.color)}" title="${escapeHtml(r.name)}">
                <div class="mg-die mg-die-sm">${r.pick}</div>
                <span class="mg-dice-pick-name">${escapeHtml(r.name)}</span>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="mg-vs">VS</div>
        <div class="mg-dice-col">
          <small>出目</small>
          <div class="mg-die rolling" id="mg-roll-die">?</div>
        </div>
      </div>`;
  } else {
    const pickLabel = String(
      partyRows[0]?.pick
      ?? reveal.outcome?.pick
      ?? reveal.pick
      ?? '?',
    );
    body.innerHTML = `
      <div class="mg-dice-row">
        <div class="mg-dice-col"><small>予想</small><div class="mg-die">${escapeHtml(pickLabel)}</div></div>
        <div class="mg-vs">VS</div>
        <div class="mg-dice-col"><small>出目</small><div class="mg-die rolling" id="mg-roll-die">?</div></div>
      </div>`;
  }

  const die = body.querySelector('#mg-roll-die');
  audio.sfx.dice();
  const start = performance.now();
  while (performance.now() - start < 1000) {
    die.textContent = String(1 + Math.floor(Math.random() * 6));
    await wait(70);
  }
  die.textContent = String(roll);
  die.classList.remove('rolling');
  die.classList.add('landed');
  audio.sfx.diceLand(roll);
  await wait(450);
}

async function animateDiceBattleReveal(body, reveal) {
  const o = reveal.outcome || {};
  const style = o.pick === 'guard' ? '守り' : '攻め';
  const youDice = Array.isArray(o.youDice) ? o.youDice : [1];
  const foeDice = Array.isArray(o.foeDice) ? o.foeDice : [1, 1];
  const youBonus = o.youBonus || 0;
  body.innerHTML = `
    <div class="mg-battle">
      <div class="mg-battle-side">
        <small>あなた（${style}）</small>
        <div class="mg-battle-dice" id="mg-you-dice">
          ${youDice.map(() => '<span class="mg-battle-die rolling">?</span>').join('')}
          ${youBonus ? `<span class="mg-battle-bonus">+${youBonus}</span>` : ''}
        </div>
        <strong class="mg-battle-total" id="mg-you-total">?</strong>
      </div>
      <div class="mg-battle-vs">VS</div>
      <div class="mg-battle-side foe">
        <small>ハウス</small>
        <div class="mg-battle-dice" id="mg-foe-dice">
          ${foeDice.map(() => '<span class="mg-battle-die rolling">?</span>').join('')}
        </div>
        <strong class="mg-battle-total" id="mg-foe-total">?</strong>
      </div>
    </div>`;
  const youEls = [...body.querySelectorAll('#mg-you-dice .mg-battle-die')];
  const foeEls = [...body.querySelectorAll('#mg-foe-dice .mg-battle-die')];
  audio.sfx.dice();
  for (let i = 0; i < 10; i++) {
    youEls.forEach((el) => { el.textContent = String(1 + Math.floor(Math.random() * 6)); });
    foeEls.forEach((el) => { el.textContent = String(1 + Math.floor(Math.random() * 6)); });
    await wait(70);
  }
  youEls.forEach((el, i) => {
    el.textContent = String(youDice[i]);
    el.classList.remove('rolling');
    el.classList.add('landed');
  });
  audio.sfx.diceLand(youDice[0] || 1);
  await wait(220);
  foeEls.forEach((el, i) => {
    el.textContent = String(foeDice[i]);
    el.classList.remove('rolling');
    el.classList.add('landed');
  });
  audio.sfx.diceLand(foeDice[0] || 1);
  const youTotal = body.querySelector('#mg-you-total');
  const foeTotal = body.querySelector('#mg-foe-total');
  if (youTotal) youTotal.textContent = String(o.youTotal ?? '?');
  if (foeTotal) foeTotal.textContent = String(o.foeTotal ?? '?');
  await wait(450);
}

async function animateHorseRaceReveal(body, reveal) {
  const o = reveal.outcome || {};
  const horses = Array.isArray(o.horses) ? o.horses : ['ハヤテ', 'ライジン', 'カゼ', 'ツキ'];
  const order = Array.isArray(o.order) ? o.order : [0, 1, 2, 3];
  const pick = o.pick ?? 0;
  body.innerHTML = `
    <div class="mg-race">
      ${horses.map((name, i) => `
        <div class="mg-race-lane ${i === pick ? 'picked' : ''}" data-i="${i}">
          <span class="mg-race-name">${name}</span>
          <div class="mg-race-track"><span class="mg-race-horse" style="--dist:8%">馬</span></div>
          <span class="mg-race-place"></span>
        </div>`).join('')}
    </div>`;
  const lanes = [...body.querySelectorAll('.mg-race-lane')];
  audio.sfx.minigameDrum();
  // 順位の逆から距離を割り当て（1着が最右）
  const distByIdx = {};
  order.forEach((horseIdx, place) => {
    distByIdx[horseIdx] = 22 + (3 - place) * 22;
  });
  for (let step = 0; step < 12; step++) {
    lanes.forEach((lane) => {
      const i = Number(lane.dataset.i);
      const horse = lane.querySelector('.mg-race-horse');
      const jitter = 6 + Math.random() * 18;
      const target = distByIdx[i] ?? 40;
      const progress = Math.min(target, 10 + step * (target / 11) + (Math.random() - 0.5) * jitter * 0.3);
      if (horse) horse.style.setProperty('--dist', `${progress}%`);
    });
    await wait(90);
  }
  lanes.forEach((lane) => {
    const i = Number(lane.dataset.i);
    const horse = lane.querySelector('.mg-race-horse');
    const placeEl = lane.querySelector('.mg-race-place');
    const place = order.indexOf(i) + 1;
    if (horse) horse.style.setProperty('--dist', `${distByIdx[i]}%`);
    if (placeEl) placeEl.textContent = `${place}着`;
    if (place === 1) lane.classList.add('winner');
  });
  audio.sfx.slotWin(order[0] === pick);
  await wait(500);
}

async function animateRpsDuelReveal(body, reveal) {
  const labels = { rock: 'グー', paper: 'パー', scissors: 'チョキ' };
  const pick = reveal.outcome?.pick || 'rock';
  const foe = reveal.outcome?.foe || 'rock';
  body.innerHTML = `
    <div class="mg-rps">
      <div class="mg-rps-hand you"><span class="mg-rps-glyph shake">?</span><small>あなた</small></div>
      <div class="mg-rps-vs">VS</div>
      <div class="mg-rps-hand foe"><span class="mg-rps-glyph shake">?</span><small>あいて</small></div>
    </div>`;
  const youG = body.querySelector('.mg-rps-hand.you .mg-rps-glyph');
  const foeG = body.querySelector('.mg-rps-hand.foe .mg-rps-glyph');
  const cycle = ['rock', 'paper', 'scissors'];
  audio.sfx.minigameDrum();
  for (let i = 0; i < 9; i++) {
    const c = cycle[i % 3];
    if (youG) youG.textContent = labels[c];
    if (foeG) foeG.textContent = labels[cycle[(i + 1) % 3]];
    await wait(100);
  }
  if (youG) {
    youG.textContent = labels[pick];
    youG.classList.remove('shake');
    youG.classList.add('landed');
  }
  if (foeG) {
    foeG.textContent = labels[foe];
    foeG.classList.remove('shake');
    foeG.classList.add('landed');
  }
  const band = document.createElement('div');
  band.className = 'mg-hl-band';
  band.textContent = `${labels[pick]} vs ${labels[foe]}`;
  body.appendChild(band);
  audio.sfx.buy();
  await wait(450);
}

async function animateRouletteReveal(body, reveal) {
  const spin = reveal.shared?.spin ?? reveal.outcome?.spin ?? 0;
  const color = reveal.shared?.color ?? reveal.outcome?.color ?? 'red';
  const viewer = minigameViewerRow(reveal);
  const pick = viewer?.pick || reveal.outcome?.pick || reveal.pick || 'red';
  const colorLabel = { red: '赤', black: '黒', green: '緑' };
  body.innerHTML = `
    <div class="mg-roulette">
      <div class="mg-roulette-wheel spinning" id="mg-wheel">
        <span class="mg-roulette-ball" id="mg-ball">?</span>
      </div>
      <div class="mg-hl-band">予想：${colorLabel[pick] || pick}</div>
    </div>`;
  const ball = body.querySelector('#mg-ball');
  const wheel = body.querySelector('#mg-wheel');
  audio.sfx.slotSpin();
  for (let i = 0; i < 14; i++) {
    const n = Math.floor(Math.random() * 37);
    if (ball) {
      ball.textContent = String(n);
      ball.dataset.color = n === 0 ? 'green' : (n % 2 === 0 ? 'black' : 'red');
    }
    await wait(70);
  }
  if (ball) {
    ball.textContent = String(spin);
    ball.dataset.color = color;
  }
  if (wheel) {
    wheel.classList.remove('spinning');
    wheel.classList.add('landed', `color-${color}`);
  }
  const band = body.querySelector('.mg-hl-band');
  if (band) band.textContent = `${colorLabel[color]}${spin}`;
  audio.sfx.slotStop();
  await wait(450);
}

async function animateHeistReveal(body, reveal) {
  const success = !!reveal.outcome?.success;
  const pick = reveal.outcome?.pick || 'normal';
  const riskLabel = { safe: '用心', normal: '普通', bold: '大胆' }[pick] || pick;
  body.innerHTML = `
    <div class="mg-heist">
      <div class="mg-vault cracking" id="mg-vault">
        <span class="mg-vault-dial">●</span>
      </div>
      <div class="mg-hl-band">${riskLabel}作戦…</div>
    </div>`;
  const vault = body.querySelector('#mg-vault');
  const dial = body.querySelector('.mg-vault-dial');
  audio.sfx.minigameDrum();
  for (let i = 0; i < 8; i++) {
    if (dial) dial.style.transform = `rotate(${i * 45}deg)`;
    audio.sfx.buy();
    await wait(110);
  }
  if (vault) {
    vault.classList.remove('cracking');
    vault.classList.add(success ? 'open' : 'alarm');
  }
  if (dial) dial.textContent = success ? 'OPEN' : 'NG';
  const band = body.querySelector('.mg-hl-band');
  if (band) band.textContent = success ? '金庫オープン！' : '警報！捕まった…';
  if (success) audio.sfx.slotWin(pick === 'bold');
  else audio.sfx.buy();
  await wait(500);
}

async function animateBalloonDashReveal(body, reveal) {
  const pumps = reveal.outcome?.pumps ?? 5;
  const popped = !!reveal.outcome?.popped;
  const popAt = reveal.outcome?.popAt ?? pumps;
  body.innerHTML = `
    <div class="mg-balloon-wrap">
      <div class="mg-balloon" id="mg-balloon" style="--size:1"></div>
      <div class="mg-hl-band">ポンプ 0 / ${pumps}</div>
    </div>`;
  const balloon = body.querySelector('#mg-balloon');
  const band = body.querySelector('.mg-hl-band');
  audio.sfx.minigameDrum();
  const steps = popped ? popAt : pumps;
  for (let i = 1; i <= steps; i++) {
    const size = 0.85 + i * 0.22;
    if (balloon) balloon.style.setProperty('--size', String(size));
    if (band) band.textContent = `ポンプ ${i} / ${pumps}`;
    audio.sfx.coinFlip();
    await wait(160);
  }
  if (popped) {
    if (balloon) balloon.classList.add('popped');
    if (band) band.textContent = `パンッ！（限界 ${popAt}）`;
    audio.sfx.buy();
  } else {
    if (balloon) balloon.classList.add('safe');
    if (band) band.textContent = `成功！限界は ${popAt}`;
    audio.sfx.slotWin(pumps >= 7);
  }
  await wait(450);
}

async function animateHighLowReveal(body, reveal) {
  const secret = reveal.shared?.secret ?? reveal.outcome?.secret ?? 1;
  const bandRaw = reveal.shared?.band ?? reveal.outcome?.band;
  const band = bandRaw === 'high' ? '高' : '低';
  const partyRows = (reveal.results || []).map((r) => ({
    name: r.playerName || '',
    color: r.playerColor || '#c4a574',
    pick: r.pick === 'high' ? 'high' : 'low',
    win: !!r.win,
  }));
  const party = partyRows.length > 1;
  const viewer = minigameViewerRow(reveal);
  const pickLabel = formatHighLowPickLabel(viewer?.pick ?? reveal.pick);

  if (party) {
    body.innerHTML = `
      <div class="mg-dice-row mg-dice-party">
        <div class="mg-dice-col mg-dice-picks">
          <small>みんなの予想</small>
          <div class="mg-dice-pick-grid">
            ${partyRows.map((r) => `
              <div class="mg-dice-pick ${r.win ? 'is-win' : ''}" style="--pc:${escapeHtml(r.color)}" title="${escapeHtml(r.name)}">
                <div class="mg-die mg-die-sm mg-hl-face">${formatHighLowPickLabel(r.pick)}</div>
                <span class="mg-dice-pick-name">${escapeHtml(r.name)}</span>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="mg-vs">VS</div>
        <div class="mg-dice-col">
          <small>数字</small>
          <div class="mg-hl-card spinning" id="mg-hl-num">?</div>
        </div>
      </div>`;
  } else {
    body.innerHTML = `
      <div>
        <div class="mg-hl-card spinning" id="mg-hl-num">?</div>
        <div class="mg-hl-band">予想：${pickLabel}</div>
      </div>`;
  }
  const card = body.querySelector('#mg-hl-num');
  audio.sfx.minigameDrum();
  const start = performance.now();
  while (performance.now() - start < 900) {
    card.textContent = String(1 + Math.floor(Math.random() * 10));
    await wait(65);
  }
  card.textContent = String(secret);
  card.classList.remove('spinning');
  card.classList.add('landed');
  const bandEl = body.querySelector('.mg-hl-band');
  if (bandEl) bandEl.textContent = `${secret} は ${band}`;
  audio.sfx.diceLand(Math.min(6, secret));
  await wait(450);
}

async function animateCoinReveal(body, reveal) {
  const face = (reveal.shared?.face ?? reveal.outcome?.face) === 'tails' ? 'tails' : 'heads';
  const faceLabel = face === 'heads' ? '表' : '裏';
  const partyRows = (reveal.results || []).map((r) => ({
    name: r.playerName || '',
    color: r.playerColor || '#c4a574',
    pick: r.pick === 'tails' ? 'tails' : 'heads',
    win: !!r.win,
  }));
  const party = partyRows.length > 1;
  const viewer = minigameViewerRow(reveal);
  const pickLabel = formatCoinPickLabel(viewer?.pick ?? reveal.pick);

  if (party) {
    body.innerHTML = `
      <div class="mg-dice-row mg-dice-party">
        <div class="mg-dice-col mg-dice-picks">
          <small>みんなの予想</small>
          <div class="mg-dice-pick-grid">
            ${partyRows.map((r) => `
              <div class="mg-dice-pick ${r.win ? 'is-win' : ''}" style="--pc:${escapeHtml(r.color)}" title="${escapeHtml(r.name)}">
                <div class="mg-die mg-die-sm mg-coin-face">${formatCoinPickLabel(r.pick)}</div>
                <span class="mg-dice-pick-name">${escapeHtml(r.name)}</span>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="mg-vs">VS</div>
        <div class="mg-dice-col">
          <small>コイン</small>
          <div class="mg-coin flipping" id="mg-coin">？</div>
        </div>
      </div>`;
  } else {
    body.innerHTML = `
      <div>
        <div class="mg-coin flipping" id="mg-coin">？</div>
        <div class="mg-hl-band">予想：${pickLabel}</div>
      </div>`;
  }
  const coin = body.querySelector('#mg-coin');
  const labels = ['表', '裏'];
  for (let i = 0; i < 12; i++) {
    coin.textContent = labels[i % 2];
    audio.sfx.coinFlip();
    await wait(90);
  }
  coin.textContent = faceLabel;
  coin.classList.remove('flipping');
  coin.classList.add('landed');
  audio.sfx.coinLand();
  await wait(450);
}

async function handleHostAction(from, data) {
  const action = data.action;
  const seat = app.game?.players?.findIndex((p) => p.peerId === from) ?? -1;
  if (seat < 0) return;

  // お祝い／スクラッチ等の能動選択は告知UIより優先
  if (action?.type === 'choice') {
    flushEventFlashImmediate();
    app.busy = false;
  } else if (app.busy || isEventUiBlocking()) {
    // 料金確認がホストにだけ残っているとクライアントの進行を拒否してしまう → 残留なら解放
    if (isEventUiBlocking() && app.game) {
      reconcileStaleEventFlash(app.game);
    }
    if (app.busy || isEventUiBlocking()) {
      // 手番プレイヤーのサイコロなら、確認担当が自分でない残留告知を捨てて受理
      // （告知中は busy=true になり得るので !busy 条件は付けない）
      if (action?.type === 'roll'
        && app.game?.phase === 'await_roll'
        && app.game.currentPlayerIdx === seat
        && isEventUiBlocking()) {
        const readerId = app.eventFlashReaderId;
        if (readerId == null || readerId !== seat) {
          flushEventFlashImmediate();
          app.busy = false;
        } else {
          app.net.sendTo(from, { type: 'reject', reason: '出来事の確認中です' });
          return;
        }
      } else {
        app.net.sendTo(from, { type: 'reject', reason: '出来事の確認中です' });
        return;
      }
    }
  }

  if (action.type === 'roll') {
    if (app.game.currentPlayerIdx !== seat || app.game.phase !== 'await_roll') {
      app.net.sendTo(from, { type: 'reject', reason: 'あなたのターンではありません' });
      return;
    }
    noteActionActor(seat);
    const result = rollDice(app.game);
    if (result.state) commitGameState(result.state);
    if (result.skipped) {
      syncState();
      refreshGameUI();
      await flushPendingEventNpcFx();
      if (clearBusyUnlessEventUi()) scheduleCpu();
      return;
    }
    app.hideDiceResult = true;
    refreshGameUI();
    await runDiceAndMove(result.dice);
    return;
  }

  if (action.type === 'trade_open') {
    if (app.game.currentPlayerIdx !== seat || app.game.phase !== 'await_roll') {
      app.net.sendTo(from, { type: 'reject', reason: '今は物件取引できません' });
      return;
    }
    noteActionActor(seat);
    const result = openShopTradeCompose(app.game, seat);
    if (!result.ok) {
      app.net.sendTo(from, { type: 'reject', reason: choiceErrorMessage(result.error) });
      return;
    }
    if (result.state) commitGameState(result.state);
    syncState();
    refreshGameUI();
    return;
  }

  if (action.type === 'choice') {
    const pend = app.game.pending;
    if (!pend || pend.playerId !== seat) {
      app.net.sendTo(from, { type: 'reject', reason: '選択できません' });
      return;
    }
    noteActionActor(seat);
    // 分岐演出中の二重 nextId、または着地後に遅れて届いた nextId は無視
    if (action.choice?.nextId != null && action.choice.action == null) {
      if (pend.type !== 'fork' || app.forkResolving) return;
    }
    if (pend.type === 'fork') {
      if (app.forkResolving) return;
      app.forkResolving = true;
      try {
        await resolveForkChoice(Number(action.choice.nextId));
      } finally {
        app.forkResolving = false;
      }
      return;
    }
    if (app.game.phase !== 'await_choice') {
      app.net.sendTo(from, { type: 'reject', reason: '今は選択できません' });
      return;
    }
    // handleHostAction は await されないため、演出 await 中の二重 choice をここで弾く
    if (app.choiceResolving) {
      app.net.sendTo(from, { type: 'reject', reason: '選択の処理中です' });
      return;
    }
    app.choiceResolving = true;
    try {
      const result = applyChoice(app.game, action.choice);
      if (!result.ok) {
        if (result.state) commitGameState(result.state);
        app.net.sendTo(from, { type: 'reject', reason: choiceErrorMessage(result.error) });
        syncState();
        refreshGameUI();
        return;
      }
      if (result.state) commitGameState(result.state);
      if (result.warps?.length) armWarpHolds(result.warps);
      if (result.fiveBuy) presentFiveBuyFx(result);
      if (result.monopolyBreak) presentMonopolyBreakFx(result);
      if (result.monopoly) presentMonopolyFx(result);
      if (result.scratched) {
        await presentScratchOutcome(result);
        await presentWarpFx(result.warps);
      }
      if (result.reveal) {
        await presentMinigameResult(result);
      } else if (result.minigame && result.messages) {
        if (result.win) audio.sfx.levelUp();
        else audio.sfx.buy();
        enqueueBanner({
          kicker: 'ミニゲーム',
          title: result.win ? '当たり！' : '結果発表',
          detail: result.messages.join(' / '),
          kind: 'event',
          color: app.game.players[seat]?.color || '#ffe08a',
          actorId: seat,
        });
        broadcastFx({
          kind: 'banner',
          payload: {
            kicker: 'ミニゲーム',
            title: result.win ? '当たり！' : '結果発表',
            detail: result.messages.join(' / '),
            kind: 'event',
            color: app.game.players[seat]?.color || '#ffe08a',
            actorId: seat,
          },
        });
      }
      if (result.potionReveal) {
        await presentPotionReveal(result);
      }
      syncState();
      refreshGameUI();
      if (result.resumeMove || (app.game.phase === 'moving' && app.game.move)) {
        app.busy = true;
        app.deferEventFlash = true;
        await continueAdvancing();
        await resumeAfterMovement();
      } else {
        await flushPendingEventNpcFx();
        if (clearBusyUnlessEventUi()) {
          refreshGameUI();
          scheduleCpu();
        }
      }
    } finally {
      app.choiceResolving = false;
    }
    return;
  }

  if (action.type === 'sell') {
    if (app.game.currentPlayerIdx !== seat) {
      app.net.sendTo(from, { type: 'reject', reason: 'あなたのターンではありません' });
      return;
    }
    const result = preTurnSell(app.game, seat, action.area, action.count);
    if (!result.ok) {
      app.net.sendTo(from, { type: 'reject', reason: result.error || '売却できません' });
      return;
    }
    if (result.state) commitGameState(result.state);
    audio.sfx.buy();
    syncState();
    refreshGameUI();
  }
}

function syncState(extra = {}) {
  if (app.mode !== 'host' || !app.net) return;
  // イベントNPC演出キューがある間は最終位置への state を遅延（ゲスト瞬移・同期ずれ防止）
  if (app.pendingEventNpcFx?.length && !extra.forceNpcSync) {
    const { forceNpcSync: _f, ...rest } = extra;
    app.deferredStateExtra = { ...(app.deferredStateExtra || {}), ...rest };
    return;
  }
  const { forceNpcSync: _force, ...rest } = extra;
  app.net.broadcast({ type: 'state', state: serializeState(app.game), ...rest });
}

function broadcastFx(fx) {
  if (app.mode === 'host' && app.net) app.net.broadcast({ type: 'fx', ...fx });
}

/** イベントUI（表示中・待ち行列）がある間は絶対に進行しない */
function isEventUiBlocking() {
  return !!(app.eventFlashOpen || app.eventFlashHoldingBusy || (app.eventFlashQueue?.length > 0));
}

/** イベント確認が残っているなら busy を維持。空なら解除して true */
function clearBusyUnlessEventUi() {
  if (isEventUiBlocking()) {
    app.eventFlashHoldingBusy = true;
    app.busy = true;
    return false;
  }
  app.busy = false;
  return true;
}

function noteActionActor(pid = app.game?.currentPlayerIdx) {
  if (pid == null || pid < 0) return;
  app.actionActorId = pid;
}

function scheduleCpu() {
  clearTimeout(app.cpuTimer);
  // 確認UIが無いのに busy/HoldingBusy だけ残っていると CPU が永久停止する
  if (app.game && isEventUiBlocking()) {
    reconcileStaleEventFlash(app.game);
  }
  // イベント確認中は次のNPCを絶対に動かさない
  if (isEventUiBlocking()) return;
  if (!app.game || app.game.phase === 'gameover' || app.busy) return;
  if (app.mode === 'guest') return;
  const cur = currentPlayer(app.game);
  const pend = app.game.pending;
  const pendingCpu = (app.game.phase === 'await_choice' || app.game.phase === 'await_fork')
    && pend
    && app.game.players[pend.playerId]?.isCPU
    && !app.game.players[pend.playerId]?.bankrupt;
  if (!cur?.isCPU && !pendingCpu) return;

  app.cpuTimer = setTimeout(async () => {
    if (app.busy || isEventUiBlocking() || !app.game) return;
    const pendNow = app.game.pending;
    const actorId = (app.game.phase === 'await_choice' || app.game.phase === 'await_fork')
      && pendNow?.playerId != null
      ? pendNow.playerId
      : app.game.currentPlayerIdx;
    noteActionActor(actorId);
    const phase = app.game.phase;

    if (phase === 'await_roll') {
      if (!currentPlayer(app.game)?.isCPU) return;
      const result = cpuAct(app.game);
      if (result?.state) commitGameState(result.state);
      if (result?.dice) {
        app.hideDiceResult = true;
        refreshGameUI();
        await runDiceAndMove(result.dice);
      } else {
        syncState();
        refreshGameUI();
        await flushPendingEventNpcFx();
        if (clearBusyUnlessEventUi()) scheduleCpu();
      }
      return;
    }

    if (phase === 'await_fork') {
      let result = cpuAct(app.game);
      // cpuAct 失敗で return すると分岐待ちのまま永久停止するため、先頭候補で再試行
      if (!result?.ok) {
        const opts = app.game.pending?.options;
        if (app.game.pending?.type === 'fork' && opts?.length) {
          result = chooseFork(app.game, opts[0].id);
        }
      }
      if (!result?.ok) {
        syncState();
        refreshGameUI();
        if (clearBusyUnlessEventUi()) scheduleCpu();
        return;
      }
      const pid = app.game.currentPlayerIdx;
      // chooseFork already applied in cpuAct
      if (result.state) commitGameState(result.state);
      if (result.stepped) {
        app.busy = true;
        app.deferEventFlash = true;
        app.renderer?.animateToken(pid, result.from, result.to, 400);
        audio.sfx.step();
        syncState({ anim: { pid, from: result.from, to: result.to } });
        refreshGameUI();
        await wait(420);
        await continueAdvancing();
        await resumeAfterMovement();
      } else {
        refreshGameUI();
        if (clearBusyUnlessEventUi()) scheduleCpu();
      }
      return;
    }

    if (phase === 'await_choice') {
      const result = cpuAct(app.game);
      if (result?.state) commitGameState(result.state);
      if (result?.warps?.length) armWarpHolds(result.warps);
      if (result?.fiveBuy) presentFiveBuyFx(result);
      if (result?.monopolyBreak) presentMonopolyBreakFx(result);
      if (result?.monopoly) presentMonopolyFx(result);
      if (result?.scratched) {
        await presentScratchOutcome(result);
        await presentWarpFx(result.warps);
      }
      if (result?.reveal) {
        await presentMinigameResult(result);
      }
      syncState();
      refreshGameUI();
      // null / !ok で pending が残る場合は再スケジュールすると同じ失敗を繰り返す。
      // cpuAct 側で escape 済みであることが前提。未解消なら短遅延で再試行（最大は busy 外）。
      if (result?.resumeMove || (app.game.phase === 'moving' && app.game.move)) {
        app.busy = true;
        app.deferEventFlash = true;
        await continueAdvancing();
        await resumeAfterMovement();
      } else {
        await flushPendingEventNpcFx();
        if (clearBusyUnlessEventUi()) {
          refreshGameUI();
          scheduleCpu();
        }
      }
    }
  }, 550 + Math.random() * 350);
}

function maybeYourTurnChime() {
  const g = app.game;
  if (!g || g.phase !== 'await_roll') return;
  if (app.busy || isEventUiBlocking()) return;
  const cur = currentPlayer(g);
  if (!cur || cur.isCPU || cur.resting) return;
  const mine = isLocalPlayer({
    mode: app.mode,
    player: cur,
    localSeat: app.localSeat,
    localPeerId: app.net?.peerId,
  });
  const key = `${g.turn}-${g.currentPlayerIdx}-${g.phase}`;
  if (!mine || app.lastTurnKey === key) return;
  app.lastTurnKey = key;
  audio.sfx.yourTurn();
  if (app.mode === 'host') broadcastFx({ kind: 'yourTurn', seat: cur.id, key });
}

function choiceErrorMessage(err) {
  if (err === 'still_short') return 'まだ目標金額に足りません。売却か破産を選んでください';
  if (err === 'insufficient') return '資金が足りません';
  if (err === 'bad_choice') return 'その操作は今できません';
  if (err === 'cannot_trade') return '今は物件取引できません（双方に店が必要です）';
  if (err === 'need_shops') return '渡す店と受け取る店をそれぞれ1軒以上選んでください';
  if (err === 'bad_target') return '取引相手を選んでください';
  if (err === 'bad_give' || err === 'bad_take') return '選べないお店です';
  if (err === 'proposer_cash') return '提案側の現金が足りません';
  if (err === 'target_cash') return '相手の現金が足りません（差額を減らしてください）';
  if (err === 'bad_player') return '取引相手がいません';
  return err || '失敗';
}

function renderDisconnectPanel(g) {
  let panel = $('#disconnect-panel');
  if (!panel) {
    const side = document.querySelector('.side') || $('#players-panel')?.parentElement;
    if (!side) return;
    panel = document.createElement('div');
    panel.id = 'disconnect-panel';
    panel.hidden = true;
    const players = $('#players-panel');
    if (players) players.before(panel);
    else side.prepend(panel);
  }
  if (app.mode !== 'host' || !g) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }
  const offline = g.players.filter((p) => p.offline && !p.bankrupt && !p.isCPU);
  if (!offline.length) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }
  const graceSec = Math.round(app.disconnectGraceMs / 1000);
  panel.hidden = false;
  panel.innerHTML = `
    <div class="dc-title">切断プレイヤー</div>
    <p class="dc-hint">${graceSec}秒で自動CPU化。同じ名前で再接続も可。</p>
    ${offline.map((p) => `
      <div class="dc-row" style="--pc:${p.color}">
        <span class="dc-name">${escapeHtml(p.name)}</span>
        <button type="button" class="btn tiny" data-dc-cpu="${p.id}">CPUに任せる</button>
        <button type="button" class="btn tiny danger" data-dc-kick="${p.id}">キック</button>
      </div>
    `).join('')}
  `;
  panel.querySelectorAll('[data-dc-cpu]').forEach((btn) => {
    btn.onclick = () => {
      audio.sfx.click();
      applyConvertToCpu(Number(btn.dataset.dcCpu));
    };
  });
  panel.querySelectorAll('[data-dc-kick]').forEach((btn) => {
    btn.onclick = () => {
      audio.sfx.click();
      applyKickPlayer(Number(btn.dataset.dcKick));
    };
  });
}

function refreshGameUI() {
  const g = app.game;
  if (!g) return;

  const box = $('#players-panel');
  box.innerHTML = g.players.map((p) => {
    const a = getPlayerAssets(g, p);
    const shopCount = g.map.filter((s) => s.type === 'shop' && s.owner === p.id).length;
    const marks = SUIT_LABELS.map((s, i) => `<span class="mark ${p.marks[i] ? 'on' : ''}">${s}</span>`).join('');
    const wildN = Math.max(0, Math.floor(Number(p.wildcards) || 0));
    const wilds = wildN > 0
      ? `<span class="pc-wilds" title="ワイルドカード（銀行でレベルアップできるときだけ必要枚数を消費）">${'Ｗ'.repeat(Math.min(4, wildN))}<small>×${wildN}</small></span>`
      : '';
    const active = g.currentPlayerIdx === p.id ? 'active' : '';
    const me = p.id === app.localSeat ? 'me' : '';
    const myTurnCard = active && me ? 'my-turn' : '';
    const persona = p.isCPU ? getCpuPersonality(p) : null;
    const atGoal = !p.bankrupt && a.total >= g.goal;
    const statusPeekOn = app.statusPeek?.pid === p.id ? app.statusPeek.key : null;
    const statusBtn = (key, label, detail, className = '', extra = {}) => {
      const peek = statusPeekOn === key ? ' peek-on' : '';
      const shopAttr = extra.shopId != null ? ` data-shop-id="${extra.shopId}"` : '';
      const areaAttr = extra.area != null ? ` data-status-area="${extra.area}"` : '';
      const ac = extra.color ? ` style="--ac:${extra.color}"` : '';
      return `<button type="button" class="pc-flag${className ? ` ${className}` : ''}${peek}" data-status-key="${escapeHtml(key)}" data-status-detail="${escapeHtml(detail)}" title="${escapeHtml(detail)}（クリックで説明）"${shopAttr}${areaAttr}${ac}>${label}</button>`;
    };
    const statusBits = [
      p.offline ? statusBtn(`offline-${p.id}`, '切断', '接続が切れています。再接続するか、ホストがCPU化／キックできます', 'offline') : '',
      atGoal ? statusBtn(`goal-${p.id}`, '目標到達', '総資産が目標以上 — 銀行停止／通過で勝利', 'goal') : '',
      p.lucky ? statusBtn(`lucky-${p.id}`, '★ラッキー', '他者の買い物料の20%を銀行から受取（次の自分の番まで）', 'lucky') : '',
      p.flags?.investCoupon ? statusBtn(`invest-${p.id}`, '増資半額', '次の自分店への増資が半額', 'invest-half') : '',
      (() => {
        const m = Number(p.flags?.takeoverMulti);
        if (Number.isFinite(m) && m >= 2 && m <= 4) {
          return statusBtn(`takeover-${p.id}`, `${m}倍クーポン`, `次の店奪取が${m}倍買いになる`, 'coupon');
        }
        if (p.flags?.fiveBuyCoupon) {
          return statusBtn(`fivebuy-${p.id}`, '3倍クーポン', '次の店奪取が3倍買いになる', 'coupon');
        }
        return '';
      })(),
      p.flags?.tollShield ? statusBtn(`shield-${p.id}`, '通行守り', '次に払う買い物料を1回無効化する') : '',
      p.flags?.fixedDice != null
        ? statusBtn(
          `dice-${p.id}`,
          `出目${Math.floor(Number(p.flags.fixedDice) || 1)}固定`,
          `次の移動サイコロが ${Math.floor(Number(p.flags.fixedDice) || 1)} になる`,
          'fixed-dice',
        )
        : '',
      p.flags?.extraRoll ? statusBtn(`extra-${p.id}`, 'もう一回', 'このターン終了後に、もう一度サイコロを振れる', 'extra-roll') : '',
      p.resting ? statusBtn(`rest-${p.id}`, '休み', 'このターンはサイコロを振らずスキップする（休み明けで解除）') : '',
      p.shopsClosed ? statusBtn(`closed-${p.id}`, '店休', '自分の店の買い物料が一時的に発生しない', 'closed') : '',
      ...g.map
        .filter((s) => s.type === 'shop' && s.owner === p.id && (Number(s.protectTurns) || 0) > 0)
        .map((s) => statusBtn(
          `protect-${p.id}-${s.id}`,
          `店守り×${Math.floor(Number(s.protectTurns) || 1)}`,
          `「${s.label || '店'}」が買収から守られている（残り${Math.floor(Number(s.protectTurns) || 1)}周）`,
          'protect',
          { shopId: s.id, area: s.area, color: AREA_META[s.area]?.color || g.areas[s.area]?.color },
        )),
      ...g.map
        .filter((s) => s.type === 'shop' && s.coOwnerId === p.id)
        .map((s) => statusBtn(
          `coown-${p.id}-${s.id}`,
          '共同オーナー',
          `「${s.label || '店'}」の買い物料の一部を受け取れる`,
          'co-own',
          { shopId: s.id, area: s.area, color: AREA_META[s.area]?.color || g.areas[s.area]?.color },
        )),
      persona ? statusBtn(`cpu-${p.id}`, escapeHtml(persona.label), `CPU個性：${persona.label}`, 'cpu-style') : '',
    ].filter(Boolean);
    const status = statusBits.join('');
    const stockBits = Object.keys(g.areas).map(Number)
      .filter((area) => (p.stocks[area] || 0) > 0)
      .map((area) => {
        const meta = g.areas[area];
        const n = p.stocks[area];
        const peek = app.stockPeekArea === area ? ' peek-on' : '';
        return `<button type="button" class="pc-stock${peek}" data-hold-area="${area}"
          style="--ac:${meta.color}"
          title="${escapeHtml(meta.name)} ${meta.stockPrice}G（クリックで盤面のエリアを表示）">${getAreaCode(g, area)}×${n}</button>`;
      });
    const stockLine = stockBits.length
      ? `<div class="pc-stocks">${stockBits.join('')}</div>`
      : '<div class="pc-stocks empty">株なし</div>';
    return `
      <div class="player-card ${active} ${me} ${myTurnCard}" data-pid="${p.id}" style="--pc:${p.color}">
        <div class="pc-head"><span class="pc-dot"></span><strong>${escapeHtml(p.name)}</strong>${myTurnCard ? '<span class="pc-turn-badge">あなたの番</span>' : ''}<span class="pc-lv">Lv.${p.level}</span></div>
        <div class="pc-money${a.cash < 0 ? ' debt' : ''}" data-cash="${a.cash}">${a.cash.toLocaleString()}G</div>
        <div class="pc-assets">総資産 ${a.total.toLocaleString()}G</div>
        <div class="pc-sub">店 ${shopCount}軒 · ${a.shopAsset.toLocaleString()}G / 株 ${a.stockAsset.toLocaleString()}G</div>
        ${stockLine}
        <div class="pc-marks">${marks}${wilds}</div>
        ${status ? `<div class="pc-status">${status}</div><div class="pc-status-detail" hidden></div>` : ''}
        ${p.bankrupt ? '<div class="pc-bust">破産</div>' : ''}
      </div>
    `;
  }).join('');
  bindStockAreaPeek(box, g);
  bindStatusPeek(box, g);
  renderMobilePlayerStrip(g);
  renderDisconnectPanel(g);
  maybePresentMoneyFx(g);
  flushPendingMoneyFx();

  const pressure = getGoalPressurePlayers(g);
  const mapChip = $('#map-chip');
  if (mapChip) mapChip.textContent = g.mapName || getMapDefName(g.mapId);
  $('#goal-chip').textContent = pressure.length
    ? `目標 ${g.goal.toLocaleString()}G ⚠到達${pressure.length}人`
    : `目標 ${g.goal.toLocaleString()}G`;
  $('#goal-chip').classList.toggle('urgent', pressure.length > 0);
  $('#turn-chip').textContent = `ターン ${g.turn}`;
  const cur = currentPlayer(g);
  const myTurnNow = isMyTurn() && g.phase !== 'gameover';
  $('#phase-chip').textContent = phaseLabel(g);
  const currentName = $('#current-name');
  if (currentName) {
    if (myTurnNow) {
      currentName.textContent = 'あなたの番！';
      currentName.classList.add('your-turn');
    } else {
      currentName.textContent = cur ? `${cur.name} の番` : '';
      currentName.classList.remove('your-turn');
    }
    currentName.style.color = cur?.color || '#fff';
  }
  document.body.classList.toggle('your-turn', myTurnNow);
  const me = localHumanSeat(g) != null ? g.players[localHumanSeat(g)] : null;
  const buff = $('#buff-chip');
  if (buff) {
    const half = !!me?.flags?.investCoupon;
    buff.hidden = !half;
    buff.textContent = half ? '増資半額' : '';
    buff.classList.toggle('on', half);
  }
  syncGoalPressureBgm(g);

  // 上→下（古い→新しい）。内部配列は newest-first のため表示時に反転
  const logLines = g.logs.slice(0, 24).reverse().map((l) => {
    let text = l.text;
    if (app.hideDiceResult && l.kind === 'dice' && /サイコロ\s*→\s*\d/.test(text)) {
      text = text.replace(/サイコロ\s*→\s*\d+/, 'サイコロ → ？');
    }
    return `<div class="log-line ${l.kind || ''}">${escapeHtml(text)}</div>`;
  });
  const logEl = $('#log');
  logEl.innerHTML = logLines.join('');
  logEl.scrollTop = logEl.scrollHeight;

  const diceEl = $('#dice-face');
  if (app.hideDiceResult) {
    diceEl.textContent = '?';
    diceEl.classList.remove('pop');
  } else if (g.dice) {
    diceEl.textContent = String(g.dice);
    diceEl.classList.add('pop');
  } else if (!app.busy) {
    diceEl.textContent = '·';
    diceEl.classList.remove('pop');
  }

  const humanTurn = app.mode === 'local' ? !cur?.isCPU : isMyTurn();
  // ログ告知は選択UIより先に処理し、直後の flush で購入/増資モーダルを塞がないようにする
  announceNewLogs(g);
  // 料金確認などが手番移行後に残り、ホストだけ止まる／次が振れないのを解放
  if (reconcileStaleEventFlash(g)) {
    /* busy / flash をクリア済み */
  }
  const choiceMine = isLocalPendingChoice(g);
  // 自分の選択待ち（分かれ道直後の購入/増資など）は移動演出 busy より優先
  if (choiceMine) {
    if (isEventUiBlocking()) {
      flushEventFlashImmediate();
      if (app.mode === 'guest') requestHostEventFlashFlush();
    }
    app.busy = false;
    app.eventFlashHoldingBusy = false;
  }
  const eventBlocked = isEventUiBlocking();
  const canRoll = !app.busy && !eventBlocked && g.phase === 'await_roll' && humanTurn && !cur?.resting;
  $('#btn-roll').disabled = !canRoll;
  const tradeBtn = $('#btn-trade');
  if (tradeBtn) {
    const myId = app.mode === 'local'
      ? (humanTurn ? cur?.id : -1)
      : app.localSeat;
    const canTrade = !app.busy && !eventBlocked
      && canOpenShopTrade(g, myId);
    tradeBtn.hidden = !canTrade;
    tradeBtn.disabled = !canTrade;
  }
  const reader = g.players[app.eventFlashReaderId];
  if (eventBlocked || app.eventFlashOpen) {
    $('#btn-roll').textContent = reader?.isCPU
      ? `${reader.name} が確認中…`
      : (canDismissEventFlash() || (app.mode === 'local' && !reader?.isCPU)
        ? '出来事を確認中…'
        : `${reader?.name || '手番'} の確認待ち…`);
  } else {
    $('#btn-roll').textContent = app.busy
      ? '演出中…'
      : (cur?.resting && humanTurn
        ? '休憩中（自動スキップ）…'
        : (canRoll ? 'あなたの番！サイコロを振る' : (cur?.isCPU ? 'CPUの手番…' : '待機中…')));
  }

  if ((g.phase === 'await_choice' || g.phase === 'await_fork') && g.pending) {
    const actor = g.players[g.pending.playerId];
    if (choiceMine) {
      app.modalActive = true;
      if (app.modalMode === 'hidden') {
        $('#modal').hidden = true;
        $('#btn-modal-restore').hidden = false;
      } else {
        showChoiceModal(g);
      }
      $('#wait-hint').hidden = true;
      setStatusBanner(true, 'あなたの番 — 選択してください', actor?.color || cur?.color);
    } else {
      // busy（告知演出中）でも、相手／CPU待ちの古い選択UIは必ず閉じる。
      // 逆交渉連打で CPU 側の pending に対し古い「逆交渉」ボタンが残ると進行が止まる。
      app.modalActive = false;
      hideModal();
      $('#wait-hint').hidden = false;
      const pendingLabel = pendingStatusLabel(g.pending);
      $('#wait-hint').textContent = `${actor?.name || ''} が${pendingLabel}…`;
      setStatusBanner(true, `${actor?.name || '相手'} が${pendingLabel}`, actor?.color);
    }
  } else if (!app.busy) {
    app.modalActive = false;
    hideModal();
    $('#wait-hint').hidden = true;
    $('#btn-modal-restore').hidden = true;
    if (g.phase === 'moving' || app.hideDiceResult) {
      setStatusBanner(true, myTurnNow ? 'あなたが移動中' : `${cur?.name || ''} が移動中`, cur?.color);
    } else if (canRoll) {
      setStatusBanner(true, 'あなたの番！サイコロを振ろう', cur?.color);
    } else {
      setStatusBanner(false);
    }
  } else if (app.hideDiceResult) {
    setStatusBanner(true, myTurnNow ? 'あなたがサイコロ中' : `${cur?.name || ''} がサイコロ中`, cur?.color);
  }

  if (g.phase === 'gameover') {
    showWinner(g);
  }

  renderStockPanel(g);
  updateInspectPanel();
  maybeYourTurnChime();
  updateNudgeButton();
  // ログ再フラッシュでホスト／次手番が止まるのを防ぐ
  if (reconcileStaleEventFlash(g)) {
    const canRollNow = !app.busy && !isEventUiBlocking()
      && g.phase === 'await_roll' && humanTurn && !cur?.resting;
    if (canRollNow) {
      $('#btn-roll').disabled = false;
      $('#btn-roll').textContent = 'あなたの番！サイコロを振る';
    }
  }
  maybeAutoSkipRest();
}

/** このクライアントが今すぐ選択UIを出すべきか（購入・増資・分岐など） */
function isLocalPendingChoice(g) {
  if (!g || (g.phase !== 'await_choice' && g.phase !== 'await_fork') || !g.pending) return false;
  const pl = g.players[g.pending.playerId];
  if (!pl || pl.bankrupt) return false;
  if (app.mode === 'local') return !pl.isCPU;
  return g.pending.playerId === app.localSeat;
}

function pendingStatusLabel(pend) {
  switch (pend?.type) {
    case 'fork': return '分岐を選択中';
    case 'buy_shop': return 'お店を購入するか選択中';
    case 'invest': return '増資を検討中';
    case 'pick_invest': return 'イベント増資する店を選択中';
    case 'force_sell_shop': return '強制売却する店を選択中';
    case 'any_shop_buy': return `${pend.multi || 6}倍の指名買収を検討中`;
    case 'vacant_shop_buy': return `空き店の${pend.multi || 2}倍購入を検討中`;
    case 'force_rival_sell': return `相手店の${pend.multi || 3}倍銀行買取を検討中`;
    case 'pick_dice': return '次の出目を宣言中';
    case 'shop_protect': return '店守りする店を選択中';
    case 'co_own': return '共同オーナーになる店を選択中';
    case 'fortune_triple': return '運命の三択を選択中';
    case 'mono_hearing': return '独禁ヒアリングの回答中';
    case 'potion_pick': {
      const left = (pend.participantIds || []).filter((id) => (pend.picks || {})[id] == null).length;
      return left > 1
        ? `薬品カード選択中（残り${left}人）`
        : '薬品カードを選択中';
    }
    case 'five_buy': return '5倍買いを検討中';
    case 'raise_funds': return '資金調達中（株・物件の売却）';
    case 'stock': return (pend.bankVisit || pend.bankPass)
      ? (pend.resumeMove ? '銀行通過の株購入中' : '銀行で株購入中')
      : '株を取引中';
    case 'scratch': return 'イベント表をスクラッチ中';
    case 'minigame': {
      const left = (pend.participantIds || []).filter((id) => (pend.picks || {})[id] == null).length;
      return left > 1
        ? `ミニゲーム「${pend.label || ''}」選択中（残り${left}人）`
        : `ミニゲーム「${pend.label || ''}」中`;
    }
    case 'level_up': return '昇進を祝っている';
    case 'shop_trade_compose': return '物件取引を作成中';
    case 'shop_trade_offer': return '物件取引の承認待ち';
    default: return '選択中';
  }
}

function setStatusBanner(show, text = '', color = '') {
  const el = $('#status-chip');
  const tx = $('#status-chip-text');
  if (!el || !tx) return;
  if (!show) {
    el.hidden = true;
    return;
  }
  tx.textContent = text;
  el.style.setProperty('--sb', color || '#ffe08a');
  el.hidden = false;
}

function logKey(l) {
  return `${l.t || ''}|${l.kind || ''}|${l.text}`;
}

/**
 * ログ既読カーソルを新しい方へだけ進める。
 * 古い throughLogKey で巻き戻すと、クライアントが同じログを再告知し続けて SE が鳴り続ける。
 */
function advanceLastSeenLogKey(nextKey, g = app.game) {
  if (!nextKey) return;
  if (app.lastSeenLogKey == null) {
    app.lastSeenLogKey = nextKey;
    return;
  }
  if (app.lastSeenLogKey === nextKey) return;
  const logs = g?.logs;
  if (!logs?.length) {
    app.lastSeenLogKey = nextKey;
    return;
  }
  const keys = logs.map(logKey);
  const curIdx = keys.indexOf(app.lastSeenLogKey);
  const nextIdx = keys.indexOf(nextKey);
  // newest-first: 小さい index ほど新しい。不明・より新しいときだけ更新
  if (nextIdx < 0) return;
  if (curIdx < 0 || nextIdx < curIdx) app.lastSeenLogKey = nextKey;
}

function announceNewLogs(g) {
  if (!g?.logs?.length) return;
  // 初回は既存ログを既読扱いにしてスパムしない
  if (app.lastSeenLogKey == null) {
    app.lastSeenLogKey = logKey(g.logs[0]);
    return;
  }
  const fresh = [];
  for (const l of g.logs) {
    if (logKey(l) === app.lastSeenLogKey) break;
    fresh.push(l);
  }
  if (!fresh.length) return;
  advanceLastSeenLogKey(logKey(g.logs[0]), g);

  // 新しいものから時系列順へ
  for (const l of fresh.reverse()) {
    if (app.hideDiceResult && l.kind === 'dice' && /サイコロ\s*→/.test(l.text)) continue;
    const banner = bannerFromLog(g, l);
    if (banner) enqueueBanner(banner);
  }
}

function bannerFromLog(g, l) {
  if (!l) return null;
  // 出目確定ログは runDiceAndMove 側のバナーで表示済み
  if (l.kind === 'dice' && (/サイコロ\s*→/.test(l.text) || /サイコロを振った/.test(l.text))) return null;
  // 着地ログ「もう一回サイコロ！」のみ。分岐の「『もう一回』方面へ」は誤マッチさせない
  if (l.kind === 'dice' && !/もう一回サイコロ/.test(l.text)) return null;

  const kind = l.kind || 'info';
  if (!BANNER_KINDS.has(kind) && !(kind === 'dice' && /もう一回サイコロ/.test(l.text))) return null;

  const player = g.players.find((p) => l.text.includes(p.name));
  const mine = player && (
    app.mode === 'local' ? !player.isCPU : player.id === app.localSeat
  );

  let title = l.text;
  let detail = '';
  let kicker = mine ? 'あなたにイベント' : (player ? `${player.name} にイベント` : '出来事');

  if (kind === 'mark') {
    // スクラッチ開始ログと二重になるので、入手／停止は1枚にまとめる
    if (/ぴったり停止/.test(l.text) && !/[♠♥♦♣]/.test(l.text)) {
      return null;
    }
    kicker = mine ? 'マーク' : `${player?.name || ''} のマーク`;
    const m = l.text.match(/[♠♥♦♣]/);
    title = m ? m[0] : 'マークマス';
    // 通過／補充はイベント表を開かない。着地入手は openScratch モーダルが本体。
    // 確認ダイアログ（busy）にするとスクラッチ／分岐UIが塞がり P2P が止まる。
    if (/通過で/.test(l.text)) {
      detail = `${player?.name || ''} が通過でマークを入手`;
    } else if (/ワイルドカード|空きマークに変化|足りないマーク|全マーク所持/.test(l.text)) {
      detail = l.text;
    } else if (/入手/.test(l.text)) {
      detail = `${player?.name || ''} がマークを入手`;
    } else {
      detail = l.text;
    }
  } else if (kind === 'toll') {
    const amt = (l.text.match(/([\d,]+)\s*G/) || [])[1];
    const m = l.text.match(/^(.+?)\s*→\s*(.+?)[「\s]/);
    const payer = m?.[1]?.trim() || player?.name || '';
    const owner = m?.[2]?.trim() || '';
    const shop = (l.text.match(/「([^」]+)」/) || [])[1] || 'お店';
    kicker = '買い物料';
    title = amt ? `−${amt}G` : '支払い';
    detail = owner
      ? `${payer} が ${owner} の「${shop}」へ支払い`
      : l.text;
  } else if (kind === 'level') {
    // 昇進モーダル表示中は重複告知しない（「お祝いする」が塞がるため）
    if (g.pending?.type === 'level_up') return null;
    kicker = mine ? '昇進！' : `${player?.name || ''} が昇進`;
    title = 'レベルアップ';
    detail = l.text;
  } else if (kind === 'shop') {
    kicker = mine ? 'お店' : `${player?.name || ''} のお店`;
    title = /購入/.test(l.text)
      ? '購入！'
      : (/増資/.test(l.text)
        ? '増資！'
        : (/([0-9]+)倍買い|奪取/.test(l.text)
          ? `${(l.text.match(/([0-9]+)倍/) || [, '5'])[1]}倍買い！`
          : (/物件取引|逆交渉を申し込んだ/.test(l.text)
            ? '物件取引'
            : 'お店')));
    // 専用 fiveBuy FX と二重になるログ告知は抑止
    if (/[0-9]+倍買いで/.test(l.text) && /奪取/.test(l.text)) return null;
    detail = l.text;
  } else if (kind === 'stock') {
    if (/わけ前|配当/.test(l.text)) {
      kicker = '株わけ前';
      title = 'エリア収益の分配';
      detail = l.text;
    } else {
      kicker = mine ? '株式取引' : `${player?.name || ''} の株`;
      title = /売却/.test(l.text) ? '株を売却' : '株を購入';
      detail = l.text;
    }
  } else if (kind === 'event') {
    // 着地直後の「表を開く」告知はモーダルと二重になるので出さない
    if (/イベント表をスクラッチ/.test(l.text)) return null;
    if (/スクラッチマスに停止/.test(l.text)) return null;
    if (/ミニゲームマス/.test(l.text) && /停止/.test(l.text)) return null;
    // スイッチは presentSwitchFx 側のスタンプ／トーストのみ
    // （経路=エンジンログ、航路=旧UI文言。どちらも確認ダイアログにしない）
    if (/スイッチを倒した|経路が切り替わった|航路が切り替わった/.test(l.text)) return null;
    if (/店休/.test(l.text)) {
      kicker = mine ? 'ステータス' : `${player?.name || ''} の状況`;
      title = 'お店が休み';
      detail = l.text;
    } else if (/スクラッチ\s*→/.test(l.text)) {
      // presentScratchOutcome 側でイベント名・効果を大きく出す
      return null;
    } else if (/チャンス|イベント！/.test(l.text)) {
      kicker = mine ? 'イベント発生' : `${player?.name || '誰か'} のイベント`;
      title = l.text.replace(/（.*）/, '').replace(/^(チャンス！|イベント！)\s*/, '') || 'イベント';
      detail = (l.text.match(/（(.+)）/) || [])[1] || l.text;
    } else if (/ラッキー/.test(l.text)) {
      kicker = mine ? 'ラッキー！' : `${player?.name || ''} がラッキー`;
      title = /切れた/.test(l.text) ? 'ラッキー終了' : 'ラッキーステータス';
      detail = /受取|銀行から|20%/.test(l.text)
        ? l.text
        : '他者の買い物料の20%を銀行から受取（次の自分の番まで）';
    } else {
      kicker = mine ? 'イベント発生' : `${player?.name || '誰か'} のイベント`;
      title = 'イベント';
      detail = l.text;
    }
  } else if (kind === 'system') {
    if (/営業再開/.test(l.text)) {
      kicker = mine ? 'ステータス' : `${player?.name || ''} の状況`;
      title = 'お店が再開';
      detail = l.text;
    } else if (/店休|休み中/.test(l.text)) {
      kicker = mine ? 'ステータス' : `${player?.name || ''} の状況`;
      title = 'お店が休み';
      detail = l.text;
    } else if (/休憩|次ターン休み|復帰/.test(l.text)) {
      kicker = mine ? 'ステータス' : `${player?.name || ''} の状況`;
      title = '休憩';
      detail = l.text;
    } else if (/破産|売却/.test(l.text)) {
      kicker = mine ? 'ステータス' : `${player?.name || ''} の状況`;
      title = /破産/.test(l.text) ? '破産' : '売却';
      detail = l.text;
    } else {
      return null;
    }
  } else if (kind === 'win') {
    kicker = 'ゲーム終了';
    title = '勝利！';
    detail = l.text;
  } else if (kind === 'dice' && /もう一回サイコロ/.test(l.text)) {
    kicker = mine ? 'もう一回！' : `${player?.name || ''} にもう一回`;
    title = 'サイコロ再挑戦';
    detail = l.text;
  } else {
    return null;
  }

  // ログ本文の当事者を優先（ゲストで actionActorId が古いと確認担当がズレて詰まる）
  const actorId = player?.id ?? app.actionActorId ?? null;

  // マーク系はフィードのみ。中央確認はスクラッチ等の選択UIと衝突して通信停止の原因になる
  // （航路スイッチ告知と同じクラス: busy のまま guest reader 待ちで choice/roll 拒否）
  // 物件取引の提案／逆交渉／成立も確認ダイアログにしない
  // （成立ログで busy を掴むと CPU 応答や次手番のサイコロが止まる）
  const stampOnly = kind === 'mark'
    || (kind === 'shop' && /物件取引|逆交渉を申し込んだ/.test(l.text));

  return {
    kicker,
    title,
    detail,
    kind,
    color: player?.color || '#ffe08a',
    mine: !!mine,
    actorId,
    stampOnly,
  };
}

function enqueueBanner(payload) {
  if (!payload?.title) return;
  const visual = resolveEventVisual(payload);
  const actorId = payload.actorId != null ? payload.actorId : app.actionActorId;
  const stampPayload = { ...payload, visual, actorId };
  pushEventStamp(stampPayload);
  // silentStamp / stampOnly はフィードのみ（確認ダイアログで busy を掴まない）
  if (payload.silentStamp || payload.stampOnly) return;
  queueEventFlash({ ...payload, visual, actorId });
}

function eventFlashBlocked() {
  return !$('#dice-overlay')?.hidden
    || !$('#warp-overlay')?.hidden
    || !$('#scratch-match-overlay')?.hidden
    || !$('#minigame-overlay')?.hidden
    || !$('#money-fx')?.hidden;
}

function eventFlashKey(payload) {
  return `${payload.kind || ''}|${payload.title || ''}|${payload.detail || ''}|${payload.actorId ?? ''}`;
}

function queueEventFlash(payload) {
  if (!payload?.title) return;
  const key = eventFlashKey(payload);
  // 同一行動内の重複告知を防ぐ
  if (app.eventFlashOpen && eventFlashKey({
    kind: $('#event-flash')?.dataset.visual,
    title: $('#ef-title')?.textContent,
    detail: $('#ef-detail')?.textContent,
    actorId: app.eventFlashReaderId,
  }) === key) return;
  if (app.eventFlashQueue.some((q) => eventFlashKey(q) === key)) return;
  app.eventFlashQueue.push(payload);
  // 移動中はキューに積むだけ（着地前に busy を掴むとマス選択UIが出ない）
  if (app.deferEventFlash) return;
  // 自分の購入/増資/分岐待ち中は確認フラッシュでモーダルを塞がない（選択後に pump）
  if (isLocalPendingChoice(app.game)) return;
  // 待ち行列に入った時点で進行を止める（ホスト／ローカル）
  if (app.mode !== 'guest') {
    app.eventFlashHoldingBusy = true;
    app.busy = true;
    clearTimeout(app.cpuTimer);
  }
  pumpEventFlash();
}

function pumpEventFlash() {
  if (app.deferEventFlash) return;
  if (app.eventFlashOpen) return;
  if (isLocalPendingChoice(app.game)) return;
  if (eventFlashBlocked()) return;
  const payload = app.eventFlashQueue.shift();
  if (!payload) {
    clearTimeout(app.eventFlashNpcTimer);
    app.eventFlashReaderId = null;
    if (app.eventFlashHoldingBusy) {
      app.eventFlashHoldingBusy = false;
      app.busy = false;
      flushPendingMoneyFx();
      refreshGameUI();
      scheduleCpu();
    }
    return;
  }
  presentEventFlash(payload);
}

/** 移動完了後: 遅延したイベントUIを出し、なければ選択UI／次手番へ */
async function resumeAfterMovement() {
  app.deferEventFlash = false;
  // プレイヤー移動完了後にイベントNPCのダイス／歩行を再生
  if (app.pendingEventNpcFx?.length) {
    await flushPendingEventNpcFx();
  }
  // 分かれ道直後の購入/増資など、選択待ちなら演出 busy を先に解放してモーダルを出す
  if (isLocalPendingChoice(app.game)) {
    if (isEventUiBlocking()) {
      flushEventFlashImmediate();
      if (app.mode === 'guest') requestHostEventFlashFlush();
    }
    app.busy = false;
    app.eventFlashHoldingBusy = false;
    refreshGameUI();
    return;
  }
  refreshGameUI();
  if (app.eventFlashQueue.length > 0 || app.eventFlashOpen) {
    if (app.mode !== 'guest') {
      app.eventFlashHoldingBusy = true;
      app.busy = true;
      clearTimeout(app.cpuTimer);
    }
    pumpEventFlash();
    // pump で開いたフラッシュは着地者 reader のまま手番が移っていることがある。
    // 再 refresh で reconcileStaleEventFlash を走らせ、ホスト残留の確認中を解放する。
    refreshGameUI();
  }
  if (clearBusyUnlessEventUi()) {
    refreshGameUI();
    scheduleCpu();
  }
}

function eventFlashReader(payload) {
  const id = payload?.actorId != null ? payload.actorId : app.actionActorId;
  if (id == null || !app.game) return null;
  return app.game.players[id] || null;
}

/** 人間の確認担当だけ手動で閉じられる。NPC担当はNPCが進める */
function canDismissEventFlash() {
  if (!app.game || !app.eventFlashOpen) return false;
  // 手番が移ったあとに残った告知は、いまサイコロを振る側も閉じられる
  if (app.game.phase === 'await_roll' && isMyTurn()) return true;
  // 選択待ちの本人も閉じられる（マーク確認などがスクラッチ／分岐モーダルを塞いだとき）
  const pend = app.game.pending;
  if ((app.game.phase === 'await_choice' || app.game.phase === 'await_fork') && pend) {
    const pendingPl = app.game.players[pend.playerId];
    if (app.mode === 'local' && pendingPl && !pendingPl.isCPU) return true;
    if (pend.playerId === app.localSeat) return true;
  }
  const reader = app.game.players[app.eventFlashReaderId];
  if (!reader) {
    if (app.mode === 'local' || app.mode === 'host') return true;
    return isMyTurn();
  }
  if (reader.isCPU) return false; // NPCタイマーが force で閉じる
  if (app.mode === 'local') return true;
  return isLocalPlayer({
    mode: app.mode,
    player: reader,
    localSeat: app.localSeat,
    localPeerId: app.net?.peerId,
  });
}

/** 人間の出来事ポップ：無操作ならこの時間で自動閉じ */
const EVENT_FLASH_HUMAN_AUTO_MS = 5000;

function scheduleNpcEventFlashIfNeeded() {
  clearTimeout(app.eventFlashNpcTimer);
  if (!app.eventFlashOpen) return;
  const reader = app.game?.players?.[app.eventFlashReaderId];
  const npcReading = !!reader?.isCPU;

  // ゲスト: NPC確認はホストが進める。自分が閉じられるポップだけ自動閉じ→ホストへ通知
  if (app.mode === 'guest') {
    if (npcReading || !canDismissEventFlash()) return;
    app.eventFlashNpcTimer = setTimeout(() => {
      if (!app.eventFlashOpen || !canDismissEventFlash()) return;
      dismissEventFlash();
    }, EVENT_FLASH_HUMAN_AUTO_MS);
    return;
  }

  if (npcReading) {
    const delay = 1200 + Math.random() * 600;
    app.eventFlashNpcTimer = setTimeout(() => {
      if (!app.eventFlashOpen) return;
      const r = app.game?.players?.[app.eventFlashReaderId];
      if (!r?.isCPU) return;
      dismissEventFlash({ force: true });
    }, delay);
    return;
  }

  // ホスト／ローカル: 人間ポップは必ず自動進行する。
  // 確認担当クライアントにUIが出なかった場合でも、観戦側ホストが永久「確認待ち」で
  // CPU手番を止めないよう、読めない側も force で閉じる（正規の5秒タイムアウト）。
  app.eventFlashNpcTimer = setTimeout(() => {
    if (!app.eventFlashOpen) return;
    const r = app.game?.players?.[app.eventFlashReaderId];
    if (r?.isCPU) return;
    dismissEventFlash({ force: true });
  }, EVENT_FLASH_HUMAN_AUTO_MS);
}

function resolveEventVisual(payload) {
  const kind = payload.kind || 'info';
  const text = `${payload.kicker || ''} ${payload.title || ''} ${payload.detail || ''}`;
  const base = { ...(EVENT_VISUALS[kind] || EVENT_VISUALS.info) };
  const chips = [...(base.chips || [])];

  if (kind === 'shop') {
    const multiM = text.match(/(\d+)\s*倍/);
    if (multiM || /奪取|指名買収/.test(text)) {
      const m = multiM ? multiM[1] : '5';
      base.glyph = m;
      chips.unshift(`${m}倍買い`);
    } else if (/増資/.test(text)) {
      base.glyph = '+';
      chips.unshift('増資');
    } else if (/購入|買った/.test(text)) {
      chips.unshift('購入');
    }
  } else if (kind === 'level' || /独占/.test(text)) {
    if (/独占/.test(text)) {
      base.glyph = '◎';
      chips.unshift('独占');
    }
  } else if (kind === 'mark') {
    const suit = (text.match(/[♠♥♦♣]/) || [])[0];
    if (suit) base.glyph = suit;
  } else if (kind === 'toll') {
    base.glyph = '料';
    const amt = (text.match(/([\d,]+)\s*G/) || [])[1] || (payload.title || '').replace(/[^\d,]/g, '');
    if (amt) chips.unshift(`${amt}G`);
    chips.unshift('支払い');
  } else if (kind === 'system') {
    if (/営業再開/.test(text)) {
      base.glyph = '開';
      chips.unshift('再開');
    } else if (/店休|休み中/.test(text)) {
      base.glyph = '休';
      chips.unshift('店休');
    } else if (/休憩|次ターン休み|復帰/.test(text)) {
      base.glyph = 'Z';
      chips.unshift('休憩');
    } else if (/破産/.test(text)) {
      base.glyph = '×';
      chips.unshift('破産');
    } else if (/売却/.test(text)) {
      base.glyph = '売';
      chips.unshift('売却');
    }
  } else if (kind === 'event') {
    if (/ワープ/.test(text)) {
      base.glyph = '↗';
      chips.unshift('ワープ');
    } else if (/スクラッチ|そろい/.test(text)) {
      base.glyph = '◇';
      chips.unshift('スクラッチ');
    } else if (/ラッキー/.test(text)) {
      base.glyph = '★';
      chips.unshift('ラッキー');
    } else if (/ミニゲーム|当たり|ハズレ|ジャックポット/.test(text)) {
      base.glyph = '遊';
      chips.unshift('ミニゲーム');
    }
  } else if (kind === 'stock') {
    if (/わけ前|配当/.test(text)) {
      base.glyph = '％';
      chips.unshift('わけ前');
    } else if (/売却|売った/.test(text)) chips.unshift('売却');
    else chips.unshift('購入');
  } else if (kind === 'dice') {
    const n = (String(payload.title).match(/^\d+$/) || [])[0];
    if (n) base.glyph = n;
  }

  return { glyph: base.glyph, chips: [...new Set(chips)].slice(0, 3) };
}

/**
 * 直近ログから現金変化の意味を判定。
 * - toll_loss: 他人の店での買い物料
 * - invest: 通常の店購入・増資・株購入
 * - five_buy: 5倍買い
 * - dividend: エリア収益の株わけ前
 * - gain / toll_gain: 収入
 * - loss: その他の強制出費
 */
function classifyMoneyMood(g, p, amount) {
  const name = p.name;
  const recent = (g.logs || []).slice(0, 14);
  for (const l of recent) {
    const t = l.text || '';
    if (l.kind === 'toll') {
      const m = t.match(/^(.+?)\s*→\s*(.+?)[「\s]/);
      if (m) {
        const payer = m[1].trim();
        const owner = m[2].trim();
        if (amount < 0 && (payer === name || payer.includes(name))) return 'toll_loss';
        if (amount > 0 && (owner === name || owner.includes(name))) return 'toll_gain';
      }
      if (amount < 0 && t.startsWith(name)) return 'toll_loss';
    }
    if (l.kind === 'shop' && t.includes(name)) {
      if (/\d+倍/.test(t)) return amount < 0 ? 'five_buy' : 'gain';
      if (/購入|増資/.test(t) && amount <= 0) return 'invest';
    }
    // 物件売却は system ログ（「店名」を売却）
    if (l.kind === 'system' && t.includes(name) && /を売却/.test(t) && amount > 0) {
      return 'shop_sell';
    }
    if (l.kind === 'stock' && t.includes(name)) {
      if (/わけ前|配当/.test(t) && amount > 0) return 'dividend';
      if (/購入/.test(t) && amount < 0) return 'invest';
      if (/売却/.test(t) && amount > 0) return 'gain';
    }
    if (l.kind === 'stock' && /わけ前|配当/.test(t) && amount > 0) return 'dividend';
    if ((l.kind === 'level' || l.kind === 'win') && t.includes(name) && amount > 0) return 'gain';
    if (l.kind === 'event' && t.includes(name)) {
      if (amount > 0) return 'gain';
      if (amount < 0 && /税|出費|支払|−|-/.test(t)) return 'loss';
    }
  }
  return amount > 0 ? 'gain' : 'loss';
}

/** 現金増減を検知して内容が分かる演出を出す */
function maybePresentMoneyFx(g) {
  if (!g?.players) return;
  const next = {};
  for (const p of g.players) next[p.id] = p.cash;
  if (!app.prevCash) {
    app.prevCash = next;
    return;
  }
  const deltas = [];
  for (const p of g.players) {
    const prev = app.prevCash[p.id];
    if (prev == null || prev === p.cash) continue;
    const amount = p.cash - prev;
    if (!amount) continue;
    deltas.push({
      pid: p.id,
      name: p.name,
      color: p.color,
      amount,
      cash: p.cash,
      mood: classifyMoneyMood(g, p, amount),
      mine: app.mode === 'local' ? !p.isCPU : p.id === app.localSeat,
    });
  }
  app.prevCash = next;
  if (!deltas.length) return;
  presentMoneyFx(deltas);
}

function moneyTier(absAmount) {
  if (absAmount >= 1000) return 3;
  if (absAmount >= 300) return 2;
  return 1;
}

function moneyFxBlocked() {
  return !$('#dice-overlay')?.hidden
    || !$('#warp-overlay')?.hidden
    || !$('#scratch-match-overlay')?.hidden
    || !$('#minigame-overlay')?.hidden
    || app.eventFlashOpen
    || !$('#event-flash')?.hidden;
}

/** 本番: 所持金デルタから内容表示。競合中はキューして後で再生 */
function presentMoneyFx(deltas, { remote = false } = {}) {
  if (!deltas?.length) return;
  for (const d of deltas) spawnPlayerCashFloat(d);

  if (moneyFxBlocked()) {
    app.pendingMoneyFx = mergeMoneyDeltas(app.pendingMoneyFx, deltas);
    return;
  }
  showMoneyFxOverlay(deltas, { remote });
}

function mergeMoneyDeltas(prev, next) {
  const map = new Map();
  for (const d of [...(prev || []), ...next]) {
    const cur = map.get(d.pid);
    if (!cur) map.set(d.pid, { ...d });
    else {
      map.set(d.pid, {
        ...cur,
        amount: cur.amount + d.amount,
        cash: d.cash ?? cur.cash,
        mood: d.mood || cur.mood,
      });
    }
  }
  return [...map.values()].filter((d) => d.amount);
}

function flushPendingMoneyFx() {
  if (!app.pendingMoneyFx?.length || moneyFxBlocked()) return;
  if (!$('#money-fx')?.hidden) return;
  const queued = app.pendingMoneyFx;
  app.pendingMoneyFx = null;
  showMoneyFxOverlay(queued);
}

/** 文言は事実のみ（感情表現は入れない） */
function resolveMoneyFxCopy(focus) {
  const mood = focus.mood || (focus.amount > 0 ? 'gain' : 'loss');
  const abs = Math.abs(focus.amount);
  const signed = `${focus.amount > 0 ? '+' : '−'}${abs.toLocaleString()}G`;
  const who = focus.mine ? '' : focus.name;

  if (mood === 'invest') {
    return {
      mood: 'invest',
      color: '#c4a574',
      face: '店',
      title: 'お店・株の購入',
      amount: signed,
      who: who ? `${who} のお店／株への出費` : 'お店／株への出費',
      coinMode: 'invest',
      se: 'invest',
      floatClass: 'invest',
    };
  }
  if (mood === 'five_buy') {
    let multi = 5;
    for (const l of (app.game?.logs || []).slice(0, 14)) {
      const m = String(l.text || '').match(/(\d+)\s*倍/);
      if (m && l.kind === 'shop') {
        multi = Number(m[1]) || 5;
        break;
      }
    }
    return {
      mood: 'five_buy',
      color: '#e09a6a',
      face: `×${multi}`,
      title: `${multi}倍買い`,
      amount: signed,
      who: who ? `${who} がお店を${multi}倍買い` : `お店を${multi}倍買い`,
      coinMode: 'impact',
      se: 'impact',
      floatClass: 'impact',
    };
  }
  if (mood === 'toll_loss') {
    return {
      mood: 'loss',
      color: '#ff8a80',
      face: '料',
      title: '買い物料',
      amount: signed,
      who: who ? `${who} → 他人のお店へ支払い` : '他人のお店へ買い物料を支払い',
      coinMode: 'loss',
      se: 'loss',
      floatClass: 'loss',
    };
  }
  if (mood === 'loss' && focus.amount < 0) {
    return {
      mood: 'loss',
      color: '#ff8a80',
      face: 'G',
      title: '現金の減少',
      amount: signed,
      who: who ? `${who} の現金が減少` : '現金が減少',
      coinMode: 'loss',
      se: 'loss',
      floatClass: 'loss',
    };
  }
  if (mood === 'toll_gain') {
    return {
      mood: 'gain',
      color: '#8fd4a8',
      face: '料',
      title: '買い物料 収入',
      amount: signed,
      who: who ? `${who} の店への買い物料` : '自分の店への買い物料',
      coinMode: 'gain',
      se: 'gain',
      floatClass: 'gain',
    };
  }
  if (mood === 'dividend') {
    return {
      mood: 'gain',
      color: '#6e8fad',
      face: '株',
      title: '株わけ前',
      amount: signed,
      who: who ? `${who} がエリア収益のわけ前を受け取り` : 'エリア収益のわけ前',
      coinMode: 'gain',
      se: 'gain',
      floatClass: 'gain',
    };
  }
  if (mood === 'shop_sell') {
    return {
      mood: 'shop_sell',
      color: '#e6c57a',
      face: '売',
      title: 'お店を売却',
      amount: signed,
      who: who ? `${who} がお店を売却` : 'お店を売却',
      coinMode: 'gain',
      se: 'shopSell',
      floatClass: 'gain',
    };
  }
  return {
    mood: 'gain',
    color: '#8fd4a8',
    face: 'G',
    title: '現金の増加',
    amount: signed,
    who: who ? `${who} の現金が増加` : '現金が増加',
    coinMode: 'gain',
    se: 'gain',
    floatClass: 'gain',
  };
}

function showMoneyFxOverlay(deltas, { remote = false } = {}) {
  const focus = deltas.find((d) => d.mine)
    || [...deltas].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
  if (!focus || !focus.amount) return;

  const copy = resolveMoneyFxCopy(focus);
  const abs = Math.abs(focus.amount);
  const tier = moneyTier(abs);
  const seq = ++app.moneyFxSeq;
  const overlay = $('#money-fx');
  if (!overlay) return;

  clearTimeout(app.moneyFxTimer);
  overlay.dataset.mood = copy.mood;
  overlay.style.setProperty('--mfc', copy.color);
  $('#mf-face').textContent = copy.face;
  $('#mf-mood').textContent = copy.title;
  $('#mf-amount').textContent = copy.amount;
  $('#mf-who').textContent = copy.who;

  const coins = $('#mf-coins');
  const count = 6 + tier * 4;
  const rising = copy.coinMode === 'gain' || copy.coinMode === 'invest' || copy.coinMode === 'impact';
  coins.innerHTML = Array.from({ length: count }, () => {
    const x = 8 + Math.random() * 84;
    const y = rising ? 55 + Math.random() * 30 : 18 + Math.random() * 28;
    const drift = Math.round((Math.random() - 0.5) * 70);
    const delay = (Math.random() * 0.28).toFixed(2);
    const dur = (0.75 + Math.random() * 0.45).toFixed(2);
    return `<span class="mf-coin" style="--x:${x}%;--y:${y}%;--drift:${drift}px;--delay:${delay}s;--dur:${dur}s"></span>`;
  }).join('');

  overlay.hidden = false;
  overlay.classList.remove('show');
  requestAnimationFrame(() => {
    if (app.moneyFxSeq !== seq) return;
    overlay.classList.add('show');
  });

  // 5倍買い本体のファンファーレと二重にならないよう、金額演出は短めのSEに留める
  if (copy.se === 'shopSell') {
    audio.sfx.shopSell();
  } else if (copy.se === 'gain' || copy.se === 'invest' || copy.se === 'impact') {
    audio.sfx.cashGain(copy.se === 'impact' ? Math.max(2, tier) : tier);
  } else {
    audio.sfx.cashLoss(tier);
  }

  maybeExpandEventFeed();

  app.moneyFxTimer = setTimeout(() => {
    if (app.moneyFxSeq !== seq) return;
    overlay.classList.remove('show');
    setTimeout(() => {
      if (app.moneyFxSeq !== seq) return;
      overlay.hidden = true;
      coins.innerHTML = '';
      flushPendingMoneyFx();
      pumpEventFlash();
    }, 240);
  }, 1250 + tier * 120);
}

function spawnPlayerCashFloat(delta) {
  const card = document.querySelector(`.player-card[data-pid="${delta.pid}"]`);
  if (!card) return;
  const copy = resolveMoneyFxCopy(delta);
  const money = card.querySelector('.pc-money');
  if (money) {
    money.classList.remove('gain-pulse', 'loss-pulse', 'invest-pulse', 'impact-pulse');
    void money.offsetWidth;
    money.classList.add(`${copy.floatClass}-pulse`);
  }
  const floater = document.createElement('div');
  floater.className = `pc-cash-float ${copy.floatClass}`;
  floater.textContent = `${delta.amount > 0 ? '+' : '−'}${Math.abs(delta.amount).toLocaleString()}G`;
  card.appendChild(floater);
  setTimeout(() => floater.remove(), 1000);
}

/** 盤面中央に視覚的なイベントフラッシュを出す（確認完了まで進行停止） */
function presentEventFlash(payload) {
  const overlay = $('#event-flash');
  if (!overlay || !payload?.title) {
    pumpEventFlash();
    return;
  }
  if (eventFlashBlocked()) {
    app.eventFlashQueue.unshift(payload);
    return;
  }

  const visual = payload.visual || resolveEventVisual(payload);
  const kind = payload.kind || 'info';
  const color = payload.color || '#c4a574';
  const seq = ++app.eventFlashSeq;
  // マス／アイコン枠からはみ出さないよう最大2文字＆長さに応じて縮小
  const glyph = String(visual.glyph || '!').slice(0, 2);
  const reader = eventFlashReader(payload);
  app.eventFlashReaderId = reader?.id ?? payload.actorId ?? app.actionActorId;

  clearTimeout(app.eventFlashTimer);
  clearTimeout(app.eventFlashNpcTimer);
  app.eventFlashOpen = true;
  // 確認完了まで絶対に手番進行を止める
  app.eventFlashHoldingBusy = true;
  app.busy = true;
  clearTimeout(app.cpuTimer);

  const npcReading = !!reader?.isCPU;
  const canDismiss = canDismissEventFlash();
  const spectator = !canDismiss;
  overlay.dataset.visual = kind;
  overlay.dataset.spectator = spectator ? '1' : '0';
  overlay.dataset.npc = npcReading ? '1' : '0';
  overlay.style.setProperty('--efc', color);
  const icon = $('#ef-icon');
  icon.textContent = glyph;
  icon.dataset.len = String([...glyph].length);
  $('#ef-kicker').textContent = payload.kicker || '';
  $('#ef-title').textContent = payload.title || '';
  $('#ef-detail').textContent = payload.detail || '';
  const chips = $('#ef-chips');
  chips.innerHTML = (visual.chips || [])
    .map((c, i) => `<span class="ef-chip" style="--i:${i}">${escapeHtml(c)}</span>`)
    .join('');
  const hint = $('#ef-hint');
  const btn = $('#ef-continue');
  const queued = app.eventFlashQueue.length;
  const readerName = reader?.name || '手番プレイヤー';
  if (hint) {
    if (npcReading) {
      hint.textContent = queued
        ? `${readerName}（NPC）が確認中…（残り ${queued}）`
        : `${readerName}（NPC）が確認中…`;
    } else if (spectator) {
      hint.textContent = `${readerName} が確認するまで待機`;
    } else {
      hint.textContent = queued
        ? `確認したら「つづける」（残り ${queued}）· 5秒で自動`
        : '確認したら「つづける」· 5秒で自動';
    }
  }
  if (btn) {
    btn.hidden = spectator || npcReading;
    btn.disabled = npcReading;
    btn.textContent = queued ? `つづける（残り ${queued}）` : 'つづける';
  }

  overlay.hidden = false;
  overlay.classList.remove('show');
  requestAnimationFrame(() => {
    if (app.eventFlashSeq !== seq) return;
    overlay.classList.add('show');
    try { (btn && canDismiss ? btn : overlay).focus({ preventScroll: true }); } catch (_) { /* ignore */ }
  });

  // ユーザーが一度隠していなければフィードも開く
  maybeExpandEventFeed();
  $('#btn-roll').disabled = true;
  $('#btn-roll').textContent = npcReading
    ? `${readerName} が確認中…`
    : (canDismiss ? '出来事を確認中…' : `${readerName} の確認待ち…`);

  scheduleNpcEventFlashIfNeeded();
}

/** 確認担当のクリック／Enter、または NPC タイマーで次へ */
function dismissEventFlash({ remote = false, force = false } = {}) {
  if (!app.eventFlashOpen) return;
  if (!remote && !force && !canDismissEventFlash()) return;

  if (!remote && !force && app.mode === 'guest' && app.net) {
    audio.sfx.click();
    // busy 解除と他端末同期はホスト経由。未応答でも詰まらないよう待ち表示＋タイムアウト解放
    const btn = $('#ef-continue');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '同期中…';
    }
    const sent = app.net.sendToHost({ type: 'event_flash_dismiss', seat: app.localSeat });
    if (!sent) {
      toast('ホストに届きませんでした。再接続を試してください');
      dismissEventFlash({ remote: true });
      return;
    }
    clearTimeout(app.eventFlashDismissWait);
    app.eventFlashDismissWait = setTimeout(() => {
      app.eventFlashDismissWait = null;
      if (!app.eventFlashOpen) return;
      // ホスト未応答でもクライアントは進めるが、ホスト残留で止まらないよう flush も依頼
      dismissEventFlash({ remote: true });
      requestHostEventFlashFlush();
    }, 1500);
    return;
  }

  clearTimeout(app.eventFlashDismissWait);
  app.eventFlashDismissWait = null;
  const overlay = $('#event-flash');
  const seq = app.eventFlashSeq;
  clearTimeout(app.eventFlashTimer);
  clearTimeout(app.eventFlashNpcTimer);
  if (!remote) {
    if (!force) audio.sfx.click();
    if (app.mode === 'host') broadcastFx({ kind: 'eventFlashDismiss' });
    // ローカルの NPC 進行でも音は控えめに
    else if (force && app.mode === 'local') audio.sfx.click();
  }
  if (overlay) {
    overlay.classList.remove('show');
    // hidden 済みでも open フラグが残ると進行が止まるので必ず解放する
    app.eventFlashTimer = setTimeout(() => {
      if (app.eventFlashSeq !== seq) return;
      overlay.hidden = true;
      overlay.dataset.spectator = '0';
      overlay.dataset.npc = '0';
      app.eventFlashOpen = false;
      const btn = $('#ef-continue');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'つづける';
      }
      pumpEventFlash();
    }, 180);
  } else {
    app.eventFlashOpen = false;
    pumpEventFlash();
  }
}

function isTypingTarget(el) {
  if (!el || !(el instanceof Element)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return !!el.closest?.('input, textarea, select, [contenteditable="true"]');
}

function screenIsActive(id) {
  return !!$(id)?.classList.contains('active');
}

/** スペース：サイコロ／出来事のつづける／選択のスキップ。クリック操作はそのまま */
function bindSpaceShortcuts() {
  if (document.body.dataset.spaceBound === '1') return;
  document.body.dataset.spaceBound = '1';
  document.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.code !== 'Space') return;
    if (e.repeat) return;
    if (isTypingTarget(document.activeElement) || isTypingTarget(e.target)) return;

    // 出来事フラッシュ（つづける）
    if (app.eventFlashOpen) {
      e.preventDefault();
      dismissEventFlash();
      return;
    }

    // 順番決めダイス
    if (screenIsActive('#screen-order-roll') && app.orderRoll) {
      const btn = $('#btn-order-roll');
      if (btn && !btn.disabled) {
        e.preventDefault();
        btn.click();
        return;
      }
    }

    // ゲーム中のサイコロ
    if (screenIsActive('#screen-game') && app.game) {
      const roll = $('#btn-roll');
      if (roll && !roll.disabled && !app.busy) {
        e.preventDefault();
        roll.click();
        return;
      }
    }

    // 選択ダイアログ：購入は確定、それ以外はスキップ（表示中のみ）
    if (app.modalActive && app.modalMode !== 'hidden') {
      e.preventDefault();
      const pend = app.game?.pending;
      if (pend?.type === 'buy_shop') {
        const buy = $('#m-buy');
        if (buy && !buy.disabled) {
          buy.click();
          return;
        }
      }
      const skip = $('#btn-skip-choice');
      if (skip && !skip.hidden && !skip.disabled) {
        skip.click();
      }
    }
  });
}

function bindEventFlashControls() {
  const overlay = $('#event-flash');
  if (!overlay || overlay.dataset.bound === '1') return;
  overlay.dataset.bound = '1';
  const onDismiss = (e) => {
    e.preventDefault();
    dismissEventFlash();
  };
  overlay.addEventListener('click', onDismiss);
  $('#ef-continue')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dismissEventFlash();
  });
  document.addEventListener('keydown', (e) => {
    if (!app.eventFlashOpen) return;
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      dismissEventFlash();
    }
  });
}

/** 左上フィードへ即時スタンプ追加（上→下・さかのぼり可） */
function pushEventStamp({ kicker, title, detail, kind, color, mine, visual, silentStamp }) {
  const feed = $('#event-feed');
  if (!feed) return;

  const v = visual || resolveEventVisual({ kicker, title, detail, kind });
  const stamp = document.createElement('article');
  stamp.className = 'event-stamp';
  stamp.dataset.kind = kind || 'info';
  stamp.dataset.mine = mine ? '1' : '0';
  stamp.style.setProperty('--eb', color || '#ffe08a');
  const glyph = String(v.glyph || '!');
  stamp.innerHTML = `
    <div class="eb-glyph" data-len="${[...glyph].length}" aria-hidden="true">${escapeHtml(glyph)}</div>
    <div class="eb-kicker">${escapeHtml(kicker || '')}</div>
    <div class="eb-title">${escapeHtml(title || '')}</div>
    ${detail ? `<div class="eb-detail">${escapeHtml(detail)}</div>` : ''}
  `;
  // 時系列は上（古い）→下（新しい）。新しいスタンプは末尾へ追加
  feed.appendChild(stamp);

  while (feed.children.length > 40) feed.firstElementChild?.remove();

  // 未オーバーフロー時は先頭（上）を見せて積み下がりを確認。溢れたら下端追従
  const overflowing = feed.scrollHeight > feed.clientHeight + 2;
  if (!overflowing) {
    feed.scrollTop = 0;
    app.feedPinnedBottom = true;
  } else if (app.feedPinnedBottom !== false) {
    feed.scrollTop = feed.scrollHeight;
  }

  if (silentStamp) return;
  if (kind === 'shop' || kind === 'level' || kind === 'mark' || kind === 'event') audio.sfx.buy();
}

function phaseLabel(g) {
  switch (g.phase) {
    case 'await_roll': return 'サイコロ待ち';
    case 'await_choice': return '選択待ち';
    case 'await_fork': return '分岐選択';
    case 'moving': return '移動中';
    case 'gameover': return '終了';
    default: return g.phase;
  }
}

/** 店IDをエリア順にグループ化 */
function groupShopIdsByArea(g, ids) {
  /** @type {Map<number, number[]>} */
  const groups = new Map();
  for (const raw of ids || []) {
    const id = Number(raw);
    const sq = getNode(g, id);
    if (!sq || sq.type !== 'shop') continue;
    const area = Number(sq.area);
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(id);
  }
  return [...groups.entries()].sort((a, b) => {
    const ca = getAreaCode(g, a[0]);
    const cb = getAreaCode(g, b[0]);
    return String(ca).localeCompare(String(cb), 'ja') || a[0] - b[0];
  });
}

function shopAreaDisplayName(g, area) {
  return AREA_META[area]?.name || g.areas?.[area]?.name || getAreaCode(g, area);
}

/**
 * エリア見出し付きの店選びリストHTML。
 * @param {(id:number)=>string} renderShopBtn
 */
function renderGroupedShopPickList(g, ids, renderShopBtn) {
  const groups = groupShopIdsByArea(g, ids);
  if (!groups.length) return '';
  const tabs = groups.map(([area, shopIds]) => {
    const color = AREA_META[area]?.color || g.areas?.[area]?.color || '#888';
    const code = getAreaCode(g, area);
    return `<button type="button" class="shop-pick-tab" data-jump-area="${area}" style="--ac:${color}" title="${escapeHtml(shopAreaDisplayName(g, area))}">
      <span class="shop-pick-tab-swatch" aria-hidden="true"></span>${escapeHtml(code)}<small>${shopIds.length}</small>
    </button>`;
  }).join('');
  const sections = groups.map(([area, shopIds]) => {
    const color = AREA_META[area]?.color || g.areas?.[area]?.color || '#888';
    const code = getAreaCode(g, area);
    const name = shopAreaDisplayName(g, area);
    return `<section class="shop-pick-area" data-area="${area}" id="shop-pick-area-${area}" style="--ac:${color}">
      <header class="shop-pick-area-head" data-peek-area="${area}">
        <span class="shop-pick-area-swatch" aria-hidden="true"></span>
        <span class="shop-pick-area-code">${escapeHtml(code)}</span>
        <span class="shop-pick-area-name">${escapeHtml(name)}</span>
        <span class="shop-pick-area-count">${shopIds.length}店</span>
      </header>
      <div class="shop-pick-area-shops">${shopIds.map((id) => renderShopBtn(id)).join('')}</div>
    </section>`;
  }).join('');
  return `<div class="shop-pick-tabs" role="tablist">${tabs}</div>
    <div class="pick-invest-list shop-pick-scroll">${sections}</div>`;
}

/** エリアタブ／見出しのホバーで盤面エリアを光らせ、タブで該当ブロックへスクロール */
function bindShopPickAreaChrome(g, listRoot) {
  const root = listRoot || $('#modal-body');
  if (!root) return;
  const clearPeek = () => app.renderer?.clearStockHighlight?.();
  root.querySelectorAll('[data-peek-area], .shop-pick-tab').forEach((el) => {
    const area = Number(el.dataset.peekArea || el.dataset.jumpArea);
    if (!Number.isFinite(area)) return;
    el.addEventListener('mouseenter', () => app.renderer?.setStockHighlight?.(area, true));
    el.addEventListener('mouseleave', clearPeek);
  });
  root.querySelectorAll('.shop-pick-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const area = Number(tab.dataset.jumpArea);
      const section = root.querySelector(`#shop-pick-area-${area}`);
      section?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      app.renderer?.setStockHighlight?.(area, true);
      root.querySelectorAll('.shop-pick-tab').forEach((t) => {
        t.classList.toggle('is-active', Number(t.dataset.jumpArea) === area);
      });
    });
  });
}

/**
 * 盤面クリックで選んだ店ボタンをリスト内で見える位置までスクロールし、
 * 対応エリアタブをアクティブにする。
 */
function scrollShopPickIntoView(btn) {
  if (!btn) return;
  const root = $('#modal-body');
  const area = Number(btn.dataset.area);
  if (root && Number.isFinite(area)) {
    root.querySelectorAll('.shop-pick-tab').forEach((t) => {
      t.classList.toggle('is-active', Number(t.dataset.jumpArea) === area);
    });
  }
  // リスト内のスクロールコンテナ優先（カード全体を動かさない）
  const scroller = btn.closest('.shop-pick-scroll, .pick-invest-list');
  if (scroller && typeof scroller.getBoundingClientRect === 'function') {
    const sRect = scroller.getBoundingClientRect();
    const bRect = btn.getBoundingClientRect();
    const pad = 12;
    let nextTop = scroller.scrollTop;
    if (bRect.top < sRect.top + pad) {
      nextTop -= (sRect.top + pad) - bRect.top;
    } else if (bRect.bottom > sRect.bottom - pad) {
      nextTop += bRect.bottom - (sRect.bottom - pad);
    } else {
      // すでに見えていても中央付近へ寄せる（マップ選択のフィードバック）
      const btnMid = bRect.top + bRect.height / 2;
      const scrollerMid = sRect.top + sRect.height / 2;
      nextTop += btnMid - scrollerMid;
    }
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    nextTop = Math.max(0, Math.min(maxScroll, nextTop));
    if (typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ top: nextTop, behavior: 'smooth' });
    } else {
      scroller.scrollTop = nextTop;
    }
    return;
  }
  btn.scrollIntoView({ block: 'center', behavior: 'smooth', inline: 'nearest' });
}

function enableShopPickModalCard() {
  $('#modal-card')?.classList.add('shop-pick-modal');
}

function showChoiceModal(g) {
  const pend = g.pending;
  const modal = $('#modal');
  const body = $('#modal-body');
  const title = $('#modal-title');
  app.modalActive = true;
  if (app.modalMode === 'hidden') {
    applyModalMode();
    return;
  }
  // pending／関連資産が変わっていなければ作り直さない（催促での数値巻き戻り防止）
  // raise_funds は売却で cash/stocks が変わるので modalContentKey で再描画する
  const fp = modalContentKey(g, pend) || pendingFingerprint(pend);
  if (fp && fp === app.modalPendingKey && !modal.hidden && body?.childNodes?.length) {
    applyModalMode();
    scheduleModalLayoutClamp();
    return;
  }
  const drafts = (!modal.hidden && body?.childNodes?.length)
    ? snapshotEditableFields(body)
    : [];
  app.modalPendingKey = fp;
  modal.hidden = false;
  applyModalMode();
  $('#btn-end-choice').hidden = true;
  $('#btn-skip-choice').hidden = false;
  $('#btn-skip-choice').textContent = 'やめる';
  $('#modal-card').classList.remove('wide');
  $('#modal-card').classList.remove('stock-modal');
  $('#modal-card').classList.remove('scratch-modal');
  $('#modal-card').classList.remove('raise-modal');
  $('#modal-card').classList.remove('shop-pick-modal');
  hideForkRails();

  try {
  if (pend.type === 'fork') {
    title.textContent = `どちらへ進む？（残り${pend.stepsLeft}マス）`;
    $('#modal-card').classList.add('fork-hint-only');
    body.innerHTML = `
      <p class="hint">端の進路ボタンか、盤上の<strong>ハイライトされた停止マス</strong>を直接クリックしても進めます。タイトルをドラッグで移動できます。</p>`;
    $('#btn-skip-choice').hidden = true;
    renderForkRails(pend);
    return;
  }
  $('#modal-card').classList.remove('fork-hint-only');

  if (pend.type === 'shop_trade_compose') {
    title.textContent = '物件取引';
    $('#modal-card').classList.add('wide');
    $('#btn-skip-choice').textContent = 'やめる';
    const others = g.players.filter((o) => o.id !== pend.playerId && !o.bankrupt
      && g.map.some((s) => s.type === 'shop' && s.owner === o.id));
    const target = pend.targetId != null ? g.players[pend.targetId] : null;
    const giveSet = new Set(pend.giveShopIds || []);
    const takeSet = new Set(pend.takeShopIds || []);
    const giveValue = sumShopPrices(g, pend.giveShopIds);
    const takeValue = sumShopPrices(g, pend.takeShopIds);
    const cashDelta = Math.floor(Number(pend.cashDelta) || 0);
    const autoDelta = defaultShopTradeCashDelta(giveValue, takeValue);
    const myShops = g.map.filter((s) => s.type === 'shop' && s.owner === pend.playerId);
    const theirShops = target
      ? g.map.filter((s) => s.type === 'shop' && s.owner === target.id)
      : [];
    const shopBtn = (sq, selected, dataAttr) => `
      <button type="button" class="btn tiny trade-shop${selected ? ' selected' : ''}"
        ${dataAttr}="${sq.id}" style="--ac:${AREA_META[sq.area]?.color || '#888'}">
        ${escapeHtml(sq.label)}
        <span class="hint">${sq.price.toLocaleString()}G・${getAreaCode(g, sq.area)}</span>
      </button>`;
    body.innerHTML = `
      <p class="hint">渡す店と受け取る店を選び、差額を確認して提案します。相手は承認・拒否のほか、差額を変えて逆交渉できます。</p>
      <div class="trade-section">
        <h4>相手</h4>
        <div class="trade-targets">
          ${others.map((o) => `
            <button type="button" class="btn tiny${pend.targetId === o.id ? ' primary' : ''}"
              data-trade-target="${o.id}" style="--pc:${o.color}">
              ${escapeHtml(o.name)}${o.isCPU ? '（CPU）' : ''}
            </button>`).join('') || '<p class="hint">取引できる相手がいません</p>'}
        </div>
      </div>
      ${target ? `
      <div class="trade-cols">
        <div class="trade-section">
          <h4>渡す（自分 → ${escapeHtml(target.name)}）</h4>
          <p class="hint">合計 ${giveValue.toLocaleString()}G</p>
          <div class="trade-shop-list">${myShops.map((sq) => shopBtn(sq, giveSet.has(sq.id), 'data-trade-give')).join('')}</div>
        </div>
        <div class="trade-section">
          <h4>受け取る（${escapeHtml(target.name)} → 自分）</h4>
          <p class="hint">合計 ${takeValue.toLocaleString()}G</p>
          <div class="trade-shop-list">${theirShops.map((sq) => shopBtn(sq, takeSet.has(sq.id), 'data-trade-take')).join('')}</div>
        </div>
      </div>
      <div class="trade-section">
        <h4>差額精算</h4>
        <p class="hint">店価差のデフォルトは ${autoDelta === 0 ? '0G' : (autoDelta > 0 ? `あなたが ${autoDelta.toLocaleString()}G 支払い` : `相手が ${Math.abs(autoDelta).toLocaleString()}G 支払い`)}です。変更できます（正の値＝あなたが支払う）。</p>
        <label class="field">差額（G）
          <input type="number" id="trade-cash-delta" value="${cashDelta}" step="10" />
        </label>
        <p class="modal-lead">${cashDelta === 0 ? '現金のやりとりなし' : (cashDelta > 0 ? `あなたが ${cashDelta.toLocaleString()}G 支払う` : `相手が ${Math.abs(cashDelta).toLocaleString()}G 支払う`)}</p>
      </div>
      <div class="modal-actions">
        <button class="btn primary" id="m-trade-propose">この内容で提案</button>
      </div>` : '<p class="hint">先に相手を選んでください</p>'}`;
    body.querySelectorAll('[data-trade-target]').forEach((btn) => {
      btn.onclick = () => {
        sendAction({ type: 'choice', choice: { action: 'set_target', targetId: Number(btn.dataset.tradeTarget) } });
      };
    });
    body.querySelectorAll('[data-trade-give]').forEach((btn) => {
      btn.onclick = () => {
        sendAction({ type: 'choice', choice: { action: 'toggle_give', shopId: Number(btn.dataset.tradeGive) } });
      };
    });
    body.querySelectorAll('[data-trade-take]').forEach((btn) => {
      btn.onclick = () => {
        sendAction({ type: 'choice', choice: { action: 'toggle_take', shopId: Number(btn.dataset.tradeTake) } });
      };
    });
    const cashInput = $('#trade-cash-delta');
    if (cashInput) {
      const commitCash = () => {
        sendAction({ type: 'choice', choice: { action: 'set_cash', cashDelta: Number(cashInput.value) || 0 } });
      };
      cashInput.addEventListener('change', commitCash);
    }
    $('#m-trade-propose')?.addEventListener('click', () => {
      const cashDelta = Number($('#trade-cash-delta')?.value) || 0;
      sendAction({ type: 'choice', choice: { action: 'propose', cashDelta } });
    });
    if (drafts.length) restoreEditableFields(body, drafts);
    return;
  }

  if (pend.type === 'shop_trade_offer') {
    const from = g.players[pend.fromId];
    const me = g.players[pend.playerId];
    title.textContent = '物件取引の提案';
    $('#modal-card').classList.add('wide');
    // モーダル内に拒否があるのでフッタの「拒否する」は出さない（二重表示防止）
    $('#btn-skip-choice').hidden = true;
    const giveValue = sumShopPrices(g, pend.giveShopIds);
    const takeValue = sumShopPrices(g, pend.takeShopIds);
    const cashDelta = Math.floor(Number(pend.cashDelta) || 0);
    const counterCash = pend.counterCashDelta != null
      ? Math.floor(Number(pend.counterCashDelta) || 0)
      : cashDelta;
    const listShops = (ids) => (ids || []).map((id) => {
      const sq = getNode(g, id);
      if (!sq) return '';
      return `<li><strong>${escapeHtml(sq.label)}</strong>（${sq.price.toLocaleString()}G）</li>`;
    }).join('');
    let cashLine = '現金のやりとりなし';
    if (cashDelta > 0) cashLine = `${escapeHtml(from?.name || '相手')} があなたへ ${cashDelta.toLocaleString()}G 支払い`;
    else if (cashDelta < 0) cashLine = `あなたが ${escapeHtml(from?.name || '相手')} へ ${Math.abs(cashDelta).toLocaleString()}G 支払い`;
    const counterLead = counterCash === 0
      ? '逆交渉：現金のやりとりなし'
      : (counterCash > 0
        ? `逆交渉：相手があなたへ ${counterCash.toLocaleString()}G`
        : `逆交渉：あなたが相手へ ${Math.abs(counterCash).toLocaleString()}G`);
    body.innerHTML = `
      <p class="modal-lead">${escapeHtml(from?.name || '相手')} からの提案です</p>
      <div class="trade-cols">
        <div class="trade-section">
          <h4>あなたが受け取る（計 ${giveValue.toLocaleString()}G）</h4>
          <ul class="trade-summary">${listShops(pend.giveShopIds) || '<li class="hint">なし</li>'}</ul>
        </div>
        <div class="trade-section">
          <h4>あなたが渡す（計 ${takeValue.toLocaleString()}G）</h4>
          <ul class="trade-summary">${listShops(pend.takeShopIds) || '<li class="hint">なし</li>'}</ul>
        </div>
      </div>
      <p><strong>提案の差額：</strong>${cashLine}</p>
      <div class="trade-section">
        <h4>逆交渉の差額</h4>
        <p class="hint">正の値＝相手があなたに支払う。承認は元の提案額のまま、逆交渉だけ下書き額を使います。</p>
        <label class="field">差額（G）
          <input type="number" id="trade-counter-cash" value="${counterCash}" step="10" />
        </label>
        <p class="modal-lead">${counterLead}</p>
      </div>
      <p class="hint">所持金 ${Number(me?.cash || 0).toLocaleString()}G</p>
      <div class="modal-actions">
        <button class="btn primary" id="m-trade-accept">承認する</button>
        <button class="btn" id="m-trade-counter">この差額で逆交渉</button>
        <button class="btn danger ghost" id="m-trade-reject">拒否する</button>
      </div>`;
    const counterInput = $('#trade-counter-cash');
    if (counterInput) {
      const commitCounterCash = () => {
        sendAction({ type: 'choice', choice: { action: 'set_cash', cashDelta: Number(counterInput.value) || 0 } });
      };
      counterInput.addEventListener('change', commitCounterCash);
    }
    const sendTradeOfferChoice = (choice) => {
      if (app.choiceResolving) return;
      for (const id of ['m-trade-accept', 'm-trade-counter', 'm-trade-reject']) {
        const btn = $(`#${id}`);
        if (btn) btn.disabled = true;
      }
      hideModal();
      sendAction({ type: 'choice', choice });
    };
    $('#m-trade-accept').onclick = () => {
      sendTradeOfferChoice({ action: 'accept' });
    };
    $('#m-trade-counter').onclick = () => {
      const draft = Number($('#trade-counter-cash')?.value || 0);
      sendTradeOfferChoice({ action: 'counter', cashDelta: draft });
    };
    $('#m-trade-reject').onclick = () => {
      audio.sfx.cancel();
      sendTradeOfferChoice({ action: 'reject' });
    };
    return;
  }

  if (pend.type === 'buy_shop') {
    const sq = getNode(g, pend.shopId);
    const buyer = g.players[pend.playerId];
    const price = Number(pend.price ?? sq?.price) || 0;
    const canAfford = (buyer?.cash || 0) >= price;
    title.textContent = 'お店を購入？';
    $('#btn-skip-choice').textContent = '見送る';
    body.innerHTML = `
      <p class="modal-lead"><strong>${escapeHtml(sq?.label || 'お店')}</strong>（${AREA_META[sq?.area]?.name || '？'}）</p>
      <p>価格 <strong>${price.toLocaleString()}G</strong></p>
      <p class="hint">所持金 ${(buyer?.cash || 0).toLocaleString()}G${canAfford ? '' : '（不足時は資金調達へ）'}</p>
      <div class="modal-actions">
        <button class="btn primary" id="m-buy">購入する</button>
      </div>`;
    $('#m-buy').onclick = () => {
      hideModal();
      sendAction({ type: 'choice', choice: { action: 'buy' } });
    };
    return;
  }

  if (pend.type === 'invest') {
    const investor = g.players[pend.playerId];
    const landedId = pend.landedShopId ?? pend.shopId;
    const landed = getNode(g, landedId);
    const ids = pend.shopIds?.length
      ? pend.shopIds
      : g.map.filter((s) => s.type === 'shop' && s.owner === pend.playerId).map((s) => s.id);
    let selectedId = Number(landedId);
    if (!ids.includes(selectedId) && ids.length) selectedId = ids[0];

    const shopMeta = (id) => {
      const sq = getNode(g, id);
      if (!sq) return null;
      const rem = getRemainingInvest(g, sq);
      const maxInv = getMaxExtraInvest(g, sq);
      const owned = getPlayerAreaCount(g, pend.playerId, sq.area);
      const total = getAreaShops(g, sq.area).length;
      const rate = getAreaMonopolyRate(g, pend.playerId, sq.area);
      const multi = investMultiByMonopolyRate(rate);
      const pct = Math.round(rate * 100);
      const area = shopAreaDisplayName(g, sq.area);
      const code = getAreaCode(g, sq.area);
      return { sq, rem, maxInv, owned, total, multi, pct, area, code };
    };

    title.textContent = '好きな店へ増資';
    enableShopPickModalCard();
    const hasHalf = !!investor?.flags?.investCoupon;
    const listHtml = ids.length
      ? renderGroupedShopPickList(g, ids, (id) => {
        const m = shopMeta(id);
        if (!m) return '';
        const landedTag = id === landedId ? '<span class="invest-landed-tag">止まった店</span>' : '';
        return `<button type="button" class="btn pick-invest-shop invest-pick-shop${id === selectedId ? ' selected' : ''}" data-shop="${id}" data-area="${m.sq.area}" style="--ac:${AREA_META[m.sq.area]?.color || '#888'}">
          <strong>${escapeHtml(m.sq.label)}</strong>${landedTag}
          <span class="pick-invest-gain">枠 ${m.rem.toLocaleString()}G</span>
          <small>${escapeHtml(m.code)} · 料 ${calcToll(g, m.sq).toLocaleString()}G · 独占 ${m.owned}/${m.total}（×${m.multi}）</small>
        </button>`;
      })
      : '<p class="hint">所持店がありません</p>';

    const renderAmount = () => {
      const m = shopMeta(selectedId);
      const rem = m?.rem || 0;
      const panel = $('#invest-amount-panel');
      if (!panel || !m) return;
      const preview = Math.min(rem, 100);
      const payPreview = hasHalf ? Math.ceil(preview / 2) : preview;
      panel.innerHTML = `
        <p class="modal-lead">選択中: <strong>${escapeHtml(m.sq.label)}</strong> <span class="hint">（${escapeHtml(m.code)} ${escapeHtml(m.area)}）</span></p>
        <p>買い物料 ${calcToll(g, m.sq).toLocaleString()}G / 増資残り <strong>${rem.toLocaleString()}G</strong></p>
        <p class="hint">独占率 ${m.owned}/${m.total}（${m.pct}%）→ 上限倍率×${m.multi}（上限 ${m.maxInv.toLocaleString()}G）</p>
        <label class="field">増資額 <input type="number" id="m-amt" min="0" max="${rem}" value="${preview}" ${rem <= 0 ? 'disabled' : ''} /></label>
        ${hasHalf ? `<p class="invest-half-pay">支払い <strong id="m-pay">${payPreview.toLocaleString()}G</strong>（半額クーポン）</p>` : ''}
        <div class="modal-actions">
          <button class="btn primary" id="m-inv" ${rem <= 0 ? 'disabled' : ''}>${rem <= 0 ? '増資上限です' : '増資する'}</button>
        </div>`;
      const amtInput = $('#m-amt');
      const syncPay = () => {
        const payEl = $('#m-pay');
        if (!payEl || !hasHalf) return;
        const amount = Number(amtInput?.value) || 0;
        payEl.textContent = `${Math.ceil(amount / 2).toLocaleString()}G`;
      };
      amtInput?.addEventListener('input', syncPay);
      $('#m-inv').onclick = () => {
        const amount = Number($('#m-amt').value) || 0;
        hideModal();
        sendAction({ type: 'choice', choice: { action: 'invest', shopId: selectedId, amount } });
      };
    };

    body.innerHTML = `
      <div class="shop-pick-layout">
        ${hasHalf ? '<div class="invest-half-banner" role="status">増資半額クーポン適用中 — 今回の増資支払いが半分</div>' : ''}
        <p class="hint shop-pick-intro">${landed ? `「${escapeHtml(landed.label)}」に止まりました。` : ''}エリア見出し／タブで場所を確認。選択店は盤面で琥珀色に光ります。</p>
        ${listHtml}
        <div id="invest-amount-panel" class="shop-pick-footer"></div>
      </div>`;
    const syncInvestHighlight = () => {
      app.renderer?.setInvestHighlight(selectedId);
      const sq = getNode(g, selectedId);
      if (sq) app.renderer?.setStockHighlight?.(sq.area, true);
    };
    $$('.invest-pick-shop').forEach((btn) => {
      btn.onmouseenter = () => {
        app.renderer?.setInvestHighlight(Number(btn.dataset.shop));
        const area = Number(btn.dataset.area);
        if (Number.isFinite(area)) app.renderer?.setStockHighlight?.(area, true);
      };
      btn.onmouseleave = () => {
        syncInvestHighlight();
      };
      btn.onclick = () => {
        selectedId = Number(btn.dataset.shop);
        $$('.invest-pick-shop').forEach((b) => b.classList.toggle('selected', Number(b.dataset.shop) === selectedId));
        syncInvestHighlight();
        renderAmount();
      };
    });
    bindShopPickAreaChrome(g, body);
    syncInvestHighlight();
    renderAmount();
    return;
  }

  if (pend.type === 'pick_invest') {
    const amount = pend.amount || 80;
    const ids = pend.shopIds?.length
      ? pend.shopIds
      : g.map.filter((s) => s.type === 'shop' && s.owner === pend.playerId).map((s) => s.id);
    title.textContent = 'スクラッチ特典：店を選んで増資';
    enableShopPickModalCard();
    const listHtml = ids.length
      ? renderGroupedShopPickList(g, ids, (id) => {
        const sq = getNode(g, id);
        if (!sq) return '';
        const rem = getRemainingInvest(g, sq);
        const code = getAreaCode(g, sq.area);
        const capped = rem < amount;
        return `<button type="button" class="btn pick-invest-shop" data-shop="${sq.id}" data-area="${sq.area}" style="--ac:${AREA_META[sq.area]?.color || '#888'}">
          <strong>${escapeHtml(sq.label)}</strong>
          <span class="pick-invest-gain">+${Math.min(amount, Math.max(0, rem)).toLocaleString()}G</span>
          <small>${escapeHtml(code)} · 価格 ${sq.price.toLocaleString()}G · 枠 ${rem.toLocaleString()}G${capped ? '（枠内まで）' : ''}</small>
        </button>`;
      })
      : '<p class="hint">所持店がありません</p>';
    body.innerHTML = `
      <div class="shop-pick-layout">
        <div class="scratch-followup">
          <p class="scratch-followup-kicker">スクラッチで発動</p>
          <p class="modal-lead">好きな自分の店へ <strong>+${amount.toLocaleString()}G</strong> 無料増資</p>
          <p class="hint">エリア別に並んでいます。ホバーで盤面の場所が分かります。</p>
        </div>
        ${listHtml}
      </div>`;
    $$('.pick-invest-shop').forEach((btn) => {
      btn.onmouseenter = () => {
        app.renderer?.setInvestHighlight(Number(btn.dataset.shop));
        const area = Number(btn.dataset.area);
        if (Number.isFinite(area)) app.renderer?.setStockHighlight?.(area, true);
      };
      btn.onmouseleave = () => {
        app.renderer?.clearInvestHighlight();
        app.renderer?.clearStockHighlight?.();
      };
      btn.onclick = () => {
        hideModal();
        sendAction({ type: 'choice', choice: { action: 'invest', shopId: Number(btn.dataset.shop) } });
      };
    });
    bindShopPickAreaChrome(g, body);
    const skip = $('#btn-skip-choice');
    if (skip) skip.textContent = 'おまかせで増資';
    return;
  }

  if (pend.type === 'force_sell_shop') {
    const rawIds = pend.shopIds?.length
      ? pend.shopIds
      : g.map.filter((s) => s.type === 'shop' && s.owner === pend.playerId).map((s) => s.id);
    const ids = rawIds.filter((id) => {
      const sq = getNode(g, id);
      return sq && sq.type === 'shop' && sq.owner === pend.playerId;
    });
    title.textContent = '強制売却：1店舗売る';
    enableShopPickModalCard();
    const listHtml = ids.length
      ? renderGroupedShopPickList(g, ids, (id) => {
        const sq = getNode(g, id);
        if (!sq) return '';
        const got = Math.floor(sq.price * 0.5);
        const code = getAreaCode(g, sq.area);
        return `<button type="button" class="btn pick-invest-shop force-sell-shop" data-shop="${sq.id}" data-area="${sq.area}" style="--ac:${AREA_META[sq.area]?.color || '#888'}">
          <strong>${escapeHtml(sq.label)}</strong>
          <span class="pick-invest-gain">売却 +${got.toLocaleString()}G</span>
          <small>${escapeHtml(code)} · 価格 ${sq.price.toLocaleString()}G（半額で換金）</small>
        </button>`;
      })
      : '<p class="hint">所持店がありません（つづけるで免除）</p>';
    body.innerHTML = `
      <div class="shop-pick-layout">
        <div class="scratch-followup">
          <p class="scratch-followup-kicker">スクラッチで発動</p>
          <p class="modal-lead">お店を <strong>1店舗</strong> 売却する義務が発生しました</p>
          <p class="hint">エリア別に表示。盤面の店をクリックしても選べます。</p>
        </div>
        ${listHtml}
      </div>`;
    app.renderer?.setShopPickHighlight?.(ids);
    $$('.force-sell-shop').forEach((btn) => {
      btn.onmouseenter = () => {
        app.renderer?.setInvestHighlight(Number(btn.dataset.shop));
        const area = Number(btn.dataset.area);
        if (Number.isFinite(area)) app.renderer?.setStockHighlight?.(area, true);
      };
      btn.onmouseleave = () => {
        app.renderer?.clearInvestHighlight();
        app.renderer?.clearStockHighlight?.();
      };
      btn.onclick = () => {
        hideModal();
        sendAction({ type: 'choice', choice: { action: 'sell', shopId: Number(btn.dataset.shop) } });
      };
    });
    bindShopPickAreaChrome(g, body);
    const skip = $('#btn-skip-choice');
    if (skip) {
      skip.hidden = false;
      skip.disabled = false;
      skip.textContent = ids.length ? 'おまかせで売却' : 'つづける';
    }
    return;
  }

  if (pend.type === 'any_shop_buy') {
    const multi = pend.multi || 6;
    const p = g.players[pend.playerId];
    const ids = pend.shopIds?.length
      ? pend.shopIds
      : g.map.filter((s) => s.type === 'shop' && s.owner >= 0 && s.owner !== pend.playerId).map((s) => s.id);
    title.textContent = `指名買収：${multi}倍で買う`;
    enableShopPickModalCard();
    const listHtml = ids.length
      ? renderGroupedShopPickList(g, ids, (id) => {
        const sq = getNode(g, id);
        if (!sq) return '';
        const owner = g.players[sq.owner];
        const price = sq.price * multi;
        const can = getLiquidatableValue(g, p) >= price;
        const code = getAreaCode(g, sq.area);
        return `<button type="button" class="btn pick-invest-shop any-shop-buy" data-shop="${sq.id}" data-area="${sq.area}" ${can ? '' : 'disabled'} style="--ac:${AREA_META[sq.area]?.color || '#888'}">
          <strong>${escapeHtml(sq.label)}</strong>
          <span class="pick-invest-gain">${price.toLocaleString()}G</span>
          <small>${escapeHtml(owner?.name || '')} · ${escapeHtml(code)} · 店価 ${sq.price.toLocaleString()}G×${multi}${can ? '' : '（資金不足）'}</small>
        </button>`;
      })
      : '<p class="hint">相手の店がありません</p>';
    body.innerHTML = `
      <div class="shop-pick-layout">
        <div class="scratch-followup">
          <p class="scratch-followup-kicker">スクラッチで発動</p>
          <p class="modal-lead">好きな相手の店を <strong>${multi}倍</strong> で買収できます</p>
          <p class="hint">エリア別に表示。盤面の候補店（水色の縁）でも選べます。所持金 ${Number(p?.cash || 0).toLocaleString()}G</p>
        </div>
        ${listHtml}
      </div>`;
    app.renderer?.setShopPickHighlight?.(ids);
    $$('.any-shop-buy').forEach((btn) => {
      btn.onmouseenter = () => {
        app.renderer?.setInvestHighlight(Number(btn.dataset.shop));
        const area = Number(btn.dataset.area);
        if (Number.isFinite(area)) app.renderer?.setStockHighlight?.(area, true);
      };
      btn.onmouseleave = () => {
        app.renderer?.clearInvestHighlight();
        app.renderer?.clearStockHighlight?.();
      };
      btn.onclick = () => {
        if (btn.disabled) return;
        hideModal();
        sendAction({ type: 'choice', choice: { action: 'buy', shopId: Number(btn.dataset.shop) } });
      };
    });
    bindShopPickAreaChrome(g, body);
    const skip = $('#btn-skip-choice');
    if (skip) {
      skip.textContent = '見送る';
      skip.disabled = false;
    }
    return;
  }

  if (pend.type === 'vacant_shop_buy') {
    const multi = pend.multi || 2;
    const p = g.players[pend.playerId];
    const ids = pend.shopIds?.length
      ? pend.shopIds
      : g.map.filter((s) => s.type === 'shop' && s.owner < 0).map((s) => s.id);
    title.textContent = `空き店購入：${multi}倍価格`;
    enableShopPickModalCard();
    const listHtml = ids.length
      ? renderGroupedShopPickList(g, ids, (id) => {
        const sq = getNode(g, id);
        if (!sq) return '';
        const base = Number(sq.basePrice || sq.price) || 0;
        const price = base * multi;
        const can = getLiquidatableValue(g, p) >= price;
        const code = getAreaCode(g, sq.area);
        return `<button type="button" class="btn pick-invest-shop vacant-shop-buy" data-shop="${sq.id}" data-area="${sq.area}" ${can ? '' : 'disabled'} style="--ac:${AREA_META[sq.area]?.color || '#888'}">
          <strong>${escapeHtml(sq.label)}</strong>
          <span class="pick-invest-gain">${price.toLocaleString()}G</span>
          <small>${escapeHtml(code)} · 定価 ${base.toLocaleString()}G×${multi}${can ? '' : '（資金不足）'}</small>
        </button>`;
      })
      : '<p class="hint">空き店がありません</p>';
    body.innerHTML = `
      <div class="shop-pick-layout">
        <div class="scratch-followup">
          <p class="scratch-followup-kicker">スクラッチで発動</p>
          <p class="modal-lead">好きな空き店を <strong>${multi}倍価格</strong> で購入できます</p>
          <p class="hint">エリア別に表示。盤面の空き店でも選べます。所持金 ${Number(p?.cash || 0).toLocaleString()}G</p>
        </div>
        ${listHtml}
      </div>`;
    app.renderer?.setShopPickHighlight?.(ids);
    $$('.vacant-shop-buy').forEach((btn) => {
      btn.onmouseenter = () => {
        app.renderer?.setInvestHighlight(Number(btn.dataset.shop));
        const area = Number(btn.dataset.area);
        if (Number.isFinite(area)) app.renderer?.setStockHighlight?.(area, true);
      };
      btn.onmouseleave = () => {
        app.renderer?.clearInvestHighlight();
        app.renderer?.clearStockHighlight?.();
      };
      btn.onclick = () => {
        if (btn.disabled) return;
        hideModal();
        sendAction({ type: 'choice', choice: { action: 'buy', shopId: Number(btn.dataset.shop) } });
      };
    });
    bindShopPickAreaChrome(g, body);
    const skip = $('#btn-skip-choice');
    if (skip) {
      skip.textContent = '見送る';
      skip.disabled = false;
    }
    return;
  }

  if (pend.type === 'force_rival_sell') {
    const multi = pend.multi || 3;
    const ids = pend.shopIds?.length
      ? pend.shopIds
      : g.map.filter((s) => s.type === 'shop' && s.owner >= 0 && s.owner !== pend.playerId).map((s) => s.id);
    title.textContent = `相手店の強制換金：${multi}倍`;
    enableShopPickModalCard();
    const listHtml = ids.length
      ? renderGroupedShopPickList(g, ids, (id) => {
        const sq = getNode(g, id);
        if (!sq) return '';
        const owner = g.players[sq.owner];
        const payout = Math.floor(sq.price * multi);
        const code = getAreaCode(g, sq.area);
        return `<button type="button" class="btn pick-invest-shop force-rival-sell" data-shop="${sq.id}" data-area="${sq.area}" style="--ac:${AREA_META[sq.area]?.color || '#888'}">
          <strong>${escapeHtml(sq.label)}</strong>
          <span class="pick-invest-gain">銀行→相手 ${payout.toLocaleString()}G</span>
          <small>${escapeHtml(owner?.name || '')} · ${escapeHtml(code)} · 店価 ${sq.price.toLocaleString()}G×${multi}</small>
        </button>`;
      })
      : '<p class="hint">相手の店がありません</p>';
    body.innerHTML = `
      <div class="shop-pick-layout">
        <div class="scratch-followup">
          <p class="scratch-followup-kicker">スクラッチで発動</p>
          <p class="modal-lead">好きな相手の店を空きにし、<strong>店価×${multi}</strong>を銀行が相手に支払います</p>
          <p class="hint">エリア別に表示。盤面の候補店でも選べます。</p>
        </div>
        ${listHtml}
      </div>`;
    app.renderer?.setShopPickHighlight?.(ids);
    $$('.force-rival-sell').forEach((btn) => {
      btn.onmouseenter = () => {
        app.renderer?.setInvestHighlight(Number(btn.dataset.shop));
        const area = Number(btn.dataset.area);
        if (Number.isFinite(area)) app.renderer?.setStockHighlight?.(area, true);
      };
      btn.onmouseleave = () => {
        app.renderer?.clearInvestHighlight();
        app.renderer?.clearStockHighlight?.();
      };
      btn.onclick = () => {
        hideModal();
        sendAction({ type: 'choice', choice: { action: 'sell', shopId: Number(btn.dataset.shop) } });
      };
    });
    bindShopPickAreaChrome(g, body);
    const skip = $('#btn-skip-choice');
    if (skip) {
      skip.textContent = '見送る';
      skip.disabled = false;
    }
    return;
  }

  if (pend.type === 'pick_dice') {
    const diceMax = Math.max(2, Number(getMoveDiceMax(g)) || 6);
    title.textContent = '出目固定券';
    $('#btn-skip-choice').hidden = true;
    $('#btn-end-choice').hidden = true;
    body.innerHTML = `
      <div class="scratch-followup">
        <p class="scratch-followup-kicker">スクラッチで発動</p>
        <p class="modal-lead">次に振る出目を今すぐ宣言！</p>
        <p class="hint">選んだ目がそのまま次の移動に使われます（1〜${diceMax}）。</p>
      </div>
      <div class="mini-pick-grid">
        ${Array.from({ length: diceMax }, (_, i) => i + 1).map((n) =>
          `<button type="button" class="btn primary mini-pick" data-face="${n}">${n}</button>`).join('')}
      </div>`;
    body.querySelectorAll('[data-face]').forEach((btn) => {
      btn.onclick = () => {
        hideModal();
        sendAction({ type: 'choice', choice: { value: Number(btn.dataset.face) } });
      };
    });
    return;
  }

  if (pend.type === 'shop_protect') {
    const rawIds = pend.shopIds?.length
      ? pend.shopIds
      : g.map.filter((s) => s.type === 'shop' && s.owner === pend.playerId).map((s) => s.id);
    const ids = rawIds.filter((id) => {
      const sq = getNode(g, id);
      return sq && sq.type === 'shop' && sq.owner === pend.playerId;
    });
    const turns = Math.max(1, Number(pend.turns) || 1);
    title.textContent = '店守り契約';
    enableShopPickModalCard();
    const skipProtect = $('#btn-skip-choice');
    if (skipProtect) {
      skipProtect.hidden = ids.length > 0;
      skipProtect.disabled = false;
      skipProtect.textContent = 'つづける（手当+40G）';
    }
    const listHtml = ids.length
      ? renderGroupedShopPickList(g, ids, (id) => {
        const sq = getNode(g, id);
        if (!sq) return '';
        const code = getAreaCode(g, sq.area);
        return `<button type="button" class="btn pick-invest-shop shop-protect-pick" data-shop="${sq.id}" data-area="${sq.area}" style="--ac:${AREA_META[sq.area]?.color || '#888'}">
          <strong>${escapeHtml(sq.label)}</strong>
          <span class="pick-invest-gain">守り ${turns}周</span>
          <small>${escapeHtml(code)} · 価格 ${sq.price.toLocaleString()}G</small>
        </button>`;
      })
      : '<p class="hint">所持店がありません（つづけるで手当）</p>';
    body.innerHTML = `
      <div class="shop-pick-layout">
        <div class="scratch-followup">
          <p class="scratch-followup-kicker">スクラッチで発動</p>
          <p class="modal-lead">守るお店を <strong>1軒</strong> 選ぼう</p>
          <p class="hint">守られている間は5倍買いなどの買収を防げます。</p>
        </div>
        ${listHtml}
      </div>`;
    app.renderer?.setShopPickHighlight?.(ids);
    $$('.shop-protect-pick').forEach((btn) => {
      btn.onmouseenter = () => {
        app.renderer?.setInvestHighlight(Number(btn.dataset.shop));
        const area = Number(btn.dataset.area);
        if (Number.isFinite(area)) app.renderer?.setStockHighlight?.(area, true);
      };
      btn.onmouseleave = () => {
        app.renderer?.clearInvestHighlight();
        app.renderer?.clearStockHighlight?.();
      };
      btn.onclick = () => {
        hideModal();
        sendAction({ type: 'choice', choice: { shopId: Number(btn.dataset.shop) } });
      };
    });
    bindShopPickAreaChrome(g, body);
    return;
  }

  if (pend.type === 'co_own') {
    const rawIds = pend.shopIds?.length
      ? pend.shopIds
      : g.map.filter((s) => s.type === 'shop' && s.owner >= 0 && s.owner !== pend.playerId).map((s) => s.id);
    const ids = rawIds.filter((id) => {
      const sq = getNode(g, id);
      return sq && sq.type === 'shop' && sq.owner >= 0 && sq.owner !== pend.playerId;
    });
    title.textContent = '共同オーナー';
    enableShopPickModalCard();
    const skipCoOwn = $('#btn-skip-choice');
    if (skipCoOwn) {
      skipCoOwn.hidden = ids.length > 0;
      skipCoOwn.disabled = false;
      skipCoOwn.textContent = 'つづける（手当+40G）';
    }
    const listHtml = ids.length
      ? renderGroupedShopPickList(g, ids, (id) => {
        const sq = getNode(g, id);
        if (!sq) return '';
        const owner = g.players[sq.owner];
        const code = getAreaCode(g, sq.area);
        return `<button type="button" class="btn pick-invest-shop co-own-pick" data-shop="${sq.id}" data-area="${sq.area}" style="--ac:${AREA_META[sq.area]?.color || '#888'}">
          <strong>${escapeHtml(sq.label)}</strong>
          <span class="pick-invest-gain">共同</span>
          <small>${escapeHtml(owner?.name || '')} · ${escapeHtml(code)} · ${sq.price.toLocaleString()}G</small>
        </button>`;
      })
      : '<p class="hint">相手の店がありません（つづけるで手当）</p>';
    body.innerHTML = `
      <div class="shop-pick-layout">
        <div class="scratch-followup">
          <p class="scratch-followup-kicker">スクラッチで発動</p>
          <p class="modal-lead">共同オーナーになる店を選ぼう</p>
          <p class="hint">以降その店の買い物料の一部を受け取れます。</p>
        </div>
        ${listHtml}
      </div>`;
    app.renderer?.setShopPickHighlight?.(ids);
    $$('.co-own-pick').forEach((btn) => {
      btn.onmouseenter = () => {
        app.renderer?.setInvestHighlight(Number(btn.dataset.shop));
        const area = Number(btn.dataset.area);
        if (Number.isFinite(area)) app.renderer?.setStockHighlight?.(area, true);
      };
      btn.onmouseleave = () => {
        app.renderer?.clearInvestHighlight();
        app.renderer?.clearStockHighlight?.();
      };
      btn.onclick = () => {
        hideModal();
        sendAction({ type: 'choice', choice: { shopId: Number(btn.dataset.shop) } });
      };
    });
    bindShopPickAreaChrome(g, body);
    return;
  }

  if (pend.type === 'fortune_triple') {
    const opts = pend.options || [];
    title.textContent = '運命の三択';
    $('#btn-skip-choice').hidden = true;
    $('#btn-end-choice').hidden = true;
    body.innerHTML = `
      <div class="scratch-followup">
        <p class="scratch-followup-kicker">スクラッチで発動</p>
        <p class="modal-lead">3つのうち1つを選べ！</p>
        <p class="hint">中身はラベルどおり。選んだ効果がすぐに発動します。</p>
      </div>
      <div class="modal-actions fortune-triple-actions">
        ${opts.map((opt, i) => `
          <button type="button" class="btn primary" data-fortune="${i}">
            ${escapeHtml(opt.label || `選択肢${i + 1}`)}
          </button>`).join('')}
      </div>`;
    body.querySelectorAll('[data-fortune]').forEach((btn) => {
      btn.onclick = () => {
        hideModal();
        sendAction({ type: 'choice', choice: { value: Number(btn.dataset.fortune) } });
      };
    });
    return;
  }

  if (pend.type === 'mono_hearing') {
    const sq = getNode(g, pend.shopId);
    const starter = g.players[pend.starterId];
    const fine = Math.max(80, Number(pend.fine) || 180);
    title.textContent = '独禁ヒアリング';
    $('#btn-skip-choice').hidden = true;
    $('#btn-end-choice').hidden = true;
    body.innerHTML = `
      <div class="scratch-followup">
        <p class="scratch-followup-kicker">独占への監査</p>
        <p class="modal-lead">店を渡すか、罰金を払うか</p>
        <p class="hint">${escapeHtml(starter?.name || '相手')} からのヒアリング。「${escapeHtml(sq?.label || '対象店')}」を渡すと独占が崩れます。罰金は ${fine.toLocaleString()}G。</p>
      </div>
      <div class="modal-actions">
        <button class="btn danger" id="m-hearing-shop">店を渡す</button>
        <button class="btn primary" id="m-hearing-fine">罰金 ${fine.toLocaleString()}G</button>
      </div>`;
    $('#m-hearing-shop').onclick = () => {
      hideModal();
      sendAction({ type: 'choice', choice: { action: 'give_shop' } });
    };
    $('#m-hearing-fine').onclick = () => {
      hideModal();
      sendAction({ type: 'choice', choice: { action: 'pay_fine' } });
    };
    return;
  }

  if (pend.type === 'five_buy') {
    const sq = getNode(g, pend.shopId);
    const owner = g.players[sq.owner];
    const p = g.players[pend.playerId];
    const multi = pend.multi || 5;
    const short = (p?.cash || 0) < pend.price;
    const canRaise = getLiquidatableValue(g, p) >= pend.price;
    const coupon = multi < 5;
    title.textContent = coupon ? `${multi}倍買い？（クーポン）` : '5倍買い？';
    const paidToll = Number(pend.toll || 0);
    body.innerHTML = `
      <p class="modal-lead"><strong>${escapeHtml(sq.label)}</strong>（${escapeHtml(owner?.name || '')}の店）</p>
      ${paidToll > 0 ? `<p class="inspect-toll enemy" style="margin:0.35rem 0"><span class="it-label">たった今の買い物料</span><span class="it-amount">−${paidToll.toLocaleString()}G</span></p>` : ''}
      <p>${multi}倍買い価格 <strong>${pend.price.toLocaleString()}G</strong>（店価×${multi}${coupon ? '・クーポン適用' : ''}）</p>
      <p class="hint">所持金 ${Number(p?.cash || 0).toLocaleString()}G${short ? ' — 不足分は株や物件を売って調達できます' : ''}</p>
      <div class="modal-actions">
        <button class="btn danger" id="m-five" ${!canRaise ? 'disabled' : ''}>
          ${short ? `資金を調達して${multi}倍買い` : `${multi}倍買いする`}
        </button>
      </div>`;
    $('#m-five').onclick = () => {
      hideModal();
      sendAction({ type: 'choice', choice: { action: 'buy' } });
    };
    return;
  }

  if (pend.type === 'raise_funds') {
    const p = g.players[pend.playerId];
    const target = Number(pend.targetCash) || 0;
    const short = Math.max(0, target - (p?.cash || 0));
    const reasonLabel = {
      toll: '買い物料の支払い後',
      five_buy: '5倍買いのため',
      any_shop_buy: '指名買収のため',
      vacant_shop_buy: '空き店の倍額購入のため',
      buy_shop: 'お店購入のため',
      invest: '増資のため',
    }[pend.reason] || '資金調達';
    title.textContent = '資金調達';
    $('#modal-card').classList.add('wide');
    $('#modal-card').classList.add('raise-modal');
    const stockRows = Object.keys(g.areas).map((a) => {
      const area = Number(a);
      const have = p?.stocks[area] || 0;
      if (!have) return '';
      const price = g.areas[area].stockPrice;
      const initial = Math.min(have, Math.max(1, Math.ceil(short / Math.max(1, price))));
      return `<div class="raise-row" style="--ac:${g.areas[area].color}" data-raise-stock-row="${area}">
        <span>${getAreaCode(g, area)} ${escapeHtml(g.areas[area].name)} ×${have}（${price}G）</span>
        <label class="field tiny">枚数
          <input type="number" min="1" max="${have}" value="${initial}" data-sell-stock="${area}" />
        </label>
        <button type="button" class="btn tiny" data-do-sell-stock="${area}">売る</button>
        <div class="sell-preview" data-sell-preview="${area}">${formatStockSellPreview(g, area, initial)}</div>
      </div>`;
    }).join('');
    const shopRows = g.map.filter((s) => s.type === 'shop' && s.owner === pend.playerId).map((sq) => {
      const got = Math.floor(sq.price * 0.5);
      return `<div class="raise-row" style="--ac:${AREA_META[sq.area]?.color || '#888'}">
        <span>${escapeHtml(sq.label)}（売却見込 ${got.toLocaleString()}G）</span>
        <button type="button" class="btn tiny" data-do-sell-shop="${sq.id}">物件を売る</button>
      </div>`;
    }).join('');
    const canContinue = (p?.cash || 0) >= target;
    const mustPay = pend.resume?.type === 'after_toll' || pend.reason === 'toll';
    const canExec = canContinue && pend.resume && ['five_buy', 'any_shop_buy', 'vacant_shop_buy', 'buy_shop', 'invest'].includes(pend.resume.type);
    const execLabel = {
      five_buy: '調達完了 — 5倍買いする',
      any_shop_buy: '調達完了 — 指名買収する',
      vacant_shop_buy: '調達完了 — 空き店を買う',
      buy_shop: '調達完了 — 購入する',
      invest: '調達完了 — 増資する',
    }[pend.resume?.type] || '調達完了 — 実行する';
    body.innerHTML = `
      <p class="modal-lead">${reasonLabel}</p>
      <p>所持金 <strong style="color:${(p?.cash || 0) < 0 ? '#ff8a80' : 'var(--gold)'}">${Number(p?.cash || 0).toLocaleString()}G</strong>
        ／ 目標 <strong>${target.toLocaleString()}G</strong>
        ${short > 0 ? `（あと ${short.toLocaleString()}G）` : '（達成）'}</p>
      <p class="hint">自動では売りません。株や物件を自分で選んで売却してください。自分のターン内でエリアごとに${STOCK_SELL_PRESSURE_MIN}枚売るごとに売却後の株価が下がります（次の自分の番で累計リセット）。${
        mustPay && !canContinue ? ' 買い物料不足のときは調達か破産が必要です。' : ''
      }</p>
      <div class="raise-section"><h4>株</h4>${stockRows || '<p class="hint">売却できる株がありません</p>'}</div>
      <div class="raise-section"><h4>物件（半額売却）</h4>${shopRows || '<p class="hint">売却できる物件がありません</p>'}</div>
      <div class="modal-actions">
        <button class="btn primary" id="m-raise-go" ${canContinue ? '' : 'disabled'}>
          ${canExec ? execLabel : '調達完了'}
        </button>
        ${mustPay && !canContinue
          ? '<button class="btn ghost" id="m-raise-cancel" disabled title="負債を解消するまでやめられません">やめる（不可）</button>'
          : '<button class="btn ghost" id="m-raise-cancel">やめる（ターン終了）</button>'}
        <button class="btn danger ghost" id="m-raise-bankrupt">破産を宣言</button>
      </div>`;
    $('#btn-skip-choice').hidden = true;
    $('#btn-end-choice').hidden = true;
    body.querySelectorAll('[data-do-sell-stock]').forEach((btn) => {
      btn.onclick = () => {
        const area = Number(btn.dataset.doSellStock);
        const input = body.querySelector(`input[data-sell-stock="${area}"]`);
        const have = Math.max(0, Math.floor(Number(p?.stocks[area]) || 0));
        if (have <= 0) return toast('売却できる株がありません');
        const want = Math.max(1, Math.floor(Number(input?.value) || 1));
        const count = Math.min(have, want);
        if (count <= 0) return toast('売却できる株がありません');
        sendAction({ type: 'choice', choice: { action: 'sell_stock', area, count } });
      };
    });
    body.querySelectorAll('input[data-sell-stock]').forEach((input) => {
      const sync = () => {
        const area = Number(input.dataset.sellStock);
        const have = Math.max(0, Math.floor(Number(p?.stocks[area]) || 0));
        const want = Math.max(1, Math.floor(Number(input.value) || 1));
        const count = have > 0 ? Math.min(have, want) : 0;
        const el = body.querySelector(`[data-sell-preview="${area}"]`);
        if (el) {
          el.className = `sell-preview${previewStockSell(g, area, count)?.drops ? ' drop' : ''}`;
          el.innerHTML = formatStockSellPreview(g, area, count);
        }
      };
      input.addEventListener('input', sync);
      input.addEventListener('change', sync);
      sync();
    });
    body.querySelectorAll('[data-do-sell-shop]').forEach((btn) => {
      btn.onclick = () => {
        sendAction({ type: 'choice', choice: { action: 'sell_shop', shopId: Number(btn.dataset.doSellShop) } });
      };
    });
    $('#m-raise-go').onclick = () => {
      if (!canContinue) return;
      // 調達後の購入／増資UIと資金調達UIが二重に残らないよう先に閉じる
      hideModal();
      sendAction({ type: 'choice', choice: { action: 'continue', execute: !!canExec } });
    };
    const cancelBtn = $('#m-raise-cancel');
    if (cancelBtn && !cancelBtn.disabled) {
      cancelBtn.onclick = () => {
        audio.sfx.cancel();
        // still_short のときは pending が残るので閉じない（refresh で再表示）
        hideModal();
        sendAction({ type: 'choice', choice: { action: 'cancel' } });
      };
    }
    $('#m-raise-bankrupt').onclick = () => {
      if (!confirm('破産すると店も株も失います。よろしいですか？')) return;
      hideModal();
      sendAction({ type: 'choice', choice: { action: 'bankrupt' } });
    };
    if (drafts.length) {
      restoreEditableFields(body, drafts);
      body.querySelectorAll('input[data-sell-stock]').forEach((input) => {
        const area = Number(input.dataset.sellStock);
        const have = Math.max(0, Math.floor(Number(p?.stocks[area]) || 0));
        if (have > 0) {
          input.max = String(have);
          if (Number(input.value) > have) input.value = String(have);
        }
        input.dispatchEvent(new Event('input'));
      });
    }
    return;
  }

  if (pend.type === 'level_up') {
    const p = g.players[pend.playerId];
    title.textContent = '昇進おめでとう！';
    $('#btn-skip-choice').hidden = true;
    body.innerHTML = `
      <div class="levelup-hero" style="--pc:${p?.color || '#ffe08a'}">
        <div class="levelup-badge">LEVEL UP</div>
        <p class="modal-lead"><strong>${escapeHtml(p?.name || '')}</strong></p>
        <p class="levelup-levels">Lv.${pend.from} → <strong>Lv.${pend.to}</strong></p>
        <p class="levelup-bonus">Lv.${pend.to} 昇進賞金 <strong>+${Number(pend.bonus || 0).toLocaleString()}G</strong></p>
        <p class="hint">賞金はレベルごとに全員同じ額です（高いほど増えます）</p>
      </div>
      <div class="modal-actions">
        <button class="btn primary large" id="m-levelup">お祝いする</button>
      </div>`;
    audio.sfx.levelUp?.() || audio.sfx.win();
    // 告知フラッシュは出さない（モーダル自体がお祝いUI。出すと「お祝いする」が塞がる）
    $('#m-levelup').onclick = () => {
      hideModal();
      sendAction({ type: 'choice', choice: { action: 'celebrate' } });
    };
    return;
  }

  if (pend.type === 'stock') {
    const bankVisit = !!pend.bankVisit || !!pend.bankPass || !!pend.atBank;
    const broker = !!pend.broker && !bankVisit;
    const p = currentPlayer(g);
    title.textContent = bankVisit
      ? (pend.resumeMove ? '銀行通過 — 株を1種類購入' : '銀行 — 株を1種類購入')
      : '証券マス — 株を1種類購入';
    $('#modal-card').classList.add('stock-modal');
    // 盤面は通常表示のまま。ホバー/選択したエリアの店だけハイライト
    app.renderer?.setStockHighlight(null, true);
    applyModalMode();

    const bindAreaHighlight = (root) => {
      root.querySelectorAll('[data-area]').forEach((el) => {
        const area = Number(el.dataset.area);
        el.addEventListener('pointerenter', () => app.renderer?.setStockHighlight(area, true));
        el.addEventListener('pointerleave', () => {
          const sel = root.querySelector('.stock-card.selected');
          app.renderer?.setStockHighlight(sel ? Number(sel.dataset.area) : null, true);
        });
      });
    };

    const cards = Object.keys(g.areas).map((a) => {
      const area = Number(a);
      const meta = g.areas[area];
      const price = meta.stockPrice;
      const maxBuy = Math.floor((p?.cash || 0) / price);
      const have = p?.stocks[area] || 0;
      return `<button type="button" class="stock-card" style="--ac:${meta.color}" data-area="${area}" data-max-buy="${maxBuy}" data-have="${have}" ${maxBuy < 1 && !(broker && have) ? 'disabled' : ''}>
        <span class="sc-swatch" aria-hidden="true"></span>
        <span class="sc-name">${getAreaCode(g, area)} ${meta.name}</span>
        <span class="sc-price">${price}G</span>
        <span class="sc-max">${maxBuy < 1 ? '資金不足' : `最大 ${maxBuy}枚`}</span>
        <span class="sc-have">持株 ${have}</span>
      </button>`;
    }).join('');

    body.innerHTML = `
      <p class="hint">1種類だけ選べます。枚数は下の入力欄で指定（所持金 ${Number(p?.cash || 0).toLocaleString()}G）。盤面の店を直接クリックするか、カードに触れるとそのエリアが光ります。</p>
      <div class="stock-grid">${cards}</div>
      <div id="stock-buy-panel" class="stock-buy-panel" hidden>
        <label class="field">枚数 <input type="number" id="m-stock-count" min="1" value="1" /></label>
        <button class="btn primary" id="m-stock-confirm">この枚数で買う</button>
        ${broker ? '<button class="btn ghost" id="m-stock-sell" hidden>この枚数で売る</button>' : ''}
        <div id="stock-trade-preview" class="sell-preview" hidden></div>
      </div>`;
    $('#btn-end-choice').hidden = true;
    $('#btn-skip-choice').hidden = false;
    $('#btn-skip-choice').textContent = pend.resumeMove
      ? '買わずに進む方向を選ぶ'
      : (broker ? '買わずに終了' : '買わずに終了');

    let selected = null;
    bindAreaHighlight(body);
    /** 購入可能なら購入後株価予想、売却のみのときだけ売却予想 */
    const syncStockTradePreview = () => {
      const preview = $('#stock-trade-preview');
      if (!preview) return;
      if (selected == null) {
        preview.hidden = true;
        preview.textContent = '';
        return;
      }
      const card = body.querySelector(`.stock-card[data-area="${selected}"]`);
      const maxBuy = Number(card?.dataset.maxBuy) || 0;
      const have = Number(card?.dataset.have) || 0;
      const raw = Number($('#m-stock-count')?.value) || 1;
      const buyBtn = $('#m-stock-confirm');
      const sellBtn = $('#m-stock-sell');
      const canBuy = buyBtn && !buyBtn.hidden && maxBuy >= 1;
      const canSell = sellBtn && !sellBtn.hidden && have >= 1;
      if (canBuy) {
        const count = Math.max(1, Math.min(maxBuy, raw));
        const prev = previewStockBuy(g, selected, count);
        preview.hidden = false;
        preview.className = `sell-preview${prev?.rises ? ' rise' : ''}`;
        preview.innerHTML = formatStockBuyPreview(g, selected, count);
        return;
      }
      if (canSell) {
        const count = Math.max(1, Math.min(have, raw));
        preview.hidden = false;
        preview.className = `sell-preview${previewStockSell(g, selected, count)?.drops ? ' drop' : ''}`;
        preview.innerHTML = formatStockSellPreview(g, selected, count);
        return;
      }
      preview.hidden = true;
      preview.textContent = '';
    };
    body.querySelectorAll('.stock-card').forEach((btn) => {
      btn.onclick = () => {
        body.querySelectorAll('.stock-card').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        selected = Number(btn.dataset.area);
        app.renderer?.setStockHighlight(selected, true);
        const maxBuy = Number(btn.dataset.maxBuy) || 0;
        const have = Number(btn.dataset.have) || 0;
        const panel = $('#stock-buy-panel');
        const input = $('#m-stock-count');
        const buyBtn = $('#m-stock-confirm');
        const sellBtn = $('#m-stock-sell');
        panel.hidden = false;
        if (maxBuy >= 1) {
          input.min = '1';
          input.max = String(maxBuy);
          input.value = String(maxBuy);
          buyBtn.hidden = false;
          buyBtn.disabled = false;
        } else {
          buyBtn.hidden = true;
        }
        if (sellBtn) {
          if (have >= 1) {
            sellBtn.hidden = false;
            if (maxBuy < 1) {
              input.min = '1';
              input.max = String(have);
              input.value = String(Math.min(have, 10));
            } else {
              input.max = String(Math.max(maxBuy, have));
            }
          } else {
            sellBtn.hidden = true;
          }
        }
        syncStockTradePreview();
      };
    });
    $('#m-stock-count')?.addEventListener('input', syncStockTradePreview);
    $('#m-stock-count')?.addEventListener('change', syncStockTradePreview);
    $('#m-stock-confirm').onclick = () => {
      if (selected == null) return;
      const card = body.querySelector(`.stock-card[data-area="${selected}"]`);
      const maxBuy = Number(card?.dataset.maxBuy) || 1;
      if (maxBuy < 1) return;
      const count = Math.max(1, Math.min(maxBuy, Number($('#m-stock-count').value) || 1));
      hideModal();
      sendAction({ type: 'choice', choice: { action: 'buy', area: selected, count } });
    };
    const sellBtn = $('#m-stock-sell');
    if (sellBtn) {
      sellBtn.onclick = () => {
        if (selected == null) return;
        const card = body.querySelector(`.stock-card[data-area="${selected}"]`);
        const have = Number(card?.dataset.have) || 0;
        if (have < 1) return;
        const count = Math.max(1, Math.min(have, Number($('#m-stock-count').value) || 1));
        hideModal();
        sendAction({ type: 'choice', choice: { action: 'sell', area: selected, count } });
      };
    }
    return;
  }

  if (pend.type === 'scratch') {
    const p = g.players[pend.playerId];
    const table = getSharedEventTable(g);
    const canPick = app.mode === 'local'
      ? !p?.isCPU
      : pend.playerId === app.localSeat;
    title.textContent = '共通イベント表スクラッチ（1〜200）';
    $('#btn-skip-choice').hidden = true;
    // スクラッチは中央に大きく表示（ドラッグ位置はリセット）
    app.modalDrag = null;
    $('#modal-card').classList.add('wide', 'scratch-modal');
    applyModalMode();
    if (!table) {
      body.innerHTML = '<p class="hint">イベント表がありません</p>';
      return;
    }
    const legend = g.players.filter((p) => !p.bankrupt).map((p) =>
      `<span class="scratch-legend" style="--sc:${p.color}">${escapeHtml(p.name)}</span>`
    ).join('');
    const cells = table.cells.map((c) => {
      if (c.scratched) {
        const scratcher = c.scratchedBy != null ? g.players[c.scratchedBy] : g.players[c.color];
        const pc = scratcher?.color || '#888';
        const who = scratcher ? escapeHtml(scratcher.name) : '';
        // 開けた人の色で塗り、番号のみ表示（イベント名は title）
        return `<button type="button" class="scratch-cell done by-player" style="--pc:${pc}" disabled title="${escapeHtml(c.label)}${who ? ` — ${who}` : ''}">
          <span class="scratch-num">${c.eventId}</span>
          <span class="scratch-owner" aria-hidden="true">${who ? who.slice(0, 1) : '·'}</span>
        </button>`;
      }
      return `<button type="button" class="scratch-cell sealed" data-cell="${c.id}" aria-label="イベントマス" ${canPick ? '' : 'disabled'}>?</button>`;
    }).join('');
    body.innerHTML = `
      <p class="hint">マスを1つ選んでめくります。同じプレイヤー色が縦・横・斜めに隣接3つ以上で<strong>${MATCH_BONUS_PER}G×枚数</strong>（その人へ）</p>
      <div class="scratch-legends">${legend}</div>
      <div class="scratch-board-fit">
        <div class="scratch-grid" style="--n:${TABLE_SIZE}">${cells}</div>
      </div>
      <div class="scratch-result" id="scratch-result" hidden></div>
    `;
    if (!canPick) {
      body.querySelector('.hint')?.insertAdjacentHTML('afterend', '<p class="hint">他のプレイヤーが選ぶのを待っています…</p>');
    }
    body.querySelectorAll('[data-cell]').forEach((btn) => {
      btn.onclick = () => {
        if (!canPick) return;
        body.querySelectorAll('[data-cell]').forEach((b) => { b.disabled = true; });
        const cellId = Number(btn.dataset.cell);
        const cell = table.cells[cellId];
        const actor = g.players[pend.playerId];
        const pc = actor?.color || '#888';
        btn.classList.remove('sealed');
        btn.classList.add('reveal', 'done', 'by-player');
        btn.style.setProperty('--pc', pc);
        btn.title = cell?.label || '';
        btn.innerHTML = `<span class="scratch-num">${cell?.eventId ?? ''}</span>
          <span class="scratch-owner" aria-hidden="true">${(actor?.name || '·').slice(0, 1)}</span>`;
        const resultEl = $('#scratch-result');
        if (resultEl) {
          resultEl.hidden = false;
          resultEl.classList.add('outcome-pop');
          resultEl.innerHTML = `
            <span class="sr-kicker">めくり中</span>
            <span class="sr-label">${escapeHtml(cell?.label || `No.${cell?.eventId ?? ''}`)}</span>
            <span class="sr-effect">効果を適用しています…</span>
          `;
        }
        audio.sfx.buy();
        // そろい演出のためモーダルは残す（結果後に閉じる）
        sendAction({ type: 'choice', choice: { action: 'scratch', cellId } });
      };
    });
    return;
  }

  if (pend.type === 'potion_pick') {
    title.textContent = '薬品マス';
    $('#btn-skip-choice').hidden = true;
    $('#btn-end-choice').hidden = true;
    $('#modal-card').classList.add('wide');
    const participants = (pend.participantIds || []).map((id) => g.players[id]).filter(Boolean);
    const picks = pend.picks || {};
    const statusHtml = `<ul class="mg-roster">${participants.map((pl) => {
      const done = picks[pl.id] != null;
      const current = pl.id === pend.playerId;
      return `<li class="${done ? 'done' : ''} ${current ? 'current' : ''}" style="--pc:${pl.color}">
        <span class="mg-roster-name">${escapeHtml(pl.name)}</span>
        <span class="mg-roster-state">${done ? '選択済' : (current ? '選択中' : '待ち')}</span>
      </li>`;
    }).join('')}</ul>`;
    const cards = Array.from({ length: POTION_CARD_COUNT }, (_, i) => `
      <button type="button" class="btn potion-card" data-slot="${i}" aria-label="伏せカード${i + 1}">
        <span class="potion-card-back">？</span>
        <small>カード ${i + 1}</small>
      </button>
    `).join('');
    body.innerHTML = `
      <div class="scratch-followup">
        <p class="scratch-followup-kicker">薬品マス</p>
        <p class="modal-lead">効果は伏せられています。好きなカードを1枚選んでください</p>
        <p class="hint">同じカードを複数人が選んでも構いません。全員の選択後に一斉公開します。</p>
      </div>
      ${statusHtml}
      <div class="potion-card-grid">${cards}</div>`;
    body.querySelectorAll('[data-slot]').forEach((btn) => {
      btn.onclick = () => {
        hideModal();
        sendAction({ type: 'choice', choice: { action: 'pick', slot: Number(btn.dataset.slot) } });
      };
    });
    return;
  }

  if (pend.type === 'minigame') {
    const label = pend.label || 'ミニゲーム';
    title.textContent = label;
    $('#btn-skip-choice').hidden = true;
    $('#btn-end-choice').hidden = true;
    $('#modal-card').classList.add('wide');
    const game = pend.game || 'guess_dice';
    const party = !!(pend.party || ((pend.participantIds || []).length > 1));
    const participants = (pend.participantIds || [pend.playerId]).map((id) => g.players[id]).filter(Boolean);
    const picks = pend.picks || {};
    const statusHtml = party
      ? `<ul class="mg-roster">${participants.map((pl) => {
        const done = picks[pl.id] != null;
        const current = pl.id === pend.playerId;
        return `<li class="${done ? 'done' : ''} ${current ? 'current' : ''}" style="--pc:${pl.color}">
          <span class="mg-roster-name">${escapeHtml(pl.name)}</span>
          <span class="mg-roster-state">${done ? '選択済' : (current ? '選択中' : '待ち')}</span>
        </li>`;
      }).join('')}</ul>`
      : '';
    const partyTag = party ? '（全員参加）' : '';
    const partyHint = party
      ? '全員が選んだあと共通の結果で精算します。最後の人まで選択できます。'
      : '';
    if (game === 'guess_dice') {
      body.innerHTML = `
        <p class="modal-lead">出目を当てよう！${partyTag}</p>
        <p class="hint">${partyHint ? `${partyHint} ` : ''}ぴったりで高額、おしい（±1）でも報酬。ハズレは参加賞。</p>
        ${statusHtml}
        <div class="mini-pick-grid">
          ${[1, 2, 3, 4, 5, 6].map((n) => `<button type="button" class="btn primary mini-pick" data-pick="${n}">${n}</button>`).join('')}
        </div>`;
      body.querySelectorAll('[data-pick]').forEach((btn) => {
        btn.onclick = () => {
          hideModal();
          sendAction({ type: 'choice', choice: { action: 'pick', value: Number(btn.dataset.pick) } });
        };
      });
    } else if (game === 'dice_battle') {
      body.innerHTML = `
        <p class="modal-lead">ハウスとダイスバトル！</p>
        <p class="hint">攻めは2d6、守りは1d6+3。ハウスの2d6を上回れば勝ち。外れは参加賞。</p>
        ${statusHtml}
        <div class="modal-actions">
          <button class="btn primary" id="m-rush">攻め（2d6）</button>
          <button class="btn" id="m-guard">守り（1d6+3）</button>
        </div>`;
      $('#m-rush').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'rush' } }); };
      $('#m-guard').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'guard' } }); };
    } else if (game === 'horse_race') {
      const horses = ['ハヤテ', 'ライジン', 'カゼ', 'ツキ'];
      body.innerHTML = `
        <p class="modal-lead">ミニ競馬！乗る馬を選ぼう${partyTag}</p>
        <p class="hint">${partyHint ? `${partyHint} ` : ''}1着は高額、2着も入賞。それ以外は参加賞。</p>
        ${statusHtml}
        <div class="mini-pick-grid">
          ${horses.map((name, i) => `<button type="button" class="btn primary mini-pick" data-pick="${i}">${name}</button>`).join('')}
        </div>`;
      body.querySelectorAll('[data-pick]').forEach((btn) => {
        btn.onclick = () => {
          hideModal();
          sendAction({ type: 'choice', choice: { action: 'pick', value: Number(btn.dataset.pick) } });
        };
      });
    } else if (game === 'high_low') {
      body.innerHTML = `
        <p class="modal-lead">次の数字は高？ 低？${partyTag}</p>
        <p class="hint">${partyHint ? `${partyHint} ` : ''}1〜10のうち、6以上が高・5以下が低。</p>
        ${statusHtml}
        <div class="modal-actions">
          <button class="btn primary" id="m-hi">高（6〜10）</button>
          <button class="btn" id="m-lo">低（1〜5）</button>
        </div>`;
      $('#m-hi').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'high' } }); };
      $('#m-lo').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'low' } }); };
    } else if (game === 'rps_duel') {
      body.innerHTML = `
        <p class="modal-lead">じゃんけん勝負！</p>
        <p class="hint">勝ちで本賞、あいこは引き分け賞。負けは参加賞。</p>
        <div class="modal-actions">
          <button class="btn primary" id="m-rock">グー</button>
          <button class="btn primary" id="m-paper">パー</button>
          <button class="btn primary" id="m-scissors">チョキ</button>
        </div>`;
      $('#m-rock').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'rock' } }); };
      $('#m-paper').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'paper' } }); };
      $('#m-scissors').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'scissors' } }); };
    } else if (game === 'coin') {
      body.innerHTML = `
        <p class="modal-lead">コインの裏表を予想！${partyTag}</p>
        <p class="hint">${partyHint ? `${partyHint} ` : ''}当たればボーナス。外れは参加賞。</p>
        ${statusHtml}
        <div class="modal-actions">
          <button class="btn primary" id="m-heads">表</button>
          <button class="btn" id="m-tails">裏</button>
        </div>`;
      $('#m-heads').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'heads' } }); };
      $('#m-tails').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'tails' } }); };
    } else if (game === 'roulette') {
      body.innerHTML = `
        <p class="modal-lead">ルーレットに賭けよう！${partyTag}</p>
        <p class="hint">${partyHint ? `${partyHint} ` : ''}赤／黒は通常配当、緑(0)は大当り。</p>
        ${statusHtml}
        <div class="modal-actions">
          <button class="btn primary" id="m-red">赤</button>
          <button class="btn" id="m-black">黒</button>
          <button class="btn" id="m-green">緑(0)</button>
        </div>`;
      $('#m-red').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'red' } }); };
      $('#m-black').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'black' } }); };
      $('#m-green').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'green' } }); };
    } else if (game === 'heist') {
      body.innerHTML = `
        <p class="modal-lead">金庫破り</p>
        <p class="hint">用心は成功しやすいが少額。大胆は高配当だが失敗しやすい。失敗時は慰労金。</p>
        <div class="modal-actions">
          <button class="btn" id="m-safe">用心（高確率）</button>
          <button class="btn primary" id="m-normal">普通</button>
          <button class="btn" id="m-bold">大胆（高配当）</button>
        </div>`;
      $('#m-safe').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'safe' } }); };
      $('#m-normal').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'normal' } }); };
      $('#m-bold').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'bold' } }); };
    } else if (game === 'balloon_dash') {
      body.innerHTML = `
        <p class="modal-lead">バルーンチャレンジ！</p>
        <p class="hint">ポンプ回数が多いほど高配当。限界超えで破裂（参加賞）。</p>
        <div class="modal-actions">
          <button class="btn" id="m-p3">3回（安全寄り）</button>
          <button class="btn primary" id="m-p5">5回</button>
          <button class="btn" id="m-p7">7回（高配当）</button>
        </div>`;
      $('#m-p3').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 3 } }); };
      $('#m-p5').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 5 } }); };
      $('#m-p7').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 7 } }); };
    } else if (game === 'memory_match') {
      let first = null;
      body.innerHTML = `
        <p class="modal-lead">神経衰弱！2枚めくってペアを当てよう</p>
        <p class="hint">伏せカード6枚から2枚を選ぶ。同じ記号なら成功。</p>
        <div class="mini-pick-grid memory-match-grid">
          ${[0, 1, 2, 3, 4, 5].map((i) =>
            `<button type="button" class="btn primary mini-pick" data-card="${i}">${i + 1}</button>`).join('')}
        </div>
        <p class="hint" id="mm-hint">1枚目を選んでください</p>`;
      const hint = body.querySelector('#mm-hint');
      body.querySelectorAll('[data-card]').forEach((btn) => {
        btn.onclick = () => {
          const idx = Number(btn.dataset.card);
          if (first == null) {
            first = idx;
            btn.disabled = true;
            btn.classList.add('selected');
            if (hint) hint.textContent = '2枚目を選んでください';
            return;
          }
          if (idx === first) return;
          hideModal();
          sendAction({ type: 'choice', choice: { action: 'pick', value: `${first},${idx}` } });
        };
      });
    } else if (game === 'silent_bid') {
      body.innerHTML = `
        <p class="modal-lead">かぶりなし賞金！${partyTag}</p>
        <p class="hint">${partyHint ? `${partyHint} ` : ''}<strong>50 / 100 / 300G</strong> から1つ選ぶ。同じ額を選んだ人は全員もらえず、かぶらなかった人だけがその金額を受け取ります。</p>
        ${statusHtml}
        <div class="mini-pick-grid silent-bid-picks">
          ${[50, 100, 300].map((n) =>
            `<button type="button" class="btn primary mini-pick" data-bid="${n}">${n}G</button>`).join('')}
        </div>`;
      body.querySelectorAll('[data-bid]').forEach((btn) => {
        btn.onclick = () => {
          hideModal();
          sendAction({ type: 'choice', choice: { action: 'pick', value: Number(btn.dataset.bid) } });
        };
      });
    } else if (game === 'push_pull') {
      body.innerHTML = `
        <p class="modal-lead">押し引き！どこで止める？</p>
        <p class="hint">段階が高いほど高配当。限界を超えると失敗（参加賞）。</p>
        <div class="mini-pick-grid">
          ${[1, 2, 3, 4, 5].map((n) =>
            `<button type="button" class="btn primary mini-pick" data-stop="${n}">${n}</button>`).join('')}
        </div>`;
      body.querySelectorAll('[data-stop]').forEach((btn) => {
        btn.onclick = () => {
          hideModal();
          sendAction({ type: 'choice', choice: { action: 'pick', value: Number(btn.dataset.stop) } });
        };
      });
    } else if (game === 'divide_pool') {
      body.innerHTML = `
        <p class="modal-lead">配分ゲーム！自分の取り分は？</p>
        <p class="hint">要求％が閾値以下なら成立。欲張りすぎると拒否されます。</p>
        <div class="mini-pick-grid">
          ${[40, 50, 60, 70].map((n) =>
            `<button type="button" class="btn primary mini-pick" data-keep="${n}">${n}%</button>`).join('')}
        </div>`;
      body.querySelectorAll('[data-keep]').forEach((btn) => {
        btn.onclick = () => {
          hideModal();
          sendAction({ type: 'choice', choice: { action: 'pick', value: Number(btn.dataset.keep) } });
        };
      });
    } else if (game === 'target_roulette') {
      const others = participants.filter((pl) => pl.id !== pend.playerId);
      const opts = [
        { value: 'prize', label: '賞金' },
        ...others.map((pl) => ({ value: String(pl.id), label: pl.name })),
      ];
      body.innerHTML = `
        <p class="modal-lead">ターゲットルーレット！着地を予想${partyTag}</p>
        <p class="hint">${partyHint ? `${partyHint} ` : ''}ルーレットが止まった先を当てよう。プレイヤー的中なら徴収。</p>
        ${statusHtml}
        <div class="mini-pick-grid">
          ${opts.map((o) =>
            `<button type="button" class="btn primary mini-pick" data-land="${escapeHtml(o.value)}">${escapeHtml(o.label)}</button>`).join('')}
        </div>`;
      body.querySelectorAll('[data-land]').forEach((btn) => {
        btn.onclick = () => {
          const raw = btn.dataset.land;
          const value = raw === 'prize' ? 'prize' : Number(raw);
          hideModal();
          sendAction({ type: 'choice', choice: { action: 'pick', value } });
        };
      });
    } else if (game === 'hot_potato') {
      body.innerHTML = `
        <p class="modal-lead">パス禁止！止める？回す？${partyTag}</p>
        <p class="hint">${partyHint ? `${partyHint} ` : ''}止め人が少なすぎず多すぎずなら成功。多すぎると罰金。</p>
        ${statusHtml}
        <div class="modal-actions">
          <button class="btn primary" id="m-potato-stop">止める</button>
          <button class="btn" id="m-potato-pass">回す</button>
        </div>`;
      $('#m-potato-stop').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'stop' } }); };
      $('#m-potato-pass').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'pass' } }); };
    } else {
      body.innerHTML = `
        <p class="modal-lead">スロットを回そう！</p>
        <p class="hint">5リールの役（5揃い／4揃い／フルハウスなど）で報酬。外れは参加賞。</p>
        <div class="modal-actions">
          <button class="btn primary large" id="m-spin">回す！</button>
        </div>`;
      $('#m-spin').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'spin' } }); };
    }
    return;
  }

  $('#modal-card').classList.remove('wide');
  } finally {
    scheduleModalLayoutClamp();
  }
}

function hideModal() {
  app.modalActive = false;
  app.modalPendingKey = null;
  // 選択完了後は次の選択を右下に再表示
  app.modalMode = 'shown';
  $('#modal').hidden = true;
  $('#btn-modal-restore').hidden = true;
  hideForkRails();
  const card = $('#modal-card');
  card?.classList.remove('fork-hint-only', 'scratch-modal', 'stock-modal', 'raise-modal', 'wide', 'shop-pick-modal');
  if (card) card.style.maxHeight = '';
  const body = $('#modal-body');
  if (body) body.innerHTML = '';
  $('#modal')?.classList.remove('centered', 'floating');
  app.renderer?.clearStockHighlight();
  app.renderer?.clearInvestHighlight();
  app.renderer?.clearShopPickHighlight?.();
}

function buildResultsExportPayload(g, results) {
  return formatGameResultsExport(results, {
    mapId: g.mapId || null,
    mapName: g.mapName || getMapDefName(g.mapId),
    mode: app.mode || null,
  });
}

function downloadTextFile(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function bindResultsExportActions(payload) {
  saveLastResultsExport(payload);
  const jsonBtn = $('#btn-export-json');
  const csvBtn = $('#btn-export-csv');
  const textBtn = $('#btn-export-text');
  const copyBtn = $('#btn-export-copy');

  if (jsonBtn) {
    jsonBtn.onclick = () => {
      audio.sfx.click();
      const body = `${JSON.stringify(payload, null, 2)}\n`;
      downloadTextFile(gameResultsExportFilename(payload, 'json'), body, 'application/json;charset=utf-8');
      toast('JSONを保存しました');
    };
  }
  if (csvBtn) {
    csvBtn.onclick = () => {
      audio.sfx.click();
      downloadTextFile(
        gameResultsExportFilename(payload, 'csv'),
        gameResultsExportToCsv(payload),
        'text/csv;charset=utf-8',
      );
      toast('CSVを保存しました');
    };
  }
  if (textBtn) {
    textBtn.onclick = () => {
      audio.sfx.click();
      downloadTextFile(
        gameResultsExportFilename(payload, 'txt'),
        gameResultsExportToText(payload),
        'text/plain;charset=utf-8',
      );
      toast('テキストを保存しました');
    };
  }
  if (copyBtn) {
    copyBtn.onclick = async () => {
      audio.sfx.click();
      const ok = await copyTextToClipboard(gameResultsExportToText(payload));
      toast(ok ? '結果をコピーしました' : 'コピーに失敗しました');
    };
  }
}

function showWinner(g) {
  const results = buildGameResults(g);
  const w = results.winnerId != null ? g.players[results.winnerId] : null;
  const overlay = $('#winner');
  overlay.hidden = false;
  $('#winner-name').textContent = w ? `${w.name} の勝ち！` : 'ゲーム終了';
  $('#winner-name').style.color = w?.color || 'var(--accent-strong)';
  const winAssets = w ? getPlayerAssets(g, w) : { total: 0 };
  $('#winner-sub').textContent = w
    ? `総資産 ${winAssets.total.toLocaleString()}G ／ 目標 ${Number(results.goal).toLocaleString()}G ／ ${results.turn}ターン`
    : `目標 ${Number(results.goal).toLocaleString()}G ／ ${results.turn}ターン`;
  renderResultsBody(results);
  bindResultsExportActions(buildResultsExportPayload(g, results));
  $('#btn-again').onclick = () => location.reload();
  audio.sfx.win();
}

function fmtG(n) {
  return `${Number(n || 0).toLocaleString()}G`;
}

function fmtSignedG(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v).toLocaleString();
  if (v > 0) return `+${abs}G`;
  if (v < 0) return `−${abs}G`;
  return '0G';
}

/** 本家風・総資産推移グラフ */
function renderWorthGraphSvg(results) {
  const hist = results.worthHistory || [];
  const ranking = results.ranking || [];
  if (!hist.length || !ranking.length) {
    return '<p class="results-empty">推移データなし</p>';
  }
  const W = 640;
  const H = 220;
  const pad = { t: 18, r: 18, b: 30, l: 52 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const maxY = Math.max(1, results.maxTotal || 1);
  const goal = Math.max(0, Number(results.goal) || 0);
  const startCash = Math.max(0, Number(results.startCash) || 0);
  const turns = hist.map((h) => h.turn);
  const tMin = turns[0];
  const tMax = Math.max(tMin + 1, turns[turns.length - 1]);
  const xAt = (turn) => pad.l + ((turn - tMin) / (tMax - tMin)) * plotW;
  const yAt = (v) => pad.t + plotH - (Math.max(0, v) / maxY) * plotH;

  const goalY = yAt(goal);
  const startY = yAt(startCash);
  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((r) => {
    const v = Math.round(maxY * r);
    const y = yAt(v);
    return `<line class="wg-grid" x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" />
      <text class="wg-axis" x="${pad.l - 6}" y="${y + 3}" text-anchor="end">${v >= 1000 ? `${Math.round(v / 1000)}k` : v}</text>`;
  }).join('');

  const lines = ranking.map((row) => {
    const pts = hist.map((h) => {
      const v = h.values?.[row.id];
      if (v == null) return null;
      return `${xAt(h.turn).toFixed(1)},${yAt(v).toFixed(1)}`;
    }).filter(Boolean);
    if (pts.length < 2) return '';
    return `<polyline class="wg-line" points="${pts.join(' ')}" stroke="${escapeHtml(row.color)}" fill="none" />`;
  }).join('');

  const dots = ranking.map((row) => {
    const last = hist[hist.length - 1];
    const v = last?.values?.[row.id];
    if (v == null) return '';
    return `<circle class="wg-dot" cx="${xAt(last.turn).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="3.5" fill="${escapeHtml(row.color)}" />`;
  }).join('');

  const legend = ranking.map((row) =>
    `<span class="wg-legend-item"><i style="background:${escapeHtml(row.color)}"></i>${escapeHtml(row.name)}</span>`
  ).join('');

  return `
    <div class="worth-graph">
      <svg viewBox="0 0 ${W} ${H}" class="worth-graph-svg" role="img" aria-label="総資産の推移">
        ${gridYs}
        <line class="wg-goal" x1="${pad.l}" y1="${goalY}" x2="${W - pad.r}" y2="${goalY}" />
        <text class="wg-goal-label" x="${W - pad.r}" y="${goalY - 4}" text-anchor="end">目標 ${goal.toLocaleString()}G</text>
        <line class="wg-start" x1="${pad.l}" y1="${startY}" x2="${W - pad.r}" y2="${startY}" />
        <text class="wg-start-label" x="${pad.l + 4}" y="${startY - 4}">開始 ${startCash.toLocaleString()}G</text>
        ${lines}
        ${dots}
        <text class="wg-axis" x="${pad.l}" y="${H - 8}">T${tMin}</text>
        <text class="wg-axis" x="${W - pad.r}" y="${H - 8}" text-anchor="end">T${tMax}</text>
      </svg>
      <div class="wg-legend">${legend}</div>
    </div>`;
}

function renderResultsRankingPane(results) {
  const maxTotal = Math.max(1, results.maxTotal || 1);
  const rankingHtml = results.ranking.map((row, i) => {
    const { cash, shopAsset, stockAsset, total } = row.assets;
    const safeTotal = Math.max(0, total);
    const barPct = Math.max(8, Math.round((safeTotal / maxTotal) * 100));
    const cashPct = safeTotal > 0 ? Math.max(0, (Math.max(0, cash) / safeTotal) * 100) : 0;
    const shopPct = safeTotal > 0 ? Math.max(0, (shopAsset / safeTotal) * 100) : 0;
    const stockPct = Math.max(0, 100 - cashPct - shopPct);
    const cls = [
      'results-row',
      row.isWinner ? 'is-winner' : '',
      row.bankrupt ? 'is-bankrupt' : '',
    ].filter(Boolean).join(' ');
    return `<article class="${cls}" data-rank="${row.rank}" style="--i:${i}">
      <div class="results-rank">${row.rank}</div>
      <div class="results-player">
        <div class="results-name" style="color:${escapeHtml(row.color)}">${escapeHtml(row.name)}</div>
        <div class="results-meta">Lv.${row.level} · 店${row.shopCount}軒 · 独占${row.monopolyAreas} · ${row.bankrupt ? '破産' : '生存'}</div>
      </div>
      <div class="results-total">${fmtG(safeTotal)}</div>
      <div class="results-bar-wrap">
        <div class="results-bar" style="--bar-w:${barPct}%">
          <i class="seg-cash" style="width:${cashPct}%"></i>
          <i class="seg-shop" style="width:${shopPct}%"></i>
          <i class="seg-stock" style="width:${stockPct}%"></i>
        </div>
        <div class="results-legend">
          <span><i class="lg-cash"></i>現金 ${fmtG(Math.max(0, cash))}</span>
          <span><i class="lg-shop"></i>お店 ${fmtG(shopAsset)}</span>
          <span><i class="lg-stock"></i>株 ${fmtG(stockAsset)}</span>
        </div>
      </div>
    </article>`;
  }).join('');

  return `
    <div class="results-pane-stack">
      ${renderWorthGraphSvg(results)}
      <div class="results-ranking">${rankingHtml}</div>
    </div>`;
}

function renderResultsSalesPane(results) {
  const head = `
    <div class="rs-table rs-head">
      <span>プレイヤー</span>
      <span>売上回数</span><span>売上合計</span><span>平均</span><span>最大</span>
      <span>支払回数</span><span>支払合計</span><span>平均</span><span>最大</span>
      <span>株リターン</span>
    </div>`;
  const rows = results.ranking.map((row, i) => {
    const s = row.sales;
    const p = row.payments;
    const ret = row.stockReturn || 0;
    const retCls = ret > 0 ? 'is-plus' : ret < 0 ? 'is-minus' : '';
    return `<div class="rs-table rs-row ${row.isWinner ? 'is-winner' : ''} ${row.bankrupt ? 'is-bankrupt' : ''}" style="--i:${i}">
      <span class="rs-name" style="color:${escapeHtml(row.color)}">${escapeHtml(row.name)}</span>
      <span>${s.count}</span><span>${fmtG(s.total)}</span><span>${fmtG(s.average)}</span><span>${fmtG(s.greatest)}</span>
      <span>${p.count}</span><span>${fmtG(p.total)}</span><span>${fmtG(p.average)}</span><span>${fmtG(p.greatest)}</span>
      <span class="rs-return ${retCls}">${fmtSignedG(ret)}</span>
    </div>`;
  }).join('');
  return `<div class="rs-scroll">${head}${rows}</div>
    <p class="results-hint">売上＝受け取った買い物料／支払＝払った買い物料／株リターン＝株価変動の含み損益</p>`;
}

function renderResultsAssetsPane(results) {
  const head = `
    <div class="ra-table ra-head">
      <span>プレイヤー</span>
      <span>総資産</span><span>現金</span><span>お店</span><span>株</span>
      <span>レベル</span><span>次の給料</span>
      <span>催促した</span><span>催促された</span>
    </div>`;
  const rows = results.ranking.map((row, i) => {
    const a = row.assets;
    const st = row.stats || {};
    return `<div class="ra-table ra-row ${row.isWinner ? 'is-winner' : ''} ${row.bankrupt ? 'is-bankrupt' : ''}" style="--i:${i}">
      <span class="ra-name" style="color:${escapeHtml(row.color)}">${escapeHtml(row.name)}</span>
      <span class="ra-total">${fmtG(a.total)}</span>
      <span>${fmtG(Math.max(0, a.cash))}</span>
      <span>${fmtG(a.shopAsset)}</span>
      <span>${fmtG(a.stockAsset)}</span>
      <span>Lv.${row.level}</span>
      <span>${fmtG(row.nextSalary)}</span>
      <span>${Number(st.nudgeSent || 0)}回</span>
      <span>${Number(st.nudgeReceived || 0)}回</span>
    </div>`;
  }).join('');
  return `<div class="ra-scroll">${head}${rows}</div>
    <p class="results-hint">次の給料＝あと1レベル昇進したときの昇進賞金見込み／催促はオンライン対戦での送受信回数</p>`;
}

function renderResultsAwardsPane(results) {
  if (!results.awards.length) {
    return '<p class="results-empty">特賞なし</p>';
  }
  return `<div class="results-awards">${results.awards.map((a, i) =>
    `<article class="results-award" style="--i:${i}">
      <div class="results-award-title">${escapeHtml(a.title)}</div>
      <div class="results-award-who" style="color:${escapeHtml(a.playerColor)}">${escapeHtml(a.playerName)}</div>
      <div class="results-award-val">${escapeHtml(a.desc)} · ${escapeHtml(a.valueLabel)}</div>
    </article>`
  ).join('')}</div>`;
}

function renderResultsBody(results, container = null) {
  const body = container || $('#results-body');
  if (!body) return;

  const tabs = [
    { id: 'rank', label: '順位' },
    { id: 'sales', label: '売上と支払い' },
    { id: 'assets', label: '資産と給料' },
    { id: 'awards', label: '特賞' },
  ];

  body.innerHTML = `
    <nav class="results-tabs" role="tablist" aria-label="結果パネル">
      ${tabs.map((t, i) =>
        `<button type="button" class="results-tab ${i === 0 ? 'active' : ''}" role="tab"
          data-results-tab="${t.id}" aria-selected="${i === 0 ? 'true' : 'false'}">${escapeHtml(t.label)}</button>`
      ).join('')}
    </nav>
    <div class="results-panes">
      <section class="results-pane active" data-results-pane="rank" role="tabpanel">
        <h3 class="results-section-title">順位グラフ</h3>
        ${renderResultsRankingPane(results)}
      </section>
      <section class="results-pane" data-results-pane="sales" role="tabpanel" hidden>
        <h3 class="results-section-title">売上と支払い</h3>
        ${renderResultsSalesPane(results)}
      </section>
      <section class="results-pane" data-results-pane="assets" role="tabpanel" hidden>
        <h3 class="results-section-title">資産と給料</h3>
        ${renderResultsAssetsPane(results)}
      </section>
      <section class="results-pane" data-results-pane="awards" role="tabpanel" hidden>
        <h3 class="results-section-title">特賞</h3>
        ${renderResultsAwardsPane(results)}
      </section>
    </div>
  `;

  body.querySelectorAll('[data-results-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.resultsTab;
      body.querySelectorAll('[data-results-tab]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      body.querySelectorAll('[data-results-pane]').forEach((pane) => {
        const on = pane.dataset.resultsPane === id;
        pane.classList.toggle('active', on);
        pane.hidden = !on;
      });
    });
  });
}

function setArchiveStatus(msg, isError = false) {
  const el = $('#archive-status');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('is-error', !!isError);
}

function setArchiveViewTab(tab) {
  const viewBody = $('#archive-results-body');
  const jsonView = $('#archive-json-view');
  $$('#archive-view-tabs [data-archive-tab]').forEach((btn) => {
    const on = btn.dataset.archiveTab === tab;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (viewBody) viewBody.hidden = tab !== 'view' || !app.archivePayload;
  if (jsonView) jsonView.hidden = tab !== 'json' || !app.archivePayload;
}

function showArchivePayload(payload, { sourceLabel = '' } = {}) {
  const parsed = parseGameResultsExport(payload);
  if (!parsed.ok) {
    setArchiveStatus(parsed.error, true);
    return false;
  }
  app.archivePayload = parsed.payload;
  const results = resultsFromExportPayload(parsed.payload);
  const summary = $('#archive-summary');
  if (summary) {
    const map = results.meta.mapName || results.meta.mapId || '—';
    const when = results.meta.exportedAt
      ? new Date(results.meta.exportedAt).toLocaleString('ja-JP')
      : '—';
    const winner = parsed.payload.winnerName || '（なし）';
    summary.hidden = false;
    summary.innerHTML = `
      <div><span>勝者</span><b>${escapeHtml(winner)}</b></div>
      <div><span>マップ</span><b>${escapeHtml(String(map))}</b></div>
      <div><span>ターン</span><b>${escapeHtml(String(results.turn))}</b></div>
      <div><span>目標</span><b>${escapeHtml(fmtG(results.goal))}</b></div>
      <div><span>出力</span><b>${escapeHtml(when)}</b></div>
      ${sourceLabel ? `<div><span>読込</span><b>${escapeHtml(sourceLabel)}</b></div>` : ''}
    `;
  }
  const tabs = $('#archive-view-tabs');
  if (tabs) tabs.hidden = false;
  const body = $('#archive-results-body');
  if (body) {
    body.hidden = false;
    renderResultsBody(results, body);
  }
  const jsonView = $('#archive-json-view');
  if (jsonView) {
    jsonView.textContent = `${JSON.stringify(parsed.payload, null, 2)}\n`;
  }
  const copyBtn = $('#btn-archive-copy-json');
  const dlBtn = $('#btn-archive-download');
  if (copyBtn) copyBtn.hidden = false;
  if (dlBtn) dlBtn.hidden = false;
  setArchiveViewTab('view');
  setArchiveStatus(sourceLabel ? `${sourceLabel}を表示中` : '結果を表示中');
  return true;
}

function openResultsArchive() {
  showScreen('screen-results-archive');
  const input = $('#archive-json-input');
  const cached = app.lastResultsExport || loadLastResultsExport();
  if (cached) {
    if (input && !input.value.trim()) {
      input.value = `${JSON.stringify(cached, null, 2)}\n`;
    }
    showArchivePayload(cached, { sourceLabel: '直前の結果' });
  } else {
    app.archivePayload = null;
    const summary = $('#archive-summary');
    if (summary) summary.hidden = true;
    const tabs = $('#archive-view-tabs');
    if (tabs) tabs.hidden = true;
    const body = $('#archive-results-body');
    if (body) {
      body.hidden = true;
      body.innerHTML = '';
    }
    const jsonView = $('#archive-json-view');
    if (jsonView) {
      jsonView.hidden = true;
      jsonView.textContent = '';
    }
    const copyBtn = $('#btn-archive-copy-json');
    const dlBtn = $('#btn-archive-download');
    if (copyBtn) copyBtn.hidden = true;
    if (dlBtn) dlBtn.hidden = true;
    setArchiveStatus('まだ結果がありません。試合終了後に自動保存されます。JSONを貼り付けるかファイルを開けます。');
  }
}

function bindResultsArchiveUi() {
  $('#btn-archive-back')?.addEventListener('click', () => {
    audio.sfx.click();
    showScreen('screen-title');
  });
  $('#btn-archive-last')?.addEventListener('click', () => {
    audio.sfx.click();
    const cached = app.lastResultsExport || loadLastResultsExport();
    if (!cached) {
      setArchiveStatus('保存済みの結果がありません', true);
      return;
    }
    const input = $('#archive-json-input');
    if (input) input.value = `${JSON.stringify(cached, null, 2)}\n`;
    showArchivePayload(cached, { sourceLabel: '直前の結果' });
  });
  $('#btn-archive-parse')?.addEventListener('click', () => {
    audio.sfx.click();
    const text = $('#archive-json-input')?.value || '';
    const parsed = parseGameResultsExport(text);
    if (!parsed.ok) {
      setArchiveStatus(parsed.error, true);
      return;
    }
    showArchivePayload(parsed.payload, { sourceLabel: '貼り付け' });
  });
  $('#archive-file')?.addEventListener('change', async (ev) => {
    const file = ev.target?.files?.[0];
    ev.target.value = '';
    if (!file) return;
    audio.sfx.click();
    try {
      const text = await file.text();
      const parsed = parseGameResultsExport(text);
      if (!parsed.ok) {
        setArchiveStatus(parsed.error, true);
        return;
      }
      const input = $('#archive-json-input');
      if (input) input.value = `${JSON.stringify(parsed.payload, null, 2)}\n`;
      showArchivePayload(parsed.payload, { sourceLabel: file.name });
    } catch {
      setArchiveStatus('ファイルを読めませんでした', true);
    }
  });
  $$('#archive-view-tabs [data-archive-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!app.archivePayload) return;
      audio.sfx.click();
      setArchiveViewTab(btn.dataset.archiveTab);
    });
  });
  $('#btn-archive-copy-json')?.addEventListener('click', async () => {
    if (!app.archivePayload) return;
    audio.sfx.click();
    const ok = await copyTextToClipboard(`${JSON.stringify(app.archivePayload, null, 2)}\n`);
    toast(ok ? 'JSONをコピーしました' : 'コピーに失敗しました');
  });
  $('#btn-archive-download')?.addEventListener('click', () => {
    if (!app.archivePayload) return;
    audio.sfx.click();
    downloadTextFile(
      gameResultsExportFilename(app.archivePayload, 'json'),
      `${JSON.stringify(app.archivePayload, null, 2)}\n`,
      'application/json;charset=utf-8',
    );
    toast('JSONを保存しました');
  });
}

function localHumanSeat(g) {
  if (app.mode === 'local') {
    const cur = currentPlayer(g);
    if (!cur || cur.isCPU) return null;
    return cur.id;
  }
  if (app.mode === 'host' || app.mode === 'guest') return app.localSeat;
  return null;
}

/** ステータス旗をクリックすると説明を表示（所持株のエリア覗き見と同じ操作感） */
function bindStatusPeek(root, g) {
  if (!root?.querySelectorAll) return;
  const clearBoardHints = () => {
    app.renderer?.clearInvestHighlight?.();
    if (app.stockPeekArea == null) app.renderer?.clearStockHighlight?.();
  };
  const syncPeek = () => {
    root.querySelectorAll('.player-card').forEach((card) => {
      const pid = Number(card.dataset.pid);
      const detailEl = card.querySelector('.pc-status-detail');
      let openBtn = null;
      card.querySelectorAll('[data-status-key]').forEach((btn) => {
        const on = app.statusPeek?.pid === pid && app.statusPeek?.key === btn.dataset.statusKey;
        btn.classList.toggle('peek-on', on);
        if (on) openBtn = btn;
      });
      if (!detailEl) return;
      if (openBtn) {
        detailEl.hidden = false;
        detailEl.textContent = openBtn.dataset.statusDetail || '';
        const shopId = Number(openBtn.dataset.shopId);
        const area = Number(openBtn.dataset.statusArea);
        if (Number.isFinite(shopId)) app.renderer?.setInvestHighlight?.(shopId);
        if (Number.isFinite(area)) app.renderer?.setStockHighlight?.(area, true);
      } else if (app.statusPeek?.pid === pid) {
        detailEl.hidden = true;
        detailEl.textContent = '';
      } else {
        detailEl.hidden = true;
        detailEl.textContent = '';
      }
    });
  };
  syncPeek();

  root.querySelectorAll('[data-status-key]').forEach((btn) => {
    const card = btn.closest('.player-card');
    const pid = Number(card?.dataset.pid);
    if (!Number.isFinite(pid)) return;
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const key = btn.dataset.statusKey;
      if (app.statusPeek?.pid === pid && app.statusPeek?.key === key) {
        app.statusPeek = null;
        clearBoardHints();
      } else {
        app.statusPeek = { pid, key };
        clearBoardHints();
        const shopId = Number(btn.dataset.shopId);
        const area = Number(btn.dataset.statusArea);
        if (Number.isFinite(shopId)) app.renderer?.setInvestHighlight?.(shopId);
        if (Number.isFinite(area)) app.renderer?.setStockHighlight?.(area, true);
      }
      // 他カードの説明も閉じる
      syncPeek();
      document.querySelectorAll('#players-panel [data-status-key]').forEach((el) => {
        const c = el.closest('.player-card');
        const id = Number(c?.dataset.pid);
        el.classList.toggle(
          'peek-on',
          app.statusPeek?.pid === id && app.statusPeek?.key === el.dataset.statusKey,
        );
      });
      document.querySelectorAll('#players-panel .player-card').forEach((c) => {
        const detailEl = c.querySelector('.pc-status-detail');
        if (!detailEl) return;
        const id = Number(c.dataset.pid);
        const open = c.querySelector(`[data-status-key].peek-on`);
        if (app.statusPeek?.pid === id && open) {
          detailEl.hidden = false;
          detailEl.textContent = open.dataset.statusDetail || '';
        } else {
          detailEl.hidden = true;
          detailEl.textContent = '';
        }
      });
    });
  });
}

/** 株チップ／所持表から盤面のエリアをハイライト（自分・他人どちらでも可） */
function bindStockAreaPeek(root, g) {
  if (!root?.querySelectorAll) return;
  const highlight = (area) => {
    if (!Number.isFinite(area)) return;
    app.renderer?.setStockHighlight(area, true);
  };
  const restoreHighlight = () => {
    if (g.phase === 'await_choice' && g.pending?.type === 'stock') {
      const sel = document.querySelector('.stock-card.selected, .stock-card[aria-pressed="true"]');
      const keep = sel ? Number(sel.dataset.area) : null;
      app.renderer?.setStockHighlight(keep, true);
      return;
    }
    if (app.stockPeekArea != null) {
      app.renderer?.setStockHighlight(app.stockPeekArea, true);
      return;
    }
    app.renderer?.clearStockHighlight();
  };
  const syncPeekClass = () => {
    root.querySelectorAll('[data-hold-area]').forEach((node) => {
      const area = Number(node.dataset.holdArea);
      node.classList.toggle('peek-on', app.stockPeekArea === area);
    });
  };
  syncPeekClass();
  if (app.stockPeekArea != null) highlight(app.stockPeekArea);

  root.querySelectorAll('[data-hold-area]').forEach((node) => {
    const area = Number(node.dataset.holdArea);
    if (!Number.isFinite(area)) return;
    node.addEventListener('mouseenter', () => highlight(area));
    node.addEventListener('mouseleave', restoreHighlight);
    node.addEventListener('focus', () => highlight(area));
    node.addEventListener('blur', restoreHighlight);
    node.addEventListener('click', (ev) => {
      // 売却UIの操作は覗き見トグルにしない
      if (ev.target.closest('input, label, [data-turn-sell], .sell-row .btn')) return;
      if (!node.classList.contains('pc-stock')
        && !node.classList.contains('stock-chip')
        && !node.classList.contains('sh-row')
        && !node.classList.contains('sh-count')
        && !node.classList.contains('sell-row')) {
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      app.stockPeekArea = app.stockPeekArea === area ? null : area;
      document.querySelectorAll('#players-panel [data-hold-area], #stocks-panel [data-hold-area]').forEach((el) => {
        el.classList.toggle('peek-on', app.stockPeekArea === Number(el.dataset.holdArea));
      });
      restoreHighlight();
    });
  });
}

function renderStockPanel(g) {
  const el = $('#stocks-panel');
  const drafts = snapshotEditableFields(el);
  const areas = Object.keys(g.areas).map(Number);
  const players = g.players;
  const seat = localHumanSeat(g);
  const me = seat != null ? g.players[seat] : null;
  const canSell = seat != null && !app.busy && canSellStockOnTurn(g, seat);

  const priceChips = areas.map((area) => {
    const meta = g.areas[area];
    const peek = app.stockPeekArea === area ? ' peek-on' : '';
    return `<button type="button" class="stock-chip${peek}" style="--ac:${meta.color}" data-hold-area="${area}" title="${escapeHtml(meta.name)}（クリックで盤面表示）">
      <b>${getAreaCode(g, area)}</b> ${meta.stockPrice}G
    </button>`;
  }).join('');

  const head = `
    <div class="sh-row sh-head">
      <span class="sh-area">エリア</span>
      ${players.map((p) => `<span class="sh-player" style="--pc:${p.color}" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>`).join('')}
    </div>`;

  const rows = areas.map((area) => {
    const meta = g.areas[area];
    const peek = app.stockPeekArea === area ? ' peek-on' : '';
    const cells = players.map((p) => {
      const n = p.stocks[area] || 0;
      return `<button type="button" class="sh-count ${n > 0 ? 'has' : ''}${peek}" style="--pc:${p.color}"
        data-hold-area="${area}"
        title="${escapeHtml(p.name)} · ${escapeHtml(meta.name)}（クリックで盤面のエリアを表示）"
        ${n > 0 ? '' : 'disabled'}>${n > 0 ? `×${n}` : '—'}</button>`;
    }).join('');
    return `<div class="sh-row${peek}" data-hold-area="${area}" style="--ac:${meta.color}">
      <span class="sh-area" title="${escapeHtml(meta.name)}">
        <b>${getAreaCode(g, area)}</b>
        <small>${meta.stockPrice}G</small>
      </span>
      ${cells}
    </div>`;
  }).join('');

  const held = me
    ? areas.filter((area) => (me.stocks[area] || 0) > 0)
    : [];
  const sellBlock = canSell && held.length
    ? `<div class="stocks-sell">
        <div class="sh-title">自分の株を売る</div>
        <p class="hint">自分のターン中なら、サイコロ前でも選択中でもいつでも売れます</p>
        <p class="hint">自分のターン内でエリアごとに${STOCK_SELL_PRESSURE_MIN}枚売るごとに株価が下がります（受取は今の株価・次の自分の番で累計リセット）</p>
        ${held.map((area) => {
          const meta = g.areas[area];
          const have = me.stocks[area] || 0;
          const price = meta.stockPrice;
          const initial = Math.min(have, 10);
          return `<div class="sell-row" style="--ac:${meta.color}" data-hold-area="${area}">
            <span class="sell-label">${getAreaCode(g, area)} ${escapeHtml(meta.name)} <small>${price}G ×${have}</small></span>
            <label class="field tiny">枚数
              <input type="number" min="1" max="${have}" value="${initial}" data-sell-count="${area}" />
            </label>
            <button type="button" class="btn tiny" data-turn-sell="${area}">売る</button>
            <div class="sell-preview" data-sell-preview="${area}">${formatStockSellPreview(g, area, initial)}</div>
          </div>`;
        }).join('')}
      </div>`
    : (seat != null && g.currentPlayerIdx === seat && !app.busy && ['await_roll', 'await_choice', 'await_fork'].includes(g.phase)
      ? `<div class="stocks-sell muted"><p class="hint">売る株がありません</p></div>`
      : '');

  el.innerHTML = `
    <div class="stocks-prices">${priceChips}</div>
    <div class="stocks-holdings">
      <div class="sh-title">株の所持（全員）</div>
      <p class="hint">マス／枚数をクリックすると盤面でエリアが光ります（自分・他人どちらでも可）。そのエリアで買い物料が発生すると、保有に応じてわけ前が入ります</p>
      <div class="sh-table" style="--sh-cols:${players.length}">${head}${rows}</div>
    </div>
    ${sellBlock}`;

  bindStockAreaPeek(el, g);

  el.querySelectorAll('[data-turn-sell]').forEach((btn) => {
    btn.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (seat == null || app.busy) return;
      const area = Number(btn.dataset.turnSell);
      const input = el.querySelector(`input[data-sell-count="${area}"]`);
      const have = Math.max(0, Math.floor(Number(me?.stocks[area]) || 0));
      if (have <= 0) return toast('売却できる株がありません');
      const want = Math.max(1, Math.floor(Number(input?.value) || 1));
      const count = Math.min(have, want);
      if (count <= 0) return toast('売却できる株がありません');
      sendAction({ type: 'sell', playerId: seat, area, count });
    };
  });

  el.querySelectorAll('input[data-sell-count]').forEach((input) => {
    const sync = () => {
      const area = Number(input.dataset.sellCount);
      const have = Math.max(0, Math.floor(Number(me?.stocks[area]) || 0));
      const want = Math.max(1, Math.floor(Number(input.value) || 1));
      const count = have > 0 ? Math.min(have, want) : 0;
      const preview = el.querySelector(`[data-sell-preview="${area}"]`);
      if (preview) {
        preview.className = `sell-preview${previewStockSell(g, area, count)?.drops ? ' drop' : ''}`;
        preview.innerHTML = formatStockSellPreview(g, area, count);
      }
    };
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    sync();
  });

  // 催促などの再描画で入力中の枚数が初期値に戻らないようにする
  restoreEditableFields(el, drafts);
  el.querySelectorAll('input[data-sell-count]').forEach((input) => {
    const area = Number(input.dataset.sellCount);
    const have = Math.max(0, Math.floor(Number(me?.stocks[area]) || 0));
    const want = Math.max(1, Math.floor(Number(input.value) || 1));
    const count = have > 0 ? Math.min(have, want) : 0;
    if (have > 0) {
      input.max = String(have);
      if (Number(input.value) > have) input.value = String(have);
    }
    const preview = el.querySelector(`[data-sell-preview="${area}"]`);
    if (preview) {
      preview.className = `sell-preview${previewStockSell(g, area, count)?.drops ? ' drop' : ''}`;
      preview.innerHTML = formatStockSellPreview(g, area, count);
    }
  });
}

/** 株売却の受取額と売却後株価の予測テキスト */
function formatStockSellPreview(g, area, count) {
  const prev = previewStockSell(g, area, count);
  if (!prev || prev.count <= 0) return '';
  const got = `受取 <strong>${prev.proceeds.toLocaleString()}G</strong>`;
  const meter = `今ターン ${prev.pressureBefore}/${prev.threshold}`;
  if (!prev.drops) {
    return `${got} · 株価変動なし（${meter} · あと${prev.untilDrop}枚）`;
  }
  const times = prev.dropCount > 1 ? `×${prev.dropCount}` : '';
  if (prev.diff === 0) {
    return `${got} · 売却後も株価 ${prev.oldPrice}G（圧${times} · ${meter}→${prev.pressureAfter}）`;
  }
  const arrow = `${prev.oldPrice}→${prev.newPrice}G（${prev.diff}G）`;
  return `${got} · 売却後の株価 <strong>${arrow}</strong>（圧${times} · ${meter}→${prev.pressureAfter}）`;
}

/** 株購入の支払額と購入後株価の予測テキスト */
function formatStockBuyPreview(g, area, count) {
  const prev = previewStockBuy(g, area, count);
  if (!prev || prev.count <= 0) return '';
  const cost = `支払 <strong>${prev.cost.toLocaleString()}G</strong>`;
  if (!prev.rises) {
    return `${cost} · 株価変動なし（${prev.threshold}枚未満）`;
  }
  if (prev.diff === 0) {
    return `${cost} · 購入後も株価 ${prev.oldPrice}G`;
  }
  const arrow = `${prev.oldPrice}→${prev.newPrice}G（+${prev.diff}G）`;
  return `${cost} · 購入後の株価 <strong>${arrow}</strong>（${prev.threshold}枚以上で上昇）`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// boot
{
  const saved = loadSavedPlayerName();
  if (saved) {
    app.localName = saved;
    const lobbyName = $('#lobby-name');
    if (lobbyName) lobbyName.value = saved;
  } else {
    app.localName = 'プレイヤー';
  }
  const ver = $('#app-version-label');
  if (ver) ver.textContent = `v${APP_VERSION}`;
}
bindVolumeUI();
bindSideChrome();
bindTitle();
bindEventFlashControls();
bindSpaceShortcuts();
showScreen('screen-title');

const field = $('#title-field');
if (field) {
  for (let i = 0; i < 14; i++) {
    const d = document.createElement('span');
    d.className = 'float-coin';
    d.style.setProperty('--x', `${6 + Math.random() * 88}%`);
    d.style.setProperty('--d', `${10 + Math.random() * 12}s`);
    d.style.setProperty('--delay', `${Math.random() * 9}s`);
    field.appendChild(d);
  }
}

// ?demo=xxx でローカル4人戦を自動開始（演出確認用）
const bootDemo = new URLSearchParams(location.search).get('demo');
if (bootDemo === 'results-json') {
  // タイトルの試合結果ビューアをサンプルJSONで開く
  const sample = {
    schema: 'mkmk-street-results/v1',
    exportedAt: '2026-11-18T12:00:00.000Z',
    game: 'MkMk Street',
    mapId: 'central_cross',
    mapName: '中央クロス',
    mode: 'local',
    goal: 10000,
    turn: 18,
    startCash: 2500,
    winnerId: 0,
    winnerName: 'あか',
    ranking: [
      {
        rank: 1, id: 0, name: 'あか', color: '#e85d75', bankrupt: false, level: 4,
        shopCount: 7, monopolyAreas: 2, isWinner: true,
        assets: { cash: 4200, shopAsset: 4800, stockAsset: 900, total: 9900 },
        sales: { count: 12, total: 6200, average: 516, greatest: 980 },
        payments: { count: 5, total: 1800, average: 360, greatest: 520 },
        stockReturn: 640, nextSalary: 1450,
        stats: { nudgeSent: 5, nudgeReceived: 1 },
      },
      {
        rank: 2, id: 1, name: 'あお', color: '#3d8bfd', bankrupt: false, level: 3,
        shopCount: 4, monopolyAreas: 0, isWinner: false,
        assets: { cash: 2800, shopAsset: 2100, stockAsset: 3200, total: 8100 },
        sales: { count: 8, total: 3100, average: 387, greatest: 610 },
        payments: { count: 9, total: 2400, average: 266, greatest: 740 },
        stockReturn: 1280, nextSalary: 1200,
        stats: { nudgeSent: 2, nudgeReceived: 4 },
      },
    ],
    awards: [
      {
        id: 'toll_king', title: '売上王', desc: '買い物料の合計が最多',
        playerId: 0, playerName: 'あか', playerColor: '#e85d75',
        value: 6200, valueLabel: '6200G',
      },
    ],
    worthHistory: [
      { turn: 1, values: { 0: 2500, 1: 2500 } },
      { turn: 9, values: { 0: 5500, 1: 4800 } },
      { turn: 18, values: { 0: 9900, 1: 8100 } },
    ],
  };
  saveLastResultsExport(sample);
  openResultsArchive();
} else if (bootDemo) {
  app.mode = 'local';
  startLocal([
    { name: 'あか', isCPU: false },
    { name: 'あお', isCPU: true },
    { name: 'きいろ', isCPU: true },
    { name: 'みどり', isCPU: true },
  ]);
}
