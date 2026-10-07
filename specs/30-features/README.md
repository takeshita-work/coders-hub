# 機能単位の仕様

1 機能 = 1 フォルダ（`NNN-名前/`）。`_template/` をコピーして始める。

```
30-features/
├── _template/
├── 001-session-list/        # REQ-001, 008, 010（MVP）
├── 002-send-instruction/    # REQ-002, 003, 005
├── 003-permission-relay/    # REQ-004, 005
├── 004-transcript-view/     # REQ-007
└── 005-remote-access/       # REQ-006
```

上記は案。MVP の `001-session-list` から、着手するときにフォルダを作る。

## 進め方
1. `spec.md`（何を・なぜ・受け入れ条件）を書いて合意する → Approved
2. `plan.md`（どう作るか）を書く
3. `tasks.md`（実装タスク）に分解する
4. 実装・テスト後、`spec.md` を Implemented にする
