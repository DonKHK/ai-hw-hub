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

export function isFirebaseConfigured(): boolean {
  return REQUIRED_FIELDS.every((field) => Boolean(config[field]))
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
