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
  cpuAct,
  currentPlayer,
  getPlayerAssets,
  buildGameResults,
  createEmptyStats,
  updateAreaStockPrices,
  getLiquidatableValue,
  calcToll,
  getRemainingInvest,
  getNode,
  getSharedEventTable,
  PLAYER_COLORS,
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
import { AREA_META, SUIT_LABELS } from './board.js';
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

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const audio = createAudio();

const app = {
  mode: null,
  net: null,
  game: null,
  localSeat: 0,
  localName: 'プレイヤー',
  lobbyPlayers: [],
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
};

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

function showHostReconnectPrompt() {
  const rejoin = readRejoinSession(app.net?.roomCode || '');
  const room = app.net?.roomCode || rejoin?.room || '';
  const name = app.localName || rejoin?.name || '';
  app.net?.destroy();
  app.net = null;
  app.game = null;
  clearAllDisconnectTimers();
  showScreen('screen-title');
  // タイトルから再参加しやすく部屋コードを渡す
  const joinBtn = $('#btn-join');
  if (joinBtn && room) {
    joinBtn.dataset.prefillRoom = room;
    joinBtn.dataset.prefillName = name;
  }
  toast(room ? `部屋 ${room} に同じ名前で再接続できます` : 'タイトルから再接続してください');
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
  $('#btn-feed-toggle')?.addEventListener('click', () => {
    $('#event-feed-wrap')?.classList.toggle('feed-collapsed');
    audio.sfx.click();
  });
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

function openSetupLocal() {
  showScreen('screen-setup');
  $('#setup-online-only').hidden = true;
  $('#setup-title').textContent = 'ローカル対戦';
  renderSeatEditors(2);
  $('#btn-start-game').onclick = () => {
    const seats = readSeatEditors();
    if (seats.length < 2) return toast('2人以上必要です');
    audio.sfx.click();
    startLocal(seats);
  };
  $('#btn-setup-back').onclick = () => showScreen('screen-title');
}

function renderSeatEditors(count) {
  const box = $('#seat-editors');
  box.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const row = document.createElement('div');
    row.className = 'seat-row';
    row.innerHTML = `
      <span class="seat-swatch" style="background:${PLAYER_COLORS[i]}"></span>
      <input class="seat-name" data-i="${i}" value="${['あか','あお','きいろ','みどり'][i]}" maxlength="10" />
      <label class="seat-cpu"><input type="checkbox" data-cpu="${i}" ${i >= count ? 'checked' : ''}/> CPU</label>
      <label class="seat-on"><input type="checkbox" data-on="${i}" ${i < count ? 'checked' : ''}/> 参加</label>
    `;
    box.appendChild(row);
  }
}

function readSeatEditors() {
  const seats = [];
  for (let i = 0; i < 4; i++) {
    const on = $(`input[data-on="${i}"]`)?.checked;
    if (!on) continue;
    seats.push({
      name: $(`input.seat-name[data-i="${i}"]`)?.value || `P${i + 1}`,
      color: PLAYER_COLORS[i],
      isCPU: $(`input[data-cpu="${i}"]`)?.checked || false,
    });
  }
  return seats;
}

async function openLobby(role, prefill = {}) {
  app.mode = role;
  showScreen('screen-lobby');
  $('#lobby-role').textContent = role === 'host' ? 'ホスト（部屋を作る）' : 'ゲスト（部屋に入る）';
  $('#lobby-room-wrap').hidden = role === 'host';
  $('#lobby-host-tools').hidden = role !== 'host';
  $('#btn-lobby-start').hidden = role !== 'host';
  $('#btn-add-cpu').hidden = role !== 'host';
  $('#lobby-code-display').textContent = '------';
  $('#lobby-players').innerHTML = '';
  if (prefill.name) $('#lobby-name').value = prefill.name;
  if (prefill.room && role === 'guest') {
    const roomInput = $('#lobby-room');
    if (roomInput) roomInput.value = String(prefill.room).toUpperCase();
  }
  const rejoin = role === 'guest' ? readRejoinSession(($('#lobby-room')?.value || '').toUpperCase()) : null;
  if (role === 'guest' && rejoin?.name && !$('#lobby-name').value.trim()) {
    $('#lobby-name').value = rejoin.name;
  }
  setStatus(role === 'host' ? '「接続」で部屋を開きます' : '部屋コードを入れて「接続」（切断後は同じ名前で再接続）');

  $('#btn-lobby-back').onclick = () => {
    app.net?.destroy();
    app.net = null;
    showScreen('screen-title');
  };

  $('#btn-lobby-connect').onclick = async () => {
    try {
      const name = $('#lobby-name').value.trim() || 'プレイヤー';
      app.localName = name;
      const roomInput = $('#lobby-room').value.trim().toUpperCase();
      if (role === 'guest' && roomInput.length < 4) return toast('部屋コードを入力してください');

      app.net = createNet({
        role,
        roomCode: role === 'guest' ? roomInput : undefined,
        onStatus: ({ msg, kind }) => setStatus(msg, kind),
        onEvent: handleNetEvent,
      });
      const info = await app.net.start();
      $('#lobby-code-display').textContent = info.roomCode;
      if (role === 'host') {
        app.lobbyPlayers = [{ peerId: info.peerId, name, color: PLAYER_COLORS[0], isHost: true }];
        renderLobbyPlayers();
        app.net.broadcast({ type: 'lobby_sync', players: app.lobbyPlayers });
      } else {
        const rejoin = readRejoinSession(roomInput);
        app.net.sendToHost({
          type: 'hello',
          name,
          peerId: info.peerId,
          rejoinSeat: rejoin?.seat,
        });
      }
    } catch (e) {
      setStatus(e.message || String(e), 'error');
      toast('接続に失敗しました');
    }
  };

  $('#btn-lobby-start').onclick = () => {
    if (app.mode !== 'host') return;
    if (app.lobbyPlayers.length < 2) return toast('あと1人以上待ってください（またはCPUを追加）');
    const goal = Number($('#lobby-goal').value) || 10000;
    const players = app.lobbyPlayers.map((p, i) => ({
      peerId: p.peerId,
      name: p.name,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      isCPU: !!p.isCPU,
    }));
    app.game = createGame({ players, goal });
    app.localSeat = 0;
    app.net.broadcast({ type: 'game_start', state: serializeState(app.game), seatMap: players.map((p) => p.peerId) });
    enterGame();
    saveRejoinSession();
  };

  $('#btn-add-cpu').onclick = () => {
    if (app.lobbyPlayers.length >= 4) return toast('最大4人です');
    const i = app.lobbyPlayers.length;
    app.lobbyPlayers.push({
      peerId: `cpu-${i}`,
      name: `CPU${i}`,
      color: PLAYER_COLORS[i],
      isCPU: true,
    });
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
    <div class="lobby-player" style="--pc:${p.color || PLAYER_COLORS[i]}">
      <span class="lp-dot"></span>
      <span>${p.name}${p.isHost ? '（ホスト）' : ''}${p.isCPU ? '（CPU）' : ''}</span>
    </div>
  `).join('');
}

function handleNetEvent({ from, data }) {
  if (!data) return;

  if (app.mode === 'host') {
    if (data.type === 'hello') {
      if (app.lobbyPlayers.length >= 4) {
        app.net.sendTo(from, { type: 'lobby_full' });
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
      const i = app.lobbyPlayers.length;
      app.lobbyPlayers.push({
        peerId: data.peerId || from,
        name: data.name || `P${i + 1}`,
        color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      });
      renderLobbyPlayers();
      app.net.broadcast({ type: 'lobby_sync', players: app.lobbyPlayers });
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
      if (data.throughLogKey) app.lastSeenLogKey = data.throughLogKey;
      flushEventFlashImmediate();
      app.busy = false;
      refreshGameUI();
      scheduleCpu();
      return;
    }
    if (data.type === 'action') {
      handleHostAction(from, data);
      return;
    }
    if (data.type === 'peer_left') {
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
    if (data.type === 'lobby_sync') {
      app.lobbyPlayers = data.players;
      renderLobbyPlayers();
      return;
    }
    if (data.type === 'lobby_full') {
      toast('部屋が満員です');
      return;
    }
    if (data.type === 'game_start' || data.type === 'game_rejoin') {
      app.game = restoreState(data.state);
      const myPeer = app.net.peerId;
      if (data.type === 'game_rejoin' && typeof data.seat === 'number') {
        app.localSeat = data.seat;
        app.game.players[app.localSeat].peerId = myPeer;
        app.game.players[app.localSeat].offline = false;
      } else {
        app.localSeat = app.game.players.findIndex((p) => p.peerId === myPeer);
        if (app.localSeat < 0) app.localSeat = 0;
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
  if (data.kind === 'banner') {
    enqueueBanner(data.payload || data);
  }
  if (data.kind === 'eventFlashFlush') {
    flushEventFlashImmediate({ remote: true });
    // 同一ログからの再フラッシュで次手番が塞がらないよう既読にする
    if (data.throughLogKey) app.lastSeenLogKey = data.throughLogKey;
    app.busy = false;
    refreshGameUI();
  }
  if (data.kind === 'eventFlashDismiss') {
    dismissEventFlash({ remote: true });
  }
  if (data.kind === 'fiveBuy') {
    audio.sfx.fiveBuy();
    if (data.payload) enqueueBanner(data.payload);
  }
  if (data.kind === 'monopoly') {
    audio.sfx.monopoly();
    if (data.payload) enqueueBanner(data.payload);
  }
  if (data.kind === 'monopolyBreak') {
    audio.sfx.toll();
    if (data.payload) enqueueBanner(data.payload);
  }
  if (data.kind === 'yourTurn' && data.seat === app.localSeat) audio.sfx.yourTurn();
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

function startLocal(seats) {
  const goal = Number($('#setup-goal').value) || 10000;
  app.game = createGame({ players: seats, goal });
  app.localSeat = seats.findIndex((s) => !s.isCPU);
  if (app.localSeat < 0) app.localSeat = 0;
  enterGame();
  maybeDemoLanding();
}

function maybeDemoLanding() {
  const demo = new URLSearchParams(location.search).get('demo');
  if (!demo || !app.game) return;
  const p = currentPlayer(app.game);
  if (!p) return;
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
        cell.color = playerColorIndex(who);
        cell.group = cell.color;
      }
    } else {
      // 開けた人の色で塗られた状態を見せる（イベント効果は適用しない）
      for (let i = 0; i < Math.min(12, table.cells.length); i++) {
        const who = app.game.players[i % app.game.players.length];
        const cell = table.cells[i];
        cell.scratched = true;
        cell.scratchedBy = who.id;
        cell.color = playerColorIndex(who);
        cell.group = cell.color;
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
        rolls: 28, diceTotal: 98, tollEarned: 6200, tollPaid: 1800, dividendEarned: 420,
        shopsBought: 7, shopsStolen: 1, investTotal: 3400, salaryEarned: 2100, levelUps: 3,
        monopolyCount: 2, monopolyBonus: 1800, stockBought: 40, stockSpent: 2200,
        stockSold: 8, stockIncome: 500, scratchCount: 6, matchBonus: 300,
        minigamePlays: 3, minigameWins: 2, minigamePrize: 520,
      },
    },
    {
      cash: 2800,
      level: 3,
      stats: {
        rolls: 26, diceTotal: 90, tollEarned: 3100, tollPaid: 2400, dividendEarned: 980,
        shopsBought: 4, shopsStolen: 0, investTotal: 900, salaryEarned: 1200, levelUps: 2,
        monopolyCount: 0, monopolyBonus: 0, stockBought: 85, stockSpent: 4800,
        stockSold: 20, stockIncome: 1400, scratchCount: 4, matchBonus: 100,
        minigamePlays: 2, minigameWins: 0, minigamePrize: 0,
      },
    },
    {
      cash: 1500,
      level: 3,
      stats: {
        rolls: 24, diceTotal: 85, tollEarned: 4500, tollPaid: 3200, dividendEarned: 200,
        shopsBought: 6, shopsStolen: 2, investTotal: 2100, salaryEarned: 900, levelUps: 2,
        monopolyCount: 1, monopolyBonus: 900, stockBought: 15, stockSpent: 800,
        stockSold: 5, stockIncome: 280, scratchCount: 8, matchBonus: 450,
        minigamePlays: 5, minigameWins: 3, minigamePrize: 780,
      },
    },
    {
      cash: 600,
      level: 2,
      stats: {
        rolls: 22, diceTotal: 70, tollEarned: 800, tollPaid: 4100, dividendEarned: 60,
        shopsBought: 2, shopsStolen: 0, investTotal: 200, salaryEarned: 400, levelUps: 1,
        monopolyCount: 0, monopolyBonus: 0, stockBought: 10, stockSpent: 400,
        stockSold: 2, stockIncome: 90, scratchCount: 3, matchBonus: 50,
        minigamePlays: 1, minigameWins: 0, minigamePrize: 0,
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
  const feed = $('#event-feed');
  if (feed) feed.innerHTML = '';
  const canvas = $('#board');
  app.renderer = createRenderer(canvas);
  app.renderer.resize();
  window.addEventListener('resize', () => app.renderer?.resize());
  app.renderer.startLoop(() => app.game);
  canvas.onclick = (e) => {
    if (!app.game) return;
    const hit = app.renderer.hitTest(app.game, e.clientX, e.clientY);
    if (!hit) return;

    // マス情報は演出中でも常に更新
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
    const areaName = AREA_META[sq.area]?.name || `A${sq.area}`;
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
  if (app.game.phase === 'gameover') return false;
  const cur = currentPlayer(app.game);
  if (!cur || cur.isCPU) return false;
  if (app.mode === 'local') return !cur.isCPU;
  if (app.mode === 'host') return cur.peerId === app.net?.peerId || cur.id === 0;
  if (app.mode === 'guest') return cur.peerId === app.net?.peerId;
  return false;
}

function bindGameControls() {
  $('#btn-roll').onclick = () => {
    if (app.busy) return;
    audio.resume();
    sendAction({ type: 'roll' });
  };
  $('#btn-end-choice').onclick = () => {
    hideModal();
    sendAction({ type: 'choice', choice: { action: 'done' } });
  };
  $('#btn-skip-choice').onclick = () => {
    audio.sfx.cancel();
    hideModal();
    sendAction({ type: 'choice', choice: { action: 'skip' } });
  };
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

/** ゲストが局所解放したとき、ホスト側の残留告知も捨てさせる */
function requestHostEventFlashFlush() {
  if (app.mode !== 'guest' || !app.net) return;
  const throughLogKey = app.game?.logs?.[0] ? logKey(app.game.logs[0]) : null;
  app.net.sendToHost({
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
    if (throughLogKey) app.lastSeenLogKey = throughLogKey;
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
    app.net.sendToHost({ type: 'action', action, seat: app.localSeat });
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
    if (!result.ok) return toast(result.error || '失敗');
    if (result.state) app.game = restoreState(result.state);
    if (action.choice.action === 'buy' && pend.type === 'buy_shop') audio.sfx.buy();
    if (result.fiveBuy) {
      audio.sfx.fiveBuy();
      const fivePayload = {
        kicker: '5倍買い',
        title: 'お店を奪取',
        detail: '店価×5でお店を買収した',
        kind: 'shop',
        color: currentPlayer(app.game)?.color || '#ffe08a',
        mine: true,
      };
      broadcastFx({ kind: 'fiveBuy', payload: fivePayload });
      enqueueBanner(fivePayload);
    }
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

async function continueAdvancing() {
  app.deferEventFlash = true;
  while (app.game?.move && app.game.phase === 'moving') {
    const pid = app.game.currentPlayerIdx;
    const from = app.game.players[pid].pos;
    const result = advanceMove(app.game);
    if (!result.ok) break;
    if (result.state) app.game = restoreState(result.state);

    if (result.forked) {
      audio.sfx.fork();
      syncState();
      refreshGameUI();
      return;
    }

    if (result.stepped) {
      app.renderer?.animateToken(pid, result.from ?? from, result.to, 400);
      audio.sfx.step();
      syncState({ anim: { pid, from: result.from ?? from, to: result.to } });
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
      if (result.warps?.length) await presentWarpFx(result.warps);
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
  const title = `${COLOR_LABELS[top.color] || ''}色 ${top.count}そろい！`;
  const detail = matchMsgs.join(' / ') || `+${totalBonus}G`;
  const color = top.beneficiaryColor || GROUP_COLORS[top.color] || '#ffe08a';

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
  } else if (game === 'high_low') {
    await animateHighLowReveal(body, reveal);
  } else if (game === 'coin') {
    await animateCoinReveal(body, reveal);
  } else {
    body.innerHTML = `<div class="mg-hl-card landed">?</div>`;
    await wait(400);
  }

  title.textContent = reveal.title || (reveal.win ? '当たり！' : '結果発表');
  detail.textContent = reveal.detail || (reveal.messages || []).join(' / ');
  overlay.classList.add('show-result');

  if (reveal.tier === 'jackpot' || reveal.tier === 'exact') audio.sfx.slotWin(true);
  else if (reveal.win) audio.sfx.slotWin(false);
  else audio.sfx.buy();

  await wait(reveal.tier === 'jackpot' ? 1600 : 1100);
  overlay.hidden = true;
  overlay.classList.remove('show-result');
  body.innerHTML = '';
  pumpEventFlash();
}

async function animateSlotReveal(body, reveal) {
  const finals = reveal.outcome?.symbols || ['★', '♪', 'G'];
  body.innerHTML = `
    <div class="mg-slot">
      ${[0, 1, 2].map((i) => `<div class="mg-reel spinning" data-i="${i}"><span>${SLOT_SYMS[i]}</span></div>`).join('')}
    </div>`;
  const reels = [...body.querySelectorAll('.mg-reel')];
  const spans = reels.map((r) => r.querySelector('span'));
  let spinning = true;
  const spinLoop = (async () => {
    while (spinning) {
      spans.forEach((sp, i) => {
        if (reels[i].classList.contains('spinning')) {
          sp.textContent = SLOT_SYMS[Math.floor(Math.random() * SLOT_SYMS.length)];
        }
      });
      audio.sfx.slotSpin();
      await wait(70);
    }
  })();

  await wait(500);
  for (let i = 0; i < 3; i++) {
    await wait(380 + i * 120);
    reels[i].classList.remove('spinning');
    reels[i].classList.add('stopped');
    spans[i].textContent = finals[i];
    audio.sfx.slotStop();
  }
  spinning = false;
  await spinLoop;

  const [a, b, c] = finals;
  if (a === b && b === c) reels.forEach((r) => r.classList.add('hit'));
  else {
    if (a === b) { reels[0].classList.add('hit'); reels[1].classList.add('hit'); }
    if (b === c) { reels[1].classList.add('hit'); reels[2].classList.add('hit'); }
    if (a === c && a !== b) { reels[0].classList.add('hit'); reels[2].classList.add('hit'); }
  }
  await wait(350);
}

async function animateDiceGuessReveal(body, reveal) {
  const pick = reveal.outcome?.pick ?? reveal.pick ?? '?';
  const roll = reveal.outcome?.roll ?? 1;
  body.innerHTML = `
    <div class="mg-dice-row">
      <div class="mg-dice-col"><small>予想</small><div class="mg-die">${pick}</div></div>
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
    if (isEventUiBlocking() && !app.busy && app.game) {
      reconcileStaleEventFlash(app.game);
    }
    if (app.busy || isEventUiBlocking()) {
      // 手番プレイヤーのサイコロなら、確認担当が自分でない残留告知を捨てて受理
      if (action?.type === 'roll'
        && app.game?.phase === 'await_roll'
        && app.game.currentPlayerIdx === seat
        && isEventUiBlocking()
        && !app.busy) {
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
    if (result.state) app.game = restoreState(result.state);
    if (result.fiveBuy) {
      audio.sfx.fiveBuy();
      broadcastFx({ kind: 'fiveBuy' });
    }
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
  if (!cur?.isCPU) return;

  app.cpuTimer = setTimeout(async () => {
    if (app.busy || isEventUiBlocking() || !app.game) return;
    noteActionActor(app.game.currentPlayerIdx);
    const phase = app.game.phase;

    if (phase === 'await_roll') {
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
      if (result?.fiveBuy) {
        audio.sfx.fiveBuy();
        broadcastFx({ kind: 'fiveBuy' });
      }
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
  const cur = currentPlayer(g);
  if (!cur || cur.isCPU) return;
  const mine = app.mode === 'local' ? !cur.isCPU : (
    app.mode === 'guest' ? cur.peerId === app.net?.peerId : (cur.peerId === app.net?.peerId || cur.id === 0)
  );
  const key = `${g.turn}-${g.currentPlayerIdx}-${g.phase}`;
  if (!mine || app.lastTurnKey === key) return;
  app.lastTurnKey = key;
  audio.sfx.yourTurn();
  broadcastFx({ kind: 'yourTurn', seat: cur.id });
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
    const active = g.currentPlayerIdx === p.id ? 'active' : '';
    const me = p.id === app.localSeat ? 'me' : '';
    const persona = p.isCPU ? getCpuPersonality(p) : null;
    const atGoal = !p.bankrupt && a.total >= g.goal;
    const status = [
      p.offline ? '<span class="pc-flag offline">切断</span>' : '',
      atGoal ? '<span class="pc-flag goal" title="総資産が目標以上 — 銀行停止／通過で勝利">目標到達</span>' : '',
      p.lucky ? '<span class="pc-flag lucky" title="他者の買い物料の20%を銀行から受取（次の自分の番まで）">★ラッキー</span>' : '',
      p.flags?.fiveBuyCoupon ? '<span class="pc-flag coupon" title="次の店奪取が3倍買いになる">3倍クーポン</span>' : '',
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
      <div class="player-card ${active} ${me}" data-pid="${p.id}" style="--pc:${p.color}">
        <div class="pc-head"><span class="pc-dot"></span><strong>${escapeHtml(p.name)}</strong><span class="pc-lv">Lv.${p.level}</span></div>
        <div class="pc-money${a.cash < 0 ? ' debt' : ''}" data-cash="${a.cash}">${a.cash.toLocaleString()}G</div>
        <div class="pc-assets">総資産 ${a.total.toLocaleString()}G</div>
        <div class="pc-sub">店 ${a.shopAsset.toLocaleString()} / 株 ${a.stockAsset.toLocaleString()}</div>
        ${stockLine}
        <div class="pc-marks">${marks}${status}</div>
        ${p.bankrupt ? '<div class="pc-bust">破産</div>' : ''}
      </div>
    `;
  }).join('');
  renderDisconnectPanel(g);
  maybePresentMoneyFx(g);
  flushPendingMoneyFx();

  const pressure = getGoalPressurePlayers(g);
  $('#goal-chip').textContent = pressure.length
    ? `目標 ${g.goal.toLocaleString()}G ⚠到達${pressure.length}人`
    : `目標 ${g.goal.toLocaleString()}G`;
  $('#goal-chip').classList.toggle('urgent', pressure.length > 0);
  $('#turn-chip').textContent = `ターン ${g.turn}`;
  const cur = currentPlayer(g);
  $('#phase-chip').textContent = phaseLabel(g);
  $('#current-name').textContent = cur ? `${cur.name} の番` : '';
  $('#current-name').style.color = cur?.color || '#fff';
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
        : (canRoll ? 'サイコロを振る' : (cur?.isCPU ? 'CPUの手番…' : '待機中…')));
  }

  if ((g.phase === 'await_choice' || g.phase === 'await_fork') && g.pending && !app.busy) {
    const mine = app.mode === 'local' ? !g.players[g.pending.playerId]?.isCPU : g.pending.playerId === app.localSeat;
    const actor = g.players[g.pending.playerId];
    if (mine) {
      app.modalActive = true;
      if (app.modalMode === 'hidden') {
        $('#modal').hidden = true;
        $('#btn-modal-restore').hidden = false;
      } else {
        showChoiceModal(g);
      }
      $('#wait-hint').hidden = true;
      setStatusBanner(false);
    } else {
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
      setStatusBanner(true, `${cur?.name || ''} が移動中`, cur?.color);
    } else {
      setStatusBanner(false);
    }
  } else if (app.hideDiceResult) {
    setStatusBanner(true, `${cur?.name || ''} がサイコロ中`, cur?.color);
  }

  if (g.phase === 'gameover') {
    showWinner(g);
  }

  renderStockPanel(g);
  updateInspectPanel();
  maybeYourTurnChime();
  announceNewLogs(g);
  // ログ再フラッシュでホスト／次手番が止まるのを防ぐ
  if (reconcileStaleEventFlash(g)) {
    const canRollNow = !app.busy && !isEventUiBlocking()
      && g.phase === 'await_roll' && humanTurn && !cur?.resting;
    if (canRollNow) {
      $('#btn-roll').disabled = false;
      $('#btn-roll').textContent = 'サイコロを振る';
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
    case 'five_buy': return '5倍買いを検討中';
    case 'raise_funds': return '資金調達中（株・物件の売却）';
    case 'stock': return (pend.bankVisit || pend.bankPass)
      ? (pend.resumeMove ? '銀行通過の株購入中' : '銀行で株購入中')
      : '株を取引中';
    case 'scratch': return 'イベント表をスクラッチ中';
    case 'minigame': return `ミニゲーム「${pend.label || ''}」中`;
    case 'level_up': return '昇進を祝っている';
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
  app.lastSeenLogKey = logKey(g.logs[0]);

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
  if (l.kind === 'dice' && !/もう一回|方面へ/.test(l.text)) return null;

  const kind = l.kind || 'info';
  if (!BANNER_KINDS.has(kind) && !(kind === 'dice' && /もう一回/.test(l.text))) return null;

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
    detail = /入手/.test(l.text) ? `${player?.name || ''} がマークを入手 → イベント表` : l.text;
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
    title = /購入/.test(l.text) ? '購入！' : (/増資/.test(l.text) ? '増資！' : (/5倍/.test(l.text) ? '5倍買い！' : 'お店'));
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
  } else if (kind === 'dice' && /もう一回/.test(l.text)) {
    kicker = mine ? 'もう一回！' : `${player?.name || ''} にもう一回`;
    title = 'サイコロ再挑戦';
    detail = l.text;
  } else {
    return null;
  }

  // ログ本文の当事者を優先（ゲストで actionActorId が古いと確認担当がズレて詰まる）
  const actorId = player?.id ?? app.actionActorId ?? null;

  return {
    kicker,
    title,
    detail,
    kind,
    color: player?.color || '#ffe08a',
    mine: !!mine,
    actorId,
  };
}

function enqueueBanner(payload) {
  if (!payload?.title) return;
  const visual = resolveEventVisual(payload);
  const actorId = payload.actorId != null ? payload.actorId : app.actionActorId;
  pushEventStamp({ ...payload, visual, actorId });
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
  const reader = app.game.players[app.eventFlashReaderId];
  if (!reader) {
    if (app.mode === 'local' || app.mode === 'host') return true;
    return isMyTurn();
  }
  if (reader.isCPU) return false; // NPCタイマーが force で閉じる
  if (app.mode === 'local') return true;
  if (app.mode === 'host') return reader.id === app.localSeat || reader.peerId === app.net?.peerId || reader.id === 0;
  if (app.mode === 'guest') return reader.id === app.localSeat || reader.peerId === app.net?.peerId;
  return false;
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
  if (copy.se === 'gain' || copy.se === 'invest' || copy.se === 'impact') {
    audio.sfx.cashGain(copy.se === 'impact' ? Math.max(2, tier) : tier);
  } else {
    audio.sfx.cashLoss(tier);
  }

  $('#event-feed-wrap')?.classList.remove('feed-collapsed');

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

  // フィードも開いて出来事を追えるようにする
  $('#event-feed-wrap')?.classList.remove('feed-collapsed');
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
    app.net.sendToHost({ type: 'event_flash_dismiss', seat: app.localSeat });
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
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
      e.preventDefault();
      dismissEventFlash();
    }
  });
}

/** 左上フィードへ即時スタンプ追加（上→下・さかのぼり可） */
function pushEventStamp({ kicker, title, detail, kind, color, mine, visual }) {
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
      const area = AREA_META[sq.area]?.name || `A${sq.area}`;
      return { sq, rem, maxInv, owned, total, multi, pct, area };
    };

    title.textContent = '好きな店へ増資';
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
      panel.innerHTML = `
        <p class="modal-lead">選択中: <strong>${escapeHtml(m.sq.label)}</strong></p>
        <p>買い物料 ${calcToll(g, m.sq).toLocaleString()}G / 増資残り <strong>${rem.toLocaleString()}G</strong></p>
        <p class="hint">独占率 ${m.owned}/${m.total}（${m.pct}%）→ 上限倍率×${m.multi}（上限 ${m.maxInv.toLocaleString()}G）</p>
        <label class="field">増資額 <input type="number" id="m-amt" min="0" max="${rem}" value="${Math.min(rem, 100)}" ${rem <= 0 ? 'disabled' : ''} /></label>
        <div class="modal-actions">
          <button class="btn primary" id="m-inv" ${rem <= 0 ? 'disabled' : ''}>${rem <= 0 ? '増資上限です' : '増資する'}</button>
        </div>`;
      $('#m-inv').onclick = () => {
        const amount = Number($('#m-amt').value) || 0;
        hideModal();
        sendAction({ type: 'choice', choice: { action: 'invest', shopId: selectedId, amount } });
      };
    };

    body.innerHTML = `
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
      return `<div class="raise-row" style="--ac:${g.areas[area].color}">
        <span>A${area} ${escapeHtml(g.areas[area].name)} ×${have}（${price}G）</span>
        <label class="field tiny">枚数
          <input type="number" min="1" max="${have}" value="${Math.min(have, Math.max(1, Math.ceil(short / Math.max(1, price))))}" data-sell-stock="${area}" />
        </label>
        <button type="button" class="btn tiny" data-do-sell-stock="${area}">売る</button>
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
    const canExec = canContinue && pend.resume && ['five_buy', 'buy_shop', 'invest'].includes(pend.resume.type);
    const execLabel = {
      five_buy: '調達完了 — 5倍買いする',
      buy_shop: '調達完了 — 購入する',
      invest: '調達完了 — 増資する',
    }[pend.resume?.type] || '調達完了 — 実行する';
    body.innerHTML = `
      <p class="modal-lead">${reasonLabel}</p>
      <p>所持金 <strong style="color:${(p?.cash || 0) < 0 ? '#ff8a80' : 'var(--gold)'}">${Number(p?.cash || 0).toLocaleString()}G</strong>
        ／ 目標 <strong>${target.toLocaleString()}G</strong>
        ${short > 0 ? `（あと ${short.toLocaleString()}G）` : '（達成）'}</p>
      <p class="hint">自動では売りません。株や物件を自分で選んで売却してください。</p>
      <div class="raise-section"><h4>株</h4>${stockRows || '<p class="hint">売却できる株がありません</p>'}</div>
      <div class="raise-section"><h4>物件（半額売却）</h4>${shopRows || '<p class="hint">売却できる物件がありません</p>'}</div>
      <div class="modal-actions">
        <button class="btn primary" id="m-raise-go" ${canContinue ? '' : 'disabled'}>
          ${canExec ? execLabel : '調達完了'}
        </button>
        <button class="btn ghost" id="m-raise-cancel">やめる（ターン終了）</button>
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
    body.querySelectorAll('[data-do-sell-shop]').forEach((btn) => {
      btn.onclick = () => {
        sendAction({ type: 'choice', choice: { action: 'sell_shop', shopId: Number(btn.dataset.doSellShop) } });
      };
    });
    $('#m-raise-go').onclick = () => {
      if (!canContinue) return;
      hideModal();
      sendAction({ type: 'choice', choice: { action: 'continue', execute: !!canExec } });
    };
    $('#m-raise-cancel').onclick = () => {
      hideModal();
      sendAction({ type: 'choice', choice: { action: 'cancel' } });
    };
    $('#m-raise-bankrupt').onclick = () => {
      if (!confirm('破産すると店も株も失います。よろしいですか？')) return;
      hideModal();
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
        <p class="hint">賞金は昇進後レベルが高いほど増えます</p>
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
    // 盤面の店にエリア番号を出し、ホバー/選択でハイライト
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
      <p class="hint">1種類だけ選べます。枚数は下の入力欄で指定（所持金 ${Number(p?.cash || 0).toLocaleString()}G）。カードに触れると盤面のエリア店が光ります。</p>
      <div class="stock-grid">${cards}</div>
      <div id="stock-buy-panel" class="stock-buy-panel" hidden>
        <label class="field">枚数 <input type="number" id="m-stock-count" min="1" value="1" /></label>
        <button class="btn primary" id="m-stock-confirm">この枚数で買う</button>
        ${broker ? '<button class="btn ghost" id="m-stock-sell" hidden>この枚数で売る</button>' : ''}
      </div>`;
    $('#btn-end-choice').hidden = true;
    $('#btn-skip-choice').hidden = false;
    $('#btn-skip-choice').textContent = pend.resumeMove
      ? '買わずに進む方向を選ぶ'
      : (broker ? '買わずに終了' : '買わずに終了');

    let selected = null;
    bindAreaHighlight(body);
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
            }
          } else {
            sellBtn.hidden = true;
          }
        }
      };
    });
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
    const legend = GROUP_COLORS.map((c, i) =>
      `<span class="scratch-legend" style="--sc:${c}">${COLOR_LABELS[i]}</span>`
    ).join('');
    const cells = table.cells.map((c) => {
      if (c.scratched) {
        const scratcher = c.scratchedBy != null ? g.players[c.scratchedBy] : null;
        const pc = scratcher?.color || GROUP_COLORS[c.color] || '#888';
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
      <p class="hint">マスを1つ選んでめくります。同じ色が縦・横・斜めに隣接3つ以上で<strong>${MATCH_BONUS_PER}G×枚数</strong></p>
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
    } else {
      body.innerHTML = `
        <p class="modal-lead">スロットを回そう！</p>
        <p class="hint">3つ揃いでジャックポット。2つ揃いでも報酬。外れても全員に参加賞。</p>
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
  $('#btn-again').onclick = () => location.reload();
  audio.sfx.win();
}

function renderResultsBody(results) {
  const body = $('#results-body');
  if (!body) return;
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
      <div class="results-total">${safeTotal.toLocaleString()}G</div>
      <div class="results-bar-wrap">
        <div class="results-bar" style="--bar-w:${barPct}%">
          <i class="seg-cash" style="width:${cashPct}%"></i>
          <i class="seg-shop" style="width:${shopPct}%"></i>
          <i class="seg-stock" style="width:${stockPct}%"></i>
        </div>
        <div class="results-legend">
          <span><i class="lg-cash"></i>現金 ${Math.max(0, cash).toLocaleString()}G</span>
          <span><i class="lg-shop"></i>お店 ${shopAsset.toLocaleString()}G</span>
          <span><i class="lg-stock"></i>株 ${stockAsset.toLocaleString()}G</span>
        </div>
      </div>
    </article>`;
  }).join('');

  const awardsHtml = results.awards.length
    ? results.awards.map((a, i) => `<article class="results-award" style="--i:${i}">
        <div class="results-award-title">${escapeHtml(a.title)}</div>
        <div class="results-award-who" style="color:${escapeHtml(a.playerColor)}">${escapeHtml(a.playerName)}</div>
        <div class="results-award-val">${escapeHtml(a.desc)} · ${escapeHtml(a.valueLabel)}</div>
      </article>`).join('')
    : '<p class="results-award-val">特賞なし</p>';

  body.innerHTML = `
    <section>
      <h3 class="results-section-title">RANKING</h3>
      <div class="results-ranking">${rankingHtml}</div>
    </section>
    <section>
      <h3 class="results-section-title">SPECIAL AWARDS</h3>
      <div class="results-awards">${awardsHtml}</div>
    </section>
  `;
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
        ${held.map((area) => {
          const meta = g.areas[area];
          const have = me.stocks[area] || 0;
          const price = meta.stockPrice;
          return `<div class="sell-row" style="--ac:${meta.color}" data-hold-area="${area}">
            <span class="sell-label">A${area} ${escapeHtml(meta.name)} <small>${price}G ×${have}</small></span>
            <label class="field tiny">枚数
              <input type="number" min="1" max="${have}" value="${Math.min(have, 10)}" data-sell-count="${area}" />
            </label>
            <button type="button" class="btn tiny" data-turn-sell="${area}">売る</button>
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
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// boot
bindVolumeUI();
bindSideChrome();
bindTitle();
bindEventFlashControls();
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
