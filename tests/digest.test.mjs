import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { feedStatus, buildDigest, buildFailureAlert, listOf, jstDate } from '../lib/digest.mjs';

const xFeed = { brand: 'ロストボール', media: 'X', time: '5:53', posted: { path: 'p', date: 'date' }, planned: { path: 'q', date: 'date', approved: 'approved' } };
const thFeed = { brand: 'ハーレー', media: 'Threads', time: '5:00', posted: { path: 'p', list: 'posts', date: 'postedAt', iso: true }, planned: { path: 'q', list: 'items', date: 'targetDate' } };

test('JST の日付: UTC 20時台は翌日', () => {
  assert.equal(jstDate(new Date('2026-10-12T20:03:00Z')), '2026-10-13');
});

test('投稿済み / 予定あり・まだ / 未承認 / 予定なし を見分ける', () => {
  const q = [{ date: '2026-10-13', approved: true }, { date: '2026-10-14', approved: false }, { date: '2026-10-19', approved: true }];
  assert.equal(feedStatus(xFeed, [{ date: '2026-10-13' }], q, '2026-10-13').state, 'posted');
  assert.equal(feedStatus(xFeed, [], q, '2026-10-13').state, 'pending');
  assert.equal(feedStatus(xFeed, [], q, '2026-10-14').state, 'unapproved');
  assert.equal(feedStatus(xFeed, [], q, '2026-10-15').state, 'none');
  assert.equal(feedStatus(xFeed, [], q, '2026-10-13').until, '2026-10-19');
});

test('ISO 時刻の投稿記録と、{items:[...]} 形式の予定(2099年の保留は数えない)', () => {
  const s = feedStatus(thFeed, { posts: [{ postedAt: '2026-10-12T20:03:42Z' }] }, { items: [{ targetDate: '2026-10-19' }, { targetDate: '2099-01-01' }] }, '2026-10-13');
  assert.equal(s.state, 'posted');
  assert.equal(s.until, '2026-10-19');
});

test('まとめ文: 件数、要対応(承認切れ間近・失敗・接続期限)', () => {
  const rows = [
    { feed: xFeed, status: { state: 'posted', until: '2026-10-19' } },
    { feed: thFeed, status: { state: 'pending', until: '2026-10-14' } },
  ];
  const text = buildDigest({ today: '2026-10-13', rows, failures: [{ repo: 'r', name: 'X Post' }], tokens: [{ label: 'IG', expiresAt: '2026-10-20T00:00:00Z' }] });
  assert.match(text, /今日の予定 2本 → 投稿済み 1本/);
  assert.match(text, /承認済みが 10\/14 で終わります/);
  assert.match(text, /失敗：r \/ X Post/);
  assert.match(text, /IG の接続が/);
});

test('失敗通知には再実行しないよう書く', () => {
  assert.match(buildFailureAlert([{ repo: 'r', name: 'n', url: 'u' }]), /再実行はしないでください/);
});

test('feeds.json: 全媒体に repo / workflow / posted / planned がある', () => {
  const cfg = JSON.parse(readFileSync(new URL('../feeds.json', import.meta.url), 'utf8'));
  assert.ok(cfg.feeds.length >= 10);
  for (const f of cfg.feeds) assert.ok(f.repo && f.workflow && f.posted?.path && f.planned?.path, `${f.brand} ${f.media}`);
  assert.deepEqual(listOf({ posts: [1] }, 'posts'), [1]);
});

test('1日1本: 時刻 + 猶予の前（7:30 のまとめで Instagram 12:05）は「このあと投稿予定」、要対応に出さない', () => {
  const feed = { brand: 'ソーシャルライフ', media: 'Instagram', time: '12:05', posted: { date: 'date' }, planned: { date: 'date', approved: 'approved' } };
  const planned = [{ date: '2026-10-21', approved: true }];
  const early = feedStatus(feed, [], planned, '2026-10-21', { now: new Date('2026-10-21T07:30:00+09:00'), graceMinutes: 30 });
  assert.deepEqual([early.state, early.notYet], ['pending', true]); // スタッフ用は state を見て自分で時刻を比べる
  const text = buildDigest({ today: '2026-10-21', rows: [{ feed, status: early }] });
  assert.match(text, /✅ Instagram 12:05 このあと投稿予定/);
  assert.match(text, /今日の予定 1本 → 投稿済み 0本（このあと 1本）/);
  assert.doesNotMatch(text, /出ていません/);
  const late = feedStatus(feed, [], planned, '2026-10-21', { now: new Date('2026-10-21T12:36:00+09:00'), graceMinutes: 30 });
  assert.equal(late.notYet, undefined);
  assert.match(buildDigest({ today: '2026-10-21', rows: [{ feed, status: late }] }), /⚠️ Instagram 12:05 予定あり・まだ出ていない/);
});
