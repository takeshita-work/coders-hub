# 007 配布 タスク

- 対応 plan: ./plan.md
- 凡例: `[ ]` 未着手 / `[x]` 完了。★は検証タスク

## フェーズ 0: 検証
- [x] T0-1 ★ SEA で、`ws`・MCP SDK を含むコードが、exe として動くか（確認済み。ADR 0018。約 88 MB）
- [x] T0-2 ★ SEA のメインに ESM を使えるか → Node 22.23 では不可。最上位の `await` の `async` 化が必要（確認済み）
- [x] T0-3 ★ SEA のアセット（画面のファイル）を、`sea.getAsset` で取り出して配信できるか → 配信できた。ファイル名の一覧は、マニフェスト（`manifest.json`）のアセットに持つ（`getAsset` に一覧の API がないため）
- [x] T0-4 ★ exe を、フックとして起動したときの起動時間 → 中央値 約 120ms（最大 約 200ms。Hub への送信を含む）。`node` 版は約 82ms。NFR-003（3 秒）に収まる
- [x] T0-5 ★ exe をチャネルサーバーとして動かせるか → 模擬の MCP クライアントから `channel --channel` で起動し、Hub に操作モードで登録され、終了で一覧から外れることを確認した。Hub の自動起動（exe から exe を `hub` で起動）も確認した。**本物の `claude` と、スペース・日本語を含むパスでの確認は、T5-3 で行う**

## フェーズ 1: 入口の整理
- [x] T1-1 4 つの入口の最上位の `await` を、`run()` に包む（直接実行の動作は変えない）
- [x] T1-2 `src/cli/main.mjs`: サブコマンドの振り分け（AC-011-5・9・10）
- [x] T1-3 引数なしの実行（ダブルクリック）で、Hub の起動と URL を表示する（AC-011-6）

## フェーズ 2: 画面の配信・自動起動・設定
- [x] T2-1 画面の配信元の差し替え（フォルダ／アセット）。リスト外は返さない（AC-011-6・7）
- [x] T2-2 Hub の自動起動を、exe でも動くようにする（AC-011-11）
- [x] T2-3 設定の生成部品を共通化し、`setup` サブコマンドを作る（AC-011-8）

## フェーズ 3: ビルド
- [x] T3-1 `scripts/build-exe.mjs`: 束ね・blob・注入・動作確認（AC-011-5・6）
- [x] T3-2 配布物の組み立て（zip・README・LICENSE・SHA256SUMS）（AC-011-2・3）。のちに、zip をやめて個別の資産にした（ADR 0022。T4d-1）

## フェーズ 4: 公開の準備
- [x] T4-1 ライセンスを決め（MIT）、`LICENSE` を置く。配布物に `THIRD_PARTY_NOTICES.txt` を入れる
- [x] T4-2 公開前の確認（履歴を含む、秘密情報・個人情報・個人のパス・アカウント名）→ 確認は完了（`pre-release-check.md`）。秘密情報はなし。個人名・アカウント名は、A（作業ツリーだけ置き換え）で対応した
- [x] T4-3 `.github/workflows/release.yml`（タグ・バージョン一致・テスト・リリースをドラフトで作成して公開）（AC-011-1・4）
- [x] T4-4 利用者向けの README（AC-011-14。`README.md` と、リリースの `README.txt`）

## フェーズ 4b: ポートの設定ファイル（ADR 0019）
- [x] T4b-1 `src/shared/config.mjs`: 設定ファイル（exe と同じフォルダの `config.json`。ADR 0021）の読み込み、優先順位（環境変数 > ファイル > 既定）、既定を 47765 / 47766 に（AC-011-15〜19）
- [x] T4b-2 テスト（`tests/config.test.mjs`）
- [x] T4b-3 文書: README・`docs/setup.md`・`docs/release-readme.txt`・設計（architecture・security・api）の既定ポートと、ポートの変え方

## フェーズ 4c: Hub の起動の分離（ADR 0020）
- [x] T4c-1 ★ exe を GUI（ウィンドウなし）にしても、パイプ経由の標準入出力（`version`・`hook`・`channel` の MCP）が動くか → 動いた（PE のサブシステムを 3 から 2 へ。2026-10-12）。ターミナルの直接実行は出力が出ない（`| more` で受ける）
- [x] T4c-2 チャネルサーバーが Hub を起動しない（`ensureHub` を削除）。止まっていても落ちず、再接続する（AC-011-23）
- [x] T4c-3 `src/cli/start.mjs`: 引数なし・`start`（ウィンドウなし・切り離し・ログ `%LOCALAPPDATA%\coders-hub\hub.log`）（AC-011-20〜22）
- [x] T4c-4 `POST /api/shutdown` と画面の「Hub を終了」（AC-011-24・25、機能 006 の AC-UI-31）。試作にも反映
- [x] T4c-5 ビルド: exe を GUI にする（`scripts/pe-subsystem.mjs`）（AC-011-26）。Actions の動作確認を `start`・終了 API に変更
- [x] T4c-6 文書: README・`docs/setup.md`・`docs/release-readme.txt`・設計（architecture・security・api）
- [x] T4c-7 実機（ビルドした exe）: ダブルクリック相当でウィンドウなしの Hub が起動し、2 回目は何もせず、`/api/shutdown` で終了し、再起動されない
- [ ] T4c-8 本物の `claude` で、GUI の exe を使ったフック・チャネルサーバー（AC-011-12 に含む）

## フェーズ 4d: 個別の資産での配布（ADR 0022）
- [x] T4d-1 `scripts/package-release.mjs`: zip をやめ、`dist/release/` に、`coders-hub.exe`・`config.example.jsonc`・`README.txt`・`LICENSE`・`THIRD_PARTY_NOTICES.txt`・`SHA256SUMS.txt` を並べる（AC-011-2・3）
- [x] T4d-2 `release.yml`: `dist/release/*` を添付する（AC-011-1）
- [x] T4d-3 `config.example.jsonc` を追加（読まれない見本。上書きの懸念を避ける）。README・`release-readme.txt`・`setup.md` の入手と更新の手順

## フェーズ 4e: 設定ファイルのコメント（ADR 0023）
- [x] T4e-1 `stripJsonComments`（`//`・`/* */`・BOM）と、`config.json` の読み込み（AC-011-27）
- [x] T4e-2 見本を `config.example.jsonc`（コメントつき）にする。説明用のキー（`_説明`）はやめる

## フェーズ 4f: 起動時の案内（ADR 0024）
- [x] T4f-1 `src/cli/guide.mjs`（案内の本文と、cmd の start で別のコンソールのウィンドウに出す処理）、`waitForHub`、引数なしと `start` の分離（AC-011-28）
- [x] T4f-2 テスト（`tests/start.test.mjs`）。表示の仕組み（`start` で新しいコンソールが開き、`set /p` で待つ）を実機で確認
- [x] T4f-3 文書: README・`docs/setup.md`・`docs/release-readme.txt`（ダブルクリックと `start` の使い分け）
- [x] T4f-4 ビルドした exe のダブルクリック相当で、案内のウィンドウ（Windows Terminal）が出て、Hub が 1 つだけ動き、2 回目は「すでに起動しています」になることを確認。cmd が `start` を終えるまで待たないと、親の exe の終了で案内も消えるため、待つようにした。Enter キーでの閉じ方は、画面での目視は未確認

## フェーズ 5: 確認
- [x] T5-1 テスト（サブコマンド・アセット配信・設定の生成・自動起動）（AC-011-5〜11）
- [x] T5-2 開発時の動作が変わらないこと（`npm test`・`npm start`）（AC-011-13）
- [ ] T5-3 クリーンな Windows（Node なし）で、配布版を使った通しの確認（AC-011-12）
- [ ] T5-4 リリースの試行（プレリリースのタグ）
