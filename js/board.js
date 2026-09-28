/** MkMk Street — 本家いただきストリート風・分岐マップ */

export const AREA_META = {
  1: { name: '桜通り', color: '#e85d75' },
  2: { name: '青葉通り', color: '#3cb371' },
  3: { name: '港町', color: '#3d8bfd' },
  4: { name: '陽だまり', color: '#f0a202' },
  5: { name: '月見坂', color: '#9b6bff' },
  6: { name: '市場横丁', color: '#20c997' },
  7: { name: '中央広場', color: '#c45c26' },
  8: { name: '駅前', color: '#5c7cfa' },
};

export const SUIT_LABELS = ['♠', '♥', '♦', '♣'];

export const DEFAULT_GOAL = 10000;
export const DEFAULT_CASH = 2000;

function link(...pairs) {
  for (const [a, b] of pairs) {
    if (!a.nexts.includes(b.id)) a.nexts.push(b.id);
    if (!b.nexts.includes(a.id)) b.nexts.push(a.id);
  }
}

/**
 * 銀行を中心に十字＋外周ループの分岐グラフ。
 * マーク地点・四隅でルートが分かれる（1本道ではない）。
 */
export function buildBoard() {
  const nodes = [];
  let nid = 0;
  const N = (type, o = {}) => {
    const n = { id: nid++, type, nexts: [], ...o };
    nodes.push(n);
    return n;
  };

  // ── 中央銀行（4方向分岐）──
  const bank = N('bank', { label: '銀行', isStart: true, col: 5, row: 5 });

  // ── 十字アーム（銀行 ↔ 各マーク）──
  // 北
  const n1 = N('shop', { label: '喫茶店', area: 7, basePrice: 200, col: 5, row: 4 });
  const n2 = N('rest', { label: '休憩', col: 5, row: 3 });
  const n3 = N('shop', { label: '花屋', area: 7, basePrice: 160, col: 5, row: 2 });
  const n4 = N('chance', { label: 'チャンス', col: 5, row: 1 });
  const spa = N('mark', { label: '♠', mark: 0, col: 5, row: 0 });

  // 東
  const e1 = N('shop', { label: '本屋', area: 8, basePrice: 180, col: 6, row: 5 });
  const e2 = N('stockbroker', { label: '証券', col: 7, row: 5 });
  const e3 = N('shop', { label: '雑貨屋', area: 8, basePrice: 140, col: 8, row: 5 });
  const e4 = N('rollon', { label: 'もう一回', col: 9, row: 5 });
  const hrt = N('mark', { label: '♥', mark: 1, col: 10, row: 5 });

  // 南
  const s1 = N('shop', { label: '弁当屋', area: 7, basePrice: 120, col: 5, row: 6 });
  const s2 = N('lucky', { label: '★', col: 5, row: 7 });
  const s3 = N('shop', { label: '時計店', area: 7, basePrice: 280, col: 5, row: 8 });
  const s4 = N('chance', { label: 'チャンス', col: 5, row: 9 });
  const club = N('mark', { label: '♣', mark: 3, col: 5, row: 10 });

  // 西
  const w1 = N('shop', { label: '靴屋', area: 8, basePrice: 220, col: 4, row: 5 });
  const w2 = N('stockbroker', { label: '証券', col: 3, row: 5 });
  const w3 = N('shop', { label: '眼鏡店', area: 8, basePrice: 190, col: 2, row: 5 });
  const w4 = N('rest', { label: '休憩', col: 1, row: 5 });
  const dia = N('mark', { label: '♦', mark: 2, col: 0, row: 5 });

  link([bank, n1], [n1, n2], [n2, n3], [n3, n4], [n4, spa]);
  link([bank, e1], [e1, e2], [e2, e3], [e3, e4], [e4, hrt]);
  link([bank, s1], [s1, s2], [s2, s3], [s3, s4], [s4, club]);
  link([bank, w1], [w1, w2], [w2, w3], [w3, w4], [w4, dia]);

  // ── 四隅ジャンクション ──
  const jnNW = N('junction', { label: '分岐', col: 0, row: 0 });
  const jnNE = N('junction', { label: '分岐', col: 10, row: 0 });
  const jnSW = N('junction', { label: '分岐', col: 0, row: 10 });
  const jnSE = N('junction', { label: '分岐', col: 10, row: 10 });

  // ── 外周：北辺（♠ から左右へ）エリア1・2 ──
  const a1 = N('shop', { label: 'カフェ', area: 1, basePrice: 290, col: 4, row: 0 });
  const a2 = N('shop', { label: '洋服屋', area: 1, basePrice: 410, col: 3, row: 0 });
  const a3 = N('shop', { label: 'パン屋', area: 1, basePrice: 190, col: 2, row: 0 });
  const a4 = N('shop', { label: 'アクセ', area: 1, basePrice: 350, col: 1, row: 0 });

  const b1 = N('shop', { label: 'ラーメン', area: 2, basePrice: 280, col: 6, row: 0 });
  const b2 = N('shop', { label: 'ファミレス', area: 2, basePrice: 300, col: 7, row: 0 });
  const b3 = N('shop', { label: 'コンビニ', area: 2, basePrice: 170, col: 8, row: 0 });
  const b4 = N('shop', { label: 'スーパー', area: 2, basePrice: 360, col: 9, row: 0 });

  link([spa, a1], [a1, a2], [a2, a3], [a3, a4], [a4, jnNW]);
  link([spa, b1], [b1, b2], [b2, b3], [b3, b4], [b4, jnNE]);

  // ── 外周：東辺（♥ の上下）エリア3 ──
  const c1 = N('shop', { label: 'ホテル', area: 3, basePrice: 420, col: 10, row: 1 });
  const c2 = N('shop', { label: '水族館', area: 3, basePrice: 380, col: 10, row: 2 });
  const c3 = N('shop', { label: '港食堂', area: 3, basePrice: 240, col: 10, row: 3 });
  const c4 = N('shop', { label: '土産物', area: 3, basePrice: 150, col: 10, row: 4 });

  const d1 = N('shop', { label: 'ゲーム店', area: 3, basePrice: 200, col: 10, row: 6 });
  const d2 = N('shop', { label: '映画館', area: 4, basePrice: 300, col: 10, row: 7 });
  const d3 = N('shop', { label: '遊園地', area: 4, basePrice: 500, col: 10, row: 8 });
  const d4 = N('shop', { label: '屋台', area: 4, basePrice: 90, col: 10, row: 9 });

  link([jnNE, c1], [c1, c2], [c2, c3], [c3, c4], [c4, hrt]);
  link([hrt, d1], [d1, d2], [d2, d3], [d3, d4], [d4, jnSE]);

  // ── 外周：南辺（♣ から左右）エリア4・5 ──
  const f1 = N('shop', { label: '薬局', area: 4, basePrice: 160, col: 6, row: 10 });
  const f2 = N('shop', { label: '雑貨', area: 4, basePrice: 130, col: 7, row: 10 });
  const f3 = N('shop', { label: '百均', area: 4, basePrice: 80, col: 8, row: 10 });
  const f4 = N('shop', { label: '家電', area: 4, basePrice: 340, col: 9, row: 10 });

  const g1 = N('shop', { label: 'たこ焼き', area: 5, basePrice: 100, col: 4, row: 10 });
  const g2 = N('shop', { label: 'うどん屋', area: 5, basePrice: 150, col: 3, row: 10 });
  const g3 = N('shop', { label: '寿司屋', area: 5, basePrice: 260, col: 2, row: 10 });
  const g4 = N('shop', { label: '魚市場', area: 5, basePrice: 310, col: 1, row: 10 });

  link([club, f1], [f1, f2], [f2, f3], [f3, f4], [f4, jnSE]);
  link([club, g1], [g1, g2], [g2, g3], [g3, g4], [g4, jnSW]);

  // ── 外周：西辺（♦ の上下）エリア6 ──
  const h1 = N('shop', { label: '古本屋', area: 6, basePrice: 70, col: 0, row: 4 });
  const h2 = N('shop', { label: 'カフェ2', area: 6, basePrice: 180, col: 0, row: 3 });
  const h3 = N('shop', { label: 'ギャラリー', area: 6, basePrice: 320, col: 0, row: 2 });
  const h4 = N('shop', { label: '旅館', area: 6, basePrice: 400, col: 0, row: 1 });

  const i1 = N('shop', { label: '美容院', area: 6, basePrice: 210, col: 0, row: 6 });
  const i2 = N('shop', { label: 'カラオケ', area: 6, basePrice: 230, col: 0, row: 7 });
  const i3 = N('shop', { label: '銭湯', area: 5, basePrice: 170, col: 0, row: 8 });
  const i4 = N('shop', { label: '八百屋', area: 5, basePrice: 140, col: 0, row: 9 });

  link([dia, h1], [h1, h2], [h2, h3], [h3, h4], [h4, jnNW]);
  link([dia, i1], [i1, i2], [i2, i3], [i3, i4], [i4, jnSW]);

  // お店初期化
  for (const sq of nodes) {
    if (sq.type === 'shop') {
      sq.owner = -1;
      sq.price = sq.basePrice;
      sq.extraInvest = 0;
      sq.baseToll = Math.max(1, Math.floor(sq.basePrice * 0.21) - 10);
    }
  }

  const areaIds = [...new Set(nodes.filter((n) => n.type === 'shop').map((n) => n.area))];
  const areas = {};
  for (const a of areaIds) {
    const shops = nodes.filter((n) => n.type === 'shop' && n.area === a);
    const avg = shops.reduce((s, n) => s + n.basePrice, 0) / shops.length;
    const targetStock = Math.max(1, Math.floor(avg / 10));
    areas[a] = {
      B: Math.ceil((targetStock * 65536) / avg),
      stockPrice: targetStock,
      name: AREA_META[a]?.name || `エリア${a}`,
      color: AREA_META[a]?.color || '#888',
    };
  }

  return {
    nodes,
    areas,
    startId: bank.id,
    initialCash: DEFAULT_CASH,
    goal: DEFAULT_GOAL,
    cols: 11,
    rows: 11,
  };
}

/** 進行方向の矢印ラベル（UI用） */
export function dirLabel(from, to) {
  if (!from || !to) return '進む';
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  if (Math.abs(dc) >= Math.abs(dr)) return dc > 0 ? '→ 右' : '← 左';
  return dr > 0 ? '↓ 下' : '↑ 上';
}
