import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
} from 'firebase/firestore'
import type { Firestore } from 'firebase/firestore'
import { db, isFirebaseConfigured } from '../firebase/config'
import { withoutUndefined } from '../lib/firestoreData'
import type { AiPlanLog, AiPlanLogAction, NewAiPlanLog } from '../types'

/**
 * AI 計劃活動紀錄（LOG）存取層。
 *
 * 設計原則：LOG 係**輔助功能** —— Firebase 未設定或者寫入失敗，
 * **絕對唔應該影響儲存計劃本身**（所以 `addPlanLog` 會吞錯）。
 *
 * 查詢策略：只用**單欄位** `where`（唔用 composite）→ 唔需要去 Console
 * 建 index；排序一律喺 client 做。
 */

const LOGS_COLLECTION = 'aiPlanLogs'

const VALID_ACTIONS: AiPlanLogAction[] = [
  'selected',
  'created',
  'updated',
  'deleted',
]

export function isLogStoreReady(): boolean {
  return isFirebaseConfigured() && db !== null
}

function firestore(): Firestore {
  if (db === null) {
    throw new Error('Firebase is not configured (missing .env).')
  }
  return db
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function toLog(id: string, data: Record<string, unknown>): AiPlanLog | null {
  // 🛡️ 單位重設前嘅備份文件（有 backupKind）唔係活動紀錄 —— 一律過濾走。
  //    （佢哋同樣冇 workflowCode，下面個檢查都會剔走，呢個係第一重保險。）
  if (typeof data.backupKind === 'string') {
    return null
  }
  if (
    typeof data.workflowCode !== 'string' ||
    typeof data.ownerId !== 'string' ||
    typeof data.summary !== 'string'
  ) {
    return null
  }
  const action =
    typeof data.action === 'string' &&
    VALID_ACTIONS.includes(data.action as AiPlanLogAction)
      ? (data.action as AiPlanLogAction)
      : 'updated'

  return {
    id,
    planId: typeof data.planId === 'string' ? data.planId : '',
    workflowCode: data.workflowCode,
    workflowName:
      typeof data.workflowName === 'string'
        ? data.workflowName
        : data.workflowCode,
    unit: typeof data.unit === 'string' ? data.unit : '',
    ownerId: data.ownerId,
    ownerName:
      typeof data.ownerName === 'string' ? data.ownerName : data.ownerId,
    action,
    summary: data.summary,
    details: toStringArray(data.details),
    at: typeof data.at === 'number' ? data.at : 0,
  }
}

/**
 * 寫一筆 LOG。Firebase 未設定或者寫入失敗都會**靜靜略過** ——
 * LOG 唔應該阻住儲存計劃。
 */
export async function addPlanLog(input: NewAiPlanLog): Promise<void> {
  if (!isLogStoreReady()) {
    return
  }
  try {
    // Firestore 唔接受 undefined —— 寫入前剔走（防禦性）
    await addDoc(
      collection(firestore(), LOGS_COLLECTION),
      withoutUndefined(input),
    )
  } catch (error) {
    console.warn('Failed to write the activity log (saving the plan is unaffected):', error)
  }
}

/** 某個用戶自己嘅 log（可按 workflow codes 再篩；client 排序）。 */
export async function listLogsByOwner(
  ownerId: string,
  codes?: string[],
): Promise<AiPlanLog[]> {
  if (!isLogStoreReady()) {
    return []
  }
  const snapshot = await getDocs(
    query(
      collection(firestore(), LOGS_COLLECTION),
      where('ownerId', '==', ownerId),
    ),
  )
  const logs = snapshot.docs
    .map((item) =>
      toLog(item.id, (item.data() ?? {}) as Record<string, unknown>),
    )
    .filter((log): log is AiPlanLog => log !== null)
  const filtered =
    codes === undefined || codes.length === 0
      ? logs
      : logs.filter((log) => codes.includes(log.workflowCode))
  return filtered.sort((a, b) => b.at - a.at)
}

/** 全部 log（監控頁 superadmin 用；client 排序）。 */
export async function listAllLogs(): Promise<AiPlanLog[]> {
  if (!isLogStoreReady()) {
    return []
  }
  const snapshot = await getDocs(collection(firestore(), LOGS_COLLECTION))
  return snapshot.docs
    .map((item) =>
      toLog(item.id, (item.data() ?? {}) as Record<string, unknown>),
    )
    .filter((log): log is AiPlanLog => log !== null)
    .sort((a, b) => b.at - a.at)
}

/** 刪除一筆 LOG（UI 只會俾 superadmin 撳）。 */
export async function deletePlanLog(logId: string): Promise<void> {
  await deleteDoc(doc(firestore(), LOGS_COLLECTION, logId))
}

/** 時間顯示（yyyy-mm-dd hh:mm）。保留做向後兼容。 */
export function formatLogTime(ms: number): string {
  if (ms === 0) {
    return '—'
  }
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 日期欄（例 `13/9/2026`，日/月/年）。 */
export function formatLogDate(ms: number): string {
  if (ms === 0) {
    return '—'
  }
  const date = new Date(ms)
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`
}

/** 時間欄（例 `13:45`，24 小時制）。 */
export function formatLogClock(ms: number): string {
  if (ms === 0) {
    return '—'
  }
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/* ============================================================
 * 🔄 單位重設（只限 Firebase superadmin）
 *
 * LOG 唔會喺呢度刪 —— 重設只清 AI 計劃，審計紀錄要保留。
 * ============================================================ */

/** 一個單位有幾多筆 LOG（重設前確認用，**唔會刪**）。 */
export async function countLogsByUnit(unit: string): Promise<number> {
  if (!isLogStoreReady()) {
    return 0
  }
  const snapshot = await getDocs(
    query(collection(firestore(), LOGS_COLLECTION), where('unit', '==', unit)),
  )
  // ⚠️ 備份文件用 `backupUnit`（冇 `unit` 欄位），所以上面個 query 已經唔會
  //    攞到佢哋；呢個 filter 係第二重保險，確保「會保留 N 筆」唔會計錯。
  return snapshot.docs.filter((item) => {
    const data = (item.data() ?? {}) as Record<string, unknown>
    return typeof data.backupKind !== 'string'
  }).length
}
