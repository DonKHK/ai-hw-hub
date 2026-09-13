import { createContext } from 'react'
import type { AppUser } from '../types'

export interface AuthContextValue {
  /** 已登入身份（Portal 身份 或 Firebase 帳號）；未登入為 null */
  user: AppUser | null
  /** 首次還原登入狀態期間為 true（Portal 模式同步讀 localStorage，通常係 false） */
  loading: boolean
  /** Portal 式登入：揀身份 id + 密碼 */
  login: (identityId: string, password: string) => Promise<void>
  /** Firebase 登入：Email + 密碼（角色由 Firestore users/{uid} 決定） */
  loginWithFirebase: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
