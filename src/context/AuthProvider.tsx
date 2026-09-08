import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { auth } from '../firebase/config'
import type { AppUser } from '../types'
import { AuthContext } from './authContext'
import type { AuthContextValue } from './authContext'

export const NOT_CONFIGURED_MESSAGE =
  'Firebase 尚未設定。請參考 README.md 建立 .env 並重新啟動 dev server。'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  // 只有真係有 Firebase 時先需要「讀取登入狀態」階段
  const [loading, setLoading] = useState(() => auth !== null)
  const configured = auth !== null

  useEffect(() => {
    if (auth === null) {
      return
    }

    const currentAuth = auth
    const unsubscribe = onAuthStateChanged(currentAuth, (firebaseUser) => {
      setUser(
        firebaseUser
          ? {
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              displayName: firebaseUser.displayName,
            }
          : null,
      )
      setLoading(false)
    })
    return unsubscribe
  }, [])

  const value = useMemo<AuthContextValue>(() => {
    return {
      user,
      loading,
      configured,
      async login(email: string, password: string): Promise<void> {
        const currentAuth = auth
        if (currentAuth === null) {
          throw new Error(NOT_CONFIGURED_MESSAGE)
        }
        await signInWithEmailAndPassword(currentAuth, email, password)
      },
      async register(
        email: string,
        password: string,
        displayName: string,
      ): Promise<void> {
        const currentAuth = auth
        if (currentAuth === null) {
          throw new Error(NOT_CONFIGURED_MESSAGE)
        }
        const credential = await createUserWithEmailAndPassword(
          currentAuth,
          email,
          password,
        )
        const name = displayName.trim()
        if (name !== '' && credential.user) {
          await updateProfile(credential.user, { displayName: name })
        }
      },
      async loginWithGoogle(): Promise<void> {
        const currentAuth = auth
        if (currentAuth === null) {
          throw new Error(NOT_CONFIGURED_MESSAGE)
        }
        await signInWithPopup(currentAuth, new GoogleAuthProvider())
      },
      async logout(): Promise<void> {
        const currentAuth = auth
        if (currentAuth !== null) {
          await signOut(currentAuth)
        }
      },
    }
  }, [user, loading, configured])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
