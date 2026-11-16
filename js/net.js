/** MkMk Street — PeerJS による P2P 同期（ホスト権威） */

const PEER_CDN = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';

let PeerCtor = null;

export async function ensurePeerJS() {
  if (window.Peer) {
    PeerCtor = window.Peer;
    return PeerCtor;
  }
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PEER_CDN;
    s.onload = resolve;
    s.onerror = () => reject(new Error('PeerJSの読み込みに失敗しました'));
    document.head.appendChild(s);
  });
  PeerCtor = window.Peer;
  return PeerCtor;
}

function randomRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/**
 * ネットワーカー
 * - host: ゲーム状態を権威的に保持し、ゲストへ配信
 * - guest: 操作をホストへ送り、状態を受信
 */
export function createNet({ role, roomCode, onEvent, onStatus }) {
  const code = (roomCode || randomRoomCode()).toUpperCase();
  const peerId = role === 'host' ? `mkmk-${code}` : undefined;

  let peer = null;
  let hostConn = null; // guest → host
  const clients = new Map(); // peerId → DataConnection (host)
  let ready = false;
  let myId = null;
  let destroyed = false;
  let reconnecting = false;

  const status = (msg, kind = 'info') => onStatus?.({ msg, kind });

  function bindGuestConn(conn) {
    hostConn = conn;
    conn.on('data', (data) => onEvent?.({ from: 'host', data }));
    conn.on('close', () => {
      if (destroyed || reconnecting) return;
      status('ホストとの接続が切れました', 'error');
      onEvent?.({ from: 'host', data: { type: 'host_left' } });
    });
    conn.on('error', (e) => {
      status(`接続エラー: ${e?.type || e?.message || e}`, 'error');
    });
  }

  async function openGuestConn() {
    if (!peer || peer.destroyed) throw new Error('Peerが利用できません');
    const conn = peer.connect(`mkmk-${code}`, { reliable: true });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ホストへの接続がタイムアウトしました')), 15000);
      conn.on('open', () => {
        clearTimeout(t);
        status('ホストに接続しました', 'ok');
        resolve();
      });
      conn.on('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
    bindGuestConn(conn);
  }

  async function start() {
    destroyed = false;
    await ensurePeerJS();
    peer = new PeerCtor(peerId, {
      debug: 1,
    });

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Peer接続がタイムアウトしました')), 15000);
      peer.on('open', (id) => {
        clearTimeout(t);
        myId = id;
        ready = true;
        status(role === 'host' ? `部屋 ${code} を作成しました` : `接続ID: ${id}`, 'ok');
        resolve(id);
      });
      peer.on('error', (err) => {
        status(`Peerエラー: ${err.type || err.message}`, 'error');
        if (!ready) {
          clearTimeout(t);
          reject(err);
        } else if (role === 'guest' && !destroyed) {
          onEvent?.({ from: 'host', data: { type: 'host_left', reason: err.type || 'peer_error' } });
        }
      });
      peer.on('disconnected', () => {
        if (destroyed) return;
        status('シグナリングから切断 — 再接続を試行中…', 'warn');
        try {
          peer.reconnect();
        } catch (_) { /* ignore */ }
      });
    });

    if (role === 'host') {
      peer.on('connection', (conn) => {
        setupClient(conn);
      });
    } else {
      await openGuestConn();
    }

    return { roomCode: code, peerId: myId };
  }

  function setupClient(conn) {
    conn.on('open', () => {
      clients.set(conn.peer, conn);
      status(`プレイヤー参加: ${conn.peer}`, 'ok');
      onEvent?.({ from: conn.peer, data: { type: 'peer_joined', peerId: conn.peer } });
    });
    conn.on('data', (data) => onEvent?.({ from: conn.peer, data }));
    conn.on('close', () => {
      clients.delete(conn.peer);
      status(`切断: ${conn.peer}`, 'warn');
      onEvent?.({ from: conn.peer, data: { type: 'peer_left', peerId: conn.peer } });
    });
  }

  /**
   * ゲストがホストへ再接続する。
   * Peer が生きていれば DataConnection だけ張り直し、死んでいれば Peer ごと作り直す。
   */
  async function reconnect() {
    if (role !== 'guest') throw new Error('ゲストのみ再接続できます');
    if (destroyed) throw new Error('ネットは破棄済みです');
    reconnecting = true;
    status('再接続中…', 'warn');
    try {
      try { hostConn?.close(); } catch (_) { /* ignore */ }
      hostConn = null;

      if (!peer || peer.destroyed) {
        ready = false;
        myId = null;
        peer = null;
        await ensurePeerJS();
        peer = new PeerCtor(undefined, { debug: 1 });
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('Peer再接続がタイムアウトしました')), 15000);
          peer.on('open', (id) => {
            clearTimeout(t);
            myId = id;
            ready = true;
            resolve(id);
          });
          peer.on('error', (err) => {
            if (!ready) {
              clearTimeout(t);
              reject(err);
            }
          });
          peer.on('disconnected', () => {
            if (destroyed) return;
            try { peer.reconnect(); } catch (_) { /* ignore */ }
          });
        });
      } else if (peer.disconnected) {
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('シグナリング再接続がタイムアウトしました')), 10000);
          peer.once('open', () => {
            clearTimeout(t);
            resolve();
          });
          try {
            peer.reconnect();
          } catch (e) {
            clearTimeout(t);
            reject(e);
          }
        });
      }

      await openGuestConn();
      status('再接続しました', 'ok');
      return { roomCode: code, peerId: myId };
    } finally {
      reconnecting = false;
    }
  }

  function sendToHost(data) {
    if (role !== 'guest' || !hostConn?.open) return false;
    hostConn.send(data);
    return true;
  }

  function broadcast(data) {
    if (role !== 'host') return;
    for (const conn of clients.values()) {
      if (conn.open) conn.send(data);
    }
  }

  function sendTo(peerIdTarget, data) {
    const conn = clients.get(peerIdTarget);
    if (conn?.open) conn.send(data);
  }

  function destroy() {
    destroyed = true;
    ready = false;
    try {
      hostConn?.close();
      for (const c of clients.values()) c.close();
      peer?.destroy();
    } catch (_) { /* ignore */ }
    hostConn = null;
    clients.clear();
    peer = null;
  }

  return {
    role,
    get roomCode() { return code },
    get peerId() { return myId },
    get clientCount() { return clients.size },
    get connected() {
      if (destroyed || !ready) return false;
      if (role === 'host') return !!(peer && !peer.destroyed);
      return !!(hostConn && hostConn.open);
    },
    start,
    reconnect,
    sendToHost,
    broadcast,
    sendTo,
    destroy,
  };
}
