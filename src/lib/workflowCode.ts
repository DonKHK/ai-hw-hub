/**
 * Portal workflow 嘅 code 係 UUID（36 字元），太長唔適合喺 UI 顯示。
 * 本機 inventory 嘅 code 係短嘅（例：1A-001），顯示冇問題。
 */

/** 係唔係「太長唔應該喺 UI 顯示」嘅 code（門檻 12 字元）。 */
export function isLongWorkflowCode(code: string): boolean {
  return code.length > 12
}
