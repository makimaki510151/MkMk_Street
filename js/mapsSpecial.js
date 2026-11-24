/**
 * 特殊マップ: 暮違某為町 / 空島地帯 / 強欲鉱山 / 削削パンダ / 回転橋
 * grid-map-maker JSON の配置をそのまま使用。
 * board.js の内部ヘルパは export されていないため、同等の構築部品をここに持つ。
 * （board.js からの循環 import を避けるため AREA_META は参照しない）
 */
const AREA_SHOP_MAX = 5;

const FALLBACK_AREA_META = {
  1: { color: '#5b7c99', pattern: 'check', patternInk: '#9eb6c9' },
  2: { color: '#3d6b5e', pattern: 'stripe', patternInk: '#7fad9c' },
  3: { color: '#4a6fa5', pattern: 'dots', patternInk: '#8fb0d9' },
  4: { color: '#5c6bc0', pattern: 'grid', patternInk: '#9aa6e0' },
  5: { color: '#6a5b8c', pattern: 'diamond', patternInk: '#a899c4' },
  6: { color: '#2f6f7a', pattern: 'check', patternInk: '#6ea8b3' },
  7: { color: '#455a7a', pattern: 'stripe', patternInk: '#7f95b5' },
  8: { color: '#51607a', pattern: 'dots', patternInk: '#8a9ab3' },
  9: { color: '#3f5f6b', pattern: 'grid', patternInk: '#7a9aa6' },
  10: { color: '#4d5f8a', pattern: 'diamond', patternInk: '#8796bc' },
  11: { color: '#3a6a72', pattern: 'stripe', patternInk: '#6f9aa3' },
  12: { color: '#4f6d8c', pattern: 'check', patternInk: '#8aa3bd' },
  13: { color: '#3f6f7e', pattern: 'dots', patternInk: '#7aa3b0' },
};

function link(...pairs) {
  for (const [a, b] of pairs) {
    if (!a.nexts.includes(b.id)) a.nexts.push(b.id);
    if (!b.nexts.includes(a.id)) b.nexts.push(a.id);
  }
}

/** 階層出口（・着）など、隣マスからは入れず出発のみの一方通行にする */
function sealInboundExceptSelf(nodes, isExit) {
  for (const exit of nodes) {
    if (!isExit(exit)) continue;
    exit.oneWayOut = true;
    for (const n of nodes) {
      if (n.id === exit.id || !n.nexts?.includes(exit.id)) continue;
      n.nexts = n.nexts.filter((id) => id !== exit.id);
    }
  }
}

/** 下降・着（地下）／上昇・着（地上）＝入口からの転送先。隣からの侵入は無効 */
function isShaftLandingExit(n) {
  if (!n || n.type !== 'shaft') return false;
  return (n.shaft === 'down' && n.floor === 2) || (n.shaft === 'up' && n.floor === 1);
}

function linkGridOrthoAndGapDiagonals(grid) {
  const ortho = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const diag = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      const a = row[c];
      if (!a) continue;
      for (const [dc, dr] of ortho) {
        const b = grid[r + dr]?.[c + dc];
        if (!b || a.id >= b.id) continue;
        link([a, b]);
      }
      for (const [dc, dr] of diag) {
        const b = grid[r + dr]?.[c + dc];
        if (!b || a.id >= b.id) continue;
        const cornerH = grid[r]?.[c + dc];
        const cornerV = grid[r + dr]?.[c];
        if (cornerH || cornerV) continue;
        link([a, b]);
      }
    }
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

function buildAreas(nodes, areaOverrides = {}, areaMeta = {}) {
  const areaIds = [...new Set(nodes.filter((n) => n.type === 'shop').map((n) => n.area))].sort((a, b) => a - b);
  const areas = {};
  for (const a of areaIds) {
    const shops = nodes.filter((n) => n.type === 'shop' && n.area === a);
    if (shops.length > AREA_SHOP_MAX) {
      throw new Error(`エリア${a}のお店が${shops.length}件（上限${AREA_SHOP_MAX}）`);
    }
    const avg = shops.reduce((s, n) => s + n.basePrice, 0) / shops.length;
    // board.js の STOCK_PRICE_MIN/MAX（10〜99）と同値。循環 import 回避のため直書き
    const targetStock = Math.max(10, Math.min(99, Math.floor(avg / 10)));
    const meta = { ...(FALLBACK_AREA_META[a] || {}), ...(areaMeta[a] || {}), ...(areaOverrides[a] || {}) };
    areas[a] = {
      B: Math.ceil((targetStock * 65536) / avg),
      stockPrice: targetStock,
      name: meta.name || `エリア${a}`,
      code: meta.code || `A${a}`,
      color: meta.color || '#888',
      pattern: meta.pattern || 'check',
      patternInk: meta.patternInk || '#aaa',
    };
  }
  return areas;
}

/** board.js の applySwitchState と同ロジック（循環 import 回避） */
function applySwitchStateLocal(g) {
  const nodes = g?.map || g?.nodes;
  if (!nodes) return;
  let nStates = 2;
  for (const mv of g.switchMoves || []) {
    const len = Array.isArray(mv?.pos) ? mv.pos.length : 0;
    if (len > nStates) nStates = len;
  }
  const state = Math.max(0, Math.floor(Number(g.switchState) || 0)) % nStates;
  g.switchState = state;
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

function packBoard(nodes, bank, cols, rows, extra = {}) {
  finalizeShops(nodes);
  for (const n of nodes) {
    if (!Array.isArray(n.baseNexts)) n.baseNexts = [...(n.nexts || [])];
  }
  const board = {
    nodes,
    areas: buildAreas(nodes, extra.areaOverrides, extra.areaMeta),
    startId: bank.id,
    initialCash: extra.initialCash ?? 2200,
    goal: extra.goal ?? 10000,
    cols,
    rows,
    mapId: extra.mapId,
    mapName: extra.mapName,
    diceMax: extra.diceMax != null ? Math.max(2, Math.floor(Number(extra.diceMax)) || 6) : null,
    switchState: extra.switchState || 0,
    switchGates: extra.switchGates || [],
    switchMoves: extra.switchMoves || [],
  };
  if (board.switchGates.length || board.switchMoves.length) {
    applySwitchStateLocal(board);
  }
  return board;
}

function putShop(put, N, col, row, area, shopIdx, shopNames, shopPrice) {
  const i = shopIdx[area]++;
  const names = shopNames[area];
  const prices = shopPrice[area];
  return put(col, row, N('shop', {
    label: names[i % names.length],
    area,
    basePrice: prices[i % prices.length],
    col,
    row,
  }));
}

const COMMON_MARKS = {
  '♠': 0, '♥': 1, '♦': 2, '♣': 3,
};

function putCommonSpecial(put, N, ch, col, row, ctx) {
  if (COMMON_MARKS[ch] != null) {
    put(col, row, N('mark', { label: ch, mark: COMMON_MARKS[ch], col, row }));
    return true;
  }
  if (ch === '銀') {
    ctx.bank = put(col, row, N('bank', { label: '銀行', isStart: true, col, row }));
    return true;
  }
  if (ch === '削') {
    put(col, row, N('scratch', { label: 'スクラッチ', col, row }));
    return true;
  }
  if (ch === 'ス') {
    ctx.slotCount += 1;
    const n = ctx.slotCount;
    put(col, row, N('minigame', {
      label: n === 1 ? 'スロット' : `スロット${'ⅡⅢⅣⅤⅥⅦⅧⅨⅩ'[n - 2] || n}`,
      game: 'slot',
      col,
      row,
    }));
    return true;
  }
  if (ch === '当') {
    put(col, row, N('minigame', { label: 'サイコロ当て', game: 'guess_dice', col, row }));
    return true;
  }
  if (ch === '株') {
    put(col, row, N('stockbroker', { label: '証券', col, row }));
    return true;
  }
  if (ch === 'ラ') {
    put(col, row, N('lucky', { label: '★', col, row }));
    return true;
  }
  if (ch === 'イ') {
    put(col, row, N('event', { label: 'イベント', col, row }));
    return true;
  }
  if (ch === '回') {
    put(col, row, N('rollon', { label: 'もう一回', col, row }));
    return true;
  }
  if (ch === 'ワ') {
    put(col, row, N('suit_fill', { label: 'ワイルド', col, row }));
    return true;
  }
  if (ch === 'ら') {
    put(col, row, N('warp_random', { label: 'ランダム転移', col, row }));
    return true;
  }
  if (ch === '催') {
    put(col, row, N('nudge', { label: '催促', col, row }));
    return true;
  }
  if (ch === '切') {
    put(col, row, N('switch', { label: 'スイッチ', col, row }));
    return true;
  }
  return false;
}

/**
 * 暮違某為町（30×20）。L区画は高価格。転送は 転／て の2組。
 */
export function buildKurechigai() {
  const { nodes, N } = makeNodeFactory();
  const gridRows = [
    '　　　　　　　　　　　♦ＡＡラＡＡ回　　　　　　　　　　　　',
    '　　　　　　　　　　　Ｂ　　　　　Ｃ　　　　　　　　　　　　',
    '　　　　　　　　　　　Ｂ　　　　　Ｃ　　　　　　　　　　　　',
    '　　　　　　　　　　　Ｂ　　　　　Ｃ　　　　　　　　　　　　',
    '　　　　　　　　　　　Ｂ　　　　　Ｃ　　　　　　　　　　　　',
    '　　　　ス削ス　ＪイＬイＤＤＤＤＤイＬ♣Ｋ　スワス　　　　　',
    '　　　　ス　ス　Ｊ　　　　　イ　　　　　Ｋ　ス　ス　　　　　',
    '　　　　株　転　転　　　　　銀　　　　　て　て　株　　　　　',
    '　　　　ス　ス　Ｊ　　　　　イ　　　　　Ｋ　ス　ス　　　　　',
    '　　　　スワス　Ｊ♠ＬイＥＥＥＥＥイＬイＫ　ス削ス　　　　　',
    '　　　　　　　　　　　Ｇ　　　　　Ｈ　　　　　　　　　　　　',
    '　　　　　　　　　　　Ｇ　　　　　Ｈ　　　　　　　　　　　　',
    '　　　　　　　　　　　Ｇ　　　　　Ｈ　　　　　　　　　　　　',
    '　　　　　　　　　　　Ｇ　　　　　Ｈ　　　　　　　　　　　　',
    '　　　　　　　　　　　回ＩＩラＩＩ♥　　　　　　　　　　　　',
    '　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　',
    '　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　',
    '　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　',
    '　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　',
    '　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　',
  ];
  const W = 30;
  const BLANK = '　';
  // F 欠番 → G以降を詰める
  const areaFromChar = {
    Ａ: 1, Ｂ: 2, Ｃ: 3, Ｄ: 4, Ｅ: 5,
    Ｇ: 6, Ｈ: 7, Ｉ: 8, Ｊ: 9, Ｋ: 10, Ｌ: 11,
  };
  const shopNames = {
    1: ['暮違カフェ', '某為パン', '角の茶屋', '路地みやげ'],
    2: ['北町食堂', '煙突屋', '屋根瓦屋', '風見鶏屋'],
    3: ['東町ホテル', '提灯屋', '軒下屋台', '看板みやげ'],
    4: ['中央横丁', 'のれん屋', '暖簾カフェ', '大通り屋'],
    5: ['南町マーケット', '石畳屋', '溝端屋', '井戸みやげ'],
    6: ['西の坂茶屋', '石段屋', '坂の上屋', '見晴らし屋'],
    7: ['東の坂食堂', '石垣屋', '坂の下屋', '荷車みやげ'],
    8: ['下町ホテル', '川端屋', '橋のたもと', '夕涼み屋'],
    9: ['裏路地ブティック', '猫の額屋', '抜け道屋', '隠し扉みやげ'],
    10: ['表通りマーケット', '馬車屋', '馬具屋', '蹄鉄みやげ'],
    11: ['某為大飯店', '暮違宝石店', '高台サロン', '夜会みやげ'],
  };
  const shopPrice = {
    1: [220, 180, 160, 260],
    2: [210, 175, 155, 250],
    3: [210, 175, 155, 250],
    4: [280, 240, 200, 320, 300],
    5: [280, 240, 200, 320, 300],
    6: [200, 170, 150, 240],
    7: [200, 170, 150, 240],
    8: [240, 200, 180, 280],
    9: [230, 190, 170, 270],
    10: [230, 190, 170, 270],
    11: [480, 420, 390, 520], // L 高価格
  };
  const shopIdx = Object.fromEntries(Object.keys(shopNames).map((k) => [k, 0]));
  const warpsByKind = { 転: [], て: [] };
  const warpLabels = {
    転: ['西転送', '西転送・対'],
    て: ['東転送', '東転送・対'],
  };

  /** @type {(object|null)[][]} */
  const grid = [];
  const put = (col, row, node) => {
    if (!grid[row]) grid[row] = [];
    grid[row][col] = node;
    return node;
  };
  const ctx = { bank: null, slotCount: 0 };

  for (let row = 0; row < gridRows.length; row++) {
    const chars = [...gridRows[row]];
    if (chars.length !== W) throw new Error(`暮違某為町: 行${row}の幅が${chars.length}`);
    for (let col = 0; col < chars.length; col++) {
      const ch = chars[col];
      if (ch === BLANK) continue;
      if (areaFromChar[ch]) {
        putShop(put, N, col, row, areaFromChar[ch], shopIdx, shopNames, shopPrice);
        continue;
      }
      if (putCommonSpecial(put, N, ch, col, row, ctx)) continue;
      if (warpsByKind[ch]) {
        const list = warpsByKind[ch];
        const labels = warpLabels[ch];
        const w = put(col, row, N('warp', {
          label: labels[list.length] || `転送${list.length + 1}`,
          col,
          row,
        }));
        list.push(w);
        continue;
      }
      throw new Error(`暮違某為町: 未知のマス ${ch} @${col},${row}`);
    }
  }
  if (!ctx.bank) throw new Error('暮違某為町: 銀行なし');
  for (const [kind, list] of Object.entries(warpsByKind)) {
    if (list.length !== 2) throw new Error(`暮違某為町: 転送「${kind}」が${list.length}件`);
    list[0].warpTo = list[1].id;
    list[1].warpTo = list[0].id;
  }
  linkGridOrthoAndGapDiagonals(grid);

  return packBoard(nodes, ctx.bank, W, gridRows.length, {
    mapId: 'kurechigai',
    mapName: '暮違某為町',
    diceMax: 6,
    goal: 15000,
    initialCash: 2200,
    areaOverrides: {
      1: { name: '暮違通り' },
      2: { name: '北町' },
      3: { name: '東町' },
      4: { name: '中央横丁' },
      5: { name: '南町' },
      6: { name: '西の坂' },
      7: { name: '東の坂' },
      8: { name: '下町' },
      9: { name: '裏路地' },
      10: { name: '表通り' },
      11: { name: '某為高台' },
    },
  });
}

/**
 * 空島地帯（22×17）。
 * 本島転Ａ↔♥右、Ｄ転↔♠左。♥左↔♦上、♠右↔♣下。
 * ♣上↔隣島Ｂ、♦下↔隣島Ｅ。ら＝ランダム転移（小島の転移マスへ）。
 * げ＝門（反対側の門へ即時ジャンプし残移動）。薬＝薬品マス。
 */
export function buildSkyIsles() {
  const { nodes, N } = makeNodeFactory();
  const gridRows = [
    '　　　　　　　　　　　　　　　　　　　　　　',
    '　　　　　　　　　　　　　　　ラＣＣ削げ　　',
    '　　　　　　♥Ｈイ　　　　　　Ｃ　　Ｂ　　　',
    '　　　　　　Ｈ　Ｈ　　　　　　Ｃ　　Ｂ　　　',
    '　　　　　　転Ｈ転　　　　　株転ＢＢワ　　　',
    '　　　　　　　　　　　　　Ａら　　　　　　　',
    '　　　　　　　　　　　　ＡＡ　　　　　　　　',
    '　♦Ｇ転　　　　　　　転Ａ　　　　　転ＪＪ　',
    '　Ｇ　Ｇ　　　　　　銀ス　　　　　　Ｊ　Ｊ　',
    '　ＧＧ転　　　　　Ｄ転　　　　　　　転Ｊ♣　',
    '　　　　　　　　ＤＤ　　　　　　　　　　　　',
    '　　　　　　　らＤ　　　　　　　　　　　　　',
    '　　　ワＥＥ転削　　　　　転Ｉ転　　　　　　',
    '　　　Ｅ　　Ｆ　　　　　　Ｉ　Ｉ　　　　　　',
    '　　　Ｅ　　Ｆ　　　　　　当Ｉ♠　　　　　　',
    '　　げ薬ＦＦス　　　　　　　　　　　　　　　',
    '　　　　　　　　　　　　　　　　　　　　　　',
  ];
  const W = 22;
  const BLANK = '　';
  const areaFromChar = {
    Ａ: 1, Ｂ: 2, Ｃ: 3, Ｄ: 4, Ｅ: 5,
    Ｆ: 6, Ｇ: 7, Ｈ: 8, Ｉ: 9, Ｊ: 10,
  };
  const shopNames = {
    1: ['浮島カフェ', '雲橋屋', '空中茶屋', '風鈴みやげ'],
    2: ['暁の塔ホテル', '翼の食堂', '夜明け屋', '暁みやげ'],
    3: ['晴嵐マーケット', '嵐除け屋', '風切り屋', '晴天みやげ'],
    4: ['本島広場', '石畳屋', '中央屋台', '広場みやげ'],
    5: ['翠緑庭園', '薬草屋', '蔦のカフェ', '翠みやげ'],
    6: ['霧の工房', '錬金屋', '霧笛屋', '霧みやげ'],
    7: ['西風の巣', '羽ばたき屋', '巣箱屋', '西風みやげ', 'とまり木屋'],
    8: ['心臓島ホテル', '鼓動屋', 'ルビー屋', '心臓みやげ'],
    9: ['東の灯台', '導き屋', '灯火屋', '灯台みやげ'],
    10: ['虹の拱門', '七色屋', '拱門カフェ', '虹みやげ', '空橋屋'],
  };
  const shopPrice = {
    1: [240, 200, 180, 280],
    2: [260, 220, 190, 300],
    3: [260, 220, 190, 300],
    4: [220, 180, 160, 260],
    5: [250, 210, 185, 290],
    6: [250, 210, 185, 290],
    7: [280, 240, 210, 320, 300],
    8: [300, 260, 230, 340],
    9: [270, 230, 200, 310],
    10: [290, 250, 220, 330, 310],
  };
  const shopIdx = Object.fromEntries(Object.keys(shopNames).map((k) => [k, 0]));

  /** @type {(object|null)[][]} */
  const grid = [];
  const put = (col, row, node) => {
    if (!grid[row]) grid[row] = [];
    grid[row][col] = node;
    return node;
  };
  const ctx = { bank: null, slotCount: 0 };
  /** @type {object[]} */
  const warps = [];
  /** @type {object[]} */
  const gates = [];

  for (let row = 0; row < gridRows.length; row++) {
    const chars = [...gridRows[row]];
    if (chars.length !== W) throw new Error(`空島地帯: 行${row}の幅が${chars.length}`);
    for (let col = 0; col < chars.length; col++) {
      const ch = chars[col];
      if (ch === BLANK) continue;
      if (areaFromChar[ch]) {
        putShop(put, N, col, row, areaFromChar[ch], shopIdx, shopNames, shopPrice);
        continue;
      }
      if (putCommonSpecial(put, N, ch, col, row, ctx)) continue;
      if (ch === '転') {
        const w = put(col, row, N('warp', { label: '空橋', col, row }));
        warps.push(w);
        continue;
      }
      if (ch === 'ら') {
        put(col, row, N('warp_random', { label: 'ランダム転移', col, row }));
        continue;
      }
      if (ch === 'げ') {
        const gate = put(col, row, N('gate', { label: '門', col, row }));
        gates.push(gate);
        continue;
      }
      if (ch === '薬') {
        put(col, row, N('potion', { label: '薬品', col, row }));
        continue;
      }
      throw new Error(`空島地帯: 未知のマス ${ch} @${col},${row}`);
    }
  }
  if (!ctx.bank) throw new Error('空島地帯: 銀行なし');
  if (gates.length !== 2) throw new Error(`空島地帯: 門は2つ必要（今${gates.length}）`);
  gates[0].gateTo = gates[1].id;
  gates[1].gateTo = gates[0].id;

  // 本島転Ａ↔♥右、Ｄ転↔♠左。♥左↔♦上、♠右↔♣下。♣上↔Ｂ、♦下↔Ｅ
  const byPos = new Map(warps.map((w) => [`${w.col},${w.row}`, w]));
  const pairs = [
    ['11,7', '8,4'],   // 本島転Ａ ↔ ハート右
    ['10,9', '13,12'], // 本島Ｄ転 ↔ スペード左
    ['6,4', '3,7'],    // ハート左 ↔ ダイヤ上
    ['15,12', '18,9'], // スペード右 ↔ クローバー下
    ['18,7', '15,4'],  // クローバー上 ↔ 隣島Ｂ
    ['3,9', '6,12'],   // ダイヤ下 ↔ 隣島Ｅ
  ];
  for (const [a, b] of pairs) {
    const wa = byPos.get(a);
    const wb = byPos.get(b);
    if (!wa || !wb) throw new Error(`空島地帯: 転送ペア欠損 ${a}-${b}`);
    wa.warpTo = wb.id;
    wb.warpTo = wa.id;
  }
  if (warps.some((w) => w.warpTo == null)) {
    throw new Error('空島地帯: 未ペアの転送があります');
  }

  linkGridOrthoAndGapDiagonals(grid);

  return packBoard(nodes, ctx.bank, W, gridRows.length, {
    mapId: 'sky_isles',
    mapName: '空島地帯',
    diceMax: 6,
    goal: 14000,
    initialCash: 2200,
    areaOverrides: {
      1: { name: '浮島広場' },
      2: { name: '暁の塔' },
      3: { name: '晴嵐島' },
      4: { name: '本島' },
      5: { name: '翠緑庭' },
      6: { name: '霧の工房' },
      7: { name: '西風の巣' },
      8: { name: '心臓島' },
      9: { name: '東の灯台' },
      10: { name: '虹の拱門' },
    },
  });
}

/**
 * 強欲鉱山（29×21）。一階A–H／地下一階I–L／地下二階N。
 * 下・上は通過で階層移動（残出目継続）。降・昇はぴったり停止で転移。
 */
export function buildGreedMine() {
  const { nodes, N } = makeNodeFactory();
  const gridRows = [
    '　　　　　　　　　　　　　　　　　　　　　　　　　　　　　',
    '　　　　　　　　　　　　　　　　　　　　　　　　　　　　　',
    '　　　　　　　　　　　　　　　　　　　　　　　　　　　　　',
    '　　　Ｅ削Ｅ♦Ｅ当Ｅ　　　　　　　　　　　　　　　　　　　',
    '　　Ｄ　　　上　　　Ａ　　　　　　　　　　　　　　　　　　',
    '　Ｈ　Ｄ　　　　　Ａ　Ｆ　　　　　　　　ワＩＩ削ＬＬ金　　',
    '　ス　　Ｄ　　　Ａ　　Ｆ　　　　　　　　Ｉ　　　　　Ｌ　　',
    '　Ｈ　　　Ｄ　Ａ　　　イ　　　　　　　　Ｉ　　　　　Ｌ　　',
    '　♣下　　　銀　　　下♥　　　　　　　下削降ラスラ降削上　',
    '　Ｈ　　　Ｃ　Ｂ　　　株　　　　　　　　Ｊ　　　　　Ｋ　　',
    '　鉄　　Ｃ　　　Ｂ　　Ｆ　　　　　　　　Ｊ　　　　　Ｋ　　',
    '　Ｈ　Ｃ　　　　　Ｂ　Ｆ　　　　　　　　ワＪＪ削ＫＫワ　　',
    '　　Ｃ　　　下　　　Ｂ　　　　　　　　　　　　　　　　　　',
    '　　　ＧＧス♠イＧＧ　　　　　　　　　　　　　　　　　　　',
    '　　　　　　　　　　　　　削Ｎ株ダ削　　　　　　　　　　　',
    '　　　　　　　　　　　　　ス　　　ス　　　　　　　　　　　',
    '　　　　　　　　　　　　　削Ｎ昇Ｎ削　　　　　　　　　　　',
    '　　　　　　　　　　　　　　　　　　　　　　　　　　　　　',
    '　　　　　　　　　　　　　　　　　　　　　　　　　　　　　',
    '　　　　　　　　　　　　　　　　　　　　　　　　　　　　　',
    '　　　　　　　　　　　　　　　　　　　　　　　　　　　　　',
  ];
  const W = 29;
  const BLANK = '　';
  const areaFromChar = {
    Ａ: 1, Ｂ: 2, Ｃ: 3, Ｄ: 4, Ｅ: 5, Ｆ: 6, Ｇ: 7, Ｈ: 8,
    Ｉ: 9, Ｊ: 10, Ｋ: 11, Ｌ: 12, Ｎ: 13,
  };
  const shopNames = {
    1: ['坑口カフェ', 'ヘルメット屋', '入坑みやげ', '安全灯屋'],
    2: ['鉱車通り', 'レール屋', 'トロッコ屋', '車輪みやげ'],
    3: ['支柱横丁', '梁材屋', '支保屋', '杭みやげ'],
    4: ['鉱石市場', '検鉱屋', '品位屋', '原石みやげ'],
    5: ['発破ホテル', '火薬屋', '導火線屋', '轟音みやげ'],
    6: ['選鉱場', '篩い屋', '水簸屋', '精鉱みやげ'],
    7: ['排気塔食堂', '風洞屋', '換気屋', '排気みやげ'],
    8: ['坑道宿', '寝台屋', 'カンテラ屋', '坑夫みやげ'],
    9: ['地下街ホテル', '鍾乳屋', '岩盤カフェ', '地下みやげ'],
    10: ['鋼の市場', 'インゴット屋', '圧延屋', '鋼みやげ'],
    11: ['宝石工房', '研磨屋', 'カット屋', '輝きみやげ'],
    12: ['金庫通り', '金塊屋', '金箔屋', '財宝みやげ'],
    13: ['深淵ホテル', '暗黒屋', '深層カフェ'],
  };
  const shopPrice = {
    1: [200, 170, 150, 240],
    2: [210, 175, 155, 250],
    3: [210, 175, 155, 250],
    4: [240, 200, 180, 280],
    5: [260, 220, 190, 300],
    6: [250, 210, 185, 290],
    7: [230, 190, 170, 270],
    8: [220, 185, 165, 260],
    9: [320, 280, 250, 360],
    10: [340, 300, 270, 380],
    11: [360, 320, 290, 400],
    12: [400, 360, 330, 450],
    13: [480, 440, 500], // 地下二階は高リスク高価格（3軒）
  };
  const shopIdx = Object.fromEntries(Object.keys(shopNames).map((k) => [k, 0]));

  /** @type {(object|null)[][]} */
  const grid = [];
  const put = (col, row, node) => {
    if (!grid[row]) grid[row] = [];
    grid[row][col] = node;
    return node;
  };
  const ctx = { bank: null, slotCount: 0 };

  for (let row = 0; row < gridRows.length; row++) {
    const chars = [...gridRows[row]];
    if (chars.length !== W) throw new Error(`強欲鉱山: 行${row}の幅が${chars.length}`);
    for (let col = 0; col < chars.length; col++) {
      const ch = chars[col];
      if (ch === BLANK) continue;
      if (areaFromChar[ch]) {
        putShop(put, N, col, row, areaFromChar[ch], shopIdx, shopNames, shopPrice);
        continue;
      }
      if (putCommonSpecial(put, N, ch, col, row, ctx)) continue;
      if (ch === '下') {
        // col>=19 は地下一階の着地側
        const floor = col >= 19 ? 2 : 1;
        put(col, row, N('shaft', {
          label: floor === 1 ? '下降' : '下降・着',
          shaft: 'down',
          floor,
          col,
          row,
          ...(floor === 2 ? { oneWayOut: true } : {}),
        }));
        continue;
      }
      if (ch === '上') {
        // col>=19 は地下一階の出発側、それ以外は一階の着地側
        const floor = col >= 19 ? 2 : 1;
        put(col, row, N('shaft', {
          label: floor === 2 ? '上昇' : '上昇・着',
          shaft: 'up',
          floor,
          col,
          row,
          ...(floor === 1 ? { oneWayOut: true } : {}),
        }));
        continue;
      }
      if (ch === '降') {
        put(col, row, N('pit', { label: '転移下降', pit: 'down', col, row }));
        continue;
      }
      if (ch === '昇') {
        put(col, row, N('pit', { label: '転移上昇', pit: 'up', col, row }));
        continue;
      }
      if (ch === '鉄') {
        put(col, row, N('ore', { label: '鉄鉱石', ore: 'iron', col, row }));
        continue;
      }
      if (ch === '金') {
        put(col, row, N('ore', { label: '金鉱石', ore: 'gold', col, row }));
        continue;
      }
      if (ch === 'ダ') {
        put(col, row, N('ore', { label: 'ダイヤ鉱石', ore: 'diamond', col, row }));
        continue;
      }
      throw new Error(`強欲鉱山: 未知のマス ${ch} @${col},${row}`);
    }
  }
  if (!ctx.bank) throw new Error('強欲鉱山: 銀行なし');
  linkGridOrthoAndGapDiagonals(grid);
  // 上昇・着／下降・着は階層転送の出口。隣マスから入っても効果がないので侵入禁止（出ていく一方通行）
  sealInboundExceptSelf(nodes, isShaftLandingExit);

  return packBoard(nodes, ctx.bank, W, gridRows.length, {
    mapId: 'greed_mine',
    mapName: '強欲鉱山',
    diceMax: 7,
    goal: 18000,
    initialCash: 2100,
    areaOverrides: {
      1: { name: '坑口' },
      2: { name: '鉱車通り' },
      3: { name: '支柱横丁' },
      4: { name: '鉱石市場' },
      5: { name: '発破場' },
      6: { name: '選鉱場' },
      7: { name: '排気塔' },
      8: { name: '坑道宿' },
      9: { name: '地下街' },
      10: { name: '鋼の市場' },
      11: { name: '宝石工房' },
      12: { name: '金庫通り' },
      13: { name: '深淵' },
    },
  });
}

/**
 * 削削パンダ（12×15）。
 * スクラッチ多め＋催促マス。ら＝ランダム転移。店名は竹・パンダ系。
 */
export function buildScratchPanda() {
  const { nodes, N } = makeNodeFactory();
  const gridRows = [
    '　　　　　　　　　　　　',
    '　♦ＣＣらＦＦ削ＦＦ♠　',
    '　Ｂ　　Ｄ　　Ｅ　　Ｇ　',
    '　Ｂ　　Ｄ　　スＥＥ株　',
    '　Ｂ　　当ＤＤ削　　Ｇ　',
    '　削ＣＣ削　　Ｅ　　Ｇ　',
    '　Ｂ　　Ｄ　　Ｅ　　Ｇ　',
    '　削ＡＡ銀ＡＡ削　　ワ　',
    '　Ｈ　　Ｊ　　Ｋ　　Ｍ　',
    '　催ＩＩ催　　Ｋ　　Ｍ　',
    '　Ｈ　　削ＪＪ削　　Ｍ　',
    '　Ｈ　　Ｊ　　催ＫＫ削　',
    '　Ｈ　　Ｊ　　Ｋ　　Ｍ　',
    '　♥ＩＩ削ＬＬ株ＬＬ♣　',
    '　　　　　　　　　　　　',
  ];
  const W = 12;
  const BLANK = '　';
  const areaFromChar = {
    Ａ: 1, Ｂ: 2, Ｃ: 3, Ｄ: 4, Ｅ: 5,
    Ｆ: 6, Ｇ: 7, Ｈ: 8, Ｉ: 9, Ｊ: 10,
    Ｋ: 11, Ｌ: 12, Ｍ: 13,
  };
  const shopNames = {
    1: ['パンダ茶屋', '笹団子屋', '白黒カフェ', '竹林みやげ'],
    2: ['西の笹横丁', '竹細工屋', '笹の葉屋', 'パンダ屋台'],
    3: ['北笹マーケット', '竹筒屋', '笹飴屋', '青笹みやげ'],
    4: ['中央竹通り', '竹炭屋', '笹寿司屋', '竹籠みやげ'],
    5: ['東の熊猫食堂', 'パンダまん', '笹アイス', '黒目みやげ'],
    6: ['北東パンダホテル', '竹フロア宿', '笹の展望台', '白熊みやげ'],
    7: ['東端みやげ市', 'パンダグッズ', '竹ぼうき屋', '笹笛屋'],
    8: ['南西笹小路', '竹垣屋', '笹餅屋', '子パンダ屋'],
    9: ['南の笹縁', '竹とんぼ屋', '笹舟屋', 'パンダクレープ'],
    10: ['南中央工房', '竹ひご屋', '笹すだれ屋', '墨パンダ屋'],
    11: ['南東熊猫市', 'パンダ焼', '竹ストロー屋', '笹サイダー'],
    12: ['南端竹市場', '竹刀屋', '笹の湯', '白黒みやげ'],
    13: ['東南パンダ通り', '竹ランプ屋', '笹カーテン屋', '熊猫ホテル'],
  };
  const shopPrice = {
    1: [280, 220, 200, 320],
    2: [240, 200, 180, 260],
    3: [250, 210, 190, 280],
    4: [260, 220, 200, 300],
    5: [250, 210, 190, 280],
    6: [300, 260, 230, 340],
    7: [240, 200, 180, 270],
    8: [230, 190, 170, 250],
    9: [240, 200, 180, 260],
    10: [250, 210, 190, 280],
    11: [250, 210, 190, 280],
    12: [270, 230, 210, 310],
    13: [260, 220, 200, 300],
  };
  const shopIdx = Object.fromEntries(Object.keys(shopNames).map((k) => [k, 0]));
  /** @type {(object|null)[][]} */
  const grid = [];
  const put = (col, row, node) => {
    if (!grid[row]) grid[row] = [];
    grid[row][col] = node;
    return node;
  };
  const ctx = { bank: null, slotCount: 0 };

  for (let row = 0; row < gridRows.length; row++) {
    const chars = [...gridRows[row]];
    if (chars.length !== W) throw new Error(`削削パンダ: 行${row}の幅が${chars.length}`);
    for (let col = 0; col < chars.length; col++) {
      const ch = chars[col];
      if (ch === BLANK) continue;
      if (areaFromChar[ch]) {
        putShop(put, N, col, row, areaFromChar[ch], shopIdx, shopNames, shopPrice);
        continue;
      }
      if (putCommonSpecial(put, N, ch, col, row, ctx)) continue;
      throw new Error(`削削パンダ: 未知のマス ${ch} @${col},${row}`);
    }
  }
  if (!ctx.bank) throw new Error('削削パンダ: 銀行なし');
  linkGridOrthoAndGapDiagonals(grid);

  return packBoard(nodes, ctx.bank, W, gridRows.length, {
    mapId: 'scratch_panda',
    mapName: '削削パンダ',
    diceMax: 6,
    goal: 15000,
    initialCash: 2200,
    areaOverrides: {
      1: { name: 'パンダ茶屋通り', code: 'A1' },
      2: { name: '西の笹横丁', code: 'B1' },
      3: { name: '北笹マーケット', code: 'B2' },
      4: { name: '中央竹通り', code: 'B3' },
      5: { name: '東の熊猫食堂', code: 'B4' },
      6: { name: '北東パンダホテル', code: 'B5' },
      7: { name: '東端みやげ市', code: 'B6' },
      8: { name: '南西笹小路', code: 'C1' },
      9: { name: '南の笹縁', code: 'C2' },
      10: { name: '南中央工房', code: 'C3' },
      11: { name: '南東熊猫市', code: 'C4' },
      12: { name: '南端竹市場', code: 'C5' },
      13: { name: '東南パンダ通り', code: 'C6' },
    },
  });
}

/**
 * 回転橋（13×13）。
 * Aエリア＋変動銀行が北東西南の4地点をスイッチでランダム移動。
 * 横移動は回転、正面は平行移動の演出用メタを switchMoves に載せる。
 */
export function buildRotateBridge() {
  const { nodes, N } = makeNodeFactory();
  // １２３４・銀は可変のためグリッドには置かず、後で movable を載せる
  const gridRows = [
    '　　　スＢＢ切ＣＣラ　　　',
    '　　　Ｂ　　　　　Ｃ　　　',
    '　　　Ｂ　　　　　Ｃ　　　',
    '削ＩＩ♥　　　　　♠ＤＤイ',
    'Ｉ　　　　　　　　　　　Ｄ',
    'Ｉ　　　　　　　　　　　Ｄ',
    '切　　　　　　　　　　　切',
    'Ｈ　　　　　　　　　　　Ｅ',
    'Ｈ　　　　　　　　　　　Ｅ',
    'イＨＨ♦　　　　　♣ＥＥ削',
    '　　　Ｇ　　　　　Ｆ　　　',
    '　　　Ｇ　　　　　Ｆ　　　',
    '　　　ラＧＧ切ＦＦス　　　',
  ];
  const W = 13;
  const BLANK = '　';
  const areaFromChar = {
    Ｂ: 2, Ｃ: 3, Ｄ: 4, Ｅ: 5,
    Ｆ: 6, Ｇ: 7, Ｈ: 8, Ｉ: 9,
  };
  const shopNames = {
    1: ['橋の茶屋', '欄干カフェ', '渡舟屋', '回転みやげ'],
    2: ['北西埠頭屋', '錨カフェ', '北風屋', '埠頭みやげ'],
    3: ['北東灯台屋', '霧笛屋', '灯火カフェ', '岬みやげ'],
    4: ['東波止場', '桟橋食堂', '潮風屋', '波止みやげ'],
    5: ['南東倉庫通り', 'クレーン屋', '荷揚げ屋', '倉庫みやげ'],
    6: ['南東砂浜通り', '砂浜カフェ', '貝掘り屋', '南風みやげ'],
    7: ['南西干潟市', 'しおさい屋', '干潟カフェ', '貝殻みやげ'],
    8: ['西運河横丁', '運河食堂', '水門屋', '運河みやげ'],
    9: ['北西運河市', '船大工', 'ロープ屋', '運河みやげ'],
  };
  const shopPrice = {
    1: [300, 260, 240, 340],
    2: [240, 200, 180, 270],
    3: [240, 200, 180, 270],
    4: [250, 210, 190, 280],
    5: [250, 210, 190, 280],
    6: [240, 200, 180, 270],
    7: [240, 200, 180, 270],
    8: [250, 210, 190, 280],
    9: [250, 210, 190, 280],
  };
  const shopIdx = Object.fromEntries(Object.keys(shopNames).map((k) => [k, 0]));
  /** @type {(object|null)[][]} */
  const grid = [];
  const put = (col, row, node) => {
    if (!grid[row]) grid[row] = [];
    grid[row][col] = node;
    return node;
  };
  const ctx = { bank: null, slotCount: 0 };
  /** @type {object[]} */
  const switches = [];

  for (let row = 0; row < gridRows.length; row++) {
    const chars = [...gridRows[row]];
    if (chars.length !== W) throw new Error(`回転橋: 行${row}の幅が${chars.length}`);
    for (let col = 0; col < chars.length; col++) {
      const ch = chars[col];
      if (ch === BLANK) continue;
      if (areaFromChar[ch]) {
        putShop(put, N, col, row, areaFromChar[ch], shopIdx, shopNames, shopPrice);
        continue;
      }
      if (ch === '切') {
        const sw = put(col, row, N('switch', { label: 'スイッチ', col, row }));
        switches.push(sw);
        continue;
      }
      if (putCommonSpecial(put, N, ch, col, row, ctx)) continue;
      throw new Error(`回転橋: 未知のマス ${ch} @${col},${row}`);
    }
  }

  // Aエリア4店＋変動銀行。中心 (6,6) まわりの幾何回転で N→E→S→W がつながる。
  // 状態0=北 1=東 2=南 3=西／movable 順: a0,a1,bank,a2,a3
  // E/W は銀行と同じ縦軸（東 col9／西 col3）に店＋銀を一列配置。
  const armPos = [
    // N: ♥１１銀１１♠
    [{ col: 4, row: 3 }, { col: 5, row: 3 }, { col: 6, row: 3 }, { col: 7, row: 3 }, { col: 8, row: 3 }],
    // E: 銀と同じ縦軸 col9（中央は銀行）
    [{ col: 9, row: 4 }, { col: 9, row: 5 }, { col: 9, row: 6 }, { col: 9, row: 7 }, { col: 9, row: 8 }],
    // S: ♦３３銀３３♣（回転継続のため左右反転スロット）
    [{ col: 8, row: 9 }, { col: 7, row: 9 }, { col: 6, row: 9 }, { col: 5, row: 9 }, { col: 4, row: 9 }],
    // W: 銀と同じ縦軸 col3（中央は銀行）
    [{ col: 3, row: 8 }, { col: 3, row: 7 }, { col: 3, row: 6 }, { col: 3, row: 5 }, { col: 3, row: 4 }],
  ];
  const aNames = shopNames[1];
  const aPrices = shopPrice[1];
  const movable = [];
  for (let i = 0; i < 5; i++) {
    const p0 = armPos[0][i];
    let node;
    if (i === 2) {
      node = N('bank', { label: '銀行', isStart: true, col: p0.col, row: p0.row });
      ctx.bank = node;
    } else {
      const si = i < 2 ? i : i - 1;
      node = N('shop', {
        label: aNames[si % aNames.length],
        area: 1,
        basePrice: aPrices[si % aPrices.length],
        col: p0.col,
        row: p0.row,
      });
    }
    put(p0.col, p0.row, node);
    movable.push(node);
  }
  if (!ctx.bank) throw new Error('回転橋: 銀行なし');

  linkGridOrthoAndGapDiagonals(grid);

  // 静的リンクを確定してから、可変ノードの baseNexts は空に（ゲートのみで接続）
  for (const n of movable) {
    // グリッド ortho で付いた仮リンクを剥がし、ゲートに任せる
    for (const other of nodes) {
      if (other.id === n.id) continue;
      other.nexts = (other.nexts || []).filter((id) => id !== n.id);
    }
    n.nexts = [];
  }

  const byCR = (c, r) => grid[r]?.[c];
  const heart = byCR(3, 3);
  const spade = byCR(9, 3);
  const diamond = byCR(3, 9);
  const club = byCR(9, 9);
  const swN = byCR(6, 0);
  const swE = byCR(12, 6);
  const swS = byCR(6, 12);
  const swW = byCR(0, 6);
  // 北南アーム端の行き止まり防止（同列の外周店へ）
  const bTop = byCR(4, 0);
  const cTop = byCR(8, 0);
  const gBot = byCR(4, 12);
  const fBot = byCR(8, 12);

  const [a0, a1, bank, a2, a3] = movable;
  const switchMoves = movable.map((n, i) => ({
    id: n.id,
    pos: armPos.map((arm) => ({ col: arm[i].col, row: arm[i].row })),
  }));

  /** @type {{a:number,b:number,when:number}[]} */
  const switchGates = [];
  const gate = (when, a, b) => {
    if (!a || !b) return;
    switchGates.push({ a: a.id, b: b.id, when });
  };
  // N: ♥—A—銀—A—♠ ＋ 北辺Ｂ/Ｃ・北スイッチ
  gate(0, heart, a0);
  gate(0, a0, a1);
  gate(0, a1, bank);
  gate(0, bank, a2);
  gate(0, a2, a3);
  gate(0, a3, spade);
  gate(0, a0, bTop);
  gate(0, a3, cTop);
  gate(0, swN, bank);
  // E: ♠—A—銀—A—♣（銀と同じ縦軸）＋東スイッチ
  gate(1, spade, a0);
  gate(1, a0, a1);
  gate(1, a1, bank);
  gate(1, bank, a2);
  gate(1, a2, a3);
  gate(1, a3, club);
  gate(1, bank, swE);
  // S: ♣—A—銀—A—♦ ＋ 南辺Ｆ/Ｇ・南スイッチ
  gate(2, club, a0);
  gate(2, a0, a1);
  gate(2, a1, bank);
  gate(2, bank, a2);
  gate(2, a2, a3);
  gate(2, a3, diamond);
  gate(2, a0, fBot);
  gate(2, a3, gBot);
  gate(2, swS, bank);
  // W: ♦—A—銀—A—♥（銀と同じ縦軸）＋西スイッチ
  gate(3, diamond, a0);
  gate(3, a0, a1);
  gate(3, a1, bank);
  gate(3, bank, a2);
  gate(3, a2, a3);
  gate(3, a3, heart);
  gate(3, bank, swW);

  return packBoard(nodes, ctx.bank, W, gridRows.length, {
    mapId: 'rotate_bridge',
    mapName: '回転橋',
    diceMax: 6,
    goal: 14000,
    initialCash: 2200,
    switchState: 0,
    switchGates,
    switchMoves,
    areaOverrides: {
      1: { name: '回転橋', code: 'A1' },
      2: { name: '北西埠頭', code: 'B1' },
      3: { name: '北東灯台', code: 'B2' },
      4: { name: '東波止場', code: 'C1' },
      5: { name: '南東倉庫', code: 'C2' },
      6: { name: '南東砂浜', code: 'D1' },
      7: { name: '南西干潟', code: 'D2' },
      8: { name: '西運河', code: 'E1' },
      9: { name: '北西運河', code: 'E2' },
    },
  });
}
