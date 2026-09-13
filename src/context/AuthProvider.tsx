import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { findIdentity, validatePortalLogin } from '../lib/portalData'
import type { PortalIdentity } from '../lib/portalData'
import {
  firebaseErrorMessage,
  loadProfile,
  signInWithEmail,
  signOutFirebase,
  subscribeToAuth,
} from '../firebase/authService'
import { isFirebaseConfigured } from '../firebase/config'
import type {
  AppUser,
  AuthProvider as AuthProviderId,
  FirebaseProfile,
  Role,
} from '../types'
import { AuthContext } from './authContext'
import type { AuthContextValue } from './authContext'

const SESSION_KEY = 'ai-hw-hub.session.v1'
/** 記住上次用邊個方法登入：開 app 時先知要唔要等 Firebase 還原 session。 */
const PROVIDER_KEY = 'ai-hw-hub.authProvider.v1'

/**
 * Portal 身份 → 登入級別。
 * 只係為咗統一 model／顯示，**唔會改變原有 workflow 範圍**
 * （範圍一律由 src/lib/access.ts 嘅 accessForUser() 決定）。
 */
function portalRole(identity: PortalIdentity): Role {
  if (identity.kind === 'ceo') {
    return 'superadmin'
  }
  if (identity.kind === 'readonly') {
    return 'admin'
  }
  return 'user'
}

function identityToUser(identity: PortalIdentity): AppUser {
  const isUnitUser = identity.kind === 'dept' || identity.kind === 'business'
  return {
    uid: identity.id,
    email: null,
    displayName: identity.name,
    provider: 'portal',
    role: portalRole(identity),
    unit: isUnitUser ? identity.name : undefined,
  }
}

/** Firebase profile → AppUser。uid 加 "fb:" 前綴，唔會同 portal 身份 id 撞。 */
function profileToUser(profile: FirebaseProfile): AppUser {
  return {
    uid: `fb:${profile.uid}`,
    email: profile.email,
    displayName: profile.displayName ?? profile.email ?? profile.uid,
    provider: 'firebase',
    role: profile.role,
    unit: profile.unit ?? undefined,
  }
}

/** 由 localStorage 讀返上次登入嘅 Portal 身份（冇就 null）。 */
function readStoredUser(): AppUser | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY)
    if (raw === null) {
      return null
    }
    const parsed = JSON.parse(raw) as { id?: unknown; name?: unknown }
    if (typeof parsed.id !== 'string' || typeof parsed.name !== 'string') {
      return null
    }
    const identity = findIdentity(parsed.id)
    return identity === undefined ? null : identityToUser(identity)
  } catch {
    return null
  }
}

function readStoredProvider(): AuthProviderId {
  return window.localStorage.getItem(PROVIDER_KEY) === 'firebase'
    ? 'firebase'
    : 'portal'
}

/**
 * 登入 Provider —— 支援兩種方法：
 * 1. Portal 式：揀身份（CEO / Steering / Dept / Business）+ 密碼，存 localStorage
 *    （呢個 Vite SPA 冇 server，所以用 localStorage 代替 Next.js 版嘅 httpOnly cookie）
 * 2. Firebase：Email + 密碼，角色由 Firestore `users/{uid}` 決定
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(() =>
    readStoredProvider() === 'portal' ? readStoredUser() : null,
  )
  // Firebase 模式先需要等 onAuthStateChanged 還原 session，所以 initial 可能係 true
  const [loading, setLoading] = useState<boolean>(
    () => readStoredProvider() === 'firebase' && isFirebaseConfigured(),
  )

  useEffect(() => {
    // 冇 .env 時 loading 一開始已經係 false（見上面 useState initializer），
    // 所以直接唔訂閱就夠，唔需要喺 effect 度再 setState。
    if (!isFirebaseConfigured()) {
      return
    }

    let cancelled = false
    const unsubscribe = subscribeToAuth((firebaseUser) => {
      if (cancelled) {
        return
      }

      if (firebaseUser === null) {
        // Firebase 冇 session。只有上次真係用 Firebase 登入先清走個 user，
        // 否則會連 Portal 用戶都被踢走。
        if (readStoredProvider() === 'firebase') {
          window.localStorage.removeItem(PROVIDER_KEY)
          setUser(null)
        }
        setLoading(false)
        return
      }

      void loadProfile(firebaseUser)
        .then((profile) => {
          if (cancelled) {
            return
          }
          // 冇角色 或者 已被停用 → 唔好放佢入去（就算 session 仲喺度）
          if (profile === null || !profile.isActive) {
            window.localStorage.removeItem(PROVIDER_KEY)
            setUser(null)
            return
          }
          window.localStorage.setItem(PROVIDER_KEY, 'firebase')
          window.localStorage.removeItem(SESSION_KEY)
          setUser(profileToUser(profile))
        })
        .catch(() => {
          if (!cancelled) {
            setUser(null)
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false)
          }
        })
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      async login(identityId: string, password: string): Promise<void> {
        const identity = validatePortalLogin(identityId.trim(), password)
        if (identity === null) {
          throw new Error('Incorrect password. Please try again.')
        }
        // 之前用 Firebase 登入嘅話要先登出，避免兩個 session 同時存在
        if (readStoredProvider() === 'firebase' && isFirebaseConfigured()) {
          await signOutFirebase()
        }
        window.localStorage.setItem(
          SESSION_KEY,
          JSON.stringify({
            id: identity.id,
            name: identity.name,
            kind: identity.kind,
          }),
        )
        window.localStorage.setItem(PROVIDER_KEY, 'portal')
        setUser(identityToUser(identity))
      },
      async loginWithFirebase(email: string, password: string): Promise<void> {
        try {
          const profile = await signInWithEmail(email, password)
          window.localStorage.removeItem(SESSION_KEY)
          window.localStorage.setItem(PROVIDER_KEY, 'firebase')
          setUser(profileToUser(profile))
        } catch (error) {
          throw new Error(firebaseErrorMessage(error))
        }
      },
      async logout(): Promise<void> {
        const provider = readStoredProvider()
        window.localStorage.removeItem(SESSION_KEY)
        window.localStorage.removeItem(PROVIDER_KEY)
        setUser(null)
        if (provider === 'firebase' && isFirebaseConfigured()) {
          await signOutFirebase()
        }
      },
    }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

