import { collection, doc, getDocs, writeBatch } from 'firebase/firestore'
import type { Firestore } from 'firebase/firestore'
import { db, isFirebaseConfigured } from '../firebase/config'
import { withoutUndefined } from '../lib/firestoreData'
import { fetchAllPortalWorkflows } from './portalWorkflows'

/**
 * AAI Portal workflow **快照**（Firestore collection `portalWorkflows`）。
 *
 * 點解要有快照：
 *   1. 唔使每次開頁都打 Portal Supabase（快 + 穩定）
 *   2. Portal 掛咗都照用
 *   3. **只有 Firebase superadmin 負責「抽」**，其他身份一律由快照讀
 *
 * Doc ID = Portal workflow 嘅 UUID（同 app 嘅 workflowCode 一樣）
 * → sync 係天然 upsert，重複 sync 都安全。
 */

const STORE_COLLECTION = 'portalWorkflows'

/** 一次 batch 最多寫幾多份（Firestore limit 500，留 buffer）。 */
const BATCH_SIZE = 400

export interface StoredPortalWorkflow {
  code: string
  name: string
  unit: string
  ownerName?: string
  frequency?: string
  painPoint?: string
  aiOpportunity?: string
  priorityScore?: number
  /** 幾時 sync 落嚟（Unix 毫秒） */
  syncedAt: number
}

export interface SyncResult {
  count: number
  syncedAt: number
}

export function isPortalStoreReady(): boolean {
  return isFirebaseConfigured() && db !== null
}

function firestore(): Firestore {
  if (db === null) {
    throw new Error('Firebase is not configured (missing .env).')
  }
  return db
}

function toText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined
}

function toStored(
  id: string,
  data: Record<string, unknown>,
): StoredPortalWorkflow | null {
  const name = toText(data.name)
  const unit = toText(data.unit)
  if (name === undefined || unit === undefined) {
    return null
  }
  return {
    code: id,
    name,
    unit,
    ownerName: toText(data.ownerName),
    frequency: toText(data.frequency),
    painPoint: toText(data.painPoint),
    aiOpportunity: toText(data.aiOpportunity),
    priorityScore:
      typeof data.priorityScore === 'number' ? data.priorityScore : undefined,
    syncedAt: typeof data.syncedAt === 'number' ? data.syncedAt : 0,
  }
}

/**
 * 快照快取（module-level）。
 * 為咗唔使「Workflows 頁讀一次 363 份、AI 計劃頁又再讀一次」——
 * sync 完會 invalidate，所以唔會攞到舊資料。
 */
let rowsCache: StoredPortalWorkflow[] | null = null

/** 清快取（sync 完之後一定要叫）。 */
export function invalidatePortalStoreCache(): void {
  rowsCache = null
}

/** 讀全部快照（按單位／名稱排序）。第一次讀完會 cache 起。 */
export async function listStoredPortalWorkflows(): Promise<
  StoredPortalWorkflow[]
> {
  if (rowsCache !== null) {
    return rowsCache
  }
  const snapshot = await getDocs(collection(firestore(), STORE_COLLECTION))
  const rows = snapshot.docs
    .map((item) =>
      toStored(item.id, (item.data() ?? {}) as Record<string, unknown>),
    )
    .filter((row): row is StoredPortalWorkflow => row !== null)
    .sort((a, b) => `${a.unit}|${a.name}`.localeCompare(`${b.unit}|${b.name}`))
  rowsCache = rows
  return rows
}

/**
 * 🔄 由 AAI Portal 抽**全部** workflow，寫入 Firestore 快照。
 * 只有 Firebase superadmin 應該撳（UI gate）。
 */
export async function syncPortalWorkflowsToFirestore(): Promise<SyncResult> {
  const store = firestore()
  const portal = await fetchAllPortalWorkflows()
  if (!portal.ok) {
    throw new Error(portal.error ?? 'Failed to read AAI Portal.')
  }

  const syncedAt = Date.now()
  const col = collection(store, STORE_COLLECTION)
  let batch = writeBatch(store)
  let pending = 0

  for (const item of portal.items) {
    // ⚠️ 一定要 withoutUndefined：Portal 部分欄位係空字串，
    //    toText() 會轉成 undefined，直接寫入 Firestore 會 throw。
    batch.set(
      doc(col, item.code),
      withoutUndefined({
        code: item.code,
        name: item.name,
        unit: item.unit,
        ownerName: item.ownerName,
        frequency: item.frequency,
        painPoint: item.painPoint,
        aiOpportunity: item.aiOpportunity,
        priorityScore: item.priorityScore,
        syncedAt,
      }),
    )
    pending += 1
    if (pending >= BATCH_SIZE) {
      await batch.commit()
      batch = writeBatch(store)
      pending = 0
    }
  }
  if (pending > 0) {
    await batch.commit()
  }

  // 快照已經變咗 → 清快取，等下一次讀攞到新資料
  invalidatePortalStoreCache()

  return { count: portal.items.length, syncedAt }
}
