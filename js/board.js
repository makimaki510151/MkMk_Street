/** MkMk Street — ボード定義（いただきストリート風・外周ループ） */

export const AREA_META = {
  1: { name: '桜通り', color: '#e85d75' },
  2: { name: '青葉通り', color: '#3cb371' },
  3: { name: '港町', color: '#3d8bfd' },
  4: { name: '陽だまり', color: '#f0a202' },
  5: { name: '月見坂', color: '#9b6bff' },
  6: { name: '市場横丁', color: '#20c997' },
};

export const SUIT_LABELS = ['♠', '♥', '♦', '♣'];

export const DEFAULT_GOAL = 10000;
export const DEFAULT_CASH = 2000;

/**
 * 外周ループのマップを生成する。
 * col/row は描画用グリッド座標（時計回り）。
 */
export function buildBoard() {
  const nodes = [];
  let nid = 0;
  const N = (type, o = {}) => {
    const n = { id: nid++, type, nexts: [], ...o };
    nodes.push(n);
    return n;
  };

  // ── 下辺（左→右は後でリンク。銀行は下辺中央）──
  // 時計回り: 銀行 → 右へ → 右辺上へ → 上辺左へ → 左辺下へ → 下辺右へ戻る

  const bank = N('bank', { label: '銀行', isStart: true, col: 5, row: 10 });
  const roll = N('rollon', { label: 'もう一回', col: 6, row: 10 });
  const botA = N('shop', { label: '薬局', area: 4, basePrice: 160, col: 7, row: 10 });
  const stockBot = N('stockbroker', { label: '証券', col: 8, row: 10 });
  const botB = N('shop', { label: '雑貨屋', area: 4, basePrice: 130, col: 9, row: 10 });

  // 右辺（下→上）エリア4・3
  const r1 = N('shop', { label: '屋台', area: 4, basePrice: 90, col: 10, row: 9 });
  const r2 = N('shop', { label: '遊園地', area: 4, basePrice: 500, col: 10, row: 8 });
  const chanceR = N('chance', { label: 'チャンス', col: 10, row: 7 });
  const r3 = N('shop', { label: '映画館', area: 4, basePrice: 300, col: 10, row: 6 });
  const lucky = N('lucky', { label: '★', col: 10, row: 5 });
  const r4 = N('shop', { label: 'ゲーム店', area: 3, basePrice: 170, col: 10, row: 4 });
  const r5 = N('shop', { label: '港食堂', area: 3, basePrice: 240, col: 10, row: 3 });
  const restR = N('rest', { label: '休憩', col: 10, row: 2 });
  const r6 = N('shop', { label: '水族館', area: 3, basePrice: 420, col: 10, row: 1 });
  const r7 = N('shop', { label: 'ホテル', area: 3, basePrice: 380, col: 10, row: 0 });

  // 上辺（右→左）エリア2
  const t1 = N('shop', { label: '土産物', area: 3, basePrice: 110, col: 9, row: 0 });
  const hrt = N('mark', { label: '♥', mark: 1, col: 8, row: 0 });
  const t2 = N('shop', { label: 'スーパー', area: 2, basePrice: 350, col: 7, row: 0 });
  const t3 = N('shop', { label: 'ファミレス', area: 2, basePrice: 260, col: 6, row: 0 });
  const stockTop = N('stockbroker', { label: '証券', col: 5, row: 0 });
  const t4 = N('shop', { label: 'コンビニ', area: 2, basePrice: 200, col: 4, row: 0 });
  const t5 = N('shop', { label: 'ラーメン', area: 2, basePrice: 140, col: 3, row: 0 });
  const spa = N('mark', { label: '♠', mark: 0, col: 2, row: 0 });
  const t6 = N('shop', { label: 'ジュエリー', area: 1, basePrice: 450, col: 1, row: 0 });

  // 左上・左辺（上→下）エリア1・5
  const l1 = N('shop', { label: 'ブティック', area: 1, basePrice: 280, col: 0, row: 0 });
  const chanceL = N('chance', { label: 'チャンス', col: 0, row: 1 });
  const l2 = N('shop', { label: 'パン屋', area: 1, basePrice: 160, col: 0, row: 2 });
  const l3 = N('shop', { label: '花屋', area: 1, basePrice: 120, col: 0, row: 3 });
  const l4 = N('shop', { label: '旅館', area: 5, basePrice: 400, col: 0, row: 4 });
  const dia = N('mark', { label: '♦', mark: 2, col: 0, row: 5 });
  const l5 = N('shop', { label: 'ギャラリー', area: 5, basePrice: 320, col: 0, row: 6 });
  const restL = N('rest', { label: '休憩', col: 0, row: 7 });
  const l6 = N('shop', { label: 'カフェ', area: 5, basePrice: 180, col: 0, row: 8 });
  const l7 = N('shop', { label: '古本屋', area: 5, basePrice: 80, col: 0, row: 9 });

  // 下辺左（左→右）エリア6 → 銀行へ
  const b1 = N('shop', { label: '魚市場', area: 6, basePrice: 280, col: 0, row: 10 });
  const club = N('mark', { label: '♣', mark: 3, col: 1, row: 10 });
  const b2 = N('shop', { label: '寿司屋', area: 6, basePrice: 220, col: 2, row: 10 });
  const b3 = N('shop', { label: 'うどん屋', area: 6, basePrice: 150, col: 3, row: 10 });
  const b4 = N('shop', { label: 'たこ焼き', area: 6, basePrice: 100, col: 4, row: 10 });

  const path = [
    bank, roll, botA, stockBot, botB,
    r1, r2, chanceR, r3, lucky, r4, r5, restR, r6, r7,
    t1, hrt, t2, t3, stockTop, t4, t5, spa, t6,
    l1, chanceL, l2, l3, l4, dia, l5, restL, l6, l7,
    b1, club, b2, b3, b4,
  ];

  for (let i = 0; i < path.length; i++) {
    path[i].nexts = [path[(i + 1) % path.length].id];
  }

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
