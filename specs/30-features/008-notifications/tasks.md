# 008 通知（音と点滅） タスク

- 対応 plan: ./plan.md

- [x] T1 `src/web/notify.mjs`: 設定の既定・検証・出来事の検出（AC-NT-1〜4、AC-NT-10）
- [x] T2 通知のくり返しと音・点滅（`createNotifier`）（AC-NT-5〜8）
- [x] T3 メニューの設定（音量・ミュート・点滅・続ける時間）と、点滅の重ね（AC-NT-9）
- [x] T4 `main.mjs` に組み込む（出来事の検出・設定の保存・操作で止める）（AC-NT-10、AC-NT-11）
- [x] T5 テスト（AC-NT-1〜11）
- [ ] T6 実機の確認: 音が聞こえる、点滅が見える、止まる（`acceptance.md`）
- [x] T7 サイドバーの目印（2026-10-13 追加）: `notify.mjs` の `detectMarks`、`logic.mjs` の `bestMark`、行・折りたたんだ見出しへの点の表示、選ぶと消える結線（`main.mjs`）（AC-NT-12〜14）
- [ ] T8 実機の確認: 点がつく・折りたたみに伝わる・開くと消える（`acceptance.md`）
