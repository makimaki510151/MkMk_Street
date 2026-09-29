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
  cpuAct,
  currentPlayer,
  getPlayerAssets,
  calcToll,
  getRemainingInvest,
  getNode,
  PLAYER_COLORS,
} from './engine.js';
import { AREA_META, SUIT_LABELS } from './board.js';
import { GROUP_COLORS, TABLE_SIZE, COLOR_LABELS, MATCH_BONUS_PER } from './eventTable.js';
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
  bannerQueue: [],
  bannerShowing: false,
  lastTurnKey: null,
  modalMode: 'center', // center | docked | hidden
  modalActive: false,
  inspectedId: null,
  restSkipTimer: null,
};

const BANNER_KINDS = new Set(['event', 'mark', 'toll', 'level', 'shop', 'win', 'system']);

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

function bindVolumeUI() {
  const v = audio.getVolume();
  $('#vol-master').value = v.master;
  $('#vol-bgm').value = v.bgm;
  $('#vol-se').value = v.se;
  $('#btn-mute').textContent = v.muted ? '🔇' : '🔊';

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
    $('#btn-mute').textContent = muted ? '🔇' : '🔊';
    unlock();
  };
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
  $('#btn-join').onclick = () => { audio.sfx.click(); openLobby('guest'); };
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

async function openLobby(role) {
  app.mode = role;
  showScreen('screen-lobby');
  $('#lobby-role').textContent = role === 'host' ? 'ホスト（部屋を作る）' : 'ゲスト（部屋に入る）';
  $('#lobby-room-wrap').hidden = role === 'host';
  $('#lobby-host-tools').hidden = role !== 'host';
  $('#btn-lobby-start').hidden = role !== 'host';
  $('#btn-add-cpu').hidden = role !== 'host';
  $('#lobby-code-display').textContent = '------';
  $('#lobby-players').innerHTML = '';
  setStatus(role === 'host' ? '「接続」で部屋を開きます' : '部屋コードを入れて「接続」');

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
        app.net.sendToHost({ type: 'hello', name, peerId: info.peerId });
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
    if (data.type === 'action') {
      handleHostAction(from, data);
      return;
    }
    if (data.type === 'peer_left' && !app.game) {
      app.lobbyPlayers = app.lobbyPlayers.filter((p) => p.peerId !== data.peerId);
      renderLobbyPlayers();
      app.net.broadcast({ type: 'lobby_sync', players: app.lobbyPlayers });
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
    if (data.type === 'game_start') {
      app.game = restoreState(data.state);
      const myPeer = app.net.peerId;
      app.localSeat = app.game.players.findIndex((p) => p.peerId === myPeer);
      if (app.localSeat < 0) app.localSeat = 0;
      enterGame();
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
  if (data.kind === 'banner') {
    enqueueBanner(data.payload || data);
  }
  if (data.kind === 'yourTurn' && data.seat === app.localSeat) audio.sfx.yourTurn();
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
  if (demo === 'scratch') {
    const mark = app.game.map.find((n) => n.type === 'mark');
    if (!mark) return;
    p.pos = mark.id;
    app.game.phase = 'moving';
    app.game.move = { stepsLeft: 0, path: [mark.id], passedBank: false, startPos: app.game.startId };
    advanceMove(app.game);
    refreshGameUI();
  }
}

function enterGame() {
  showScreen('screen-game');
  audio.resume();
  audio.startBgm();
  app.hideDiceResult = false;
  app.lastSeenLogKey = null;
  app.bannerQueue = [];
  app.bannerShowing = false;
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
  app.lastTurnKey = null;
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
  const sq = app.inspectedId != null ? getNode(app.game, app.inspectedId) : null;
  if (!sq) {
    el.innerHTML = '<strong>マス情報</strong><span class="inspect-sub">マスをクリックして詳細を固定表示</span>';
    return;
  }
  el.innerHTML = `<strong>${escapeHtml(sq.label || sq.type)}</strong><span class="inspect-sub">${escapeHtml(shopTooltip(app.game, sq))}</span>`;
}

/** 休み中は自動スキップ（人間がNPCのダイスを振らされるのを防ぐ） */
function maybeAutoSkipRest() {
  clearTimeout(app.restSkipTimer);
  if (!app.game || app.busy || app.mode === 'guest') return;
  if (app.game.phase !== 'await_roll') return;
  const cur = currentPlayer(app.game);
  if (!cur?.resting || cur.bankrupt) return;

  // 人間プレイヤーが休みのときも自動で進める
  app.restSkipTimer = setTimeout(async () => {
    if (!app.game || app.busy || app.game.phase !== 'await_roll') return;
    const p = currentPlayer(app.game);
    if (!p?.resting) return;
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
    scheduleCpu();
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
  $('#btn-modal-dock').onclick = () => {
    app.modalMode = app.modalMode === 'docked' ? 'center' : 'docked';
    applyModalMode();
    audio.sfx.click();
  };
  $('#btn-modal-hide').onclick = () => {
    app.modalMode = 'hidden';
    applyModalMode();
    audio.sfx.click();
  };
  $('#btn-modal-restore').onclick = () => {
    app.modalMode = 'docked';
    applyModalMode();
    if (app.modalActive && app.game) showChoiceModal(app.game);
    audio.sfx.click();
  };
}

function applyModalMode() {
  const modal = $('#modal');
  const restore = $('#btn-modal-restore');
  modal.classList.toggle('docked', app.modalMode === 'docked');
  if (app.modalMode === 'hidden') {
    modal.hidden = true;
    restore.hidden = !app.modalActive;
  } else if (app.modalActive) {
    modal.hidden = false;
    restore.hidden = true;
  } else {
    restore.hidden = true;
  }
  $('#btn-modal-dock').textContent = app.modalMode === 'docked' ? '中央へ' : '端へ';
}

function sendAction(action) {
  if (app.mode === 'guest') {
    app.net.sendToHost({ type: 'action', action, seat: app.localSeat });
    return;
  }
  applyLocalAction(action);
}

async function applyLocalAction(action) {
  if (!app.game || app.busy) return;

  if (action.type === 'roll') {
    const cur = currentPlayer(app.game);
    if (app.mode === 'local') {
      if (cur.isCPU) return;
    } else if (!isMyTurn()) {
      return toast('あなたのターンではありません');
    }
    if (app.game.phase !== 'await_roll') return;
    const result = rollDice(app.game);
    if (!result.ok) return toast(result.error || '失敗');
    if (result.state) app.game = restoreState(result.state);
    if (result.skipped) {
      syncState();
      refreshGameUI();
      scheduleCpu();
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

    if (pend.type === 'fork') {
      await resolveForkChoice(Number(action.choice.nextId));
      return;
    }

    const result = applyChoice(app.game, action.choice);
    if (!result.ok) return toast(result.error || '失敗');
    if (result.state) app.game = restoreState(result.state);
    if (action.choice.action === 'buy' && pend.type === 'buy_shop') audio.sfx.buy();
    if (pend.type === 'five_buy' && action.choice.action === 'buy') audio.sfx.buy();
    syncState();
    refreshGameUI();
    scheduleCpu();
    return;
  }

  if (action.type === 'sell') {
    const result = preTurnSell(app.game, action.playerId, action.area, action.count);
    if (result?.state) app.game = restoreState(result.state);
    syncState();
    refreshGameUI();
  }
}

async function resolveForkChoice(nextId) {
  const pid = app.game.currentPlayerIdx;
  const from = app.game.players[pid].pos;
  const result = chooseFork(app.game, nextId);
  if (!result.ok) return toast(result.error || '失敗');
  if (result.state) app.game = restoreState(result.state);
  hideModal();
  app.busy = true;
  app.renderer?.animateToken(pid, from, nextId, 400);
  audio.sfx.step();
  syncState({ anim: { pid, from, to: nextId } });
  refreshGameUI();
  await wait(420);
  await continueAdvancing();
  app.busy = false;
  refreshGameUI();
  scheduleCpu();
}

async function runDiceAndMove(face) {
  app.busy = true;
  app.hideDiceResult = true;
  $('#btn-roll').disabled = true;
  broadcastFx({ kind: 'dice', face });
  await playDiceOverlay(face);
  app.hideDiceResult = false;
  const roller = currentPlayer(app.game);
  if (roller && app.game) {
    app.game.logs.unshift({ text: `${roller.name} のサイコロ → ${face}`, kind: 'dice', t: Date.now() });
    if (app.game.logs.length > 80) app.game.logs.length = 80;
  }
  syncState({ hideDice: false });
  refreshGameUI();
  if (roller) {
    enqueueBanner({
      kicker: `${roller.name} のサイコロ`,
      title: `${face}`,
      detail: `${face} マス進みます`,
      kind: 'dice',
      color: roller.color,
    });
    // バナー表示中も進行が止まらないよう、短く待ってから移動
    await wait(480);
  }
  await continueAdvancing();
  app.busy = false;
  refreshGameUI();
  scheduleCpu();
}

async function continueAdvancing() {
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

    if (result.done) {
      onLandingSfx();
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
}

async function handleHostAction(from, data) {
  if (app.busy) {
    app.net.sendTo(from, { type: 'reject', reason: '演出中です' });
    return;
  }
  const action = data.action;
  const seat = app.game.players.findIndex((p) => p.peerId === from);
  if (seat < 0) return;

  if (action.type === 'roll') {
    if (app.game.currentPlayerIdx !== seat || app.game.phase !== 'await_roll') {
      app.net.sendTo(from, { type: 'reject', reason: 'あなたのターンではありません' });
      return;
    }
    const result = rollDice(app.game);
    if (result.state) app.game = restoreState(result.state);
    if (result.skipped) {
      syncState();
      refreshGameUI();
      scheduleCpu();
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
    syncState();
    refreshGameUI();
    scheduleCpu();
    return;
  }

  if (action.type === 'sell') {
    const result = preTurnSell(app.game, seat, action.area, action.count);
    if (result.state) app.game = restoreState(result.state);
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

function scheduleCpu() {
  clearTimeout(app.cpuTimer);
  if (!app.game || app.game.phase === 'gameover' || app.busy) return;
  if (app.mode === 'guest') return;
  const cur = currentPlayer(app.game);
  if (!cur?.isCPU) return;

  app.cpuTimer = setTimeout(async () => {
    if (app.busy || !app.game) return;
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
        scheduleCpu();
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
        app.renderer?.animateToken(pid, result.from, result.to, 400);
        audio.sfx.step();
        syncState({ anim: { pid, from: result.from, to: result.to } });
        refreshGameUI();
        await wait(420);
        await continueAdvancing();
        app.busy = false;
      }
      refreshGameUI();
      scheduleCpu();
      return;
    }

    if (phase === 'await_choice') {
      const result = cpuAct(app.game);
      if (result?.state) app.game = restoreState(result.state);
      syncState();
      refreshGameUI();
      scheduleCpu();
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

function refreshGameUI() {
  const g = app.game;
  if (!g) return;

  const box = $('#players-panel');
  box.innerHTML = g.players.map((p) => {
    const a = getPlayerAssets(g, p);
    const marks = SUIT_LABELS.map((s, i) => `<span class="mark ${p.marks[i] ? 'on' : ''}">${s}</span>`).join('');
    const active = g.currentPlayerIdx === p.id ? 'active' : '';
    const me = p.id === app.localSeat ? 'me' : '';
    const status = [
      p.resting ? '<span class="pc-flag">休み</span>' : '',
      p.shopsClosed ? '<span class="pc-flag closed">店休</span>' : '',
    ].join('');
    return `
      <div class="player-card ${active} ${me}" style="--pc:${p.color}">
        <div class="pc-head"><span class="pc-dot"></span><strong>${p.name}</strong><span class="pc-lv">Lv.${p.level}</span></div>
        <div class="pc-money">${a.cash.toLocaleString()}G</div>
        <div class="pc-assets">総資産 ${a.total.toLocaleString()}G</div>
        <div class="pc-sub">店 ${a.shopAsset.toLocaleString()} / 株 ${a.stockAsset.toLocaleString()}</div>
        <div class="pc-marks">${marks}${status}</div>
        ${p.bankrupt ? '<div class="pc-bust">破産</div>' : ''}
      </div>
    `;
  }).join('');

  $('#goal-chip').textContent = `目標 ${g.goal.toLocaleString()}G`;
  $('#turn-chip').textContent = `ターン ${g.turn}`;
  const cur = currentPlayer(g);
  $('#phase-chip').textContent = phaseLabel(g);
  $('#current-name').textContent = cur ? `${cur.name} の番` : '';
  $('#current-name').style.color = cur?.color || '#fff';

  const logLines = g.logs.slice(0, 24).map((l) => {
    let text = l.text;
    if (app.hideDiceResult && l.kind === 'dice' && /サイコロ\s*→\s*\d/.test(text)) {
      text = text.replace(/サイコロ\s*→\s*\d+/, 'サイコロ → ？');
    }
    return `<div class="log-line ${l.kind || ''}">${escapeHtml(text)}</div>`;
  });
  $('#log').innerHTML = logLines.join('');

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
  const canRoll = !app.busy && g.phase === 'await_roll' && humanTurn && !cur?.resting;
  $('#btn-roll').disabled = !canRoll;
  $('#btn-roll').textContent = app.busy
    ? '演出中…'
    : (cur?.resting && humanTurn
      ? '休憩中（自動スキップ）…'
      : (canRoll ? 'サイコロを振る' : (cur?.isCPU ? 'CPUの手番…' : '待機中…')));

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
  maybeAutoSkipRest();
}

function pendingStatusLabel(pend) {
  switch (pend?.type) {
    case 'fork': return '分岐を選択中';
    case 'buy_shop': return 'お店を購入するか選択中';
    case 'invest': return '増資を検討中';
    case 'five_buy': return '5倍買いを検討中';
    case 'stock': return pend.bankPass ? '銀行通過の株購入中' : '株を取引中';
    case 'scratch': return 'イベント表をスクラッチ中';
    case 'level_up': return '昇進を祝っている';
    default: return '選択中';
  }
}

function setStatusBanner(show, text = '', color = '') {
  const el = $('#status-banner');
  const tx = $('#status-banner-text');
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
    kicker = mine ? 'マーク入手！' : `${player?.name || ''} がマーク入手`;
    const m = l.text.match(/[♠♥♦♣]/);
    title = m ? m[0] : 'マーク';
    detail = l.text;
  } else if (kind === 'toll') {
    kicker = '買い物料';
    title = '支払い発生';
    detail = l.text;
  } else if (kind === 'level') {
    kicker = mine ? '昇進！' : `${player?.name || ''} が昇進`;
    title = 'レベルアップ';
    detail = l.text;
  } else if (kind === 'shop') {
    kicker = mine ? 'お店' : `${player?.name || ''} のお店`;
    title = /購入/.test(l.text) ? '購入！' : (/増資/.test(l.text) ? '増資！' : (/5倍/.test(l.text) ? '5倍買い！' : 'お店'));
    detail = l.text;
  } else if (kind === 'event') {
    if (/店休/.test(l.text)) {
      kicker = mine ? 'ステータス' : `${player?.name || ''} の状況`;
      title = 'お店が休み';
      detail = l.text;
    } else if (/スクラッチ\s*→/.test(l.text)) {
      kicker = mine ? 'スクラッチ' : `${player?.name || ''} のスクラッチ`;
      title = 'スクラッチ結果';
      detail = l.text.replace(/^.*?スクラッチ\s*→\s*/, '');
    } else if (/イベント表をスクラッチ/.test(l.text)) {
      kicker = mine ? 'マーク停止' : `${player?.name || ''} がマーク停止`;
      title = 'イベント表オープン';
      detail = l.text;
    } else if (/チャンス|イベント！/.test(l.text)) {
      kicker = mine ? 'イベント発生' : `${player?.name || '誰か'} のイベント`;
      title = l.text.replace(/（.*）/, '').replace(/^(チャンス！|イベント！)\s*/, '') || 'イベント';
      detail = (l.text.match(/（(.+)）/) || [])[1] || l.text;
    } else if (/ラッキー/.test(l.text)) {
      kicker = mine ? 'ラッキー！' : `${player?.name || ''} がラッキー`;
      title = 'ラッキーステータス';
      detail = l.text;
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

  return {
    kicker,
    title,
    detail,
    kind,
    color: player?.color || '#ffe08a',
    mine: !!mine,
  };
}

function enqueueBanner(payload) {
  if (!payload?.title) return;
  // 各クライアントがログ差分から表示（二重配信しない）
  app.bannerQueue.push(payload);
  pumpBannerQueue();
}

async function pumpBannerQueue() {
  if (app.bannerShowing) return;
  const next = app.bannerQueue.shift();
  if (!next) return;
  app.bannerShowing = true;
  await showEventBanner(next);
  app.bannerShowing = false;
  if (app.bannerQueue.length) pumpBannerQueue();
}

function showEventBanner({ kicker, title, detail, kind, color, mine }) {
  const el = $('#event-banner');
  if (!el) return Promise.resolve();
  $('#eb-kicker').textContent = kicker || '';
  $('#eb-title').textContent = title || '';
  $('#eb-detail').textContent = detail || '';
  el.dataset.kind = kind || 'info';
  el.dataset.mine = mine ? '1' : '0';
  el.style.setProperty('--eb', color || '#ffe08a');
  el.hidden = false;
  el.classList.remove('out');
  el.classList.add('in');

  // SE は着地側と二重にならないよう、バナー固有のものだけ
  if (kind === 'shop' || kind === 'level' || kind === 'mark' || kind === 'event') audio.sfx.buy();
  else if (kind === 'dice') { /* 出目SEはオーバーレイ側 */ }

  const hold = kind === 'win' ? 2200 : (mine ? 2000 : 1700);
  return wait(hold).then(() => {
    el.classList.remove('in');
    el.classList.add('out');
    return wait(280).then(() => {
      el.hidden = true;
      el.classList.remove('out');
    });
  });
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
  if (app.modalMode === 'hidden') app.modalMode = 'docked';
  modal.hidden = false;
  applyModalMode();
  $('#btn-end-choice').hidden = true;
  $('#btn-skip-choice').hidden = false;
  $('#btn-skip-choice').textContent = 'やめる';
  $('#modal-card').classList.remove('wide');

  if (pend.type === 'fork') {
    title.textContent = `どちらへ進む？（残り${pend.stepsLeft}マス）`;
    body.innerHTML = `
      <p class="hint">マスをクリック／下のボタン。「隠す」「端へ」で盤面を確認できます</p>
      <div class="modal-actions fork-actions">
        ${pend.options.map((o) => `
          <button class="btn primary fork-btn" data-next="${o.id}">
            ${o.label}<br><small>${o.dest}</small>
          </button>
        `).join('')}
      </div>`;
    $('#btn-skip-choice').hidden = true;
    body.querySelectorAll('[data-next]').forEach((btn) => {
      btn.onclick = () => {
        hideModal();
        sendAction({ type: 'choice', choice: { nextId: Number(btn.dataset.next) } });
      };
    });
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
    const sq = getNode(g, pend.shopId);
    const rem = getRemainingInvest(g, sq);
    title.textContent = '増資する？';
    body.innerHTML = `
      <p class="modal-lead"><strong>${sq.label}</strong></p>
      <p>買い物料 ${calcToll(g, sq).toLocaleString()}G / 増資残り ${rem.toLocaleString()}G</p>
      <label class="field">増資額 <input type="number" id="m-amt" min="0" max="${rem}" value="${Math.min(rem, 100)}" /></label>
      <div class="modal-actions">
        <button class="btn primary" id="m-inv">増資する</button>
      </div>`;
    $('#m-inv').onclick = () => {
      const amount = Number($('#m-amt').value) || 0;
      hideModal();
      sendAction({ type: 'choice', choice: { action: 'invest', amount } });
    };
    return;
  }

  if (pend.type === 'five_buy') {
    const sq = getNode(g, pend.shopId);
    const owner = g.players[sq.owner];
    title.textContent = '5倍買い？';
    body.innerHTML = `
      <p class="modal-lead"><strong>${sq.label}</strong>（${owner?.name || ''}の店）</p>
      <p>価格 <strong>${pend.price.toLocaleString()}G</strong>（店価×5）</p>
      <div class="modal-actions">
        <button class="btn danger" id="m-five">5倍買いする</button>
      </div>`;
    $('#m-five').onclick = () => {
      hideModal();
      sendAction({ type: 'choice', choice: { action: 'buy' } });
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
        <p class="levelup-bonus">昇進賞金 <strong>+${Number(pend.bonus || 0).toLocaleString()}G</strong></p>
        <p class="hint">マークを揃えて銀行へ到達！</p>
      </div>
      <div class="modal-actions">
        <button class="btn primary large" id="m-levelup">お祝いする</button>
      </div>`;
    audio.sfx.levelUp?.() || audio.sfx.win();
    enqueueBanner({
      kicker: '昇進！',
      title: `Lv.${pend.to}`,
      detail: `${p?.name || ''} +${pend.bonus}G`,
      kind: 'level',
      color: p?.color,
      mine: true,
    });
    $('#m-levelup').onclick = () => {
      hideModal();
      sendAction({ type: 'choice', choice: { action: 'celebrate' } });
    };
    return;
  }

  if (pend.type === 'stock') {
    const pass = !!pend.bankPass;
    title.textContent = pass
      ? '銀行通過 — 株を1種類だけ購入'
      : (pend.atBank ? '銀行 — 株取引' : '証券マス — 株取引');
    const rows = Object.keys(g.areas).map((a) => {
      const area = Number(a);
      const meta = g.areas[area];
      const have = currentPlayer(g).stocks[area] || 0;
      return `<div class="stock-row" style="--ac:${meta.color}">
        <span class="sr-name">A${area} ${meta.name}</span>
        <span class="sr-price">${meta.stockPrice}G</span>
        <span class="sr-have">持株 ${have}</span>
        <button class="btn tiny" data-buy="${area}">買う</button>
        ${pass ? '' : `<button class="btn tiny ghost" data-sell="${area}" ${have ? '' : 'disabled'}>売る</button>`}
      </div>`;
    }).join('');
    body.innerHTML = `<div class="stock-list">${rows}</div>
      <p class="hint">${pass ? '通過ボーナス：好きなエリアを1種類だけ購入できます（見送り可）' : '枚数はダイアログで指定。盤面確認は「隠す／端へ」'}</p>`;
    $('#btn-end-choice').hidden = false;
    $('#btn-skip-choice').hidden = !pass;
    if (pass) $('#btn-skip-choice').textContent = '買わずに進む';

    body.querySelectorAll('[data-buy]').forEach((btn) => {
      btn.onclick = () => {
        const area = Number(btn.dataset.buy);
        const count = Number(prompt('何枚買いますか？（1〜99）', pass ? '10' : '10')) || 0;
        if (count > 0) sendAction({ type: 'choice', choice: { action: 'buy', area, count } });
      };
    });
    body.querySelectorAll('[data-sell]').forEach((btn) => {
      btn.onclick = () => {
        const area = Number(btn.dataset.sell);
        const count = Number(prompt('何枚売りますか？', '10')) || 0;
        if (count > 0) sendAction({ type: 'choice', choice: { action: 'sell', area, count } });
      };
    });
    return;
  }

  if (pend.type === 'scratch') {
    const p = g.players[pend.playerId];
    const table = p?.eventTable;
    title.textContent = 'イベント表スクラッチ（1〜200）';
    $('#btn-skip-choice').hidden = true;
    $('#modal-card').classList.add('wide');
    if (!table) {
      body.innerHTML = '<p class="hint">イベント表がありません</p>';
      return;
    }
    const legend = GROUP_COLORS.map((c, i) =>
      `<span class="scratch-legend" style="--sc:${c}">${COLOR_LABELS[i]}</span>`
    ).join('');
    const cells = table.cells.map((c) => {
      const color = GROUP_COLORS[c.color] || GROUP_COLORS[c.group] || '#888';
      if (c.scratched) {
        return `<button type="button" class="scratch-cell done" style="--sc:${color}" disabled title="${c.label}">
          <small>#${c.eventId}</small><span>${c.shortLabel || c.label}</span>
        </button>`;
      }
      return `<button type="button" class="scratch-cell sealed" data-cell="${c.id}" style="--sc:${color}" aria-label="イベントマス">?</button>`;
    }).join('');
    body.innerHTML = `
      <p class="hint">1マススクラッチ。縦・横・斜めに同じ色が3つ以上そろうと、その色のプレイヤーに ${MATCH_BONUS_PER}G×数</p>
      <div class="scratch-legends">${legend}</div>
      <div class="scratch-grid" style="--n:${TABLE_SIZE}">${cells}</div>
      <p class="scratch-result" id="scratch-result" hidden></p>
    `;
    body.querySelectorAll('[data-cell]').forEach((btn) => {
      btn.onclick = () => {
        body.querySelectorAll('[data-cell]').forEach((b) => { b.disabled = true; });
        const cellId = Number(btn.dataset.cell);
        const cell = table.cells[cellId];
        btn.classList.remove('sealed');
        btn.classList.add('reveal');
        btn.innerHTML = `<small>#${cell?.eventId ?? ''}</small><span>${cell?.shortLabel || cell?.label || '!'}</span>`;
        const resultEl = $('#scratch-result');
        if (resultEl) {
          resultEl.hidden = false;
          resultEl.textContent = `${cell?.label || ''} をスクラッチ…`;
        }
        audio.sfx.buy();
        hideModal();
        sendAction({ type: 'choice', choice: { action: 'scratch', cellId } });
      };
    });
    return;
  }

  $('#modal-card').classList.remove('wide');
}

function hideModal() {
  app.modalActive = false;
  $('#modal').hidden = true;
  $('#btn-modal-restore').hidden = true;
}

function showWinner(g) {
  const w = g.players[g.winnerId];
  const overlay = $('#winner');
  overlay.hidden = false;
  $('#winner-name').textContent = w ? `${w.name} の勝ち！` : 'ゲーム終了';
  $('#winner-name').style.color = w?.color || '#ffe08a';
  const a = w ? getPlayerAssets(g, w) : { total: 0 };
  $('#winner-sub').textContent = `総資産 ${a.total.toLocaleString()}G`;
  $('#btn-again').onclick = () => location.reload();
  audio.sfx.win();
}

function renderStockPanel(g) {
  const el = $('#stocks-panel');
  el.innerHTML = Object.keys(g.areas).map((a) => {
    const area = Number(a);
    const meta = g.areas[area];
    return `<div class="stock-chip" style="--ac:${meta.color}" title="${meta.name}">
      <b>A${area}</b> ${meta.stockPrice}G
    </div>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// boot
bindVolumeUI();
bindTitle();
showScreen('screen-title');

const field = $('#title-field');
if (field) {
  for (let i = 0; i < 18; i++) {
    const d = document.createElement('span');
    d.className = 'float-coin';
    d.style.setProperty('--x', `${Math.random() * 100}%`);
    d.style.setProperty('--d', `${8 + Math.random() * 10}s`);
    d.style.setProperty('--delay', `${Math.random() * 8}s`);
    d.textContent = ['♠', '♥', '♦', '♣', 'G'][i % 5];
    field.appendChild(d);
  }
}
