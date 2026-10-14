// 1日に複数本（枠 = slot）投稿する媒体の判定。純粋な関数だけ(ネットワーク・ファイルに触らない)。
// feeds.json の媒体に `slots: [{ slot, time }]` があるときだけ使う。無い媒体はこれまでどおり1日1本。
// 枠に `lang` があると、予定・記録の lang も一致するものだけをその枠として数える
// (ロストボール: 同じ「夜」に日本語20:35と英語21:00の2本)。`label` は表示名(例: "英語")。
// - 予定(planned)・記録(posted)に `slot` があるものは、その枠の分。
// - `slot` が無いものは従来の1日1本(legacy)。その日に legacy の予定・記録があれば、従来の表示のまま。
// - 枠は「時刻 + 猶予(graceMinutes)」を過ぎて記録が無いときだけ「出ていない」と数える。

import { listOf, jstDate, dayOf } from './digest.mjs';

export const DEFAULT_GRACE_MINUTES = 30;
const SLOT_LABEL = { morning: '朝', noon: '昼', night: '夜' };
export const slotLabel = (slot) => SLOT_LABEL[slot] ?? slot;
// 枠の表示名。feeds.json の label があればそれ(「英語」)、無ければ 朝/昼/夜。
export const slotName = (s) => s?.label ?? slotLabel(s?.slot);
// 予定・記録 p が、枠 s のものか。枠に lang があれば言語も見る。
const inSlot = (p, s) => p.slot === s.slot && (s.lang === undefined || p.lang === s.lang);

const toMin = (time) => {
  const [h, m] = String(time).split(':').map(Number);
  return h * 60 + m;
};

// その日(JST)の "H:MM" の時刻(Date)。
export function slotDeadline(date, time, graceMinutes = 0) {
  return new Date(Date.parse(`${date}T00:00:00+09:00`) + (toMin(time) + graceMinutes) * 60000);
}

export const graceOf = (feed, cfg) => feed.graceMinutes ?? cfg?.graceMinutes ?? DEFAULT_GRACE_MINUTES;

// その日が「枠の日」か。予定・記録に slot があれば枠の日、slot の無い予定・記録があれば従来の日。
// どちらも無い日は、feed.slotsFrom 以降なら枠の日として扱う(「今日は予定なし」の表示用)。
function dayKind(feed, todaysPlanned, todaysPosted, today) {
  if ([...todaysPlanned, ...todaysPosted].some((p) => p.slot)) return 'slots';
  if (todaysPlanned.length || todaysPosted.length) return 'legacy';
  return feed.slotsFrom && today >= feed.slotsFrom ? 'slots' : 'legacy';
}

// 枠の日の、枠ごとの状態。枠の日でなければ null。
// now: いまの時刻(Date)。時刻 + 猶予を過ぎた枠だけ due(出ているはず)にする。
export function slotDay(feed, postedJson, plannedJson, today, { now = new Date(), graceMinutes = DEFAULT_GRACE_MINUTES } = {}) {
  if (!Array.isArray(feed.slots) || !feed.slots.length) return null;
  const todaysPlanned = listOf(plannedJson, feed.planned.list).filter((p) => dayOf(p, feed.planned) === today);
  const todaysPosted = listOf(postedJson, feed.posted.list).filter((p) => dayOf(p, feed.posted) === today);
  if (dayKind(feed, todaysPlanned, todaysPosted, today) !== 'slots') return null;

  const isApproved = (p) => !feed.planned.approved || p[feed.planned.approved] === true;
  const list = feed.slots.map((def) => {
    const { slot, time, lang, label } = def;
    const items = todaysPlanned.filter((p) => inSlot(p, def));
    const planned = items.length > 0;
    const approved = items.some(isApproved);
    const posted = todaysPosted.some((p) => inSlot(p, def));
    const due = now >= slotDeadline(today, time, graceMinutes);
    return { slot, time, ...(lang ? { lang } : {}), ...(label ? { label } : {}), planned, approved, posted, due, overdue: approved && !posted && due };
  });
  return {
    list,
    planned: list.filter((s) => s.planned).length,
    approved: list.filter((s) => s.approved).length,
    posted: list.filter((s) => s.posted).length,
    later: list.filter((s) => s.planned && !s.posted && !s.due).length,
  };
}

// 毎時の見回り用: 前回の見回り(since)から今回(now)までに「時刻 + 猶予」を迎えたのに記録が無い枠。
// 同じ枠を毎時くり返し知らせないよう、締め切りが (since, now] に入った枠だけを返す。後の枠は数えない。
export function missedSlots(feed, postedJson, plannedJson, { since, now, graceMinutes = DEFAULT_GRACE_MINUTES }) {
  const sinceD = new Date(since);
  const nowD = new Date(now);
  const out = [];
  for (const date of [...new Set([jstDate(sinceD), jstDate(nowD)])]) {
    const day = slotDay(feed, postedJson, plannedJson, date, { now: nowD, graceMinutes });
    if (!day) continue;
    for (const s of day.list) {
      const deadline = slotDeadline(date, s.time, graceMinutes);
      if (s.overdue && deadline > sinceD && deadline <= nowD) {
        out.push({ brand: feed.brand, media: feed.media, repo: feed.repo, date, slot: s.slot, time: s.time, ...(s.lang ? { lang: s.lang } : {}), ...(s.label ? { label: s.label } : {}) });
      }
    }
  }
  return out;
}
