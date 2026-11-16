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
 * @param {{ map?: object[], nodes?: object[], switchState?: number, switchGates?: object[], switchMoves?: object[] }} g
 */
export function applySwitchState(g) {
  const nodes = g?.map || g?.nodes;
  if (!nodes) return;
  const state = Number(g.switchState) ? 1 : 0;
  for (const n of nodes) {
    const base = n.baseNexts || n.nexts || [];
    n.nexts.length = 0;
    for (const id of base) n.nexts.push(id);
  }
  for (const gate of g.switchGates || []) {
    if (Number(gate.when) !== state) continue;
    const a = nodes.find((n) => n.id === gate.a);
    const b = nodes.find((n) => n.id === gate.b);
    if (!a || !b) continue;
    if (!a.nexts.includes(b.id)) a.nexts.push(b.id);
    if (!b.nexts.includes(a.id)) b.nexts.push(a.id);
  }
  for (const mv of g.switchMoves || []) {
    const n = nodes.find((x) => x.id === mv.id);
    const pos = mv.pos?.[state];
    if (!n || !pos) continue;
    n.col = pos.col;
    n.row = pos.row;
  }
}

/** スイッチで動くマスのスライド演出用（serialize には含めない） */
export function recordSwitchSlide(g, move) {
  if (!move || move.id == null) return;
  if (!g.switchFx) g.switchFx = [];
  g.switchFx.push(move);
}

export function takeSwitchFx(g) {
  const slides = g.switchFx ? [...g.switchFx] : [];
  g.switchFx = null;
  return slides;
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
 * 本家「貝がら島」系：外周の海岸リング＋並列の埠頭ルート＋直径スイッチ。
 * 分かれ道は「海岸どおり / 埠頭へ」の二択が基本（十字マップの東西南北分岐とは別物）。
 * 斜めなし・行き止まりなし。
 */
export function buildShellHarbor() {
  const { nodes, N } = makeNodeFactory();

  // 北のイベント・南のチャンスを削って1列詰め、幅は 9 列（0–8）
  const mkNW = N('mark', { label: '♠', mark: 0, col: 0, row: 0 });
  const mkNE = N('mark', { label: '♥', mark: 1, col: 8, row: 0 });
  const mkSE = N('mark', { label: '♣', mark: 3, col: 8, row: 7 });
  const mkSW = N('mark', { label: '♦', mark: 2, col: 0, row: 7 });

  // 北辺 — かき氷とホテルを直結。外周 (4,0) は空白のまま
  const aN1 = N('shop', { label: '真珠店', area: 1, basePrice: 350, col: 1, row: 0 });
  const aN2 = N('shop', { label: '珊瑚屋', area: 1, basePrice: 240, col: 2, row: 0 });
  const b1 = N('shop', { label: '砂浜カフェ', area: 2, basePrice: 260, col: 3, row: 0, forkAs: '海岸どおり' });
  const b2 = N('shop', { label: 'サーフ屋', area: 2, basePrice: 300, col: 5, row: 0, forkAs: '海岸どおり' });
  const b3 = N('shop', { label: 'かき氷', area: 2, basePrice: 140, col: 6, row: 0 });
  const c1 = N('shop', { label: 'ホテル', area: 3, basePrice: 420, col: 7, row: 0 });

  // 東辺 — 埠頭スイッチは1マス内側。外周 (8,3) は空白
  const c2 = N('shop', { label: '水族館', area: 3, basePrice: 380, col: 8, row: 1 });
  const c3 = N('shop', { label: '港食堂', area: 3, basePrice: 240, col: 8, row: 2, forkAs: '海岸どおり' });
  const c4 = N('shop', { label: 'ヨット屋', area: 3, basePrice: 360, col: 8, row: 4, forkAs: '海岸どおり' });
  const d1 = N('shop', { label: '灯台茶屋', area: 4, basePrice: 280, col: 8, row: 5 });
  const luckyE = N('lucky', { label: '★', col: 8, row: 6 });

  // 南辺 — 温泉宿と銭湯を直結。外周 (4,7) は空白
  const e1 = N('shop', { label: '温泉宿', area: 4, basePrice: 400, col: 7, row: 7 });
  const e2 = N('shop', { label: '銭湯', area: 5, basePrice: 170, col: 6, row: 7 });
  const slot = N('minigame', { label: 'スロット', game: 'slot', col: 5, row: 7, forkAs: '海岸どおり' });
  const e4 = N('shop', { label: 'うどん', area: 5, basePrice: 150, col: 3, row: 7, forkAs: '海岸どおり' });
  const e3 = N('shop', { label: 'たこ焼き', area: 5, basePrice: 110, col: 2, row: 7 });
  const f1 = N('shop', { label: '鮮魚', area: 6, basePrice: 290, col: 1, row: 7 });

  // 西辺 — 銀行は1マス内側。外周 (0,3) は空白
  const f2 = N('shop', { label: '海女小屋', area: 6, basePrice: 210, col: 0, row: 6 });
  const f3 = N('shop', { label: '網元', area: 6, basePrice: 250, col: 0, row: 5 });
  const aW = N('shop', { label: '潮干狩', area: 1, basePrice: 180, col: 0, row: 4, forkAs: '海岸どおり' });
  const a1 = N('shop', { label: '貝細工', area: 1, basePrice: 220, col: 0, row: 2, forkAs: '海岸どおり' });
  const scratch = N('scratch', { label: 'スクラッチ', col: 0, row: 1 });

  // 埠頭ハブ：東西もスイッチ（旧サイコロ／証券）。銀行は中央航路
  const pierN = N('shop', { label: '浜茶屋', area: 2, basePrice: 190, col: 3, row: 1, forkAs: '北埠頭へ' });
  const swN = N('switch', { label: 'スイッチ', col: 4, row: 1, forkAs: '北埠頭へ' });
  const pierN2 = N('rollon', { label: 'もう一回', col: 5, row: 1, forkAs: '北埠頭へ' });
  const pierS = N('shop', { label: '屋台横丁', area: 5, basePrice: 130, col: 3, row: 6, forkAs: '南埠頭へ' });
  const swS = N('switch', { label: 'スイッチ', col: 4, row: 6, forkAs: '南埠頭へ' });
  const pierS2 = N('shop', { label: 'かき小屋', area: 5, basePrice: 200, col: 5, row: 6, forkAs: '南埠頭へ' });
  const pierE = N('shop', { label: '埠頭食堂', area: 3, basePrice: 210, col: 7, row: 2, forkAs: '東埠頭へ' });
  const swE = N('switch', { label: 'スイッチ', col: 7, row: 3, forkAs: '東埠頭へ' });
  const pierE2 = N('chance', { label: 'チャンス', col: 7, row: 4, forkAs: '東埠頭へ' });
  const pierW = N('shop', { label: '船着場', area: 1, basePrice: 160, col: 1, row: 2, forkAs: '西埠頭へ' });
  const swW = N('switch', { label: 'スイッチ', col: 1, row: 3, forkAs: '西埠頭へ' });
  const pierW2 = N('lucky', { label: '★', col: 1, row: 4, forkAs: '西埠頭へ' });

  // 直径ハブ＝銀行（スタート）。ゲートのみで常に2接続
  const bank = N('bank', { label: '銀行', isStart: true, col: 4, row: 3, forkAs: '航路へ' });
  const boatN = N('shop', { label: '屋台船', area: 4, basePrice: 170, col: 4, row: 2, forkAs: '航路へ' });
  const boatS = N('shop', { label: '渡し舟', area: 4, basePrice: 200, col: 4, row: 4, forkAs: '航路へ' });

  // 外周海岸リング：寄せた跡 (4,0)/(8,3)/(4,7)/(0,3) は空白のまま埋めない。
  // 空白は橋渡しせず、先へ進むには内側の埠頭分岐（スイッチ）を通る。
  link(
    [mkNW, aN1], [aN1, aN2], [aN2, b1], /* 北の空白 */ [b2, b3], [b3, c1], [c1, mkNE],
    [mkNE, c2], [c2, c3], /* 東の空白 */ [c4, d1], [d1, luckyE], [luckyE, mkSE],
    [mkSE, e1], [e1, e2], [e2, slot], /* 南の空白 */ [e4, e3], [e3, f1], [f1, mkSW],
    [mkSW, f2], [f2, f3], [f3, aW], /* 西の空白 */ [a1, scratch], [scratch, mkNW],
  );
  // 埠頭ルート：空白をまたいで海岸をつなぐ唯一の橋（中央に分岐ハブ）
  link([b1, pierN], [pierN, swN], [swN, pierN2], [pierN2, b2]);
  link([e4, pierS], [pierS, swS], [swS, pierS2], [pierS2, slot]);
  link([c3, pierE], [pierE, swE], [swE, pierE2], [pierE2, c4]);
  link([a1, pierW], [pierW, swW], [swW, pierW2], [pierW2, aW]);

  const switchGates = [
    { a: swN.id, b: boatN.id, when: 0 },
    { a: boatN.id, b: bank.id, when: 0 },
    { a: bank.id, b: boatS.id, when: 0 },
    { a: boatS.id, b: swS.id, when: 0 },
    { a: swW.id, b: boatN.id, when: 1 },
    { a: boatN.id, b: bank.id, when: 1 },
    { a: bank.id, b: boatS.id, when: 1 },
    { a: boatS.id, b: swE.id, when: 1 },
  ];
  const switchMoves = [
    {
      id: boatN.id,
      pos: [
        { col: 4, row: 2 },
        { col: 2, row: 3 }, // 西スイッチ(1,3)の隣
      ],
    },
    {
      id: boatS.id,
      pos: [
        { col: 4, row: 4 },
        { col: 6, row: 3 }, // 横向き：東スイッチ(7,3)の左隣
      ],
    },
  ];

  return packBoard(nodes, bank, 9, 8, {
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
 * 小島へはワープのみ。本島・島ともループ構成で行き止まりなし。
 */
export function buildCliffIsle() {
  const { nodes, N } = makeNodeFactory();
  // 本島は角の丸い長方形ループ＋中央十字。島は小さな四角ループ。
  const bank = N('bank', { label: '銀行', isStart: true, col: 4, row: 5 });

  // 中央十字（銀行から四方）
  const n1 = N('shop', { label: 'あまぐも茶', area: 1, basePrice: 200, col: 4, row: 4 });
  const n2 = N('lucky', { label: '★', col: 4, row: 3 });
  const n3 = N('shop', { label: '雨宿り', area: 1, basePrice: 160, col: 4, row: 2 });
  const hubN = N('event', { label: 'イベント', col: 4, row: 1 });

  const s1 = N('shop', { label: 'たいよう食堂', area: 2, basePrice: 240, col: 4, row: 6 });
  const s2 = N('chance', { label: 'チャンス', col: 4, row: 7 });
  const s3 = N('shop', { label: '果実店', area: 2, basePrice: 180, col: 4, row: 8 });
  const hubS = N('minigame', { label: 'スロット', game: 'slot', col: 4, row: 9 });

  const w1 = N('shop', { label: 'どぜう屋', area: 3, basePrice: 150, col: 3, row: 5 });
  const w2 = N('shop', { label: '川魚', area: 3, basePrice: 210, col: 2, row: 5 });
  const w3 = N('shop', { label: '釣り具', area: 3, basePrice: 170, col: 1, row: 5 });
  const hubW = N('scratch', { label: 'スクラッチ', col: 0, row: 5 });

  const e1 = N('shop', { label: '渓流宿', area: 4, basePrice: 280, col: 5, row: 5 });
  const e2 = N('stockbroker', { label: '証券', col: 6, row: 5 });
  const e3 = N('shop', { label: '吊り橋茶屋', area: 4, basePrice: 190, col: 7, row: 5 });
  const mainWarp = N('warp', { label: '島ワープ', col: 8, row: 5 });

  link([bank, n1], [n1, n2], [n2, n3], [n3, hubN]);
  link([bank, s1], [s1, s2], [s2, s3], [s3, hubS]);
  link([bank, w1], [w1, w2], [w2, w3], [w3, hubW]);
  link([bank, e1], [e1, e2], [e2, e3], [e3, mainWarp]);

  // 外周ループ（マークは角で2本接続）
  const mkNW = N('mark', { label: '♠', mark: 0, col: 0, row: 1 });
  const nw1 = N('shop', { label: '苔むした店', area: 1, basePrice: 320, col: 2, row: 1 });
  const nw2 = N('shop', { label: 'きのこ屋', area: 1, basePrice: 140, col: 1, row: 1 });
  const nw3 = N('shop', { label: '滝見台', area: 5, basePrice: 260, col: 0, row: 2 });
  const nw4 = N('shop', { label: 'ガイド小屋', area: 5, basePrice: 200, col: 0, row: 3 });
  link([hubN, nw1], [nw1, nw2], [nw2, mkNW], [mkNW, nw3], [nw3, nw4], [nw4, hubW]);

  const mkSW = N('mark', { label: '♦', mark: 2, col: 0, row: 9 });
  const sw1 = N('shop', { label: 'たいよう屋台', area: 2, basePrice: 120, col: 2, row: 9 });
  const sw2 = N('shop', { label: 'フルーツ', area: 2, basePrice: 170, col: 1, row: 9 });
  const sw3 = N('shop', { label: 'カヌー屋', area: 5, basePrice: 300, col: 0, row: 8 });
  const sw4 = N('shop', { label: '川辺食堂', area: 5, basePrice: 220, col: 0, row: 7 });
  const sw5 = N('lucky', { label: '★', col: 0, row: 6 });
  link([hubS, sw1], [sw1, sw2], [sw2, mkSW], [mkSW, sw3], [sw3, sw4], [sw4, sw5], [sw5, hubW]);

  const mkNE = N('mark', { label: '♥', mark: 1, col: 8, row: 1 });
  const ne1 = N('shop', { label: '展望台', area: 6, basePrice: 340, col: 6, row: 1 });
  const ne2 = N('shop', { label: '写真屋', area: 6, basePrice: 180, col: 7, row: 1 });
  const ne3 = N('shop', { label: 'ロープウェイ', area: 6, basePrice: 400, col: 8, row: 2 });
  const ne4 = N('chance', { label: 'チャンス', col: 8, row: 3 });
  link([hubN, ne1], [ne1, ne2], [ne2, mkNE], [mkNE, ne3], [ne3, ne4], [ne4, mainWarp]);

  const mkSE = N('mark', { label: '♣', mark: 3, col: 8, row: 9 });
  const se1 = N('shop', { label: '下山口', area: 4, basePrice: 160, col: 6, row: 9 });
  const se2 = N('shop', { label: 'みやげ', area: 6, basePrice: 130, col: 7, row: 9 });
  const se3 = N('minigame', { label: 'サイコロ', game: 'guess_dice', col: 8, row: 8 });
  const se4 = N('shop', { label: 'バス停', area: 4, basePrice: 210, col: 8, row: 7 });
  const se5 = N('shop', { label: '川辺民宿', area: 3, basePrice: 250, col: 8, row: 6 });
  link([hubS, se1], [se1, se2], [se2, mkSE], [mkSE, se3], [se3, se4], [se4, se5], [se5, mainWarp]);

  // 離れ小島（拡大）：外周ループ＋中央横断（株なし）。エリア11/12の2区画。
  // cols 11-16 / rows 2-8
  const isleWarp = N('warp', { label: '本島ワープ', col: 11, row: 5 });
  const i11a = N('shop', { label: 'がけ茶屋', area: 11, basePrice: 260, col: 11, row: 3 });
  const i11b = N('shop', { label: '滝つぼ', area: 11, basePrice: 300, col: 12, row: 2 });
  const i11c = N('shop', { label: '苔岩屋', area: 11, basePrice: 180, col: 14, row: 2 });
  const i11d = N('shop', { label: '吊り橋宿', area: 11, basePrice: 380, col: 16, row: 3 });
  const i12a = N('shop', { label: 'かもめ屋', area: 12, basePrice: 220, col: 16, row: 7 });
  const i12b = N('shop', { label: '潮風食堂', area: 12, basePrice: 240, col: 14, row: 8 });
  const i12c = N('shop', { label: '浜小屋', area: 12, basePrice: 160, col: 12, row: 8 });
  const i12d = N('shop', { label: '岩場みやげ', area: 12, basePrice: 200, col: 11, row: 8 });
  const isleN = N('event', { label: '島イベント', col: 13, row: 2 });
  const isleS = N('chance', { label: 'チャンス', col: 13, row: 8 });
  const isleE = N('lucky', { label: '★', col: 16, row: 5 });
  const isleNE = N('rollon', { label: 'もう一回', col: 16, row: 2 });
  const isleSE = N('minigame', { label: 'サイコロ', game: 'guess_dice', col: 16, row: 8 });
  const isleNW = N('scratch', { label: 'スクラッチ', col: 11, row: 2 });
  const isleW6 = N('lucky', { label: '★', col: 11, row: 6 });
  const isleW7 = N('rollon', { label: 'もう一回', col: 11, row: 7 });
  const midW = N('shop', { label: '洞くつ店', area: 11, basePrice: 280, col: 12, row: 5 });
  const midC = N('event', { label: '潮騒', col: 13, row: 5 });
  const midE = N('shop', { label: '灯台みやげ', area: 12, basePrice: 320, col: 14, row: 5 });
  const midEE = N('chance', { label: 'チャンス', col: 15, row: 5 });

  mainWarp.warpTo = isleWarp.id;
  isleWarp.warpTo = mainWarp.id;

  // 外周（時計回り・直交のみ）
  link(
    [isleNW, i11b], [i11b, isleN], [isleN, i11c], [i11c, isleNE], [isleNE, i11d],
    [i11d, isleE], [isleE, i12a], [i12a, isleSE], [isleSE, i12b], [i12b, isleS],
    [isleS, i12c], [i12c, i12d], [i12d, isleW7], [isleW7, isleW6], [isleW6, isleWarp],
    [isleWarp, i11a], [i11a, isleNW],
  );
  // 中央横断（株マスなし・ワープと東辺を結ぶ）
  link(
    [isleWarp, midW], [midW, midC], [midC, midE], [midE, midEE], [midEE, isleE],
  );

  return packBoard(nodes, bank, 17, 11, {
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
      12: { name: '潮風どおり' },
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
    blurb: '海岸と埠頭の並列ルート。スイッチで航路も切り替わる',
    defaultGoal: 12000,
    defaultCash: 1800,
    build: buildShellHarbor,
  },
  {
    id: 'cliff_isle',
    name: 'がけした島',
    blurb: '大きな離れ小島（2エリア）。本島とはワープのみで行き来',
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
