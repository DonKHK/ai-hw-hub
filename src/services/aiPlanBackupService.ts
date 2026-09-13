import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore'
import type { Firestore } from 'firebase/firestore'
import { db, isFirebaseConfigured } from '../firebase/config'

/**
 * 🛡️ 單位「重設」前嘅**自動備份**。
 *
 * 點解要有：重設係不可逆 —— 冇備份就刪，一撳錯就永遠冇咗。
 * 所以 `resetUnitData` 會【先備份，備份成功先刪】；
 * 備份失敗 = 直接中止，唔會刪任何嘢。
 *
 * 存放位置：**`aiPlanLogs`**（同活動紀錄同一個 collection）
 *   點解唔開新 collection：Firestore 規則係逐個 collection 寫嘅，而
 *   `aiPlanLogs` 已經 `allow write: if true`；開新 collection 就要人手
 *   去 Firebase Console 發布規則，否則備份一定失敗（實測過）。
 *
 *   備份文件點樣同真正 LOG 分開（兩重保險）：
 *     ① `backupKind`（'header' | 'plans' | 'logs'）→ `toLog()` 見到會
 *        過濾走，所以永遠唔會出現喺活動紀錄
 *     ② 用 `backupUnit` 而唔係 `unit` → 所有 `where('unit','==',…)`
 *        查詢天然唔會撞到備份文件
 *
 *   - header doc：（`backupKind: 'header'`）backupGroupId / backupUnit /
 *     backupAt / backupBy / backupPlanCount / backupLogCount
 *     —— **有 header 就代表備份完整**
 *   - chunk doc：（`backupKind: 'plans' | 'logs'`）backupIndex / backupItems
 *     每個 doc 控制喺 ~600KB 以下（Firestore 單文件上限 1 MiB）
 *
 * 還原方法：Firebase Console → Firestore → `aiPlanLogs`
 *   → 用 `backupGroupId` 篩出所有 doc → 將 `backupItems[].data`
 *   寫返 `aiPlans` / `aiPlanLogs`
 */

const BACKUP_COLLECTION = 'aiPlanLogs'
const PLANS_COLLECTION = 'aiPlans'
const LOGS_COLLECTION = 'aiPlanLogs'

/** 每份備份 doc 最多幾多 bytes（1 MiB 上限，留大 buffer）。 */
const CHUNK_BYTES = 600_000

export interface BackupItem {
  id: string
  data: Record<string, unknown>
}

export interface UnitBackupResult {
  /** 備份 group id（同一次備份嘅所有 doc 共用） */
  backupId: string
  /** 備份咗幾多份 AI 計劃 */
  planCount: number
  /** 備份咗幾多筆活動紀錄 */
  logCount: number
}

export function isBackupStoreReady(): boolean {
  return isFirebaseConfigured() && db !== null
}

function firestore(): Firestore {
  if (db === null) {
    throw new Error('Firebase is not configured (missing .env).')
  }
  return db
}

/** 將 items 切開做每份 ≤ CHUNK_BYTES 嘅 chunk。 */
function chunkItems(items: BackupItem[]): BackupItem[][] {
  const chunks: BackupItem[][] = []
  let current: BackupItem[] = []
  let size = 0
  for (const item of items) {
    let itemSize = 0
    try {
      itemSize = JSON.stringify(item).length
    } catch {
      // 冇辦法量度就當 0（呢個 item 會自己一個 chunk，唔會無限增長）
      itemSize = 0
    }
    if (current.length > 0 && size + itemSize > CHUNK_BYTES) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(item)
    size += itemSize
  }
  if (current.length > 0) {
    chunks.push(current)
  }
  return chunks
}

/**
 * 🛡️ 備份一個單位嘅**全部** AI 計劃 + 活動紀錄（**唔會刪任何嘢**）。
 *
 * 拋出錯誤 = 備份失敗 → 呼叫者**必須**中止重設（呢個係整個安全設計嘅核心）。
 */
export async function backupUnitData(
  unit: string,
  actor: { id: string; name: string },
): Promise<UnitBackupResult> {
  const store = firestore()
  const [planSnap, logSnap] = await Promise.all([
    getDocs(
      query(collection(store, PLANS_COLLECTION), where('unit', '==', unit)),
    ),
    getDocs(query(collection(store, LOGS_COLLECTION), where('unit', '==', unit))),
  ])

  const plans: BackupItem[] = planSnap.docs.map((item) => ({
    id: item.id,
    data: { ...item.data() },
  }))
  const logs: BackupItem[] = logSnap.docs.map((item) => ({
    id: item.id,
    data: { ...item.data() },
  }))

  const headerRef = doc(collection(store, BACKUP_COLLECTION))
  const groupId = headerRef.id
  const planChunks = chunkItems(plans)
  const logChunks = chunkItems(logs)

  try {
    const backupAt = Date.now()
    const base = {
      backupGroupId: groupId,
      backupUnit: unit,
      backupAt,
      backupBy: actor.id,
      backupByName: actor.name,
    }

    // ① 先寫 chunk。任何一個失敗 → 拋出 → header 唔會寫 → 呼叫者唔會刪資料。
    for (let index = 0; index < planChunks.length; index += 1) {
      await setDoc(doc(collection(store, BACKUP_COLLECTION)), {
        ...base,
        backupKind: 'plans',
        backupIndex: index,
        backupItems: planChunks[index],
      })
    }
    for (let index = 0; index < logChunks.length; index += 1) {
      await setDoc(doc(collection(store, BACKUP_COLLECTION)), {
        ...base,
        backupKind: 'logs',
        backupIndex: index,
        backupItems: logChunks[index],
      })
    }

    // ② 最後寫 header —— 有 header = 備份完整，可以安全刪除。
    await setDoc(headerRef, {
      ...base,
      backupKind: 'header',
      backupPlanCount: plans.length,
      backupLogCount: logs.length,
      backupPlanChunks: planChunks.length,
      backupLogChunks: logChunks.length,
    })
  } catch (error) {
    // ⚠️ 一定要拋出【有指向性】嘅錯誤 ——
    //    否則上層會當成「讀唔到角色設定」，令人查錯方向。
    const detail = error instanceof Error ? error.message : String(error)
    // `code: 'backup-failed'` 令 describeStoreError 認得出「已經係人話，
    // 唔好再翻譯一次」（否則會被通用 permission 訊息蓋掉）。
    throw Object.assign(
      new Error(
        '🛡️ Backup failed — NOTHING was deleted. ' +
          'Firestore could not write the pre-reset backup into aiPlanLogs. ' +
          `(Technical detail: ${detail})`,
      ),
      { code: 'backup-failed' },
    )
  }

  return { backupId: groupId, planCount: plans.length, logCount: logs.length }
}
