// Googleビジネスプロフィール（GBP）の投稿予約の見回り。純粋な関数だけ(ネットワーク・ファイルに触らない)。
// GBP は API が無く、本人が Google の画面で手で予約する。予約の記録は各リポジトリの data/gbp-schedule.json
// （days: [{ date, id, status: reserved | approved | draft, checkedAt }]、本文は書かない）。
// 毎週 土曜(遅くとも日曜)に「次の火〜月」の7本を確認・承認して予約する。

const addDays = (date, n) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=日 … 6=土
const hm = (time) => String(time).replace(/^0(\d)/, '$1');

// 今日より後で最初の火曜から7日間（火〜月）。
export function nextCycle(today) {
  let start = addDays(today, 1);
  while (weekday(start) !== 2) start = addDays(start, 1);
  return { start, end: addDays(start, 6) };
}

// schedule: gbp-schedule.json の中身(読めなければ null)。
// 戻り値: null(読めない・形が違う)、または
// { time, todayReserved, until, lastReserved, cycle: { start, end, total, reserved, approved }, approvedUnreserved }
export function gbpStatus(schedule, today) {
  if (!schedule || typeof schedule !== 'object' || !Array.isArray(schedule.days)) return null;
  const perDay = Number(schedule.perDay) > 0 ? Number(schedule.perDay) : 1;
  const byDate = new Map();
  for (const d of schedule.days) {
    if (!d || typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(d.date)) continue;
    const date = d.date.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(String(d.status ?? ''));
  }
  const reservedOn = (date) => (byDate.get(date) ?? []).filter((s) => s === 'reserved').length >= perDay;

  // 今日から途切れずに予約済みの最後の日（今日が未予約なら null）。
  let until = null;
  for (let d = today; reservedOn(d); d = addDays(d, 1)) until = d;
  const reservedDates = [...byDate.keys()].filter(reservedOn).sort();
  const lastReserved = reservedDates.at(-1) ?? null;

  const { start, end } = nextCycle(today);
  const cycle = { start, end, total: 7 * perDay, reserved: 0, approved: 0 };
  let approvedUnreserved = 0;
  for (const [date, statuses] of byDate) {
    if (date < today) continue;
    const approved = statuses.filter((s) => s === 'approved').length;
    approvedUnreserved += approved;
    if (date >= start && date <= end) {
      cycle.reserved += statuses.filter((s) => s === 'reserved').length;
      cycle.approved += approved;
    }
  }
  return { time: hm(schedule.postTime ?? '09:15'), todayReserved: reservedOn(today), until, lastReserved, cycle, approvedUnreserved };
}

// エンパワーの欄に載せる1行。
export function gbpLine(status, label = 'Googleビジネスプロフィール') {
  if (!status) return '❓ GBPの予約記録が読めません（未確認）';
  if (status.todayReserved) return `✅ ${label} ${status.time} 予約済み（〜${md(status.until)}）`;
  return `⚠️ ${label} ${status.time} 今日の分が未予約${status.lastReserved ? `（予約の記録は〜${md(status.lastReserved)}）` : ''}`;
}

// 【要対応】に載せる行(「・」付き)。
export function gbpTodo(status, today) {
  if (!status) return [];
  const out = [];
  const tomorrow = addDays(today, 1);
  const { cycle } = status;
  const range = `${md(cycle.start)}〜${md(cycle.end)}・${cycle.total}本`;

  if (!status.todayReserved) {
    out.push(`・⚠️ GBP：今日（${md(today)}）の分が予約されていません`);
  } else if (status.until <= tomorrow) {
    const next = addDays(status.until, 1);
    // 次の日が火曜 = 週の区切り（月曜で予約が終わる）なら「来週分」。
    const what = weekday(next) === 2 ? '来週分が未予約です' : `${md(next)}以降が未予約です`;
    const urgent = status.until === today ? '。明日の分がありません' : '';
    out.push(`・⚠️ GBPの予約が${md(status.until)}で終わります。${what}${urgent}`);
  }

  // 土曜・日曜: 次の火〜月がまだ全部予約済みでなければ、確認・承認の日を知らせる。
  const wd = weekday(today);
  if ((wd === 6 || wd === 0) && cycle.reserved < cycle.total) {
    const progress = cycle.reserved || cycle.approved ? `（承認済み ${cycle.approved + cycle.reserved}・予約済み ${cycle.reserved}/${cycle.total}）` : '';
    out.push(wd === 6
      ? `・📝 今日（または明日）はGBP来週分（${range}）の確認・承認日です${progress}`
      : `・📝 GBP来週分（${range}）の確認・承認、まだなら今日中に${progress}`);
  }

  if (status.approvedUnreserved > 0) out.push(`・GBP：承認済み・未予約 ${status.approvedUnreserved}本 → 予約してください`);
  return out;
}
