// 毎朝8:00: スタッフ用LINE（別の公式アカウント）の友だち全員に、エンパワーの「今日の発信」を1通（broadcast）。読むだけ。
// 載せるのは feeds.json の staff の媒体だけ（ほかのブランド・代表だけの情報は載せない）。
// ログは公開されるので、件数と送ったかどうかだけ（中身・鍵は出さない）。
import { readFile } from 'node:fs/promises';
import { githubClient, fixtureClient } from '../lib/github.mjs';
import { feedStatus, jstDate } from '../lib/digest.mjs';
import { graceOf } from '../lib/slots.mjs';
import { broadcastLine } from '../lib/line.mjs';
import { staffFeeds, staffFeedItem, staffGbpItem, buildStaffDigest } from '../lib/staff.mjs';

const cfg = JSON.parse(await readFile(new URL('../feeds.json', import.meta.url), 'utf8'));
// FIXTURES_DIR / NOW / TARGET_DATE: 手元のフォルダと時刻で試すとき用。
const gh = process.env.FIXTURES_DIR ? fixtureClient(process.env.FIXTURES_DIR) : githubClient({ token: process.env.GH_READ_TOKEN });
const now = process.env.NOW ? new Date(process.env.NOW) : new Date();
const today = process.env.TARGET_DATE || jstDate(now);

const items = [];
let unreadable = 0;
for (const media of cfg.staff?.media ?? []) {
  if (media === 'GBP') {
    const g = cfg.staff.gbp;
    let schedule = null;
    try {
      schedule = await gh.readJson(cfg.owner, g.repo, g.path, null);
    } catch {
      unreadable++;
    }
    items.push(staffGbpItem(schedule, today, g.label));
    continue;
  }
  for (const feed of staffFeeds(cfg).filter((f) => f.media === media)) {
    const opts = { now, graceMinutes: graceOf(feed, cfg) };
    try {
      const posted = await gh.readJson(cfg.owner, feed.repo, feed.posted.path, []);
      const planned = await gh.readJson(cfg.owner, feed.repo, feed.planned.path, []);
      items.push(staffFeedItem(feed, feedStatus(feed, posted, planned, today, opts), posted, today, opts));
    } catch {
      unreadable++;
      items.push(staffFeedItem(feed, null, [], today, opts));
    }
  }
}

const text = buildStaffDigest({ brand: cfg.staff.brand, today, items });
const problems = items.filter((i) => i.problem).length;
let sent = false;
try {
  ({ sent } = await broadcastLine({ text, token: process.env.STAFF_LINE_CHANNEL_ACCESS_TOKEN }));
} catch (err) {
  console.log(String(err?.message ?? 'スタッフ用LINEへの送信に失敗しました').replace(/[^\p{L}\p{N}() .:_-]/gu, ''));
  process.exitCode = 1;
}
console.log(`staff-digest ${today}: ${items.length} lines, ${problems} problems, ${unreadable} unreadable, sent=${sent}`);
