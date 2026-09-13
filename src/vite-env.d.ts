/// <reference types="vite/client" />

/**
 * Firebase Web 設定（由 .env 注入，參考 .env.example）。
 * 未有 .env 時全部會係 undefined —— src/firebase/config.ts 會自動
 * 判斷 isFirebaseConfigured()，唔會令成個 app crash。
 */
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string

  /** AAI AI Homework Portal（Supabase）—— workflow 清單來源（可選） */
  readonly VITE_PORTAL_SUPABASE_URL?: string
  readonly VITE_PORTAL_SUPABASE_ANON_KEY?: string
  readonly VITE_PORTAL_UNITS_TABLE?: string
  readonly VITE_PORTAL_WORKFLOWS_TABLE?: string
  readonly VITE_PORTAL_UNIT_COL?: string
  readonly VITE_PORTAL_UNIT_NAME_COL?: string

  /**
   * 🔐 Portal 登入 —— 身份清單同密碼（**唔會 commit 落 repo**）。
   * 冇填 = 登入唔到（fail-closed），同時列出「未設定」提示。
   */
  readonly VITE_PORTAL_DEPT_NAMES?: string
  readonly VITE_PORTAL_BUSINESS_NAMES?: string
  readonly VITE_PORTAL_CEO_PASSWORD?: string
  readonly VITE_PORTAL_STEERING_PASSWORD?: string
  readonly VITE_PORTAL_ADMIN_PASSWORD?: string
  readonly VITE_PORTAL_UNIT_PASSWORD_SUFFIX?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
