// スタッフ用LINE（エンパワーだけ）の文面を作る。純粋な関数だけ(ネットワーク・ファイルに触らない)。
// スタッフの役割は「知っておくだけ」。問題がある行は必ず「→ 代表が対応します」で終わる。
// 載せないもの: ほかのブランド、代表だけの情報（接続の期限・ほかのリポジトリの失敗・GitHub のリンク）、
// 専門用語（GitHub・API・鍵 など）、理由コード（英語）。
// 設定は feeds.json の staff（brand・media・alertMedia・gbp）。
import { listOf, dayOf, jstDate } from './digest.mjs';
import { slotDeadline, DEFAULT_GRACE_MINUTES } from './slots.mjs';
import { gbpStatus } from './gbp.mjs';
import { reasonPlain } from './macstatus.mjs';

export const STAFF_TAIL = '→ 代表が対応します';
const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const hm = (time) => String(time).replace(/^0(\d)/, '$1');

// 公開タイトルは1行・40文字まで。
export function cleanTitle(t) {
  const s = typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : '';
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

// まとめに載せる媒体（staff.media の順、staff.brand のものだけ）。
export function staffFeeds(cfg) {
  const s = cfg?.staff;
  if (!s) return [];
  const order = s.media ?? [];
  return (cfg.feeds ?? [])
    .filter((f) => f.brand === s.brand && order.includes(f.media))
    .sort((a, b) => order.indexOf(a.media) - order.indexOf(b.media));
}

// 1つの媒体の行。戻り値 { line, problem }（problem は「止まっているもの」に載せる短い文。無ければ null）。
// status: feedStatus の結果（読めなければ null）。postedJson: その媒体の記録（タイトル・理由を見るため）。
export function staffFeedItem(feed, status, postedJson, today, { now = new Date(), graceMinutes = DEFAULT_GRACE_MINUTES } = {}) {
  const m = feed.media;
  if (!status) return { line: `❓ ${m} 確認できませんでした`, problem: `${m}（確認できませんでした）` };

  const s = status.slots;
  if (s) {
    if (status.state === 'none') return { line: `・${m} 今日は予定なし`, problem: null };
    const overdue = s.list.filter((x) => x.overdue);
    const unapproved = s.list.filter((x) => x.planned && !x.approved);
    const simple = s.posted === 0 && !overdue.length && !unapproved.length && s.list.every((x) => x.planned);
    const icon = overdue.length || unapproved.length ? '⚠️' : s.posted >= s.planned ? '✅' : '⏳';
    const detail = simple
      ? `${s.list.map((x) => hm(x.time)).join('・')} の予定`
      : s.list.map((x) => `${hm(x.time)} ${x.posted ? '投稿済み' : !x.planned ? '予定なし' : x.overdue ? 'まだ出ていません' : !x.approved ? '準備中' : '予定'}`).join('・');
    const probs = [
      ...overdue.map((x) => `${hm(x.time)} の分がまだ出ていません`),
      ...unapproved.filter((x) => !x.overdue).map((x) => `${hm(x.time)} の分が準備中です`),
    ];
    return { line: `${icon} ${m} ${s.posted}/${s.planned}（${detail}）`, problem: probs.length ? `${m}（${probs.join('、')}）` : null };
  }

  const head = `${m} ${hm(feed.time)}`;
  const todays = listOf(postedJson, feed.posted.list).filter((p) => dayOf(p, feed.posted) === today);
  const statusIn = Array.isArray(feed.posted.statusIn) ? feed.posted.statusIn : null;
  switch (status.state) {
    case 'posted': {
      const ok = statusIn ? todays.filter((p) => statusIn.includes(p?.status)) : todays;
      const rec = ok.at(-1) ?? {};
      const manual = ok.some((p) => p?.reason === 'manual-post');
      const title = statusIn ? cleanTitle(rec.title) : '';
      return { line: `✅ ${head} 投稿済み${manual ? '（手動）' : ''}${title ? `「${title}」` : ''}`, problem: null };
    }
    case 'stopped': {
      const rec = todays.filter((p) => !statusIn?.includes(p?.status)).at(-1);
      const why = reasonPlain(rec);
      return { line: `⚠️ ${head} 止まっています（${why}）`, problem: `${m}（${why}）` };
    }
    case 'pending':
      if (now < slotDeadline(today, feed.time, graceMinutes)) return { line: `⏳ ${head} の予定`, problem: null };
      return { line: `⚠️ ${head} まだ投稿が確認できません`, problem: `${m}（まだ投稿が確認できません）` };
    case 'unapproved':
      return { line: `⚠️ ${head} 今日の分は準備中です`, problem: `${m}（今日の分が準備中です）` };
    default:
      return { line: `・${m} 今日は予定なし`, problem: null };
  }
}

// Googleビジネスプロフィール（手で予約。出たかどうかは確かめられない）。schedule: gbp-schedule.json（読めなければ null）。
export function staffGbpItem(schedule, today, label = 'Google ビジネスプロフィール') {
  let st = null;
  try {
    st = gbpStatus(schedule, today);
  } catch {
    st = null;
  }
  if (!st) return { line: `❓ ${label}：今日の予定を確認できませんでした`, problem: `${label}（予定を確認できませんでした）` };
  if (!st.todayReserved) return { line: `⚠️ ${label}：今日の分の予約が確認できません`, problem: `${label}（今日の分の予約が確認できません）` };
  const day = (schedule.days ?? []).find((d) => String(d?.date ?? '').slice(0, 10) === today && d?.status === 'reserved');
  const title = cleanTitle(day?.title);
  return { line: `📅 ${label}：今日 ${st.time} ${title ? `の予定「${title}」` : 'に予約済み'}（手動予約のため、投稿の確認はできません）`, problem: null };
}

// 朝のまとめ全体。items: [{ line, problem }]（並べたい順）。
export function buildStaffDigest({ brand, today, items }) {
  const out = [`【${brand} 今日の発信 ${md(today)}】`, ...items.map((i) => i.line), ''];
  const problems = items.map((i) => i.problem).filter(Boolean);
  if (problems.length) for (const p of problems) out.push(`⚠️ 止まっているもの：${p}${STAFF_TAIL}`);
  else out.push('止まっているものはありません');
  return out.join('\n');
}

// 毎時の見回り: Mac の記録（LITALICO・note）の「止まった・エラー」。macDue: [{ label, repo, rec }]（dueMacAlerts で拾った分）。
export function staffMacAlerts(cfg, macDue) {
  const s = cfg?.staff;
  if (!s) return [];
  const repos = new Set((cfg.feeds ?? []).filter((f) => f.brand === s.brand).map((f) => f.repo));
  return (macDue ?? [])
    .filter((d) => (s.alertMedia ?? []).includes(d.label) && repos.has(d.repo))
    .map((d) => `⚠️ ${s.brand}の【${d.label}】の投稿が止まりました（${md(d.rec.date)}・${reasonPlain(d.rec)}）。代表が対応します。`);
}

// 毎時の見回り: GitHub で動く投稿（Threads・X）の失敗。failures: failedRuns の結果（path = 実行したワークフローのファイル）。
// staff.brand の媒体の workflow と一致する失敗だけ。同じ媒体・同じ日は1通にまとめる。
export function staffRunAlerts(cfg, failures) {
  const s = cfg?.staff;
  if (!s) return [];
  const feeds = (cfg.feeds ?? []).filter((f) => f.brand === s.brand && (s.alertMedia ?? []).includes(f.media) && /\.ya?ml$/.test(f.workflow ?? ''));
  const out = [];
  for (const f of failures ?? []) {
    const file = String(f?.path ?? '').split('/').pop();
    const feed = file && feeds.find((x) => x.repo === f.repo && x.workflow === file);
    if (!feed) continue;
    const t = Date.parse(f.updatedAt);
    const date = Number.isFinite(t) ? `（${md(jstDate(new Date(t)))}）` : '';
    const text = `⚠️ ${s.brand}の【${feed.media}】の投稿が止まりました${date}。代表が対応します。`;
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

