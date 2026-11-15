/** MkMk Street — 本家いただきストリート風・分岐マップ群 */

/**
 * 店グループ色は非暖色・プレイヤー単色と混ざらないクール系。
 * pattern: check | stripe | dots | grid | diamond
 */
export const AREA_META = {
  1: { name: '桜通り', color: '#5b7c99', pattern: 'check', patternInk: '#9eb6c9' },
  2: { name: '青葉通り', color: '#3d6b5e', pattern: 'stripe', patternInk: '#7fad9c' },
  3: { name: '港町', color: '#4a6fa5', pattern: 'dots', patternInk: '#8fb0d9' },
  4: { name: '陽だまり', color: '#5c6bc0', pattern: 'grid', patternInk: '#9aa6e0' },
  5: { name: '月見坂', color: '#6a5b8c', pattern: 'diamond', patternInk: '#a899c4' },
  6: { name: '市場横丁', color: '#2f6f7a', pattern: 'check', patternInk: '#6ea8b3' },
  7: { name: '夕焼け通り', color: '#455a7a', pattern: 'stripe', patternInk: '#7f95b5' },
  8: { name: '温泉通り', color: '#51607a', pattern: 'dots', patternInk: '#8a9ab3' },
  9: { name: '中央広場', color: '#3f5f6b', pattern: 'grid', patternInk: '#7a9aa6' },
  10: { name: '駅前', color: '#4d5f8a', pattern: 'diamond', patternInk: '#8796bc' },
  11: { name: 'がけした', color: '#3a6a72', pattern: 'stripe', patternInk: '#6f9aa3' },
  12: { name: '潮風通り', color: '#4f6d8c', pattern: 'check', patternInk: '#8aa3bd' },
};

/** 1グループ（株エリア）あたりのお店数の上限 */
export const AREA_SHOP_MAX = 5;
/** 基本のお店数 */
export const AREA_SHOP_BASE = 4;

export const SUIT_LABELS = ['♠', '♥', '♦', '♣'];

export const DEFAULT_GOAL = 10000;
export const DEFAULT_CASH = 2000;
export const DEFAULT_MAP_ID = 'central_cross';

function link(...pairs) {
  for (const [a, b] of pairs) {
    if (!a.nexts.includes(b.id)) a.nexts.push(b.id);
    if (!b.nexts.includes(a.id)) b.nexts.push(a.id);
  }
}

function makeNodeFactory() {
  const nodes = [];
  let nid = 0;
  const N = (type, o = {}) => {
    const n = { id: nid++, type, nexts: [], ...o };
    nodes.push(n);
    return n;
  };
  return { nodes, N };
}

function finalizeShops(nodes) {
  for (const sq of nodes) {
    if (sq.type === 'shop') {
      sq.owner = -1;
      sq.price = sq.basePrice;
      sq.extraInvest = 0;
      sq.baseToll = Math.max(1, Math.floor(sq.basePrice * 0.21) - 10);
    }
  }
}

function buildAreas(nodes, areaOverrides = {}) {
  const areaIds = [...new Set(nodes.filter((n) => n.type === 'shop').map((n) => n.area))].sort((a, b) => a - b);
  const areas = {};
  for (const a of areaIds) {
    const shops = nodes.filter((n) => n.type === 'shop' && n.area === a);
    if (shops.length > AREA_SHOP_MAX) {
      throw new Error(`エリア${a}のお店が${shops.length}件（上限${AREA_SHOP_MAX}）`);
    }
    const avg = shops.reduce((s, n) => s + n.basePrice, 0) / shops.length;
    const targetStock = Math.max(1, Math.floor(avg / 10));
    const meta = { ...(AREA_META[a] || {}), ...(areaOverrides[a] || {}) };
    areas[a] = {
      B: Math.ceil((targetStock * 65536) / avg),
      stockPrice: targetStock,
      name: meta.name || `エリア${a}`,
      color: meta.color || '#888',
      pattern: meta.pattern || 'check',
      patternInk: meta.patternInk || '#aaa',
      shopCount: shops.length,
    };
  }
  return areas;
}

function freezeBaseNexts(nodes) {
  for (const n of nodes) {
    n.baseNexts = [...(n.nexts || [])];
  }
}

/**
 * スイッチ状態に応じて nexts / 座標を組み立てる（エンジンからも呼ぶ）。
 * @param {{ map: object[], switchState?: number, switchGates?: object[], switchMoves?: object[] }} g
 */
export function applySwitchState(g) {
  if (!g?.map) return;
  const state = g.switchState ? 1 : 0;
  for (const n of g.map) {
    const base = n.baseNexts || n.nexts || [];
    n.nexts = [...base];
  }
  for (const gate of g.switchGates || []) {
    if ((gate.when ? 1 : 0) !== state) continue;
    const a = g.map.find((n) => n.id === gate.a);
    const b = g.map.find((n) => n.id === gate.b);
    if (!a || !b) continue;
    if (!a.nexts.includes(b.id)) a.nexts.push(b.id);
    if (!b.nexts.includes(a.id)) b.nexts.push(a.id);
  }
  for (const mv of g.switchMoves || []) {
    const n = g.map.find((x) => x.id === mv.id);
    const pos = mv.pos?.[state];
    if (!n || !pos) continue;
    n.col = pos.col;
    n.row = pos.row;
  }
}

function packBoard(nodes, bank, cols, rows, extra = {}) {
  finalizeShops(nodes);
  freezeBaseNexts(nodes);
  const board = {
    nodes,
    areas: buildAreas(nodes, extra.areaOverrides),
    startId: bank.id,
    initialCash: extra.initialCash ?? DEFAULT_CASH,
    goal: extra.goal ?? DEFAULT_GOAL,
    cols,
    rows,
    mapId: extra.mapId,
    mapName: extra.mapName,
    switchState: extra.switchState || 0,
    switchGates: extra.switchGates || [],
    switchMoves: extra.switchMoves || [],
  };
  applySwitchState(board);
  return board;
}

/**
 * 銀行を中心に十字＋外周ループ（従来マップ）。
 */
export function buildCentralCross() {
  const { nodes, N } = makeNodeFactory();
  const bank = N('bank', { label: '銀行', isStart: true, col: 5, row: 5 });

  const n1 = N('shop', { label: '喫茶店', area: 9, basePrice: 200, col: 5, row: 4 });
  const n2 = N('lucky', { label: '★', col: 5, row: 3 });
  const n3 = N('shop', { label: '花屋', area: 9, basePrice: 160, col: 5, row: 2 });
  const n4 = N('chance', { label: 'チャンス', col: 5, row: 1 });
  const hubN = N('event', { label: 'イベント', col: 5, row: 0 });

  const e1 = N('shop', { label: '本屋', area: 10, basePrice: 180, col: 6, row: 5 });
  const e2 = N('stockbroker', { label: '証券', col: 7, row: 5 });
  const e3 = N('shop', { label: '雑貨屋', area: 10, basePrice: 140, col: 8, row: 5 });
  const e4 = N('rollon', { label: 'もう一回', col: 9, row: 5 });
  const hubE = N('minigame', { label: 'サイコロ', game: 'guess_dice', col: 10, row: 5 });

  const s1 = N('shop', { label: '弁当屋', area: 9, basePrice: 120, col: 5, row: 6 });
  const s2 = N('lucky', { label: '★', col: 5, row: 7 });
  const s3 = N('shop', { label: '時計店', area: 9, basePrice: 280, col: 5, row: 8 });
  const s4 = N('chance', { label: 'チャンス', col: 5, row: 9 });
  const hubS = N('minigame', { label: 'スロット', game: 'slot', col: 5, row: 10 });

  const w1 = N('shop', { label: '靴屋', area: 10, basePrice: 220, col: 4, row: 5 });
  const w2 = N('stockbroker', { label: '証券', col: 3, row: 5 });
  const w3 = N('shop', { label: '眼鏡店', area: 10, basePrice: 190, col: 2, row: 5 });
  const w4 = N('rollon', { label: 'もう一回', col: 1, row: 5 });
  const hubW = N('scratch', { label: 'スクラッチ', col: 0, row: 5 });

  link([bank, n1], [n1, n2], [n2, n3], [n3, n4], [n4, hubN]);
  link([bank, e1], [e1, e2], [e2, e3], [e3, e4], [e4, hubE]);
  link([bank, s1], [s1, s2], [s2, s3], [s3, s4], [s4, hubS]);
  link([bank, w1], [w1, w2], [w2, w3], [w3, w4], [w4, hubW]);

  const mkNW = N('mark', { label: '♠', mark: 0, col: 0, row: 0 });
  const mkNE = N('mark', { label: '♥', mark: 1, col: 10, row: 0 });
  const mkSE = N('mark', { label: '♣', mark: 3, col: 10, row: 10 });
  const mkSW = N('mark', { label: '♦', mark: 2, col: 0, row: 10 });

  const a1 = N('shop', { label: 'カフェ', area: 1, basePrice: 290, col: 4, row: 0 });
  const a2 = N('shop', { label: '洋服屋', area: 1, basePrice: 410, col: 3, row: 0 });
  const a3 = N('shop', { label: 'パン屋', area: 1, basePrice: 190, col: 2, row: 0 });
  const a4 = N('shop', { label: 'アクセ', area: 1, basePrice: 350, col: 1, row: 0 });

  const b1 = N('shop', { label: 'ラーメン', area: 2, basePrice: 280, col: 6, row: 0 });
  const b2 = N('shop', { label: 'ファミレス', area: 2, basePrice: 300, col: 7, row: 0 });
  const b3 = N('shop', { label: 'コンビニ', area: 2, basePrice: 170, col: 8, row: 0 });
  const b4 = N('shop', { label: 'スーパー', area: 2, basePrice: 360, col: 9, row: 0 });

  link([hubN, a1], [a1, a2], [a2, a3], [a3, a4], [a4, mkNW]);
  link([hubN, b1], [b1, b2], [b2, b3], [b3, b4], [b4, mkNE]);

  const c1 = N('shop', { label: 'ホテル', area: 3, basePrice: 420, col: 10, row: 1 });
  const c2 = N('shop', { label: '水族館', area: 3, basePrice: 380, col: 10, row: 2 });
  const c3 = N('shop', { label: '港食堂', area: 3, basePrice: 240, col: 10, row: 3 });
  const c4 = N('shop', { label: '土産物', area: 3, basePrice: 150, col: 10, row: 4 });

  const d1 = N('shop', { label: 'ゲーム店', area: 4, basePrice: 200, col: 10, row: 6 });
  const d2 = N('shop', { label: '映画館', area: 4, basePrice: 300, col: 10, row: 7 });
  const d3 = N('shop', { label: '遊園地', area: 4, basePrice: 500, col: 10, row: 8 });
  const d4 = N('shop', { label: '屋台', area: 4, basePrice: 90, col: 10, row: 9 });

  link([mkNE, c1], [c1, c2], [c2, c3], [c3, c4], [c4, hubE]);
  link([hubE, d1], [d1, d2], [d2, d3], [d3, d4], [d4, mkSE]);

  const f1 = N('shop', { label: '薬局', area: 5, basePrice: 160, col: 6, row: 10 });
  const f2 = N('shop', { label: '雑貨', area: 5, basePrice: 130, col: 7, row: 10 });
  const f3 = N('shop', { label: '百均', area: 5, basePrice: 80, col: 8, row: 10 });
  const f4 = N('shop', { label: '家電', area: 5, basePrice: 340, col: 9, row: 10 });

  const g1 = N('shop', { label: 'たこ焼き', area: 6, basePrice: 100, col: 4, row: 10 });
  const g2 = N('shop', { label: 'うどん屋', area: 6, basePrice: 150, col: 3, row: 10 });
  const g3 = N('shop', { label: '寿司屋', area: 6, basePrice: 260, col: 2, row: 10 });
  const g4 = N('shop', { label: '魚市場', area: 6, basePrice: 310, col: 1, row: 10 });

  link([hubS, f1], [f1, f2], [f2, f3], [f3, f4], [f4, mkSE]);
  link([hubS, g1], [g1, g2], [g2, g3], [g3, g4], [g4, mkSW]);

  const h1 = N('shop', { label: '古本屋', area: 7, basePrice: 70, col: 0, row: 4 });
  const h2 = N('shop', { label: '茶屋', area: 7, basePrice: 180, col: 0, row: 3 });
  const h3 = N('shop', { label: 'ギャラリー', area: 7, basePrice: 320, col: 0, row: 2 });
  const h4 = N('shop', { label: '旅館', area: 7, basePrice: 400, col: 0, row: 1 });

  const i1 = N('shop', { label: '美容院', area: 8, basePrice: 210, col: 0, row: 6 });
  const i2 = N('shop', { label: 'カラオケ', area: 8, basePrice: 230, col: 0, row: 7 });
  const i3 = N('shop', { label: '銭湯', area: 8, basePrice: 170, col: 0, row: 8 });
  const i4 = N('shop', { label: '八百屋', area: 8, basePrice: 140, col: 0, row: 9 });

  link([hubW, h1], [h1, h2], [h2, h3], [h3, h4], [h4, mkNW]);
  link([hubW, i1], [i1, i2], [i2, i3], [i3, i4], [i4, mkSW]);

  return packBoard(nodes, bank, 11, 11, {
    mapId: 'central_cross',
    mapName: '中央クロス',
  });
}

/**
 * 本家「貝がら島」系を整理した環状マップ。
 * 外周は常時接続。スイッチで縦／横ショートカットと動くマスが切り替わる。
 */
export function buildShellHarbor() {
  const { nodes, N } = makeNodeFactory();
  // きれいに整えた 11x9 の環
  const bank = N('bank', { label: '銀行', isStart: true, col: 1, row: 4 });

  const mkW = N('mark', { label: '♠', mark: 0, col: 0, row: 4 });
  const scratchW = N('scratch', { label: 'スクラッチ', col: 0, row: 2 });
  const chanceW = N('chance', { label: 'チャンス', col: 0, row: 6 });
  const a1 = N('shop', { label: '貝細工', area: 1, basePrice: 220, col: 1, row: 2 });
  const a2 = N('shop', { label: '潮干狩', area: 1, basePrice: 180, col: 1, row: 6 });
  const a3 = N('shop', { label: '真珠店', area: 1, basePrice: 350, col: 2, row: 4 });
  const a4 = N('shop', { label: '珊瑚屋', area: 1, basePrice: 240, col: 3, row: 4 });

  const b1 = N('shop', { label: '砂浜カフェ', area: 2, basePrice: 260, col: 2, row: 1 });
  const b2 = N('shop', { label: 'サーフ屋', area: 2, basePrice: 300, col: 3, row: 0 });
  const b3 = N('shop', { label: 'かき氷', area: 2, basePrice: 140, col: 4, row: 0 });
  const b4 = N('shop', { label: '土産屋', area: 2, basePrice: 200, col: 5, row: 0 });
  const hubN = N('switch', { label: 'スイッチ', col: 5, row: 1 });
  const eventN = N('event', { label: 'イベント', col: 6, row: 0 });

  const c1 = N('shop', { label: 'ホテル', area: 3, basePrice: 420, col: 7, row: 0 });
  const c2 = N('shop', { label: '水族館', area: 3, basePrice: 380, col: 8, row: 0 });
  const c3 = N('shop', { label: '港食堂', area: 3, basePrice: 240, col: 9, row: 1 });
  const c4 = N('shop', { label: 'ヨット屋', area: 3, basePrice: 360, col: 8, row: 2 });
  const mkNE = N('mark', { label: '♥', mark: 1, col: 10, row: 0 });

  const d1 = N('shop', { label: '灯台茶屋', area: 4, basePrice: 280, col: 10, row: 2 });
  const broker = N('stockbroker', { label: '証券', col: 10, row: 4 });
  const d2 = N('shop', { label: '魚市場', area: 4, basePrice: 320, col: 10, row: 3 });
  const d3 = N('shop', { label: '干物屋', area: 4, basePrice: 160, col: 10, row: 5 });
  const d4 = N('shop', { label: '民宿', area: 4, basePrice: 210, col: 9, row: 4 });
  const luckyE = N('lucky', { label: '★', col: 10, row: 6 });
  const mkE = N('mark', { label: '♣', mark: 3, col: 10, row: 8 });

  const e1 = N('shop', { label: '温泉宿', area: 5, basePrice: 400, col: 8, row: 8 });
  const e2 = N('shop', { label: '銭湯', area: 5, basePrice: 170, col: 7, row: 8 });
  const hubS = N('switch', { label: 'スイッチ', col: 5, row: 7 });
  const slotS = N('minigame', { label: 'スロット', game: 'slot', col: 5, row: 8 });
  const e3 = N('shop', { label: 'たこ焼き', area: 5, basePrice: 110, col: 4, row: 8 });
  const e4 = N('shop', { label: 'うどん', area: 5, basePrice: 150, col: 3, row: 8 });

  const f1 = N('shop', { label: '鮮魚', area: 6, basePrice: 290, col: 2, row: 8 });
  const f2 = N('shop', { label: '海女小屋', area: 6, basePrice: 210, col: 1, row: 7 });
  const f3 = N('shop', { label: '網元', area: 6, basePrice: 250, col: 2, row: 6 });
  const f4 = N('shop', { label: '海産物', area: 6, basePrice: 190, col: 3, row: 6 });
  const mkSW = N('mark', { label: '♦', mark: 2, col: 0, row: 8 });
  const diceE = N('minigame', { label: 'サイコロ', game: 'guess_dice', col: 8, row: 4 });
  const rollMid = N('rollon', { label: 'もう一回', col: 5, row: 4 });
  const chanceMid = N('chance', { label: 'チャンス', col: 6, row: 4 });

  // 動くマス（スイッチで位置が変わる）
  const float1 = N('shop', { label: '屋台船', area: 2, basePrice: 170, col: 4, row: 3 });
  const float2 = N('shop', { label: '渡し舟', area: 3, basePrice: 200, col: 6, row: 3 });

  // 外周＋銀行まわり（常時）
  link(
    [bank, a1], [a1, scratchW], [scratchW, mkW], [mkW, chanceW], [chanceW, a2], [a2, bank],
    [bank, a3], [a3, a4],
  );
  link(
    [a1, b1], [b1, b2], [b2, b3], [b3, b4], [b4, eventN], [eventN, c1],
    [c1, c2], [c2, mkNE], [mkNE, c3], [c3, d1], [d1, d2], [d2, broker],
    [broker, d3], [d3, luckyE], [luckyE, mkE], [mkE, e1], [e1, e2], [e2, slotS],
    [slotS, e3], [e3, e4], [e4, f1], [f1, f2], [f2, mkSW], [mkSW, a2],
  );
  link([eventN, hubN], [hubN, b4]);
  link([slotS, hubS], [hubS, e3]);
  link([c3, c4], [c4, d1]);
  link([f2, f3], [f3, f4]);
  link([broker, d4], [d4, diceE]);

  // スイッチゲート：状態0=縦通路、状態1=横通路
  // 動くマスはゲート接続先としても使う
  const switchGates = [
    { a: hubN.id, b: float1.id, when: 0 },
    { a: float1.id, b: rollMid.id, when: 0 },
    { a: rollMid.id, b: float2.id, when: 0 },
    { a: float2.id, b: hubS.id, when: 0 },
    { a: a4.id, b: float1.id, when: 1 },
    { a: float1.id, b: rollMid.id, when: 1 },
    { a: rollMid.id, b: chanceMid.id, when: 1 },
    { a: chanceMid.id, b: diceE.id, when: 1 },
    { a: diceE.id, b: d4.id, when: 1 },
    { a: float2.id, b: c4.id, when: 1 },
    { a: float2.id, b: f4.id, when: 0 },
  ];
  const switchMoves = [
    {
      id: float1.id,
      pos: [
        { col: 4, row: 3 }, // 縦ルート寄り
        { col: 4, row: 4 }, // 横ルート上
      ],
    },
    {
      id: float2.id,
      pos: [
        { col: 6, row: 5 }, // 縦ルート寄り
        { col: 7, row: 4 }, // 横ルート上
      ],
    },
    {
      id: rollMid.id,
      pos: [
        { col: 5, row: 4 },
        { col: 5, row: 4 },
      ],
    },
  ];

  return packBoard(nodes, bank, 11, 9, {
    mapId: 'shell_harbor',
    mapName: '貝がら港',
    goal: 12000,
    initialCash: 1800,
    switchState: 0,
    switchGates,
    switchMoves,
    areaOverrides: {
      1: { name: '貝がら浜' },
      2: { name: '北砂浜' },
      3: { name: '東灯台' },
      4: { name: '岬通り' },
      5: { name: '南湯けむり' },
      6: { name: '西市' },
    },
  });
}

/**
 * 本家「レインフォレスト」系：本島＋離れ小島。
 * 小島へは歩いて渡れず、ワープマスでのみ出入りする。
 */
export function buildCliffIsle() {
  const { nodes, N } = makeNodeFactory();
  // 本島 0..8 / 空白 9-10 / 島 12..15
  const bank = N('bank', { label: '銀行', isStart: true, col: 4, row: 5 });

  const n1 = N('shop', { label: 'あまぐも茶', area: 1, basePrice: 200, col: 4, row: 4 });
  const n2 = N('lucky', { label: '★', col: 4, row: 3 });
  const n3 = N('shop', { label: '雨宿り', area: 1, basePrice: 160, col: 4, row: 2 });
  const hubN = N('event', { label: 'イベント', col: 4, row: 1 });
  const mkN = N('mark', { label: '♠', mark: 0, col: 4, row: 0 });

  const s1 = N('shop', { label: 'たいよう食堂', area: 2, basePrice: 240, col: 4, row: 6 });
  const s2 = N('chance', { label: 'チャンス', col: 4, row: 7 });
  const s3 = N('shop', { label: '果実店', area: 2, basePrice: 180, col: 4, row: 8 });
  const hubS = N('minigame', { label: 'スロット', game: 'slot', col: 4, row: 9 });
  const mkS = N('mark', { label: '♦', mark: 2, col: 4, row: 10 });

  const w1 = N('shop', { label: 'どぜう屋', area: 3, basePrice: 150, col: 3, row: 5 });
  const w2 = N('shop', { label: '川魚', area: 3, basePrice: 210, col: 2, row: 5 });
  const w3 = N('shop', { label: '釣り具', area: 3, basePrice: 170, col: 1, row: 5 });
  const w4 = N('shop', { label: '川辺民宿', area: 3, basePrice: 250, col: 1, row: 4 });
  const hubW = N('scratch', { label: 'スクラッチ', col: 0, row: 5 });
  const mkW = N('mark', { label: '♣', mark: 3, col: 0, row: 3 });

  const e1 = N('shop', { label: '渓流宿', area: 4, basePrice: 280, col: 5, row: 5 });
  const e2 = N('rollon', { label: 'もう一回', col: 6, row: 5 });
  const e3 = N('shop', { label: '吊り橋茶屋', area: 4, basePrice: 190, col: 7, row: 5 });
  const mainWarp = N('warp', { label: '島ワープ', col: 8, row: 5 });

  link([bank, n1], [n1, n2], [n2, n3], [n3, hubN], [hubN, mkN]);
  link([bank, s1], [s1, s2], [s2, s3], [s3, hubS], [hubS, mkS]);
  link([bank, w1], [w1, w2], [w2, w3], [w3, hubW], [w3, w4], [w4, mkW]);
  link([bank, e1], [e1, e2], [e2, e3], [e3, mainWarp]);

  const nw1 = N('shop', { label: '苔むした店', area: 1, basePrice: 320, col: 2, row: 1 });
  const nw2 = N('shop', { label: 'きのこ屋', area: 1, basePrice: 140, col: 1, row: 1 });
  const nw3 = N('shop', { label: '滝見台', area: 5, basePrice: 260, col: 0, row: 1 });
  const nw4 = N('shop', { label: 'ガイド小屋', area: 5, basePrice: 200, col: 0, row: 2 });
  link([hubN, nw1], [nw1, nw2], [nw2, nw3], [nw3, nw4], [nw4, mkW], [mkW, hubW]);

  const sw1 = N('shop', { label: 'たいよう屋台', area: 2, basePrice: 120, col: 2, row: 9 });
  const sw2 = N('shop', { label: 'フルーツ', area: 2, basePrice: 170, col: 1, row: 9 });
  const sw3 = N('shop', { label: 'カヌー屋', area: 5, basePrice: 300, col: 0, row: 9 });
  const sw4 = N('shop', { label: '川辺食堂', area: 5, basePrice: 220, col: 0, row: 7 });
  const sw5 = N('lucky', { label: '★', col: 0, row: 6 });
  link([hubS, sw1], [sw1, sw2], [sw2, sw3], [sw3, sw4], [sw4, sw5], [sw5, hubW]);

  const ne1 = N('shop', { label: '展望台', area: 6, basePrice: 340, col: 6, row: 1 });
  const ne2 = N('shop', { label: '写真屋', area: 6, basePrice: 180, col: 7, row: 1 });
  const ne3 = N('shop', { label: 'ロープウェイ', area: 6, basePrice: 400, col: 8, row: 1 });
  const ne4 = N('chance', { label: 'チャンス', col: 8, row: 3 });
  const mkNE = N('mark', { label: '♥', mark: 1, col: 8, row: 0 });
  link([hubN, ne1], [ne1, ne2], [ne2, ne3], [ne3, mkNE]);
  link([ne3, ne4], [ne4, mainWarp]);

  const se1 = N('shop', { label: '下山口', area: 4, basePrice: 160, col: 6, row: 9 });
  const se2 = N('shop', { label: 'みやげ', area: 6, basePrice: 130, col: 7, row: 9 });
  const se3 = N('minigame', { label: 'サイコロ', game: 'guess_dice', col: 8, row: 9 });
  const se4 = N('shop', { label: 'バス停', area: 4, basePrice: 210, col: 8, row: 7 });
  link([hubS, se1], [se1, se2], [se2, se3], [se3, se4], [se4, mainWarp]);

  // ── 離れ小島（徒歩不可・ワープのみ）──
  const isleWarp = N('warp', { label: '本島ワープ', col: 12, row: 5 });
  const isleGate = N('stockbroker', { label: '証券', col: 13, row: 5 });
  const isle1 = N('shop', { label: 'がけ茶屋', area: 11, basePrice: 260, col: 13, row: 3 });
  const isle2 = N('shop', { label: '滝つぼ', area: 11, basePrice: 300, col: 14, row: 3 });
  const isle3 = N('shop', { label: '吊り橋宿', area: 11, basePrice: 380, col: 14, row: 7 });
  const isle4 = N('shop', { label: 'かもめ屋', area: 11, basePrice: 220, col: 13, row: 7 });
  const isleTip = N('event', { label: '島イベント', col: 15, row: 5 });
  const isleChance = N('chance', { label: 'チャンス', col: 14, row: 5 });
  const isleLucky = N('lucky', { label: '★', col: 12, row: 3 });

  // 本島ワープ → 島の証券前／島ワープ → 本島ワープマス（着地後は再ワープしない）
  mainWarp.warpTo = isleGate.id;
  isleWarp.warpTo = mainWarp.id;

  link([isleWarp, isleGate], [isleGate, isleChance], [isleChance, isleTip]);
  link(
    [isleGate, isle1], [isle1, isleLucky], [isle1, isle2], [isle2, isleChance],
    [isleChance, isle3], [isle3, isle4], [isle4, isleGate],
  );

  return packBoard(nodes, bank, 16, 11, {
    mapId: 'cliff_isle',
    mapName: 'がけした島',
    goal: 14000,
    initialCash: 1600,
    areaOverrides: {
      1: { name: 'あまぐもタウン' },
      2: { name: 'たいようタウン' },
      3: { name: 'どぜうウォーク' },
      4: { name: '渓流通り' },
      5: { name: '川辺' },
      6: { name: '展望通り' },
      11: { name: 'がけしたどおり' },
    },
  });
}

/** 選択可能なマップ一覧 */
export const MAP_CATALOG = [
  {
    id: 'central_cross',
    name: '中央クロス',
    blurb: '銀行中心の十字＋外周。定番の分岐マップ',
    defaultGoal: 10000,
    defaultCash: 2000,
    build: buildCentralCross,
  },
  {
    id: 'shell_harbor',
    name: '貝がら港',
    blurb: '環状の港町。スイッチで縦／横ルートと動くマスが切り替わる',
    defaultGoal: 12000,
    defaultCash: 1800,
    build: buildShellHarbor,
  },
  {
    id: 'cliff_isle',
    name: 'がけした島',
    blurb: '離れ小島あり。本島とはワープマスでのみ行き来できる',
    defaultGoal: 14000,
    defaultCash: 1600,
    build: buildCliffIsle,
  },
];

export function getMapDef(mapId) {
  return MAP_CATALOG.find((m) => m.id === mapId) || MAP_CATALOG[0];
}

/**
 * @param {string} [mapId]
 */
export function buildBoard(mapId = DEFAULT_MAP_ID) {
  const def = getMapDef(mapId);
  return def.build();
}

export function dirLabel(from, to) {
  if (!from || !to) return '進む';
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  if (Math.abs(dc) >= Math.abs(dr)) return dc > 0 ? '→ 右' : '← 左';
  return dr > 0 ? '↓ 下' : '↑ 上';
}
