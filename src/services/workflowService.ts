import {
  findWorkflowByCode,
  getAllFlows,
  getFlowsForUnit,
} from '../lib/localInventory'
import type { LocalInventoryItem } from '../lib/localInventory'
import type { Access } from '../lib/access'
import { describeStoreError } from '../lib/firestoreError'
import {
  fetchAllPortalWorkflows,
  fetchPortalWorkflowsForUnit,
  isPortalConfigured,
} from './portalWorkflows'
import {
  isPortalStoreReady,
  listStoredPortalWorkflows,
} from './portalWorkflowStore'
import type { StoredPortalWorkflow } from './portalWorkflowStore'

/**
 * 睇 Workflow —— **三層來源**：
 *   ① Firestore 快照 `portalWorkflows`（主要；由 Firebase superadmin 同步）
 *   ② 即時 AAI Portal Supabase（只有 superadmin 未同步時先讀）
 *   ③ 本機 `src/lib/localInventory.ts`（冇 Firebase 時嘅開發 fallback）
 *
 * 範圍（跟 src/lib/access.ts）：
 * - workflowScope 'all'  → 全部
 * - workflowScope 'unit' → 只自己部門（精確名 → prefix fallback）
 * - workflowScope 'none' → 完全冇
 */

export interface WorkflowItem {
  code: string
  name: string
  unit?: string
  /** 以下係 Portal 帶落嚟嘅額外資料（本機 fallback 冇） */
  ownerName?: string
  frequency?: string
  painPoint?: string
  aiOpportunity?: string
  priorityScore?: number
}

/** UI 用嚟決定顯示邊種空狀態。 */
export type WorkflowFetchReason =
  | 'ok'
  | 'no-workflow-access'
  | 'unit-empty'
  | 'unit-no-data'
  | 'no-data'

export interface WorkflowFetchResult {
  ok: boolean
  items: WorkflowItem[]
  error?: string
  /** 俾人睇嘅訊息（人話，唔會提到 code 檔名） */
  note?: string
  /** 機器可讀原因（成功有資料時係 'ok'） */
  reason: WorkflowFetchReason
  /** 資料由邊度嚟 */
  source: 'firestore' | 'portal' | 'local'
  /** source === 'firestore' 時：快照上次同步時間（Unix 毫秒） */
  syncedAt?: number
}

function toWorkflowItem(row: StoredPortalWorkflow): WorkflowItem {
  return {
    code: row.code,
    name: row.name,
    unit: row.unit,
    ownerName: row.ownerName,
    frequency: row.frequency,
    painPoint: row.painPoint,
    aiOpportunity: row.aiOpportunity,
    priorityScore: row.priorityScore,
  }
}

/** 由 Firestore 快照過濾出 access 睇得到嘅 workflow。 */
function fromStored(
  stored: StoredPortalWorkflow[],
  access: Access,
): WorkflowFetchResult {
  const syncedAt = stored.reduce((max, row) => Math.max(max, row.syncedAt), 0)

  if (access.workflowScope === 'all') {
    return {
      ok: true,
      items: stored.map(toWorkflowItem),
      reason: 'ok',
      source: 'firestore',
      syncedAt,
    }
  }

  const unitKey = access.unit?.trim() ?? ''
  if (unitKey === '') {
    return {
      ok: true,
      items: [],
      reason: 'unit-empty',
      source: 'firestore',
      syncedAt,
      note: 'Your account is not linked to a unit.',
    }
  }

  // 精確名 → prefix（同讀 Portal 時一致：「Finance」→「Finance - Account」）
  const key = unitKey.toLowerCase()
  let matched = stored.filter((row) => row.unit.toLowerCase() === key)
  if (matched.length === 0) {
    matched = stored.filter((row) => row.unit.toLowerCase().startsWith(key))
  }
  if (matched.length === 0) {
    return {
      ok: true,
      items: [],
      reason: 'unit-no-data',
      source: 'firestore',
      syncedAt,
      note: `The snapshot has no workflows for "${unitKey}".`,
    }
  }
  return {
    ok: true,
    items: matched.map(toWorkflowItem),
    reason: 'ok',
    source: 'firestore',
    syncedAt,
  }
}

/** 即時讀 AAI Portal Supabase。 */
async function livePortalFetch(access: Access): Promise<WorkflowFetchResult> {
  const portal =
    access.workflowScope === 'unit' && access.unit !== undefined
      ? await fetchPortalWorkflowsForUnit(access.unit)
      : await fetchAllPortalWorkflows()

  if (portal.matchKind === 'none') {
    return {
      ok: true,
      items: [],
      reason: 'unit-no-data',
      source: 'portal',
      note: portal.note ?? 'AAI Portal has no such unit.',
    }
  }
  return {
    ok: true,
    items: portal.items,
    reason: portal.items.length === 0 ? 'unit-no-data' : 'ok',
    source: 'portal',
    note: portal.items.length === 0 ? portal.note : undefined,
  }
}

/** 本機 inventory（fallback）。 */
function localFetch(access: Access): WorkflowFetchResult {
  const mapItem = (item: LocalInventoryItem): WorkflowItem => ({
    code: item.code,
    name: item.name,
    unit: item.unit,
  })

  if (access.workflowScope === 'none') {
    return {
      ok: true,
      items: [],
      reason: 'no-workflow-access',
      source: 'local',
      note: 'Admin accounts are for admin / view-only use and have no workflows. To load your unit\'s workflows, sign in with an "AAI Portal identity" instead.',
    }
  }

  if (access.workflowScope === 'unit') {
    const unitName = access.unit?.trim() ?? ''
    if (unitName === '') {
      return {
        ok: true,
        items: [],
        reason: 'unit-empty',
        source: 'local',
        note: 'Your account is not linked to a unit, so no workflows can be loaded.',
      }
    }
    const flows = getFlowsForUnit(unitName)
    if (flows.length === 0) {
      return {
        ok: true,
        items: [],
        reason: 'unit-no-data',
        source: 'local',
        note: `Your unit (${unitName}) has not been added to the workflow list yet.`,
      }
    }
    return { ok: true, items: flows.map(mapItem), reason: 'ok', source: 'local' }
  }

  const all = getAllFlows()
  if (all.length === 0) {
    return {
      ok: true,
      items: [],
      reason: 'no-data',
      source: 'local',
      note: 'There is no workflow data yet.',
    }
  }
  return {
    ok: true,
    items: all.map(mapItem),
    reason: 'ok',
    source: 'local',
  }
}

/** 主入口：按三層來源攞 workflow。 */
export async function fetchWorkflowsForAccess(
  access: Access,
): Promise<WorkflowFetchResult> {
  if (access.workflowScope === 'none') {
    return {
      ok: true,
      items: [],
      reason: 'no-workflow-access',
      source: 'firestore',
      note: 'This identity has no workflows.',
    }
  }

  // 冇 Firebase（開發模式）→ 本機 inventory
  if (!isPortalStoreReady()) {
    return localFetch(access)
  }

  // ① Firestore 快照
  let stored: StoredPortalWorkflow[]
  try {
    stored = await listStoredPortalWorkflows()
  } catch (error) {
    return {
      ok: true,
      items: [],
      reason: 'no-data',
      source: 'firestore',
      note: `Cannot read the Firestore workflow snapshot. ${describeStoreError(error)}`,
    }
  }

  if (stored.length > 0) {
    return fromStored(stored, access)
  }

  // 快照係空 → superadmin 可以即時讀 Portal；其他人等同步
  if (access.canPullFromPortal && isPortalConfigured()) {
    try {
      return await livePortalFetch(access)
    } catch (error) {
      return {
        ok: true,
        items: [],
        reason: 'no-data',
        source: 'portal',
        note: `Cannot reach AAI Portal: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      }
    }
  }

  return {
    ok: true,
    items: [],
    reason: 'no-data',
    source: 'firestore',
    note: 'The administrator has not synced the workflow data yet. Ask the Firebase Superadmin to sign in → Workflows → click "Sync workflows from AAI Portal to Firestore".',
  }
}

/**
 * 用 code 清單還原 workflow。
 *
 * ⚠️ 一定要用呢個，而**唔好**直接 call `findWorkflowByCode`：
 *    Portal workflow 嘅 code 係 UUID，而 LOCAL_INVENTORY 只有 I&DD 嘅
 *    1A-001…，直接查會全部搵唔到 → AI 計劃頁誤報「冇揀到任何 workflow」。
 *
 * 次序：① Firestore 快照（主要）→ ② 本機 inventory（冇 Firebase 嘅開發 fallback）
 */
export async function resolveWorkflowsByCodes(
  codes: string[],
): Promise<WorkflowItem[]> {
  const unique = [
    ...new Set(codes.map((code) => code.trim()).filter((code) => code !== '')),
  ]
  if (unique.length === 0) {
    return []
  }

  const fromStore = new Map<string, WorkflowItem>()
  if (isPortalStoreReady()) {
    try {
      for (const row of await listStoredPortalWorkflows()) {
        fromStore.set(row.code, toWorkflowItem(row))
      }
    } catch {
      // 讀唔到快照（權限／離線）→ 淨係靠本機 inventory
    }
  }

  const items: WorkflowItem[] = []
  for (const code of unique) {
    const stored = fromStore.get(code)
    if (stored !== undefined) {
      items.push(stored)
      continue
    }
    const local = findWorkflowByCode(code)
    if (local !== undefined) {
      items.push({ code: local.code, name: local.name, unit: local.unit })
    }
  }
  return items
}


