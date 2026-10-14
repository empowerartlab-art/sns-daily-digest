import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { feedStatus, buildDigest, buildFailureAlert, jstDate } from '../lib/digest.mjs';
import { slotDay, missedSlots, slotDeadline, graceOf } from '../lib/slots.mjs';
import { dueKakeai, kakeaiRecord } from '../lib/kakeai.mjs';
import { githubClient, fixtureClient } from '../lib/github.mjs';

const cfg = JSON.parse(readFileSync(new URL('../feeds.json', import.meta.url), 'utf8'));
const FIX = fileURLToPath(new URL('./fixtures/slots', import.meta.url));
const feedOf = (brand) => cfg.feeds.find((f) => f.brand === brand && f.media === 'Threads');
const harley = feedOf('ハーレー');
const zero = feedOf('ZERO RIDERS');
const hetaro = feedOf('ヘタ郎');
const fx = (repo, path) => JSON.parse(readFileSync(`${FIX}/${repo}/${path}`, 'utf8'));
const H = { posted: fx('threads-harley-solo', 'data/threads-posts.json'), planned: fx('threads-harley-solo', 'data/draft-bank.json') };
const Z = { posted: fx('threads-zero-riders', 'data/threads-posts.json'), planned: fx('threads-zero-riders', 'data/draft-bank.json') };
const E = { posted: fx('threads-hetaro', 'data/threads-posts.json'), planned: fx('threads-hetaro', 'data/draft-bank.json') };
const jst = (date, hm) => new Date(`${date}T${hm}:00+09:00`);
const opt = (date, hm) => ({ now: jst(date, hm), graceMinutes: 30 });

test('feeds.json: 3アカウントの Threads は 3枠、時刻は各リポジトリの lib/slots.mjs と同じ', () => {
  assert.deepEqual(harley.slots.map((s) => s.time), ['7:05', '12:05', '20:05']);
  assert.deepEqual(zero.slots.map((s) => s.time), ['7:25', '12:25', '20:25']);
  assert.deepEqual(hetaro.slots.map((s) => s.time), ['7:45', '12:45', '20:45']);
  for (const f of cfg.feeds.filter((x) => x.slots)) {
    assert.deepEqual(f.slots.map((s) => s.slot), ['morning', 'noon', 'night']);
    assert.equal(f.workflow, 'daily-post.yml');
    assert.match(f.time, /^\d{1,2}:\d{2}$/, 'legacy の時刻は残す');
  }
  assert.equal(graceOf(harley, cfg), 30);
  assert.equal(cfg.feeds.filter((x) => x.slots).length, 3, 'ほかの媒体は1日1本のまま');
});

test('朝 7:30: ハーレーは 1/3、ZERO RIDERS・ヘタ郎は 0/3 でも正常（まだ時刻+猶予前）', () => {
  const h = feedStatus(harley, H.posted, H.planned, '2026-10-21', opt('2026-10-21', '07:30'));
  assert.equal(h.state, 'scheduled');
  assert.deepEqual([h.slots.planned, h.slots.approved, h.slots.posted, h.slots.later], [3, 3, 1, 2]);
  const e = feedStatus(hetaro, E.posted, E.planned, '2026-10-21', opt('2026-10-21', '07:30'));
  assert.equal(e.state, 'scheduled');
  assert.equal(e.slots.posted, 0);
  const z = feedStatus(zero, Z.posted, Z.planned, '2026-10-22', opt('2026-10-22', '07:30'));
  assert.equal(z.state, 'scheduled', '07:25 + 30分 = 7:55 まではまだ遅れではない');
  assert.equal(feedStatus(zero, Z.posted, Z.planned, '2026-10-22', opt('2026-10-22', '07:56')).state, 'pending');
});

test('記録の targetDate を日付として使う（postedAt が日付をまたいでも）', () => {
  const posted = { posts: [{ postedAt: '2026-10-21T15:10:00Z', slot: 'night', targetDate: '2026-10-21' }] }; // JST 10/22 0:10
  const d = slotDay(harley, posted, H.planned, '2026-10-21', opt('2026-10-22', '00:20'));
  assert.equal(d.list.find((s) => s.slot === 'night').posted, true);
});

test('旧1日1本の日は従来の表示のまま（ZERO RIDERS 10/21、ハーレー 10/19）', () => {
  const z = feedStatus(zero, Z.posted, Z.planned, '2026-10-21', opt('2026-10-21', '07:30'));
  assert.equal(z.slots, undefined);
  assert.equal(z.state, 'posted');
  const h = feedStatus(harley, { posts: [] }, H.planned, '2026-10-19', opt('2026-10-19', '07:30'));
  assert.equal(h.state, 'pending');
  const text = buildDigest({ today: '2026-10-21', rows: [{ feed: zero, status: z }] });
  assert.match(text, /✅ Threads 6:00 投稿済み/);
});

test('まとめの文面: 「3本（7:05・12:05・20:05） 承認済み 3/3・1/3 投稿済み」と「このあと」', () => {
  const rows = [
    { feed: harley, status: feedStatus(harley, H.posted, H.planned, '2026-10-21', opt('2026-10-21', '07:30')) },
    { feed: hetaro, status: feedStatus(hetaro, E.posted, E.planned, '2026-10-21', opt('2026-10-21', '07:30')) },
  ];
  const text = buildDigest({ today: '2026-10-21', rows });
  assert.match(text, /✅ Threads 3本（7:05・12:05・20:05） 承認済み 3\/3・1\/3 投稿済み（承認済み〜10\/22）/);
  assert.match(text, /✅ Threads 3本（7:45・12:45・20:45） 承認済み 3\/3・0\/3 投稿済み/);
  assert.match(text, /今日の予定 6本 → 投稿済み 1本（このあと 5本）/);
  assert.match(text, /【要対応】/);
  assert.doesNotMatch(text, /出ていません/);
});

test('時刻+猶予を過ぎた枠だけ「出ていない」、未承認の枠は未承認として出す', () => {
  const at13 = feedStatus(harley, H.posted, H.planned, '2026-10-21', opt('2026-10-21', '13:00'));
  assert.equal(at13.state, 'pending');
  const text = buildDigest({ today: '2026-10-21', rows: [{ feed: harley, status: at13 }] });
  assert.match(text, /⚠️ Threads 3本（7:05・12:05・20:05） 承認済み 3\/3・1\/3 投稿済み・昼 12:05 がまだ出ていない/);
  assert.match(text, /ハーレー Threads：昼 12:05 の分が時間を過ぎても出ていません/);
  assert.doesNotMatch(text, /夜 20:05 の分/);

  const planned = E.planned.map((p) => (p.id === 'h3' ? { ...p, approved: false } : p));
  const u = feedStatus(hetaro, E.posted, planned, '2026-10-21', opt('2026-10-21', '07:30'));
  assert.equal(u.state, 'unapproved');
  const ut = buildDigest({ today: '2026-10-21', rows: [{ feed: hetaro, status: u }] });
  assert.match(ut, /承認済み 2\/3・0\/3 投稿済み/);
  assert.match(ut, /ヘタ郎 Threads：今日の分が未承認です（夜 20:45）/);
});

test('slotsFrom 以降で予定の無い日は「3本（…） 今日は予定なし」', () => {
  const s = feedStatus(hetaro, [], [], '2026-10-25', opt('2026-10-25', '07:30'));
  assert.equal(s.state, 'none');
  assert.match(buildDigest({ today: '2026-10-25', rows: [{ feed: hetaro, status: s }] }), /・ Threads 3本（7:45・12:45・20:45） 今日は予定なし/);
});

test('見回り: 枠ごとに、時刻+猶予を過ぎた最初の見回りで1回だけ。後の枠は知らせない', () => {
  const run = (since, now, posted = H.posted) =>
    missedSlots(harley, posted, H.planned, { since: jst('2026-10-21', since).toISOString(), now: jst('2026-10-21', now).toISOString(), graceMinutes: 30 }).map((m) => m.slot);
  assert.deepEqual(run('06:45', '07:45'), [], '朝は記録あり');
  assert.deepEqual(run('10:45', '11:45'), [], '昼・夜はまだ');
  assert.deepEqual(run('12:00', '12:34'), [], '昼 12:05 + 30分 = 12:35 より前は数えない');
  assert.deepEqual(run('11:45', '12:45'), ['noon'], '12:45 の見回りで昼だけ（夜はまだ）');
  assert.deepEqual(run('12:45', '13:45'), [], '同じ枠をくり返さない');
  assert.deepEqual(run('19:45', '20:45'), ['night']);
  assert.deepEqual(run('20:45', '21:45'), []);
  // 朝の記録が無ければ朝だけ（昼・夜はまだ）
  assert.deepEqual(run('06:45', '07:45', { posts: [] }), ['morning']);
  // 締め切り = 時刻 + 猶予
  assert.equal(slotDeadline('2026-10-21', '12:05', 30).toISOString(), '2026-10-21T03:35:00.000Z');
});

test('見回り: 旧1日1本の日・未承認の枠・日付またぎ', () => {
  const zRun = (date, since, now, planned = Z.planned, posted = []) =>
    missedSlots(zero, posted, planned, { since: jst(date, since).toISOString(), now: jst(date, now).toISOString(), graceMinutes: 30 });
  assert.deepEqual(zRun('2026-10-21', '05:45', '23:45'), [], '10/21 は legacy の日: 枠では数えない');
  assert.equal(zRun('2026-10-22', '05:45', '23:45').length, 3);
  const unapproved = Z.planned.map((p) => ({ ...p, approved: false }));
  assert.deepEqual(zRun('2026-10-22', '05:45', '23:45', unapproved), [], '未承認の枠は投稿されないので「失敗」ではない');
  // 前日 23:45 から当日 05:45 の見回り: 前日夜の締め切り(20:55)は範囲外
  const overnight = missedSlots(zero, [], Z.planned, { since: jst('2026-10-21', '23:45').toISOString(), now: jst('2026-10-22', '05:45').toISOString(), graceMinutes: 30 });
  assert.deepEqual(overnight, []);
});

test('失敗通知: 枠の未投稿と、実行の時刻（1日に何回も動くので）', () => {
  const text = buildFailureAlert(
    [{ repo: 'threads-hetaro', label: 'ヘタ郎', name: 'Daily post', url: 'u', updatedAt: '2026-10-21T03:47:00Z' }],
    [{ brand: 'ハーレー', media: 'Threads', date: '2026-10-21', slot: 'noon', time: '12:05' }],
  );
  assert.match(text, /・ヘタ郎：Daily post（12:47ごろ）/);
  assert.match(text, /・ハーレー Threads：10\/21 昼 12:05 の分が、時間を過ぎても出ていません/);
  assert.match(text, /再実行はしないでください/);
  assert.doesNotMatch(buildFailureAlert([{ repo: 'r', name: 'n', url: 'u' }]), /ごろ/);
});

test('daily-post.yml の失敗検出: 1日3〜4回の実行でも、失敗した実行だけを前回以降の分すべて拾う', async () => {
  const runs = [
    { name: 'Daily post', html_url: 'a', updated_at: '2026-10-21T03:30:00Z', event: 'schedule', conclusion: 'failure' },
    { name: 'Daily post', html_url: 'b', updated_at: '2026-10-21T11:30:00Z', event: 'schedule', conclusion: 'failure' },
    { name: 'Daily post', html_url: 'c', updated_at: '2026-10-20T20:01:00Z', event: 'schedule', conclusion: 'failure' },
  ];
  let url = '';
  const fetchImpl = async (u) => {
    url = u;
    return { ok: true, text: async () => JSON.stringify({ workflow_runs: runs }) };
  };
  const got = await githubClient({ token: '', fetchImpl }).failedRuns('o', 'threads-hetaro', '2026-10-21T00:00:00Z');
  assert.match(url, /status=failure/, '成功した実行(legacy の日の何もしない実行を含む)は API の時点で除かれる');
  assert.deepEqual(got.map((r) => r.url), ['a', 'b']);
  assert.equal(got[0].updatedAt, '2026-10-21T03:30:00Z');
});

test('掛け合い: 1日3本の日も、その日いちばん早い投稿で1回だけ知らせる', () => {
  const source = { brand: 'ヘタ郎', media: { Threads: { posted: 'p', link: 'https://www.threads.com/@x' } } };
  const entries = fx('threads-hetaro', 'data/kakeai.json');
  const posted = [
    { date: '2026-10-21', slot: 'morning', threadsId: '1', publishedAt: '2026-10-20T22:46:00.000Z' },
    { date: '2026-10-21', slot: 'noon', threadsId: '2', publishedAt: '2026-10-21T03:46:00.000Z' },
    { date: '2026-10-21', slot: 'night', threadsId: '3', publishedAt: '2026-10-21T11:46:00.000Z' },
  ];
  const at = (s, n) => dueKakeai({ source, entries, postedByMedia: { Threads: posted }, since: jst('2026-10-21', s).toISOString(), now: jst('2026-10-21', n).toISOString() });
  assert.equal(at('07:45', '08:45').length, 1, '朝の投稿のあとの見回りで知らせる');
  assert.equal(at('12:45', '13:45').length, 0, '昼の投稿ではくり返さない');
  assert.equal(at('20:45', '21:45').length, 0);
  // 記録の並びが前後していても、いちばん早い投稿
  assert.equal(kakeaiRecord([...posted].reverse(), entries[0]).threadsId, '1');
  // 予定に slot があれば、その枠の投稿
  assert.equal(kakeaiRecord(posted, { ...entries[0], slot: 'noon' }).threadsId, '2');
  // 旧1日1本の記録(slot なし)も今までどおり
  assert.equal(kakeaiRecord([{ date: '2026-10-21', publishedAt: '2026-10-20T20:38:00Z' }], entries[0]).publishedAt, '2026-10-20T20:38:00Z');
});

test('試し用の fixtureClient: 無いファイルは fallback', async () => {
  const c = fixtureClient(FIX);
  assert.deepEqual(await c.readJson('o', 'nope', 'data/x.json', []), []);
  assert.equal((await c.readJson('o', 'threads-hetaro', 'data/draft-bank.json')).length, 4);
  assert.deepEqual(await c.failedRuns('o', 'threads-hetaro', '2026-10-21T00:00:00Z'), []);
});

const cleanEnv = () => {
  const env = { ...process.env, FIXTURES_DIR: FIX };
  for (const k of ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_TO', 'GH_READ_TOKEN', 'GITHUB_TOKEN', 'TARGET_DATE']) delete env[k];
  return env;
};

test('scripts/digest.mjs を手元の fixtures で dry-run（LINE には送らない）', () => {
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/digest.mjs', import.meta.url))], { env: { ...cleanEnv(), NOW: '2026-10-21T07:30:00+09:00' }, encoding: 'utf8' });
  assert.match(out, /dry-run/);
  assert.match(out, /【朝のまとめ 10\/21】/);
  assert.match(out, /■ハーレー\n✅ Threads 3本（7:05・12:05・20:05） 承認済み 3\/3・1\/3 投稿済み/);
  assert.match(out, /■ZERO RIDERS\n✅ Threads 6:00 投稿済み/);
  assert.match(out, /■ヘタ郎\n✅ Threads 3本（7:45・12:45・20:45） 承認済み 3\/3・0\/3 投稿済み/);
  assert.match(out, /【今日の掛け合い】\n・ ヘタ郎 Threads（投稿待ち）/);
  assert.equal(jstDate(new Date('2026-10-20T22:30:00Z')), '2026-10-21');
});

test('scripts/watch.mjs を fixtures で dry-run: 12:45 は昼だけ、19:45 は何も、20:45 はハーレー夜だけ', () => {
  const run = (since, now) =>
    execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/watch.mjs', import.meta.url))], { env: { ...cleanEnv(), SINCE: since, NOW: now }, encoding: 'utf8' });
  const noon = run('2026-10-21T11:45:00+09:00', '2026-10-21T12:45:00+09:00');
  assert.match(noon, /1 missed slots/);
  assert.match(noon, /ハーレー Threads：10\/21 昼 12:05 の分/);
  assert.doesNotMatch(noon, /夜/);
  const early = run('2026-10-21T18:45:00+09:00', '2026-10-21T19:45:00+09:00');
  assert.match(early, /0 failures, 0 missed slots/);
  assert.doesNotMatch(early, /dry-run/);
  const night = run('2026-10-21T19:45:00+09:00', '2026-10-21T20:45:00+09:00');
  assert.match(night, /1 missed slots/);
  assert.match(night, /ハーレー Threads：10\/21 夜 20:05 の分/);
  assert.doesNotMatch(night, /ヘタ郎 Threads/, 'ヘタ郎の夜(20:45 + 30分)はまだ');
});
