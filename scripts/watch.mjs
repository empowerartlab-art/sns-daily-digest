// 1時間ごと: 前回の見回り以降に「失敗した実行」があれば、すぐに LINE で1通。無ければ何も送らない。
// あわせて、前回以降に出たキャラクターの投稿に「掛け合い」の予定があれば、媒体ごとに1通ずつ知らせる。
import { readFile } from 'node:fs/promises';
import { githubClient, fixtureClient } from '../lib/github.mjs';
import { buildFailureAlert } from '../lib/digest.mjs';
import { missedPosts, graceOf } from '../lib/slots.mjs';
import { pushLine } from '../lib/line.mjs';
import { dueKakeai, buildKakeaiMessage, dueReplies, buildReplyMessage } from '../lib/kakeai.mjs';
import { jstDate } from '../lib/digest.mjs';
import { runCommentAssist } from '../lib/comments.mjs';
import { dueMacAlerts, buildMacAlert } from '../lib/macstatus.mjs';
import { broadcastLine, STAFF_NO_TOKEN } from '../lib/line.mjs';
import { staffMacAlerts, staffRunAlerts } from '../lib/staff.mjs';

const cfg = JSON.parse(await readFile(new URL('../feeds.json', import.meta.url), 'utf8'));
// FIXTURES_DIR / NOW / SINCE: 手元のフォルダと時刻で試すとき用。
const gh = process.env.FIXTURES_DIR ? fixtureClient(process.env.FIXTURES_DIR) : githubClient({ token: process.env.GH_READ_TOKEN });
const self = process.env.FIXTURES_DIR ? gh : githubClient({ token: process.env.GITHUB_TOKEN });
const nowMs = process.env.NOW ? Date.parse(process.env.NOW) : Date.now();

let since = null;
try {
  since = await self.previousRunStart(process.env.GITHUB_REPOSITORY, 'watch.yml', process.env.GITHUB_RUN_ID);
} catch {
  // 初回など
}
since = (process.env.SINCE && new Date(process.env.SINCE).toISOString()) || since || new Date(nowMs - 65 * 60 * 1000).toISOString();

const labels = new Map(cfg.feeds.map((f) => [f.repo, f.brand]));
const failures = [];
for (const repo of [...new Set(cfg.feeds.map((f) => f.repo))]) {
  try {
    for (const f of await gh.failedRuns(cfg.owner, repo, since)) failures.push({ ...f, label: labels.get(repo) });
  } catch (err) {
    failures.push({ repo, label: labels.get(repo), name: `実行履歴が読めませんでした（${err.message}）`, url: '' });
  }
}

// 前回以降に「時刻 + 猶予」を過ぎたのに記録が無い投稿。枠(slots)の媒体は枠ごと、1日1本の日は feed.time で。
// どちらも承認済みの予定がある日だけ、1回だけ。後の枠・後の時刻は数えない(lib/slots.mjs の missedPosts)。
const now = new Date(nowMs).toISOString();
const missed = [];
for (const feed of cfg.feeds.filter((f) => (Array.isArray(f.slots) && f.slots.length) || f.time)) {
  try {
    const posted = await gh.readJson(cfg.owner, feed.repo, feed.posted.path, []);
    const planned = await gh.readJson(cfg.owner, feed.repo, feed.planned.path, []);
    missed.push(...missedPosts(feed, posted, planned, { since, now, graceMinutes: graceOf(feed, cfg) }));
  } catch (err) {
    console.log(`slots ${feed.brand} ${feed.media}: 読めませんでした（${err.message}）`);
  }
}
console.log(`watch since ${since}: ${failures.length} failures, ${missed.filter((m) => !m.legacy).length} missed slots, ${missed.filter((m) => m.legacy).length} late posts`);
if (failures.length || missed.length) await pushLine({ text: buildFailureAlert(failures, missed), token: process.env.LINE_CHANNEL_ACCESS_TOKEN, to: process.env.LINE_TO });

// Mac で動く投稿(LITALICO・note)。前回の見回り以降に「止まった・エラー」の記録が入っていれば、1件ずつ LINE に1通。
// GitHub の実行履歴には出ないので、Mac が data/mac-status/ に書く記録を読む。上の通知とは別で、ここで何が起きても止めない。
// ログは件数だけ(公開リポジトリ。タイトル・理由は出さない)。
const macDue = []; // スタッフ用LINE（下）でも使う
for (const source of cfg.macStatus ?? []) {
  try {
    const due = dueMacAlerts(await gh.readJson(cfg.owner, source.repo, source.path, []), { since, now });
    macDue.push(...due.map((rec) => ({ label: source.label, repo: source.repo, rec })));
    let sent = 0;
    for (const rec of due) {
      try {
        await pushLine({ text: buildMacAlert(source.label, rec), token: process.env.LINE_CHANNEL_ACCESS_TOKEN, to: process.env.LINE_TO, log: () => console.log(`mac ${source.label}: LINE の鍵が未設定のため送信しませんでした（中身は出しません）`) });
        sent++;
      } catch (err) {
        console.log(`mac ${source.label}: 送信に失敗しました（${err?.name ?? 'Error'}）`);
      }
    }
    console.log(`mac ${source.label}: ${due.length} stops, ${sent} sent`);
  } catch (err) {
    console.log(`mac ${source.label}: 読めませんでした（${err?.name ?? 'Error'}）`);
  }
}

// 掛け合いリマインド。失敗の見回りとは別に、読めなくても上の通知は止めない。ログにコメントの中身は出さない(公開リポジトリ)。
for (const source of cfg.kakeai ?? []) {
  try {
    const entries = await gh.readJson(cfg.owner, source.repo, source.path, []);
    const postedByMedia = {};
    for (const [media, m] of Object.entries(source.media)) postedByMedia[media] = await gh.readJson(cfg.owner, source.repo, m.posted, []);
    const due = dueKakeai({ source, entries, postedByMedia, since, now });
    for (const item of due) await pushLine({ text: buildKakeaiMessage(item), token: process.env.LINE_CHANNEL_ACCESS_TOKEN, to: process.env.LINE_TO });
    // 12時台（12:45 の見回り）だけ、②（キャラからの返し）の時間を知らせる。
    const jstHour = new Date(nowMs + 9 * 3600 * 1000).getUTCHours();
    const replies = jstHour === 12 ? dueReplies({ source, entries, postedByMedia, today: jstDate(new Date(nowMs)) }) : [];
    for (const item of replies) await pushLine({ text: buildReplyMessage(item), token: process.env.LINE_CHANNEL_ACCESS_TOKEN, to: process.env.LINE_TO });
    console.log(`kakeai ${source.brand}: ${due.length} reminders, ${replies.length} reply reminders`);
  } catch (err) {
    console.log(`kakeai ${source.brand}: 読めませんでした（${err.message}）`);
  }
}

// コメントの返信アシスト（lib/comments.mjs）。各リポジトリの暗号化されたコメントを読み、返信案つきで LINE に1件ずつ。
// 上の失敗の見回り・掛け合いとは別。ここで何が起きても上の通知は止めない。ログは件数だけ(公開リポジトリ)。
try {
  const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const lineTo = process.env.LINE_TO;
  const stats = await runCommentAssist({
    cfg,
    gh,
    since,
    now,
    privateKeyPem: process.env.INBOX_PRIVATE_KEY,
    geminiKey: (process.env.GEMINI_API_KEY ?? '').trim(),
    model: (process.env.GEMINI_MODEL ?? '').trim() || undefined,
    // 鍵が無いときも中身はログに出さない（pushLine の dry-run 表示を使わない）。
    push: (text) => pushLine({ text, token: lineToken, to: lineTo, log: () => console.log('comments: LINE の鍵が未設定のため送信しませんでした（中身は出しません）') }),
  });
  console.log(`comments: ${stats.sent} sent, ${stats.queued} queued, ${stats.dropped} dropped, ${stats.unreadable} unreadable, ${stats.aiErrors} ai errors, ${stats.sendErrors} send errors`);
} catch (err) {
  console.log(`comments: 途中で止まりました（${err?.name ?? 'Error'}）`);
}

// スタッフ用LINE（エンパワーだけ、友だち全員に broadcast）。上で見つけた「Mac の止まった記録」と「失敗した実行」のうち、
// feeds.json の staff の媒体の分だけを1件ずつ。運用者本人用の鍵は使わない。ここで何が起きても上の通知には影響しない。
// ログは件数だけ（中身は出さない）。
try {
  const texts = [...staffMacAlerts(cfg, macDue), ...staffRunAlerts(cfg, failures)];
  let sent = 0;
  let noToken = false;
  let sendErrors = 0;
  for (const text of texts) {
    try {
      const r = await broadcastLine({ text, token: process.env.STAFF_LINE_CHANNEL_ACCESS_TOKEN, log: () => { noToken = true; } });
      if (r.sent) sent++;
    } catch {
      sendErrors++;
    }
  }
  if (noToken) console.log(STAFF_NO_TOKEN);
  console.log(`staff: ${texts.length} alerts, ${sent} sent, ${sendErrors} send errors`);
} catch (err) {
  console.log(`staff: 途中で止まりました（${err?.name ?? 'Error'}）`);
}
