// X 5アカウントとエンパワー Threads の1日3本（2026-10-20〜）。
// X: x-queue.json / x-posts.json の項目は date と slot（旧1日1本は slot なし）。
// エンパワー Threads: draft-bank.json の items は targetDate と slot、threads-posts.json の posts は postedAt(ISO) と slot / targetDate（旧は null）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { feedStatus, buildDigest, buildFailureAlert } from '../lib/digest.mjs';
import { missedSlots } from '../lib/slots.mjs';
import { dueKakeai, dueReplies } from '../lib/kakeai.mjs';

const cfg = JSON.parse(readFileSync(new URL('../feeds.json', import.meta.url), 'utf8'));
const FIX = fileURLToPath(new URL('./fixtures/slots', import.meta.url));
const fx = (repo, path) => JSON.parse(readFileSync(`${FIX}/${repo}/${path}`, 'utf8'));
const feed = (brand, media) => cfg.feeds.find((f) => f.brand === brand && f.media === media);
const jst = (date, hm) => new Date(`${date}T${hm}:00+09:00`);
const opt = (date, hm) => ({ now: jst(date, hm), graceMinutes: 30 });

const hx = feed('ハーレー', 'X');
const HX = { posted: fx('threads-harley-solo', 'data/x-posts.json'), planned: fx('threads-harley-solo', 'data/x-queue.json') };
const et = feed('エンパワー', 'Threads');
const ET = { posted: fx('threads-automation-empower', 'data/threads-posts.json'), planned: fx('threads-automation-empower', 'data/draft-bank.json') };

test('feeds.json: X 5アカウントは3枠、時刻は各リポジトリの X の枠と同じ。旧1日1本の時刻も残す', () => {
  const want = {
    ハーレー: ['6:50', '11:50', '19:50', '5:23'],
    ロストボール: ['7:10', '12:10', '20:10', '5:53'],
    'ZERO RIDERS': ['7:30', '12:30', '20:30', '6:23'],
    ヘタ郎: ['7:50', '12:50', '20:50', '6:13'],
    エンパワー: ['8:10', '13:10', '21:10', '6:43'],
  };
  for (const [brand, times] of Object.entries(want)) {
    const f = feed(brand, 'X');
    assert.deepEqual([...f.slots.map((s) => s.time), f.time], times, brand);
    assert.deepEqual(f.slots.map((s) => s.slot), ['morning', 'noon', 'night']);
    assert.equal(f.slotsFrom, '2026-10-20');
    assert.equal(f.workflow, 'x-post.yml');
    assert.deepEqual([f.posted.date, f.planned.date, f.planned.approved], ['date', 'date', 'approved']);
  }
});

test('feeds.json: エンパワー Threads は 7:55・12:55・20:55（旧 5:00）、記録の targetDate を日付に使う', () => {
  assert.deepEqual(et.slots.map((s) => `${s.slot}/${s.time}`), ['morning/7:55', 'noon/12:55', 'night/20:55']);
  assert.equal(et.time, '5:00');
  assert.equal(et.slotsFrom, '2026-10-20');
  assert.equal(et.workflow, 'threads-daily-post.yml');
  assert.deepEqual([et.posted.date, et.posted.iso, et.posted.dayField, et.planned.date], ['postedAt', true, 'targetDate', 'targetDate']);
});

test('ハーレー X: 朝 7:30 は 3本（6:50・11:50・19:50） 承認済み 3/3・1/3 投稿済み', () => {
  const s = feedStatus(hx, HX.posted, HX.planned, '2026-10-21', opt('2026-10-21', '07:30'));
  assert.equal(s.state, 'scheduled');
  assert.deepEqual([s.slots.planned, s.slots.approved, s.slots.posted, s.slots.later], [3, 3, 1, 2]);
  const text = buildDigest({ today: '2026-10-21', rows: [{ feed: hx, status: s }] });
  assert.match(text, /✅ X 3本（6:50・11:50・19:50） 承認済み 3\/3・1\/3 投稿済み/);
  assert.match(text, /今日の予定 3本 → 投稿済み 1本（このあと 2本）/);
});

test('ハーレー X: 10/19 は旧1日1本の表示（X 5:23）', () => {
  const s = feedStatus(hx, HX.posted, HX.planned, '2026-10-19', opt('2026-10-19', '07:30'));
  assert.equal(s.slots, undefined);
  assert.match(buildDigest({ today: '2026-10-19', rows: [{ feed: hx, status: s }] }), /✅ X 5:23 投稿済み/);
});

test('ハーレー X: 未承認の枠と、時刻+猶予を過ぎた枠', () => {
  const u = feedStatus(hx, HX.posted, HX.planned, '2026-10-22', opt('2026-10-22', '06:00'));
  assert.equal(u.state, 'unapproved');
  assert.match(buildDigest({ today: '2026-10-22', rows: [{ feed: hx, status: u }] }), /ハーレー X：今日の分が未承認です（夜 19:50）/);
  const late = feedStatus(hx, HX.posted, HX.planned, '2026-10-21', opt('2026-10-21', '12:21'));
  assert.equal(late.state, 'pending');
  assert.match(buildDigest({ today: '2026-10-21', rows: [{ feed: hx, status: late }] }), /ハーレー X：昼 11:50 の分が時間を過ぎても出ていません/);
  assert.equal(feedStatus(hx, HX.posted, HX.planned, '2026-10-21', opt('2026-10-21', '12:19')).state, 'scheduled', '11:50 + 30分 まではまだ');
});

test('ハーレー X: 見回りは枠ごとに1回だけ（30分の猶予）', () => {
  const run = (since, now, posted = HX.posted) =>
    missedSlots(hx, posted, HX.planned, { since: jst('2026-10-21', since).toISOString(), now: jst('2026-10-21', now).toISOString(), graceMinutes: 30 }).map((m) => m.slot);
  assert.deepEqual(run('06:45', '07:45'), [], '朝は記録あり');
  assert.deepEqual(run('06:45', '07:45', []), ['morning'], '6:50 + 30分 = 7:20');
  assert.deepEqual(run('11:45', '12:15'), [], '12:20 より前は数えない');
  assert.deepEqual(run('11:45', '12:45'), ['noon']);
  assert.deepEqual(run('12:45', '13:45'), [], 'くり返さない');
  assert.deepEqual(run('19:45', '20:45'), ['night']);
  const noonPosted = [...HX.posted, { id: 'hx-1021-n', date: '2026-10-21', slot: 'noon', xId: '102', publishedAt: '2026-10-21T02:51:00.000Z' }];
  assert.deepEqual(run('11:45', '12:45', noonPosted), []);
  // 旧1日1本の日(10/19)は枠では数えない
  assert.deepEqual(missedSlots(hx, [], HX.planned, { since: jst('2026-10-19', '00:00').toISOString(), now: jst('2026-10-19', '23:59').toISOString(), graceMinutes: 30 }), []);
  const text = buildFailureAlert([], missedSlots(hx, HX.posted, HX.planned, { since: jst('2026-10-21', '11:45').toISOString(), now: jst('2026-10-21', '12:45').toISOString(), graceMinutes: 30 }));
  assert.match(text, /・ハーレー X：10\/21 昼 11:50 の分が、時間を過ぎても出ていません/);
});

test('エンパワー Threads: 朝 7:30 は 0/3（7:55 前）、10/19 は旧表示（Threads 5:00）', () => {
  const s = feedStatus(et, ET.posted, ET.planned, '2026-10-21', opt('2026-10-21', '07:30'));
  assert.equal(s.state, 'scheduled');
  assert.deepEqual([s.slots.planned, s.slots.approved, s.slots.posted, s.slots.later], [3, 3, 0, 3]);
  assert.match(buildDigest({ today: '2026-10-21', rows: [{ feed: et, status: s }] }), /✅ Threads 3本（7:55・12:55・20:55） 承認済み 3\/3・0\/3 投稿済み/);
  const legacy = feedStatus(et, ET.posted, ET.planned, '2026-10-19', opt('2026-10-19', '07:30'));
  assert.equal(legacy.slots, undefined);
  assert.match(buildDigest({ today: '2026-10-19', rows: [{ feed: et, status: legacy }] }), /✅ Threads 5:00 投稿済み/);
});

test('エンパワー Threads: 記録の slot / targetDate で数え、夜が0時を過ぎても targetDate の日の分', () => {
  const posts = [
    ...ET.posted.posts,
    { id: 'm', postedAt: '2026-10-20T22:56:00.000Z', slot: 'morning', targetDate: '2026-10-21' },
    { id: 'n', postedAt: '2026-10-21T03:56:00.000Z', slot: 'noon', targetDate: '2026-10-21' },
    { id: 'e', postedAt: '2026-10-21T15:05:00.000Z', slot: 'night', targetDate: '2026-10-21' }, // JST 10/22 0:05
  ];
  const s = feedStatus(et, { posts }, ET.planned, '2026-10-21', opt('2026-10-22', '00:10'));
  assert.equal(s.state, 'posted');
  assert.equal(s.slots.posted, 3);
  const missed = (since, now, p) => missedSlots(et, { posts: p }, ET.planned, { since: jst('2026-10-21', since).toISOString(), now: jst('2026-10-21', now).toISOString(), graceMinutes: 30 }).map((m) => m.slot);
  assert.deepEqual(missed('12:45', '13:45', posts.slice(0, 3)), ['noon'], '12:55 + 30分 = 13:25');
  assert.deepEqual(missed('20:45', '21:45', posts.slice(0, 4)), ['night']);
  assert.deepEqual(missed('05:00', '23:59', posts), []);
});

// ヘタ郎の掛け合い: X も1日3本になったが、kakeai.json は1日1件（date + media）のまま。
// その日いちばん早い X の投稿で1回だけ知らせ、昼・夜の投稿ではくり返さない。
test('掛け合い（ヘタ郎 X）: 1日3本でも1回だけ、リンクは朝の投稿', () => {
  const source = cfg.kakeai.find((k) => k.brand === 'ヘタ郎');
  const entries = [{ date: '2026-10-21', media: 'X', from: '公式（テスト）', text: 'テスト', replyText: 'テスト返し' }];
  const xPosts = [
    { id: 'x1', date: '2026-10-21', slot: 'morning', xId: '111', publishedAt: '2026-10-20T22:51:00.000Z' },
    { id: 'x2', date: '2026-10-21', slot: 'noon', xId: '222', publishedAt: '2026-10-21T03:51:00.000Z' },
    { id: 'x3', date: '2026-10-21', slot: 'night', xId: '333', publishedAt: '2026-10-21T11:51:00.000Z' },
  ];
  const postedByMedia = { Threads: [], X: xPosts, Instagram: [] };
  let fired = [];
  // 1日の毎時の見回りをすべて回す
  for (let h = 0; h < 24; h++) {
    const since = new Date(Date.parse('2026-10-21T00:45:00+09:00') + (h - 1) * 3600000).toISOString();
    const now = new Date(Date.parse('2026-10-21T00:45:00+09:00') + h * 3600000).toISOString();
    fired.push(...dueKakeai({ source, entries, postedByMedia, since, now }));
  }
  assert.equal(fired.length, 1, '3本出ても掛け合いは1回だけ');
  assert.equal(fired[0].url, 'https://x.com/Hetarougolf/status/111');
  const replies = dueReplies({ source, entries, postedByMedia, today: '2026-10-21' });
  assert.equal(replies.length, 1, '12時台の②も1回だけ');
  assert.equal(replies[0].url, 'https://x.com/Hetarougolf/status/111');
});
