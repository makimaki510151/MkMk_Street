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
};

const BANNER_KINDS = new Set(['event', 'mark', 'toll', 'level', 'shop', 'win', 'system']);

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
  if (typeof rejoinSeat === 'number' && rejoinSeat >= 0 && rejoinSeat < g.players.length) {
    const p = g.players[rejoinSeat];
    if (p && !p.isCPU && p.name === nm && (p.offline || !p.peerId)) return rejoinSeat;
  }
  return g.players.findIndex((p) => !p.isCPU && p.name === nm && (p.offline || !p.peerId));
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
          pl.peerId = data.peerId || from;
          pl.offline = false;
          app.game.logs.unshift({ text: `${pl.name} が再接続`, kind: 'system' });
          if (app.game.logs.length > 30) app.game.logs.length = 30;
          app.net.sendTo(from, {
            type: 'game_rejoin',
            state: serializeState(app.game),
            seat,
          });
          syncState();
          refreshGameUI();
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
      if (seat >= 0) {
        app.game.players[seat].offline = true;
        app.game.players[seat].peerId = null;
        app.game.logs.unshift({
          text: `${app.game.players[seat].name} が切断（同じ名前で再接続できます）`,
          kind: 'system',
        });
        if (app.game.logs.length > 30) app.game.logs.length = 30;
        syncState();
        refreshGameUI();
      }
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
      toast('進行中のゲームがあります。同じ名前で再接続を試してください');
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
  if (data.kind === 'scratchMatch' && data.matches?.length) {
    app.busy = true;
    playScratchMatchReveal(data.matches, data.messages || [], { banner: false }).finally(() => {
      app.busy = false;
      refreshGameUI();
    });
  }
  if (data.kind === 'minigameReveal' && data.reveal) {
    app.busy = true;
    playMinigameReveal(data.reveal).finally(() => {
      app.busy = false;
      refreshGameUI();
    });
  }
  if (data.kind === 'warp' && data.warp) {
    app.busy = true;
    presentWarpFx([data.warp], { remote: true }).finally(() => {
      app.busy = false;
      refreshGameUI();
    });
  }
  if (data.kind === 'banner') {
    enqueueBanner(data.payload || data);
  }
  if (data.kind === 'fiveBuy') audio.sfx.fiveBuy();
  if (data.kind === 'monopoly') {
    audio.sfx.monopoly();
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
    if (result.fiveBuy) {
      audio.sfx.fiveBuy();
      broadcastFx({ kind: 'fiveBuy' });
      enqueueBanner({
        kicker: '衝撃！',
        title: '5倍買い！',
        detail: 'お店を奪取した！',
        kind: 'shop',
        color: currentPlayer(app.game)?.color || '#ffe08a',
        mine: true,
      });
    }
    if (result.monopoly) presentMonopolyFx(result);
    if (result.scratched) {
      await presentScratchMatches(result);
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
      await continueAdvancing();
      app.busy = false;
      refreshGameUI();
    }
    scheduleCpu();
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

    // 銀行通過割込み（昇進→株→方向）
    if (result.bankInterrupt || app.game.phase === 'await_choice') {
      syncState();
      refreshGameUI();
      return;
    }

    if (result.done) {
      onLandingSfx();
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
}

async function presentScratchMatches(result) {
  const matches = result.matches || [];
  if (!matches.length) {
    hideModal();
    return;
  }
  app.busy = true;
  broadcastFx({
    kind: 'scratchMatch',
    matches,
    messages: result.messages || [],
  });
  await playScratchMatchReveal(matches, result.messages || [], { banner: true });
  hideModal();
  app.busy = false;
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
  if (!wasBusy) app.busy = false;
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
  app.busy = false;
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
    if (result.fiveBuy) {
      audio.sfx.fiveBuy();
      broadcastFx({ kind: 'fiveBuy' });
    }
    if (result.monopoly) presentMonopolyFx(result);
    if (result.scratched) {
      await presentScratchMatches(result);
      await presentWarpFx(result.warps);
    }
    if (result.reveal) {
      await presentMinigameResult(result);
    } else if (result.minigame && result.messages) {
      if (result.win) audio.sfx.levelUp();
      else audio.sfx.buy();
      broadcastFx({
        kind: 'banner',
        payload: {
          kicker: 'ミニゲーム',
          title: result.win ? '当たり！' : '結果発表',
          detail: result.messages.join(' / '),
          kind: 'event',
          color: app.game.players[seat]?.color || '#ffe08a',
        },
      });
    }
    syncState();
    refreshGameUI();
    if (result.resumeMove || (app.game.phase === 'moving' && app.game.move)) {
      app.busy = true;
      await continueAdvancing();
      app.busy = false;
      refreshGameUI();
    }
    scheduleCpu();
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
      if (result?.fiveBuy) {
        audio.sfx.fiveBuy();
        broadcastFx({ kind: 'fiveBuy' });
      }
      if (result?.monopoly) presentMonopolyFx(result);
      if (result?.scratched) {
        await presentScratchMatches(result);
        await presentWarpFx(result.warps);
      }
      if (result?.reveal) {
        await presentMinigameResult(result);
      }
      syncState();
      refreshGameUI();
      if (result?.resumeMove || (app.game.phase === 'moving' && app.game.move)) {
        app.busy = true;
        await continueAdvancing();
        app.busy = false;
        refreshGameUI();
      }
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
    const persona = p.isCPU ? getCpuPersonality(p) : null;
    const status = [
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
      <div class="player-card ${active} ${me}" style="--pc:${p.color}">
        <div class="pc-head"><span class="pc-dot"></span><strong>${p.name}</strong><span class="pc-lv">Lv.${p.level}</span></div>
        <div class="pc-money${a.cash < 0 ? ' debt' : ''}">${a.cash.toLocaleString()}G</div>
        <div class="pc-assets">総資産 ${a.total.toLocaleString()}G</div>
        <div class="pc-sub">店 ${a.shopAsset.toLocaleString()} / 株 ${a.stockAsset.toLocaleString()}</div>
        ${stockLine}
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
  pushEventStamp(payload);
}

/** 左上フィードへ即時スタンプ追加（上→下・さかのぼり可） */
function pushEventStamp({ kicker, title, detail, kind, color, mine }) {
  const feed = $('#event-feed');
  if (!feed) return;

  const stamp = document.createElement('article');
  stamp.className = 'event-stamp';
  stamp.dataset.kind = kind || 'info';
  stamp.dataset.mine = mine ? '1' : '0';
  stamp.style.setProperty('--eb', color || '#ffe08a');
  stamp.innerHTML = `
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
    const sq = getNode(g, pend.shopId);
    const rem = getRemainingInvest(g, sq);
    const maxInv = getMaxExtraInvest(g, sq);
    const owned = getPlayerAreaCount(g, pend.playerId, sq.area);
    const total = getAreaShops(g, sq.area).length;
    const rate = getAreaMonopolyRate(g, pend.playerId, sq.area);
    const multi = investMultiByMonopolyRate(rate);
    const pct = Math.round(rate * 100);
    title.textContent = '増資する？';
    body.innerHTML = `
      <p class="modal-lead"><strong>${sq.label}</strong></p>
      <p>買い物料 ${calcToll(g, sq).toLocaleString()}G / 増資残り <strong>${rem.toLocaleString()}G</strong></p>
      <p class="hint">独占率 ${owned}/${total}（${pct}%）→ 上限倍率×${multi}（上限 ${maxInv.toLocaleString()}G）</p>
      <label class="field">増資額 <input type="number" id="m-amt" min="0" max="${rem}" value="${Math.min(rem, 100)}" ${rem <= 0 ? 'disabled' : ''} /></label>
      <div class="modal-actions">
        <button class="btn primary" id="m-inv" ${rem <= 0 ? 'disabled' : ''}>${rem <= 0 ? '増資上限です' : '増資する'}</button>
      </div>`;
    $('#m-inv').onclick = () => {
      const amount = Number($('#m-amt').value) || 0;
      hideModal();
      sendAction({ type: 'choice', choice: { action: 'invest', amount } });
    };
    return;
  }

  if (pend.type === 'pick_invest') {
    const amount = pend.amount || 80;
    const ids = pend.shopIds?.length
      ? pend.shopIds
      : g.map.filter((s) => s.type === 'shop' && s.owner === pend.playerId).map((s) => s.id);
    title.textContent = '増資するお店を選ぶ';
    const rows = ids.map((id) => {
      const sq = getNode(g, id);
      if (!sq) return '';
      const rem = getRemainingInvest(g, sq);
      const area = AREA_META[sq.area]?.name || `A${sq.area}`;
      return `<button type="button" class="btn pick-invest-shop" data-shop="${sq.id}" style="--ac:${AREA_META[sq.area]?.color || '#888'}">
        <strong>${escapeHtml(sq.label)}</strong>
        <small>${escapeHtml(area)} · 価格 ${sq.price.toLocaleString()}G · 増資枠 ${rem.toLocaleString()}G</small>
      </button>`;
    }).join('');
    body.innerHTML = `
      <p class="modal-lead">無料で <strong>+${amount.toLocaleString()}G</strong> 増資できます</p>
      <p class="hint">自分の店舗から1つ選んでください</p>
      <div class="pick-invest-list">${rows || '<p class="hint">所持店がありません</p>'}</div>`;
    $$('.pick-invest-shop').forEach((btn) => {
      btn.onclick = () => {
        hideModal();
        sendAction({ type: 'choice', choice: { action: 'invest', shopId: Number(btn.dataset.shop) } });
      };
    });
    const skip = $('#btn-skip-choice');
    if (skip) skip.textContent = 'おまかせ';
    return;
  }

  if (pend.type === 'five_buy') {
    const sq = getNode(g, pend.shopId);
    const owner = g.players[sq.owner];
    const p = g.players[pend.playerId];
    const short = (p?.cash || 0) < pend.price;
    const canRaise = getLiquidatableValue(g, p) >= pend.price;
    title.textContent = '5倍買い？';
    body.innerHTML = `
      <p class="modal-lead"><strong>${escapeHtml(sq.label)}</strong>（${escapeHtml(owner?.name || '')}の店）</p>
      <p>価格 <strong>${pend.price.toLocaleString()}G</strong>（店価×5）</p>
      <p class="hint">所持金 ${Number(p?.cash || 0).toLocaleString()}G${short ? ' — 不足分は株や物件を売って調達できます' : ''}</p>
      <div class="modal-actions">
        <button class="btn danger" id="m-five" ${!canRaise ? 'disabled' : ''}>
          ${short ? '資金を調達して5倍買い' : '5倍買いする'}
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
      <p class="hint">全員共通の表です。めくると<strong>開けた人の色</strong>で塗られます。同じ色が縦・横・斜めに3つ以上そろうとセルが回り、<strong>${MATCH_BONUS_PER}G×枚数</strong>ボーナス</p>
      <div class="scratch-legends">${legend}</div>
      <div class="scratch-grid" style="--n:${TABLE_SIZE}">${cells}</div>
      <p class="scratch-result" id="scratch-result" hidden></p>
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
          resultEl.textContent = `${cell?.label || ''} をスクラッチ…`;
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
