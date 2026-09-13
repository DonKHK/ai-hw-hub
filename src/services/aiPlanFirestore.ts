import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import type { Firestore } from 'firebase/firestore'
import { db, isFirebaseConfigured } from '../firebase/config'
import { changesToDetails, diffPlanChanges, summarizeChanges } from '../lib/planDiff'
import { withoutUndefined } from '../lib/firestoreData'
import { addPlanLog } from './aiPlanLogService'
import type { AiPlan, AiPlanStatus, AiPlanStep, AiPlanStepState, NewAiPlan } from '../types'

/**
 * AI 計劃嘅 Firestore 存取層 —— 監控 dashboard 嘅資料來源。
 *
 * 點解要上 Firestore：原本只存 localStorage，即係 superadmin
 * 只睇到自己部電腦填過嘅計劃，完全睇唔到其他 BU/DEPT 交咗咩。
 *
 * Doc ID 用決定性 `{ownerId}__{workflowCode}`：
 *   同一身份 + 同一條 workflow = 同一份文件 → setDoc 天然 upsert，
 *   同原本 localStorage 版 savePlan 嘅語意一樣，唔使 query。
 *
 * ⚠️ Rules 目前開放讀寫（見 firestore.rules）；Portal 用戶冇 Firebase
 *    Auth session，所以唔可以用 request.auth 鎖。Phase 2 會改用匿名登入收緊。
 */

const AI_PLANS_COLLECTION = 'aiPlans'

/** Firestore 係咪可用（有 .env + 已初始化）。 */
export function isPlanStoreReady(): boolean {
  return isFirebaseConfigured() && db !== null
}

function firestore(): Firestore {
  if (db === null) {
    throw new Error('Firebase is not configured (missing .env).')
  }
  return db
}

export function planDocId(ownerId: string, workflowCode: string): string {
  // Firestore doc ID 唔可以有 '/'；ownerId 同 workflowCode 都唔會有。
  return `${ownerId}__${workflowCode}`
}

const VALID_STATUS: AiPlanStatus[] = ['selected', 'in_progress', 'done']

const VALID_STEP_STATES: AiPlanStepState[] = [
  'planning',
  'in_progress',
  'done',
  'on_hold',
]

function toText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function toDateOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function toStepState(value: unknown): AiPlanStepState | undefined {
  return typeof value === 'string' &&
    VALID_STEP_STATES.includes(value as AiPlanStepState)
    ? (value as AiPlanStepState)
    : undefined
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function toSteps(value: unknown): AiPlanStep[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null,
    )
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name : '',
      due: typeof item.due === 'string' ? item.due : '',
      dueDate: toDateOrNull(item.dueDate),
      startDate: toDateOrNull(item.startDate),
      state: toStepState(item.state),
      detail: typeof item.detail === 'string' ? item.detail : '',
    }))
    .filter((step) => step.name !== '')
}

/** Firestore 文件 → AiPlan（格式唔啱回 null）。 */
function toPlan(id: string, data: Record<string, unknown>): AiPlan | null {
  if (
    typeof data.workflowCode !== 'string' ||
    typeof data.unit !== 'string' ||
    typeof data.ownerId !== 'string' ||
    typeof data.plan !== 'string'
  ) {
    return null
  }
  const status =
    typeof data.status === 'string' &&
    VALID_STATUS.includes(data.status as AiPlanStatus)
      ? (data.status as AiPlanStatus)
      : undefined

  return {
    id,
    workflowCode: data.workflowCode,
    workflowName:
      typeof data.workflowName === 'string'
        ? data.workflowName
        : data.workflowCode,
    unit: data.unit,
    ownerId: data.ownerId,
    ownerName:
      typeof data.ownerName === 'string' ? data.ownerName : undefined,
    leadName: toText(data.leadName),
    leadEmail: toText(data.leadEmail),
    leadPhone: toText(data.leadPhone),
    flowOwnerName: toText(data.flowOwnerName),
    flowOwnerEmail: toText(data.flowOwnerEmail),
    flowOwnerPhone: toText(data.flowOwnerPhone),
    startDate: toDateOrNull(data.startDate),
    endDate: toDateOrNull(data.endDate),
    plan: data.plan,
    inputData: typeof data.inputData === 'string' ? data.inputData : '',
    outputData: typeof data.outputData === 'string' ? data.outputData : '',
    steps: toSteps(data.steps),
    status,
    painPoints: toStringArray(data.painPoints),
    supports: toStringArray(data.supports),
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : Date.now(),
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now(),
  }
}

/** 全部 AI 計劃（監控 dashboard 用；按更新時間由新到舊）。 */
export async function listAllPlansFromFirestore(): Promise<AiPlan[]> {
  const snapshot = await getDocs(collection(firestore(), AI_PLANS_COLLECTION))
  return snapshot.docs
    .map((item) =>
      toPlan(item.id, (item.data() ?? {}) as Record<string, unknown>),
    )
    .filter((plan): plan is AiPlan => plan !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function listPlansByOwnerFromFirestore(
  ownerId: string,
): Promise<AiPlan[]> {
  const all = await listAllPlansFromFirestore()
  return all.filter((plan) => plan.ownerId === ownerId)
}

export async function getPlanFromFirestore(
  ownerId: string,
  workflowCode: string,
): Promise<AiPlan | null> {
  const snapshot = await getDoc(
    doc(firestore(), AI_PLANS_COLLECTION, planDocId(ownerId, workflowCode)),
  )
  if (!snapshot.exists()) {
    return null
  }
  return toPlan(snapshot.id, (snapshot.data() ?? {}) as Record<string, unknown>)
}

/** 儲存（upsert）。保留原本嘅 createdAt，並寫一筆活動紀錄。 */
export async function savePlanToFirestore(
  input: NewAiPlan,
): Promise<AiPlan> {
  const ref = doc(
    firestore(),
    AI_PLANS_COLLECTION,
    planDocId(input.ownerId, input.workflowCode),
  )
  const existing = await getDoc(ref)
  const now = Date.now()
  let createdAt = now
  let previous: AiPlan | null = null
  if (existing.exists()) {
    const data = (existing.data() ?? {}) as Record<string, unknown>
    if (typeof data.createdAt === 'number') {
      createdAt = data.createdAt
    }
    previous = toPlan(existing.id, data)
  }
  const plan: AiPlan = { ...input, id: ref.id, createdAt, updatedAt: now }
  await setDoc(ref, withoutUndefined(plan))
  await writeActivityLog(plan, previous)
  return plan
}

/**
 * 寫一筆活動紀錄（LOG）。`addPlanLog` 內部會吞錯，
 * 所以 LOG 出問題都唔會影響計劃儲存。
 */
async function writeActivityLog(
  plan: AiPlan,
  previous: AiPlan | null,
): Promise<void> {
  const isNew = previous === null
  const changes = diffPlanChanges(previous, plan)
  await addPlanLog({
    planId: plan.id,
    workflowCode: plan.workflowCode,
    workflowName: plan.workflowName,
    unit: plan.unit,
    ownerId: plan.ownerId,
    ownerName: plan.ownerName ?? plan.ownerId,
    action: isNew ? 'created' : 'updated',
    summary: summarizeChanges(changes, isNew),
    details: changesToDetails(changes),
    at: Date.now(),
  })
}

/**
 * 只標記「已揀 flow」（`status: 'selected'`，`plan` 空）。
 * 已經有記錄就唔會覆蓋（回 null）。
 */
export async function markSelectedInFirestore(input: {
  ownerId: string
  ownerName: string
  workflowCode: string
  workflowName: string
  unit: string
}): Promise<AiPlan | null> {
  const ref = doc(
    firestore(),
    AI_PLANS_COLLECTION,
    planDocId(input.ownerId, input.workflowCode),
  )
  const existing = await getDoc(ref)
  if (existing.exists()) {
    return null
  }
  const now = Date.now()
  const plan: AiPlan = {
    id: ref.id,
    workflowCode: input.workflowCode,
    workflowName: input.workflowName,
    unit: input.unit,
    ownerId: input.ownerId,
    ownerName: input.ownerName,
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
  await setDoc(ref, withoutUndefined(plan))
  await addPlanLog({
    planId: plan.id,
    workflowCode: plan.workflowCode,
    workflowName: plan.workflowName,
    unit: plan.unit,
    ownerId: plan.ownerId,
    ownerName: plan.ownerName ?? plan.ownerId,
    action: 'selected',
    summary: 'Plan started',
    details: [],
    at: now,
  })
  return plan
}

/* ============================================================
 * 🔄 單位重設（只限 Firebase superadmin；UI 會先做 re-authentication）
 * ============================================================ */

/** 一次 batch 最多刪幾多份（Firestore limit 500，留 buffer）。 */
const DELETE_BATCH_SIZE = 400

/** 一個單位有幾多份 AI 計劃（重設前確認用，**唔會刪**）。 */
export async function countPlansByUnit(unit: string): Promise<number> {
  const snapshot = await getDocs(
    query(
      collection(firestore(), AI_PLANS_COLLECTION),
      where('unit', '==', unit),
    ),
  )
  return snapshot.size
}

/**
 * 🔄 刪除一個單位嘅**全部** AI 計劃（所有 owner）。
 * ⚠️ 唔可以復原。回傳實際刪咗幾多份。
 */
export async function deletePlansByUnit(unit: string): Promise<number> {
  const store = firestore()
  const snapshot = await getDocs(
    query(collection(store, AI_PLANS_COLLECTION), where('unit', '==', unit)),
  )
  if (snapshot.empty) {
    return 0
  }

  let batch = writeBatch(store)
  let pending = 0
  let deleted = 0
  for (const item of snapshot.docs) {
    batch.delete(item.ref)
    pending += 1
    deleted += 1
    if (pending >= DELETE_BATCH_SIZE) {
      await batch.commit()
      batch = writeBatch(store)
      pending = 0
    }
  }
  if (pending > 0) {
    await batch.commit()
  }
  return deleted
}
