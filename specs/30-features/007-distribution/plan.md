# 007 配布 実装計画

- ステータス: Approved
- 対応 spec: ./spec.md
- 関連 ADR: 0018

## 方針
コードの動作は変えず、**入口の形・画面ファイルの配り方・Hub の自動起動・設定の生成**を、exe 向けに整える。ビルドは、esbuild で、CommonJS の 1 本にまとめ、Node の SEA で exe にする。Actions が、タグからリリースまで自動で行う。

```
src/cli/main.mjs ─┐ (サブコマンドで振り分け)
  hub / hook / ask-hook / channel / setup / version
        │ esbuild（CommonJS・1 本）
        ▼
   dist/exe/coders-hub.cjs ── Node SEA（画面のファイルをアセットとして埋め込み）──► coders-hub.exe
```

## 変更

| 部品 | 変更 |
|---|---|
| `src/cli/main.mjs`（新規） | 引数でサブコマンドを振り分ける。各入口は、関数（`run()`）として呼ぶ |
| `src/hub/main.mjs`・`src/channel/channel.mjs`・`src/hook/hook.mjs`・`src/hook/ask-hook.mjs` | 最上位の `await` を、`async` 関数（`run`）に包む。ファイルを直接実行したときの動作（`node src/…`）は、これまでどおり |
| `src/hub/hub.mjs` | 画面の配信元を差し替えられるようにする（フォルダ／SEA のアセット）。アセットは、リストにあるものだけを返す（フォルダの外を返さない。AC-011-7） |
| `src/shared/hub-client.mjs` | Hub の自動起動を、「`process.execPath` が SEA の exe なら、`<exe> hub`、そうでなければ、`node src/hub/main.mjs`」にする |
| `src/setup/*` | 設定の生成部品を、`print-setup.mjs` と `coders-hub.exe setup` の両方が使う（exe のパスを渡す） |
| `scripts/build-exe.mjs`（新規） | ① 画面をビルド ② esbuild で CommonJS にまとめる ③ SEA の設定を作り、blob を作る ④ `node.exe` を複製して `postject` で注入 ⑤ 動作確認 |
| `.github/workflows/release.yml`（新規） | タグ `v*` で、Windows のランナー・Node 22 固定で、テスト → ビルド → 資産の作成（zip にはしない。ADR 0022）→ SHA-256 → リリースの作成と添付 |
| `README.txt`・`LICENSE`・`config.example.json`・`SHA256SUMS.txt` | 資産として添付する。README は、`docs/setup.md` を元にした、利用者向けの短い版 |

## 実機で確認した制約（ADR 0018）
- Node 22 の SEA は、CommonJS のメインだけ。最上位の `await` を持つ ESM は、そのままでは束ねられない → 入口の `async` 化
- `ws` の任意の依存（`bufferutil`・`utf-8-validate`）は、外部扱いにして束ねない（無くても動く）
- `import.meta.url` を使う箇所（`hub.mjs`・`hub-client.mjs`）は、束ねたあとは使えない → パスの決め方を、SEA のときと、開発時で分ける

## リスクと確認
- **SEA の画面アセット**: `sea.getAsset` で取り出して配信する。Content-Type の対応と、パスの検査を、テストで確認する
- **Hub の多重起動**: exe の `hub` と、`node` 版が、同じポートで競合しないこと（NFR-005 のポート排他は、そのまま効く）
- **フックの起動時間**: exe の起動（約 88 MB の読み込み）が、フックの時間に収まるか。実機で計測する（`node` 版は 20〜50ms）
- **誤検知**: 署名なしの exe が、ウイルス対策ソフトに検知されないか、複数の環境で確認する
- **リリースの作成**: 実際のタグで、Actions が通ること。失敗したときに、リリースが中途半端に残らないこと（ドラフトで作り、最後に公開）
