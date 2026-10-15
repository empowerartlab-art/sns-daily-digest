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
const lostball = feedOf('ロストボール');
const fx = (repo, path) => JSON.parse(readFileSync(`${FIX}/${repo}/${path}`, 'utf8'));
const H = { posted: fx('threads-harley-solo', 'data/threads-posts.json'), planned: fx('threads-harley-solo', 'data/draft-bank.json') };
const Z = { posted: fx('threads-zero-riders', 'data/threads-posts.json'), planned: fx('threads-zero-riders', 'data/draft-bank.json') };
const E = { posted: fx('threads-hetaro', 'data/threads-posts.json'), planned: fx('threads-hetaro', 'data/draft-bank.json') };
const L = { posted: fx('threads-lostball-empowerartlab', 'data/threads-posts.json'), planned: fx('threads-lostball-empowerartlab', 'data/draft-bank.json') };
const jst = (date, hm) => new Date(`${date}T${hm}:00+09:00`);
const opt = (date, hm) => ({ now: jst(date, hm), graceMinutes: 30 });

test('feeds.json: ハーレー・ZERO RIDERS・ヘタ郎の Threads は 3枠、時刻は各リポジトリの lib/slots.mjs と同じ', () => {
  assert.deepEqual(harley.slots.map((s) => s.time), ['7:05', '12:05', '20:05']);
  assert.deepEqual(zero.slots.map((s) => s.time), ['7:25', '12:25', '20:25']);
  assert.deepEqual(hetaro.slots.map((s) => s.time), ['7:45', '12:45', '20:45']);
  for (const f of [harley, zero, hetaro]) {
    assert.deepEqual(f.slots.map((s) => s.slot), ['morning', 'noon', 'night']);
    assert.equal(f.workflow, 'daily-post.yml');
  }
  for (const f of cfg.feeds.filter((x) => x.slots)) assert.match(f.time, /^\d{1,2}:\d{2}$/, 'legacy の時刻は残す');
  assert.equal(graceOf(harley, cfg), 30);
  assert.equal(cfg.feeds.filter((x) => x.slots).length, 10, '枠は Threads 5アカウント＋X 5アカウント。Instagram は1日1本のまま');
  // Mac(launchd)で動く LITALICO・note は1日1本(枠なし)。
  assert.deepEqual(cfg.feeds.filter((x) => !x.slots && !x.workflow.startsWith('(Mac)')).map((x) => x.media), ['Instagram', 'Instagram', 'Instagram']);
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
  assert.match(out, /■ハーレー\n.*\n✅ X 3本（6:50・11:50・19:50） 承認済み 3\/3・1\/3 投稿済み/);
  assert.match(out, /■エンパワー\n✅ Threads 3本（7:55・12:55・20:55） 承認済み 3\/3・0\/3 投稿済み/);
  assert.equal(jstDate(new Date('2026-10-20T22:30:00Z')), '2026-10-21');
});

test('scripts/watch.mjs を fixtures で dry-run: 12:45 は昼だけ、19:45 は何も、20:45 はハーレー夜だけ（Threads と X）', () => {
  const run = (since, now) =>
    execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/watch.mjs', import.meta.url))], { env: { ...cleanEnv(), SINCE: since, NOW: now }, encoding: 'utf8' });
  const noon = run('2026-10-21T11:45:00+09:00', '2026-10-21T12:45:00+09:00');
  assert.match(noon, /2 missed slots/);
  assert.match(noon, /ハーレー Threads：10\/21 昼 12:05 の分/);
  assert.match(noon, /ハーレー X：10\/21 昼 11:50 の分/, 'X 11:50 + 30分 = 12:20');
  assert.doesNotMatch(noon, /夜/);
  const early = run('2026-10-21T18:45:00+09:00', '2026-10-21T19:45:00+09:00');
  assert.match(early, /0 failures, 0 missed slots/);
  assert.doesNotMatch(early, /dry-run/);
  const night = run('2026-10-21T19:45:00+09:00', '2026-10-21T20:45:00+09:00');
  assert.match(night, /2 missed slots/);
  assert.match(night, /ハーレー Threads：10\/21 夜 20:05 の分/);
  assert.match(night, /ハーレー X：10\/21 夜 19:50 の分/);
  assert.doesNotMatch(night, /ヘタ郎 Threads/, 'ヘタ郎の夜(20:45 + 30分)はまだ');
});

// ---- ロストボール Threads: 1日4本（2026-10-20〜。日本語 7:35・12:35・20:35、英語 21:00） ----
// 同じ「夜」に日本語と英語の2本があるので、枠は slot と lang の両方で数える（feeds.json の lang / label）。

test('ロストボール: feeds.json は4枠（日本語 朝・昼・夜＋英語 夜21:00）、記録の targetDate を日付に使う', () => {
  assert.deepEqual(lostball.slots.map((s) => `${s.slot}/${s.lang}/${s.time}`), ['morning/ja/7:35', 'noon/ja/12:35', 'night/ja/20:35', 'night/en/21:00']);
  assert.equal(lostball.slotsFrom, '2026-10-20');
  assert.equal(lostball.workflow, 'daily-live-post.yml');
  assert.equal(lostball.posted.dayField, 'targetDate');
});

test('ロストボール: まとめは「4本（7:35・12:35・20:35・英語21:00）」、日本語の夜の記録は英語の枠に数えない', () => {
  const morning = feedStatus(lostball, L.posted, L.planned, '2026-10-21', opt('2026-10-21', '07:30'));
  assert.deepEqual([morning.slots.planned, morning.slots.approved, morning.slots.posted, morning.slots.later], [4, 4, 1, 3]);
  const text = buildDigest({ today: '2026-10-21', rows: [{ feed: lostball, status: morning }] });
  assert.match(text, /✅ Threads 4本（7:35・12:35・20:35・英語21:00） 承認済み 4\/4・1\/4 投稿済み/);
  assert.match(text, /今日の予定 4本 → 投稿済み 1本（このあと 3本）/);

  // 日本語3本が出て、英語がまだ（21:00 + 30分 を過ぎた 22:00）
  const jaNight = { postedAt: '2026-10-21T11:36:00Z', lang: 'ja', slot: 'night', targetDate: '2026-10-21' };
  const jaNoon = { postedAt: '2026-10-21T03:36:00Z', lang: 'ja', slot: 'noon', targetDate: '2026-10-21' };
  const posted = { posts: [...L.posted.posts, jaNoon, jaNight] };
  const late = feedStatus(lostball, posted, L.planned, '2026-10-21', opt('2026-10-21', '22:00'));
  assert.equal(late.state, 'pending');
  assert.deepEqual(late.slots.list.map((x) => x.posted), [true, true, true, false]);
  const lateText = buildDigest({ today: '2026-10-21', rows: [{ feed: lostball, status: late }] });
  assert.match(lateText, /⚠️ Threads 4本（7:35・12:35・20:35・英語21:00） 承認済み 4\/4・3\/4 投稿済み・英語 21:00 がまだ出ていない/);
  assert.match(lateText, /ロストボール Threads：英語 21:00 の分が時間を過ぎても出ていません/);

  // 英語が0時を過ぎて出ても、targetDate の日の分として数える
  const enAfterMidnight = { postedAt: '2026-10-21T15:10:00Z', lang: 'en', slot: 'night', targetDate: '2026-10-21' };
  const done = feedStatus(lostball, { posts: [...posted.posts, enAfterMidnight] }, L.planned, '2026-10-21', opt('2026-10-22', '00:20'));
  assert.equal(done.state, 'posted');
  assert.equal(done.slots.posted, 4);
});

test('ロストボール: 10/19までは従来の表示（Threads 5:00）', () => {
  const s = feedStatus(lostball, L.posted, L.planned, '2026-10-19', opt('2026-10-19', '07:30'));
  assert.equal(s.slots, undefined);
  assert.equal(s.state, 'posted');
  assert.match(buildDigest({ today: '2026-10-19', rows: [{ feed: lostball, status: s }] }), /✅ Threads 5:00 投稿済み/);
});

test('ロストボール: 見回りは4枠すべてを、時刻+猶予を過ぎた最初の見回りで1回だけ知らせる', () => {
  const run = (since, now, posted = L.posted) =>
    missedSlots(lostball, posted, L.planned, { since: jst('2026-10-21', since).toISOString(), now: jst('2026-10-21', now).toISOString(), graceMinutes: 30 }).map((m) => `${m.slot}/${m.lang}`);
  assert.deepEqual(run('05:45', '23:45', { posts: [] }), ['morning/ja', 'noon/ja', 'night/ja', 'night/en']);
  assert.deepEqual(run('07:45', '08:45'), [], '朝は記録あり');
  assert.deepEqual(run('12:45', '13:45'), ['noon/ja']);
  assert.deepEqual(run('20:45', '21:45'), ['night/ja', 'night/en'], '21:45 の見回りで日本語の夜(21:05)と英語(21:30)');
  assert.deepEqual(run('21:45', '22:45'), [], 'くり返さない');
  const ja = { posts: [...L.posted.posts, { postedAt: '2026-10-21T11:36:00Z', lang: 'ja', slot: 'night', targetDate: '2026-10-21' }] };
  assert.deepEqual(run('20:45', '21:45', ja), ['night/en'], '日本語の夜が出ていても英語は別に数える');
  const text = buildFailureAlert([], missedSlots(lostball, ja, L.planned, { since: jst('2026-10-21', '20:45').toISOString(), now: jst('2026-10-21', '21:45').toISOString(), graceMinutes: 30 }));
  assert.match(text, /・ロストボール Threads：10\/21 英語 21:00 の分が、時間を過ぎても出ていません/);
});

test('scripts/watch.mjs を fixtures で dry-run: 21:45 はロストボールの日本語の夜と英語', () => {
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/watch.mjs', import.meta.url))], {
    env: { ...cleanEnv(), SINCE: '2026-10-21T20:45:00+09:00', NOW: '2026-10-21T21:45:00+09:00' },
    encoding: 'utf8'
  });
  assert.match(out, /ロストボール Threads：10\/21 夜 20:35 の分/);
  assert.match(out, /ロストボール Threads：10\/21 英語 21:00 の分/);
});
