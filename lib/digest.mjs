// 朝のまとめと失敗通知の文面を作る。純粋な関数だけ(ネットワーク・ファイルに触らない)。
import { slotDay, slotName } from './slots.mjs';

export const jstDate = (d = new Date()) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

// JSON の中の一覧を取り出す(配列そのもの、または { posts: [...] } のような形)。
export function listOf(json, key) {
  if (Array.isArray(json)) return json;
  if (json && key && Array.isArray(json[key])) return json[key];
  return [];
}

// spec.dayField: 記録にその項目(例: targetDate)があれば、それを日本時間の日付としてそのまま使う。
export function dayOf(item, spec) {
  if (spec.dayField && item?.[spec.dayField]) return String(item[spec.dayField]).slice(0, 10);
  const v = item?.[spec.date];
  if (!v) return null;
  return spec.iso ? jstDate(new Date(v)) : String(v).slice(0, 10);
}

// 1つの媒体の、今日の状態と「承認済みがいつまでか」。
// planned に approved の指定が無いもの(Threads の draft-bank)は、入っている時点で承認済み。
// feed.slots がある媒体の「枠の日」は、枠ごとに数える(slots)。opts: { now, graceMinutes }。
// feed.posted.statusIn があれば、記録の status がその中のものだけを「投稿済み」と数える
// (Mac の LITALICO・note の記録は止まった・エラーも同じファイルに入るため)。それ以外の status の
// 今日の記録があって投稿済みが無ければ state は 'stopped'。
export function feedStatus(feed, postedJson, plannedJson, today, opts = {}) {
  const allToday = listOf(postedJson, feed.posted.list).filter((p) => dayOf(p, feed.posted) === today);
  const statusIn = Array.isArray(feed.posted.statusIn) ? feed.posted.statusIn : null;
  const posted = statusIn ? allToday.filter((p) => statusIn.includes(p?.status)).length : allToday.length;
  const stoppedToday = statusIn ? allToday.some((p) => !statusIn.includes(p?.status)) : false;
  const planned = listOf(plannedJson, feed.planned.list);
  const isApproved = (p) => !feed.planned.approved || p[feed.planned.approved] === true;
  const todays = planned.filter((p) => dayOf(p, feed.planned) === today);
  const approvedDates = planned.filter(isApproved).map((p) => dayOf(p, feed.planned)).filter((d) => d && d < '2099');
  const until = approvedDates.length ? approvedDates.sort().at(-1) : null;

  const slots = slotDay(feed, postedJson, plannedJson, today, opts);
  if (slots) {
    let state;
    if (!slots.planned && !slots.posted) state = 'none';
    else if (slots.list.some((x) => x.overdue)) state = 'pending';
    else if (slots.list.some((x) => x.planned && !x.approved)) state = 'unapproved';
    else if (slots.posted >= slots.planned) state = 'posted';
    else state = 'scheduled';
    return { posted: slots.posted, state, until, slots };
  }

  let state;
  if (posted > 0) state = 'posted';
  else if (stoppedToday) state = 'stopped';
  else if (todays.some(isApproved)) state = 'pending';
  else if (todays.length) state = 'unapproved';
  else state = 'none';
  return { posted, state, until };
}

const ICON = { posted: '✅', scheduled: '✅', pending: '⚠️', unapproved: '⚠️', stopped: '⚠️', none: '・', error: '❓' };
const LABEL = { posted: '投稿済み', pending: '予定あり・まだ出ていない', unapproved: '予定はあるが未承認', stopped: '止まりました', none: '今日は予定なし', error: '確認できず' };
const hm = (time) => time.replace(/^0(\d)/, '$1');

// 枠の日の1行: 「3本（7:05・12:05・20:05） 承認済み 3/3・1/3 投稿済み」。
function slotLine(feed, status) {
  const s = status.slots;
  // 枠に label があれば時刻の前に付ける（例: 「英語21:00」）。
  const head = `${feed.media} ${s.list.length}本（${s.list.map((x) => `${x.label ?? ''}${hm(x.time)}`).join('・')}）`;
  if (status.state === 'none') return `${head} ${LABEL.none}`;
  const late = s.list.filter((x) => x.overdue).map((x) => `${slotName(x)} ${hm(x.time)}`);
  return `${head} 承認済み ${s.approved}/${s.planned}・${s.posted}/${s.planned} 投稿済み${late.length ? `・${late.join('、')} がまだ出ていない` : ''}`;
}

// rows: [{ feed, status | null, error? }], failures: [{ repo, name, url }], tokens: [{ label, expiresAt }]
// gbp: { brand, line, todo: [] }（Googleビジネスプロフィール。lib/gbp.mjs）。line はそのブランドの欄の最後に載せる。
export function buildDigest({ today, rows, failures = [], tokens = [], gbp = null }) {
  const out = [`【朝のまとめ ${md(today)}】`];
  // 1日1本の媒体は1本、枠の媒体は枠の数で数える。まだ時間の来ていない枠は「このあと」。
  let planned = 0;
  let ok = 0;
  let later = 0;
  for (const r of rows) {
    if (!r.status || r.status.state === 'none') continue;
    const s = r.status.slots;
    planned += s ? s.planned : 1;
    ok += s ? s.posted : r.status.state === 'posted' ? 1 : 0;
    later += s ? s.later : 0;
  }
  out.push(`今日の予定 ${planned}本 → 投稿済み ${ok}本${later ? `（このあと ${later}本）` : ''}`);

  let brand = null;
  for (const r of rows) {
    if (r.feed.brand !== brand) {
      brand = r.feed.brand;
      out.push('', `■${brand}`);
    }
    const s = r.status ? r.status.state : 'error';
    const until = r.status?.until ? `（承認済み〜${md(r.status.until)}）` : '';
    out.push(r.status?.slots ? `${ICON[s]} ${slotLine(r.feed, r.status)}${until}` : `${ICON[s]} ${r.feed.media} ${r.feed.time} ${LABEL[s]}${until}`);
  }
  if (gbp?.line) {
    const at = out.lastIndexOf(`■${gbp.brand}`);
    if (at < 0) out.push('', `■${gbp.brand}`, gbp.line);
    else {
      let end = at + 1;
      while (end < out.length && out[end] !== '') end++;
      out.splice(end, 0, gbp.line);
    }
  }

  const todo = [];
  const soon = addDays(today, 3);
  for (const r of rows) {
    if (r.status?.until && r.status.until <= soon && r.status.until >= today) todo.push(`・${r.feed.brand} ${r.feed.media}：承認済みが ${md(r.status.until)} で終わります`);
    const sl = r.status?.slots;
    if (sl && r.status.state === 'pending') {
      for (const x of sl.list.filter((y) => y.overdue)) todo.push(`・${r.feed.brand} ${r.feed.media}：${slotName(x)} ${hm(x.time)} の分が時間を過ぎても出ていません（遅れの可能性。失敗なら別に通知が来ます）`);
    } else if (r.status?.state === 'pending') todo.push(`・${r.feed.brand} ${r.feed.media}：予定の時間を過ぎても出ていません（遅れの可能性。失敗なら別に通知が来ます）`);
    else if (r.status?.state === 'stopped') todo.push(`・${r.feed.brand} ${r.feed.media}：今日の分が止まりました（再実行はしないで Claude に相談）`);
    if (sl && sl.list.some((y) => y.planned && !y.approved)) {
      const names = sl.list.filter((y) => y.planned && !y.approved).map((y) => `${slotName(y)} ${hm(y.time)}`);
      todo.push(`・${r.feed.brand} ${r.feed.media}：今日の分が未承認です（${names.join('、')}）`);
    } else if (r.status?.state === 'unapproved') todo.push(`・${r.feed.brand} ${r.feed.media}：今日の分が未承認です`);
    if (r.error) todo.push(`・${r.feed.brand} ${r.feed.media}：記録が読めませんでした（${r.error}）`);
  }
  if (gbp?.todo) todo.push(...gbp.todo);
  for (const f of failures) todo.push(`・失敗：${f.repo} / ${f.name}（再実行しないで Claude に相談）`);
  for (const t of tokens) {
    if (!t.expiresAt) continue;
    const days = Math.floor((new Date(t.expiresAt) - new Date(`${today}T00:00:00+09:00`)) / 86400000);
    if (days <= 14) todo.push(`・${t.label} の接続が ${days}日後（${md(jstDate(new Date(t.expiresAt)))}）に切れます`);
  }
  out.push('', todo.length ? '【要対応】' : '【要対応】なし');
  out.push(...todo);
  return out.join('\n');
}

const jstHm = (iso) => new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(11, 16).replace(/^0/, '');

// failures: 失敗した実行。missed: 時刻 + 猶予を過ぎても記録が無い投稿(lib/slots.mjs の missedPosts)。
// 枠(slot)の分は従来の「自動投稿の失敗」の文面。1日1本(legacy: true)の分は「⏰ まだ出ていません」の文面で、
// 同じ1通の後ろに付ける(失敗も枠の遅れも無ければ、⏰ の部分だけ)。
export function buildFailureAlert(failures, missed = []) {
  const slotMissed = missed.filter((m) => !m.legacy);
  const late = missed.filter((m) => m.legacy);
  const blocks = [];
  if (failures.length || slotMissed.length || !late.length) {
    const lines = ['【⚠️ 自動投稿の失敗】'];
    for (const f of failures) lines.push(`・${f.label ?? f.repo}：${f.name}${f.updatedAt ? `（${jstHm(f.updatedAt)}ごろ）` : ''}`, `  ${f.url}`);
    for (const m of slotMissed) lines.push(`・${m.brand} ${m.media}：${md(m.date)} ${slotName(m)} ${hm(m.time)} の分が、時間を過ぎても出ていません`);
    lines.push('', '再実行はしないでください（二重投稿の恐れ）。Claude に「失敗の通知が来た」と伝えてください。');
    blocks.push(lines.join('\n'));
  }
  if (late.length) blocks.push(buildLateAlert(late));
  return blocks.join('\n\n');
}

// 1日1本の投稿が「時刻 + 猶予」を過ぎても出ていないときの文面(やさしい日本語)。
export function buildLateAlert(late) {
  const lines = late.map((m) => `⏰ まだ出ていません：${m.brand} ${m.media} ${hm(m.time)}（予定から${m.graceMinutes ?? 30}分すぎ）`);
  const why = [];
  if (late.some((m) => !m.mac)) why.push('GitHub が起動しなかった可能性があります。');
  if (late.some((m) => m.mac)) why.push('Mac が動かなかった（スリープ・電源・ログイン切れ）可能性があります。');
  lines.push(...why, '自分で再実行はしないでください（二重投稿の恐れ）。Claude に『出ていない投稿がある』と伝えてください。');
  return lines.join('\n');
}
