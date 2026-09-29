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
import { GROUP_COLORS, TABLE_SIZE } from './eventTable.js';
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
  lastTurnKey: null,
  modalMode: 'center', // center | docked | hidden
  modalActive: false,
};

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
  if (data.kind === 'dice') playDiceOverlay(data.face, true);
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
  const canvas = $('#board');
  app.renderer = createRenderer(canvas);
  app.renderer.resize();
  window.addEventListener('resize', () => app.renderer?.resize());
  app.renderer.startLoop(() => app.game);
  canvas.onclick = (e) => {
    if (!app.game || app.busy) return;
    const hit = app.renderer.hitTest(app.game, e.clientX, e.clientY);
    if (!hit) return;

    if (app.game.phase === 'await_fork' && app.game.pending?.type === 'fork') {
      const mine = app.mode === 'local'
        ? !app.game.players[app.game.pending.playerId]?.isCPU
        : app.game.pending.playerId === app.localSeat;
      if (mine && app.game.pending.options.some((o) => o.id === hit.id)) {
        sendAction({ type: 'choice', choice: { nextId: hit.id } });
        return;
      }
    }

    $('#inspect').textContent = shopTooltip(app.game, hit);
  };
  bindGameControls();
  bindModalTools();
  app.lastTurnKey = null;
  refreshGameUI();
  maybeYourTurnChime();
  scheduleCpu();
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
    syncState();
    refreshGameUI();
    if (result.skipped) {
      scheduleCpu();
      return;
    }
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
  $('#btn-roll').disabled = true;
  broadcastFx({ kind: 'dice', face });
  await playDiceOverlay(face);
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
  overlay.hidden = false;
  overlay.classList.remove('landed');
  label.textContent = 'サイコロ…';
  if (!remote) audio.sfx.dice();

  const start = performance.now();
  while (performance.now() - start < 1100) {
    faceEl.textContent = String(1 + Math.floor(Math.random() * 6));
    await wait(70);
  }
  faceEl.textContent = String(face);
  overlay.classList.add('landed');
  label.textContent = `${face} が出た！`;
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
    syncState();
    refreshGameUI();
    if (!result.skipped) await runDiceAndMove(result.dice);
    else scheduleCpu();
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
      syncState();
      refreshGameUI();
      if (result?.dice) await runDiceAndMove(result.dice);
      else scheduleCpu();
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

  $('#log').innerHTML = g.logs.slice(0, 24).map((l) => `<div class="log-line ${l.kind || ''}">${escapeHtml(l.text)}</div>`).join('');

  const diceEl = $('#dice-face');
  if (g.dice) {
    diceEl.textContent = String(g.dice);
    diceEl.classList.add('pop');
  } else if (!app.busy) {
    diceEl.textContent = '·';
    diceEl.classList.remove('pop');
  }

  const canRoll = !app.busy && g.phase === 'await_roll' && (app.mode === 'local' ? !cur?.isCPU : isMyTurn());
  $('#btn-roll').disabled = !canRoll;
  $('#btn-roll').textContent = app.busy
    ? '演出中…'
    : (canRoll ? 'サイコロを振る' : (cur?.isCPU ? 'CPUの手番…' : '待機中…'));

  if ((g.phase === 'await_choice' || g.phase === 'await_fork') && g.pending && !app.busy) {
    const mine = app.mode === 'local' ? !g.players[g.pending.playerId]?.isCPU : g.pending.playerId === app.localSeat;
    if (mine) {
      app.modalActive = true;
      if (app.modalMode === 'hidden') {
        $('#modal').hidden = true;
        $('#btn-modal-restore').hidden = false;
      } else {
        showChoiceModal(g);
      }
      $('#wait-hint').hidden = true;
    } else {
      app.modalActive = false;
      hideModal();
      $('#wait-hint').hidden = false;
      $('#wait-hint').textContent = `${g.players[g.pending.playerId]?.name || ''} が選択中…`;
    }
  } else if (!app.busy) {
    app.modalActive = false;
    hideModal();
    $('#wait-hint').hidden = true;
    $('#btn-modal-restore').hidden = true;
  }

  if (g.phase === 'gameover') {
    showWinner(g);
  }

  renderStockPanel(g);
  maybeYourTurnChime();
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

  if (pend.type === 'stock') {
    title.textContent = pend.atBank ? '銀行 — 株取引' : '証券マス — 株取引';
    const rows = Object.keys(g.areas).map((a) => {
      const area = Number(a);
      const meta = g.areas[area];
      const have = currentPlayer(g).stocks[area] || 0;
      return `<div class="stock-row" style="--ac:${meta.color}">
        <span class="sr-name">A${area} ${meta.name}</span>
        <span class="sr-price">${meta.stockPrice}G</span>
        <span class="sr-have">持株 ${have}</span>
        <button class="btn tiny" data-buy="${area}">買う</button>
        <button class="btn tiny ghost" data-sell="${area}" ${have ? '' : 'disabled'}>売る</button>
      </div>`;
    }).join('');
    body.innerHTML = `<div class="stock-list">${rows}</div>
      <p class="hint">枚数はダイアログで指定。盤面確認は「隠す／端へ」</p>`;
    $('#btn-end-choice').hidden = false;
    $('#btn-skip-choice').hidden = true;

    body.querySelectorAll('[data-buy]').forEach((btn) => {
      btn.onclick = () => {
        const area = Number(btn.dataset.buy);
        const count = Number(prompt('何枚買いますか？（1〜99）', '10')) || 0;
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
    title.textContent = 'イベント表スクラッチ';
    $('#btn-skip-choice').hidden = true;
    $('#modal-card').classList.add('wide');
    if (!table) {
      body.innerHTML = '<p class="hint">イベント表がありません</p>';
      return;
    }
    const cells = table.cells.map((c) => {
      const color = GROUP_COLORS[c.group] || '#888';
      if (c.scratched) {
        return `<button type="button" class="scratch-cell done" style="--sc:${color}" disabled title="${c.label}">${c.label}</button>`;
      }
      return `<button type="button" class="scratch-cell sealed" data-cell="${c.id}" style="--sc:${color}" aria-label="マス${c.id + 1}">?</button>`;
    }).join('');
    body.innerHTML = `
      <p class="hint">未公開のマスを1つ選んでスクラッチ。縦横が揃うとボーナス！</p>
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
        btn.textContent = cell?.label || '!';
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
