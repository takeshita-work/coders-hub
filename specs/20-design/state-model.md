# 状態モデル

- ステータス: Draft

## セッションの状態

| 状態 | 遷移のきっかけ |
|---|---|
| 作業中 | `UserPromptSubmit`（許可後は `PostToolUse`） |
| 返答待ち | `Stop`。許可の拒否・Esc による中断は、会話ログ（ADR 0007）と状態ファイル（ADR 0009）で補う |
| 許可待ち | `PermissionRequest`（`Notification` は約 6 秒遅れるので使わない） |
| 質問待ち | `PermissionRequest` のうち、`tool_name` が `AskUserQuestion` のもの（ADR 0010） |

状態の主はフック（ADR 0003）。ずれの補正は、`claude` 自身の状態ファイル `sessions/<pid>.json` の `status`（ADR 0009）と、会話ログ（ADR 0007）。遷移表と詳細は `../30-features/001-session-list/plan.md`。指示送信・許可応答の中継（Channels）は「次」の段階。

遷移図は後で追加する（`drawio` スキルで作成可）。

## ターミナル操作との共存

### 指示の送信
- Hub 本体がセッションごとに「作業中／待機中」を管理する
- アプリからの指示は、待機中のセッションにだけ渡す
- 作業中に送られた指示は、本体で保留して次の待機に渡す（REQ-003）

```
UserPromptSubmit フック → 本体: 作業中にする／古い待機に superseded を返して終了させる
Stop フック（asyncRewake）→ 本体: 待機中にする／保留中の指示があればすぐ渡す
```

### 許可プロンプト

| 方式 | 共存性 |
|---|---|
| Channels の許可中継 | ターミナルとアプリの両方に出て、先に返った回答が使われる（完全な共存） |
| PermissionRequest フック（同期） | 応答待ちの間ターミナルで応答できない。短いタイムアウトで、応答がなければターミナルに任せる |
| Notification フック | 通知のみ。ターミナル操作を邪魔しない |

## 要検証
`../10-requirements/open-questions.md` を参照。
