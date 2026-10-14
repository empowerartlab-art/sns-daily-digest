import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, publicEncrypt, randomBytes, createCipheriv, constants } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  decryptEnvelope, normalizePem, nextMark, scheduleComments, selectDue, buildCommentMessage, buildOverflowMessage,
  buildPrompt, draftReplies, runCommentAssist, CAP, TONES,
} from '../lib/comments.mjs';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

// 各リポジトリの lib/comment-watch.mjs の encryptPayload と同じ形。
function encrypt(payload, pem = publicKey) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(payload), 'utf8'), c.final()]);
  return { v: 1, alg: 'RSA-OAEP-256+A256GCM', key: publicEncrypt({ key: pem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key).toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

const payload = { account: 'ヘタ郎', media: 'Threads', postUrl: 'https://www.threads.com/@hetarou.golf2026/post/1', postText: '池に呼ばれる体質です', commentText: '私も今日池ポチャ3回でした笑', username: 'golfer_a', commentedAt: '2026-10-15T01:12:00Z' };

test('暗号化した中身を秘密鍵で戻せる(改行が \\n と書かれた鍵でも)', () => {
  const enc = encrypt(payload);
  assert.deepEqual(decryptEnvelope(privateKey, enc), payload);
  assert.deepEqual(decryptEnvelope(normalizePem(privateKey.replace(/\n/g, '\\n')), enc), payload);
  const tampered = { ...enc, data: Buffer.from('x').toString('base64') };
  assert.throws(() => decryptEnvelope(privateKey, tampered));
});

test('各リポジトリの公開鍵の形式で暗号化したものも戻せる(公開鍵は RSA-3072)', () => {
  const pem = readFileSync(new URL('./fixtures/comments/inbox-public.pem', import.meta.url), 'utf8');
  assert.match(pem, /BEGIN PUBLIC KEY/);
  assert.equal(Buffer.from(encrypt(payload, pem).key, 'base64').length, 384);
});

test('送る時刻の刻みは :40、見回りの無い深夜(0〜5時 JST)は朝 5:40 へ', () => {
  assert.equal(new Date(nextMark(Date.parse('2026-10-15T01:21:00Z'))).toISOString(), '2026-10-15T01:40:00.000Z');
  assert.equal(new Date(nextMark(Date.parse('2026-10-15T01:40:00Z'))).toISOString(), '2026-10-15T01:40:00.000Z');
  assert.equal(new Date(nextMark(Date.parse('2026-10-15T01:41:00Z'))).toISOString(), '2026-10-15T02:40:00.000Z');
  // 23:50 JST = 14:50 UTC → 翌 5:40 JST = 20:40 UTC
  assert.equal(new Date(nextMark(Date.parse('2026-10-15T14:50:00Z'))).toISOString(), '2026-10-15T20:40:00.000Z');
});

test('窓: 前回の見回り〜今に送る時刻が入るものだけ。続けて見回っても重複しない', () => {
  const items = [
    { repo: 'a', id: '1', fetchedAt: '2026-10-15T01:21:00Z' }, // +10分 → 01:40
    { repo: 'a', id: '2', fetchedAt: '2026-10-15T01:35:00Z' }, // +10分 = 01:45 → 02:40
  ];
  const s = scheduleComments(items);
  const run1 = selectDue(s, { since: '2026-10-15T00:46:00Z', now: '2026-10-15T01:46:30Z' });
  const run2 = selectDue(s, { since: '2026-10-15T01:46:00Z', now: '2026-10-15T02:47:00Z' });
  assert.deepEqual(run1.due.map((i) => i.id), ['1']);
  assert.deepEqual(run2.due.map((i) => i.id), ['2']);
  // 見回りが遅れて開始が 02:10 でも、窓がつながっていれば1回だけ
  const late = selectDue(s, { since: '2026-10-15T01:46:00Z', now: '2026-10-15T02:10:00Z' });
  assert.equal(late.due.length, 0);
});

test(`1回の見回りは最大${CAP}件。あふれた分は次の見回りに回り、実際に送られる`, () => {
  const items = Array.from({ length: 13 }, (_, i) => ({ repo: i % 2 ? 'b' : 'a', id: String(i).padStart(2, '0'), fetchedAt: '2026-10-15T01:21:00Z' }));
  const s = scheduleComments(items);
  const run1 = selectDue(s, { since: '2026-10-15T00:46:00Z', now: '2026-10-15T01:46:00Z' });
  assert.equal(run1.due.length, CAP);
  assert.equal(run1.queued, 3);
  assert.equal(run1.dropped, 0);
  // 次の見回りで、まだ送っていない3件だけ
  const run2 = selectDue(s, { since: '2026-10-15T01:46:00Z', now: '2026-10-15T02:46:00Z' });
  assert.equal(run2.due.length, 3);
  assert.equal(run2.queued, 0);
  const ids1 = new Set(run1.due.map((i) => `${i.repo}${i.id}`));
  assert.ok(run2.due.every((i) => !ids1.has(`${i.repo}${i.id}`)));
  // 後から新しいコメントが来ても、すでに過ぎた刻みの割り当ては変わらない
  const s2 = scheduleComments([...items, { repo: 'c', id: 'new', fetchedAt: '2026-10-15T01:50:00Z' }]);
  assert.deepEqual(selectDue(s2, { since: '2026-10-15T00:46:00Z', now: '2026-10-15T01:46:00Z' }).due.map((i) => i.id), run1.due.map((i) => i.id));
});

test('見回りが抜けて刻みが2つ入ったときは CAP 件だけ送り、残りの件数を返す', () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ repo: 'a', id: String(i).padStart(2, '0'), fetchedAt: '2026-10-15T01:21:00Z' }));
  const r = selectDue(scheduleComments(items), { since: '2026-10-15T00:46:00Z', now: '2026-10-15T02:50:00Z' });
  assert.equal(r.due.length, CAP);
  assert.equal(r.dropped, 10);
  assert.equal(r.queued, 5);
  assert.match(buildOverflowMessage(r), /ほかに5件（次の見回りで送ります）/);
  assert.match(buildOverflowMessage(r), /10件は、見回りが遅れたため/);
});

test('LINE の文面: だれが・だれに・なにを。返信案は①②③', () => {
  const text = buildCommentMessage(payload, { drafts: ['案1', '案2', '案3'] });
  assert.equal(text, [
    '【コメントが来ました】ヘタ郎のThreads',
    '投稿：https://www.threads.com/@hetarou.golf2026/post/1',
    '（投稿の書き出し：池に呼ばれる体質です…）',
    'だれから：@golfer_a',
    'いつ：10/15 10:12',
    'コメント：私も今日池ポチャ3回でした笑',
    '―――',
    '返信案（ヘタ郎のThreadsから、@golfer_a さんへ返信として）',
    '① 案1',
    '② 案2',
    '③ 案3',
    '',
    '※自動では返信しません。合うものを選んで、手で貼ってください。',
  ].join('\n'));
});

test('人が判断すべきもの: ⚠️ と理由だけで、返信案は付けない', () => {
  const text = buildCommentMessage(payload, { needsHuman: true, reason: '悩み相談' });
  assert.match(text, /⚠️ 人が判断してください（悩み相談）/);
  assert.ok(!text.includes('①'));
});

test('AI の鍵が無いとき: コメントだけ送り、「鍵の登録後に付きます」', () => {
  const text = buildCommentMessage(payload, { noKey: true });
  assert.match(text, /返信案はAIの鍵の登録後に付きます/);
  assert.match(text, /コメント：私も今日池ポチャ3回でした笑/);
});

test('口調: 5アカウントすべてあり、ロストボールには確認済みの事実が入る', () => {
  assert.deepEqual(Object.keys(TONES).sort(), ['empower', 'harley', 'hetaro', 'lostball', 'zero-riders']);
  const p = buildPrompt({ tone: 'lostball', facts: ['日本のロストボールを再利用して販売する'], payload });
  assert.match(p.system, /確認済みの事実（これ以外は言わない）/);
  assert.match(p.system, /日本のロストボールを再利用して販売する/);
  assert.match(buildPrompt({ tone: 'hetaro', payload }).system, /熊本/);
  assert.match(p.user, /コメント：私も今日池ポチャ3回でした笑/);
});

const geminiReply = (obj, status = 200) => async () => ({ ok: status === 200, status, json: async () => ({ candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] } }] }) });

test('AI: needsHuman のときは返信案を捨てる。壊れた応答は中身を含まないエラー', async () => {
  const human = await draftReplies({ apiKey: 'k', tone: 'empower', payload, fetchImpl: geminiReply({ needsHuman: true, reason: '利用者の話', drafts: ['x'] }) });
  assert.deepEqual(human, { needsHuman: true, reason: '利用者の話', drafts: [] });
  const ok = await draftReplies({ apiKey: 'k', tone: 'hetaro', payload, fetchImpl: geminiReply({ needsHuman: false, reason: '', drafts: [' a ', 'b', 'c', 'd'] }) });
  assert.deepEqual(ok.drafts, ['a', 'b', 'c']);
  await assert.rejects(draftReplies({ apiKey: 'k', tone: 'hetaro', payload, fetchImpl: geminiReply('池ポチャ{壊れた') }), (e) => !e.message.includes('池ポチャ'));
  await assert.rejects(draftReplies({ apiKey: 'k', tone: 'hetaro', payload, fetchImpl: geminiReply({}, 429) }), /AI HTTP 429/);
});

// 見回り全体: GitHub の代わりの readJson、LINE の代わりの push。ログに中身が出ないこと。
function fakeGh(files) {
  return { readJson: async (owner, repo, path, fallback) => files[`${repo}/${path}`] ?? fallback };
}
const cfg = { owner: 'o', commentInbox: [
  { brand: 'ヘタ郎', repo: 'threads-hetaro', path: 'data/comment-inbox.enc.json', tone: 'hetaro' },
  { brand: 'ロストボール', repo: 'lb', path: 'data/comment-inbox.enc.json', tone: 'lostball', facts: { path: 'data/verified-facts.json' } },
] };
const window = { since: '2026-10-15T00:46:00Z', now: '2026-10-15T01:46:00Z' };

test('見回り: AI の鍵が無くてもコメントは届き、ログは件数だけ', async () => {
  const gh = fakeGh({ 'threads-hetaro/data/comment-inbox.enc.json': [{ id: 'threads:1', fetchedAt: '2026-10-15T01:21:00Z', enc: encrypt(payload) }] });
  const sent = [];
  const logs = [];
  const stats = await runCommentAssist({ cfg, gh, ...window, privateKeyPem: privateKey, geminiKey: '', push: async (t) => sent.push(t), log: (l) => logs.push(l) });
  assert.equal(stats.sent, 1);
  assert.match(sent[0], /返信案はAIの鍵の登録後に付きます/);
  assert.ok(logs.every((l) => !l.includes('池ポチャ') && !l.includes('golfer_a')));
});

test('見回り: ロストボールは確認済みの事実だけを AI に渡す。needsHuman はそのまま知らせる', async () => {
  const lbPayload = { ...payload, account: 'ロストボール', commentText: '在庫ありますか' };
  const gh = fakeGh({
    'lb/data/comment-inbox.enc.json': [{ id: 'instagram:9', fetchedAt: '2026-10-15T01:21:00Z', enc: encrypt(lbPayload) }],
    'lb/data/verified-facts.json': { facts: [{ statementJa: '確認済みA', verified: true }, { statementJa: '未確認B', verified: false }] },
  });
  let prompt = '';
  const fetchImpl = async (url, init) => {
    prompt = JSON.parse(init.body).systemInstruction.parts[0].text;
    return geminiReply({ needsHuman: true, reason: '在庫の確認が必要', drafts: [] })();
  };
  const sent = [];
  await runCommentAssist({ cfg, gh, ...window, privateKeyPem: privateKey, geminiKey: 'k', fetchImpl, push: async (t) => sent.push(t), log: () => {} });
  assert.match(prompt, /確認済みA/);
  assert.ok(!prompt.includes('未確認B'));
  assert.match(sent[0], /⚠️ 人が判断してください（在庫の確認が必要）/);
});

test('見回り: 秘密鍵が無ければ何も読まず送らない。読めない1通は飛ばして次へ', async () => {
  const gh = fakeGh({ 'threads-hetaro/data/comment-inbox.enc.json': [
    { id: 'threads:bad', fetchedAt: '2026-10-15T01:20:00Z', enc: { v: 1, key: 'AA==', iv: 'AA==', tag: 'AA==', data: 'AA==' } },
    { id: 'threads:1', fetchedAt: '2026-10-15T01:21:00Z', enc: encrypt(payload) },
  ] });
  const sent = [];
  const none = await runCommentAssist({ cfg, gh, ...window, privateKeyPem: '', push: async (t) => sent.push(t), log: () => {} });
  assert.equal(none.sent, 0);
  const stats = await runCommentAssist({ cfg, gh, ...window, privateKeyPem: privateKey, push: async (t) => sent.push(t), log: () => {} });
  assert.equal(stats.unreadable, 1);
  assert.equal(stats.sent, 1);
});

test('見回り: inbox が空なら何も送らない', async () => {
  const sent = [];
  const stats = await runCommentAssist({ cfg, gh: fakeGh({}), ...window, privateKeyPem: privateKey, geminiKey: 'k', push: async (t) => sent.push(t), log: () => {} });
  assert.equal(sent.length, 0);
  assert.equal(stats.sent, 0);
});
