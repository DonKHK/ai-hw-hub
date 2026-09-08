import { createContext } from 'react'
import type { AppUser } from '../types'

export interface AuthContextValue {
  user: AppUser | null
  /** 首次讀取登入狀態期間為 true */
  loading: boolean
  /** .env 是否已提供有效 Firebase 設定 */
  configured: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName: string) => Promise<void>
  loginWithGoogle: () => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
