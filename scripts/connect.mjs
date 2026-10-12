// 鍵の登録(最初の1回と、鍵を作り直したとき)。持ち主が自分のターミナルで実行する。
// Claude は実行しない・値を見ない。入力は画面に表示されず、確認できたものだけ GitHub Secrets に保存する。
//
//   GH_READ_TOKEN            … 4つの自動投稿リポジトリを「読むだけ」の GitHub の鍵
//   LINE_CHANNEL_ACCESS_TOKEN … LINE 公式アカウント(Messaging API)のチャネルアクセストークン(長期)
//   LINE_TO                  … 通知を受け取る人(運用者本人)の LINE ユーザーID(U から始まる)
//
// 使い方: node scripts/connect.mjs            (3つとも)
//         node scripts/connect.mjs --line     (LINE の2つだけ)
//         node scripts/connect.mjs --github   (GitHub の鍵だけ)
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { githubClient } from '../lib/github.mjs';
import { pushLine } from '../lib/line.mjs';

const REPO = 'empowerartlab-art/sns-daily-digest';
const only = (f) => !process.argv.includes('--line') && !process.argv.includes('--github') || process.argv.includes(f);

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.startsWith(question)) process.stdout.write(question); };
    rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); resolve(a.trim()); });
  });
}
function setSecret(name, value) {
  const r = spawnSync('gh', ['secret', 'set', name, '--repo', REPO], { input: value, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`gh secret set ${name} failed`);
}

const cfg = JSON.parse(await readFile(new URL('../feeds.json', import.meta.url), 'utf8'));
let failed = false;

if (only('--github')) {
  const token = await ask('GitHub の読み取り専用の鍵（github_pat_ で始まる。表示されません）: ');
  const gh = githubClient({ token });
  const repos = [...new Set(cfg.feeds.map((f) => f.repo))];
  let ok = true;
  for (const repo of repos) {
    try {
      await gh.readJson(cfg.owner, repo, 'package.json');
      await gh.failedRuns(cfg.owner, repo, new Date(Date.now() - 86400000).toISOString());
      console.log(`  ✔ ${repo} を読めました`);
    } catch (err) {
      ok = false;
      console.log(`  ✖ ${repo} が読めません（${err.message}）→ 鍵の対象リポジトリと権限（Contents・Actions を Read-only）を確認してください`);
    }
  }
  if (ok) {
    setSecret('GH_READ_TOKEN', token);
    console.log('✅ GitHub の鍵を保存しました。');
  } else {
    failed = true;
    console.log('❌ GitHub の鍵は保存していません。');
  }
}

if (only('--line')) {
  const token = await ask('LINE のチャネルアクセストークン（長期。表示されません）: ');
  const to = await ask('あなたの LINE ユーザーID（U から始まる。表示されません）: ');
  try {
    await pushLine({ text: '【テスト】SNS 自動投稿の通知を、この LINE に届けるように設定しました。', token, to });
    setSecret('LINE_CHANNEL_ACCESS_TOKEN', token);
    setSecret('LINE_TO', to);
    console.log('✅ LINE にテストを送りました。届いていれば設定完了です（GitHub Secrets に保存済み）。');
  } catch (err) {
    failed = true;
    console.log(`❌ ${err.message}。LINE の鍵は保存していません。トークンとユーザーIDを確認してください。`);
  }
}
process.exit(failed ? 1 : 0);
