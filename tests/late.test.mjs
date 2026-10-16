// 1日1本の投稿の「出ていない」見回り（lib/slots.mjs の missedLegacy / missedPosts、lib/digest.mjs の buildLateAlert）。
// 10/16 の朝のように GitHub が予定の実行を起動しなかった日に、時刻 + 猶予を過ぎた最初の見回りで1回だけ LINE で知らせる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { missedLegacy, missedPosts } from '../lib/slots.mjs';
import { buildFailureAlert, buildLateAlert } from '../lib/digest.mjs';

const cfg = JSON.parse(readFileSync(new URL('../feeds.json', import.meta.url), 'utf8'));
const root = fileURLToPath(new URL('..', import.meta.url));
const LATE = fileURLToPath(new URL('./fixtures/late', import.meta.url));
const SLOTS = fileURLToPath(new URL('./fixtures/slots', import.meta.url));
const fx = (dir, repo, path) => JSON.parse(readFileSync(`${dir}/${repo}/${path}`, 'utf8'));
const feed = (brand, media) => cfg.feeds.find((f) => f.brand === brand && f.media === media);
const jst = (date, hm) => new Date(`${date}T${hm}:00+09:00`).toISOString();

const ig = feed('ヘタ郎', 'Instagram');
const IG = { posted: fx(LATE, 'threads-hetaro', 'data/ig-posts.json'), planned: fx(LATE, 'threads-hetaro', 'data/ig-queue.json') };
const run = (f, posted, planned, date, since, now) => missedLegacy(f, posted, planned, { since: jst(date, since), now: jst(date, now), graceMinutes: 30 });

test('ヘタ郎 Instagram 6:37: 承認済みで記録が無ければ、6:37+30分を過ぎた最初の見回り（7:45）で1回だけ', () => {
  assert.deepEqual(run(ig, IG.posted, IG.planned, '2026-10-16', '05:45', '06:45'), [], '7:07 より前は数えない');
  const hit = run(ig, IG.posted, IG.planned, '2026-10-16', '06:45', '07:45');
  assert.equal(hit.length, 1);
  assert.deepEqual({ ...hit[0] }, { brand: 'ヘタ郎', media: 'Instagram', repo: 'threads-hetaro', date: '2026-10-16', time: '6:37', graceMinutes: 30, legacy: true, mac: false });
  assert.deepEqual(run(ig, IG.posted, IG.planned, '2026-10-16', '07:45', '08:45'), [], 'くり返さない');
  // 見回りが抜けても、前回の見回りからの範囲に入れば知らせる
  assert.equal(run(ig, IG.posted, IG.planned, '2026-10-16', '05:45', '09:45').length, 1);
});

test('知らせないとき: 記録あり・未承認・予定なし', () => {
  assert.deepEqual(run(ig, [{ id: 'ig-1016', date: '2026-10-16' }], IG.planned, '2026-10-16', '06:45', '07:45'), [], '記録あり');
  assert.deepEqual(run(ig, IG.posted, IG.planned, '2026-10-17', '06:45', '07:45'), [], '未承認');
  assert.deepEqual(run(ig, IG.posted, IG.planned, '2026-10-18', '06:45', '07:45'), [], '予定なし');
  const th = feed('ヘタ郎', 'Threads');
  const TH = { posted: fx(LATE, 'threads-hetaro', 'data/threads-posts.json'), planned: fx(LATE, 'threads-hetaro', 'data/draft-bank.json') };
  assert.deepEqual(run(th, TH.posted, TH.planned, '2026-10-16', '05:45', '06:45'), [], 'ヘタ郎 Threads 5:37 は投稿済み');
  assert.equal(run(th, [], TH.planned, '2026-10-16', '05:45', '06:45').length, 1, '記録が無ければ 6:07 を過ぎた 6:45 の見回りで');
});

test('枠の媒体（ロストボール Threads）: 旧1日1本の日（10/19、5:00）は legacy で、枠の日（10/21）は missedSlots だけ', () => {
  const lb = feed('ロストボール', 'Threads');
  const planned = fx(SLOTS, 'threads-lostball-empowerartlab', 'data/draft-bank.json');
  // targetDate があるので draft-bank の項目は入っている時点で承認済み。記録は postedAt(ISO)。
  assert.deepEqual(run(lb, { posts: [] }, planned, '2026-10-19', '04:45', '05:45').map((m) => m.time), ['5:00']);
  assert.deepEqual(run(lb, { posts: [{ postedAt: '2026-10-18T20:05:00.000Z' }] }, planned, '2026-10-19', '04:45', '05:45'), [], '10/19 5:05 JST に記録あり');
  assert.deepEqual(missedLegacy(lb, { posts: [] }, planned, { since: jst('2026-10-21', '00:00'), now: jst('2026-10-21', '23:59'), graceMinutes: 30 }), [], '枠の日は legacy では数えない');
  const both = missedPosts(lb, { posts: [] }, planned, { since: jst('2026-10-21', '07:45'), now: jst('2026-10-21', '08:45'), graceMinutes: 30 });
  assert.deepEqual(both.map((m) => [m.slot, !!m.legacy]), [['morning', false]], '枠の日は枠の分だけ');
});

test('Mac（LITALICO・note）: 止まった記録があれば「止まりました」の通知に任せる。記録が無ければ ⏰（Mac の可能性）', () => {
  const lit = feed('エンパワー', 'LITALICO');
  const note = feed('エンパワー', 'note');
  const M = (n) => fx(LATE, 'threads-automation-empower', `data/mac-status/${n}`);
  assert.deepEqual(run(lit, M('litalico-posts.json'), M('litalico-planned.json'), '2026-10-16', '05:45', '06:45'), []);
  const n = run(note, M('note-posts.json'), M('note-planned.json'), '2026-10-16', '05:45', '06:45');
  assert.equal(n.length, 1);
  assert.equal(n[0].mac, true);
  assert.match(buildLateAlert(n), /⏰ まだ出ていません：エンパワー note 5:55（予定から30分すぎ）\nMac が動かなかった/);
  assert.doesNotMatch(buildLateAlert(n), /GitHub/);
});

test('文面: ⏰ まだ出ていません（やさしい日本語）。失敗・枠の遅れと同時なら同じ1通の後ろに付ける', () => {
  const late = run(ig, IG.posted, IG.planned, '2026-10-16', '06:45', '07:45');
  const text = buildFailureAlert([], late);
  assert.equal(text, [
    '⏰ まだ出ていません：ヘタ郎 Instagram 6:37（予定から30分すぎ）',
    'GitHub が起動しなかった可能性があります。',
    '自分で再実行はしないでください（二重投稿の恐れ）。Claude に『出ていない投稿がある』と伝えてください。',
  ].join('\n'));
  const mixed = buildFailureAlert([{ repo: 'r', label: 'ZERO RIDERS', name: 'X post', url: 'u' }], [{ brand: 'ハーレー', media: 'Threads', date: '2026-10-21', slot: 'noon', time: '12:05' }, ...late]);
  assert.match(mixed, /^【⚠️ 自動投稿の失敗】/);
  assert.match(mixed, /・ハーレー Threads：10\/21 昼 12:05 の分が、時間を過ぎても出ていません/);
  assert.match(mixed, /\n\n⏰ まだ出ていません：ヘタ郎 Instagram 6:37/);
  assert.equal((mixed.match(/再実行はしないで/g) ?? []).length, 2);
});

test('watch.mjs を手元の記録で動かす: 7:45 の見回りで ⏰ を1通（スタッフ用には送らない）', () => {
  const exec = (since, now) => execFileSync('node', ['scripts/watch.mjs'], {
    cwd: root,
    env: { PATH: process.env.PATH, FIXTURES_DIR: LATE, NOW: now, SINCE: since },
    encoding: 'utf8',
  });
  const out = exec('2026-10-15T21:45:00Z', '2026-10-15T22:45:00Z'); // JST 6:45〜7:45
  assert.match(out, /0 failures, 0 missed slots, 1 late posts/);
  assert.match(out, /⏰ まだ出ていません：ヘタ郎 Instagram 6:37（予定から30分すぎ）/);
  assert.match(out, /staff: 0 alerts/);
  assert.match(exec('2026-10-15T22:45:00Z', '2026-10-15T23:45:00Z'), /0 failures, 0 missed slots, 0 late posts/, 'くり返さない');
});
