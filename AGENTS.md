# AGENTS.md

Coders Hub: 複数の AI コーディングエージェント（まず Claude Code）のセッションを一か所で監視・操作する Web アプリ。
仕様駆動開発（SDD）で進める。仕様は `specs/` が唯一の正。

## 仕様の入口
- 全体像: `specs/README.md`
- 目的・用語: `specs/00-product/`
- 要件（REQ-xxx）: `specs/10-requirements/`
- 全体設計: `specs/20-design/`
- 機能単位の仕様・計画・タスク: `specs/30-features/`
- 設計判断の記録: `specs/adr/`
- Claude Code の仕組みの調査メモ: `docs/research/claude-code-mechanisms.md`（仕様ではなく参考情報）
- セットアップ手順（下書き）: `docs/setup.md`
- 実装前の参考コード（未検証）: `docs/research/reference-code.md`

## 開発ルール
1. 実装前に、対象機能の `spec.md` / `plan.md` と、関連する `REQ-xxx` / ADR を読む。
2. 仕様と食い違う実装が必要になったら、コードを先に変えず、**spec の修正を提案してから**進める。
3. 仕様変更と実装は同じ変更（PR）に含める。
4. 方式を変える・重要な判断をするときは ADR を新規追加する。既存 ADR は書き換えず、`Superseded by` で置き換える。
5. 用語は `specs/00-product/glossary.md` に合わせる。
6. 受け入れ条件（`AC-xxx`）はテストから参照できるようにする。
7. 未検証の前提は `specs/10-requirements/open-questions.md` に載せ、決まったら ADR 化して消す。
