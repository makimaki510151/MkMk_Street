/** スクラッチイベント図鑑（目撃記録＋カタログ変更時の失効） */

import { EVENT_CATALOG, EVENT_COUNT } from './eventTable.js';

const STORAGE_KEY = 'mkmk_scratch_dex_v1';

/** 指紋に使う内容フィールド（順序固定） */
const SIGNATURE_FIELDS = [
  'kind',
  'label',
  'effect',
  'multi',
  'amount',
  'cash',
  'levelScale',
  'stocks',
  'shopBoost',
  'game',
  'lucky',
  'grantMark',
  'extraRoll',
  'npcKind',
];

/**
 * 保存済み／現行の指紋を比較用に正規化する。
 * null/undefined キーを落とし、フィールド追加だけでは未変更扱いになるようにする。
 */
export function normalizeEventSignature(sig) {
  if (sig == null || sig === '') return '';
  if (typeof sig !== 'string') return '';
  try {
    const obj = JSON.parse(sig);
    if (!obj || typeof obj !== 'object') return sig;
    const cleaned = {};
    for (const key of SIGNATURE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      const v = obj[key];
      if (v === null || v === undefined) continue;
      cleaned[key] = v;
    }
    return JSON.stringify(cleaned);
  } catch {
    return sig;
  }
}

/** イベント定義の指紋（内容が変わったら目撃を消す判定用） */
export function eventDefSignature(def) {
  if (!def) return '';
  const cleaned = {};
  for (const key of SIGNATURE_FIELDS) {
    const v = def[key];
    if (v === null || v === undefined) continue;
    cleaned[key] = v;
  }
  return JSON.stringify(cleaned);
}

/** 指紋が同じ内容を指すか（スキーマ拡張による null 追加だけでは不一致にしない） */
export function eventSignaturesMatch(a, b) {
  return normalizeEventSignature(a) === normalizeEventSignature(b);
}

/** 図鑑用の効果説明（番号リストの本文） */
export function describeEventDef(def) {
  if (!def) return '不明なイベント';
  const effect = def.effect || def.kind;
  const multi = Number(def.multi) || 0;
  const amount = Number(def.amount) || 0;
  const cash = Number(def.cash) || 0;
  const scale = Number(def.levelScale) || 0;
  const scaledHint = scale
    ? `（基本${cash || amount}＋レベル×${scale}）`
    : '';

  switch (effect) {
    case 'cash':
      return cash >= 0
        ? `所持金 +${cash || 50}G${scaledHint}`
        : `所持金 ${cash}G${scaledHint}`;
    case 'all_cash':
      return `全員の所持金 +${cash || 80}G${scaledHint}`;
    case 'stocks':
      return `ランダムエリアの株 +${def.stocks || 5}`;
    case 'shop_boost':
      return `自分の店の価値アップ（枠内・基本${def.shopBoost || 50}）`;
    case 'pick_invest':
      return `好きな自分の店へ +${amount || 50}G 増資${scaledHint}`;
    case 'slash_rival_shops':
      return `ライバル店の増資を削る（目安 ${amount || 40}）`;
    case 'slash_own_shops':
      return `自分の店の増資が目減り（目安 ${amount || 40}）`;
    case 'takeover_coupon':
      return `次の店奪取が${multi || 3}倍買いに（通常は5倍）`;
    case 'any_shop_buy':
      return `好きな相手の店を${multi || 6}倍で指名買収できる`;
    case 'vacant_shop_buy':
      return `好きな空き店を${multi || 2}倍価格で購入できる`;
    case 'force_sell_shop':
      return '自分のお店を1店舗、強制売却しなければならない';
    case 'force_rival_sell':
      return `好きな相手の店を強制売却（店価×${multi || 3}を銀行が相手に支払う）`;
    case 'shuffle_marks':
      return '全員が持っているマークをバラバラにシャッフルする';
    case 'extra_roll':
      return 'もう一度サイコロを振れる';
    case 'warp_bank':
      return '銀行マスへワープ';
    case 'warp_mark':
      return '未所持マークのマスへワープ';
    case 'warp_vacant_shop':
      return '空き店マスへワープ';
    case 'warp_random':
      return 'ランダムなマスへワープ';
    case 'grant_mark':
      return '不足しているマークを1つ入手';
    case 'grant_two_marks':
      return '不足マークを最大2つ入手';
    case 'lucky':
      return 'ラッキー状態（他者の買い物料の一部を銀行から受取）';
    case 'invest_coupon':
    case 'invest_half':
      return '次の増資支払いが半額';
    case 'toll_shield':
      return '次の買い物料を1回無効化';
    case 'toll_boost':
      return '次に受け取る買い物料がアップ';
    case 'own_shop_holiday':
      return '自分のお店が1ターン休み';
    case 'rival_shop_holiday':
      return 'ライバルのお店が1ターン休み';
    case 'rest':
      return '次のターンは休憩';
    case 'seize_mono_shop':
      return '相手の独占エリアから店を1軒奪取';
    case 'mono_area_holiday':
      return '相手の独占店が1ターン休み';
    case 'mono_tax':
      return `独占主から税を徴収（目安 ${amount || 180}G）`;
    case 'slash_mono_value':
      return `独占エリアの店価を削る（目安 ${amount || 50}）`;
    case 'steal_mono_stock':
      return `独占エリアの株を横取り（最大 ${amount || 8}）`;
    case 'minigame':
      return `ミニゲーム「${def.game || def.label || '？'}」に挑戦`;
    case 'donate_poorest':
      return `最下位プレイヤーにプレゼント（目安 ${amount || 80}G）`;
    case 'tax_richest':
      return `首位プレイヤーから徴収（目安 ${amount || 70}G）`;
    case 'steal_stock':
      return `他プレイヤーから株を奪う（最大 ${amount || 5}）`;
    case 'swap_pos':
      return '他プレイヤー1人と位置を交換';
    case 'swap_all_pos':
      return '全員の位置を入れ替え';
    case 'scatter_all':
      return '全員がバラバラのマスへ飛ぶ';
    case 'gather_all':
      return '全員が同じマスに集合';
    case 'bump_area_stock':
      return amount >= 1
        ? `ランダムエリアの株価が上昇（×${amount}）`
        : `ランダムエリアの株価が調整（×${amount || 0.92}）`;
    case 'boost_area_shops':
      return `ランダムエリアの自分の店価値アップ（目安 ${amount || 25}）`;
    case 'trim_stocks':
      return `持株を一部利確（目安 ${amount || 5}枚）`;
    case 'boost_all_shops':
      return `全所持店の価値アップ（枠内・目安 ${amount || 20}）`;
    case 'multi_stocks':
      return `複数エリアに株配布（目安 ${amount || 4}）`;
    case 'mystery':
      return 'ミステリー効果（その場で抽選）';
    case 'shop_and_stock':
      return '店みがき＋株のセット';
    case 'lucky_invest':
      return 'ラッキー状態＋増資半額券';
    case 'rival_slash_and_coupon':
      return `ライバル店を値下げし、${multi || 4}倍買いクーポンを入手`;
    case 'spawn_event_npc': {
      const kind = def.npcKind || '';
      if (kind === 'mark_fairy') {
        return 'マークの妖精が登場。10面移動ですれ違いに未所持マーク／ワイルドをくれる';
      }
      if (kind === 'merchant') {
        return '大商人が登場。高い店を狙って移動し、買い物料を支払う';
      }
      if (kind === 'poverty') {
        return '貧乏神が登場。通過した店を一時店休にし、大きめの出目で移動する';
      }
      return 'イベントNPCをマップに召喚する';
    }
    default:
      return def.label || String(effect);
  }
}

function emptyStore() {
  return { seen: {}, sigs: {} };
}

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    return {
      seen: parsed?.seen && typeof parsed.seen === 'object' ? { ...parsed.seen } : {},
      sigs: parsed?.sigs && typeof parsed.sigs === 'object' ? { ...parsed.sigs } : {},
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      seen: store.seen || {},
      sigs: store.sigs || {},
    }));
  } catch {
    /* ignore quota */
  }
}

/**
 * カタログと照合し、内容が変わった番号の目撃記録だけ削除する。
 * 指紋スキーマにフィールドが増えても、実内容が同じなら残す。
 * @returns {{ cleared: number[], seenCount: number }}
 */
export function syncScratchDexWithCatalog(catalog = EVENT_CATALOG) {
  const store = readStore();
  const cleared = [];
  const nextSigs = {};
  const nextSeen = { ...store.seen };

  for (let i = 0; i < EVENT_COUNT; i++) {
    const def = catalog[i];
    const id = def?.id ?? (i + 1);
    const sig = eventDefSignature(def);
    nextSigs[id] = sig;
    const prev = store.sigs[id] ?? store.sigs[String(id)];
    const seenHere = !!(nextSeen[id] || nextSeen[String(id)]);
    // 指紋未登録の番号は消さない（初回同期・旧データ補完）
    if (prev != null && seenHere && !eventSignaturesMatch(prev, sig)) {
      delete nextSeen[id];
      delete nextSeen[String(id)];
      cleared.push(id);
    }
  }

  // カタログ外の古いキーも掃除
  for (const key of Object.keys(nextSeen)) {
    const n = Number(key);
    if (!Number.isFinite(n) || n < 1 || n > EVENT_COUNT) delete nextSeen[key];
  }

  writeStore({ seen: nextSeen, sigs: nextSigs });
  return {
    cleared,
    seenCount: Object.keys(nextSeen).filter((k) => nextSeen[k]).length,
  };
}

/** 試合でスクラッチ番号を目撃したときに呼ぶ */
export function markScratchEventSeen(eventId) {
  const id = Number(eventId);
  if (!Number.isFinite(id) || id < 1 || id > EVENT_COUNT) return false;
  const store = readStore();
  if (store.seen[id]) return false;
  store.seen[id] = true;
  // 指紋が未登録なら現カタログで補完
  if (!store.sigs[id]) {
    const def = EVENT_CATALOG[id - 1];
    store.sigs[id] = eventDefSignature(def);
  }
  writeStore(store);
  return true;
}

export function isScratchEventSeen(eventId) {
  const id = Number(eventId);
  const store = readStore();
  return !!(store.seen[id] || store.seen[String(id)]);
}

/** 図鑑リスト用エントリ（未目撃は seen=false） */
export function getScratchDexEntries(catalog = EVENT_CATALOG) {
  syncScratchDexWithCatalog(catalog);
  const store = readStore();
  return Array.from({ length: EVENT_COUNT }, (_, i) => {
    const def = catalog[i];
    const id = def?.id ?? (i + 1);
    const seen = !!(store.seen[id] || store.seen[String(id)]);
    return {
      id,
      seen,
      label: seen ? (def?.label || `イベント${id}`) : '？？？',
      description: seen ? describeEventDef(def) : 'まだ目撃していません',
    };
  });
}

export function getScratchDexStats(catalog = EVENT_CATALOG) {
  const entries = getScratchDexEntries(catalog);
  const seen = entries.filter((e) => e.seen).length;
  return { seen, total: entries.length };
}
