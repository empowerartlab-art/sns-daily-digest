import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dueMacAlerts, buildMacAlert, reasonText } from '../lib/macstatus.mjs';
import { feedStatus, buildDigest } from '../lib/digest.mjs';

const cfg = JSON.parse(readFileSync(new URL('../feeds.json', import.meta.url), 'utf8'));
const lit = cfg.feeds.find((f) => f.media === 'LITALICO');
const note = cfg.feeds.find((f) => f.media === 'note');
const root = fileURLToPath(new URL('..', import.meta.url));
const fixtures = fileURLToPath(new URL('./fixtures/macstatus', import.meta.url));

test('feeds.json: LITALICO 6:00 と note がエンパワーの欄にあり、macStatus で見回る', () => {
  assert.equal(lit.brand, 'エンパワー');
  assert.equal(lit.time, '6:00');
  assert.equal(note.brand, 'エンパワー');
  assert.equal(lit.posted.path, 'data/mac-status/litalico-posts.json');
  assert.deepEqual(cfg.macStatus.map((m) => m.label), ['LITALICO', 'note']);
});

test('止まった・エラーの記録だけ、since〜now の間のものを拾う', () => {
  const recs = [
    { date: '2026-10-16', status: 'stopped', reason: 'AUTH_REQUIRED', recordedAt: '2026-10-15T21:01:00Z' },
    { date: '2026-10-16', status: 'error', reason: 'claude-failed', recordedAt: '2026-10-15T21:30:00Z' },
    { date: '2026-10-16', status: 'published', reason: 'ok', recordedAt: '2026-10-15T21:02:00Z' },
    { date: '2026-10-15', status: 'skipped', reason: 'manual-post', recordedAt: '2026-10-15T21:03:00Z' },
    { date: '2026-10-14', status: 'stopped', reason: 'AUTH_REQUIRED', recordedAt: '2026-10-13T21:00:00Z' },
    { date: '2026-10-16', status: 'stopped', reason: 'x', recordedAt: '2026-10-15T21:45:00Z' }, // now ちょうどは次回
  ];
  const due = dueMacAlerts(recs, { since: '2026-10-15T20:45:00Z', now: '2026-10-15T21:45:00Z' });
  assert.deepEqual(due.map((r) => r.reason), ['AUTH_REQUIRED', 'claude-failed']);
  assert.deepEqual(dueMacAlerts(null, { since: '2026-10-15T20:45:00Z', now: '2026-10-15T21:45:00Z' }), []);
});

test('通知文: 日付・やさしい理由・再実行しない', () => {
  const text = buildMacAlert('LITALICO', { date: '2026-10-16', status: 'stopped', reason: 'AUTH_REQUIRED', detail: 'AUTH_REQUIRED' });
  assert.equal(text, '【⚠️ LITALICO の投稿が止まりました】\n日付：10/16　理由：ログイン切れ（AUTH_REQUIRED）\n対処：Claude に「LITALICOが止まった」と伝えてください（再実行はしないでください）');
  assert.match(reasonText({ reason: 'AUTH_REQUIRED', detail: 'UNKNOWN' }), /確認できず.*AUTH_REQUIRED\/UNKNOWN/);
  assert.equal(reasonText({ reason: 'manual-review-required' }), '前の停止が未解決（manual-review-required）');
  assert.equal(reasonText({ reason: 'already-attempted' }), '同じ日はもう試した（already-attempted）');
  assert.equal(reasonText({ reason: 'something-new' }), 'その他（something-new）');
  // 変な値は理由コードとして出さない
  assert.equal(reasonText({ reason: 'https://evil example' }), '不明（unknown）');
});

test('朝のまとめ: 公開・手動投稿(skipped)は投稿済み、止まったら「止まりました」、記録が無ければ「まだ出ていない」', () => {
  const planned = [{ date: '2026-10-15', approved: true }, { date: '2026-10-16', approved: true }, { date: '2026-10-20', approved: true }];
  const pub = [{ date: '2026-10-16', status: 'published' }];
  assert.equal(feedStatus(lit, pub, planned, '2026-10-16').state, 'posted');
  assert.equal(feedStatus(lit, [{ date: '2026-10-15', status: 'skipped' }], planned, '2026-10-15').state, 'posted');
  const stop = [{ date: '2026-10-16', status: 'stopped' }];
  assert.equal(feedStatus(lit, stop, planned, '2026-10-16').state, 'stopped');
  assert.equal(feedStatus(lit, [...stop, ...pub], planned, '2026-10-16').state, 'posted');
  const none = feedStatus(lit, [], planned, '2026-10-16');
  assert.equal(none.state, 'pending');
  assert.equal(none.until, '2026-10-20');
  assert.equal(feedStatus(lit, [], planned, '2026-10-17').state, 'none');

  const text = buildDigest({ today: '2026-10-16', rows: [
    { feed: lit, status: feedStatus(lit, stop, planned, '2026-10-16') },
    { feed: note, status: feedStatus(note, [], [{ date: '2026-10-16', approved: true }], '2026-10-16') },
  ] });
  assert.match(text, /⚠️ LITALICO 6:00 止まりました（承認済み〜10\/20）/);
  assert.match(text, /エンパワー LITALICO：今日の分が止まりました/);
  assert.match(text, /⚠️ note 5:55 予定あり・まだ出ていない/);
  assert.match(text, /エンパワー note：予定の時間を過ぎても出ていません/);
});

test('watch.mjs を手元の記録で動かす: 止まった1件だけ数え、ログに中身(タイトル・理由)を出さない', () => {
  const out = execFileSync('node', ['scripts/watch.mjs'], {
    cwd: root,
    env: { PATH: process.env.PATH, FIXTURES_DIR: fixtures, NOW: '2026-10-15T21:45:00Z', SINCE: '2026-10-15T20:45:00Z' },
    encoding: 'utf8',
  });
  assert.match(out, /mac LITALICO: 1 stops, 1 sent/);
  assert.match(out, /mac note: 0 stops, 0 sent/);
  assert.doesNotMatch(out, /T16|ログイン切れ|AUTH_REQUIRED/);
});
