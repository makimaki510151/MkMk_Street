/** MkMk Street — 10×10 イベント表（1〜200番をランダム配置） */

import { remainingInvest } from './investLimits.js';
import { getAreaCode, clampStockPrice } from './board.js';

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

/** ワイルドカード上限（engine.MAX_WILDCARDS と同値。循環 import 回避のためここにも置く） */
const WARP_WILDCARD_MAX = 4;

/**
 * ワープ先がマーク／ワイルドマスなら入手する（スクラッチは開かない）。
 * @returns {{ kind: 'mark'|'wildcard'|null, gained: boolean }}
 */
export function collectWarpSquareRewards(g, player, destId, messages = []) {
  if (!g?.map || !player || destId == null) return { kind: null, gained: false };
  const dest = g.map.find((n) => n.id === destId);
  if (!dest) return { kind: null, gained: false };

  if (dest.type === 'mark') {
    const idx = Number(dest.mark);
    if (!Number.isFinite(idx) || idx < 0 || !player.marks) {
      return { kind: 'mark', gained: false };
    }
    if (player.marks[idx]) {
      messages.push(`${dest.label || 'マーク'}はすでに所持`);
      return { kind: 'mark', gained: false };
    }
    player.marks[idx] = true;
    messages.push(`${dest.label || 'マーク'}を入手！`);
    return { kind: 'mark', gained: true };
  }

  if (dest.type === 'suit_fill') {
    const have = Math.max(0, Math.min(WARP_WILDCARD_MAX, Math.floor(Number(player.wildcards) || 0)));
    if (have >= WARP_WILDCARD_MAX) {
      messages.push(`ワイルドカード上限（${WARP_WILDCARD_MAX}枚）`);
      return { kind: 'wildcard', gained: false };
    }
    player.wildcards = have + 1;
    messages.push(`ワイルドカード入手！（${player.wildcards}/${WARP_WILDCARD_MAX}）`);
    return { kind: 'wildcard', gained: true };
  }

  return { kind: null, gained: false };
}

/**
 * 1〜200 のユニークイベント定義。
 * 類似の金運・店みがきを抑え、店価操作・買収権利・強制売却など固有効果を厚くする。
 */
function buildCatalog() {
  /** @type {{kind:string,label:string,cash?:number,stocks?:number,shopBoost?:number,extraRoll?:boolean,lucky?:boolean,grantMark?:boolean,effect?:string,amount?:number,multi?:number,game?:string}[]} */
  const list = [];
  const push = (kind, label, data = {}) => {
    list.push({ id: list.length + 1, kind, label, ...data });
  };

  // ── 金運（圧縮）──────────────────────────────────────────
  [
    ['treasure_map', '宝の地図', 50, 30], ['lost_wallet', '落とし物発見', 70, 35],
    ['rank_allowance', '階級手当', 100, 60],
  ].forEach(([k, l, cash, levelScale]) => push(k, l, { cash, levelScale, effect: 'cash' }));
  [
    ['flat_tire', 'パンク修理', -40, -20], ['rank_dues', '階級維持費', -40, -30],
  ].forEach(([k, l, cash, levelScale]) => push(k, l, { cash, levelScale, effect: 'cash' }));

  // ── 株・店みがき（圧縮）──────────────────────────────────
  [
    ['broker_tip', '証券屋の耳打ち', 8], ['share_gift', '株の贈り物', 15],
  ].forEach(([k, l, stocks]) => push(k, l, { stocks, effect: 'stocks' }));
  [
    ['remodel_aid', '改装助成', 50],
  ].forEach(([k, l, shopBoost]) => push(k, l, { shopBoost, effect: 'shop_boost' }));
  [
    ['free_remodel', '好きなお店を改装', 50, 20],
    ['selective_invest', '一点集中投資', 60, 25],
  ].forEach(([k, l, amount, levelScale]) => push(k, l, { effect: 'pick_invest', amount, levelScale }));

  // ── 店価操作（圧縮）──────────────────────────────────────
  [
    ['price_war', '価格競争', 45], ['competitor_sale', '競合セール', 60],
  ].forEach(([k, l, amount]) => push(k, l, { effect: 'slash_rival_shops', amount }));
  [
    ['inventory_loss', '在庫ロス', 50], ['bad_review', '酷評レビュー', 35],
  ].forEach(([k, l, amount]) => push(k, l, { effect: 'slash_own_shops', amount }));

  // ── 買収権利（圧縮）──────────────────────────────────────
  [
    ['three_times_pass', '3倍買いクーポン', 3],
    ['four_times_deal', '4倍買い権利', 4],
  ].forEach(([k, l, multi]) => push(k, l, { effect: 'takeover_coupon', multi }));
  [
    ['six_buy_license', '6倍買いライセンス', 6],
  ].forEach(([k, l, multi]) => push(k, l, { effect: 'any_shop_buy', multi }));
  [
    ['vacant_double_deed', '空地2倍購入権'],
  ].forEach(([k, l]) => push(k, l, { effect: 'vacant_shop_buy', multi: 2 }));
  [
    ['bank_buyout_order', '銀行買取命令'],
  ].forEach(([k, l]) => push(k, l, { effect: 'force_rival_sell', multi: 3 }));
  [
    ['suit_shuffle', 'マーク大シャッフル'],
  ].forEach(([k, l]) => push(k, l, { effect: 'shuffle_marks' }));
  [
    ['forced_liquidation', '強制売却命令'],
  ].forEach(([k, l]) => push(k, l, { effect: 'force_sell_shop' }));

  // ── サイコロ・移動（圧縮）────────────────────────────────
  [
    ['roll_again', 'もう一振り'], ['sprint_shoes', 'ダッシュシューズ'],
  ].forEach(([k, l]) => push(k, l, { effect: 'extra_roll', extraRoll: true }));
  [
    ['bank_warp', '銀行ワープ'],
  ].forEach(([k, l]) => push(k, l, { effect: 'warp_bank' }));
  [
    ['warp_mark', 'マーク地点へ'],
  ].forEach(([k, l]) => push(k, l, { effect: 'warp_mark' }));
  [
    ['warp_shop', '空き店へワープ'],
  ].forEach(([k, l]) => push(k, l, { effect: 'warp_vacant_shop' }));
  [
    ['warp_random', '迷子ワープ'],
  ].forEach(([k, l]) => push(k, l, { effect: 'warp_random' }));

  // ── マーク・ステータス（圧縮）────────────────────────────
  [
    ['suit_finder', 'マーク探知機'],
  ].forEach(([k, l]) => push(k, l, { effect: 'grant_mark', grantMark: true }));
  [
    ['lucky_charm', '幸運のお守り'],
  ].forEach(([k, l]) => push(k, l, { effect: 'lucky', lucky: true }));
  [
    ['invest_half', '増資半額券'],
  ].forEach(([k, l]) => push(k, l, { effect: 'invest_coupon' }));
  [
    ['toll_shield', '通行守り'],
  ].forEach(([k, l]) => push(k, l, { effect: 'toll_shield' }));
  [
    ['toll_boost', '買い物料アップ'],
  ].forEach(([k, l]) => push(k, l, { effect: 'toll_boost' }));
  [
    ['shop_nap', 'お店お昼寝'],
  ].forEach(([k, l]) => push(k, l, { effect: 'own_shop_holiday' }));
  [
    ['rival_closed', 'ライバル店休'],
  ].forEach(([k, l]) => push(k, l, { effect: 'rival_shop_holiday' }));
  [
    ['park_bench', '公園のベンチ'],
  ].forEach(([k, l]) => push(k, l, { effect: 'rest' }));

  // ── 独占打開（圧縮）──────────────────────────────────────
  [
    ['antitrust_raid', '独占摘発'],
  ].forEach(([k, l]) => push(k, l, { effect: 'seize_mono_shop' }));
  [
    ['mono_nap', '独占店の昼寝'],
  ].forEach(([k, l]) => push(k, l, { effect: 'mono_area_holiday' }));
  [
    ['mono_tax', '独占税'],
  ].forEach(([k, l]) => push(k, l, { effect: 'mono_tax', amount: 180 }));
  [
    ['value_slash', '独占店の値崩れ'],
  ].forEach(([k, l]) => push(k, l, { effect: 'slash_mono_value', amount: 50 }));
  [
    ['mono_stock_siphon', '独占エリア株の横取り'],
  ].forEach(([k, l]) => push(k, l, { effect: 'steal_mono_stock', amount: 8 }));

  // ── 全員ボーナス（圧縮）──────────────────────────────────
  [
    ['payday_all', '給料日', 70, 20], ['bonus_wave', 'ボーナス支給', 80, 25],
    ['festival_boom', 'お祭り景気', 60, 18],
  ].forEach(([k, l, cash, levelScale]) => push(k, l, { cash, levelScale, effect: 'all_cash' }));

  // ── ミニゲーム（既存＋新規体験）──────────────────────────
  [
    ['mini_dice', 'サイコロ当て', 'guess_dice'],
    ['mini_highlow', 'ハイ＆ロー', 'high_low'],
    ['mini_coin', 'コイントス', 'coin'],
    ['mini_slot', 'ファイブスロット', 'slot'],
    ['dice_battle', 'ダイスバトル', 'dice_battle'],
    ['horse_race', 'ミニ競馬', 'horse_race'],
    ['rps_duel', 'じゃんけん勝負', 'rps_duel'],
    ['roulette', 'ルーレット', 'roulette'],
    ['heist', '金庫破り', 'heist'],
    ['balloon_dash', 'バルーンチャレンジ', 'balloon_dash'],
    ['memory_match', '神経衰弱', 'memory_match'],
    ['silent_bid', 'サイレント入札', 'silent_bid'],
    ['push_pull', '押し引き', 'push_pull'],
    ['divide_pool', '配分ゲーム', 'divide_pool'],
    ['target_roulette', 'ターゲットルーレット', 'target_roulette'],
    ['hot_potato', 'パス禁止', 'hot_potato'],
  ].forEach(([k, l, game]) => push(k, l, { effect: 'minigame', game }));

  // ── 相手・分配・移動（圧縮）──────────────────────────────
  [
    ['charity_box', '募金箱'],
  ].forEach(([k, l]) => push(k, l, { effect: 'donate_poorest', amount: 80 }));
  [
    ['rich_tax', '金持ち税'],
  ].forEach(([k, l]) => push(k, l, { effect: 'tax_richest', amount: 70 }));
  [
    ['stock_swap_hint', '株の交換話'],
  ].forEach(([k, l]) => push(k, l, { effect: 'steal_stock', amount: 5 }));
  [
    ['position_trade', '場所交換'],
  ].forEach(([k, l]) => push(k, l, { effect: 'swap_pos' }));
  [
    ['all_shuffle', '全員席替え'],
  ].forEach(([k, l]) => push(k, l, { effect: 'swap_all_pos' }));
  [
    ['scatter_warp', '全員散開'],
  ].forEach(([k, l]) => push(k, l, { effect: 'scatter_all' }));
  [
    ['all_gather', '全員集合'],
  ].forEach(([k, l]) => push(k, l, { effect: 'gather_all' }));

  // ── 相場・エリア ─────────────────────────────────────────
  [
    ['bull_run', '株価急騰'],
  ].forEach(([k, l]) => push(k, l, { effect: 'bump_area_stock', amount: 1.12 }));
  [
    ['bear_dip', '株価調整'],
  ].forEach(([k, l]) => push(k, l, { effect: 'bump_area_stock', amount: 0.92 }));
  [
    ['area_cheer', 'エリア応援'],
  ].forEach(([k, l]) => push(k, l, { effect: 'boost_area_shops', amount: 25 }));
  [
    ['sell_pressure', '利確の波'],
  ].forEach(([k, l]) => push(k, l, { effect: 'trim_stocks', amount: 5 }));
  [
    ['all_shop_polish', '全店みがき'],
  ].forEach(([k, l]) => push(k, l, { effect: 'boost_all_shops', amount: 20 }));

  // ── 複合・ユニーク＋新規独創 ─────────────────────────────
  [
    ['dice_and_coin', '賽と硬貨', { effect: 'extra_roll', extraRoll: true, cash: 25, levelScale: 15 }],
    ['shop_and_share', '店と株セット', { effect: 'shop_and_stock', shopBoost: 20, levelScale: 10, stocks: 5 }],
    ['lucky_invest', '強運の増資', { effect: 'lucky_invest', lucky: true }],
    ['mono_break_kit', '打開キット', { effect: 'takeover_coupon', multi: 3, cash: 40 }],
    ['bank_bonus_trip', '銀行寄り道', { effect: 'warp_bank', cash: 30, levelScale: 20 }],
    ['mark_festival', 'マーク祭', { effect: 'grant_two_marks' }],
    ['stock_shower', '株のシャワー', { effect: 'multi_stocks', amount: 4 }],
    ['mystery_box', 'ミステリー箱', { effect: 'mystery' }],
    ['sale_raid_combo', 'セール＆買収', { effect: 'rival_slash_and_coupon', amount: 30, multi: 4 }],
    // 新規
    ['fixed_dice_pass', '出目固定券', { effect: 'pick_dice' }],
    ['mark_steal', 'マーク奪取', { effect: 'steal_mark' }],
    ['wildcard_shard', 'ワイルドの欠片', { effect: 'grant_wildcard' }],
    ['home_return', '本拠地帰還', { effect: 'warp_best_shop' }],
    ['hunt_beacon', '追跡ビーコン', { effect: 'warp_behind_leader' }],
    ['shop_guard_pact', '店守り契約', { effect: 'shop_protect' }],
    ['joint_owner', '共同オーナー', { effect: 'co_own' }],
    ['toll_divert', '買い物料横流し', { effect: 'toll_hijack' }],
    ['time_capsule', 'タイムカプセル', { effect: 'time_capsule', amount: 80, levelScale: 25 }],
    ['bank_interest', '銀行利息', { effect: 'bank_interest', amount: 8 }],
    ['mono_hearing', '独禁ヒアリング', { effect: 'mono_hearing', amount: 180 }],
    ['area_lockdown', 'エリア封鎖', { effect: 'area_block' }],
    ['status_strip', 'ステータス没収', { effect: 'strip_status' }],
    ['backstep_order', '後退指令', { effect: 'retreat', amount: 4 }],
    ['hard_brake', '強制停止', { effect: 'force_stop' }],
    ['swap_two_seats', '二人席替', { effect: 'swap_two_others' }],
    ['insider_tip', 'インサイダー嫌疑', { effect: 'insider_stocks', stocks: 10, amount: 60 }],
    ['fortune_triple', '運命の三択', { effect: 'fortune_triple' }],
    ['name_lend', '名義貸し', { effect: 'lend_shop' }],
    ['compare_ad', '比較広告', { effect: 'compare_ad', amount: 40 }],
    ['insurance_pay', '保険金', { effect: 'insurance_refund' }],
    ['mark_wager', 'マーク賭博', { effect: 'mark_gamble' }],
    ['short_sale', '株の空売り', { effect: 'short_stock', amount: 120 }],
  ].forEach(([k, l, data]) => push(k, l, data));

  // ── イベントNPC召喚（各1枠・同種は同時出現しない）────────
  push('spawn_mark_fairy', 'マークの妖精', { effect: 'spawn_event_npc', npcKind: 'mark_fairy' });
  push('spawn_merchant', '大商人あらわる', { effect: 'spawn_event_npc', npcKind: 'merchant' });
  push('spawn_poverty', '貧乏神あらわる', { effect: 'spawn_event_npc', npcKind: 'poverty' });

  // ── フレーバー埋め：ユニーク効果中心のローテ ──────────────
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
    'ラジオ出演', '撮影エキストラ', '月曜マジック', '火曜トライ', '水曜ウィッシュ',
    '木曜チャーム', '金曜フィーバー', '土曜サプライズ', '日曜リラックス', '祝日スペシャル',
    '満月散歩', '新月の誓い', '春一番', '夏祭り', '秋祭り',
    '冬ぼんてん', '節分豆', 'ひな祭り', 'こどもの日', '七夕短冊',
    'お月見', 'ハロウィン', 'クリスマス', 'お正月', 'バレンタイン',
    'ミントの香り', 'ラベンダー畑', 'ローズガーデン', 'サイダー工場', '時計台の鐘',
    '噴水広場', 'アーケード街', '屋上テラス', '地下通路の壁画', '夕焼けロード',
  ];

  const flavorEffects = [
    { effect: 'slash_rival_shops', amount: 35 },
    { effect: 'steal_mark' },
    { effect: 'pick_dice' },
    { effect: 'shop_protect' },
    { effect: 'co_own' },
    { effect: 'force_sell_shop' },
    { effect: 'warp_best_shop' },
    { effect: 'retreat', amount: 4 },
    { effect: 'extra_roll', extraRoll: true },
    { effect: 'grant_wildcard' },
    { effect: 'grant_mark', grantMark: true },
    { effect: 'bank_interest', amount: 8 },
    { effect: 'time_capsule', amount: 70, levelScale: 20 },
    { effect: 'invest_coupon' },
    { effect: 'toll_hijack' },
    { effect: 'bump_area_stock', amount: 1.08 },
    { effect: 'force_stop' },
    { effect: 'fortune_triple' },
    { effect: 'cash', cash: 30, levelScale: 18 },
    { effect: 'all_cash', cash: 35, levelScale: 10 },
    { effect: 'minigame', game: 'memory_match' },
    { effect: 'minigame', game: 'push_pull' },
    { effect: 'trim_stocks', amount: 3 },
    { effect: 'compare_ad', amount: 35 },
    { effect: 'multi_stocks', amount: 3 },
    { effect: 'strip_status' },
    { effect: 'mark_gamble' },
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

/** プレイヤー色 → 表の色インデックス（スクラッチ表は4色グループ） */
export function playerColorIndex(player) {
  const c = (player?.color || '').toLowerCase();
  const idx = GROUP_COLORS.findIndex((g) => g.toLowerCase() === c);
  if (idx >= 0) return idx;
  // 拡張パレット色は安定ハッシュで 0〜3 に割当
  if (c) {
    let h = 0;
    for (let i = 0; i < c.length; i++) h = (Math.imul(h, 31) + c.charCodeAt(i)) >>> 0;
    return h % GROUP_COLORS.length;
  }
  return (player?.id ?? 0) % GROUP_COLORS.length;
}

export function scratchCell(g, player, cellId) {
  const table = g.sharedEventTable || player.eventTable;
  if (!table) return { ok: false, error: 'no_table' };
  const cell = table.cells[cellId];
  if (!cell || cell.scratched) return { ok: false, error: 'bad_cell' };

  cell.scratched = true;
  cell.scratchedBy = player.id;
  // 開けた人の座席IDで塗る（見た目の色＝そのプレイヤー色。そろいも同一プレイヤー基準）
  cell.color = player.id;
  cell.group = player.id;
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

/**
 * 自分以外が独占しているエリア一覧。
 * エンジンの hasAreaMonopoly と同じ定義：エリア内の全店が同一オーナー。
 */
export function findRivalMonopolies(g, playerId) {
  /** @type {{ area: number, ownerId: number, shops: object[], name: string }[]} */
  const out = [];
  const pid = Number(playerId);
  for (const a of Object.keys(g.areas || {}).map(Number)) {
    const shops = g.map.filter((s) => s.type === 'shop' && Number(s.area) === a);
    if (!shops.length) continue;
    const oid = Number(shops[0].owner);
    if (!(oid >= 0) || oid === pid) continue;
    if (g.players[oid]?.bankrupt) continue;
    // 全軒同一オーナー（空き混じり・分割所有は独占にしない）
    if (!shops.every((s) => Number(s.owner) === oid)) continue;
    out.push({
      area: a,
      ownerId: oid,
      shops,
      name: g.areas[a]?.name || getAreaCode(g, a),
    });
  }
  return out;
}

function refreshAreaStockPrice(g, area) {
  const meta = g.areas[area];
  if (!meta) return;
  const shops = g.map.filter((s) => s.type === 'shop' && Number(s.area) === area);
  if (!shops.length) return;
  const avg = shops.reduce((s, sq) => s + sq.price, 0) / shops.length;
  meta.stockPrice = clampStockPrice(Math.floor((avg / 65536) * (meta.B || 100)));
}

/** スクラッチ後にエンジン側で処理する副作用（循環 import 回避） */
function queueScratchSideEffect(g, effect) {
  if (!g.scratchSideEffects) g.scratchSideEffects = [];
  g.scratchSideEffects.push(effect);
}

export function takeScratchSideEffects(g) {
  const list = g.scratchSideEffects ? [...g.scratchSideEffects] : [];
  g.scratchSideEffects = null;
  return list;
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
  messages.push(`${getAreaCode(g, a)}株 +${count}`);
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

/** 店の増資分を削って店価を下げる。削れた合計を返す */
function slashShopInvest(shops, cutEach) {
  const cutPer = Math.max(10, Math.floor(Number(cutEach) || 40));
  let cut = 0;
  const areas = new Set();
  for (const sq of shops) {
    const n = Math.min(sq.extraInvest || 0, cutPer);
    if (n <= 0) continue;
    sq.extraInvest -= n;
    sq.price -= n;
    cut += n;
    areas.add(sq.area);
  }
  return { cut, areas: [...areas] };
}

function grantTakeoverCoupon(player, multi, messages) {
  const m = Math.max(2, Math.min(4, Number(multi) || 3));
  player.flags.takeoverMulti = m;
  player.flags.fiveBuyCoupon = m <= 3;
  messages.push(`次の店奪取が${m}倍買いに（通常は5倍）`);
}

/** 全員の所持マークをプールしてランダムに再配布（ワイルドは対象外） */
function shuffleAllPlayerMarks(g, messages) {
  const alive = (g.players || []).filter((p) => p && !p.bankrupt);
  if (alive.length < 2) {
    messages.push('シャッフルできる相手がいない');
    return;
  }
  /** @type {number[]} */
  const tokens = [];
  for (const p of alive) {
    if (!Array.isArray(p.marks)) p.marks = [false, false, false, false];
    for (let i = 0; i < 4; i++) {
      if (p.marks[i]) tokens.push(i);
      p.marks[i] = false;
    }
  }
  if (!tokens.length) {
    messages.push('誰もマークを持っていなかった');
    return;
  }
  // Fisher–Yates
  for (let i = tokens.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = tokens[i];
    tokens[i] = tokens[j];
    tokens[j] = tmp;
  }
  for (const suit of tokens) {
    const candidates = alive.filter((p) => !p.marks[suit]);
    const pool = candidates.length ? candidates : alive;
    const who = pickRandom(pool);
    who.marks[suit] = true;
  }
  messages.push(`全員のマークがシャッフルされた（${tokens.length}枚）`);
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
        collectWarpSquareRewards(g, player, mark.id, messages);
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
        collectWarpSquareRewards(g, player, vacant.id, messages);
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
        collectWarpSquareRewards(g, player, dest.id, messages);
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
      const prevId = Number(sq.owner);
      const prev = g.players[prevId];
      sq.owner = player.id;
      sq.extraInvest = 0;
      sq.price = sq.basePrice;
      // 5倍買い／取引と同じ独占崩壊ペナルティをエンジン側で適用
      queueScratchSideEffect(g, { type: 'monopolyBreak', pid: prevId, area: mono.area });
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
    case 'takeover_coupon':
      grantTakeoverCoupon(player, def.multi || 3, messages);
      break;
    case 'slash_rival_shops': {
      const rivals = otherPlayers(g, player).filter((r) =>
        g.map.some((s) => s.type === 'shop' && s.owner === r.id));
      if (!rivals.length) {
        applyCash(player, 60, messages);
        messages.push('ライバル店なし → 小ボーナス');
        break;
      }
      const rival = pickRandom(rivals);
      const shops = g.map.filter((s) => s.type === 'shop' && s.owner === rival.id);
      const { cut, areas } = slashShopInvest(shops, def.amount || 45);
      for (const a of areas) refreshAreaStockPrice(g, a);
      if (cut > 0) {
        messages.push(`${rival.name} の店価 −${cut}G（増資分を削る）`);
      } else {
        rival.shopsClosed = true;
        messages.push(`${rival.name} の店は増資が少なく削れず → 店休1ターン`);
      }
      break;
    }
    case 'slash_own_shops': {
      const shops = g.map.filter((s) => s.type === 'shop' && s.owner === player.id);
      if (!shops.length) {
        applyCash(player, -40, messages);
        messages.push('所持店なし → 罰金');
        break;
      }
      const { cut, areas } = slashShopInvest(shops, def.amount || 40);
      for (const a of areas) refreshAreaStockPrice(g, a);
      if (cut > 0) {
        messages.push(`自分の店価 −${cut}G（増資分が目減り）`);
      } else {
        applyCash(player, -50, messages);
        messages.push('削れる増資なし → 罰金');
      }
      break;
    }
    case 'any_shop_buy': {
      const targets = g.map.filter((s) => s.type === 'shop' && s.owner >= 0 && s.owner !== player.id);
      const multi = Math.max(5, Math.min(8, Number(def.multi) || 6));
      if (!targets.length) {
        grantTakeoverCoupon(player, 3, messages);
        messages.push('相手店なし → 3倍買いクーポンに変換');
        break;
      }
      player.flags.pendingAnyShopBuy = { multi };
      messages.push(`好きな相手の店を${multi}倍で買える！`);
      break;
    }
    case 'vacant_shop_buy': {
      const vacants = g.map.filter((s) => s.type === 'shop' && s.owner < 0);
      const multi = Math.max(2, Math.min(4, Number(def.multi) || 2));
      if (!vacants.length) {
        applyCash(player, 40, messages);
        messages.push('空き店なし → 手当に変換');
        break;
      }
      player.flags.pendingVacantShopBuy = { multi };
      messages.push(`好きな空き店を${multi}倍価格で買える！`);
      break;
    }
    case 'force_rival_sell': {
      const targets = g.map.filter((s) => s.type === 'shop' && s.owner >= 0 && s.owner !== player.id);
      const multi = Math.max(2, Math.min(5, Number(def.multi) || 3));
      if (!targets.length) {
        applyCash(player, 50, messages);
        messages.push('相手店なし → 手当に変換');
        break;
      }
      player.flags.pendingForceRivalSell = { multi };
      messages.push(`好きな相手の店を${multi}倍額で銀行買取させられる！`);
      break;
    }
    case 'shuffle_marks': {
      shuffleAllPlayerMarks(g, messages);
      break;
    }
    case 'force_sell_shop': {
      const shops = g.map.filter((s) => s.type === 'shop' && s.owner === player.id);
      if (!shops.length) {
        applyCash(player, -60, messages);
        messages.push('所持店なし → 罰金で代替');
        break;
      }
      player.flags.pendingForceSell = true;
      messages.push('お店を1店舗、売却しなければならない');
      break;
    }
    case 'rival_slash_and_coupon': {
      const rivals = otherPlayers(g, player).filter((r) =>
        g.map.some((s) => s.type === 'shop' && s.owner === r.id));
      if (rivals.length) {
        const rival = pickRandom(rivals);
        const shops = g.map.filter((s) => s.type === 'shop' && s.owner === rival.id);
        const { cut, areas } = slashShopInvest(shops, def.amount || 30);
        for (const a of areas) refreshAreaStockPrice(g, a);
        messages.push(cut > 0
          ? `${rival.name} の店価 −${cut}G`
          : `${rival.name} への値下げは効かず`);
      }
      grantTakeoverCoupon(player, def.multi || 4, messages);
      break;
    }
    case 'spawn_event_npc': {
      const kind = def.npcKind || 'mark_fairy';
      const labels = {
        mark_fairy: 'マークの妖精',
        merchant: '大商人',
        poverty: '貧乏神',
      };
      const label = labels[kind] || 'イベントNPC';
      const exists = Array.isArray(g.eventNpcs) && g.eventNpcs.some((n) => n.kind === kind);
      if (exists) {
        applyCash(player, 40, messages);
        messages.push(`${label}はすでに徘徊中 → 手当 +40G`);
        break;
      }
      player.flags.pendingSpawnNpc = kind;
      messages.push(`${label}を異界から呼び出した！`);
      break;
    }
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
      messages.push(`${victim.name} から ${getAreaCode(g, a)}株×${n}`);
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
      collectWarpSquareRewards(g, player, bFrom, messages);
      collectWarpSquareRewards(g, other, aFrom, messages);
      break;
    }
    case 'swap_all_pos': {
      const alive = g.players.filter((p) => !p.bankrupt);
      if (alive.length < 2) {
        player.flags.extraRoll = true;
        messages.push('もう一度サイコロ！');
        break;
      }
      const positions = alive.map((p) => p.pos);
      // 全員が必ず動くよう 1〜n-1 マス分ずらして再配置
      const offset = 1 + Math.floor(Math.random() * (alive.length - 1));
      alive.forEach((p, i) => {
        const to = positions[(i + offset) % alive.length];
        recordWarp(g, p.id, p.pos, to);
        p.prevPos = null;
        p.pos = to;
        collectWarpSquareRewards(g, p, to, messages);
      });
      messages.push(`全員の位置を入れ替え（${alive.length}人）`);
      break;
    }
    case 'scatter_all': {
      const alive = g.players.filter((p) => !p.bankrupt);
      const walkable = g.map.filter((n) => n.type !== 'junction');
      if (!alive.length || !walkable.length) {
        player.flags.extraRoll = true;
        messages.push('もう一度サイコロ！');
        break;
      }
      const pool = walkable.map((n) => n.id);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = pool[i];
        pool[i] = pool[j];
        pool[j] = tmp;
      }
      alive.forEach((p, i) => {
        const to = pool[i % pool.length];
        recordWarp(g, p.id, p.pos, to);
        p.prevPos = null;
        p.pos = to;
        collectWarpSquareRewards(g, p, to, messages);
      });
      messages.push(`全員がバラバラのマスへ飛んだ（${alive.length}人）`);
      break;
    }
    case 'gather_all': {
      const alive = g.players.filter((p) => !p.bankrupt);
      const dest = pickRandom(g.map.filter((n) => n.type !== 'junction'));
      if (!alive.length || !dest) {
        player.flags.extraRoll = true;
        messages.push('もう一度サイコロ！');
        break;
      }
      alive.forEach((p) => {
        recordWarp(g, p.id, p.pos, dest.id);
        p.prevPos = null;
        p.pos = dest.id;
        collectWarpSquareRewards(g, p, dest.id, messages);
      });
      messages.push(`全員が「${dest.label || dest.type}」に集合！`);
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
          g.areas[a].stockPrice = clampStockPrice(Math.floor((avg / 65536) * g.areas[a].B));
        }
        messages.push(`${getAreaCode(g, a)} の相場が${mult >= 1 ? '上昇' : '調整'}（${g.areas[a].stockPrice}G）`);
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
      messages.push(n ? `${getAreaCode(g, a)} の自分の店×${n} 価値+${gained}（枠内）` : `${getAreaCode(g, a)} に自分の店なし／増資枠なし`);
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
      messages.push(`${getAreaCode(g, a)}株×${n} を利確 +${got}G`);
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
    case 'pick_dice':
      player.flags.pendingPickDice = true;
      messages.push('次の出目を宣言できる！');
      break;
    case 'steal_mark': {
      const holders = otherPlayers(g, player).filter((o) => Array.isArray(o.marks) && o.marks.some(Boolean));
      if (!holders.length) {
        const missing = player.marks.findIndex((m) => !m);
        if (missing >= 0) {
          player.marks[missing] = true;
          messages.push('奪えるマークなし → 不足マーク入手');
        } else {
          applyCash(player, 40, messages);
          messages.push('奪えるマークなし → 手当');
        }
        break;
      }
      const victim = pickRandom(holders);
      const suits = victim.marks.map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
      const suit = pickRandom(suits);
      victim.marks[suit] = false;
      if (!player.marks[suit]) {
        player.marks[suit] = true;
        messages.push(`${victim.name} からマークを奪取`);
      } else {
        applyCash(player, 50, messages);
        messages.push(`${victim.name} のマークを破棄（自分は所持済）→ 手当`);
      }
      break;
    }
    case 'grant_wildcard': {
      const have = Math.max(0, Math.min(WARP_WILDCARD_MAX, Math.floor(Number(player.wildcards) || 0)));
      if (have >= WARP_WILDCARD_MAX) {
        applyCash(player, 40, messages);
        messages.push(`ワイルド上限 → 手当`);
      } else {
        player.wildcards = have + 1;
        messages.push(`ワイルドカード入手（${player.wildcards}/${WARP_WILDCARD_MAX}）`);
      }
      break;
    }
    case 'warp_best_shop': {
      const shops = g.map.filter((s) => s.type === 'shop' && s.owner === player.id);
      const dest = shops.sort((a, b) => b.price - a.price)[0]
        || pickRandom(g.map.filter((s) => s.type === 'shop' && s.owner < 0));
      if (dest) {
        recordWarp(g, player.id, player.pos, dest.id);
        player.prevPos = null;
        player.pos = dest.id;
        messages.push(`本拠地「${dest.label}」へ帰還`);
        collectWarpSquareRewards(g, player, dest.id, messages);
      } else {
        player.flags.extraRoll = true;
        messages.push('行き先なし → もう一振り');
      }
      break;
    }
    case 'warp_behind_leader': {
      const alive = g.players.filter((pl) => !pl.bankrupt && pl.id !== player.id);
      if (!alive.length) {
        player.flags.extraRoll = true;
        messages.push('もう一振り');
        break;
      }
      const leader = alive.reduce((a, b) => {
        const av = (a.cash || 0) + Object.values(a.stocks || {}).reduce((s, n) => s + n, 0);
        const bv = (b.cash || 0) + Object.values(b.stocks || {}).reduce((s, n) => s + n, 0);
        return bv >= av ? b : a;
      });
      recordWarp(g, player.id, player.pos, leader.pos);
      player.prevPos = null;
      player.pos = leader.pos;
      messages.push(`${leader.name} の位置へ追跡`);
      collectWarpSquareRewards(g, player, leader.pos, messages);
      break;
    }
    case 'shop_protect':
      player.flags.pendingShopProtect = true;
      messages.push('守るお店を選ぼう');
      break;
    case 'co_own':
      player.flags.pendingCoOwn = true;
      messages.push('共同オーナーになる店を選ぼう');
      break;
    case 'toll_hijack':
      g.tollHijackId = player.id;
      messages.push('次に発生する買い物料を横流し！');
      break;
    case 'time_capsule': {
      const amt = Math.max(40, scaledAmount(def, player, 'amount') || scaledAmount({ cash: def.amount || 80, levelScale: def.levelScale }, player, 'cash'));
      player.flags.timeCapsule = amt;
      messages.push(`タイムカプセルセット（次の銀行で +${amt}G）`);
      break;
    }
    case 'bank_interest': {
      const pct = Math.max(5, Math.min(15, Number(def.amount) || 8));
      const got = Math.min(250, Math.floor(player.cash * pct / 100));
      if (got > 0) {
        player.cash += got;
        messages.push(`銀行利息 +${got}G（${pct}%）`);
      } else {
        applyCash(player, 30, messages);
        messages.push('利息なし → 手当');
      }
      break;
    }
    case 'mono_hearing': {
      const monos = findRivalMonopolies(g, player.id);
      if (!monos.length) {
        applyCash(player, 80, messages);
        messages.push('独占なし → 手当');
        break;
      }
      const mono = pickRandom(monos);
      const shop = pickRandom(mono.shops);
      player.flags.pendingMonoHearing = {
        ownerId: mono.ownerId,
        area: mono.area,
        shopId: shop.id,
        fine: def.amount || 180,
      };
      messages.push(`${g.players[mono.ownerId]?.name || '独占主'} をヒアリングへ`);
      break;
    }
    case 'area_block': {
      const monos = findRivalMonopolies(g, player.id);
      const area = monos.length
        ? pickRandom(monos).area
        : pickRandom(Object.keys(g.areas || {}).map(Number));
      if (area == null || !g.areas[area]) {
        player.flags.tollShield = true;
        messages.push('封鎖先なし → 通行守り');
        break;
      }
      g.areas[area].blockTurns = 2;
      g.areas[area].blockOwnerId = player.id;
      messages.push(`${getAreaCode(g, area)} を2ターン封鎖（買い物料0）`);
      break;
    }
    case 'strip_status': {
      const rivals = otherPlayers(g, player).filter((o) => o.lucky
        || o.flags?.investCoupon
        || o.flags?.tollShield
        || o.flags?.tollBoost
        || o.flags?.takeoverMulti
        || o.flags?.fiveBuyCoupon);
      if (!rivals.length) {
        applyCash(player, 40, messages);
        messages.push('没収対象なし → 手当');
        break;
      }
      const victim = pickRandom(rivals);
      if (victim.lucky) {
        victim.lucky = false;
        messages.push(`${victim.name} のラッキーを没収`);
      } else if (victim.flags?.takeoverMulti || victim.flags?.fiveBuyCoupon) {
        victim.flags.takeoverMulti = null;
        victim.flags.fiveBuyCoupon = false;
        messages.push(`${victim.name} の買収クーポンを没収`);
      } else if (victim.flags?.investCoupon) {
        victim.flags.investCoupon = false;
        messages.push(`${victim.name} の増資半額券を没収`);
      } else if (victim.flags?.tollShield) {
        victim.flags.tollShield = false;
        messages.push(`${victim.name} の通行守りを没収`);
      } else {
        victim.flags.tollBoost = false;
        messages.push(`${victim.name} の家主印章を没収`);
      }
      break;
    }
    case 'retreat': {
      // 双方向グラフで隣をランダムに選ぶと往復して実質動かないことがある。
      // 到着元（prevPos）へ戻り、以降は「今来たマス」を除外して後退を続ける。
      const maxSteps = Math.max(1, Math.min(6, Number(def.amount) || 4));
      const from = player.pos;
      let cur = player.pos;
      let prefer = player.prevPos; // 最初の1歩は来た道へ
      let exclude = null; // 直後に来たマスへ戻らない
      let moved = 0;
      let last = from;
      for (let i = 0; i < maxSteps; i++) {
        const linked = g.map.filter((n) => (n.nexts || []).includes(cur) && n.id !== exclude);
        let preds = linked.filter((n) => n.type !== 'junction');
        if (!preds.length) preds = linked;
        if (!preds.length) break;
        let dest = prefer != null ? preds.find((n) => n.id === prefer) : null;
        if (!dest) dest = pickRandom(preds);
        if (!dest || dest.id === cur) break;
        exclude = cur;
        prefer = null;
        last = cur;
        cur = dest.id;
        moved++;
      }
      if (moved) {
        player.prevPos = last;
        player.pos = cur;
        recordWarp(g, player.id, from, cur);
        messages.push(`${moved}マス後退`);
        collectWarpSquareRewards(g, player, cur, messages);
      } else {
        player.flags.forceStopNext = true;
        messages.push('後退路なし → 強制停止を付与');
      }
      break;
    }
    case 'force_stop':
      player.flags.forceStopNext = true;
      messages.push('次の移動は1マスで強制停止');
      break;
    case 'swap_two_others': {
      const others = otherPlayers(g, player);
      if (others.length < 2) {
        player.flags.extraRoll = true;
        messages.push('対象不足 → もう一振り');
        break;
      }
      const a = pickRandom(others);
      const b = pickRandom(others.filter((o) => o.id !== a.id));
      const aFrom = a.pos;
      const bFrom = b.pos;
      recordWarp(g, a.id, aFrom, bFrom);
      recordWarp(g, b.id, bFrom, aFrom);
      a.pos = bFrom;
      b.pos = aFrom;
      a.prevPos = null;
      b.prevPos = null;
      messages.push(`${a.name} と ${b.name} の席を入れ替え`);
      collectWarpSquareRewards(g, a, bFrom, messages);
      collectWarpSquareRewards(g, b, aFrom, messages);
      break;
    }
    case 'insider_stocks': {
      applyStocks(g, player, def.stocks || 10, messages);
      const tax = Math.max(40, Number(def.amount) || 60);
      player.flags.insiderTax = tax;
      messages.push(`インサイダー嫌疑（次の銀行で −${tax}G）`);
      break;
    }
    case 'fortune_triple': {
      const pool = [
        { effect: 'cash', cash: 90, label: '現金+90G' },
        { effect: 'stocks', stocks: 8, label: '株+8' },
        { effect: 'extra_roll', label: 'もう一振り' },
        { effect: 'lucky', label: 'ラッキー' },
        { effect: 'invest_coupon', label: '増資半額券' },
        { effect: 'cash', cash: -40, label: '罰金40G' },
      ];
      const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);
      player.flags.pendingFortuneTriple = shuffled;
      messages.push('運命の三択！');
      break;
    }
    case 'lend_shop': {
      const shops = g.map.filter((s) => s.type === 'shop' && s.owner === player.id);
      const poor = otherPlayers(g, player).sort((a, b) => a.cash - b.cash)[0];
      if (!shops.length || !poor) {
        applyCash(player, 40, messages);
        messages.push('名義貸し不可 → 手当');
        break;
      }
      const sq = pickRandom(shops);
      sq.owner = poor.id;
      player.flags.lentShop = {
        shopId: sq.id,
        fromId: player.id,
        toId: poor.id,
        returnTurn: (g.turn || 0) + 2,
      };
      messages.push(`「${sq.label}」を ${poor.name} へ名義貸し（2ターン）`);
      break;
    }
    case 'compare_ad': {
      const myShops = g.map.filter((s) => s.type === 'shop' && s.owner === player.id);
      if (!myShops.length) {
        applyCash(player, 40, messages);
        messages.push('自店なし → 手当');
        break;
      }
      const area = pickRandom(myShops).area;
      const rivals = g.map.filter((s) => s.type === 'shop' && Number(s.area) === area && s.owner >= 0 && s.owner !== player.id);
      const cut = Math.max(20, Number(def.amount) || 40);
      let cutTotal = 0;
      for (const sq of rivals) {
        const n = Math.min(sq.extraInvest || 0, cut);
        if (n <= 0) continue;
        sq.extraInvest -= n;
        sq.price -= n;
        cutTotal += n;
      }
      let boost = 0;
      for (const sq of myShops.filter((s) => Number(s.area) === area)) {
        boost += boostShopCapped(g, sq, Math.floor(cut / 2));
      }
      refreshAreaStockPrice(g, area);
      messages.push(cutTotal || boost
        ? `${getAreaCode(g, area)} 比較広告（相手−${cutTotal} / 自分+${boost}）`
        : '比較広告は効かず');
      break;
    }
    case 'insurance_refund': {
      const last = Math.max(0, Math.floor(Number(player.flags?.lastTollPaid) || 0));
      const got = Math.floor(last / 2);
      if (got > 0) {
        player.cash += got;
        messages.push(`保険金 +${got}G（直近買い物料の半分）`);
      } else {
        applyCash(player, 35, messages);
        messages.push('直近支払いなし → 手当');
      }
      break;
    }
    case 'mark_gamble': {
      const have = player.marks.map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
      if (!have.length) {
        applyCash(player, -30, messages);
        messages.push('賭けマークなし → 罰金');
        break;
      }
      const suit = pickRandom(have);
      player.marks[suit] = false;
      if (Math.random() < 0.5) {
        const missing = player.marks.findIndex((m) => !m);
        if (missing >= 0) player.marks[missing] = true;
        player.marks[suit] = true;
        const extra = player.marks.findIndex((m) => !m);
        if (extra >= 0) player.marks[extra] = true;
        messages.push('マーク賭博あたり！（最大+1）');
      } else {
        messages.push('マーク賭博はずれ…1枚没収');
      }
      break;
    }
    case 'short_stock': {
      const areas = Object.keys(g.areas || {}).map(Number);
      if (!areas.length) {
        applyCash(player, 40, messages);
        break;
      }
      const a = pickRandom(areas);
      const price = g.areas[a]?.stockPrice || 20;
      const n = 5;
      const got = price * n;
      player.cash += got;
      player.flags.shortCover = Math.floor(got * 1.2);
      messages.push(`${getAreaCode(g, a)} を空売り +${got}G（次銀行で買い戻し ${player.flags.shortCover}G）`);
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

/** ライン上に塗られているプレイヤー色（座席ID）を列挙 */
function colorsPresentOnLine(lineCells, table) {
  const set = new Set();
  for (const id of lineCells) {
    const cell = table.cells[id];
    if (cell?.scratched && Number.isInteger(cell.color)) set.add(cell.color);
  }
  return [...set];
}

/**
 * 縦・横・斜めに同じプレイヤー色が隣接して3つ以上そろえば、
 * そのマスを開けたプレイヤーへ報酬。
 */
function checkColorMatches(g, table, cellId, messages) {
  const size = table.size;
  const row = Math.floor(cellId / size);
  const col = cellId % size;
  const lines = [];

  lines.push({ key: `r${row}`, cells: Array.from({ length: size }, (_, c) => row * size + c) });
  lines.push({ key: `c${col}`, cells: Array.from({ length: size }, (_, r) => r * size + col) });

  // ↘ 斜め（row-col 一定）。本対角だけでなく平行な斜め列もすべて対象
  {
    const diff = row - col;
    const cells = [];
    for (let r = 0; r < size; r++) {
      const c = r - diff;
      if (c >= 0 && c < size) cells.push(r * size + c);
    }
    if (cells.length >= 3) lines.push({ key: `d0_${diff}`, cells });
  }
  // ↙ 斜め（row+col 一定）
  {
    const sum = row + col;
    const cells = [];
    for (let r = 0; r < size; r++) {
      const c = sum - r;
      if (c >= 0 && c < size) cells.push(r * size + c);
    }
    if (cells.length >= 3) lines.push({ key: `d1_${sum}`, cells });
  }

  let total = 0;
  /** @type {{ lineKey: string, color: number, count: number, bonus: number, cellIds: number[], beneficiaryId: number, beneficiaryName: string, beneficiaryColor: string }[]} */
  const matches = [];
  if (!table.claimedMatches) table.claimedMatches = {};

  for (const line of lines) {
    for (const color of colorsPresentOnLine(line.cells, table)) {
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
      // color は開けた人の player.id。グループ色インデックスとの取り違えをしない
      const beneficiary = g.players.find((p) => !p.bankrupt && p.id === color);
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
        messages.push(`${beneficiary.name}色そろい×${n} → ${beneficiary.name} +${bonus}G`);
      }
    }
  }
  return { total, matches };
}
