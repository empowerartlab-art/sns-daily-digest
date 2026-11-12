// ZERO RIDERS・ヘタ郎・ハーレーの note(2026-11-12〜、Mac の毎朝 6:25／6:40／6:55)の見回り。
// 結果の記録は Mac の report_status.py が、ブランドごとのリポジトリの data/mac-status/note-*.json に書く。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildMacAlert, reasonText } from '../lib/macstatus.mjs';
import { feedStatus, buildDigest } from '../lib/digest.mjs';
import { staffMacAlerts } from '../lib/staff.mjs';

const cfg = JSON.parse(readFileSync(new URL('../feeds.json', import.meta.url), 'utf8'));
const root = fileURLToPath(new URL('..', import.meta.url));
const fixtures = fileURLToPath(new URL('./fixtures/brand-notes', import.meta.url));

const BRANDS = [
  { brand: 'ZERO RIDERS', label: 'ZERO RIDERS note', repo: 'threads-zero-riders', time: '6:25', job: 'com.artlab.zero-riders-note-daily' },
  { brand: 'ヘタ郎', label: 'ヘタ郎 note', repo: 'threads-hetaro', time: '6:40', job: 'com.artlab.hetaro-note-daily' },
  { brand: 'ハーレー', label: 'ハーレー note', repo: 'threads-harley-solo', time: '6:55', job: 'com.artlab.harley-note-daily' },
];
const feedOf = (b) => cfg.feeds.find((f) => f.brand === b.brand && f.media === 'note');

test('feeds.json: 3つの note は自分のブランドのリポジトリの記録を読み、エンパワーの note とは混ぜない', () => {
  for (const b of BRANDS) {
    const feed = feedOf(b);
    assert.ok(feed, `${b.brand} の note が feeds にある`);
    assert.deepEqual([feed.repo, feed.time, feed.workflow], [b.repo, b.time, `(Mac) ${b.job}`]);
    assert.equal(feed.posted.path, 'data/mac-status/note-posts.json');
    assert.equal(feed.planned.path, 'data/mac-status/note-planned.json');
    assert.deepEqual(feed.posted.statusIn, ['published', 'skipped']);
    const mac = cfg.macStatus.find((m) => m.label === b.label);
    assert.ok(mac, `${b.label} が macStatus にある`);
    assert.deepEqual([mac.repo, mac.path], [b.repo, 'data/mac-status/note-posts.json']);
  }
  assert.equal(cfg.feeds.find((f) => f.brand === 'エンパワー' && f.media === 'note').repo, 'threads-automation-empower');
});

test('feeds.json: 同じブランドの行は続けて並んでいる（朝のまとめの見出しが二重にならない）', () => {
  const seen = [];
  for (const f of cfg.feeds) if (seen[seen.length - 1] !== f.brand) seen.push(f.brand);
  assert.equal(new Set(seen).size, seen.length, `見出しが重なる並び: ${seen.join(' / ')}`);
});

test('止まった通知の文面: 3つとも「◯◯ note」の名前で、再実行しないよう案内する。理由コードは全部やさしい日本語', () => {
  for (const b of BRANDS) {
    const text = buildMacAlert(b.label, { date: '2026-11-13', status: 'error', reason: 'claude-failed' });
    assert.equal(text, [
      `【⚠️ ${b.label} の投稿が止まりました】`,
      '日付：11/13　理由：投稿の作業が3回とも失敗（claude-failed）',
      `対処：Claude に「${b.label}が止まった」と伝えてください（再実行はしないでください）`,
    ].join('\n'));
  }
  // run-daily.sh と report_status.py が書く理由コード。「その他」になるものがあれば日本語を足す。
  for (const code of ['hash-mismatch', 'not-approved-status', 'missing-approved-by', 'missing-approved-at', 'already-published',
    'claude-failed', 'not-marked-published', 'extract-failed']) {
    assert.doesNotMatch(reasonText({ reason: code }), /その他/, code);
  }
});

test('スタッフ用LINEには、ほかのブランドの note の失敗は流れない（エンパワーの note は今までどおり）', () => {
  const rec = { date: '2026-11-13', status: 'error', reason: 'claude-failed' };
  assert.deepEqual(staffMacAlerts(cfg, BRANDS.map((b) => ({ label: b.label, repo: b.repo, rec }))), []);
  assert.equal(staffMacAlerts(cfg, [{ label: 'note', repo: 'threads-automation-empower', rec }]).length, 1);
});

test('朝のまとめ: 承認済みで記録が無ければ「予定あり・まだ出ていない」、公開済みなら投稿済み、止まったら止まりました、承認が無い日は何も出さない', () => {
  const planned = [{ date: '2026-11-13', approved: true }, { date: '2026-11-14', approved: true }];
  for (const b of BRANDS) {
    const f = feedOf(b);
    assert.equal(feedStatus(f, [], planned, '2026-11-13').state, 'pending', b.brand);
    assert.equal(feedStatus(f, [{ date: '2026-11-13', status: 'published' }], planned, '2026-11-13').state, 'posted', b.brand);
    assert.equal(feedStatus(f, [{ date: '2026-11-13', status: 'error' }], planned, '2026-11-13').state, 'stopped', b.brand);
    assert.equal(feedStatus(f, [], planned, '2026-11-24').state, 'none', b.brand);
  }
  const rows = BRANDS.map((b) => ({ feed: feedOf(b), status: feedStatus(feedOf(b), [], planned, '2026-11-13') }));
  const text = buildDigest({ today: '2026-11-13', rows });
  for (const b of BRANDS) assert.match(text, new RegExp(`⚠️ note ${b.time} 予定あり・まだ出ていない`), b.brand);
  assert.match(text, /ハーレー note：予定の時間を過ぎても出ていません/);
});

test('watch.mjs を手元の記録で動かす: 失敗(ZERO)と停止(ヘタ郎)を1件ずつ数え、動かなかった日(ハーレー)を知らせる。理由コードはログに出さない', () => {
  const out = execFileSync('node', ['scripts/watch.mjs'], {
    cwd: root,
    // 2026-11-13 の 6:45〜7:45（JST）の見回り。ZERO は 6:58 にエラー、ヘタ郎は 6:50 に停止、ハーレーは記録なし（6:55 + 30分 = 7:25 を過ぎた）
    env: { PATH: process.env.PATH, FIXTURES_DIR: fixtures, NOW: '2026-11-12T22:45:00Z', SINCE: '2026-11-12T21:45:00Z' },
    encoding: 'utf8',
  });
  assert.match(out, /mac ZERO RIDERS note: 1 stops, 1 sent/);
  assert.match(out, /mac ヘタ郎 note: 1 stops, 1 sent/);
  assert.match(out, /mac ハーレー note: 0 stops, 0 sent/);
  assert.match(out, /1 late posts/);
  assert.match(out, /まだ出ていません：ハーレー note 6:55（予定から30分すぎ）/);
  assert.match(out, /Mac が動かなかった/);
  assert.doesNotMatch(out, /claude-failed|hash-mismatch/);
  assert.match(out, /staff: 0 alerts/);
});

test('watch.mjs: 承認済みの予定が無い日は、記録が無くても知らせない', () => {
  const out = execFileSync('node', ['scripts/watch.mjs'], {
    cwd: root,
    // 2026-11-24 の 6:45〜7:45（予定は 11/13・11/14 だけ）
    env: { PATH: process.env.PATH, FIXTURES_DIR: fixtures, NOW: '2026-11-23T22:45:00Z', SINCE: '2026-11-23T21:45:00Z' },
    encoding: 'utf8',
  });
  assert.match(out, /0 late posts/);
  assert.doesNotMatch(out, /まだ出ていません/);
});
