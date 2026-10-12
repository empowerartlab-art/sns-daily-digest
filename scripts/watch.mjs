// 1時間ごと: 前回の見回り以降に「失敗した実行」があれば、すぐに LINE で1通。無ければ何も送らない。
import { readFile } from 'node:fs/promises';
import { githubClient } from '../lib/github.mjs';
import { buildFailureAlert } from '../lib/digest.mjs';
import { pushLine } from '../lib/line.mjs';

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
