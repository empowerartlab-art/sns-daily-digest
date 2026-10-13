import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dueKakeai, buildKakeaiMessage, kakeaiDigestLines, postLink } from '../lib/kakeai.mjs';

const source = {
  brand: 'ヘタ郎',
  media: {
    Threads: { posted: 'p1', link: 'https://www.threads.com/@hetarou.golf2026' },
    X: { posted: 'p2', postLink: 'https://x.com/Hetarougolf/status/{xId}', link: 'https://x.com/Hetarougolf' },
  },
};
const entries = [
  { date: '2026-10-14', media: 'Threads', from: 'ロストボールのThreads', text: 'よろしく' },
  { date: '2026-10-14', media: 'X', from: 'ロストボールのX', text: '池へ' },
  { date: '2026-10-15', media: 'Threads', from: 'ロストボールのThreads', text: 'まだ' },
];

test('前回の見回り以降に出た投稿の分だけ知らせる', () => {
  const postedByMedia = {
    Threads: [{ date: '2026-10-14', threadsId: '1', publishedAt: '2026-10-13T20:38:00.000Z' }],
    X: [{ date: '2026-10-14', xId: '99', publishedAt: '2026-10-13T21:14:00.000Z' }],
  };
  const at545 = dueKakeai({ source, entries, postedByMedia, since: '2026-10-13T19:45:00Z', now: '2026-10-13T20:45:00Z' });
  assert.deepEqual(at545.map((d) => d.media), ['Threads']);
  const at645 = dueKakeai({ source, entries, postedByMedia, since: '2026-10-13T20:45:00Z', now: '2026-10-13T21:45:00Z' });
  assert.deepEqual(at645.map((d) => d.media), ['X']);
  assert.equal(at645[0].url, 'https://x.com/Hetarougolf/status/99');
});

test('投稿がまだ・予定の無い媒体・記録に publishedAt が無いものは知らせない', () => {
  const postedByMedia = { Threads: [{ date: '2026-10-15' }], X: [] };
  assert.equal(dueKakeai({ source, entries, postedByMedia, since: '2026-10-13T00:00:00Z', now: '2026-10-20T00:00:00Z' }).length, 0);
  const unknown = [{ date: '2026-10-14', media: 'TikTok', from: 'x', text: 'y' }];
  assert.equal(dueKakeai({ source, entries: unknown, postedByMedia: {}, since: '2026-10-13T00:00:00Z', now: '2026-10-20T00:00:00Z' }).length, 0);
});

test('X の記録に xId が無ければプロフィールのリンク', () => {
  assert.equal(postLink(source.media.X, { date: '2026-10-14' }), 'https://x.com/Hetarougolf');
  assert.equal(postLink(source.media.Threads, { threadsId: '1' }), 'https://www.threads.com/@hetarou.golf2026');
});

test('LINE の文面にリンク・アカウント・コメント案が入る', () => {
  const text = buildKakeaiMessage({ brand: 'ヘタ郎', media: 'Threads', date: '2026-10-14', url: 'https://u', from: 'ロストボールのThreads', text: 'よろしく' });
  assert.match(text, /【掛け合い】ヘタ郎のThreadsが投稿されました（10\/14）/);
  assert.match(text, /https:\/\/u/);
  assert.match(text, /ロストボールのThreads/);
  assert.match(text, /よろしく/);
});

test('朝のまとめの「今日の掛け合い」', () => {
  assert.deepEqual(kakeaiDigestLines([]), []);
  const lines = kakeaiDigestLines([{ brand: 'ヘタ郎', media: 'X', from: 'ロストボールのX', text: '池へ', posted: false, url: '' }]);
  assert.equal(lines[1], '【今日の掛け合い】');
  assert.match(lines[2], /投稿待ち/);
});

test('feeds.json の kakeai 設定が読める形になっている', () => {
  const cfg = JSON.parse(readFileSync(new URL('../feeds.json', import.meta.url), 'utf8'));
  for (const k of cfg.kakeai ?? []) {
    assert.ok(k.repo && k.path && k.brand);
    for (const m of Object.values(k.media)) assert.ok(m.posted && m.link);
  }
});
