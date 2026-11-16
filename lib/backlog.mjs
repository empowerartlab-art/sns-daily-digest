// 自動返信の「返事待ち」がたまったときの知らせ（2026-11-16 代表の依頼）。
// 各リポジトリの data/comment-autoreply.json の backlog { at, waiting }（自動返信が上限で次の回へ回した件数）を読む。
// 前回の見回り以降に書かれた backlog で、waiting が THRESHOLD 件以上なら LINE に1通。中身（コメント）は読まない・出さない。
export const BACKLOG_THRESHOLD = 20;

export function dueBacklogAlert(state, { since, now, threshold = BACKLOG_THRESHOLD }) {
  const b = state?.backlog;
  if (!b) return null;
  const at = Date.parse(b.at);
  const waiting = Number(b.waiting);
  if (!Number.isFinite(at) || !Number.isFinite(waiting) || waiting < threshold) return null;
  if (at <= Date.parse(since) || at > Date.parse(now)) return null; // この見回りの窓の分だけ（同じ記録で2回送らない）
  return { at: b.at, waiting };
}

export function buildBacklogMessage(brand, alert) {
  return [
    `【返信がたまっています】${brand}の Threads`,
    `自動返信の返事待ち：${alert.waiting}件`,
    '自動返信は1回8件・1日60件までなので、追いつくまで時間がかかります（48時間を過ぎたコメントには返しません）。',
    '急ぐものは、アプリで手で返してください。',
  ].join('\n');
}
