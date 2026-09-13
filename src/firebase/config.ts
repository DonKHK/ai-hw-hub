import { initializeApp } from 'firebase/app'
import type { FirebaseApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import type { Auth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import type { Firestore } from 'firebase/firestore'

/**
 * 所有 Firebase Web 設定由 .env 提供（參考 .env.example）。
 * 未有 .env 時，isFirebaseConfigured() 會回傳 false，
 * 頁面會顯示設定指引，而唔會令成個 app crash。
 */
interface FirebaseConfigValues {
  apiKey?: string
  authDomain?: string
  projectId?: string
  storageBucket?: string
  messagingSenderId?: string
  appId?: string
  measurementId?: string
}

const config: FirebaseConfigValues = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

const REQUIRED_FIELDS = ['apiKey', 'authDomain', 'projectId', 'appId'] as const

/**
 * `.env.example` 嘅佔位值當作「未設定」。
 * 如果唔過濾，直接複製 .env.example 做 .env 就會被當成「已設定」，
 * 然後 initializeApp 會爆啲好難明嘅 Firebase 錯誤（例如 API key 無效）。
 */
const PLACEHOLDER_PATTERN = /^(your-|xxx|placeholder|change-me|<)/i

function hasRealValue(field: keyof FirebaseConfigValues): boolean {
  const value = config[field]?.trim() ?? ''
  return value !== '' && !PLACEHOLDER_PATTERN.test(value)
}

export function isFirebaseConfigured(): boolean {
  return REQUIRED_FIELDS.every((field) => hasRealValue(field))
}

/** 4 個必需值對應嘅 .env 變數名。 */
const REQUIRED_ENV_NAMES: Record<(typeof REQUIRED_FIELDS)[number], string> = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  appId: 'VITE_FIREBASE_APP_ID',
}

export type FirebaseConfigFieldState = 'ok' | 'empty' | 'placeholder'

export interface FirebaseConfigFieldStatus {
  envName: string
  state: FirebaseConfigFieldState
}

/**
 * 診斷用：列出 4 個必需值而家嘅狀態（**唔會露出真值**）。
 * 登入頁「Firebase 登入未設定」嘅指引會用佢話你知仍然爭邊個。
 */
export function firebaseConfigStatus(): FirebaseConfigFieldStatus[] {
  return REQUIRED_FIELDS.map((field) => {
    const value = config[field]?.trim() ?? ''
    let state: FirebaseConfigFieldState = 'ok'
    if (value === '') {
      state = 'empty'
    } else if (PLACEHOLDER_PATTERN.test(value)) {
      state = 'placeholder'
    }
    return { envName: REQUIRED_ENV_NAMES[field], state }
  })
}

let firebaseApp: FirebaseApp | null = null
let firebaseAuth: Auth | null = null
let firestore: Firestore | null = null

if (isFirebaseConfigured()) {
  firebaseApp = initializeApp(config)
  firebaseAuth = getAuth(firebaseApp)
  firestore = getFirestore(firebaseApp)
}

export { firebaseApp, firebaseAuth as auth, firestore as db }
