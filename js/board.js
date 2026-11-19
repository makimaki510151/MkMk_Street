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
  13: { name: '底の灯', color: '#3f6f7e', pattern: 'dots', patternInk: '#7aa3b0' },
  14: { name: '人差し指', color: '#4a7088', pattern: 'grid', patternInk: '#7ea3b6' },
  15: { name: 'こぶし脇', color: '#3e6280', pattern: 'diamond', patternInk: '#7496b0' },
  16: { name: '第一関節', color: '#456a78', pattern: 'check', patternInk: '#7a9eab' },
  17: { name: '指先通り', color: '#3d5f86', pattern: 'stripe', patternInk: '#7394b8' },
  18: { name: '親指の先', color: '#4b678a', pattern: 'dots', patternInk: '#839ebc' },
  19: { name: '親指の腹', color: '#395f70', pattern: 'grid', patternInk: '#6f95a4' },
};

/** 1グループ（株エリア）あたりのお店数の上限 */
export const AREA_SHOP_MAX = 5;
/** 基本のお店数 */
export const AREA_SHOP_BASE = 4;

export const SUIT_LABELS = ['♠', '♥', '♦', '♣'];

export const DEFAULT_GOAL = 10000;
export const DEFAULT_CASH = 2500;
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
  // エリア1: 真珠店・貝細工・船着場・旧削りマス店 / エリア2: 珊瑚〜かき氷＋屋台船
  const aN1 = N('shop', { label: '真珠店', area: 1, basePrice: 350, col: 1, row: 0 });
  const aN2 = N('shop', { label: '珊瑚屋', area: 2, basePrice: 240, col: 2, row: 0 });
  const b1 = N('shop', { label: '砂浜カフェ', area: 2, basePrice: 260, col: 3, row: 0, forkAs: '海岸どおり' });
  const b2 = N('shop', { label: 'サーフ屋', area: 2, basePrice: 300, col: 5, row: 0, forkAs: '海岸どおり' });
  const b3 = N('shop', { label: 'かき氷', area: 2, basePrice: 140, col: 6, row: 0 });
  const c1 = N('shop', { label: 'ホテル', area: 3, basePrice: 420, col: 7, row: 0 });

  // 東辺 — 埠頭スイッチは1マス内側。外周 (8,3) は空白
  // エリア3: ホテル〜埠頭食堂 / エリア4: ヨット〜温泉宿（旧ラッキーも店）
  const c2 = N('shop', { label: '水族館', area: 3, basePrice: 380, col: 8, row: 1 });
  const c3 = N('shop', { label: '港食堂', area: 3, basePrice: 240, col: 8, row: 2, forkAs: '海岸どおり' });
  const c4 = N('shop', { label: 'ヨット屋', area: 4, basePrice: 360, col: 8, row: 4, forkAs: '海岸どおり' });
  const d1 = N('shop', { label: '灯台茶屋', area: 4, basePrice: 280, col: 8, row: 5 });
  const shopSE = N('shop', { label: 'みやげ屋', area: 4, basePrice: 190, col: 8, row: 6 });

  // 南辺 — 温泉宿と銭湯を直結。外周 (4,7) は空白
  // エリア5: かき小屋・銭湯・うどん・たこ焼き・渡し舟（かき小屋↔スロット入替）
  const e1 = N('shop', { label: '温泉宿', area: 4, basePrice: 400, col: 7, row: 7 });
  const e2 = N('shop', { label: '銭湯', area: 5, basePrice: 170, col: 6, row: 7 });
  const kaki = N('shop', { label: 'かき小屋', area: 5, basePrice: 200, col: 5, row: 7, forkAs: '海岸どおり' });
  const e4 = N('shop', { label: 'うどん', area: 5, basePrice: 150, col: 3, row: 7, forkAs: '海岸どおり' });
  const e3 = N('shop', { label: 'たこ焼き', area: 5, basePrice: 110, col: 2, row: 7 });
  const f1 = N('shop', { label: '鮮魚', area: 6, basePrice: 290, col: 1, row: 7 });

  // 西辺 — 銀行は1マス内側。外周 (0,3) は空白
  // エリア6: 鮮魚〜潮干狩 / 旧削りマスはエリア1の店へ
  const f2 = N('shop', { label: '海女小屋', area: 6, basePrice: 210, col: 0, row: 6 });
  const f3 = N('shop', { label: '網元', area: 6, basePrice: 250, col: 0, row: 5 });
  const aW = N('shop', { label: '潮干狩', area: 6, basePrice: 180, col: 0, row: 4, forkAs: '海岸どおり' });
  const a1 = N('shop', { label: '貝細工', area: 1, basePrice: 220, col: 0, row: 2, forkAs: '海岸どおり' });
  const shellShop = N('shop', { label: '貝がら屋', area: 1, basePrice: 160, col: 0, row: 1 });

  // 埠頭ハブ：浜茶屋→スクラッチ、屋台横丁→ラッキー、チャンス→証券。かき小屋↔スロット入替
  const pierN = N('scratch', { label: 'スクラッチ', col: 3, row: 1, forkAs: '北埠頭へ' });
  const swN = N('switch', { label: 'スイッチ', col: 4, row: 1, forkAs: '北埠頭へ' });
  const pierN2 = N('rollon', { label: 'もう一回', col: 5, row: 1, forkAs: '北埠頭へ' });
  const pierS = N('lucky', { label: '★', col: 3, row: 6, forkAs: '南埠頭へ' });
  const swS = N('switch', { label: 'スイッチ', col: 4, row: 6, forkAs: '南埠頭へ' });
  const slot = N('minigame', { label: 'スロット', game: 'slot', col: 5, row: 6, forkAs: '南埠頭へ' });
  const pierE = N('shop', { label: '埠頭食堂', area: 3, basePrice: 210, col: 7, row: 2, forkAs: '東埠頭へ' });
  const swE = N('switch', { label: 'スイッチ', col: 7, row: 3, forkAs: '東埠頭へ' });
  const pierE2 = N('stockbroker', { label: '証券', col: 7, row: 4, forkAs: '東埠頭へ' });
  const pierW = N('shop', { label: '船着場', area: 1, basePrice: 160, col: 1, row: 2, forkAs: '西埠頭へ' });
  const swW = N('switch', { label: 'スイッチ', col: 1, row: 3, forkAs: '西埠頭へ' });
  const pierW2 = N('lucky', { label: '★', col: 1, row: 4, forkAs: '西埠頭へ' });

  // 直径ハブ＝銀行（スタート）。ゲートのみで常に2接続
  const bank = N('bank', { label: '銀行', isStart: true, col: 4, row: 3, forkAs: '航路へ' });
  const boatN = N('shop', { label: '屋台船', area: 2, basePrice: 170, col: 4, row: 2, forkAs: '航路へ' });
  const boatS = N('shop', { label: '渡し舟', area: 5, basePrice: 200, col: 4, row: 4, forkAs: '航路へ' });

  // 外周海岸リング：寄せた跡 (4,0)/(8,3)/(4,7)/(0,3) は空白のまま埋めない。
  // 空白は橋渡しせず、先へ進むには内側の埠頭分岐（スイッチ）を通る。
  link(
    [mkNW, aN1], [aN1, aN2], [aN2, b1], /* 北の空白 */ [b2, b3], [b3, c1], [c1, mkNE],
    [mkNE, c2], [c2, c3], /* 東の空白 */ [c4, d1], [d1, shopSE], [shopSE, mkSE],
    [mkSE, e1], [e1, e2], [e2, kaki], /* 南の空白 */ [e4, e3], [e3, f1], [f1, mkSW],
    [mkSW, f2], [f2, f3], [f3, aW], /* 西の空白 */ [a1, shellShop], [shellShop, mkNW],
  );
  // 埠頭ルート：空白をまたいで海岸をつなぐ唯一の橋（中央に分岐ハブ）
  link([b1, pierN], [pierN, swN], [swN, pierN2], [pierN2, b2]);
  link([e4, pierS], [pierS, swS], [swS, slot], [slot, kaki]);
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
    initialCash: 2300,
    switchState: 0,
    switchGates,
    switchMoves,
    areaOverrides: {
      1: { name: '貝がら浜' },
      2: { name: '北砂浜' },
      3: { name: '東灯台' },
      4: { name: '岬灯台' },
      5: { name: '南湯けむり' },
      6: { name: '西市' },
    },
  });
}

/**
 * 本家「レインフォレスト」系：本島 7×7 ＋ 離れ小島 5×5。
 * 小島へはワープのみ。直交隣接のみリンク、行き止まりなし。
 *
 * 本島:
 *   ペ１１株１１ハ
 *   ２００４００５
 *   ２００４００５
 *   削３３銀３３転
 *   ２００４００５
 *   ２００４００５
 *   ダ６６ス６６ク
 * 小島（イベント／ラッキーなし・4列に詰めた外周）:
 *   削７８再 / ７００８ / 転７８全 / ７００８ / 再７８削
 */
export function buildCliffIsle() {
  const { nodes, N } = makeNodeFactory();
  const shopNames = {
    1: ['あまぐも茶', '苔むした店', 'きのこ屋', '雨宿り'],
    2: ['どぜう屋', '川魚', '釣り具', 'ガイド小屋'],
    3: ['渓流宿', '吊り橋茶屋', '川辺民宿', '岩魚屋'],
    4: ['中央茶屋', 'けものみち', '木陰の店', 'つゆ店'],
    5: ['展望台', '写真屋', 'ロープウェイ', 'みやげ屋'],
    6: ['たいよう食堂', '果実店', 'たいよう屋台', 'フルーツ'],
    7: ['がけ茶屋', '滝つぼ', '苔岩屋', '洞くつ店', '吊り橋宿'],
    8: ['かもめ屋', '潮風食堂', '浜小屋', '岩場みやげ', '灯台みやげ'],
  };
  const shopIdx = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 };
  const shopPrice = {
    1: [200, 320, 140, 160],
    2: [150, 210, 170, 200],
    3: [280, 190, 250, 220],
    4: [180, 210, 160, 190],
    5: [340, 180, 400, 130],
    6: [240, 180, 120, 170],
    7: [260, 300, 180, 280, 380],
    8: [220, 240, 160, 200, 320],
  };

  function shop(area, col, row) {
    const i = shopIdx[area]++;
    const names = shopNames[area];
    const prices = shopPrice[area];
    return N('shop', {
      label: names[i % names.length],
      area,
      basePrice: prices[i % prices.length],
      col,
      row,
    });
  }

  /** @type {(object|null)[][]} */
  const grid = [];
  const put = (col, row, node) => {
    if (!grid[row]) grid[row] = [];
    grid[row][col] = node;
    return node;
  };

  // ── 本島 (cols 0–6, rows 0–6) ──
  put(0, 0, N('mark', { label: '♠', mark: 0, col: 0, row: 0 }));
  put(1, 0, shop(1, 1, 0));
  put(2, 0, shop(1, 2, 0));
  put(3, 0, N('stockbroker', { label: '証券', col: 3, row: 0 }));
  put(4, 0, shop(1, 4, 0));
  put(5, 0, shop(1, 5, 0));
  put(6, 0, N('mark', { label: '♥', mark: 1, col: 6, row: 0 }));

  put(0, 1, shop(2, 0, 1));
  put(3, 1, shop(4, 3, 1));
  put(6, 1, shop(5, 6, 1));

  put(0, 2, shop(2, 0, 2));
  put(3, 2, shop(4, 3, 2));
  put(6, 2, shop(5, 6, 2));

  put(0, 3, N('scratch', { label: 'スクラッチ', col: 0, row: 3 }));
  put(1, 3, shop(3, 1, 3));
  put(2, 3, shop(3, 2, 3));
  const bank = put(3, 3, N('bank', { label: '銀行', isStart: true, col: 3, row: 3 }));
  put(4, 3, shop(3, 4, 3));
  put(5, 3, shop(3, 5, 3));
  const mainWarp = put(6, 3, N('warp', { label: '島ワープ', col: 6, row: 3 }));

  put(0, 4, shop(2, 0, 4));
  put(3, 4, shop(4, 3, 4));
  put(6, 4, shop(5, 6, 4));

  put(0, 5, shop(2, 0, 5));
  put(3, 5, shop(4, 3, 5));
  put(6, 5, shop(5, 6, 5));

  put(0, 6, N('mark', { label: '♦', mark: 2, col: 0, row: 6 }));
  put(1, 6, shop(6, 1, 6));
  put(2, 6, shop(6, 2, 6));
  put(3, 6, N('minigame', { label: 'スロット', game: 'slot', col: 3, row: 6 }));
  put(4, 6, shop(6, 4, 6));
  put(5, 6, shop(6, 5, 6));
  put(6, 6, N('mark', { label: '♣', mark: 3, col: 6, row: 6 }));

  // ── 離れ小島 (cols 8–11, rows 1–5) ──
  // 旧5列中央のイベント×2・ラッキーを削除し、右半分を1列詰める
  const ox = 8;
  const oy = 1;
  put(ox + 0, oy + 0, N('scratch', { label: 'スクラッチ', col: ox + 0, row: oy + 0 }));
  put(ox + 1, oy + 0, shop(7, ox + 1, oy + 0));
  put(ox + 2, oy + 0, shop(8, ox + 2, oy + 0));
  put(ox + 3, oy + 0, N('rollon', { label: 'もう一回', col: ox + 3, row: oy + 0 }));

  put(ox + 0, oy + 1, shop(7, ox + 0, oy + 1));
  put(ox + 3, oy + 1, shop(8, ox + 3, oy + 1));

  const isleWarp = put(ox + 0, oy + 2, N('warp', { label: '本島ワープ', col: ox + 0, row: oy + 2 }));
  put(ox + 1, oy + 2, shop(7, ox + 1, oy + 2));
  put(ox + 2, oy + 2, shop(8, ox + 2, oy + 2));
  put(ox + 3, oy + 2, N('suit_fill', { label: 'ワイルド', col: ox + 3, row: oy + 2 }));

  put(ox + 0, oy + 3, shop(7, ox + 0, oy + 3));
  put(ox + 3, oy + 3, shop(8, ox + 3, oy + 3));

  put(ox + 0, oy + 4, N('rollon', { label: 'もう一回', col: ox + 0, row: oy + 4 }));
  put(ox + 1, oy + 4, shop(7, ox + 1, oy + 4));
  put(ox + 2, oy + 4, shop(8, ox + 2, oy + 4));
  put(ox + 3, oy + 4, N('scratch', { label: 'スクラッチ', col: ox + 3, row: oy + 4 }));

  mainWarp.warpTo = isleWarp.id;
  isleWarp.warpTo = mainWarp.id;

  // 直交隣接のみリンク
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      const a = row[c];
      if (!a) continue;
      for (const [dc, dr] of dirs) {
        const b = grid[r + dr]?.[c + dc];
        if (!b || a.id >= b.id) continue;
        link([a, b]);
      }
    }
  }

  return packBoard(nodes, bank, 12, 7, {
    mapId: 'cliff_isle',
    mapName: 'がけした島',
    goal: 14000,
    initialCash: 2100,
    areaOverrides: {
      1: { name: 'あまぐもタウン' },
      2: { name: 'どぜうウォーク' },
      3: { name: '渓流通り' },
      4: { name: 'けものみち' },
      5: { name: '展望通り' },
      6: { name: 'たいようタウン' },
      7: { name: 'がけしたどおり' },
      8: { name: '潮風どおり' },
    },
  });
}

/**
 * マップ案「瓶」：縦長のボトル形（9×14）。首に銀行、胴に分岐、底にワープ往復。
 * 凡例: 銀銀行 / Ａ〜Ｍ店 / 削スクラッチ / スロット / 株 / ララッキー / イイベント / ワワイルド / 転ワープ / ♠♥♦♣
 */
export function buildBin() {
  const { nodes, N } = makeNodeFactory();
  const gridRows = [
    '　スＡＡ銀ＢＢ削　',
    '　Ａ　　　　　Ｂ　',
    '　Ａ　　　　　Ｂ　',
    '　ラＣ　　　Ｄイ　',
    '　　Ｃ　　　Ｄ　　',
    '　ＥＣＣ♦ＤＤＦ　',
    '　Ｅ　　　　　Ｆ　',
    'ＧＧＥＥ♥ＦＦＨＨ',
    'Ｇ　　　　　　　Ｈ',
    'Ｇ　ＬＬワＭＭ　Ｈ',
    '♠　株　　　ス　♣',
    'Ｉ　ＬＬ転ＭＭ　Ｊ',
    'Ｉ　　　　　　　Ｊ',
    'ＩＩＫＫ転ＫＫＪＪ',
  ];
  const BLANK = '　';
  const areaFromChar = {
    Ａ: 1, Ｂ: 2, Ｃ: 3, Ｄ: 4, Ｅ: 5, Ｆ: 6, Ｇ: 7,
    Ｈ: 8, Ｉ: 9, Ｊ: 10, Ｋ: 11, Ｌ: 12, Ｍ: 13,
  };
  const shopNames = {
    1: ['コルク屋', '封ろう屋', '栓みがき', 'ボトルキャップ'],
    2: ['リボン屋', 'ラベル印刷', '封緘堂', 'ネック飾り'],
    3: ['首もと茶屋', 'グラス磨き', '雫カフェ', '蒸気スタンド'],
    4: ['肩口みやげ', 'ビーカー屋', '計量屋', '実験道具'],
    5: ['ラベル左食堂', 'インク屋', '貼紙屋', '筆文字屋'],
    6: ['ラベル右食堂', 'スタンプ屋', '箔押し', 'シール屋'],
    7: ['胴の左岸屋台', '炭酸水', 'シロップ屋', '氷屋'],
    8: ['胴の右岸屋台', '麦芽屋', '酵母屋', '樽の店'],
    9: ['底左の灯台屋', '灯油屋', '錨のみやげ', '潮風食堂'],
    10: ['底右の灯台屋', '漁具屋', '貝がら屋', '塩屋'],
    11: ['底中央マーケット', '瓶詰屋', '保存食', '倉庫カフェ'],
    12: ['中胴ギャラリー', '硝子工房', 'ステンド屋', '切子屋'],
    13: ['中胴アトリエ', '絵具屋', 'フレーム屋', '写真屋'],
  };
  const shopPrice = {
    1: [320, 280, 240, 360],
    2: [300, 260, 220, 340],
    3: [210, 180, 160, 250],
    4: [200, 170, 150, 240],
    5: [190, 160, 140, 230],
    6: [190, 160, 140, 230],
    7: [180, 150, 130, 220],
    8: [180, 150, 130, 220],
    9: [260, 220, 200, 300],
    10: [260, 220, 200, 300],
    11: [280, 240, 210, 330],
    12: [230, 190, 170, 270],
    13: [230, 190, 170, 270],
  };
  const shopIdx = Object.fromEntries(Object.keys(shopNames).map((k) => [k, 0]));

  /** @type {(object|null)[][]} */
  const grid = [];
  const put = (col, row, node) => {
    if (!grid[row]) grid[row] = [];
    grid[row][col] = node;
    return node;
  };

  /** @type {object[]} */
  const warps = [];
  let bank = null;
  let slotCount = 0;

  for (let row = 0; row < gridRows.length; row++) {
    const chars = [...gridRows[row]];
    for (let col = 0; col < chars.length; col++) {
      const ch = chars[col];
      if (ch === BLANK) continue;
      if (areaFromChar[ch]) {
        const area = areaFromChar[ch];
        const i = shopIdx[area]++;
        const names = shopNames[area];
        const prices = shopPrice[area];
        put(col, row, N('shop', {
          label: names[i % names.length],
          area,
          basePrice: prices[i % prices.length],
          col,
          row,
        }));
        continue;
      }
      if (ch === '銀') {
        bank = put(col, row, N('bank', { label: '銀行', isStart: true, col, row }));
        continue;
      }
      if (ch === '♠') {
        put(col, row, N('mark', { label: '♠', mark: 0, col, row }));
        continue;
      }
      if (ch === '♥') {
        put(col, row, N('mark', { label: '♥', mark: 1, col, row }));
        continue;
      }
      if (ch === '♦') {
        put(col, row, N('mark', { label: '♦', mark: 2, col, row }));
        continue;
      }
      if (ch === '♣') {
        put(col, row, N('mark', { label: '♣', mark: 3, col, row }));
        continue;
      }
      if (ch === '削') {
        put(col, row, N('scratch', { label: 'スクラッチ', col, row }));
        continue;
      }
      if (ch === 'ス') {
        slotCount += 1;
        put(col, row, N('minigame', {
          label: slotCount === 1 ? 'スロット' : 'スロットⅡ',
          game: 'slot',
          col,
          row,
        }));
        continue;
      }
      if (ch === '株') {
        put(col, row, N('stockbroker', { label: '証券', col, row }));
        continue;
      }
      if (ch === 'ラ') {
        put(col, row, N('lucky', { label: '★', col, row }));
        continue;
      }
      if (ch === 'イ') {
        put(col, row, N('event', { label: 'イベント', col, row }));
        continue;
      }
      if (ch === 'ワ') {
        put(col, row, N('suit_fill', { label: 'ワイルド', col, row }));
        continue;
      }
      if (ch === '転') {
        const w = put(col, row, N('warp', {
          label: warps.length ? '瓶底ワープ' : '胴ワープ',
          col,
          row,
        }));
        warps.push(w);
        continue;
      }
      throw new Error(`未知のマス記号: ${ch} @${col},${row}`);
    }
  }

  if (!bank) throw new Error('瓶マップに銀行がありません');
  if (warps.length >= 2) {
    warps[0].warpTo = warps[1].id;
    warps[1].warpTo = warps[0].id;
  }

  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      const a = row[c];
      if (!a) continue;
      for (const [dc, dr] of dirs) {
        const b = grid[r + dr]?.[c + dc];
        if (!b || a.id >= b.id) continue;
        link([a, b]);
      }
    }
  }

  return packBoard(nodes, bank, 9, 14, {
    mapId: 'bin',
    mapName: '瓶',
    goal: 16000,
    initialCash: 2000,
    areaOverrides: {
      1: { name: 'コルク通り' },
      2: { name: '封ろう通り' },
      3: { name: '首もと坂' },
      4: { name: '肩口通り' },
      5: { name: 'ラベル左' },
      6: { name: 'ラベル右' },
      7: { name: '胴の左岸' },
      8: { name: '胴の右岸' },
      9: { name: '底左の灯' },
      10: { name: '底右の灯' },
      11: { name: '瓶底マーケット' },
      12: { name: '硝子ギャラリー' },
      13: { name: '中胴アトリエ' },
    },
  });
}

/**
 * マップ案「サムズアップ」：親指を立てた形（21×18）。
 * 凡例: 銀銀行 / Ａ〜Ｓ店 / 削スクラッチ / スロット / 株 / ララッキー / イイベント / 再もう一回 / ♠♥♦♣
 */
export function buildThumbsUp() {
  const { nodes, N } = makeNodeFactory();
  const gridRows = [
    '　　　　　　　　　　　　　　　イＲＲ　　　',
    '　　　　　　　　　　　　　　　Ｒ　Ｒ　　　',
    '　　　　　　　　　　　　　　　Ｒ　♣ＱＱＱ',
    '　　　　　　　　　　　　　　　ス　　　　Ｑ',
    '　　　　　　　　　　　　　　　Ｓ　　　　Ｐ',
    '　　　　　　　　　　　　　　　Ｓ　　　　Ｐ',
    '　　　　　　　　　　　　　　　Ｓ　　　　株',
    '　　　　　　　　　　　　　　　Ｓ　　　　Ｐ',
    'ＢＡＡＡＡ銀ＪＪＪＪ削ＬＬＬＬ再　　　　Ｐ',
    'Ｂ　　　　　　　　　Ｉ　　　　Ｍ　　　ＯＯ',
    'Ｂ　　　　　　　　　Ｉ　　　　Ｍ　　ＯＯ　',
    'Ｂ　　　　　　　　　Ｉ　　　　Ｍ　　♠　　',
    'イＣＣＣＣ♦　　　　Ｉ　　　　Ｍ　ＮＮ　　',
    'Ｅ　　　　Ｄ　　　　ラＫＫＫＫイＮＮ　　　',
    'Ｅ　　　　Ｄ　　　　Ｈ　　　　　　　　　　',
    'Ｅ　　　　Ｄ　　　　Ｈ　　　　　　　　　　',
    'Ｅ　　　　Ｄ　　　　Ｈ　　　　　　　　　　',
    '♥ＦＦＦＦスＧＧＧＧＨ　　　　　　　　　　',
  ];
  const BLANK = '　';
  const areaFromChar = {
    Ａ: 1, Ｂ: 2, Ｃ: 3, Ｄ: 4, Ｅ: 5, Ｆ: 6, Ｇ: 7,
    Ｈ: 8, Ｉ: 9, Ｊ: 10, Ｋ: 11, Ｌ: 12, Ｍ: 13,
    Ｎ: 14, Ｏ: 15, Ｐ: 16, Ｑ: 17, Ｒ: 18, Ｓ: 19,
  };
  const shopNames = {
    1: ['拍手屋', 'メガホン堂', 'フラッグ屋', 'ビブス屋'],
    2: ['手首カフェ', 'サポーター屋', 'アームバンド', 'リストラップ'],
    3: ['グッジョブ食堂', 'ハイタッチ屋', '握手の店', '握手みやげ'],
    4: ['掌の茶屋', 'フィンガーフード', '親指パン', 'ピースサンド'],
    5: ['手のひら食堂', 'グローブ屋', 'ミット屋', '掌ヒット屋'],
    6: ['手首マーケット', 'カフ屋', 'ボタン屋', '袖口みやげ'],
    7: ['こぶし広場屋台', 'ガッツポーズ屋', '気合入れ', '気合丼'],
    8: ['小指通り食堂', 'ピンキー屋', '指輪屋', 'ネイル屋'],
    9: ['中指の交差点', 'シグナル屋', '指差し看板', '道標カフェ'],
    10: ['人差し指横丁', 'ポイント屋', '案内所', '地図屋'],
    11: ['薬指通り', 'リング工房', '宝石屋', '煌めき屋'],
    12: ['関節マーケット', 'ヒンジ屋', 'ばね屋', '可動みやげ'],
    13: ['手の甲ギャラリー', 'ナックル屋', 'プロテクター', '拳みやげ'],
    14: ['第二関節屋台', 'ジョイント茶屋', '曲げ伸ばし屋', 'ストレッチ屋'],
    15: ['こぶし脇食堂', 'サイドポケット', '脇役みやげ', '隠し味屋'],
    16: ['第一関節ブティック', 'ナックルリング', '指サック屋', 'グリップ屋'],
    17: ['指先ブティック', 'タッチ屋', 'センサー屋', '先端みやげ'],
    18: ['親指の先ホテル', 'サムズアップ屋', 'いいね屋', '頂点カフェ', '頂上手みやげ'],
    19: ['親指の腹食堂', '腹巻き屋', 'パッド屋', 'むっちりパン'],
  };
  const shopPrice = {
    1: [300, 260, 220, 340],
    2: [240, 200, 180, 280],
    3: [230, 190, 170, 270],
    4: [210, 180, 160, 250],
    5: [200, 170, 150, 240],
    6: [190, 160, 140, 230],
    7: [200, 170, 150, 240],
    8: [210, 180, 160, 250],
    9: [250, 210, 190, 290],
    10: [280, 240, 210, 320],
    11: [260, 220, 200, 300],
    12: [270, 230, 200, 310],
    13: [250, 210, 190, 290],
    14: [240, 200, 180, 280],
    15: [260, 220, 200, 300],
    16: [300, 260, 230, 340],
    17: [320, 280, 250, 360],
    18: [380, 340, 300, 420, 360],
    19: [310, 270, 240, 350],
  };
  const shopIdx = Object.fromEntries(Object.keys(shopNames).map((k) => [k, 0]));

  /** @type {(object|null)[][]} */
  const grid = [];
  const put = (col, row, node) => {
    if (!grid[row]) grid[row] = [];
    grid[row][col] = node;
    return node;
  };

  let bank = null;
  let slotCount = 0;

  for (let row = 0; row < gridRows.length; row++) {
    const chars = [...gridRows[row]];
    for (let col = 0; col < chars.length; col++) {
      const ch = chars[col];
      if (ch === BLANK) continue;
      if (areaFromChar[ch]) {
        const area = areaFromChar[ch];
        const i = shopIdx[area]++;
        const names = shopNames[area];
        const prices = shopPrice[area];
        put(col, row, N('shop', {
          label: names[i % names.length],
          area,
          basePrice: prices[i % prices.length],
          col,
          row,
        }));
        continue;
      }
      if (ch === '銀') {
        bank = put(col, row, N('bank', { label: '銀行', isStart: true, col, row }));
        continue;
      }
      if (ch === '♠') {
        put(col, row, N('mark', { label: '♠', mark: 0, col, row }));
        continue;
      }
      if (ch === '♥') {
        put(col, row, N('mark', { label: '♥', mark: 1, col, row }));
        continue;
      }
      if (ch === '♦') {
        put(col, row, N('mark', { label: '♦', mark: 2, col, row }));
        continue;
      }
      if (ch === '♣') {
        put(col, row, N('mark', { label: '♣', mark: 3, col, row }));
        continue;
      }
      if (ch === '削') {
        put(col, row, N('scratch', { label: 'スクラッチ', col, row }));
        continue;
      }
      if (ch === 'ス') {
        slotCount += 1;
        put(col, row, N('minigame', {
          label: slotCount === 1 ? 'スロット' : 'スロットⅡ',
          game: 'slot',
          col,
          row,
        }));
        continue;
      }
      if (ch === '株') {
        put(col, row, N('stockbroker', { label: '証券', col, row }));
        continue;
      }
      if (ch === 'ラ') {
        put(col, row, N('lucky', { label: '★', col, row }));
        continue;
      }
      if (ch === 'イ') {
        put(col, row, N('event', { label: 'イベント', col, row }));
        continue;
      }
      if (ch === '再') {
        put(col, row, N('rollon', { label: 'もう一回', col, row }));
        continue;
      }
      throw new Error(`未知のマス記号: ${ch} @${col},${row}`);
    }
  }

  if (!bank) throw new Error('サムズアップマップに銀行がありません');

  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      const a = row[c];
      if (!a) continue;
      for (const [dc, dr] of dirs) {
        const b = grid[r + dr]?.[c + dc];
        if (!b || a.id >= b.id) continue;
        link([a, b]);
      }
    }
  }

  return packBoard(nodes, bank, 21, 18, {
    mapId: 'thumbs_up',
    mapName: 'サムズアップ',
    goal: 18000,
    initialCash: 1900,
    areaOverrides: {
      1: { name: '拍手横丁' },
      2: { name: '手首坂' },
      3: { name: 'ハイタッチ通り' },
      4: { name: '掌の小路' },
      5: { name: '手のひら通り' },
      6: { name: '手首マーケット' },
      7: { name: 'こぶし広場' },
      8: { name: '小指通り' },
      9: { name: '中指交差点' },
      10: { name: '人差し指横丁' },
      11: { name: '薬指通り' },
      12: { name: '関節マーケット' },
      13: { name: '手の甲ギャラリー' },
      14: { name: '第二関節' },
      15: { name: 'こぶし脇' },
      16: { name: '第一関節' },
      17: { name: '指先通り' },
      18: { name: '親指の先' },
      19: { name: '親指の腹' },
    },
  });
}

/**
 * マップ案「とりま」：19×11（grid-map-maker JSON どおり）。
 * マス配置は案のまま。斜め隣接もリンクする（8方向）。
 * 凡例: 銀銀行 / Ａ〜Ｊ店 / 削スクラッチ / スロット / 株 / ララッキー / イイベント
 *       当サイコロ当て / 休＝止まると自分の店が1ターン休店 / ♠♥♦♣
 */
export function buildTorima() {
  const { nodes, N } = makeNodeFactory();
  // アップロード案 JSON の map 配列をそのまま使用（配置を変えない）
  const gridRows = [
    '　　　　　　　　Ｃ休Ｃ　　　　　　　　',
    '　　　　　　　Ｃ　　　Ｃ　　　　　　　',
    '　♦ＥＥ削ＥＥス　　　ラＨＨイＨＨ♠　',
    '　Ｇ　　　　　　Ａ　Ａ　　　　　　Ｊ　',
    '　Ｇ　　　　　　Ａ　Ａ　　　　　　Ｊ　',
    '　株　　　　　　　銀　　　　　　　当　',
    '　Ｇ　　　　　　Ｂ　Ｂ　　　　　　Ｊ　',
    '　Ｇ　　　　　　Ｂ　Ｂ　　　　　　Ｊ　',
    '　♥ＦＦイＦＦラ　　　スＩＩ削ＩＩ♣　',
    '　　　　　　　Ｄ　　　Ｄ　　　　　　　',
    '　　　　　　　　Ｄ休Ｄ　　　　　　　　',
  ];
  const BLANK = '　';
  const areaFromChar = {
    Ａ: 1, Ｂ: 2, Ｃ: 3, Ｄ: 4, Ｅ: 5,
    Ｆ: 6, Ｇ: 7, Ｈ: 8, Ｉ: 9, Ｊ: 10,
  };
  const shopNames = {
    1: ['巣箱カフェ', 'ひなみやげ', 'とまり木茶屋', '羽根ペン屋'],
    2: ['砂浴び場屋台', 'ひなたパン', 'むく毛屋', '雛の雑貨'],
    3: ['てっぺん枝ホテル', '梢の展望台', '風切り食堂', '雲見みやげ'],
    4: ['根もとの市場', '落ち葉茶屋', '地べた屋台', '巣材屋'],
    5: ['左翼ブティック', '風切り屋', '羽ばたき屋', 'エアロみやげ'],
    6: ['右翼マーケット', 'バランス屋', '羽軸屋', 'グライダー屋'],
    7: ['くちばし坂食堂', 'ついばみ屋', '種ひろい屋', 'くちばしみやげ'],
    8: ['風切り羽工房', 'ダウン屋', '羽繕い屋', 'フライト屋'],
    9: ['尾羽横丁', '舵取り屋', '尾羽根みやげ', '方向屋'],
    10: ['とまり木通り', '止まり木カフェ', '見晴らし屋', 'さえずり屋'],
  };
  const shopPrice = {
    1: [220, 180, 160, 260],
    2: [220, 180, 160, 260],
    3: [300, 250, 220, 340],
    4: [300, 250, 220, 340],
    5: [200, 170, 150, 240],
    6: [200, 170, 150, 240],
    7: [190, 160, 140, 230],
    8: [240, 200, 180, 280],
    9: [240, 200, 180, 280],
    10: [210, 175, 155, 250],
  };
  const shopIdx = Object.fromEntries(Object.keys(shopNames).map((k) => [k, 0]));

  /** @type {(object|null)[][]} */
  const grid = [];
  const put = (col, row, node) => {
    if (!grid[row]) grid[row] = [];
    grid[row][col] = node;
    return node;
  };

  let bank = null;
  let slotCount = 0;

  for (let row = 0; row < gridRows.length; row++) {
    const chars = [...gridRows[row]];
    if (chars.length !== 19) {
      throw new Error(`とりま: 行${row}の幅が${chars.length}（19であるべき）`);
    }
    for (let col = 0; col < chars.length; col++) {
      const ch = chars[col];
      if (ch === BLANK) continue;
      if (areaFromChar[ch]) {
        const area = areaFromChar[ch];
        const i = shopIdx[area]++;
        const names = shopNames[area];
        const prices = shopPrice[area];
        put(col, row, N('shop', {
          label: names[i % names.length],
          area,
          basePrice: prices[i % prices.length],
          col,
          row,
        }));
        continue;
      }
      if (ch === '銀') {
        bank = put(col, row, N('bank', { label: '銀行', isStart: true, col, row }));
        continue;
      }
      if (ch === '♠') {
        put(col, row, N('mark', { label: '♠', mark: 0, col, row }));
        continue;
      }
      if (ch === '♥') {
        put(col, row, N('mark', { label: '♥', mark: 1, col, row }));
        continue;
      }
      if (ch === '♦') {
        put(col, row, N('mark', { label: '♦', mark: 2, col, row }));
        continue;
      }
      if (ch === '♣') {
        put(col, row, N('mark', { label: '♣', mark: 3, col, row }));
        continue;
      }
      if (ch === '削') {
        put(col, row, N('scratch', { label: 'スクラッチ', col, row }));
        continue;
      }
      if (ch === 'ス') {
        slotCount += 1;
        put(col, row, N('minigame', {
          label: slotCount === 1 ? 'スロット' : 'スロットⅡ',
          game: 'slot',
          col,
          row,
        }));
        continue;
      }
      if (ch === '当') {
        put(col, row, N('minigame', {
          label: 'サイコロ当て',
          game: 'guess_dice',
          col,
          row,
        }));
        continue;
      }
      if (ch === '株') {
        put(col, row, N('stockbroker', { label: '証券', col, row }));
        continue;
      }
      if (ch === 'ラ') {
        put(col, row, N('lucky', { label: '★', col, row }));
        continue;
      }
      if (ch === 'イ') {
        put(col, row, N('event', { label: 'イベント', col, row }));
        continue;
      }
      if (ch === '休') {
        // 止まると自分の店が1ターン休店（買い物料0）
        put(col, row, N('holiday', { label: '店休', col, row }));
        continue;
      }
      throw new Error(`未知のマス記号: ${ch} @${col},${row}`);
    }
  }

  if (!bank) throw new Error('とりまマップに銀行がありません');
  for (const [area, count] of Object.entries(shopIdx)) {
    if (count !== 4) throw new Error(`とりま: エリア${area}の店が${count}件（4であるべき）`);
  }

  // 直交＋斜め（8方向）。案のマス配置を変えないための接続規則
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      const a = row[c];
      if (!a) continue;
      for (const [dc, dr] of dirs) {
        const b = grid[r + dr]?.[c + dc];
        if (!b || a.id >= b.id) continue;
        link([a, b]);
      }
    }
  }

  return packBoard(nodes, bank, 19, gridRows.length, {
    mapId: 'torima',
    mapName: 'とりま',
    goal: 13000,
    initialCash: 2200,
    areaOverrides: {
      1: { name: '巣のまわり' },
      2: { name: 'ひな広場' },
      3: { name: 'てっぺん枝' },
      4: { name: '根もとの道' },
      5: { name: '左翼通り' },
      6: { name: '右翼通り' },
      7: { name: 'くちばし坂' },
      8: { name: '風切り羽' },
      9: { name: '尾羽横丁' },
      10: { name: 'とまり木通り' },
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
    defaultCash: 2500,
    build: buildCentralCross,
  },
  {
    id: 'shell_harbor',
    name: '貝がら港',
    blurb: '海岸と埠頭の並列ルート。スイッチで航路も切り替わる',
    defaultGoal: 12000,
    defaultCash: 2300,
    build: buildShellHarbor,
  },
  {
    id: 'cliff_isle',
    name: 'がけした島',
    blurb: '本島7×7＋離れ小島。ワープで行き来し、島にはマーク補充マスあり',
    defaultGoal: 14000,
    defaultCash: 2100,
    build: buildCliffIsle,
  },
  {
    id: 'bin',
    name: '瓶',
    blurb: '縦長のボトル形。首の銀行から胴・底へ分岐し、底のワープで往復',
    defaultGoal: 16000,
    defaultCash: 2000,
    build: buildBin,
  },
  {
    id: 'thumbs_up',
    name: 'サムズアップ',
    blurb: '親指を立てた形。銀行から指先・手首へ長く分岐する大会戦マップ',
    defaultGoal: 18000,
    defaultCash: 1900,
    build: buildThumbsUp,
  },
  {
    id: 'torima',
    name: 'とりま',
    blurb: '中央銀行から上下左右に広がる交差マップ（斜め接続あり）。休みマスは自分の店が1ターン休店',
    defaultGoal: 13000,
    defaultCash: 2200,
    build: buildTorima,
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
  const dc = Math.sign((to.col ?? 0) - (from.col ?? 0));
  const dr = Math.sign((to.row ?? 0) - (from.row ?? 0));
  if (dc === 0 && dr === 0) return '進む';
  if (dc === 0) return dr > 0 ? '↓ 下' : '↑ 上';
  if (dr === 0) return dc > 0 ? '→ 右' : '← 左';
  if (dc > 0 && dr > 0) return '↘ 右下';
  if (dc > 0 && dr < 0) return '↗ 右上';
  if (dc < 0 && dr > 0) return '↙ 左下';
  return '↖ 左上';
}
