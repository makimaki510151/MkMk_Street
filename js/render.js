/** MkMk Street — ボード描画 */

import { AREA_META, SUIT_LABELS } from './board.js';
import { calcToll } from './engine.js';

const TYPE_ICON = {
  bank: '銀',
  shop: '',
  mark: '',
  rest: '休',
  holiday: '店休',
  minigame: '遊',
  event: 'EV',
  scratch: '削',
  chance: '？',
  stockbroker: '株',
  lucky: '★',
  rollon: '再',
  junction: '分岐',
};

const MINIGAME_ICON = {
  guess_dice: '賽',
  high_low: 'HL',
  coin: '貨',
  slot: 'スロ',
};

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let anim = {
    pulse: 0,
    /** @type {Record<number, {fromId:number,toId:number,start:number,dur:number}>} */
    moves: {},
    diceSpin: 0,
  };
  let raf = 0;
  let layout = { size: 40, ox: 0, oy: 0 };
  /** 株購入中に盤面で強調するエリア番号（null=強調なし / 'all'=全店にA番号） */
  let stockHighlightArea = null;
  let stockHighlightMode = false;

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
  }

  function cellSize(g, viewW, viewH) {
    const pad = 16;
    const cw = (viewW - pad * 2) / g.cols;
    const ch = (viewH - pad * 2) / g.rows;
    return Math.min(cw, ch);
  }

  function cellOrigin(g, viewW, viewH, size) {
    const boardW = size * g.cols;
    const boardH = size * g.rows;
    return {
      ox: (viewW - boardW) / 2,
      oy: (viewH - boardH) / 2,
    };
  }

  function nodeCenter(g, nodeId) {
    const n = g.map.find((x) => x.id === nodeId);
    if (!n) return null;
    return {
      x: layout.ox + n.col * layout.size + layout.size / 2,
      y: layout.oy + n.row * layout.size + layout.size / 2,
    };
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

  function tokenDrawPos(g, p, stackIndex, stackCount) {
    const oxf = (stackIndex - (stackCount - 1) / 2) * layout.size * 0.22;
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

  function draw(g) {
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

    const size = cellSize(g, viewW, viewH);
    const { ox, oy } = cellOrigin(g, viewW, viewH, size);
    layout = { size, ox, oy };
    anim.pulse = (anim.pulse + 0.04) % (Math.PI * 2);

    // パス
    ctx.strokeStyle = 'rgba(255, 210, 120, 0.28)';
    ctx.lineWidth = Math.max(4, size * 0.18);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const n of g.map) {
      const x = ox + n.col * size + size / 2;
      const y = oy + n.row * size + size / 2;
      for (const nid of n.nexts) {
        const m = g.map.find((x) => x.id === nid);
        if (!m) continue;
        ctx.moveTo(x, y);
        ctx.lineTo(ox + m.col * size + size / 2, oy + m.row * size + size / 2);
      }
    }
    ctx.stroke();

    // マス
    for (const n of g.map) {
      const x = ox + n.col * size;
      const y = oy + n.row * size;
      const pad = size * 0.08;
      const r = size * 0.14;
      roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, r);

      let fill = '#2a4050';
      let stroke = 'rgba(255,255,255,0.15)';
      const owner = n.type === 'shop' && n.owner >= 0 ? g.players[n.owner] : null;
      if (n.type === 'shop') {
        fill = AREA_META[n.area]?.color || '#51607a';
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
      else if (n.type === 'junction') fill = '#5a4a3a';

      const forkOpt = g.phase === 'await_fork' && g.pending?.options?.some((o) => o.id === n.id);
      const stockMode = stockHighlightMode || (g.phase === 'await_choice' && g.pending?.type === 'stock');
      const areaHot = stockMode && n.type === 'shop' && (
        stockHighlightArea == null
          ? true
          : Number(stockHighlightArea) === Number(n.area)
      );
      const areaDim = stockMode && n.type === 'shop' && stockHighlightArea != null
        && Number(stockHighlightArea) !== Number(n.area);

      ctx.fillStyle = fill;
      ctx.fill();

      if (n.type === 'shop') {
        const meta = AREA_META[n.area];
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

      // 株購入中：エリア色の縁取り（全体表示 or 選択/ホバー中を強調）
      if (areaHot && n.type === 'shop') {
        ctx.save();
        const selected = stockHighlightArea != null;
        const glow = selected
          ? 0.4 + Math.sin(anim.pulse) * 0.25
          : 0.22 + Math.sin(anim.pulse) * 0.08;
        ctx.globalAlpha = glow;
        ctx.strokeStyle = AREA_META[n.area]?.patternInk || AREA_META[n.area]?.color || '#ffe08a';
        ctx.lineWidth = selected ? 4.5 : 2.5;
        roundRect(ctx, x + pad - 1, y + pad - 1, size - pad * 2 + 2, size - pad * 2 + 2, r + 1);
        ctx.stroke();
        if (selected) {
          ctx.globalAlpha = 0.24 + Math.sin(anim.pulse) * 0.12;
          ctx.fillStyle = AREA_META[n.area]?.color || '#ffe08a';
          roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, r);
          ctx.fill();
        }
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
        if (stockMode) {
          // 株購入中はエリア番号を大きく表示
          ctx.font = `900 ${Math.max(11, size * 0.28)}px "Fredoka", "Zen Maru Gothic", sans-serif`;
          ctx.fillStyle = areaDim ? 'rgba(255,255,255,0.35)' : '#ffe08a';
          ctx.fillText(`A${n.area}`, x + size / 2, y + size / 2 - size * 0.12);
          ctx.font = `700 ${Math.max(8, size * 0.16)}px "Zen Maru Gothic", sans-serif`;
          ctx.fillStyle = areaDim ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.95)';
          ctx.fillText(n.label.slice(0, 3), x + size / 2, y + size / 2 + size * 0.16);
        } else {
          ctx.font = `700 ${Math.max(9, size * 0.2)}px "Zen Maru Gothic", sans-serif`;
          ctx.fillText(n.label.slice(0, 3), x + size / 2, y + size / 2 - size * 0.02);
          ctx.font = `600 ${Math.max(8, size * 0.16)}px "Zen Maru Gothic", sans-serif`;
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          ctx.fillText(`${n.price}G`, x + size / 2, y + size / 2 + size * 0.24);
        }
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
    }

    // コマ
    const byPos = {};
    g.players.forEach((p) => {
      if (p.bankrupt) return;
      if (!byPos[p.pos]) byPos[p.pos] = [];
      byPos[p.pos].push(p);
    });

    for (const p of g.players) {
      if (p.bankrupt) continue;
      const list = byPos[p.pos] || [p];
      const idx = list.indexOf(p);
      const pos = tokenDrawPos(g, p, Math.max(0, idx), list.length);
      if (!pos) continue;
      const rad = layout.size * 0.16;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, rad, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (g.currentPlayerIdx === p.id) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, rad + 4 + Math.sin(anim.pulse) * 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,224,120,0.85)';
        ctx.stroke();
      }
    }

    // ブランド（空き象限）
    const brandX = ox + size * 2.5;
    const brandY = oy + size * 2.5;
    ctx.save();
    ctx.fillStyle = 'rgba(12, 28, 32, 0.42)';
    roundRect(ctx, brandX - size * 1.35, brandY - size * 0.7, size * 2.7, size * 1.4, 12);
    ctx.fill();
    ctx.fillStyle = '#ffe08a';
    ctx.font = `900 ${Math.max(14, size * 0.32)}px "Fredoka", "Zen Maru Gothic", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MkMk Street', brandX, brandY - size * 0.18);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `600 ${Math.max(10, size * 0.18)}px "Zen Maru Gothic", sans-serif`;
    ctx.fillText(`目標 ${g.goal.toLocaleString()}G`, brandX, brandY + size * 0.28);
    ctx.restore();
  }

  function startLoop(getState) {
    cancelAnimationFrame(raf);
    const tick = () => {
      draw(getState());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
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
    const size = cellSize(g, viewW, viewH);
    const { ox, oy } = cellOrigin(g, viewW, viewH, size);
    for (const n of g.map) {
      const cx = ox + n.col * size;
      const cy = oy + n.row * size;
      if (x >= cx && x <= cx + size && y >= cy && y <= cy + size) return n;
    }
    return null;
  }

  /** @param {number|null} area 強調するエリア。null で解除。mode=true で株UI中のA番号表示 */
  function setStockHighlight(area, mode = true) {
    stockHighlightMode = !!mode;
    stockHighlightArea = area == null ? null : Number(area);
  }

  function clearStockHighlight() {
    stockHighlightMode = false;
    stockHighlightArea = null;
  }

  return { resize, draw, startLoop, stop, hitTest, animateToken, setStockHighlight, clearStockHighlight };
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
      slot: 'スリースロット',
    };
    return `${sq.label} — 止まるとミニゲーム「${names[sq.game] || sq.game}」（外れても全員に参加賞）`;
  }
  if (sq.type === 'event') return `${sq.label} — 止まるとイベント発生`;
  if (sq.type === 'scratch') return `${sq.label} — 止まるとイベント表を1マススクラッチ`;
  if (sq.type === 'rest') return `${sq.label} — 止まると次ターン休み`;
  if (sq.type !== 'shop') return `${sq.label}`;
  const owner = sq.owner >= 0 ? g.players[sq.owner]?.name : '空き';
  const toll = calcToll(g, sq);
  const closed = sq.owner >= 0 && g.players[sq.owner]?.shopsClosed ? '／店休中' : '';
  const ownTag = sq.owner >= 0 ? `【${owner}の店】` : '【空き】';
  return `${ownTag} ${sq.label} / ${AREA_META[sq.area]?.name || ''} / 価格${sq.price}G / 料${toll}G${closed}`;
}
