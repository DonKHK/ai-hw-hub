import { findIdentity } from './portalData'
import type { AppUser } from '../types'

/**
 * 統一嘅 access 模型 —— Portal 同 Firebase 兩種登入方法共用。
 *
 * 點解要咁做：app 入面好多地方用 `findIdentity(user.uid)` 判斷
 * 「睇全部定係只睇自己單位」。Firebase 用戶嘅 uid 係一串隨機字元，
 * 一定搵唔到 portal 身份，如果照用就會**錯手睇到全部 workflow**。
 * 所以所有地方改為問 `accessForUser(user)` 攞答案。
 */
export interface Access {
  /** 穩定嘅擁有者 key（AI 計劃嘅 ownerId） */
  userId: string
  displayName: string
  role: AppUser['role']
  /**
   * 顯示用嘅身份標籤。
   *
   * ⚠️ 唔可以就咁顯示 `role`：Portal CEO 嘅 `role` 係 'superadmin'
   * （見 AuthProvider 嘅 portalRole），但佢**冇任何**刪除／重設權。
   * 照顯示會令人誤以為自己有 Superadmin 權限（睇唔到 Reset 掣就以為係 bug）。
   */
  roleLabel: string
  /**
   * 監控 Dashboard 見到嘅範圍。
   * - 'all'  = 全部單位（superadmin／觀察員／Portal CEO・Steering）
   * - 'unit' = 只睇自己綁定單位（admin）
   * - 'none' = 睇唔到監控頁（Portal Dept／Business 係落手填 workflow 嘅人）
   */
  monitorScope: 'all' | 'unit' | 'none'
  /**
   * 睇／揀 Workflow 嘅範圍。
   * - 'all'  = 全部（Firebase superadmin／觀察員、Portal CEO・Steering）
   * - 'unit' = 只睇自己部門（Firebase admin、Portal Dept／Business）
   * - 'none' = 完全冇 workflow
   */
  workflowScope: 'all' | 'unit' | 'none'
  /**
   * 🆕 可唔可以「**抽**」（打 AAI Portal Supabase 同步落 Firestore）。
   * **只有 Firebase superadmin = true** —— 其他身份一律由 Firestore 快照讀。
   */
  canPullFromPortal: boolean
  /**
   * 🆕 可唔可以填／改／交 AI 計劃。
   * false = 「觀察身份」（Portal CEO、Read-only Steering）—— 只可以睇。
   *
   * 點解唔用 `role` 判斷：Portal CEO 嘅 role 係 'superadmin'
   * （見 AuthProvider 嘅 portalRole），照用 role 會誤得刪除權，
   * 所以呢度明文寫死。
   */
  canEditPlans: boolean
  /**
   * 🆕 可唔可以執行【破壞性／管理】動作：
   *   - 刪除活動紀錄（LOG）
   *   - 重設（清空）一個單位嘅 AI 計劃 + LOG
   *   - 將本機舊紀錄同步上 Firestore
   * **只有 Firebase superadmin = true**。
   */
  canManage: boolean
  /** workflowScope === 'unit' 時，要對得上 src/lib/localInventory.ts 嘅 unit 名 */
  unit?: string
}

/**
 * Portal：
 * - ceo / readonly → 監控全部 + 抽全部
 * - dept / business → **冇監控頁**、只抽自己部門（unit = 身份顯示名）
 *
 * Firebase（全部係管理員／觀察員，**永遠冇 workflow**）：
 * - superadmin → 監控全部
 * - admin      → 監控自己綁定單位
 * - user       → 觀察員，監控全部
 */
export function accessForUser(user: AppUser): Access {
  if (user.provider === 'portal') {
    const identity = findIdentity(user.uid)
    if (identity === undefined) {
      // 身份清單改過但 localStorage 仲留住舊 id：fail-closed，乜都唔放。
      return {
        userId: user.uid,
        displayName: user.displayName ?? user.uid,
        role: user.role,
        // fail-closed：連身份都搵唔到 → 唔好顯示成任何有權嘅角色
        roleLabel: 'No access',
        monitorScope: 'none',
        workflowScope: 'none',
        canPullFromPortal: false,
        canEditPlans: false,
        canManage: false,
      }
    }

    const isUnitUser = identity.kind === 'dept' || identity.kind === 'business'
    if (isUnitUser) {
      // Dept / Business = 落手填 workflow 嘅人：只睇自己部門、冇監控頁、唔抽。
      return {
        userId: identity.id,
        displayName: identity.name,
        role: user.role,
        roleLabel: identity.kind === 'business' ? 'Business' : 'Dept',
        monitorScope: 'none',
        workflowScope: 'unit',
        canPullFromPortal: false,
        // 落手填 workflow 嘅人 → 可以填 / 改 AI 計劃
        canEditPlans: true,
        canManage: false,
        unit: identity.name,
      }
    }

    // CEO / Read-only Steering = 管理層：睇全部（唔抽）。
    // ⚠️ CEO 睇晒所有單位，但【只可以睇】—— 唔可以填／改／刪。
    return {
      userId: identity.id,
      displayName: identity.name,
      role: user.role,
      // ⚠️ CEO／Steering 睇晒所有單位，但【只可以睇】——
      //    role 雖然係 'superadmin'（見 AuthProvider 嘅 portalRole），
      //    顯示上一定要寫清楚 view-only，否則會誤會自己有 Reset／刪除權。
      roleLabel: 'View-only',
      monitorScope: 'all',
      workflowScope: 'all',
      canPullFromPortal: false,
      canEditPlans: false,
      canManage: false,
    }
  }

  // Firebase 帳號：Workflow 由 Firestore 快照讀（唔抽）——
  // **只有 superadmin 先可以撳「由 AAI Portal 同步」**。
  return {
    userId: user.uid,
    displayName: user.displayName ?? user.email ?? user.uid,
    role: user.role,
    roleLabel:
      user.role === 'superadmin'
        ? 'Superadmin'
        : user.role === 'admin'
          ? 'Admin'
          : 'User (observer)',
    monitorScope: user.role === 'admin' ? 'unit' : 'all',
    workflowScope: user.role === 'admin' ? 'unit' : 'all',
    canPullFromPortal: user.role === 'superadmin',
    // Firebase 帳號照舊可以填／改計劃；
    // 只有 superadmin 可以刪 LOG／重設單位／同步本機舊紀錄。
    canEditPlans: true,
    canManage: user.role === 'superadmin',
    unit: user.role === 'admin' ? user.unit : undefined,
  }
}
