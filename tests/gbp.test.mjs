import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { gbpStatus, gbpLine, gbpTodo, nextCycle } from '../lib/gbp.mjs';
import { buildDigest } from '../lib/digest.mjs';

// 予約済み 10/7〜10/19（A-1〜B-7）、10/20〜10/26 は下書き（C-1〜C-7）。
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/gbp/threads-automation-empower/data/gbp-schedule.json', import.meta.url), 'utf8'));
const run = (today, schedule = fixture()) => {
  const s = gbpStatus(schedule, today);
  return { s, line: gbpLine(s), todo: gbpTodo(s, today) };
};

test('次の火〜月: 土曜 10/17 → 10/20〜10/26、月曜 10/19 → 10/20〜、火曜 10/20 → 10/27〜', () => {
  assert.deepEqual(nextCycle('2026-10-17'), { start: '2026-10-20', end: '2026-10-26' });
  assert.deepEqual(nextCycle('2026-10-19'), { start: '2026-10-20', end: '2026-10-26' });
  assert.equal(nextCycle('2026-10-20').start, '2026-10-27');
});

test('ふつうの日（水 10/14）: ✅ 予約済み〜10/19、要対応なし', () => {
  const { line, todo } = run('2026-10-14');
  assert.equal(line, '✅ Googleビジネスプロフィール 9:15 予約済み（〜10/19）');
  assert.deepEqual(todo, []);
});

test('土曜 10/17: 来週分（10/20〜10/26・7本）の確認・承認日', () => {
  const { line, todo } = run('2026-10-17');
  assert.match(line, /^✅ .*予約済み（〜10\/19）/);
  assert.deepEqual(todo, ['・📝 今日（または明日）はGBP来週分（10/20〜10/26・7本）の確認・承認日です']);
});

test('日曜 10/18: 予約が明日で終わる警告 + 「まだなら今日中に」', () => {
  const { todo } = run('2026-10-18');
  assert.deepEqual(todo, [
    '・⚠️ GBPの予約が10/19で終わります。来週分が未予約です',
    '・📝 GBP来週分（10/20〜10/26・7本）の確認・承認、まだなら今日中に',
  ]);
});

test('月曜 10/19: 明日の分がありません（至急）', () => {
  const { line, todo } = run('2026-10-19');
  assert.match(line, /^✅ /);
  assert.deepEqual(todo, ['・⚠️ GBPの予約が10/19で終わります。来週分が未予約です。明日の分がありません']);
});

test('承認済み・未予約は別に数える（日曜、C-1〜C-3 承認済み）', () => {
  const sch = fixture();
  for (const d of sch.days) if (['C-1', 'C-2', 'C-3'].includes(d.id)) d.status = 'approved';
  const { todo } = run('2026-10-18', sch);
  assert.ok(todo.includes('・GBP：承認済み・未予約 3本 → 予約してください'));
  assert.ok(todo.some((t) => t.includes('まだなら今日中に（承認済み 3・予約済み 0/7）')));
});

test('来週分が全部予約済みなら、土日の知らせも予約切れの警告も出ない', () => {
  const sch = fixture();
  for (const d of sch.days) d.status = 'reserved';
  assert.deepEqual(run('2026-10-17', sch).todo, []);
  assert.deepEqual(run('2026-10-19', sch).todo, []);
  assert.equal(run('2026-10-19', sch).line, '✅ Googleビジネスプロフィール 9:15 予約済み（〜10/26）');
});

test('今日が未予約なら ⚠️（火曜 10/20、下書きのまま）', () => {
  const { line, todo } = run('2026-10-20');
  assert.equal(line, '⚠️ Googleビジネスプロフィール 9:15 今日の分が未予約（予約の記録は〜10/19）');
  assert.ok(todo.includes('・⚠️ GBP：今日（10/20）の分が予約されていません'));
});

test('記録が無い・形が違う: 1行だけ、要対応は増やさない', () => {
  for (const bad of [null, [], {}, { days: 'x' }]) {
    assert.equal(gbpStatus(bad, '2026-10-17'), null);
    assert.equal(gbpLine(null), '❓ GBPの予約記録が読めません（未確認）');
    assert.deepEqual(gbpTodo(null, '2026-10-17'), []);
  }
});

test('まとめ文: GBP の行はエンパワーの欄の最後、要対応にも載る', () => {
  const feed = (brand, media) => ({ brand, media, time: '5:00', posted: {}, planned: {} });
  const rows = [
    { feed: feed('エンパワー', 'Threads'), status: { state: 'posted' } },
    { feed: feed('エンパワー', 'X'), status: { state: 'posted' } },
    { feed: feed('ヘタ郎', 'Threads'), status: { state: 'posted' } },
  ];
  const s = gbpStatus(fixture(), '2026-10-19');
  const text = buildDigest({ today: '2026-10-19', rows, gbp: { brand: 'エンパワー', line: gbpLine(s), todo: gbpTodo(s, '2026-10-19') } });
  const lines = text.split('\n');
  assert.equal(lines[lines.indexOf('✅ X 5:00 投稿済み') + 1], '✅ Googleビジネスプロフィール 9:15 予約済み（〜10/19）');
  assert.match(text, /【要対応】\n・⚠️ GBPの予約が10\/19で終わります/);
  assert.match(text, /今日の予定 3本/); // GBP は投稿の本数に数えない
});

const script = (dir, now) => execFileSync(process.execPath, ['scripts/digest.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { PATH: process.env.PATH, FIXTURES_DIR: dir, NOW: now },
  encoding: 'utf8',
});

test('朝のまとめ(dry-run): 記録が無くても止まらず「読めません（未確認）」', () => {
  const out = script('tests/fixtures/gbp-missing', '2026-10-17T07:30:00+09:00');
  assert.match(out, /■エンパワー[\s\S]*❓ GBPの予約記録が読めません（未確認）/);
  assert.match(out, /digest 2026-10-17/);
});

test('朝のまとめ(dry-run): 土曜 10/17 の知らせが出る', () => {
  const out = script('tests/fixtures/gbp', '2026-10-17T07:30:00+09:00');
  assert.match(out, /✅ Googleビジネスプロフィール 9:15 予約済み（〜10\/19）/);
  assert.match(out, /確認・承認日です/);
});
