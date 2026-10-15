// スタッフ用LINE（エンパワーだけ、broadcast）。朝8:00のまとめと、毎時の「止まりました」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { feedStatus } from '../lib/digest.mjs';
import { broadcastLine, STAFF_NO_TOKEN } from '../lib/line.mjs';
import { staffFeeds, staffFeedItem, staffGbpItem, buildStaffDigest, staffMacAlerts, staffRunAlerts } from '../lib/staff.mjs';

const cfg = JSON.parse(readFileSync(new URL('../feeds.json', import.meta.url), 'utf8'));
const root = fileURLToPath(new URL('..', import.meta.url));
const fixtures = fileURLToPath(new URL('./fixtures/staff', import.meta.url));
const feed = (media) => cfg.feeds.find((f) => f.brand === 'エンパワー' && f.media === media);
const lit = feed('LITALICO');
const note = feed('note');
const threads = feed('Threads');
const jst = (date, hm) => new Date(`${date}T${hm}:00+09:00`);
const item = (f, posted, planned, today, now) => {
  const opts = { now, graceMinutes: 30 };
  return staffFeedItem(f, feedStatus(f, posted, planned, today, opts), posted, today, opts);
};
const OTHER = ['ハーレー', 'ZERO RIDERS', 'ヘタ郎', 'ロストボール'];
const TECH = /GitHub|API|token|トークン|鍵|https?:|AUTH_REQUIRED|manual-post|[a-z]+-[a-z]+/;

test('feeds.json: staff はエンパワーだけ。まとめは note・LITALICO・Threads・GBP、ほかのブランドは入らない', () => {
  assert.equal(cfg.staff.brand, 'エンパワー');
  assert.deepEqual(cfg.staff.media, ['note', 'LITALICO', 'Threads', 'GBP']);
  const fs = staffFeeds(cfg);
  assert.deepEqual(fs.map((f) => f.media), ['note', 'LITALICO', 'Threads']);
  assert.ok(fs.every((f) => f.brand === 'エンパワー'));
  assert.equal(cfg.staff.gbp.path, 'data/gbp-schedule.json');
});

test('1日1本: 投稿済み（タイトル）・手動・止まった・まだ・予定なし・読めない', () => {
  const planned = [{ date: '2026-10-16', approved: true }];
  const at8 = jst('2026-10-16', '08:00');
  assert.deepEqual(item(note, [{ date: '2026-10-16', status: 'published', reason: 'ok', title: '春の作品展' }], planned, '2026-10-16', at8),
    { line: '✅ note 5:55 投稿済み「春の作品展」', problem: null });
  assert.equal(item(lit, [{ date: '2026-10-16', status: 'published', reason: 'manual-post', title: 'T' }], planned, '2026-10-16', at8).line, '✅ LITALICO 6:00 投稿済み（手動）「T」');
  assert.equal(item(lit, [{ date: '2026-10-16', status: 'skipped', reason: 'manual-post' }], planned, '2026-10-16', at8).line, '✅ LITALICO 6:00 投稿済み（手動）');
  const stop = item(lit, [{ date: '2026-10-16', status: 'stopped', reason: 'AUTH_REQUIRED', detail: 'AUTH_REQUIRED', title: 'T' }], planned, '2026-10-16', at8);
  assert.deepEqual(stop, { line: '⚠️ LITALICO 6:00 止まっています（ログイン切れ）', problem: 'LITALICO（ログイン切れ）' });
  const capt = item(lit, [{ date: '2026-10-16', status: 'stopped', reason: 'AUTH_REQUIRED', detail: 'CAPTCHA_BLOCKED' }], planned, '2026-10-16', at8);
  assert.equal(capt.problem, 'LITALICO（人間確認の画面が出た）');
  assert.deepEqual(item(note, [], planned, '2026-10-16', at8), { line: '⚠️ note 5:55 まだ投稿が確認できません', problem: 'note（まだ投稿が確認できません）' });
  assert.deepEqual(item(note, [], planned, '2026-10-16', jst('2026-10-16', '05:00')), { line: '⏳ note 5:55 の予定', problem: null });
  assert.deepEqual(item(note, [], [], '2026-10-16', at8), { line: '・note 今日は予定なし', problem: null });
  assert.deepEqual(staffFeedItem(note, null, [], '2026-10-16'), { line: '❓ note 確認できませんでした', problem: 'note（確認できませんでした）' });
});

test('Threads 1日3本: 時刻ごと（予定・投稿済み・まだ出ていない）、予定なし', () => {
  const planned = { items: ['morning', 'noon', 'night'].map((slot) => ({ targetDate: '2026-10-21', slot })) };
  assert.deepEqual(item(threads, { posts: [] }, planned, '2026-10-21', jst('2026-10-21', '08:00')),
    { line: '⏳ Threads 0/3（7:55・12:55・20:55 の予定）', problem: null });
  const one = { posts: [{ postedAt: '2026-10-20T22:56:00Z', slot: 'morning', targetDate: '2026-10-21' }] };
  assert.deepEqual(item(threads, one, planned, '2026-10-21', jst('2026-10-21', '09:00')),
    { line: '⏳ Threads 1/3（7:55 投稿済み・12:55 予定・20:55 予定）', problem: null });
  const late = item(threads, { posts: [] }, planned, '2026-10-21', jst('2026-10-21', '09:00'));
  assert.equal(late.line, '⚠️ Threads 0/3（7:55 まだ出ていません・12:55 予定・20:55 予定）');
  assert.equal(late.problem, 'Threads（7:55 の分がまだ出ていません）');
  assert.deepEqual(item(threads, { posts: [] }, { items: [] }, '2026-10-21', jst('2026-10-21', '08:00')), { line: '・Threads 今日は予定なし', problem: null });
  // 10/19 までは1日1本（5:00）
  const legacy = item(threads, { posts: [{ postedAt: '2026-10-18T20:01:00Z' }] }, { items: [{ targetDate: '2026-10-19' }] }, '2026-10-19', jst('2026-10-19', '08:00'));
  assert.equal(legacy.line, '✅ Threads 5:00 投稿済み');
});

test('GBP: 予約済み（確認できない旨）・未予約・読めない', () => {
  const sch = { postTime: '09:15', perDay: 1, days: [{ date: '2026-10-16', status: 'reserved' }] };
  assert.deepEqual(staffGbpItem(sch, '2026-10-16'), { line: '📅 Google ビジネスプロフィール：今日 9:15 に予約済み（手動予約のため、投稿の確認はできません）', problem: null });
  assert.match(staffGbpItem({ ...sch, days: [{ date: '2026-10-16', status: 'reserved', title: '見学会' }] }, '2026-10-16').line, /今日 9:15 の予定「見学会」/);
  assert.equal(staffGbpItem(sch, '2026-10-17').problem, 'Google ビジネスプロフィール（今日の分の予約が確認できません）');
  assert.equal(staffGbpItem(null, '2026-10-16').line, '❓ Google ビジネスプロフィール：今日の予定を確認できませんでした');
});

test('まとめ全体: 見出し・問題は「→ 代表が対応します」・問題なしの1行', () => {
  const text = buildStaffDigest({ brand: 'エンパワー', today: '2026-10-16', items: [
    { line: '✅ note 5:55 投稿済み「A」', problem: null },
    { line: '⚠️ LITALICO 6:00 止まっています（ログイン切れ）', problem: 'LITALICO（ログイン切れ）' },
  ] });
  assert.equal(text, '【エンパワー 今日の発信 10/16】\n✅ note 5:55 投稿済み「A」\n⚠️ LITALICO 6:00 止まっています（ログイン切れ）\n\n⚠️ 止まっているもの：LITALICO（ログイン切れ）→ 代表が対応します');
  assert.match(buildStaffDigest({ brand: 'エンパワー', today: '2026-10-16', items: [{ line: 'x', problem: null }] }), /止まっているものはありません$/);
});

test('毎時: Mac の止まった記録はエンパワーの LITALICO・note だけ、理由はやさしい日本語', () => {
  const rec = { date: '2026-10-16', status: 'stopped', reason: 'AUTH_REQUIRED', detail: 'AUTH_REQUIRED' };
  const out = staffMacAlerts(cfg, [
    { label: 'LITALICO', repo: 'threads-automation-empower', rec },
    { label: 'note', repo: 'threads-automation-empower', rec: { ...rec, reason: 'claude-failed', detail: undefined } },
    { label: 'LITALICO', repo: 'threads-hetaro', rec }, // ほかのリポジトリ
    { label: 'Instagram', repo: 'threads-automation-empower', rec }, // staff に無い媒体
  ]);
  assert.deepEqual(out, [
    '⚠️ エンパワーの【LITALICO】の投稿が止まりました（10/16・ログイン切れ）。代表が対応します。',
    '⚠️ エンパワーの【note】の投稿が止まりました（10/16・投稿の作業が3回とも失敗）。代表が対応します。',
  ]);
});

test('毎時: 失敗した実行はエンパワーの Threads・X の投稿だけ。ほかのブランド・ほかのワークフローは入らない', () => {
  const out = staffRunAlerts(cfg, [
    { repo: 'threads-automation-empower', name: 'Threads Daily Post', path: '.github/workflows/threads-daily-post.yml', updatedAt: '2026-10-15T23:00:00Z', url: 'https://github.com/a' },
    { repo: 'threads-automation-empower', name: 'Threads Daily Post', path: '.github/workflows/threads-daily-post.yml', updatedAt: '2026-10-15T23:05:00Z' }, // 同じ日は1通
    { repo: 'threads-automation-empower', name: 'X Post (Empower)', path: '.github/workflows/x-post.yml', updatedAt: '2026-10-15T23:10:00Z' },
    { repo: 'threads-automation-empower', name: 'Threads Auth Check', path: '.github/workflows/threads-auth-check.yml', updatedAt: '2026-10-15T23:10:00Z' },
    { repo: 'threads-hetaro', name: 'X', path: '.github/workflows/x-post.yml', updatedAt: '2026-10-15T23:10:00Z' },
    { repo: 'threads-zero-riders', name: '実行履歴が読めませんでした（HTTP 500）', url: '' },
  ]);
  assert.deepEqual(out, [
    '⚠️ エンパワーの【Threads】の投稿が止まりました（10/16）。代表が対応します。',
    '⚠️ エンパワーの【X】の投稿が止まりました（10/16）。代表が対応します。',
  ]);
  for (const t of out) assert.doesNotMatch(t, /github|http/i);
});

test('broadcast: 鍵が無ければ送らず、決まった1行だけ（中身は出さない）。運用者の鍵とは別', async () => {
  const logs = [];
  let called = false;
  const r = await broadcastLine({ text: 'ひみつの中身', token: '  ', fetchImpl: () => { called = true; }, log: (l) => logs.push(l) });
  assert.deepEqual(r, { sent: false });
  assert.equal(called, false);
  assert.deepEqual(logs, ['スタッフ用LINEの鍵が未設定のため送信しませんでした']);
  assert.equal(STAFF_NO_TOKEN, logs[0]);
});

test('broadcast: broadcast の宛先に、宛先IDなしで送る', async () => {
  let req;
  const r = await broadcastLine({ text: 'こんにちは', token: 'staff-token', fetchImpl: async (url, init) => { req = { url, init }; return { ok: true, status: 200 }; } });
  assert.deepEqual(r, { sent: true });
  assert.equal(req.url, 'https://api.line.me/v2/bot/message/broadcast');
  assert.equal(req.init.headers.Authorization, 'Bearer staff-token');
  assert.deepEqual(JSON.parse(req.init.body), { messages: [{ type: 'text', text: 'こんにちは' }] });
  await assert.rejects(broadcastLine({ text: 'x', token: 't', fetchImpl: async () => ({ ok: false, status: 401 }) }), /HTTP 401/);
});

test('staff-digest.mjs を手元の記録で: ほかのブランドが入らず、ログに中身・鍵を出さない', () => {
  const env = { PATH: process.env.PATH, FIXTURES_DIR: fixtures, NOW: '2026-10-15T23:00:00Z', LINE_CHANNEL_ACCESS_TOKEN: 'owner-secret', LINE_TO: 'Uowner' };
  const out = execFileSync('node', ['scripts/staff-digest.mjs'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(out, 'スタッフ用LINEの鍵が未設定のため送信しませんでした\nstaff-digest 2026-10-16: 4 lines, 1 problems, 0 unreadable, sent=false\n');
});

test('watch.mjs を手元の記録で: スタッフ向けはエンパワーの2件だけ数え、ログに中身を出さない', () => {
  const env = { PATH: process.env.PATH, FIXTURES_DIR: fixtures, NOW: '2026-10-15T21:45:00Z', SINCE: '2026-10-15T20:45:00Z' };
  const out = execFileSync('node', ['scripts/watch.mjs'], { cwd: root, env, encoding: 'utf8' });
  assert.match(out, /^スタッフ用LINEの鍵が未設定のため送信しませんでした$/m);
  assert.match(out, /^staff: 2 alerts, 0 sent, 0 send errors$/m);
  assert.doesNotMatch(out.split('\n').filter((l) => /staff|スタッフ/.test(l)).join('\n'), /ひみつ|ログイン切れ|エンパワーの/);
});

test('スタッフ向けの文面にほかのブランド・専門用語が入らない', () => {
  const planned = [{ date: '2026-10-16', approved: true }];
  const items = [
    item(note, [{ date: '2026-10-16', status: 'published', reason: 'manual-post', title: 'T' }], planned, '2026-10-16', jst('2026-10-16', '08:00')),
    item(lit, [{ date: '2026-10-16', status: 'stopped', reason: 'AUTH_REQUIRED', detail: 'UNKNOWN' }], planned, '2026-10-16', jst('2026-10-16', '08:00')),
    staffGbpItem(null, '2026-10-16'),
  ];
  const text = buildStaffDigest({ brand: cfg.staff.brand, today: '2026-10-16', items });
  for (const b of OTHER) assert.ok(!text.includes(b), b);
  assert.doesNotMatch(text, TECH);
  assert.equal(text.split('\n').filter((l) => l.startsWith('⚠️ 止まっているもの')).every((l) => l.endsWith('→ 代表が対応します')), true);
});
