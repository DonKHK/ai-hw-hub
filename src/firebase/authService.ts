import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import type { Auth, User } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import type { Firestore } from 'firebase/firestore'
import { auth, db, isFirebaseConfigured } from './config'
import type { FirebaseProfile, Role } from '../types'

/**
 * Firebase 登入（Email / Password）＋ Firestore 角色讀取。
 *
 * 角色**唔存喺前端**，而係讀 Firestore `users/{uid}`：
 *   { email, displayName, role: 'superadmin'|'admin'|'user', unit, isActive }
 * 咁樣就可以直接喺 Firebase Console 改角色／停用帳號，唔使重新 deploy。
 *
 * ⚠️ 呢個 Vite SPA 冇後端，所以呢度嘅角色判斷只係 UI gate，唔係真正安全鎖。
 *    要真鎖就要靠 Firestore Security Rules 或 Cloud Functions。
 */

const USERS_COLLECTION = 'users'

const VALID_ROLES: Role[] = ['superadmin', 'admin', 'user']

/** Firebase 未初始化（冇 .env）時即刻報錯，唔好靜靜地死。 */
function firebaseAuth(): Auth {
  if (auth === null) {
    throw new Error('Firebase is not configured (missing .env). See .env.example.')
  }
  return auth
}

function firestore(): Firestore {
  if (db === null) {
    throw new Error('Firebase is not configured (missing .env). See .env.example.')
  }
  return db
}

/** Firebase 登入功能係咪可用（有 .env + Auth + Firestore）。 */
export function isFirebaseLoginReady(): boolean {
  return isFirebaseConfigured() && auth !== null && db !== null
}

/** Firebase 錯誤碼 → 中文訊息（跟返 app 現有嘅語氣）。 */
export function firebaseErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : ''

  // API key 問題嘅 error code 特別長（auth/api-key-not-valid.-please-pass-…），
  // 所以用 prefix 比對，唔用 switch。
  if (
    code.startsWith('auth/api-key-not-valid') ||
    code === 'auth/invalid-api-key'
  ) {
    return 'Firebase configuration is incorrect (API key) — check VITE_FIREBASE_* in .env, then restart npm run dev.'
  }

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password. Please try again.'
    case 'auth/user-mismatch':
      return 'That email is different from the account you are signed in with.'
    case 'auth/requires-recent-login':
      return 'Your sign-in is too old — sign out and sign in again first.'
    case 'auth/invalid-email':
      return 'Invalid email format.'
    case 'auth/user-disabled':
      return 'This account has been disabled.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Please try again later.'
    case 'auth/network-request-failed':
      return 'Network connection failed. Please check your connection.'
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled — go to Firebase Console → Authentication → Sign-in method and enable Email/Password.'
    case 'auth/configuration-not-found':
      return 'Firebase configuration is incomplete — check .env and make sure Email/Password is enabled in Authentication.'
    case 'permission-denied':
      return 'Cannot read the role setting (Firestore users/{uid}) — make sure the Firestore rules are published.'
    default:
      return error instanceof Error && error.message !== ''
        ? error.message
        : 'Sign-in failed. Please try again later.'
  }
}

function toRole(value: unknown): Role | null {
  return typeof value === 'string' && VALID_ROLES.includes(value as Role)
    ? (value as Role)
    : null
}

function toText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** 讀 Firestore `users/{uid}` 攞角色（搵唔到／格式唔啱回 null）。 */
export async function loadProfile(user: User): Promise<FirebaseProfile | null> {
  const snapshot = await getDoc(doc(firestore(), USERS_COLLECTION, user.uid))
  if (!snapshot.exists()) {
    return null
  }
  const data: Record<string, unknown> = snapshot.data() ?? {}
  const role = toRole(data.role)
  if (role === null) {
    return null
  }
  return {
    uid: user.uid,
    email: user.email,
    displayName: toText(data.displayName) ?? user.displayName ?? user.email,
    role,
    unit: toText(data.unit),
    isActive: data.isActive !== false,
  }
}

/**
 * Email / 密碼登入。
 * 登入成功但冇角色／已停用／Admin-User 冇綁單位 → 即刻 signOut 再丟錯，
 * 避免出現「登入咗但唔知自己係邊個 level」嘅狀態。
 */
export async function signInWithEmail(
  email: string,
  password: string,
): Promise<FirebaseProfile> {
  const credential = await signInWithEmailAndPassword(
    firebaseAuth(),
    email.trim(),
    password,
  )

  let profile: FirebaseProfile | null
  try {
    profile = await loadProfile(credential.user)
  } catch (error) {
    await signOut(firebaseAuth())
    throw error
  }

  if (profile === null) {
    await signOut(firebaseAuth())
    throw new Error(
      'This account has no role set — add a role field to Firestore users/{uid}.',
    )
  }
  if (!profile.isActive) {
    await signOut(firebaseAuth())
    throw new Error('This account has been disabled.')
  }
  // 只有 admin（管理自己單位）一定要綁 unit；
  // superadmin 同觀察員（user）都係睇全部，唔需要綁單位。
  if (profile.role === 'admin' && profile.unit === null) {
    await signOut(firebaseAuth())
    throw new Error(
      'An Admin account must be linked to a unit — fill in Firestore users/{uid}.unit.',
    )
  }

  return profile
}

export async function signOutFirebase(): Promise<void> {
  if (auth === null) {
    return
  }
  await signOut(auth)
}

/**
 * 🔐 重新驗證目前登入嘅 Firebase 帳號（要求再輸入密碼）。
 *
 * 用嚟保護【不可逆】操作（重設一個單位嘅全部資料）——
 * 就算有人偷用一個已經解鎖嘅瀏覽器，冇密碼都做唔到。
 *
 * ⚠️ 用 `reauthenticateWithCredential`（唔係再 signIn 一次）→ 唔會影響 session。
 * ⚠️ Email 一定要同目前登入帳號一樣，否則 Firebase 會丟 `auth/user-mismatch`。
 * ⚠️ 呢個係 **Firebase 伺服器端驗證**，唔係前端假驗證。
 */
export async function confirmSuperadminPassword(
  email: string,
  password: string,
): Promise<void> {
  const current = firebaseAuth().currentUser
  if (current === null) {
    throw new Error('You are already signed out. Please sign in again.')
  }

  const credential = EmailAuthProvider.credential(email.trim(), password)
  // 密碼錯 / 帳號唔對 → 呢度會 throw（auth/wrong-password / auth/user-mismatch）
  await reauthenticateWithCredential(current, credential)

  // 再確認 Firestore 角色仍然係 superadmin（可能有人中途改咗）
  const profile = await loadProfile(current)
  if (profile === null || !profile.isActive || profile.role !== 'superadmin') {
    throw new Error('This account is not a Superadmin, so it cannot reset data.')
  }
}

/** 訂閱登入狀態（開 app 時還原 Firebase session 用）。 */
export function subscribeToAuth(
  handler: (user: User | null) => void,
): () => void {
  if (auth === null) {
    return () => {}
  }
  return onAuthStateChanged(auth, handler)
}
