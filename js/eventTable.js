/** MkMk Street — 10×10 イベント表（1〜200番をランダム配置） */

import { remainingInvest } from './investLimits.js';

export const TABLE_SIZE = 10;
export const EVENT_COUNT = 200;
/** 同じ色が3つ以上そろったときの1マスあたりボーナス */
export const MATCH_BONUS_PER = 50;

/** プレイヤー色インデックスと対応（あか/あお/きいろ/みどり） */
export const COLOR_LABELS = ['あか', 'あお', 'きいろ', 'みどり'];
export const GROUP_COLORS = ['#e85d75', '#3d8bfd', '#f0a202', '#20c997'];

/** ワープ演出用。serializeState には含めず、UIが takeWarpFx で取り出す */
export function recordWarp(g, pid, from, to) {
  if (from == null || to == null || from === to) return;
  if (!g.warpFx) g.warpFx = [];
  g.warpFx.push({ pid, from, to });
}

export function takeWarpFx(g) {
  const warps = g.warpFx ? [...g.warpFx] : [];
  g.warpFx = null;
  return warps;
}

/**
 * 1〜200 のユニークイベント定義。
 * G増減に偏らず、移動・株・店・相手干渉・ステータスなど多彩に配分。
 */
function buildCatalog() {
  /** @type {{kind:string,label:string,cash?:number,stocks?:number,shopBoost?:number,extraRoll?:boolean,lucky?:boolean,grantMark?:boolean,effect?:string,amount?:number}[]} */
  const list = [];
  const push = (kind, label, data = {}) => {
    list.push({ id: list.length + 1, kind, label, ...data });
  };

  // ── 小〜中の金運（一部はレベル連動）────────────────────────
  [
    ['treasure_map', '宝の地図', 50, 30], ['street_fair', '縁日の儲け', 60, 25],
    ['lost_wallet', '落とし物発見', 70, 35], ['tip_jar', 'チップ箱', 40, 20],
    ['night_market', '夜店ボーナス', 55, 28], ['busking', '路上ライブ', 45, 22],
    ['lottery_petal', '花びらくじ', 65, 30], ['friend_treat', '差し入れ', 35, 18],
    ['parade_tip', 'パレード祝儀', 50, 25], ['secret_stash', '隠し金庫', 80, 40],
  ].forEach(([k, l, cash, levelScale]) => push(k, l, { cash, levelScale, effect: 'cash' }));

  // ── レベル基準の特別金運 ─────────────────────────────────
  [
    ['rank_allowance', '階級手当', 100, 60],
    ['title_bonus', '肩書きボーナス', 80, 50],
    ['seniority_pay', '年功加算', 60, 70],
    ['badge_stipend', 'バッジ支給', 90, 45],
    ['promotion_prep', '昇進準備金', 70, 55],
  ].forEach(([k, l, cash, levelScale]) => push(k, l, { cash, levelScale, effect: 'cash' }));

  // ── 小〜中の出費（一部レベル連動）──────────────────────────
  [
    ['flat_tire', 'パンク修理', -40, -20], ['parking_fee', '駐車料金', -30, -15],
    ['phone_bill', '通信費', -35, -18], ['laundry', 'クリーニング', -25, -12],
    ['broken_sign', '看板修繕', -50, -25], ['overdue_book', '延滞料', -20, -10],
    ['coffee_spill', '弁償コーヒー', -30, -12], ['umbrella_buy', '急ぎの傘', -20, -8],
    ['rank_dues', '階級維持費', -40, -30], ['title_tax', '肩書き税', -35, -28],
  ].forEach(([k, l, cash, levelScale]) => push(k, l, { cash, levelScale, effect: 'cash' }));

  // ── 株 ─────────────────────────────────────────────────
  [
    ['broker_tip', '証券屋の耳打ち', 8], ['penny_stock', '端株ゲット', 5],
    ['dividend_day', '配当日', 10], ['ipo_invite', 'IPOのお誘い', 12],
    ['share_gift', '株の贈り物', 15], ['analyst_note', 'アナリスト便り', 7],
    ['floor_pass', '取引フロア通行', 6], ['portfolio_tune', '配分見直し', 9],
    ['bull_echo', '急騰の余波', 11], ['quiet_buy', '静かな買い', 5],
  ].forEach(([k, l, stocks]) => push(k, l, { stocks, effect: 'stocks' }));

  // ── 店の価値アップ ───────────────────────────────────────
  [
    ['remodel_aid', '改装助成', 50], ['flyer_boost', 'チラシ効果', 40],
    ['window_display', 'ショーウィンドウ', 55], ['local_fame', '地元の評判', 45],
    ['supply_deal', '仕入れ特約', 60], ['grand_reopen', 'リニューアル祝', 70],
    ['area_banner', 'エリア横断幕', 35], ['staff_cheer', '店員の応援', 40],
  ].forEach(([k, l, shopBoost]) => push(k, l, { shopBoost, effect: 'shop_boost' }));

  // ── 好きな自分の店へ無料増資（選択・レベル連動あり）────────
  [
    ['free_remodel', '好きなお店を改装', 50, 20],
    ['owner_choice_boost', '店主の采配', 40, 18],
    ['pick_renovation', '改装オーダー', 55, 22],
    ['my_shop_glowup', '推し店を磨こう', 35, 15],
    ['selective_invest', '一点集中投資', 60, 25],
    ['spotlight_shop', 'スポットライト改装', 45, 18],
    ['rank_remodel', '階級改装権', 40, 30],
  ].forEach(([k, l, amount, levelScale]) => push(k, l, { effect: 'pick_invest', amount, levelScale }));

  // ── サイコロ・移動 ───────────────────────────────────────
  [
    ['roll_again', 'もう一振り'], ['express_lane', '急行レーン'],
    ['double_step', '二歩の靴'], ['shortcut_alley', '抜け道発見'],
    ['dice_charm', '賽の加護'], ['sprint_shoes', 'ダッシュシューズ'],
    ['wind_boost', '追い風'], ['relay_baton', 'バトンタッチ'],
  ].forEach(([k, l]) => push(k, l, { effect: 'extra_roll', extraRoll: true }));

  [
    ['bank_warp', '銀行ワープ'], ['taxi_voucher', 'タクシー券'],
    ['home_portal', '帰宅ポータル'],
  ].forEach(([k, l]) => push(k, l, { effect: 'warp_bank' }));

  [
    ['warp_mark', 'マーク地点へ'], ['suit_beacon', 'スートの灯台'],
  ].forEach(([k, l]) => push(k, l, { effect: 'warp_mark' }));

  [
    ['warp_shop', '空き店へワープ'], ['browse_street', '商店街めぐり'],
  ].forEach(([k, l]) => push(k, l, { effect: 'warp_vacant_shop' }));

  [
    ['warp_random', '迷子ワープ'], ['teleport_glitch', '転移の不調'],
  ].forEach(([k, l]) => push(k, l, { effect: 'warp_random' }));

  // ── マーク・ステータス ───────────────────────────────────
  [
    ['suit_finder', 'マーク探知機'], ['compass', '街の羅針盤'],
    ['mark_radar', 'スートレーダー'], ['collector_note', '収集家のメモ'],
    ['corner_map', '四隅の地図'],
  ].forEach(([k, l]) => push(k, l, { effect: 'grant_mark', grantMark: true }));

  [
    ['lucky_charm', '幸運のお守り'], ['rabbit_foot', 'うさぎの足'],
    ['four_leaf', '四つ葉'], ['sparkle_dust', 'きらめきの粉'],
    ['lucky_aura', '強運のオーラ'],
  ].forEach(([k, l]) => push(k, l, { effect: 'lucky', lucky: true }));

  [
    ['invest_half', '増資半額券'], ['vip_card', 'VIPカード'],
    ['coupon_book', 'クーポン冊子'], ['builder_pass', '工事パス'],
  ].forEach(([k, l]) => push(k, l, { effect: 'invest_coupon' }));

  [
    ['toll_shield', '通行守り'], ['guard_badge', 'ガードバッジ'],
    ['free_pass', 'フリーパス'],
  ].forEach(([k, l]) => push(k, l, { effect: 'toll_shield' }));

  [
    ['toll_boost', '買い物料アップ'], ['landlord_seal', '家主の印章'],
  ].forEach(([k, l]) => push(k, l, { effect: 'toll_boost' }));

  // ── 店休・休憩（少なめ）─────────────────────────────────
  [
    ['shop_nap', 'お店お昼寝'], ['holiday_notice', '臨時休業のお知らせ'],
  ].forEach(([k, l]) => push(k, l, { effect: 'own_shop_holiday' }));

  [
    ['rival_closed', 'ライバル店休'], ['city_inspection', '抜き打ち検査'],
  ].forEach(([k, l]) => push(k, l, { effect: 'rival_shop_holiday' }));

  [
    ['park_bench', '公園のベンチ'],
  ].forEach(([k, l]) => push(k, l, { effect: 'rest' }));

  // ── 独占打開（ライバル独占エリアへのカウンター）──────────
  [
    ['antitrust_raid', '独占摘発'], ['break_chain', 'チェーン崩し'],
    ['hostile_takeover', '敵対的買収くじ'],
  ].forEach(([k, l]) => push(k, l, { effect: 'seize_mono_shop' }));

  [
    ['mono_nap', '独占店の昼寝'], ['regulator_holiday', '規制当局の休業令'],
  ].forEach(([k, l]) => push(k, l, { effect: 'mono_area_holiday' }));

  [
    ['mono_tax', '独占税'], ['fair_trade_fine', '独禁法の罰金'],
  ].forEach(([k, l]) => push(k, l, { effect: 'mono_tax', amount: 180 }));

  [
    ['value_slash', '独占店の値崩れ'], ['price_cut_wave', '価格破壊の波'],
  ].forEach(([k, l]) => push(k, l, { effect: 'slash_mono_value', amount: 50 }));

  [
    ['cheap_takeover', 'お買い得買収券'], ['three_times_pass', '3倍買いクーポン'],
  ].forEach(([k, l]) => push(k, l, { effect: 'five_buy_coupon' }));

  [
    ['mono_stock_siphon', '独占エリア株の横取り'],
  ].forEach(([k, l]) => push(k, l, { effect: 'steal_mono_stock', amount: 8 }));

  // ── 全員の持ち金アップ（発動者レベルで厚みが変わる）────────
  [
    ['payday_all', '給料日', 70, 20], ['bonus_wave', 'ボーナス支給', 80, 25],
    ['town_stimulus', '景気刺激策', 55, 15], ['festival_boom', 'お祭り景気', 60, 18],
    ['tourist_rush', '観光客ラッシュ', 50, 12], ['year_end_refund', '年末還付', 75, 22],
    ['new_year_gift', 'お年玉タイム', 65, 20], ['summer_bonus', '夏のボーナス', 85, 28],
    ['street_dividend', '通りの配当', 50, 15], ['mayor_gift', '市長からの贈り物', 55, 18],
    ['prosperity_bell', '繁栄の鐘', 70, 22], ['market_cheer', '市場の万歳', 45, 12],
    ['rank_celebration', '階級のお祝い', 60, 30],
  ].forEach(([k, l, cash, levelScale]) => push(k, l, { cash, levelScale, effect: 'all_cash' }));

  // ── ミニゲーム（勝利者＋全員に参加賞）────────────────────
  [
    ['mini_dice', 'サイコロ当て', 'guess_dice'],
    ['mini_highlow', 'ハイ＆ロー', 'high_low'],
    ['mini_coin', 'コイントス', 'coin'],
    ['mini_slot', 'ファイブスロット', 'slot'],
    ['dice_carnival', '賽のカーニバル', 'guess_dice'],
    ['lucky_flip', 'ラッキーフリップ', 'coin'],
    ['card_highlow', 'カードハイロー', 'high_low'],
    ['neon_slot', 'ネオンスロット', 'slot'],
    ['fortune_dice', 'フォーチュンダイス', 'guess_dice'],
    ['party_coin', 'パーティーコイン', 'coin'],
  ].forEach(([k, l, game]) => push(k, l, { effect: 'minigame', game }));

  // ── 相手・分配インタラクション ───────────────────────────
  [
    ['charity_box', '募金箱'], ['share_candy', 'あめ玉シェア'],
  ].forEach(([k, l]) => push(k, l, { effect: 'donate_poorest', amount: 80 }));

  [
    ['toll_echo', '買い物料の反響'], ['rich_tax', '金持ち税'],
  ].forEach(([k, l]) => push(k, l, { effect: 'tax_richest', amount: 70 }));

  [
    ['stock_swap_hint', '株の交換話'], ['borrow_share', '株の貸し借り'],
  ].forEach(([k, l]) => push(k, l, { effect: 'steal_stock', amount: 5 }));

  [
    ['position_trade', '場所交換'], ['seat_change', '席替え'],
  ].forEach(([k, l]) => push(k, l, { effect: 'swap_pos' }));

  // ── 相場・エリア ─────────────────────────────────────────
  [
    ['bull_run', '株価急騰'], ['rumor_mill', '噂の相場'],
    ['hot_tip', 'アツい筋'],
  ].forEach(([k, l]) => push(k, l, { effect: 'bump_area_stock', amount: 1.12 }));

  [
    ['bear_dip', '株価調整'], ['cold_water', '冷や水'],
  ].forEach(([k, l]) => push(k, l, { effect: 'bump_area_stock', amount: 0.92 }));

  [
    ['area_cheer', 'エリア応援'], ['street_festival', '通りの祭り'],
  ].forEach(([k, l]) => push(k, l, { effect: 'boost_area_shops', amount: 25 }));

  [
    ['sell_pressure', '利確の波'], ['thin_out', '持ち株整理'],
  ].forEach(([k, l]) => push(k, l, { effect: 'trim_stocks', amount: 5 }));

  [
    ['all_shop_polish', '全店みがき'], ['chain_care', 'チェーン整備'],
  ].forEach(([k, l]) => push(k, l, { effect: 'boost_all_shops', amount: 20 }));

  // ── 複合・ユニーク（レベル連動を混ぜる）────────────────────
  [
    ['level_toast', '昇進の予祝', { effect: 'grant_mark', grantMark: true }],
    ['dice_and_coin', '賽と硬貨', { effect: 'extra_roll', extraRoll: true, cash: 25, levelScale: 15 }],
    ['shop_and_share', '店と株セット', { effect: 'shop_and_stock', shopBoost: 20, levelScale: 10, stocks: 5 }],
    ['lucky_invest', '強運の増資', { effect: 'lucky_invest', lucky: true }],
    ['mono_break_kit', '打開キット', { effect: 'five_buy_coupon', cash: 40 }],
    ['bank_bonus_trip', '銀行寄り道', { effect: 'warp_bank', cash: 30, levelScale: 20 }],
    ['mark_festival', 'マーク祭', { effect: 'grant_two_marks' }],
    ['stock_shower', '株のシャワー', { effect: 'multi_stocks', amount: 4 }],
    ['street_cleanup', '街の清掃', { effect: 'boost_all_shops', amount: 15 }],
    ['mystery_box', 'ミステリー箱', { effect: 'mystery' }],
    ['fortune_wheel', '運命の輪', { effect: 'mystery' }],
    ['all_hands_raise', 'みんなで乾杯', { effect: 'all_cash', cash: 90, levelScale: 25 }],
    ['city_wide_sale', '全市セール還元', { effect: 'all_cash', cash: 40, levelScale: 12 }],
    ['level_salary_day', '階級給料日', { effect: 'cash', cash: 80, levelScale: 70 }],
    ['rank_shop_polish', '階級店みがき', { effect: 'shop_boost', shopBoost: 25, levelScale: 20 }],
  ].forEach(([k, l, data]) => push(k, l, data));

  // ── 残りを多彩フレーバーで埋める（G偏重を避けるローテーション）──
  const flavor = [
    '星空観測会', 'ねこカフェ訪問', '風船リリース', '花火のあと', '朝霧の散歩',
    '図書館の司書賞', '屋上菜園', '駅前ライブ', '砂浜の貝がら', '雪だるまコンテスト',
    '虹を見たご褒美', '雲の形クイズ', '風鈴の音色', '桜餅タイム', 'ひまわり畑',
    '電車の席ゆずり', '迷子案内', '写真コンテスト', '手書き地図', '秘密の近道メモ',
    '青空食堂', '路地裏ギャラリー', '橋のたもと広場', '港の汽笛', '山手の展望台',
    '川辺のマルシェ', '夜の星占い', '朝の体操会', '夕やけスケッチ', '真昼の昼寝',
    'フルーツ狩り', 'パンの耳アソート', 'スパイス交換会', '紅茶の試飲', '氷菓フェス',
    '楽器レンタル', '劇団チケット', '映画館半券', 'ゲーム大会', 'パズル完成',
    'スタンプ満了', '会員ランクアップ', '紹介キャンペーン', 'リピート特典', '季節の福袋',
    '福引の当たり', 'ガラガラポン', 'カプセル景品', 'トレード成立', '交渉上手',
    'ボランティア感謝', '清掃キャンペーン', '植樹の記念', 'リサイクル賞', 'エコバッグ',
    '雨宿りお茶', '日傘シェア', 'ベンチの会話', '看板猫タッチ', '鳩にエサやり',
    '郵便配達ありがとう', '工事現場の差し入れ', '交番の落とし物', '学校のバザー', '町内会のお礼',
    'ラジオ出演', '撮影エキストラ', '筋トレ体験', 'ヨガ体験会', 'ジョギング完走',
    '水泳教室', 'ダンスレッスン', '英会話体験', '料理教室', '陶芸ひとかけ',
    '書道の清書', 'そろばん検定', '月曜マジック', '火曜トライ', '水曜ウィッシュ',
    '木曜チャーム', '金曜フィーバー', '土曜サプライズ', '日曜リラックス', '祝日スペシャル',
    '満月散歩', '新月の誓い', '春一番', '夏祭り', '秋祭り',
    '冬ぼんてん', '節分豆', 'ひな祭り', 'こどもの日', '七夕短冊',
    'お月見', 'ハロウィン', 'クリスマス', 'お正月', 'バレンタイン',
    'ホワイトデー', 'エイプリルフール', 'ミントの香り', 'ラベンダー畑', 'ローズガーデン',
    'サイダー工場', 'チョコレート工房', 'チーズ工房', 'はちみつスタンド', '時計台の鐘',
    '噴水広場', 'アーケード街', '屋上テラス', '地下通路の壁画', '横断歩道の音楽',
    '信号待ちの幸運', 'エレベーター相席', '改札の忘れ物', '青信号ラッシュ', '夕焼けロード',
  ];

  /** フレーバー埋めの効果ローテ（Gは少なめ／全員ボーナス・ミニゲームも混ぜる） */
  const flavorEffects = [
    { effect: 'extra_roll', extraRoll: true },
    { effect: 'lucky', lucky: true },
    { effect: 'grant_mark', grantMark: true },
    { effect: 'stocks', stocks: 5 },
    { effect: 'shop_boost', shopBoost: 20, levelScale: 8 },
    { effect: 'pick_invest', amount: 40, levelScale: 12 },
    { effect: 'invest_coupon' },
    { effect: 'toll_shield' },
    { effect: 'bump_area_stock', amount: 1.08 },
    { effect: 'warp_random' },
    { effect: 'mystery' },
    { effect: 'cash', cash: 30, levelScale: 18 },
    { effect: 'all_cash', cash: 30, levelScale: 10 },
    { effect: 'minigame', game: 'coin' },
    { effect: 'minigame', game: 'high_low' },
    { effect: 'trim_stocks', amount: 3 },
    { effect: 'boost_area_shops', amount: 20 },
    { effect: 'donate_poorest', amount: 50 },
    { effect: 'multi_stocks', amount: 3 },
  ];

  let fi = 0;
  while (list.length < EVENT_COUNT) {
    const name = flavor[fi % flavor.length] + (fi >= flavor.length ? `・${Math.floor(fi / flavor.length) + 1}` : '');
    const data = { ...flavorEffects[fi % flavorEffects.length] };
    push(`flavor_${fi}`, name, data);
    fi++;
  }

  return list.slice(0, EVENT_COUNT).map((e, i) => ({ ...e, id: i + 1 }));
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

function pickRandom(arr) {
  if (!arr?.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function otherPlayers(g, player) {
  return g.players.filter((p) => p.id !== player.id && !p.bankrupt);
}

/** プレイヤー用 10×10 表：1〜200 からランダム配置＋色 */
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

/** プレイヤー色 → 表の色インデックス（あか/あお/きいろ/みどり） */
export function playerColorIndex(player) {
  const c = (player?.color || '').toLowerCase();
  const idx = GROUP_COLORS.findIndex((g) => g.toLowerCase() === c);
  return idx >= 0 ? idx : (player?.id ?? 0) % GROUP_COLORS.length;
}

export function scratchCell(g, player, cellId) {
  const table = g.sharedEventTable || player.eventTable;
  if (!table) return { ok: false, error: 'no_table' };
  const cell = table.cells[cellId];
  if (!cell || cell.scratched) return { ok: false, error: 'bad_cell' };

  cell.scratched = true;
  cell.scratchedBy = player.id;
  // 開けた人の色で塗る（そろいボーナスもその色）
  const painted = playerColorIndex(player);
  cell.color = painted;
  cell.group = painted;
  const messages = [];
  const def = EVENT_CATALOG[cell.eventId - 1];
  applyEventDef(g, player, def, messages);

  const match = checkColorMatches(g, table, cellId, messages);
  const warps = takeWarpFx(g);

  return {
    ok: true,
    cell,
    matchBonus: match.total,
    matches: match.matches,
    messages,
    warps,
  };
}

/** 自分以外が独占しているエリア一覧 */
function findRivalMonopolies(g, playerId) {
  /** @type {{ area: number, ownerId: number, shops: object[], name: string }[]} */
  const out = [];
  for (const a of Object.keys(g.areas || {}).map(Number)) {
    const shops = g.map.filter((s) => s.type === 'shop' && s.area === a);
    if (!shops.length) continue;
    const owners = [...new Set(shops.map((s) => s.owner))];
    if (owners.length !== 1) continue;
    const oid = owners[0];
    if (oid < 0 || oid === playerId) continue;
    out.push({
      area: a,
      ownerId: oid,
      shops,
      name: g.areas[a]?.name || `A${a}`,
    });
  }
  return out;
}

function clearMonoFlag(g, pid, area) {
  const p = g.players[pid];
  if (p?.flags?.monopolyBonusClaimed) delete p.flags.monopolyBonusClaimed[area];
}

function refreshAreaStockPrice(g, area) {
  const meta = g.areas[area];
  if (!meta) return;
  const shops = g.map.filter((s) => s.type === 'shop' && s.area === area);
  if (!shops.length) return;
  const avg = shops.reduce((s, sq) => s + sq.price, 0) / shops.length;
  meta.stockPrice = Math.max(1, Math.floor((avg / 65536) * (meta.B || 100)));
}

function grantLuckyStatus(player, messages) {
  player.lucky = true;
  if (player.flags) player.flags.luckyExpireOnTurn = false;
  messages.push('ラッキー：他者の買い物料の20%を銀行から受取（次の自分の番まで）');
}

/** 基本額 + レベル×levelScale（スクラッチのレベル基準イベント用） */
function scaledAmount(def, player, field = 'cash') {
  const base = Number(def?.[field] ?? def?.amount ?? 0);
  const scale = Number(def?.levelScale || 0);
  if (!scale) return Math.floor(base);
  const lv = Math.max(1, Number(player?.level) || 1);
  return Math.floor(base + lv * scale);
}

function applyCash(player, amount, messages) {
  if (!amount) return;
  if (amount > 0) {
    player.cash += amount;
    messages.push(`+${amount}G`);
  } else {
    const n = Math.min(player.cash, -amount);
    player.cash -= n;
    messages.push(`-${n}G`);
  }
}

/** 生存プレイヤー全員に同額支給（原作の景気・給料イベント） */
export function applyAllCash(g, amount, messages) {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  if (!n) return 0;
  const alive = g.players.filter((p) => !p.bankrupt);
  for (const pl of alive) pl.cash += n;
  messages.push(`全員 +${n}G（${alive.length}人）`);
  return alive.length;
}

function applyStocks(g, player, count, messages) {
  const areas = Object.keys(g.areas).map(Number);
  if (!areas.length || !count) return;
  const a = pickRandom(areas);
  player.stocks[a] = (player.stocks[a] || 0) + count;
  messages.push(`A${a}株 +${count}`);
}

function areaOwnedTotal(g, pid, area) {
  const shops = g.map.filter((s) => s.type === 'shop' && s.area === area);
  const owned = shops.filter((s) => s.owner === pid).length;
  return { owned, total: shops.length };
}

/** 独占率に応じた増資枠内だけで店価値を上げる */
function boostShopCapped(g, sq, amount) {
  const { owned, total } = areaOwnedTotal(g, sq.owner, sq.area);
  const add = Math.max(0, Math.min(Math.floor(amount), remainingInvest(sq.basePrice, sq.extraInvest || 0, owned, total)));
  if (add <= 0) return 0;
  sq.extraInvest = (sq.extraInvest || 0) + add;
  sq.price += add;
  return add;
}

function applyShopBoost(g, player, amount, messages) {
  const shops = g.map.filter((s) => s.type === 'shop' && s.owner === player.id);
  if (!shops.length) {
    messages.push('所持店なし（効果なし）');
    return;
  }
  const pool = shops.filter((sq) => {
    const { owned, total } = areaOwnedTotal(g, player.id, sq.area);
    return remainingInvest(sq.basePrice, sq.extraInvest || 0, owned, total) > 0;
  });
  const sq = pickRandom(pool.length ? pool : shops);
  const add = boostShopCapped(g, sq, amount);
  if (add > 0) messages.push(`「${sq.label}」価値 +${add}`);
  else messages.push(`増資上限のため効果なし（独占率を上げよう）`);
}

function applyEventDef(g, player, def, messages) {
  if (!def) {
    player.flags.extraRoll = true;
    messages.push('謎の再挑戦！');
    return;
  }

  const effect = def.effect || def.kind;

  // 明示フィールドも併用（レベル連動対応）
  if (def.cash && effect !== 'cash' && effect !== 'dice_and_coin' && effect !== 'bank_bonus_trip' && effect !== 'warp_bank') {
    applyCash(player, scaledAmount(def, player, 'cash'), messages);
  }

  switch (effect) {
    case 'cash':
      applyCash(player, scaledAmount(def, player, 'cash') || 50, messages);
      break;
    case 'all_cash':
      applyAllCash(g, scaledAmount(def, player, 'cash') || 80, messages);
      break;
    case 'minigame': {
      const game = def.game || 'guess_dice';
      player.flags.pendingMinigame = {
        game,
        label: def.label || 'ミニゲーム',
      };
      messages.push(`ミニゲーム「${def.label || game}」へ！`);
      break;
    }
    case 'stocks':
      applyStocks(g, player, def.stocks || 5, messages);
      break;
    case 'shop_boost':
      applyShopBoost(g, player, scaledAmount(def, player, 'shopBoost') || 30, messages);
      break;
    case 'pick_invest': {
      const shops = g.map.filter((s) => s.type === 'shop' && s.owner === player.id);
      const amount = Math.max(20, Math.floor(
        scaledAmount({ ...def, cash: def.amount || def.shopBoost || 80 }, player, 'cash'),
      ));
      if (!shops.length) {
        player.flags.investCoupon = true;
        messages.push('所持店なし → 増資半額券');
        break;
      }
      player.flags.pendingPickInvest = { amount };
      messages.push(`好きな自分の店を選んで +${amount}G 増資！`);
      break;
    }
    case 'shop_and_stock':
      applyShopBoost(g, player, scaledAmount(def, player, 'shopBoost') || 30, messages);
      applyStocks(g, player, def.stocks || 5, messages);
      break;
    case 'extra_roll':
    case 'roll_again':
    case 'express_lane':
    case 'double_step':
      player.flags.extraRoll = true;
      messages.push('もう一度サイコロ！');
      if (def.cash) applyCash(player, scaledAmount(def, player, 'cash'), messages);
      break;
    case 'warp_bank':
    case 'bank_warp':
    case 'taxi_voucher':
    case 'home_portal':
      recordWarp(g, player.id, player.pos, g.startId);
      player.pos = g.startId;
      player.prevPos = null;
      messages.push('銀行へ移動');
      if (def.cash) applyCash(player, scaledAmount(def, player, 'cash'), messages);
      break;
    case 'warp_mark': {
      const mark = pickRandom(g.map.filter((n) => n.type === 'mark'));
      if (mark) {
        recordWarp(g, player.id, player.pos, mark.id);
        player.prevPos = player.pos;
        player.pos = mark.id;
        messages.push(`${mark.label || 'マーク'}マスへ移動`);
      } else {
        player.flags.extraRoll = true;
        messages.push('もう一度サイコロ！');
      }
      break;
    }
    case 'warp_vacant_shop': {
      const vacant = pickRandom(g.map.filter((n) => n.type === 'shop' && n.owner < 0));
      if (vacant) {
        recordWarp(g, player.id, player.pos, vacant.id);
        player.prevPos = player.pos;
        player.pos = vacant.id;
        messages.push(`空き店「${vacant.label}」へ`);
      } else {
        applyStocks(g, player, 5, messages);
      }
      break;
    }
    case 'warp_random': {
      const walkable = g.map.filter((n) => n.type !== 'junction');
      const dest = pickRandom(walkable);
      if (dest) {
        recordWarp(g, player.id, player.pos, dest.id);
        player.prevPos = player.pos;
        player.pos = dest.id;
        messages.push(`「${dest.label || dest.type}」へワープ`);
      }
      break;
    }
    case 'grant_mark':
    case 'suit_finder': {
      const missing = player.marks.findIndex((m) => !m);
      if (missing >= 0) {
        player.marks[missing] = true;
        messages.push('不足マーク入手');
      } else {
        grantLuckyStatus(player, messages);
        messages[messages.length - 1] = `マーク揃済 → ${messages[messages.length - 1]}`;
      }
      break;
    }
    case 'grant_two_marks': {
      let got = 0;
      for (let i = 0; i < player.marks.length && got < 2; i++) {
        if (!player.marks[i]) {
          player.marks[i] = true;
          got++;
        }
      }
      messages.push(got ? `マーク×${got}入手` : 'マーク揃済 → もう一振り');
      if (!got) player.flags.extraRoll = true;
      break;
    }
    case 'lucky':
    case 'lucky_charm':
      grantLuckyStatus(player, messages);
      break;
    case 'lucky_invest':
      grantLuckyStatus(player, messages);
      player.flags.investCoupon = true;
      messages.push('次の増資が半額');
      break;
    case 'seize_mono_shop': {
      const monos = findRivalMonopolies(g, player.id);
      if (!monos.length) {
        applyCash(player, 100, messages);
        messages.push('独占エリアなし → 打開手当');
        break;
      }
      const mono = pickRandom(monos);
      const sq = pickRandom(mono.shops);
      const prevId = sq.owner;
      const prev = g.players[prevId];
      sq.owner = player.id;
      sq.extraInvest = 0;
      sq.price = sq.basePrice;
      clearMonoFlag(g, prevId, mono.area);
      refreshAreaStockPrice(g, mono.area);
      messages.push(`${prev?.name || '相手'}の独占「${mono.name}」から「${sq.label}」を奪取！`);
      break;
    }
    case 'mono_area_holiday': {
      const monos = findRivalMonopolies(g, player.id);
      if (!monos.length) {
        player.flags.tollShield = true;
        messages.push('独占なし → 通行守りを入手');
        break;
      }
      const mono = pickRandom(monos);
      const owner = g.players[mono.ownerId];
      if (owner) {
        owner.shopsClosed = true;
        messages.push(`${owner.name} の独占店（${mono.name}）が1ターン休み／買い物料0`);
      }
      break;
    }
    case 'mono_tax': {
      const monos = findRivalMonopolies(g, player.id);
      if (!monos.length) {
        applyCash(player, 80, messages);
        messages.push('独占エリアなし → 小ボーナス');
        break;
      }
      const mono = pickRandom(monos);
      const owner = g.players[mono.ownerId];
      const value = mono.shops.reduce((s, sq) => s + sq.price, 0);
      const want = Math.max(def.amount || 150, Math.floor(value * 0.08));
      const amt = Math.min(owner?.cash || 0, want);
      if (owner && amt > 0) {
        owner.cash -= amt;
        player.cash += amt;
        messages.push(`${owner.name} の独占税として ${amt}G（${mono.name}）`);
      } else {
        applyCash(player, 60, messages);
        messages.push('独占主の現金不足 → 銀行から補償');
      }
      break;
    }
    case 'slash_mono_value': {
      const monos = findRivalMonopolies(g, player.id);
      if (!monos.length) {
        applyCash(player, 70, messages);
        messages.push('独占エリアなし → 小ボーナス');
        break;
      }
      const mono = pickRandom(monos);
      const cutEach = Math.max(20, def.amount || 40);
      let cut = 0;
      for (const sq of mono.shops) {
        const n = Math.min(sq.extraInvest || 0, cutEach);
        if (n <= 0) continue;
        sq.extraInvest -= n;
        sq.price -= n;
        cut += n;
      }
      refreshAreaStockPrice(g, mono.area);
      messages.push(
        cut > 0
          ? `${mono.name} の独占店価値 −${cut}G（増資分を削る）`
          : `${mono.name} は増資が少なく削れず → 店休付与`,
      );
      if (!cut) {
        const owner = g.players[mono.ownerId];
        if (owner) owner.shopsClosed = true;
      }
      break;
    }
    case 'five_buy_coupon':
      player.flags.fiveBuyCoupon = true;
      messages.push('次の店奪取が3倍買いに（通常は5倍）');
      break;
    case 'steal_mono_stock': {
      const monos = findRivalMonopolies(g, player.id);
      if (!monos.length) {
        applyStocks(g, player, 6, messages);
        messages.push('独占なし → 株プレゼント');
        break;
      }
      const mono = pickRandom(monos);
      const owner = g.players[mono.ownerId];
      const held = owner?.stocks?.[mono.area] || 0;
      const n = Math.min(def.amount || 8, held);
      if (n > 0) {
        owner.stocks[mono.area] -= n;
        player.stocks[mono.area] = (player.stocks[mono.area] || 0) + n;
        messages.push(`${owner.name} から ${mono.name}株×${n} を横取り`);
      } else {
        player.stocks[mono.area] = (player.stocks[mono.area] || 0) + (def.amount || 8);
        messages.push(`${mono.name}株×${def.amount || 8} を新規入手（相手は未保有）`);
      }
      break;
    }
    case 'invest_coupon':
    case 'invest_half':
    case 'vip_card':
      player.flags.investCoupon = true;
      messages.push('次の増資が半額');
      break;
    case 'toll_shield':
      player.flags.tollShield = true;
      messages.push('次の買い物料を無効化');
      break;
    case 'toll_boost':
      player.flags.tollBoost = true;
      messages.push('次に受け取る買い物料アップ');
      break;
    case 'own_shop_holiday':
      player.shopsClosed = true;
      messages.push('自分のお店が1ターン休み');
      break;
    case 'rival_shop_holiday': {
      const rival = pickRandom(otherPlayers(g, player));
      if (rival) {
        rival.shopsClosed = true;
        messages.push(`${rival.name} のお店が1ターン休み`);
      } else {
        player.flags.extraRoll = true;
        messages.push('もう一度サイコロ！');
      }
      break;
    }
    case 'rest':
      player.resting = true;
      messages.push('次ターン休憩');
      break;
    case 'donate_poorest': {
      const others = otherPlayers(g, player);
      if (!others.length) {
        applyCash(player, 40, messages);
        break;
      }
      const poorest = others.reduce((a, b) => (a.cash <= b.cash ? a : b));
      const amt = Math.min(player.cash, def.amount || 60);
      player.cash -= amt;
      poorest.cash += amt;
      messages.push(`${poorest.name} に ${amt}G プレゼント`);
      break;
    }
    case 'tax_richest': {
      const others = otherPlayers(g, player);
      if (!others.length) {
        applyCash(player, 40, messages);
        break;
      }
      const richest = others.reduce((a, b) => (a.cash >= b.cash ? a : b));
      const amt = Math.min(richest.cash, def.amount || 60);
      richest.cash -= amt;
      player.cash += amt;
      messages.push(`${richest.name} から ${amt}G`);
      break;
    }
    case 'steal_stock': {
      const holders = otherPlayers(g, player).filter((p) => Object.values(p.stocks || {}).some((n) => n > 0));
      if (!holders.length) {
        applyStocks(g, player, 5, messages);
        break;
      }
      const victim = pickRandom(holders);
      const areas = Object.keys(victim.stocks).map(Number).filter((a) => (victim.stocks[a] || 0) > 0);
      const a = pickRandom(areas);
      const n = Math.min(def.amount || 5, victim.stocks[a] || 0);
      victim.stocks[a] -= n;
      player.stocks[a] = (player.stocks[a] || 0) + n;
      messages.push(`${victim.name} から A${a}株×${n}`);
      break;
    }
    case 'swap_pos': {
      const other = pickRandom(otherPlayers(g, player));
      if (!other) {
        player.flags.extraRoll = true;
        messages.push('もう一度サイコロ！');
        break;
      }
      const aFrom = player.pos;
      const bFrom = other.pos;
      recordWarp(g, player.id, aFrom, bFrom);
      recordWarp(g, other.id, bFrom, aFrom);
      player.pos = bFrom;
      other.pos = aFrom;
      player.prevPos = null;
      other.prevPos = null;
      messages.push(`${other.name} と場所交換`);
      break;
    }
    case 'bump_area_stock': {
      const areas = Object.keys(g.areas).map(Number);
      const a = pickRandom(areas);
      const mult = def.amount || 1.1;
      if (g.areas[a]) {
        g.areas[a].B = Math.max(80, Math.floor((g.areas[a].B || 100) * mult));
        const shops = g.map.filter((s) => s.type === 'shop' && s.area === a);
        if (shops.length) {
          const avg = shops.reduce((s, sq) => s + sq.price, 0) / shops.length;
          g.areas[a].stockPrice = Math.max(1, Math.floor((avg / 65536) * g.areas[a].B));
        }
        messages.push(`A${a} の相場が${mult >= 1 ? '上昇' : '調整'}（${g.areas[a].stockPrice}G）`);
      }
      break;
    }
    case 'boost_area_shops': {
      const areas = Object.keys(g.areas).map(Number);
      const a = pickRandom(areas);
      const amt = def.amount || 20;
      let n = 0;
      let gained = 0;
      for (const sq of g.map.filter((s) => s.type === 'shop' && s.area === a && s.owner === player.id)) {
        const add = boostShopCapped(g, sq, amt);
        if (add > 0) {
          n++;
          gained += add;
        }
      }
      messages.push(n ? `A${a} の自分の店×${n} 価値+${gained}（枠内）` : `A${a} に自分の店なし／増資枠なし`);
      if (!n) applyStocks(g, player, 5, messages);
      break;
    }
    case 'boost_all_shops': {
      const amt = def.amount || 15;
      const shops = g.map.filter((s) => s.type === 'shop' && s.owner === player.id);
      if (!shops.length) {
        player.flags.investCoupon = true;
        messages.push('所持店なし → 増資半額券');
        break;
      }
      let gained = 0;
      let hit = 0;
      for (const sq of shops) {
        const add = boostShopCapped(g, sq, amt);
        if (add > 0) {
          hit++;
          gained += add;
        }
      }
      messages.push(hit ? `全店の価値 +${gained}（${hit}/${shops.length}店・増資枠内）` : '増資上限のため効果なし');
      break;
    }
    case 'trim_stocks': {
      const held = Object.keys(player.stocks || {}).map(Number).filter((a) => (player.stocks[a] || 0) > 0);
      if (!held.length) {
        player.flags.extraRoll = true;
        messages.push('持株なし → もう一振り');
        break;
      }
      const a = pickRandom(held);
      const n = Math.min(def.amount || 5, player.stocks[a]);
      player.stocks[a] -= n;
      const price = g.areas[a]?.stockPrice || 20;
      const got = price * n;
      player.cash += got;
      messages.push(`A${a}株×${n} を利確 +${got}G`);
      break;
    }
    case 'multi_stocks': {
      const areas = Object.keys(g.areas).map(Number);
      const n = def.amount || 3;
      for (let i = 0; i < Math.min(3, areas.length); i++) {
        const a = areas[(Math.floor(Math.random() * areas.length))];
        player.stocks[a] = (player.stocks[a] || 0) + n;
      }
      messages.push(`複数エリアに株 +${n}`);
      break;
    }
    case 'mystery': {
      const roll = Math.floor(Math.random() * 6);
      if (roll === 0) {
        player.flags.extraRoll = true;
        messages.push('ミステリー → もう一振り');
      } else if (roll === 1) {
        grantLuckyStatus(player, messages);
        messages[messages.length - 1] = `ミステリー → ${messages[messages.length - 1]}`;
      } else if (roll === 2) {
        applyStocks(g, player, 8, messages);
        messages.push('ミステリー株');
      } else if (roll === 3) {
        applyShopBoost(g, player, 40, messages);
      } else if (roll === 4) {
        const missing = player.marks.findIndex((m) => !m);
        if (missing >= 0) {
          player.marks[missing] = true;
          messages.push('ミステリーマーク');
        } else {
          player.flags.investCoupon = true;
          messages.push('ミステリー増資券');
        }
      } else {
        applyCash(player, 70, messages);
      }
      break;
    }
    default: {
      // kind フォールバック
      if (def.stocks) applyStocks(g, player, def.stocks, messages);
      if (def.shopBoost) applyShopBoost(g, player, def.shopBoost, messages);
      if (def.extraRoll) {
        player.flags.extraRoll = true;
        messages.push('もう一度サイコロ！');
      }
      if (def.grantMark) {
        const missing = player.marks.findIndex((m) => !m);
        if (missing >= 0) {
          player.marks[missing] = true;
          messages.push('不足マーク入手');
        }
      }
      if (def.lucky) {
        grantLuckyStatus(player, messages);
      }
      if (def.cash) applyCash(player, def.cash, messages);
      break;
    }
  }

  if (!messages.length) {
    player.flags.extraRoll = true;
    messages.push(`${def.label} → もう一振り`);
  }
}

/**
 * 一直線上で、同じ色が隣接して続くランを列挙する。
 * とびとび（間に別色・未開封がある）は別ランになる。
 */
function contiguousColorRuns(lineCells, table, color) {
  /** @type {number[][]} */
  const runs = [];
  /** @type {number[]} */
  let cur = [];
  for (const id of lineCells) {
    const cell = table.cells[id];
    if (cell?.scratched && cell.color === color) {
      cur.push(id);
    } else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** 縦・横・斜めに同じ色が隣接して3つ以上そろえば、その色のプレイヤーに報酬 */
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
  /** @type {{ lineKey: string, color: number, count: number, bonus: number, cellIds: number[], beneficiaryId: number, beneficiaryName: string, beneficiaryColor: string }[]} */
  const matches = [];
  if (!table.claimedMatches) table.claimedMatches = {};

  for (const line of lines) {
    for (let color = 0; color < 4; color++) {
      const runs = contiguousColorRuns(line.cells, table, color).filter((r) => r.length >= 3);
      if (!runs.length) continue;
      const cellIds = runs.flat();
      const n = cellIds.length;
      const claimKey = `${line.key}-c${color}-n${n}`;
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
        matches.push({
          lineKey: line.key,
          color,
          count: n,
          bonus,
          cellIds,
          beneficiaryId: beneficiary.id,
          beneficiaryName: beneficiary.name,
          beneficiaryColor: beneficiary.color,
        });
        messages.push(`${COLOR_LABELS[color]}色そろい×${n} → ${beneficiary.name} +${bonus}G`);
      }
    }
  }
  return { total, matches };
}
