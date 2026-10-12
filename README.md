# sns-daily-digest

全 SNS 自動投稿（Threads・Instagram・X）の結果を見回り、**毎朝 7:30 にまとめを1通**、**失敗があればすぐに1通**、LINE で知らせる仕組み。

- **読むだけ**：各リポジトリの投稿記録と実行履歴を読むだけ。投稿・承認・設定の変更は一切しない。
- **見回る対象**：`feeds.json`（アカウントや媒体が増えたら1行足す）。
- **時間**：まとめ 7:30 JST（`digest.yml`）／失敗の見回り 5:45〜23:45 JST の毎時（`watch.yml`）。
- **鍵**（GitHub Secrets。値はここに置かない）：
  - `GH_READ_TOKEN`：4つの自動投稿リポジトリを読むだけの鍵（Contents・Actions を Read-only）
  - `LINE_CHANNEL_ACCESS_TOKEN`／`LINE_TO`：LINE 公式アカウントから運用者本人へ送るための鍵
  - 登録は本人がターミナルで `node scripts/connect.mjs`（入力は表示されない。確認できたものだけ保存）
- 鍵が無いあいだは送信せず、ログに出すだけ（dry-run）。
- このリポジトリは公開（GitHub の実行時間の上限を避けるため）。ログに鍵や投稿本文は出さない。
