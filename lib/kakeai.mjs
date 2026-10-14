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

// 掛け合いの予定に対応する投稿の記録(date が同じで publishedAt があるもの)。
// 1日3本(枠)の日は記録が複数ある: 予定に slot があればその枠、無ければその日いちばん早く出た投稿。
export function kakeaiRecord(posted, entry) {
  const sameDay = listOf(posted).filter((p) => p.date === entry.date && p.publishedAt);
  const pool = entry.slot ? sameDay.filter((p) => p.slot === entry.slot) : sameDay;
  return pool.sort((a, b) => String(a.publishedAt).localeCompare(String(b.publishedAt)))[0] ?? null;
}

// since 以降・now より前に投稿された日の掛け合いだけを返す。
// entries: kakeai.json の中身、postedByMedia: { Threads: [...], X: [...], Instagram: [...] }
export function dueKakeai({ source, entries, postedByMedia, since, now }) {
  const due = [];
  for (const e of listOf(entries)) {
    const mediaCfg = source.media?.[e.media];
    if (!mediaCfg || !e.date || !e.text) continue;
    const record = kakeaiRecord(postedByMedia[e.media], e);
    if (!record) continue;
    if (record.publishedAt >= since && record.publishedAt < now) due.push({ ...e, brand: source.brand, url: postLink(mediaCfg, record) });
  }
  return due;
}

// ①公式 → キャラの投稿へコメント、②キャラ → ①のコメントへ返信（replyText があるときだけ）。
export function buildKakeaiMessage(item) {
  const out = [
    `【掛け合い】${item.brand}の${item.media}が投稿されました（${md(item.date)}）`,
    `投稿：${item.url}`,
    '',
    '① 今すぐ',
    `だれが：${item.from}`,
    `だれに：${item.brand}の今日の投稿に、コメント（返信）として`,
    'なにを：',
    item.text,
  ];
  if (item.replyText) {
    out.push(
      '',
      '② 昼ごろ（12:45ごろに、もう一度 LINE でお知らせします）',
      `だれが：${item.replyFrom ?? `${item.brand}の${item.media}`}`,
      `だれに：①の${item.from.replace(/（.*$/, '')}のコメントに、返信として`,
      'なにを：',
      item.replyText,
    );
  }
  out.push('', 'どちらも自動ではありません。それぞれのアカウントにログインして、手で貼ってください。');
  return out.join('\n');
}

// 昼（12時台の見回り）に送る「②の時間です」。今日の投稿が出ていて、返し案があるものだけ。
export function dueReplies({ source, entries, postedByMedia, today }) {
  const due = [];
  for (const e of listOf(entries)) {
    const mediaCfg = source.media?.[e.media];
    if (!mediaCfg || e.date !== today || !e.replyText) continue;
    const record = kakeaiRecord(postedByMedia[e.media], e);
    if (record) due.push({ ...e, brand: source.brand, url: postLink(mediaCfg, record) });
  }
  return due;
}

export function buildReplyMessage(item) {
  return [
    `【掛け合い②の時間です】${item.brand}の${item.media}（${md(item.date)}）`,
    `投稿：${item.url}`,
    '',
    `だれが：${item.replyFrom ?? `${item.brand}の${item.media}`}`,
    `だれに：${item.from.replace(/（.*$/, '')}のコメントに、返信として`,
    'なにを：',
    item.replyText,
    '',
    `※ ${item.from.replace(/（.*$/, '')}のコメント（①）がまだなら、先に①をしてください：`,
    item.text,
  ].join('\n');
}

// 朝のまとめに入れる「今日の掛け合い」。posted: その媒体で今日の投稿が出ているか。
export function kakeaiDigestLines(items) {
  if (!items.length) return [];
  const out = ['', '【今日の掛け合い】'];
  for (const i of items) {
    out.push(`${i.posted ? '▶' : '・'} ${i.brand} ${i.media}${i.posted ? `（投稿済み ${i.url}）` : '（投稿待ち）'}`);
    out.push(`  ①${i.from} →「${i.text}」`);
    if (i.replyText) out.push(`  ②${i.replyFrom ?? i.brand} →「${i.replyText}」（昼ごろ）`);
  }
  return out;
}
