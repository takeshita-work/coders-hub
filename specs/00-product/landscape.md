# 類似ツール

- ステータス: Draft

| ツール | 特徴 | 今回の要件との差 |
|---|---|---|
| cliq/claude-monitor | 複数の設定ディレクトリに対応した監視 | 介入機能・Windows 対応は要確認 |
| bruceyxli/claude-code-monitor | 複数 IDE をまたぐ監視、PreToolUse によるリモート承認 | `~/.claude` のみ対象 |
| onikan27/claude-code-monitor | スマホからの操作 | macOS 専用 |
| sverrirsig/claude-control | デスクトップダッシュボード | macOS 専用 |
| claude-view / augml/claude-code-ui | 閲覧・分析中心 | 介入機能なし |
| Agent View（公式） | `claude agents` による一覧と指示送信 | 主にバックグラウンドセッション対象 |
| interlink-mcp | Channels と asyncRewake の両方式を実装 | 実装の参考になる |

## 自作する理由
個人利用で、学習と自分好みの仕様にすることが目的。既存ツールで足りる場合でも、自作すること自体に価値がある。差別化や公開は目的にしない。

## 参考にする点
- interlink-mcp: Channels と asyncRewake の両方式の実装
- bruceyxli/claude-code-monitor: PreToolUse によるリモート承認、複数 IDE をまたぐ監視
- cliq/claude-monitor: 複数の設定ディレクトリの扱い
