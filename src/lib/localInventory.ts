/**
 * 本機 per-unit workflow inventory。
 *
 * 來源：由 AAI AI Homework Portal 匯出嘅「1A Saved Workflow Inventory」。
 *
 * 而家嘅實際流程已經變成（見 src/services/workflowService.ts）：
 *   ① Firebase superadmin 抽 AAI Portal → Firestore 快照 `portalWorkflows`（主要來源）
 *   ② 部門登入後由快照讀（跟 login 揀咗嘅身份過濾）
 *   ③ 呢份 inventory 只係【冇 Firebase 時嘅開發 fallback】——
 *      唔會再喺 UI 出現「抽取 Workflow」掣。
 *
 * 想加更多單位：喺下面 LOCAL_INVENTORY 加 entries，單位名一定要同
 * login dropdown（src/lib/portalData.ts 嘅 PORTAL_IDENTITIES）顯示名一模一樣。
 */

export interface LocalInventoryItem {
  unit: string // portal 顯示名（login dropdown 都用緊嗰個）
  code: string // 例：1A-001
  name: string // workflow name
}

export const LOCAL_INVENTORY: LocalInventoryItem[] = [
  // ---- Innovation and Development Department (I&DD) ----
  {
    unit: 'Innovation and Development Department (I&DD)',
    code: '1A-001',
    name: 'Government Funding Opportunity Assessment',
  },
  {
    unit: 'Innovation and Development Department (I&DD)',
    code: '1A-002',
    name: 'Innovation Project Commercialization & Handover',
  },
  {
    unit: 'Innovation and Development Department (I&DD)',
    code: '1A-003',
    name: 'Innovation Project Development & Gate Review',
  },
  {
    unit: 'Innovation and Development Department (I&DD)',
    code: '1A-004',
    name: 'Innovation Project Feasibility & POC',
  },
  {
    unit: 'Innovation and Development Department (I&DD)',
    code: '1A-005',
    name: 'Internal Inno Idea Submission',
  },
]

/** 搵指定單位嘅 workflow（跟 login 身份顯示名，case-insensitive）。 */
export function getFlowsForUnit(unitName: string): LocalInventoryItem[] {
  const key = unitName.trim()
  return LOCAL_INVENTORY.filter(
    (item) =>
      item.unit === key || item.unit.toLowerCase() === key.toLowerCase(),
  ).sort((a, b) => a.code.localeCompare(b.code))
}

/** 全部 workflow（CEO／Steering 用）。 */
export function getAllFlows(): LocalInventoryItem[] {
  return [...LOCAL_INVENTORY].sort((a, b) =>
  `${a.unit}|${a.code}`.localeCompare(`${b.unit}|${b.code}`),
  )
}

/** 用 code 搵 workflow（跨單位），例如 "1A-001"。 */
export function findWorkflowByCode(
  code: string,
): LocalInventoryItem | undefined {
  return LOCAL_INVENTORY.find((item) => item.code === code)
}
