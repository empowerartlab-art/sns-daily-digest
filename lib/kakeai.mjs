// 掛け合いリマインドの判定と文面。純粋な関数だけ(ネットワーク・ファイルに触らない)。
// 掛け合い = キャラクターの投稿に、公式アカウントから本人が手でコメントすること。
// 予定は各リポジトリの kakeai.json（{ date, media, from, text }）。投稿の記録に publishedAt が入ったら知らせる。

import { listOf } from './digest.mjs';

const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

// 投稿の記録から、その媒体の投稿のURLを作る。X は個別の投稿、ほかはプロフィール（最新の投稿が一番上）。
export function postLink(mediaCfg, record) {
  if (mediaCfg.postLink && record?.xId) return mediaCfg.postLink.replace('{xId}', record.xId);
  return mediaCfg.link ?? '';
}

// since 以降・now より前に投稿された日の掛け合いだけを返す。
// entries: kakeai.json の中身、postedByMedia: { Threads: [...], X: [...], Instagram: [...] }
export function dueKakeai({ source, entries, postedByMedia, since, now }) {
  const due = [];
  for (const e of listOf(entries)) {
    const mediaCfg = source.media?.[e.media];
    if (!mediaCfg || !e.date || !e.text) continue;
    const record = listOf(postedByMedia[e.media]).find((p) => p.date === e.date && p.publishedAt);
    if (!record) continue;
    if (record.publishedAt >= since && record.publishedAt < now) due.push({ ...e, brand: source.brand, url: postLink(mediaCfg, record) });
  }
  return due;
}

export function buildKakeaiMessage(item) {
  return [
    `【掛け合い】${item.brand}の${item.media}が投稿されました（${md(item.date)}）`,
    `▶ 投稿：${item.url}`,
    `▶ コメントするアカウント：${item.from}`,
    '▶ コメント案：',
    item.text,
    '',
    'コメントは、公式アカウントで手で貼ってください（自動ではコメントしません）。',
  ].join('\n');
}

// 朝のまとめに入れる「今日の掛け合い」。posted: その媒体で今日の投稿が出ているか。
export function kakeaiDigestLines(items) {
  if (!items.length) return [];
  const out = ['', '【今日の掛け合い】'];
  for (const i of items) out.push(`${i.posted ? '▶' : '・'} ${i.brand} ${i.media} → ${i.from}${i.posted ? `（投稿済み ${i.url}）` : '（投稿待ち）'}`, `  「${i.text}」`);
  return out;
}
