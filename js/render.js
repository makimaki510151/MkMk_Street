/** MkMk Street — ボード描画 */

import { AREA_META, SUIT_LABELS, getAreaCode } from './board.js';
import {
  calcToll,
  getRemainingInvest,
  hasAreaMonopoly,
  getPlayerAreaCount,
  getAreaShops,
  getTollMulti,
  getForwardNexts,
  getLandingCandidates,
} from './engine.js';

const TYPE_ICON = {
  bank: '銀',
  shop: '',
  mark: '',
  rest: '休',
  holiday: '休',
  minigame: '遊',
  event: '！',
  scratch: '削',
  chance: '？',
  stockbroker: '株',
  lucky: '★',
  rollon: '再',
  suit_fill: 'Ｗ',
  junction: '岐',
  warp: '転',
  warp_random: 'ら',
  switch: '切',
  shaft: '井',
  pit: '坑',
  ore: '鉱',
  potion: '薬',
  gate: '門',
};

const MINIGAME_ICON = {
  guess_dice: '賽',
  high_low: '高',
  coin: '貨',
  slot: 'ス',
  dice_battle: '戦',
  horse_race: '馬',
  rps_duel: '拳',
  roulette: '輪',
  heist: '金庫',
  balloon_dash: '球',
};

/** 盤面まわりのUI（検査パネル・分岐レール・フィード等）を避ける余白 */
const UI_INSETS = { top: 56, right: 88, bottom: 64, left: 88 };
const ZOOM_MIN = 0.65;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.15;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let anim = {
    pulse: 0,
    /** @type {Record<number, {fromId:number,toId:number,start:number,dur:number}>} */
    moves: {},
    /** @type {Record<number, {fromId:number,toId:number,start:number,dur:number,color?:string}>} */
    warps: {},
    /** @type {Record<number, {fromCol:number,fromRow:number,toCol:number,toRow:number,start:number,dur:number}>} */
    tileSlides: {},
    diceSpin: 0,
  };
  let raf = 0;
  let layout = { size: 40, ox: 0, oy: 0, fit: 40, zoom: 1 };
  /** 株購入中に盤面で強調するエリア番号（null=特定エリアなし＝通常表示のまま） */
  let stockHighlightArea = null;
  let stockHighlightMode = false;
  /** 増資選択中に強調する店ID（出目ハイライトとは別色） */
  let investHighlightShopId = null;
  /** 指名買収など候補店の輪郭強調（Set / 配列 / null） */
  let shopPickIds = null;
  /** 出目ネタバレ防止中は着地候補を出さない */
  let hideDiceResult = false;
  /** 1 = 全体フィット。拡大時は pan で移動 */
  let userZoom = 1;
  let panX = 0;
  let panY = 0;

  function resize() {
    const parent = canvas.parentElement;
    const w = parent?.clientWidth || 640;
    const h = parent?.clientHeight || 640;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (userZoom <= 1.001) {
      panX = 0;
      panY = 0;
    }
  }

  function clampZoom(z) {
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  }

  /** UI余白を除いた領域に全体が収まるセルサイズ */
  function fitCellSize(g, viewW, viewH) {
    const availW = Math.max(80, viewW - UI_INSETS.left - UI_INSETS.right);
    const availH = Math.max(80, viewH - UI_INSETS.top - UI_INSETS.bottom);
    return Math.min(availW / g.cols, availH / g.rows);
  }

  function clampPan(g, viewW, viewH, size, ox, oy) {
    const boardW = size * g.cols;
    const boardH = size * g.rows;
    const minOx = Math.min(UI_INSETS.left, viewW - UI_INSETS.right - boardW);
    const maxOx = Math.max(UI_INSETS.left, viewW - UI_INSETS.right - boardW);
    const minOy = Math.min(UI_INSETS.top, viewH - UI_INSETS.bottom - boardH);
    const maxOy = Math.max(UI_INSETS.top, viewH - UI_INSETS.bottom - boardH);
    // 盤が余白内より小さいときは中央付近に留める／大きいときは端が見切れすぎないよう制限
    const loX = Math.min(minOx, maxOx);
    const hiX = Math.max(minOx, maxOx);
    const loY = Math.min(minOy, maxOy);
    const hiY = Math.max(minOy, maxOy);
    return {
      ox: Math.min(hiX, Math.max(loX, ox)),
      oy: Math.min(hiY, Math.max(loY, oy)),
    };
  }

  function computeLayout(g, viewW, viewH) {
    if (!g) return { size: 40, ox: 0, oy: 0, fit: 40, zoom: userZoom };
    const fit = fitCellSize(g, viewW, viewH);
    const size = fit * userZoom;
    const boardW = size * g.cols;
    const boardH = size * g.rows;
    const contentW = viewW - UI_INSETS.left - UI_INSETS.right;
    const contentH = viewH - UI_INSETS.top - UI_INSETS.bottom;
    const ox0 = UI_INSETS.left + (contentW - boardW) / 2 + panX;
    const oy0 = UI_INSETS.top + (contentH - boardH) / 2 + panY;
    const clamped = clampPan(g, viewW, viewH, size, ox0, oy0);
    return { size, ox: clamped.ox, oy: clamped.oy, fit, zoom: userZoom };
  }

  /** draw で更新。ズーム操作のアンカー計算に使う */
  let lastGame = null;

  function getZoom() {
    return userZoom;
  }

  function setZoom(z, anchorX, anchorY) {
    const viewW = canvas.clientWidth;
    const viewH = canvas.clientHeight;
    const next = clampZoom(Number(z) || 1);
    const g = lastGame;
    const ax = anchorX == null ? viewW / 2 : anchorX;
    const ay = anchorY == null ? viewH / 2 : anchorY;

    if (!g) {
      userZoom = next <= 1.001 ? 1 : next;
      if (userZoom === 1) {
        panX = 0;
        panY = 0;
      }
      return userZoom;
    }

    const before = computeLayout(g, viewW, viewH);
    const wx = before.size > 0 ? (ax - before.ox) / before.size : 0;
    const wy = before.size > 0 ? (ay - before.oy) / before.size : 0;

    userZoom = next <= 1.001 ? 1 : next;
    if (userZoom === 1) {
      panX = 0;
      panY = 0;
      return userZoom;
    }

    const fit = fitCellSize(g, viewW, viewH);
    const size = fit * userZoom;
    const contentW = viewW - UI_INSETS.left - UI_INSETS.right;
    const contentH = viewH - UI_INSETS.top - UI_INSETS.bottom;
    const boardW = size * g.cols;
    const boardH = size * g.rows;
    const desiredOx = ax - wx * size;
    const desiredOy = ay - wy * size;
    panX = desiredOx - (UI_INSETS.left + (contentW - boardW) / 2);
    panY = desiredOy - (UI_INSETS.top + (contentH - boardH) / 2);
    return userZoom;
  }

  function zoomBy(delta, anchorX, anchorY) {
    return setZoom(userZoom + delta, anchorX, anchorY);
  }

  function zoomIn(anchorX, anchorY) {
    return zoomBy(ZOOM_STEP, anchorX, anchorY);
  }

  function zoomOut(anchorX, anchorY) {
    return zoomBy(-ZOOM_STEP, anchorX, anchorY);
  }

  function zoomFit() {
    userZoom = 1;
    panX = 0;
    panY = 0;
    return userZoom;
  }

  function panBy(dx, dy) {
    if (userZoom <= 1.001) return;
    panX += dx;
    panY += dy;
    if (!lastGame) return;
    const viewW = canvas.clientWidth;
    const viewH = canvas.clientHeight;
    const lay = computeLayout(lastGame, viewW, viewH);
    const contentW = viewW - UI_INSETS.left - UI_INSETS.right;
    const contentH = viewH - UI_INSETS.top - UI_INSETS.bottom;
    const boardW = lay.size * lastGame.cols;
    const boardH = lay.size * lastGame.rows;
    panX = lay.ox - (UI_INSETS.left + (contentW - boardW) / 2);
    panY = lay.oy - (UI_INSETS.top + (contentH - boardH) / 2);
  }

  function getLayout() {
    return { ...layout, insets: { ...UI_INSETS } };
  }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  /** スイッチで動くマスの見た目座標（アニメ中は補間）。完了分の掃除は draw 末尾で行う */
  function visualGridPos(n) {
    const slide = anim.tileSlides[n.id];
    if (!slide) return { col: n.col, row: n.row, hop: 0 };
    const t = Math.min(1, (performance.now() - slide.start) / slide.dur);
    const ease = easeInOut(t);
    const hop = t >= 1 ? 0 : Math.sin(Math.PI * ease) * 0.18;
    if (t >= 1) return { col: n.col, row: n.row, hop: 0 };
    return {
      col: slide.fromCol + (slide.toCol - slide.fromCol) * ease,
      row: slide.fromRow + (slide.toRow - slide.fromRow) * ease,
      hop,
    };
  }

  function pruneFinishedTileSlides() {
    const now = performance.now();
    for (const id of Object.keys(anim.tileSlides)) {
      const s = anim.tileSlides[id];
      if (!s || now - s.start >= s.dur) delete anim.tileSlides[id];
    }
  }

  function nodeCenter(g, nodeId) {
    const n = g.map.find((x) => x.id === nodeId);
    if (!n) return null;
    const vg = visualGridPos(n);
    return {
      x: layout.ox + vg.col * layout.size + layout.size / 2,
      y: layout.oy + vg.row * layout.size + layout.size / 2 - vg.hop * layout.size,
    };
  }

  /** 2マス間の向き（ラジアン）。同一点なら null */
  function angleBetweenIds(g, fromId, toId) {
    const a = nodeCenter(g, fromId);
    const b = nodeCenter(g, toId);
    if (!a || !b) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.hypot(dx, dy) < 0.5) return null;
    return Math.atan2(dy, dx);
  }

  /**
   * コマの進行向き。移動／ワープ中は行き先、停止中は直前マス→現在マス。
   * @returns {number|null}
   */
  function tokenFacingAngle(g, p) {
    const mv = anim.moves[p.id];
    if (mv) return angleBetweenIds(g, mv.fromId, mv.toId);
    const wv = anim.warps[p.id];
    if (wv && warpProgress(wv) < 0.92) return angleBetweenIds(g, wv.fromId, wv.toId);
    if (p.prevPos != null && p.prevPos !== p.pos) {
      return angleBetweenIds(g, p.prevPos, p.pos);
    }
    return null;
  }

  /** コマ先端の向き矢印（白＋プレイヤー色） */
  function drawFacingChevron(x, y, rad, angle, color, emphasize) {
    if (angle == null || !Number.isFinite(angle)) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const tip = rad * (emphasize ? 1.85 : 1.65);
    const base = rad * 0.25;
    const half = rad * (emphasize ? 0.62 : 0.52);
    ctx.beginPath();
    ctx.moveTo(tip, 0);
    ctx.lineTo(base, -half);
    ctx.lineTo(base, half);
    ctx.closePath();
    ctx.fillStyle = '#fffef5';
    ctx.globalAlpha = emphasize ? 0.98 : 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color || '#ffe08a';
    ctx.lineWidth = emphasize ? 2.2 : 1.6;
    ctx.stroke();
    // 内側の色チップで自分の向きと分かりやすく
    ctx.beginPath();
    ctx.moveTo(tip - rad * 0.22, 0);
    ctx.lineTo(base + rad * 0.12, -half * 0.45);
    ctx.lineTo(base + rad * 0.12, half * 0.45);
    ctx.closePath();
    ctx.fillStyle = color || '#ffe08a';
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** 移動中の最終着地候補（出目ネタバレ中は空） */
  function landingCandidateSet(g) {
    if (hideDiceResult || !g?.move) return null;
    const cur = g.players?.[g.currentPlayerIdx];
    if (!cur || cur.bankrupt) return null;
    const left = g.phase === 'await_fork' && g.pending?.stepsLeft != null
      ? Number(g.pending.stepsLeft)
      : Number(g.move.stepsLeft);
    if (!Number.isFinite(left) || left <= 0) return null;
    const ids = getLandingCandidates(g, cur.pos, cur.prevPos, left);
    if (!ids.length) return null;
    return new Set(ids);
  }

  /** 着地候補マスを強調（ハイライト縁のみ） */
  function drawLandingCandidateMarks(g, landSet) {
    if (!landSet?.size) return;
    const { size } = layout;
    const pulse = 0.55 + Math.sin(anim.pulse) * 0.2;
    for (const n of g.map) {
      if (!landSet.has(n.id)) continue;
      const vg = visualGridPos(n);
      const x = layout.ox + vg.col * size;
      const y = layout.oy + vg.row * size - vg.hop * size;
      const pad = size * 0.04;
      const r = size * 0.1;
      ctx.save();
      ctx.globalAlpha = 0.7 + pulse * 0.25;
      ctx.strokeStyle = '#5ef0c8';
      ctx.lineWidth = Math.max(3, size * 0.08);
      roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, r);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** 手番プレイヤーの次の進み先マスを薄く示す */
  function drawForwardHeadingHints(g) {
    const cur = g.players?.[g.currentPlayerIdx];
    if (!cur || cur.bankrupt) return;
    if (anim.warps[cur.id]) return;

    let nextIds = [];
    const mv = anim.moves[cur.id];
    if (mv) {
      nextIds = [mv.toId];
    } else if (g.phase === 'await_fork' && Array.isArray(g.pending?.options)) {
      nextIds = g.pending.options.map((o) => o.id).filter((id) => id != null);
    } else if (g.phase === 'await_roll' || g.phase === 'moving') {
      nextIds = getForwardNexts(g, cur.pos, cur.prevPos);
    }
    if (!nextIds.length) return;

    const from = nodeCenter(g, mv ? mv.fromId : cur.pos);
    if (!from) return;
    const size = layout.size;
    const pulse = 0.45 + Math.sin(anim.pulse) * 0.2;

    for (const nid of nextIds) {
      const to = nodeCenter(g, nid);
      if (!to) continue;
      ctx.save();
      ctx.strokeStyle = cur.color || '#ffe08a';
      ctx.globalAlpha = pulse * 0.85;
      ctx.lineWidth = Math.max(2.5, size * 0.06);
      ctx.setLineDash([Math.max(4, size * 0.12), Math.max(4, size * 0.1)]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // 行き先マスの縁
      const n = g.map.find((x) => x.id === nid);
      if (n) {
        const vg = visualGridPos(n);
        const pad = size * 0.08;
        const r = size * 0.14;
        const x = layout.ox + vg.col * size;
        const y = layout.oy + vg.row * size - vg.hop * size;
        ctx.globalAlpha = 0.35 + Math.sin(anim.pulse) * 0.15;
        ctx.strokeStyle = cur.color || '#ffe08a';
        ctx.lineWidth = 3;
        roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, r);
        ctx.stroke();
      }

      // 線先の矢印
      const ang = Math.atan2(to.y - from.y, to.x - from.x);
      const ah = size * 0.16;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = cur.color || '#ffe08a';
      ctx.translate(to.x, to.y);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(ah * 0.15, 0);
      ctx.lineTo(-ah * 0.55, -ah * 0.4);
      ctx.lineTo(-ah * 0.55, ah * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /** コマ移動アニメを予約 */
  function animateToken(playerId, fromId, toId, dur = 380) {
    anim.moves[playerId] = {
      fromId,
      toId,
      start: performance.now(),
      dur,
    };
  }

  /** スイッチで動くマスのスライド（from/to はグリッド座標） */
  function animateTileSlide(nodeId, from, to, dur = 780) {
    if (!from || !to || nodeId == null) return;
    anim.tileSlides[nodeId] = {
      fromCol: from.col,
      fromRow: from.row,
      toCol: to.col,
      toRow: to.row,
      start: performance.now(),
      dur,
    };
  }

  /** ワープ移動（高い弧＋ビーム）。どこへ飛んだかを見せる */
  function animateWarp(playerId, fromId, toId, dur = 1200, color) {
    delete anim.moves[playerId];
    anim.warps[playerId] = {
      fromId,
      toId,
      start: performance.now(),
      dur,
      color,
    };
  }

  function warpProgress(wv) {
    return Math.min(1, (performance.now() - wv.start) / wv.dur);
  }

  /** 0..1 → 飛行フェーズ（出発待機を除く） */
  function warpFlyT(t) {
    if (t < 0.12) return 0;
    if (t > 0.88) return 1;
    const u = (t - 0.12) / 0.76;
    return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  }

  function warpBezier(a, b, t, lift) {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2 - lift;
    const omt = 1 - t;
    return {
      x: omt * omt * a.x + 2 * omt * t * mx + t * t * b.x,
      y: omt * omt * a.y + 2 * omt * t * my + t * t * b.y,
    };
  }

  function tokenDrawPos(g, p, stackIndex, stackCount) {
    const oxf = (stackIndex - (stackCount - 1) / 2) * layout.size * 0.22;
    const wv = anim.warps[p.id];
    if (wv) {
      const t = warpProgress(wv);
      const a = nodeCenter(g, wv.fromId);
      const b = nodeCenter(g, wv.toId);
      if (a && b) {
        const lift = Math.max(layout.size * 1.8, Math.hypot(b.x - a.x, b.y - a.y) * 0.35);
        const fly = warpFlyT(t);
        const pt = warpBezier(a, b, fly, lift);
        if (t >= 1) delete anim.warps[p.id];
        const land = t > 0.88 ? Math.sin(((t - 0.88) / 0.12) * Math.PI) * layout.size * 0.08 : 0;
        return { x: pt.x + oxf, y: pt.y + layout.size * 0.28 - land };
      }
    }
    const mv = anim.moves[p.id];
    if (mv) {
      const t = Math.min(1, (performance.now() - mv.start) / mv.dur);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const a = nodeCenter(g, mv.fromId);
      const b = nodeCenter(g, mv.toId);
      if (a && b) {
        const hop = Math.sin(Math.PI * ease) * layout.size * 0.22;
        if (t >= 1) delete anim.moves[p.id];
        return { x: a.x + (b.x - a.x) * ease + oxf, y: a.y + (b.y - a.y) * ease + layout.size * 0.28 - hop };
      }
    }
    const c = nodeCenter(g, p.pos);
    if (!c) return null;
    return { x: c.x + oxf, y: c.y + layout.size * 0.28 };
  }

  function drawWarpEffects(g) {
    const size = layout.size;
    for (const pid of Object.keys(anim.warps)) {
      const wv = anim.warps[pid];
      const t = warpProgress(wv);
      const a = nodeCenter(g, wv.fromId);
      const b = nodeCenter(g, wv.toId);
      if (!a || !b) continue;
      const p = g.players.find((x) => x.id === Number(pid));
      const col = wv.color || p?.color || '#c4a574';
      const lift = Math.max(size * 1.8, Math.hypot(b.x - a.x, b.y - a.y) * 0.35);
      const fly = warpFlyT(t);

      // 出発・到着マスの枠
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = t < 0.35 ? 0.85 : Math.max(0.2, 1 - t);
      roundRect(ctx, a.x - size * 0.42, a.y - size * 0.42, size * 0.84, size * 0.84, 2);
      ctx.stroke();
      ctx.globalAlpha = 0.35 + Math.min(1, t * 1.4) * 0.55;
      const pulse = 1 + Math.sin(t * Math.PI * 3) * 0.04;
      roundRect(
        ctx,
        b.x - size * 0.42 * pulse,
        b.y - size * 0.42 * pulse,
        size * 0.84 * pulse,
        size * 0.84 * pulse,
        2,
      );
      ctx.stroke();
      ctx.restore();

      // 軌道ビーム
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 7]);
      ctx.lineDashOffset = -t * 40;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - lift, b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // 進行点の残像
      for (let i = 0; i < 5; i++) {
        const u = Math.max(0, fly - i * 0.06);
        const pt = warpBezier(a, b, u, lift);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3 + (4 - i) * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.15 + (4 - i) * 0.1;
        ctx.fill();
      }

      // 到着ラベル
      if (t > 0.2) {
        const dest = g.map.find((n) => n.id === wv.toId);
        const label = (dest?.label || dest?.type || '？').slice(0, 6);
        ctx.globalAlpha = Math.min(1, (t - 0.2) / 0.25);
        ctx.fillStyle = 'rgba(20, 24, 28, 0.82)';
        const tw = Math.max(size * 0.9, label.length * size * 0.22);
        roundRect(ctx, b.x - tw / 2, b.y - size * 0.72, tw, size * 0.28, 2);
        ctx.fill();
        ctx.fillStyle = '#e8e4dc';
        ctx.font = `700 ${Math.max(10, size * 0.18)}px "Zen Kaku Gothic New", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, b.x, b.y - size * 0.58);
      }
      ctx.restore();
    }
  }

  function draw(g, opts = {}) {
    if (opts && Object.prototype.hasOwnProperty.call(opts, 'hideDiceResult')) {
      hideDiceResult = !!opts.hideDiceResult;
    }
    const viewW = canvas.clientWidth;
    const viewH = canvas.clientHeight;
    ctx.clearRect(0, 0, viewW, viewH);

    const grad = ctx.createLinearGradient(0, 0, viewW, viewH);
    grad.addColorStop(0, '#1a3a3a');
    grad.addColorStop(0.45, '#234846');
    grad.addColorStop(1, '#1e2f4a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.fillStyle = 'rgba(255,220,140,0.04)';
    for (let y = 0; y < viewH; y += 18) {
      for (let x = 0; x < viewW; x += 18) {
        ctx.beginPath();
        ctx.arc(x + (y % 36 === 0 ? 0 : 9), y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (!g) return;
    lastGame = g;

    layout = computeLayout(g, viewW, viewH);
    const { size, ox, oy } = layout;
    anim.pulse = (anim.pulse + 0.04) % (Math.PI * 2);

    const landSet = landingCandidateSet(g);

    // パス（有効）
    ctx.strokeStyle = 'rgba(255, 210, 120, 0.28)';
    ctx.lineWidth = Math.max(4, size * 0.18);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const n of g.map) {
      const va = visualGridPos(n);
      const x = ox + va.col * size + size / 2;
      const y = oy + va.row * size + size / 2 - va.hop * size;
      for (const nid of n.nexts) {
        const m = g.map.find((x) => x.id === nid);
        if (!m) continue;
        const vb = visualGridPos(m);
        ctx.moveTo(x, y);
        ctx.lineTo(ox + vb.col * size + size / 2, oy + vb.row * size + size / 2 - vb.hop * size);
      }
    }
    ctx.stroke();

    // スイッチで無効なゲートは点線で残す
    if (g.switchGates?.length) {
      const state = g.switchState ? 1 : 0;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 210, 120, 0.12)';
      ctx.lineWidth = Math.max(2, size * 0.1);
      ctx.setLineDash([Math.max(3, size * 0.12), Math.max(4, size * 0.16)]);
      ctx.beginPath();
      for (const gate of g.switchGates) {
        if (Number(gate.when) === state) continue;
        const a = g.map.find((n) => n.id === gate.a);
        const b = g.map.find((n) => n.id === gate.b);
        if (!a || !b) continue;
        const va = visualGridPos(a);
        const vb = visualGridPos(b);
        ctx.moveTo(ox + va.col * size + size / 2, oy + va.row * size + size / 2 - va.hop * size);
        ctx.lineTo(ox + vb.col * size + size / 2, oy + vb.row * size + size / 2 - vb.hop * size);
      }
      ctx.stroke();
      ctx.restore();
    }

    // ワープ同士の対応を薄い弧で示す
    ctx.save();
    ctx.strokeStyle = 'rgba(170, 140, 255, 0.28)';
    ctx.lineWidth = Math.max(1.5, size * 0.06);
    ctx.setLineDash([4, 6]);
    for (const n of g.map) {
      if (n.type !== 'warp' || n.warpTo == null) continue;
      if (n.id > n.warpTo) continue;
      const m = g.map.find((x) => x.id === n.warpTo);
      if (!m) continue;
      const ax = ox + n.col * size + size / 2;
      const ay = oy + n.row * size + size / 2;
      const bx = ox + m.col * size + size / 2;
      const by = oy + m.row * size + size / 2;
      const mx = (ax + bx) / 2;
      const my = Math.min(ay, by) - size * 0.8;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx, my, bx, by);
      ctx.stroke();
    }
    ctx.restore();

    // マス
    for (const n of g.map) {
      const vg = visualGridPos(n);
      const x = ox + vg.col * size;
      const y = oy + vg.row * size - vg.hop * size;
      const pad = size * 0.07;
      const r = size * 0.04;
      const sliding = !!anim.tileSlides[n.id];
      if (sliding) {
        ctx.save();
        ctx.shadowColor = 'rgba(255, 224, 138, 0.55)';
        ctx.shadowBlur = size * 0.22;
      }
      roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, r);

      let fill = '#2a4050';
      let stroke = 'rgba(255,255,255,0.15)';
      const owner = n.type === 'shop' && n.owner >= 0 ? g.players[n.owner] : null;
      if (n.type === 'shop') {
        fill = g.areas[n.area]?.color || AREA_META[n.area]?.color || '#51607a';
        if (owner) stroke = owner.color || '#fff';
      } else if (n.type === 'bank') fill = '#d4a017';
      else if (n.type === 'mark') fill = '#3a2f55';
      else if (n.type === 'chance') fill = '#c45c26';
      else if (n.type === 'event') fill = '#6b3fa0';
      else if (n.type === 'scratch') fill = '#1f6f8b';
      else if (n.type === 'holiday') fill = '#a65d2e';
      else if (n.type === 'minigame') fill = n.game === 'slot' ? '#8b3a62' : '#c27820';
      else if (n.type === 'stockbroker') fill = '#2f6f6a';
      else if (n.type === 'rest') fill = '#4a6a7a';
      else if (n.type === 'lucky') fill = '#b8860b';
      else if (n.type === 'rollon') fill = '#2d6a4f';
      else if (n.type === 'suit_fill') fill = '#6b3d6a';
      else if (n.type === 'junction') fill = '#5a4a3a';
      else if (n.type === 'warp') fill = '#5b4a8c';
      else if (n.type === 'warp_random') fill = '#6a8b4a';
      else if (n.type === 'switch') fill = '#8a6b2a';
      else if (n.type === 'shaft') fill = n.shaft === 'up' ? '#7a9a4a' : '#7a4a8a';
      else if (n.type === 'pit') fill = n.pit === 'up' ? '#9a6a5a' : '#4a5a9a';
      else if (n.type === 'ore') {
        fill = n.ore === 'gold' ? '#b8860b' : n.ore === 'diamond' ? '#5a9a7a' : '#6a6a7a';
      }
      else if (n.type === 'potion') fill = '#5a6a9a';
      else if (n.type === 'gate') fill = '#6a5a8a';

      const forkOpt = g.phase === 'await_fork' && g.pending?.options?.some((o) => o.id === n.id);
      const landOpt = !!(landSet && landSet.has(n.id));
      const stockMode = stockHighlightMode || (g.phase === 'await_choice' && g.pending?.type === 'stock');
      // 選択／ホバー中のエリアだけ強調。未選択時はマス表示を通常のままにする
      const areaHot = stockMode && n.type === 'shop' && stockHighlightArea != null
        && Number(stockHighlightArea) === Number(n.area);
      const areaDim = stockMode && n.type === 'shop' && stockHighlightArea != null
        && Number(stockHighlightArea) !== Number(n.area);
      const landDim = !!(landSet && landSet.size && !landOpt);

      ctx.fillStyle = fill;
      ctx.fill();

      if (n.type === 'shop') {
        const meta = g.areas[n.area] || AREA_META[n.area];
        fillShopPattern(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, r, meta);
      }

      // 株購入中：対象外エリアを暗く
      if (areaDim) {
        ctx.save();
        ctx.fillStyle = 'rgba(4, 12, 16, 0.55)';
        roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, r);
        ctx.fill();
        ctx.restore();
      }

      // 出目後：着地候補以外を少し抑えつつ、マス情報は読める明るさを残す
      if (landDim) {
        ctx.save();
        ctx.fillStyle = 'rgba(4, 10, 14, 0.32)';
        roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, r);
        ctx.fill();
        ctx.restore();
      }

      // 株購入中：エリア色の縁取り（全体表示 or 選択/ホバー中を強調）
      if (areaHot && n.type === 'shop') {
        ctx.save();
        const selected = stockHighlightArea != null;
        const glow = selected
          ? 0.4 + Math.sin(anim.pulse) * 0.25
          : 0.22 + Math.sin(anim.pulse) * 0.08;
        ctx.globalAlpha = glow;
        const areaMeta = g.areas[n.area] || AREA_META[n.area];
        ctx.strokeStyle = areaMeta?.patternInk || areaMeta?.color || '#ffe08a';
        ctx.lineWidth = selected ? 4.5 : 2.5;
        roundRect(ctx, x + pad - 1, y + pad - 1, size - pad * 2 + 2, size - pad * 2 + 2, r + 1);
        ctx.stroke();
        if (selected) {
          ctx.globalAlpha = 0.24 + Math.sin(anim.pulse) * 0.12;
          ctx.fillStyle = areaMeta?.color || '#ffe08a';
          roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, r);
          ctx.fill();
        }
        ctx.restore();
      }

      // 候補店（指名買収など）：薄いシアンの縁
      if (shopPickIds?.has?.(n.id) && n.id !== investHighlightShopId) {
        ctx.save();
        ctx.globalAlpha = 0.35 + Math.sin(anim.pulse) * 0.12;
        ctx.strokeStyle = '#9ad7ff';
        ctx.lineWidth = Math.max(2, size * 0.055);
        roundRect(ctx, x + pad - 1, y + pad - 1, size - pad * 2 + 2, size - pad * 2 + 2, r + 1);
        ctx.stroke();
        ctx.restore();
      }

      // 増資選択：琥珀色の内側グロー（出目のシアン縁とは別）
      if (investHighlightShopId != null && n.id === investHighlightShopId) {
        ctx.save();
        const pulse = 0.28 + Math.sin(anim.pulse * 1.15) * 0.14;
        ctx.globalAlpha = pulse;
        ctx.fillStyle = '#f0c878';
        roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, r);
        ctx.fill();
        ctx.globalAlpha = 0.55 + Math.sin(anim.pulse) * 0.2;
        ctx.strokeStyle = '#ffe6a8';
        ctx.lineWidth = Math.max(2.5, size * 0.07);
        roundRect(ctx, x + pad - 1.5, y + pad - 1.5, size - pad * 2 + 3, size - pad * 2 + 3, r + 1);
        ctx.stroke();
        ctx.restore();
      }

      ctx.strokeStyle = forkOpt ? '#ffe08a' : (areaHot && stockHighlightArea != null ? '#fffef5' : stroke);
      ctx.lineWidth = forkOpt ? 4 : (areaHot && stockHighlightArea != null ? 3.5 : (owner ? 3.5 : 1.5));
      roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, r);
      ctx.stroke();

      // 所有者の色帯（上辺）— プレイヤー単色。グループ模様と分離
      if (owner) {
        ctx.fillStyle = owner.color;
        roundRect(ctx, x + pad, y + pad, size - pad * 2, Math.max(4, size * 0.14), r);
        ctx.fill();
        // 角バッジ
        const br = Math.max(7, size * 0.16);
        ctx.beginPath();
        ctx.arc(x + size - pad - br * 0.2, y + pad + br * 0.9, br, 0, Math.PI * 2);
        ctx.fillStyle = owner.color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `800 ${Math.max(8, size * 0.18)}px "Zen Maru Gothic", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((owner.name || '?').slice(0, 1), x + size - pad - br * 0.2, y + pad + br * 0.9);
      }

      if (forkOpt) {
        ctx.save();
        ctx.globalAlpha = 0.35 + Math.sin(anim.pulse) * 0.15;
        ctx.fillStyle = '#ffe08a';
        roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, r);
        ctx.fill();
        ctx.restore();
      }

      const someoneHere = g.players.some((p) => !p.bankrupt && p.pos === n.id);
      if (someoneHere) {
        ctx.save();
        ctx.globalAlpha = 0.25 + Math.sin(anim.pulse) * 0.15;
        ctx.strokeStyle = '#ffe08a';
        ctx.lineWidth = 3;
        roundRect(ctx, x + pad - 2, y + pad - 2, size - pad * 2 + 4, size - pad * 2 + 4, r + 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.fillStyle = '#fffef5';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (n.type === 'shop') {
        // 株購入中も店名・料／価格を通常表示（エリア番号に差し替えない）
        const labelAlpha = areaDim ? 0.35 : 1;
        ctx.save();
        ctx.globalAlpha = labelAlpha;
        ctx.font = `700 ${Math.max(9, size * 0.18)}px "Zen Maru Gothic", sans-serif`;
        ctx.fillStyle = '#fffef5';
        ctx.fillText(n.label.slice(0, 3), x + size / 2, y + size / 2 - size * 0.14);
        ctx.font = `800 ${Math.max(8, size * 0.15)}px "Zen Maru Gothic", sans-serif`;
        if (n.owner >= 0) {
          // 所有店は「止まると払う料」を主表示（価格より重要）
          const closed = !!g.players[n.owner]?.shopsClosed;
          const toll = calcToll(g, n);
          ctx.fillStyle = closed ? 'rgba(255, 196, 150, 0.95)' : '#ffc2b4';
          ctx.fillText(closed ? '店休・料0' : `料${toll.toLocaleString()}`, x + size / 2, y + size / 2 + size * 0.12);
          ctx.font = `600 ${Math.max(7, size * 0.12)}px "Zen Maru Gothic", sans-serif`;
          ctx.fillStyle = 'rgba(255,255,255,0.72)';
          ctx.fillText(`${n.price.toLocaleString()}G`, x + size / 2, y + size / 2 + size * 0.32);
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          ctx.fillText(`${n.price.toLocaleString()}G`, x + size / 2, y + size / 2 + size * 0.18);
        }
        ctx.restore();
      } else if (n.type === 'mark') {
        ctx.font = `900 ${Math.max(16, size * 0.42)}px "Fredoka", sans-serif`;
        ctx.fillText(SUIT_LABELS[n.mark], x + size / 2, y + size / 2);
      } else if (n.type === 'minigame') {
        ctx.font = `800 ${Math.max(9, size * 0.2)}px "Zen Maru Gothic", sans-serif`;
        ctx.fillText(MINIGAME_ICON[n.game] || TYPE_ICON.minigame, x + size / 2, y + size / 2 - size * 0.08);
        ctx.font = `700 ${Math.max(8, size * 0.16)}px "Zen Maru Gothic", sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillText((n.label || '遊').slice(0, 3), x + size / 2, y + size / 2 + size * 0.2);
      } else if (n.type === 'holiday' || n.type === 'event' || n.type === 'scratch') {
        ctx.font = `800 ${Math.max(9, size * 0.22)}px "Zen Maru Gothic", sans-serif`;
        ctx.fillText(TYPE_ICON[n.type] || n.label.slice(0, 2), x + size / 2, y + size / 2);
      } else {
        ctx.font = `800 ${Math.max(11, size * 0.28)}px "Zen Maru Gothic", sans-serif`;
        ctx.fillText(TYPE_ICON[n.type] || n.label.slice(0, 2), x + size / 2, y + size / 2);
      }
      if (sliding) ctx.restore();
    }

    pruneFinishedTileSlides();
    drawWarpEffects(g);

    // 出目後の最終着地候補（分岐を踏まえた停止マス）
    drawLandingCandidateMarks(g, landSet);

    // 手番の進み先ヒント（コマの下に敷く）
    drawForwardHeadingHints(g);

    // コマ
    const byPos = {};
    g.players.forEach((p) => {
      if (p.bankrupt) return;
      const key = anim.warps[p.id] ? anim.warps[p.id].fromId : p.pos;
      if (!byPos[key]) byPos[key] = [];
      byPos[key].push(p);
    });

    for (const p of g.players) {
      if (p.bankrupt) continue;
      const key = anim.warps[p.id] ? anim.warps[p.id].fromId : p.pos;
      const list = byPos[key] || [p];
      const idx = list.indexOf(p);
      const pos = tokenDrawPos(g, p, Math.max(0, idx), list.length);
      if (!pos) continue;
      const rad = layout.size * 0.16;
      const warping = !!anim.warps[p.id];
      const isCurrent = g.currentPlayerIdx === p.id;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, rad * (warping ? 1.08 : 1), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = warping ? 0.92 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = warping ? 2.5 : 2;
      ctx.stroke();
      if (isCurrent || warping) {
        const pulse = rad + 4 + Math.sin(anim.pulse) * 2;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, pulse, 0, Math.PI * 2);
        ctx.strokeStyle = warping ? p.color : 'rgba(255,224,120,0.95)';
        ctx.lineWidth = warping ? 2.5 : 3;
        ctx.stroke();
        if (!warping) {
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, pulse + 3, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,224,120,0.35)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      // 進行方向（自分・他プレイヤーとも）
      const facing = tokenFacingAngle(g, p);
      drawFacingChevron(pos.x, pos.y, rad, facing, p.color, isCurrent || warping || !!anim.moves[p.id]);
    }

    // ブランド表記はトップバーに集約（盤面マスと被らない）
  }

  function startLoop(getFrame) {
    cancelAnimationFrame(raf);
    const tick = () => {
      const frame = getFrame();
      if (frame && typeof frame === 'object' && Object.prototype.hasOwnProperty.call(frame, 'game')) {
        draw(frame.game, { hideDiceResult: !!frame.hideDiceResult });
      } else {
        draw(frame);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function setHideDiceResult(v) {
    hideDiceResult = !!v;
  }

  function stop() {
    cancelAnimationFrame(raf);
  }

  function hitTest(g, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const viewW = canvas.clientWidth;
    const viewH = canvas.clientHeight;
    const lay = computeLayout(g, viewW, viewH);
    const { size, ox, oy } = lay;
    for (const n of g.map) {
      const cx = ox + n.col * size;
      const cy = oy + n.row * size;
      if (x >= cx && x <= cx + size && y >= cy && y <= cy + size) return n;
    }
    return null;
  }

  /** @param {number|null} area 強調するエリア。null は強調なし（通常マス表示）。mode=true で株UI中のハイライト */
  function setStockHighlight(area, mode = true) {
    stockHighlightMode = !!mode;
    stockHighlightArea = area == null ? null : Number(area);
  }

  function clearStockHighlight() {
    stockHighlightMode = false;
    stockHighlightArea = null;
  }

  /** @param {number|null} shopId 増資で選択中の店。出目ハイライトとは別演出 */
  function setInvestHighlight(shopId) {
    investHighlightShopId = shopId == null ? null : Number(shopId);
  }

  function clearInvestHighlight() {
    investHighlightShopId = null;
  }

  /** @param {Iterable<number>|null} ids 盤面クリック候補の店 */
  function setShopPickHighlight(ids) {
    if (ids == null) {
      shopPickIds = null;
      return;
    }
    shopPickIds = new Set([...ids].map(Number).filter((n) => Number.isFinite(n)));
  }

  function clearShopPickHighlight() {
    shopPickIds = null;
  }

  return {
    resize,
    draw,
    startLoop,
    stop,
    hitTest,
    animateToken,
    animateWarp,
    animateTileSlide,
    setStockHighlight,
    clearStockHighlight,
    setInvestHighlight,
    clearInvestHighlight,
    setShopPickHighlight,
    clearShopPickHighlight,
    setHideDiceResult,
    getZoom,
    setZoom,
    zoomIn,
    zoomOut,
    zoomFit,
    zoomBy,
    panBy,
    getLayout,
    ZOOM_MIN,
    ZOOM_MAX,
  };
}

function fillShopPattern(ctx, x, y, w, h, r, meta) {
  if (!meta) return;
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const ink = meta.patternInk || 'rgba(255,255,255,0.35)';
  const pat = meta.pattern || 'check';
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.55;
  if (pat === 'check') {
    const s = Math.max(5, w / 5);
    for (let iy = 0; iy < h; iy += s) {
      for (let ix = 0; ix < w; ix += s) {
        if (((ix / s) + (iy / s)) % 2 < 1) ctx.fillRect(x + ix, y + iy, s, s);
      }
    }
  } else if (pat === 'stripe') {
    ctx.lineWidth = 2;
    for (let i = -h; i < w + h; i += 6) {
      ctx.beginPath();
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i + h, y + h);
      ctx.stroke();
    }
  } else if (pat === 'dots') {
    const s = Math.max(6, w / 4);
    for (let iy = s / 2; iy < h; iy += s) {
      for (let ix = s / 2; ix < w; ix += s) {
        ctx.beginPath();
        ctx.arc(x + ix, y + iy, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (pat === 'grid') {
    ctx.lineWidth = 1.2;
    const s = Math.max(5, w / 4);
    for (let ix = s; ix < w; ix += s) {
      ctx.beginPath();
      ctx.moveTo(x + ix, y);
      ctx.lineTo(x + ix, y + h);
      ctx.stroke();
    }
    for (let iy = s; iy < h; iy += s) {
      ctx.beginPath();
      ctx.moveTo(x, y + iy);
      ctx.lineTo(x + w, y + iy);
      ctx.stroke();
    }
  } else if (pat === 'diamond') {
    ctx.lineWidth = 1.2;
    const s = Math.max(6, w / 3.5);
    for (let iy = 0; iy < h + s; iy += s) {
      for (let ix = 0; ix < w + s; ix += s) {
        ctx.beginPath();
        ctx.moveTo(x + ix, y + iy - s / 2);
        ctx.lineTo(x + ix + s / 2, y + iy);
        ctx.lineTo(x + ix, y + iy + s / 2);
        ctx.lineTo(x + ix - s / 2, y + iy);
        ctx.closePath();
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  const rw = Math.max(0, w);
  const rh = Math.max(0, h);
  const rr = Math.max(0, Math.min(r, rw / 2, rh / 2));
  ctx.beginPath();
  if (rw < 0.5 || rh < 0.5) {
    ctx.rect(x, y, rw, rh);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + rw, y, x + rw, y + rh, rr);
  ctx.arcTo(x + rw, y + rh, x, y + rh, rr);
  ctx.arcTo(x, y + rh, x, y, rr);
  ctx.arcTo(x, y, x + rw, y, rr);
  ctx.closePath();
}

export function shopTooltip(g, sq) {
  if (!sq) return '';
  if (sq.type === 'mark') return `マーク ${sq.label}（通過で入手／停止でイベント表スクラッチ）`;
  if (sq.type === 'holiday') return `${sq.label} — 止まるとお店が1ターン休み`;
  if (sq.type === 'minigame') {
    const names = {
      guess_dice: 'サイコロ当て',
      high_low: 'ハイ＆ロー',
      coin: 'コイントス',
      slot: 'ファイブスロット',
    };
    return `${sq.label} — 止まるとミニゲーム「${names[sq.game] || sq.game}」（外れても全員に参加賞）`;
  }
  if (sq.type === 'event') return `${sq.label} — 止まるとイベント発生`;
  if (sq.type === 'scratch') return `${sq.label} — 止まるとイベント表を1マススクラッチ`;
  if (sq.type === 'suit_fill') {
    return `${sq.label} — 通過／停止でワイルドカードを入手（最大4枚・銀行でレベルアップできるときだけ必要枚数を消費）`;
  }
  if (sq.type === 'lucky') return `${sq.label} — ラッキーステータス獲得`;
  if (sq.type === 'rollon') return `${sq.label} — もう一度サイコロ`;
  if (sq.type === 'stockbroker') return `${sq.label} — 株を1種類購入`;
  if (sq.type === 'warp') {
    const dest = g.map.find((n) => n.id === sq.warpTo);
    return `${sq.label} — 止まると${dest ? `「${dest.label}」へ` : ''}ワープ`;
  }
  if (sq.type === 'warp_random') {
    return `${sq.label} — 止まると小島のいずれかの転移マスへランダム転移`;
  }
  if (sq.type === 'shaft') {
    return sq.shaft === 'down'
      ? `${sq.label} — 乗ると地下一階へ下降（残りの出目で移動継続）`
      : `${sq.label} — 乗ると一階へ上昇（残りの出目で移動継続）`;
  }
  if (sq.type === 'pit') {
    return sq.pit === 'down'
      ? `${sq.label} — ぴったり止まると地下二階へ転移`
      : `${sq.label} — ぴったり止まると地下一階の転移下降へランダム移動`;
  }
  if (sq.type === 'ore') {
    const kind = sq.ore === 'gold' ? '金（どの目でも賞金）' : sq.ore === 'diamond' ? 'ダイヤ（8面・大当たりあり）' : '鉄（低目は空振り）';
    return `${sq.label} — 通過時にダイスで賞金（${kind}）`;
  }
  if (sq.type === 'potion') {
    return `${sq.label} — 止まると全員で伏せカードを選ぶ（6種・同じカード可）`;
  }
  if (sq.type === 'gate') {
    return `${sq.label} — 入ると反対側の門へ飛び、残りの出目で移動継続`;
  }
  if (sq.type === 'switch') {
    const st = g.switchState ? 2 : 1;
    return `${sq.label} — 止まると経路・動くマスが切り替わる（今は状態${st}）`;
  }
  if (sq.type === 'rest') return `${sq.label} — 止まると次ターン休み`;
  if (sq.type !== 'shop') return `${sq.label}`;
  const owner = sq.owner >= 0 ? g.players[sq.owner]?.name : '空き';
  const toll = calcToll(g, sq);
  const closed = sq.owner >= 0 && g.players[sq.owner]?.shopsClosed ? '／店休中（買い物料0）' : '';
  const ownTag = sq.owner >= 0 ? `【${owner}の店】` : '【空き】';
  const areaCode = getAreaCode(g, sq.area);
  const areaName = g.areas[sq.area]?.name || AREA_META[sq.area]?.name || '';
  const areaTag = areaName ? `${areaCode} ${areaName}` : areaCode;
  let mono = '';
  if (sq.owner >= 0) {
    const areaSize = getAreaShops(g, sq.area).length;
    const cnt = getPlayerAreaCount(g, sq.owner, sq.area);
    const multi = getTollMulti(cnt, areaSize);
    if (hasAreaMonopoly(g, sq.owner, sq.area)) {
      mono = `／独占×${multi}`;
    } else if (cnt > 1) {
      mono = `／${cnt}/${areaSize}軒×${multi}`;
    }
  }
  const tollLabel = sq.owner >= 0
    ? `止まると買い物料 ${toll.toLocaleString()}G`
    : '空き店（買い物料なし）';
  const rem = sq.owner >= 0
    ? ` / 残り増資 ${getRemainingInvest(g, sq).toLocaleString()}G`
    : '';
  return `${ownTag} ${sq.label} / ${areaTag} / 価格${sq.price.toLocaleString()}G / ${tollLabel}${mono}${closed}${rem}`;
}
