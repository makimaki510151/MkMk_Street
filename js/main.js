/** MkMk Street — UI / エントリ */

import {
  createGame,
  serializeState,
  restoreState,
  rollDice,
  advanceMove,
  applyChoice,
  chooseFork,
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
} from './engine.js';
import { AREA_META, SUIT_LABELS, MAP_CATALOG, DEFAULT_MAP_ID, applySwitchState } from './board.js';
import { resolveWaitingSeatId } from './nudgeTarget.js';
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
import {
  evaluateOrderRolls,
  rollOrderDie,
  reclaimOrderRollPlayer,
  markOrderRollPlayerLeft,
} from './orderRoll.js';
import { isLocalPlayer, isMyTurnSeat } from './turnOwner.js';

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
};

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
      app.net.broadcast({ type: 'lobby_sync', players: app.lobbyPlayers });
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
  app.net?.broadcast({ type: 'lobby_sync', players: app.lobbyPlayers });
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
  if (result.state) app.game = restoreState(result.state);
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
  scheduleCpu();
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
  if (result.state) app.game = restoreState(result.state);
  syncState();
  refreshGameUI();
  scheduleCpu();
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

function bindSideChrome() {
  $$('.side-tab').forEach((btn) => {
    btn.onclick = () => {
      const tab = btn.dataset.sideTab;
      $$('.side-tab').forEach((b) => {
        const on = b.dataset.sideTab === tab;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      $$('.side-pane').forEach((pane) => {
        const on = pane.dataset.pane === tab;
        pane.classList.toggle('active', on);
        pane.hidden = !on;
      });
      audio.sfx.click();
    };
  });
  $('#btn-feed-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const wrap = $('#event-feed-wrap');
    wrap?.classList.toggle('feed-collapsed');
    // 一度隠したらイベント／所持金演出で勝手に開かない
    if (wrap?.classList.contains('feed-collapsed')) app.feedAutoExpand = false;
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
}

function selectedMapId(rootSel) {
  const checked = document.querySelector(`${rootSel} input[name="map-id"]:checked`);
  return checked?.value || DEFAULT_MAP_ID;
}

function getMapDefName(mapId) {
  return MAP_CATALOG.find((m) => m.id === mapId)?.name || '中央クロス';
}

function renderMapPicker(containerId, preferredId = DEFAULT_MAP_ID, goalInputId = null) {
  const box = document.getElementById(containerId);
  if (!box) return;
  const current = preferredId || DEFAULT_MAP_ID;
  box.innerHTML = MAP_CATALOG.map((m) => `
    <label class="map-option">
      <input type="radio" name="map-id" value="${escapeHtml(m.id)}" ${m.id === current ? 'checked' : ''} />
      <span class="map-option-body">
        <strong>${escapeHtml(m.name)}</strong>
        <small>${escapeHtml(m.blurb)}</small>
      </span>
    </label>
  `).join('');
  const syncGoal = () => {
    if (!goalInputId) return;
    const input = document.getElementById(goalInputId);
    const def = MAP_CATALOG.find((m) => m.id === selectedMapId(`#${containerId}`));
    if (input && def?.defaultGoal) input.value = String(def.defaultGoal);
  };
  box.querySelectorAll('input[name="map-id"]').forEach((el) => {
    el.addEventListener('change', syncGoal);
  });
  syncGoal();
}

function openSetupLocal() {
  showScreen('screen-setup');
  $('#setup-online-only').hidden = true;
  $('#setup-title').textContent = 'ローカル対戦';
  renderMapPicker('setup-map-options', DEFAULT_MAP_ID, 'setup-goal');
  renderSeatEditors(2);
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
  if (role === 'host') renderMapPicker('lobby-map-options', DEFAULT_MAP_ID, 'lobby-goal');
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
        app.net.broadcast({ type: 'lobby_sync', players: app.lobbyPlayers });
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
    const mapId = selectedMapId('#lobby-map-options');
    resyncLobbyColors();
    const players = app.lobbyPlayers.map((p) => ({
      peerId: p.peerId,
      name: p.name,
      color: p.color,
      isCPU: !!p.isCPU,
      key: p.peerId,
    }));
    beginOrderRoll({ players, goal, mapId, mode: 'host' });
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
    app.net?.broadcast({ type: 'lobby_sync', players: app.lobbyPlayers });
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
          app.net.broadcast({ type: 'lobby_sync', players: app.lobbyPlayers });
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
      app.net.broadcast({ type: 'lobby_sync', players: app.lobbyPlayers });
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
      app.net.broadcast({ type: 'lobby_sync', players: app.lobbyPlayers });
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
        app.net.broadcast({ type: 'lobby_sync', players: app.lobbyPlayers });
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
      app.orderRoll = null;
      toast('順番決めが中断されました');
      showScreen('screen-lobby');
      return;
    }
    if (data.type === 'game_start' || data.type === 'game_rejoin') {
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
    playDiceOverlay(data.face, true).finally(() => {
      app.hideDiceResult = false;
      refreshGameUI();
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
function beginOrderRoll({ players, goal, mapId, mode }) {
  const list = players.map((p, i) => ({
    key: p.key || p.peerId || `p-${i}`,
    peerId: p.peerId || null,
    name: p.name,
    color: p.color,
    isCPU: !!p.isCPU,
  }));
  app.orderRoll = {
    players: list,
    rolls: {},
    pending: list.map((p) => p.key),
    round: 1,
    awaitingConfirm: false,
    finalOrder: null,
    goal,
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
    goal: o.goal,
    mapId: o.mapId,
  };
}

function applyOrderRollSync(data) {
  app.orderRoll = {
    players: data.players || [],
    rolls: data.rolls || {},
    pending: data.pending || [],
    round: data.round || 1,
    awaitingConfirm: !!data.awaitingConfirm,
    finalOrder: Array.isArray(data.finalOrder) ? data.finalOrder : null,
    goal: data.goal,
    mapId: data.mapId,
    mode: 'guest',
  };
  showOrderRollScreen();
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
  const awaiting = !!o.awaitingConfirm && Array.isArray(o.finalOrder) && o.finalOrder.length;
  if (hint) {
    if (awaiting) {
      hint.textContent = '出目がそろいました。下の順番を確認してください。';
    } else {
      hint.textContent = o.round > 1
        ? `同じ出目の人だけ振り直し（${o.round}回目）。1〜100・大きいほど先手。スペースでも振れます。`
        : '1〜100の出目が大きいほど先手。同じ出目の人だけ振り直します。スペースでも振れます。';
    }
  }
  if (list) {
    const byKey = new Map(o.players.map((p) => [p.key, p]));
    const rows = awaiting
      ? o.finalOrder.map((key, i) => ({ p: byKey.get(key), rank: i + 1 })).filter((r) => r.p)
      : o.players.map((p) => ({ p, rank: 0 }));
    list.innerHTML = rows.map(({ p, rank }) => {
      const rolled = Number.isFinite(o.rolls[p.key]);
      const waiting = !awaiting && pendingSet.has(p.key);
      const cls = [
        'order-roll-row',
        awaiting ? 'ranked' : '',
        awaiting && rank === 1 ? 'first' : '',
        waiting ? 'pending' : '',
        waiting && o.round > 1 ? 'tied' : '',
      ].filter(Boolean).join(' ');
      const dice = rolled ? String(o.rolls[p.key]) : (waiting ? '待ち' : '—');
      const rankHtml = awaiting
        ? `<span class="or-rank">${rank}位</span>`
        : '';
      return `<div class="${cls}" style="--pc:${p.color || PLAYER_COLORS[0]}">
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
    && !!myKey
    && pendingSet.has(myKey)
    && !o.players.find((p) => p.key === myKey)?.isCPU;
  const canConfirm = orderRollCanConfirm();
  if (btn) {
    if (awaiting) {
      btn.disabled = !canConfirm;
      btn.textContent = canConfirm ? 'この順番で開始' : 'ホストの開始待ち';
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
    o.awaitingConfirm = false;
    o.finalOrder = null;
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
  o.awaitingConfirm = true;
  o.finalOrder = result.order.slice();
  renderOrderRollUi();
  broadcastOrderRollSync();
  toast('順番が決まりました');
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
  const mapId = o.mapId;
  const mode = o.mode;
  app.orderRoll = null;

  if (mode === 'local') {
    app.mode = 'local';
    app.game = createGame({ players, goal, mapId });
    app.localSeat = players.findIndex((p) => !p.isCPU);
    if (app.localSeat < 0) app.localSeat = 0;
    enterGame();
    return;
  }

  // host online
  app.game = createGame({ players, goal, mapId });
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
      : demo === 'map-bin' ? 'bin'
      : demo === 'map-thumbs-up' ? 'thumbs_up'
        : params.get('map');
  const mapId = mapFromDemo || selectedMapId('#setup-map-options');
  const mapDef = MAP_CATALOG.find((m) => m.id === mapId);
  const goalFromUi = Number($('#setup-goal')?.value);
  const goal = mapFromDemo
    ? (mapDef?.defaultGoal)
    : (goalFromUi || mapDef?.defaultGoal || 10000);
  // デモ直入れは順番ダイスを飛ばす
  if (demo) {
    app.game = createGame({ players: seats, goal, mapId });
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
  beginOrderRoll({ players, goal, mapId, mode: 'local' });
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
    const areaName = app.game.areas[area]?.name || `A${area}`;
    p.stocks[area] = Math.max(p.stocks[area] || 0, 3);
    const other = app.game.players[1];
    if (other) other.stocks[area] = Math.max(other.stocks[area] || 0, 1);
    app.prevCash = Object.fromEntries(app.game.players.map((pl) => [pl.id, pl.cash]));
    payAreaStockDividend(app.game, area, 1000);
    enqueueBanner({
      kicker: '株わけ前',
      title: 'エリア収益の分配',
      detail: app.game.logs.find((l) => /株わけ前/.test(l.text))?.text
        || `A${area}「${areaName}」株わけ前（収益 1000G の一部）`,
      kind: 'stock',
      color: '#3d8bfd',
      mine: true,
    });
    refreshGameUI();
    return;
  }
  if (demo === 'minigame' || demo === 'slot' || demo === 'coin' || demo === 'high_low') {
    const game = demo === 'minigame' ? 'guess_dice' : demo;
    const labels = {
      guess_dice: 'サイコロ当て',
      slot: 'スロット',
      coin: 'コイントス',
      high_low: 'ハイ＆ロー',
    };
    app.game.phase = 'await_choice';
    app.game.pending = {
      type: 'minigame',
      playerId: p.id,
      game,
      label: labels[game] || 'ミニゲーム',
    };
    app.game.move = null;
    refreshGameUI();
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
    $$('.side-tab').forEach((b) => {
      const on = b.dataset.sideTab === 'holdings';
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.side-pane').forEach((pane) => {
      const on = pane.dataset.pane === 'holdings';
      pane.classList.toggle('active', on);
      pane.hidden = !on;
    });
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
  const startCash = 2000;
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
  window.addEventListener('resize', () => app.renderer?.resize());
  app.renderer.startLoop(() => app.game);
  bindBoardZoomControls(canvas);
  bindGameControls();
  bindModalTools();
  bindModalDrag();
  app.lastTurnKey = null;
  saveRejoinSession();
  app.inspectedId = app.game.startId;
  updateInspectPanel();
  refreshGameUI();
  maybeYourTurnChime();
  maybeAutoSkipRest();
  scheduleCpu();
}

function updateInspectPanel() {
  const el = $('#inspect');
  if (!el || !app.game) return;
  const g = app.game;
  const sq = app.inspectedId != null ? getNode(g, app.inspectedId) : null;
  if (!sq) {
    el.innerHTML = '<strong>マス情報</strong><span class="inspect-sub">マスをクリックして詳細を固定表示</span>';
    return;
  }
  if (sq.type === 'shop') {
    const owner = sq.owner >= 0 ? g.players[sq.owner] : null;
    const toll = calcToll(g, sq);
    const closed = !!(owner?.shopsClosed);
    const areaName = g.areas?.[sq.area]?.name || AREA_META[sq.area]?.name || `A${sq.area}`;
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
    el.innerHTML = `
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
  el.innerHTML = `<strong>${escapeHtml(sq.label || sq.type)}</strong><span class="inspect-sub">${escapeHtml(shopTooltip(g, sq))}</span>`;
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
    if (result.state) app.game = restoreState(result.state);
    syncState();
    refreshGameUI();
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
    syncState();
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
    card.style.position = 'fixed';
    card.style.left = `${app.modalDrag.x}px`;
    card.style.top = `${app.modalDrag.y}px`;
    card.style.margin = '0';
  } else {
    card.style.position = '';
    card.style.left = '';
    card.style.top = '';
    card.style.margin = '';
  }
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
    app.modalDrag.x = Math.max(8, Math.min(window.innerWidth - w - 8, origX + e.clientX - startX));
    app.modalDrag.y = Math.max(52, Math.min(window.innerHeight - h - 8, origY + e.clientY - startY));
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
      hideForkRails();
      hideModal();
      sendAction({ type: 'choice', choice: { nextId: Number(btn.dataset.next) } });
    };
  });
}

/** マップ拡大縮小・ドラッグパン・ホイールズーム */
function bindBoardZoomControls(canvas) {
  const syncZoomButtons = () => {
    const z = app.renderer?.getZoom?.() ?? 1;
    const out = $('#btn-zoom-out');
    const inn = $('#btn-zoom-in');
    if (out) out.disabled = z <= (app.renderer?.ZOOM_MIN ?? 0.65) + 0.001;
    if (inn) inn.disabled = z >= (app.renderer?.ZOOM_MAX ?? 2.5) - 0.001;
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
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !app.renderer) return;
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
    const wasClick = !pan.moved;
    const clientX = e?.clientX ?? pan.x;
    const clientY = e?.clientY ?? pan.y;
    canvas.classList.remove('is-panning');
    try { canvas.releasePointerCapture(pan.id); } catch { /* ignore */ }
    pan = null;
    if (!wasClick || !app.game || !app.renderer) return;
    const hit = app.renderer.hitTest(app.game, clientX, clientY);
    if (!hit) return;
    app.inspectedId = hit.id;
    updateInspectPanel();
    if (app.busy) return;
    if (app.game.phase === 'await_fork' && app.game.pending?.type === 'fork') {
      const mine = app.mode === 'local'
        ? !app.game.players[app.game.pending.playerId]?.isCPU
        : app.game.pending.playerId === app.localSeat;
      if (mine && app.game.pending.options.some((o) => o.id === hit.id)) {
        sendAction({ type: 'choice', choice: { nextId: hit.id } });
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
 */
function reconcileStaleEventFlash(g) {
  if (!g || !isEventUiBlocking()) return false;
  if (g.phase !== 'await_roll' && g.phase !== 'moving') return false;
  // HoldingBusy だけ残ってキューも表示もない＝スイッチ演出後などに起こる残留デッドロック
  if (!app.eventFlashOpen && !(app.eventFlashQueue?.length > 0)) {
    if (app.eventFlashHoldingBusy) {
      app.eventFlashHoldingBusy = false;
      app.busy = false;
      return true;
    }
    return false;
  }
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
    if (result.state) app.game = restoreState(result.state);
    if (result.skipped) {
      syncState();
      refreshGameUI();
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
    noteActionActor(pend.playerId ?? app.game.currentPlayerIdx);

    if (pend.type === 'fork') {
      await resolveForkChoice(Number(action.choice.nextId));
      return;
    }

    const result = applyChoice(app.game, action.choice);
    if (!result.ok) {
      if (result.state) app.game = restoreState(result.state);
      toast(choiceErrorMessage(result.error));
      refreshGameUI();
      return;
    }
    if (result.state) app.game = restoreState(result.state);
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
    if ((pend.type === 'stock' || pend.type === 'level_up') && action.choice.action === 'buy') audio.sfx.buy();
    syncState();
    refreshGameUI();

    // 銀行通過後：進行方向選択 or 移動再開
    if (result.resumeMove || (app.game.phase === 'moving' && app.game.move)) {
      app.busy = true;
      app.deferEventFlash = true;
      await continueAdvancing();
      resumeAfterMovement();
    } else if (clearBusyUnlessEventUi()) {
      refreshGameUI();
      scheduleCpu();
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
    if (result.state) app.game = restoreState(result.state);
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
    if (result.state) app.game = restoreState(result.state);
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
  if (result.state) app.game = restoreState(result.state);
  hideModal();
  app.busy = true;
  app.deferEventFlash = true;
  app.renderer?.animateToken(pid, from, nextId, 400);
  audio.sfx.step();
  syncState({ anim: { pid, from, to: nextId } });
  refreshGameUI();
  await wait(420);
  await continueAdvancing();
  resumeAfterMovement();
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
  resumeAfterMovement();
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
    if (result.state) app.game = restoreState(result.state);
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
      app.renderer?.animateToken(pid, result.from ?? from, result.to, 400);
      audio.sfx.step();
      // 最終歩でスイッチ切替がある場合、新座標の state 同期を演出後に回す
      // （ゲストが一瞬新位置→スライド開始の巻き戻りフラッシュを見ないように）
      if (!(result.done && result.switchMoves?.length)) {
        syncState({ anim: { pid, from: result.from ?? from, to: result.to } });
      }
      refreshGameUI();
      await wait(420);
    }

    // 銀行通過割込み（昇進→株→方向）
    if (result.bankInterrupt || app.game.phase === 'await_choice') {
      syncState();
      refreshGameUI();
      return;
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

async function playDiceOverlay(face, remote = false) {
  const overlay = $('#dice-overlay');
  const faceEl = $('#dice-overlay-face');
  const label = $('#dice-overlay-label');
  app.hideDiceResult = true;
  overlay.hidden = false;
  overlay.classList.remove('landed');
  label.textContent = 'サイコロ…';
  faceEl.textContent = '?';
  $('#dice-face').textContent = '?';
  $('#dice-face').classList.remove('pop');
  if (!remote) audio.sfx.dice();

  const start = performance.now();
  while (performance.now() - start < 1100) {
    faceEl.textContent = String(1 + Math.floor(Math.random() * 6));
    await wait(70);
  }
  faceEl.textContent = String(face);
  overlay.classList.add('landed');
  label.textContent = `${face} が出た！`;
  app.hideDiceResult = false;
  $('#dice-face').textContent = String(face);
  $('#dice-face').classList.add('pop');
  if (!remote) audio.sfx.diceLand(face);
  await wait(650);
  overlay.hidden = true;
  pumpEventFlash();
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

async function presentWarpFx(warps, { remote = false } = {}) {
  if (!warps?.length || !app.game) return;
  const wasBusy = app.busy;
  app.busy = true;
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

async function presentMinigameResult(result) {
  const reveal = result.reveal;
  if (!reveal) return;
  app.busy = true;
  broadcastFx({ kind: 'minigameReveal', reveal });
  await playMinigameReveal(reveal);
  const color = reveal.playerColor || '#ffe08a';
  enqueueBanner({
    kicker: reveal.label || 'ミニゲーム',
    title: reveal.title || (reveal.win ? '当たり！' : '結果発表'),
    detail: (reveal.messages || result.messages || []).join(' / '),
    kind: 'event',
    color,
    mine: true,
  });
  broadcastFx({
    kind: 'banner',
    payload: {
      kicker: reveal.label || 'ミニゲーム',
      title: reveal.title || (reveal.win ? '当たり！' : '結果発表'),
      detail: (reveal.messages || result.messages || []).join(' / '),
      kind: 'event',
      color,
    },
  });
  // busy はイベント確認完了まで維持
  clearBusyUnlessEventUi();
}

async function playMinigameReveal(reveal) {
  const overlay = $('#minigame-overlay');
  const body = $('#mg-body');
  const title = $('#mg-title');
  const detail = $('#mg-detail');
  const kicker = $('#mg-kicker');
  if (!overlay || !body) return;

  overlay.hidden = false;
  overlay.classList.remove('show-result', 'tier-jackpot', 'tier-exact', 'tier-pair', 'tier-near', 'tier-win', 'tier-miss');
  if (reveal.tier) overlay.classList.add(`tier-${reveal.tier}`);
  kicker.textContent = `${reveal.playerName || ''} の${reveal.label || 'ミニゲーム'}`;
  title.textContent = '';
  detail.textContent = '';
  body.innerHTML = '';
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

  title.textContent = reveal.title || (reveal.win ? '当たり！' : '結果発表');
  detail.textContent = reveal.detail || (reveal.messages || []).join(' / ');
  overlay.classList.add('show-result');

  if (reveal.tier === 'jackpot' || reveal.tier === 'quad' || reveal.tier === 'exact') {
    audio.sfx.slotWin(true);
  } else if (reveal.win) {
    audio.sfx.slotWin(false);
  } else {
    audio.sfx.buy();
  }

  const bigHold = reveal.tier === 'jackpot' || reveal.tier === 'quad' || reveal.tier === 'fullhouse';
  await wait(bigHold ? 1600 : 1100);
  overlay.hidden = true;
  overlay.classList.remove('show-result');
  body.innerHTML = '';
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
  const pickLabel = String(reveal.outcome?.pick ?? reveal.pick ?? '?');
  const roll = reveal.outcome?.roll ?? 1;
  body.innerHTML = `
    <div class="mg-dice-row">
      <div class="mg-dice-col"><small>予想</small><div class="mg-die">${pickLabel}</div></div>
      <div class="mg-vs">VS</div>
      <div class="mg-dice-col"><small>出目</small><div class="mg-die rolling" id="mg-roll-die">?</div></div>
    </div>`;
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
  const spin = reveal.outcome?.spin ?? 0;
  const color = reveal.outcome?.color || 'red';
  const pick = reveal.outcome?.pick || 'red';
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
  const secret = reveal.outcome?.secret ?? 1;
  const band = reveal.outcome?.band === 'high' ? 'ハイ' : 'ロー';
  const pickLabel = reveal.outcome?.pick === 'high' || reveal.pick === 'high' ? 'ハイ' : 'ロー';
  body.innerHTML = `
    <div>
      <div class="mg-hl-card spinning" id="mg-hl-num">?</div>
      <div class="mg-hl-band">予想：${pickLabel}</div>
    </div>`;
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
  const face = reveal.outcome?.face === 'tails' ? 'tails' : 'heads';
  const faceLabel = face === 'heads' ? 'おもて' : 'うら';
  const pickLabel = (reveal.outcome?.pick || reveal.pick) === 'tails' ? 'うら' : 'おもて';
  body.innerHTML = `
    <div>
      <div class="mg-coin flipping" id="mg-coin">？</div>
      <div class="mg-hl-band">予想：${pickLabel}</div>
    </div>`;
  const coin = body.querySelector('#mg-coin');
  const labels = ['おもて', 'うら'];
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
    if (result.state) app.game = restoreState(result.state);
    if (result.skipped) {
      syncState();
      refreshGameUI();
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
    if (result.state) app.game = restoreState(result.state);
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
    if (pend.type === 'fork') {
      await resolveForkChoice(Number(action.choice.nextId));
      return;
    }
    if (app.game.phase !== 'await_choice') {
      app.net.sendTo(from, { type: 'reject', reason: '今は選択できません' });
      return;
    }
    const result = applyChoice(app.game, action.choice);
    if (!result.ok) {
      if (result.state) app.game = restoreState(result.state);
      app.net.sendTo(from, { type: 'reject', reason: choiceErrorMessage(result.error) });
      syncState();
      refreshGameUI();
      return;
    }
    if (result.state) app.game = restoreState(result.state);
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
    syncState();
    refreshGameUI();
    if (result.resumeMove || (app.game.phase === 'moving' && app.game.move)) {
      app.busy = true;
      app.deferEventFlash = true;
      await continueAdvancing();
      resumeAfterMovement();
    } else if (clearBusyUnlessEventUi()) {
      refreshGameUI();
      scheduleCpu();
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
    if (result.state) app.game = restoreState(result.state);
    audio.sfx.buy();
    syncState();
    refreshGameUI();
  }
}

function syncState(extra = {}) {
  if (app.mode === 'host' && app.net) {
    app.net.broadcast({ type: 'state', state: serializeState(app.game), ...extra });
  }
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
      if (result?.state) app.game = restoreState(result.state);
      if (result?.dice) {
        app.hideDiceResult = true;
        refreshGameUI();
        await runDiceAndMove(result.dice);
      } else {
        syncState();
        refreshGameUI();
        if (clearBusyUnlessEventUi()) scheduleCpu();
      }
      return;
    }

    if (phase === 'await_fork') {
      const result = cpuAct(app.game);
      if (!result?.ok) return;
      const pid = app.game.currentPlayerIdx;
      // chooseFork already applied in cpuAct
      if (result.state) app.game = restoreState(result.state);
      if (result.stepped) {
        app.busy = true;
        app.deferEventFlash = true;
        app.renderer?.animateToken(pid, result.from, result.to, 400);
        audio.sfx.step();
        syncState({ anim: { pid, from: result.from, to: result.to } });
        refreshGameUI();
        await wait(420);
        await continueAdvancing();
        resumeAfterMovement();
      } else {
        refreshGameUI();
        if (clearBusyUnlessEventUi()) scheduleCpu();
      }
      return;
    }

    if (phase === 'await_choice') {
      const result = cpuAct(app.game);
      if (result?.state) app.game = restoreState(result.state);
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
      if (result?.resumeMove || (app.game.phase === 'moving' && app.game.move)) {
        app.busy = true;
        app.deferEventFlash = true;
        await continueAdvancing();
        resumeAfterMovement();
      } else if (clearBusyUnlessEventUi()) {
        refreshGameUI();
        scheduleCpu();
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
    const marks = SUIT_LABELS.map((s, i) => `<span class="mark ${p.marks[i] ? 'on' : ''}">${s}</span>`).join('');
    const wildN = Math.max(0, Math.floor(Number(p.wildcards) || 0));
    const wilds = wildN > 0
      ? `<span class="pc-wilds" title="ワイルドカード（銀行で空きマークに変化）">${'Ｗ'.repeat(Math.min(4, wildN))}<small>×${wildN}</small></span>`
      : '';
    const active = g.currentPlayerIdx === p.id ? 'active' : '';
    const me = p.id === app.localSeat ? 'me' : '';
    const myTurnCard = active && me ? 'my-turn' : '';
    const persona = p.isCPU ? getCpuPersonality(p) : null;
    const atGoal = !p.bankrupt && a.total >= g.goal;
    const status = [
      p.offline ? '<span class="pc-flag offline">切断</span>' : '',
      atGoal ? '<span class="pc-flag goal" title="総資産が目標以上 — 銀行停止／通過で勝利">目標到達</span>' : '',
      p.lucky ? '<span class="pc-flag lucky" title="他者の買い物料の20%を銀行から受取（次の自分の番まで）">★ラッキー</span>' : '',
      p.flags?.investCoupon ? '<span class="pc-flag invest-half" title="次の自分店への増資が半額">増資半額</span>' : '',
      (() => {
        const m = Number(p.flags?.takeoverMulti);
        if (Number.isFinite(m) && m >= 2 && m <= 4) {
          return `<span class="pc-flag coupon" title="次の店奪取が${m}倍買いになる">${m}倍クーポン</span>`;
        }
        if (p.flags?.fiveBuyCoupon) {
          return '<span class="pc-flag coupon" title="次の店奪取が3倍買いになる">3倍クーポン</span>';
        }
        return '';
      })(),
      p.flags?.tollShield ? '<span class="pc-flag" title="次の買い物料を無効化">通行守り</span>' : '',
      p.resting ? '<span class="pc-flag">休み</span>' : '',
      p.shopsClosed ? '<span class="pc-flag closed">店休</span>' : '',
      persona ? `<span class="pc-flag cpu-style" title="CPU個性">${escapeHtml(persona.label)}</span>` : '',
    ].join('');
    const stockBits = Object.keys(g.areas).map(Number)
      .filter((area) => (p.stocks[area] || 0) > 0)
      .map((area) => {
        const meta = g.areas[area];
        const n = p.stocks[area];
        return `<span class="pc-stock" style="--ac:${meta.color}" title="${escapeHtml(meta.name)} ${meta.stockPrice}G">A${area}×${n}</span>`;
      });
    const stockLine = stockBits.length
      ? `<div class="pc-stocks">${stockBits.join('')}</div>`
      : '<div class="pc-stocks empty">株なし</div>';
    return `
      <div class="player-card ${active} ${me} ${myTurnCard}" data-pid="${p.id}" style="--pc:${p.color}">
        <div class="pc-head"><span class="pc-dot"></span><strong>${escapeHtml(p.name)}</strong>${myTurnCard ? '<span class="pc-turn-badge">あなたの番</span>' : ''}<span class="pc-lv">Lv.${p.level}</span></div>
        <div class="pc-money${a.cash < 0 ? ' debt' : ''}" data-cash="${a.cash}">${a.cash.toLocaleString()}G</div>
        <div class="pc-assets">総資産 ${a.total.toLocaleString()}G</div>
        <div class="pc-sub">店 ${a.shopAsset.toLocaleString()} / 株 ${a.stockAsset.toLocaleString()}</div>
        ${stockLine}
        <div class="pc-marks">${marks}${wilds}${status}</div>
        ${p.bankrupt ? '<div class="pc-bust">破産</div>' : ''}
      </div>
    `;
  }).join('');
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
  // 料金確認などが手番移行後に残り、ホストだけ止まる／次が振れないのを解放
  if (reconcileStaleEventFlash(g)) {
    /* busy / flash をクリア済み */
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
    const mine = app.mode === 'local' ? !g.players[g.pending.playerId]?.isCPU : g.pending.playerId === app.localSeat;
    const actor = g.players[g.pending.playerId];
    // 選択UIを優先。マーク確認などの残留フラッシュが busy のままだとモーダルが出ず通信停止する
    if (mine && isEventUiBlocking()) {
      flushEventFlashImmediate();
      if (app.mode === 'guest') requestHostEventFlashFlush();
      app.busy = false;
    }
    if (mine && !app.busy) {
      app.modalActive = true;
      if (app.modalMode === 'hidden') {
        $('#modal').hidden = true;
        $('#btn-modal-restore').hidden = false;
      } else {
        showChoiceModal(g);
      }
      $('#wait-hint').hidden = true;
      setStatusBanner(true, 'あなたの番 — 選択してください', actor?.color || cur?.color);
    } else if (!mine && !app.busy) {
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
  announceNewLogs(g);
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

function pendingStatusLabel(pend) {
  switch (pend?.type) {
    case 'fork': return '分岐を選択中';
    case 'buy_shop': return 'お店を購入するか選択中';
    case 'invest': return '増資を検討中';
    case 'pick_invest': return 'イベント増資する店を選択中';
    case 'force_sell_shop': return '強制売却する店を選択中';
    case 'any_shop_buy': return `${pend.multi || 6}倍の指名買収を検討中`;
    case 'five_buy': return '5倍買いを検討中';
    case 'raise_funds': return '資金調達中（株・物件の売却）';
    case 'stock': return (pend.bankVisit || pend.bankPass)
      ? (pend.resumeMove ? '銀行通過の株購入中' : '銀行で株購入中')
      : '株を取引中';
    case 'scratch': return 'イベント表をスクラッチ中';
    case 'minigame': return `ミニゲーム「${pend.label || ''}」中`;
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
        : (/[0-9]+倍買い|奪取/.test(l.text) ? '5倍買い！' : 'お店'));
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
    if (/休み|店休|休憩|営業再開|破産|売却|休み中/.test(l.text)) {
      kicker = mine ? 'ステータス' : `${player?.name || ''} の状況`;
      title = /店休|休み中/.test(l.text) ? 'お店が休み' : (/休憩|次ターン休み|復帰/.test(l.text) ? '休憩' : 'お知らせ');
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
  const stampOnly = kind === 'mark';

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
function resumeAfterMovement() {
  app.deferEventFlash = false;
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

function scheduleNpcEventFlashIfNeeded() {
  clearTimeout(app.eventFlashNpcTimer);
  if (!app.eventFlashOpen) return;
  if (app.mode === 'guest') return; // ホスト側のNPCが進める
  const reader = app.game?.players?.[app.eventFlashReaderId];
  if (!reader?.isCPU) return;
  const delay = 1200 + Math.random() * 600;
  app.eventFlashNpcTimer = setTimeout(() => {
    if (!app.eventFlashOpen) return;
    const r = app.game?.players?.[app.eventFlashReaderId];
    if (!r?.isCPU) return;
    dismissEventFlash({ force: true });
  }, delay);
}

function resolveEventVisual(payload) {
  const kind = payload.kind || 'info';
  const text = `${payload.kicker || ''} ${payload.title || ''} ${payload.detail || ''}`;
  const base = { ...(EVENT_VISUALS[kind] || EVENT_VISUALS.info) };
  const chips = [...(base.chips || [])];

  if (kind === 'shop') {
    if (/5倍|奪取/.test(text)) {
      base.glyph = '5';
      chips.unshift('5倍買い');
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
    if (/休憩|休み/.test(text)) {
      base.glyph = 'Z';
      chips.unshift('休憩');
    } else if (/店休|営業/.test(text)) {
      base.glyph = '休';
      chips.unshift('店休');
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
      if (/5倍/.test(t)) return amount < 0 ? 'five_buy' : 'gain';
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
    return {
      mood: 'five_buy',
      color: '#e09a6a',
      face: '×5',
      title: '5倍買い',
      amount: signed,
      who: who ? `${who} がお店を5倍買い` : 'お店を5倍買い',
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
        ? `確認したら「つづける」（残り ${queued}）`
        : '確認したら「つづける」';
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

    // 選択ダイアログのスキップ（表示中のみ）
    if (app.modalActive && app.modalMode !== 'hidden') {
      const skip = $('#btn-skip-choice');
      if (skip && !skip.hidden && !skip.disabled) {
        e.preventDefault();
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
  modal.hidden = false;
  applyModalMode();
  $('#btn-end-choice').hidden = true;
  $('#btn-skip-choice').hidden = false;
  $('#btn-skip-choice').textContent = 'やめる';
  $('#modal-card').classList.remove('wide');
  $('#modal-card').classList.remove('stock-modal');
  $('#modal-card').classList.remove('scratch-modal');
  $('#modal-card').classList.remove('raise-modal');
  hideForkRails();

  if (pend.type === 'fork') {
    title.textContent = `どちらへ進む？（残り${pend.stepsLeft}マス）`;
    $('#modal-card').classList.add('fork-hint-only');
    body.innerHTML = `
      <p class="hint">左右（上下）の端に進路があります。盤面のマスをクリックしても選べます。タイトルをドラッグで移動できます。</p>`;
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
        <span class="hint">${sq.price.toLocaleString()}G・A${sq.area}</span>
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
      sendAction({ type: 'choice', choice: { action: 'propose' } });
    });
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
    $('#m-trade-accept').onclick = () => {
      sendAction({ type: 'choice', choice: { action: 'accept' } });
    };
    $('#m-trade-counter').onclick = () => {
      const draft = Number($('#trade-counter-cash')?.value || 0);
      sendAction({ type: 'choice', choice: { action: 'counter', cashDelta: draft } });
    };
    $('#m-trade-reject').onclick = () => {
      audio.sfx.cancel();
      sendAction({ type: 'choice', choice: { action: 'reject' } });
    };
    return;
  }

  if (pend.type === 'buy_shop') {
    const sq = getNode(g, pend.shopId);
    title.textContent = 'お店を購入？';
    body.innerHTML = `
      <p class="modal-lead"><strong>${sq.label}</strong>（${AREA_META[sq.area]?.name}）</p>
      <p>価格 <strong>${sq.price.toLocaleString()}G</strong></p>
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
      const area = AREA_META[sq.area]?.name || g.areas[sq.area]?.name || `A${sq.area}`;
      return { sq, rem, maxInv, owned, total, multi, pct, area };
    };

    title.textContent = '好きな店へ増資';
    const hasHalf = !!investor?.flags?.investCoupon;
    const rows = ids.map((id) => {
      const m = shopMeta(id);
      if (!m) return '';
      const landedTag = id === landedId ? '<span class="invest-landed-tag">止まった店</span>' : '';
      return `<button type="button" class="btn pick-invest-shop invest-pick-shop${id === selectedId ? ' selected' : ''}" data-shop="${id}" style="--ac:${AREA_META[m.sq.area]?.color || '#888'}">
        <strong>${escapeHtml(m.sq.label)}</strong>${landedTag}
        <span class="pick-invest-gain">枠 ${m.rem.toLocaleString()}G</span>
        <small>${escapeHtml(m.area)} · 料 ${calcToll(g, m.sq).toLocaleString()}G · 独占 ${m.owned}/${m.total}（×${m.multi}）</small>
      </button>`;
    }).join('');

    const renderAmount = () => {
      const m = shopMeta(selectedId);
      const rem = m?.rem || 0;
      const panel = $('#invest-amount-panel');
      if (!panel || !m) return;
      const preview = Math.min(rem, 100);
      const payPreview = hasHalf ? Math.ceil(preview / 2) : preview;
      panel.innerHTML = `
        <p class="modal-lead">選択中: <strong>${escapeHtml(m.sq.label)}</strong></p>
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
      ${hasHalf ? '<div class="invest-half-banner" role="status">増資半額クーポン適用中 — 今回の増資支払いが半分</div>' : ''}
      <p class="hint">${landed ? `「${escapeHtml(landed.label)}」に止まりました。` : ''}好きな自分の店へ増資できます</p>
      <div class="pick-invest-list invest-pick-list">${rows || '<p class="hint">所持店がありません</p>'}</div>
      <div id="invest-amount-panel"></div>`;
    $$('.invest-pick-shop').forEach((btn) => {
      btn.onclick = () => {
        selectedId = Number(btn.dataset.shop);
        $$('.invest-pick-shop').forEach((b) => b.classList.toggle('selected', Number(b.dataset.shop) === selectedId));
        renderAmount();
      };
    });
    renderAmount();
    return;
  }

  if (pend.type === 'pick_invest') {
    const amount = pend.amount || 80;
    const ids = pend.shopIds?.length
      ? pend.shopIds
      : g.map.filter((s) => s.type === 'shop' && s.owner === pend.playerId).map((s) => s.id);
    title.textContent = 'スクラッチ特典：店を選んで増資';
    const rows = ids.map((id) => {
      const sq = getNode(g, id);
      if (!sq) return '';
      const rem = getRemainingInvest(g, sq);
      const area = AREA_META[sq.area]?.name || `A${sq.area}`;
      const capped = rem < amount;
      return `<button type="button" class="btn pick-invest-shop" data-shop="${sq.id}" style="--ac:${AREA_META[sq.area]?.color || '#888'}">
        <strong>${escapeHtml(sq.label)}</strong>
        <span class="pick-invest-gain">+${Math.min(amount, Math.max(0, rem)).toLocaleString()}G</span>
        <small>${escapeHtml(area)} · 価格 ${sq.price.toLocaleString()}G · 枠 ${rem.toLocaleString()}G${capped ? '（枠内まで）' : ''}</small>
      </button>`;
    }).join('');
    body.innerHTML = `
      <div class="scratch-followup">
        <p class="scratch-followup-kicker">スクラッチで発動</p>
        <p class="modal-lead">好きな自分の店へ <strong>+${amount.toLocaleString()}G</strong> 無料増資</p>
        <p class="hint">タップした店の価値が上がります（増資枠がある店を選んでください）</p>
      </div>
      <div class="pick-invest-list">${rows || '<p class="hint">所持店がありません</p>'}</div>`;
    $$('.pick-invest-shop').forEach((btn) => {
      btn.onclick = () => {
        hideModal();
        sendAction({ type: 'choice', choice: { action: 'invest', shopId: Number(btn.dataset.shop) } });
      };
    });
    const skip = $('#btn-skip-choice');
    if (skip) skip.textContent = 'おまかせで増資';
    return;
  }

  if (pend.type === 'force_sell_shop') {
    const ids = pend.shopIds?.length
      ? pend.shopIds
      : g.map.filter((s) => s.type === 'shop' && s.owner === pend.playerId).map((s) => s.id);
    title.textContent = '強制売却：1店舗売る';
    const rows = ids.map((id) => {
      const sq = getNode(g, id);
      if (!sq) return '';
      const got = Math.floor(sq.price * 0.5);
      const area = AREA_META[sq.area]?.name || `A${sq.area}`;
      return `<button type="button" class="btn pick-invest-shop force-sell-shop" data-shop="${sq.id}" style="--ac:${AREA_META[sq.area]?.color || '#888'}">
        <strong>${escapeHtml(sq.label)}</strong>
        <span class="pick-invest-gain">売却 +${got.toLocaleString()}G</span>
        <small>${escapeHtml(area)} · 価格 ${sq.price.toLocaleString()}G（半額で換金）</small>
      </button>`;
    }).join('');
    body.innerHTML = `
      <div class="scratch-followup">
        <p class="scratch-followup-kicker">スクラッチで発動</p>
        <p class="modal-lead">お店を <strong>1店舗</strong> 売却する義務が発生しました</p>
        <p class="hint">売却する店を選んでください（価格の半額が手元に戻ります）</p>
      </div>
      <div class="pick-invest-list">${rows || '<p class="hint">所持店がありません</p>'}</div>`;
    $$('.force-sell-shop').forEach((btn) => {
      btn.onclick = () => {
        hideModal();
        sendAction({ type: 'choice', choice: { action: 'sell', shopId: Number(btn.dataset.shop) } });
      };
    });
    const skip = $('#btn-skip-choice');
    if (skip) {
      skip.textContent = 'おまかせで売却';
      skip.disabled = false;
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
    const rows = ids.map((id) => {
      const sq = getNode(g, id);
      if (!sq) return '';
      const owner = g.players[sq.owner];
      const price = sq.price * multi;
      const can = getLiquidatableValue(g, p) >= price;
      const area = AREA_META[sq.area]?.name || `A${sq.area}`;
      return `<button type="button" class="btn pick-invest-shop any-shop-buy" data-shop="${sq.id}" ${can ? '' : 'disabled'} style="--ac:${AREA_META[sq.area]?.color || '#888'}">
        <strong>${escapeHtml(sq.label)}</strong>
        <span class="pick-invest-gain">${price.toLocaleString()}G</span>
        <small>${escapeHtml(owner?.name || '')} · ${escapeHtml(area)} · 店価 ${sq.price.toLocaleString()}G×${multi}${can ? '' : '（資金不足）'}</small>
      </button>`;
    }).join('');
    body.innerHTML = `
      <div class="scratch-followup">
        <p class="scratch-followup-kicker">スクラッチで発動</p>
        <p class="modal-lead">好きな相手の店を <strong>${multi}倍</strong> で買収できます</p>
        <p class="hint">所持金 ${Number(p?.cash || 0).toLocaleString()}G — 不足時は調達に進めます</p>
      </div>
      <div class="pick-invest-list">${rows || '<p class="hint">相手の店がありません</p>'}</div>`;
    $$('.any-shop-buy').forEach((btn) => {
      btn.onclick = () => {
        if (btn.disabled) return;
        hideModal();
        sendAction({ type: 'choice', choice: { action: 'buy', shopId: Number(btn.dataset.shop) } });
      };
    });
    const skip = $('#btn-skip-choice');
    if (skip) {
      skip.textContent = '見送る';
      skip.disabled = false;
    }
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
        <span>A${area} ${escapeHtml(g.areas[area].name)} ×${have}（${price}G）</span>
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
    const canExec = canContinue && pend.resume && ['five_buy', 'any_shop_buy', 'buy_shop', 'invest'].includes(pend.resume.type);
    const execLabel = {
      five_buy: '調達完了 — 5倍買いする',
      any_shop_buy: '調達完了 — 指名買収する',
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
        const count = Math.max(1, Number(input?.value) || 1);
        sendAction({ type: 'choice', choice: { action: 'sell_stock', area, count } });
      };
    });
    body.querySelectorAll('input[data-sell-stock]').forEach((input) => {
      const sync = () => {
        const area = Number(input.dataset.sellStock);
        const have = p?.stocks[area] || 0;
        const count = Math.max(1, Math.min(have, Number(input.value) || 1));
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
      sendAction({ type: 'choice', choice: { action: 'continue', execute: !!canExec } });
    };
    const cancelBtn = $('#m-raise-cancel');
    if (cancelBtn && !cancelBtn.disabled) {
      cancelBtn.onclick = () => {
        audio.sfx.cancel();
        // 失敗時（still_short）は pending が残るので、先に閉じない
        sendAction({ type: 'choice', choice: { action: 'cancel' } });
      };
    }
    $('#m-raise-bankrupt').onclick = () => {
      if (!confirm('破産すると店も株も失います。よろしいですか？')) return;
      sendAction({ type: 'choice', choice: { action: 'bankrupt' } });
    };
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
        <span class="sc-name">A${area} ${meta.name}</span>
        <span class="sc-price">${price}G</span>
        <span class="sc-max">${maxBuy < 1 ? '資金不足' : `最大 ${maxBuy}枚`}</span>
        <span class="sc-have">持株 ${have}</span>
      </button>`;
    }).join('');

    body.innerHTML = `
      <p class="hint">1種類だけ選べます。枚数は下の入力欄で指定（所持金 ${Number(p?.cash || 0).toLocaleString()}G）。カードに触れると盤面のそのエリアの店が光ります（マス表記は通常のまま）。</p>
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

  if (pend.type === 'minigame') {
    const label = pend.label || 'ミニゲーム';
    title.textContent = label;
    $('#btn-skip-choice').hidden = true;
    $('#btn-end-choice').hidden = true;
    $('#modal-card').classList.add('wide');
    const game = pend.game || 'guess_dice';
    if (game === 'guess_dice') {
      body.innerHTML = `
        <p class="modal-lead">出目を当てよう！</p>
        <p class="hint">ぴったりで高額、おしい（±1）でも報酬。ハズレでも全員に参加賞が出ます。</p>
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
        <p class="hint">攻めは2d6、守りは1d6+3。ハウスの2d6を上回れば勝ち。外れても参加賞。</p>
        <div class="modal-actions">
          <button class="btn primary" id="m-rush">攻め（2d6）</button>
          <button class="btn" id="m-guard">守り（1d6+3）</button>
        </div>`;
      $('#m-rush').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'rush' } }); };
      $('#m-guard').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'guard' } }); };
    } else if (game === 'horse_race') {
      const horses = ['ハヤテ', 'ライジン', 'カゼ', 'ツキ'];
      body.innerHTML = `
        <p class="modal-lead">ミニ競馬！乗る馬を選ぼう</p>
        <p class="hint">1着は高額、2着も入賞。3着以下でも参加賞あり。</p>
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
        <p class="modal-lead">次の数字はハイ？ ロー？</p>
        <p class="hint">1〜10のうち、6以上がハイ・5以下がロー。外れても全員に参加賞。</p>
        <div class="modal-actions">
          <button class="btn primary" id="m-hi">ハイ（6〜10）</button>
          <button class="btn" id="m-lo">ロー（1〜5）</button>
        </div>`;
      $('#m-hi').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'high' } }); };
      $('#m-lo').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'low' } }); };
    } else if (game === 'rps_duel') {
      body.innerHTML = `
        <p class="modal-lead">じゃんけん勝負！</p>
        <p class="hint">勝ちで本賞、あいこは引き分け賞。負けても参加賞あり。</p>
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
        <p class="modal-lead">コインの裏表を予想！</p>
        <p class="hint">当たればボーナス。外れても全員に参加賞。</p>
        <div class="modal-actions">
          <button class="btn primary" id="m-heads">おもて</button>
          <button class="btn" id="m-tails">うら</button>
        </div>`;
      $('#m-heads').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'heads' } }); };
      $('#m-tails').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 'tails' } }); };
    } else if (game === 'roulette') {
      body.innerHTML = `
        <p class="modal-lead">ルーレットに賭けよう！</p>
        <p class="hint">赤／黒は通常配当、緑(0)は大当り。外れても参加賞。</p>
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
        <p class="modal-lead">金庫破り（非対称リスク）</p>
        <p class="hint">用心は成功しやすいが少額。大胆は高配当だが失敗しやすい。失敗時もみんなに慰労金。</p>
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
        <p class="hint">ポンプ回数が多いほど高配当。限界を超えると破裂して本人ゼロ。参加賞あり。</p>
        <div class="modal-actions">
          <button class="btn" id="m-p3">3回（安全寄り）</button>
          <button class="btn primary" id="m-p5">5回</button>
          <button class="btn" id="m-p7">7回（高配当）</button>
        </div>`;
      $('#m-p3').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 3 } }); };
      $('#m-p5').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 5 } }); };
      $('#m-p7').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'pick', value: 7 } }); };
    } else {
      body.innerHTML = `
        <p class="modal-lead">スロットを回そう！</p>
        <p class="hint">5リールの役（5揃い／4揃い／フルハウスなど）で報酬。外れても全員に参加賞。</p>
        <div class="modal-actions">
          <button class="btn primary large" id="m-spin">回す！</button>
        </div>`;
      $('#m-spin').onclick = () => { hideModal(); sendAction({ type: 'choice', choice: { action: 'spin' } }); };
    }
    return;
  }

  $('#modal-card').classList.remove('wide');
}

function hideModal() {
  app.modalActive = false;
  // 選択完了後は次の選択を右下に再表示
  app.modalMode = 'shown';
  $('#modal').hidden = true;
  $('#btn-modal-restore').hidden = true;
  hideForkRails();
  const card = $('#modal-card');
  card?.classList.remove('fork-hint-only', 'scratch-modal', 'stock-modal', 'wide');
  $('#modal')?.classList.remove('centered');
  app.renderer?.clearStockHighlight();
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
  app.lastResultsExport = payload;
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

function renderResultsBody(results) {
  const body = $('#results-body');
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

function localHumanSeat(g) {
  if (app.mode === 'local') {
    const cur = currentPlayer(g);
    if (!cur || cur.isCPU) return null;
    return cur.id;
  }
  if (app.mode === 'host' || app.mode === 'guest') return app.localSeat;
  return null;
}

function renderStockPanel(g) {
  const el = $('#stocks-panel');
  const areas = Object.keys(g.areas).map(Number);
  const players = g.players;
  const seat = localHumanSeat(g);
  const me = seat != null ? g.players[seat] : null;
  const canSell = seat != null && !app.busy && canSellStockOnTurn(g, seat);

  const priceChips = areas.map((area) => {
    const meta = g.areas[area];
    return `<button type="button" class="stock-chip" style="--ac:${meta.color}" data-hold-area="${area}" title="${escapeHtml(meta.name)}">
      <b>A${area}</b> ${meta.stockPrice}G
    </button>`;
  }).join('');

  const head = `
    <div class="sh-row sh-head">
      <span class="sh-area">エリア</span>
      ${players.map((p) => `<span class="sh-player" style="--pc:${p.color}" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>`).join('')}
    </div>`;

  const rows = areas.map((area) => {
    const meta = g.areas[area];
    const cells = players.map((p) => {
      const n = p.stocks[area] || 0;
      return `<span class="sh-count ${n > 0 ? 'has' : ''}" style="--pc:${p.color}">${n > 0 ? `×${n}` : '—'}</span>`;
    }).join('');
    return `<div class="sh-row" data-hold-area="${area}" style="--ac:${meta.color}">
      <span class="sh-area" title="${escapeHtml(meta.name)}">
        <b>A${area}</b>
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
            <span class="sell-label">A${area} ${escapeHtml(meta.name)} <small>${price}G ×${have}</small></span>
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
      <p class="hint">そのエリアで買い物料が発生すると、保有に応じてわけ前が入ります</p>
      <div class="sh-table" style="--sh-cols:${players.length}">${head}${rows}</div>
    </div>
    ${sellBlock}`;

  const highlight = (area) => {
    app.renderer?.setStockHighlight(area, true);
  };
  const clear = () => {
    // 株購入モーダル中はハイライトを維持
    if (g.phase === 'await_choice' && g.pending?.type === 'stock') {
      const sel = document.querySelector('.stock-card.selected, .stock-card[aria-pressed="true"]');
      const keep = sel ? Number(sel.dataset.area) : null;
      app.renderer?.setStockHighlight(keep, true);
      return;
    }
    app.renderer?.clearStockHighlight();
  };

  el.querySelectorAll('[data-hold-area]').forEach((node) => {
    const area = Number(node.dataset.holdArea);
    node.addEventListener('mouseenter', () => highlight(area));
    node.addEventListener('mouseleave', clear);
    node.addEventListener('focus', () => highlight(area));
    node.addEventListener('blur', clear);
  });

  el.querySelectorAll('[data-turn-sell]').forEach((btn) => {
    btn.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (seat == null || app.busy) return;
      const area = Number(btn.dataset.turnSell);
      const input = el.querySelector(`input[data-sell-count="${area}"]`);
      const have = me?.stocks[area] || 0;
      const count = Math.max(1, Math.min(have, Number(input?.value) || 1));
      sendAction({ type: 'sell', playerId: seat, area, count });
    };
  });

  el.querySelectorAll('input[data-sell-count]').forEach((input) => {
    const sync = () => {
      const area = Number(input.dataset.sellCount);
      const have = me?.stocks[area] || 0;
      const count = Math.max(1, Math.min(have, Number(input.value) || 1));
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
if (bootDemo) {
  app.mode = 'local';
  startLocal([
    { name: 'あか', isCPU: false },
    { name: 'あお', isCPU: true },
    { name: 'きいろ', isCPU: true },
    { name: 'みどり', isCPU: true },
  ]);
}
