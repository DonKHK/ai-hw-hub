import type { Role } from '../types'

/**
 * Firebase 登入嘅 3 個 login level。
 *
 * 實際角色由 Firestore `users/{uid}.role` 決定（可以喺 Firebase Console 改，
 * 唔使重新 deploy）。呢個檔只係集中定義 label 同示範資料，方便 UI 顯示。
 *
 * ⚠️ 前端判斷只係 UI gate，唔係真正安全鎖 —— 要真鎖就要靠 Firestore
 * Security Rules 或 Cloud Functions。
 */

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  user: 'User',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  superadmin: 'View workflows and data for all units',
  admin: 'Manage workflows and data for your own unit',
  user: 'View your own unit, work on your own items',
}

/** 只有superadmin 同 admin 可以做管理工作。 */
export function canManage(role: Role): boolean {
  return role === 'superadmin' || role === 'admin'
}

/** Firebase Console 開帳號時，用嚟列出 3 個 level 嘅說明。 */
export const FIREBASE_ROLE_OPTIONS: Array<{
  id: Role
  label: string
  description: string
}> = [
  {
    id: 'superadmin',
    label: ROLE_LABELS.superadmin,
    description: ROLE_DESCRIPTIONS.superadmin,
  },
  {
    id: 'admin',
    label: ROLE_LABELS.admin,
    description: ROLE_DESCRIPTIONS.admin,
  },
  {
    id: 'user',
    label: ROLE_LABELS.user,
    description: ROLE_DESCRIPTIONS.user,
  },
]
