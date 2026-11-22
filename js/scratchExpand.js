/**
 * 新規スクラッチ・ミニゲーム拡張（engine / eventTable から利用）。
 * engine 循環 import を避けるため、盤面副作用は呼び出し側の helpers 経由。
 */

export const NEW_PARTY_MINIGAMES = new Set(['silent_bid', 'hot_potato', 'target_roulette']);

export const NEW_MINIGAME_LABELS = {
  memory_match: '神経衰弱',
  silent_bid: 'サイレント入札',
  push_pull: '押し引き',
  divide_pool: '配分ゲーム',
  target_roulette: 'ターゲットルーレット',
  hot_potato: 'パス禁止',
};

/** @param {string} game @param {any} choice */
export function normalizeNewMinigamePick(game, choice) {
  if (game === 'memory_match') {
    const raw = choice?.value;
    let a;
    let b;
    if (typeof raw === 'string' && raw.includes(',')) {
      const parts = raw.split(',').map((x) => Number(x));
      a = parts[0];
      b = parts[1];
    } else if (typeof raw === 'number') {
      a = Math.floor(raw / 10);
      b = raw % 10;
    } else if (Array.isArray(raw)) {
      a = Number(raw[0]);
      b = Number(raw[1]);
    }
    a = Math.max(0, Math.min(5, Number(a) || 0));
    b = Math.max(0, Math.min(5, Number(b) || 0));
    if (a === b) b = (a + 1) % 6;
    return `${a},${b}`;
  }
  if (game === 'silent_bid') {
    const n = Number(choice?.value);
    return [30, 60, 100, 150].includes(n) ? n : 60;
  }
  if (game === 'push_pull') {
    const n = Number(choice?.value);
    return [1, 2, 3, 4, 5].includes(n) ? n : 3;
  }
  if (game === 'divide_pool') {
    const n = Number(choice?.value);
    return [40, 50, 60, 70].includes(n) ? n : 50;
  }
  if (game === 'target_roulette') {
    if (choice?.value === 'prize') return 'prize';
    const id = Number(choice?.value);
    return Number.isFinite(id) ? id : 'prize';
  }
  if (game === 'hot_potato') {
    return choice?.value === 'stop' ? 'stop' : 'pass';
  }
  return null;
}

/**
 * @param {string} game
 * @param {{ rng: () => number, participants: { id: number }[] }} ctx
 */
export function setupNewMinigameShared(game, ctx) {
  const { rng, participants } = ctx;
  /** @type {Record<string, unknown>} */
  const shared = {};
  if (game === 'memory_match') {
    const syms = ['★', '★', '♪', '♪', 'G', 'G'];
    for (let i = syms.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = syms[i];
      syms[i] = syms[j];
      syms[j] = t;
    }
    shared.board = syms;
  } else if (game === 'push_pull') {
    shared.popAt = 2 + Math.floor(rng() * 5);
  } else if (game === 'divide_pool') {
    shared.pool = 160 + Math.floor(rng() * 80);
    shared.threshold = 45 + Math.floor(rng() * 26);
  } else if (game === 'target_roulette') {
    const opts = ['prize', ...participants.map((p) => p.id)];
    shared.land = opts[Math.floor(rng() * opts.length)];
  } else if (game === 'hot_potato') {
    shared.safeStops = Math.max(1, Math.floor(rng() * Math.max(1, participants.length)));
  } else if (game === 'silent_bid') {
    shared.pot = 180 + Math.floor(rng() * 100);
  }
  return shared;
}

/**
 * @returns {{ win: boolean, detail: string, tier: string, title: string, prizeWon: number, messages: string[], outcome: Record<string, unknown> }}
 */
export function scoreNewMinigamePlayer(g, p, game, pick, shared, helpers) {
  const {
    grantMinigamePrize,
    minigameConsolation,
    lvPrize,
    flatPrize,
  } = helpers;
  const messages = [];
  let win = false;
  let detail = '';
  let tier = 'miss';
  let title = '結果発表';
  let prizeWon = 0;
  /** @type {Record<string, unknown>} */
  const outcome = {};
  const lvTag = `Lv${p.level}`;

  if (game === 'memory_match') {
    const board = shared.board || [];
    const [as, bs] = String(pick).split(',');
    const a = Number(as);
    const b = Number(bs);
    const sa = board[a];
    const sb = board[b];
    outcome.board = board;
    outcome.picks = [a, b];
    outcome.symbols = [sa, sb];
    if (a !== b && sa && sa === sb) {
      win = true;
      tier = 'win';
      title = 'ペア成立！';
      const prize = lvPrize(140);
      prizeWon = grantMinigamePrize(p, prize, messages, `神経衰弱成功（${sa}）→ +${prize}G（${lvTag}）`);
    } else {
      title = '不一致…';
      prizeWon = minigameConsolation(p, 22, messages, `不一致（${sa || '?'} / ${sb || '?'}）→ 参加賞 +22G`);
    }
    detail = `${a + 1}枚目と${b + 1}枚目`;
  } else if (game === 'silent_bid') {
    const bid = Number(pick) || 60;
    const pot = Number(shared.pot) || 200;
    const allBids = shared.allBids || {};
    const entries = Object.entries(allBids).map(([id, b]) => ({ id: Number(id), bid: Number(b) }));
    const maxBid = entries.reduce((m, e) => Math.max(m, e.bid), 0);
    const leaders = entries.filter((e) => e.bid === maxBid);
    outcome.bid = bid;
    outcome.pot = pot;
    outcome.maxBid = maxBid;
    const paid = Math.min(p.cash, bid);
    p.cash -= paid;
    if (leaders.length === 1 && leaders[0].id === p.id) {
      win = true;
      tier = bid >= 100 ? 'jackpot' : 'win';
      title = '落札！';
      const prize = flatPrize(pot);
      prizeWon = grantMinigamePrize(p, prize, messages, `入札${bid}Gで落札 → +${prize}G（支払 ${paid}G）`);
    } else if (leaders.length > 1 && leaders.some((l) => l.id === p.id)) {
      title = '同額で流札';
      p.cash += Math.floor(paid / 2);
      prizeWon = minigameConsolation(p, 20, messages, `同額入札で流札 → 半額返還＋参加賞`);
    } else {
      title = '入札負け…';
      p.cash += Math.floor(paid * 0.7);
      prizeWon = minigameConsolation(p, 18, messages, `入札${bid}G敗退 → 7割返還＋参加賞`);
    }
    detail = `入札 ${bid}G / 最高 ${maxBid}G`;
  } else if (game === 'push_pull') {
    const stop = Number(pick) || 3;
    const popAt = Number(shared.popAt) || 4;
    const popped = stop >= popAt;
    outcome.stop = stop;
    outcome.popAt = popAt;
    outcome.popped = popped;
    if (!popped) {
      win = true;
      tier = stop >= 4 ? 'jackpot' : stop >= 3 ? 'win' : 'near';
      title = '押し引き成功！';
      const prize = lvPrize(36 * stop);
      prizeWon = grantMinigamePrize(p, prize, messages, `${stop}段階でストップ（限界${popAt}）→ +${prize}G（${lvTag}）`);
    } else {
      title = '引き失敗…';
      prizeWon = minigameConsolation(p, 20, messages, `${stop}段階で破綻（限界${popAt}）→ 参加賞 +20G`);
    }
    detail = `ストップ ${stop} / 限界 ${popAt}`;
  } else if (game === 'divide_pool') {
    const keep = Number(pick) || 50;
    const pool = Number(shared.pool) || 200;
    const th = Number(shared.threshold) || 55;
    outcome.keep = keep;
    outcome.pool = pool;
    outcome.threshold = th;
    if (keep <= th) {
      win = true;
      tier = keep <= 50 ? 'win' : 'near';
      title = '配分成立！';
      const prize = flatPrize(Math.floor(pool * keep / 100));
      prizeWon = grantMinigamePrize(p, prize, messages, `自分${keep}%（閾値${th}%）→ +${prize}G`);
    } else {
      title = '配分拒否…';
      prizeWon = minigameConsolation(p, 24, messages, `欲張り${keep}% > 閾値${th}% → 参加賞 +24G`);
    }
    detail = `要求 ${keep}% / 閾値 ${th}% / 池 ${pool}G`;
  } else if (game === 'target_roulette') {
    const land = shared.land;
    outcome.land = land;
    outcome.pick = pick;
    const landLabel = land === 'prize' ? '賞金' : (g.players[land]?.name || `P${land}`);
    const pickLabel = pick === 'prize' ? '賞金' : (g.players[pick]?.name || `P${pick}`);
    if (pick === land || String(pick) === String(land)) {
      win = true;
      if (land === 'prize') {
        tier = 'win';
        title = '賞金ゲット！';
        const prize = lvPrize(150);
        prizeWon = grantMinigamePrize(p, prize, messages, `ルーレット「賞金」→ +${prize}G（${lvTag}）`);
      } else {
        const victim = g.players[Number(land)];
        const want = flatPrize(90 + p.level * 12);
        const got = Math.min(victim?.cash || 0, want);
        if (victim && got > 0) {
          victim.cash -= got;
          p.cash += got;
          prizeWon = got;
          messages.push(`${victim.name} から徴収 +${got}G`);
        } else {
          prizeWon = grantMinigamePrize(p, 40, messages, '徴収先の現金不足 → 手当 +40G');
        }
        tier = 'jackpot';
        title = 'ターゲット的中！';
      }
    } else {
      title = '外れ…';
      prizeWon = minigameConsolation(p, 22, messages, `予想${pickLabel} → ${landLabel} → 参加賞 +22G`);
    }
    detail = `予想 ${pickLabel} → ${landLabel}`;
  } else if (game === 'hot_potato') {
    const allPicks = shared.allPicks || {};
    const stoppers = Object.entries(allPicks)
      .filter(([, v]) => v === 'stop')
      .map(([id]) => Number(id));
    const safe = Number(shared.safeStops) || 1;
    outcome.pick = pick;
    outcome.stoppers = stoppers;
    outcome.safeStops = safe;
    if (pick === 'stop') {
      if (stoppers.length > 0 && stoppers.length <= safe && stoppers.includes(p.id)) {
        win = true;
        tier = stoppers.length === 1 ? 'jackpot' : 'win';
        title = '止めて成功！';
        const prize = lvPrize(stoppers.length === 1 ? 170 : 100);
        prizeWon = grantMinigamePrize(p, prize, messages, `パス禁止成功（${stoppers.length}人）→ +${prize}G（${lvTag}）`);
      } else {
        title = '止めすぎ…';
        const fine = Math.min(p.cash, 35);
        p.cash -= fine;
        prizeWon = minigameConsolation(p, 15, messages, `止め人が多すぎ（上限${safe}）→ −${fine}G＋参加賞`);
      }
    } else if (stoppers.length === 0) {
      win = true;
      tier = 'near';
      title = '誰も止めず…';
      const prize = flatPrize(55);
      prizeWon = grantMinigamePrize(p, prize, messages, `全員パス → 分配 +${prize}G`);
    } else {
      title = '回して回避';
      prizeWon = minigameConsolation(p, 28, messages, 'パスして回避 → 参加賞 +28G');
    }
    detail = pick === 'stop' ? `止める（止め${stoppers.length}/${safe}）` : '回す';
  } else {
    return null;
  }

  return { win, detail, tier, title, prizeWon, messages, outcome };
}
