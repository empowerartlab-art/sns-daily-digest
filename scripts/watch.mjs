// 1時間ごと: 前回の見回り以降に「失敗した実行」があれば、すぐに LINE で1通。無ければ何も送らない。
// あわせて、前回以降に出たキャラクターの投稿に「掛け合い」の予定があれば、媒体ごとに1通ずつ知らせる。
import { readFile } from 'node:fs/promises';
import { githubClient } from '../lib/github.mjs';
import { buildFailureAlert } from '../lib/digest.mjs';
import { pushLine } from '../lib/line.mjs';
import { dueKakeai, buildKakeaiMessage } from '../lib/kakeai.mjs';

const cfg = JSON.parse(await readFile(new URL('../feeds.json', import.meta.url), 'utf8'));
const gh = githubClient({ token: process.env.GH_READ_TOKEN });
const self = githubClient({ token: process.env.GITHUB_TOKEN });

let since = null;
try {
  since = await self.previousRunStart(process.env.GITHUB_REPOSITORY, 'watch.yml', process.env.GITHUB_RUN_ID);
} catch {
  // 初回など
}
since ??= new Date(Date.now() - 65 * 60 * 1000).toISOString();

const labels = new Map(cfg.feeds.map((f) => [f.repo, f.brand]));
const failures = [];
for (const repo of [...new Set(cfg.feeds.map((f) => f.repo))]) {
  try {
    for (const f of await gh.failedRuns(cfg.owner, repo, since)) failures.push({ ...f, label: labels.get(repo) });
  } catch (err) {
    failures.push({ repo, label: labels.get(repo), name: `実行履歴が読めませんでした（${err.message}）`, url: '' });
  }
}
console.log(`watch since ${since}: ${failures.length} failures`);
if (failures.length) await pushLine({ text: buildFailureAlert(failures), token: process.env.LINE_CHANNEL_ACCESS_TOKEN, to: process.env.LINE_TO });

// 掛け合いリマインド。失敗の見回りとは別に、読めなくても上の通知は止めない。ログにコメントの中身は出さない(公開リポジトリ)。
const now = new Date().toISOString();
for (const source of cfg.kakeai ?? []) {
  try {
    const entries = await gh.readJson(cfg.owner, source.repo, source.path, []);
    const postedByMedia = {};
    for (const [media, m] of Object.entries(source.media)) postedByMedia[media] = await gh.readJson(cfg.owner, source.repo, m.posted, []);
    const due = dueKakeai({ source, entries, postedByMedia, since, now });
    for (const item of due) await pushLine({ text: buildKakeaiMessage(item), token: process.env.LINE_CHANNEL_ACCESS_TOKEN, to: process.env.LINE_TO });
    console.log(`kakeai ${source.brand}: ${due.length} reminders`);
  } catch (err) {
    console.log(`kakeai ${source.brand}: 読めませんでした（${err.message}）`);
  }
}
