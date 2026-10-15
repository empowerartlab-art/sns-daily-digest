// Mac で動く投稿(LITALICO・note)の結果記録を読み、止まった・エラーの記録を LINE の文面にする。純粋な関数だけ。
// 記録は Mac の ~/projects/mac-status-reporter/report_status.py が threads-automation-empower の
// data/mac-status/*-posts.json に書く: [{ date, status: published|stopped|error|skipped, reason, detail?, title, url, recordedAt }]。
// 公開リポジトリのログに出すのは件数だけ(タイトル・理由は出さない)。

const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

// 理由コード → やさしい日本語。知らないコードは「その他」。
export const REASON_JA = {
  AUTH_REQUIRED: 'ログイン切れ',
  'manual-review-required': '前の停止が未解決',
  'already-attempted': '同じ日はもう試した',
  'publish-uncertain': '公開できたか確認できない（二重投稿の恐れ）',
  'dry-run-enabled': 'テストモードのまま',
  'image-upload-not-enabled': '画像の設定が未許可',
  'facility-id-mismatch': '事業所の番号が違う',
  'hash-mismatch': '承認のあとで本文が変わっている',
  'unexpected-error': '想定外のエラー',
  'unknown-result': '結果を読み取れない',
  'claude-failed': '投稿の作業が3回とも失敗',
  'not-marked-published': '作業は終わったが公開の記録が無い',
  'extract-failed': '承認済み記事の読み出しに失敗',
  'already-published': 'もう公開済みの記録がある',
  'not-approved-status': '承認の状態がおかしい',
  'missing-approved-by': '承認者の記録が無い',
  'missing-approved-at': '承認日時の記録が無い',
  unknown: '不明',
};

// LITALICO の AUTH_REQUIRED は「認証の段階で止まった」だけの意味。detail(authStatus)で言い分ける。
const AUTH_JA = {
  AUTH_REQUIRED: 'ログイン切れ',
  UNKNOWN: 'ログイン状態を確認できず（一時的な不調の可能性）',
  CAPTCHA_BLOCKED: '人間確認（CAPTCHA）の画面が出た',
  NO_STORAGE_STATE: 'ログイン情報のファイルが無い',
  STORAGE_STATE_CORRUPTED: 'ログイン情報のファイルが壊れている',
};

const safeCode = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : 'unknown');

export function reasonText(rec) {
  const code = safeCode(rec?.reason);
  const detail = safeCode(rec?.detail);
  if (code === 'AUTH_REQUIRED' && AUTH_JA[detail]) return `${AUTH_JA[detail]}（${code}${detail !== 'AUTH_REQUIRED' ? `/${detail}` : ''}）`;
  return `${REASON_JA[code] ?? 'その他'}（${code}）`;
}

// since <= recordedAt < now の、止まった・エラーの記録。
export function dueMacAlerts(records, { since, now }) {
  const s = Date.parse(since);
  const n = Date.parse(now);
  return (Array.isArray(records) ? records : []).filter((r) => {
    if (!r || (r.status !== 'stopped' && r.status !== 'error')) return false;
    const t = Date.parse(r.recordedAt);
    return Number.isFinite(t) && t >= s && t < n && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date));
  });
}

export function buildMacAlert(label, rec) {
  return [
    `【⚠️ ${label} の投稿が止まりました】`,
    `日付：${md(rec.date)}　理由：${reasonText(rec)}`,
    `対処：Claude に「${label}が止まった」と伝えてください（再実行はしないでください）`,
  ].join('\n');
}

// スタッフ向け: 理由をやさしい日本語だけで（コード・英語は出さない）。
export function reasonPlain(rec) {
  const code = safeCode(rec?.reason);
  const detail = safeCode(rec?.detail);
  const text = code === 'AUTH_REQUIRED' && AUTH_JA[detail] ? AUTH_JA[detail] : REASON_JA[code] ?? 'その他';
  return text.replace(/（[A-Za-z_ -]+）/g, '');
}
