/** 用邊種方法登入（本機只記住你上次揀邊個，唔係安全憑證）。 */
export type AuthProvider = 'portal' | 'firebase'

/**
 * 登入級別（login level）—— Firebase 登入用：
 * - superadmin：睇晒所有單位（等同 Portal 嘅 CEO／Steering 範圍）
 * - admin：管理自己綁定嘅單位
 * - user：睇到自己單位，只做自己嘅嘢
 */
export type Role = 'superadmin' | 'admin' | 'user'

/** Firestore `users/{uid}` 文件（Firebase 用戶嘅角色設定）。 */
export interface FirebaseProfile {
  uid: string
  email: string | null
  displayName: string | null
  role: Role
  /** 綁定嘅單位顯示名，要對得上 src/lib/localInventory.ts 嘅 unit */
  unit: string | null
  isActive: boolean
}

export interface AppUser {
  /**
   * 穩定嘅「擁有者」key（AI 計劃嘅 `plan.ownerId`）。
   * Portal 用戶 = portal 身份 id（例 "dept-finance"）；
   * Firebase 用戶 = "fb:<firebase uid>"（加前綴，唔會同 portal id 撞）。
   */
  uid: string
  email: string | null
  displayName: string | null
  /** 用邊種方法登入 */
  provider: AuthProvider
  /** 登入級別 */
  role: Role
  /** Firebase 用戶綁定嘅單位；Portal 用戶靠 uid 反查身份，唔用呢個 */
  unit?: string
}

/** AI 化 partition（step）嘅狀態。 */
export type AiPlanStepState = 'planning' | 'in_progress' | 'done' | 'on_hold'

export const AI_PLAN_STEP_STATE_LABELS: Record<AiPlanStepState, string> = {
  planning: 'Planning',
  in_progress: 'In progress',
  done: 'Done',
  on_hold: 'On Hold',
}

/**
 * 頁頭「總負責人」—— 整份提交共用。
 * 填一次就夠，因為之後所有 AI 化 flow 都係同一個人做總負責。
 */
export interface AiPlanLead {
  name: string
  email: string
  phone: string
}

/** AI 計劃入面嘅一個 flow step（用戶自訂，有幾時做完） */
export interface AiPlanStep {
  name: string
  /** 幾時做完 —— 向後兼容用（舊資料可能係自由文字，例如 "Q2"） */
  due: string
  /** 到期／完成日 yyyy-mm-dd（新：用 date picker 入，可以排序／計到期） */
  dueDate?: string | null
  /** 🆕 開始日期 yyyy-mm-dd */
  startDate?: string | null
  /** 🆕 State（Planning / In progress / Done / On Hold） */
  state?: AiPlanStepState
  /** 🆕 內容（呢個 partition 打算做啲咩） */
  detail?: string
}

/**
 * AI 計劃狀態：
 * - selected：揀咗 flow 但未填 AI 方法
 * - in_progress：已填，進行中
 * - done：已完成
 */
export type AiPlanStatus = 'selected' | 'in_progress' | 'done'

export const AI_PLAN_STATUS_LABELS: Record<AiPlanStatus, string> = {
  selected: 'Flow selected',
  in_progress: 'In progress',
  done: 'Completed',
}

/**
 * 用戶揀咗一條 workflow 之後交嘅「AI 計劃」。
 * 好似 workflow 咁：每一步都有一條 timeline。
 */
export interface AiPlan {
  id: string
  workflowCode: string
  workflowName: string
  unit: string
  /** 邊個交（portal identity id 或 "fb:<uid>"） */
  ownerId: string
  /** 邊個填（顯示名快照，方便 dashboard 顯示） */
  ownerName?: string
  /**
   * 🆕 總負責人（頁頭填一次，所有 AI 化 flow 共用）。
   * ⚠️ 同 `ownerName` 唔同：ownerName 係「登入帳號嘅顯示名」。
   */
  leadName?: string
  leadEmail?: string
  leadPhone?: string
  /** 🆕 呢條 flow 嘅負責人（每條 flow 可以唔同人，所以要逐條填） */
  flowOwnerName?: string
  flowOwnerEmail?: string
  flowOwnerPhone?: string
  /** 🆕 計劃開始／完成時間 yyyy-mm-dd */
  startDate?: string | null
  endDate?: string | null
  /** AI 打算點做（PLAN） */
  plan: string
  inputData: string
  outputData: string
  steps: AiPlanStep[]
  /** 計劃狀態（舊資料可能冇，會由 steps／plan 自動推導） */
  status?: AiPlanStatus
  painPoints: string[]
  supports: string[]
  createdAt: number
  updatedAt: number
}

export type NewAiPlan = Omit<AiPlan, 'id' | 'createdAt' | 'updatedAt'>

/** AI 計劃活動紀錄（audit log）嘅動作類型。 */
export type AiPlanLogAction = 'selected' | 'created' | 'updated' | 'deleted'

export const AI_PLAN_LOG_ACTION_LABELS: Record<AiPlanLogAction, string> = {
  selected: 'Plan started',
  created: 'Plan created',
  updated: 'Plan updated',
  deleted: 'Deleted',
}

/** 一項變更（人話）。 */
export interface PlanChange {
  /** 變咗乜，例「Step「UAT」到期日」 */
  label: string
  from: string
  to: string
}

/** Firestore `aiPlanLogs` 文件 —— 邊個改過咩。 */
export interface AiPlanLog {
  id: string
  /** aiPlans 嘅 doc id（{ownerId}__{workflowCode}） */
  planId: string
  workflowCode: string
  workflowName: string
  unit: string
  /** 邊個改（portal identity id 或 "fb:<uid>"） */
  ownerId: string
  ownerName: string
  action: AiPlanLogAction
  /** 一句人話，例「修改 AI 方法」 */
  summary: string
  /** 逐項變更（人話），例「AI 方法：a → b」 */
  details: string[]
  /** Unix 毫秒 */
  at: number
}

export type NewAiPlanLog = Omit<AiPlanLog, 'id'>
