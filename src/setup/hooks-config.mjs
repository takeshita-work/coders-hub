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

// hookPath: hook.mjs の絶対パス。Windows のパスはバックスラッシュを / にして、シェルで壊れないようにする
export const buildHooksConfig = (hookPath) => {
  const command = `node "${hookPath.replaceAll('\\', '/')}"`
  const entry = [{ hooks: [{ type: 'command', command, async: true }] }]
  return { hooks: Object.fromEntries(HOOK_EVENTS.map((event) => [event, entry])) }
}
