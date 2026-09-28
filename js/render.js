/** MkMk Street — ボード描画 */

import { AREA_META, SUIT_LABELS } from './board.js';
import { calcToll } from './engine.js';

const TYPE_ICON = {
  bank: '銀',
  shop: '',
  mark: '',
  rest: '休',
  chance: '？',
  stockbroker: '株',
  lucky: '★',
  rollon: '再',
  junction: '分岐',
};

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let anim = { tokens: {}, focusId: null, pulse: 0 };
  let raf = 0;

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

  function draw(g, localPlayerId = null) {
    const viewW = canvas.clientWidth;
    const viewH = canvas.clientHeight;
    ctx.clearRect(0, 0, viewW, viewH);

    // 雰囲気背景
    const grad = ctx.createLinearGradient(0, 0, viewW, viewH);
    grad.addColorStop(0, '#1a3a3a');
    grad.addColorStop(0.45, '#234846');
    grad.addColorStop(1, '#1e2f4a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, viewW, viewH);

    // ドットパターン
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
    anim.pulse = (anim.pulse + 0.04) % (Math.PI * 2);

    // パスの線
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
      if (n.type === 'shop') {
        fill = AREA_META[n.area]?.color || '#666';
        if (n.owner >= 0) {
          const owner = g.players[n.owner];
          stroke = owner?.color || '#fff';
        }
      } else if (n.type === 'bank') {
        fill = '#d4a017';
      } else if (n.type === 'mark') {
        fill = '#3a2f55';
      } else if (n.type === 'chance') {
        fill = '#c45c26';
      } else if (n.type === 'stockbroker') {
        fill = '#2f6f6a';
      } else if (n.type === 'rest') {
        fill = '#4a6a7a';
      } else if (n.type === 'lucky') {
        fill = '#b8860b';
      } else if (n.type === 'rollon') {
        fill = '#2d6a4f';
      } else if (n.type === 'junction') {
        fill = '#5a4a3a';
      }

      // 分岐候補のハイライト
      const forkOpt = g.phase === 'await_fork' && g.pending?.options?.some((o) => o.id === n.id);

      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = forkOpt ? '#ffe08a' : stroke;
      ctx.lineWidth = forkOpt ? 4 : (n.owner >= 0 ? 3 : 1.5);
      ctx.stroke();

      if (forkOpt) {
        ctx.save();
        ctx.globalAlpha = 0.35 + Math.sin(anim.pulse) * 0.15;
        ctx.fillStyle = '#ffe08a';
        ctx.fill();
        ctx.restore();
      }

      // 現在マスのパルス
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
        ctx.font = `700 ${Math.max(9, size * 0.22)}px "Zen Maru Gothic", sans-serif`;
        ctx.fillText(n.label.slice(0, 3), x + size / 2, y + size / 2 - size * 0.12);
        ctx.font = `600 ${Math.max(8, size * 0.18)}px "Zen Maru Gothic", sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillText(`${n.price}G`, x + size / 2, y + size / 2 + size * 0.18);
      } else if (n.type === 'mark') {
        ctx.font = `900 ${Math.max(16, size * 0.42)}px "Fredoka", sans-serif`;
        ctx.fillText(SUIT_LABELS[n.mark], x + size / 2, y + size / 2);
      } else {
        ctx.font = `800 ${Math.max(11, size * 0.28)}px "Zen Maru Gothic", sans-serif`;
        ctx.fillText(TYPE_ICON[n.type] || n.label.slice(0, 2), x + size / 2, y + size / 2);
      }
    }

    // コマ
    const byPos = {};
    g.players.forEach((p, i) => {
      if (p.bankrupt) return;
      if (!byPos[p.pos]) byPos[p.pos] = [];
      byPos[p.pos].push(p);
    });

    for (const [pos, list] of Object.entries(byPos)) {
      const n = g.map.find((x) => x.id === Number(pos));
      if (!n) continue;
      const cx = ox + n.col * size + size / 2;
      const cy = oy + n.row * size + size / 2;
      list.forEach((p, i) => {
        const oxf = (i - (list.length - 1) / 2) * size * 0.22;
        const r = size * 0.16;
        ctx.beginPath();
        ctx.arc(cx + oxf, cy + size * 0.28, r, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        if (g.currentPlayerIdx === p.id) {
          ctx.beginPath();
          ctx.arc(cx + oxf, cy + size * 0.28, r + 4 + Math.sin(anim.pulse) * 2, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,224,120,0.8)';
          ctx.stroke();
        }
      });
    }

    // 中央ブランドプレート
    const midX = ox + (g.cols * size) / 2;
    const midY = oy + (g.rows * size) / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(12, 28, 32, 0.55)';
    roundRect(ctx, midX - size * 2.2, midY - size * 1.1, size * 4.4, size * 2.2, 16);
    ctx.fill();
    ctx.fillStyle = '#ffe08a';
    ctx.font = `900 ${Math.max(18, size * 0.45)}px "Fredoka", "Zen Maru Gothic", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MkMk Street', midX, midY - size * 0.25);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `600 ${Math.max(11, size * 0.22)}px "Zen Maru Gothic", sans-serif`;
    ctx.fillText(`目標 ${g.goal.toLocaleString()}G`, midX, midY + size * 0.35);
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

  return { resize, draw, startLoop, stop, hitTest };
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function shopTooltip(g, sq) {
  if (!sq) return '';
  if (sq.type !== 'shop') return `${sq.label}`;
  const owner = sq.owner >= 0 ? g.players[sq.owner]?.name : '空き';
  const toll = calcToll(g, sq);
  return `${sq.label} / ${AREA_META[sq.area]?.name || ''} / 価格${sq.price}G / 料${toll}G / ${owner}`;
}
