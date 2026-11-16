import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueBacklogAlert, buildBacklogMessage } from '../lib/backlog.mjs';

const win = { since: '2026-11-16T00:00:00.000Z', now: '2026-11-16T01:00:00.000Z' };

test('窓の中で20件以上なら知らせる', () => {
  assert.deepEqual(dueBacklogAlert({ backlog: { at: '2026-11-16T00:30:00.000Z', waiting: 25 } }, win), { at: '2026-11-16T00:30:00.000Z', waiting: 25 });
});
test('20件未満・窓の外・記録なしは知らせない', () => {
  assert.equal(dueBacklogAlert({ backlog: { at: '2026-11-16T00:30:00.000Z', waiting: 19 } }, win), null);
  assert.equal(dueBacklogAlert({ backlog: { at: '2026-11-15T23:59:00.000Z', waiting: 60 } }, win), null);
  assert.equal(dueBacklogAlert({ ids: [] }, win), null);
  assert.equal(dueBacklogAlert(null, win), null);
});
test('文面にブランドと件数が入り、コメントの中身は入らない', () => {
  const m = buildBacklogMessage('ハーレー', { waiting: 70 });
  assert.match(m, /ハーレー/);
  assert.match(m, /70件/);
});
