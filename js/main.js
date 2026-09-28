/** MkMk Street — UI / エントリ */

import {
  createGame,
  serializeState,
  restoreState,
  rollDice,
  applyChoice,
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
import { createNet } from './net.js';
import { createRenderer, shopTooltip } from './render.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const app = {
  mode: null, // local | host | guest
  net: null,
  game: null,
  localSeat: 0,
  localName: 'プレイヤー',
  lobbyPlayers: [],
  renderer: null,
  cpuTimer: null,
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

function bindTitle() {
  $('#btn-local').onclick = () => {
    app.mode = 'local';
    openSetupLocal();
  };
  $('#btn-host').onclick = () => openLobby('host');
  $('#btn-join').onclick = () => openLobby('guest');
  $('#btn-howto').onclick = () => showScreen('screen-howto');
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
    // 足りない分をCPUで埋めるオプションはホストUIから
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

  // クリップボード
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
    if (data.type === 'peer_left') {
      // ロビー中なら除去
      if (!app.game) {
        app.lobbyPlayers = app.lobbyPlayers.filter((p) => p.peerId !== data.peerId);
        renderLobbyPlayers();
        app.net.broadcast({ type: 'lobby_sync', players: app.lobbyPlayers });
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
    if (data.type === 'game_start') {
      app.game = restoreState(data.state);
      const myPeer = app.net.peerId;
      app.localSeat = app.game.players.findIndex((p) => p.peerId === myPeer);
      if (app.localSeat < 0) app.localSeat = 0;
      enterGame();
      return;
    }
    if (data.type === 'state') {
      app.game = restoreState(data.state);
      refreshGameUI();
      return;
    }
    if (data.type === 'reject') {
      toast(data.reason || '操作が拒否されました');
    }
  }
}

function startLocal(seats) {
  const goal = Number($('#setup-goal').value) || 10000;
  app.game = createGame({ players: seats, goal });
  app.localSeat = seats.findIndex((s) => !s.isCPU);
  if (app.localSeat < 0) app.localSeat = 0;
  enterGame();
}

function enterGame() {
  showScreen('screen-game');
  const canvas = $('#board');
  app.renderer = createRenderer(canvas);
  app.renderer.resize();
  window.addEventListener('resize', () => app.renderer?.resize());
  app.renderer.startLoop(() => app.game);
  canvas.onclick = (e) => {
    if (!app.game) return;
    const hit = app.renderer.hitTest(app.game, e.clientX, e.clientY);
    if (hit) {
      $('#inspect').textContent = shopTooltip(app.game, hit);
    }
  };
  bindGameControls();
  refreshGameUI();
  scheduleCpu();
}

function isMyTurn() {
  if (!app.game) return false;
  if (app.game.phase === 'gameover') return false;
  const cur = currentPlayer(app.game);
  if (!cur || cur.isCPU) return false;
  if (app.mode === 'local') return !cur.isCPU;
  if (app.mode === 'host') {
    return cur.peerId === app.net?.peerId || cur.id === 0;
  }
  if (app.mode === 'guest') return cur.peerId === app.net?.peerId;
  return false;
}

function bindGameControls() {
  $('#btn-roll').onclick = () => sendAction({ type: 'roll' });
  $('#btn-end-choice').onclick = () => {
    hideModal();
    sendAction({ type: 'choice', choice: { action: 'done' } });
  };
  $('#btn-skip-choice').onclick = () => {
    hideModal();
    sendAction({ type: 'choice', choice: { action: 'skip' } });
  };
}

function sendAction(action) {
  if (app.mode === 'guest') {
    app.net.sendToHost({ type: 'action', action, seat: app.localSeat });
    return;
  }
  // host or local
  applyLocalAction(action);
}

function applyLocalAction(action) {
  if (!app.game) return;
  let result = null;
  if (action.type === 'roll') {
    if (!isMyTurn() && app.mode !== 'local') {
      // local: any human can roll on their turn; isMyTurn handles CPU
    }
    const cur = currentPlayer(app.game);
    if (app.mode === 'local') {
      if (cur.isCPU) return;
    } else if (!isMyTurn()) {
      return toast('あなたのターンではありません');
    }
    if (app.game.phase !== 'await_roll') return;
    result = rollDice(app.game);
  } else if (action.type === 'choice') {
    const pend = app.game.pending;
    if (!pend) return;
    if (app.mode !== 'local' && pend.playerId !== app.localSeat && app.mode === 'guest') return;
    result = applyChoice(app.game, action.choice);
  } else if (action.type === 'sell') {
    result = preTurnSell(app.game, action.playerId, action.area, action.count);
  }

  if (result && !result.ok) {
    toast(result.error || '失敗');
    return;
  }
  if (result?.state) app.game = restoreState(result.state);
  syncState();
  refreshGameUI();
  scheduleCpu();
}

function handleHostAction(from, data) {
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
  } else if (action.type === 'choice') {
    if (!app.game.pending || app.game.pending.playerId !== seat) {
      app.net.sendTo(from, { type: 'reject', reason: '選択できません' });
      return;
    }
    const result = applyChoice(app.game, action.choice);
    if (result.state) app.game = restoreState(result.state);
  } else if (action.type === 'sell') {
    const result = preTurnSell(app.game, seat, action.area, action.count);
    if (result.state) app.game = restoreState(result.state);
  }
  syncState();
  refreshGameUI();
  scheduleCpu();
}

function syncState() {
  if (app.mode === 'host' && app.net) {
    app.net.broadcast({ type: 'state', state: serializeState(app.game) });
  }
}

function scheduleCpu() {
  clearTimeout(app.cpuTimer);
  if (!app.game || app.game.phase === 'gameover') return;
  // CPUはホストまたはローカルのみ実行
  if (app.mode === 'guest') return;
  const cur = currentPlayer(app.game);
  if (!cur?.isCPU) return;

  app.cpuTimer = setTimeout(() => {
    const result = cpuAct(app.game);
    if (result?.state) app.game = restoreState(result.state);
    syncState();
    refreshGameUI();
    scheduleCpu();
  }, 700 + Math.random() * 500);
}

function refreshGameUI() {
  const g = app.game;
  if (!g) return;

  // プレイヤーステータス
  const box = $('#players-panel');
  box.innerHTML = g.players.map((p) => {
    const a = getPlayerAssets(g, p);
    const marks = SUIT_LABELS.map((s, i) => `<span class="mark ${p.marks[i] ? 'on' : ''}">${s}</span>`).join('');
    const active = g.currentPlayerIdx === p.id ? 'active' : '';
    const me = p.id === app.localSeat ? 'me' : '';
    return `
      <div class="player-card ${active} ${me}" style="--pc:${p.color}">
        <div class="pc-head"><span class="pc-dot"></span><strong>${p.name}</strong><span class="pc-lv">Lv.${p.level}</span></div>
        <div class="pc-money">${a.cash.toLocaleString()}G</div>
        <div class="pc-assets">総資産 ${a.total.toLocaleString()}G</div>
        <div class="pc-sub">店 ${a.shopAsset.toLocaleString()} / 株 ${a.stockAsset.toLocaleString()}</div>
        <div class="pc-marks">${marks}</div>
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

  // ログ
  $('#log').innerHTML = g.logs.slice(0, 24).map((l) => `<div class="log-line ${l.kind || ''}">${escapeHtml(l.text)}</div>`).join('');

  // ダイス表示
  const diceEl = $('#dice-face');
  if (g.dice) {
    diceEl.textContent = String(g.dice);
    diceEl.classList.add('pop');
  } else {
    diceEl.textContent = '·';
    diceEl.classList.remove('pop');
  }

  // ロールボタン
  const canRoll = g.phase === 'await_roll' && (app.mode === 'local' ? !cur?.isCPU : isMyTurn());
  $('#btn-roll').disabled = !canRoll;
  $('#btn-roll').textContent = canRoll ? 'サイコロを振る' : (cur?.isCPU ? 'CPUの手番…' : '待機中…');

  // モーダル
  if (g.phase === 'await_choice' && g.pending) {
    const mine = app.mode === 'local' ? !g.players[g.pending.playerId]?.isCPU : g.pending.playerId === app.localSeat;
    if (mine) showChoiceModal(g);
    else {
      hideModal();
      $('#wait-hint').hidden = false;
      $('#wait-hint').textContent = `${g.players[g.pending.playerId]?.name || ''} が選択中…`;
    }
  } else {
    hideModal();
    $('#wait-hint').hidden = true;
  }

  if (g.phase === 'gameover') {
    showWinner(g);
  }

  // 株パネル
  renderStockPanel(g);
}

function phaseLabel(g) {
  switch (g.phase) {
    case 'await_roll': return 'サイコロ待ち';
    case 'await_choice': return '選択待ち';
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
  modal.hidden = false;
  $('#btn-end-choice').hidden = true;
  $('#btn-skip-choice').hidden = false;

  if (pend.type === 'buy_shop') {
    const sq = getNode(g, pend.shopId);
    title.textContent = 'お店を購入？';
    body.innerHTML = `
      <p class="modal-lead"><strong>${sq.label}</strong>（${AREA_META[sq.area]?.name}）</p>
      <p>価格 <strong>${sq.price.toLocaleString()}G</strong> / 買い物料 ${calcToll(g, { ...sq, owner: app.localSeat })}G〜</p>
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
      <p>現在の買い物料 ${calcToll(g, sq).toLocaleString()}G / 増資上限 残り ${rem.toLocaleString()}G</p>
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
    title.textContent = '5倍買い？';
    body.innerHTML = `
      <p class="modal-lead"><strong>${sq.label}</strong> を奪い取れます</p>
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
      <p class="hint">枚数はダイアログで指定。終わったら「完了」を押してください。</p>`;
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
  }
}

function hideModal() {
  $('#modal').hidden = true;
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
bindTitle();
showScreen('screen-title');

// タイトルの浮遊モーション用ドット
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
