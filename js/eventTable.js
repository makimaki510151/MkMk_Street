/** MkMk Street — 10×10 イベント表スクラッチ（マーク着地時） */

export const TABLE_SIZE = 10;

/** セル種別（色分け用グループ付き） */
export const CELL_KINDS = [
  { id: 'cash_s', group: 0, label: '+150G', weight: 14 },
  { id: 'cash_m', group: 0, label: '+300G', weight: 10 },
  { id: 'cash_l', group: 0, label: '+500G', weight: 5 },
  { id: 'tax_s', group: 1, label: '-100G', weight: 10 },
  { id: 'tax_m', group: 1, label: '-200G', weight: 6 },
  { id: 'stock', group: 2, label: '株+10', weight: 8 },
  { id: 'salary', group: 2, label: '半額賞金', weight: 5 },
  { id: 'holiday', group: 3, label: '店休1T', weight: 7 },
  { id: 'rest', group: 3, label: '休み1T', weight: 6 },
  { id: 'rollon', group: 4, label: 'もう一回', weight: 6 },
  { id: 'invest', group: 4, label: '増資半額', weight: 6 },
  { id: 'lucky', group: 4, label: 'ラッキー', weight: 5 },
  { id: 'warp', group: 5, label: '銀行へ', weight: 4 },
  { id: 'mark', group: 5, label: '不足マーク', weight: 4 },
  { id: 'bonus_line', group: 0, label: '+80G', weight: 8 },
];

export const GROUP_COLORS = [
  '#3cb371', // 緑系・プラス金
  '#e85d75', // 赤系・マイナス
  '#3d8bfd', // 青・株/賞
  '#f0a202', // 黄・休み系
  '#9b6bff', // 紫・特典
  '#20c997', // ティール・移動/マーク
];

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickKind(rng) {
  const total = CELL_KINDS.reduce((s, k) => s + k.weight, 0);
  let r = rng() * total;
  for (const k of CELL_KINDS) {
    r -= k.weight;
    if (r <= 0) return k;
  }
  return CELL_KINDS[0];
}

/** プレイヤー用 10×10 表を生成 */
export function createEventTable(seed = 1) {
  const rng = mulberry32(seed);
  const cells = [];
  for (let i = 0; i < TABLE_SIZE * TABLE_SIZE; i++) {
    const kind = pickKind(rng);
    cells.push({
      id: i,
      kind: kind.id,
      group: kind.group,
      label: kind.label,
      scratched: false,
    });
  }
  return {
    size: TABLE_SIZE,
    cells,
    lineBonuses: { rows: Array(TABLE_SIZE).fill(false), cols: Array(TABLE_SIZE).fill(false) },
  };
}

export function unscratchedIds(table) {
  return table.cells.filter((c) => !c.scratched).map((c) => c.id);
}

/**
 * セルをスクラッチして効果を適用。
 * @returns {{ cell, lineBonus, messages }}
 */
export function scratchCell(g, player, cellId) {
  const table = player.eventTable;
  if (!table) return { ok: false, error: 'no_table' };
  const cell = table.cells[cellId];
  if (!cell || cell.scratched) return { ok: false, error: 'bad_cell' };

  cell.scratched = true;
  const messages = [];
  applyCellEffect(g, player, cell, messages);

  const lineBonus = checkLineBonuses(table, cellId, player, messages);

  return { ok: true, cell, lineBonus, messages };
}

function applyCellEffect(g, player, cell, messages) {
  switch (cell.kind) {
    case 'cash_s':
      player.cash += 150;
      messages.push(`+150G`);
      break;
    case 'cash_m':
      player.cash += 300;
      messages.push(`+300G`);
      break;
    case 'cash_l':
      player.cash += 500;
      messages.push(`+500G`);
      break;
    case 'tax_s':
      player.cash = Math.max(0, player.cash - 100);
      messages.push(`-100G`);
      break;
    case 'tax_m':
      player.cash = Math.max(0, player.cash - 200);
      messages.push(`-200G`);
      break;
    case 'stock': {
      const areas = Object.keys(g.areas).map(Number);
      const a = areas[Math.floor(Math.random() * areas.length)];
      player.stocks[a] = (player.stocks[a] || 0) + 10;
      messages.push(`A${a}株 +10`);
      break;
    }
    case 'salary': {
      const shopTotal = g.map
        .filter((s) => s.type === 'shop' && s.owner === player.id)
        .reduce((s, sq) => s + sq.price, 0);
      const n = Math.floor((400 + 150 * player.level + shopTotal * 0.1) * 0.5);
      player.cash += n;
      messages.push(`半額賞金 +${n}G`);
      break;
    }
    case 'holiday':
      player.shopsClosed = true;
      messages.push(`お店が1ターン休み`);
      break;
    case 'rest':
      player.resting = true;
      messages.push(`次ターン休み`);
      break;
    case 'rollon':
      player.flags.extraRoll = true;
      messages.push(`もう一度サイコロ！`);
      break;
    case 'invest':
      player.flags.investCoupon = true;
      messages.push(`次の増資が半額`);
      break;
    case 'lucky':
      player.lucky = true;
      messages.push(`ラッキーステータス`);
      break;
    case 'warp':
      player.pos = g.startId;
      player.prevPos = null;
      messages.push(`銀行へワープ`);
      break;
    case 'mark': {
      const missing = player.marks.findIndex((m) => !m);
      if (missing >= 0) {
        player.marks[missing] = true;
        messages.push(`不足マーク入手`);
      } else {
        player.cash += 100;
        messages.push(`マーク揃済のため +100G`);
      }
      break;
    }
    case 'bonus_line':
      player.cash += 80;
      messages.push(`+80G`);
      break;
    default:
      player.cash += 50;
      messages.push(`+50G`);
  }
}

function checkLineBonuses(table, cellId, player, messages) {
  const size = table.size;
  const row = Math.floor(cellId / size);
  const col = cellId % size;
  let gained = 0;

  const rowComplete = Array.from({ length: size }, (_, c) => table.cells[row * size + c])
    .every((c) => c.scratched);
  if (rowComplete && !table.lineBonuses.rows[row]) {
    table.lineBonuses.rows[row] = true;
    // 同色（同group）が揃っていればボーナス増
    const groups = Array.from({ length: size }, (_, c) => table.cells[row * size + c].group);
    const same = groups.every((g) => g === groups[0]);
    const bonus = same ? 200 : Math.max(40, groups.filter((g) => g === groups[0]).length * 10);
    player.cash += bonus;
    messages.push(`横一列クリア！ +${bonus}G`);
    gained += bonus;
  }

  const colComplete = Array.from({ length: size }, (_, r) => table.cells[r * size + col])
    .every((c) => c.scratched);
  if (colComplete && !table.lineBonuses.cols[col]) {
    table.lineBonuses.cols[col] = true;
    const groups = Array.from({ length: size }, (_, r) => table.cells[r * size + col].group);
    const same = groups.every((g) => g === groups[0]);
    const bonus = same ? 200 : Math.max(40, groups.filter((g) => g === groups[0]).length * 10);
    player.cash += bonus;
    messages.push(`縦一列クリア！ +${bonus}G`);
    gained += bonus;
  }

  return gained;
}
