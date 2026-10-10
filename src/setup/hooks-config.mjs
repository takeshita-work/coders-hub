// 各アカウントの settings.json に追加するフック設定を作る。
// 使うフックは plan.md の状態遷移表のうち、状態を動かすものだけ（PreToolUse・Notification は使わない）。

export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PermissionRequest',
  'PostToolUse',
  'Stop',
  'SessionEnd',
]

// 質問用フックの待ち時間の上限（秒）。Hub の待ち時間（既定 85 秒）より長くする（機能 003、ADR 0014）
export const ASK_HOOK_TIMEOUT_SEC = 100

// hookPath: hook.mjs の絶対パス。Windows のパスはバックスラッシュを / にして、シェルで壊れないようにする
// askHookPath: ask-hook.mjs の絶対パス。渡すと、AskUserQuestion に答えるための同期フックを PermissionRequest に足す
export const buildHooksConfig = (hookPath, askHookPath = null) => {
  const nodeCommand = (file) => `node "${file.replaceAll('\\', '/')}"`
  const entry = [{ hooks: [{ type: 'command', command: nodeCommand(hookPath), async: true }] }]
  const hooks = Object.fromEntries(HOOK_EVENTS.map((event) => [event, [...entry]]))
  if (askHookPath) {
    // 同期（async なし）。答えを標準出力で返すため
    hooks.PermissionRequest.push({
      matcher: 'AskUserQuestion',
      hooks: [{ type: 'command', command: nodeCommand(askHookPath), timeout: ASK_HOOK_TIMEOUT_SEC }],
    })
  }
  return { hooks }
}
