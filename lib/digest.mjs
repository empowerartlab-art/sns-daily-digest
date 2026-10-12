// 朝のまとめと失敗通知の文面を作る。純粋な関数だけ(ネットワーク・ファイルに触らない)。

export const jstDate = (d = new Date()) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

// JSON の中の一覧を取り出す(配列そのもの、または { posts: [...] } のような形)。
export function listOf(json, key) {
  if (Array.isArray(json)) return json;
  if (json && key && Array.isArray(json[key])) return json[key];
  return [];
}

function dayOf(item, spec) {
  const v = item?.[spec.date];
  if (!v) return null;
  return spec.iso ? jstDate(new Date(v)) : String(v).slice(0, 10);
}

// 1つの媒体の、今日の状態と「承認済みがいつまでか」。
// planned に approved の指定が無いもの(Threads の draft-bank)は、入っている時点で承認済み。
export function feedStatus(feed, postedJson, plannedJson, today) {
  const posted = listOf(postedJson, feed.posted.list).filter((p) => dayOf(p, feed.posted) === today).length;
  const planned = listOf(plannedJson, feed.planned.list);
  const isApproved = (p) => !feed.planned.approved || p[feed.planned.approved] === true;
  const todays = planned.filter((p) => dayOf(p, feed.planned) === today);
  const approvedDates = planned.filter(isApproved).map((p) => dayOf(p, feed.planned)).filter((d) => d && d < '2099');
  const until = approvedDates.length ? approvedDates.sort().at(-1) : null;

  let state;
  if (posted > 0) state = 'posted';
  else if (todays.some(isApproved)) state = 'pending';
  else if (todays.length) state = 'unapproved';
  else state = 'none';
  return { posted, state, until };
}

const ICON = { posted: '✅', pending: '⚠️', unapproved: '⚠️', none: '・', error: '❓' };
const LABEL = { posted: '投稿済み', pending: '予定あり・まだ出ていない', unapproved: '予定はあるが未承認', none: '今日は予定なし', error: '確認できず' };

// rows: [{ feed, status | null, error? }], failures: [{ repo, name, url }], tokens: [{ label, expiresAt }]
export function buildDigest({ today, rows, failures = [], tokens = [] }) {
  const out = [`【朝のまとめ ${md(today)}】`];
  const counted = rows.filter((r) => r.status && r.status.state !== 'none');
  const ok = counted.filter((r) => r.status.state === 'posted').length;
  out.push(`今日の予定 ${counted.length}本 → 投稿済み ${ok}本`);

  let brand = null;
  for (const r of rows) {
    if (r.feed.brand !== brand) {
      brand = r.feed.brand;
      out.push('', `■${brand}`);
    }
    const s = r.status ? r.status.state : 'error';
    const until = r.status?.until ? `（承認済み〜${md(r.status.until)}）` : '';
    out.push(`${ICON[s]} ${r.feed.media} ${r.feed.time} ${LABEL[s]}${until}`);
  }

  const todo = [];
  const soon = addDays(today, 3);
  for (const r of rows) {
    if (r.status?.until && r.status.until <= soon && r.status.until >= today) todo.push(`・${r.feed.brand} ${r.feed.media}：承認済みが ${md(r.status.until)} で終わります`);
    if (r.status?.state === 'pending') todo.push(`・${r.feed.brand} ${r.feed.media}：予定の時間を過ぎても出ていません（遅れの可能性。失敗なら別に通知が来ます）`);
    if (r.status?.state === 'unapproved') todo.push(`・${r.feed.brand} ${r.feed.media}：今日の分が未承認です`);
    if (r.error) todo.push(`・${r.feed.brand} ${r.feed.media}：記録が読めませんでした（${r.error}）`);
  }
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

export function buildFailureAlert(failures) {
  const lines = ['【⚠️ 自動投稿の失敗】'];
  for (const f of failures) lines.push(`・${f.label ?? f.repo}：${f.name}`, `  ${f.url}`);
  lines.push('', '再実行はしないでください（二重投稿の恐れ）。Claude に「失敗の通知が来た」と伝えてください。');
  return lines.join('\n');
}
