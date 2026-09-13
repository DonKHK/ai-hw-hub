import { describeStoreError } from '../lib/firestoreError'
import {
  countPlansByUnit,
  deletePlansByUnit,
  getPlanFromFirestore,
  isPlanStoreReady,
  listAllPlansFromFirestore,
  markSelectedInFirestore,
  savePlanToFirestore,
} from './aiPlanFirestore'
import { addPlanLog, countLogsByUnit } from './aiPlanLogService'
import { backupUnitData } from './aiPlanBackupService'
import type { AiPlan, NewAiPlan } from '../types'

/**
 * AI 計劃 CRUD —— **Firestore 優先**，讀寫失敗自動 fallback 本機 localStorage。
 *
 * 點解要上 Firestore：監控 dashboard 要睇「所有 BU/DEPT」交咗咩，
 * 而 localStorage 只有當前 browser 嘅資料。
 *
 * 冇 `.env`（Firebase 未設定）時會照樣用 localStorage，所以舊環境唔會壞。
 */

const AI_PLANS_KEY = 'ai-hw-hub.ai-plans.v1'

/**
 * 最近一次 Firestore 讀取失敗嘅原因（成功就 null）。
 * 監控 dashboard 用佢提示「而家只係顯示本機資料」，
 * 否則 Firestore rules 未發布時會靜靜地只顯示本機資料，
 * 令人誤以為「所有單位都未開始」。
 */
let lastStoreError: string | null = null

export function lastPlanStoreError(): string | null {
  return lastStoreError
}

/**
 * 最近一次「**寫入** Firestore 失敗」嘅人話原因（成功就 null）。
 * AI 計劃表單用佢提示「只係存咗喺本機」，避免用戶以為已經上到雲端
 * （之前靜默 fallback 落 localStorage，令人以為儲存成功）。
 */
let lastWriteError: string | null = null

export function lastPlanWriteError(): string | null {
  return lastWriteError
}

function isAiPlan(value: unknown): value is AiPlan {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.workflowCode === 'string' &&
    typeof candidate.ownerId === 'string' &&
    typeof candidate.plan === 'string' &&
    Array.isArray(candidate.steps)
  )
}

function readAll(): AiPlan[] {
  try {
    const raw = window.localStorage.getItem(AI_PLANS_KEY)
    if (raw === null) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(isAiPlan)
  } catch {
    return []
  }
}

function writeAll(plans: AiPlan[]): void {
  window.localStorage.setItem(AI_PLANS_KEY, JSON.stringify(plans))
}

function newId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/** 本機 upsert（同一 owner + workflowCode 就 update）。 */
function savePlanLocally(input: NewAiPlan): AiPlan {
  const all = readAll()
  const existingIndex = all.findIndex(
    (plan) =>
      plan.ownerId === input.ownerId &&
      plan.workflowCode === input.workflowCode,
  )
  const now = Date.now()

  if (existingIndex >= 0) {
    const existing = all[existingIndex]
    const updated: AiPlan = {
      ...existing,
      ...input,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: now,
    }
    all[existingIndex] = updated
    writeAll(all)
    return updated
  }

  const created: AiPlan = {
    id: newId(),
    ...input,
    createdAt: now,
    updatedAt: now,
  }
  all.push(created)
  writeAll(all)
  return created
}

/** 本機留一份鏡像（離線用／方便除錯）。 */
function writeLocalPlan(plan: AiPlan): void {
  const all = readAll()
  const index = all.findIndex(
    (item) =>
      item.id === plan.id ||
      (item.ownerId === plan.ownerId &&
        item.workflowCode === plan.workflowCode),
  )
  if (index >= 0) {
    all[index] = plan
  } else {
    all.push(plan)
  }
  writeAll(all)
}

/** 全部 AI 計劃（監控 dashboard 用；按更新時間由新到舊）。 */
export async function listAllPlans(): Promise<AiPlan[]> {
  if (isPlanStoreReady()) {
    try {
      const remote = await listAllPlansFromFirestore()
      lastStoreError = null
      return remote
    } catch (error) {
      lastStoreError = describeStoreError(error)
      console.warn('Failed to read Firestore aiPlans; falling back to local data:', error)
    }
  } else {
    lastStoreError = 'Firebase is not configured (missing .env).'
  }
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 列出某身份交過嘅全部 AI 計劃。 */
export async function listPlansByOwner(ownerId: string): Promise<AiPlan[]> {
  const all = await listAllPlans()
  return all.filter((plan) => plan.ownerId === ownerId)
}

/** 攞某身份喺指定 workflow 嘅 AI 計劃（未交過就 null）。 */
export async function getPlanByWorkflow(
  ownerId: string,
  workflowCode: string,
): Promise<AiPlan | null> {
  if (isPlanStoreReady()) {
    try {
      return await getPlanFromFirestore(ownerId, workflowCode)
    } catch (error) {
      console.warn('Failed to read Firestore AI plans; falling back to local data:', error)
    }
  }
  return (
    readAll().find(
      (plan) => plan.ownerId === ownerId && plan.workflowCode === workflowCode,
    ) ?? null
  )
}

/** 新增／更新：同一 owner + workflowCode 就 update，否則開新記錄。 */
export async function savePlan(input: NewAiPlan): Promise<AiPlan> {
  if (isPlanStoreReady()) {
    try {
      const saved = await savePlanToFirestore(input)
      writeLocalPlan(saved)
      lastWriteError = null
      return saved
    } catch (error) {
      lastWriteError = describeStoreError(error)
      console.warn('Failed to write to Firestore; saving locally instead:', error)
    }
  } else {
    lastWriteError = 'Firebase is not configured (missing .env); saved locally only.'
  }
  return savePlanLocally(input)
}

/**
 * 標記「已揀 flow」（`status: 'selected'`）。
 * 已經有記錄就唔會覆蓋（回 null），所以 dashboard 分得出
 * 「揀咗但未填」同「完全未開始」。
 */
export async function markSelected(input: {
  ownerId: string
  ownerName: string
  workflowCode: string
  workflowName: string
  unit: string
}): Promise<AiPlan | null> {
  if (isPlanStoreReady()) {
    try {
      const result = await markSelectedInFirestore(input)
      lastWriteError = null
      return result
    } catch (error) {
      lastWriteError = describeStoreError(error)
      console.warn('Failed to mark in Firestore; saving locally instead:', error)
    }
  }

  const all = readAll()
  const exists = all.some(
    (plan) =>
      plan.ownerId === input.ownerId &&
      plan.workflowCode === input.workflowCode,
  )
  if (exists) {
    return null
  }
  const now = Date.now()
  const stub: AiPlan = {
    id: newId(),
    ...input,
    plan: '',
    inputData: '',
    outputData: '',
    steps: [],
    status: 'selected',
    painPoints: [],
    supports: [],
    createdAt: now,
    updatedAt: now,
  }
  all.push(stub)
  writeAll(all)
  return stub
}

/** 本機有幾多份 AI 計劃（同步掣用）。 */
export function countLocalPlans(): number {
  return readAll().length
}

/**
 * 一次過將本機 AI 計劃上傳 Firestore。回傳成功上傳嘅數量。
 * 用決定性 doc ID + upsert，所以重複按都安全。
 */
export async function syncLocalPlansToFirestore(): Promise<number> {
  if (!isPlanStoreReady()) {
    throw new Error('Firebase is not configured (missing .env); cannot sync.')
  }
  const local = readAll()
  let count = 0
  for (const plan of local) {
    const input: NewAiPlan = {
      workflowCode: plan.workflowCode,
      workflowName: plan.workflowName,
      unit: plan.unit,
      ownerId: plan.ownerId,
      ownerName: plan.ownerName,
      plan: plan.plan,
      inputData: plan.inputData,
      outputData: plan.outputData,
      steps: plan.steps,
      status: plan.status,
      painPoints: plan.painPoints,
      supports: plan.supports,
    }
    await savePlanToFirestore(input)
    count += 1
  }
  return count
}

/* ============================================================
 * 🔄 單位重設（只限 Firebase superadmin）
 *
 * ⚠️ 不可逆！UI 必須先做 re-authentication
 *    （src/firebase/authService.ts → confirmSuperadminPassword）。
 * ============================================================ */

export interface UnitDataCount {
  /** Firestore 有幾多份計劃 */
  plans: number
  /** Firestore 有幾多筆活動紀錄 */
  logs: number
  /** 本機 localStorage 有幾多份 */
  localPlans: number
}

/** 睇下一個單位有幾多資料（重設前確認用，**唔會刪任何嘢**）。 */
export async function countUnitData(unit: string): Promise<UnitDataCount> {
  const localPlans = readAll().filter((plan) => plan.unit === unit).length
  if (!isPlanStoreReady()) {
    return { plans: 0, logs: 0, localPlans }
  }
  const [plans, logs] = await Promise.all([
    countPlansByUnit(unit),
    countLogsByUnit(unit),
  ])
  return { plans, logs, localPlans }
}

export interface UnitResetResult {
  /** 刪咗幾多份 Firestore AI 計劃 */
  plansDeleted: number
  /** 清走咗幾多份本機舊紀錄 */
  localPlansDeleted: number
  /** 保留咗幾多筆活動紀錄（LOG）—— 唔會刪 */
  logsKept: number
  /** 🛡️ 備份 group id（可以喺 Firestore `aiPlanLogs` 用 backupGroupId 搵返） */
  backupId: string
  /** 🛡️ 備份咗幾多份計劃 */
  backupPlans: number
  /** 🛡️ 備份咗幾多筆 LOG */
  backupLogs: number
}

/**
 * 🔄 重設一個單位。
 *
 * 安全流程（**次序好重要**）：
 *   ① 🛡️ **先備份**落 `aiPlanLogs`（backupKind 文件）—— 備份失敗 = 直接 throw，
 *      **唔會刪任何嘢**（呢個係整個安全設計嘅核心）
 *   ② 只刪 `aiPlans`（該單位）—— ⚠️ **唔會刪 LOG**（審計紀錄要保留）
 *   ③ 清走本機同名單位嘅計劃（否則 fallback 會「翻生」）
 *   ④ 寫一筆審計 LOG 記錄低今次重設（邊個、刪幾多、備份 id）
 *
 * ⚠️ 計劃本身唔可以復原（要靠備份還原）。
 * ⚠️ UI 必須先做 re-authentication（authService.confirmSuperadminPassword）。
 */
export async function resetUnitData(
  unit: string,
  actor: { id: string; name: string },
): Promise<UnitResetResult> {
  // ① 先讀本機（呢一步未有副作用）
  const localAll = readAll()
  const localPlans = localAll.filter((plan) => plan.unit === unit)

  if (!isPlanStoreReady()) {
    // 冇 Firebase → 只可以清本機
    if (localPlans.length > 0) {
      writeAll(localAll.filter((plan) => plan.unit !== unit))
    }
    return {
      plansDeleted: 0,
      localPlansDeleted: localPlans.length,
      logsKept: 0,
      backupId: '',
      backupPlans: 0,
      backupLogs: 0,
    }
  }

  // ② 🛡️ 先備份 —— 拋出錯誤就唔會行到落面（唔會刪任何嘢）
  const backup = await backupUnitData(unit, actor).catch((error: unknown) => {
    // 已經係「人話」錯誤（例如 backupUnitData 拋嘅）就唔好再包一次 ——
    // 保留 code: 'backup-failed' 令上層唔會誤判成 permission-denied。
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: unknown }).code === 'backup-failed'
    ) {
      throw error
    }
    const detail = error instanceof Error ? error.message : String(error)
    throw Object.assign(
      new Error(
        '🛡️ Backup failed — NOTHING was deleted. ' +
          `(Technical detail: ${detail})`,
      ),
      { code: 'backup-failed' },
    )
  })

  // ③ 只刪 AI 計劃（⚠️ 唔會刪 LOG）
  const plansDeleted = await deletePlansByUnit(unit)

  // ④ 清走本機同名單位嘅計劃
  if (localPlans.length > 0) {
    writeAll(localAll.filter((plan) => plan.unit !== unit))
  }

  // ⑤ 寫一筆審計 LOG（addPlanLog 內部吞錯，唔會影響重設本身）
  await addPlanLog({
    planId: '',
    workflowCode: '',
    workflowName: '',
    unit,
    ownerId: actor.id,
    ownerName: actor.name,
    action: 'deleted',
    summary: `🔄 Reset all AI plans for "${unit}"`,
    details: [
      `Deleted ${plansDeleted} AI plan(s)`,
      `Cleared ${localPlans.length} local record(s)`,
      `${backup.logCount} activity log entries kept`,
      `🛡️ Backed up ${backup.planCount} plan(s) + ${backup.logCount} log entry/entries (aiPlanLogs backup ${backup.backupId})`,
    ],
    at: Date.now(),
  })

  return {
    plansDeleted,
    localPlansDeleted: localPlans.length,
    logsKept: backup.logCount,
    backupId: backup.backupId,
    backupPlans: backup.planCount,
    backupLogs: backup.logCount,
  }
}

