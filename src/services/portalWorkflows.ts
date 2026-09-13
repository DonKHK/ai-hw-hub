/**
 * AAI AI Homework Portal（Supabase）—— workflow 清單來源。
 *
 * 點解可以直接由前端讀：
 *   - Supabase 嘅 **publishable key** 設計上就係公開（會出現喺前端 bundle）
 *   - 而且呢個 key 本來已經出現喺 portal 自己嘅 public JS bundle
 *   - Portal 嘅 RLS 亦允許公開讀取（實測 HTTP 200 + CORS OK）
 *
 * ⚠️ 代價：任何人有呢個 key 都讀得到 portal 嘅資料。
 *
 * 用純 fetch 打 PostgREST —— **唔需要**裝 @supabase/supabase-js。
 * ⚠️ 一定要用 `apikey` header（當 Bearer 用會 401）。
 *
 * 真實 schema（實測）：
 *   ai_units           { id, name, kind, group_name }
 *   workflow_inventory { id, unit_id, workflow_name, owner_name, frequency,
 *                        pain_point, ai_opportunity, priority_score, … }
 *
 * Mapping：登入部門名 → ai_units.name → ai_units.id → workflow_inventory.unit_id
 */

function envValue(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? fallback : trimmed
}

// ⚠️ Portal 位址唔硬編碼 —— 內部 Supabase URL 唔應該入 repo。
//    冇設定時 SUPABASE_URL = ''，配合 isPortalConfigured() 會自動
//    fallback 去本機 inventory（src/lib/localInventory.ts）。
const SUPABASE_URL = envValue(import.meta.env.VITE_PORTAL_SUPABASE_URL, '')
const SUPABASE_KEY = envValue(import.meta.env.VITE_PORTAL_SUPABASE_ANON_KEY, '')
const UNITS_TABLE = envValue(
  import.meta.env.VITE_PORTAL_UNITS_TABLE,
  'ai_units',
)
const WORKFLOWS_TABLE = envValue(
  import.meta.env.VITE_PORTAL_WORKFLOWS_TABLE,
  'workflow_inventory',
)
const UNIT_COL = envValue(import.meta.env.VITE_PORTAL_UNIT_COL, 'unit_id')
const UNIT_NAME_COL = envValue(import.meta.env.VITE_PORTAL_UNIT_NAME_COL, 'name')

/**
 * 有冇設定 Portal（**URL + key 兩樣都要有**）。
 * ⚠️ 只有 key 冇 URL 會打去相對路徑 → 一定失敗，所以當「未設定」處理，
 *    自動 fallback 去本機 inventory（src/lib/localInventory.ts）。
 */
export function isPortalConfigured(): boolean {
  return SUPABASE_URL !== '' && SUPABASE_KEY !== ''
}

export interface PortalUnit {
  id: string
  name: string
}

export interface PortalWorkflowItem {
  /** ★ Portal 嘅 UUID（workflow_inventory.id） */
  code: string
  name: string
  /**
   * 用返「登入時嘅部門名」（唔用 Portal 嘅 split 名），
   * 令 dashboard 單位分組同 AI 計劃嘅 unit 保持一致。
   */
  unit: string
  ownerName?: string
  frequency?: string
  painPoint?: string
  aiOpportunity?: string
  priorityScore?: number
}

export interface PortalWorkflowResult {
  ok: boolean
  items: PortalWorkflowItem[]
  note?: string
  error?: string
  /** 用邊種方式配對到單位 */
  matchKind?: 'exact' | 'prefix' | 'all' | 'none'
  /** 配對到嘅 Portal 單位名（prefix match 時會多過一個） */
  matchedUnits?: string[]
}

function portalHeaders(): Record<string, string> {
  return { apikey: SUPABASE_KEY }
}

function toText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

let unitsCache: PortalUnit[] | null = null

/** 攞 Portal 全部單位（cache 喺模組度，一次 session 只打一次）。 */
export async function listPortalUnits(): Promise<PortalUnit[]> {
  if (unitsCache !== null) {
    return unitsCache
  }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${UNITS_TABLE}?select=id,${UNIT_NAME_COL}`,
    { headers: portalHeaders(), cache: 'no-store' },
  )
  if (!res.ok) {
    throw new Error(`Failed to read AAI Portal units: HTTP ${res.status}`)
  }
  const rows = (await res.json()) as Array<Record<string, unknown>>
  unitsCache = rows
    .map((row) => ({
      id: typeof row.id === 'string' ? row.id : '',
      name: toText(row[UNIT_NAME_COL]) ?? '',
    }))
    .filter((unit) => unit.id !== '' && unit.name !== '')
  return unitsCache
}

/** 唔好抽已封存嘅 workflow（實測 Portal 有 2 條 is_archived = true）。 */
const ACTIVE_FILTER = 'is_archived=eq.false'

/** 部門名 → 對應嘅 Portal 單位（精確 → prefix）。 */
function matchUnits(
  units: PortalUnit[],
  unitName: string,
): { matched: PortalUnit[]; kind: 'exact' | 'prefix' | 'none' } {
  const key = unitName.trim().toLowerCase()
  if (key === '') {
    return { matched: [], kind: 'none' }
  }
  const exact = units.filter((unit) => unit.name.toLowerCase() === key)
  if (exact.length > 0) {
    return { matched: exact, kind: 'exact' }
  }
  // Portal 有啲單位會 split（例：「Finance」→「Finance - Account」／「Finance - Construction」）
  const prefix = units.filter((unit) =>
    unit.name.toLowerCase().startsWith(key),
  )
  if (prefix.length > 0) {
    return { matched: prefix, kind: 'prefix' }
  }
  return { matched: [], kind: 'none' }
}

const WORKFLOW_SELECT =
  'id,workflow_name,owner_name,frequency,pain_point,ai_opportunity,priority_score,unit_id'

function toPortalItems(
  rows: Array<Record<string, unknown>>,
  unitLabel: string | undefined,
  unitNames: Map<string, string>,
): PortalWorkflowItem[] {
  return rows
    .map((row) => {
      const unitId = typeof row[UNIT_COL] === 'string' ? row[UNIT_COL] : ''
      return {
        code: typeof row.id === 'string' ? row.id : '',
        name: toText(row.workflow_name) ?? '',
        unit: unitLabel ?? unitNames.get(unitId) ?? '',
        ownerName: toText(row.owner_name),
        frequency: toText(row.frequency),
        painPoint: toText(row.pain_point),
        aiOpportunity: toText(row.ai_opportunity),
        priorityScore: toNumber(row.priority_score),
      }
    })
    .filter((item) => item.code !== '' && item.name !== '')
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 按登入部門名攞 workflow（精確 → prefix fallback）。 */
export async function fetchPortalWorkflowsForUnit(
  unitName: string,
): Promise<PortalWorkflowResult> {
  const units = await listPortalUnits()
  const { matched, kind } = matchUnits(units, unitName)
  if (matched.length === 0 || kind === 'none') {
    return {
      ok: true,
      items: [],
      matchKind: 'none',
      note: `AAI Portal has no unit named "${unitName}".`,
    }
  }
  const idList = matched.map((unit) => unit.id).join(',')
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${WORKFLOWS_TABLE}?select=${WORKFLOW_SELECT}&${UNIT_COL}=in.(${idList})&${ACTIVE_FILTER}`,
    { headers: portalHeaders(), cache: 'no-store' },
  )
  if (!res.ok) {
    throw new Error(`Failed to read AAI Portal workflows: HTTP ${res.status}`)
  }
  const rows = (await res.json()) as Array<Record<string, unknown>>
  return {
    ok: true,
    items: toPortalItems(rows, unitName, new Map()),
    matchKind: kind,
    matchedUnits: matched.map((unit) => unit.name),
  }
}

/** 全部單位嘅 workflow（Portal CEO / Read-only Steering）。 */
export async function fetchAllPortalWorkflows(): Promise<PortalWorkflowResult> {
  const units = await listPortalUnits()
  if (units.length === 0) {
    return {
      ok: true,
      items: [],
      matchKind: 'all',
      note: 'AAI Portal has no unit data.',
    }
  }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${WORKFLOWS_TABLE}?select=${WORKFLOW_SELECT}&${ACTIVE_FILTER}`,
    { headers: portalHeaders(), cache: 'no-store' },
  )
  if (!res.ok) {
    throw new Error(`Failed to read AAI Portal workflows: HTTP ${res.status}`)
  }
  const rows = (await res.json()) as Array<Record<string, unknown>>
  const unitNames = new Map(units.map((unit) => [unit.id, unit.name]))
  return {
    ok: true,
    items: toPortalItems(rows, undefined, unitNames),
    matchKind: 'all',
  }
}
