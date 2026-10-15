// LINE 公式アカウント(Messaging API)から、運用者本人に1通送る。
// LINE_CHANNEL_ACCESS_TOKEN と LINE_TO(運用者のユーザーID)が無いときは送らずにログへ出すだけ。

const PUSH = 'https://api.line.me/v2/bot/message/push';
const MAX = 4900; // LINE の1メッセージ上限は5000文字

export async function pushLine({ text, token, to, fetchImpl = fetch, log = console.log }) {
  if (!token || !to) {
    log('LINE の鍵が未設定のため送信しませんでした(dry-run)。送る予定だった内容:\n' + text);
    return { sent: false };
  }
  const body = JSON.stringify({ to, messages: [{ type: 'text', text: text.length > MAX ? text.slice(0, MAX) + '\n…(省略)' : text }] });
  const res = await fetchImpl(PUSH, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body });
  if (!res.ok) throw new Error(`LINE への送信に失敗しました(HTTP ${res.status})`);
  return { sent: true };
}

// スタッフ用の LINE 公式アカウント(別のアカウント)から、友だち全員に1通（broadcast）。ユーザーIDは使わない。
// 鍵(STAFF_LINE_CHANNEL_ACCESS_TOKEN)が無いときは送らず、決まった1行だけログに出す(中身は出さない)。
// 運用者本人用の鍵(LINE_CHANNEL_ACCESS_TOKEN)はここでは使わない。
const BROADCAST = 'https://api.line.me/v2/bot/message/broadcast';
export const STAFF_NO_TOKEN = 'スタッフ用LINEの鍵が未設定のため送信しませんでした';

export async function broadcastLine({ text, token, fetchImpl = fetch, log = console.log }) {
  const key = String(token ?? '').trim();
  if (!key) {
    log(STAFF_NO_TOKEN);
    return { sent: false };
  }
  const body = JSON.stringify({ messages: [{ type: 'text', text: text.length > MAX ? text.slice(0, MAX) + '\n…(省略)' : text }] });
  const res = await fetchImpl(BROADCAST, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body });
  if (!res.ok) throw new Error(`スタッフ用LINEへの送信に失敗しました(HTTP ${res.status})`);
  return { sent: true };
}
