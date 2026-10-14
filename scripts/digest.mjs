// 毎朝7:30: 全アカウント・全媒体の「今日の投稿」をまとめて LINE に1通。読むだけ。
// ログは公開されるので、鍵の値は出さない(投稿の中身も出さない)。
import { readFile } from 'node:fs/promises';
import { githubClient, fixtureClient } from '../lib/github.mjs';
import { feedStatus, buildDigest, jstDate } from '../lib/digest.mjs';
import { pushLine } from '../lib/line.mjs';
import { graceOf } from '../lib/slots.mjs';
import { postLink, kakeaiDigestLines, kakeaiRecord } from '../lib/kakeai.mjs';

const cfg = JSON.parse(await readFile(new URL('../feeds.json', import.meta.url), 'utf8'));
// FIXTURES_DIR: 手元のフォルダを GitHub の代わりに読む(試し用)。NOW: いまの時刻(ISO、試し用)。
const gh = process.env.FIXTURES_DIR ? fixtureClient(process.env.FIXTURES_DIR) : githubClient({ token: process.env.GH_READ_TOKEN });
const now = process.env.NOW ? new Date(process.env.NOW) : new Date();
const today = process.env.TARGET_DATE || jstDate(now);

const cache = new Map();
const read = (repo, path) => {
  const k = `${repo}/${path}`;
  if (!cache.has(k)) cache.set(k, gh.readJson(cfg.owner, repo, path, []));
  return cache.get(k);
};

const rows = [];
for (const feed of cfg.feeds) {
  try {
    rows.push({ feed, status: feedStatus(feed, await read(feed.repo, feed.posted.path), await read(feed.repo, feed.planned.path), today, { now, graceMinutes: graceOf(feed, cfg) }) });
  } catch (err) {
    rows.push({ feed, status: null, error: err.message });
  }
}

const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
const failures = [];
for (const repo of [...new Set(cfg.feeds.map((f) => f.repo))]) {
  try {
    failures.push(...(await gh.failedRuns(cfg.owner, repo, since)));
  } catch (err) {
    failures.push({ repo, name: `実行履歴が読めませんでした（${err.message}）` });
  }
}

const tokens = [];
for (const t of cfg.tokens) {
  try {
    tokens.push({ label: t.label, expiresAt: (await read(t.repo, t.path))?.[t.field] ?? null });
  } catch {
    // 読めなくてもまとめは送る
  }
}

// 今日の掛け合い（予定と、投稿が出ていればそのリンク）。読めなくてもまとめは送る。
const kakeai = [];
for (const source of cfg.kakeai ?? []) {
  try {
    for (const e of await read(source.repo, source.path)) {
      const m = source.media?.[e.media];
      if (e.date !== today || !m) continue;
      const record = kakeaiRecord(await read(source.repo, m.posted), e);
      kakeai.push({ ...e, brand: source.brand, posted: Boolean(record), url: record ? postLink(m, record) : '' });
    }
  } catch {
    // 読めなくてもまとめは送る
  }
}

const text = buildDigest({ today, rows, failures, tokens }) + kakeaiDigestLines(kakeai).map((l) => `\n${l}`).join('');
await pushLine({ text, token: process.env.LINE_CHANNEL_ACCESS_TOKEN, to: process.env.LINE_TO });
console.log(`digest ${today}: ${rows.length} feeds, ${failures.length} failures`);
