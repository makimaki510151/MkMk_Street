/** MkMk Street — 10×10 イベント表（1〜200番をランダム配置） */

export const TABLE_SIZE = 10;
export const EVENT_COUNT = 200;
/** 同じ色が3つ以上そろったときの1マスあたりボーナス */
export const MATCH_BONUS_PER = 60;

/** プレイヤー色インデックスと対応（あか/あお/きいろ/みどり） */
export const COLOR_LABELS = ['あか', 'あお', 'きいろ', 'みどり'];
export const GROUP_COLORS = ['#e85d75', '#3d8bfd', '#f0a202', '#20c997'];

/**
 * 1〜200 のユニークイベント定義。
 * kind は効果種別、label は表示名（差分バリエーションではなく固有名）。
 */
function buildCatalog() {
  const list = [];
  const push = (kind, label, data = {}) => {
    list.push({ id: list.length + 1, kind, label, ...data });
  };

  // 金運・商売（固有名）
  const goldNames = [
    ['treasure_map', '宝の地図'], ['street_fair', '縁日の儲け'], ['lost_wallet', '落とし物発見'],
    ['tip_jar', 'チップ箱いっぱい'], ['antique_sale', '骨董市'], ['night_market', '夜店ボーナス'],
    ['coupon_rain', '割引券の雨'], ['gold_fish', '金魚すくい賞'], ['parade_tip', 'パレード祝儀'],
    ['mailbox_cash', '郵便受けの現金'], ['side_job', '副業の報酬'], ['busking', '路上ライブ収益'],
    ['lottery_petal', '花びらくじ'], ['charity_return', '寄付の還元'], ['tourist_boom', '観光客ラッシュ'],
    ['viral_post', 'バズった宣伝'], ['rainy_sale', '雨の日セール'], ['sunrise_deal', '朝市特価'],
    ['friend_treat', '友からの差し入れ'], ['secret_stash', '隠し金庫'],
  ];
  goldNames.forEach(([kind, label], i) => push(kind, label, { cash: 120 + i * 18 }));

  // 出費・ハプニング（休みではない）
  const costNames = [
    ['flat_tire', 'パンク修理'], ['umbrella_buy', '傘を買った'], ['snack_spree', 'おやつ散財'],
    ['parking_fee', '駐車料金'], ['phone_bill', '通信費請求'], ['laundry', 'クリーニング代'],
    ['broken_sign', '看板修繕'], ['fine_dust', '罰金（ほこり）'], ['overdue_book', '延滞料'],
    ['coffee_spill', 'コーヒー弁償'],
  ];
  costNames.forEach(([kind, label], i) => push(kind, label, { cash: -(80 + i * 15) }));

  // 株・投資
  const stockNames = [
    ['broker_tip', '証券屋の耳打ち'], ['penny_stock', '端株ゲット'], ['dividend_day', '配当日'],
    ['ipo_invite', 'IPOのお誘い'], ['bull_run', '株価急騰の余波'], ['bear_hedge', 'ヘッジ成功'],
    ['share_gift', '株の贈り物'], ['analyst_note', 'アナリスト便り'], ['floor_pass', '取引フロア通行証'],
    ['portfolio_tune', 'ポートフォリオ調整'],
  ];
  stockNames.forEach(([kind, label], i) => push(kind, label, { stocks: 5 + (i % 4) * 5 }));

  // お店・街
  const shopNames = [
    ['remodel_aid', '改装助成金'], ['flyer_boost', 'チラシ効果'], ['vip_card', 'VIPカード'],
    ['rent_discount', '家賃割引券'], ['window_display', 'ショーウィンドウ賞'], ['local_fame', '地元の評判'],
    ['supply_deal', '仕入れ特約'], ['staff_cheer', '店員応援'], ['grand_reopen', 'リニューアル祝'],
    ['area_banner', 'エリア横断幕'],
  ];
  shopNames.forEach(([kind, label], i) => push(kind, label, { shopBoost: 40 + i * 10 }));

  // 移動・チャンス（休みなし）
  const moveNames = [
    ['taxi_voucher', 'タクシー券'], ['express_lane', '急行レーン'], ['shortcut_alley', '抜け道発見'],
    ['roll_again', 'もう一振り'], ['bank_warp', '銀行ワープ'], ['suit_finder', 'マーク探知機'],
    ['lucky_charm', '幸運のお守り'], ['invest_half', '増資半額券'], ['double_step', '二歩の靴'],
    ['compass', '街の羅針盤'],
  ];
  moveNames.forEach(([kind, label]) => push(kind, label));

  // ユニーク演出系を埋めて 200 まで
  const flavor = [
    '星空観測会', 'ねこカフェ訪問', '風船リリース', '花火のあと', '朝霧の散歩',
    '図書館の司書賞', '屋上菜園', '駅前ライブ', '砂浜の貝がら', '雪だるまコンテスト',
    '虹を見たご褒美', '雲の形クイズ', '風鈴の音色', '桜餅タイム', 'ひまわり畑',
    '電車の席ゆずり', '迷子案内ボーナス', '写真コンテスト', '手書き地図完成', '秘密の近道メモ',
    '青空食堂', '路地裏ギャラリー', '橋のたもと広場', '港の汽笛', '山手の展望台',
    '川辺のマルシェ', '夜の星占い', '朝の体操会', '夕やけスケッチ', '真昼の昼寝枕',
    'フルーツ狩りの分け前', 'パンの耳アソート', 'スパイス交換会', '紅茶の試飲会', '氷菓フェス',
    '楽器レンタル得', '劇団チケット', '映画館半券', 'ゲーム大会景品', 'パズル完成賞',
    'スタンプカード満了', 'ポイント還元日', '会員ランクアップ', '紹介キャンペーン', 'リピート特典',
    '季節の福袋', '福引の当たり', 'ガラガラポン', 'カプセル景品', 'トレード成立',
    '交渉上手', '値切り成功', 'まとめ買い得', '早割り適用', 'レイトショー割',
    'ボランティア感謝', '清掃キャンペーン', '植樹の記念', 'リサイクル賞', 'エコバッグ進呈',
    '雨宿りお茶', '日傘シェア', 'ベンチの会話', '看板猫タッチ', '鳩にエサやり',
    '郵便配達ありがとう', '工事現場の差し入れ', '交番の落とし物', '学校のバザー', '町内会のお礼',
    'ラジオ出演料', 'ポッドキャスト差し入れ', 'ブログの広告', 'チラシ折りバイト', '撮影エキストラ',
    '筋トレジム体験', 'ヨガ体験会', 'ジョギング完走', '水泳教室', 'ダンスレッスン',
    '英会話体験', '料理教室', '陶芸ひとかけ', '書道の清書', 'そろばん検定',
    '朝市くじ', '夜市くじ', '港くじ', '山くじ', '空くじ',
    '月曜マジック', '火曜トライ', '水曜ウィッシュ', '木曜チャーム', '金曜フィーバー',
    '土曜サプライズ', '日曜リラックス', '祝日スペシャル', '満月ボーナス', '新月ボーナス',
    '春一番', '夏祭り', '秋祭り', '冬ぼんてん', '節分豆',
    'ひな祭り', 'こどもの日', '七夕短冊', 'お月見だんご', 'ハロウィン飴',
    'クリスマスリース', 'お正月お年玉風', 'バレンタインお返し', 'ホワイトデー', 'エイプリルフール',
    'ゴールデンウィーク', 'シルバーウィーク', 'ブルーマンデー回避', 'オレンジデイ', 'ティールタイム',
    'ミントの香り', 'ラベンダー畑', 'ローズガーデン', 'サイダー工場', 'チョコレート工房',
    'チーズ工房', 'はちみつスタンド', 'オリーブオイル市', '紅茶オークション', 'コーヒー焙煎所',
    '時計台の鐘', '噴水広場', 'アーケード街', '屋上ビア', '地下通路の壁画',
    '横断歩道の音楽', '信号待ちの幸運', 'エレベーター相席', 'エスカレーター右側', '改札の忘れ物',
  ];

  let fi = 0;
  while (list.length < EVENT_COUNT) {
    const name = flavor[fi % flavor.length] + (fi >= flavor.length ? ` ${Math.floor(fi / flavor.length) + 1}` : '');
    const slot = fi % 7;
    if (slot === 0) push(`flavor_cash_${fi}`, name, { cash: 90 + (fi % 12) * 12 });
    else if (slot === 1) push(`flavor_cost_${fi}`, name, { cash: -(50 + (fi % 8) * 10) });
    else if (slot === 2) push(`flavor_stock_${fi}`, name, { stocks: 5 + (fi % 3) * 5 });
    else if (slot === 3) push(`flavor_shop_${fi}`, name, { shopBoost: 30 + (fi % 5) * 15 });
    else if (slot === 4) push(`flavor_roll_${fi}`, name, { extraRoll: true });
    else if (slot === 5) push(`flavor_lucky_${fi}`, name, { lucky: true });
    else push(`flavor_mark_${fi}`, name, { grantMark: true });
    fi++;
  }

  return list.slice(0, EVENT_COUNT);
}

export const EVENT_CATALOG = buildCatalog();

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** プレイヤー用 10×10 表：1〜200 からランダム配置＋プレイヤー色 */
export function createEventTable(seed = 1) {
  const rng = mulberry32(seed);
  const cells = [];
  for (let i = 0; i < TABLE_SIZE * TABLE_SIZE; i++) {
    const eventId = 1 + Math.floor(rng() * EVENT_COUNT);
    const def = EVENT_CATALOG[eventId - 1];
    const color = Math.floor(rng() * 4);
    cells.push({
      id: i,
      eventId,
      kind: def.kind,
      label: `#${eventId} ${def.label}`,
      shortLabel: def.label,
      color,
      group: color,
      scratched: false,
    });
  }
  return {
    size: TABLE_SIZE,
    cells,
    claimedMatches: {},
  };
}

export function unscratchedIds(table) {
  return table.cells.filter((c) => !c.scratched).map((c) => c.id);
}

export function scratchCell(g, player, cellId) {
  const table = g.sharedEventTable || player.eventTable;
  if (!table) return { ok: false, error: 'no_table' };
  const cell = table.cells[cellId];
  if (!cell || cell.scratched) return { ok: false, error: 'bad_cell' };

  cell.scratched = true;
  cell.scratchedBy = player.id;
  const messages = [];
  const def = EVENT_CATALOG[cell.eventId - 1];
  applyEventDef(g, player, def, messages);

  const matchBonus = checkColorMatches(g, table, cellId, messages);

  return { ok: true, cell, matchBonus, messages };
}

function applyEventDef(g, player, def, messages) {
  if (!def) {
    player.cash += 50;
    messages.push('+50G');
    return;
  }

  if (def.cash) {
    if (def.cash > 0) {
      player.cash += def.cash;
      messages.push(`+${def.cash}G`);
    } else {
      const n = Math.min(player.cash, -def.cash);
      player.cash -= n;
      messages.push(`-${n}G`);
    }
  }
  if (def.stocks) {
    const areas = Object.keys(g.areas).map(Number);
    const a = areas[Math.floor(Math.random() * areas.length)];
    player.stocks[a] = (player.stocks[a] || 0) + def.stocks;
    messages.push(`A${a}株 +${def.stocks}`);
  }
  if (def.shopBoost) {
    const shops = g.map.filter((s) => s.type === 'shop' && s.owner === player.id);
    if (shops.length) {
      const sq = shops[Math.floor(Math.random() * shops.length)];
      sq.extraInvest = (sq.extraInvest || 0) + def.shopBoost;
      sq.price += def.shopBoost;
      messages.push(`「${sq.label}」価値 +${def.shopBoost}G`);
    } else {
      player.cash += def.shopBoost;
      messages.push(`所持店なしのため +${def.shopBoost}G`);
    }
  }
  if (def.extraRoll || def.kind === 'roll_again' || def.kind === 'express_lane' || def.kind === 'double_step') {
    player.flags.extraRoll = true;
    messages.push('もう一度サイコロ！');
  }
  if (def.kind === 'bank_warp' || def.kind === 'taxi_voucher') {
    player.pos = g.startId;
    player.prevPos = null;
    messages.push('銀行へ移動');
  }
  if (def.kind === 'suit_finder' || def.grantMark) {
    const missing = player.marks.findIndex((m) => !m);
    if (missing >= 0) {
      player.marks[missing] = true;
      messages.push('不足マーク入手');
    } else {
      player.cash += 100;
      messages.push('マーク揃済 +100G');
    }
  }
  if (def.kind === 'lucky_charm' || def.lucky) {
    player.lucky = true;
    messages.push('ラッキーステータス');
  }
  if (def.kind === 'invest_half' || def.kind === 'vip_card') {
    player.flags.investCoupon = true;
    messages.push('次の増資が半額');
  }
  if (def.kind === 'shortcut_alley' || def.kind === 'compass') {
    player.cash += 100;
    messages.push('近道ボーナス +100G');
  }

  if (!messages.length) {
    player.cash += 80;
    messages.push(`${def.label} +80G`);
  }
}

/** 縦・横・斜めに同じ色が3つ以上（スクラッチ済み）そろえば、その色のプレイヤーに報酬 */
function checkColorMatches(g, table, cellId, messages) {
  const size = table.size;
  const row = Math.floor(cellId / size);
  const col = cellId % size;
  const lines = [];

  lines.push({ key: `r${row}`, cells: Array.from({ length: size }, (_, c) => row * size + c) });
  lines.push({ key: `c${col}`, cells: Array.from({ length: size }, (_, r) => r * size + col) });

  if (row === col) {
    lines.push({ key: 'd0', cells: Array.from({ length: size }, (_, i) => i * size + i) });
  }
  if (row + col === size - 1) {
    lines.push({ key: 'd1', cells: Array.from({ length: size }, (_, i) => i * size + (size - 1 - i)) });
  }

  let total = 0;
  if (!table.claimedMatches) table.claimedMatches = {};

  for (const line of lines) {
    const counts = [0, 0, 0, 0];
    for (const id of line.cells) {
      const cell = table.cells[id];
      if (cell.scratched) counts[cell.color] += 1;
    }
    for (let color = 0; color < 4; color++) {
      const n = counts[color];
      if (n < 3) continue;
      const claimKey = `${line.key}-c${color}-n${n}`;
      // 同じ本数での二重取り防止。増えたら再支給可
      const prevKey = Object.keys(table.claimedMatches).find((k) => k.startsWith(`${line.key}-c${color}-`));
      if (prevKey && table.claimedMatches[prevKey] >= n) continue;
      if (prevKey) delete table.claimedMatches[prevKey];
      table.claimedMatches[claimKey] = n;

      const bonus = n * MATCH_BONUS_PER;
      const beneficiary = g.players.find((p) => !p.bankrupt && p.id === color)
        || g.players.find((p) => !p.bankrupt && (p.color || '').toLowerCase() === GROUP_COLORS[color].toLowerCase())
        || g.players[color];
      if (beneficiary && !beneficiary.bankrupt) {
        beneficiary.cash += bonus;
        total += bonus;
        messages.push(`${COLOR_LABELS[color]}色そろい×${n} → ${beneficiary.name} +${bonus}G`);
      }
    }
  }
  return total;
}
